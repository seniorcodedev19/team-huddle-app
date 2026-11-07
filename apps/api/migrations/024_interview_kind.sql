-- What kind of event this is. Recorded as its own column rather than being
-- inferred from the topic text, because these categories are intended to be
-- counted: future metrics and evaluation group by this.
--
--   interview     a live interview with the client
--   ai_interview  an automated or AI-run interview
--   event         anything else on the calendar
--
-- 'interview' is the default: every row that exists now is one, and the
-- calendar was built for interviews before it held anything else.
--
-- Named `kind`, not `type`, to avoid colliding with the SQL keyword.

alter table interviews add column if not exists kind text not null default 'interview';

alter table interviews drop constraint if exists interviews_kind_check;
alter table interviews add constraint interviews_kind_check
  check (kind in ('interview', 'ai_interview', 'event'));

-- Metrics will group by kind over a date range, so index that pair.
create index if not exists interviews_kind_idx on interviews (kind, scheduled_at desc);
