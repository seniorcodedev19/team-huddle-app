-- Who should be told about an activity, and whether they have read it.
--
-- audit_log already records what happened, who did it and when. What it
-- cannot say is who ought to hear about it. Rather than add a column that
-- would hold a list, this is a relation: an audit_log row with no recipients
-- is a plain audit entry, exactly as today, and one with recipients is a
-- notification. "Who should see this" and "has it been read" then live in one
-- place and cannot drift apart.

create table if not exists activity_recipients (
  activity_id bigint not null references audit_log(id) on delete cascade,
  user_id     int    not null references users(id) on delete cascade,
  read_at     timestamptz,
  primary key (activity_id, user_id)
);

-- The feed query: one user's rows, unread first, newest first. The read_at
-- column is in the index so "how many unread" is answered without touching
-- the table itself.
create index if not exists activity_recipients_unread_idx
  on activity_recipients (user_id, read_at, activity_id desc);
