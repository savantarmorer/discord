import { SlashCommandBuilder } from 'discord.js';
import { playerConfig } from '../config.js';
import { stop } from '../playerManager.js';

export const data = new SlashCommandBuilder().setName('parar').setDescription('Para a reprodução e sai do canal de voz.');

function hasAccess(member) {
  return Boolean(playerConfig.callsArchiveRoleId) && member.roles.cache.has(playerConfig.callsArchiveRoleId);
}

export async function execute(interaction) {
  if (!hasAccess(interaction.member)) {
    return interaction.reply({ content: '❌ Você não tem acesso ao arquivo de gravações.', ephemeral: true });
  }
  const ok = stop(interaction.guildId);
  return interaction.reply({ content: ok ? '⏹️ Reprodução encerrada.' : '❌ Nada tocando no momento.', ephemeral: true });
}
