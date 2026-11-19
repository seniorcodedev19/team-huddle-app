-- Close the hosting provider's REST door to the tables.
--
-- Supabase puts a REST API in front of the `public` schema and grants its two
-- web roles, `anon` and `authenticated`, full rights on every table created
-- there. With row-level security off, as it was on all of ours, anyone holding
-- the project's anon key could read and change every table over HTTPS without
-- going through this app at all: users and their password hashes, reports,
-- profiles, the audit log.
--
-- This app never uses that API. It connects to Postgres directly, as a role
-- that owns the tables and so is not subject to row-level security. Two
-- layers, so that one being undone later does not reopen the door:
--
--   1. Row-level security on, with no policies: the web roles see no rows.
--   2. The web roles lose their rights on the tables, and stop receiving
--      rights on tables created from now on.
--
-- On plain Postgres (docker compose) the web roles do not exist and step 2 is
-- skipped. A new table still needs `enable row level security` in its own
-- migration to get the first layer; the second covers it either way.
do $$
declare
  t regclass;
  web_role text;
begin
  for t in
    select c.oid::regclass
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    execute format('alter table %s enable row level security', t);
  end loop;

  foreach web_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = web_role) then
      execute format('revoke all on all tables in schema public from %I', web_role);
      execute format('revoke all on all sequences in schema public from %I', web_role);
      execute format('alter default privileges in schema public revoke all on tables from %I', web_role);
      execute format('alter default privileges in schema public revoke all on sequences from %I', web_role);
    end if;
  end loop;
end $$;
