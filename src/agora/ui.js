// ============================================
// agora/ui.js — Formatação e respostas da prévia da Ágora
// ============================================
// Todas as respostas são efêmeras (só quem usou o comando vê): o bot não posta
// nada no chat público durante a prévia.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
} from 'discord.js';
import { config } from '../config.js';
import { acessoDe, ErroAgora } from './cliente.js';

export const EFEMERA = MessageFlags.Ephemeral;

// Paleta do app (terracota, oliva, dourado discreto, grafite)
export const COR = {
  primaria: 0xa9452b,
  secundaria: 0x5e7a3a,
  dourado: 0xc9a227,
  neutra: 0x3a3632,
  perigo: 0xb3261e,
};

export const NOMES_NIVEIS = { 1: 'Aprendiz', 2: 'Colaborador', 3: 'Curador', 4: 'Guardião' };
export const LIMIARES = { 1: 0, 2: 50, 3: 250, 4: 800 };
export const PERMISSOES_NIVEL = {
  1: ['Ler tudo', 'Comentar e responder', 'Inscrever-se em tarefas e eventos', 'Votar', 'Avaliar as aulas de que participou'],
  2: ['Criar tópicos', 'Propor artigos', 'Criar tarefas nos seus projetos', 'Dar aulas pela call'],
  3: ['Revisar e aprovar artigos', 'Montar trilhas', 'Abrir propostas na Assembleia', 'Marcar debates ao vivo'],
  4: ['Criar projetos de Mutirão', 'Moderar conteúdo', 'Lançar no caixa dos projetos que coordena'],
};
export const ROTULOS_ACAO = {
  resposta_util: 'Resposta marcada como útil',
  resposta_util_estorno: 'Marcação de resposta útil desfeita',
  artigo_publicado: 'Artigo publicado',
  revisao_concluida: 'Revisão concluída',
  trilha_publicada: 'Trilha publicada',
  hora_voluntariado: 'Horas de voluntariado confirmadas',
  presenca_evento: 'Presença confirmada em evento',
  presenca_evento_estorno: 'Presença desfeita',
  aula_ministrada: 'Aula bem avaliada pelos participantes',
  projeto_concluido: 'Projeto concluído',
  proposta_aprovada: 'Proposta aprovada',
  conteudo_removido: 'Conteúdo removido pela moderação',
  conteudo_removido_estorno: 'Remoção revertida em recurso',
  contribuicao_historica: 'Contribuições no Discord (migração)',
};

const FUSO = 'America/Sao_Paulo';
const fmtData = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: FUSO });
const fmtDataHora = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: FUSO,
});
const fmtMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNumero = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

export const data = (iso) => (iso ? fmtData.format(new Date(iso)) : '—');
export const dataHora = (iso) => (iso ? fmtDataHora.format(new Date(iso)) : '—');
export const moeda = (v) => fmtMoeda.format(Number(v ?? 0));
export const numero = (v) => fmtNumero.format(Number(v ?? 0));
/** Data relativa nativa do Discord ("há 3 dias"), que se atualiza sozinha */
export const relativo = (iso) => (iso ? `<t:${Math.floor(new Date(iso).getTime() / 1000)}:R>` : '—');

export function cortar(texto, max) {
  const t = String(texto ?? '').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function tempoLeitura(md) {
  const palavras = String(md ?? '').trim().split(/\s+/).filter(Boolean).length;
  return `${Math.max(1, Math.round(palavras / 200))} min de leitura`;
}

export const plural = (n, um, varios) => `${n} ${n === 1 ? um : (varios ?? `${um}s`)}`;

export function nomePublico(p) {
  return p?.nome_publico ?? p?.nome_exibicao ?? 'Membro';
}

export const RODAPE = 'Prévia da Ágora pelo Discord · tudo o que você faz aqui já vale no app';

export function embed(titulo, descricao, cor = COR.primaria) {
  const e = new EmbedBuilder().setColor(cor).setFooter({ text: RODAPE });
  if (titulo) e.setTitle(cortar(titulo, 256));
  if (descricao) e.setDescription(cortar(descricao, 4000));
  return e;
}

export function botao(customId, rotulo, estilo = ButtonStyle.Secondary, emoji) {
  const b = new ButtonBuilder().setCustomId(customId).setLabel(cortar(rotulo, 80)).setStyle(estilo);
  if (emoji) b.setEmoji(emoji);
  return b;
}

export function linha(...componentes) {
  return new ActionRowBuilder().addComponents(...componentes.filter(Boolean));
}

/** Menu "abrir item" para listas: value = id do item */
export function menuAbrir(customId, placeholder, itens) {
  if (!itens.length) return null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(cortar(placeholder, 150))
    .addOptions(
      itens.slice(0, 25).map((i) => ({
        label: cortar(i.rotulo, 100),
        value: i.valor,
        ...(i.descricao ? { description: cortar(i.descricao, 100) } : {}),
      })),
    );
  return new ActionRowBuilder().addComponents(menu);
}

export function linkApp() {
  return `[baixar o app](${config.agora.urlApp})`;
}

// ------------------------------------------------------------------ respostas
async function enviar(interaction, payload) {
  const corpo = typeof payload === 'string' ? { content: payload } : payload;
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({ content: null, embeds: [], components: [], ...corpo });
  }
  return interaction.reply({ ...corpo, flags: EFEMERA });
}

export async function responder(interaction, payload) {
  return enviar(interaction, payload);
}

export async function erro(interaction, mensagem) {
  return enviar(interaction, { embeds: [embed(null, `⚠️ ${mensagem}`, COR.perigo)] });
}

/** Pede o aceite do Código de Conduta (primeiro uso). */
export function telaConduta(perfil) {
  const e = embed(
    'Bem-vinda, bem-vindo à prévia da Ágora',
    [
      `Olá, **${perfil.nome_exibicao}**! Antes do app ser lançado, você já pode estudar, debater, participar dos mutirões e votar na Assembleia **por aqui** — e tudo vai junto para o app.`,
      '',
      '**Código de Conduta (resumo)**',
      '• Respeito acima de tudo: discorde das ideias, nunca das pessoas.',
      '• Nada de discurso de ódio, assédio, golpes ou divulgação comercial.',
      '• Cite fontes quando afirmar fatos; diga quando for opinião.',
      '• O dinheiro da comunidade é transparente: todo lançamento é público e não pode ser apagado.',
      '• Denúncias são analisadas pela moderação e registradas no log público.',
      '',
      'Ao aceitar, você concorda com o Código de Conduta e com a política de privacidade da Ágora.',
    ].join('\n'),
  );
  return {
    embeds: [e],
    components: [linha(botao('agora:aceitar', 'Aceito o Código de Conduta', ButtonStyle.Success, '✅'))],
  };
}

/**
 * Executa uma ação como a pessoa: abre a sessão na Ágora, exige o aceite do Código
 * de Conduta (exceto quando `semConduta`) e traduz erros para mensagens amigáveis.
 */
export async function comoMembro(interaction, acao, { semConduta = false, adiar = true } = {}) {
  try {
    if (adiar && !interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: EFEMERA });
    const acesso = await acessoDe(interaction);
    if (!semConduta && !acesso.perfil.aceitou_codigo_conduta_em) {
      return await enviar(interaction, telaConduta(acesso.perfil));
    }
    if (!semConduta && acesso.perfil.status_assinatura !== 'ativo') {
      return await erro(
        interaction,
        'Sua participação na Ágora não está ativa. Fale com a administração para receber o cargo de membro.',
      );
    }
    return await acao(acesso);
  } catch (e) {
    if (e instanceof ErroAgora) return erro(interaction, e.message);
    throw e;
  }
}

/** Lê um id de opção com autocomplete; aceita também "Título (id)". */
export function idDaOpcao(valor) {
  if (!valor) return null;
  const m = String(valor).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0].toLowerCase() : null;
}

/** Opções de autocompletar a partir de uma lista { id, titulo } */
export function opcoes(lista, rotulo = (i) => i.titulo) {
  return lista.slice(0, 25).map((i) => ({ name: cortar(rotulo(i), 100), value: i.id }));
}
