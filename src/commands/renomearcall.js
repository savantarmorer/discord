// ============================================
// commands/renomearcall.js — Comando /renomearcall
// ============================================
// Define título e categoria de uma gravação de call arquivada, para que
// dê pra saber do que se trata sem precisar ouvir tudo de novo.

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { config } from '../config.js';
import { getRecordings, renameRecording } from '../callArchive.js';

export const data = new SlashCommandBuilder()
  .setName('renomearcall')
  .setDescription('Define título e categoria de uma gravação de call arquivada.');

function hasAccess(member) {
  return Boolean(config.callsArchiveRoleId) && member.roles.cache.has(config.callsArchiveRoleId);
}

export async function execute(interaction) {
  if (!hasAccess(interaction.member)) {
    return interaction.reply({ content: '❌ Você não tem acesso ao arquivo de gravações.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const recordings = await getRecordings(interaction.guildId, null, 25);
  if (recordings.length === 0) {
    return interaction.editReply({ content: '❌ Nenhuma gravação encontrada ainda.' });
  }

  const options = recordings.map((r) => ({
    label: (r.title || `${r.channel_name} — sem título`).slice(0, 100),
    description: new Date(r.created_at).toLocaleString('pt-BR').slice(0, 100),
    value: String(r.id),
  }));

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`renomearcall:pick:${interaction.user.id}`)
    .setPlaceholder('Selecione a gravação para renomear...')
    .addOptions(options);

  return interaction.editReply({
    content: 'Selecione qual gravação você quer renomear/categorizar:',
    components: [new ActionRowBuilder().addComponents(selectMenu)],
  });
}

export async function handleInteraction(interaction, args) {
  const [action, authorId] = args;
  if (action !== 'pick') return;

  if (interaction.user.id !== authorId) {
    return interaction.reply({ content: '❌ Apenas quem usou o comando pode interagir com o menu.', ephemeral: true });
  }

  const recordingId = interaction.values[0];

  const modal = new ModalBuilder().setCustomId(`renomearcall:modal:${recordingId}`).setTitle('Renomear gravação');

  const titleInput = new TextInputBuilder()
    .setCustomId('title')
    .setLabel('Título')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(100)
    .setRequired(true);

  const categoryInput = new TextInputBuilder()
    .setCustomId('category')
    .setLabel('Categoria')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(50)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(titleInput),
    new ActionRowBuilder().addComponents(categoryInput)
  );

  return interaction.showModal(modal);
}

export async function handleModalSubmit(interaction, args) {
  const [action, recordingId] = args;
  if (action !== 'modal') return;

  const title = interaction.fields.getTextInputValue('title');
  const category = interaction.fields.getTextInputValue('category');

  await interaction.deferReply({ ephemeral: true });
  const ok = await renameRecording(recordingId, title, category, interaction.user.id);
  if (ok) {
    return interaction.editReply({ content: `✅ Gravação renomeada para **${title}** (categoria: **${category}**).` });
  }
  return interaction.editReply({ content: '❌ Erro ao renomear a gravação.' });
}
