-- SubarnaPasal POS upgrade: invoices, repairs, gold schemes, FX settings.
-- Run this in the Supabase SQL Editor. Safe to run more than once.
--
-- Without these tables the app still works: the new data is kept in the
-- server's local JSON store and synced up automatically once they exist.

-- 1) Extra settings (FX rates + invoice/repair/scheme counters) in one jsonb column.
alter table if exists settings add column if not exists extras jsonb;

-- 2) Generic per-user jsonb collections.
create table if not exists sales (
  user_id uuid not null,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists repairs (
  user_id uuid not null,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists schemes (
  user_id uuid not null,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- These three previously lived only in the local JSON fallback; creating the
-- tables lets the server persist them to the database as well.
create table if not exists karigars (
  user_id uuid not null,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists gold_ledger (
  user_id uuid not null,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists old_gold_exchanges (
  user_id uuid not null,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists options (
  user_id uuid not null,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists requests (
  user_id uuid not null,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- 3) Lock the tables down: the API uses the service-role key, which bypasses
-- RLS; enabling RLS with no policies blocks any anon/browser access.
alter table sales enable row level security;
alter table repairs enable row level security;
alter table schemes enable row level security;
alter table karigars enable row level security;
alter table gold_ledger enable row level security;
alter table old_gold_exchanges enable row level security;
alter table options enable row level security;
alter table requests enable row level security;
