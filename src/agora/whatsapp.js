// ============================================
// agora/whatsapp.js — Ponte entre um grupo do WhatsApp e um canal do Discord
// ============================================
// Só texto por enquanto: mídia do WhatsApp vira um aviso e anexos do Discord viram links.
//
// ATENÇÃO: o Baileys é uma biblioteca NÃO oficial (a API oficial do WhatsApp quase não
// serve para grupos comuns). Isso viola os termos do WhatsApp e o número pode ser banido:
// use um chip só para isto, nunca o número principal da Ágora. Os erros deste módulo são
// capturados para só a ponte parar, mas uma exceção solta de dentro da biblioteca ainda cai
// no uncaughtException do index.js, que encerra o processo.

import makeWASocket, {
  Browsers,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  normalizeMessageContent,
  WAMessageStatus,
} from 'baileys';
import pino from 'pino';
import { config } from '../config.js';
import { agoraConfigurada, clienteAdmin } from './cliente.js';
import {
  deveIrParaWhatsApp,
  dividirTexto,
  esperaDeReconexao,
  estadoDoGrupo,
  mensagensParaDiscord,
  nomeParaWebhook,
  textoParaWhatsApp,
} from './whatsapp-formato.js';
import { criarSessao, verificarTabelaSessao } from './whatsapp-sessao.js';

const cfg = config.whatsapp;
const INTERVALO_ENVIO = 1500; // Ritmo de envio ao WhatsApp, para não parecer disparo em massa
const MAX_NA_FILA = 50;
const NOME_WEBHOOK = 'Ponte WhatsApp';
const VALIDADE_GRUPO = 5 * 60_000;
const MAX_ENVIADAS = 500;
const LIMITE_ENVIO = 60_000; // Um envio travado não pode segurar a fila para sempre

const logger = pino({ level: cfg.nivelLog });
const log = (...a) => console.log('📱 WhatsApp:', ...a);
const aviso = (...a) => console.error('⚠️  WhatsApp:', ...a);

let discord = null;
let sock = null;
let sessao = null;
let conectado = false;
let parado = false;
let iniciada = false;
let tentativas = 0;
let reconexao = null;
let webhook = null;
let grupo = null; // { dados, em }

const enviadas = new Map(); // id → { conteudo, origem }: reenvio pedido pelo WhatsApp e aviso de recusa
const filaEnvio = [];
let enviando = false;
let filaDiscord = Promise.resolve(); // Mantém a ordem das mensagens no canal

/** Liga a ponte (chamado quando o bot do Discord fica online). */
export async function iniciarPonte(client) {
  discord = client;
  webhook = null;
  if (iniciada) return;
  const faltando = [
    !cfg.canalId && 'WHATSAPP_CANAL_ID',
    !agoraConfigurada() && 'as chaves AGORA_SUPABASE_*',
  ].filter(Boolean);
  if (faltando.length) {
    aviso(`ponte desligada: falta ${faltando.join(' e ')}.`);
    return;
  }
  const adm = clienteAdmin();
  const erro = await verificarTabelaSessao(adm);
  if (erro) {
    aviso(`ponte desligada: não consegui ler a tabela da sessão (${erro}). Rode sql/whatsapp_sessao.sql no Supabase.`);
    return;
  }
  iniciada = true;
  sessao = await criarSessao(adm);
  await conectar();
}

/** Encerra a conexão sem desparear o número (no desligamento do bot). */
export async function pararPonte() {
  parado = true;
  clearTimeout(reconexao);
  try {
    sock?.end(undefined);
    await sessao?.aguardar();
  } catch (e) {
    aviso('erro ao encerrar:', e.message);
  }
}

// ---------- Conexão ----------

async function conectar() {
  if (parado) return;
  const socket = makeWASocket({
    auth: { creds: sessao.state.creds, keys: makeCacheableSignalKeyStore(sessao.state.keys, logger) },
    logger,
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: false, // Não tira as notificações do celular do chip
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    getMessage: async (key) => enviadas.get(key.id)?.conteudo,
    cachedGroupMetadata: async (jid) => (jid === cfg.grupoId && grupoValido() ? grupo.dados : undefined),
  });
  sock = socket;
  let pediuCodigo = false;

  socket.ev.on('creds.update', () => {
    sessao.saveCreds().catch((e) => aviso(e.message));
  });

  socket.ev.on('connection.update', (u) => {
    // Sem pareamento o WhatsApp manda um QR; num servidor é mais prático o código de 8 letras.
    if (u.qr && !pediuCodigo && !sessao.state.creds.registered) {
      pediuCodigo = true;
      pedirCodigo(socket).catch((e) => aviso('não consegui gerar o código de pareamento:', e.message));
    }
    if (u.connection === 'open') {
      conectado = true;
      tentativas = 0;
      log('conectado.');
      aoConectar(socket).catch((e) => aviso(e.message));
    }
    if (u.connection === 'close' && socket === sock) {
      conectado = false;
      aoFechar(u.lastDisconnect?.error?.output?.statusCode).catch((e) => aviso(e.message));
    }
  });

  socket.ev.on('messages.upsert', (evento) => {
    for (const m of mensagensParaDiscord(evento, cfg.grupoId, normalizeMessageContent)) {
      filaDiscord = filaDiscord.then(() => postarNoDiscord(m)).catch((e) => aviso('falha ao postar no Discord:', e.message));
    }
  });

  // O servidor pode recusar depois de o envio parecer certo (ex.: só administradores escrevem)
  socket.ev.on('messages.update', (atualizacoes) => {
    for (const { key, update } of atualizacoes) {
      if (update?.status !== WAMessageStatus.ERROR || !enviadas.has(key?.id)) continue;
      aviso(`o WhatsApp recusou a mensagem ${key.id} (código ${update.messageStubParameters?.[0] ?? '?'}).`);
      avisarFalha(enviadas.get(key.id).origem);
    }
  });

  const esquecerGrupo = () => {
    grupo = null;
  };
  socket.ev.on('groups.update', esquecerGrupo);
  socket.ev.on('group-participants.update', esquecerGrupo);
}

async function pedirCodigo(socket) {
  const numero = String(cfg.numero ?? '').replace(/\D/g, '');
  if (!numero) {
    aviso('número não pareado: defina WHATSAPP_NUMERO (só dígitos, com DDI, ex.: 5521999998888) e reinicie.');
    return;
  }
  const codigo = await socket.requestPairingCode(numero);
  log(`no celular do chip: Aparelhos conectados › Conectar aparelho › Conectar com número de telefone. Código: ${codigo}`);
}

async function aoConectar(socket) {
  const grupos = await socket.groupFetchAllParticipating();
  if (!cfg.grupoId) {
    const lista = Object.values(grupos).map((g) => `   ${g.id} — ${g.subject}`);
    log(`defina WHATSAPP_GRUPO_ID e reinicie. Grupos deste número:\n${lista.join('\n') || '   (nenhum: adicione o chip ao grupo)'}`);
    return;
  }
  if (!grupos[cfg.grupoId]) aviso(`este número não está no grupo ${cfg.grupoId}: adicione o chip ao grupo.`);
  else {
    grupo = { dados: grupos[cfg.grupoId], em: Date.now() };
    const { resumo, problema } = estadoDoGrupo(grupo.dados, sessao.state.creds.me);
    log(`grupo ${resumo}.`);
    if (problema) aviso(`as mensagens do Discord não vão chegar ao grupo: ${problema}.`);
  }
  processarFila();
}

async function aoFechar(codigo) {
  if (parado) return;
  await sessao.aguardar();

  if (codigo === DisconnectReason.loggedOut) {
    desistir();
    await sessao.limpar();
    aviso('o número foi desconectado do aparelho. Sessão apagada: reinicie o bot para parear de novo. A ponte parou.');
    return;
  }
  if (codigo === DisconnectReason.forbidden) {
    desistir();
    aviso('o WhatsApp recusou o número (403), que pode ter sido bloqueado ou banido. A ponte parou e não vai insistir.');
    return;
  }
  // restartRequired é normal logo depois de parear. connectionReplaced é outra instância com
  // a mesma sessão (comum durante um deploy): espera mais para as duas não ficarem se derrubando.
  let minimo = 5_000;
  if (codigo === DisconnectReason.connectionReplaced) minimo = 60_000;
  // Sem pareamento, cada tentativa gera um código novo: não vale insistir depressa.
  else if (!sessao.state.creds.registered) minimo = 60_000;
  const espera = codigo === DisconnectReason.restartRequired ? 1_000 : esperaDeReconexao(tentativas, minimo);
  tentativas += 1;
  log(`conexão fechada (${codigo ?? 'sem código'}). Tentando de novo em ${Math.round(espera / 1000)} s.`);
  clearTimeout(reconexao);
  reconexao = setTimeout(() => conectar().catch((e) => aviso('falha ao reconectar:', e.message)), espera);
  reconexao.unref?.();
}

// ---------- WhatsApp → Discord ----------

async function obterWebhook(canal) {
  if (webhook) return webhook;
  const existentes = await canal.fetchWebhooks();
  webhook =
    existentes.find((w) => w.name === NOME_WEBHOOK && w.owner?.id === discord.user.id) ??
    (await canal.createWebhook({ name: NOME_WEBHOOK, reason: 'Ponte com o grupo do WhatsApp' }));
  return webhook;
}

async function postarNoDiscord({ nome, texto }) {
  const canal = await discord.channels.fetch(cfg.canalId);
  if (!canal?.isTextBased?.()) throw new Error(`o canal ${cfg.canalId} não é de texto.`);
  // Ninguém no WhatsApp consegue marcar @everyone ou cargos no servidor.
  const allowedMentions = { parse: [] };
  let gancho = null;
  try {
    gancho = await obterWebhook(canal);
  } catch (e) {
    aviso(`sem webhook (falta "Gerenciar webhooks" no canal?): ${e.message}. Postando como o próprio bot.`);
  }
  if (gancho) {
    for (const parte of dividirTexto(texto)) {
      await gancho.send({ content: parte, username: nomeParaWebhook(nome), allowedMentions });
    }
    return;
  }
  for (const parte of dividirTexto(`**${nome}:** ${texto}`)) await canal.send({ content: parte, allowedMentions });
}

// ---------- Discord → WhatsApp ----------

/** Recebe toda mensagem do Discord; só as do canal da ponte atravessam. */
export function aoMensagemDiscord(message, prefixo) {
  if (!iniciada || !deveIrParaWhatsApp(message, cfg.canalId, prefixo)) return;
  const semDestino = parado || !cfg.grupoId || !sessao.state.creds.registered;
  if (semDestino || filaEnvio.length >= MAX_NA_FILA) {
    avisarFalha(message);
    return;
  }
  if (!conectado) log('sem conexão agora: a mensagem do Discord espera na fila até reconectar.');
  filaEnvio.push(message);
  processarFila();
}

/** A ponte parou de vez: nada na fila vai ser entregue, então avisa em vez de sumir calado. */
function desistir() {
  parado = true;
  for (const message of filaEnvio.splice(0)) avisarFalha(message);
}

function avisarFalha(message) {
  message.react('⚠️').catch(() => null);
}

const grupoValido = () => grupo && Date.now() - grupo.em < VALIDADE_GRUPO;

async function enviarAoGrupo(message) {
  if (!grupoValido()) grupo = { dados: await sock.groupMetadata(cfg.grupoId), em: Date.now() };
  const r = await sock.sendMessage(cfg.grupoId, { text: textoParaWhatsApp(message) });
  if (r?.key?.id && r.message) {
    enviadas.set(r.key.id, { conteudo: r.message, origem: message });
    if (enviadas.size > MAX_ENVIADAS) enviadas.delete(enviadas.keys().next().value);
  }
  log(`mensagem do Discord enviada ao grupo (${r?.key?.id ?? 'sem id'}).`);
}

function comLimite(promessa) {
  let relogio;
  const limite = new Promise((_, rejeitar) => {
    relogio = setTimeout(() => rejeitar(new Error(`sem resposta em ${LIMITE_ENVIO / 1000} s`)), LIMITE_ENVIO);
  });
  return Promise.race([promessa, limite]).finally(() => clearTimeout(relogio));
}

/** Envia uma por vez, em ritmo lento. Sem conexão, as mensagens esperam na fila (até 50). */
async function processarFila() {
  if (enviando) return;
  enviando = true;
  try {
    while (conectado && filaEnvio.length) {
      const message = filaEnvio.shift();
      try {
        await comLimite(enviarAoGrupo(message));
      } catch (e) {
        aviso('falha ao enviar ao grupo:', e.message);
        avisarFalha(message);
      }
      await new Promise((r) => setTimeout(r, INTERVALO_ENVIO));
    }
  } finally {
    enviando = false;
  }
}
