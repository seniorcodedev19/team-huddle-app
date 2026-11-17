-- ManicTime replaces hand-logged time.
--
-- A sync job reads the ManicTime Server API and writes two things per person
-- per day: active computer time (which feeds the Time Tracking metric) and the
-- time spent under each ManicTime tag (the day's task list). Hand-logged rows
-- in time_logs stay as history: a day with ManicTime data uses ManicTime, a
-- day without falls back to whatever was logged by hand before the switch.

-- Connection, saved by an admin. The secret is an API token or a password,
-- AES-GCM encrypted like the Slack and OpenAI secrets, never returned.
create table if not exists manictime_config (
  id int primary key default 1 check (id = 1),
  server_url text not null default '',
  auth_mode text not null default 'password' check (auth_mode in ('token', 'password')),
  username text not null default '',
  secret_enc text,
  updated_by int references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  synced_at timestamptz,
  sync_error text,
  sync_summary jsonb
);

insert into manictime_config (id) values (1) on conflict (id) do nothing;

-- ManicTime users the sync has seen, and which Huddle user each one is.
-- Keyed by ManicTime's login name, which is what a timeline's owner carries.
create table if not exists manictime_people (
  mt_username text primary key,
  display_name text not null default '',
  user_id int unique references users(id) on delete set null,
  devices int not null default 0,
  seen_at timestamptz not null default now()
);

-- Active computer time, merged across a person's devices so two machines
-- running at once are not counted twice. log_date is the person's local day.
create table if not exists manictime_days (
  user_id int not null references users(id) on delete cascade,
  log_date date not null,
  active_minutes int not null check (active_minutes >= 0 and active_minutes <= 1440),
  synced_at timestamptz not null default now(),
  primary key (user_id, log_date)
);

-- Time under each tag per day. A tag is ManicTime's comma-separated tag
-- combination ("Client A, Design"). auto marks ManicTime's AutoTags timeline.
create table if not exists manictime_tags (
  user_id int not null references users(id) on delete cascade,
  log_date date not null,
  tag text not null,
  auto boolean not null default false,
  minutes int not null check (minutes > 0 and minutes <= 1440),
  notes text,
  synced_at timestamptz not null default now(),
  primary key (user_id, log_date, tag, auto)
);
