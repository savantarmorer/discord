// ============================================
// player/videoWorker.js — Geração automática de vídeo (waveform) por gravação
// ============================================
// Roda em segundo plano dentro do bot de reprodução (não no bot principal,
// que já lida com áudio em tempo real e não deve competir por CPU com uma
// codificação de vídeo). A cada intervalo, processa UMA gravação pendente
// por vez: baixa o .ogg, gera um .mp4 com visualização de onda sonora via
// ffmpeg (filtro showwaves — nenhuma imagem externa necessária), sobe o
// vídeo pro mesmo bucket e posta o link no canal configurado, pronto pra
// upload manual no YouTube.

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { getRecordingsWithoutVideo, getListenUrl, setVideoPath, uploadVideo } from '../callArchive.js';
import { playerConfig } from './config.js';

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // checa por uma gravação pendente a cada 5 minutos
const DOWNLOAD_URL_TTL_SECONDS = 30 * 60; // link interno de download, só precisa durar o processamento
const POSTED_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // link postado no canal, mesma validade dos links de áudio

const TEMP_DIR = path.resolve('./video-tmp');
fs.mkdirSync(TEMP_DIR, { recursive: true });

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

async function downloadToFile(url, destPath) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Falha ao baixar áudio (HTTP ${response.status}).`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(destPath, buffer);
}

async function postVideoLink(client, recording, videoStoragePath) {
  if (!playerConfig.recordingsChannelId) return;
  try {
    const channel = await client.channels.fetch(playerConfig.recordingsChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const url = await getListenUrl(videoStoragePath, POSTED_URL_TTL_SECONDS);
    if (!url) return;

    const title = recording.title || `${recording.channel_name} — sem título`;
    await channel.send({
      content: `🎥 **Vídeo pronto: ${title}**\n${url}\n*Pronto pra upload manual no YouTube. Link válido por 7 dias.*`,
    });
  } catch (err) {
    console.error('❌ [PLAYER] Erro ao postar link do vídeo:', err.message);
  }
}

async function processOne(client) {
  const [recording] = await getRecordingsWithoutVideo(playerConfig.guildId, 1);
  if (!recording) return false; // nada pendente

  const audioPath = path.join(TEMP_DIR, `${recording.id}.ogg`);
  const videoPath = path.join(TEMP_DIR, `${recording.id}.mp4`);

  try {
    const audioUrl = await getListenUrl(recording.storage_path, DOWNLOAD_URL_TTL_SECONDS);
    if (!audioUrl) throw new Error('Não foi possível gerar o link de download do áudio.');

    await downloadToFile(audioUrl, audioPath);

    await runFfmpeg([
      '-y',
      '-i', audioPath,
      '-filter_complex', '[0:a]showwaves=s=1280x720:mode=cline:colors=white[v]',
      '-map', '[v]',
      '-map', '0:a',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '28',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-shortest',
      videoPath,
    ]);

    const videoStoragePath = recording.storage_path.replace(/\.ogg$/, '.mp4');
    const uploaded = await uploadVideo(videoStoragePath, videoPath);
    if (uploaded) {
      await setVideoPath(recording.id, videoStoragePath);
      await postVideoLink(client, recording, videoStoragePath);
      console.log(`🎥 [PLAYER] Vídeo gerado para a gravação ${recording.id}.`);
    }
  } catch (err) {
    console.error(`❌ [PLAYER] Erro ao gerar vídeo da gravação ${recording.id}:`, err.message);
  } finally {
    await fs.promises.unlink(audioPath).catch(() => null);
    await fs.promises.unlink(videoPath).catch(() => null);
  }

  return true;
}

export function startVideoWorker(client) {
  const tick = () => {
    processOne(client).catch((err) => console.error('❌ [PLAYER] Erro no worker de vídeo:', err.message));
  };

  tick(); // processa uma gravação pendente logo no início, se houver
  setInterval(tick, CHECK_INTERVAL_MS);
}
