// ============================================
// agora/cmd-dracmas.js — /dracmas: prévia dos créditos de Dracma (DRC)
// ============================================
// Os créditos já são calculados pelo banco da Ágora a cada ponto de reputação.
// Na prévia eles ficam guardados; o resgate on-chain acontece pela carteira do app.

import { SlashCommandBuilder } from 'discord.js';
import { dados } from './cliente.js';
import { COR, ROTULOS_ACAO, comoMembro, embed, linkApp, numero, relativo, responder } from './ui.js';

export const data = new SlashCommandBuilder()
  .setName('dracmas')
  .setDescription('Prévia dos seus Dracmas (DRC): créditos acumulados contribuindo com a comunidade.');

/** Próximo fechamento de época: toda segunda-feira às 03:10 (UTC) */
function proximoFechamento(agora = new Date()) {
  const d = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), 3, 10));
  const dias = (8 - d.getUTCDay()) % 7; // 1 = segunda
  d.setUTCDate(d.getUTCDate() + dias);
  if (d <= agora) d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString();
}

export async function execute(interaction) {
  return comoMembro(interaction, async ({ sb, perfil }) => {
    const [pendente, creditos, historico, conf] = await Promise.all([
      dados(sb.rpc('meu_saldo_drc_pendente')),
      dados(sb.from('creditos_drc').select('epoca_id, valor, resgatado_em').eq('profile_id', perfil.id).order('epoca_id', { ascending: false }).limit(10)),
      dados(sb.rpc('historico_reputacao', { p_profile: perfil.id, p_limite: 8, p_antes: null })),
      dados(sb.from('configuracoes').select('valor').eq('chave', 'drc').maybeSingle()),
    ]);
    const taxa = Number(conf?.valor?.taxa_conversao ?? 1);
    const teto = Number(conf?.valor?.teto_por_carteira_epoca ?? 2000);
    const emEpocas = creditos.reduce((s, c) => s + Number(c.valor), 0);
    const resgatado = creditos.filter((c) => c.resgatado_em).reduce((s, c) => s + Number(c.valor), 0);
    const total = Number(pendente) + emEpocas;

    const e = embed(
      `Seus Dracmas: ${numero(total)} DRC`,
      [
        `**${numero(pendente)} DRC** acumulados desde o último fechamento`,
        `**${numero(emEpocas - resgatado)} DRC** em épocas fechadas, aguardando resgate`,
        resgatado ? `**${numero(resgatado)} DRC** já resgatados na carteira` : null,
        '',
        `Próximo fechamento de época: ${relativo(proximoFechamento())}. Cada ponto de reputação vale **${numero(taxa)} DRC** (até ${numero(teto)} DRC por semana).`,
      ].filter((x) => x !== null).join('\n'),
      COR.dourado,
    );
    if (historico.length) {
      e.addFields({
        name: 'De onde vieram',
        value: historico
          .filter((h) => h.pontos !== 0)
          .map((h) => `${h.pontos > 0 ? '+' : ''}${numero(h.pontos * taxa)} DRC · ${ROTULOS_ACAO[h.acao] ?? h.acao} · ${relativo(h.criado_em)}`)
          .join('\n') || '—',
      });
    } else {
      e.addFields({
        name: 'Como ganhar',
        value: 'Publique artigos, revise os de outros membros, tenha respostas marcadas como úteis, registre horas de mutirão confirmadas e vá aos eventos. Cada contribuição confirmada vira reputação — e reputação vira DRC.',
      });
    }
    e.addFields({
      name: 'O que é o Dracma',
      value: [
        'Ficha de participação da Ágora: reconhece contribuições verificadas e dá voz nas decisões on-chain da Assembleia.',
        'Não é vendido, não tem preço no app e não é investimento.',
        `Na prévia os créditos ficam guardados; o resgate acontece pela carteira do app (${linkApp()}).`,
      ].join('\n'),
    });
    return responder(interaction, { embeds: [e] });
  });
}
