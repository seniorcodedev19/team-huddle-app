-- Board cards need a stable, human-facing identifier.
--
-- A card is a training_accounts row: the (profile, site) pairing. Its primary
-- key is a serial, but that id is an implementation detail and is not what a
-- person types, reads out, or puts in a notification. This adds card_no, the
-- number shown as TRN-184 and used in the card's URL.
--
-- Why a separate column rather than reusing id: the two drift the moment a
-- row is deleted and re-created, and a card number that gets reused would
-- silently point an old link at a different card. card_no comes from its own
-- sequence and is never reused.

alter table training_accounts add column if not exists card_no int;

-- Backfill existing rows in id order, so the numbering is stable: re-running
-- this file assigns the same number to the same row. Rows that already have a
-- number keep it, which is what makes the statement safe to repeat.
with ordered as (
  select id, row_number() over (order by id) as n
  from training_accounts
  where card_no is null
)
update training_accounts t
set card_no = ordered.n + coalesce((select max(card_no) from training_accounts), 0)
from ordered
where ordered.id = t.id and t.card_no is null;

create sequence if not exists training_card_no_seq;

-- Start the sequence past whatever the backfill used. `false` means the next
-- nextval() returns exactly this value rather than one beyond it.
select setval(
  'training_card_no_seq',
  coalesce((select max(card_no) from training_accounts), 0) + 1,
  false
);

alter table training_accounts
  alter column card_no set default nextval('training_card_no_seq');

-- Only enforce not-null once every row has a value, so the constraint cannot
-- fail against existing data.
alter table training_accounts
  alter column card_no set not null;

-- Unique because it is an identifier, and indexed because every card lookup
-- by URL goes through it.
create unique index if not exists training_accounts_card_no_idx
  on training_accounts (card_no);

-- The card panel shows when a card was created, which the table never
-- recorded — it only kept updated_at. Existing rows get their updated_at as
-- the best available answer: it is the only timestamp they have, and it is
-- never later than the real creation time by more than the last edit.
alter table training_accounts
  add column if not exists created_at timestamptz;

update training_accounts set created_at = updated_at where created_at is null;

alter table training_accounts
  alter column created_at set default now(),
  alter column created_at set not null;
