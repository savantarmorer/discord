// ============================================
// agora/eventos-discord.js — Eventos agendados do Discord a partir da Ágora
// ============================================
// Eventos do Mutirão e propostas em debate/votação na Assembleia aparecem na aba
// "Eventos" do servidor. Vale para o que foi criado pelo bot ou pelo app: o bot
// confere a cada 10 minutos (e logo depois de alguém criar algo pelo bot), cria o
// que falta, atualiza o que mudou e apaga o que foi cancelado ou já terminou.
// Nada é postado em canais de texto.

import {
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus,
  PermissionFlagsBits,
} from 'discord.js';
import { config } from '../config.js';
import { agoraConfigurada, clienteAdmin, problemasDeConfiguracao } from './cliente.js';

const INTERVALO = 10 * 60_000;
const FUSO = 'America/Sao_Paulo';
const fmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: FUSO });

let cliente = null;
let rodando = false;
let pendente = false;
let espera = null;
let semPermissaoAvisado = false;

const cortar = (t, max) => {
  const s = String(t ?? '').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

/** Liga a sincronização (chamado quando o bot fica online). */
export function iniciarEventosDiscord(client) {
  if (!config.agora.eventosDiscord || !agoraConfigurada() || problemasDeConfiguracao().length) return false;
  cliente = client;
  sincronizarEventos().catch((e) => console.error('⚠️  Eventos do Discord:', e.message));
  setInterval(() => sincronizarEventos().catch((e) => console.error('⚠️  Eventos do Discord:', e.message)), INTERVALO).unref?.();
  return true;
}

/** Pede uma sincronização em alguns segundos (depois de criar um evento ou proposta). */
export function agendarSincronizacao() {
  if (!cliente) return;
  clearTimeout(espera);
  espera = setTimeout(() => sincronizarEventos().catch((e) => console.error('⚠️  Eventos do Discord:', e.message)), 3000);
}

/** O que deve existir no Discord para cada evento/proposta da Ágora. */
export function desejados({ eventos, propostas }, agora = new Date()) {
  const lista = [];
  for (const ev of eventos) {
    if (ev.excluido_em || new Date(ev.fim) <= agora) continue;
    const onde = [ev.local_nome, ev.endereco].filter(Boolean).join(' — ') || (ev.nucleo ? `${ev.nucleo.cidade}/${ev.nucleo.estado}` : 'A combinar');
    lista.push({
      origem: 'evento',
      id: ev.id,
      inicio: ev.inicio,
      fim: ev.fim,
      nome: cortar(`🤝 ${ev.titulo}`, 100),
      local: cortar(onde, 100),
      descricao: cortar(
        [
          ev.projeto?.titulo ? `Mutirão · ${ev.projeto.titulo}` : 'Mutirão da Ágora',
          ev.descricao ? `\n${ev.descricao}` : '',
          '\nConfirme presença e faça check-in pelo bot: /mutirao evento (ou /menu › Mutirão). Também aparece no app da Ágora.',
        ].join('\n'),
        1000,
      ),
    });
  }
  for (const p of propostas) {
    if (p.excluido_em || p.oculto || !['debate', 'votacao'].includes(p.status) || !p.votacao_ate) continue;
    if (new Date(p.votacao_ate) <= agora) continue;
    lista.push({
      origem: 'proposta',
      id: p.id,
      inicio: p.debate_iniciado_em ?? p.created_at,
      fim: p.votacao_ate,
      nome: cortar(`🗳️ Assembleia: ${p.titulo}`, 100),
      local: 'Assembleia da Ágora (bot e app)',
      descricao: cortar(
        [
          `Debate até ${p.debate_ate ? fmt.format(new Date(p.debate_ate)) : '—'} · votação até ${fmt.format(new Date(p.votacao_ate))} (horário de Brasília).`,
          '',
          'Leia, comente e vote pelo bot: /assembleia proposta (ou /menu › Assembleia). Cada membro ativo tem voz.',
        ].join('\n'),
        1000,
      ),
    });
  }
  return lista;
}

const assinatura = (d) => JSON.stringify([d.nome, d.local, d.descricao, d.inicio, d.fim]);

function payload(d, agora = Date.now(), jaComecou = false) {
  // O Discord só aceita início no futuro: o que já começou abre daqui a 1 minuto
  const inicio = Math.max(new Date(d.inicio).getTime(), agora + 60_000);
  const fim = Math.max(new Date(d.fim).getTime(), inicio + 60_000);
  return {
    name: d.nome,
    description: d.descricao,
    ...(jaComecou ? {} : { scheduledStartTime: new Date(inicio) }),
    scheduledEndTime: new Date(fim),
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    entityType: GuildScheduledEventEntityType.External,
    entityMetadata: { location: d.local },
  };
}

export async function sincronizarEventos() {
  if (!cliente) return;
  if (rodando) {
    pendente = true;
    return;
  }
  rodando = true;
  try {
    const guild = await cliente.guilds.fetch(config.guildId);
    const eu = await guild.members.fetchMe();
    const pode = eu.permissions.has(PermissionFlagsBits.ManageEvents) || eu.permissions.has(PermissionFlagsBits.CreateEvents);
    if (!pode) {
      if (!semPermissaoAvisado) console.warn('⚠️  Eventos do Discord: dê ao bot a permissão "Criar eventos" (ou "Gerenciar eventos") para publicar os eventos da Ágora.');
      semPermissaoAvisado = true;
      return;
    }
    semPermissaoAvisado = false;

    const adm = clienteAdmin();
    const agoraIso = new Date().toISOString();
    const [ev, pr, mp] = await Promise.all([
      adm.from('eventos').select('id, titulo, descricao, local_nome, endereco, inicio, fim, excluido_em, projeto:projetos(titulo), nucleo:nucleos(cidade, estado)')
        .gte('fim', agoraIso).order('inicio').limit(100),
      adm.from('propostas').select('id, titulo, status, debate_iniciado_em, debate_ate, votacao_ate, oculto, excluido_em, created_at')
        .in('status', ['debate', 'votacao']).gte('votacao_ate', agoraIso).limit(100),
      adm.from('discord_eventos').select('*').eq('guild_id', guild.id),
    ]);
    for (const r of [ev, pr, mp]) if (r.error) throw new Error(r.error.message);

    const lista = desejados({ eventos: ev.data, propostas: pr.data });
    const mapa = new Map(mp.data.map((m) => [`${m.origem}:${m.origem_id}`, m]));
    const existentes = await guild.scheduledEvents.fetch();

    for (const d of lista) {
      const chave = `${d.origem}:${d.id}`;
      const m = mapa.get(chave);
      mapa.delete(chave);
      try {
        if (!m) {
          const criado = await guild.scheduledEvents.create(payload(d));
          await adm.from('discord_eventos').upsert({
            origem: d.origem, origem_id: d.id, guild_id: guild.id, discord_evento_id: criado.id, assinatura: assinatura(d), sincronizado_em: agoraIso,
          });
          continue;
        }
        if (m.assinatura === assinatura(d)) continue;
        const atual = existentes.get(m.discord_evento_id);
        // Apagado à mão pela moderação: respeita e não recria
        if (atual) await atual.edit(payload(d, Date.now(), atual.status === GuildScheduledEventStatus.Active));
        await adm.from('discord_eventos').update({ assinatura: assinatura(d), sincronizado_em: agoraIso })
          .eq('origem', d.origem).eq('origem_id', d.id).eq('guild_id', guild.id);
      } catch (e) {
        console.error(`⚠️  Evento do Discord (${chave}):`, e.message);
      }
    }

    // Sobrou no mapa: cancelado, decidido ou já terminou → tira do Discord
    for (const m of mapa.values()) {
      try {
        const atual = existentes.get(m.discord_evento_id);
        if (atual && atual.status !== GuildScheduledEventStatus.Completed && atual.status !== GuildScheduledEventStatus.Canceled) await atual.delete();
        await adm.from('discord_eventos').delete().eq('origem', m.origem).eq('origem_id', m.origem_id).eq('guild_id', guild.id);
      } catch (e) {
        console.error(`⚠️  Evento do Discord (${m.origem}:${m.origem_id}):`, e.message);
      }
    }
  } finally {
    rodando = false;
    if (pendente) {
      pendente = false;
      agendarSincronizacao();
    }
  }
}
