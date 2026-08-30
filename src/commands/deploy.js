// ============================================
// commands/deploy.js — Deploy dos Slash Commands
// ============================================
// Pode ser executado via CLI: npm run deploy-commands
// Ou importado para rodar no startup do bot.

import { REST, Routes } from 'discord.js';
import { config } from '../config.js';
import { data as statusvoz } from './statusvoz.js';
import { data as topfala } from './topfala.js';
import { data as level } from './level.js';
import { data as toplevel } from './toplevel.js';
import { data as loja } from './loja.js';
import { data as falar } from './falar.js';
import { data as repetir } from './repetir.js';
import { data as conquistas } from './conquistas.js';
import { data as logs } from './logs.js';
import { data as calls } from './calls.js';
import { data as renomearcall } from './renomearcall.js';
import { data as participacao } from './participacao.js';

const commands = [
  statusvoz.toJSON(),
  topfala.toJSON(),
  level.toJSON(),
  toplevel.toJSON(),
  loja.toJSON(),
  falar.toJSON(),
  repetir.toJSON(),
  conquistas.toJSON(),
  logs.toJSON(),
  calls.toJSON(),
  renomearcall.toJSON(),
  participacao.toJSON()
];

const rest = new REST({ version: '10' }).setToken(config.token);

export async function deployCommands() {
  try {
    console.log(`📡 Registrando ${commands.length} comando(s) de barra...`);

    // Registra os comandos no servidor (guild) específico
    const data = await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: commands }
    );

    console.log(`✅ ${data.length} comando(s) registrado(s) com sucesso!`);
    console.log('   Comandos disponíveis:');
    data.forEach((cmd) => console.log(`   - /${cmd.name}: ${cmd.description}`));
    return true;
  } catch (error) {
    console.error('❌ Erro ao registrar comandos:', error);
    return false;
  }
}

// Se executado diretamente via CLI
if (process.argv[1] && (process.argv[1].endsWith('deploy.js') || process.argv[1].endsWith('deploy'))) {
  deployCommands();
}

