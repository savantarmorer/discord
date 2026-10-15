// ============================================
// config.js — Configuração centralizada do bot
// ============================================
// Carrega variáveis de ambiente do arquivo .env
import 'dotenv/config';

/**
 * Validação de variáveis obrigatórias.
 * O bot não inicia se alguma estiver ausente.
 */
/**
 * Recursos antigos (voz, fala na call, mensagens no chat, apelidos, ARG, clima,
 * gravação de calls, comandos $/%) ficam DESLIGADOS por padrão durante a prévia
 * da Ágora. Para religar: RECURSOS_LEGADOS=true.
 */
const LEGADO = process.env.RECURSOS_LEGADOS === 'true';

const REQUIRED_VARS = [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_GUILD_ID',
  // O banco antigo (métricas de voz) só é exigido com os recursos antigos ligados
  ...(LEGADO ? ['SUPABASE_URL', 'SUPABASE_KEY'] : []),
];

for (const varName of REQUIRED_VARS) {
  if (!process.env[varName]) {
    console.error(`❌ Variável de ambiente "${varName}" não está definida. Verifique seu arquivo .env`);
    process.exit(1);
  }
}

export const config = {
  // true = liga voz, fala, mensagens no chat, apelidos etc. (ver topo do arquivo)
  legado: LEGADO,

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

  // Prévia da Ágora (banco do app; ver src/agora/README)
  agora: {
    url: process.env.AGORA_SUPABASE_URL,
    anonKey: process.env.AGORA_SUPABASE_ANON_KEY,
    serviceKey: process.env.AGORA_SUPABASE_SERVICE_KEY,
    // Opcional: segredo JWT legado do projeto (Settings › API › JWT Secret). Com ele o bot
    // assina as sessões localmente; sem ele usa links mágicos gerados pelo servidor.
    jwtSecret: process.env.AGORA_JWT_SECRET,
    // Opcional: cargo do Discord que dá assinatura ativa na Ágora. Sem ele, todos do servidor participam.
    cargoMembroId: process.env.AGORA_CARGO_MEMBRO_ID,
    // Domínio dos e-mails técnicos das contas criadas pelo Discord (nenhum e-mail é enviado para ele)
    dominioEmail: process.env.AGORA_DOMINIO_EMAIL || 'discord.agora.app',
    // Link mostrado nas mensagens para baixar o app
    urlApp: process.env.AGORA_URL_APP || 'https://github.com/savantarmorer/newrepo/releases/latest/download/agora.apk',
    // Eventos do Mutirão e votações da Assembleia viram eventos agendados no Discord
    // (precisa da permissão "Criar eventos"/"Gerenciar eventos"). Desligue com "false".
    eventosDiscord: process.env.AGORA_EVENTOS_DISCORD !== 'false',
    // Canal de voz padrão das aulas e debates ao vivo (quem marca pode escolher outro)
    canalVozPadrao: process.env.AGORA_CANAL_VOZ_PADRAO || '1514437822407381133',
    // Prefixo dos comandos por mensagem (%menu, %app…). Vazio desliga. Precisa da intent
    // "Message Content" ligada no Developer Portal.
    prefixo: process.env.AGORA_PREFIXO ?? '%',
  },
};
