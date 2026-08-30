// ============================================
// player/config.js — Configuração do bot de reprodução
// ============================================
// Processo Node separado do bot principal (roda como outro serviço no
// Render), com seu próprio token de aplicação Discord — necessário porque
// o Discord só permite UMA conexão de voz por servidor por bot, e o bot
// principal já usa a dele para gravar a call ao vivo.
import 'dotenv/config';

const REQUIRED_VARS = [
  'PLAYER_BOT_TOKEN',
  'PLAYER_BOT_CLIENT_ID',
  'DISCORD_GUILD_ID',
  'PLAYER_VOICE_CHANNEL_ID',
  'SUPABASE_URL',
  'SUPABASE_KEY',
];

for (const varName of REQUIRED_VARS) {
  if (!process.env[varName]) {
    console.error(`❌ [PLAYER] Variável de ambiente "${varName}" não está definida.`);
    process.exit(1);
  }
}

export const playerConfig = {
  token: process.env.PLAYER_BOT_TOKEN,
  clientId: process.env.PLAYER_BOT_CLIENT_ID,
  guildId: process.env.DISCORD_GUILD_ID,
  voiceChannelId: process.env.PLAYER_VOICE_CHANNEL_ID,
  callsArchiveRoleId: process.env.CALLS_ARCHIVE_ROLE_ID,
};
