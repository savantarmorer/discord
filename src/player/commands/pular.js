import { SlashCommandBuilder } from 'discord.js';
import { playerConfig } from '../config.js';
import { skip } from '../playerManager.js';

export const data = new SlashCommandBuilder()
  .setName('pular')
  .setDescription('Pula para a próxima parte da call atual (se ela tiver mais de 30min).');

function hasAccess(member) {
  return Boolean(playerConfig.callsArchiveRoleId) && member.roles.cache.has(playerConfig.callsArchiveRoleId);
}

export async function execute(interaction) {
  if (!hasAccess(interaction.member)) {
    return interaction.reply({ content: '❌ Você não tem acesso ao arquivo de gravações.', ephemeral: true });
  }
  const ok = skip(interaction.guildId);
  return interaction.reply({
    content: ok ? '⏭️ Pulando para a próxima parte...' : '❌ Não há próxima parte na fila. Use /tocar para escolher outra call.',
    ephemeral: true,
  });
}
