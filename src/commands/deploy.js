// ============================================
// commands/deploy.js — Deploy dos Slash Commands
// ============================================
// O index.js chama deployCommands(lista) no startup com os comandos ativos.
// Também pode rodar sozinho: npm run deploy-commands

import { REST, Routes } from 'discord.js';
import { config } from '../config.js';

/**
 * Registra no servidor (guild) exatamente a lista recebida — comandos que saíram
 * da lista (ex.: os antigos, com RECURSOS_LEGADOS desligado) somem do Discord.
 * @param {object[]} commands JSON dos SlashCommandBuilder
 */
export async function deployCommands(commands) {
  const rest = new REST({ version: '10' }).setToken(config.token);
  try {
    console.log(`📡 Registrando ${commands.length} comando(s) de barra...`);
    const data = await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
      body: commands,
    });
    console.log(`✅ ${data.length} comando(s) registrado(s):`);
    data.forEach((cmd) => console.log(`   - /${cmd.name}: ${cmd.description}`));
    return true;
  } catch (error) {
    console.error('❌ Erro ao registrar comandos:', error);
    return false;
  }
}

/** Monta a lista de comandos ativos conforme a configuração. */
export async function comandosAtivos() {
  const { comandosAgora } = await import('../agora/comandos.js');
  const lista = [...comandosAgora];
  if (config.legado) {
    const legado = await import('../legado.js');
    lista.push(...legado.comandos);
  }
  return lista.map((c) => c.data.toJSON());
}

// Execução direta via CLI
if (process.argv[1] && (process.argv[1].endsWith('deploy.js') || process.argv[1].endsWith('deploy'))) {
  deployCommands(await comandosAtivos());
}
