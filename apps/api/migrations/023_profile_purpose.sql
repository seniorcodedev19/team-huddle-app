-- A profile is used for two separate things, and not every profile is used
-- for both: job hunting (bidding, interviews) and AI training accounts.
--
-- Before this, every profile appeared on the AI Training board whether or
-- not it was ever meant to hold training accounts, so the matrix carried
-- columns that would always stay empty.
--
-- Both default to true: existing profiles were implicitly used for both, and
-- defaulting to false would empty the training board on deploy.

alter table profiles add column if not exists for_job boolean not null default true;
alter table profiles add column if not exists for_ai_training boolean not null default true;

-- The training board filters on this, so index the column it scans.
create index if not exists profiles_ai_training_idx on profiles (for_ai_training);
