// ============================================
// agora/prefixo.js — Comandos com % (ex.: %menu, %app, %biblioteca acervo tarô)
// ============================================
// Para quem não consegue (ou não quer) usar os comandos de barra. Mensagens comuns não
// podem ter respostas "só para você", então o bot responde à mensagem com um botão
// "Abrir" que só funciona para quem digitou: o clique roda o mesmo comando de barra e a
// resposta aparece só para a pessoa. A mensagem do botão some sozinha em seguida.
//
// Precisa da intent privilegiada "Message Content" (Developer Portal › Bot).

import crypto from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { config } from '../config.js';

export const PREFIXO = config.agora.prefixo;
const VIDA_LANCADOR = 2 * 60_000;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Atalhos curtos → [comando, subcomando]
const ATALHOS = {
  ajuda: ['agora', 'ajuda'],
  comandos: ['agora', 'ajuda'],
  entrar: ['agora', 'entrar'],
  conta: ['agora', 'entrar'],
  perfil: ['agora', 'perfil'],
  app: ['agora', 'app'],
  codigo: ['agora', 'app'],
  email: ['agora', 'email'],
  pseudonimo: ['agora', 'pseudonimo'],
  notificacoes: ['agora', 'notificacoes'],
  buscar: ['agora', 'buscar'],
  busca: ['agora', 'buscar'],
  acervo: ['biblioteca', 'acervo'],
  topicos: ['biblioteca', 'topicos'],
  artigos: ['biblioteca', 'artigos'],
  trilhas: ['biblioteca', 'trilhas'],
  projetos: ['mutirao', 'projetos'],
  eventos: ['mutirao', 'eventos'],
  propostas: ['assembleia', 'propostas'],
  decisoes: ['assembleia', 'decisoes'],
  dracma: ['dracmas', null],
  tutorial: ['menu', 'tutorial'],
  subir: ['menu', 'subir'],
  nivel: ['menu', 'subir'],
};

// Comando com subcomandos digitado sem subcomando → abre a área no menu
const AREA_NO_MENU = { agora: 'conta', biblioteca: 'biblioteca', mutirao: 'mutirao', assembleia: 'assembleia', aulas: 'aulas' };

export const normalizar = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const pendentes = new Map(); // token → { autorId, comando, sub, resto, texto, em }
const recentes = new Map(); // autorId → [timestamps] (limite de uso)

function limparVelhos() {
  const agora = Date.now();
  for (const [t, p] of pendentes) if (agora - p.em > VIDA_LANCADOR) pendentes.delete(t);
}

/**
 * Entende "%biblioteca acervo tarô" → { comando: 'biblioteca', sub: 'acervo', resto: 'tarô' }.
 * Devolve null quando não é um comando conhecido.
 */
export function interpretar(texto, comandos) {
  if (!PREFIXO || !texto.startsWith(PREFIXO)) return null;
  const corpo = texto.slice(PREFIXO.length).trim();
  if (!corpo || !/^[\p{L}]/u.test(corpo)) return null;
  const [primeiro, ...resto] = corpo.split(/\s+/);
  const nome = normalizar(primeiro);
  let comando;
  let sub = null;
  let args = resto;
  if (comandos.has(nome)) {
    comando = nome;
    const dados = comandos.get(nome).data.toJSON();
    const subs = (dados.options ?? []).filter((o) => o.type === 1).map((o) => o.name);
    if (subs.length) {
      const candidato = normalizar(args[0] ?? '');
      if (subs.includes(candidato)) {
        sub = candidato;
        args = args.slice(1);
      } else {
        sub = null; // sem subcomando: abre a área no menu
      }
    }
  } else if (ATALHOS[nome]) {
    [comando, sub] = ATALHOS[nome];
  } else {
    return { desconhecido: nome };
  }
  return { comando, sub, resto: args.join(' ').trim() };
}

/** Distribui o texto digitado pelas opções do subcomando (com "|" para separar várias). */
export async function montarOpcoes(interaction, comando, sub, resto) {
  const dados = comando.data.toJSON();
  const defs = sub ? (dados.options ?? []).find((o) => o.name === sub)?.options ?? [] : (dados.options ?? []).filter((o) => o.type !== 1);
  const valores = {};
  const partes = resto.includes('|') ? resto.split('|').map((s) => s.trim()) : null;

  if (partes) {
    defs.forEach((d, i) => {
      if (partes[i] !== undefined && partes[i] !== '') valores[d.name] = partes[i];
    });
  } else if (resto) {
    let texto = resto;
    for (const d of defs) {
      if (d.type === 6) { // usuário: menção <@id>
        const m = /<@!?(\d+)>/.exec(texto);
        if (m) { valores[d.name] = m[1]; texto = texto.replace(m[0], ' '); }
      } else if (d.type === 7) { // canal: <#id>
        const m = /<#(\d+)>/.exec(texto);
        if (m) { valores[d.name] = m[1]; texto = texto.replace(m[0], ' '); }
      } else if (d.type === 4 || d.type === 10) { // número
        const m = /(^|\s)(\d+(?:[.,]\d+)?)(?=\s|$)/.exec(texto);
        if (m) { valores[d.name] = m[2]; texto = texto.replace(m[2], ' '); }
      }
    }
    texto = texto.replace(/\s+/g, ' ').trim();
    const primeiraTexto = defs.find((d) => d.type === 3);
    if (texto && primeiraTexto) valores[primeiraTexto.name] = texto;
  }

  // Converte para o tipo de cada opção e resolve nomes digitados em opções de autocompletar
  const final = {};
  for (const d of defs) {
    const v = valores[d.name];
    if (v === undefined) continue;
    if (d.type === 4) final[d.name] = Number.parseInt(v, 10);
    else if (d.type === 10) final[d.name] = Number(String(v).replace(',', '.'));
    else if (d.type === 5) final[d.name] = /^(sim|s|true|1|yes)$/i.test(v);
    else if (d.type === 6) final[d.name] = await interaction.client.users.fetch(String(v).replace(/\D/g, '')).catch(() => null);
    else if (d.type === 7) final[d.name] = interaction.guild?.channels?.cache?.get(String(v).replace(/\D/g, '')) ?? null;
    else if (d.autocomplete && !UUID.test(v) && typeof comando.autocomplete === 'function') {
      final[d.name] = (await sugerir(interaction, comando, d.name, v)) ?? v;
    } else final[d.name] = v;
  }
  return final;
}

/** Usa o autocompletar do próprio comando para achar o item pelo nome digitado. */
async function sugerir(interaction, comando, opcao, termo) {
  let escolhido = null;
  const falso = {
    user: interaction.user,
    member: interaction.member,
    guild: interaction.guild,
    client: interaction.client,
    options: { getFocused: (completo) => (completo ? { name: opcao, value: termo } : termo) },
    respond: async (lista) => { escolhido = lista?.[0]?.value ?? null; },
  };
  await comando.autocomplete(falso).catch(() => null);
  return escolhido;
}

function opcoesFalsas(sub, valores) {
  const obter = (n) => valores[n] ?? null;
  return {
    getSubcommand: () => sub,
    getString: obter,
    getInteger: obter,
    getNumber: obter,
    getBoolean: obter,
    getUser: obter,
    getChannel: obter,
    getFocused: () => '',
  };
}

// ------------------------------------------------------------------ mensagens com %
export async function aoReceberMensagem(message, comandos) {
  if (!PREFIXO || message.author?.bot || !message.inGuild?.()) return;
  const texto = message.content?.trim() ?? '';
  if (!texto.startsWith(PREFIXO)) return;
  const pedido = interpretar(texto, comandos);
  if (!pedido) return;

  // limite: 10 comandos por minuto por pessoa (avisa uma vez quando passa)
  const agora = Date.now();
  const lista = (recentes.get(message.author.id) ?? []).filter((t) => agora - t < 60_000);
  lista.push(agora);
  recentes.set(message.author.id, lista);
  if (lista.length > 10) {
    if (lista.length === 11) {
      const aviso = await message.reply({ content: 'Calma 🙂 muitos comandos seguidos. Espere um minutinho e tente de novo.', allowedMentions: { repliedUser: false } }).catch(() => null);
      setTimeout(() => aviso?.delete().catch(() => null), 20_000);
    }
    return;
  }

  if (pedido.desconhecido) {
    const aviso = await message.reply({
      content: `Não conheço **${PREFIXO}${pedido.desconhecido}**. Comece por **${PREFIXO}menu** (tudo em botões) ou veja **${PREFIXO}ajuda**.`,
      allowedMentions: { repliedUser: false },
    }).catch(() => null);
    setTimeout(() => aviso?.delete().catch(() => null), 30_000);
    return;
  }

  limparVelhos();
  const token = crypto.randomBytes(6).toString('hex');
  pendentes.set(token, { autorId: message.author.id, ...pedido, texto, em: agora });
  const botao = new ButtonBuilder().setCustomId(`px:${token}`).setLabel('Abrir (só você vê)').setStyle(ButtonStyle.Primary).setEmoji('🔒');
  const lancador = await message.reply({
    content: `${message.author}, toque no botão para ver **${texto.slice(0, 60)}** — a resposta aparece só para você.`,
    components: [new ActionRowBuilder().addComponents(botao)],
    allowedMentions: { repliedUser: false, users: [] },
  }).catch((e) => {
    console.error('⚠️  Comando com %: não consegui responder no canal:', e.message);
    return null;
  });
  if (!lancador) return;
  // Limpa o chat: some com o botão depois de um tempo e (se o bot puder) com a mensagem digitada
  setTimeout(() => lancador.delete().catch(() => null), VIDA_LANCADOR);
  message.delete().catch(() => null);
}

/** Clique no botão "Abrir": roda o comando como se fosse o de barra. */
export async function aoClicar(interaction, token, comandos) {
  const pedido = pendentes.get(token);
  if (!pedido) {
    return interaction.reply({ content: `Esse botão expirou. Digite de novo (ex.: **${PREFIXO}menu**).`, flags: MessageFlags.Ephemeral });
  }
  if (pedido.autorId !== interaction.user.id) {
    return interaction.reply({ content: `Esse botão é de outra pessoa. Digite **${PREFIXO}menu** para abrir o seu.`, flags: MessageFlags.Ephemeral });
  }
  const comando = comandos.get(pedido.comando);
  try {
    if (pedido.comando === 'menu' && pedido.sub === 'tutorial') return await comando.handleInteraction(interaction, ['tutorial', '0']);
    if (pedido.comando === 'menu' && pedido.sub === 'subir') return await comando.handleInteraction(interaction, ['subir']);
    if (!pedido.sub && AREA_NO_MENU[pedido.comando]) {
      return await comandos.get('menu').handleInteraction(interaction, [AREA_NO_MENU[pedido.comando]]);
    }
    const valores = await montarOpcoes(interaction, comando, pedido.sub, pedido.resto ?? '');
    // O botão vira o "comando": as funções de cada comando leem as opções daqui
    Object.defineProperty(interaction, 'options', { value: opcoesFalsas(pedido.sub, valores), configurable: true });
    Object.defineProperty(interaction, 'commandName', { value: pedido.comando, configurable: true });
    return await comando.execute(interaction);
  } finally {
    pendentes.delete(token);
    interaction.message?.delete?.().catch(() => null);
  }
}

/** Texto de ajuda dos comandos com % */
export function ajudaPrefixo() {
  if (!PREFIXO) return null;
  const p = PREFIXO;
  return [
    `**Sem barra?** Use **${p}** no lugar: **${p}menu** abre o painel com tudo. Atalhos: **${p}tutorial** · **${p}app** (código para o app) · **${p}perfil** · **${p}dracmas** · **${p}acervo** *busca* · **${p}aulas** · **${p}subir** (como subir de nível) · **${p}ajuda**.`,
    `Qualquer comando de barra funciona igual: **${p}biblioteca topico** *título* · **${p}mutirao horas** *projeto* **|** *horas* **|** *o que fez* (use **|** para separar os campos).`,
  ].join('\n');
}
