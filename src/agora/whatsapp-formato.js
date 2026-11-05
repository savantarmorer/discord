// ============================================
// agora/whatsapp-formato.js — Regras da ponte WhatsApp ⇄ Discord (sem rede)
// ============================================
// Decide o que atravessa a ponte e como o texto fica do outro lado. Separado da
// conexão para poder ser testado sem WhatsApp nem Discord (scripts/testar-whatsapp.mjs).

import { areJidsSameUser } from 'baileys';

export const LIMITE_DISCORD = 2000;
const LIMITE_NOME_WEBHOOK = 80;

const MIDIAS = {
  imageMessage: '📷 imagem',
  videoMessage: '🎬 vídeo',
  ptvMessage: '🎬 vídeo',
  audioMessage: '🎤 áudio',
  documentMessage: '📄 documento',
  stickerMessage: '🖼️ figurinha',
  contactMessage: '👤 contato',
  contactsArrayMessage: '👤 contatos',
  locationMessage: '📍 localização',
  liveLocationMessage: '📍 localização',
  pollCreationMessage: '📊 enquete',
  pollCreationMessageV2: '📊 enquete',
  pollCreationMessageV3: '📊 enquete',
};

/**
 * Texto de uma mensagem do WhatsApp (já sem os invólucros de "temporária" etc.).
 * Mídia ainda não atravessa a ponte: vira um aviso, com a legenda quando houver.
 * Devolve null para o que não é conversa (reações, avisos internos, edições).
 */
export function textoDoWhatsApp(conteudo) {
  if (!conteudo) return null;
  if (conteudo.conversation) return conteudo.conversation;
  if (conteudo.extendedTextMessage?.text) return conteudo.extendedTextMessage.text;
  for (const [tipo, rotulo] of Object.entries(MIDIAS)) {
    if (!conteudo[tipo]) continue;
    const legenda = conteudo[tipo].caption;
    return legenda ? `[${rotulo}] ${legenda}` : `[${rotulo}]`;
  }
  return null;
}

/**
 * Filtra um evento "messages.upsert" e devolve o que deve ir para o Discord.
 * Nunca usa o número de quem enviou: no Discord só aparece o nome do perfil.
 */
export function mensagensParaDiscord(evento, grupoId, normalizar = (m) => m) {
  if (evento?.type !== 'notify' || !grupoId) return [];
  const saida = [];
  for (const m of evento.messages ?? []) {
    if (m.key?.remoteJid !== grupoId || m.key?.fromMe) continue; // fromMe evita o laço
    const texto = textoDoWhatsApp(normalizar(m.message));
    if (!texto?.trim()) continue;
    saida.push({ nome: m.pushName?.trim() || 'Membro do grupo', texto });
  }
  return saida;
}

/** Nome do webhook: o Discord recusa nomes com "discord" ou "clyde" e limita a 80 caracteres. */
export function nomeParaWebhook(nome) {
  const sufixo = ' · WhatsApp';
  const limpo = String(nome ?? '')
    .replace(/discord|clyde/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${(limpo || 'Membro do grupo').slice(0, LIMITE_NOME_WEBHOOK - sufixo.length).trimEnd()}${sufixo}`;
}

/** Quebra um texto longo no limite do Discord, de preferência em fim de linha. */
export function dividirTexto(texto, limite = LIMITE_DISCORD) {
  const partes = [];
  let resto = String(texto ?? '');
  while (resto.length > limite) {
    const quebra = resto.lastIndexOf('\n', limite);
    const corte = quebra > 0 ? quebra : limite;
    partes.push(resto.slice(0, corte));
    resto = resto.slice(corte).replace(/^\n/, '');
  }
  if (resto) partes.push(resto);
  return partes;
}

/**
 * A mensagem do Discord deve ir para o WhatsApp? Bots e webhooks ficam de fora (é o que
 * impede o laço), assim como comandos do bot e avisos do sistema ("fulano entrou").
 */
export function deveIrParaWhatsApp(message, canalId, prefixo = '') {
  if (!canalId || message.channelId !== canalId) return false;
  if (message.author?.bot || message.webhookId || message.system) return false;
  const conteudo = message.content ?? '';
  if (prefixo && conteudo.startsWith(prefixo)) return false;
  return Boolean(conteudo.trim() || (message.attachments?.size ?? 0) > 0);
}

/** "*Nome:* texto", com os anexos como links (a mídia em si ainda não atravessa). */
export function textoParaWhatsApp(message) {
  const nome = String(message.member?.displayName ?? message.author?.displayName ?? message.author?.username ?? 'Discord')
    .replace(/[*_~`]/g, '')
    .trim();
  const anexos = [...(message.attachments?.values() ?? [])].map((a) => `📎 ${a.name}: ${a.url}`);
  const corpo = [message.cleanContent ?? message.content ?? '', ...anexos].filter((p) => p.trim()).join('\n');
  return `*${nome}:* ${corpo}`;
}

/**
 * Resumo do grupo para o log e o motivo, se houver, de o WhatsApp recusar o que o chip enviar.
 * O servidor recusa sem gerar erro no envio, então é preciso olhar as regras do grupo.
 */
export function estadoDoGrupo(dados, me) {
  const eu = (dados.participants ?? []).find((p) =>
    [p.id, p.lid, p.phoneNumber].some((jid) => jid && [me?.id, me?.lid].some((m) => m && areJidsSameUser(jid, m))),
  );
  const chipAdmin = Boolean(eu?.admin);
  let problema = null;
  if (dados.isCommunity) problema = 'é o grupo principal de uma Comunidade, que não recebe mensagens comuns: use um grupo de conversa dentro dela';
  else if (dados.announce && !chipAdmin) problema = 'só administradores podem escrever e o chip não é administrador: promova o chip ou mude a regra do grupo';
  const resumo = `"${dados.subject}": ${dados.participants?.length ?? '?'} membros · só administradores escrevem: ${dados.announce ? 'sim' : 'não'} · chip administrador: ${chipAdmin ? 'sim' : 'não'}`;
  return { resumo, problema };
}

/** Espera até a próxima tentativa de reconexão: dobra a cada falha, de 5 s a 5 min. */
export function esperaDeReconexao(tentativa, minimo = 5_000) {
  return Math.min(Math.max(minimo, 5_000 * 2 ** Math.max(0, tentativa)), 5 * 60_000);
}
