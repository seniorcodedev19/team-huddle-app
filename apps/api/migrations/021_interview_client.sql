-- An interview is a meeting between one of our profiles and an outside
-- client, not a 1:1 between two staff users.
--
-- 002 modelled it as member_id + interviewer_id, both users. The profile is
-- now the subject (added in 020) and the other side is a client who has no
-- account here, so they are plain text rather than a users row.
--
-- member_id stays, nullable, for the rows created under the old meaning;
-- interviewer_id keeps recording which of us booked it.

alter table interviews add column if not exists client_name text not null default '';
alter table interviews add column if not exists client_email text not null default '';

alter table interviews alter column member_id drop not null;
