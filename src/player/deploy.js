// ============================================
// player/deploy.js — Deploy dos Slash Commands do bot de reprodução
// ============================================
// Execute via: npm run deploy-commands:player
// Ou importado para rodar no startup do bot de reprodução.

import { REST, Routes } from 'discord.js';
import { playerConfig } from './config.js';
import { data as tocar } from './commands/tocar.js';
import { data as pause } from './commands/pause.js';
import { data as continuar } from './commands/continuar.js';
import { data as pular } from './commands/pular.js';
import { data as parar } from './commands/parar.js';
import { data as status } from './commands/status.js';

const commands = [tocar.toJSON(), pause.toJSON(), continuar.toJSON(), pular.toJSON(), parar.toJSON(), status.toJSON()];

const rest = new REST({ version: '10' }).setToken(playerConfig.token);

export async function deployPlayerCommands() {
  try {
    console.log(`📡 [PLAYER] Registrando ${commands.length} comando(s) de barra...`);

    const data = await rest.put(Routes.applicationGuildCommands(playerConfig.clientId, playerConfig.guildId), {
      body: commands,
    });

    console.log(`✅ [PLAYER] ${data.length} comando(s) registrado(s) com sucesso!`);
    return true;
  } catch (error) {
    console.error('❌ [PLAYER] Erro ao registrar comandos:', error);
    return false;
  }
}

if (process.argv[1] && (process.argv[1].endsWith('deploy.js') || process.argv[1].endsWith('deploy'))) {
  deployPlayerCommands();
}
