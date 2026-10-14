// ============================================
// agora/cmd-biblioteca.js — /biblioteca: temas, tópicos, artigos, revisão e trilhas
// ============================================

import {
  ButtonStyle, ModalBuilder, SlashCommandBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
} from 'discord.js';
import { acessoDe, dados } from './cliente.js';
import {
  COR, botao, comoMembro, cortar, embed, erro, idDaOpcao, linha, menuAbrir, nomePublico, opcoes, plural, relativo, responder, tempoLeitura,
} from './ui.js';

const ROTULO_STATUS = { rascunho: 'Rascunho', em_revisao: 'Em revisão', publicado: 'Publicado', recusado: 'Recusado' };
const ROTULO_DIFICULDADE = { 1: 'Introdutória', 2: 'Intermediária', 3: 'Avançada' };
const ROTULO_PARECER = { aprovar: 'Aprovar', pedir_mudancas: 'Pedir mudanças', recusar: 'Recusar' };

const opTema = (o, obrig = false) => o.setName('tema').setDescription('Tema').setRequired(obrig).setAutocomplete(true);

export const data = new SlashCommandBuilder()
  .setName('biblioteca')
  .setDescription('Biblioteca da Ágora: tópicos, artigos revisados por pares e trilhas de estudo.')
  .addSubcommand((s) => s.setName('temas').setDescription('Lista os temas da Biblioteca.'))
  .addSubcommand((s) => s.setName('topicos').setDescription('Conversas mais ativas (de um tema, se quiser).').addStringOption((o) => opTema(o)))
  .addSubcommand((s) =>
    s.setName('topico').setDescription('Abre um tópico com as respostas.')
      .addStringOption((o) => o.setName('topico').setDescription('Comece a digitar o título').setRequired(true).setAutocomplete(true)),
  )
  .addSubcommand((s) => s.setName('novo-topico').setDescription('Abre uma conversa nova (nível Colaborador).').addStringOption((o) => opTema(o, true)))
  .addSubcommand((s) => s.setName('artigos').setDescription('Artigos publicados (de um tema, se quiser).').addStringOption((o) => opTema(o)))
  .addSubcommand((s) =>
    s.setName('artigo').setDescription('Lê um artigo publicado.')
      .addStringOption((o) => o.setName('artigo').setDescription('Comece a digitar o título').setRequired(true).setAutocomplete(true)),
  )
  .addSubcommand((s) => s.setName('escrever').setDescription('Escreve um artigo novo para revisão por pares (nível Colaborador).').addStringOption((o) => opTema(o, true)))
  .addSubcommand((s) => s.setName('meus-artigos').setDescription('Seus artigos e o andamento da revisão.'))
  .addSubcommand((s) => s.setName('revisar').setDescription('Fila de revisão de artigos (nível Curador).'))
  .addSubcommand((s) => s.setName('trilhas').setDescription('Trilhas de estudo publicadas.'))
  .addSubcommand((s) =>
    s.setName('trilha').setDescription('Abre uma trilha e mostra seu progresso.')
      .addStringOption((o) => o.setName('trilha').setDescription('Comece a digitar o título').setRequired(true).setAutocomplete(true)),
  )
  .addSubcommand((s) => s.setName('salvos').setDescription('Tópicos, artigos e trilhas que você salvou.'));

// ------------------------------------------------------------------ autocompletar
export async function autocomplete(interaction) {
  const foco = interaction.options.getFocused(true);
  const termo = String(foco.value ?? '').trim();
  const { sb } = await acessoDe(interaction);
  let lista = [];
  if (foco.name === 'tema') {
    let q = sb.from('temas').select('id, nome').order('ordem').limit(25);
    if (termo) q = q.ilike('nome', `%${termo}%`);
    lista = (await dados(q)).map((t) => ({ id: t.id, titulo: t.nome }));
  } else if (foco.name === 'topico') {
    let q = sb.from('topicos').select('id, titulo').is('excluido_em', null).order('ultima_atividade_em', { ascending: false }).limit(25);
    if (termo) q = q.ilike('titulo', `%${termo}%`);
    lista = await dados(q);
  } else if (foco.name === 'artigo') {
    let q = sb.from('artigos').select('id, titulo').eq('status', 'publicado').is('excluido_em', null).order('publicado_em', { ascending: false }).limit(25);
    if (termo) q = q.ilike('titulo', `%${termo}%`);
    lista = await dados(q);
  } else if (foco.name === 'trilha') {
    let q = sb.from('trilhas').select('id, titulo').eq('publicada', true).is('excluido_em', null).order('publicada_em', { ascending: false }).limit(25);
    if (termo) q = q.ilike('titulo', `%${termo}%`);
    lista = await dados(q);
  }
  return interaction.respond(opcoes(lista));
}

// ------------------------------------------------------------------ comandos
export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const temaId = idDaOpcao(interaction.options.getString('tema'));
  switch (sub) {
    case 'temas': return temas(interaction);
    case 'topicos': return topicos(interaction, temaId);
    case 'topico': return mostrarTopico(interaction, idDaOpcao(interaction.options.getString('topico')));
    case 'novo-topico': return interaction.showModal(modalTopico(temaId));
    case 'artigos': return artigos(interaction, temaId);
    case 'artigo': return mostrarArtigo(interaction, idDaOpcao(interaction.options.getString('artigo')));
    case 'escrever': return interaction.showModal(modalArtigo(temaId));
    case 'meus-artigos': return meusArtigos(interaction);
    case 'revisar': return filaRevisao(interaction);
    case 'trilhas': return trilhas(interaction);
    case 'trilha': return mostrarTrilha(interaction, idDaOpcao(interaction.options.getString('trilha')));
    case 'salvos': return salvos(interaction);
  }
}

async function temas(interaction) {
  return comoMembro(interaction, async ({ sb }) => {
    const lista = await dados(sb.from('temas').select('id, nome, descricao').order('ordem'));
    return responder(interaction, {
      embeds: [embed('Temas da Biblioteca', lista.map((t) => `**${t.nome}**${t.descricao ? ` — ${cortar(t.descricao, 120)}` : ''}`).join('\n'), COR.secundaria)],
    });
  });
}

const CAMPOS_TOPICO = 'id, tema_id, autor_id, titulo, corpo_md, fixado, trancado, status, ultima_atividade_em, created_at, tema:temas(nome), respostas(count)';

async function topicos(interaction, temaId) {
  return comoMembro(interaction, async ({ sb }) => {
    let q = sb.from('topicos').select(CAMPOS_TOPICO).is('excluido_em', null)
      .order('fixado', { ascending: false }).order('ultima_atividade_em', { ascending: false }).limit(10);
    if (temaId) q = q.eq('tema_id', temaId);
    const lista = await dados(q);
    if (!lista.length) {
      return responder(interaction, { embeds: [embed('Tópicos', 'Silêncio na praça. Abra a primeira conversa com `/biblioteca novo-topico`.', COR.neutra)] });
    }
    const e = embed(
      temaId ? `Tópicos · ${lista[0].tema?.nome ?? ''}` : 'Tópicos ativos',
      lista.map((t) => `${t.fixado ? '📌 ' : ''}**${cortar(t.titulo, 90)}**\n${t.tema?.nome ?? ''} · ${plural(t.respostas?.[0]?.count ?? 0, 'resposta')} · ativo ${relativo(t.ultima_atividade_em)}`).join('\n\n'),
    );
    return responder(interaction, {
      embeds: [e],
      components: [menuAbrir('biblioteca:abrir-topico', 'Abrir um tópico…', lista.map((t) => ({ rotulo: t.titulo, valor: t.id, descricao: t.tema?.nome })))],
    });
  });
}

export async function mostrarTopico(interaction, id) {
  if (!id) return comoMembro(interaction, async () => erro(interaction, 'Escolha um tópico da lista.'));
  return comoMembro(interaction, async ({ sb, perfil }) => {
    const t = await dados(sb.from('topicos').select(CAMPOS_TOPICO).eq('id', id).maybeSingle());
    if (!t) return erro(interaction, 'Tópico não encontrado (ou oculto pela moderação).');
    const respostas = await dados(sb.from('respostas').select('id, autor_id, corpo_md, marcada_como_util, resposta_pai_id, created_at, excluido_em').eq('topico_id', id).order('created_at'));
    const perfis = await perfisPorIds(sb, [t.autor_id, ...respostas.map((r) => r.autor_id)]);
    const visiveis = respostas.filter((r) => !r.excluido_em);
    const e = embed(
      t.titulo,
      `${t.tema?.nome ?? ''} · por **${nomePublico(perfis[t.autor_id])}** · ${relativo(t.created_at)}${t.trancado ? ' · 🔒 trancado' : ''}${t.status === 'resolvido' ? ' · ✅ resolvido' : ''}\n\n${cortar(t.corpo_md, 1800)}`,
    );
    const ultimas = visiveis.slice(-6);
    if (ultimas.length) {
      e.addFields({
        name: `${plural(visiveis.length, 'resposta')}${visiveis.length > 6 ? ' (as 6 mais recentes)' : ''}`,
        value: cortar(
          ultimas.map((r) => `${r.marcada_como_util ? '⭐ ' : ''}**${nomePublico(perfis[r.autor_id])}** · ${relativo(r.created_at)}\n${cortar(r.corpo_md, 220)}`).join('\n\n'),
          1024,
        ),
      });
    }
    const salvo = await estaSalvo(sb, perfil.id, 'topico', id);
    const componentes = [
      linha(
        !t.trancado ? botao(`biblioteca:responder:${id}`, 'Responder', ButtonStyle.Primary, '💬') : null,
        botao(`biblioteca:salvar:topico:${id}:${salvo ? 0 : 1}`, salvo ? 'Remover dos salvos' : 'Salvar', ButtonStyle.Secondary, salvo ? '🗑️' : '🔖'),
      ),
    ];
    // O autor do tópico pode marcar respostas úteis (vale reputação para quem respondeu)
    const marcaveis = visiveis.filter((r) => r.autor_id !== perfil.id && !r.marcada_como_util);
    if (t.autor_id === perfil.id && marcaveis.length) {
      componentes.push(
        menuAbrir('biblioteca:util', 'Marcar uma resposta como útil (+reputação para quem respondeu)…',
          marcaveis.slice(-25).map((r) => ({ rotulo: `${nomePublico(perfis[r.autor_id])}: ${r.corpo_md}`, valor: r.id }))),
      );
    }
    return responder(interaction, { embeds: [e], components: componentes });
  });
}

const CAMPOS_ARTIGO = 'id, tema_id, criado_por, titulo, resumo, corpo_md, status, rodada_revisao, publicado_em, updated_at, tema:temas(nome)';

async function artigos(interaction, temaId) {
  return comoMembro(interaction, async ({ sb }) => {
    let q = sb.from('artigos').select(CAMPOS_ARTIGO).eq('status', 'publicado').is('excluido_em', null).order('publicado_em', { ascending: false }).limit(10);
    if (temaId) q = q.eq('tema_id', temaId);
    const lista = await dados(q);
    if (!lista.length) return responder(interaction, { embeds: [embed('Artigos', 'A estante está vazia por aqui. Que tal escrever o primeiro com `/biblioteca escrever`?', COR.neutra)] });
    return responder(interaction, {
      embeds: [embed('Artigos publicados', lista.map((a) => `**${cortar(a.titulo, 90)}**\n${a.tema?.nome ?? ''} · ${tempoLeitura(a.corpo_md)} · publicado ${relativo(a.publicado_em)}${a.resumo ? `\n${cortar(a.resumo, 140)}` : ''}`).join('\n\n'))],
      components: [menuAbrir('biblioteca:abrir-artigo', 'Ler um artigo…', lista.map((a) => ({ rotulo: a.titulo, valor: a.id, descricao: a.tema?.nome })))],
    });
  });
}

export async function mostrarArtigo(interaction, id) {
  if (!id) return comoMembro(interaction, async () => erro(interaction, 'Escolha um artigo da lista.'));
  return comoMembro(interaction, async ({ sb, perfil }) => {
    const a = await dados(sb.from('artigos').select(CAMPOS_ARTIGO).eq('id', id).maybeSingle());
    if (!a) return erro(interaction, 'Artigo não encontrado.');
    const autoria = await dados(sb.from('artigo_autores').select('profile_id, papel').eq('artigo_id', id));
    const perfis = await perfisPorIds(sb, autoria.map((x) => x.profile_id));
    const autores = autoria.filter((x) => x.papel !== 'revisor').map((x) => nomePublico(perfis[x.profile_id])).join(', ');
    const revisores = autoria.filter((x) => x.papel === 'revisor').map((x) => nomePublico(perfis[x.profile_id])).join(', ');
    const corpo = a.corpo_md ?? '';
    const e = embed(
      a.titulo,
      `${a.tema?.nome ?? ''} · ${autores || 'Autoria'} · ${tempoLeitura(corpo)}${a.status !== 'publicado' ? ` · **${ROTULO_STATUS[a.status]}**` : ''}\n${a.resumo ? `*${cortar(a.resumo, 300)}*\n` : ''}\n${cortar(corpo, 3300)}`,
    );
    if (corpo.length > 3300) e.addFields({ name: 'Continua…', value: 'O artigo é maior que uma mensagem do Discord. Leia a versão completa no app.' });
    if (revisores) e.addFields({ name: 'Revisado por', value: revisores });
    const ehAutor = autoria.some((x) => x.profile_id === perfil.id && x.papel !== 'revisor');
    const salvo = await estaSalvo(sb, perfil.id, 'artigo', id);
    const botoes = [];
    if (a.status === 'publicado') botoes.push(botao(`biblioteca:lido:${id}`, 'Marcar como lido', ButtonStyle.Success, '✅'));
    botoes.push(botao(`biblioteca:salvar:artigo:${id}:${salvo ? 0 : 1}`, salvo ? 'Remover dos salvos' : 'Salvar', ButtonStyle.Secondary, salvo ? '🗑️' : '🔖'));
    if (ehAutor && ['rascunho', 'recusado'].includes(a.status)) botoes.push(botao(`biblioteca:enviar:${id}`, 'Enviar para revisão', ButtonStyle.Primary, '📨'));
    return responder(interaction, { embeds: [e], components: [linha(...botoes)] });
  });
}

async function meusArtigos(interaction) {
  return comoMembro(interaction, async ({ sb, perfil }) => {
    const linhas = await dados(
      sb.from('artigo_autores').select(`papel, artigo:artigos(${CAMPOS_ARTIGO})`).eq('profile_id', perfil.id).in('papel', ['autor', 'coautor']),
    );
    const lista = linhas.filter((l) => l.artigo).map((l) => l.artigo).sort((x, y) => String(y.updated_at).localeCompare(String(x.updated_at)));
    if (!lista.length) return responder(interaction, { embeds: [embed('Meus artigos', 'Você ainda não escreveu artigos. Comece com `/biblioteca escrever`.', COR.neutra)] });
    return responder(interaction, {
      embeds: [embed('Meus artigos', lista.slice(0, 15).map((a) => `**${cortar(a.titulo, 90)}** · ${ROTULO_STATUS[a.status]}${a.status === 'em_revisao' ? ` (rodada ${a.rodada_revisao})` : ''} · ${relativo(a.updated_at)}`).join('\n'))],
      components: [menuAbrir('biblioteca:abrir-artigo', 'Abrir um artigo…', lista.map((a) => ({ rotulo: a.titulo, valor: a.id, descricao: ROTULO_STATUS[a.status] })))],
    });
  });
}

async function filaRevisao(interaction) {
  return comoMembro(interaction, async ({ sb, perfil }) => {
    if (perfil.nivel < 3) return erro(interaction, `A revisão de artigos é para o nível 3 (Curador). Você está no nível ${perfil.nivel}.`);
    const artigosEmRevisao = await dados(sb.from('artigos').select(CAMPOS_ARTIGO).eq('status', 'em_revisao').order('updated_at'));
    if (!artigosEmRevisao.length) return responder(interaction, { embeds: [embed('Fila de revisão', 'Nenhum artigo esperando revisão agora. 🎉', COR.secundaria)] });
    const ids = artigosEmRevisao.map((a) => a.id);
    const [autorias, revisoes] = await Promise.all([
      dados(sb.from('artigo_autores').select('artigo_id, profile_id').in('artigo_id', ids).in('papel', ['autor', 'coautor'])),
      dados(sb.from('revisoes').select('artigo_id, revisor_id, rodada, parecer').in('artigo_id', ids)),
    ]);
    const fila = artigosEmRevisao
      .filter((a) => !autorias.some((x) => x.artigo_id === a.id && x.profile_id === perfil.id))
      .map((a) => {
        const daRodada = revisoes.filter((r) => r.artigo_id === a.id && r.rodada === a.rodada_revisao);
        return { ...a, aprovacoes: daRodada.filter((r) => r.parecer === 'aprovar').length, jaRevisei: daRodada.some((r) => r.revisor_id === perfil.id) };
      });
    if (!fila.length) return responder(interaction, { embeds: [embed('Fila de revisão', 'Só há artigos seus em revisão — eles precisam de outros curadores.', COR.neutra)] });
    return responder(interaction, {
      embeds: [embed('Fila de revisão', `Cada artigo precisa de **2 aprovações** de curadores diferentes para ser publicado.\n\n${fila.map((a) => `**${cortar(a.titulo, 90)}** · ${a.tema?.nome ?? ''} · ${a.aprovacoes}/2 aprovações${a.jaRevisei ? ' · você já revisou' : ''}`).join('\n')}`, COR.dourado)],
      components: [menuAbrir('biblioteca:abrir-revisao', 'Revisar um artigo…', fila.filter((a) => !a.jaRevisei).map((a) => ({ rotulo: a.titulo, valor: a.id, descricao: `${a.aprovacoes}/2 aprovações` })))].filter(Boolean),
    });
  });
}

async function mostrarParaRevisao(interaction, id) {
  return comoMembro(interaction, async ({ sb }) => {
    const a = await dados(sb.from('artigos').select(CAMPOS_ARTIGO).eq('id', id).maybeSingle());
    if (!a) return erro(interaction, 'Artigo não encontrado.');
    const e = embed(`Revisão: ${a.titulo}`, `${a.tema?.nome ?? ''} · rodada ${a.rodada_revisao} · ${tempoLeitura(a.corpo_md)}\n${a.resumo ? `*${cortar(a.resumo, 300)}*\n` : ''}\n${cortar(a.corpo_md, 3400)}`, COR.dourado);
    if ((a.corpo_md ?? '').length > 3400) e.addFields({ name: 'Texto longo', value: 'O texto completo está no app; aqui aparecem os primeiros 3.400 caracteres.' });
    return responder(interaction, {
      embeds: [e],
      components: [
        linha(
          botao(`biblioteca:parecer:${id}:aprovar`, 'Aprovar', ButtonStyle.Success, '✅'),
          botao(`biblioteca:parecer:${id}:pedir_mudancas`, 'Pedir mudanças', ButtonStyle.Secondary, '✏️'),
          botao(`biblioteca:parecer:${id}:recusar`, 'Recusar', ButtonStyle.Danger, '✖️'),
        ),
      ],
    });
  });
}

async function trilhas(interaction) {
  return comoMembro(interaction, async ({ sb }) => {
    const lista = await dados(
      sb.from('trilhas').select('id, titulo, descricao, nivel_dificuldade, destaque, tema:temas(nome), trilha_itens(count)').eq('publicada', true).is('excluido_em', null)
        .order('destaque', { ascending: false }).order('publicada_em', { ascending: false }).limit(15),
    );
    if (!lista.length) return responder(interaction, { embeds: [embed('Trilhas', 'Nenhuma trilha publicada ainda. Curadores montam trilhas no app.', COR.neutra)] });
    return responder(interaction, {
      embeds: [embed('Trilhas de estudo', lista.map((t) => `${t.destaque ? '⭐ ' : ''}**${cortar(t.titulo, 90)}** · ${ROTULO_DIFICULDADE[t.nivel_dificuldade]} · ${plural(t.trilha_itens?.[0]?.count ?? 0, 'artigo')}${t.descricao ? `\n${cortar(t.descricao, 140)}` : ''}`).join('\n\n'), COR.dourado)],
      components: [menuAbrir('biblioteca:abrir-trilha', 'Abrir uma trilha…', lista.map((t) => ({ rotulo: t.titulo, valor: t.id, descricao: t.tema?.nome })))],
    });
  });
}

export async function mostrarTrilha(interaction, id) {
  if (!id) return comoMembro(interaction, async () => erro(interaction, 'Escolha uma trilha da lista.'));
  return comoMembro(interaction, async ({ sb, perfil }) => {
    const t = await dados(sb.from('trilhas').select('id, titulo, descricao, nivel_dificuldade, curador_id, tema:temas(nome)').eq('id', id).maybeSingle());
    if (!t) return erro(interaction, 'Trilha não encontrada.');
    const [itens, progresso, concluida] = await Promise.all([
      dados(sb.from('trilha_itens').select('artigo_id, ordem, artigo:artigos(id, titulo)').eq('trilha_id', id).order('ordem')),
      dados(sb.from('progresso_trilha').select('artigo_id').eq('trilha_id', id).eq('profile_id', perfil.id)),
      dados(sb.from('trilhas_concluidas').select('trilha_id').eq('trilha_id', id).eq('profile_id', perfil.id).maybeSingle()),
    ]);
    const feitos = new Set(progresso.map((p) => p.artigo_id));
    const proximo = itens.find((i) => !feitos.has(i.artigo_id));
    const e = embed(
      t.titulo,
      `${t.tema?.nome ?? ''} · ${ROTULO_DIFICULDADE[t.nivel_dificuldade]} · ${feitos.size}/${itens.length} lidos${concluida ? ' · 🏅 concluída' : ''}\n${t.descricao ? `\n${cortar(t.descricao, 500)}\n` : ''}\n${itens.map((i, n) => `${feitos.has(i.artigo_id) ? '✅' : '▫️'} ${n + 1}. ${i.artigo?.titulo ?? 'Artigo indisponível'}`).join('\n')}`,
      COR.dourado,
    );
    const botoes = [];
    if (proximo) {
      botoes.push(botao(`biblioteca:ler-trilha:${proximo.artigo_id}`, 'Ler o próximo', ButtonStyle.Primary, '📖'));
      botoes.push(botao(`biblioteca:lido-trilha:${proximo.artigo_id}:${id}`, 'Marcar o próximo como lido', ButtonStyle.Success, '✅'));
    }
    const salvo = await estaSalvo(sb, perfil.id, 'trilha', id);
    botoes.push(botao(`biblioteca:salvar:trilha:${id}:${salvo ? 0 : 1}`, salvo ? 'Remover dos salvos' : 'Salvar', ButtonStyle.Secondary, salvo ? '🗑️' : '🔖'));
    return responder(interaction, { embeds: [e], components: [linha(...botoes)] });
  });
}

async function salvos(interaction) {
  return comoMembro(interaction, async ({ sb, perfil }) => {
    const lista = await dados(sb.from('salvos').select('tipo, item_id, created_at').eq('profile_id', perfil.id).order('created_at', { ascending: false }).limit(25));
    if (!lista.length) return responder(interaction, { embeds: [embed('Salvos', 'Nada salvo ainda. Use o botão 🔖 Salvar em tópicos, artigos e trilhas.', COR.neutra)] });
    const porTipo = (tipo) => lista.filter((s) => s.tipo === tipo).map((s) => s.item_id);
    const tabelas = { topico: 'topicos', artigo: 'artigos', trilha: 'trilhas' };
    const titulos = new Map();
    for (const tipo of Object.keys(tabelas)) {
      const ids = porTipo(tipo);
      if (ids.length) for (const i of await dados(sb.from(tabelas[tipo]).select('id, titulo').in('id', ids))) titulos.set(i.id, i.titulo);
    }
    const nomeTipo = { topico: 'Tópico', artigo: 'Artigo', trilha: 'Trilha' };
    return responder(interaction, {
      embeds: [embed('Salvos', lista.map((s) => `**${nomeTipo[s.tipo]}** · ${cortar(titulos.get(s.item_id) ?? 'Item indisponível', 90)}`).join('\n'), COR.neutra)],
      components: [menuAbrir('biblioteca:abrir-salvo', 'Abrir…', lista.filter((s) => titulos.has(s.item_id)).map((s) => ({ rotulo: titulos.get(s.item_id), valor: `${s.tipo}|${s.item_id}`, descricao: nomeTipo[s.tipo] })))].filter(Boolean),
    });
  });
}

// ------------------------------------------------------------------ formulários
function campo(id, rotulo, estilo, { min, max, obrig = true, valor, placeholder } = {}) {
  const c = new TextInputBuilder().setCustomId(id).setLabel(rotulo).setStyle(estilo).setRequired(obrig);
  if (min) c.setMinLength(min);
  if (max) c.setMaxLength(max);
  if (valor) c.setValue(valor);
  if (placeholder) c.setPlaceholder(placeholder);
  return new ActionRowBuilder().addComponents(c);
}

function modalTopico(temaId) {
  return new ModalBuilder().setCustomId(`biblioteca:m-topico:${temaId ?? ''}`).setTitle('Novo tópico').addComponents(
    campo('titulo', 'Título', TextInputStyle.Short, { min: 5, max: 200 }),
    campo('corpo', 'Texto (Markdown)', TextInputStyle.Paragraph, { min: 10, max: 4000, placeholder: 'Contexto, pergunta, fontes…' }),
  );
}

function modalArtigo(temaId) {
  return new ModalBuilder().setCustomId(`biblioteca:m-artigo:${temaId ?? ''}`).setTitle('Novo artigo').addComponents(
    campo('titulo', 'Título', TextInputStyle.Short, { min: 5, max: 200 }),
    campo('resumo', 'Resumo (aparece na lista)', TextInputStyle.Paragraph, { max: 400, obrig: false }),
    campo('corpo', 'Texto (Markdown, mín. 300 caracteres)', TextInputStyle.Paragraph, { min: 300, max: 4000 }),
  );
}

export async function handleModalSubmit(interaction, partes) {
  const [tipo, id, extra] = partes;
  const texto = (c) => interaction.fields.getTextInputValue(c)?.trim() ?? '';

  if (tipo === 'm-topico') {
    return comoMembro(interaction, async ({ sb, perfil }) => {
      if (!id) return erro(interaction, 'Escolha um tema.');
      const t = await dados(sb.from('topicos').insert({ tema_id: id, autor_id: perfil.id, titulo: texto('titulo'), corpo_md: texto('corpo') }).select('id').single());
      return mostrarTopico(interaction, t.id);
    });
  }
  if (tipo === 'm-resposta') {
    return comoMembro(interaction, async ({ sb, perfil }) => {
      await dados(sb.from('respostas').insert({ topico_id: id, autor_id: perfil.id, corpo_md: texto('corpo') }).select('id').single());
      return mostrarTopico(interaction, id);
    });
  }
  if (tipo === 'm-artigo') {
    return comoMembro(interaction, async ({ sb, perfil }) => {
      if (!id) return erro(interaction, 'Escolha um tema.');
      const a = await dados(
        sb.from('artigos').insert({ tema_id: id, criado_por: perfil.id, titulo: texto('titulo'), resumo: texto('resumo') || null, corpo_md: texto('corpo') }).select('id').single(),
      );
      return responder(interaction, {
        embeds: [embed('Rascunho salvo', 'Seu artigo foi salvo como **rascunho**. Quando estiver pronto, envie para revisão: dois curadores precisam aprovar antes de ele ser publicado (e render reputação e Dracmas).', COR.secundaria)],
        components: [linha(botao(`biblioteca:enviar:${a.id}`, 'Enviar para revisão', ButtonStyle.Primary, '📨'), botao(`biblioteca:ler:${a.id}`, 'Ver rascunho', ButtonStyle.Secondary, '👀'))],
      });
    });
  }
  if (tipo === 'm-parecer') {
    return comoMembro(interaction, async ({ sb, perfil }) => {
      await dados(sb.from('revisoes').insert({ artigo_id: id, revisor_id: perfil.id, parecer: extra, comentario: texto('comentario'), rodada: 0 }));
      const a = await dados(sb.from('artigos').select('titulo, status').eq('id', id).maybeSingle());
      const resultado = a?.status === 'publicado' ? '📗 Com a sua aprovação o artigo foi **publicado**!' : a?.status === 'recusado' ? 'O artigo foi recusado.' : 'Parecer registrado. O autor foi notificado.';
      return responder(interaction, { embeds: [embed(`Revisão enviada: ${ROTULO_PARECER[extra]}`, `${a?.titulo ? `**${a.titulo}**\n` : ''}${resultado}\n\nObrigado — revisões concluídas também rendem reputação.`, COR.secundaria)] });
    });
  }
}

// ------------------------------------------------------------------ botões e menus
export async function handleInteraction(interaction, partes) {
  const [acao, a1, a2, a3] = partes;
  const valor = interaction.values?.[0];

  if (acao === 'abrir-topico') return mostrarTopico(interaction, valor);
  if (acao === 'abrir-artigo' || acao === 'ler' || acao === 'ler-trilha') return mostrarArtigo(interaction, valor ?? a1);
  if (acao === 'abrir-trilha') return mostrarTrilha(interaction, valor);
  if (acao === 'abrir-revisao') return mostrarParaRevisao(interaction, valor);
  if (acao === 'abrir-salvo') {
    const [tipo, id] = valor.split('|');
    if (tipo === 'topico') return mostrarTopico(interaction, id);
    if (tipo === 'trilha') return mostrarTrilha(interaction, id);
    return mostrarArtigo(interaction, id);
  }

  if (acao === 'responder') {
    return interaction.showModal(
      new ModalBuilder().setCustomId(`biblioteca:m-resposta:${a1}`).setTitle('Responder').addComponents(
        campo('corpo', 'Sua resposta (Markdown)', TextInputStyle.Paragraph, { min: 2, max: 4000 }),
      ),
    );
  }
  if (acao === 'parecer') {
    return interaction.showModal(
      new ModalBuilder().setCustomId(`biblioteca:m-parecer:${a1}:${a2}`).setTitle(`Parecer: ${ROTULO_PARECER[a2]}`).addComponents(
        campo('comentario', 'Comentário para o autor (mín. 10 caracteres)', TextInputStyle.Paragraph, { min: 10, max: 2000 }),
      ),
    );
  }

  if (acao === 'salvar') {
    await interaction.deferUpdate();
    return comoMembro(interaction, async ({ sb, perfil }) => {
      const [tipo, id, salvar] = [a1, a2, a3 === '1'];
      if (salvar) await dados(sb.from('salvos').upsert({ profile_id: perfil.id, tipo, item_id: id }));
      else await dados(sb.from('salvos').delete().eq('profile_id', perfil.id).eq('tipo', tipo).eq('item_id', id));
      if (tipo === 'topico') return mostrarTopico(interaction, id);
      if (tipo === 'trilha') return mostrarTrilha(interaction, id);
      return mostrarArtigo(interaction, id);
    }, { adiar: false });
  }

  if (acao === 'lido' || acao === 'lido-trilha') {
    await interaction.deferUpdate();
    return comoMembro(interaction, async ({ sb }) => {
      const trilhaId = acao === 'lido-trilha' ? a2 : null;
      const res = await dados(sb.rpc('marcar_artigo_lido', { p_artigo: a1, p_trilha: trilhaId }));
      const concluiu = (res ?? []).filter((r) => r.concluida);
      if (trilhaId) return mostrarTrilha(interaction, trilhaId);
      return responder(interaction, {
        embeds: [embed('Leitura registrada', concluiu.length ? '🏅 Você concluiu uma trilha com essa leitura!' : 'Artigo marcado como lido. Ele conta no progresso das trilhas que o incluem.', COR.secundaria)],
      });
    }, { adiar: false });
  }

  if (acao === 'enviar') {
    await interaction.deferUpdate();
    return comoMembro(interaction, async ({ sb }) => {
      await dados(sb.from('artigos').update({ status: 'em_revisao' }).eq('id', a1).select('id').single());
      return responder(interaction, { embeds: [embed('Enviado para revisão', 'Curadores vão ler e dar parecer. Você recebe as notificações em `/agora notificacoes`.', COR.secundaria)] });
    }, { adiar: false });
  }

  if (acao === 'util') {
    await interaction.deferUpdate();
    return comoMembro(interaction, async ({ sb }) => {
      const r = await dados(sb.from('respostas').update({ marcada_como_util: true }).eq('id', valor).select('topico_id').single());
      return mostrarTopico(interaction, r.topico_id);
    }, { adiar: false });
  }
}

// ------------------------------------------------------------------ apoio
async function perfisPorIds(sb, ids) {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!unicos.length) return {};
  const lista = await dados(sb.from('perfis_publicos').select('id, nome_publico').in('id', unicos));
  return Object.fromEntries(lista.map((p) => [p.id, p]));
}

async function estaSalvo(sb, perfilId, tipo, id) {
  const { count } = await sb.from('salvos').select('item_id', { count: 'exact', head: true }).eq('profile_id', perfilId).eq('tipo', tipo).eq('item_id', id);
  return (count ?? 0) > 0;
}

export { perfisPorIds };
