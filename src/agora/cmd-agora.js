// ============================================
// agora/cmd-agora.js — /agora: entrar, perfil, e-mail, notificações, busca, ajuda
// ============================================

import crypto from 'node:crypto';
import { ButtonBuilder, ButtonStyle, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { ajudaPrefixo } from './prefixo.js';
import { clienteAdmin, dados, limparSessoes, perfilIdDoDiscord, vinculoDe } from './cliente.js';
import {
  COR, LIMIARES, NOMES_NIVEIS, PERMISSOES_NIVEL, ROTULOS_ACAO,
  botao, comoMembro, cortar, data as dataBr, embed, EFEMERA, erro, linha, linkApp, menuAbrir, nomePublico, numero, plural, relativo, responder, telaConduta,
} from './ui.js';

export const data_ = new SlashCommandBuilder()
  .setName('agora')
  .setDescription('Prévia da Ágora: sua conta, perfil, busca e notificações.')
  .addSubcommand((s) => s.setName('entrar').setDescription('Cria sua conta na Ágora (uma vez só) e mostra como começar.'))
  .addSubcommand((s) =>
    s.setName('perfil').setDescription('Seu nível, reputação e contribuições (ou de outra pessoa).')
      .addUserOption((o) => o.setName('membro').setDescription('Ver o perfil de outra pessoa').setRequired(false)),
  )
  .addSubcommand((s) => s.setName('app').setDescription('Gera um código para entrar no app com esta mesma conta (sem e-mail nem senha).'))
  .addSubcommand((s) =>
    s.setName('email').setDescription('Cadastra um e-mail para também entrar no app por link no e-mail.')
      .addStringOption((o) => o.setName('email').setDescription('Seu e-mail').setRequired(true).setMaxLength(200)),
  )
  .addSubcommand((s) =>
    s.setName('pseudonimo').setDescription('Usa um pseudônimo público no lugar do seu nome (ou remove).')
      .addStringOption((o) => o.setName('nome').setDescription('Pseudônimo (deixe vazio para voltar ao nome)').setRequired(false).setMaxLength(40)),
  )
  .addSubcommand((s) => s.setName('notificacoes').setDescription('Suas últimas notificações da Ágora.'))
  .addSubcommand((s) =>
    s.setName('buscar').setDescription('Busca em tópicos, artigos, trilhas, projetos, propostas e decisões.')
      .addStringOption((o) => o.setName('termo').setDescription('O que procurar').setRequired(true).setMinLength(2).setMaxLength(100)),
  )
  .addSubcommand((s) => s.setName('ajuda').setDescription('Tudo o que dá para fazer na prévia pelo Discord.'))
  .addSubcommand((s) =>
    s.setName('reconhecer').setDescription('(Administração) Reconhece contribuições anteriores: dá nível, não dá Dracmas.')
      .addUserOption((o) => o.setName('membro').setDescription('Quem será reconhecido').setRequired(true))
      .addIntegerOption((o) => o.setName('pontos').setDescription('Pontos de reputação (Colaborador = 50, Curador = 250)').setRequired(true).setMinValue(1).setMaxValue(250))
      .addStringOption((o) => o.setName('motivo').setDescription('O que a pessoa já fez (fica público)').setRequired(true).setMinLength(10).setMaxLength(500)),
  );
export { data_ as data };

const ROTULO_BUSCA = { topico: 'Tópico', artigo: 'Artigo', trilha: 'Trilha', projeto: 'Projeto', proposta: 'Proposta', decisao: 'Decisão' };
const ABRIR_BUSCA = {
  topico: '`/biblioteca topico`', artigo: '`/biblioteca artigo`', trilha: '`/biblioteca trilha`',
  projeto: '`/mutirao projeto`', proposta: '`/assembleia proposta`', decisao: '`/assembleia decisoes`',
};

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'ajuda') return responder(interaction, { embeds: [telaAjuda()] });
  if (sub === 'entrar') return entrar(interaction);
  if (sub === 'perfil') return perfil(interaction);
  if (sub === 'app') return codigoApp(interaction);
  if (sub === 'reconhecer') return reconhecer(interaction);
  if (sub === 'email') return cadastrarEmail(interaction, interaction.options.getString('email'));
  if (sub === 'pseudonimo') return definirPseudonimo(interaction, interaction.options.getString('nome'));
  if (sub === 'notificacoes') return notificacoes(interaction);
  if (sub === 'buscar') return buscar(interaction, interaction.options.getString('termo'));
}

export function telaAjuda() {
  return embed(
    'O que dá para fazer na prévia',
    [
      '**Jeito mais fácil**: `/menu` (ou `%menu`) abre um painel com botões para tudo, e o **Tutorial** explica cada parte.',
      ajudaPrefixo() ?? '',
      '',
      '**Conta**: `/agora entrar` · `/agora app` (código para entrar no app) · `/agora perfil` · `/agora email` · `/agora pseudonimo` · `/agora notificacoes` · `/agora buscar`',
      '**Dracmas**: `/dracmas` mostra os créditos que você já acumulou contribuindo.',
      '**Biblioteca**: `/biblioteca temas · topicos · topico · novo-topico · artigos · artigo · escrever · meus-artigos · revisar · trilhas · trilha · salvos · acervo`',
      '**Mutirão**: `/mutirao projetos · projeto · tarefas · horas · confirmar-horas · eventos · evento · novo-evento · checkin · caixa · doar`',
      '**Assembleia**: `/assembleia propostas · proposta · nova · decisoes`',
      '',
      'Tudo acontece no **mesmo banco do app**: o que você publica, vota ou registra aqui continua lá quando o app lançar.',
      `Respostas do bot são visíveis só para você. App: ${linkApp()}.`,
    ].join('\n'),
    COR.secundaria,
  );
}

export async function entrar(interaction) {
  return comoMembro(
    interaction,
    async ({ perfil }) => {
      if (!perfil.aceitou_codigo_conduta_em) return responder(interaction, telaConduta(perfil));
      return responder(interaction, {
        embeds: [
          embed(
            `Você já está na Ágora, ${perfil.nome_exibicao}`,
            `Nível **${perfil.nivel} · ${NOMES_NIVEIS[perfil.nivel]}** com **${perfil.reputacao_total}** pontos de reputação.\n\nAbra o painel com \`/menu\` ou veja os comandos em \`/agora ajuda\`.`,
            COR.secundaria,
          ),
        ],
        components: [linha(botao('menu:inicio', 'Abrir o menu', ButtonStyle.Primary, '🧭'), botao('menu:tutorial:0', 'Tutorial', ButtonStyle.Secondary, '🎓'))],
      });
    },
    { semConduta: true },
  );
}

/** Botão "Aceito o Código de Conduta" */
export async function handleInteraction(interaction, partes) {
  if (partes[0] === 'aceitar') {
    await interaction.deferUpdate();
    return comoMembro(
      interaction,
      async ({ sb, perfil }) => {
        const agoraIso = new Date().toISOString();
        await dados(
          sb.from('profiles')
            .update({ aceitou_codigo_conduta_em: perfil.aceitou_codigo_conduta_em ?? agoraIso, onboarding_concluido_em: perfil.onboarding_concluido_em ?? agoraIso })
            .eq('id', perfil.id).select('id').single(),
        );
        return responder(interaction, {
          embeds: [
            embed(
              'Tudo certo! Sua conta na Ágora está pronta',
              [
                'Por onde começar:',
                '• `/menu` — painel com botões para tudo (e um tutorial)',
                '• `/biblioteca topicos` — conversas abertas por tema',
                '• `/mutirao projetos` — ações solidárias com caixa transparente',
                '• `/assembleia propostas` — o que está em debate e votação',
                '• `/dracmas` — seus créditos de Dracma',
                '',
                `Para usar a mesma conta no app: \`/agora app\` gera um código de entrada. App: ${linkApp()}.`,
              ].join('\n'),
              COR.secundaria,
            ),
          ],
          components: [linha(botao('menu:inicio', 'Abrir o menu', ButtonStyle.Primary, '🧭'), botao('menu:tutorial:0', 'Tutorial', ButtonStyle.Secondary, '🎓'))],
        });
      },
      { semConduta: true, adiar: false },
    );
  }
  if (partes[0] === 'lidas') return marcarLidas(interaction);
  if (partes[0] === 'novo-codigo') return codigoApp(interaction);
  if (partes[0] === 'busca') {
    // menu da busca: "tipo|id" → abre o item direto
    const [tipo, id] = interaction.values[0].split('|');
    const abrir = await abridor(tipo);
    if (abrir) return abrir(interaction, id);
    return interaction.reply({ content: `Abra com ${ABRIR_BUSCA[tipo]}.`, flags: EFEMERA });
  }
}

/** Funções de detalhe de cada módulo (import tardio evita ciclo na carga) */
async function abridor(tipo) {
  if (tipo === 'topico') return (await import('./cmd-biblioteca.js')).mostrarTopico;
  if (tipo === 'artigo') return (await import('./cmd-biblioteca.js')).mostrarArtigo;
  if (tipo === 'trilha') return (await import('./cmd-biblioteca.js')).mostrarTrilha;
  if (tipo === 'projeto') return (await import('./cmd-mutirao.js')).mostrarProjeto;
  if (tipo === 'proposta') return (await import('./cmd-assembleia.js')).mostrarProposta;
  if (tipo === 'decisao') return (await import('./cmd-assembleia.js')).mostrarDecisao;
  return null;
}

export async function perfil(interaction) {
  const alvo = interaction.options?.getUser?.('membro') ?? null;
  return comoMembro(interaction, async ({ sb, perfil: eu }) => {
    let perfilId = eu.id;
    if (alvo && alvo.id !== interaction.user.id) {
      perfilId = await perfilIdDoDiscord(alvo.id);
      if (!perfilId) return erro(interaction, `${alvo} ainda não entrou na prévia da Ágora.`);
    }
    const p = await dados(sb.from('perfis_publicos').select('*').eq('id', perfilId).maybeSingle());
    if (!p) return erro(interaction, 'Não encontramos esse perfil.');
    const [historico, artigos, horas, presencas, propostas, revisoes] = await Promise.all([
      dados(sb.rpc('historico_reputacao', { p_profile: perfilId, p_limite: 6, p_antes: null })),
      dados(sb.from('artigo_autores').select('artigo:artigos(status)').eq('profile_id', perfilId).in('papel', ['autor', 'coautor'])),
      dados(sb.from('horas_voluntariado').select('horas').eq('profile_id', perfilId).not('confirmado_em', 'is', null)),
      sb.from('rsvps').select('evento_id', { count: 'exact', head: true }).eq('profile_id', perfilId).eq('presente', true),
      sb.from('propostas').select('id', { count: 'exact', head: true }).eq('autor_id', perfilId).neq('status', 'rascunho'),
      sb.from('revisoes').select('id', { count: 'exact', head: true }).eq('revisor_id', perfilId),
    ]);
    const publicados = artigos.filter((a) => a.artigo?.status === 'publicado').length;
    const totalHoras = horas.reduce((s, h) => s + Number(h.horas), 0);
    const nivel = p.nivel;
    const prox = nivel < 4 ? LIMIARES[nivel + 1] : null;
    const barra = (() => {
      if (!prox) return '██████████ nível máximo';
      const ini = LIMIARES[nivel];
      const pct = Math.max(0, Math.min(1, (p.reputacao_total - ini) / (prox - ini)));
      const cheios = Math.round(pct * 10);
      return `${'█'.repeat(cheios)}${'░'.repeat(10 - cheios)} faltam ${Math.max(0, prox - p.reputacao_total)} pontos para ${NOMES_NIVEIS[nivel + 1]}`;
    })();
    const e = embed(
      `${nomePublico(p)}${p.papel !== 'membro' ? ` · ${p.papel}` : ''}`,
      [
        `**Nível ${nivel} · ${NOMES_NIVEIS[nivel]}** — ${p.reputacao_total} pontos`,
        barra,
        p.cidade ? `📍 ${p.cidade}${p.estado ? `/${p.estado}` : ''}` : null,
        p.bio ? `\n${cortar(p.bio, 300)}` : null,
      ].filter(Boolean).join('\n'),
    );
    e.addFields(
      {
        name: 'Contribuições',
        value: [
          plural(publicados, 'artigo publicado', 'artigos publicados'),
          plural(revisoes.count ?? 0, 'revisão', 'revisões'),
          `${numero(totalHoras)} h de voluntariado confirmadas`,
          plural(presencas.count ?? 0, 'presença em evento', 'presenças em eventos'),
          plural(propostas.count ?? 0, 'proposta na Assembleia', 'propostas na Assembleia'),
        ].join('\n'),
        inline: true,
      },
      {
        name: `O nível ${nivel} permite`,
        value: [1, 2, 3, 4].filter((n) => n <= nivel).flatMap((n) => PERMISSOES_NIVEL[n]).map((x) => `• ${x}`).join('\n').slice(0, 1024),
        inline: true,
      },
    );
    if (historico.length) {
      e.addFields({
        name: 'Reputação recente',
        value: historico.map((h) => `${h.pontos > 0 ? '+' : ''}${h.pontos} · ${ROTULOS_ACAO[h.acao] ?? h.acao} · ${relativo(h.criado_em)}`).join('\n'),
      });
    }
    try {
      if (alvo) e.setThumbnail(alvo.displayAvatarURL({ size: 128 }));
    } catch {
      /* avatar indisponível: segue sem miniatura */
    }
    return responder(interaction, { embeds: [e] });
  });
}

// ------------------------------------------------------------------ entrar no app
// Código de uso único (15 min) que o app troca por uma sessão desta conta, pela Edge
// Function entrar-com-codigo. Só o hash fica no banco.
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O e 1/I, que se confundem
const VALIDADE_MIN = 15;

export function gerarCodigo() {
  let c = '';
  for (let i = 0; i < 8; i++) c += ALFABETO[crypto.randomInt(ALFABETO.length)];
  return c;
}
export const hashCodigo = (codigo) => crypto.createHash('sha256').update(codigo.toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');

export async function codigoApp(interaction) {
  return comoMembro(interaction, async ({ perfil }) => {
    const adm = clienteAdmin();
    const codigo = gerarCodigo();
    // um código válido por vez: gerar outro invalida o anterior
    await dados(adm.from('codigos_login').delete().eq('profile_id', perfil.id).is('usado_em', null));
    await dados(adm.from('codigos_login').insert({
      codigo_hash: hashCodigo(codigo), profile_id: perfil.id, expira_em: new Date(Date.now() + VALIDADE_MIN * 60_000).toISOString(),
    }));
    const formatado = `${codigo.slice(0, 4)}-${codigo.slice(4)}`;
    const expira = Math.floor((Date.now() + VALIDADE_MIN * 60_000) / 1000);
    return responder(interaction, {
      embeds: [
        embed(
          'Seu código para entrar no app',
          [
            `# ${formatado}`,
            `Vale até <t:${expira}:t> (${VALIDADE_MIN} minutos) e funciona **uma vez só**.`,
            '',
            '**No celular:**',
            `1. Instale o app da Ágora (botão abaixo) e abra.`,
            '2. Toque em **Entrar** › **Já usa a Ágora pelo Discord?**',
            `3. Digite **${formatado}**. Pronto: é a mesma conta, com sua reputação, artigos, votos e Dracmas.`,
            '',
            '🔒 Não mostre este código a ninguém: quem tiver o código entra na sua conta. Precisa de outro? É só pedir de novo (o anterior deixa de valer).',
          ].join('\n'),
          COR.dourado,
        ),
      ],
      components: [linha(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(config.agora.urlApp).setLabel('Baixar o app').setEmoji('📲'),
        botao('agora:novo-codigo', 'Gerar outro código', ButtonStyle.Secondary, '🔁'),
      )],
    });
  }, { semConduta: true });
}

/**
 * E-mail de login (opcional): troca o e-mail técnico da conta pelo da pessoa, para ela também
 * poder entrar no app por link no e-mail. Feito pelo servidor porque o e-mail técnico não
 * recebe mensagens (a troca "pelo usuário" exigiria confirmar nos dois endereços).
 */
export async function cadastrarEmail(interaction, bruto) {
  const valor = String(bruto ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor)) return erro(interaction, 'Esse e-mail não parece válido.');
  if (valor.endsWith(`@${config.agora.dominioEmail}`)) return erro(interaction, 'Use o seu e-mail pessoal.');
  return comoMembro(interaction, async ({ perfil }) => {
    const adm = clienteAdmin();
    const { error } = await adm.auth.admin.updateUserById(perfil.id, { email: valor });
    if (error) {
      if (/already|registered|exists/i.test(error.message)) {
        return erro(interaction, 'Esse e-mail já é usado por outra conta da Ágora. Para entrar no app com **esta** conta do Discord, use `/agora app`.');
      }
      return erro(interaction, `Não foi possível cadastrar o e-mail: ${error.message}`);
    }
    await dados(adm.from('discord_vinculos').update({ email_tecnico: valor }).eq('discord_id', interaction.user.id));
    limparSessoes(interaction.user.id);
    return responder(interaction, {
      embeds: [
        embed(
          'E-mail cadastrado',
          `Agora você também pode entrar no app com **${valor}**: em **Entrar**, toque em *Receber link de acesso* e abra o link que chegar nesse e-mail.\nO jeito mais rápido continua sendo o código: \`/agora app\`.`,
          COR.secundaria,
        ),
      ],
    });
  });
}

export async function definirPseudonimo(interaction, bruto) {
  const nome = String(bruto ?? '').trim() || null;
  return comoMembro(interaction, async ({ sb, perfil }) => {
    await dados(
      sb.from('profiles').update({ pseudonimo: nome ?? perfil.pseudonimo, pseudonimo_ativo: Boolean(nome) }).eq('id', perfil.id).select('id').single(),
    );
    return responder(interaction, {
      embeds: [embed(null, nome ? `Pronto: você aparece como **${nome}** na Ágora.` : `Pronto: você volta a aparecer como **${perfil.nome_exibicao}**.`, COR.secundaria)],
    });
  });
}

export async function notificacoes(interaction) {
  return comoMembro(interaction, async ({ sb, perfil }) => {
    const lista = await dados(
      sb.from('notificacoes').select('id, titulo, corpo, lida, created_at').eq('profile_id', perfil.id).order('created_at', { ascending: false }).limit(15),
    );
    if (!lista.length) return responder(interaction, { embeds: [embed('Notificações', 'Nada por aqui ainda. Quando alguém responder você, votar ou confirmar suas horas, aparece aqui.', COR.neutra)] });
    const naoLidas = lista.filter((n) => !n.lida).length;
    const e = embed(
      `Notificações${naoLidas ? ` · ${naoLidas} nova${naoLidas > 1 ? 's' : ''}` : ''}`,
      lista.map((n) => `${n.lida ? '▫️' : '🔸'} **${cortar(n.titulo, 90)}** · ${relativo(n.created_at)}${n.corpo ? `\n${cortar(n.corpo, 140)}` : ''}`).join('\n\n'),
    );
    return responder(interaction, {
      embeds: [e],
      components: naoLidas ? [linha(botao('agora:lidas', 'Marcar todas como lidas', ButtonStyle.Secondary, '✓'))] : [],
    });
  });
}

async function marcarLidas(interaction) {
  await interaction.deferUpdate();
  return comoMembro(
    interaction,
    async ({ sb, perfil }) => {
      await dados(sb.from('notificacoes').update({ lida: true }).eq('profile_id', perfil.id).eq('lida', false));
      return responder(interaction, { embeds: [embed('Notificações', 'Todas marcadas como lidas.', COR.neutra)] });
    },
    { adiar: false },
  );
}

export async function buscar(interaction, bruto) {
  const termo = String(bruto ?? '').trim();
  if (termo.length < 2) return comoMembro(interaction, async () => erro(interaction, 'Digite pelo menos 2 letras.'));
  return comoMembro(interaction, async ({ sb }) => {
    const lista = await dados(sb.rpc('buscar', { p_termo: termo, p_limite: 8 }));
    if (!lista.length) return responder(interaction, { embeds: [embed(`Busca: “${termo}”`, 'Nada encontrado. Tente outras palavras.', COR.neutra)] });
    const e = embed(
      `Busca: “${termo}”`,
      lista.slice(0, 15).map((r) => `**${ROTULO_BUSCA[r.tipo]}** · ${cortar(r.titulo, 90)}${r.data ? ` · ${dataBr(r.data)}` : ''}\n${cortar(String(r.trecho ?? '').replace(/<\/?b>/g, '**'), 160)}`).join('\n\n'),
    );
    return responder(interaction, {
      embeds: [e],
      components: [menuAbrir('agora:busca', 'Como abrir um resultado…', lista.slice(0, 25).map((r) => ({ rotulo: `${ROTULO_BUSCA[r.tipo]}: ${r.titulo}`, valor: `${r.tipo}|${r.id}` })))].filter(Boolean),
    });
  });
}


// ------------------------------------------------------------------ reconhecimento (administração)
async function reconhecer(interaction) {
  const alvo = interaction.options.getUser('membro');
  const pontos = interaction.options.getInteger('pontos');
  const motivo = interaction.options.getString('motivo');
  return comoMembro(interaction, async ({ sb, perfil }) => {
    if (perfil.papel !== 'admin') return erro(interaction, 'Só a administração da Ágora reconhece contribuições.');
    if (alvo.bot) return erro(interaction, 'Bots não participam da Ágora.');
    // Quem ainda não entrou na prévia ganha a conta agora (ligada ao Discord dela)
    const vinculo = await vinculoDe(alvo, alvo.globalName || alvo.username);
    await dados(sb.rpc('reconhecer_contribuicao', { p_profile: vinculo.profile_id, p_pontos: pontos, p_motivo: motivo }));
    const p = await dados(sb.from('perfis_publicos').select('nivel, reputacao_total').eq('id', vinculo.profile_id).single());
    return responder(interaction, {
      embeds: [
        embed(
          'Contribuição reconhecida',
          [
            `${alvo} recebeu **+${pontos} pontos de reputação** e agora está no **nível ${p.nivel} · ${NOMES_NIVEIS[p.nivel]}** (${p.reputacao_total} pontos).`,
            `Motivo (público): ${motivo}`,
            '',
            'Reconhecimento dá nível, mas não gera Dracmas. Cada pessoa pode receber até 250 pontos assim; o resto se conquista contribuindo.',
          ].join('\n'),
          COR.secundaria,
        ),
      ],
    });
  });
}
