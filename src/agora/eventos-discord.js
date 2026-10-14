// ============================================
// agora/eventos-discord.js — Eventos agendados do Discord a partir da Ágora
// ============================================
// Eventos do Mutirão, aulas, debates ao vivo e propostas em debate/votação na
// Assembleia aparecem na aba "Eventos" do servidor. Vale para o que foi criado
// pelo bot ou pelo app: a cada 10 minutos (e logo depois de alguém criar algo pelo
// bot) o bot cria o que falta, atualiza o que mudou e tira o que foi cancelado.
//
// Eventos com canal de voz (aulas, debates, mutirões online) têm um ciclo próprio,
// a cada minuto: o evento do Discord começa e termina na hora, o bot soma quem está
// na call (sem entrar nem falar nada) e, no fim, confirma a presença de quem ficou
// tempo suficiente. Nas aulas ele posta as estrelas de avaliação no chat do canal
// de voz e, quando a avaliação fecha (48 h), edita a mensagem com o resultado.

import {
  ChannelType,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus,
  PermissionFlagsBits,
} from 'discord.js';
import { config } from '../config.js';
import { agoraConfigurada, clienteAdmin, problemasDeConfiguracao } from './cliente.js';

const INTERVALO = 10 * 60_000;
const INTERVALO_VOZ = 60_000;
const ANTES_DO_INICIO = 10 * 60_000; // a contagem de presença começa 10 min antes
const FUSO = 'America/Sao_Paulo';
const fmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: FUSO });

let cliente = null;
let rodando = false;
let pendente = false;
let rodandoVoz = false;
let espera = null;
let semPermissaoAvisado = false;

const cortar = (t, max) => {
  const s = String(t ?? '').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};
const nomeDe = (p) => (p ? (p.pseudonimo_ativo && p.pseudonimo ? p.pseudonimo : p.nome_exibicao) : null);
const log = (e) => console.error('⚠️  Eventos do Discord:', e?.message ?? e);

/** Liga a sincronização (chamado quando o bot fica online). */
export function iniciarEventosDiscord(client) {
  if (!config.agora.eventosDiscord || !agoraConfigurada() || problemasDeConfiguracao().length) return false;
  cliente = client;
  sincronizarEventos().catch(log);
  setInterval(() => sincronizarEventos().catch(log), INTERVALO).unref?.();
  setInterval(() => cicloVoz().catch(log), INTERVALO_VOZ).unref?.();
  return true;
}

/** Pede uma sincronização em alguns segundos (depois de criar um evento ou proposta). */
export function agendarSincronizacao() {
  if (!cliente) return;
  clearTimeout(espera);
  espera = setTimeout(() => sincronizarEventos().catch(log), 3000);
}

const ROTULO_TIPO = { mutirao: '🤝', aula: '🎓 Aula:', assembleia: '🗳️ Debate ao vivo:', encontro: '☕' };

/** O que deve existir no Discord para cada evento/proposta da Ágora. */
export function desejados({ eventos, propostas }, agora = new Date()) {
  const lista = [];
  for (const ev of eventos) {
    if (ev.excluido_em || new Date(ev.fim) <= agora) continue;
    const tipo = ev.tipo ?? 'mutirao';
    const onde = [ev.local_nome, ev.endereco].filter(Boolean).join(' — ') || (ev.nucleo ? `${ev.nucleo.cidade}/${ev.nucleo.estado}` : 'A combinar');
    const quem = nomeDe(ev.autor);
    let texto;
    if (tipo === 'aula') {
      texto = [
        `Aula${quem ? ` com ${quem}` : ''}${ev.tema?.nome ? ` · ${ev.tema.nome}` : ''}`,
        ev.descricao ? `\n${ev.descricao}` : '',
        '\nEntre no canal na hora: a presença conta sozinha (fique pelo menos metade da aula, até 30 min). No fim, avalie com as estrelas que aparecem no chat do canal — quem ensina bem ganha Dracmas.',
      ];
    } else if (tipo === 'assembleia') {
      texto = [
        'Debate ao vivo de uma proposta da Assembleia.',
        ev.descricao ? `\n${ev.descricao}` : '',
        '\nO voto continua pelo bot ou pelo app: /assembleia proposta. Presença registrada só para a ata, não vale pontos.',
      ];
    } else {
      texto = [
        ev.projeto?.titulo ? `Mutirão · ${ev.projeto.titulo}` : 'Mutirão da Ágora',
        ev.descricao ? `\n${ev.descricao}` : '',
        ev.canal_voz_id
          ? '\nEncontro pela call: a presença conta sozinha. Confirme se vai: /mutirao evento.'
          : '\nConfirme presença e faça check-in pelo bot: /mutirao evento (ou /menu › Mutirão). Também aparece no app da Ágora.',
      ];
    }
    lista.push({
      origem: 'evento',
      id: ev.id,
      inicio: ev.inicio,
      fim: ev.fim,
      canal: ev.canal_voz_id ?? null,
      nome: cortar(`${ROTULO_TIPO[tipo] ?? '🤝'} ${ev.titulo}`, 100),
      local: cortar(onde, 100),
      descricao: cortar(texto.join('\n'), 1000),
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
      canal: null,
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

const assinatura = (d) => JSON.stringify([d.nome, d.local, d.descricao, d.inicio, d.fim, d.canal]);

function payload(d, guild, agora = Date.now(), jaComecou = false) {
  // O Discord só aceita início no futuro: o que já começou abre daqui a 1 minuto
  const inicio = Math.max(new Date(d.inicio).getTime(), agora + 60_000);
  const fim = Math.max(new Date(d.fim).getTime(), inicio + 60_000);
  const canal = d.canal ? guild.channels?.cache?.get(d.canal) : null;
  const base = {
    name: d.nome,
    description: d.descricao,
    ...(jaComecou ? {} : { scheduledStartTime: new Date(inicio) }),
    scheduledEndTime: new Date(fim),
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
  };
  if (canal) {
    const palco = canal.type === ChannelType.GuildStageVoice;
    return { ...base, entityType: palco ? GuildScheduledEventEntityType.StageInstance : GuildScheduledEventEntityType.Voice, channel: canal.id };
  }
  if (d.canal) console.warn(`⚠️  Canal de voz ${d.canal} não encontrado: o evento "${d.nome}" fica como externo.`);
  return { ...base, entityType: GuildScheduledEventEntityType.External, entityMetadata: { location: d.local } };
}

async function guildaComPermissao() {
  const guild = await cliente.guilds.fetch(config.guildId);
  const eu = await guild.members.fetchMe();
  const pode = eu.permissions.has(PermissionFlagsBits.ManageEvents) || eu.permissions.has(PermissionFlagsBits.CreateEvents);
  if (!pode) {
    if (!semPermissaoAvisado) console.warn('⚠️  Eventos do Discord: dê ao bot a permissão "Criar eventos" (ou "Gerenciar eventos") para publicar os eventos da Ágora.');
    semPermissaoAvisado = true;
    return { guild, pode: false };
  }
  semPermissaoAvisado = false;
  return { guild, pode: true };
}

const CAMPOS_EVENTO = 'id, tipo, titulo, descricao, local_nome, endereco, inicio, fim, canal_voz_id, excluido_em, projeto:projetos(titulo), nucleo:nucleos(cidade, estado), tema:temas(nome), autor:profiles!eventos_criado_por_fkey(nome_exibicao, pseudonimo, pseudonimo_ativo)';

export async function sincronizarEventos() {
  if (!cliente) return;
  if (rodando) {
    pendente = true;
    return;
  }
  rodando = true;
  try {
    const { guild, pode } = await guildaComPermissao();
    if (!pode) return;

    const adm = clienteAdmin();
    const agoraIso = new Date().toISOString();
    const [ev, pr, mp] = await Promise.all([
      adm.from('eventos').select(CAMPOS_EVENTO).gte('fim', agoraIso).order('inicio').limit(100),
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
          const criado = await guild.scheduledEvents.create(payload(d, guild));
          await adm.from('discord_eventos').upsert({
            origem: d.origem, origem_id: d.id, guild_id: guild.id, discord_evento_id: criado.id, assinatura: assinatura(d), sincronizado_em: agoraIso,
          });
          continue;
        }
        if (m.assinatura === assinatura(d)) continue;
        const atual = existentes.get(m.discord_evento_id);
        // Apagado à mão pela moderação: respeita e não recria
        if (atual) {
          const jaComecou = atual.status === GuildScheduledEventStatus.Active;
          const p = payload(d, guild, Date.now(), jaComecou);
          if (jaComecou) delete p.entityType; // o tipo não muda com o evento em andamento
          await atual.edit(p);
        }
        await adm.from('discord_eventos').update({ assinatura: assinatura(d), sincronizado_em: agoraIso })
          .eq('origem', d.origem).eq('origem_id', d.id).eq('guild_id', guild.id);
      } catch (e) {
        console.error(`⚠️  Evento do Discord (${chave}):`, e.message);
      }
    }

    // Sobrou no mapa: terminou, foi cancelado ou decidido → encerra (se em andamento) ou apaga
    for (const m of mapa.values()) {
      try {
        const atual = existentes.get(m.discord_evento_id);
        if (atual?.status === GuildScheduledEventStatus.Active) await atual.setStatus(GuildScheduledEventStatus.Completed);
        else if (atual?.status === GuildScheduledEventStatus.Scheduled) await atual.delete();
        await adm.from('discord_eventos').delete().eq('origem', m.origem).eq('origem_id', m.origem_id).eq('guild_id', guild.id);
      } catch (e) {
        console.error(`⚠️  Evento do Discord (${m.origem}:${m.origem_id}):`, e.message);
      }
    }

    // Fecha avaliações vencidas (também roda no pg_cron, se houver) e publica resultados
    await adm.rpc('fechar_avaliacoes_aulas');
    await publicarResultados(guild);
  } finally {
    rodando = false;
    if (pendente) {
      pendente = false;
      agendarSincronizacao();
    }
  }
}

// ------------------------------------------------------------------ ciclo das calls
/** Quem está (de verdade) no canal de voz agora: contas humanas. */
function presentesNoCanal(guild, canalId) {
  const canal = guild.channels?.cache?.get(canalId);
  if (!canal?.members) return [];
  return [...canal.members.values()].filter((m) => !m.user?.bot).map((m) => m.id);
}

export async function cicloVoz() {
  if (!cliente || rodandoVoz) return;
  rodandoVoz = true;
  try {
    const guild = await cliente.guilds.fetch(config.guildId);
    const adm = clienteAdmin();
    const agora = Date.now();
    const { data: eventos, error } = await adm.from('eventos')
      .select('id, tipo, titulo, inicio, fim, canal_voz_id, criado_por')
      .not('canal_voz_id', 'is', null).is('excluido_em', null)
      .lte('inicio', new Date(agora + ANTES_DO_INICIO).toISOString())
      .gte('fim', new Date(agora - 6 * 3600_000).toISOString())
      .limit(50);
    if (error) throw new Error(error.message);
    if (!eventos.length) return;

    const ids = eventos.map((e) => e.id);
    const [{ data: mapeados }, { data: processados }] = await Promise.all([
      adm.from('discord_eventos').select('origem_id, discord_evento_id').eq('origem', 'evento').eq('guild_id', guild.id).in('origem_id', ids),
      adm.from('discord_avaliacoes').select('evento_id').in('evento_id', ids),
    ]);
    const idDiscord = new Map((mapeados ?? []).map((m) => [m.origem_id, m.discord_evento_id]));
    const feitos = new Set((processados ?? []).map((p) => p.evento_id));

    for (const ev of eventos) {
      const inicio = new Date(ev.inicio).getTime();
      const fim = new Date(ev.fim).getTime();
      try {
        // 1. Presença: soma um minuto para cada pessoa na call
        if (agora >= inicio - ANTES_DO_INICIO && agora < fim) {
          const presentes = presentesNoCanal(guild, ev.canal_voz_id);
          if (presentes.length) {
            const { error: e1 } = await adm.rpc('somar_minutos_voz', { p_evento: ev.id, p_discord_ids: presentes, p_minutos: 1 });
            if (e1) throw new Error(e1.message);
          }
        }
        // 2. O evento do Discord começa e termina na hora
        const deDiscord = idDiscord.get(ev.id) ? guild.scheduledEvents.cache?.get(idDiscord.get(ev.id)) ?? await guild.scheduledEvents.fetch(idDiscord.get(ev.id)).catch(() => null) : null;
        if (deDiscord) {
          if (agora >= inicio && agora < fim && deDiscord.status === GuildScheduledEventStatus.Scheduled) {
            await deDiscord.setStatus(GuildScheduledEventStatus.Active).catch(log);
          } else if (agora >= fim && deDiscord.status === GuildScheduledEventStatus.Active) {
            await deDiscord.setStatus(GuildScheduledEventStatus.Completed).catch(log);
          }
        }
        // 3. Acabou: confirma presenças e, se for aula, pede a avaliação no chat do canal
        if (agora >= fim && !feitos.has(ev.id)) {
          const { error: e2 } = await adm.from('discord_avaliacoes').insert({ evento_id: ev.id, canal_id: ev.canal_voz_id });
          if (e2) continue; // outra instância já processou
          const { data: qtd } = await adm.rpc('confirmar_presenca_voz', { p_evento: ev.id });
          if (ev.tipo === 'aula') await pedirAvaliacao(guild, ev, qtd ?? 0);
        }
      } catch (e) {
        console.error(`⚠️  Call do evento ${ev.id}:`, e.message);
      }
    }
  } finally {
    rodandoVoz = false;
  }
}

async function pedirAvaliacao(guild, ev, presencas) {
  const { botoesNota } = await import('./cmd-aulas.js');
  const { embed, COR } = await import('./ui.js');
  const adm = clienteAdmin();
  const ate = Math.floor((new Date(ev.fim).getTime() + 48 * 3600_000) / 1000);
  const mensagem = {
    embeds: [
      embed(
        `🎓 A aula “${cortar(ev.titulo, 80)}” terminou`,
        [
          `Quem participou pela call pode avaliar de 1 a 5 estrelas até <t:${ate}:f>. A nota é **anônima**.`,
          'Com boas avaliações, quem ensinou ganha reputação — e Dracmas.',
          presencas ? `\n${presencas} presença(s) confirmada(s) automaticamente.` : '',
        ].join('\n'),
        COR.dourado,
      ),
    ],
    components: botoesNota(ev.id),
  };
  const canal = guild.channels?.cache?.get(ev.canal_voz_id);
  try {
    if (!canal?.send) throw new Error('canal sem chat');
    const enviada = await canal.send(mensagem);
    await adm.from('discord_avaliacoes').update({ mensagem_id: enviada.id }).eq('evento_id', ev.id);
  } catch (e) {
    // Sem permissão no chat do canal: manda por mensagem direta para quem participou
    console.warn(`⚠️  Não consegui postar no chat do canal ${ev.canal_voz_id} (${e.message}); enviando por mensagem direta.`);
    const [{ data: pv }, { data: min }] = await Promise.all([
      adm.from('presencas_voz').select('discord_id, minutos').eq('evento_id', ev.id),
      adm.rpc('minutos_minimos_presenca', { p_evento: ev.id }),
    ]);
    for (const p of (pv ?? []).filter((x) => x.minutos >= (min ?? 0))) {
      const membro = await guild.members.fetch(p.discord_id).catch(() => null);
      await membro?.send(mensagem).catch(() => null);
    }
  }
}

/** Edita a mensagem das estrelas com o resultado quando a avaliação fecha. */
async function publicarResultados(guild) {
  const adm = clienteAdmin();
  const { data: pendentes } = await adm.from('discord_avaliacoes')
    .select('evento_id, canal_id, mensagem_id, evento:eventos(titulo, avaliacao_fechada_em, avaliacao_media, avaliacao_total, criado_por)')
    .is('resultado_publicado_em', null).not('mensagem_id', 'is', null).limit(20);
  const { embed, COR } = await import('./ui.js');
  for (const p of pendentes ?? []) {
    if (!p.evento?.avaliacao_fechada_em) continue;
    try {
      const { data: rep } = await adm.from('reputacao_eventos').select('pontos').eq('acao', 'aula_ministrada').eq('referencia_id', p.evento_id).maybeSingle();
      const canal = guild.channels?.cache?.get(p.canal_id);
      const msg = await canal?.messages?.fetch(p.mensagem_id).catch(() => null);
      const media = Number(p.evento.avaliacao_media ?? 0).toFixed(1).replace('.', ',');
      if (msg) {
        await msg.edit({
          embeds: [
            embed(
              `🎓 Avaliação encerrada: ${cortar(p.evento.titulo, 80)}`,
              p.evento.avaliacao_total
                ? `${'⭐'.repeat(Math.round(Number(p.evento.avaliacao_media)))} **${media}** em ${p.evento.avaliacao_total} avaliação(ões).\n${rep ? `Quem ensinou ganhou **${rep.pontos} pontos de reputação = ${rep.pontos} DRC**. Obrigado a todos!` : 'Desta vez a aula não somou pontos (são precisas 3 avaliações de membros com conta de 7+ dias e média 3,5).'}`
                : 'Ninguém avaliou desta vez.',
              COR.dourado,
            ),
          ],
          components: [],
        });
      }
      await adm.from('discord_avaliacoes').update({ resultado_publicado_em: new Date().toISOString() }).eq('evento_id', p.evento_id);
    } catch (e) {
      console.error(`⚠️  Resultado da aula ${p.evento_id}:`, e.message);
    }
  }
}
