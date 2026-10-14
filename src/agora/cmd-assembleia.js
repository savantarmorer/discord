// ============================================
// agora/cmd-assembleia.js — /assembleia: propostas, debate, votação e decisões
// ============================================

import {
  ActionRowBuilder, ButtonStyle, ModalBuilder, SlashCommandBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { acessoDe, dados } from './cliente.js';
import { perfisPorIds } from './cmd-biblioteca.js';
import { agendarSincronizacao } from './eventos-discord.js';
import {
  COR, botao, comoMembro, cortar, data as dataBr, embed, erro, idDaOpcao, linha, menuAbrir, nomePublico, opcoes, plural, relativo, responder,
} from './ui.js';

const ROTULO_STATUS = {
  rascunho: 'Rascunho', debate: 'Em debate', votacao: 'Em votação', aprovada: 'Aprovada', rejeitada: 'Rejeitada', bloqueada: 'Bloqueada', retirada: 'Retirada',
};
const ROTULO_TIPO = { geral: 'Geral', financeira: 'Financeira', regimento: 'Regimento', nucleo: 'Núcleo' };
const ROTULO_VOTO = { favor: 'A favor', contra: 'Contra', abstencao: 'Abstenção', bloqueio: 'Bloqueio' };
const ROTULO_RESULTADO = { aprovada: '✅ Aprovada', rejeitada: '❌ Rejeitada', bloqueada: '⛔ Bloqueada' };

const CAMPOS = 'id, autor_id, titulo, contexto_md, proposta_md, tipo, natureza, escopo_nucleo_id, status, rodada, debate_ate, votacao_ate, quorum_minimo, limiar_aprovacao, created_at, escopo:nucleos(cidade, estado)';

export const data = new SlashCommandBuilder()
  .setName('assembleia')
  .setDescription('Assembleia da Ágora: debates, votações e o arquivo de decisões.')
  .addSubcommand((s) =>
    s.setName('propostas').setDescription('Propostas em debate, em votação ou decididas.')
      .addStringOption((o) =>
        o.setName('aba').setDescription('Qual lista (padrão: em votação)').setRequired(false).addChoices(
          { name: 'Em votação', value: 'votacao' }, { name: 'Em debate', value: 'debate' },
          { name: 'Decididas', value: 'decididas' }, { name: 'Minhas', value: 'minhas' },
        ),
      ),
  )
  .addSubcommand((s) =>
    s.setName('proposta').setDescription('Abre uma proposta: texto, debate e voto.')
      .addStringOption((o) => o.setName('proposta').setDescription('Comece a digitar o título').setRequired(true).setAutocomplete(true)),
  )
  .addSubcommand((s) =>
    s.setName('nova').setDescription('Abre uma proposta na Assembleia (nível Curador).')
      .addStringOption((o) =>
        o.setName('tipo').setDescription('Tipo da proposta').setRequired(true).addChoices(
          { name: 'Geral (maioria de 60%)', value: 'geral' },
          { name: 'Financeira (2/3)', value: 'financeira' },
          { name: 'Regimento (2/3)', value: 'regimento' },
          { name: 'Do meu núcleo', value: 'nucleo' },
        ),
      )
      .addIntegerOption((o) => o.setName('dias_debate').setDescription('Dias de debate (mínimo 5)').setRequired(false).setMinValue(5).setMaxValue(60))
      .addIntegerOption((o) => o.setName('dias_votacao').setDescription('Dias de votação (mínimo 3)').setRequired(false).setMinValue(3).setMaxValue(30))
      .addBooleanOption((o) => o.setName('rascunho').setDescription('Salvar como rascunho em vez de abrir o debate já').setRequired(false)),
  )
  .addSubcommand((s) => s.setName('decisoes').setDescription('Arquivo imutável das decisões da comunidade.'));

export async function autocomplete(interaction) {
  const foco = interaction.options.getFocused(true);
  const termo = String(foco.value ?? '').trim();
  const { sb } = await acessoDe(interaction);
  let q = sb.from('propostas').select('id, titulo, status').is('excluido_em', null).neq('status', 'rascunho').order('created_at', { ascending: false }).limit(25);
  if (termo) q = q.ilike('titulo', `%${termo}%`);
  return interaction.respond(opcoes(await dados(q), (p) => `${p.titulo} · ${ROTULO_STATUS[p.status]}`));
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'propostas') return propostas(interaction, interaction.options.getString('aba') ?? 'votacao');
  if (sub === 'proposta') return mostrarProposta(interaction, idDaOpcao(interaction.options.getString('proposta')));
  if (sub === 'decisoes') return decisoes(interaction);
  if (sub === 'nova') {
    const tipo = interaction.options.getString('tipo');
    const debate = interaction.options.getInteger('dias_debate') ?? 5;
    const votacao = interaction.options.getInteger('dias_votacao') ?? 3;
    const rascunho = interaction.options.getBoolean('rascunho') ? 1 : 0;
    return interaction.showModal(modalNovaProposta(tipo, debate, votacao, rascunho));
  }
}

export function modalNovaProposta(tipo, debate = 5, votacao = 3, rascunho = 0) {
  return new ModalBuilder().setCustomId(`assembleia:m-nova:${tipo}:${debate}:${votacao}:${rascunho}`).setTitle(`Nova proposta · ${ROTULO_TIPO[tipo] ?? 'Geral'}`).addComponents(
    campo('titulo', 'Título', TextInputStyle.Short, { min: 5, max: 200 }),
    campo('contexto', 'Contexto: por que isso importa?', TextInputStyle.Paragraph, { min: 20, max: 3000 }),
    campo('proposta', 'O que se propõe (mín. 50 caracteres)', TextInputStyle.Paragraph, { min: 50, max: 3000 }),
  );
}

function campo(id, rotulo, estilo, { min, max } = {}) {
  const c = new TextInputBuilder().setCustomId(id).setLabel(rotulo).setStyle(estilo).setRequired(true);
  if (min) c.setMinLength(min);
  if (max) c.setMaxLength(max);
  return new ActionRowBuilder().addComponents(c);
}

export async function propostas(interaction, aba = 'votacao') {
  return comoMembro(interaction, async ({ sb, perfil }) => {
    let q = sb.from('propostas').select(CAMPOS).is('excluido_em', null).limit(15);
    if (aba === 'debate') q = q.eq('status', 'debate').order('debate_ate');
    else if (aba === 'votacao') q = q.eq('status', 'votacao').order('votacao_ate');
    else if (aba === 'decididas') q = q.in('status', ['aprovada', 'rejeitada', 'retirada', 'bloqueada']).order('votacao_ate', { ascending: false, nullsFirst: false });
    else q = q.eq('autor_id', perfil.id).order('created_at', { ascending: false });
    const lista = await dados(q);
    const titulos = { votacao: 'Em votação', debate: 'Em debate', decididas: 'Decididas', minhas: 'Minhas propostas' };
    if (!lista.length) return responder(interaction, { embeds: [embed(`Assembleia · ${titulos[aba]}`, 'Nenhuma proposta aqui agora.', COR.neutra)] });
    const prazo = (p) => (p.status === 'debate' ? `debate até ${dataBr(p.debate_ate)}` : p.status === 'votacao' ? `votação termina ${relativo(p.votacao_ate)}` : ROTULO_STATUS[p.status]);
    return responder(interaction, {
      embeds: [
        embed(
          `Assembleia · ${titulos[aba]}`,
          lista.map((p) => `**${cortar(p.titulo, 90)}**\n${ROTULO_TIPO[p.tipo]}${p.natureza === 'onchain' ? ' · on-chain' : ''}${p.escopo ? ` · núcleo ${p.escopo.cidade}` : ''} · ${prazo(p)}`).join('\n\n'),
          COR.primaria,
        ),
      ],
      components: [menuAbrir('assembleia:abrir', 'Abrir uma proposta…', lista.map((p) => ({ rotulo: p.titulo, valor: p.id, descricao: ROTULO_STATUS[p.status] })))],
    });
  });
}

export async function mostrarProposta(interaction, id) {
  if (!id) return comoMembro(interaction, async () => erro(interaction, 'Escolha uma proposta da lista.'));
  return comoMembro(interaction, async ({ sb, perfil }) => {
    const p = await dados(sb.from('propostas').select(CAMPOS).eq('id', id).maybeSingle());
    if (!p) return erro(interaction, 'Proposta não encontrada.');
    const [placarLista, meusVotos, bloqueios, comentarios, podeVotar] = await Promise.all([
      dados(sb.rpc('placar_proposta', { p_proposta: id })),
      dados(sb.from('votos').select('voto, rodada').eq('proposta_id', id).eq('profile_id', perfil.id).eq('rodada', p.rodada)),
      dados(sb.from('votos').select('profile_id, justificativa').eq('proposta_id', id).eq('rodada', p.rodada).eq('voto', 'bloqueio')),
      dados(sb.from('proposta_comentarios').select('autor_id, corpo_md, created_at').eq('proposta_id', id).is('excluido_em', null).order('created_at', { ascending: false }).limit(5)),
      dados(sb.rpc('pode_votar', { p_proposta: id })),
    ]);
    const placar = placarLista?.[0];
    const perfis = await perfisPorIds(sb, [p.autor_id, ...bloqueios.map((b) => b.profile_id), ...comentarios.map((c) => c.autor_id)]);
    const meuVoto = meusVotos[0]?.voto;
    const limiar = Math.round(Number(p.limiar_aprovacao) * 100);
    const e = embed(
      p.titulo,
      [
        `**${ROTULO_STATUS[p.status]}** · ${ROTULO_TIPO[p.tipo]}${p.escopo ? ` · núcleo ${p.escopo.cidade}/${p.escopo.estado}` : ''}${p.rodada > 1 ? ` · rodada ${p.rodada}` : ''} · por **${nomePublico(perfis[p.autor_id])}**`,
        p.status === 'debate' ? `Debate até <t:${Math.floor(new Date(p.debate_ate).getTime() / 1000)}:f>; votação até <t:${Math.floor(new Date(p.votacao_ate).getTime() / 1000)}:f>` : null,
        p.status === 'votacao' ? `Votação termina <t:${Math.floor(new Date(p.votacao_ate).getTime() / 1000)}:R>` : null,
        `Aprovação exige **${limiar}%** dos votos válidos e quórum de ${Math.round(Number(p.quorum_minimo) * 100)}% dos membros aptos.`,
        '',
        '**Contexto**',
        cortar(p.contexto_md, 1200),
        '',
        '**Proposta**',
        cortar(p.proposta_md, 1500),
      ].filter((x) => x !== null).join('\n'),
      COR.primaria,
    );
    if (placar) {
      const linhaPlacar = placar.encerrada
        ? `A favor ${placar.favor} · Contra ${placar.contra} · Abstenção ${placar.abstencao} · Bloqueio ${placar.bloqueio}`
        : `${plural(placar.total, 'voto')} até agora (o placar abre no fim) · quórum: ${placar.quorum_exigido} votos${placar.bloqueio ? ` · ⛔ ${plural(placar.bloqueio, 'bloqueio')}` : ''}`;
      e.addFields({ name: 'Votação', value: `${linhaPlacar}${meuVoto ? `\nSeu voto: **${ROTULO_VOTO[meuVoto]}** (dá para mudar até o fim)` : ''}` });
    }
    if (bloqueios.length) {
      e.addFields({ name: 'Bloqueios (públicos)', value: cortar(bloqueios.map((b) => `**${nomePublico(perfis[b.profile_id])}**: ${cortar(b.justificativa, 200)}`).join('\n'), 1024) });
    }
    if (comentarios.length) {
      e.addFields({ name: 'Debate (comentários recentes)', value: cortar(comentarios.reverse().map((c) => `**${nomePublico(perfis[c.autor_id])}** · ${relativo(c.created_at)}\n${cortar(c.corpo_md, 200)}`).join('\n\n'), 1024) });
    }
    const componentes = [];
    if (p.natureza === 'onchain') {
      e.addFields({ name: 'Proposta on-chain', value: 'O voto desta proposta é feito com Dracmas pela carteira do app (Governor).' });
    } else if (p.status === 'votacao' && podeVotar) {
      componentes.push(
        linha(
          botao(`assembleia:votar:${id}:${p.rodada}:favor`, 'A favor', meuVoto === 'favor' ? ButtonStyle.Success : ButtonStyle.Secondary, '👍'),
          botao(`assembleia:votar:${id}:${p.rodada}:contra`, 'Contra', meuVoto === 'contra' ? ButtonStyle.Danger : ButtonStyle.Secondary, '👎'),
          botao(`assembleia:votar:${id}:${p.rodada}:abstencao`, 'Abstenção', meuVoto === 'abstencao' ? ButtonStyle.Primary : ButtonStyle.Secondary),
          botao(`assembleia:bloquear:${id}:${p.rodada}`, 'Bloquear', ButtonStyle.Secondary, '⛔'),
        ),
      );
    }
    if (['debate', 'votacao'].includes(p.status)) {
      componentes.push(linha(botao(`assembleia:comentar:${id}`, 'Comentar no debate', ButtonStyle.Secondary, '💬')));
    }
    return responder(interaction, { embeds: [e], components: componentes });
  });
}

export async function decisoes(interaction) {
  return comoMembro(interaction, async ({ sb }) => {
    const lista = await dados(sb.from('decisoes').select('id, resultado, resumo_md, total_votos, votos_favor, votos_contra, registrada_em, proposta:propostas(titulo, tipo)').order('registrada_em', { ascending: false }).limit(10));
    if (!lista.length) return responder(interaction, { embeds: [embed('Decisões', 'Nenhuma decisão registrada ainda.', COR.neutra)] });
    return responder(interaction, {
      embeds: [embed('Arquivo de decisões', lista.map((d) => `${ROTULO_RESULTADO[d.resultado]} · **${cortar(d.proposta?.titulo ?? 'Proposta', 90)}** · ${dataBr(d.registrada_em)}\n${d.votos_favor} a favor · ${d.votos_contra} contra · ${plural(d.total_votos, 'voto')}`).join('\n\n'), COR.neutra)],
      components: [menuAbrir('assembleia:abrir-decisao', 'Ler uma decisão…', lista.map((d) => ({ rotulo: d.proposta?.titulo ?? 'Decisão', valor: d.id, descricao: dataBr(d.registrada_em) })))],
    });
  });
}

export async function mostrarDecisao(interaction, id) {
  return comoMembro(interaction, async ({ sb }) => {
    const d = await dados(sb.from('decisoes').select('*, proposta:propostas(id, titulo, tipo)').eq('id', id).maybeSingle());
    if (!d) return erro(interaction, 'Decisão não encontrada.');
    return responder(interaction, {
      embeds: [
        embed(
          `${ROTULO_RESULTADO[d.resultado]}: ${d.proposta?.titulo ?? ''}`,
          `Registrada em ${dataBr(d.registrada_em)} · rodada ${d.rodada}\n${d.votos_favor} a favor · ${d.votos_contra} contra · ${d.abstencoes} abstenções · ${d.bloqueios} bloqueios · quórum ${d.quorum_atingido ? 'atingido' : 'não atingido'} (${d.quorum_exigido})\n\n${cortar(d.resumo_md, 3000)}`,
          COR.neutra,
        ),
      ],
      components: d.proposta ? [linha(botao(`assembleia:ver:${d.proposta.id}`, 'Ver a proposta', ButtonStyle.Secondary))] : [],
    });
  });
}

export async function handleInteraction(interaction, partes) {
  const [acao, a1, a2, a3] = partes;
  if (acao === 'abrir') return mostrarProposta(interaction, interaction.values[0]);
  if (acao === 'abrir-decisao') return mostrarDecisao(interaction, interaction.values[0]);
  if (acao === 'ver') return mostrarProposta(interaction, a1);
  if (acao === 'comentar') {
    return interaction.showModal(
      new ModalBuilder().setCustomId(`assembleia:m-comentar:${a1}`).setTitle('Comentar no debate').addComponents(
        campo('corpo', 'Seu comentário (Markdown)', TextInputStyle.Paragraph, { min: 2, max: 3000 }),
      ),
    );
  }
  if (acao === 'bloquear') {
    return interaction.showModal(
      new ModalBuilder().setCustomId(`assembleia:m-bloqueio:${a1}:${a2}`).setTitle('Bloquear a proposta').addComponents(
        campo('justificativa', 'Justificativa pública (mín. 200 caracteres)', TextInputStyle.Paragraph, { min: 200, max: 3000 }),
      ),
    );
  }
  if (acao === 'votar') {
    await interaction.deferUpdate();
    return comoMembro(interaction, async ({ sb, perfil }) => {
      await dados(sb.from('votos').upsert({ proposta_id: a1, profile_id: perfil.id, rodada: Number(a2), voto: a3, justificativa: null, peso: 1 }, { onConflict: 'proposta_id,profile_id,rodada' }));
      return mostrarProposta(interaction, a1);
    }, { adiar: false });
  }
}

export async function handleModalSubmit(interaction, partes) {
  const [tipo, a1, a2, a3, a4] = partes;
  const texto = (c) => interaction.fields.getTextInputValue(c)?.trim() ?? '';
  if (tipo === 'm-comentar') {
    return comoMembro(interaction, async ({ sb, perfil }) => {
      await dados(sb.from('proposta_comentarios').insert({ proposta_id: a1, autor_id: perfil.id, corpo_md: texto('corpo') }));
      return mostrarProposta(interaction, a1);
    });
  }
  if (tipo === 'm-bloqueio') {
    return comoMembro(interaction, async ({ sb, perfil }) => {
      await dados(sb.from('votos').upsert({ proposta_id: a1, profile_id: perfil.id, rodada: Number(a2), voto: 'bloqueio', justificativa: texto('justificativa'), peso: 1 }, { onConflict: 'proposta_id,profile_id,rodada' }));
      return mostrarProposta(interaction, a1);
    });
  }
  if (tipo === 'm-nova') {
    // a1 = tipo, a2 = dias de debate, a3 = dias de votação, a4 = rascunho (1/0)
    return comoMembro(interaction, async ({ sb, perfil }) => {
      if (perfil.nivel < 3 && perfil.papel !== 'admin') {
        return erro(interaction, `Abrir propostas é para o nível 3 (Curador). Você está no nível ${perfil.nivel}.`);
      }
      if (a1 === 'nucleo' && !perfil.nucleo_id) return erro(interaction, 'Para propor no seu núcleo, escolha um núcleo no perfil do app primeiro.');
      // Prazos com uma folga de 5 minutos sobre os mínimos (o servidor confere)
      const debateAte = new Date(Date.now() + Number(a2) * 86_400_000 + 5 * 60_000);
      const votacaoAte = new Date(debateAte.getTime() + Number(a3) * 86_400_000);
      const abrir = a4 !== '1';
      const p = await dados(
        sb.from('propostas').insert({
          autor_id: perfil.id,
          titulo: texto('titulo'),
          contexto_md: texto('contexto'),
          proposta_md: texto('proposta'),
          tipo: a1,
          escopo_nucleo_id: a1 === 'nucleo' ? perfil.nucleo_id : null,
          debate_ate: debateAte.toISOString(),
          votacao_ate: votacaoAte.toISOString(),
          status: abrir ? 'debate' : 'rascunho',
        }).select('id').single(),
      );
      if (!abrir) return responder(interaction, { embeds: [embed('Rascunho salvo', 'Sua proposta ficou como rascunho. Abra o debate pelo app quando estiver pronta.', COR.secundaria)] });
      agendarSincronizacao();
      return mostrarProposta(interaction, p.id);
    });
  }
}
