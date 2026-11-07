-- An interview now records its outcome, not just whether it happened.
--
-- 002 allowed only scheduled / done / cancelled, so there was nowhere to say
-- whether the candidate passed. The dashboard's team overview counts these,
-- so the set has to carry the result:
--
--   scheduled  booked, not yet held
--   done       held, outcome not recorded yet
--   passed     held, candidate moves on
--   failed     held, candidate does not
--   cancelled  called off, never held
--
-- 'done' stays rather than being migrated to an outcome: existing rows only
-- record that the interview took place, and guessing a result for them would
-- invent data. New ones can still be marked done and resolved later.

alter table interviews drop constraint if exists interviews_status_check;
alter table interviews add constraint interviews_status_check
  check (status in ('scheduled', 'done', 'passed', 'failed', 'cancelled'));
