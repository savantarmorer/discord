-- Sessão da ponte WhatsApp ⇄ Discord (src/agora/whatsapp-sessao.js).
-- Rode uma vez no SQL Editor do Supabase da Ágora.
-- Quem lê esta tabela consegue agir como o número do WhatsApp: o RLS fica ligado e sem
-- nenhuma política, de modo que só a chave service_role (usada pelo bot) tem acesso.

create table if not exists public.whatsapp_sessao (
  sessao text not null,
  chave text not null,
  valor text not null,
  atualizado_em timestamptz not null default now(),
  primary key (sessao, chave)
);

alter table public.whatsapp_sessao enable row level security;
revoke all on public.whatsapp_sessao from anon, authenticated;
