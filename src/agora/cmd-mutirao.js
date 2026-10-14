// ============================================
// agora/cmd-mutirao.js — /mutirao: projetos, tarefas, horas, eventos, caixa e doações
// ============================================

import {
  ActionRowBuilder, AttachmentBuilder, ButtonStyle, ChannelType, ModalBuilder, SlashCommandBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { acessoDe, dados } from './cliente.js';
import { perfisPorIds } from './cmd-biblioteca.js';
import { agendarSincronizacao } from './eventos-discord.js';
import {
  COR, botao, comoMembro, cortar, data as dataBr, dataHora, embed, erro, idDaOpcao, linha, menuAbrir, moeda, nomePublico, numero, opcoes, plural, relativo, responder,
} from './ui.js';

const ROTULO_STATUS_PROJETO = { planejamento: 'Em planejamento', ativo: 'Ativo', concluido: 'Concluído', cancelado: 'Cancelado' };
const ROTULO_TAREFA = { a_fazer: 'A fazer', fazendo: 'Fazendo', feito: 'Feito' };
const ROTULO_RSVP = { vou: 'Vou', talvez: 'Talvez', nao_vou: 'Não vou' };
const ICONE_TIPO = { mutirao: '🤝 ', aula: '🎓 ', assembleia: '🗳️ ', encontro: '☕ ' };

const opProjeto = (o, obrig = true) => o.setName('projeto').setDescription('Projeto').setRequired(obrig).setAutocomplete(true);
const opEvento = (o) => o.setName('evento').setDescription('Evento').setRequired(true).setAutocomplete(true);

export const data = new SlashCommandBuilder()
  .setName('mutirao')
  .setDescription('Mutirão: ações solidárias com caixa 100% transparente.')
  .addSubcommand((s) => s.setName('projetos').setDescription('Projetos ativos e em planejamento.'))
  .addSubcommand((s) => s.setName('projeto').setDescription('Detalhes, tarefas e caixa de um projeto.').addStringOption((o) => opProjeto(o)))
  .addSubcommand((s) => s.setName('tarefas').setDescription('As tarefas que estão com você.'))
  .addSubcommand((s) =>
    s.setName('horas').setDescription('Registra horas de voluntariado (a coordenação confirma).')
      .addStringOption((o) => opProjeto(o))
      .addNumberOption((o) => o.setName('horas').setDescription('Quantas horas (ex.: 2.5)').setRequired(true).setMinValue(0.25).setMaxValue(24))
      .addStringOption((o) => o.setName('descricao').setDescription('O que você fez').setRequired(true).setMinLength(5).setMaxLength(500)),
  )
  .addSubcommand((s) => s.setName('confirmar-horas').setDescription('Horas pendentes nos projetos que você coordena.'))
  .addSubcommand((s) => s.setName('eventos').setDescription('Próximos eventos.'))
  .addSubcommand((s) => s.setName('evento').setDescription('Detalhes do evento e sua presença.').addStringOption((o) => opEvento(o)))
  .addSubcommand((s) =>
    s.setName('novo-evento').setDescription('Marca um evento (coordenação do projeto ou nível Guardião). Vira evento do Discord.')
      .addStringOption((o) => opProjeto(o, false))
      .addChannelOption((o) =>
        o.setName('canal').setDescription('Encontro pela call? Escolha o canal de voz: a presença conta sozinha').setRequired(false)
          .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
      ),
  )
  .addSubcommand((s) =>
    s.setName('checkin').setDescription('Confirma presença no evento com o código mostrado pela organização.')
      .addStringOption((o) => opEvento(o))
      .addStringOption((o) => o.setName('codigo').setDescription('Código de check-in').setRequired(true).setMaxLength(200)),
  )
  .addSubcommand((s) => s.setName('caixa').setDescription('Lançamentos do caixa transparente de um projeto.').addStringOption((o) => opProjeto(o)))
  .addSubcommand((s) =>
    s.setName('doar').setDescription('Gera um Pix para doar a um projeto (vira entrada pública no caixa).')
      .addStringOption((o) => opProjeto(o))
      .addNumberOption((o) => o.setName('valor').setDescription('Valor em reais').setRequired(true).setMinValue(1).setMaxValue(50000))
      .addBooleanOption((o) => o.setName('anonima').setDescription('Não mostrar seu nome no caixa').setRequired(false)),
  );

// ------------------------------------------------------------------ autocompletar
export async function autocomplete(interaction) {
  const foco = interaction.options.getFocused(true);
  const termo = String(foco.value ?? '').trim();
  const { sb } = await acessoDe(interaction);
  if (foco.name === 'projeto') {
    let q = sb.from('projetos').select('id, titulo').is('excluido_em', null).in('status', ['planejamento', 'ativo', 'concluido']).order('created_at', { ascending: false }).limit(25);
    if (termo) q = q.ilike('titulo', `%${termo}%`);
    return interaction.respond(opcoes(await dados(q)));
  }
  if (foco.name === 'evento') {
    let q = sb.from('eventos').select('id, titulo, inicio').is('excluido_em', null).gte('fim', new Date(Date.now() - 2 * 3600_000).toISOString()).order('inicio').limit(25);
    if (termo) q = q.ilike('titulo', `%${termo}%`);
    return interaction.respond(opcoes(await dados(q), (e) => `${e.titulo} · ${dataBr(e.inicio)}`));
  }
  return interaction.respond([]);
}

// ------------------------------------------------------------------ comandos
export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const projetoId = idDaOpcao(interaction.options.getString('projeto'));
  const eventoId = idDaOpcao(interaction.options.getString('evento'));
  switch (sub) {
    case 'projetos': return projetos(interaction);
    case 'projeto': return mostrarProjeto(interaction, projetoId);
    case 'tarefas': return minhasTarefas(interaction);
    case 'horas': return registrarHoras(interaction, projetoId);
    case 'confirmar-horas': return horasPendentes(interaction);
    case 'eventos': return eventos(interaction);
    case 'evento': return mostrarEvento(interaction, eventoId);
    case 'novo-evento': return interaction.showModal(modalEvento(projetoId, interaction.options.getChannel?.('canal')?.id ?? null));
    case 'checkin': return checkin(interaction, eventoId);
    case 'caixa': return caixa(interaction, projetoId);
    case 'doar': return doar(interaction, projetoId);
  }
}

async function resumos(sb, ids) {
  if (!ids.length) return {};
  const lista = await dados(sb.from('caixa_resumo').select('*').in('projeto_id', ids));
  return Object.fromEntries(lista.map((r) => [r.projeto_id, r]));
}

export async function projetos(interaction) {
  return comoMembro(interaction, async ({ sb }) => {
    const lista = await dados(
      sb.from('projetos').select('id, titulo, causa, status, meta_financeira, nucleo:nucleos(cidade, estado)').is('excluido_em', null)
        .in('status', ['planejamento', 'ativo']).order('created_at', { ascending: false }).limit(15),
    );
    if (!lista.length) return responder(interaction, { embeds: [embed('Mutirão', 'Nenhum projeto ativo agora.', COR.neutra)] });
    const r = await resumos(sb, lista.map((p) => p.id));
    return responder(interaction, {
      embeds: [
        embed(
          'Projetos do Mutirão',
          lista.map((p) => `**${cortar(p.titulo, 90)}** · ${ROTULO_STATUS_PROJETO[p.status]}\n${p.causa}${p.nucleo ? ` · ${p.nucleo.cidade}/${p.nucleo.estado}` : ''} · caixa ${moeda(r[p.id]?.saldo ?? 0)}${p.meta_financeira ? ` de ${moeda(p.meta_financeira)}` : ''}`).join('\n\n'),
          COR.secundaria,
        ),
      ],
      components: [menuAbrir('mutirao:abrir-projeto', 'Abrir um projeto…', lista.map((p) => ({ rotulo: p.titulo, valor: p.id, descricao: p.causa })))],
    });
  });
}

export async function mostrarProjeto(interaction, id) {
  if (!id) return comoMembro(interaction, async () => erro(interaction, 'Escolha um projeto da lista.'));
  return comoMembro(interaction, async ({ sb, perfil }) => {
    const p = await dados(sb.from('projetos').select('id, titulo, descricao_md, causa, status, coordenador_id, meta_financeira, data_inicio, data_fim, nucleo:nucleos(cidade, estado)').eq('id', id).maybeSingle());
    if (!p) return erro(interaction, 'Projeto não encontrado.');
    const [membros, tarefas, r] = await Promise.all([
      dados(sb.from('projeto_membros').select('profile_id, papel').eq('projeto_id', id)),
      dados(sb.from('tarefas').select('id, titulo, status, responsavel_id, prazo').eq('projeto_id', id).order('prazo', { ascending: true, nullsFirst: false })),
      resumos(sb, [id]),
    ]);
    const perfis = await perfisPorIds(sb, [p.coordenador_id, ...tarefas.map((t) => t.responsavel_id)]);
    const resumo = r[id];
    const souMembro = membros.some((m) => m.profile_id === perfil.id);
    const e = embed(
      p.titulo,
      `${ROTULO_STATUS_PROJETO[p.status]} · ${p.causa}${p.nucleo ? ` · ${p.nucleo.cidade}/${p.nucleo.estado}` : ''}\nCoordenação: **${nomePublico(perfis[p.coordenador_id])}** · ${plural(membros.length, 'pessoa', 'pessoas')} no projeto\n\n${cortar(p.descricao_md, 1500)}`,
      COR.secundaria,
    );
    e.addFields({
      name: 'Caixa transparente',
      value: `Saldo **${moeda(resumo?.saldo ?? 0)}** · entradas ${moeda(resumo?.total_entradas ?? 0)} · saídas ${moeda(resumo?.total_saidas ?? 0)}${p.meta_financeira ? `\nMeta: ${moeda(p.meta_financeira)}` : ''}`,
    });
    const abertas = tarefas.filter((t) => t.status !== 'feito');
    if (abertas.length) {
      e.addFields({
        name: `Tarefas abertas (${abertas.length})`,
        value: cortar(abertas.slice(0, 10).map((t) => `${t.status === 'fazendo' ? '🔄' : '▫️'} ${cortar(t.titulo, 70)}${t.responsavel_id ? ` · ${nomePublico(perfis[t.responsavel_id])}` : ' · livre'}${t.prazo ? ` · até ${dataBr(`${t.prazo}T12:00:00`)}` : ''}`).join('\n'), 1024),
      });
    }
    const componentes = [
      linha(
        !souMembro && ['planejamento', 'ativo'].includes(p.status) ? botao(`mutirao:participar:${id}`, 'Quero participar', ButtonStyle.Primary, '🤝') : null,
        botao(`mutirao:ver-caixa:${id}`, 'Ver caixa', ButtonStyle.Secondary, '📒'),
        botao(`mutirao:doar:${id}`, 'Doar via Pix', ButtonStyle.Success, '💚'),
      ),
    ];
    if (abertas.length) {
      componentes.push(menuAbrir('mutirao:abrir-tarefa', 'Abrir uma tarefa…', abertas.map((t) => ({ rotulo: t.titulo, valor: t.id, descricao: ROTULO_TAREFA[t.status] }))));
    }
    return responder(interaction, { embeds: [e], components: componentes });
  });
}

async function mostrarTarefa(interaction, id) {
  return comoMembro(interaction, async ({ sb, perfil }) => {
    const t = await dados(sb.from('tarefas').select('*, projeto:projetos(id, titulo)').eq('id', id).maybeSingle());
    if (!t) return erro(interaction, 'Tarefa não encontrada.');
    const perfis = await perfisPorIds(sb, [t.responsavel_id]);
    const minha = t.responsavel_id === perfil.id;
    const e = embed(
      t.titulo,
      `Projeto: **${t.projeto?.titulo ?? '—'}**\nStatus: **${ROTULO_TAREFA[t.status]}**${t.responsavel_id ? ` · com ${nomePublico(perfis[t.responsavel_id])}` : ' · livre'}${t.prazo ? `\nPrazo: ${dataBr(`${t.prazo}T12:00:00`)}` : ''}${t.horas_estimadas ? ` · estimativa ${numero(t.horas_estimadas)} h` : ''}${t.descricao ? `\n\n${cortar(t.descricao, 1500)}` : ''}`,
      COR.secundaria,
    );
    const botoes = [];
    if (!t.responsavel_id && t.status !== 'feito') botoes.push(botao(`mutirao:tarefa:${id}:assumir`, 'Assumir', ButtonStyle.Primary, '🙋'));
    if (minha && t.status === 'a_fazer') botoes.push(botao(`mutirao:tarefa:${id}:fazendo`, 'Comecei', ButtonStyle.Secondary, '🔄'));
    if (minha && t.status !== 'feito') botoes.push(botao(`mutirao:tarefa:${id}:feito`, 'Concluí', ButtonStyle.Success, '✅'));
    if (minha && t.status !== 'feito') botoes.push(botao(`mutirao:tarefa:${id}:liberar`, 'Liberar', ButtonStyle.Secondary));
    if (minha) botoes.push(botao(`mutirao:horas-tarefa:${t.projeto_id}:${id}`, 'Registrar horas', ButtonStyle.Secondary, '⏱️'));
    return responder(interaction, { embeds: [e], components: botoes.length ? [linha(...botoes)] : [] });
  });
}

export async function minhasTarefas(interaction) {
  return comoMembro(interaction, async ({ sb, perfil }) => {
    const lista = await dados(sb.from('tarefas').select('id, titulo, status, prazo, projeto:projetos(titulo)').eq('responsavel_id', perfil.id).neq('status', 'feito').order('prazo', { nullsFirst: false }));
    if (!lista.length) return responder(interaction, { embeds: [embed('Minhas tarefas', 'Nenhuma tarefa com você. Escolha uma em `/mutirao projeto`.', COR.neutra)] });
    return responder(interaction, {
      embeds: [embed('Minhas tarefas', lista.map((t) => `${t.status === 'fazendo' ? '🔄' : '▫️'} **${cortar(t.titulo, 80)}** · ${t.projeto?.titulo ?? ''}${t.prazo ? ` · até ${dataBr(`${t.prazo}T12:00:00`)}` : ''}`).join('\n'), COR.secundaria)],
      components: [menuAbrir('mutirao:abrir-tarefa', 'Abrir uma tarefa…', lista.map((t) => ({ rotulo: t.titulo, valor: t.id, descricao: t.projeto?.titulo })))],
    });
  });
}

async function registrarHoras(interaction, projetoId, tarefaId = null, horasModal = null, descricaoModal = null) {
  const horas = horasModal ?? interaction.options.getNumber('horas');
  const descricao = descricaoModal ?? interaction.options.getString('descricao');
  return comoMembro(interaction, async ({ sb, perfil }) => {
    if (!projetoId) return erro(interaction, 'Escolha um projeto da lista.');
    await dados(sb.from('horas_voluntariado').insert({ projeto_id: projetoId, tarefa_id: tarefaId, profile_id: perfil.id, horas, descricao }));
    return responder(interaction, {
      embeds: [embed('Horas registradas', `**${numero(horas)} h** enviadas para a coordenação confirmar. Quando confirmadas, viram reputação (e Dracmas).`, COR.secundaria)],
    });
  });
}

export async function horasPendentes(interaction) {
  return comoMembro(interaction, async ({ sb, perfil }) => {
    const [coordeno, comoMembroCoord] = await Promise.all([
      dados(sb.from('projetos').select('id').eq('coordenador_id', perfil.id)),
      dados(sb.from('projeto_membros').select('projeto_id').eq('profile_id', perfil.id).eq('papel', 'coordenador')),
    ]);
    const ids = [...new Set([...coordeno.map((p) => p.id), ...comoMembroCoord.map((m) => m.projeto_id)])];
    if (!ids.length) return erro(interaction, 'Você não coordena nenhum projeto.');
    const lista = await dados(
      sb.from('horas_voluntariado').select('id, profile_id, horas, descricao, created_at, projeto:projetos(titulo)').in('projeto_id', ids)
        .is('confirmado_em', null).is('recusado_em', null).neq('profile_id', perfil.id).order('created_at').limit(25),
    );
    if (!lista.length) return responder(interaction, { embeds: [embed('Horas pendentes', 'Nada para confirmar agora. 👍', COR.secundaria)] });
    const perfis = await perfisPorIds(sb, lista.map((h) => h.profile_id));
    return responder(interaction, {
      embeds: [embed('Horas pendentes', lista.map((h) => `**${nomePublico(perfis[h.profile_id])}** · ${numero(h.horas)} h · ${h.projeto?.titulo ?? ''} · ${relativo(h.created_at)}\n${cortar(h.descricao, 150)}`).join('\n\n'), COR.dourado)],
      components: [menuAbrir('mutirao:abrir-horas', 'Analisar um registro…', lista.map((h) => ({ rotulo: `${nomePublico(perfis[h.profile_id])} · ${numero(h.horas)} h`, valor: h.id, descricao: h.descricao })))],
    });
  });
}

async function analisarHoras(interaction, id) {
  return comoMembro(interaction, async ({ sb }) => {
    const h = await dados(sb.from('horas_voluntariado').select('id, profile_id, horas, descricao, created_at, projeto:projetos(titulo)').eq('id', id).maybeSingle());
    if (!h) return erro(interaction, 'Registro não encontrado.');
    const perfis = await perfisPorIds(sb, [h.profile_id]);
    return responder(interaction, {
      embeds: [embed(`${numero(h.horas)} h · ${nomePublico(perfis[h.profile_id])}`, `${h.projeto?.titulo ?? ''} · registrado ${relativo(h.created_at)}\n\n${h.descricao}`, COR.dourado)],
      components: [
        linha(
          botao(`mutirao:confirmar:${id}:1`, 'Confirmar', ButtonStyle.Success, '✅'),
          botao(`mutirao:confirmar:${id}:0`, 'Recusar', ButtonStyle.Danger, '✖️'),
        ),
      ],
    });
  });
}

export async function eventos(interaction) {
  return comoMembro(interaction, async ({ sb }) => {
    const lista = await dados(
      sb.from('eventos').select('id, tipo, titulo, inicio, fim, local_nome, canal_voz_id, nucleo:nucleos(cidade, estado), projeto:projetos(titulo)').is('excluido_em', null)
        .gte('fim', new Date().toISOString()).order('inicio').limit(15),
    );
    if (!lista.length) return responder(interaction, { embeds: [embed('Eventos', 'Nenhum evento marcado por enquanto.', COR.neutra)] });
    return responder(interaction, {
      embeds: [embed('Próximos eventos', lista.map((e) => `${ICONE_TIPO[e.tipo] ?? ''}**${cortar(e.titulo, 90)}** · <t:${Math.floor(new Date(e.inicio).getTime() / 1000)}:f>\n${[e.canal_voz_id ? `🔊 <#${e.canal_voz_id}>` : e.local_nome, e.nucleo ? `${e.nucleo.cidade}/${e.nucleo.estado}` : null, e.projeto?.titulo].filter(Boolean).join(' · ')}`).join('\n\n'), COR.secundaria)],
      components: [menuAbrir('mutirao:abrir-evento', 'Abrir um evento…', lista.map((e) => ({ rotulo: e.titulo, valor: e.id, descricao: dataHora(e.inicio) })))],
    });
  });
}

export async function mostrarEvento(interaction, id) {
  if (!id) return comoMembro(interaction, async () => erro(interaction, 'Escolha um evento da lista.'));
  return comoMembro(interaction, async ({ sb, perfil }) => {
    const ev = await dados(sb.from('eventos').select('*, nucleo:nucleos(cidade, estado), projeto:projetos(titulo), proposta:propostas(titulo)').eq('id', id).maybeSingle());
    if (!ev) return erro(interaction, 'Evento não encontrado.');
    if (ev.tipo === 'aula') return (await import('./cmd-aulas.js')).mostrarAula(interaction, id);
    const rsvps = await dados(sb.from('rsvps').select('profile_id, status, presente').eq('evento_id', id));
    const meu = rsvps.find((r) => r.profile_id === perfil.id);
    const confirmados = rsvps.filter((r) => r.status === 'vou').length;
    const t0 = Math.floor(new Date(ev.inicio).getTime() / 1000);
    const t1 = Math.floor(new Date(ev.fim).getTime() / 1000);
    const e = embed(
      ev.titulo,
      `${ev.tipo === 'assembleia' ? `🗳️ Debate ao vivo da proposta **${ev.proposta?.titulo ?? ''}**\n` : ''}<t:${t0}:F> até <t:${t1}:t> (<t:${t0}:R>)\n${ev.canal_voz_id ? `🔊 <#${ev.canal_voz_id}> — a presença conta sozinha pela call` : [ev.local_nome, ev.endereco].filter(Boolean).join(' — ')}${ev.nucleo ? `\nNúcleo ${ev.nucleo.cidade}/${ev.nucleo.estado}` : ''}${ev.projeto ? ` · ${ev.projeto.titulo}` : ''}\n\n${cortar(ev.descricao ?? '', 1500)}`,
      COR.secundaria,
    );
    e.addFields({
      name: 'Presença',
      value: `${plural(confirmados, 'pessoa confirmada', 'pessoas confirmadas')}${ev.vagas ? ` de ${ev.vagas} vagas` : ''}\nSua resposta: **${meu ? ROTULO_RSVP[meu.status] : 'ainda não respondeu'}**${meu?.presente ? ' · ✅ presença confirmada' : ''}`,
    });
    const componentes = [
      linha(
        botao(`mutirao:rsvp:${id}:vou`, 'Vou', meu?.status === 'vou' ? ButtonStyle.Success : ButtonStyle.Secondary, '✅'),
        botao(`mutirao:rsvp:${id}:talvez`, 'Talvez', meu?.status === 'talvez' ? ButtonStyle.Primary : ButtonStyle.Secondary, '🤔'),
        botao(`mutirao:rsvp:${id}:nao_vou`, 'Não vou', meu?.status === 'nao_vou' ? ButtonStyle.Danger : ButtonStyle.Secondary),
      ),
    ];
    if ((ev.criado_por === perfil.id || perfil.papel === 'admin') && !ev.canal_voz_id) {
      componentes.push(linha(botao(`mutirao:codigo:${id}`, 'Mostrar código de check-in (organização)', ButtonStyle.Secondary, '🔑')));
    }
    return responder(interaction, { embeds: [e], components: componentes });
  });
}

async function checkin(interaction, eventoId) {
  const codigo = interaction.options.getString('codigo').trim();
  return comoMembro(interaction, async ({ sb }) => {
    const conteudo = codigo.startsWith('agora-checkin:') ? codigo : eventoId ? `agora-checkin:${eventoId}:${codigo}` : null;
    if (!conteudo) return erro(interaction, 'Escolha o evento da lista.');
    const id = await dados(sb.rpc('fazer_checkin', { p_conteudo_qr: conteudo }));
    const ev = await dados(sb.from('eventos').select('titulo').eq('id', id).maybeSingle());
    return responder(interaction, { embeds: [embed('Presença confirmada!', `Bom evento${ev ? ` — **${ev.titulo}**` : ''}. A presença conta para sua reputação.`, COR.secundaria)] });
  });
}

async function caixa(interaction, id) {
  if (!id) return comoMembro(interaction, async () => erro(interaction, 'Escolha um projeto da lista.'));
  return comoMembro(interaction, async ({ sb }) => {
    const p = await dados(sb.from('projetos').select('id, titulo').eq('id', id).maybeSingle());
    if (!p) return erro(interaction, 'Projeto não encontrado.');
    const [lancs, r] = await Promise.all([
      dados(sb.from('caixa_lancamentos').select('tipo, valor, descricao, categoria, data, comprovante_url, estorno_de').eq('projeto_id', id).order('data', { ascending: false }).order('created_at', { ascending: false }).limit(20)),
      resumos(sb, [id]),
    ]);
    const resumo = r[id];
    const e = embed(
      `Caixa · ${p.titulo}`,
      `Saldo **${moeda(resumo?.saldo ?? 0)}** · entradas ${moeda(resumo?.total_entradas ?? 0)} · saídas ${moeda(resumo?.total_saidas ?? 0)} · ${plural(resumo?.lancamentos ?? 0, 'lançamento')}\n\n${
        lancs.length
          ? lancs.map((l) => `${l.tipo === 'entrada' ? '🟢 +' : '🔴 −'}${moeda(l.valor)} · ${dataBr(`${l.data}T12:00:00`)} · ${l.categoria}${l.estorno_de ? ' · estorno' : ''}\n${cortar(l.descricao, 120)}${l.comprovante_url ? ' · 📎 comprovante' : ''}`).join('\n')
          : 'Nenhum lançamento ainda.'
      }\n\nLançamentos nunca são apagados: correções aparecem como estorno.`,
      COR.secundaria,
    );
    return responder(interaction, { embeds: [e], components: [linha(botao(`mutirao:doar:${id}`, 'Doar via Pix', ButtonStyle.Success, '💚'))] });
  });
}

async function doar(interaction, projetoId, valorModal = null) {
  const valor = valorModal ?? interaction.options.getNumber('valor');
  const anonima = interaction.options?.getBoolean?.('anonima') ?? false;
  return comoMembro(interaction, async ({ sb }) => {
    if (!projetoId) return erro(interaction, 'Escolha um projeto da lista.');
    const { data: cobranca, error } = await sb.functions.invoke('criar-doacao', { body: { projeto_id: projetoId, valor, anonima } });
    if (error || !cobranca?.pix_copia_cola) return erro(interaction, 'Não foi possível gerar o Pix agora. Tente de novo em instantes.');
    const files = [];
    const e = embed(
      `Pix de ${moeda(cobranca.valor ?? valor)}`,
      `Copie o código abaixo no app do seu banco (Pix copia e cola). Vale até ${dataHora(cobranca.expira_em)}.\n\`\`\`\n${cobranca.pix_copia_cola}\n\`\`\`\nQuando o pagamento for confirmado, ele entra **automaticamente** no caixa público do projeto${anonima ? ' (sem seu nome)' : ''}.${cobranca.simulado ? '\n\n⚠️ Ambiente de teste: este Pix é simulado.' : ''}`,
      COR.secundaria,
    );
    if (cobranca.qr_code_base64) {
      files.push(new AttachmentBuilder(Buffer.from(cobranca.qr_code_base64, 'base64'), { name: 'pix.png' }));
      e.setImage('attachment://pix.png');
    }
    return responder(interaction, { embeds: [e], files, components: [linha(botao(`mutirao:status-doacao:${cobranca.doacao_id}`, 'Já paguei — conferir', ButtonStyle.Secondary, '🔁'))] });
  });
}

// ------------------------------------------------------------------ botões, menus e formulários
export async function handleInteraction(interaction, partes) {
  const [acao, a1, a2] = partes;
  const valor = interaction.values?.[0];

  if (acao === 'abrir-projeto') return mostrarProjeto(interaction, valor);
  if (acao === 'abrir-tarefa') return mostrarTarefa(interaction, valor);
  if (acao === 'abrir-evento') return mostrarEvento(interaction, valor);
  if (acao === 'abrir-horas') return analisarHoras(interaction, valor);
  if (acao === 'ver-caixa') return caixa(interaction, a1);

  if (acao === 'doar') {
    return interaction.showModal(
      new ModalBuilder().setCustomId(`mutirao:m-doar:${a1}`).setTitle('Doar via Pix').addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('valor').setLabel('Valor em reais (ex.: 25,00)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(12)),
      ),
    );
  }
  if (acao === 'horas-tarefa') {
    return interaction.showModal(
      new ModalBuilder().setCustomId(`mutirao:m-horas:${a1}:${a2}`).setTitle('Registrar horas').addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('horas').setLabel('Horas (ex.: 2,5)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(5)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('descricao').setLabel('O que você fez').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(5).setMaxLength(500)),
      ),
    );
  }

  await interaction.deferUpdate();
  return comoMembro(interaction, async ({ sb, perfil }) => {
    if (acao === 'participar') {
      await dados(sb.from('projeto_membros').upsert({ projeto_id: a1, profile_id: perfil.id, papel: 'voluntario' }, { ignoreDuplicates: true }));
      return mostrarProjeto(interaction, a1);
    }
    if (acao === 'tarefa') {
      const campos = a2 === 'assumir' ? { responsavel_id: perfil.id } : a2 === 'liberar' ? { responsavel_id: null, status: 'a_fazer' } : { status: a2 };
      await dados(sb.from('tarefas').update(campos).eq('id', a1).select('id').single());
      return mostrarTarefa(interaction, a1);
    }
    if (acao === 'rsvp') {
      await dados(sb.from('rsvps').upsert({ evento_id: a1, profile_id: perfil.id, status: a2 }));
      return mostrarEvento(interaction, a1);
    }
    if (acao === 'confirmar') {
      await dados(sb.rpc('confirmar_horas', { p_registro: a1, p_aprovar: a2 === '1' }));
      return responder(interaction, { embeds: [embed(a2 === '1' ? 'Horas confirmadas' : 'Horas recusadas', a2 === '1' ? 'A pessoa ganhou a reputação correspondente. Obrigado por coordenar!' : 'Registro recusado. A pessoa foi notificada.', COR.secundaria)] });
    }
    if (acao === 'codigo') {
      const codigo = await dados(sb.rpc('codigo_checkin_evento', { p_evento: a1 }));
      const curto = String(codigo).split(':')[2];
      return responder(interaction, { embeds: [embed('Código de check-in', `Mostre este código para quem estiver no evento usar em \`/mutirao checkin\`:\n# ${curto}\nO check-in abre 1 hora antes do início e fecha 2 horas depois do fim.`, COR.dourado)] });
    }
    if (acao === 'status-doacao') {
      const { data: r } = await sb.functions.invoke('criar-doacao', { body: { consultar: a1 } });
      const status = r?.status ?? 'pendente';
      const texto = { pendente: 'Ainda não recebemos a confirmação do pagamento. Pode levar alguns minutos.', confirmada: '💚 Doação confirmada e lançada no caixa público. Obrigado!', falhou: 'O pagamento não foi concluído. Gere um novo Pix se quiser tentar de novo.' };
      return responder(interaction, { embeds: [embed('Status da doação', texto[status] ?? texto.pendente, COR.secundaria)], components: status === 'pendente' ? [linha(botao(`mutirao:status-doacao:${a1}`, 'Conferir de novo', ButtonStyle.Secondary, '🔁'))] : [] });
    }
  }, { adiar: false });
}

/** "1.234,56" → 1234.56 · "2,5" → 2.5 · "2.5" → 2.5 */
export function numeroBr(texto) {
  let t = String(texto).trim().replace(/[^\d.,]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return t && Number.isFinite(n) ? n : NaN;
}

export async function handleModalSubmit(interaction, partes) {
  const [tipo, a1, a2] = partes;
  if (tipo === 'm-evento') return criarEvento(interaction, a1 === '-' ? null : a1, a2 && a2 !== '-' ? a2 : null);
  if (tipo === 'm-doar') {
    const valor = numeroBr(interaction.fields.getTextInputValue('valor'));
    if (!(valor >= 1)) return comoMembro(interaction, async () => erro(interaction, 'Informe um valor de pelo menos R$ 1,00.'));
    return doar(interaction, a1, valor);
  }
  if (tipo === 'm-horas') {
    const horas = numeroBr(interaction.fields.getTextInputValue('horas'));
    if (!(horas > 0 && horas <= 24)) return comoMembro(interaction, async () => erro(interaction, 'Informe entre 0,25 e 24 horas.'));
    return registrarHoras(interaction, a1, a2, horas, interaction.fields.getTextInputValue('descricao').trim());
  }
}

// ------------------------------------------------------------------ novo evento
export function modalEvento(projetoId, canalId = null) {
  const campo = (id, rotulo, estilo, { min, max, obrig = true, placeholder } = {}) => {
    const c = new TextInputBuilder().setCustomId(id).setLabel(rotulo).setStyle(estilo).setRequired(obrig);
    if (min) c.setMinLength(min);
    if (max) c.setMaxLength(max);
    if (placeholder) c.setPlaceholder(placeholder);
    return new ActionRowBuilder().addComponents(c);
  };
  return new ModalBuilder().setCustomId(`mutirao:m-evento:${projetoId ?? '-'}:${canalId ?? '-'}`).setTitle(canalId ? 'Novo encontro pela call' : 'Novo evento do Mutirão').addComponents(
    campo('titulo', 'Título', TextInputStyle.Short, { min: 3, max: 120, placeholder: 'Ex.: Mutirão de pintura da escola' }),
    campo('inicio', 'Começa em (dia/mês/ano hora:min)', TextInputStyle.Short, { min: 10, max: 20, placeholder: '25/10/2026 14:00' }),
    campo('duracao', 'Duração em horas', TextInputStyle.Short, { max: 5, placeholder: '3' }),
    canalId
      ? campo('local', 'Local (opcional: é pela call)', TextInputStyle.Short, { max: 200, obrig: false, placeholder: 'Canal de voz do Discord' })
      : campo('local', 'Local (nome e endereço)', TextInputStyle.Short, { min: 3, max: 200, placeholder: 'Escola Estadual X — Rua Y, 123' }),
    campo('descricao', 'O que vamos fazer (opcional)', TextInputStyle.Paragraph, { max: 1500, obrig: false }),
  );
}

/** "25/10/2026 14:00" no horário de Brasília (UTC−3, sem horário de verão desde 2019) → Date */
export function dataHoraBr(texto) {
  const m = /^\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(?:às\s+)?(\d{1,2})(?::|h)?(\d{2})?\s*h?\s*$/i.exec(String(texto ?? ''));
  if (!m) return null;
  const [, d, mes, a, h, min] = m;
  let ano = a ? Number(a) : new Date().getFullYear();
  if (ano < 100) ano += 2000;
  if (Number(h) > 23 || Number(min ?? 0) > 59) return null;
  const dia = new Date(Date.UTC(ano, Number(mes) - 1, Number(d)));
  if (dia.getUTCDate() !== Number(d) || dia.getUTCMonth() !== Number(mes) - 1) return null; // 31/02 e afins
  return new Date(dia.getTime() + ((Number(h) + 3) * 60 + Number(min ?? 0)) * 60_000);
}

async function criarEvento(interaction, projetoId, canalId = null) {
  const texto = (c) => interaction.fields.getTextInputValue(c)?.trim() ?? '';
  return comoMembro(interaction, async ({ sb, perfil }) => {
    if (!projetoId && perfil.nivel < 4 && perfil.papel !== 'admin') {
      return erro(interaction, 'Eventos sem projeto são para o nível 4 (Guardião). Para um evento de projeto, escolha o projeto que você coordena em `/mutirao novo-evento projeto:`.');
    }
    const inicio = dataHoraBr(texto('inicio'));
    if (!inicio) return erro(interaction, 'Não entendi a data. Use o formato **25/10/2026 14:00** (horário de Brasília).');
    if (inicio.getTime() < Date.now() - 5 * 60_000) return erro(interaction, 'Essa data já passou.');
    const horas = numeroBr(texto('duracao'));
    if (!(horas > 0 && horas <= 72)) return erro(interaction, 'A duração precisa estar entre 0,5 e 72 horas.');
    const local = texto('local') || (canalId ? 'Canal de voz do Discord' : '');
    const [localNome, ...resto] = local.split(/\s+[—–-]\s+/);
    const ev = await dados(
      sb.from('eventos').insert({
        titulo: texto('titulo'),
        descricao: texto('descricao') || null,
        projeto_id: projetoId,
        criado_por: perfil.id,
        local_nome: localNome || local,
        canal_voz_id: canalId,
        endereco: resto.join(' — ') || null,
        inicio: inicio.toISOString(),
        fim: new Date(inicio.getTime() + horas * 3600_000).toISOString(),
      }).select('id').single(),
    );
    agendarSincronizacao();
    return mostrarEvento(interaction, ev.id);
  });
}
