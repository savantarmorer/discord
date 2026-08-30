// ============================================
// callRecorder.js — Gravação completa de chamadas (mixada)
// ============================================
// Grava a call inteira como UM único áudio mixado (todos os falantes
// juntos), dividido em blocos de 30 minutos para não deixar arquivos
// gigantes nem perder tudo se o bot cair no meio de uma call longa.
// Cada bloco é enviado ao Supabase Storage assim que fica pronto.
//
// Requer SUPABASE_SERVICE_KEY (chave service_role) — sem ela, a
// gravação de call inteira fica desativada (loga um aviso e ignora),
// mas o resto do bot continua funcionando normalmente.

import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

const PCM_SAMPLE_RATE = 48000;
const PCM_CHANNELS = 2;
const PCM_BITS_PER_SAMPLE = 16;
const BLOCK_ALIGN = (PCM_CHANNELS * PCM_BITS_PER_SAMPLE) / 8; // 4 bytes por amostra estéreo
const BYTES_PER_MS = (PCM_SAMPLE_RATE * BLOCK_ALIGN) / 1000; // 192 bytes/ms

// Só resincroniza com o tempo real se o "atraso" acumulado passar disso.
// Jitter normal de rede fica abaixo desse limiar e é ignorado — sem isso,
// qualquer chunk levemente atrasado inseria um microcorte de silêncio.
const REALIGN_THRESHOLD_MS = 200;

const SEGMENT_DURATION_MS = 30 * 60 * 1000; // divide a gravação a cada 30 minutos

const RECORDINGS_DIR = path.resolve('./recordings/sessions');
fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

const supabase = config.supabaseServiceKey
  ? createClient(config.supabaseUrl, config.supabaseServiceKey)
  : null;

let warnedNoServiceKey = false;

/** Map de sessões ativas por guildId. */
const activeSessions = new Map();

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function alignToBlock(bytes) {
  const b = Math.max(0, Math.floor(bytes));
  return b - (b % BLOCK_ALIGN);
}

function createSegment(sessionDir, segmentIndex) {
  const segmentDir = path.join(sessionDir, `seg-${segmentIndex}`);
  fs.mkdirSync(segmentDir, { recursive: true });
  return {
    segmentDir,
    startedAt: Date.now(),
    tracks: new Map(), // userId -> { username, filePath, writeStream, bytesWritten }
  };
}

/**
 * Inicia uma sessão de gravação para um canal de voz.
 * Não faz nada se SUPABASE_SERVICE_KEY não estiver configurada.
 */
export function startSession(guildId, channelId, channelName, client) {
  if (!supabase) {
    if (!warnedNoServiceKey) {
      console.warn('⚠️  [CALL-REC] SUPABASE_SERVICE_KEY não definida — gravação de chamadas completas desativada.');
      warnedNoServiceKey = true;
    }
    return;
  }

  if (activeSessions.has(guildId)) return;

  const sessionId = makeId();
  const sessionDir = path.join(RECORDINGS_DIR, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const session = {
    sessionId,
    sessionDir,
    channelId,
    channelName,
    client,
    segmentIndex: 0,
    segment: createSegment(sessionDir, 0),
    rotationTimer: null,
  };

  session.rotationTimer = setInterval(() => {
    rotateSegment(guildId).catch((err) => {
      console.error('❌ [CALL-REC] Erro ao rotacionar segmento de gravação:', err.message);
    });
  }, SEGMENT_DURATION_MS);

  activeSessions.set(guildId, session);
  console.log(`🎙️ [CALL-REC] Sessão de gravação iniciada: ${channelName} (${sessionId})`);
}

function getOrCreateTrack(segment, userId, username) {
  let track = segment.tracks.get(userId);
  if (!track) {
    const filePath = path.join(segment.segmentDir, `${userId}.pcm`);
    track = { username, filePath, writeStream: fs.createWriteStream(filePath), bytesWritten: 0 };
    segment.tracks.set(userId, track);
  }
  return track;
}

/**
 * Recebe um chunk de PCM já decodificado (o subscribe/decode do Discord é
 * feito uma única vez em voiceManager.js — subscrever duas vezes ao mesmo
 * usuário faz o @discordjs/voice reaproveitar a MESMA stream, então duas
 * gravações independentes acabavam compartilhando (e destruindo) o mesmo
 * fluxo de áudio). Esta função é só um "sink": grava na faixa do usuário
 * dentro do segmento atual, resincronizando com o tempo real apenas
 * quando o atraso acumulado passa de REALIGN_THRESHOLD_MS — jitter normal
 * de rede fica abaixo disso e é ignorado, evitando microcortes.
 */
export function writeAudioChunk(guildId, userId, username, chunk) {
  const session = activeSessions.get(guildId);
  if (!session) return;

  const track = getOrCreateTrack(session.segment, userId, username);

  const elapsedMs = Date.now() - session.segment.startedAt;
  const expectedBytes = alignToBlock(elapsedMs * BYTES_PER_MS);
  const gapMs = (expectedBytes - track.bytesWritten) / BYTES_PER_MS;

  if (gapMs > REALIGN_THRESHOLD_MS) {
    const silence = Buffer.alloc(alignToBlock(expectedBytes - track.bytesWritten));
    track.writeStream.write(silence);
    track.bytesWritten += silence.length;
  }

  track.writeStream.write(chunk);
  track.bytesWritten += chunk.length;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg saiu com código ${code}: ${stderr.slice(-500)}`));
    });
  });
}

/**
 * Mixa as faixas .pcm de um segmento em um único .ogg (Opus) via ffmpeg,
 * usando arquivos em disco (não bufferiza tudo em memória — importante
 * pois a instância roda com pouca RAM).
 */
async function mixSegmentToOgg(segment) {
  const tracks = [...segment.tracks.values()].filter((t) => t.bytesWritten > 0);
  if (tracks.length === 0) return null;

  const outputPath = path.join(segment.segmentDir, 'mixed.ogg');
  const args = ['-y'];
  for (const t of tracks) {
    args.push('-f', 's16le', '-ar', String(PCM_SAMPLE_RATE), '-ac', String(PCM_CHANNELS), '-i', t.filePath);
  }
  if (tracks.length > 1) {
    args.push('-filter_complex', `amix=inputs=${tracks.length}:duration=longest`);
  }
  args.push('-c:a', 'libopus', '-b:a', '64k', outputPath);

  await runFfmpeg(args);
  return outputPath;
}

async function uploadSegment(session, segmentIndex, oggPath) {
  const storagePath = `${session.channelId}/${session.sessionId}/segmento-${segmentIndex}.ogg`;
  const fileBuffer = await fs.promises.readFile(oggPath);

  const { error: uploadError } = await supabase.storage
    .from('call-recordings')
    .upload(storagePath, fileBuffer, { contentType: 'audio/ogg', upsert: true });

  if (uploadError) {
    console.error(`❌ [CALL-REC] Erro ao enviar ${storagePath} para o Storage:`, uploadError.message);
    return null;
  }

  const { data: signedData, error: signError } = await supabase.storage
    .from('call-recordings')
    .createSignedUrl(storagePath, 60 * 60 * 24 * 7); // 7 dias

  if (signError) {
    console.error(`❌ [CALL-REC] Erro ao gerar URL assinada para ${storagePath}:`, signError.message);
    return null;
  }

  return signedData.signedUrl;
}

async function postSegmentLink(session, segmentIndex, url) {
  if (!config.recordingsChannelId || !session.client) return;
  try {
    const channel = await session.client.channels.fetch(config.recordingsChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;
    await channel.send({
      content: `🎙️ **Gravação da call em "${session.channelName}"** — parte ${segmentIndex + 1}: ${url}\n*Link válido por 7 dias.*`,
    });
  } catch (err) {
    console.error('❌ [CALL-REC] Erro ao postar link da gravação:', err.message);
  }
}

/**
 * Fecha o segmento atual, mixa, envia ao Storage e posta o link.
 * Se `startNext` for true, um novo segmento é criado em seguida (rotação normal).
 * Recebe o objeto `session` diretamente (não busca no Map) para funcionar mesmo
 * já removido de activeSessions (caso do encerramento final da call).
 */
async function finalizeSegment(session, startNext) {
  const segment = session.segment;
  const segmentIndex = session.segmentIndex;

  if (startNext) {
    session.segmentIndex += 1;
    session.segment = createSegment(session.sessionDir, session.segmentIndex);
  }

  // Fecha todas as write streams do segmento finalizado
  await Promise.all(
    [...segment.tracks.values()].map((t) => new Promise((resolve) => t.writeStream.end(resolve)))
  );

  try {
    const oggPath = await mixSegmentToOgg(segment);
    if (oggPath) {
      const url = await uploadSegment(session, segmentIndex, oggPath);
      if (url) await postSegmentLink(session, segmentIndex, url);
    }
  } catch (err) {
    console.error(`❌ [CALL-REC] Erro ao finalizar segmento ${segmentIndex} de "${session.channelName}":`, err.message);
  }

  await fs.promises.rm(segment.segmentDir, { recursive: true, force: true }).catch(() => null);
}

async function rotateSegment(guildId) {
  const session = activeSessions.get(guildId);
  if (!session) return;
  await finalizeSegment(session, true);
}

/**
 * Encerra a sessão de gravação de um servidor: para a rotação periódica,
 * finaliza (mixa + envia) o último segmento e limpa os arquivos da sessão.
 */
export async function endSession(guildId) {
  const session = activeSessions.get(guildId);
  if (!session) return;
  activeSessions.delete(guildId);

  clearInterval(session.rotationTimer);
  await finalizeSegment(session, false).catch((err) => {
    console.error('❌ [CALL-REC] Erro ao finalizar última parte da gravação:', err.message);
  });

  // finalizeSegment já removeu o diretório do segmento; limpa a pasta da sessão (deve estar vazia)
  await fs.promises.rm(session.sessionDir, { recursive: true, force: true }).catch(() => null);

  console.log(`🎙️ [CALL-REC] Sessão encerrada: ${session.channelName} (${session.segmentIndex + 1} parte(s)).`);
}

export function hasActiveSession(guildId) {
  return activeSessions.has(guildId);
}
