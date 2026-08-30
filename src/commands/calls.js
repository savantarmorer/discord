// ============================================
// commands/calls.js — Comando /calls
// ============================================
// Arquivo de gravações de calls antigas: navega por categoria, ouve,
// vota e comenta. Acesso restrito a quem tem o cargo CALLS_ARCHIVE_ROLE_ID.

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { config } from '../config.js';
import {
  getCategories,
  getRecordings,
  getRecordingById,
  voteRecording,
  addComment,
  getComments,
  getListenUrl,
} from '../callArchive.js';

export const data = new SlashCommandBuilder()
  .setName('calls')
  .setDescription('Navega pelo arquivo de gravações de calls antigas.');

function hasAccess(member) {
  return Boolean(config.callsArchiveRoleId) && member.roles.cache.has(config.callsArchiveRoleId);
}

function noAccessReply() {
  return { content: '❌ Você não tem acesso ao arquivo de gravações.', ephemeral: true };
}

function backRow(authorId) {
  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder().setCustomId(`calls:back:${authorId}`).setLabel('🔙 Categorias').setStyle(ButtonStyle.Secondary)
    )
    .toJSON();
}

function getCategoryMenuPayload(authorId, categories) {
  const options = [
    { label: '🕐 Mais recentes', description: 'As últimas gravações, de qualquer categoria', value: '__recent__' },
    ...categories.slice(0, 24).map((c) => ({ label: c.slice(0, 100), value: c })),
  ];

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`calls:category:${authorId}`)
    .setPlaceholder('Selecione uma categoria...')
    .addOptions(options);

  return {
    flags: 32768, // IS_COMPONENTS_V2
    components: [
      {
        type: 17, // CONTAINER
        accent_color: 3447003,
        components: [
          {
            type: 10, // Text Display
            content: '# 🎙️ Arquivo de Calls\nEscolha uma categoria para ver as gravações arquivadas.',
          },
        ],
      },
      new ActionRowBuilder().addComponents(selectMenu).toJSON(),
    ],
  };
}

function getRecordingListPayload(authorId, category, recordings) {
  const label = category === '__recent__' || !category ? 'Mais recentes' : category;

  const containerComponents = [
    {
      type: 10,
      content:
        recordings.length > 0
          ? `# 🎙️ ${label}\n${recordings.length} gravação(ões) encontrada(s).`
          : `# 🎙️ ${label}\nNenhuma gravação encontrada nessa categoria ainda.`,
    },
  ];

  const components = [{ type: 17, accent_color: 3447003, components: containerComponents }];

  if (recordings.length > 0) {
    const options = recordings.map((r) => ({
      label: (r.title || `${r.channel_name} — sem título`).slice(0, 100),
      description: `👍 ${r.upvotes || 0} · 👎 ${r.downvotes || 0} · ${new Date(r.created_at).toLocaleDateString('pt-BR')}`.slice(0, 100),
      value: String(r.id),
    }));

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`calls:pick:${authorId}`)
      .setPlaceholder('Selecione uma gravação...')
      .addOptions(options);

    components.push(new ActionRowBuilder().addComponents(selectMenu).toJSON());
  }

  components.push(backRow(authorId));

  return { flags: 32768, components };
}

async function getRecordingDetailPayload(authorId, recording) {
  const comments = await getComments(recording.id, 5);
  const commentsText =
    comments.length > 0 ? comments.map((c) => `**${c.username}:** ${c.content}`).join('\n') : '_Nenhum comentário ainda._';

  const title = recording.title || `${recording.channel_name} — sem título`;
  const category = recording.category || 'Sem categoria';
  const createdTs = Math.floor(new Date(recording.created_at).getTime() / 1000);

  const containerComponents = [
    { type: 10, content: `# 🎙️ ${title}\n📁 Categoria: **${category}**\n🗓️ <t:${createdTs}:f>` },
    { type: 14, divider: true, spacing: 1 },
    {
      type: 10,
      content: `👍 \`${recording.upvotes || 0}\` · 👎 \`${recording.downvotes || 0}\`\n\n**Comentários recentes:**\n${commentsText}`,
    },
  ];

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`calls:listen:${recording.id}`).setLabel('Ouvir').setEmoji('🔊').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`calls:vote:${recording.id}:1`).setLabel('Upvote').setEmoji('👍').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`calls:vote:${recording.id}:-1`).setLabel('Downvote').setEmoji('👎').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`calls:comment:${recording.id}`).setLabel('Comentar').setEmoji('💬').setStyle(ButtonStyle.Secondary)
  );

  return {
    flags: 32768,
    components: [
      { type: 17, accent_color: 3447003, components: containerComponents },
      actionRow.toJSON(),
      backRow(authorId),
    ],
  };
}

export async function execute(interaction) {
  if (!hasAccess(interaction.member)) {
    return interaction.reply(noAccessReply());
  }

  await interaction.deferReply();

  const categories = await getCategories(interaction.guildId);
  const payload = getCategoryMenuPayload(interaction.user.id, categories);
  await interaction.editReply(payload);
}

export async function handleInteraction(interaction, args) {
  const [action] = args;

  if (action === 'category' || action === 'pick' || action === 'back') {
    const authorId = args[1];
    if (interaction.user.id !== authorId) {
      return interaction.reply({ content: '❌ Apenas quem usou o comando pode interagir com o menu.', ephemeral: true });
    }

    await interaction.deferUpdate();

    if (action === 'back') {
      const categories = await getCategories(interaction.guildId);
      return interaction.editReply(getCategoryMenuPayload(authorId, categories));
    }

    if (action === 'category') {
      const category = interaction.values[0];
      const recordings = await getRecordings(interaction.guildId, category === '__recent__' ? null : category, 25);
      return interaction.editReply(getRecordingListPayload(authorId, category, recordings));
    }

    if (action === 'pick') {
      const recording = await getRecordingById(interaction.values[0]);
      if (!recording) {
        return interaction.editReply({ content: '❌ Gravação não encontrada (pode ter sido removida).', components: [] });
      }
      return interaction.editReply(await getRecordingDetailPayload(authorId, recording));
    }
    return;
  }

  if (action === 'vote') {
    if (!hasAccess(interaction.member)) return interaction.reply(noAccessReply());

    const recordingId = args[1];
    const voteValue = Number(args[2]);
    await interaction.deferReply({ ephemeral: true });
    const result = await voteRecording(recordingId, interaction.user.id, voteValue);
    if (!result) {
      return interaction.editReply({ content: '❌ Erro ao registrar seu voto.' });
    }
    return interaction.editReply({ content: `✅ Voto registrado! 👍 ${result.upvotes} · 👎 ${result.downvotes}` });
  }

  if (action === 'listen') {
    if (!hasAccess(interaction.member)) return interaction.reply(noAccessReply());

    const recordingId = args[1];
    await interaction.deferReply({ ephemeral: true });
    const recording = await getRecordingById(recordingId);
    if (!recording) {
      return interaction.editReply({ content: '❌ Gravação não encontrada.' });
    }
    const url = await getListenUrl(recording.storage_path);
    if (!url) {
      return interaction.editReply({ content: '❌ Erro ao gerar o link de áudio.' });
    }
    return interaction.editReply({ content: `🔊 ${url}\n*Link válido por 24h.*` });
  }

  if (action === 'comment') {
    if (!hasAccess(interaction.member)) return interaction.reply(noAccessReply());

    const recordingId = args[1];
    const modal = new ModalBuilder().setCustomId(`calls:commentmodal:${recordingId}`).setTitle('Comentar na gravação');

    const input = new TextInputBuilder()
      .setCustomId('content')
      .setLabel('Seu comentário')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(500)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }
}

export async function handleModalSubmit(interaction, args) {
  const [action, recordingId] = args;
  if (action !== 'commentmodal') return;

  if (!hasAccess(interaction.member)) return interaction.reply(noAccessReply());

  const content = interaction.fields.getTextInputValue('content');
  await interaction.deferReply({ ephemeral: true });
  const ok = await addComment(recordingId, interaction.user.id, interaction.user.username, content);
  if (ok) {
    return interaction.editReply({ content: '✅ Comentário adicionado!' });
  }
  return interaction.editReply({ content: '❌ Erro ao adicionar comentário.' });
}
