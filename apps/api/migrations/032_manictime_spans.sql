-- Each stretch of ManicTime time, per person per local day: Active and Away
-- on each computer, and every Tag and AutoTag. The Time tracking page draws
-- its timelines and active-time report from these.
--
-- Display only. The Time Tracking score still reads manictime_days, which
-- keeps the week lock; these rows are replaced on every sync, locked week
-- or not, so the report always shows what ManicTime has.
--
-- start_sec/end_sec are seconds from the person's local midnight on log_date.

create table if not exists manictime_spans (
  user_id   int  not null references users(id) on delete cascade,
  log_date  date not null,
  device    text not null default '',            -- computer name; '' for tags
  kind      text not null check (kind in ('active', 'away', 'tag', 'autotag')),
  label     text not null default '',            -- the tag, for tag and autotag
  start_sec int  not null check (start_sec >= 0 and start_sec < 86400),
  end_sec   int  not null check (end_sec > start_sec and end_sec <= 86400)
);

create index if not exists manictime_spans_day_idx on manictime_spans (log_date, user_id);
