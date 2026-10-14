// ============================================
// index.js — Ponto de entrada principal do bot
// ============================================
// Durante a prévia da Ágora o bot só responde aos comandos da Ágora (/agora,
// /dracmas, /biblioteca, /mutirao, /assembleia). Os recursos antigos — voz, fala na
// call, mensagens no chat, troca de apelidos etc. — ficam em ./legado.js e só são
// carregados com RECURSOS_LEGADOS=true.

import {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  ActivityType,
  MessageFlags,
} from 'discord.js';
import http from 'http';
import { config } from './config.js';
import { comandosAgora } from './agora/comandos.js';
import { deployCommands } from './commands/deploy.js';

// ============================================
// 1. Client com o mínimo de permissões necessárias
// ============================================
// Sem os recursos antigos, o bot não precisa ver canais de voz, membros nem ler mensagens.
const intents = config.legado
  ? [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ]
  : [GatewayIntentBits.Guilds];

export const client = new Client({ intents });

// ============================================
// 2. Comandos
// ============================================
client.commands = new Collection();
for (const comando of comandosAgora) client.commands.set(comando.data.name, comando);

const legado = config.legado ? await import('./legado.js') : null;
if (legado) {
  for (const comando of legado.comandos) client.commands.set(comando.data.name, comando);
  legado.registrar(client);
} else {
  console.log('🔕 Recursos antigos desligados (voz, fala, mensagens no chat, apelidos). Use RECURSOS_LEGADOS=true para religar.');
}

// ============================================
// 3. Bot pronto
// ============================================
client.once(Events.ClientReady, (readyClient) => {
  console.log(`🤖 Bot conectado como: ${readyClient.user.tag} · servidores: ${readyClient.guilds.cache.size}`);
  if (!legado) {
    readyClient.user.setActivity('Prévia da Ágora · /agora entrar', { type: ActivityType.Playing });
  }
});

// ============================================
// 4. Interações: comandos de barra, autocompletar, botões, menus e formulários
// ============================================
const MENSAGEM_ERRO = '❌ Ocorreu um erro ao executar esta ação. Tente novamente.';

async function responderErro(interaction) {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content: MENSAGEM_ERRO, embeds: [], components: [] }).catch(() => null);
  } else {
    await interaction.reply({ content: MENSAGEM_ERRO, flags: MessageFlags.Ephemeral }).catch(() => null);
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  // Autocompletar (ex.: escolher tópico, projeto ou proposta pelo nome)
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (typeof command?.autocomplete !== 'function') return;
    try {
      await command.autocomplete(interaction);
    } catch (error) {
      console.error(`❌ Erro no autocompletar de /${interaction.commandName}:`, error.message);
      await interaction.respond([]).catch(() => null);
    }
    return;
  }

  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) {
      console.warn(`⚠️  Comando desconhecido: ${interaction.commandName}`);
      return;
    }
    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`❌ Erro ao executar /${interaction.commandName}:`, error);
      await responderErro(interaction);
    }
    return;
  }

  // Componentes e formulários: o customId começa com o nome do comando ("assembleia:votar:…")
  const ehComponente =
    interaction.isButton() || interaction.isStringSelectMenu() || interaction.isUserSelectMenu();
  if (!ehComponente && !interaction.isModalSubmit()) return;

  const partes = interaction.customId.split(':');
  const command = client.commands.get(partes[0]);
  const handler = interaction.isModalSubmit() ? command?.handleModalSubmit : command?.handleInteraction;
  if (typeof handler !== 'function') return;
  try {
    await handler(interaction, partes.slice(1));
  } catch (error) {
    console.error(`❌ Erro ao processar ${interaction.customId}:`, error);
    await responderErro(interaction);
  }
});

// ============================================
// 5. Desligamento
// ============================================
async function gracefulShutdown(signal) {
  console.log(`\n🛑 Recebido ${signal}. Encerrando...`);
  if (legado) {
    try {
      await legado.encerrar();
      console.log('✅ Dados antigos salvos.');
    } catch (err) {
      console.error('❌ Erro durante shutdown:', err.message);
    }
  }
  client.destroy();
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('uncaughtException', async (err) => {
  console.error('❌ Exceção não capturada:', err);
  await gracefulShutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  console.error('❌ Promise rejeitada sem handler:', reason);
});

// ============================================
// 6. Inicialização
// ============================================
console.log('🚀 Iniciando bot...');
if (legado) await legado.iniciar();

await deployCommands([...client.commands.values()].map((c) => c.data.toJSON()));

// Health check para o Railway/Render
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is online!');
  })
  .listen(PORT, () => console.log(`📡 Health check na porta ${PORT}`));

await client.login(config.token);
