-- migration_033: contact leads table for landing page email capture
create table if not exists contact_leads (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  agents integer,
  conversations integer,
  estimated_spend text,
  source text default 'landing_calculator',
  created_at timestamptz default now()
);

-- Allow anyone (anon) to insert — this is a public lead capture form
alter table contact_leads enable row level security;

create policy "anon can insert contact leads"
  on contact_leads for insert
  to anon, authenticated
  with check (true);

-- Only service role can read (owner views via Supabase dashboard)
create policy "service role can read contact leads"
  on contact_leads for select
  to service_role
  using (true);

-- Explicit grants required in addition to RLS policies
grant insert on contact_leads to anon;
grant insert on contact_leads to authenticated;
