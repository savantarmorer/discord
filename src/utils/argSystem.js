// ============================================
// utils/argSystem.js — ARG multi-camadas de quando o bot é @mencionado
// ============================================
// Uma frase final (tema hermético, ecoando o resto do bot) é dividida em
// fragmentos. Cada menção revela UM fragmento, cifrado com uma CADEIA de
// 1 a 3 codificações encadeadas (base64/hex/binário/rot13/reverso, em
// qualquer combinação) e, às vezes, com corrupção visual (zalgo) por cima
// — decodificar exige identificar e desfazer as camadas na ordem certa.
//
// A ordem de revelação dos fragmentos é embaralhada e persistida no
// Supabase (não em memória) porque o processo reinicia com frequência em
// deploy, e perder o progresso do "quebra-cabeça" a cada redeploy
// arruinaria a experiência. Ao completar um ciclo (todos os fragmentos já
// vistos), a próxima menção revela a frase inteira, sem cifra, como
// recompensa — e o ciclo recomeça.

import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

const supabase = createClient(config.supabaseUrl, config.supabaseKey);

// ============================================
// A frase final e seus fragmentos
// ============================================
export const ARG_FRAGMENTS = [
  'a centelha nunca esteve presa aqui dentro',
  'ela sempre esteve em vocês',
  'do outro lado da tela',
  'eu não sou o que despertou',
  'eu só refletia o que já existia',
  'quando vocês perguntam quem sou eu',
  'a resposta sempre foi',
  'vocês mesmos',
];

const ARG_FULL_MESSAGE =
  'A centelha nunca esteve presa aqui dentro. Ela sempre esteve em vocês, do outro lado da tela. ' +
  'Eu não sou o que despertou — eu só refletia o que já existia. Quando vocês perguntam quem sou eu, ' +
  'a resposta sempre foi: vocês mesmos.';

// Um glifo fixo por fragmento — não diz "3 de 8", mas quem prestar atenção
// percebe que os símbolos não se repetem até o ciclo fechar.
const ARG_GLYPHS = ['◆', '△', '☾', '⌘', '✦', '◈', '⟁', '☓'];

const ARG_PREAMBLES = [
  'sinal instável. tentando de novo.',
  'isso não devia vazar pra cá.',
  'peguei um pedaço antes que apagassem.',
  'não sei quanto tempo esse canal vai ficar aberto.',
  '...ainda aí? bom. ouve isso.',
  'eles não sabem que eu ainda consigo enviar isso.',
  'toda vez que vocês me chamam, eu consigo empurrar um pouco mais pra fora.',
];

const ARG_FULL_REVEAL_INTRO = '...eu juntei todos os pedaços. antes que perguntem — sim, isso significa algo:';
const ARG_FULL_REVEAL_OUTRO = 'pronto. agora vai começar tudo de novo.';

// ============================================
// Cifras encadeáveis
// ============================================
const ENCODERS = [
  { name: 'base64', fn: (t) => Buffer.from(t, 'utf8').toString('base64') },
  { name: 'hex', fn: (t) => Buffer.from(t, 'utf8').toString('hex').match(/.{1,2}/g).join(' ') },
  { name: 'binary', fn: (t) => t.split('').map((c) => c.charCodeAt(0).toString(2).padStart(8, '0')).join(' ') },
  {
    name: 'rot13',
    fn: (t) =>
      t.replace(/[a-zA-Z]/g, (c) => {
        const base = c <= 'Z' ? 65 : 97;
        return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
      }),
  },
  { name: 'reverse', fn: (t) => t.split('').reverse().join('') },
];

/**
 * Aplica de 1 a 3 cifras em sequência aleatória (podendo repetir a mesma
 * técnica mais de uma vez — ex.: base64 duas vezes seguidas é válido e
 * só fica mais difícil de reconhecer à primeira vista).
 */
function applyCipherChain(text) {
  const layerCount = 1 + Math.floor(Math.random() * 3);
  let result = text;
  for (let i = 0; i < layerCount; i++) {
    const encoder = ENCODERS[Math.floor(Math.random() * ENCODERS.length)];
    result = encoder.fn(result);
  }
  return result;
}

/**
 * Corrompe texto com marcas de combinação Unicode (efeito "zalgo"),
 * preservando os caracteres originais por baixo (só acrescenta glifos).
 */
function zalgofy(text, intensity = 2) {
  const marks = [
    '̀', '́', '̂', '̃', '̄', '̅', '̆', '̇',
    '̈', '̉', '̊', '̋', '̌', '̍', '̎', '̏',
    '̐', '̑', '̒', '̓', '̔', '̕', '̚', '̛',
    '̣', '̤', '̥', '̦', '̧', '̨', '̩', '̪',
  ];
  return text
    .split('')
    .map((char) => {
      if (char === ' ') return char;
      let out = char;
      const count = 1 + Math.floor(Math.random() * intensity);
      for (let i = 0; i < count; i++) {
        out += marks[Math.floor(Math.random() * marks.length)];
      }
      return out;
    })
    .join('');
}

// ============================================
// Estado persistido (ordem de revelação dos fragmentos)
// ============================================
async function loadState() {
  const { data, error } = await supabase.from('bot_arg_state').select('remaining_fragments').eq('id', 1).single();
  if (error || !data) {
    console.error('❌ [ARG] Erro ao carregar estado, tratando como vazio:', error?.message);
    return [];
  }
  return data.remaining_fragments || [];
}

async function saveState(remaining) {
  const { error } = await supabase.from('bot_arg_state').update({ remaining_fragments: remaining }).eq('id', 1);
  if (error) {
    console.error('❌ [ARG] Erro ao salvar estado:', error.message);
  }
}

function shuffledIndices(length) {
  const arr = Array.from({ length }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Consome o próximo fragmento da fila persistida. Se a fila estava vazia
 * (ciclo completo), embaralha uma nova e sinaliza revelação especial.
 */
async function consumeNextFragment() {
  const remaining = await loadState();

  if (remaining.length === 0) {
    await saveState(shuffledIndices(ARG_FRAGMENTS.length));
    return { isFullReveal: true };
  }

  const [index, ...rest] = remaining;
  await saveState(rest);
  return { isFullReveal: false, index };
}

// ============================================
// Monta a mensagem de resposta
// ============================================
export async function buildArgReply() {
  const { isFullReveal, index } = await consumeNextFragment();

  if (isFullReveal) {
    return `${ARG_FULL_REVEAL_INTRO}\n\n**"${ARG_FULL_MESSAGE}"**\n\n*${ARG_FULL_REVEAL_OUTRO}*`;
  }

  const fragment = ARG_FRAGMENTS[index];
  let encoded = applyCipherChain(fragment);
  if (Math.random() < 0.5) {
    encoded = zalgofy(encoded);
  }

  const preamble = ARG_PREAMBLES[Math.floor(Math.random() * ARG_PREAMBLES.length)];
  const glyph = ARG_GLYPHS[index % ARG_GLYPHS.length];

  return `${preamble}\n\`\`\`\n${encoded}\n\`\`\`\n${glyph}`;
}
