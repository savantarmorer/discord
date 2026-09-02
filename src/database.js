// ============================================
// database.js — Camada de acesso ao Supabase
// ============================================
import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import fs from 'fs';
import path from 'path';

// Inicializa o cliente Supabase
const supabase = createClient(config.supabaseUrl, config.supabaseKey);

/**
 * Remove qualquer tag de conquista [+x] e emojis do nome do usuário.
 * @param {string} name - Nome original
 * @returns {string} Nome limpo
 */
function cleanUsername(name) {
  if (!name) return '';
  return name
    .replace(/\[\+\s*\d+\]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Inicializa o banco de dados.
 * Verifica se a tabela voice_metrics existe tentando uma query de teste.
 * A tabela deve ser criada previamente no painel do Supabase (veja README).
 */
export async function initDatabase() {
  try {
    const { data, error } = await supabase
      .from('voice_metrics')
      .select('user_id')
      .limit(1);

    if (error) {
      console.error('❌ Erro ao conectar com Supabase:', error.message);
      console.error('   Verifique se a tabela "voice_metrics" foi criada no Supabase.');
      console.error('   Execute o SQL fornecido no README para criar a tabela.');
      process.exit(1);
    }

    console.log('✅ Conexão com Supabase estabelecida com sucesso.');
    return true;
  } catch (err) {
    console.error('❌ Falha crítica ao conectar com Supabase:', err.message);
    process.exit(1);
  }
}

/**
 * Busca ou cria um registro de métricas para o usuário.
 * Usa upsert para garantir atomicidade.
 * @param {string} userId - ID do usuário Discord
 * @param {string} username - Nome de exibição do usuário
 * @returns {Object} Registro do usuário
 */
export async function getOrCreateUser(userId, username) {
  const cleaned = cleanUsername(username) || userId;
  // Primeiro tenta buscar o usuário existente
  const { data: existing, error: fetchError } = await supabase
    .from('voice_metrics')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (existing) {
    // Se o username mudou, atualiza no banco (sempre limpando tags/emojis)
    if (existing.username !== cleaned) {
      await supabase
        .from('voice_metrics')
        .update({ username: cleaned })
        .eq('user_id', userId);
      existing.username = cleaned;
    }
    return existing;
  }

  // Se não existe, cria com valores padrão (sempre limpando tags/emojis)
  const { data, error } = await supabase
    .from('voice_metrics')
    .upsert({
      user_id: userId,
      username: cleaned,
      total_presence_time: 0,
      total_speaking_time: 0,
      last_connected: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    .select()
    .single();

  if (error) {
    console.error(`❌ Erro ao criar/buscar usuário ${username}:`, error.message);
    return null;
  }

  return data;
}

/**
 * Adiciona tempo de presença ao total acumulado do usuário.
 * Usa incremento atômico via RPC ou update direto.
 * @param {string} userId - ID do usuário
 * @param {string} username - Nome de exibição
 * @param {number} seconds - Segundos a adicionar
 */
export async function addPresenceTime(userId, username, seconds) {
  if (seconds <= 0) return { leveledUp: false };

  // Busca o valor atual só para saber o nível ANTES (comparação de level-up)
  const user = await getOrCreateUser(userId, username);
  if (!user) return { leveledUp: false };

  const { getLevelData } = await import('./utils/levels.js');
  const oldLvl = getLevelData(user.total_presence_time || 0, user.total_speaking_time || 0, user.bonus_xp || 0).level;

  // Incremento atômico via RPC (UPDATE ... SET x = x + $1 ... RETURNING) — evita
  // a corrida de "ler total, somar em JS, escrever de volta": duas chamadas
  // concorrentes para o mesmo usuário (ex.: o flush periódico de 5min e o
  // stopPresenceTracking ao sair do canal, batendo no mesmo instante) faziam
  // uma sobrescrever o incremento da outra, perdendo segundos de presença.
  const { data, error } = await supabase.rpc('increment_presence_time', {
    p_user_id: userId,
    p_seconds: Math.floor(seconds),
  });

  if (error || !data || data.length === 0) {
    console.error(`❌ Erro ao salvar presença de ${username}:`, error?.message || 'RPC não retornou dados');
    return { leveledUp: false };
  }

  // Sincroniza o nome separadamente (não crítico o suficiente pra precisar ser atômico)
  if (user.username !== username) {
    await supabase.from('voice_metrics').update({ username }).eq('user_id', userId);
  }

  const updated = data[0];
  const newLvl = getLevelData(updated.total_presence_time, updated.total_speaking_time, updated.bonus_xp);
  if (newLvl.level > oldLvl) {
    return { leveledUp: true, oldLevel: oldLvl, newLevel: newLvl.level, rank: newLvl.rank };
  }

  return { leveledUp: false };
}

/**
 * Adiciona tempo de fala ao total acumulado do usuário.
 * @param {string} userId - ID do usuário
 * @param {string} username - Nome de exibição
 * @param {number} seconds - Segundos a adicionar
 */
export async function addSpeakingTime(userId, username, seconds) {
  if (seconds <= 0) return { leveledUp: false };

  const user = await getOrCreateUser(userId, username);
  if (!user) return { leveledUp: false };

  const { getLevelData } = await import('./utils/levels.js');
  const oldLvl = getLevelData(user.total_presence_time || 0, user.total_speaking_time || 0, user.bonus_xp || 0).level;

  // Mesmo incremento atômico via RPC que addPresenceTime — este é o que mais
  // sofria com a corrida: além do flush periódico e do fim de fala, um drop
  // de conquista duplicada também chama addSpeakingTime (bônus de XP) bem no
  // meio de alguém falando, exatamente quando as outras chamadas também
  // costumam disparar.
  const { data, error } = await supabase.rpc('increment_speaking_time', {
    p_user_id: userId,
    p_seconds: Math.floor(seconds),
  });

  if (error || !data || data.length === 0) {
    console.error(`❌ Erro ao salvar tempo de fala de ${username}:`, error?.message || 'RPC não retornou dados');
    return { leveledUp: false };
  }

  if (user.username !== username) {
    await supabase.from('voice_metrics').update({ username }).eq('user_id', userId);
  }

  const updated = data[0];
  const newLvl = getLevelData(updated.total_presence_time, updated.total_speaking_time, updated.bonus_xp);
  if (newLvl.level > oldLvl) {
    return { leveledUp: true, oldLevel: oldLvl, newLevel: newLvl.level, rank: newLvl.rank };
  }

  return { leveledUp: false };
}

/**
 * Busca as métricas de um usuário específico.
 * @param {string} userId - ID do usuário
 * @returns {Object|null} Métricas do usuário ou null se não encontrado
 */
export async function getUserMetrics(userId) {
  const { data, error } = await supabase
    .from('voice_metrics')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) return null;
  return data;
}

/**
 * Busca o Top N usuários com mais tempo de fala.
 * @param {number} limit - Quantidade de resultados (padrão: 10)
 * @returns {Array} Lista ordenada de usuários
 */
export async function getTopSpeakers(limit = 10) {
  const { data, error } = await supabase
    .from('voice_metrics')
    .select('*')
    .gt('total_speaking_time', 0)
    .order('total_speaking_time', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('❌ Erro ao buscar top speakers:', error.message);
    return [];
  }

  return data || [];
}

/**
 * Salva uma sessão histórica de voz na tabela voice_sessions.
 * @param {Object} sessionData - Dados da sessão
 * @param {string} sessionData.userId - ID do usuário
 * @param {string} sessionData.username - Nome do usuário
 * @param {string} sessionData.channelId - ID do canal de voz
 * @param {number} sessionData.joinedAt - Timestamp de entrada (ms)
 * @param {number} sessionData.leftAt - Timestamp de saída (ms)
 * @param {number} sessionData.presenceSeconds - Tempo de presença (segundos)
 * @param {number} sessionData.speakingSeconds - Tempo de fala (segundos)
 */
export async function saveVoiceSession({
  userId,
  username,
  channelId,
  joinedAt,
  leftAt,
  presenceSeconds,
  speakingSeconds,
}) {
  const { error } = await supabase
    .from('voice_sessions')
    .insert({
      user_id: userId,
      username: username,
      channel_id: channelId,
      joined_at: new Date(joinedAt).toISOString(),
      left_at: new Date(leftAt).toISOString(),
      presence_seconds: Math.floor(presenceSeconds),
      speaking_seconds: Math.floor(speakingSeconds),
    });

  if (error) {
    console.error(`❌ Erro ao salvar sessão de voz no histórico de ${username}:`, error.message);
  }
}

/**
 * Busca o Top N usuários ordenados por Nível/XP acumulado.
 * @param {number} limit - Quantidade de resultados (padrão: 10)
 * @returns {Array} Lista ordenada de usuários com dados de XP agregados
 */
export async function getTopLevels(limit = 10) {
  const { data, error } = await supabase
    .from('voice_metrics')
    .select('*');

  if (error) {
    console.error('❌ Erro ao buscar top levels:', error.message);
    return [];
  }

  // Mapeia e calcula o XP de cada um em memória
  const calculated = (data || []).map(user => {
    const presence = user.total_presence_time || 0;
    const speaking = user.total_speaking_time || 0;
    const xp = Math.floor((speaking * 3) + (presence * 1));
    return { ...user, xp };
  });

  // Ordena por XP decrescente e limita ao valor solicitado
  return calculated
    .sort((a, b) => b.xp - a.xp)
    .slice(0, limit);
}

/**
 * Concede uma nova patente/badge (loot drop) para um usuário no banco de dados.
 * @param {string} userId - ID do usuário
 * @param {string} username - Nome do usuário
 * @param {string} badgeIcon - Ícone/Emoji da Badge
 * @param {string} badgeName - Nome da Badge
 * @param {string} badgeTag - Tag associada (ex: [Coruja])
 */
export async function awardBadge(userId, username, badgeIcon, badgeName, badgeTag) {
  const { error } = await supabase
    .from('user_badges')
    .insert({
      user_id: userId,
      username: username,
      badge_icon: badgeIcon,
      badge_name: badgeName
      // badge_tag removido pois não existia no schema original do CREATE TABLE
    });

  if (error) {
    console.error(`❌ Erro ao conceder badge para ${username}:`, error.message);
  }
}

/**
 * Busca todas as badges de um usuário.
 * @param {string} userId - ID do usuário
 * @returns {Array} Lista de badges do usuário
 */
export async function getUserBadges(userId) {
  const { data, error } = await supabase
    .from('user_badges')
    .select('*')
    .eq('user_id', userId)
    .order('earned_at', { ascending: false });

  if (error) {
    console.error(`❌ Erro ao buscar badges do usuário ${userId}:`, error.message);
    return [];
  }
  return data || [];
}

let cachedRarityStats = {};
let lastStatsFetchTime = 0;

/**
 * Busca estatísticas de posse (raridade) das conquistas no banco de dados.
 * Conta o número de ocorrências de cada badge_name globalmente.
 * @param {boolean} force - Se true, força o recarregamento dos dados ignorando o cache
 * @returns {Promise<Object>} Um objeto mapeando badge_name para o número total de ocorrências.
 */
export async function getBadgeRarityStats(force = false) {
  const now = Date.now();
  // Cache de 5 minutos para evitar chamadas excessivas ao Supabase
  if (!force && now - lastStatsFetchTime < 5 * 60 * 1000 && Object.keys(cachedRarityStats).length > 0) {
    return cachedRarityStats;
  }

  try {
    const { data, error } = await supabase
      .from('user_badges')
      .select('badge_name');

    if (error) throw error;

    const counts = {};
    if (data) {
      data.forEach(row => {
        counts[row.badge_name] = (counts[row.badge_name] || 0) + 1;
      });
    }

    cachedRarityStats = counts;
    lastStatsFetchTime = now;
    return counts;
  } catch (err) {
    console.error('❌ [DB] Erro ao buscar estatísticas de raridade:', err.message);
    return cachedRarityStats || {};
  }
}


/**
 * Encontra o melhor amigo do usuário cruzando os overlaps de sessões.
 * @param {string} userId - ID do usuário
 * @returns {Object|null} Objeto contendo o melhor amigo ou null
 */
export async function getBestFriend(userId) {
  try {
    // 1. Busca apenas as sessões do próprio usuário
    const { data: userSessions, error: myErr } = await supabase
      .from('voice_sessions')
      .select('channel_id, joined_at, left_at')
      .eq('user_id', userId)
      .not('left_at', 'is', null);

    if (myErr || !userSessions || userSessions.length === 0) return null;

    // Coleta os IDs únicos dos canais frequentados pelo usuário
    const channelIds = [...new Set(userSessions.map(s => s.channel_id))];
    if (channelIds.length === 0) return null;

    // 2. Busca sessões de outros usuários APENAS nos mesmos canais
    const { data: otherSessions, error: otherErr } = await supabase
      .from('voice_sessions')
      .select('user_id, username, channel_id, joined_at, left_at')
      .in('channel_id', channelIds)
      .not('user_id', 'eq', userId)
      .not('left_at', 'is', null);

    if (otherErr || !otherSessions || otherSessions.length === 0) return null;

    const overlapMap = {}; // userId -> { username, time }

    userSessions.forEach(mySession => {
      const myStart = new Date(mySession.joined_at).getTime();
      const myEnd = new Date(mySession.left_at).getTime();

      // Filtra sessões alheias no mesmo canal
      const relevant = otherSessions.filter(s => s.channel_id === mySession.channel_id);

      relevant.forEach(otherSession => {
        const otherStart = new Date(otherSession.joined_at).getTime();
        const otherEnd = new Date(otherSession.left_at).getTime();

        const overlapStart = Math.max(myStart, otherStart);
        const overlapEnd = Math.min(myEnd, otherEnd);
        const overlap = (overlapEnd - overlapStart) / 1000;

        if (overlap > 0) {
          if (!overlapMap[otherSession.user_id]) {
            overlapMap[otherSession.user_id] = { username: otherSession.username, time: 0 };
          }
          overlapMap[otherSession.user_id].time += overlap;
        }
      });
    });

    let bestFriend = null;
    let maxTime = 0;
    for (const [id, data] of Object.entries(overlapMap)) {
      if (data.time > maxTime) {
        maxTime = data.time;
        bestFriend = { id, username: data.username, time: data.time };
      }
    }

    return bestFriend;
  } catch (err) {
    console.error('❌ [DB] Erro ao buscar melhor amigo:', err.message);
    return null;
  }
}

/**
 * Retorna as moedas e bônus de XP do usuário
 */
export async function getEconomy(userId) {
  const { data, error } = await supabase
    .from('voice_metrics')
    .select('voice_coins, bonus_xp')
    .eq('user_id', userId)
    .single();
  if (error || !data) return { voice_coins: 0, bonus_xp: 0 };
  return data;
}

/**
 * Adiciona moedas e bônus de XP ao usuário
 */
export async function addEconomy(userId, username, coins = 0, bonusXp = 0) {
  if (coins === 0 && bonusXp === 0) return;
  const user = await getOrCreateUser(userId, username);
  if (!user) return;
  
  const { error } = await supabase
    .from('voice_metrics')
    .update({
      voice_coins: (user.voice_coins || 0) + coins,
      bonus_xp: (user.bonus_xp || 0) + bonusXp,
      username: username
    })
    .eq('user_id', userId);
    
  if (error) console.error(`❌ Erro ao adicionar economia para ${username}:`, error.message);
}

/**
 * Deduz moedas do usuário (retorna true se teve saldo, false se não)
 */
export async function spendCoins(userId, amount) {
  const user = await getOrCreateUser(userId, 'Unknown');
  if (!user || (user.voice_coins || 0) < amount) return false;
  
  const { error } = await supabase
    .from('voice_metrics')
    .update({
      voice_coins: user.voice_coins - amount
    })
    .eq('user_id', userId);
    
  if (error) {
    console.error(`❌ Erro ao gastar moedas de ${userId}:`, error.message);
    return false;
  }
  return true;
}


/**
 * Atualiza o username/nickname do usuário no banco de dados nas tabelas voice_metrics e user_badges.
 * @param {string} userId - ID do usuário Discord
 * @param {string} newUsername - Novo username/nickname
 */
export async function updateDatabaseUsername(userId, newUsername) {
  const cleaned = cleanUsername(newUsername) || userId;
  try {
    // 1. Atualiza na tabela voice_metrics
    const { error: metricsError } = await supabase
      .from('voice_metrics')
      .update({ username: cleaned })
      .eq('user_id', userId);

    if (metricsError) {
      console.error(`❌ [DB] Erro ao atualizar username na voice_metrics para ${userId}:`, metricsError.message);
    }

    // 2. Atualiza na tabela user_badges
    const { error: badgesError } = await supabase
      .from('user_badges')
      .update({ username: cleaned })
      .eq('user_id', userId);

    if (badgesError) {
      console.error(`❌ [DB] Erro ao atualizar username na user_badges para ${userId}:`, badgesError.message);
    }

    console.log(`💾 [DB SYNC] Username do usuário ${userId} atualizado para "${cleaned}" no banco de dados.`);
  } catch (err) {
    console.error(`❌ [DB] Erro ao sincronizar username de ${userId} no banco:`, err.message);
  }
}

/**
 * Busca todas as conquistas do banco agrupadas por user_id.
 * @returns {Promise<Object>} Um objeto mapeando user_id para um array de conquistas do usuário.
 */
export async function getAllUserBadgesMap() {
  try {
    const { data, error } = await supabase
      .from('user_badges')
      .select('*');

    if (error) throw error;

    const map = {};
    if (data) {
      data.forEach(b => {
        if (!map[b.user_id]) {
          map[b.user_id] = [];
        }
        map[b.user_id].push(b);
      });
    }
    return map;
  } catch (err) {
    console.error('❌ [DB] Erro ao carregar mapa global de badges:', err.message);
    return {};
  }
}

/**
 * Busca a última conquista concedida globalmente no servidor.
 * @returns {Promise<Object|null>}
 */
export async function getLastAwardedBadge() {
  try {
    const { data, error } = await supabase
      .from('user_badges')
      .select('username, badge_name, badge_icon, earned_at')
      .order('earned_at', { ascending: false })
      .limit(1);

    if (error) throw error;
    return (data && data.length > 0) ? data[0] : null;
  } catch (err) {
    console.error('❌ [DB] Erro ao buscar última conquista concedida:', err.message);
    return null;
  }
}

export { supabase };


