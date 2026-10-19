-- Parts Room database (Neon Postgres). Safe to run more than once.
-- Mirrors src/domain/rules.ts and server/fields.ts; the server writes only through server/pgStore.ts.

create table if not exists systems (
  id                text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name              text not null,
  sort_order        integer not null default 0,
  active            boolean not null default true,
  server_updated_at timestamptz not null default date_trunc('milliseconds', clock_timestamp())
);

create table if not exists bins (
  id                uuid primary key,
  bin_code          text not null,
  bin_key           text generated always as (case when deleted_at is null then upper(btrim(bin_code)) end) stored,
  shelf_zone        text not null default '',
  bin_size          text not null default '',
  label_text        text not null default '',
  created_at        timestamptz not null,
  updated_at        timestamptz not null,
  deleted_at        timestamptz,
  server_updated_at timestamptz not null default date_trunc('milliseconds', clock_timestamp())
);
create unique index if not exists bins_live_code on bins (bin_key);
create index if not exists bins_sync on bins (server_updated_at, (id::text));

create table if not exists parts (
  id                uuid primary key,
  part_id           text not null,
  part_key          text generated always as (case when deleted_at is null then upper(btrim(part_id)) end) stored,
  name              text not null,
  system_id         text,
  qty               numeric(12,2) not null check (qty >= 0),
  condition         text check (condition in ('New', 'Used - good', 'Needs testing', 'Needs repair', 'Unknown')),
  disposition       text check (disposition in ('Keep', 'Toss', 'Donate/Sell', 'Unknown')),
  old_location      text not null default '',
  bin_id            uuid,
  moved_back        boolean not null default false,
  manufacturer      text not null default '',
  mfr_part_number   text not null default '',
  supplier          text not null default '',
  min_qty           numeric(12,2) check (min_qty >= 0),
  reorder_qty       numeric(12,2) check (reorder_qty >= 0),
  unit_cost         numeric(12,2) check (unit_cost >= 0),
  retail_price      numeric(12,2) check (retail_price >= 0),
  last_counted      date,
  replace_by        date,
  photo_link        text not null default '',
  notes             text not null default '',
  needs_details     boolean not null default false,
  created_at        timestamptz not null,
  updated_at        timestamptz not null,
  deleted_at        timestamptz,
  server_updated_at timestamptz not null default date_trunc('milliseconds', clock_timestamp()),
  constraint moved_back_needs_bin check (deleted_at is not null or not moved_back or bin_id is not null)
);
-- Part IDs are unique among live parts (they become the Lightspeed SKU). NULL keys (deleted) don't clash.
create unique index if not exists parts_live_part_id on parts (part_key);
create index if not exists parts_sync on parts (server_updated_at, (id::text));

create table if not exists login_failures (
  key text not null,
  at  timestamptz not null default now()
);
create index if not exists login_failures_key_at on login_failures (key, at);
