// ============================================
// scripts/testar-agora.mjs — Teste de ponta a ponta dos comandos da prévia da Ágora
// ============================================
// Simula interações do Discord (comandos, botões, menus e formulários) contra um
// banco da Ágora com o seed de demonstração. Não conecta ao Discord.
//
// Uso (com o Supabase local do app: `cd agora-app && supabase start`):
//   AGORA_SUPABASE_URL=http://127.0.0.1:54321 \
//   AGORA_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long \
//   node scripts/testar-agora.mjs
// As chaves anon/service são geradas a partir do segredo JWT se não forem informadas.
// ATENÇÃO: escreve no banco (tópicos, votos, horas…). Use só em banco de teste, recém-criado
// com o seed (as reputações mudam a cada execução).

import crypto from 'node:crypto';

process.env.DISCORD_TOKEN ??= 'teste';
process.env.DISCORD_CLIENT_ID ??= '1';
process.env.DISCORD_GUILD_ID ??= '1';
const segredo = process.env.AGORA_JWT_SECRET;
if (!process.env.AGORA_SUPABASE_URL || !segredo) {
  console.error('Defina AGORA_SUPABASE_URL e AGORA_JWT_SECRET (veja o topo do arquivo).');
  process.exit(1);
}
function jwt(payload) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const corpo = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ iat: Math.floor(Date.now() / 1000), exp: 2000000000, ...payload })}`;
  return `${corpo}.${crypto.createHmac('sha256', segredo).update(corpo).digest('base64url')}`;
}
process.env.AGORA_SUPABASE_ANON_KEY ??= jwt({ role: 'anon' });
process.env.AGORA_SUPABASE_SERVICE_KEY ??= jwt({ role: 'service_role' });

const { createClient } = await import('@supabase/supabase-js');
const { comandosAgora } = await import('../src/agora/comandos.js');
const cmd = Object.fromEntries(comandosAgora.map((c) => [c.data.name, c]));

const admin = createClient(process.env.AGORA_SUPABASE_URL, process.env.AGORA_SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
async function um(q) {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}

// ------------------------------------------------------------------ pessoas (contas do seed)
const pessoas = {};
for (const [chave, email, discordId] of [
  ['membro', 'membro@agora.test', '900000000000000002'],
  ['admin', 'admin@agora.test', '900000000000000001'],
  ['coord', 'helena.duarte@agora.test', '900000000000000003'],
]) {
  const nome = { membro: 'Membro de Teste', admin: 'Administração Ágora', coord: 'Helena Duarte' }[chave];
  const id = (await um(admin.from('profiles').select('id').eq('nome_exibicao', nome).single())).id;
  await um(admin.from('discord_vinculos').upsert({ discord_id: discordId, profile_id: id, email_tecnico: email }));
  pessoas[chave] = { discordId, nome: chave, perfilId: id };
}

// ------------------------------------------------------------------ interação falsa
function interacao(quem, { comando, sub, opcoes = {}, foco, customId, valores, campos = {}, cargos = [], efemera = true, permissoes = [] }) {
  const respostas = [];
  const p = pessoas[quem];
  const it = {
    commandName: comando,
    customId,
    values: valores,
    user: { id: p.discordId, username: p.nome, globalName: p.nome, displayAvatarURL: () => 'https://exemplo/avatar.png' },
    member: { displayName: p.nome, roles: cargos },
    deferred: false,
    replied: false,
    // Botões/menus vêm de uma mensagem: efêmera (do menu pessoal) ou pública (painel fixo)
    message: customId ? { flags: { has: () => efemera } } : undefined,
    isMessageComponent: () => Boolean(customId) && !customId.includes(':m-'),
    isFromMessage: () => Boolean(customId),
    memberPermissions: { has: () => permissoes.includes('ManageGuild') },
    channel: { async send(x) { respostas.push({ ...x, content: `[canal] ${x.content ?? ''}` }); } },
    options: {
      getSubcommand: () => sub,
      getString: (n) => opcoes[n] ?? null,
      getNumber: (n) => opcoes[n] ?? null,
      getInteger: (n) => opcoes[n] ?? null,
      getBoolean: (n) => opcoes[n] ?? null,
      getUser: (n) => opcoes[n] ?? null,
      getFocused: (completo) => (completo ? { name: foco, value: opcoes[foco] ?? '' } : opcoes[foco] ?? ''),
    },
    fields: { getTextInputValue: (n) => campos[n] ?? '' },
    async deferReply() { it.deferred = true; },
    async deferUpdate() { it.deferred = true; },
    async reply(x) { it.replied = true; respostas.push(x); },
    async update(x) { it.replied = true; respostas.push({ ...x, content: `[no lugar] ${x.content ?? ''}` }); },
    async editReply(x) { respostas.push(x); },
    async showModal(m) { respostas.push({ modal: m.toJSON() }); },
    async respond(op) { respostas.push({ autocomplete: op }); },
  };
  return { it, respostas };
}

function texto(resp) {
  return resp.map((r) => {
    if (r.modal) return `[modal ${r.modal.custom_id}: ${r.modal.title}]`;
    if (r.autocomplete) return `[autocomplete ${r.autocomplete.map((o) => o.name).join(' | ')}]`;
    const partes = [r.content ?? ''];
    for (const e of r.embeds ?? []) {
      const j = e.toJSON ? e.toJSON() : e;
      partes.push(j.title ?? '', j.description ?? '', ...(j.fields ?? []).flatMap((f) => [f.name, f.value]));
    }
    for (const row of r.components ?? []) {
      const j = row.toJSON ? row.toJSON() : row;
      for (const c of j.components ?? []) partes.push(`[${c.label ?? c.placeholder ?? ''} ${c.custom_id ?? ''}]`, ...(c.options ?? []).map((o) => `{${o.label}=${o.value}}`));
    }
    return partes.join('\n');
  }).join('\n---\n');
}

let ok = 0;
let falhas = 0;
async function caso(nome, quem, args, esperado, handler = 'execute', partes) {
  const { it, respostas } = interacao(quem, args);
  try {
    const c = cmd[args.comando];
    if (handler === 'execute') await c.execute(it);
    else if (handler === 'autocomplete') await c.autocomplete(it);
    else if (handler === 'botao') await c.handleInteraction(it, partes);
    else if (handler === 'modal') await c.handleModalSubmit(it, partes);
  } catch (e) {
    respostas.push({ content: `EXCEÇÃO: ${e.stack}` });
  }
  const t = texto(respostas);
  const lista = Array.isArray(esperado) ? esperado : [esperado];
  const faltando = lista.filter((x) => !(x instanceof RegExp ? x.test(t) : t.includes(x)));
  if (faltando.length || /EXCEÇÃO|⚠️ Algo deu errado/.test(t)) {
    falhas++;
    console.log(`✗ ${nome}\n   esperado: ${faltando.join(' | ')}\n   recebido: ${t.slice(0, 900).replace(/\n/g, '\n   ')}`);
  } else {
    ok++;
    console.log(`✓ ${nome}`);
  }
  return t;
}
const idDe = (t, prefixo) => (t.match(new RegExp(`${prefixo}[^\\s\\]]*?([0-9a-f]{8}-[0-9a-f-]{27})`)) ?? [])[1];

// ------------------------------------------------------------------ dados do seed
const topico = await um(admin.from('topicos').select('id, titulo').is('excluido_em', null).order('ultima_atividade_em', { ascending: false }).limit(1).single());
const artigo = await um(admin.from('artigos').select('id, titulo').eq('status', 'publicado').ilike('titulo', '%Ragnar%').single());
const trilha = await um(admin.from('trilhas').select('id, titulo').eq('publicada', true).limit(1).single());
const projeto = await um(admin.from('projetos').select('id, titulo, coordenador_id').ilike('titulo', '%agasalhos%').single());
// quem coordena o projeto confirma as horas
await um(admin.from('discord_vinculos').upsert({ discord_id: '900000000000000004', profile_id: projeto.coordenador_id, email_tecnico: 'coordenacao@agora.test' }));
pessoas.coordProjeto = { discordId: '900000000000000004', nome: 'coordProjeto', perfilId: projeto.coordenador_id };
const tarefaLivre = await um(admin.from('tarefas').select('id, titulo').eq('projeto_id', projeto.id).is('responsavel_id', null).neq('status', 'feito').limit(1).maybeSingle());
const evento = await um(admin.from('eventos').select('id, titulo').gte('fim', new Date().toISOString()).order('inicio').limit(1).single());
const emVotacao = await um(admin.from('propostas').select('id, titulo, rodada').eq('status', 'votacao').eq('natureza', 'comunitaria').limit(1).single());
const tema = await um(admin.from('temas').select('id, nome').order('ordem').limit(1).single());

console.log('\n== Conta e perfil');
await caso('/agora ajuda', 'membro', { comando: 'agora', sub: 'ajuda' }, ['O que dá para fazer', '/dracmas']);
await caso('/agora entrar (seed já aceitou o código)', 'membro', { comando: 'agora', sub: 'entrar' }, ['Você já está na Ágora', 'Colaborador']);
await caso('/agora perfil', 'membro', { comando: 'agora', sub: 'perfil' }, ['Nível 2 · Colaborador', 'Contribuições', 'Criar tópicos']);
await caso('/agora perfil de outra pessoa', 'membro', { comando: 'agora', sub: 'perfil', opcoes: { membro: { id: pessoas.coord.discordId, displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' } } }, ['Helena', 'Nível 4']);
await caso('/agora pseudonimo', 'membro', { comando: 'agora', sub: 'pseudonimo', opcoes: { nome: 'Corvo Teste' } }, 'Corvo Teste');
await caso('/agora pseudonimo (remover)', 'membro', { comando: 'agora', sub: 'pseudonimo', opcoes: {} }, 'Membro de Teste');
await caso('/agora notificacoes', 'membro', { comando: 'agora', sub: 'notificacoes' }, 'Notificações');
const busca = await caso('/agora buscar', 'membro', { comando: 'agora', sub: 'buscar', opcoes: { termo: 'mutirão' } }, ['Busca', 'agora:busca']);
const itemBusca = (busca.match(/\{[^}]*=(\w+\|[0-9a-f-]{36})\}/) ?? [])[1];
if (itemBusca) await caso('menu da busca abre o item', 'membro', { comando: 'agora', customId: 'agora:busca', valores: [itemBusca] }, /Tópico|Artigo|Projeto|Proposta|Trilha|Decis|Caixa|Votação|leitura|resposta/i, 'botao', ['busca']);
await caso('/dracmas', 'membro', { comando: 'dracmas' }, ['Seus Dracmas', 'DRC', 'O que é o Dracma', 'Não é vendido']);

console.log('\n== Biblioteca');
await caso('/biblioteca temas', 'membro', { comando: 'biblioteca', sub: 'temas' }, 'Temas da Biblioteca');
await caso('autocompletar tema', 'membro', { comando: 'biblioteca', foco: 'tema', opcoes: { tema: '' } }, '[autocomplete', 'autocomplete');
await caso('autocompletar tópico', 'membro', { comando: 'biblioteca', foco: 'topico', opcoes: { topico: topico.titulo.slice(0, 6) } }, topico.titulo.slice(0, 20), 'autocomplete');
await caso('/biblioteca topicos', 'membro', { comando: 'biblioteca', sub: 'topicos' }, ['Tópicos ativos', 'biblioteca:abrir-topico']);
await caso('/biblioteca topico', 'membro', { comando: 'biblioteca', sub: 'topico', opcoes: { topico: topico.id } }, [topico.titulo.slice(0, 30), 'biblioteca:responder']);
await caso('botão Responder abre formulário', 'membro', { comando: 'biblioteca', customId: `biblioteca:responder:${topico.id}` }, '[modal biblioteca:m-resposta', 'botao', ['responder', topico.id]);
await caso('enviar resposta', 'membro', { comando: 'biblioteca', campos: { corpo: 'Resposta enviada pelo teste do bot do Discord.' } }, 'Resposta enviada pelo teste', 'modal', ['m-resposta', topico.id]);
await caso('salvar tópico', 'membro', { comando: 'biblioteca' }, 'Remover dos salvos', 'botao', ['salvar', 'topico', topico.id, '1']);
await caso('/biblioteca salvos', 'membro', { comando: 'biblioteca', sub: 'salvos' }, topico.titulo.slice(0, 30));
const novoTopico = await caso('criar tópico (nível 2)', 'membro', { comando: 'biblioteca', campos: { titulo: 'Tópico criado pelo Discord', corpo: 'Conteúdo do tópico criado na prévia pelo Discord.' } }, 'Tópico criado pelo Discord', 'modal', ['m-topico', tema.id]);
await caso('/biblioteca artigos', 'membro', { comando: 'biblioteca', sub: 'artigos' }, ['Artigos publicados', 'biblioteca:abrir-artigo']);
await caso('/biblioteca artigo', 'membro', { comando: 'biblioteca', sub: 'artigo', opcoes: { artigo: artigo.id } }, [artigo.titulo.slice(0, 20), 'min de leitura', 'Marcar como lido']);
await caso('marcar artigo como lido', 'membro', { comando: 'biblioteca' }, /Leitura registrada|trilha/, 'botao', ['lido', artigo.id]);
const rascunho = await caso('escrever artigo (rascunho)', 'membro', { comando: 'biblioteca', campos: { titulo: 'Artigo escrito pelo Discord', resumo: 'Resumo curto.', corpo: 'Texto do artigo. '.repeat(25) } }, ['Rascunho salvo', 'biblioteca:enviar:'], 'modal', ['m-artigo', tema.id]);
const artigoNovo = idDe(rascunho, 'biblioteca:enviar:');
await caso('enviar artigo para revisão', 'membro', { comando: 'biblioteca' }, 'Enviado para revisão', 'botao', ['enviar', artigoNovo]);
await caso('/biblioteca meus-artigos', 'membro', { comando: 'biblioteca', sub: 'meus-artigos' }, ['Artigo escrito pelo Discord', 'Em revisão']);
await caso('/biblioteca revisar bloqueado no nível 2', 'membro', { comando: 'biblioteca', sub: 'revisar' }, 'nível 3');
await caso('/biblioteca revisar (curadora)', 'coord', { comando: 'biblioteca', sub: 'revisar' }, ['Fila de revisão', 'Artigo escrito pelo Discord']);
await caso('abrir artigo para revisão', 'coord', { comando: 'biblioteca', valores: [artigoNovo] }, ['Revisão:', 'biblioteca:parecer:'], 'botao', ['abrir-revisao']);
await caso('parecer: aprovar', 'coord', { comando: 'biblioteca', campos: { comentario: 'Bom texto, aprovado pela revisão de teste.' } }, 'Revisão enviada', 'modal', ['m-parecer', artigoNovo, 'aprovar']);
await caso('segunda aprovação publica o artigo', 'admin', { comando: 'biblioteca', campos: { comentario: 'Segunda aprovação do teste automatizado.' } }, 'publicado', 'modal', ['m-parecer', artigoNovo, 'aprovar']);
await caso('/biblioteca trilhas', 'membro', { comando: 'biblioteca', sub: 'trilhas' }, 'Trilhas de estudo');
await caso('/biblioteca trilha', 'membro', { comando: 'biblioteca', sub: 'trilha', opcoes: { trilha: trilha.id } }, [trilha.titulo.slice(0, 20), 'lidos']);

console.log('\n== Mutirão');
await caso('/mutirao projetos', 'membro', { comando: 'mutirao', sub: 'projetos' }, ['Projetos do Mutirão', 'caixa']);
await caso('/mutirao projeto', 'membro', { comando: 'mutirao', sub: 'projeto', opcoes: { projeto: projeto.id } }, ['Caixa transparente', 'Saldo', 'mutirao:doar']);
await caso('autocompletar projeto', 'membro', { comando: 'mutirao', foco: 'projeto', opcoes: { projeto: 'agas' } }, 'agasalhos', 'autocomplete');
if (tarefaLivre) {
  await caso('assumir tarefa', 'membro', { comando: 'mutirao' }, ['Status:', 'Concluí'], 'botao', ['tarefa', tarefaLivre.id, 'assumir']);
  await caso('/mutirao tarefas', 'membro', { comando: 'mutirao', sub: 'tarefas' }, tarefaLivre.titulo.slice(0, 20));
}
await caso('/mutirao horas', 'membro', { comando: 'mutirao', sub: 'horas', opcoes: { projeto: projeto.id, horas: 2.5, descricao: 'Separei doações no teste do bot.' } }, 'Horas registradas');
const pend = await caso('/mutirao confirmar-horas (coordenação)', 'coordProjeto', { comando: 'mutirao', sub: 'confirmar-horas' }, 'Horas pendentes');
const registro = (pend.match(/\{[^}]*2,5 h=([0-9a-f-]{36})\}/) ?? [])[1];
if (registro) await caso('confirmar horas', 'coordProjeto', { comando: 'mutirao' }, 'Horas confirmadas', 'botao', ['confirmar', registro, '1']);
else { falhas++; console.log('✗ registro de horas do membro não apareceu para a coordenação'); }
await caso('/mutirao eventos', 'membro', { comando: 'mutirao', sub: 'eventos' }, 'Próximos eventos');
await caso('/mutirao evento + RSVP', 'membro', { comando: 'mutirao' }, ['Sua resposta: **Vou**'], 'botao', ['rsvp', evento.id, 'vou']);
await caso('check-in com código errado é recusado', 'membro', { comando: 'mutirao', sub: 'checkin', opcoes: { evento: evento.id, codigo: 'ERRADO' } }, /inválido|check-in só abre/);
await caso('/mutirao caixa', 'membro', { comando: 'mutirao', sub: 'caixa', opcoes: { projeto: projeto.id } }, ['Caixa ·', 'nunca são apagados']);
await caso('/mutirao doar sem Edge Function mostra aviso', 'membro', { comando: 'mutirao', sub: 'doar', opcoes: { projeto: projeto.id, valor: 25 } }, 'Não foi possível gerar o Pix');

console.log('\n== Assembleia');
await caso('/assembleia propostas', 'membro', { comando: 'assembleia', sub: 'propostas' }, ['Em votação', emVotacao.titulo.slice(0, 20)]);
await caso('/assembleia proposta', 'membro', { comando: 'assembleia', sub: 'proposta', opcoes: { proposta: emVotacao.id } }, ['Contexto', 'Proposta', 'assembleia:votar:']);
await caso('votar a favor', 'membro', { comando: 'assembleia' }, 'Seu voto: **A favor**', 'botao', ['votar', emVotacao.id, String(emVotacao.rodada), 'favor']);
await caso('bloqueio curto é recusado', 'membro', { comando: 'assembleia', campos: { justificativa: 'curto demais' } }, '200 caracteres', 'modal', ['m-bloqueio', emVotacao.id, String(emVotacao.rodada)]);
await caso('comentar no debate', 'membro', { comando: 'assembleia', campos: { corpo: 'Comentário de teste vindo do Discord.' } }, 'Comentário de teste vindo do Discord', 'modal', ['m-comentar', emVotacao.id]);
await caso('nova proposta bloqueada no nível 2', 'membro', { comando: 'assembleia', campos: { titulo: 'Proposta x', contexto: 'Contexto suficiente para teste.', proposta: 'x'.repeat(60) } }, 'nível 3', 'modal', ['m-nova', 'geral', '5', '3', '0']);
await caso('nova proposta (admin) abre o debate', 'admin', { comando: 'assembleia', campos: { titulo: 'Proposta aberta pelo Discord', contexto: 'Contexto da proposta aberta pelo bot.', proposta: 'Texto da proposta aberta pelo Discord para debate da comunidade.' } }, ['Proposta aberta pelo Discord', 'Em debate', 'Comentar no debate'], 'modal', ['m-nova', 'geral', '5', '3', '0']);
await caso('/assembleia decisoes', 'membro', { comando: 'assembleia', sub: 'decisoes' }, 'Arquivo de decisões');

console.log('\n== Menu e tutorial');
await caso('/menu', 'membro', { comando: 'menu' }, ['Ágora · menu', 'Nível **2', 'DRC', 'menu:biblioteca', 'menu:tutorial:0']);
await caso('menu › Biblioteca (atualiza no lugar)', 'membro', { comando: 'menu', customId: 'menu:biblioteca' }, ['Biblioteca', 'menu:b:topicos', 'menu:b:revisar'], 'botao', ['biblioteca']);
await caso('menu › Biblioteca › Tópicos ativos', 'membro', { comando: 'menu', customId: 'menu:b:topicos' }, 'Tópicos ativos', 'botao', ['b', 'topicos']);
await caso('menu › Biblioteca › Salvos', 'membro', { comando: 'menu', customId: 'menu:b:salvos' }, /Salvos|salvou/i, 'botao', ['b', 'salvos']);
await caso('menu › Novo tópico pergunta o tema', 'membro', { comando: 'menu', customId: 'menu:b:novo-topico' }, ['Em qual tema?', 'menu:tema-topico', tema.nome], 'botao', ['b', 'novo-topico']);
await caso('menu › tema escolhido abre o formulário', 'membro', { comando: 'menu', customId: 'menu:tema-topico', valores: [tema.id] }, `[modal biblioteca:m-topico:${tema.id}`, 'botao', ['tema-topico']);
await caso('menu › Mutirão', 'membro', { comando: 'menu', customId: 'menu:mutirao' }, ['Mutirão', 'menu:m:projetos', 'menu:m:novo-evento'], 'botao', ['mutirao']);
await caso('menu › Mutirão › Eventos', 'membro', { comando: 'menu', customId: 'menu:m:eventos' }, 'Próximos eventos', 'botao', ['m', 'eventos']);
await caso('menu › Marcar evento lista os projetos', 'coordProjeto', { comando: 'menu', customId: 'menu:m:novo-evento' }, ['Marcar evento', 'menu:evento-projeto', projeto.titulo.slice(0, 15)], 'botao', ['m', 'novo-evento']);
await caso('menu › projeto escolhido abre o formulário de evento', 'coordProjeto', { comando: 'menu', customId: 'menu:evento-projeto', valores: [projeto.id] }, `[modal mutirao:m-evento:${projeto.id}`, 'botao', ['evento-projeto']);
await caso('menu › Assembleia (nível 2 não abre proposta)', 'membro', { comando: 'menu', customId: 'menu:assembleia' }, ['Assembleia', 'menu:a:votacao', 'Abrir propostas: nível 3'], 'botao', ['assembleia']);
await caso('menu › Assembleia › Em votação', 'membro', { comando: 'menu', customId: 'menu:a:votacao' }, ['Em votação', emVotacao.titulo.slice(0, 20)], 'botao', ['a', 'votacao']);
await caso('menu › Nova proposta pergunta o tipo', 'admin', { comando: 'menu', customId: 'menu:a:nova' }, ['Que tipo de proposta', 'menu:proposta-tipo'], 'botao', ['a', 'nova']);
await caso('menu › tipo escolhido abre o formulário', 'admin', { comando: 'menu', customId: 'menu:proposta-tipo', valores: ['financeira'] }, '[modal assembleia:m-nova:financeira:5:3:0', 'botao', ['proposta-tipo']);
await caso('menu › Dracmas', 'membro', { comando: 'menu', customId: 'menu:dracmas' }, ['Seus Dracmas', 'O que é o Dracma'], 'botao', ['dracmas']);
await caso('menu › Minha conta', 'membro', { comando: 'menu', customId: 'menu:conta' }, ['Minha conta', 'menu:email', 'menu:pseudonimo'], 'botao', ['conta']);
await caso('menu › Perfil', 'membro', { comando: 'menu', customId: 'menu:perfil' }, ['Nível 2 · Colaborador', 'Contribuições'], 'botao', ['perfil']);
await caso('menu › e-mail abre formulário', 'membro', { comando: 'menu', customId: 'menu:email' }, '[modal menu:m-email', 'botao', ['email']);
await caso('menu › e-mail inválido é recusado', 'membro', { comando: 'menu', campos: { email: 'isso-nao-e-email' } }, 'não parece válido', 'modal', ['m-email']);
await caso('menu › pseudônimo pelo formulário', 'membro', { comando: 'menu', campos: { nome: 'Coruja' } }, 'Coruja', 'modal', ['m-pseudonimo']);
await caso('menu › pseudônimo vazio volta ao nome', 'membro', { comando: 'menu', campos: { nome: '' } }, 'Membro de Teste', 'modal', ['m-pseudonimo']);
await caso('menu › buscar pelo formulário', 'membro', { comando: 'menu', campos: { termo: 'mutirão' } }, 'Busca', 'modal', ['m-buscar']);
await caso('tutorial: primeira página', 'membro', { comando: 'menu', customId: 'menu:tutorial:0' }, ['[no lugar]', 'Tutorial · 1', 'menu:tutorial:1', 'Página 1 de'], 'botao', ['tutorial', '0']);
await caso('tutorial: como os Dracmas chegam', 'membro', { comando: 'menu', customId: 'menu:tutorial-ir', valores: ['3'] }, ['Dracmas (DRC): como chegam', 'segunda-feira', '2.000 DRC'], 'botao', ['tutorial-ir']);
await caso('tutorial: última página leva ao menu', 'membro', { comando: 'menu', customId: 'menu:tutorial:99' }, ['O que já funciona', 'Ir para o menu'], 'botao', ['tutorial', '99']);
await caso('/menu fixar sem permissão é recusado', 'membro', { comando: 'menu', opcoes: { fixar_no_canal: true } }, 'Só a administração');
await caso('/menu fixar no canal (administração)', 'admin', { comando: 'menu', opcoes: { fixar_no_canal: true }, permissoes: ['ManageGuild'] }, ['[canal]', 'Abrir meu menu', 'Painel publicado']);
await caso('painel público abre o menu pessoal sem mudar o painel', 'membro', { comando: 'menu', customId: 'menu:inicio', efemera: false }, 'Ágora · menu', 'botao', ['inicio']).then((t) => {
  if (t.includes('[no lugar]')) { falhas++; ok--; console.log('✗   …mas atualizou a mensagem pública'); }
});
await caso('tutorial pelo painel público abre mensagem própria', 'membro', { comando: 'menu', customId: 'menu:tutorial:0', efemera: false }, 'Tutorial · 1', 'botao', ['tutorial', '0']).then((t) => {
  if (t.includes('[no lugar]')) { falhas++; ok--; console.log('✗   …mas atualizou a mensagem pública'); }
});

console.log('\n== Acervo');
const docsTeste = Array.from({ length: 12 }, (_, i) => ({
  id: `teste-acervo-${i}`, nome: `Doc ${i}.pdf`, titulo: i === 0 ? 'Tarô de Marselha para iniciantes' : `Apostila de teste ${i}`,
  tipo: i % 2 ? 'documento' : 'pdf', mime: 'application/pdf', categoria: 'Categoria Teste', colecao: i < 6 ? 'Coleção A' : 'Coleção B',
  caminho: [i < 6 ? 'Coleção A' : 'Coleção B'], assunto: i === 0 ? 'Artes Divinatórias' : 'Assunto Teste', tamanho: 1024 * (i + 1),
}));
await um(admin.from('acervo_documentos').upsert(docsTeste));
const acervo = await caso('/biblioteca acervo', 'membro', { comando: 'biblioteca', sub: 'acervo' }, ['Acervo da biblioteca', 'documentos', 'biblioteca:acervo:', 'Categoria Teste']);
await caso('/biblioteca acervo com busca', 'membro', { comando: 'biblioteca', sub: 'acervo', opcoes: { busca: 'taro' } }, ['Tarô de Marselha', 'drive.google.com/file/d/teste-acervo-0', '🔎 “taro”']);
await caso('autocompletar coleção do acervo', 'membro', { comando: 'biblioteca', foco: 'colecao', opcoes: { colecao: 'cole' } }, 'Coleção A · Categoria Teste', 'autocomplete');
await caso('/biblioteca acervo por coleção', 'membro', { comando: 'biblioteca', sub: 'acervo', opcoes: { colecao: 'Categoria Teste|Coleção B' } }, ['🗂️ Coleção B', 'Apostila de teste 6']);
const chaveAcervo = (acervo.match(/biblioteca:acervo:([0-9a-f]{8}):cat/) ?? [])[1];
const porCategoria = await caso('acervo › escolher categoria', 'membro', { comando: 'biblioteca', customId: `biblioteca:acervo:${chaveAcervo}:cat`, valores: ['Categoria Teste'] }, ['📂 Categoria Teste', ':col', 'Coleção A', 'Próxima'], 'botao', ['acervo', chaveAcervo, 'cat']);
const chave2 = (porCategoria.match(/biblioteca:acervo:([0-9a-f]{8}):col/) ?? [])[1];
await caso('acervo › próxima página', 'membro', { comando: 'biblioteca', customId: `biblioteca:acervo:${chave2}:pag-1` }, ['Página 2', 'Anterior'], 'botao', ['acervo', chave2, 'pag-1']);
await caso('acervo › botão Buscar abre formulário', 'membro', { comando: 'biblioteca', customId: `biblioteca:acervo:${chave2}:buscar` }, `[modal biblioteca:m-acervo:${chave2}`, 'botao', ['acervo', chave2, 'buscar']);
await caso('acervo › busca mantém a categoria', 'membro', { comando: 'biblioteca', customId: `biblioteca:m-acervo:${chave2}`, campos: { termo: 'apostila 7' } }, ['🔎 “apostila 7”', '📂 Categoria Teste', 'Apostila de teste 7'], 'modal', ['m-acervo', chave2]);
await caso('acervo › limpar filtros', 'membro', { comando: 'biblioteca', customId: `biblioteca:acervo:${chave2}:limpar` }, 'Escolher categoria', 'botao', ['acervo', chave2, 'limpar']);
await caso('menu › Acervo', 'membro', { comando: 'menu', customId: 'menu:acervo' }, 'Acervo da biblioteca', 'botao', ['acervo']);
await um(admin.from('acervo_documentos').delete().like('id', 'teste-acervo-%'));

console.log('\n== Eventos (Mutirão → Discord)');
await caso('novo evento sem projeto exige nível 4', 'membro', { comando: 'mutirao', campos: { titulo: 'Evento x', inicio: '25/12/2030 10:00', duracao: '2', local: 'Praça' } }, 'nível 4', 'modal', ['m-evento', '-']);
await caso('novo evento com data inválida', 'coordProjeto', { comando: 'mutirao', campos: { titulo: 'Evento x', inicio: 'amanhã cedo', duracao: '2', local: 'Praça' } }, 'Não entendi a data', 'modal', ['m-evento', projeto.id]);
await caso('/mutirao novo-evento abre formulário', 'coordProjeto', { comando: 'mutirao', sub: 'novo-evento', opcoes: { projeto: projeto.id } }, `[modal mutirao:m-evento:${projeto.id}`);
const ano = new Date().getFullYear() + 1;
await caso('coordenação marca evento do projeto', 'coordProjeto', { comando: 'mutirao', campos: { titulo: 'Mutirão marcado pelo Discord', inicio: `15/03/${ano} 14:00`, duracao: '3,5', local: 'Escola X — Rua Y, 123', descricao: 'Separação de doações.' } }, ['Mutirão marcado pelo Discord', 'Escola X — Rua Y, 123', 'mutirao:rsvp:'], 'modal', ['m-evento', projeto.id]);
const evNovo = await um(admin.from('eventos').select('id, inicio, fim, local_nome, endereco').eq('titulo', 'Mutirão marcado pelo Discord').single());
const horasEv = (new Date(evNovo.fim) - new Date(evNovo.inicio)) / 3600_000;
if (evNovo.inicio.startsWith(`${ano}-03-15T17:00`) && horasEv === 3.5 && evNovo.endereco === 'Rua Y, 123') { ok++; console.log('✓ evento gravado com horário de Brasília, duração e endereço'); }
else { falhas++; console.log('✗ evento gravado errado', evNovo); }

const { iniciarEventosDiscord, sincronizarEventos, desejados } = await import('../src/agora/eventos-discord.js');
const discord = { criados: [], editados: [], apagados: [], existentes: new Map() };
let proximoId = 1;
const fazerEvento = (dadosEv) => {
  const e = { id: String(proximoId++), status: 1, ...dadosEv,
    async edit(x) { discord.editados.push({ id: e.id, ...x }); Object.assign(e, x); return e; },
    async delete() { discord.apagados.push(e.id); discord.existentes.delete(e.id); } };
  discord.existentes.set(e.id, e);
  return e;
};
const guilda = {
  id: '1',
  members: { fetchMe: async () => ({ permissions: { has: () => true } }) },
  scheduledEvents: {
    async create(x) { discord.criados.push(x); return fazerEvento(x); },
    async fetch() { return discord.existentes; },
  },
};
const lista = desejados({ eventos: [{ id: 'e', titulo: 'T', inicio: new Date(Date.now() - 3600_000).toISOString(), fim: new Date(Date.now() + 3600_000).toISOString() }], propostas: [{ id: 'p', titulo: 'P', status: 'votacao', votacao_ate: new Date(Date.now() + 86_400_000).toISOString(), created_at: new Date().toISOString() }] });
if (lista.length === 2 && lista[0].local === 'A combinar' && lista[1].nome.startsWith('🗳️')) { ok++; console.log('✓ desejados(): evento em andamento e votação aberta'); }
else { falhas++; console.log('✗ desejados()', lista); }
await um(admin.from('discord_eventos').delete().eq('guild_id', '1'));
iniciarEventosDiscord({ guilds: { fetch: async () => guilda } });
for (let i = 0; i < 50 && !discord.criados.length; i++) await new Promise((r) => setTimeout(r, 100));
await new Promise((r) => setTimeout(r, 500));
const criadoNovo = discord.criados.find((x) => x.name === '🤝 Mutirão marcado pelo Discord');
const criadoProposta = discord.criados.find((x) => x.name === '🗳️ Assembleia: Proposta aberta pelo Discord');
if (criadoNovo && criadoNovo.entityMetadata.location === 'Escola X — Rua Y, 123' && criadoNovo.scheduledStartTime > new Date() && criadoProposta) {
  ok++; console.log(`✓ sincronização criou ${discord.criados.length} eventos no Discord (evento do Mutirão e votação incluídos)`);
} else { falhas++; console.log('✗ sincronização não criou os eventos esperados', discord.criados.map((x) => x.name)); }
const mapeados = await um(admin.from('discord_eventos').select('origem, origem_id').eq('guild_id', '1'));
if (mapeados.length === discord.criados.length) { ok++; console.log('✓ vínculos gravados em discord_eventos'); } else { falhas++; console.log('✗ vínculos', mapeados.length, discord.criados.length); }
const antes = discord.criados.length;
await sincronizarEventos();
if (discord.criados.length === antes && !discord.editados.length) { ok++; console.log('✓ segunda sincronização não duplica nada'); } else { falhas++; console.log('✗ duplicou/editou sem mudança'); }
await um(admin.from('eventos').update({ titulo: 'Mutirão remarcado pelo Discord' }).eq('id', evNovo.id));
await sincronizarEventos();
if (discord.editados.some((x) => x.name === '🤝 Mutirão remarcado pelo Discord')) { ok++; console.log('✓ mudança no evento atualiza o evento do Discord'); } else { falhas++; console.log('✗ não editou', discord.editados); }
await um(admin.from('eventos').update({ excluido_em: new Date().toISOString() }).eq('id', evNovo.id));
await sincronizarEventos();
const idDiscordNovo = discord.criados.indexOf(criadoNovo) + 1;
if (discord.apagados.includes(String(idDiscordNovo))) { ok++; console.log('✓ evento cancelado sai do Discord'); } else { falhas++; console.log('✗ não apagou', discord.apagados); }

console.log('\n== Assinatura pelo cargo do Discord');
const { config } = await import('../src/config.js');
config.agora.cargoMembroId = '123';
await caso('sem o cargo: assinatura dada pela administração continua', 'membro', { comando: 'agora', sub: 'perfil' }, 'Contribuições');
await um(admin.from('discord_vinculos').update({ assinatura_pelo_discord: true }).eq('discord_id', pessoas.membro.discordId));
await caso('sem o cargo: assinatura que veio do cargo é desativada', 'membro', { comando: 'agora', sub: 'perfil' }, 'não está ativa');
await caso('com o cargo de novo: volta a funcionar', 'membro', { comando: 'agora', sub: 'perfil', cargos: ['123'] }, 'Contribuições');
config.agora.cargoMembroId = undefined;

console.log(`\n${ok} ok · ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
