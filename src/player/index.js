// ============================================
// player/index.js — Ponto de entrada do bot de reprodução
// ============================================
// Processo separado do bot principal — toca gravações arquivadas na sala
// de reprodução configurada, com controles de play/pause/pular/parar.

import { Client, GatewayIntentBits, Collection, Events } from 'discord.js';
import http from 'http';
import { playerConfig } from './config.js';
import { deployPlayerCommands } from './deploy.js';

import * as tocarCommand from './commands/tocar.js';
import * as pauseCommand from './commands/pause.js';
import * as continuarCommand from './commands/continuar.js';
import * as pularCommand from './commands/pular.js';
import * as pararCommand from './commands/parar.js';
import * as statusCommand from './commands/status.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers],
});

client.commands = new Collection();
client.commands.set(tocarCommand.data.name, tocarCommand);
client.commands.set(pauseCommand.data.name, pauseCommand);
client.commands.set(continuarCommand.data.name, continuarCommand);
client.commands.set(pularCommand.data.name, pularCommand);
client.commands.set(pararCommand.data.name, pararCommand);
client.commands.set(statusCommand.data.name, statusCommand);

client.once(Events.ClientReady, (readyClient) => {
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log(`🎧 Bot de reprodução conectado como: ${readyClient.user.tag}`);
  console.log('═══════════════════════════════════════════');
  console.log('');
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`❌ [PLAYER] Erro ao executar /${interaction.commandName}:`, error);
      const reply = { content: '❌ Ocorreu um erro ao executar este comando.', ephemeral: true };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(reply).catch(() => null);
      } else {
        await interaction.reply(reply).catch(() => null);
      }
    }
  } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
    const parts = interaction.customId.split(':');
    const command = client.commands.get(parts[0]);
    if (command && typeof command.handleInteraction === 'function') {
      try {
        await command.handleInteraction(interaction, parts.slice(1));
      } catch (error) {
        console.error(`❌ [PLAYER] Erro ao processar interação ${interaction.customId}:`, error);
        await interaction.reply({ content: '❌ Ocorreu um erro ao processar esta ação.', ephemeral: true }).catch(() => null);
      }
    }
  }
});

(async () => {
  console.log('🚀 Iniciando bot de reprodução...');

  await deployPlayerCommands();

  const PORT = process.env.PORT || 3000;
  http
    .createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Player bot is online!');
    })
    .listen(PORT, () => {
      console.log(`📡 [PLAYER] Servidor de Health Check ativo na porta ${PORT}`);
    });

  await client.login(playerConfig.token);
})();

process.on('SIGINT', () => {
  client.destroy();
  process.exit(0);
});
process.on('SIGTERM', () => {
  client.destroy();
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ [PLAYER] Promise rejeitada sem handler:', reason);
});
