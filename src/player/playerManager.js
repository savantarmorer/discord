// ============================================
// player/playerManager.js — Motor de reprodução
// ============================================
// Gerencia a conexão de voz e a fila de reprodução por servidor.
// As gravações já são .ogg/Opus (o mesmo formato que o Discord usa),
// então tocam direto sem precisar reprocessar com ffmpeg.

import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  VoiceConnectionStatus,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
} from '@discordjs/voice';
import { Readable } from 'stream';
import { getListenUrl, getSessionSegments } from '../callArchive.js';

/** Map de sessões de reprodução ativas por guildId. */
const sessions = new Map();

async function ensureSession(guildId, channel) {
  let session = sessions.get(guildId);
  if (session) return session;

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,
  });
  await entersState(connection, VoiceConnectionStatus.Ready, 15_000);

  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  connection.subscribe(player);

  session = { connection, player, queue: [], currentIndex: -1, textNotify: null };
  sessions.set(guildId, session);

  player.on(AudioPlayerStatus.Idle, () => {
    advanceQueue(guildId).catch((err) => console.error('❌ [PLAYER] Erro ao avançar fila:', err.message));
  });

  player.on('error', (err) => {
    console.error('❌ [PLAYER] Erro no player de áudio:', err.message);
    advanceQueue(guildId).catch(() => null);
  });

  return session;
}

async function fetchAudioStream(recording) {
  const url = await getListenUrl(recording.storage_path);
  if (!url) throw new Error('Não foi possível gerar o link de áudio.');

  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Falha ao baixar o áudio (HTTP ${response.status}).`);

  return Readable.fromWeb(response.body);
}

async function playCurrent(guildId) {
  const session = sessions.get(guildId);
  if (!session) return;

  const recording = session.queue[session.currentIndex];
  if (!recording) return;

  const stream = await fetchAudioStream(recording);
  const resource = createAudioResource(stream, { inputType: StreamType.OggOpus });
  session.player.play(resource);
}

async function advanceQueue(guildId) {
  const session = sessions.get(guildId);
  if (!session) return;

  session.currentIndex += 1;
  if (session.currentIndex >= session.queue.length) {
    return; // fila acabou — fica conectado e parado, esperando um novo /tocar
  }
  await playCurrent(guildId);
}

/**
 * Toca uma gravação no canal de voz configurado, enfileirando automaticamente
 * o restante das partes da mesma call (se ela foi dividida em blocos de 30min).
 */
export async function playRecording(guildId, channel, recording) {
  const session = await ensureSession(guildId, channel);
  const remainingParts = await getSessionSegments(recording.session_id, recording.segment_index);

  session.queue = remainingParts.length > 0 ? remainingParts : [recording];
  session.currentIndex = 0;
  await playCurrent(guildId);

  return { totalParts: session.queue.length };
}

export function pause(guildId) {
  const session = sessions.get(guildId);
  if (!session) return false;
  return session.player.pause();
}

export function resume(guildId) {
  const session = sessions.get(guildId);
  if (!session) return false;
  return session.player.unpause();
}

/** Pula para a próxima parte da fila (ex.: próximo bloco de 30min da mesma call). */
export function skip(guildId) {
  const session = sessions.get(guildId);
  if (!session || session.currentIndex >= session.queue.length - 1) return false;
  session.player.stop(); // dispara Idle -> advanceQueue
  return true;
}

export function stop(guildId) {
  const session = sessions.get(guildId);
  if (!session) return false;
  session.player.stop();
  session.connection.destroy();
  sessions.delete(guildId);
  return true;
}

export function getStatus(guildId) {
  const session = sessions.get(guildId);
  if (!session) return null;

  const recording = session.queue[session.currentIndex] || null;
  return {
    status: session.player.state.status,
    current: recording,
    partIndex: session.currentIndex,
    totalParts: session.queue.length,
  };
}
