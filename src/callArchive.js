// ============================================
// callArchive.js — Arquivo de gravações de call (votos, comentários, categorias)
// ============================================
// Camada de acesso às tabelas call_recordings / call_recording_votes /
// call_recording_comments. Usa o mesmo cliente Supabase (chave anônima)
// que database.js — o upload de arquivo em si usa a service_role em
// callRecorder.js, mas ler/escrever linhas nessas tabelas segue o mesmo
// padrão do resto do bot.
//
// Lê as variáveis de ambiente do Supabase diretamente (não via config.js)
// porque este módulo é compartilhado pelo bot principal E pelo bot de
// reprodução (src/player) — cada um tem seu próprio conjunto de variáveis
// obrigatórias, e importar config.js aqui forçaria o bot de reprodução a
// também precisar de DISCORD_TOKEN/DISCORD_CLIENT_ID do bot principal.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const serviceSupabase = process.env.SUPABASE_SERVICE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

/**
 * Registra uma gravação recém-enviada ao Storage, junto com quem participou
 * dela (quem falou e/ou estava presente no canal). Chamado por callRecorder.js
 * logo após o upload de cada segmento.
 */
export async function registerRecording({
  guildId,
  channelId,
  channelName,
  sessionId,
  segmentIndex,
  storagePath,
  participants = [],
}) {
  const { data, error } = await supabase
    .from('call_recordings')
    .insert({
      guild_id: guildId,
      channel_id: channelId,
      channel_name: channelName,
      session_id: sessionId,
      segment_index: segmentIndex,
      storage_path: storagePath,
    })
    .select('id')
    .single();

  if (error) {
    console.error('❌ [CALL-ARCHIVE] Erro ao registrar gravação:', error.message);
    return null;
  }

  if (participants.length > 0) {
    const rows = participants.map((p) => ({
      recording_id: data.id,
      user_id: p.userId,
      username: p.username,
      spoke: p.spoke,
      speaking_ms: p.speakingMs,
      presence_seconds: p.presenceSeconds,
    }));
    const { error: participantsError } = await supabase.from('call_recording_participants').insert(rows);
    if (participantsError) {
      console.error(`❌ [CALL-ARCHIVE] Erro ao registrar participantes da gravação ${data.id}:`, participantsError.message);
    }
  }

  return data.id;
}

/**
 * Lista as categorias distintas já usadas (calls sem categoria não aparecem aqui).
 */
export async function getCategories(guildId) {
  const { data, error } = await supabase
    .from('call_recordings')
    .select('category')
    .eq('guild_id', guildId)
    .not('category', 'is', null);

  if (error) {
    console.error('❌ [CALL-ARCHIVE] Erro ao buscar categorias:', error.message);
    return [];
  }
  return [...new Set(data.map((r) => r.category))].sort();
}

/**
 * Lista gravações de uma categoria (ou as mais recentes, se category for null),
 * mais recentes primeiro, limitado a `limit` (padrão 25 — limite de select menu do Discord).
 */
export async function getRecordings(guildId, category = null, limit = 25) {
  let query = supabase
    .from('call_recordings')
    .select('id, channel_name, title, category, created_at, upvotes, downvotes')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (category) {
    query = query.eq('category', category);
  }

  const { data, error } = await query;
  if (error) {
    console.error('❌ [CALL-ARCHIVE] Erro ao buscar gravações:', error.message);
    return [];
  }
  return data;
}

export async function getRecordingById(id) {
  const { data, error } = await supabase
    .from('call_recordings')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error(`❌ [CALL-ARCHIVE] Erro ao buscar gravação ${id}:`, error.message);
    return null;
  }
  return data;
}

/**
 * Lista todas as partes (segmentos) da mesma sessão de gravação, em ordem —
 * usado pelo bot de reprodução para enfileirar automaticamente o resto de
 * uma call de mais de 30 minutos.
 */
export async function getSessionSegments(sessionId, fromSegmentIndex = 0) {
  const { data, error } = await supabase
    .from('call_recordings')
    .select('*')
    .eq('session_id', sessionId)
    .gte('segment_index', fromSegmentIndex)
    .order('segment_index', { ascending: true });

  if (error) {
    console.error(`❌ [CALL-ARCHIVE] Erro ao buscar partes da sessão ${sessionId}:`, error.message);
    return [];
  }
  return data;
}

/**
 * Lista os participantes de uma gravação (quem falou e/ou estava presente),
 * ordenados por quem mais falou.
 */
export async function getParticipants(recordingId) {
  const { data, error } = await supabase
    .from('call_recording_participants')
    .select('user_id, username, spoke, speaking_ms, presence_seconds')
    .eq('recording_id', recordingId)
    .order('speaking_ms', { ascending: false });

  if (error) {
    console.error(`❌ [CALL-ARCHIVE] Erro ao buscar participantes da gravação ${recordingId}:`, error.message);
    return [];
  }
  return data;
}

/**
 * Ranking de usuários com maior presença/fala somada em todas as gravações
 * arquivadas do servidor — base para um futuro /topcalls, por exemplo.
 */
export async function getTopParticipants(guildId, limit = 10) {
  const { data, error } = await supabase
    .from('call_recording_participants')
    .select('user_id, username, speaking_ms, presence_seconds, call_recordings!inner(guild_id)')
    .eq('call_recordings.guild_id', guildId);

  if (error) {
    console.error('❌ [CALL-ARCHIVE] Erro ao calcular ranking de participação:', error.message);
    return [];
  }

  const totals = new Map();
  for (const row of data) {
    const entry = totals.get(row.user_id) || { userId: row.user_id, username: row.username, speakingMs: 0, presenceSeconds: 0 };
    entry.speakingMs += row.speaking_ms || 0;
    entry.presenceSeconds += row.presence_seconds || 0;
    entry.username = row.username; // mantém o nome mais recente
    totals.set(row.user_id, entry);
  }

  return [...totals.values()].sort((a, b) => b.presenceSeconds - a.presenceSeconds).slice(0, limit);
}

/**
 * Define título e categoria de uma gravação.
 */
export async function renameRecording(id, title, category, renamedBy) {
  const { error } = await supabase
    .from('call_recordings')
    .update({ title, category, renamed_by: renamedBy, renamed_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    console.error(`❌ [CALL-ARCHIVE] Erro ao renomear gravação ${id}:`, error.message);
    return false;
  }
  return true;
}

/**
 * Registra (ou troca) o voto de um usuário numa gravação, e retorna os totais atualizados.
 * @param {number} recordingId
 * @param {string} userId
 * @param {1|-1} vote
 */
export async function voteRecording(recordingId, userId, vote) {
  const { error: voteError } = await supabase
    .from('call_recording_votes')
    .upsert({ recording_id: recordingId, user_id: userId, vote }, { onConflict: 'recording_id,user_id' });

  if (voteError) {
    console.error(`❌ [CALL-ARCHIVE] Erro ao votar na gravação ${recordingId}:`, voteError.message);
    return null;
  }

  const { data: votes, error: countError } = await supabase
    .from('call_recording_votes')
    .select('vote')
    .eq('recording_id', recordingId);

  if (countError) {
    console.error(`❌ [CALL-ARCHIVE] Erro ao contar votos da gravação ${recordingId}:`, countError.message);
    return null;
  }

  const upvotes = votes.filter((v) => v.vote === 1).length;
  const downvotes = votes.filter((v) => v.vote === -1).length;

  await supabase.from('call_recordings').update({ upvotes, downvotes }).eq('id', recordingId);

  return { upvotes, downvotes };
}

export async function addComment(recordingId, userId, username, content) {
  const { error } = await supabase
    .from('call_recording_comments')
    .insert({ recording_id: recordingId, user_id: userId, username, content });

  if (error) {
    console.error(`❌ [CALL-ARCHIVE] Erro ao comentar na gravação ${recordingId}:`, error.message);
    return false;
  }

  const { count } = await supabase
    .from('call_recording_comments')
    .select('id', { count: 'exact', head: true })
    .eq('recording_id', recordingId);
  await supabase.from('call_recordings').update({ comment_count: count || 0 }).eq('id', recordingId);

  return true;
}

/**
 * Registra um clique em "Ouvir" — usado como proxy de alcance/audiência
 * já que não há como medir tempo real de escuta (o áudio toca fora do bot).
 */
export async function incrementListenCount(recordingId) {
  const { data } = await supabase.from('call_recordings').select('listen_count').eq('id', recordingId).single();
  const current = data?.listen_count || 0;
  await supabase.from('call_recordings').update({ listen_count: current + 1 }).eq('id', recordingId);
}

export async function getComments(recordingId, limit = 5) {
  const { data, error } = await supabase
    .from('call_recording_comments')
    .select('username, content, created_at')
    .eq('recording_id', recordingId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`❌ [CALL-ARCHIVE] Erro ao buscar comentários da gravação ${recordingId}:`, error.message);
    return [];
  }
  return data;
}

/**
 * Gera uma nova signed URL para ouvir a gravação (as URLs expiram em 7 dias,
 * então são geradas sob demanda em vez de guardadas permanentemente).
 */
export async function getListenUrl(storagePath, expirySeconds = 60 * 60 * 24) {
  if (!serviceSupabase) return null;
  const { data, error } = await serviceSupabase.storage
    .from('call-recordings')
    .createSignedUrl(storagePath, expirySeconds);

  if (error) {
    console.error(`❌ [CALL-ARCHIVE] Erro ao gerar link de ${storagePath}:`, error.message);
    return null;
  }
  return data.signedUrl;
}

/**
 * Relatório de participação: distribui o "engajamento" de cada gravação
 * (votos, comentários, cliques em ouvir) entre quem falou nela, proporcional
 * ao tempo de fala, soma tudo no período e normaliza em percentual por usuário.
 *
 * Fórmula (ver conversa): Engajamento(r) = max(0, (up-down)*Wv + comentários*Wc + ouvir*Wl)
 * Fatia(u,r) = Engajamento(r) * tempo_fala(u,r)/tempo_fala_total(r)
 * Percentual(u) = ΣFatia(u,r) / ΣFatia(todos,r) * 100
 */
export async function getParticipationReport(guildId, sinceIso, weights = { vote: 3, comment: 2, listen: 1 }) {
  const { data, error } = await supabase
    .from('call_recording_participants')
    .select('user_id, username, speaking_ms, recording_id, call_recordings!inner(guild_id, created_at, upvotes, downvotes, comment_count, listen_count)')
    .eq('call_recordings.guild_id', guildId)
    .eq('spoke', true)
    .gte('call_recordings.created_at', sinceIso);

  if (error) {
    console.error('❌ [CALL-ARCHIVE] Erro ao calcular relatório de participação:', error.message);
    return [];
  }

  const byRecording = new Map();
  for (const row of data) {
    if (!byRecording.has(row.recording_id)) {
      byRecording.set(row.recording_id, { rec: row.call_recordings, participants: [] });
    }
    byRecording.get(row.recording_id).participants.push(row);
  }

  const userScores = new Map();
  for (const { rec, participants } of byRecording.values()) {
    const netVotes = (rec.upvotes || 0) - (rec.downvotes || 0);
    const engagement = Math.max(
      0,
      netVotes * weights.vote + (rec.comment_count || 0) * weights.comment + (rec.listen_count || 0) * weights.listen
    );
    if (engagement === 0) continue;

    const totalSpeakingMs = participants.reduce((sum, p) => sum + (p.speaking_ms || 0), 0);
    if (totalSpeakingMs === 0) continue;

    for (const p of participants) {
      const share = engagement * (p.speaking_ms / totalSpeakingMs);
      const entry = userScores.get(p.user_id) || { userId: p.user_id, username: p.username, score: 0 };
      entry.score += share;
      entry.username = p.username;
      userScores.set(p.user_id, entry);
    }
  }

  const totalScore = [...userScores.values()].reduce((sum, u) => sum + u.score, 0);
  if (totalScore === 0) return [];

  return [...userScores.values()]
    .map((u) => ({ userId: u.userId, username: u.username, percent: (u.score / totalScore) * 100 }))
    .sort((a, b) => b.percent - a.percent);
}
