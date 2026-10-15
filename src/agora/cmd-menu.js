// ============================================
// agora/cmd-menu.js — /menu: painel com botões para tudo + tutorial
// ============================================
// Para quem não quer decorar comandos: um painel (só a pessoa vê) com botões para
// conta, Dracmas, Biblioteca, Acervo, Mutirão e Assembleia, e um tutorial em páginas.
// A administração pode fixar um painel público num canal (/menu fixar_no_canal:true);
// cada clique nele abre o menu pessoal, sem mudar a mensagem do canal.

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { config } from '../config.js';
import { dados } from './cliente.js';
import * as agora from './cmd-agora.js';
import * as biblioteca from './cmd-biblioteca.js';
import * as mutirao from './cmd-mutirao.js';
import * as assembleia from './cmd-assembleia.js';
import * as aulas from './cmd-aulas.js';
import { execute as dracmas } from './cmd-dracmas.js';
import { COR, EFEMERA, LIMIARES, NOMES_NIVEIS, botao, comoMembro, cortar, embed, erro, linha, numero, responder, telaConduta } from './ui.js';

export const data = new SlashCommandBuilder()
  .setName('menu')
  .setDescription('Painel da Ágora com botões: conta, Dracmas, Biblioteca, Acervo, Mutirão, Assembleia e tutorial.')
  .addBooleanOption((o) =>
    o.setName('fixar_no_canal').setDescription('(Administração) Publica um painel fixo neste canal para todo mundo usar.').setRequired(false),
  );

// ------------------------------------------------------------------ apoio
const linkApp = () => new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(config.agora.urlApp).setLabel('Baixar o app').setEmoji('📲');
const voltar = () => botao('menu:inicio', 'Menu', ButtonStyle.Secondary, '🧭');
const desligado = (b, condicao) => (condicao ? b : b.setDisabled(true));

/** Clique numa mensagem só da pessoa → atualiza no lugar; no painel público → abre uma mensagem nova só para ela. */
const ehMensagemPessoal = (interaction) => Boolean(interaction.message?.flags?.has(MessageFlags.Ephemeral));

async function mostrarTela(interaction, montar, { semConduta = true } = {}) {
  const noLugar = interaction.isMessageComponent?.() && ehMensagemPessoal(interaction);
  if (noLugar) await interaction.deferUpdate();
  return comoMembro(interaction, async (acesso) => responder(interaction, await montar(acesso)), { semConduta, adiar: !noLugar });
}

// ------------------------------------------------------------------ telas
async function telaInicio({ sb, perfil }) {
  const temConta = Boolean(perfil.aceitou_codigo_conduta_em);
  let saudacao;
  if (!temConta) {
    saudacao = [
      'A **Ágora** é uma comunidade para **estudar** (Biblioteca), **agir junto** (Mutirão) e **decidir junto** (Assembleia).',
      'Antes do app ser lançado, dá para fazer quase tudo **por aqui** — e tudo vai junto para o app.',
      '',
      '👉 Comece por **Criar minha conta** (leva 10 segundos) ou veja o **Tutorial**.',
    ].join('\n');
  } else {
    const pendente = await dados(sb.rpc('meu_saldo_drc_pendente')).catch(() => 0);
    saudacao = [
      `Olá, **${perfil.pseudonimo_ativo && perfil.pseudonimo ? perfil.pseudonimo : perfil.nome_exibicao}**!`,
      `Nível **${perfil.nivel} · ${NOMES_NIVEIS[perfil.nivel]}** · ${perfil.reputacao_total} pontos de reputação · **${numero(pendente)} DRC** acumulando`,
      perfil.status_assinatura !== 'ativo' ? '\n⚠️ Sua participação não está ativa: você pode ler, mas não publicar. Fale com a administração.' : null,
      perfil.nivel < 2 ? '\n🌱 Começando agora? Toque em **Subir de nível** para ver o que já dá para fazer e quanto cada coisa rende.' : null,
      '',
      'Escolha uma área abaixo. As respostas aparecem só para você.',
    ].filter((x) => x !== null).join('\n');
  }
  const e = embed('Ágora · menu', saudacao, COR.primaria);
  const conta = temConta
    ? botao('menu:conta', 'Minha conta', ButtonStyle.Secondary, '👤')
    : botao('menu:criar', 'Criar minha conta', ButtonStyle.Success, '✅');
  return {
    embeds: [e],
    components: [
      linha(
        conta,
        botao('menu:subir', 'Subir de nível', temConta && perfil.nivel < 2 ? ButtonStyle.Success : ButtonStyle.Secondary, '🌱'),
        botao('menu:dracmas', 'Dracmas', ButtonStyle.Secondary, '🪙'),
        botao('menu:notificacoes', 'Notificações', ButtonStyle.Secondary, '🔔'),
        botao('menu:buscar', 'Buscar', ButtonStyle.Secondary, '🔎'),
      ),
      linha(
        botao('menu:biblioteca', 'Biblioteca', ButtonStyle.Primary, '📚'),
        botao('menu:acervo', 'Acervo', ButtonStyle.Primary, '🗄️'),
        botao('menu:mutirao', 'Mutirão', ButtonStyle.Primary, '🤝'),
        botao('menu:assembleia', 'Assembleia', ButtonStyle.Primary, '🏛️'),
      ),
      linha(
        botao('menu:aulas', 'Aulas', ButtonStyle.Primary, '🎓'),
        botao('menu:tutorial:0', 'Tutorial', ButtonStyle.Secondary, '❓'),
        botao('menu:app', 'Entrar no app', ButtonStyle.Success, '📲'),
        linkApp(),
      ),
    ],
  };
}

function telaAulas({ perfil }) {
  return {
    embeds: [
      embed(
        'Aulas pela call',
        [
          'Alguém ensina num canal de voz; quem participa avalia; quem ensina bem ganha Dracmas.',
          '',
          '1. **Marque** a aula (nível 2+). Ela vira evento do Discord com link para o canal.',
          '2. **Entre na call** na hora. A presença conta sozinha — o bot só observa quem está no canal.',
          '3. **Avalie** com as estrelas que aparecem no chat do canal quando a aula acaba (48 h, anônimo).',
          '4. Com 3+ avaliações e média 3,5+, quem ensinou ganha **+20 pontos** (+30 com média 4,5+) = Dracmas.',
          perfil.nivel < 2 && perfil.papel !== 'admin' ? `\nVocê está no nível ${perfil.nivel}: já pode assistir e avaliar; dar aulas é a partir do nível 2.` : '',
        ].join('\n'),
        COR.secundaria,
      ),
    ],
    components: [
      linha(
        botao('menu:au:proximas', 'Próximas aulas', ButtonStyle.Primary, '📅'),
        desligado(botao('menu:au:nova', 'Marcar aula', ButtonStyle.Success, '➕'), perfil.nivel >= 2 || perfil.papel === 'admin'),
        botao('menu:au:minhas', 'Minhas aulas', ButtonStyle.Secondary, '🧑‍🏫'),
        voltar(),
      ),
    ],
  };
}

function telaSubir({ perfil }) {
  const prox = perfil.nivel < 4 ? LIMIARES[perfil.nivel + 1] : null;
  const ini = LIMIARES[perfil.nivel] ?? 0;
  const pct = prox ? Math.max(0, Math.min(1, (perfil.reputacao_total - ini) / (prox - ini))) : 1;
  const barra = `${'█'.repeat(Math.round(pct * 10))}${'░'.repeat(10 - Math.round(pct * 10))}`;
  return {
    embeds: [
      embed(
        'Como subir de nível',
        [
          prox
            ? `${barra} **${perfil.reputacao_total}/${prox}** — faltam **${prox - perfil.reputacao_total} pontos** para ${NOMES_NIVEIS[perfil.nivel + 1]}.`
            : `${barra} Você está no nível máximo. Obrigado!`,
          '',
          '**O que você já pode fazer agora (qualquer nível) e quanto rende:**',
          '🎓 **Assistir aulas pela call** — a presença conta sozinha: **+5** por aula. E você avalia quem ensinou.',
          '🤝 **Ajudar num projeto do Mutirão** — entre no projeto, assuma uma tarefa e registre as horas; a coordenação confirma: **+8 por hora**.',
          '📅 **Ir a eventos** e fazer o check-in: **+5**.',
          '💬 **Responder tópicos** da Biblioteca — se quem perguntou marcar sua resposta como útil: **+5**.',
          '🗳️ **Votar e comentar** na Assembleia — não dá pontos, mas é a sua voz nas decisões.',
          '',
          'Exemplo: 3 aulas (+15) + 4 horas de mutirão (+32) + 1 resposta útil (+5) = **52 pontos → Colaborador**.',
          '',
          '**No nível 2 (50 pontos)** você passa a criar tópicos, escrever artigos e **dar aulas** (que rendem +20 a +30).',
          '🏅 Já ajudava a comunidade no Discord antes da Ágora? Peça à administração para **reconhecer** suas contribuições.',
        ].join('\n'),
        COR.secundaria,
      ),
    ],
    components: [
      linha(
        botao('menu:au:proximas', 'Próximas aulas', ButtonStyle.Primary, '🎓'),
        botao('menu:m:projetos', 'Projetos', ButtonStyle.Primary, '🤝'),
        botao('menu:m:eventos', 'Eventos', ButtonStyle.Primary, '📅'),
        botao('menu:b:topicos', 'Tópicos', ButtonStyle.Primary, '💬'),
      ),
      linha(botao('menu:a:votacao', 'Votações abertas', ButtonStyle.Secondary, '🗳️'), voltar()),
    ],
  };
}

function telaConta({ perfil }) {
  return {
    embeds: [
      embed(
        'Minha conta',
        [
          `**${perfil.nome_exibicao}**${perfil.pseudonimo_ativo && perfil.pseudonimo ? ` · aparece como **${perfil.pseudonimo}**` : ''}`,
          `Nível ${perfil.nivel} · ${NOMES_NIVEIS[perfil.nivel]} · ${perfil.reputacao_total} pontos`,
          '',
          '• **Perfil**: nível, reputação e contribuições',
          '• **Entrar no app**: gera um código para entrar no app com esta mesma conta (sem e-mail nem senha)',
          '• **E-mail (opcional)**: para também entrar no app por link no e-mail',
          '• **Pseudônimo**: apareça com outro nome nas publicações',
        ].join('\n'),
        COR.neutra,
      ),
    ],
    components: [
      linha(
        botao('menu:perfil', 'Perfil', ButtonStyle.Primary, '👤'),
        botao('menu:app', 'Entrar no app', ButtonStyle.Success, '📲'),
        botao('menu:email', 'E-mail (opcional)', ButtonStyle.Secondary, '📧'),
        botao('menu:pseudonimo', 'Pseudônimo', ButtonStyle.Secondary, '🎭'),
        botao('menu:notificacoes', 'Notificações', ButtonStyle.Secondary, '🔔'),
      ),
      linha(voltar()),
    ],
  };
}

function telaBiblioteca({ perfil }) {
  return {
    embeds: [
      embed(
        'Biblioteca',
        [
          'Conversas por tema, artigos revisados por pares e trilhas de estudo — além do **Acervo** com os documentos da biblioteca do site.',
          '',
          `Criar tópicos e escrever artigos: nível 2 · revisar: nível 3 (você está no nível ${perfil.nivel}).`,
        ].join('\n'),
        COR.secundaria,
      ),
    ],
    components: [
      linha(
        botao('menu:b:topicos', 'Tópicos ativos', ButtonStyle.Primary, '💬'),
        botao('menu:b:artigos', 'Artigos', ButtonStyle.Primary, '📰'),
        botao('menu:b:trilhas', 'Trilhas', ButtonStyle.Primary, '🧭'),
        botao('menu:b:temas', 'Temas', ButtonStyle.Secondary, '🗂️'),
        botao('menu:acervo', 'Acervo', ButtonStyle.Secondary, '🗄️'),
      ),
      linha(
        desligado(botao('menu:b:novo-topico', 'Novo tópico', ButtonStyle.Success, '✏️'), perfil.nivel >= 2),
        desligado(botao('menu:b:escrever', 'Escrever artigo', ButtonStyle.Success, '🖋️'), perfil.nivel >= 2),
        botao('menu:b:meus-artigos', 'Meus artigos', ButtonStyle.Secondary, '📂'),
        desligado(botao('menu:b:revisar', 'Revisar', ButtonStyle.Secondary, '✅'), perfil.nivel >= 3),
        botao('menu:b:salvos', 'Salvos', ButtonStyle.Secondary, '🔖'),
      ),
      linha(voltar()),
    ],
  };
}

function telaMutirao({ perfil }) {
  return {
    embeds: [
      embed(
        'Mutirão',
        [
          'Ações solidárias com **caixa 100% transparente**: projetos, tarefas, horas de voluntariado, eventos e doações via Pix.',
          '',
          'Eventos marcados aqui também aparecem na aba **Eventos** do servidor.',
          perfil.nivel >= 4 || perfil.papel === 'admin' ? '' : 'Marcar eventos: coordenação do projeto ou nível 4.',
        ].join('\n'),
        COR.secundaria,
      ),
    ],
    components: [
      linha(
        botao('menu:m:projetos', 'Projetos', ButtonStyle.Primary, '🧱'),
        botao('menu:m:eventos', 'Eventos', ButtonStyle.Primary, '📅'),
        botao('menu:m:tarefas', 'Minhas tarefas', ButtonStyle.Secondary, '📋'),
        botao('menu:m:confirmar-horas', 'Confirmar horas', ButtonStyle.Secondary, '⏱️'),
      ),
      linha(botao('menu:m:novo-evento', 'Marcar evento', ButtonStyle.Success, '➕'), voltar()),
    ],
  };
}

function telaAssembleia({ perfil }) {
  return {
    embeds: [
      embed(
        'Assembleia',
        [
          'Onde a comunidade decide: propostas passam por **debate** (mín. 5 dias) e **votação** (mín. 3 dias).',
          'Votações abertas aparecem na aba **Eventos** do servidor.',
          '',
          `Abrir propostas: nível 3 (você está no nível ${perfil.nivel}). Votar: qualquer membro ativo.`,
        ].join('\n'),
        COR.secundaria,
      ),
    ],
    components: [
      linha(
        botao('menu:a:votacao', 'Em votação', ButtonStyle.Primary, '🗳️'),
        botao('menu:a:debate', 'Em debate', ButtonStyle.Primary, '💭'),
        botao('menu:a:decisoes', 'Decisões', ButtonStyle.Secondary, '📜'),
        botao('menu:a:minhas', 'Minhas', ButtonStyle.Secondary, '🙋'),
      ),
      linha(desligado(botao('menu:a:nova', 'Nova proposta', ButtonStyle.Success, '➕'), perfil.nivel >= 3 || perfil.papel === 'admin'), voltar()),
    ],
  };
}

// ------------------------------------------------------------------ tutorial
export const PAGINAS_TUTORIAL = [
  {
    titulo: '1 · O que é a Ágora',
    texto: [
      'A Ágora é a casa da comunidade, com três partes:',
      '📚 **Biblioteca** — estudar junto: conversas por tema, artigos revisados por pares, trilhas de estudo e o **Acervo** com os documentos da biblioteca do site.',
      '🤝 **Mutirão** — agir junto: projetos solidários, tarefas, horas de voluntariado, eventos e um caixa público.',
      '🏛️ **Assembleia** — decidir junto: propostas, debate, votação e um arquivo de decisões.',
      '',
      'O app ainda não foi lançado. Esta **prévia pelo Discord** usa o **mesmo banco do app**: o que você faz aqui (reputação, artigos, votos, horas) continua valendo lá.',
      'As respostas do bot aparecem **só para você**. O bot não posta nada no chat.',
    ],
  },
  {
    titulo: '2 · Sua conta',
    texto: [
      '**Criar conta**: botão *Criar minha conta* no `/menu` (ou `/agora entrar`). O bot cria sua conta na Ágora ligada ao seu Discord — sem senha.',
      '**Código de Conduta**: na primeira vez você lê e aceita. Respeito acima de tudo; discorde de ideias, nunca de pessoas.',
      '**Participação ativa**: quem tem o cargo de membro do servidor pode publicar, votar e registrar horas. Sem ele, dá para ler.',
      '**Entrar no app**: toque em *Entrar no app* no menu (ou `/agora app`). O bot mostra um código (ex.: ABCD-EFGH). No app: **Entrar › Já usa a Ágora pelo Discord?** e digite o código. É a mesma conta, com tudo o que você fez aqui — sem e-mail nem senha. O código vale 15 minutos e uma vez; peça outro sempre que precisar (por exemplo, num celular novo).',
      '**E-mail (opcional)**: se cadastrar um e-mail (`/agora email`), também dá para entrar no app com *Receber link de acesso*.',
      '**Pseudônimo**: se preferir, apareça com outro nome nas publicações.',
    ],
  },
  {
    titulo: '3 · Reputação e níveis',
    texto: [
      'Toda contribuição **confirmada** vira pontos de reputação:',
      '• Artigo publicado (depois da revisão): **+40**',
      '• Revisão de artigo concluída: **+10**',
      '• Resposta marcada como útil: **+5**',
      '• Hora de voluntariado confirmada pela coordenação: **+8 por hora**',
      '• Aula bem avaliada por quem participou: **+20** (+30 com média 4,5+)',
      '• Presença confirmada em evento (check-in): **+5**',
      '• Trilha publicada: **+30** · projeto concluído: **+50** · proposta aprovada: **+20**',
      '• Conteúdo removido pela moderação: **−20**',
      '',
      '**Níveis**: 1 Aprendiz (0) · 2 Colaborador (50) · 3 Curador (250) · 4 Guardião (800).',
      'Cada nível libera coisas novas: tópicos e artigos no 2, revisão e propostas no 3, projetos e moderação no 4.',
      'Ninguém compra reputação: ela só vem de contribuição.',
      '',
      '🌱 **Começando no nível 1?** Assista a aulas (+5), ajude num projeto do Mutirão (+8/h), vá a eventos (+5) e responda tópicos (+5 se for útil). O botão **Subir de nível** do `/menu` mostra o caminho. Quem já contribuía no Discord pode ter isso reconhecido pela administração (dá nível, não Dracmas).',
    ],
  },
  {
    titulo: '4 · Dracmas (DRC): como chegam até você',
    texto: [
      '**1. Contribuiu → crédito.** Cada ponto de reputação gera **1 DRC** de crédito na hora (o "acumulando" do `/dracmas`).',
      '**2. Fechamento semanal.** Toda **segunda-feira às 00:10 (Brasília)** a semana fecha. Os créditos de quem tem a **carteira do app** viram um valor resgatável daquela semana (até **2.000 DRC por pessoa por semana**; o que passar fica para a semana seguinte).',
      '**3. Resgate.** No app, na aba Carteira, você toca em *Resgatar*. O app cuida da prova e da taxa de rede — você não paga nada.',
      '',
      '**E na prévia?** Seus créditos ficam guardados e **não expiram**. Quando você instalar o app e criar a carteira, eles entram nos próximos fechamentos.',
      'Se a moderação remover um conteúdo seu, os créditos ainda não fechados diminuem.',
    ],
  },
  {
    titulo: '5 · Dracmas: pra que servem',
    texto: [
      '🗳️ **Voz nas decisões on-chain**: algumas propostas da Assembleia são votadas na blockchain, com peso pelos DRC.',
      '🏅 **Reconhecimento**: mostram quanto cada pessoa já contribuiu, de um jeito que ninguém pode apagar ou inventar.',
      '',
      '**O que o Dracma não é**: não é vendido, não tem preço no app e **não é investimento**. Não existe "comprar Dracma" na Ágora.',
      'Hoje ele roda numa rede de testes (Base Sepolia). Qualquer mudança nisso passa pela Assembleia.',
    ],
  },
  {
    titulo: '6 · Biblioteca e Acervo',
    texto: [
      '💬 **Tópicos**: conversas abertas por tema. Responda; se sua resposta for marcada como útil, ganha reputação.',
      '📰 **Artigos**: textos mais caprichados. Você escreve, **dois curadores** revisam e aí ele é publicado.',
      '🧭 **Trilhas**: sequências de artigos para estudar um assunto do começo ao fim, com progresso.',
      '🔖 **Salvos**: guarde o que quer ler depois.',
      '🗄️ **Acervo**: o índice da biblioteca do site — dezenas de milhares de PDFs, apostilas e livros, por **categoria**, **coleção** e **assunto**, com busca pelo título. Os arquivos abrem no Google Drive.',
      '',
      'Comandos: `/biblioteca …` · `/biblioteca acervo` · ou o botão **Biblioteca** do `/menu`.',
    ],
  },
  {
    titulo: '7 · Aulas pela call',
    texto: [
      '🎓 Quem é nível 2+ pode **dar aulas** num canal de voz: `/aulas nova` ou `/menu › Aulas`. A aula vira um evento do Discord com link para o canal.',
      '🔊 Na hora, é só **entrar na call**. O bot não entra nem fala: ele só vê quem está no canal e soma os minutos. Quem fica pelo menos metade da aula (no máximo 30 min exigidos) ganha presença (+5).',
      '⭐ Quando a aula acaba, aparecem **estrelas no chat do canal**. Só quem participou avalia, de forma anônima, por 48 horas — e pode deixar um comentário para quem ensinou.',
      '🪙 Fechada a avaliação: com **3+ avaliações** de membros com conta de 7+ dias e **média 3,5+**, quem ensinou ganha **+20 pontos** (+30 com média 4,5+), que viram Dracmas. No máximo 3 aulas pontuadas por semana.',
      '',
      'Por que essas regras? Para que o Dracma reconheça quem ensina de verdade, e não combinações entre amigos.',
    ],
  },
  {
    titulo: '8 · Mutirão',
    texto: [
      '🧱 **Projetos**: ações solidárias, cada uma com coordenação, tarefas e caixa.',
      '📋 **Tarefas**: assuma uma, mude o andamento e registre as horas.',
      '⏱️ **Horas**: você registra, a coordenação confirma (+8 de reputação por hora).',
      '📅 **Eventos**: diga se vai; no dia, use o **código de check-in** mostrado pela organização (`/mutirao checkin`). Eventos marcados pelo bot ou pelo app aparecem sozinhos na aba **Eventos** do servidor.',
      '🔊 **Reuniões pela call** (planejamento, divisão de tarefas): marque com um canal de voz e a presença conta sozinha, sem código.',
      '💚 **Caixa transparente**: toda entrada e saída é pública e não pode ser apagada. Doações via **Pix** entram no caixa assim que o pagamento confirma.',
    ],
  },
  {
    titulo: '9 · Assembleia',
    texto: [
      '1. Alguém de nível 3 abre uma **proposta** (contexto + o que se propõe).',
      '2. **Debate** por pelo menos 5 dias: todo mundo comenta e a proposta pode melhorar.',
      '3. **Votação** por pelo menos 3 dias: a favor, contra, abstenção ou **bloqueio** (exige justificativa de 200+ caracteres).',
      '4. Precisa de **quórum** (10% dos membros ativos) e **60%** a favor (2/3 para finanças e regimento).',
      '5. A decisão vai para o **arquivo de decisões**, que não pode ser alterado.',
      '',
      'Propostas em debate ou votação aparecem na aba **Eventos** do servidor até a votação fechar.',
      '🔊 **Debate ao vivo**: quem é nível 3 pode marcar uma conversa sobre a proposta num canal de voz (`/assembleia sessao`). A presença fica registrada, mas **não vale pontos** — ninguém ganha Dracmas por comparecer a decisões, e o voto continua sendo pelo bot ou app.'
    ],
  },
  {
    titulo: '10 · O que já funciona na prévia',
    texto: [
      '✅ Conta, perfil, pseudônimo, notificações e busca',
      '✅ Biblioteca completa: tópicos, respostas, artigos, revisão, trilhas e salvos',
      '✅ Acervo da biblioteca do site',
      '✅ Mutirão: projetos, tarefas, horas, eventos, check-in, caixa e Pix',
      '✅ Aulas e encontros pela call, com presença automática e avaliação',
      '✅ Assembleia: propostas, comentários, votação e decisões',
      '✅ Reputação e créditos de Dracma',
      '',
      '📲 **Só no app**: carteira e resgate dos Dracmas, notificações no celular, leitura offline, check-in pela câmera e montar trilhas.',
      '',
      'Dúvidas ou problemas? Fale com a administração do servidor.',
    ],
  },
];

export function telaTutorial(pagina) {
  const n = Math.max(0, Math.min(PAGINAS_TUTORIAL.length - 1, Number(pagina) || 0));
  const p = PAGINAS_TUTORIAL[n];
  const e = embed(`Tutorial · ${p.titulo}`, p.texto.join('\n'), COR.dourado);
  e.addFields({ name: '​', value: `Página ${n + 1} de ${PAGINAS_TUTORIAL.length}` });
  const ultimo = n === PAGINAS_TUTORIAL.length - 1;
  return {
    embeds: [e],
    components: [
      linha(
        desligado(botao(`menu:tutorial:${n - 1}`, 'Anterior', ButtonStyle.Secondary, '◀️'), n > 0),
        ultimo ? botao('menu:inicio', 'Ir para o menu', ButtonStyle.Success, '🧭') : botao(`menu:tutorial:${n + 1}`, 'Próxima', ButtonStyle.Primary, '▶️'),
        botao('menu:inicio', 'Menu', ButtonStyle.Secondary, '🧭'),
      ),
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('menu:tutorial-ir').setPlaceholder('Ir para um assunto…').addOptions(
          PAGINAS_TUTORIAL.map((pg, i) => ({ label: cortar(pg.titulo, 100), value: String(i), default: i === n })),
        ),
      ),
    ],
  };
}

async function mostrarTutorial(interaction, pagina) {
  const payload = telaTutorial(pagina);
  if (interaction.isMessageComponent?.() && ehMensagemPessoal(interaction)) return interaction.update(payload);
  return interaction.reply({ ...payload, flags: EFEMERA });
}

// ------------------------------------------------------------------ painel público
function painelPublico() {
  return {
    embeds: [
      embed(
        'Ágora · prévia pelo Discord',
        [
          'Estude, aja e decida com a comunidade — antes do app ser lançado, por aqui mesmo.',
          '',
          '🧭 **Abrir meu menu** — tudo em botões (só você vê)',
          '✅ **Criar minha conta** — leva 10 segundos',
          '🎓 **Tutorial** — como funciona, reputação e Dracmas',
        ].join('\n'),
        COR.primaria,
      ),
    ],
    components: [
      linha(
        botao('menu:inicio', 'Abrir meu menu', ButtonStyle.Primary, '🧭'),
        botao('menu:criar', 'Criar minha conta', ButtonStyle.Success, '✅'),
        botao('menu:tutorial:0', 'Tutorial', ButtonStyle.Secondary, '🎓'),
        linkApp(),
      ),
    ],
  };
}

// ------------------------------------------------------------------ formulários e seletores
function modalSimples(customId, titulo, campo, rotulo, { min, max, obrig = true, placeholder } = {}) {
  const c = new TextInputBuilder().setCustomId(campo).setLabel(rotulo).setStyle(TextInputStyle.Short).setRequired(obrig);
  if (min) c.setMinLength(min);
  if (max) c.setMaxLength(max);
  if (placeholder) c.setPlaceholder(placeholder);
  return new ModalBuilder().setCustomId(customId).setTitle(titulo).addComponents(new ActionRowBuilder().addComponents(c));
}

function seletor(customId, placeholder, itens) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(cortar(placeholder, 150)).addOptions(
      itens.slice(0, 25).map((i) => ({ label: cortar(i.rotulo, 100), value: i.valor, ...(i.descricao ? { description: cortar(i.descricao, 100) } : {}) })),
    ),
  );
}

/** Pergunta o tema antes de abrir o formulário de tópico/artigo. */
async function escolherTema(interaction, destino) {
  return comoMembro(interaction, async ({ sb }) => {
    const temas = await dados(sb.from('temas').select('id, nome, descricao').order('ordem').limit(25));
    if (!temas.length) return erro(interaction, 'Ainda não há temas cadastrados.');
    return responder(interaction, {
      embeds: [embed(destino === 'topico' ? 'Novo tópico' : 'Escrever artigo', 'Em qual tema?', COR.secundaria)],
      components: [seletor(`menu:tema-${destino}`, 'Escolha o tema…', temas.map((t) => ({ rotulo: t.nome, valor: t.id, descricao: t.descricao })))],
    });
  });
}

async function escolherProjetoEvento(interaction) {
  return comoMembro(interaction, async ({ sb, perfil }) => {
    const projetos = await dados(
      sb.from('projetos').select('id, titulo, causa').is('excluido_em', null).in('status', ['planejamento', 'ativo']).order('created_at', { ascending: false }).limit(24),
    );
    const itens = projetos.map((p) => ({ rotulo: p.titulo, valor: p.id, descricao: p.causa }));
    if (perfil.nivel >= 4 || perfil.papel === 'admin') itens.unshift({ rotulo: 'Sem projeto (evento geral)', valor: '-' });
    if (!itens.length) return erro(interaction, 'Não há projetos ativos para marcar eventos.');
    return responder(interaction, {
      embeds: [embed('Marcar evento', 'De qual projeto é o evento? (Só a coordenação do projeto, ou o nível 4, pode marcar.)', COR.secundaria)],
      components: [seletor('menu:evento-projeto', 'Escolha o projeto…', itens)],
    });
  });
}

function escolherTipoProposta(interaction) {
  return interaction.reply({
    embeds: [embed('Nova proposta', 'Que tipo de proposta? O debate dura 5 dias e a votação 3 (para outros prazos use `/assembleia nova`).', COR.secundaria)],
    components: [
      seletor('menu:proposta-tipo', 'Escolha o tipo…', [
        { rotulo: 'Geral', valor: 'geral', descricao: 'Aprovada com 60% dos votos' },
        { rotulo: 'Financeira', valor: 'financeira', descricao: 'Mexe com dinheiro: precisa de 2/3' },
        { rotulo: 'Regimento', valor: 'regimento', descricao: 'Muda as regras: precisa de 2/3' },
        { rotulo: 'Do meu núcleo', valor: 'nucleo', descricao: 'Só para o seu núcleo local' },
      ]),
    ],
    flags: EFEMERA,
  });
}

// ------------------------------------------------------------------ comando e interações
export async function execute(interaction) {
  if (interaction.options.getBoolean('fixar_no_canal')) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: 'Só a administração (permissão Gerenciar Servidor) pode fixar o painel num canal.', flags: EFEMERA });
    }
    try {
      await interaction.channel.send(painelPublico());
      return interaction.reply({ content: 'Painel publicado neste canal. Fixe a mensagem para ninguém perder.', flags: EFEMERA });
    } catch {
      return interaction.reply({ content: 'Não consegui postar aqui. Confira se o bot pode enviar mensagens neste canal.', flags: EFEMERA });
    }
  }
  return mostrarTela(interaction, telaInicio);
}

export async function handleInteraction(interaction, partes) {
  const [acao, a1] = partes;
  const valor = interaction.values?.[0];

  // Telas do menu (atualizam no lugar)
  if (acao === 'inicio') return mostrarTela(interaction, telaInicio);
  if (acao === 'conta') return mostrarTela(interaction, telaConta);
  if (acao === 'subir') return mostrarTela(interaction, telaSubir);
  if (acao === 'biblioteca') return mostrarTela(interaction, telaBiblioteca);
  if (acao === 'mutirao') return mostrarTela(interaction, telaMutirao);
  if (acao === 'assembleia') return mostrarTela(interaction, telaAssembleia);
  if (acao === 'aulas') return mostrarTela(interaction, telaAulas);
  if (acao === 'au') {
    if (a1 === 'nova') return interaction.showModal(aulas.modalAula(null));
    if (a1 === 'minhas') return aulas.minhas(interaction);
    return aulas.proximas(interaction);
  }
  if (acao === 'tutorial') return mostrarTutorial(interaction, a1);
  if (acao === 'tutorial-ir') return mostrarTutorial(interaction, valor);

  // Ações (abrem uma resposta nova, só para a pessoa)
  if (acao === 'criar') return agora.entrar(interaction);
  if (acao === 'perfil') return agora.perfil(interaction);
  if (acao === 'dracmas') return dracmas(interaction);
  if (acao === 'notificacoes') return agora.notificacoes(interaction);
  if (acao === 'acervo') return biblioteca.mostrarAcervo(interaction, {});
  if (acao === 'app') return agora.codigoApp(interaction);
  if (acao === 'email') return interaction.showModal(modalSimples('menu:m-email', 'E-mail para entrar no app', 'email', 'Seu e-mail', { max: 200, placeholder: 'voce@exemplo.com' }));
  if (acao === 'pseudonimo') return interaction.showModal(modalSimples('menu:m-pseudonimo', 'Pseudônimo', 'nome', 'Pseudônimo (vazio = usar seu nome)', { max: 40, obrig: false }));
  if (acao === 'buscar') return interaction.showModal(modalSimples('menu:m-buscar', 'Buscar na Ágora', 'termo', 'O que procurar', { min: 2, max: 100, placeholder: 'Ex.: hermetismo, mutirão' }));

  if (acao === 'b') {
    if (a1 === 'temas') return biblioteca.temas(interaction);
    if (a1 === 'topicos') return biblioteca.topicos(interaction);
    if (a1 === 'artigos') return biblioteca.artigos(interaction);
    if (a1 === 'trilhas') return biblioteca.trilhas(interaction);
    if (a1 === 'meus-artigos') return biblioteca.meusArtigos(interaction);
    if (a1 === 'revisar') return biblioteca.filaRevisao(interaction);
    if (a1 === 'salvos') return biblioteca.salvos(interaction);
    if (a1 === 'novo-topico') return escolherTema(interaction, 'topico');
    if (a1 === 'escrever') return escolherTema(interaction, 'artigo');
  }
  if (acao === 'tema-topico') return interaction.showModal(biblioteca.modalTopico(valor));
  if (acao === 'tema-artigo') return interaction.showModal(biblioteca.modalArtigo(valor));

  if (acao === 'm') {
    if (a1 === 'projetos') return mutirao.projetos(interaction);
    if (a1 === 'eventos') return mutirao.eventos(interaction);
    if (a1 === 'tarefas') return mutirao.minhasTarefas(interaction);
    if (a1 === 'confirmar-horas') return mutirao.horasPendentes(interaction);
    if (a1 === 'novo-evento') return escolherProjetoEvento(interaction);
  }
  if (acao === 'evento-projeto') return interaction.showModal(mutirao.modalEvento(valor === '-' ? null : valor));

  if (acao === 'a') {
    if (a1 === 'nova') return escolherTipoProposta(interaction);
    if (a1 === 'decisoes') return assembleia.decisoes(interaction);
    return assembleia.propostas(interaction, a1);
  }
  if (acao === 'proposta-tipo') return interaction.showModal(assembleia.modalNovaProposta(valor));
}

export async function handleModalSubmit(interaction, partes) {
  const [tipo] = partes;
  const campo = (c) => interaction.fields.getTextInputValue(c) ?? '';
  if (tipo === 'm-email') return agora.cadastrarEmail(interaction, campo('email'));
  if (tipo === 'm-pseudonimo') return agora.definirPseudonimo(interaction, campo('nome'));
  if (tipo === 'm-buscar') return agora.buscar(interaction, campo('termo'));
}

// Telas exportadas para os testes
export const telas = { telaInicio, telaSubir, telaConta, telaBiblioteca, telaMutirao, telaAssembleia, telaAulas, painelPublico, telaConduta };
