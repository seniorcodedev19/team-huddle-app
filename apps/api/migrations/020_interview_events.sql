-- Interviews gain the fields the calendar's New event dialog collects:
-- which profile the event belongs to, when it ends, whether it is all day,
-- and an optional location or meeting link.
--
-- profile_id is nullable: interviews created before this, and any booked
-- against a person with no profile, simply have none.

alter table interviews add column if not exists profile_id int
  references profiles(id) on delete set null;
alter table interviews add column if not exists ends_at timestamptz;
alter table interviews add column if not exists all_day boolean not null default false;
alter table interviews add column if not exists location text not null default '';

create index if not exists interviews_profile_idx on interviews (profile_id, scheduled_at desc);

-- Existing rows had no end time; the UI assumed an hour, so make that explicit.
update interviews set ends_at = scheduled_at + interval '1 hour' where ends_at is null;
