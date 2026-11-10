-- Vaani Kavach durable state: one small key/value table with a revision column used for compare-and-set.
-- Run in the Supabase SQL editor. Access is by the SERVER-SIDE service role key only.
create table if not exists public.vk_kv (
  key        text primary key,
  value      jsonb       not null,
  rev        integer     not null default 1,
  updated_at timestamptz not null default now()
);
create index if not exists vk_kv_updated_at_idx on public.vk_kv (updated_at);

-- Row Level Security ON with NO policies: anon/authenticated roles can read or write nothing.
-- The service role bypasses RLS; the browser never receives the service key.
alter table public.vk_kv enable row level security;
revoke all on public.vk_kv from anon, authenticated;
