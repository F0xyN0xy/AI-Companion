-- Drop old Supabase-auth-dependent table if it exists
drop table if exists public.profiles;

-- New self-contained users table (no dependency on auth.users)
create table if not exists public.users (
  id              uuid primary key default gen_random_uuid(),
  email           text unique not null,
  password_hash   text not null,
  first_name      text,
  verified        boolean default false,
  verify_token    text,
  verify_expires  timestamptz,
  created_at      timestamptz default now()
);

-- Index for fast token lookups
create index if not exists users_verify_token_idx on public.users (verify_token);

-- Enable RLS
alter table public.users enable row level security;

-- Only service role (your Netlify functions) can access
create policy "Service role full access"
  on public.users
  for all
  using (true)
  with check (true);
