// ============================================
// scripts/testar-whatsapp.mjs — Regras da ponte WhatsApp ⇄ Discord e sessão no banco
// ============================================
// Não conecta ao WhatsApp, ao Discord nem ao Supabase (usa um banco falso em memória).
// A conexão de verdade só dá para conferir com o chip pareado (veja o README).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initAuthCreds, normalizeMessageContent } from 'baileys';

process.env.DISCORD_TOKEN ??= 'teste';
process.env.DISCORD_CLIENT_ID ??= '1';
process.env.DISCORD_GUILD_ID ??= '1';

const {
  deveIrParaWhatsApp,
  dividirTexto,
  esperaDeReconexao,
  mensagensParaDiscord,
  nomeParaWebhook,
  textoDoWhatsApp,
  textoParaWhatsApp,
} = await import('../src/agora/whatsapp-formato.js');
const { criarSessao, verificarTabelaSessao } = await import('../src/agora/whatsapp-sessao.js');

const GRUPO = '123@g.us';
const msg = (extra = {}) => ({
  key: { remoteJid: GRUPO, fromMe: false, participant: '5521999998888@s.whatsapp.net' },
  pushName: 'Ana',
  message: { conversation: 'oi' },
  ...extra,
});
const upsert = (...messages) => ({ type: 'notify', messages });

test('WhatsApp → Discord: texto do grupo certo atravessa, com o nome do perfil', () => {
  assert.deepEqual(mensagensParaDiscord(upsert(msg()), GRUPO), [{ nome: 'Ana', texto: 'oi' }]);
});

test('WhatsApp → Discord: o número de quem enviou nunca aparece', () => {
  const [m] = mensagensParaDiscord(upsert(msg({ pushName: undefined })), GRUPO);
  assert.equal(m.nome, 'Membro do grupo');
  assert.ok(!JSON.stringify(m).includes('5521999998888'));
});

test('WhatsApp → Discord: não repassa as próprias mensagens (laço), outros chats nem histórico', () => {
  assert.deepEqual(mensagensParaDiscord(upsert(msg({ key: { remoteJid: GRUPO, fromMe: true } })), GRUPO), []);
  assert.deepEqual(mensagensParaDiscord(upsert(msg({ key: { remoteJid: 'outro@g.us' } })), GRUPO), []);
  assert.deepEqual(mensagensParaDiscord(upsert(msg({ key: { remoteJid: '55@s.whatsapp.net' } })), GRUPO), []);
  assert.deepEqual(mensagensParaDiscord({ type: 'append', messages: [msg()] }, GRUPO), []);
  assert.deepEqual(mensagensParaDiscord(upsert(msg()), undefined), []);
});

test('WhatsApp → Discord: reações e avisos internos são ignorados', () => {
  assert.deepEqual(mensagensParaDiscord(upsert(msg({ message: { reactionMessage: { text: '👍' } } })), GRUPO), []);
  assert.deepEqual(mensagensParaDiscord(upsert(msg({ message: { protocolMessage: {} } })), GRUPO), []);
  assert.deepEqual(mensagensParaDiscord(upsert(msg({ message: null })), GRUPO), []);
});

test('WhatsApp → Discord: mensagem temporária é aberta pelo normalizador real do Baileys', () => {
  const temporaria = msg({ message: { ephemeralMessage: { message: { extendedTextMessage: { text: 'some depois' } } } } });
  assert.deepEqual(mensagensParaDiscord(upsert(temporaria), GRUPO, normalizeMessageContent), [{ nome: 'Ana', texto: 'some depois' }]);
});

test('textoDoWhatsApp: mídia vira aviso, com a legenda', () => {
  assert.equal(textoDoWhatsApp({ imageMessage: {} }), '[📷 imagem]');
  assert.equal(textoDoWhatsApp({ videoMessage: { caption: 'olha' } }), '[🎬 vídeo] olha');
  assert.equal(textoDoWhatsApp({ audioMessage: {} }), '[🎤 áudio]');
});

test('nomeParaWebhook: respeita as regras de nome do Discord', () => {
  assert.equal(nomeParaWebhook('Ana'), 'Ana · WhatsApp');
  assert.equal(nomeParaWebhook('Discord Clyde'), 'Membro do grupo · WhatsApp');
  assert.ok(!/discord|clyde/i.test(nomeParaWebhook('meu discord fã do clyde')));
  assert.ok(nomeParaWebhook('x'.repeat(200)).length <= 80);
});

test('dividirTexto: nenhuma parte passa do limite e nada se perde', () => {
  const longo = 'a'.repeat(4500);
  const partes = dividirTexto(longo);
  assert.equal(partes.length, 3);
  assert.ok(partes.every((p) => p.length <= 2000));
  assert.equal(partes.join(''), longo);
  assert.deepEqual(dividirTexto(`${'a'.repeat(1500)}\n${'b'.repeat(1500)}`), ['a'.repeat(1500), 'b'.repeat(1500)]);
  assert.deepEqual(dividirTexto('curto'), ['curto']);
  assert.deepEqual(dividirTexto(''), []);
});

const discordMsg = (extra = {}) => ({
  channelId: 'canal',
  author: { bot: false, username: 'bia' },
  content: 'olá',
  cleanContent: 'olá',
  attachments: new Map(),
  ...extra,
});

test('Discord → WhatsApp: só gente de verdade, no canal certo', () => {
  assert.equal(deveIrParaWhatsApp(discordMsg(), 'canal', '%'), true);
  assert.equal(deveIrParaWhatsApp(discordMsg({ channelId: 'outro' }), 'canal', '%'), false);
  assert.equal(deveIrParaWhatsApp(discordMsg(), undefined, '%'), false);
  assert.equal(deveIrParaWhatsApp(discordMsg({ author: { bot: true } }), 'canal', '%'), false);
  assert.equal(deveIrParaWhatsApp(discordMsg({ webhookId: 'w' }), 'canal', '%'), false, 'o que veio do WhatsApp não pode voltar');
  assert.equal(deveIrParaWhatsApp(discordMsg({ system: true }), 'canal', '%'), false);
});

test('Discord → WhatsApp: comandos ficam de fora; só anexo atravessa', () => {
  assert.equal(deveIrParaWhatsApp(discordMsg({ content: '%menu' }), 'canal', '%'), false);
  assert.equal(deveIrParaWhatsApp(discordMsg({ content: '%menu' }), 'canal', ''), true);
  assert.equal(deveIrParaWhatsApp(discordMsg({ content: '   ' }), 'canal', '%'), false);
  assert.equal(deveIrParaWhatsApp(discordMsg({ content: '', attachments: new Map([['1', {}]]) }), 'canal', '%'), true);
});

test('textoParaWhatsApp: nome em negrito, menções legíveis, anexos como link', () => {
  assert.equal(textoParaWhatsApp(discordMsg({ member: { displayName: 'Bia *VIP*' } })), '*Bia VIP:* olá');
  assert.equal(textoParaWhatsApp(discordMsg({ content: '<@1> oi', cleanContent: '@Ana oi' })), '*bia:* @Ana oi');
  const anexos = new Map([['1', { name: 'a.png', url: 'https://x/a.png' }]]);
  assert.equal(textoParaWhatsApp(discordMsg({ content: '', cleanContent: '', attachments: anexos })), '*bia:* 📎 a.png: https://x/a.png');
});

test('esperaDeReconexao: cresce e tem teto', () => {
  assert.equal(esperaDeReconexao(0), 5_000);
  assert.equal(esperaDeReconexao(1), 10_000);
  assert.equal(esperaDeReconexao(0, 60_000), 60_000);
  assert.equal(esperaDeReconexao(50), 300_000);
});

// ---------- Sessão ----------

/** Imita só o pedaço do cliente do Supabase que a sessão usa. */
function bancoFalso({ erro = null, atraso = 0 } = {}) {
  const linhas = new Map();
  const id = (s, c) => `${s}|${c}`;
  const banco = {
    linhas,
    from() {
      const filtro = {};
      const q = {
        select: () => q,
        limit: () => q,
        upsert: async (lista) => {
          if (atraso) await new Promise((r) => setTimeout(r, atraso * Math.random()));
          if (erro) return { error: { message: erro } };
          for (const l of lista) linhas.set(id(l.sessao, l.chave), l);
          return { error: null };
        },
        delete: () => {
          filtro.apagar = true;
          return q;
        },
        eq: (_, v) => {
          filtro.sessao = v;
          return q;
        },
        in: (_, v) => {
          filtro.chaves = v;
          return q;
        },
        then(resolver) {
          if (erro) return resolver({ error: { message: erro }, data: null });
          const alvo = [...linhas.values()].filter(
            (l) => (!filtro.sessao || l.sessao === filtro.sessao) && (!filtro.chaves || filtro.chaves.includes(l.chave)),
          );
          if (filtro.apagar) alvo.forEach((l) => linhas.delete(id(l.sessao, l.chave)));
          return resolver({ error: null, data: alvo });
        },
      };
      return q;
    },
  };
  return banco;
}

test('sessão: credenciais com Buffers sobrevivem a um reinício', async () => {
  const banco = bancoFalso();
  const a = await criarSessao(banco);
  assert.equal(a.state.creds.registered, false);
  a.state.creds.registered = true;
  const chavePublica = Buffer.from(a.state.creds.noiseKey.public);
  await a.saveCreds();

  const b = await criarSessao(banco); // como se o bot tivesse reiniciado
  assert.equal(b.state.creds.registered, true);
  assert.ok(Buffer.isBuffer(b.state.creds.noiseKey.public), 'as chaves precisam voltar como Buffer');
  assert.deepEqual(Buffer.from(b.state.creds.noiseKey.public), chavePublica);
});

test('sessão: gravar, ler e apagar chaves, mais de um lote', async () => {
  const banco = bancoFalso();
  const s = await criarSessao(banco);
  const dados = {};
  for (let i = 0; i < 250; i += 1) dados[String(i)] = { public: Buffer.from([i % 256]) };
  await s.state.keys.set({ 'pre-key': dados });
  const ids = Object.keys(dados);
  const lidos = await s.state.keys.get('pre-key', ids);
  assert.equal(Object.keys(lidos).length, 250);
  assert.deepEqual(Buffer.from(lidos['249'].public), Buffer.from([249]));
  assert.equal((await s.state.keys.get('pre-key', ['naoexiste'])).naoexiste, null);

  await s.state.keys.set({ 'pre-key': { 0: null } });
  assert.equal((await s.state.keys.get('pre-key', ['0']))['0'], null);
  assert.ok((await s.state.keys.get('pre-key', ['1']))['1']);
});

test('sessão: a chave de sincronização volta como objeto do protobuf', async () => {
  const s = await criarSessao(bancoFalso());
  await s.state.keys.set({ 'app-state-sync-key': { k: { keyData: Buffer.from([1, 2, 3]) } } });
  const { k } = await s.state.keys.get('app-state-sync-key', ['k']);
  assert.equal(k.constructor.name, 'AppStateSyncKeyData');
  assert.deepEqual(Buffer.from(k.keyData), Buffer.from([1, 2, 3]));
});

test('sessão: a credencial mais nova vence, mesmo com gravações rápidas e banco lento', async () => {
  const banco = bancoFalso({ atraso: 20 });
  const s = await criarSessao(banco);
  for (let i = 0; i < 10; i += 1) {
    s.state.creds.nextPreKeyId = i;
    s.saveCreds();
  }
  s.state.creds.nextPreKeyId = 999;
  await s.saveCreds();
  await s.aguardar();
  const depois = await criarSessao(banco);
  assert.equal(depois.state.creds.nextPreKeyId, 999);
});

test('sessão: limpar apaga só esta sessão e recomeça do zero', async () => {
  const banco = bancoFalso();
  const a = await criarSessao(banco, 'a');
  const b = await criarSessao(banco, 'b');
  await a.saveCreds();
  await b.saveCreds();
  await a.limpar();
  assert.equal(banco.linhas.size, 1);
  assert.ok(banco.linhas.has('b|creds'));
  assert.ok((await criarSessao(banco, 'a')).state.creds.noiseKey);
});

test('sessão: erro do banco aparece, em vez de perder chaves calado', async () => {
  const bom = bancoFalso();
  const s = await criarSessao(bom);
  const ruim = bancoFalso({ erro: 'permission denied' });
  await assert.rejects(criarSessao(ruim), /permission denied/);
  assert.equal(await verificarTabelaSessao(ruim), 'permission denied');
  assert.equal(await verificarTabelaSessao(bom), null);
  await s.saveCreds();
  assert.ok(initAuthCreds().noiseKey, 'Baileys disponível');
});

test('a fila continua andando depois de uma gravação com erro', async () => {
  const banco = bancoFalso();
  const s = await criarSessao(banco);
  const original = banco.from;
  banco.from = () => ({ upsert: async () => ({ error: { message: 'caiu' } }) });
  await assert.rejects(s.saveCreds(), /caiu/);
  banco.from = original;
  await s.saveCreds();
  assert.ok(banco.linhas.has('principal|creds'));
});
