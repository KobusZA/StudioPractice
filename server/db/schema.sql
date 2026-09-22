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

-- ---------------------------------------------------------------------------
-- Practice operations. See .cursor/skills/practice-ops/SKILL.md.
--
-- The register extends `project` rather than sitting beside it, which is what
-- §14 of CLOUD-DOCUMENTS-PLAN.md left room for: the job is already separate
-- from the drawing it owns, so a strata report with no drawing at all is the
-- same row with one fewer child. Time, certificates and write-downs hang off
-- that one unambiguous target.
-- ---------------------------------------------------------------------------

alter table project add column if not exists code                 text;
alter table project add column if not exists client_name          text;
alter table project add column if not exists client_email         text;
alter table project add column if not exists client_cell          text;
alter table project add column if not exists client_address       text;
alter table project add column if not exists property_description text;
alter table project add column if not exists type_code            text;
alter table project add column if not exists budget_estimate      numeric(14, 2);
alter table project add column if not exists lead_user_id         text references app_user (id);

alter table project add column if not exists billing_basis text
  check (billing_basis in ('fixed_fee', 'time_and_materials'));

alter table project add column if not exists status text not null default 'open'
  check (status in ('open', 'on_hold', 'halted', 'complete'));

-- Normalised in the index, not by hoping the caller trimmed. The source
-- workbook carried `P078` twice and `C036 ` beside `CO36.9`, and a duplicate
-- code is found during reporting - months later, against real money - unless
-- the write itself refuses it.
create unique index if not exists project_code_live
  on project (org_id, upper(btrim(code)))
  where deleted_at is null and code is not null;

-- The controlled list behind the register's type field. Twelve disciplines are
-- claimed; five arrived with content and four as empty sheets, so a type with
-- no tasks is a first-class state rather than an unfinished one: a placeholder
-- is selectable, and everything downstream of it still works.
create table if not exists project_type (
  id                     text primary key,
  org_id                 text not null references org (id),
  code                   text not null,
  name                   text not null,
  billing_basis_default  text not null default 'fixed_fee',
  is_placeholder         boolean not null default false,
  created_by             text not null,
  created_at             timestamptz not null default now(),
  deleted_at             timestamptz
);

create unique index if not exists project_type_code_live
  on project_type (org_id, upper(btrim(code))) where deleted_at is null;

-- 0 means "no template behind this type", which is a real and permanent state
-- for the four sheets that arrived empty, not an unfinished migration. The
-- number is bumped when a firm edits its own template, so a job instantiated
-- last year can say which version of the phase list it was built from.
alter table project_type add column if not exists template_version integer not null default 0;

-- The fee template: what this discipline charges for, in the order it happens.
--
-- Three shapes came out of the workbook and this is the one schema for all
-- three. `REZONING` and `CONSENT USE` are phases with numbered tasks and a fee
-- on the phase; `TOWNSHIP establishment` is stages with a fee on each task and
-- the stage total as their sum; `STRATAREPORT` is a single phase. The
-- degenerate cases are not special-cased - a one-phase template is a template
-- with one phase.
create table if not exists fee_template_phase (
  id                text primary key,
  project_type_id   text not null references project_type (id),
  seq               integer not null,
  name              text not null,
  -- This phase's share of the template's professional fee, as a fraction.
  -- Stored rather than recomputed so that editing one phase's fee does not
  -- silently restate what every other phase is worth.
  default_pct_split numeric(7, 4),
  default_fee       numeric(14, 2),
  created_by        text not null,
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create index if not exists fee_template_phase_type_live
  on fee_template_phase (project_type_id, seq) where deleted_at is null;

-- `rate_band_code` and `default_hours` are nullable and, for now, null on every
-- seeded row. The workbook's hour columns disagree with their own phase
-- subtotals - task 1 of CONSENT USE reads "4 hours @ R3 600" beside cells
-- holding 2 and 1 - and transcribing them would put a number nobody can source
-- behind an estimate. The columns exist because the firm will author them.
create table if not exists fee_template_task (
  id             text primary key,
  phase_id       text not null references fee_template_phase (id),
  seq            integer not null,
  description    text not null,
  rate_band_code text,
  default_hours  numeric(8, 2),
  default_fee    numeric(14, 2),
  created_by     text not null,
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create index if not exists fee_template_task_phase_live
  on fee_template_task (phase_id, seq) where deleted_at is null;

-- A job's own copy of the task list, cloned at registration.
--
-- A copy rather than a reference: the template is the firm's current thinking
-- and jobs run for years, so a job that pointed at the live template would
-- silently acquire phases nobody quoted it for. `template_task_id` is null for
-- a task somebody added by hand.
--
-- Striking a task is `status = 'not_required'`, kept and displayed. Deleting it
-- would lose the only record that somebody looked at it and decided it was not
-- needed, which is the question asked when the fee is queried.
create table if not exists project_task (
  id               text primary key,
  project_id       text not null references project (id),
  template_task_id text references fee_template_task (id),
  seq              integer not null,
  phase_label      text,
  description      text not null,
  default_fee      numeric(14, 2),
  status           text not null default 'not_started'
                   check (status in ('not_started', 'in_progress', 'done', 'not_required')),
  assignee_id      text references app_user (id),
  note             text,
  created_by       text not null,
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create index if not exists project_task_project_live
  on project_task (project_id, seq) where deleted_at is null;

-- Rates are versioned, never corrected. The workbook prices the same minute at
-- R32/min in one column and off a R1 920/hr ladder in another, and the four
-- fee-template bands disagree with both. Those are the firm's numbers; a table
-- that can hold all of them is the requirement, not a table that picks one.
create table if not exists rate_band (
  id              text primary key,
  org_id          text not null references org (id),
  code            text not null,
  label           text not null,
  hourly_rate     numeric(12, 2) not null,
  effective_from  date not null default current_date,
  created_by      text not null,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create unique index if not exists rate_band_code_live
  on rate_band (org_id, upper(btrim(code)), effective_from) where deleted_at is null;

-- Captured value, and the only place it is ever written.
--
-- `captured_amount` is set once, at insert, from the rule named in
-- `pricing_rule` and the rate in `rate_applied`. No statement in src/ updates
-- it and a test asserts that. This is the settled decision the spreadsheet got
-- wrong: there, overspend was handled by typing a smaller number over the
-- original (column K), which destroys the only evidence that the work took
-- longer than it was worth. Here the row stands and a write_down says so.
--
-- A mistyped entry is soft-deleted and re-entered. That is a different claim
-- from editing one: the deletion is dated and attributed, and the sum drops it.
create table if not exists time_entry (
  id               text primary key,
  project_id       text not null references project (id),
  user_id          text not null references app_user (id),
  entry_date       date not null,
  started_at       time,
  ended_at         time,
  minutes          integer not null check (minutes >= 0),
  activity_type    text not null,
  -- What prints on the certificate. The workbook preferred this over the
  -- activity dropdown, because "Phone call" is not a line a client will pay.
  description      text not null,
  phase_ref        text,
  prints_qty       integer not null default 0,
  travel_km        numeric(10, 2) not null default 0,
  rate_band_code   text,
  rate_applied     numeric(12, 2),
  pricing_rule     text not null,
  captured_amount  numeric(14, 2) not null,
  created_by       text not null,
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create index if not exists time_entry_project_live
  on time_entry (project_id, entry_date) where deleted_at is null;

create index if not exists time_entry_user_live
  on time_entry (user_id, entry_date) where deleted_at is null;

-- The agreed quote, broken down. Not the same thing as a certificate: a
-- certificate says what is being claimed this month, and until this table
-- existed there was no stored record of what was promised in the first place,
-- so an overrun was only ever visible as one total against another.
--
-- A schedule is revised as a whole document rather than line by line, which is
-- how a fee proposal is actually reissued, so `setFeeSchedule` soft-deletes the
-- previous set and inserts the new one. The superseded rows stay: what was
-- quoted in March is the answer to a question somebody will ask in September.
create table if not exists fee_schedule_line (
  id          text primary key,
  project_id  text not null references project (id),
  seq         integer not null,
  label       text not null,
  quoted      numeric(14, 2) not null,
  created_by  text not null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists fee_schedule_line_project_live
  on fee_schedule_line (project_id, seq) where deleted_at is null;

create table if not exists payment_certificate (
  id            text primary key,
  project_id    text not null references project (id),
  seq           integer not null,
  period_start  date,
  period_end    date,
  status        text not null default 'draft' check (status in ('draft', 'issued')),
  -- Stored per certificate rather than read from a constant at render time. A
  -- reissued document must show the rate that applied when it was issued.
  vat_rate      numeric(5, 4) not null default 0.15,
  issued_at     timestamptz,
  created_by    text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create unique index if not exists payment_certificate_seq_live
  on payment_certificate (project_id, seq) where deleted_at is null;

create table if not exists certificate_line (
  id              text primary key,
  certificate_id  text not null references payment_certificate (id),
  seq             integer not null,
  -- 'schedule' is hand-typed, 'phase' is billed off a project_task cloned from
  -- a template. Distinguishable on purpose: one of the two can be reconciled
  -- against the fee schedule and the other can only be read.
  source          text not null check (source in ('schedule', 'time', 'disbursement', 'phase')),
  description     text not null,
  phase_ref       text,
  pct             numeric(7, 4),
  units           numeric(12, 4),
  amount          numeric(14, 2) not null,
  time_entry_id   text references time_entry (id),
  project_task_id text references project_task (id),
  created_by      text not null,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index if not exists certificate_line_cert_live
  on certificate_line (certificate_id, seq) where deleted_at is null;

-- `create table if not exists` above leaves an older database with the older
-- three-value constraint, so the widened one is restated here. Dropped by name
-- and re-added rather than altered, because a check constraint cannot be
-- changed in place; both statements are idempotent, which is what lets
-- migrate.js run on every boot.
alter table certificate_line drop constraint if exists certificate_line_source_check;
alter table certificate_line add constraint certificate_line_source_check
  check (source in ('schedule', 'time', 'disbursement', 'phase'));

alter table certificate_line add column if not exists project_task_id text
  references project_task (id);

-- A phase is billed once, for the same reason an hour is: billing the same
-- task on two certificates is invisible in a total, and the converse - a task
-- marked done that nobody ever charged for - is only answerable if the link
-- is a column rather than a matched description.
--
-- Not partial on `source`, because a task can only ever be reached one way.
create unique index if not exists certificate_line_project_task_live
  on certificate_line (project_task_id)
  where deleted_at is null and project_task_id is not null;

-- An hour is billed once. Without this, re-running a date range that overlaps
-- a certificate already issued bills the overlap again, and the error is
-- invisible in a total. It also makes the converse answerable: captured time
-- carrying no line is time nobody ever charged for.
create unique index if not exists certificate_line_time_entry_live
  on certificate_line (time_entry_id)
  where deleted_at is null and time_entry_id is not null;

-- The write-down. Explicit, attributed, and attached to the certificate it
-- reduces - not a smaller number typed over an honest one.
create table if not exists write_down (
  id              text primary key,
  certificate_id  text not null references payment_certificate (id),
  phase_ref       text,
  amount          numeric(14, 2) not null check (amount > 0),
  pct             numeric(7, 4),
  -- `legacy_unspecified` is reserved for rows imported from the workbook,
  -- where the discount survived but the reason for it did not. It is a value
  -- rather than a null so the column can stay NOT NULL and so the gap is
  -- reportable: a write-down nobody can explain is exactly the thing the
  -- customer asked to be shown.
  reason_code     text not null check (reason_code in (
                    'scope_creep', 'under_quoted', 'our_error',
                    'client_relationship', 'goodwill', 'legacy_unspecified')),
  note            text,
  created_by      text not null,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index if not exists write_down_cert_live
  on write_down (certificate_id) where deleted_at is null;
