create table if not exists public.used_nonces (
  nonce text primary key,
  used_at timestamptz not null default now()
);

create index if not exists idx_used_nonces_used_at on public.used_nonces (used_at);
