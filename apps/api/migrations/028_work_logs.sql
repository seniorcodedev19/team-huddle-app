-- Daily work amounts: how much was done on a profile, or on one of its
-- training cards, on a given day.
--
-- A day, not a moment. The point is to see the amount of work per day, week
-- and month, so the grain is one number per (day, subject, metric) and there
-- is no time of day anywhere in this table.
--
-- Two kinds of subject share the table:
--   * a profile     - applications, interviews scheduled, interviews done
--   * a board card  - AI-training applications, AI interviews, assessments
-- A card row also carries its profile_id, so every number can be rolled up
-- to a profile, and from there to the people the profile is assigned to,
-- without a join through the card.
--
-- All numbers are typed by hand. Interviews are deliberately not counted
-- from the calendar: an interview that never reached the calendar still
-- counts as work done.

create table if not exists work_logs (
  id         bigserial primary key,
  log_date   date not null,
  profile_id int  not null references profiles(id) on delete cascade,
  -- Set for a card's numbers, null for the profile's own.
  account_id int  references training_accounts(id) on delete cascade,
  metric     text not null,
  -- Zero is stored as no row at all, the same way daily_entries works, so a
  -- cleared field and a never-filled field are one state rather than two.
  value      int  not null check (value > 0),
  updated_by int  references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table work_logs drop constraint if exists work_logs_metric_check;
alter table work_logs add constraint work_logs_metric_check check (
  (account_id is null     and metric in ('apply', 'interview_scheduled', 'interview_done'))
  or
  (account_id is not null and metric in ('ai_apply', 'ai_interview', 'assessment'))
);

-- One number per day per subject per metric. Two partial indexes because the
-- subject is either the profile or the card, and a plain unique index treats
-- every null account_id as distinct.
create unique index if not exists work_logs_profile_uq
  on work_logs (log_date, profile_id, metric) where account_id is null;
create unique index if not exists work_logs_card_uq
  on work_logs (log_date, account_id, metric) where account_id is not null;

-- The dashboard reads a date range.
create index if not exists work_logs_date_idx on work_logs (log_date);
