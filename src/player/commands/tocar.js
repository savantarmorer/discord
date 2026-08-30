// ============================================
// player/commands/tocar.js — Comando /tocar
// ============================================
// Mesmo fluxo de menu do /calls (categoria -> lista), mas ao selecionar
// uma gravação ela começa a tocar na sala de reprodução em vez de abrir
// uma tela de detalhes.

import { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import { playerConfig } from '../config.js';
import { getCategories, getRecordings, getRecordingById } from '../../callArchive.js';
import { playRecording } from '../playerManager.js';

export const data = new SlashCommandBuilder()
  .setName('tocar')
  .setDescription('Toca uma gravação de call arquivada na sala de reprodução.');

function hasAccess(member) {
  return Boolean(playerConfig.callsArchiveRoleId) && member.roles.cache.has(playerConfig.callsArchiveRoleId);
}

function noAccessReply() {
  return { content: '❌ Você não tem acesso ao arquivo de gravações.', ephemeral: true };
}

function getCategoryMenuPayload(authorId, categories) {
  const options = [
    { label: '🕐 Mais recentes', description: 'As últimas gravações, de qualquer categoria', value: '__recent__' },
    ...categories.slice(0, 24).map((c) => ({ label: c.slice(0, 100), value: c })),
  ];
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`tocar:category:${authorId}`)
    .setPlaceholder('Selecione uma categoria...')
    .addOptions(options);
  return {
    content: '🎧 Escolha uma categoria para ver as gravações:',
    components: [new ActionRowBuilder().addComponents(selectMenu)],
  };
}

function getRecordingListPayload(authorId, recordings) {
  if (recordings.length === 0) {
    return { content: '❌ Nenhuma gravação encontrada nessa categoria ainda.', components: [] };
  }
  const options = recordings.map((r) => ({
    label: (r.title || `${r.channel_name} — sem título`).slice(0, 100),
    description: `Parte ${r.segment_index + 1} · ${new Date(r.created_at).toLocaleDateString('pt-BR')}`,
    value: String(r.id),
  }));
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`tocar:pick:${authorId}`)
    .setPlaceholder('Selecione a gravação...')
    .addOptions(options);
  return {
    content: '🎧 Selecione o que tocar:',
    components: [new ActionRowBuilder().addComponents(selectMenu)],
  };
}

export async function execute(interaction) {
  if (!hasAccess(interaction.member)) return interaction.reply(noAccessReply());

  const channel = interaction.guild.channels.cache.get(playerConfig.voiceChannelId);
  if (!channel) {
    return interaction.reply({ content: '❌ Canal de reprodução configurado não foi encontrado.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  const categories = await getCategories(interaction.guildId);
  await interaction.editReply(getCategoryMenuPayload(interaction.user.id, categories));
}

export async function handleInteraction(interaction, args) {
  const [action, authorId] = args;
  if (interaction.user.id !== authorId) {
    return interaction.reply({ content: '❌ Apenas quem usou o comando pode interagir com o menu.', ephemeral: true });
  }

  if (action === 'category') {
    await interaction.deferUpdate();
    const category = interaction.values[0];
    const recordings = await getRecordings(interaction.guildId, category === '__recent__' ? null : category, 25);
    return interaction.editReply(getRecordingListPayload(authorId, recordings));
  }

  if (action === 'pick') {
    await interaction.deferUpdate();
    const recording = await getRecordingById(interaction.values[0]);
    if (!recording) {
      return interaction.editReply({ content: '❌ Gravação não encontrada.', components: [] });
    }

    const channel = interaction.guild.channels.cache.get(playerConfig.voiceChannelId);
    if (!channel) {
      return interaction.editReply({ content: '❌ Canal de reprodução configurado não foi encontrado.', components: [] });
    }

    try {
      const { totalParts } = await playRecording(interaction.guildId, channel, recording);
      const title = recording.title || `${recording.channel_name} — sem título`;
      return interaction.editReply({
        content: `▶️ Tocando **${title}** em <#${channel.id}>${totalParts > 1 ? ` (${totalParts} partes na fila — use /pular pra avançar)` : ''}.`,
        components: [],
      });
    } catch (err) {
      console.error('❌ [PLAYER] Erro ao iniciar reprodução:', err.message);
      return interaction.editReply({ content: '❌ Erro ao iniciar a reprodução.', components: [] });
    }
  }
}
