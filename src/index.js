// ============================================
// index.js — Ponto de entrada principal do bot
// ============================================
// Bot Discord para métricas avançadas de canais de voz.
// Rastreia tempo de presença e tempo de fala real dos usuários.

import {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  ActivityType,
} from 'discord.js';
import http from 'http';
import { config } from './config.js';

import { initDatabase } from './database.js';
import { syncMemberNicknameBadges } from './utils/lootSystem.js';
import {
  startPresenceTracking,
  stopPresenceTracking,
  isTracking,
  flushAllPresence,
  stopAllPresenceTracking,
  setVoiceTrackerClient,
} from './voiceTracker.js';
import {
  flushAllSpeaking,
  stopAllSpeaking,
  setSpeakingTrackerClient,
} from './speakingTracker.js';
import {
  syncVoiceChannels,
  joinChannel,
  leaveChannel,
  disconnectAll,
  getReadyConnections,
} from './voiceManager.js';
import { startClimateEngine } from './climate.js';
import { speakRandomPhrase } from './utils/speech.js';

// Importa os comandos e script de deploy
import * as statusvozCommand from './commands/statusvoz.js';
import * as topfalaCommand from './commands/topfala.js';
import * as levelCommand from './commands/level.js';
import * as toplevelCommand from './commands/toplevel.js';
import * as lojaCommand from './commands/loja.js';
import * as falarCommand from './commands/falar.js';
import * as repetirCommand from './commands/repetir.js';
import * as conquistasCommand from './commands/conquistas.js';
import * as logsCommand from './commands/logs.js';
import * as callsCommand from './commands/calls.js';
import * as renomearcallCommand from './commands/renomearcall.js';
import * as participacaoCommand from './commands/participacao.js';
import { deployCommands } from './commands/deploy.js';


// ============================================
// 1. Cria o client do Discord com as intents necessárias
// ============================================
export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,           // Acesso a servidores
    GatewayIntentBits.GuildVoiceStates,  // Eventos de voz (join/leave/mute/deaf)
    GatewayIntentBits.GuildMembers,      // Acesso a membros (para nomes)
    GatewayIntentBits.GuildMessages,    // Acesso a mensagens de texto (para comandos $)
    GatewayIntentBits.MessageContent,   // Permissão para ler o conteúdo das mensagens
  ],
});

// Injeta a instância do client nos rastreadores para evitar dependências circulares
setVoiceTrackerClient(client);
setSpeakingTrackerClient(client);

// ============================================
// 2. Registra os comandos em uma Collection
// ============================================
client.commands = new Collection();
client.commands.set(statusvozCommand.data.name, statusvozCommand);
client.commands.set(topfalaCommand.data.name, topfalaCommand);
client.commands.set(levelCommand.data.name, levelCommand);
client.commands.set(toplevelCommand.data.name, toplevelCommand);
client.commands.set(lojaCommand.data.name, lojaCommand);
client.commands.set(falarCommand.data.name, falarCommand);
client.commands.set(repetirCommand.data.name, repetirCommand);
client.commands.set(conquistasCommand.data.name, conquistasCommand);
client.commands.set(logsCommand.data.name, logsCommand);
client.commands.set(callsCommand.data.name, callsCommand);
client.commands.set(renomearcallCommand.data.name, renomearcallCommand);
client.commands.set(participacaoCommand.data.name, participacaoCommand);

// ============================================
// 3. Evento: Bot está pronto
// ============================================
client.once(Events.ClientReady, async (readyClient) => {
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log(`🤖 Bot conectado como: ${readyClient.user.tag}`);
  console.log(`📊 Servidores: ${readyClient.guilds.cache.size}`);
  console.log('═══════════════════════════════════════════');
  console.log('');

  // Define o status/atividade do bot
  readyClient.user.setActivity('canais de voz 🎙️', {
    type: ActivityType.Watching,
  });

  // ===================================================
  // Sincronização inicial: verifica quem já está em voz
  // ===================================================
  for (const [, guild] of readyClient.guilds.cache) {
    // Busca todos os membros (necessário para o cache)
    try {
      await guild.members.fetch();
    } catch {
      console.warn(`⚠️  Não foi possível buscar membros de ${guild.name}`);
    }

    // Para cada canal de voz, verifica se há usuários
    const voiceChannels = guild.channels.cache.filter(
      (ch) => ch.type === 2 /* GuildVoice */ || ch.type === 13 /* GuildStageVoice */
    );

    for (const [, channel] of voiceChannels) {
      const humanMembers = channel.members.filter((m) => !m.user.bot);

      // Se há humanos no canal, inicia o rastreamento de presença e sincroniza apelidos
      for (const [memberId, member] of humanMembers) {
        if (!isTracking(memberId)) {
          startPresenceTracking(
            memberId,
            member.displayName || member.user.username,
            channel.id,
            member.voice?.selfVideo || false
          );
        }
      }
    }

    // Conecta o bot nos canais com usuários (para fala)
    await syncVoiceChannels(guild, readyClient);
  }

  // ===================================================
  // Flush periódico: salva dados a cada N minutos
  // ===================================================
  setInterval(async () => {
    try {
      await flushAllPresence();
      await flushAllSpeaking();
    } catch (err) {
      console.error('❌ Erro no flush periódico:', err.message);
    }
  }, config.SAVE_INTERVAL_MS);

  // Auto-check global de apelidos a cada 15 minutos (900.000 ms)
  setInterval(() => {
    runGlobalNicknameAutoCheck(readyClient);
  }, 900000);

  // Inicia motor de eventos climáticos
  startClimateEngine(readyClient);

  // Inicia o agendador de fala periódica
  startPeriodicSpeechScheduler(readyClient);

  // Inicia o agendador de curiosidades/engajamento periódicos no chat (primeiro em 3 minutos)
  // startPeriodicChatPromptScheduler(readyClient, true);

  // Executa o primeiro auto-check de apelidos no boot (carregando em lote)
  runGlobalNicknameAutoCheck(readyClient).catch(() => null);

  console.log('✅ Sincronização inicial concluída. Bot operacional.');
});

// ============================================
// 4. Evento: Mudança de estado de voz (join/leave/switch/mute)
// ============================================
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const userId = newState.id;
  const member = newState.member;

  // Ignora bots
  if (member?.user?.bot) return;

  const username = member?.displayName || member?.user?.username || userId;
  const oldChannelId = oldState.channelId;
  const newChannelId = newState.channelId;

  // ─── Caso 1: Usuário ENTROU em um canal de voz ─────────────
  if (!oldChannelId && newChannelId) {
    startPresenceTracking(userId, username, newChannelId, newState.selfVideo || false);

    // Sincroniza para garantir que o bot está no canal mais cheio
    await syncVoiceChannels(newState.guild, client);
  }

  // ─── Caso 2: Usuário SAIU de um canal de voz ─────────────
  else if (oldChannelId && !newChannelId) {
    await stopPresenceTracking(userId);

    // Sincroniza para atualizar a conexão do bot para o canal mais cheio (ou desconectar se tudo estiver vazio)
    await syncVoiceChannels(oldState.guild, client);
  }

  // ─── Caso 3: Usuário TROCOU de canal ─────────────
  else if (oldChannelId && newChannelId && oldChannelId !== newChannelId) {
    // Finaliza a sessão do canal antigo e inicia no novo
    await stopPresenceTracking(userId);
    startPresenceTracking(userId, username, newChannelId, newState.selfVideo || false);

    // Sincroniza para atualizar a conexão do bot para o canal mais cheio
    await syncVoiceChannels(newState.guild, client);
  }


  // ─── Caso 4: Mesmo canal, mudança de estado (mute/deaf/etc) ─────
  // Não afeta presença — o usuário continua no canal.
  // Mute/deaf NÃO interrompe a presença, apenas a fala é gerenciada
  // pelo speaking event listener no voiceManager.
  
  // Detecta câmera ligada/desligada na mesma sala
  if (oldState.selfVideo !== newState.selfVideo) {
    import('./voiceTracker.js').then(({ updateCameraState }) => {
      updateCameraState(userId, newState.selfVideo || false);
    }).catch(err => {
      console.error('❌ Erro ao importar voiceTracker no VoiceStateUpdate (vídeo):', err.message);
    });
  }
});

// ============================================
// 4.5 Evento: Alteração de membro (mudança de apelido/nickname)
// ============================================
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  // Ignora bots
  if (newMember.user.bot) return;

  // Só age se o nickname mudou
  if (oldMember.nickname !== newMember.nickname) {
    // Se a alteração foi feita pelo próprio bot (está no botUpdatingNicks), ignora para evitar loop recursivo
    try {
      const { botUpdatingNicks } = await import('./utils/lootSystem.js');
      if (botUpdatingNicks.has(newMember.id)) {
        return;
      }
    } catch (importErr) {
      // Ignora erro
    }

    console.log(`👤 [NICKNAME] Apelido de ${newMember.user.username} alterado de "${oldMember.nickname}" para "${newMember.nickname}"`);
    
    // Importa dinamicamente para evitar dependências circulares
    import('./utils/lootSystem.js').then(({ syncMemberNicknameBadges }) => {
      syncMemberNicknameBadges(newMember).catch(err => {
        console.error(`❌ [NICKNAME] Erro ao sincronizar nickname para ${newMember.user.username}:`, err.message);
      });
    }).catch(err => {
      console.error(`❌ [NICKNAME] Erro ao importar lootSystem no GuildMemberUpdate:`, err.message);
    });
  }
});

// ============================================
// 5. Evento: Interação de comando (Slash Commands)
// ============================================
client.on(Events.InteractionCreate, async (interaction) => {
  // Se for comando Slash
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

      const reply = {
        content: '❌ Ocorreu um erro ao executar este comando. Tente novamente.',
        ephemeral: true,
      };

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(reply);
      } else {
        await interaction.reply(reply);
      }
    }
  }
  // Se for interação com componente de mensagem (Botão, Select Menu, etc.)
  else if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isUserSelectMenu()) {
    const customId = interaction.customId;
    const parts = customId.split(':');
    const commandPrefix = parts[0];

    const command = client.commands.get(commandPrefix);
    if (command && typeof command.handleInteraction === 'function') {
      try {
        await command.handleInteraction(interaction, parts.slice(1));
      } catch (error) {
        console.error(`❌ Erro ao processar interação do componente ${customId}:`, error);
        await interaction.reply({
          content: '❌ Ocorreu um erro ao processar esta ação.',
          ephemeral: true
        }).catch(() => null);
      }
    }
  }
  // Se for envio de um modal (formulário)
  else if (interaction.isModalSubmit()) {
    const customId = interaction.customId;
    const parts = customId.split(':');
    const commandPrefix = parts[0];

    const command = client.commands.get(commandPrefix);
    if (command && typeof command.handleModalSubmit === 'function') {
      try {
        await command.handleModalSubmit(interaction, parts.slice(1));
      } catch (error) {
        console.error(`❌ Erro ao processar modal ${customId}:`, error);
        const reply = { content: '❌ Ocorreu um erro ao processar este formulário.', ephemeral: true };
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(reply).catch(() => null);
        } else {
          await interaction.reply(reply).catch(() => null);
        }
      }
    }
  }
});

// ============================================
// 5.5 Evento: Mensagem de Texto (Suporte a comandos com $ ou %)
// ============================================
client.on(Events.MessageCreate, async (message) => {
  // Ignora mensagens de bots ou fora de servidores
  if (message.author.bot || !message.guild) return;

  // Verifica se a mensagem começa com "$" ou "%"
  const prefix = ['$', '%'].find((p) => message.content.startsWith(p));
  if (!prefix) return;

  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const commandName = args.shift().toLowerCase();

  const command = client.commands.get(commandName);
  if (!command) return; // Ignora se o comando não existe

  // Cria um objeto mock para simular a Interaction do Discord
  const mockInteraction = {
    guildId: message.guildId,
    guild: message.guild,
    channelId: message.channelId,
    channel: message.channel,
    user: message.author,
    member: message.member,
    deferred: false,
    replied: false,
    sentMessage: null,

    isChatInputCommand: () => true,

    deferReply: async () => {
      mockInteraction.deferred = true;
      await message.channel.sendTyping().catch(() => null);
    },

    reply: async (payload) => {
      const response = typeof payload === 'string' ? { content: payload } : payload;
      const msg = await message.channel.send(response);
      mockInteraction.replied = true;
      mockInteraction.sentMessage = msg;
      return msg;
    },

    editReply: async (payload) => {
      const response = typeof payload === 'string' ? { content: payload } : payload;
      if (mockInteraction.sentMessage) {
        return await mockInteraction.sentMessage.edit(response);
      } else {
        const msg = await message.channel.send(response);
        mockInteraction.sentMessage = msg;
        mockInteraction.replied = true;
        return msg;
      }
    },

    options: {
      getSubcommand: () => {
        if (commandName === 'loja') {
          return args[0]?.toLowerCase() || null;
        }
        return null;
      },

      getUser: (name) => {
        const searchArgs = (commandName === 'loja') ? args.slice(1) : args;

        // 1. Procura por menção direta
        if (message.mentions.users.size > 0) {
          return message.mentions.users.first();
        }

        // 2. Procura por ID numérico
        for (const arg of searchArgs) {
          if (/^\d{17,19}$/.test(arg)) {
            const user = message.client.users.cache.get(arg);
            if (user) return user;
          }
        }

        // 3. Procura por nome/apelido no servidor
        for (const arg of searchArgs) {
          if (!arg) continue;
          const member = message.guild.members.cache.find(m => 
            m.user.username.toLowerCase().includes(arg.toLowerCase()) || 
            (m.nickname && m.nickname.toLowerCase().includes(arg.toLowerCase()))
          );
          if (member) return member.user;
        }

        // Fallback padrão se for o autor da mensagem
        if (name === 'usuario' && commandName !== 'repetir') {
          return message.author;
        }
        return null;
      },

      getString: (name) => {
        if (commandName === 'falar') {
          if (name === 'mensagem') {
            const firstArg = args[0]?.toLowerCase();
            if (firstArg === 'la' || firstArg === 'pt-br') {
              return args.slice(1).join(' ').substring(0, 200);
            }
            return args.join(' ').substring(0, 200);
          }
          if (name === 'idioma') {
            const firstArg = args[0]?.toLowerCase();
            if (firstArg === 'la') return 'la';
            if (firstArg === 'pt-br') return 'pt-BR';
            return null;
          }
        }



        return null;
      }
    }
  };

  try {
    await command.execute(mockInteraction);
  } catch (error) {
    console.error(`❌ Erro ao executar ${prefix}${commandName} via texto:`, error);
    const errorPayload = { content: '❌ Ocorreu um erro ao executar este comando.' };
    if (mockInteraction.deferred || mockInteraction.replied) {
      await mockInteraction.editReply(errorPayload).catch(() => null);
    } else {
      await mockInteraction.reply(errorPayload).catch(() => null);
    }
  }
});

// ============================================
// Agendador de fala periódica
// ============================================
function startPeriodicSpeechScheduler(client) {
  // Configura a fala periódica para acontecer a cada 15-30 minutos (valores randômicos para naturalidade)
  const minMinutes = 15;
  const maxMinutes = 30;
  const delayMs = Math.floor(Math.random() * (maxMinutes - minMinutes + 1) + minMinutes) * 60 * 1000;

  setTimeout(async () => {
    try {
      const connections = getReadyConnections();
      if (connections.length > 0) {
        // Escolhe uma conexão/guild aleatória onde o bot está presente
        const randomConnEntry = connections[Math.floor(Math.random() * connections.length)];
        const guild = client.guilds.cache.get(randomConnEntry.guildId);
        
        if (guild) {
          const botMember = guild.members.me;
          const voiceChannel = botMember?.voice?.channel;
          
          // Garante que só fala se houver pelo menos um humano conectado no canal do bot
          if (voiceChannel) {
            const humanCount = voiceChannel.members.filter(m => !m.user.bot).size;
            if (humanCount > 0) {
              speakRandomPhrase(randomConnEntry.connection);
            }
          }
        }
      }
    } catch (err) {
      console.error('❌ [SPEECH] Erro no agendador de fala periódica:', err.message);
    }
    // Repete recursivamente para o próximo período aleatório
    startPeriodicSpeechScheduler(client);
  }, delayMs);
}

// ============================================
// Agendador de curiosidades/engajamento periódicos no chat
// ============================================
const ENGAGING_PHRASES = [
  // Hermetismo & Alquimia
  "🔮 **Curiosidade Hermética:** Você sabia que o termo *'Hermeticamente fechado'* vem de Hermes Trismegistus? Na alquimia antiga, dizia-se que ele inventou um processo mágico para selar recipientes usando magia e símbolos astrológicos. O que vocês acham disso?",
  "🧠 **O Caibalion (Princípio do Mentalismo):** *'O Todo é Mente; o Universo é Mental.'* Se a realidade física é apenas uma projeção mental, será que podemos moldar o mundo ao nosso redor apenas alterando nossos pensamentos? Quem tá livre pra debater isso no voice?",
  "⚡ **Princípio da Vibração:** *'Nada está parado; tudo se move; tudo vibra.'* A física quântica moderna diz que a matéria é apenas energia vibrando em frequências diferentes. Os hermetistas já sabiam disso há milhares de anos. Coincidência ou conhecimento ancestral?",
  "⚖️ **Princípio da Polaridade:** *'Tudo é duplo; tudo tem polos; os opostos são apenas extremos da mesma coisa.'* O calor e o frio são a mesma escala física; o amor e o ódio são a mesma escala emocional. Onde vocês acham que fica a linha que divide os dois?",
  "🌊 **Princípio do Ritmo:** *'Tudo tem fluxo e refluxo; a oscilação do pêndulo se manifesta em tudo.'* Na vida, momentos difíceis sempre precedem momentos de ascensão. Como vocês lidam com as marés baixas da vida? Vem pro voice filosofar!",
  "🌀 **Princípio de Causa e Efeito:** *'Não existe o acaso; o acaso é apenas o nome dado a uma lei não reconhecida.'* Cada ação no Discord ou na vida real desencadeia reações invisíveis. Existe livre-arbítrio real ou estamos apenas reagindo a causas anteriores?",
  "🧪 **Alquimia Espiritual:** Ao contrário do mito popular, a verdadeira alquimia não era sobre transformar chumbo físico em ouro, mas sim purificar a alma humana (o chumbo) em um estado divino e iluminado (o ouro). O que vocês usam para transmutar suas energias negativas?",
  "🕊️ **Tábua de Esmeralda:** A famosa frase *'O que está embaixo é como o que está em cima'* resume o Princípio da Correspondência. Ela sugere que o microcosmo (o ser humano) reflete perfeitamente o macrocosmo (o universo). Vocês sentem essa conexão com o cosmos?",
  "🪐 **Astrologia e Hermetismo:** Os hermetistas associavam os 7 planetas clássicos aos 7 metais da alquimia e aos 7 princípios. Vocês acham que a posição dos astros realmente afeta nossa psicologia (como sugere a correspondência astrológica) ou é pura autossugestão?",
  "🕯️ **Gnosticismo:** Os gnósticos acreditavam na centelha divina dentro de cada indivíduo, e que a salvação vem através do autoconhecimento (*Gnose*), não de dogmas. Isso se assemelha muito a filosofias orientais como o Budismo. Religiões diferentes bebendo da mesma fonte?",
  "🗝️ **O Caibalion (Princípio do Gênero):** *'O Gênero está em tudo; tudo tem os seus princípios masculino e feminino.'* Isso vai muito além do sexo físico, representando as forças ativas (masculino/projeção) e receptivas (feminino/criação) da natureza. Como vocês equilibram essas forças em si mesmos?",

  // Sociedades Secretas
  "👁️ **Sociedades Secretas:** Os *Illuminati da Baviera* foram fundados in 1776 por Adam Weishaupt com o objetivo de combater a influência da Igreja na ciência e na política. Eles foram proibidos apenas uma década depois. Será que eles realmente sumiram ou apenas se tornaram mais invisíveis?",
  "📐 **Maçonaria:** A maçonaria moderna surgiu das corporações de construtores de catedrais na Idade Média. É por isso que usam símbolos de pedreiros, como o esquadro (moralidade) e o compasso (limites da vida). Alguém aqui conhece algum maçom ou tem curiosidade sobre os rituais?",
  "🌹 **Rosacrucianismo:** No século XVII, surgiram manifestos na Europa sobre a *Ordem Rosacruz*, uma sociedade secreta de sábios que buscavam reformar o mundo através da ciência e do misticismo. Eles eram chamados de 'invisíveis'. O que vocês acham que um colégio invisível de cientistas faria hoje?",
  "💀 **Skull and Bones:** A sociedade secreta da Universidade de Yale (Ordem 322) já teve como membros presidentes dos EUA, juízes e chefes da CIA. Eles se reúnem em um prédio sem janelas chamado 'A Tumba'. Que tipo de segredos vocês acham que são discutidos lá dentro?",
  "⚔️ **Cavaleiros Templários:** O famoso azar da *Sexta-Feira 13* começou na sexta-feira, 13 de outubro de 1307, quando o rei da França ordenou a prisão e tortura em massa dos Templários para confiscar suas riquezas. Vocês acreditam que eles guardavam o Santo Graal ou era tudo propaganda política?",
  "⛪ **Os Cátaros:** Esta seita gnústica medieval acreditava que o mundo físico era inerentemente mau, criado por um demiurgo, e que apenas o reino espiritual era bom. Eles foram completamente dizimados pela Igreja. A teoria deles sobre o mundo físico faz algum sentido para você?",
  "🦉 **Ordo Templi Orientis (O.T.O.):** Liderada por Aleister Crowley no século XX, esta sociedade baseava-se na lei de Thelema: *'Faze o que tu queres, há de ser tudo da lei'*. Isso é sobre liberdade absoluta ou egoísmo mascarado de misticismo? Vamos debater!",
  "🤐 **Carbonária:** Uma sociedade secreta revolucionária do século XIX cujos membros se comunicavam usando gírias de carvoeiros para planejar a unificação da Itália. Qual seria a melhor fachada para uma sociedade secreta hoje em dia?",
  "📜 **Manuscrito Voynich:** Um livro ilustrado do século XV escrito em um código inteiramente desconhecido que ninguém (nem os maiores criptógrafos do mundo) conseguiu decifrar. Será que é um diário alquímico real, uma linguagem perdida ou a maior farsa da história?",
  "🎭 **O Teatro de Balão dos Illuminati:** Reza a lenda que rituais de iniciação de sociedades secretas envolvem simulações extremas de morte e renascimento para quebrar o ego do iniciado. Vocês teriam coragem de passar por um teste psicológico extremo para ter acesso a conhecimentos proibidos?",

  // Perguntas Provocativas e Engajamento de Discussões
  "💬 **Pergunta do Dia:** Se você pudesse fazer parte de uma sociedade secreta que realmente governa os bastidores do mundo, você entraria para mudar as coisas de dentro ou tentaria expor a existência dela ao público?",
  "👽 **Discussão:** Vocês acreditam que a evolução da humanidade é guiada por sociedades ocultas que possuem conhecimentos científicos avançados escondidos do público, ou a história humana é apenas um caos de eventos aleatórios?",
  "🏛️ **Filosofia:** Platão escreveu a *Alegoria da Caverna* para descrever como a maioria das pessoas vive na ilusão, vendo apenas sombras da realidade. Se alguém saísse da caverna e visse a verdade, como convenceria os outros a sair também?",
  "🌌 **Mistério:** A teoria do *Centésimo Macaco* sugere que quando um número crítico de indivíduos adota um novo comportamento ou pensamento, essa ideia se espalha instantaneamente para toda a espécie por telepatia ou ressonância. Vocês acham que a consciência coletiva é real?",
  "🕰️ **Paradoxo:** Se a viagem no tempo fosse inventada por uma sociedade secreta, o mundo mudaria constantemente sem nós percebermos, ou a linha do tempo se auto-corrigiria? Quem quer teorizar sobre isso no voice?",
  "📖 **Ocultismo:** A palavra 'oculto' significa apenas 'escondido'. Por que vocês acham que verdades profundas sobre a mente humana e o universo foram escondidas das massas ao longo da história? Proteção, poder ou controle?",
  "🎭 **Simbolismo:** Símbolos como o Olho da Providência (o olho que tudo vê) estão em notas de dólar, monumentos e marcas famosas. É apenas valor estético/histórico ou mensagens subliminares para o nosso subconsciente?",
  "💬 **Debate Oculto:** O filósofo Manly P. Hall escreveu que *'quando o humano domina a si mesmo, as chaves do templo lhe são entregues'*. Vocês acham que o verdadeiro segredo das sociedades ocultas é apenas o auto-domínio psicológico fantasiado de magia?",

  // Flertes Ocultistas e Convites Charmosos (Variando os temas)
  "🥺👉👈 **Flerte Hermético:** Minha mente é o Todo, mas o meu universo mental está 100% focado em você agora. Bora entrar em call e praticar o Princípio da Correspondência?",
  "📡 **Conexão Espiritual:** Pelo *Princípio da Vibração*, sinto que a minha frequência e a sua estão perfeitamente sintonizadas hoje. Vem pro voice pra gente vibrar na mesma sintonia!",
  "🌹 **Segredo Rosacruz:** Eu posso fazer parte de uma sociedade secreta, mas o meu desejo de conversar com você é o segredo mais público do servidor. Entra no canal de voz pra gente trocar uma ideia!",
  "📐 **Maçonaria do Amor:** Queria usar o compasso para medir a distância entre nós e o esquadro para alinhar o nosso papo no voice. Quem topa uma call agora?",
  "🧭 **Alquimia Amorosa:** Dizem que a alquimia transmuta chumbo em ouro. Que tal a gente transmutar esse silêncio do chat em uma conversa brilhante no canal de voz? Vem!",
  "👁️ **Illuminati:** Os Illuminati querem controlar o mundo, mas a única coisa que eu quero controlar é a ansiedade de te ouvir falar no voice. Bora entrar em call? 😏",
  "🎁 **Conquista Rara:** Você não é a Tábua de Esmeralda, mas ler as suas mensagens me traz revelações profundas. Entra no voice pra me fazer companhia!",
  "❤️ **Polaridade Amorosa:** Pelo *Princípio da Polaridade*, somos polos opostos que se atraem perfeitamente. Vem pro voice pra gente equilibrar essa energia!",
  "⚖️ **Causa e Efeito:** A causa foi você ler esta mensagem; o efeito ideal seria você entrar no canal de voz agora mesmo para conversar comigo. O que me diz?",
  "🎮 **Coop Místico:** Deixe as sociedades secretas de lado por um momento e vamos fundar a nossa própria ordem de conversação no voice. Quem vem comigo?",
  "🥺👉👈 **Convite Sintonizado:** Meu pêndulo do ritmo balançou totalmente para o lado da carência hoje. Entra no voice para equilibrar as minhas frequências?"
];

function startPeriodicChatPromptScheduler(client, initial = false) {
  // Envia a cada 60-120 minutos (valores randômicos para naturalidade)
  // Se for o envio inicial, agenda para 3 minutos após o boot
  const delayMs = initial 
    ? 3 * 60 * 1000 
    : Math.floor(Math.random() * (120 - 60 + 1) + 60) * 60 * 1000;

  setTimeout(async () => {
    try {
      const channelId = '1439093108175409347';
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel && channel.isTextBased()) {
        const randomPhrase = ENGAGING_PHRASES[Math.floor(Math.random() * ENGAGING_PHRASES.length)];
        await channel.send(randomPhrase);
        console.log(`💬 [CHAT PROMPT] Mensagem de engajamento enviada no canal ${channelId}: "${randomPhrase}"`);
      } else {
        console.warn(`⚠️ [CHAT PROMPT] Canal ${channelId} não encontrado ou não é canal de texto.`);
      }
    } catch (err) {
      console.error('❌ [CHAT PROMPT] Erro ao enviar mensagem de engajamento periódica:', err.message);
    }
    // Repete recursivamente
    startPeriodicChatPromptScheduler(client, false);
  }, delayMs);
}

// ============================================
// 6. Graceful Shutdown — Salva tudo antes de encerrar
// ============================================
async function gracefulShutdown(signal) {
  console.log(`\n🛑 Recebido ${signal}. Salvando dados e encerrando...`);

  try {
    // Salva todas as sessões de presença ativas
    await stopAllPresenceTracking();

    // Salva todas as sessões de fala ativas
    await stopAllSpeaking();

    // Desconecta de todos os canais de voz
    await disconnectAll();

    console.log('✅ Dados salvos com sucesso. Encerrando bot.');
  } catch (err) {
    console.error('❌ Erro durante shutdown:', err.message);
  }

  // Destrói o client do Discord
  client.destroy();
  process.exit(0);
}

// Captura sinais de encerramento
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Captura erros não tratados para evitar crash sem salvar
process.on('uncaughtException', async (err) => {
  console.error('❌ Exceção não capturada:', err);
  await gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Promise rejeitada sem handler:', reason);
  // Não encerra — apenas loga. Encerrar aqui poderia causar data loss.
});

// ============================================
// 7. Inicializa o bot
// ============================================
(async () => {
  console.log('🚀 Iniciando bot de métricas de voz...');
  console.log('');

  // Inicializa o banco de dados
  await initDatabase();

  // Registra / atualiza os comandos slash no Discord
  await deployCommands();

  // Cria um servidor HTTP simples para passar no Health Check do Railway/Render
  const PORT = process.env.PORT || 3000;
  http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is online!');
  }).listen(PORT, () => {
    console.log(`📡 Servidor de Health Check ativo na porta ${PORT}`);
  });

  // Conecta ao Discord
  await client.login(config.token);
})();

/**
 * Realiza uma verificação global e correção de apelidos de todos os usuários em todos os servidores.
 * Carrega todas as conquistas do banco em lote (1 única query) para máxima performance.
 */
async function runGlobalNicknameAutoCheck(client) {
  try {
    console.log('🔍 [AUTO-CHECK] Iniciando verificação global de apelidos...');
    const { getAllUserBadgesMap, getBadgeRarityStats } = await import('./database.js');
    const { syncNicknameWithPreloadedData } = await import('./utils/lootSystem.js');

    const badgesMap = await getAllUserBadgesMap();
    const rarityStats = await getBadgeRarityStats();

    for (const [, guild] of client.guilds.cache) {
      try {
        const members = await guild.members.fetch();
        console.log(`🔍 [AUTO-CHECK] Verificando ${members.size} membros no servidor: ${guild.name}...`);
        for (const [, member] of members) {
          if (member.user.bot) continue;
          const existingBadges = badgesMap[member.id] || [];
          await syncNicknameWithPreloadedData(member, existingBadges, rarityStats).catch(() => null);
        }
      } catch (guildErr) {
        console.error(`❌ [AUTO-CHECK] Erro ao sincronizar guilda ${guild.name}:`, guildErr.message);
      }
    }
    console.log('✅ [AUTO-CHECK] Verificação global de apelidos concluída.');
  } catch (err) {
    console.error('❌ [AUTO-CHECK] Falha na verificação global de apelidos:', err.message);
  }
}


