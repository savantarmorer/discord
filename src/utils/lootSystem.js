// ============================================
// utils/lootSystem.js — Motor de Drops e Badges
// ============================================

import { awardBadge, getUserBadges, addSpeakingTime, updateDatabaseUsername, getBadgeRarityStats } from '../database.js';
import { getSessionSpeakingTime, checkAndMarkSessionThreshold } from '../voiceTracker.js';
import { addLog } from './debugLogger.js';
import { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getShowBadgesSetting, getUserSelectedBadges } from './userSettings.js';

// Cache em memória para garantir que não haja drops repetidos mesmo com delay/erro no Supabase
const pendingAwards = new Set(); // Formato: 'userId:badgeName'

// Apelidos trolls ativos da loja e sinalização de atualização pelo bot
export const activeTrollNicknames = new Map(); // userId -> { nickname: string, expiresAt: number, oldNickname: string }
export const botUpdatingNicks = new Set(); // userId

/**
 * Corta uma string mantendo-se estritamente abaixo do limite maxLength de code units (JS length),
 * sem cortar surrogate pairs no meio.
 * @param {string} str
 * @param {number} maxLength
 * @returns {string}
 */
export function sliceSafe(str, maxLength) {
  if (str.length <= maxLength) return str;
  let sliced = str.substring(0, maxLength);
  const lastCharCode = sliced.charCodeAt(sliced.length - 1);
  if (lastCharCode >= 0xD800 && lastCharCode <= 0xDBFF) {
    sliced = sliced.substring(0, sliced.length - 1);
  }
  return sliced;
}

/**
 * Tabela de Drops Dinâmicos (Loot).
 * 'chance' é o percentual base de chance por tentativa (0 a 1).
 * 'condition' avalia se o usuário está elegível naquele momento.
 * 'evolutions' define os estágios de evolução quando o usuário acumula conquistas do mesmo tipo.
 */
export const LOOT_TABLE = [
  {
    id: 'coruja',
    icon: '🦉',
    name: 'Coruja da Madrugada',
    tag: '🦉',
    chance: 0.25, // 25% de chance ao falar de madrugada
    condition: () => {
      const hora = new Date().getHours();
      return hora >= 2 && hora <= 5; // Entre 2 AM e 5 AM
    },
    evolutions: [
      { threshold: 5, icon: '🔮', name: 'Coruja Arcana', tag: '🔮' },
      { threshold: 20, icon: '🌌', name: 'Guardião Cósmico', tag: '🌌' }
    ]
  },
  {
    id: 'onfire',
    icon: '🔥',
    name: 'Máquina de Falar',
    tag: '🔥',
    chance: 1.0, // 100% de chance (garantido ao cruzar o limite)
    condition: (speakDurationSeconds, userId) => {
      const sessionSpeakingTime = getSessionSpeakingTime(userId);
      if (sessionSpeakingTime >= 300) {
        return checkAndMarkSessionThreshold(userId, 'onfire');
      }
      return false;
    },
    evolutions: [
      { threshold: 5, icon: '💣', name: 'Voz Explosiva', tag: '💣' },
      { threshold: 20, icon: '☢️', name: 'Radiação Vocal', tag: '☢️' }
    ]
  },
  {
    id: 'tagarela',
    icon: '🗣️',
    name: 'Tagarela Inveterado',
    tag: '🗣️',
    chance: 1.0, // 100% de chance (garantido ao cruzar o limite)
    condition: (speakDurationSeconds, userId) => {
      const sessionSpeakingTime = getSessionSpeakingTime(userId);
      if (sessionSpeakingTime >= 120) {
        return checkAndMarkSessionThreshold(userId, 'tagarela');
      }
      return false;
    },
    evolutions: [
      { threshold: 5, icon: '📢', name: 'Voz Sônica', tag: '📢' },
      { threshold: 20, icon: '☣️', name: 'Voz Biológica', tag: '☣️' }
    ]
  },
  {
    id: 'sortudo',
    icon: '🎲',
    name: 'Sortudo do Microfone',
    tag: '🎲',
    chance: 0.005, // 0.5% de chance (muito raro)
    condition: () => true, // Pode dropar a qualquer momento que a pessoa pare de falar
    evolutions: [
      { threshold: 5, icon: '🃏', name: 'Mestre das Cartas', tag: '🃏' },
      { threshold: 20, icon: '🎰', name: 'Jackpot Lendário', tag: '🎰' }
    ]
  },
  {
    id: 'fantasma',
    icon: '👻',
    name: 'Fantasma Tagarela',
    tag: '👻',
    chance: 0.20, // 20% de chance de madrugada
    condition: (speakDurationSeconds) => {
      const hora = new Date().getHours();
      return hora === 0; // Dropa à Meia-noite (hora das bruxas)
    },
    evolutions: [
      { threshold: 5, icon: '💀', name: 'Espectro de Fogo', tag: '💀' },
      { threshold: 20, icon: '👹', name: 'Ceifador de Almas', tag: '👹' }
    ]
  },
  {
    id: 'cafe',
    icon: '☕',
    name: 'Bom Dia, Vietnam!',
    tag: '☕',
    chance: 0.25, // 25% de chance
    condition: () => {
      const hora = new Date().getHours();
      return hora >= 6 && hora <= 9; // Drop matinal
    },
    evolutions: [
      { threshold: 5, icon: '🥐', name: 'Desjejum do Guerreiro', tag: '🥐' },
      { threshold: 20, icon: '☀️', name: 'Soberano da Manhã', tag: '☀️' }
    ]
  },
  {
    id: 'orador',
    icon: '🎙️',
    name: 'O Grande Orador',
    tag: '🎙️',
    chance: 1.0, // 100% de chance (garantido ao cruzar o limite)
    condition: (speakDurationSeconds, userId) => {
      const sessionSpeakingTime = getSessionSpeakingTime(userId);
      if (sessionSpeakingTime >= 600) {
        return checkAndMarkSessionThreshold(userId, 'orador');
      }
      return false;
    },
    evolutions: [
      { threshold: 5, icon: '🔞', name: 'Orador Proibido', tag: '🔞' },
      { threshold: 20, icon: '🏛️', name: 'Lorde do Senado', tag: '🏛️' }
    ]
  },
  {
    id: 'velocista',
    icon: '⚡',
    name: 'Velocista Vocal',
    tag: '⚡',
    chance: 0.20, // 20% de chance
    condition: (speakDurationSeconds) => {
      return speakDurationSeconds >= 5 && speakDurationSeconds <= 8; // Falas muito rápidas, mas válidas
    },
    evolutions: [
      { threshold: 5, icon: '🩻', name: 'Velocidade Raio-X', tag: '🩻' },
      { threshold: 20, icon: '🛸', name: 'Velocidade da Luz', tag: '🛸' }
    ]
  },
  {
    id: 'sabado',
    icon: '🍻',
    name: 'Inimigo do Fim',
    tag: '🍻',
    chance: 0.25, // 25% de chance
    condition: () => {
      const day = new Date().getDay();
      const hour = new Date().getHours();
      // Dropa sexta à noite ou sábado à noite (após 22h)
      return (day === 5 || day === 6) && (hour >= 22 || hour <= 3);
    },
    evolutions: [
      { threshold: 5, icon: '🥂', name: 'Celebrante de Elite', tag: '🥂' },
      { threshold: 20, icon: '🍾', name: 'Lorde da Taberna', tag: '🍾' }
    ]
  },
  {
    id: 'maratonista',
    icon: '🏃‍♂️',
    name: 'Maratonista de Call',
    tag: '🏃‍♂️',
    type: 'presence',
    repeatable: true, // Pode ser dado várias vezes na mesma sessão
    repeatCooldownMs: 60 * 60 * 1000, // Mínimo 1 hora entre repetições
    chance: 1.0,
    condition: (presenceSeconds) => {
      return presenceSeconds >= 3600; // Conectado por mais de 1 hora
    },
    evolutions: [
      { threshold: 5, icon: '🚴', name: 'Ciclista de Call', tag: '🚴' },
      { threshold: 20, icon: '🏎️', name: 'Fórmula 1 de Call', tag: '🏎️' }
    ]
  },
  {
    id: 'ouvinte',
    icon: '🎧',
    name: 'Ouvinte Atento',
    tag: '🎧',
    type: 'presence',
    repeatable: true, // Pode ser dado várias vezes na mesma sessão (a cada flush)
    repeatCooldownMs: 30 * 60 * 1000, // Mínimo 30 minutos entre repetições
    chance: 1.0,
    condition: (presenceSeconds, userId, speakingSeconds) => {
      return presenceSeconds >= 1800 && speakingSeconds < 60; // 30 min em call com menos de 60s de fala
    },
    evolutions: [
      { threshold: 5, icon: '📡', name: 'Antena Humana', tag: '📡' },
      { threshold: 20, icon: '🛰️', name: 'Satélite Espião', tag: '🛰️' }
    ]
  },
  {
    id: 'silencio',
    icon: '📵',
    name: 'Lorde do Silêncio',
    tag: '📵',
    type: 'presence',
    repeatable: true, // Pode ser dado várias vezes na mesma sessão (a cada flush)
    repeatCooldownMs: 10 * 60 * 1000, // Mínimo 10 minutos entre repetições
    chance: 1.0,
    condition: (presenceSeconds, userId, speakingSeconds) => {
      return presenceSeconds >= 600 && speakingSeconds < 15; // 10 minutos em call com menos de 15s de fala
    },
    evolutions: [
      { threshold: 5, icon: '🚭', name: 'Silêncio Sem Fumo', tag: '🚭' },
      { threshold: 20, icon: '🤫', name: 'Silêncio Absoluto', tag: '🤫' }
    ]
  },
  {
    id: 'astrocram',
    icon: '🎥',
    name: 'Astro da Câmera',
    tag: '🎥',
    type: 'presence',
    chance: 1.0, // 100% de chance (garantido)
    condition: (presenceSeconds, userId, speakingSeconds, cameraSeconds) => {
      return cameraSeconds >= 1800; // 30 minutos de câmera ligada
    },
    evolutions: [
      { threshold: 5, icon: '🎬', name: 'Cineasta de Call', tag: '🎬' },
      { threshold: 20, icon: '🌟', name: 'Estrela de Hollywood', tag: '🌟' }
    ]
  },
  {
    id: 'maratonistacam',
    icon: '📷',
    name: 'Maratonista de Webcam',
    tag: '📷',
    type: 'presence',
    chance: 1.0,
    condition: (presenceSeconds, userId, speakingSeconds, cameraSeconds) => {
      return cameraSeconds >= 3600; // 1 hora de câmera ligada
    },
    evolutions: [
      { threshold: 5, icon: '👁️', name: 'Vigilante Visual', tag: '👁️' },
      { threshold: 20, icon: '🛸', name: 'Streamer Interestelar', tag: '🛸' }
    ]
  },

  // ── NOVAS CONQUISTAS ──────────────────────────────────────────

  {
    // Fala muito longa de uma vez só (discurso interminável)
    id: 'discurseiro',
    icon: '🧏',
    name: 'Discurseiro Incansável',
    tag: '🧏',
    chance: 1.0,
    condition: (speakDurationSeconds) => {
      return speakDurationSeconds >= 120; // Falou por 2 minutos sem parar
    },
    evolutions: [
      { threshold: 5, icon: '📎', name: 'Anexador de Ouvidos', tag: '📎' },
      { threshold: 20, icon: '🗽', name: 'Lorde do Palanque', tag: '🗽' }
    ]
  },
  {
    // Fala no almoço (12h-14h)
    id: 'almoco',
    icon: '🍽️',
    name: 'Call no Almoço',
    tag: '🍽️',
    chance: 0.30,
    condition: () => {
      const hora = new Date().getHours();
      return hora >= 12 && hora <= 14;
    },
    evolutions: [
      { threshold: 5, icon: '🥩', name: 'Chef da Call', tag: '🥩' },
      { threshold: 20, icon: '👨‍🍳', name: 'Gordon Ramsay da Voz', tag: '👨‍🍳' }
    ]
  },
  {
    // Fala na hora da tarde preguiçosa (14h-16h)
    id: 'sesta',
    icon: '😴',
    name: 'Resistente à Sesta',
    tag: '😴',
    chance: 0.25,
    condition: () => {
      const hora = new Date().getHours();
      return hora >= 14 && hora <= 16;
    },
    evolutions: [
      { threshold: 5, icon: '🛋️', name: 'Dono do Sofá', tag: '🛋️' },
      { threshold: 20, icon: '🦥', name: 'Preguiça Élite', tag: '🦥' }
    ]
  },
  {
    // Fala na segunda-feira (o dia mais temido)
    id: 'segunda',
    icon: '😤',
    name: 'Sobrevivente da Segunda',
    tag: '😤',
    chance: 0.35,
    condition: () => {
      return new Date().getDay() === 1; // Segunda-feira
    },
    evolutions: [
      { threshold: 5, icon: '⚔️', name: 'Guerreiro da Segunda', tag: '⚔️' },
      { threshold: 20, icon: '🏆', name: 'Imortal da Semana', tag: '🏆' }
    ]
  },
  {
    // Fala no domingo à noite (aquele terror existencial)
    id: 'domingo',
    icon: '😰',
    name: 'Ansiedade do Domingo',
    tag: '😰',
    chance: 0.30,
    condition: () => {
      const day = new Date().getDay();
      const hora = new Date().getHours();
      return day === 0 && hora >= 19; // Domingo depois das 19h
    },
    evolutions: [
      { threshold: 5, icon: '🌧️', name: 'Profeta da Chuva', tag: '🌧️' },
      { threshold: 20, icon: '🌀', name: 'Senhor do Caos Semanal', tag: '🌀' }
    ]
  },
  {
    // Falou muito rápido várias vezes seguidas (fala explosiva)
    id: 'metralhadora',
    icon: '🔫',
    name: 'Metralhadora Verbal',
    tag: '🔫',
    chance: 0.15,
    condition: (speakDurationSeconds) => {
      return speakDurationSeconds >= 5 && speakDurationSeconds <= 12; // Rajadas curtas
    },
    evolutions: [
      { threshold: 10, icon: '💣', name: 'Grenadeiro de Palavras', tag: '💣' },
      { threshold: 30, icon: '🚀', name: 'Míssil Hipersônico', tag: '🚀' }
    ]
  },
  {
    // Falou entre 30 e 60 segundos (papo equilibrado)
    id: 'equilibrista',
    icon: '🎯',
    name: 'Equilibrista Vocal',
    tag: '🎯',
    chance: 0.12,
    condition: (speakDurationSeconds) => {
      return speakDurationSeconds >= 30 && speakDurationSeconds <= 60;
    },
    evolutions: [
      { threshold: 5, icon: '⚖️', name: 'Mestre do Timing', tag: '⚖️' },
      { threshold: 20, icon: '🧬', name: 'Arquiteto da Conversa', tag: '🧬' }
    ]
  },
  {
    // Entra em call depois das 23h (gosta de call noturna)
    id: 'noturno',
    icon: '🌙',
    name: 'Habitué da Noite',
    tag: '🌙',
    type: 'presence',
    repeatable: true,
    repeatCooldownMs: 60 * 60 * 1000, // 1 hora entre drops
    chance: 1.0,
    condition: (presenceSeconds) => {
      const hora = new Date().getHours();
      return (hora >= 23 || hora <= 1) && presenceSeconds >= 600; // 10+ min em call após 23h
    },
    evolutions: [
      { threshold: 5, icon: '🦇', name: 'Morcego da Voz', tag: '🦇' },
      { threshold: 20, icon: '🧛', name: 'Vampiro do Discord', tag: '🧛' }
    ]
  },
  {
    // Ficou em call mais de 2h com câmera ligada
    id: 'streamer',
    icon: '🎮',
    name: 'Streamer Honorário',
    tag: '🎮',
    type: 'presence',
    repeatable: true,
    repeatCooldownMs: 2 * 60 * 60 * 1000, // 2 horas entre drops
    chance: 1.0,
    condition: (presenceSeconds, userId, speakingSeconds, cameraSeconds) => {
      return presenceSeconds >= 7200 && cameraSeconds >= 3600; // 2h em call + 1h de câmera
    },
    evolutions: [
      { threshold: 5, icon: '📺', name: 'Apresentador Honorário', tag: '📺' },
      { threshold: 20, icon: '🌐', name: 'Influencer do Discord', tag: '🌐' }
    ]
  },
  {
    // Fala em horário de expediente (9h-18h num dia útil)
    id: 'workaholic',
    icon: '💼',
    name: 'Workaholic do Discord',
    tag: '💼',
    chance: 0.20,
    condition: () => {
      const day = new Date().getDay();
      const hora = new Date().getHours();
      const diaUtil = day >= 1 && day <= 5;
      return diaUtil && hora >= 9 && hora <= 18;
    },
    evolutions: [
      { threshold: 5, icon: '🖥️', name: 'Home Office Supremo', tag: '🖥️' },
      { threshold: 20, icon: '🏢', name: 'CEO do Caos', tag: '🏢' }
    ]
  }
];

/**
 * Retorna os dados do nível atual da conquista com base no número de acumulações.
 * @param {Object} loot - Objeto da conquista original da LOOT_TABLE
 * @param {number} timesEarned - Quantidade de vezes que a conquista foi obtida
 * @returns {Object} Dados atualizados { icon, name, tag }
 */
export function getCurrentBadgeInfo(loot, timesEarned) {
  let activeIcon = loot.icon;
  let activeName = loot.name;
  let activeTag = loot.tag;

  if (loot.evolutions && loot.evolutions.length > 0) {
    const sortedEvolutions = [...loot.evolutions].sort((a, b) => b.threshold - a.threshold);
    const activeEvolution = sortedEvolutions.find(ev => timesEarned >= ev.threshold);
    if (activeEvolution) {
      activeIcon = activeEvolution.icon;
      activeName = activeEvolution.name;
      activeTag = activeEvolution.tag;
    }
  }

  return { icon: activeIcon, name: activeName, tag: activeTag };
}

/**
 * Tenta dropar um loot para o usuário baseado na sorte e condições.
 * @param {import('discord.js').Client} client 
 * @param {string} guildId 
 * @param {string} channelId 
 * @param {string} userId 
 * @param {string} username 
 * @param {number} speakDurationSeconds 
 */
export async function evaluateLootDrop(client, guildId, channelId, userId, username, speakDurationSeconds) {
  // Ignorar falas muito curtas (menos de 5 segundos) para não spammar rolagens
  if (speakDurationSeconds < 5) return;

  // Busca as conquistas obtidas no atual canal de voz (thresholds da sessão)
  const { getSessionThresholds } = await import('../voiceTracker.js');
  const thresholdsChecked = getSessionThresholds(userId);

  // Busca conquistas atuais para não dar o mesmo loot duplicado (opcional, mas recomendado)
  const existingBadges = await getUserBadges(userId);
  const earnedBadgeIds = existingBadges.map(b => b.badge_name); // Vamos checar pelo nome

  // Avaliar loots elegíveis
  const eligibleLoots = LOOT_TABLE.filter(loot => 
    loot.type !== 'presence' && // Ignora conquistas de presença ao falar
    !(thresholdsChecked && thresholdsChecked.has(loot.id)) && // Bloqueado pelo thresholdsChecked da sessão
    loot.condition(speakDurationSeconds, userId) && 
    !pendingAwards.has(`${userId}:${loot.name}`) // Bloqueio imediato no cache
  );

  if (eligibleLoots.length === 0) return; // Não há loots possíveis

  addLog('Loot', `Avaliando ${eligibleLoots.length} conquistas de fala para ${username} (fala de ${speakDurationSeconds.toFixed(1)}s)...`);

  // Rolagem de dados (RNG)
  for (const loot of eligibleLoots) {
    const roll = Math.random(); // Gera número entre 0 e 1
    
    // Se a rolagem for menor ou igual à chance (ex: 0.04 <= 0.05) -> VENCEU!
    if (roll <= loot.chance) {

      const isDuplicate = earnedBadgeIds.includes(loot.name);
      const timesEarned = existingBadges.filter(b => b.badge_name === loot.name).length + 1;

      addLog('Loot', `🎁 GANHOU! ${username} dropou conquista "${loot.name}" (Tier ${timesEarned})`);
      console.log(`🎁 [LOOT DROP] ${username} ${isDuplicate ? 'evoluiu' : 'ganhou'} a conquista: ${loot.name} (Nível ${timesEarned})`);
      
      // Trava no cache local IMEDIATAMENTE e solta depois de 60s (dupla proteção)
      const cacheKey = `${userId}:${loot.name}`;
      pendingAwards.add(cacheKey);
      setTimeout(() => pendingAwards.delete(cacheKey), 60000);

      // Marca o threshold para não ganhar de novo na mesma sessão de voz
      if (thresholdsChecked) {
        thresholdsChecked.add(loot.id);
      }

      // Salva no banco de dados
      await awardBadge(userId, username, loot.icon, loot.name, loot.tag);

      // Concede 1000 XP bônus (334 segundos de fala real * 3) se for repetido
      if (isDuplicate) {
        await addSpeakingTime(userId, username, 334);
      }

      // Silenciosamente sincroniza o nickname (se ativado pelo usuário)
      await announceLootDrop(client, guildId, channelId, userId, loot, isDuplicate, timesEarned);
      
      // Garante que só ganhe 1 loot por avaliação
      break; 
    }
  }
}

/**
 * Sincroniza o nickname do usuário após um drop de conquista de forma silenciosa (sem notificar no chat).
 */
async function announceLootDrop(client, guildId, channelId, userId, loot, isDuplicate = false, timesEarned = 1) {
  try {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;

    // Buscar o membro para mudar o apelido
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) {
      await syncMemberNicknameBadges(member).catch(() => null);
    }
  } catch (error) {
    console.error('❌ Erro ao processar sincronização após loot:', error.message);
  }
}

/**
 * Calcula o novo nickname limpo com emojis de conquistas e contador [+x] atualizado.
 * @param {import('discord.js').GuildMember} member 
 * @param {Array} existingBadges 
 * @param {Object} rarityStats 
 * @returns {Object} { newName, currentName, cleanName }
 */
export function computeNewNickname(member, existingBadges, rarityStats) {
  const currentName = member.displayName || member.user?.username || '';
  const userId = member.id;
  
  // 1. Remove qualquer padrão de excedente [+x] ou [+ x] existente no apelido
  let cleanName = currentName.replace(/\[\+\s*\d+\]/g, '');
  
  // Failsafe contra cortes de sufixo no limite de 32 chars: remove [+x ou [+ inacabado no final
  cleanName = cleanName.replace(/\[\+\s*\d*$/g, '');
  
  // 2. Remove colchetes vazios [] ou colchetes extras que possam ter sobrado
  cleanName = cleanName.replace(/\[\s*\]/g, '');
  
  // 3. Remove apenas os emojis que são conquistas ou evoluções do bot (preserva emojis pessoais)
  const badgeIcons = new Set();
  for (const loot of LOOT_TABLE) {
    badgeIcons.add(loot.icon);
    if (loot.evolutions) {
      for (const evo of loot.evolutions) {
        badgeIcons.add(evo.icon);
      }
    }
  }
  for (const icon of badgeIcons) {
    cleanName = cleanName.replaceAll(icon, '');
  }
  
  // 4. Remove múltiplos espaços extras deixados pela remoção
  cleanName = cleanName.replace(/\s+/g, ' ').trim();
  
  // Failsafe: se o nome ficou completamente vazio (ex: apelido era só emojis), usa o username original
  if (!cleanName) {
    cleanName = member.user?.username || 'User';
  }

  // O sufixo [+x] (total de conquistas) aparece sempre que o usuário tiver
  // pelo menos uma. Os EMOJIS de conquista são opt-in — só entram se o
  // usuário tiver ativado em /level (padrão do servidor: só o [+x]).
  const totalBadgeLevel = existingBadges ? existingBadges.length : 0;
  let tagsToDisplay = [];

  if (getShowBadgesSetting(userId)) {
    // Conta conquistas por nome base
    const badgeCounts = {};
    if (existingBadges && existingBadges.length > 0) {
      existingBadges.forEach(b => {
        badgeCounts[b.badge_name] = (badgeCounts[b.badge_name] || 0) + 1;
      });
    }

    // Coleciona as conquistas ativas do usuário e suas tags
    const activeBadgesList = [];
    for (const loot of LOOT_TABLE) {
      const count = badgeCounts[loot.name] || 0;
      if (count > 0) {
        const badgeInfo = getCurrentBadgeInfo(loot, count);
        activeBadgesList.push({
          name: loot.name,
          tag: badgeInfo.tag
        });
      }
    }

    // Ordena do mais raro para o mais comum (menor contagem global no banco = mais raro)
    activeBadgesList.sort((a, b) => {
      const countA = rarityStats[a.name] !== undefined ? rarityStats[a.name] : Infinity;
      const countB = rarityStats[b.name] !== undefined ? rarityStats[b.name] : Infinity;
      return countA - countB;
    });

    // Pega as selecionadas pelo usuário ou, se não houver, os 3 mais raros
    const userSelected = getUserSelectedBadges(userId);
    let displayBadges = [];
    if (userSelected && userSelected.length > 0) {
      for (const name of userSelected) {
        const found = activeBadgesList.find(b => b.name === name);
        if (found) {
          displayBadges.push(found);
        }
      }
    } else {
      displayBadges = activeBadgesList.slice(0, 3);
    }

    tagsToDisplay = displayBadges.map(b => b.tag);
  }

  const suffixParts = [...tagsToDisplay];
  if (totalBadgeLevel > 0) {
    suffixParts.push(`[+${totalBadgeLevel}]`);
  }
  const tagSuffix = suffixParts.join(' ');

  // Junta o sufixo ao final do nome limpo usando sliceSafe para evitar ultrapassar 32 chars
  let newName;
  if (tagSuffix.length > 0) {
    const suffix = ` ${tagSuffix}`;
    const maxCleanLength = 32 - suffix.length;
    cleanName = sliceSafe(cleanName, maxCleanLength).trim();
    newName = `${cleanName}${suffix}`;
  } else {
    newName = sliceSafe(cleanName, 32).trim();
  }

  return { newName, currentName, cleanName };
}

/**
 * Verifica as conquistas do usuário no banco de dados e sincroniza o nickname
 * garantindo que possua os ícones corretos de evolução de todas as conquistas obtidas.
 * Se force for true, atualiza incondicionalmente no banco de dados e tenta atualizar
 * no Discord mesmo se manageable for falso, capturando erros.
 * @param {import('discord.js').GuildMember} member 
 * @param {boolean} force 
 */
export async function syncMemberNicknameBadges(member, force = false) {
  if (!member) return;

  const username = member.user?.username || member.id;
  const userId = member.id;

  // Se o usuário está sob efeito de um apelido troll ativo da loja, ignora sincronização
  const trollActive = activeTrollNicknames.get(userId);
  if (trollActive) {
    if (Date.now() < trollActive.expiresAt) {
      console.log(`ℹ️ [SYNC NICKNAME] Ignorando sincronização para ${username} devido a apelido troll ativo ("${trollActive.nickname}").`);
      return;
    } else {
      activeTrollNicknames.delete(userId); // Limpa se expirado
    }
  }

  try {
    const existingBadges = await getUserBadges(userId);
    const rarityStats = await getBadgeRarityStats(force);

    const { newName, currentName, cleanName } = computeNewNickname(member, existingBadges, rarityStats);

    // Se for modo force, atualiza o nome limpo no banco incondicionalmente
    if (force) {
      await updateDatabaseUsername(userId, cleanName);
    } else {
      // Checa se o username atual é diferente do cadastrado no banco para atualizar
      let dbUsername = null;
      if (existingBadges && existingBadges.length > 0) {
        dbUsername = existingBadges[0].username;
      }

      if (dbUsername && dbUsername !== cleanName) {
        await updateDatabaseUsername(userId, cleanName);
      }
    }

    // Se o apelido for diferente ou se for uma atualização forçada
    if (newName !== currentName || force) {
      if (member.manageable || force) {
        try {
          botUpdatingNicks.add(userId);
          await member.setNickname(newName, force ? 'Sincronização forçada de apelido' : 'Sincronização automática de apelido com conquistas do banco');
          console.log(`🔄 [SYNC NICKNAME] Nickname de ${username} sincronizado para: ${newName}`);
          // Atualiza o banco de dados para refletir o novo apelido com as tags
          await updateDatabaseUsername(userId, newName);
        } catch (err) {
          console.warn(`⚠️ [SYNC NICKNAME] Não foi possível alterar apelido de ${username} no Discord (Sem permissão/Hierarquia):`, err.message);
          // Mesmo se falhar no Discord, garante que o banco de dados esteja com o nome limpo atualizado
          await updateDatabaseUsername(userId, cleanName);
        } finally {
          setTimeout(() => botUpdatingNicks.delete(userId), 3000);
        }
      } else {
        console.log(`ℹ️ [SYNC NICKNAME] Ignorando alteração no Discord para ${username} pois não é gerenciável (dono do servidor ou cargo superior).`);
      }
    }
  } catch (err) {
    console.error(`❌ Erro ao sincronizar nickname de ${username}:`, err.message);
  }
}

/**
 * Sincroniza o nickname de um usuário utilizando conquistas e dados de raridade pré-carregados.
 * Otimizado para execuções globais em lote.
 */
export async function syncNicknameWithPreloadedData(member, existingBadges, rarityStats) {
  if (!member) return;

  const username = member.user?.username || member.id;
  const userId = member.id;

  // Se o usuário está sob efeito de um apelido troll ativo da loja, ignora sincronização
  const trollActive = activeTrollNicknames.get(userId);
  if (trollActive) {
    if (Date.now() < trollActive.expiresAt) return;
    else activeTrollNicknames.delete(userId);
  }

  try {
    const { newName, currentName, cleanName } = computeNewNickname(member, existingBadges, rarityStats);

    let dbUsername = null;
    if (existingBadges && existingBadges.length > 0) {
      dbUsername = existingBadges[0].username;
    }

    if (dbUsername && dbUsername !== cleanName) {
      await updateDatabaseUsername(userId, cleanName);
    }

    if (!member.manageable) return;

    if (newName !== currentName) {
      await member.setNickname(newName, 'Sincronização global periódica de apelido');
      console.log(`🔄 [BATCH SYNC] Nickname de ${username} corrigido automaticamente para: ${newName}`);
      await updateDatabaseUsername(userId, newName);
    }
  } catch (err) {
    console.error(`❌ Erro no lote de sincronização de apelido para ${username}:`, err.message);
  }
}

/**
 * Tenta dropar um loot de presença para o usuário baseado na duração da chamada.
 * Executada periodicamente ou quando o usuário sai do canal de voz.
 */
export async function evaluatePresenceLootDrop(client, guildId, channelId, userId, username, presenceSeconds, speakingSeconds, cameraSeconds = 0, thresholdsChecked = null) {
  addLog('Loot', `🔍 Avaliando presença para ${username} (Presença: ${Math.floor(presenceSeconds)}s | Fala: ${Math.floor(speakingSeconds)}s | Câmera: ${Math.floor(cameraSeconds)}s)`);

  // Ignora chamadas muito curtas (menos de 60 segundos)
  if (presenceSeconds < 60) return;

  const existingBadges = await getUserBadges(userId);
  const earnedBadgeIds = existingBadges.map(b => b.badge_name);

  // Filtra as conquistas elegíveis do tipo presence
  const eligibleLoots = LOOT_TABLE.filter(loot => {
    if (loot.type !== 'presence') return false;
    if (!loot.condition(presenceSeconds, userId, speakingSeconds, cameraSeconds)) return false;

    // Conquistas repetíveis usam pendingAwards com TTL personalizado (não bloqueiam a sessão toda)
    if (loot.repeatable) {
      return !pendingAwards.has(`${userId}:${loot.name}`);
    }

    // Conquistas não-repetíveis: bloqueadas pelo thresholdsChecked da sessão E pelo pendingAwards
    if (thresholdsChecked && thresholdsChecked.has(loot.id)) return false;
    return !pendingAwards.has(`${userId}:${loot.name}`);
  });

  if (eligibleLoots.length === 0) return;

  addLog('Loot', `Avaliando ${eligibleLoots.length} conquistas de presença para ${username} (presença: ${Math.floor(presenceSeconds)}s, fala: ${Math.floor(speakingSeconds)}s)...`);

  for (const loot of eligibleLoots) {
    const roll = Math.random();
    if (roll <= loot.chance) {
      const isDuplicate = earnedBadgeIds.includes(loot.name);
      const timesEarned = existingBadges.filter(b => b.badge_name === loot.name).length + 1;

      addLog('Loot', `🎁 GANHOU! ${username} dropou conquista de presença "${loot.name}" (Tier ${timesEarned})`);
      console.log(`🎁 [PRESENCE LOOT DROP] ${username} ${isDuplicate ? 'evoluiu' : 'ganhou'} a conquista: ${loot.name} (Nível ${timesEarned})`);

      // Trava no cache — conquistas repetíveis usam TTL próprio, não-repetíveis usam 60s
      const cacheKey = `${userId}:${loot.name}`;
      pendingAwards.add(cacheKey);
      const ttl = loot.repeatable ? (loot.repeatCooldownMs ?? 600000) : 60000;
      setTimeout(() => pendingAwards.delete(cacheKey), ttl);

      // Conquistas não-repetíveis marcam o thresholdsChecked da sessão para nunca repetir
      if (!loot.repeatable && thresholdsChecked) {
        thresholdsChecked.add(loot.id);
      }

      // Salva no banco de dados
      await awardBadge(userId, username, loot.icon, loot.name, loot.tag);

      // Bônus de 1000 XP por evolução
      if (isDuplicate) {
        await addSpeakingTime(userId, username, 334);
      }

      // Sincroniza apelido silenciosamente
      await announceLootDrop(client, guildId, channelId, userId, loot, isDuplicate, timesEarned);
      
      // Limita a no máximo 1 drop de presença por ciclo
      break;
    }
  }
}
