-- Contacts: people outside the team the org is in touch with.
--
-- Every field that holds information about the contact is stored ENCRYPTED
-- (AES-256-GCM, see apps/api/src/crypto.ts — the same key and format as
-- profile notes): name, job title, location, email, phone, the three URLs
-- and the note. The database only ever sees ciphertext or '' for empty, so
-- none of them can be searched, sorted or filtered in SQL — the API decrypts
-- and sorts in code. If the encryption secret is lost or changed, these
-- values cannot be recovered.
--
-- Status and assignee are not encrypted. They describe the team's work, not
-- the person, and they need to stay usable: status is checked against a fixed
-- list, and the assignee is a real link to a user, cleared if that user is
-- removed.

create table if not exists contacts (
  id            serial primary key,
  name          text not null,
  job_title     text not null default '',
  location      text not null default '',
  email         text not null default '',
  phone         text not null default '',
  linkedin_url  text not null default '',
  github_url    text not null default '',
  portfolio_url text not null default '',
  note          text not null default '',
  status        text not null default 'none',
  assignee_id   int references users(id) on delete set null,
  created_by    int references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_by    int references users(id) on delete set null,
  updated_at    timestamptz not null default now()
);

alter table contacts drop constraint if exists contacts_status_check;
alter table contacts add constraint contacts_status_check
  check (status in ('none', 'contacted', 'pending', 'approved', 'rejected'));

create index if not exists contacts_status_idx on contacts (status);
create index if not exists contacts_assignee_idx on contacts (assignee_id);
