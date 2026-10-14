// ============================================
// agora/cliente.js — Conexão com o backend da Ágora (o mesmo Supabase do app)
// ============================================
// Cada pessoa do Discord ganha uma conta na Ágora. O bot age SEMPRE como essa
// pessoa (sessão própria): as regras do banco (níveis, permissões, RLS, limites)
// valem igualzinho ao app, e tudo o que é feito aqui já aparece no app.
// Só duas coisas usam a chave de serviço: criar a conta/vínculo e sincronizar a
// assinatura com o cargo do Discord.

import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

const cfg = config.agora;

export class ErroAgora extends Error {}

export const agoraConfigurada = () => Boolean(cfg.url && cfg.anonKey && cfg.serviceKey);

/** Papel ('anon', 'service_role'...) de uma chave do Supabase, quando dá para saber sem rede. */
function papelDaChave(chave) {
  if (!chave) return null;
  if (chave.startsWith('sb_publishable_')) return 'anon';
  if (chave.startsWith('sb_secret_')) return 'service_role';
  const partes = chave.split('.');
  if (partes.length !== 3) return 'desconhecido';
  try {
    const corpo = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
    return { papel: corpo.role ?? 'desconhecido', ref: corpo.ref ?? null };
  } catch {
    return 'desconhecido';
  }
}

/**
 * Confere as chaves da Ágora sem acessar a rede. Devolve uma lista de problemas
 * (vazia quando está tudo certo). O erro clássico é colocar a chave anon (pública)
 * em AGORA_SUPABASE_SERVICE_KEY: aí o banco responde "permission denied for table
 * discord_vinculos".
 */
export function problemasDeConfiguracao() {
  if (!agoraConfigurada()) return ['Faltam AGORA_SUPABASE_URL, AGORA_SUPABASE_ANON_KEY ou AGORA_SUPABASE_SERVICE_KEY.'];
  const problemas = [];
  const info = (chave) => {
    const p = papelDaChave(chave);
    return typeof p === 'string' ? { papel: p, ref: null } : p;
  };
  const servico = info(cfg.serviceKey);
  const anon = info(cfg.anonKey);
  if (servico.papel !== 'service_role' && servico.papel !== 'desconhecido') {
    problemas.push(
      `AGORA_SUPABASE_SERVICE_KEY é uma chave "${servico.papel}", não a service_role. ` +
        'Use a chave "service_role" (ou "secret", sb_secret_…) em Supabase › Project Settings › API Keys.',
    );
  }
  if (anon.papel === 'service_role') {
    problemas.push('AGORA_SUPABASE_ANON_KEY está com a chave secreta (service_role). Use a chave "anon"/"publishable".');
  }
  const refUrl = /^https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(cfg.url ?? '')?.[1];
  for (const [nome, i] of [['AGORA_SUPABASE_SERVICE_KEY', servico], ['AGORA_SUPABASE_ANON_KEY', anon]]) {
    if (refUrl && i.ref && i.ref !== refUrl) {
      problemas.push(`${nome} é do projeto "${i.ref}", mas AGORA_SUPABASE_URL aponta para "${refUrl}".`);
    }
  }
  return problemas;
}

let admin = null;
export function clienteAdmin() {
  admin ??= createClient(cfg.url, cfg.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

/** Testes podem trocar a fábrica de sessões (ex.: JWT local). */
let fabricaSessao = null;
export function definirFabricaSessao(fn) {
  fabricaSessao = fn;
}

// ------------------------------------------------------------------ erros
/** Converte erros do Postgres/PostgREST em mensagens humanas (igual ao app). */
export function mensagemDeErro(erro) {
  const codigo = erro?.code;
  const msg = erro?.message ?? '';
  if (codigo === '42501' || /row-level security/i.test(msg)) {
    if (/row-level security/i.test(msg)) return 'Você não tem permissão para isso (ainda). Veja os níveis em `/agora perfil`.';
    if (/discord_vinculos/.test(msg)) {
      return 'O bot está com a chave errada do Supabase (AGORA_SUPABASE_SERVICE_KEY precisa ser a service_role). Avise a administração.';
    }
    return msg || 'Você não tem permissão para isso.';
  }
  if (codigo === '23505') return 'Esse registro já existe.';
  if (codigo === '23514') {
    if (/bloqueio_justificado/.test(msg)) return 'O bloqueio exige uma justificativa de pelo menos 200 caracteres.';
    return 'Algum campo está fora do formato esperado.';
  }
  if (codigo === 'P0429') return msg;
  if (codigo === 'PGRST116') return 'Não encontramos o que você procurou.';
  if (codigo === '22P02') return 'Identificador inválido. Escolha uma opção da lista.';
  if (/JWT expired/i.test(msg)) return 'Sua sessão expirou. Tente de novo.';
  return msg || 'Algo deu errado. Tente de novo.';
}

/** Desembrulha { data, error } do Supabase, lançando ErroAgora em português. */
export async function dados(consulta) {
  const { data, error } = await consulta;
  if (error) throw new ErroAgora(mensagemDeErro(error));
  return data;
}

// ------------------------------------------------------------------ sessões
function base64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/** JWT HS256 assinado com o segredo legado do projeto (mesmo formato do GoTrue). */
function assinarJwt(perfilId, email) {
  const agora = Math.floor(Date.now() / 1000);
  const cabecalho = base64url({ alg: 'HS256', typ: 'JWT' });
  const corpo = base64url({
    sub: perfilId,
    email,
    role: 'authenticated',
    aud: 'authenticated',
    iat: agora,
    exp: agora + 3600,
    app_metadata: { provider: 'discord-bot' },
  });
  const assinatura = crypto.createHmac('sha256', cfg.jwtSecret).update(`${cabecalho}.${corpo}`).digest('base64url');
  return { token: `${cabecalho}.${corpo}.${assinatura}`, expira: (agora + 3600) * 1000 };
}

/** Sessão real emitida pelo próprio Auth: link mágico gerado no servidor e trocado na hora. */
async function sessaoPorLinkMagico(email) {
  const { data, error } = await clienteAdmin().auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new ErroAgora(`Não foi possível abrir sua sessão na Ágora: ${error.message}`);
  const anon = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: login, error: erroLogin } = await anon.auth.verifyOtp({
    type: 'magiclink',
    token_hash: data.properties.hashed_token,
  });
  if (erroLogin || !login.session) throw new ErroAgora('Não foi possível abrir sua sessão na Ágora. Tente de novo.');
  return { token: login.session.access_token, expira: login.session.expires_at * 1000 };
}

const sessoes = new Map(); // discordId -> { sb, expira }

/** Cliente Supabase que age como a pessoa (com cache até perto de expirar). */
async function clienteDoMembro(discordId, perfilId, email) {
  const cache = sessoes.get(discordId);
  if (cache && cache.expira - Date.now() > 5 * 60_000) return cache.sb;
  const { token, expira } = fabricaSessao
    ? await fabricaSessao(perfilId, email)
    : cfg.jwtSecret
      ? assinarJwt(perfilId, email)
      : await sessaoPorLinkMagico(email);
  const sb = createClient(cfg.url, cfg.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  sessoes.set(discordId, { sb, expira });
  return sb;
}

// ------------------------------------------------------------------ contas
function temCargo(member, cargoId) {
  if (!member || !cargoId) return false;
  const roles = member.roles;
  if (Array.isArray(roles)) return roles.includes(cargoId);
  return Boolean(roles?.cache?.has?.(cargoId));
}

/** Busca o vínculo; cria a conta da Ágora na primeira vez. */
async function vinculoDe(user, nome) {
  const adm = clienteAdmin();
  const existente = await dados(
    adm.from('discord_vinculos').select('profile_id, email_tecnico, assinatura_pelo_discord').eq('discord_id', user.id).maybeSingle(),
  );
  if (existente) return existente;

  const email = `discord-${user.id}@${cfg.dominioEmail}`;
  const meta = { full_name: nome, discord_id: user.id, discord_usuario: user.username };
  let perfilId;
  const criado = await adm.auth.admin.createUser({ email, email_confirm: true, user_metadata: meta });
  if (criado.error) {
    // Conta já existe (vínculo perdido): recupera o id pelo link mágico, que devolve o usuário
    const link = await adm.auth.admin.generateLink({ type: 'magiclink', email });
    if (link.error || !link.data?.user) throw new ErroAgora(`Não foi possível criar sua conta na Ágora: ${criado.error.message}`);
    perfilId = link.data.user.id;
  } else {
    perfilId = criado.data.user.id;
  }
  const vinculo = { discord_id: user.id, profile_id: perfilId, email_tecnico: email, assinatura_pelo_discord: false };
  await dados(adm.from('discord_vinculos').upsert(vinculo));
  return vinculo;
}

/**
 * Acesso da pessoa à Ágora. Garante conta, sincroniza a assinatura com o cargo do
 * Discord e devolve o cliente que age em nome dela e o perfil atualizado.
 */
export async function acessoDe(interaction) {
  if (!agoraConfigurada()) {
    throw new ErroAgora('A prévia da Ágora ainda não foi configurada neste servidor. Avise a administração.');
  }
  const problemas = problemasDeConfiguracao();
  if (problemas.length) {
    throw new ErroAgora(`A configuração do bot tem um problema (avise a administração):\n• ${problemas.join('\n• ')}`);
  }
  const user = interaction.user;
  const nome = interaction.member?.displayName || interaction.member?.nick || user.globalName || user.username;
  const vinculo = await vinculoDe(user, nome);
  const adm = clienteAdmin();
  let perfil = await dados(adm.from('profiles').select('*').eq('id', vinculo.profile_id).single());

  // Assinatura: com cargo configurado, quem tem o cargo é membro ativo; sem cargo, todos participam
  // Em mensagem direta não há "member": sem como ver o cargo, a assinatura fica como está
  const semCargoParaVer = Boolean(cfg.cargoMembroId) && !interaction.member;
  const deveSerAtivo = cfg.cargoMembroId ? temCargo(interaction.member, cfg.cargoMembroId) : true;
  const validaAte = perfil.assinatura_valida_ate ? new Date(perfil.assinatura_valida_ate).getTime() : 0;
  const venceLogo = validaAte - Date.now() < 7 * 86_400_000;
  if (semCargoParaVer) {
    // nada a sincronizar
  } else if (deveSerAtivo && (perfil.status_assinatura !== 'ativo' || venceLogo)) {
    perfil = await dados(
      adm.from('profiles')
        .update({ status_assinatura: 'ativo', assinatura_valida_ate: new Date(Date.now() + 30 * 86_400_000).toISOString() })
        .eq('id', perfil.id).select('*').single(),
    );
    if (!vinculo.assinatura_pelo_discord) {
      await dados(adm.from('discord_vinculos').update({ assinatura_pelo_discord: true }).eq('discord_id', user.id));
    }
  } else if (!deveSerAtivo && vinculo.assinatura_pelo_discord && perfil.status_assinatura === 'ativo') {
    perfil = await dados(adm.from('profiles').update({ status_assinatura: 'inativo' }).eq('id', perfil.id).select('*').single());
    await dados(adm.from('discord_vinculos').update({ assinatura_pelo_discord: false }).eq('discord_id', user.id));
  }
  adm.from('discord_vinculos').update({ ultimo_uso_em: new Date().toISOString() }).eq('discord_id', user.id).then(() => null);

  const sb = await clienteDoMembro(user.id, perfil.id, vinculo.email_tecnico);
  return { sb, perfil, emailTecnico: vinculo.email_tecnico };
}

/** Busca o perfil da Ágora de outra pessoa do Discord (só leitura pública), se ela já entrou. */
export async function perfilIdDoDiscord(discordId) {
  if (!agoraConfigurada()) return null;
  const v = await dados(clienteAdmin().from('discord_vinculos').select('profile_id').eq('discord_id', discordId).maybeSingle());
  return v?.profile_id ?? null;
}

/** Limpa o cache de sessões (de uma pessoa ou de todas). */
export function limparSessoes(discordId) {
  if (discordId) sessoes.delete(discordId);
  else sessoes.clear();
}
