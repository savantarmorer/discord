import { SlashCommandBuilder } from 'discord.js';
import { playerConfig } from '../config.js';
import { resume } from '../playerManager.js';

export const data = new SlashCommandBuilder().setName('continuar').setDescription('Retoma a reprodução pausada.');

function hasAccess(member) {
  return Boolean(playerConfig.callsArchiveRoleId) && member.roles.cache.has(playerConfig.callsArchiveRoleId);
}

export async function execute(interaction) {
  if (!hasAccess(interaction.member)) {
    return interaction.reply({ content: '❌ Você não tem acesso ao arquivo de gravações.', ephemeral: true });
  }
  const ok = resume(interaction.guildId);
  return interaction.reply({ content: ok ? '▶️ Reprodução retomada.' : '❌ Nada pausado no momento.', ephemeral: true });
}
