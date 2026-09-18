-- The system of record. See ../../CLOUD-DOCUMENTS-PLAN.md §3.
--
-- Two rules hold for every table here and every table added later, and both are
-- cheap now and impossible to retrofit:
--
--   1. Nothing is hard-deleted. `deleted_at` only, so a mis-click is
--      recoverable without a version UI and a record that mattered legally
--      cannot vanish. No code path in src/ issues a DELETE FROM, and a test
--      asserts that.
--   2. Every row carries `created_by` and `created_at`. A quote or a legal
--      document without an author and a date is not a record, and authorship
--      cannot be reconstructed for rows written without it.
--
-- Ids are text, not uuid, because the client generates them: model.js's nid()
-- mints a drawing's id before it has ever been written anywhere, which is what
-- lets a document have an identity offline. The server scopes an id to the org
-- and rejects a collision rather than handing out identities itself.

create table if not exists org (
  id          text primary key,
  name        text not null,
  created_by  text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table if not exists app_user (
  id             text primary key,
  email          text not null,
  -- scrypt, formatted by auth.js. Never a reversible encoding.
  password_hash  text not null,
  -- The first user of an org is created in the same transaction as the org and
  -- is its own author. Self-reference rather than a null, so the column can
  -- stay NOT NULL everywhere and nothing has to special-case the first row.
  created_by     text not null,
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

-- Case-insensitive uniqueness, and only over live rows: a soft-deleted account
-- must not block the address from being used again.
create unique index if not exists app_user_email_live
  on app_user (lower(email)) where deleted_at is null;

-- One row per user today, and every user has exactly one. It exists now because
-- it is free now: suppliers, draughtsmen and clients will need narrower access,
-- and retrofitting a join table means finding every place that assumed
-- user.org_id. Nothing in src/ reads an org from a column on the user.
create table if not exists membership (
  id          text primary key,
  user_id     text not null references app_user (id),
  org_id      text not null references org (id),
  role        text not null,
  created_by  text not null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create unique index if not exists membership_user_org_live
  on membership (user_id, org_id) where deleted_at is null;

create table if not exists session (
  id             text primary key,
  -- The token itself is never stored. A stolen database dump must not be a
  -- drawer full of live sessions, and the server only ever needs to recognise a
  -- token the browser presents, not reproduce one.
  token_hash     text not null unique,
  user_id        text not null references app_user (id),
  expires_at     timestamptz not null,
  -- The offline lease of §6. Refreshed on every successful online use; past it,
  -- a pinned job lists but will not open. Unused until step 7 - the column is
  -- here so the session table is not migrated for it later.
  offline_until  timestamptz,
  created_by     text not null,
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create index if not exists session_user_live
  on session (user_id) where deleted_at is null;

-- The job. Client, job number, quotes, legal documents, supplier correspondence
-- and a timeline all hang off this row later; that is the whole reason it is
-- separate from the drawing it currently owns exactly one of (§14).
create table if not exists project (
  id                 text primary key,
  org_id             text not null references org (id),
  name               text,
  opened_at          timestamptz,
  offline_pinned_at  timestamptz,
  created_by         text not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create index if not exists project_org_live
  on project (org_id, updated_at desc) where deleted_at is null;

-- The drawing. `doc` is exactly normalizeDoc()'s output - the same payload the
-- file-based spec would have written to disk, now a jsonb column.
create table if not exists drawing (
  id           text primary key,
  project_id   text not null references project (id),
  pack_id      text,
  -- Bumped on every accepted write, and the value the client sends back as
  -- If-Match. A mismatch is a 409 the user resolves; never a silent merge.
  revision     bigint not null default 1,
  doc          jsonb not null,
  created_by   text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

-- One row per job for now; the schema does not forbid two.
create index if not exists drawing_project_live
  on drawing (project_id) where deleted_at is null;

-- Recovery only, and written on a coalescing schedule rather than every
-- keystroke: a canvas autosaves every 1.5s and storing each of those would be a
-- log of mouse movements, not a history worth keeping. Only the latest drawing
-- is readable through the API; these rows exist so a bad save is recoverable.
create table if not exists drawing_revision (
  drawing_id  text not null references drawing (id),
  revision    bigint not null,
  doc         jsonb not null,
  created_by  text not null,
  created_at  timestamptz not null default now(),
  primary key (drawing_id, revision)
);

-- Site notes are their own rows and deliberately not a key inside `doc` (§6):
-- two devices' notes both arrive and cannot conflict, which is the entire
-- reason note-taking is allowed offline while geometry editing is not.
-- Unserved until step 8.
create table if not exists project_note (
  id          text primary key,
  project_id  text not null references project (id),
  author_id   text not null references app_user (id),
  level       text,
  x           double precision,
  y           double precision,
  body        text not null,
  created_by  text not null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists project_note_project_live
  on project_note (project_id, created_at) where deleted_at is null;

-- `underlay` is the first `kind`, not the only one this is built for: quote
-- PDFs, signed drawings and supplier attachments are the same row with a
-- different kind. Unserved until step 6.
create table if not exists asset (
  id          text primary key,
  org_id      text not null references org (id),
  project_id  text references project (id),
  kind        text not null,
  mime        text not null,
  bytes       bytea not null,
  created_by  text not null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists asset_project_live
  on asset (project_id, kind) where deleted_at is null;
