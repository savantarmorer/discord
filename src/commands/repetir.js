// ============================================
// commands/repetir.js — Comando /repetir
// ============================================
// Reproduz o último áudio de voz gravado de um membro.

import { SlashCommandBuilder } from 'discord.js';
import { getGuildConnection } from '../voiceManager.js';
import { playRecordedVoice } from '../utils/speech.js';
import fs from 'fs';
import path from 'path';

export const data = new SlashCommandBuilder()
  .setName('repetir')
  .setDescription('Reproduz a última fala gravada (clone de voz) de um membro.')
  .addUserOption((option) =>
    option
      .setName('membro')
      .setDescription('O membro cuja voz você quer reproduzir')
      .setRequired(true)
  );

export async function execute(interaction) {
  const targetUser = interaction.options.getUser('membro');
  if (!targetUser) {
    return interaction.reply({
      content: '❌ Mencione um membro válido. Ex.: `/repetir membro:@usuario` ou `%repetir @usuario`.',
      ephemeral: true,
    });
  }

  const guildId = interaction.guildId;

  // Busca a conexão de voz ativa
  const connection = getGuildConnection(guildId);

  if (!connection) {
    return interaction.reply({
      content: '❌ O bot não está conectado a nenhum canal de voz neste servidor no momento. Entre em uma chamada com outros membros primeiro.',
      ephemeral: true,
    });
  }

  // Defer
  await interaction.deferReply();

  try {
    const recordingPath = path.resolve(`./recordings/${targetUser.id}.pcm`);

    if (!fs.existsSync(recordingPath)) {
      return interaction.editReply({
        content: `❌ Nenhuma gravação de voz encontrada para **${targetUser.username}** ainda. Peça para ele falar no canal de voz com o bot primeiro!\n*Nota: O bot grava trechos curtos de áudio automaticamente enquanto os usuários conversam na chamada.*`
      });
    }

    const player = playRecordedVoice(connection, recordingPath);

    if (player) {
      return interaction.editReply({
        content: `🔊 Reproduzindo última fala gravada de **${targetUser.username}**!\n*⚠️ Aviso: O bot armazena apenas fragmentos temporários de voz para diversão.*`
      });
    } else {
      return interaction.editReply({
        content: '❌ Ocorreu um erro ao reproduzir o clone de voz.'
      });
    }
  } catch (error) {
    console.error('❌ Erro no comando /repetir:', error);
    return interaction.editReply({
      content: '❌ Ocorreu um erro inesperado ao tentar repetir a voz.'
    });
  }
}
