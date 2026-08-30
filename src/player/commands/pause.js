import { SlashCommandBuilder } from 'discord.js';
import { playerConfig } from '../config.js';
import { pause } from '../playerManager.js';

export const data = new SlashCommandBuilder().setName('pause').setDescription('Pausa a reprodução atual.');

function hasAccess(member) {
  return Boolean(playerConfig.callsArchiveRoleId) && member.roles.cache.has(playerConfig.callsArchiveRoleId);
}

export async function execute(interaction) {
  if (!hasAccess(interaction.member)) {
    return interaction.reply({ content: '❌ Você não tem acesso ao arquivo de gravações.', ephemeral: true });
  }
  const ok = pause(interaction.guildId);
  return interaction.reply({ content: ok ? '⏸️ Reprodução pausada.' : '❌ Nada tocando no momento.', ephemeral: true });
}
