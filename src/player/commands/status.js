import { SlashCommandBuilder } from 'discord.js';
import { playerConfig } from '../config.js';
import { getStatus } from '../playerManager.js';

export const data = new SlashCommandBuilder().setName('status').setDescription('Mostra o que está tocando agora.');

function hasAccess(member) {
  return Boolean(playerConfig.callsArchiveRoleId) && member.roles.cache.has(playerConfig.callsArchiveRoleId);
}

export async function execute(interaction) {
  if (!hasAccess(interaction.member)) {
    return interaction.reply({ content: '❌ Você não tem acesso ao arquivo de gravações.', ephemeral: true });
  }

  const status = getStatus(interaction.guildId);
  if (!status || !status.current) {
    return interaction.reply({ content: '❌ Nada tocando no momento. Use /tocar.', ephemeral: true });
  }

  const title = status.current.title || `${status.current.channel_name} — sem título`;
  const stateLabel = status.status === 'paused' ? '⏸️ Pausado' : '▶️ Tocando';
  return interaction.reply({
    content: `${stateLabel}: **${title}** (parte ${status.partIndex + 1}/${status.totalParts})`,
    ephemeral: true,
  });
}
