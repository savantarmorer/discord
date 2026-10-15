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
import { problemasDeConfiguracao, verificarBanco } from './agora/cliente.js';
import { iniciarEventosDiscord } from './agora/eventos-discord.js';
import { aoClicar, aoReceberMensagem, PREFIXO } from './agora/prefixo.js';
import { deployCommands } from './commands/deploy.js';

// ============================================
// 1. Client com o mínimo de permissões necessárias
// ============================================
// Sem os recursos antigos, o bot não precisa ver membros. GuildVoiceStates (não
// privilegiada) serve só para saber quem está na call das aulas — o bot não entra no
// canal nem fala. GuildMessages + MessageContent servem só aos comandos com % (%menu…).
const legado = config.legado ? await import('./legado.js') : null;
const comPrefixo = !legado && Boolean(PREFIXO);
const INTENTS_PREFIXO = [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent];
const intentsDe = (prefixo) => (legado
  ? [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ]
  : [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, ...(prefixo ? INTENTS_PREFIXO : [])]);

// ============================================
// 2. Comandos
// ============================================
const comandos = new Collection();
for (const comando of comandosAgora) comandos.set(comando.data.name, comando);
if (legado) {
  for (const comando of legado.comandos) comandos.set(comando.data.name, comando);
} else {
  console.log('🔕 Recursos antigos desligados (voz, fala, mensagens no chat, apelidos). Use RECURSOS_LEGADOS=true para religar.');
}

/** Cria o cliente com os handlers (pode ser recriado sem os comandos com % se a intent faltar). */
function criarCliente(prefixoLigado) {
  const client = new Client({ intents: intentsDe(prefixoLigado) });
  client.commands = comandos;
  if (legado) legado.registrar(client);
  registrarHandlers(client, prefixoLigado);
  return client;
}

function registrarHandlers(client, prefixoLigado) {
// ============================================
// 3. Bot pronto
// ============================================
client.once(Events.ClientReady, (readyClient) => {
  console.log(`🤖 Bot conectado como: ${readyClient.user.tag} · servidores: ${readyClient.guilds.cache.size}`);
  if (!legado) {
    readyClient.user.setActivity(prefixoLigado ? `Prévia da Ágora · /menu ou ${PREFIXO}menu` : 'Prévia da Ágora · /menu', { type: ActivityType.Playing });
    if (prefixoLigado) console.log(`⌨️  Comandos com ${PREFIXO} ligados (ex.: ${PREFIXO}menu).`);
    if (iniciarEventosDiscord(readyClient)) console.log('📅 Eventos do Mutirão e votações da Assembleia viram eventos do Discord.');
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
  // Botão "Abrir" de um comando digitado com % (px:<token>)
  if (partes[0] === 'px' && interaction.isButton()) {
    try {
      await aoClicar(interaction, partes[1], client.commands);
    } catch (error) {
      console.error(`❌ Erro no comando com ${PREFIXO}:`, error);
      await responderErro(interaction);
    }
    return;
  }
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

// Comandos com % (%menu, %app, %biblioteca acervo tarô…)
if (prefixoLigado) {
  client.on(Events.MessageCreate, (message) => {
    aoReceberMensagem(message, client.commands).catch((e) => console.error(`❌ Erro no comando com ${PREFIXO}:`, e.message));
  });
}
}

let client = criarCliente(comPrefixo);

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
for (const p of problemasDeConfiguracao()) console.error(`⚠️  Ágora: ${p}`);
const erroBanco = await verificarBanco().catch((e) => e.message);
if (erroBanco) {
  console.error(`⚠️  Ágora: o banco está desatualizado em relação ao bot (${erroBanco}).`);
  console.error('   Rode no GitHub: Actions › "Ágora — backend Supabase" › Run workflow. Depois reinicie o bot.');
}

await deployCommands([...comandos.values()].map((c) => c.data.toJSON()));

// Health check para o Railway/Render
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is online!');
  })
  .listen(PORT, () => console.log(`📡 Health check na porta ${PORT}`));

// Sem a intent "Message Content" ligada no Developer Portal o Discord recusa a conexão
// (código 4014): liga de novo sem os comandos com % e explica como ativar.
const AVISO_INTENT = `⚠️  Os comandos com ${PREFIXO} precisam da intent "Message Content": Developer Portal › seu app › Bot › Privileged Gateway Intents › MESSAGE CONTENT INTENT (ligar e salvar) e reinicie o bot. Ligando sem eles por enquanto.`;
let recriado = false;
async function semPrefixo() {
  if (recriado) return;
  recriado = true;
  console.error(AVISO_INTENT);
  client.destroy();
  client = criarCliente(false);
  await client.login(config.token);
}
if (comPrefixo) {
  client.on(Events.ShardDisconnect, (evento) => {
    if (evento?.code === 4014) semPrefixo().catch((e) => console.error('❌ Falha ao reconectar:', e.message));
  });
}
try {
  await client.login(config.token);
} catch (e) {
  if (comPrefixo && /disallowed intents|privileged intent/i.test(String(e?.message ?? e))) await semPrefixo();
  else throw e;
}
