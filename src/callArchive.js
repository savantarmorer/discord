// ============================================
// callArchive.js — Arquivo de gravações de call (votos, comentários, categorias)
// ============================================
// Camada de acesso às tabelas call_recordings / call_recording_votes /
// call_recording_comments. Usa o mesmo cliente Supabase (chave anônima)
// que database.js — o upload de arquivo em si usa a service_role em
// callRecorder.js, mas ler/escrever linhas nessas tabelas segue o mesmo
// padrão do resto do bot.

import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

const supabase = createClient(config.supabaseUrl, config.supabaseKey);
const serviceSupabase = config.supabaseServiceKey
  ? createClient(config.supabaseUrl, config.supabaseServiceKey)
  : null;

/**
 * Registra uma gravação recém-enviada ao Storage. Chamado por callRecorder.js
 * logo após o upload de cada segmento.
 */
export async function registerRecording({ guildId, channelId, channelName, sessionId, segmentIndex, storagePath }) {
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
  return true;
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
