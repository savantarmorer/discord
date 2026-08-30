// ============================================
// config.js — Configuração centralizada do bot
// ============================================
// Carrega variáveis de ambiente do arquivo .env
import 'dotenv/config';

/**
 * Validação de variáveis obrigatórias.
 * O bot não inicia se alguma estiver ausente.
 */
const REQUIRED_VARS = [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_GUILD_ID',
  'SUPABASE_URL',
  'SUPABASE_KEY',
];

for (const varName of REQUIRED_VARS) {
  if (!process.env[varName]) {
    console.error(`❌ Variável de ambiente "${varName}" não está definida. Verifique seu arquivo .env`);
    process.exit(1);
  }
}

export const config = {
  // Discord
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  guildId: process.env.DISCORD_GUILD_ID,
  defaultVoiceChannelId: process.env.DEFAULT_VOICE_CHANNEL_ID,
  // Canal de texto opcional onde o bot posta os links das gravações de call ao final de cada sessão.
  recordingsChannelId: process.env.RECORDINGS_CHANNEL_ID,
  // Cargo exigido para usar /calls e /renomearcall (arquivo de gravações). Sem essa variável, ninguém tem acesso.
  callsArchiveRoleId: process.env.CALLS_ARCHIVE_ROLE_ID,

  // Supabase
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_KEY,
  // Chave service_role — opcional, usada só pelo callRecorder.js para upload
  // de gravações de chamada no Storage (bypassa RLS, nunca deve ir ao cliente).
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY,

  // Intervalo (ms) para salvar métricas parciais no banco (failsafe contra crashes)
  // A cada 5 minutos, os dados em memória são persistidos
  SAVE_INTERVAL_MS: 5 * 60 * 1000,
};
