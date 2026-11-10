-- Comments on a board card.
--
-- A card is a training_accounts row, so a comment hangs off that row and goes
-- with it when the card is deleted. The author is kept as a reference rather
-- than a copied name, so a rename shows everywhere at once.

create table if not exists card_comments (
  id         bigserial primary key,
  account_id int not null references training_accounts(id) on delete cascade,
  author_id  int not null references users(id) on delete cascade,
  body       text not null,

  -- Who was @-mentioned, resolved when the comment was written. Stored as ids
  -- rather than re-parsed from the text later: the text holds a display name,
  -- and a later rename would silently change who the comment had notified.
  mentions   int[] not null default '{}',

  created_at timestamptz not null default now(),
  -- Reserved. Editing is not built yet, but having the column means adding it
  -- later needs no migration.
  edited_at  timestamptz
);

-- The thread is always read for one card, oldest first.
create index if not exists card_comments_account_idx
  on card_comments (account_id, created_at);
