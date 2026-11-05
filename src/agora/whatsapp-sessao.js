// ============================================
// agora/whatsapp-sessao.js — Sessão do WhatsApp guardada no Supabase
// ============================================
// O disco do Render/Railway é apagado a cada deploy; sem isto, seria preciso parear o
// número de novo toda vez. Tabela em sql/whatsapp_sessao.sql. O conteúdo equivale a estar
// logado no número: só a chave de serviço acessa, e a tabela não tem nenhuma política de RLS.

import { BufferJSON, initAuthCreds, proto } from 'baileys';

const TABELA = 'whatsapp_sessao';
const LOTE = 100;
const CHAVE_CREDS = 'creds';

const lotes = (lista) => {
  const saida = [];
  for (let i = 0; i < lista.length; i += LOTE) saida.push(lista.slice(i, i + LOTE));
  return saida;
};
const conferir = ({ error }) => {
  if (error) throw new Error(`Sessão do WhatsApp no banco: ${error.message}`);
};

/** Mesma interface do useMultiFileAuthState do Baileys, mas gravando na tabela. */
export async function criarSessao(adm, sessao = 'principal') {
  // As gravações vão em fila: uma credencial antiga nunca sobrescreve uma mais nova.
  let fila = Promise.resolve();
  const naFila = (tarefa) => {
    const atual = fila.then(tarefa);
    fila = atual.catch(() => null);
    return atual;
  };

  const gravar = async (linhas) => {
    const em = new Date().toISOString();
    for (const lote of lotes(linhas)) {
      conferir(await adm.from(TABELA).upsert(lote.map((l) => ({ sessao, ...l, atualizado_em: em }))));
    }
  };

  const ler = async (chaves) => {
    const valores = new Map();
    for (const lote of lotes(chaves)) {
      const r = await adm.from(TABELA).select('chave, valor').eq('sessao', sessao).in('chave', lote);
      conferir(r);
      for (const l of r.data ?? []) valores.set(l.chave, JSON.parse(l.valor, BufferJSON.reviver));
    }
    return valores;
  };

  const creds = (await ler([CHAVE_CREDS])).get(CHAVE_CREDS) ?? initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (tipo, ids) => {
          const achados = await ler(ids.map((id) => `${tipo}-${id}`));
          const saida = {};
          for (const id of ids) {
            let valor = achados.get(`${tipo}-${id}`) ?? null;
            if (tipo === 'app-state-sync-key' && valor) valor = proto.Message.AppStateSyncKeyData.fromObject(valor);
            saida[id] = valor;
          }
          return saida;
        },
        set: (dados) =>
          naFila(async () => {
            const gravacoes = [];
            const remocoes = [];
            for (const tipo of Object.keys(dados)) {
              for (const [id, valor] of Object.entries(dados[tipo])) {
                const chave = `${tipo}-${id}`;
                if (valor) gravacoes.push({ chave, valor: JSON.stringify(valor, BufferJSON.replacer) });
                else remocoes.push(chave);
              }
            }
            await gravar(gravacoes);
            for (const lote of lotes(remocoes)) {
              conferir(await adm.from(TABELA).delete().eq('sessao', sessao).in('chave', lote));
            }
          }),
      },
    },
    saveCreds: () => naFila(() => gravar([{ chave: CHAVE_CREDS, valor: JSON.stringify(creds, BufferJSON.replacer) }])),
    /** Espera as gravações em andamento (antes de reconectar ou desligar). */
    aguardar: () => fila,
    /** Apaga a sessão inteira (o número foi desconectado e precisa parear de novo). */
    limpar: () => naFila(async () => conferir(await adm.from(TABELA).delete().eq('sessao', sessao))),
  };
}

/** Devolve a mensagem de erro se a tabela não existir ou não puder ser lida. */
export async function verificarTabelaSessao(adm) {
  const { error } = await adm.from(TABELA).select('chave').limit(1);
  return error?.message ?? null;
}
