// ============================================
// agora/cmd-aulas.js — /aulas: aulas pela call, presença automática e avaliação
// ============================================
// Quem é nível 2+ marca uma aula num canal de voz. O bot cria o evento do Discord
// apontando para o canal, conta quem fica na call (sem entrar nem falar) e, no fim,
// posta estrelas no chat do canal. Só quem participou avalia; com avaliações
// suficientes e média boa, quem ensinou ganha reputação — que vira Dracmas.

import {
  ActionRowBuilder, ButtonStyle, ChannelType, ModalBuilder, SlashCommandBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { config } from '../config.js';
import { acessoDe, clienteAdmin, dados, mensagemDeErro } from './cliente.js';
import { perfisPorIds } from './cmd-biblioteca.js';
import { dataHoraBr, numeroBr } from './cmd-mutirao.js';
import { agendarSincronizacao } from './eventos-discord.js';
import {
  COR, botao, comoMembro, cortar, embed, erro, idDaOpcao, linha, menuAbrir, numero, opcoes, plural, relativo, responder,
} from './ui.js';

const ESTRELAS = (n) => '⭐'.repeat(n);
const ts = (iso, f = 'f') => `<t:${Math.floor(new Date(iso).getTime() / 1000)}:${f}>`;

export const data = new SlashCommandBuilder()
  .setName('aulas')
  .setDescription('Aulas pela call: marque, participe e avalie. Quem ensina bem ganha Dracmas.')
  .addSubcommand((s) =>
    s.setName('nova').setDescription('Marca uma aula num canal de voz (nível Colaborador).')
      .addStringOption((o) => o.setName('tema').setDescription('Tema da Biblioteca').setRequired(false).setAutocomplete(true))
      .addChannelOption((o) =>
        o.setName('canal').setDescription('Canal de voz (padrão: o canal de aulas)').setRequired(false)
          .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
      ),
  )
  .addSubcommand((s) => s.setName('proximas').setDescription('Próximas aulas e as que estão acontecendo.'))
  .addSubcommand((s) =>
    s.setName('aula').setDescription('Detalhes de uma aula, presença e avaliação.')
      .addStringOption((o) => o.setName('aula').setDescription('Comece a digitar o título').setRequired(true).setAutocomplete(true)),
  )
  .addSubcommand((s) => s.setName('minhas').setDescription('Aulas que você deu e como foram avaliadas.'));

// ------------------------------------------------------------------ autocompletar
export async function autocomplete(interaction) {
  const foco = interaction.options.getFocused(true);
  const termo = String(foco.value ?? '').trim();
  const { sb } = await acessoDe(interaction);
  if (foco.name === 'tema') {
    let q = sb.from('temas').select('id, nome').order('ordem').limit(25);
    if (termo) q = q.ilike('nome', `%${termo}%`);
    return interaction.respond(opcoes((await dados(q)).map((t) => ({ id: t.id, titulo: t.nome }))));
  }
  let q = sb.from('eventos').select('id, titulo, inicio').eq('tipo', 'aula').is('excluido_em', null)
    .gte('fim', new Date(Date.now() - 3 * 86_400_000).toISOString()).order('inicio').limit(25);
  if (termo) q = q.ilike('titulo', `%${termo}%`);
  return interaction.respond(opcoes(await dados(q), (a) => `${a.titulo} · ${new Date(a.inicio).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`));
}

// ------------------------------------------------------------------ comandos
export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'nova') {
    const canal = interaction.options.getChannel?.('canal')?.id ?? config.agora.canalVozPadrao;
    return interaction.showModal(modalAula(idDaOpcao(interaction.options.getString('tema')), canal));
  }
  if (sub === 'proximas') return proximas(interaction);
  if (sub === 'aula') return mostrarAula(interaction, idDaOpcao(interaction.options.getString('aula')));
  if (sub === 'minhas') return minhas(interaction);
}

export function modalAula(temaId, canalId = config.agora.canalVozPadrao) {
  const campo = (id, rotulo, estilo, { min, max, obrig = true, placeholder, valor } = {}) => {
    const c = new TextInputBuilder().setCustomId(id).setLabel(rotulo).setStyle(estilo).setRequired(obrig);
    if (min) c.setMinLength(min);
    if (max) c.setMaxLength(max);
    if (placeholder) c.setPlaceholder(placeholder);
    if (valor) c.setValue(valor);
    return new ActionRowBuilder().addComponents(c);
  };
  return new ModalBuilder().setCustomId(`aulas:m-nova:${temaId ?? '-'}:${canalId ?? '-'}`).setTitle('Marcar aula').addComponents(
    campo('titulo', 'Título da aula', TextInputStyle.Short, { min: 5, max: 120, placeholder: 'Ex.: Introdução ao hermetismo' }),
    campo('inicio', 'Começa em (dia/mês/ano hora:min)', TextInputStyle.Short, { min: 5, max: 20, placeholder: '25/10/2026 20:00' }),
    campo('duracao', 'Duração em horas (máx. 4)', TextInputStyle.Short, { max: 5, valor: '1' }),
    campo('descricao', 'O que vai ser ensinado', TextInputStyle.Paragraph, { min: 20, max: 1500 }),
  );
}

async function criarAula(interaction, temaId, canalId) {
  const texto = (c) => interaction.fields.getTextInputValue(c)?.trim() ?? '';
  return comoMembro(interaction, async ({ sb, perfil }) => {
    if (perfil.nivel < 2 && perfil.papel !== 'admin') {
      return erro(interaction, `Dar aulas é a partir do nível 2 (Colaborador). Você está no nível ${perfil.nivel}: participe e contribua para subir.`);
    }
    const inicio = dataHoraBr(texto('inicio'));
    if (!inicio) return erro(interaction, 'Não entendi a data. Use o formato **25/10/2026 20:00** (horário de Brasília).');
    if (inicio.getTime() < Date.now() - 5 * 60_000) return erro(interaction, 'Essa data já passou.');
    const horas = numeroBr(texto('duracao'));
    if (!(horas >= 0.25 && horas <= 4)) return erro(interaction, 'A duração precisa estar entre 0,25 e 4 horas.');
    const aula = await dados(
      sb.from('eventos').insert({
        tipo: 'aula',
        titulo: texto('titulo'),
        descricao: texto('descricao'),
        tema_id: temaId,
        canal_voz_id: canalId,
        local_nome: 'Canal de voz do Discord',
        criado_por: perfil.id,
        inicio: inicio.toISOString(),
        fim: new Date(inicio.getTime() + horas * 3600_000).toISOString(),
      }).select('id').single(),
    );
    agendarSincronizacao();
    return mostrarAula(interaction, aula.id, 'Aula marcada! Ela já aparece na aba **Eventos** do servidor, com link para o canal de voz.');
  });
}

export async function proximas(interaction) {
  return comoMembro(interaction, async ({ sb }) => {
    const lista = await dados(
      sb.from('eventos').select('id, titulo, inicio, fim, canal_voz_id, criado_por, tema:temas(nome)').eq('tipo', 'aula').is('excluido_em', null)
        .gte('fim', new Date().toISOString()).order('inicio').limit(15),
    );
    if (!lista.length) {
      return responder(interaction, {
        embeds: [embed('Aulas', 'Nenhuma aula marcada agora. Sabe algo que vale ensinar? Marque com `/aulas nova` (nível 2).', COR.neutra)],
      });
    }
    const autores = await perfisPorIds(sb, lista.map((a) => a.criado_por));
    const agora = Date.now();
    return responder(interaction, {
      embeds: [
        embed(
          'Próximas aulas',
          lista.map((a) => {
            const aoVivo = new Date(a.inicio).getTime() <= agora;
            return `${aoVivo ? '🔴 **ao vivo** · ' : ''}**${cortar(a.titulo, 90)}** · ${ts(a.inicio)}\ncom ${autores[a.criado_por]?.nome_publico ?? 'Membro'}${a.tema?.nome ? ` · ${a.tema.nome}` : ''}${a.canal_voz_id ? ` · <#${a.canal_voz_id}>` : ''}`;
          }).join('\n\n'),
          COR.secundaria,
        ),
      ],
      components: [menuAbrir('aulas:abrir', 'Abrir uma aula…', lista.map((a) => ({ rotulo: a.titulo, valor: a.id, descricao: autores[a.criado_por]?.nome_publico })))].filter(Boolean),
    });
  });
}

/** Detalhe da aula: horário, canal, presença e — depois do fim — avaliação. */
export async function mostrarAula(interaction, id, aviso = null) {
  if (!id) return comoMembro(interaction, async () => erro(interaction, 'Escolha uma aula da lista.'));
  return comoMembro(interaction, async ({ sb, perfil }) => {
    const a = await dados(sb.from('eventos').select('*, tema:temas(nome)').eq('id', id).eq('tipo', 'aula').maybeSingle());
    if (!a) return erro(interaction, 'Aula não encontrada.');
    const [autores, rsvps, resumo, minha] = await Promise.all([
      perfisPorIds(sb, [a.criado_por]),
      dados(sb.from('rsvps').select('profile_id, status, presente').eq('evento_id', id)),
      dados(sb.rpc('resumo_avaliacoes', { p_evento: id })).then((r) => r?.[0] ?? null),
      dados(sb.from('avaliacoes_evento').select('nota, comentario').eq('evento_id', id).eq('profile_id', perfil.id).maybeSingle()),
    ]);
    const agora = Date.now();
    const terminou = new Date(a.fim).getTime() <= agora;
    const comecou = new Date(a.inicio).getTime() <= agora;
    const souProfessor = a.criado_por === perfil.id;
    const eu = rsvps.find((r) => r.profile_id === perfil.id);
    const vao = rsvps.filter((r) => r.status === 'vou').length;
    const presentes = rsvps.filter((r) => r.presente).length;
    const janelaAte = new Date(new Date(a.fim).getTime() + 48 * 3600_000).toISOString();

    const e = embed(
      `🎓 ${a.titulo}`,
      [
        aviso ? `✅ ${aviso}\n` : null,
        `Com **${autores[a.criado_por]?.nome_publico ?? 'Membro'}**${a.tema?.nome ? ` · ${a.tema.nome}` : ''}`,
        `${ts(a.inicio, 'F')} até ${ts(a.fim, 't')} (${relativo(comecou && !terminou ? a.fim : a.inicio)}${comecou && !terminou ? ' para acabar' : ''})`,
        a.canal_voz_id ? `🔊 <#${a.canal_voz_id}>` : null,
        '',
        cortar(a.descricao ?? '', 1500),
      ].filter((x) => x !== null).join('\n'),
      COR.secundaria,
    );
    e.addFields({
      name: 'Como funciona',
      value: 'Entre no canal de voz na hora: a **presença conta sozinha** (fique pelo menos metade da aula, até 30 min). No fim, quem participou avalia de 1 a 5 estrelas, de forma anônima, por 48 horas.',
    });
    if (!terminou) {
      e.addFields({ name: 'Participação', value: `${plural(vao, 'pessoa disse que vai', 'pessoas disseram que vão')}\nVocê: **${souProfessor ? 'é quem dá a aula' : eu?.status === 'vou' ? 'vai' : eu?.status === 'talvez' ? 'talvez' : eu?.status === 'nao_vou' ? 'não vai' : 'ainda não respondeu'}**` });
    } else {
      const fechada = a.avaliacao_fechada_em;
      const linhas = [
        `${plural(presentes, 'presença confirmada', 'presenças confirmadas')} pela call`,
        resumo?.total ? `${ESTRELAS(Math.round(Number(resumo.media)))} **${numero(resumo.media)}** em ${plural(resumo.total, 'avaliação', 'avaliações')}` : 'Ainda sem avaliações',
        fechada ? '**Avaliação encerrada.**' : `Avaliações abertas até ${ts(janelaAte, 'f')}.`,
      ];
      if (minha) linhas.push(`Sua nota: ${ESTRELAS(minha.nota)}${minha.comentario ? ' · com comentário' : ''}`);
      if (souProfessor && resumo?.comentarios?.length) {
        linhas.push('', '**Comentários (anônimos)**', ...resumo.comentarios.slice(0, 8).map((c) => `> ${cortar(c, 200)}`));
      }
      e.addFields({ name: 'Avaliação', value: linhas.join('\n').slice(0, 1024) });
    }

    const componentes = [];
    if (!terminou && !souProfessor) {
      componentes.push(linha(
        botao(`aulas:rsvp:${id}:vou`, 'Vou', eu?.status === 'vou' ? ButtonStyle.Success : ButtonStyle.Secondary, '✅'),
        botao(`aulas:rsvp:${id}:talvez`, 'Talvez', eu?.status === 'talvez' ? ButtonStyle.Primary : ButtonStyle.Secondary, '🤔'),
        botao(`aulas:rsvp:${id}:nao_vou`, 'Não vou', eu?.status === 'nao_vou' ? ButtonStyle.Danger : ButtonStyle.Secondary),
      ));
    }
    if (terminou && !a.avaliacao_fechada_em && !souProfessor) componentes.push(...botoesNota(id));
    return responder(interaction, { embeds: [e], components: componentes });
  });
}

/** Linha de estrelas + comentário (usada no chat do canal e no detalhe da aula). */
export function botoesNota(id) {
  return [
    linha(...[1, 2, 3, 4, 5].map((n) => botao(`aulas:nota:${id}:${n}`, String(n), n >= 4 ? ButtonStyle.Success : ButtonStyle.Secondary, '⭐'))),
    linha(botao(`aulas:comentar:${id}`, 'Deixar um comentário', ButtonStyle.Secondary, '💬'), botao(`aulas:ver:${id}`, 'Ver a aula', ButtonStyle.Secondary, '🎓')),
  ];
}

export async function minhas(interaction) {
  return comoMembro(interaction, async ({ sb, perfil }) => {
    const lista = await dados(
      sb.from('eventos').select('id, titulo, inicio, fim, avaliacao_fechada_em, avaliacao_media, avaliacao_total').eq('tipo', 'aula')
        .eq('criado_por', perfil.id).is('excluido_em', null).order('inicio', { ascending: false }).limit(15),
    );
    if (!lista.length) return responder(interaction, { embeds: [embed('Minhas aulas', 'Você ainda não deu nenhuma aula. Marque a primeira com `/aulas nova`.', COR.neutra)] });
    const pontos = await dados(sb.rpc('historico_reputacao', { p_profile: perfil.id, p_limite: 100, p_antes: null }));
    const porAula = Object.fromEntries(pontos.filter((p) => p.acao === 'aula_ministrada').map((p) => [p.referencia_id, p.pontos]));
    const agora = Date.now();
    return responder(interaction, {
      embeds: [
        embed(
          'Minhas aulas',
          lista.map((a) => {
            let situacao;
            if (new Date(a.fim).getTime() > agora) situacao = `marcada para ${ts(a.inicio)}`;
            else if (!a.avaliacao_fechada_em) situacao = 'avaliações abertas';
            else if (porAula[a.id]) situacao = `${ESTRELAS(Math.round(Number(a.avaliacao_media)))} ${numero(a.avaliacao_media)} (${a.avaliacao_total}) · **+${porAula[a.id]} pontos = ${porAula[a.id]} DRC**`;
            else situacao = a.avaliacao_total ? `${numero(a.avaliacao_media)} (${a.avaliacao_total}) · não pontuou` : 'sem avaliações';
            return `**${cortar(a.titulo, 80)}** · ${situacao}`;
          }).join('\n'),
          COR.dourado,
        ).addFields({
          name: 'Quando a aula vale Dracmas',
          value: 'Depois de 48 h: pelo menos **3 avaliações** de membros com conta de 7+ dias e **média 3,5** ou mais → **+20 pontos** (+30 com média 4,5+), até 3 aulas pontuadas por semana. Cada ponto vira 1 DRC no fechamento semanal.',
        }),
      ],
      components: [menuAbrir('aulas:abrir', 'Abrir uma aula…', lista.map((a) => ({ rotulo: a.titulo, valor: a.id })))].filter(Boolean),
    });
  });
}

// ------------------------------------------------------------------ avaliação
const motivoSemPermissao = async (eventoId, discordId) => {
  const adm = clienteAdmin();
  const [{ data: ev }, { data: pv }, { data: min }] = await Promise.all([
    adm.from('eventos').select('fim, avaliacao_fechada_em').eq('id', eventoId).maybeSingle(),
    adm.from('presencas_voz').select('minutos').eq('evento_id', eventoId).eq('discord_id', discordId).maybeSingle(),
    adm.rpc('minutos_minimos_presenca', { p_evento: eventoId }),
  ]);
  if (ev?.avaliacao_fechada_em || (ev && Date.now() > new Date(ev.fim).getTime() + 48 * 3600_000)) return 'As avaliações desta aula já foram encerradas.';
  if (ev && Date.now() < new Date(ev.fim).getTime() - 10 * 60_000) return 'A avaliação abre quando a aula estiver terminando. Aproveite a aula!';
  if (!pv) return 'Só quem participou da aula pela call pode avaliar.';
  if (pv.minutos < (min ?? 0)) return `Você ficou ${plural(pv.minutos, 'minuto')} na call; para avaliar era preciso ficar pelo menos ${min} minutos.`;
  return null;
};

async function avaliar(interaction, id, nota) {
  return comoMembro(interaction, async ({ sb, perfil }) => {
    const adm = clienteAdmin();
    const { data: ev } = await adm.from('eventos').select('id, titulo, fim, criado_por, tipo').eq('id', id).maybeSingle();
    if (!ev || ev.tipo !== 'aula') return erro(interaction, 'Aula não encontrada.');
    if (ev.criado_por === perfil.id) return erro(interaction, 'Quem dá a aula não avalia a própria aula. 🙂');
    // Quem ainda não tinha conta quando a aula acabou: confirma a presença agora
    await adm.rpc('confirmar_presenca_voz', { p_evento: id, p_discord_id: interaction.user.id });
    const { error } = await sb.from('avaliacoes_evento').upsert({ evento_id: id, profile_id: perfil.id, nota }, { onConflict: 'evento_id,profile_id' });
    if (error) {
      const motivo = (await motivoSemPermissao(id, interaction.user.id)) ?? mensagemDeErro(error);
      return erro(interaction, motivo);
    }
    const ate = new Date(new Date(ev.fim).getTime() + 48 * 3600_000).toISOString();
    return responder(interaction, {
      embeds: [embed('Obrigado pela avaliação!', `${ESTRELAS(nota)} para **${ev.titulo}**.\nSua nota é anônima e pode ser trocada até ${ts(ate)}. Um comentário ajuda quem ensinou a melhorar.`, COR.secundaria)],
      components: [linha(botao(`aulas:comentar:${id}`, 'Deixar um comentário', ButtonStyle.Primary, '💬'))],
    });
  });
}

// ------------------------------------------------------------------ botões e formulários
export async function handleInteraction(interaction, partes) {
  const [acao, id, extra] = partes;
  const valor = interaction.values?.[0];
  if (acao === 'abrir') return mostrarAula(interaction, valor);
  if (acao === 'ver') return mostrarAula(interaction, id);
  if (acao === 'nota') return avaliar(interaction, id, Math.max(1, Math.min(5, Number(extra) || 0)));
  if (acao === 'comentar') {
    return interaction.showModal(
      new ModalBuilder().setCustomId(`aulas:m-comentario:${id}`).setTitle('Comentário (anônimo)').addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('comentario').setLabel('O que foi bom? O que pode melhorar?').setStyle(TextInputStyle.Paragraph)
            .setRequired(true).setMinLength(5).setMaxLength(1000),
        ),
      ),
    );
  }
  if (acao === 'rsvp') {
    await interaction.deferUpdate();
    return comoMembro(interaction, async ({ sb, perfil }) => {
      await dados(sb.from('rsvps').upsert({ evento_id: id, profile_id: perfil.id, status: extra }));
      return mostrarAula(interaction, id);
    }, { adiar: false });
  }
}

export async function handleModalSubmit(interaction, partes) {
  const [tipo, a1, a2] = partes;
  if (tipo === 'm-nova') return criarAula(interaction, a1 === '-' ? null : a1, a2 === '-' ? config.agora.canalVozPadrao : a2);
  if (tipo === 'm-comentario') {
    return comoMembro(interaction, async ({ sb, perfil }) => {
      const comentario = interaction.fields.getTextInputValue('comentario')?.trim();
      const { data: r, error } = await sb.from('avaliacoes_evento').update({ comentario }).eq('evento_id', a1).eq('profile_id', perfil.id).select('nota');
      if (error) return erro(interaction, mensagemDeErro(error));
      if (!r?.length) return erro(interaction, 'Dê primeiro uma nota (as estrelas); o comentário vai junto com ela.');
      return responder(interaction, { embeds: [embed('Comentário enviado', 'Quem deu a aula vê o comentário sem saber quem escreveu. Obrigado!', COR.secundaria)] });
    });
  }
}
