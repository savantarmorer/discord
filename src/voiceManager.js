// ============================================
// voiceManager.js — Gerenciamento de conexões de voz do bot
// ============================================
// Controla a entrada/saída automática do bot em canais de voz
// para captar os eventos de fala (speaking) dos usuários.

import {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState,
  EndBehaviorType,
} from '@discordjs/voice';
import { startSpeaking, stopSpeaking, stopAllSpeaking } from './speakingTracker.js';
import * as callRecorder from './callRecorder.js';
import { ChannelType } from 'discord.js';
import { config } from './config.js';
import fs from 'fs';
import path from 'path';
import prism from 'prism-media';
import { pipeline } from 'stream';

// Cria pasta recordings se não existir
fs.mkdirSync('./recordings', { recursive: true });

/**
 * Map de canais onde o bot está conectado.
 * Chave: channelId | Valor: { connection, guildId, ready }
 */
const activeConnections = new Map();

// Rastreia gravações ativas para evitar conflitos
const recordingUsers = new Set();
const metadataPath = path.resolve('./recordings/metadata.json');

/**
 * Salva metadados do usuário gravado
 */
function saveVoiceMetadata(userId, username) {
  try {
    let metadata = {};
    if (fs.existsSync(metadataPath)) {
      metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) || {};
    }
    metadata[userId] = { username, updatedAt: new Date().toISOString() };
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  } catch (err) {
    console.error('⚠️ [REC] Erro ao salvar metadados de gravação:', err.message);
  }
}

const CLIP_MAX_BYTES = 48000 * 4 * 5; // ~5s de áudio estéreo 16-bit @ 48kHz

/**
 * Assina o áudio de um usuário UMA única vez por trecho de fala e distribui
 * os chunks decodificados para os dois consumidores:
 *  - o clipe curto (~5s) usado pelo /repetir
 *  - a gravação completa da call (callRecorder.js)
 *
 * IMPORTANTE: só pode existir UMA subscrição ativa por usuário aqui.
 * O receiver.subscribe() do @discordjs/voice reaproveita a MESMA stream
 * se já houver uma subscrição ativa para aquele userId — então se este
 * módulo e callRecorder.js chamassem subscribe() cada um por conta própria,
 * as duas gravações acabariam compartilhando o mesmo fluxo, e o destroy()
 * de uma (ex.: o antigo corte de 5s) cortava a outra também.
 */
function recordUserVoice(connection, userId, username, guildId) {
  if (recordingUsers.has(userId)) return;
  recordingUsers.add(userId);

  try {
    const receiver = connection.receiver;
    const opusStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 1500,
      },
    });

    const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
    const recordingPath = path.resolve(`./recordings/${userId}.pcm`);
    const writeStream = fs.createWriteStream(recordingPath);
    let clipBytesWritten = 0;

    decoder.on('data', (chunk) => {
      // Gravação completa da call (todos os chunks, a duração toda do trecho)
      callRecorder.writeAudioChunk(guildId, userId, username, chunk);

      // Clipe curto do /repetir: só os primeiros ~5s
      if (clipBytesWritten < CLIP_MAX_BYTES) {
        writeStream.write(chunk);
        clipBytesWritten += chunk.length;
      }
    });

    pipeline(opusStream, decoder, (err) => {
      writeStream.end();
      recordingUsers.delete(userId);
      if (err) {
        const msg = err.message.toLowerCase();
        if (!msg.includes('premature close') && !msg.includes('destroyed')) {
          console.error(`❌ [REC] Erro ao gravar voz de ${username}:`, err.message);
        }
      } else if (clipBytesWritten > 0) {
        saveVoiceMetadata(userId, username);
      }
    });
  } catch (err) {
    recordingUsers.delete(userId);
    console.error(`❌ [REC] Falha crítica ao iniciar gravação de ${username}:`, err.message);
  }
}

/**
 * Conecta o bot a um canal de voz para escutar eventos de fala.
 * @param {VoiceChannel|StageChannel} channel - Canal de voz para conectar
 * @param {Client} client - Instância do client Discord
 */
export async function joinChannel(channel, client) {
  // Evita reconexão se já está no canal ou em processo de conexão
  if (activeConnections.has(channel.id)) return;

  // ===================================================
  // ⚠️ LIMITAÇÃO CRUCIAL DA API DO DISCORD:
  // Um bot só pode estar em UM canal de voz por servidor (guild) por vez.
  // Se já houver alguma conexão ativa neste servidor, ignoramos para evitar
  // que o bot fique pulando (ping-pong) infinitamente entre canais ativos.
  // ===================================================
  const isAlreadyConnectedInGuild = [...activeConnections.values()].some(
    (conn) => conn.guildId === channel.guild.id
  );
  if (isAlreadyConnectedInGuild) {
    return;
  }

  try {
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,  // Bot NÃO fica surdo — precisa ouvir para detectar fala
      selfMute: false,  // Bot não fica mutado para poder tocar efeitos sonoros (Loot Drops)
    });

    // Registra imediatamente no Map para evitar chamadas concorrentes de outros eventos simultâneos
    activeConnections.set(channel.id, {
      connection,
      guildId: channel.guild.id,
      ready: false,
    });

    // Aguarda a conexão estar pronta (timeout de 30s)
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);

    // Marca como pronto
    const entry = activeConnections.get(channel.id);
    if (entry) entry.ready = true;

    console.log(`🔊 [VOZ] Bot conectado ao canal: ${channel.name} (${channel.id})`);

    // Inicia a gravação completa (mixada) da call, se configurada
    callRecorder.startSession(channel.guild.id, channel.id, channel.name, client);

    // ===================================================
    // Configura o listener de fala (Speaking Events)
    // ===================================================
    const receiver = connection.receiver;

    /**
     * Evento disparado quando um usuário COMEÇA a falar.
     * O receiver.speaking emite 'start' com o userId.
     */
    receiver.speaking.on('start', (userId) => {
      // Busca o membro para obter o nome de exibição
      const guild = client.guilds.cache.get(channel.guild.id);
      const member = guild?.members.cache.get(userId);
      const username = member?.displayName || member?.user?.username || userId;

      startSpeaking(channel.guild.id, userId, username);

      // Assina o áudio do usuário (uma única vez) e alimenta tanto o clipe
      // curto do /repetir quanto a gravação completa da call (callRecorder)
      recordUserVoice(connection, userId, username, channel.guild.id);
    });

    /**
     * Evento disparado quando um usuário PARA de falar.
     * O receiver.speaking emite 'end' com o userId.
     */
    receiver.speaking.on('end', async (userId) => {
      await stopSpeaking(channel.guild.id, userId);
    });

    // ===================================================
    // Tratamento de desconexão inesperada
    // ===================================================
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        // Tenta reconectar (pode ser uma troca de região)
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
        // Reconectando... não faz nada
      } catch {
        // Não conseguiu reconectar — limpa a sessão
        console.log(`⚠️  [VOZ] Desconectado do canal: ${channel.name}`);
        await cleanupConnection(channel.id, channel.guild.id);
      }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      activeConnections.delete(channel.id);
    });

  } catch (error) {
    console.error(`❌ [VOZ] Erro ao conectar no canal ${channel.name}:`, error.message);
    // Se a conexão chegou a ser criada (ex.: timeout esperando Ready), destrói
    // explicitamente — sem isso ela fica tentando conectar indefinidamente,
    // presa em memória, mesmo já removida do nosso próprio controle abaixo.
    const entry = activeConnections.get(channel.id);
    try {
      entry?.connection.destroy();
    } catch {
      // Já destruída ou nunca chegou a existir
    }
    activeConnections.delete(channel.id);
  }
}

/**
 * Desconecta o bot de um canal de voz.
 * Finaliza todas as sessões de fala associadas.
 * @param {string} channelId - ID do canal
 * @param {string} guildId - ID do servidor
 */
export async function leaveChannel(channelId, guildId) {
  await cleanupConnection(channelId, guildId);
}

/**
 * Limpa a conexão e salva dados pendentes.
 * @param {string} channelId - ID do canal
 * @param {string} guildId - ID do servidor
 */
async function cleanupConnection(channelId, guildId) {
  const entry = activeConnections.get(channelId);
  if (!entry) return;

  // Finaliza sessões de fala dos usuários no canal
  await stopAllSpeaking(guildId);

  // Finaliza, mixa e envia a última parte da gravação da call, se houver sessão ativa
  await callRecorder.endSession(guildId).catch((err) => {
    console.error('❌ [CALL-REC] Erro ao finalizar sessão de gravação:', err.message);
  });

  // Destrói a conexão de voz
  try {
    entry.connection.destroy();
  } catch {
    // Já destruída
  }

  activeConnections.delete(channelId);
  console.log(`🔇 [VOZ] Bot desconectado do canal (${channelId})`);
}

/**
 * Verifica todos os canais de voz do servidor e gerencia conexões:
 * - Entra em canais que possuem usuários (humanos)
 * - Sai de canais que estão vazios
 * @param {Guild} guild - Instância do servidor
 * @param {Client} client - Instância do client Discord
 */
export async function syncVoiceChannels(guild, client) {
  const voiceChannels = guild.channels.cache.filter(
    (ch) => ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice
  );

  // 1. Desconecta de qualquer canal que esteja vazio e que o bot esteja conectado
  // DESATIVADO: O bot agora é 24/7 e não sai automaticamente quando o canal fica vazio.
  /*
  for (const [channelId, channel] of voiceChannels) {
    const humanMembers = channel.members.filter((m) => !m.user.bot).size;
    if (humanMembers === 0 && activeConnections.has(channelId)) {
      await leaveChannel(channelId, guild.id);
    }
  }
  */

  // 2. Encontra o canal mais cheio (com mais humanos ativos)
  let busiestChannel = null;
  let maxHumans = 0;

  for (const [, channel] of voiceChannels) {
    const humanMembers = channel.members.filter((m) => !m.user.bot).size;
    if (humanMembers > maxHumans) {
      maxHumans = humanMembers;
      busiestChannel = channel;
    }
  }

  // 3. Gerencia a conexão com base no canal mais cheio ou padrão
  if (busiestChannel) {
    // Verifica se já estamos conectados a algum canal neste servidor
    const currentConnectionEntry = [...activeConnections.entries()].find(
      ([, conn]) => conn.guildId === guild.id
    );

    if (currentConnectionEntry) {
      const [currentChannelId] = currentConnectionEntry;
      
      // Se o canal mais cheio for diferente do canal que o bot está agora, muda de canal!
      if (currentChannelId !== busiestChannel.id) {
        console.log(
          `🔄 [VOZ] Mudando para o canal mais cheio: ${busiestChannel.name} (${maxHumans} usuários) ` +
          `— saindo do canal antigo (${currentChannelId})`
        );
        await leaveChannel(currentChannelId, guild.id);
        await joinChannel(busiestChannel, client);
      }
    } else {
      // Se não estava em nenhum canal, entra no mais cheio
      await joinChannel(busiestChannel, client);
    }
  } else {
    // Caso ninguém esteja em canais de voz:
    // Se o bot não estiver conectado a nenhum canal no servidor e houver um canal padrão configurado, conecta nele!
    const isConnectedInGuild = [...activeConnections.values()].some(
      (conn) => conn.guildId === guild.id
    );

    if (!isConnectedInGuild && config.defaultVoiceChannelId) {
      const defaultChannel = guild.channels.cache.get(config.defaultVoiceChannelId);
      if (defaultChannel && (defaultChannel.type === ChannelType.GuildVoice || defaultChannel.type === ChannelType.GuildStageVoice)) {
        console.log(`📡 [VOZ] Nenhum usuário em call. Conectando ao canal padrão 24/7: ${defaultChannel.name}`);
        await joinChannel(defaultChannel, client);
      }
    }
  }
}


/**
 * Desconecta de TODOS os canais (usado no shutdown).
 */
export async function disconnectAll() {
  const entries = [...activeConnections.entries()];
  for (const [channelId, { guildId }] of entries) {
    await cleanupConnection(channelId, guildId);
  }
  console.log(`🛑 [VOZ] Todas as ${entries.length} conexões encerradas.`);
}

/**
 * Verifica se o bot está conectado a um canal específico.
 * @param {string} channelId - ID do canal
 * @returns {boolean}
 */
export function isConnectedTo(channelId) {
  return activeConnections.has(channelId);
}

/**
 * Retorna a conexão de voz ativa para um servidor (guild) se ela estiver pronta.
 * @param {string} guildId - ID do servidor
 * @returns {Object|null} A conexão ou null
 */
export function getGuildConnection(guildId) {
  const entry = [...activeConnections.values()].find(
    (conn) => conn.guildId === guildId && conn.ready
  );
  return entry ? entry.connection : null;
}

/**
 * Retorna todas as conexões ativas e prontas.
 * @returns {Array<Object>} Lista de conexões prontas
 */
export function getReadyConnections() {
  return [...activeConnections.values()].filter(conn => conn.ready);
}
