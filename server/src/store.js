// Every read and write of a firm's data goes through here, and there is no way
// to get a query out of this file without an org id.
//
// §8 of the plan: "every query is scoped by org_id at the data-access layer
// rather than per handler, so a missing check cannot leak another firm's job."
// That is a structural claim, not a discipline one, so this module exports a
// factory that demands an org and a user up front and nothing else. A handler
// physically cannot ask for "project X" - only for "project X in my org" -
// because the only project-shaped function it can reach is a method on a store
// that already closed over the scope. Adding a table later means adding a
// method here, and the scope comes along for free.
//
// The org is resolved from `membership`, never from a column on app_user; see
// auth.js. Soft delete is the only delete: `deleted_at is null` is part of
// every predicate below, and no statement here is a DELETE.

import { sid } from "./ids.js";

/**
 * How stale the newest recovery snapshot must be before a save writes another.
 * A canvas confirms a write every ~1.5s, so snapshotting each one would record
 * mouse movements rather than history. Five minutes keeps the table small and
 * still bounds what a bad save can cost.
 */
export const REVISION_SNAPSHOT_MS = 5 * 60 * 1000;

export class ConflictError extends Error {
  constructor(current) {
    super("revision mismatch");
    this.name = "ConflictError";
    this.current = current;
  }
}

/**
 * @param queryable a pool or, for anything that writes more than one row, a
 *   client already inside a transaction. Both satisfy `.query`.
 * @param scope `{ orgId, userId }`, resolved from the session.
 */
export function openStore(queryable, { orgId, userId }) {
  if (!orgId) throw new Error("openStore requires an orgId");
  if (!userId) throw new Error("openStore requires a userId");

  const q = (text, params) => queryable.query(text, params);

  return {
    orgId,
    userId,

    // --- the library ----------------------------------------------------

    /**
     * The library list. Summary fields only: a firm with forty jobs must not
     * pull forty documents to draw a list, so `erf` is read out of the jsonb
     * server-side rather than by shipping the whole doc.
     *
     * No thumbnail. Rendering one needs the geometry, and inventing a
     * placeholder image would be exactly the plausible default this codebase
     * refuses elsewhere - the library shows a name and a date, which are facts.
     */
    async listProjects({ includeDeleted = false } = {}) {
      const { rows } = await q(
        `select p.id,
                p.name,
                p.opened_at,
                p.offline_pinned_at,
                p.updated_at,
                p.created_at,
                p.deleted_at,
                d.id        as drawing_id,
                d.pack_id,
                d.revision,
                d.doc -> 'site' ->> 'erfNumber' as erf
           from project p
           left join drawing d
                  on d.project_id = p.id
                 and d.deleted_at is null
          where p.org_id = $1
            and ($2 or p.deleted_at is null)
          order by coalesce(p.opened_at, p.updated_at) desc`,
        [orgId, includeDeleted],
      );
      return rows.map(projectSummary);
    },

    async getProject(projectId) {
      const { rows } = await q(
        `select id, name, opened_at, offline_pinned_at, updated_at, created_at, deleted_at
           from project
          where id = $1 and org_id = $2 and deleted_at is null`,
        [projectId, orgId],
      );
      return rows[0] ? projectSummary(rows[0]) : null;
    },

    /**
     * A job and the first artefact it owns, in one transaction. The drawing id
     * comes from the client because `emptyDoc()` already minted one; a
     * collision with an existing row is a rejected insert, not a re-issued id,
     * since the two documents are different work and picking a winner silently
     * would lose one of them.
     */
    async createProject({ name = null, packId = null, doc, drawingId, projectId }) {
      const project = projectId || sid("prj");
      const drawing = drawingId || sid("dwg");
      const { rows: projectRows } = await q(
        `insert into project (id, org_id, name, opened_at, created_by)
              values ($1, $2, $3, now(), $4)
           returning id, name, opened_at, offline_pinned_at, updated_at, created_at, deleted_at`,
        [project, orgId, name, userId],
      );
      const { rows: drawingRows } = await q(
        `insert into drawing (id, project_id, pack_id, doc, created_by)
              values ($1, $2, $3, $4, $5)
           returning id, project_id, pack_id, revision, doc, updated_at`,
        [drawing, project, packId, doc, userId],
      );
      await snapshot(q, drawingRows[0], userId);
      return { ...projectSummary(projectRows[0]), drawing: drawingRow(drawingRows[0]) };
    },

    /**
     * Rename sets `project.name` and `doc.name` together (§5), so the library
     * and the printed title block cannot disagree. Touching the doc bumps the
     * revision, which is why this returns the new one: the caller adopts it, or
     * its next autosave would arrive with a stale If-Match and read as a
     * conflict with itself.
     */
    async renameProject(projectId, name) {
      const clean = typeof name === "string" && name.trim() ? name.trim() : null;
      const { rows: projectRows } = await q(
        `update project
            set name = $3, updated_at = now()
          where id = $1 and org_id = $2 and deleted_at is null
        returning id, name, opened_at, offline_pinned_at, updated_at, created_at, deleted_at`,
        [projectId, orgId, clean],
      );
      if (!projectRows[0]) return null;
      const { rows: drawingRows } = await q(
        `update drawing d
            set doc = jsonb_set(d.doc, '{name}', coalesce(to_jsonb($3::text), 'null'::jsonb)),
                revision = d.revision + 1,
                updated_at = now()
          where d.project_id = $1
            and d.deleted_at is null
            and exists (select 1 from project p
                         where p.id = d.project_id and p.org_id = $2 and p.deleted_at is null)
        returning d.id, d.project_id, d.pack_id, d.revision, d.doc, d.updated_at`,
        [projectId, orgId, clean],
      );
      return {
        ...projectSummary(projectRows[0]),
        drawing: drawingRows[0] ? drawingRow(drawingRows[0]) : null,
      };
    },

    /**
     * What the old Save As was. Against a row, keeping the same id would just
     * overwrite the original, so the copy gets new ids throughout - including
     * inside the document, whose `id` is the drawing's identity.
     *
     * Revision history is not copied: the snapshots describe how the original
     * got to where it is, and attributing them to a document that did not live
     * through them would be a fabricated history.
     */
    async duplicateProject(projectId) {
      const { rows } = await q(
        `select p.name, d.pack_id, d.doc
           from project p
           join drawing d on d.project_id = p.id and d.deleted_at is null
          where p.id = $1 and p.org_id = $2 and p.deleted_at is null`,
        [projectId, orgId],
      );
      if (!rows[0]) return null;
      const source = rows[0];
      const drawingId = sid("dwg");
      const name = `${source.name || "Untitled"} (copy)`;
      const doc = { ...source.doc, id: drawingId, name };
      return this.createProject({ name, packId: source.pack_id, doc, drawingId });
    },

    /**
     * Soft delete, undoable from the library. The drawing goes with the job so
     * it stops appearing in the library's join, and both carry a timestamp
     * rather than vanishing.
     */
    async deleteProject(projectId) {
      const { rows } = await q(
        `update project
            set deleted_at = now(), updated_at = now()
          where id = $1 and org_id = $2 and deleted_at is null
        returning id`,
        [projectId, orgId],
      );
      if (!rows[0]) return null;
      await q(
        `update drawing d
            set deleted_at = now()
          where d.project_id = $1
            and d.deleted_at is null
            and exists (select 1 from project p where p.id = d.project_id and p.org_id = $2)`,
        [projectId, orgId],
      );
      return { id: rows[0].id };
    },

    async restoreProject(projectId) {
      const { rows } = await q(
        `update project
            set deleted_at = null, updated_at = now()
          where id = $1 and org_id = $2 and deleted_at is not null
        returning id, name, opened_at, offline_pinned_at, updated_at, created_at, deleted_at`,
        [projectId, orgId],
      );
      if (!rows[0]) return null;
      await q(
        `update drawing d
            set deleted_at = null
          where d.project_id = $1
            and exists (select 1 from project p where p.id = d.project_id and p.org_id = $2)`,
        [projectId, orgId],
      );
      return projectSummary(rows[0]);
    },

    /** Last opened, which is what the library orders by. */
    async touchOpened(projectId) {
      await q(
        `update project set opened_at = now()
          where id = $1 and org_id = $2 and deleted_at is null`,
        [projectId, orgId],
      );
    },

    // --- the drawing ----------------------------------------------------

    async getDrawing(drawingId) {
      const { rows } = await q(
        `select d.id, d.project_id, d.pack_id, d.revision, d.doc, d.updated_at
           from drawing d
           join project p on p.id = d.project_id
          where d.id = $1
            and d.deleted_at is null
            and p.org_id = $2
            and p.deleted_at is null`,
        [drawingId, orgId],
      );
      return rows[0] ? drawingRow(rows[0]) : null;
    },

    async getDrawingForProject(projectId) {
      const { rows } = await q(
        `select d.id, d.project_id, d.pack_id, d.revision, d.doc, d.updated_at
           from drawing d
           join project p on p.id = d.project_id
          where d.project_id = $1
            and d.deleted_at is null
            and p.org_id = $2
            and p.deleted_at is null
          order by d.created_at
          limit 1`,
        [projectId, orgId],
      );
      return rows[0] ? drawingRow(rows[0]) : null;
    },

    /**
     * Last write wins, but only against the revision the writer had. The
     * revision check is in the WHERE clause rather than a read-then-write, so
     * two tabs saving at the same moment cannot both pass it: one updates the
     * row, the other matches nothing and is told.
     *
     * Throws ConflictError with the current revision and document, because the
     * user is about to be asked to choose between them and cannot choose
     * without seeing theirs. Never merges.
     */
    async putDrawing(drawingId, { doc, packId = undefined, ifMatch }) {
      const { rows } = await q(
        `update drawing d
            set doc = $3,
                pack_id = coalesce($4, d.pack_id),
                revision = d.revision + 1,
                updated_at = now()
          where d.id = $1
            and d.deleted_at is null
            and d.revision = $2
            and exists (select 1 from project p
                         where p.id = d.project_id
                           and p.org_id = $5
                           and p.deleted_at is null)
        returning d.id, d.project_id, d.pack_id, d.revision, d.doc, d.updated_at`,
        [drawingId, String(ifMatch), doc, packId ?? null, orgId],
      );
      if (!rows[0]) {
        // Nothing matched: either the revision moved, or there is no such
        // drawing in this org. These are different answers to the client - one
        // is a choice to make, the other is a 404 - so ask which it was.
        const current = await this.getDrawing(drawingId);
        if (!current) return null;
        throw new ConflictError(current);
      }
      const row = drawingRow(rows[0]);
      // The job's name follows the document's, on every accepted save.
      //
      // `doc.name` is what the title block prints and what the chrome's name
      // field edits, so making `project.name` a copy of it means the library
      // and the printed drawing cannot disagree - which they would within one
      // keystroke if the editor only ever wrote one of them. Rename (§5) writes
      // both for the same reason; this is the same rule applied to the path
      // that runs a thousand times more often.
      await q(
        `update project
            set updated_at = now(),
                name = $3
          where id = $1 and org_id = $2`,
        [row.projectId, orgId, typeof row.doc?.name === "string" ? row.doc.name : null],
      );
      await snapshot(q, rows[0], userId);
      return row;
    },
  };
}

/**
 * A recovery snapshot, written only when the newest one is old enough. The
 * insert is ON CONFLICT DO NOTHING because two concurrent saves can both decide
 * a snapshot is due and land on adjacent revisions; losing one snapshot is
 * nothing, and a failed save because of a history row would be real.
 */
async function snapshot(q, drawing, userId) {
  const { rows } = await q(
    `select created_at from drawing_revision
      where drawing_id = $1 order by revision desc limit 1`,
    [drawing.id],
  );
  const newest = rows[0]?.created_at ? Date.parse(rows[0].created_at) : null;
  if (newest !== null && Date.now() - newest < REVISION_SNAPSHOT_MS) return;
  await q(
    `insert into drawing_revision (drawing_id, revision, doc, created_by)
          values ($1, $2, $3, $4)
     on conflict (drawing_id, revision) do nothing`,
    [drawing.id, drawing.revision, drawing.doc, userId],
  );
}

function projectSummary(row) {
  return {
    id: row.id,
    name: row.name ?? null,
    erf: row.erf ?? null,
    openedAt: row.opened_at ?? null,
    offlinePinnedAt: row.offline_pinned_at ?? null,
    updatedAt: row.updated_at ?? null,
    createdAt: row.created_at ?? null,
    deletedAt: row.deleted_at ?? null,
    drawingId: row.drawing_id ?? null,
    packId: row.pack_id ?? null,
    revision: row.revision ?? null,
  };
}

function drawingRow(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    packId: row.pack_id ?? null,
    revision: row.revision,
    doc: row.doc,
    updatedAt: row.updated_at ?? null,
  };
}
