-- Sign-in and sign-up attempts, kept only long enough to slow down guessing.
--
-- The API counts recent rows here before it checks a password
-- (apps/api/src/loginGuard.ts). A failed sign-in leaves a row; a successful
-- one clears that email's rows. Every sign-up leaves a row, so one address
-- cannot create accounts in bulk. Rows older than a day are deleted as new
-- ones arrive, so this never holds more than a day of attempts.
--
-- ip is the visitor's address as the web app reports it, '' when unknown.
create table if not exists auth_attempts (
  id bigserial primary key,
  kind text not null check (kind in ('login', 'signup')),
  email text not null,
  ip text not null default '',
  at timestamptz not null default now()
);

create index if not exists auth_attempts_email_idx on auth_attempts (kind, email, at);
create index if not exists auth_attempts_ip_idx on auth_attempts (kind, ip, at);
