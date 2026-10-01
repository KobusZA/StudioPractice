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

import { DEFAULT_PROJECT_TYPES, DEFAULT_RATE_BANDS } from "./defaults.js";
import { FEE_TEMPLATES, pctSplit, templateTotal } from "./fee-templates.js";
import { certificateUnits, priceEntry, toCents } from "./pricing.js";
import { sid } from "./ids.js";
import { buildTeamReport } from "./team-report.js";
import { capabilitiesFor, gate, ROLES } from "./permissions.js";

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
 * The caller asked for something that is not a coherent record: a time entry
 * with no description, a write-down with no reason. Its own class rather than
 * a RangeError, because the route turns this into a 400 and a RangeError
 * thrown by an actual bug would then be reported to the user as their mistake.
 */
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * A project code already in use in this firm, compared the way the index
 * compares it: trimmed and case-folded. Its own class because the caller's
 * answer is a specific one - "P078 is already Bon Accord" - and a generic 500
 * would send them to look for a bug instead of at the register.
 */
export class DuplicateCodeError extends Error {
  constructor(projectCode) {
    super(`project code ${projectCode} is already in use`);
    this.name = "DuplicateCodeError";
    this.projectCode = projectCode;
  }
}

/**
 * Asked to change a certificate that has gone out. An issued certificate is a
 * statement made to a client; the correction for one is another certificate,
 * not a quiet edit to the document they are holding.
 */
export class IssuedError extends Error {
  constructor(certificateId) {
    super("that certificate has been issued");
    this.name = "IssuedError";
    this.certificateId = certificateId;
  }
}

/**
 * The caller can reach the record - it is in their org - but their role does
 * not carry the capability the write requires. Its own class, not a bare
 * ValidationError, because the fix is "ask an owner", not "correct the
 * request", and the route answers 403 rather than 400.
 */
export class PermissionError extends Error {
  constructor(message) {
    super(message);
    this.name = "PermissionError";
  }
}

/**
 * @param queryable a pool or, for anything that writes more than one row, a
 *   client already inside a transaction. Both satisfy `.query`.
 * @param scope `{ orgId, userId, role }`, resolved from the session. `role`
 *   is optional at the type level only for auth.js's own two seeding calls
 *   (creating a firm, signing in), neither of which reads a gated field;
 *   everywhere else it is the session's own `membership.role`.
 */
export function openStore(queryable, { orgId, userId, role }) {
  if (!orgId) throw new Error("openStore requires an orgId");
  if (!userId) throw new Error("openStore requires a userId");

  const q = (text, params) => queryable.query(text, params);
  const capabilities = capabilitiesFor(role);
  const requireCapability = (capability, message) => {
    if (!capabilities[capability]) throw new PermissionError(message);
  };

  return {
    orgId,
    userId,
    capabilities,

    // --- the team ---------------------------------------------------------

    /** Everyone with a live membership in this firm, owner first by join date. */
    /**
     * The firm's own particulars, printed on a certificate: trading name,
     * address, VAT and registration numbers, banking, contact. Owner-only both
     * ways - an employee never sees a certificate, so has no use for the
     * account number on it.
     *
     * Every field is nullable and nothing is seeded; `name` (the sign-up
     * label) is returned beside them so the screen can show what a blank
     * trading name falls back to.
     */
    async getOrgSettings() {
      requireCapability("canViewBilled", "only an owner can read the firm's letterhead");
      const { rows } = await q(
        `select name, ${Object.values(ORG_SETTING_COLUMNS).join(", ")}
           from org where id = $1 and deleted_at is null`,
        [orgId],
      );
      if (!rows[0]) return null;
      const settings = { orgName: rows[0].name };
      for (const [key, column] of Object.entries(ORG_SETTING_COLUMNS)) {
        settings[key] = rows[0][column] ?? null;
      }
      return settings;
    },

    /** Only the keys present move; a blank clears one. Unknown keys are refused, not ignored. */
    async updateOrgSettings(fields) {
      requireCapability("canViewBilled", "only an owner can edit the firm's letterhead");
      if (!fields || typeof fields !== "object") {
        throw new ValidationError("settings are an object of fields");
      }
      const sets = [];
      const params = [orgId];
      for (const [key, value] of Object.entries(fields)) {
        if (key === "orgName") continue;
        const column = ORG_SETTING_COLUMNS[key];
        if (!column) throw new ValidationError(`${key} is not a firm setting`);
        params.push(trimmed(value));
        sets.push(`${column} = $${params.length}`);
      }
      if (sets.length) {
        await q(`update org set ${sets.join(", ")}, updated_at = now() where id = $1`, params);
      }
      return this.getOrgSettings();
    },

    async listTeam() {
      const { rows } = await q(
        `select m.user_id, m.role, m.created_at, u.email
           from membership m
           join app_user u on u.id = m.user_id and u.deleted_at is null
          where m.org_id = $1 and m.deleted_at is null
          order by m.created_at`,
        [orgId],
      );
      return rows.map((row) => ({
        userId: row.user_id,
        email: row.email,
        role: row.role,
        createdAt: row.created_at,
      }));
    },

    /**
     * The owner's roster: everyone in the firm with their personal details and
     * when they joined. Owner-only - phone numbers and notes about a colleague
     * are not for the whole office.
     */
    async teamRoster() {
      requireCapability("canViewBilled", "only an owner can see the team roster");
      const { rows } = await q(
        `select m.user_id, m.role, m.created_at, m.full_name, m.phone, m.job_title,
                m.start_date, m.notes, u.email
           from membership m
           join app_user u on u.id = m.user_id and u.deleted_at is null
          where m.org_id = $1 and m.deleted_at is null
          order by (m.role = 'owner') desc, m.created_at`,
        [orgId],
      );
      return rows.map((row) => ({
        userId: row.user_id,
        email: row.email,
        role: row.role,
        fullName: row.full_name,
        phone: row.phone,
        jobTitle: row.job_title,
        // The date they joined the firm; defaults to when the account was added.
        startDate: row.start_date
          ? (row.start_date instanceof Date ? row.start_date.toISOString().slice(0, 10) : String(row.start_date).slice(0, 10))
          : null,
        notes: row.notes,
        createdAt: row.created_at,
        isYou: row.user_id === userId,
      }));
    },

    async updateTeamMember(memberId, patch = {}) {
      requireCapability("canViewBilled", "only an owner can edit a team member");
      const columns = { fullName: "full_name", phone: "phone", jobTitle: "job_title", notes: "notes", startDate: "start_date" };
      const sets = [];
      const params = [orgId, memberId];
      if (patch.role !== undefined) {
        if (!ROLES.includes(patch.role)) throw new ValidationError(`role must be one of: ${ROLES.join(", ")}`);
        // Nobody changes their own role, so a firm can never be left without an owner.
        if (memberId === userId) throw new ValidationError("You cannot change your own permission level");
        params.push(patch.role);
        sets.push(`role = $${params.length}`);
      }
      for (const [key, column] of Object.entries(columns)) {
        if (!(key in patch)) continue;
        let value = patch[key] === null || patch[key] === undefined ? "" : String(patch[key]).trim();
        if (key === "startDate" && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          throw new ValidationError("start date is YYYY-MM-DD");
        }
        if (value.length > 2000) throw new ValidationError(`${key} is too long`);
        params.push(value === "" ? null : value);
        sets.push(`${column} = $${params.length}`);
      }
      if (!sets.length) return false;
      const { rowCount } = await q(
        `update membership set ${sets.join(", ")}
          where org_id = $1 and user_id = $2 and deleted_at is null`,
        params,
      );
      return rowCount > 0;
    },

    /**
     * Take someone out of the firm. Their time entries stay (they are the
     * firm's record); their account is closed and their sessions end, so the
     * address can be reused. Cannot remove yourself or an owner.
     */
    async removeTeamMember(memberId) {
      requireCapability("canViewBilled", "only an owner can remove a team member");
      if (memberId === userId) throw new ValidationError("You cannot remove yourself");
      const { rows } = await q(
        `select role from membership where org_id = $1 and user_id = $2 and deleted_at is null`,
        [orgId, memberId],
      );
      if (!rows[0]) return false;
      if (rows[0].role === "owner") throw new ValidationError("An owner cannot be removed");
      await q(`update membership set deleted_at = now() where org_id = $1 and user_id = $2 and deleted_at is null`, [orgId, memberId]);
      await q(`update session set deleted_at = now() where user_id = $1 and deleted_at is null`, [memberId]);
      await q(`update app_user set deleted_at = now() where id = $1 and deleted_at is null`, [memberId]);
      return true;
    },

    // --- the library ----------------------------------------------------

    /**
     * The library list. Summary fields only: a firm with forty jobs must not
     * pull forty documents to draw a list, so `erf` is read out of the jsonb
     * server-side rather than by shipping the whole doc.
     *
     * No thumbnail. Rendering one needs the geometry, and inventing a
     * placeholder image would be exactly the plausible default this codebase
     * refuses elsewhere - the library shows a name and a date, which are facts.
     *
     * `listDrawingPreviews` below does render one, and does not break either
     * rule: it reads the geometry out of the jsonb rather than shipping the
     * document, and a job with no drawing is left out rather than given a
     * grey rectangle.
     */
    async listProjects({ includeDeleted = false } = {}) {
      const { rows } = await q(
        `select p.id,
                p.name,
                p.code,
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
        `select id, name, code, opened_at, offline_pinned_at, updated_at, created_at, deleted_at
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
           returning id, name, code, opened_at, offline_pinned_at, updated_at, created_at, deleted_at`,
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
        returning id, name, code, opened_at, offline_pinned_at, updated_at, created_at, deleted_at`,
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
        `select p.name, p.client_name, p.client_email, p.client_cell,
                p.client_address, p.property_description, p.type_code,
                p.budget_estimate, p.projected_cost, p.billing_basis, p.lead_user_id,
                d.pack_id, d.doc
           from project p
           left join drawing d on d.project_id = p.id and d.deleted_at is null
          where p.id = $1 and p.org_id = $2 and p.deleted_at is null`,
        [projectId, orgId],
      );
      if (!rows[0]) return null;
      const source = rows[0];
      const name = `${source.name || "Untitled"} (copy)`;
      if (!source.doc) {
        // A register job with no drawing. Everything copies except the project
        // code, which is the firm's identifier for this specific instruction
        // and cannot be shared by two rows - the copy arrives needing one,
        // which is a visible gap rather than an invented `P078 (copy)`.
        const created = await this.createRegisterProject({
          code: null, name,
          clientName: source.client_name, clientEmail: source.client_email,
          clientCell: source.client_cell, clientAddress: source.client_address,
          propertyDescription: source.property_description,
          typeCode: source.type_code, budgetEstimate: source.budget_estimate,
          projectedCost: source.projected_cost,
          billingBasis: source.billing_basis, leadUserId: source.lead_user_id,
        }, { allowMissingCode: true });
        return { ...(await this.getProject(created.id)), drawing: null };
      }
      const drawingId = sid("dwg");
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
        returning id, name, code, opened_at, offline_pinned_at, updated_at, created_at, deleted_at`,
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

    /**
     * A drawing for a job that did not start with one. The register can open a
     * strata report or a dispute, neither of which has geometry; the day one
     * of them does, the canvas attaches here rather than the job having had to
     * pretend it was a drawing all along.
     */
    async createDrawingForProject(projectId, { doc, packId = null, drawingId }) {
      const project = await this.getProject(projectId);
      if (!project) return null;
      const existing = await this.getDrawingForProject(projectId);
      if (existing) return existing;
      const { rows } = await q(
        `insert into drawing (id, project_id, pack_id, doc, created_by)
              values ($1, $2, $3, $4, $5)
           returning id, project_id, pack_id, revision, doc, updated_at`,
        [drawingId || sid("dwg"), projectId, packId, doc, userId],
      );
      await snapshot(q, rows[0], userId);
      return drawingRow(rows[0]);
    },

    // --- the register ---------------------------------------------------

    /**
     * The type list and the tariff bands a new firm starts with. Called in the
     * sign-up transaction, and safe to call again: every insert is
     * ON CONFLICT DO NOTHING against the live-rows unique index, so an org
     * created before these existed is fixed by running it, not by a migration
     * that has to guess what the firm has since edited.
     */
    async seedPracticeDefaults() {
      for (const type of DEFAULT_PROJECT_TYPES) {
        await q(
          `insert into project_type (id, org_id, code, name, billing_basis_default, is_placeholder, created_by)
                values ($1, $2, $3, $4, $5, $6, $7)
             on conflict do nothing`,
          [
            sid("pty"), orgId, type.code, type.name,
            type.billingBasisDefault || "fixed_fee", Boolean(type.isPlaceholder), userId,
          ],
        );
      }
      for (const band of DEFAULT_RATE_BANDS) {
        await q(
          `insert into rate_band (id, org_id, code, label, hourly_rate, created_by)
                values ($1, $2, $3, $4, $5, $6)
             on conflict do nothing`,
          [sid("rb"), orgId, band.code, band.label, band.hourlyRate, userId],
        );
      }
      await this.seedFeeTemplates();
    },

    /**
     * The five templates that arrived with content. Guarded on
     * `template_version = 0` rather than on a unique index, because a phase
     * list has no natural key to conflict on and re-running this against a
     * firm that has since edited its own templates would quietly restore the
     * seeded ones over their work.
     *
     * The four empty sheets get nothing, and that is the finished state for
     * them: a placeholder type is selectable, a job of that type registers
     * normally, and its fee schedule is entered freehand.
     */
    async seedFeeTemplates() {
      const { rows: types } = await q(
        `select id, code from project_type
          where org_id = $1 and deleted_at is null and template_version = 0`,
        [orgId],
      );
      for (const type of types) {
        const template = FEE_TEMPLATES[type.code];
        if (!template) continue;
        const total = templateTotal(template);
        for (const [phaseIndex, phase] of template.phases.entries()) {
          const phaseId = sid("ftp");
          await q(
            `insert into fee_template_phase (
               id, project_type_id, seq, name, default_pct_split, default_fee, created_by
             ) values ($1, $2, $3, $4, $5, $6, $7)`,
            [phaseId, type.id, phaseIndex + 1, phase.name, pctSplit(phase, total), phase.fee, userId],
          );
          for (const [taskIndex, task] of phase.tasks.entries()) {
            await q(
              `insert into fee_template_task (
                 id, phase_id, seq, description, default_fee, created_by
               ) values ($1, $2, $3, $4, $5, $6)`,
              [sid("ftt"), phaseId, taskIndex + 1, task.description, task.fee ?? null, userId],
            );
          }
        }
        await q(
          `update project_type set template_version = 1 where id = $1`,
          [type.id],
        );
      }
    },

    /** A type's phases and tasks, for showing what a job would be built from. */
    async getFeeTemplate(typeCode, { internal = false } = {}) {
      // Read first and gated the same way as the fees: what a type is
      // expected to cost is as much the firm's business as what it charges.
      const { rows: typeRows } = await q(
        `select default_cost_pct from project_type
          where org_id = $1 and upper(btrim(code)) = upper(btrim($2))
            and deleted_at is null`,
        [orgId, typeCode],
      );
      const costPct = gate(num(typeRows[0]?.default_cost_pct), internal || capabilities.canViewBilled);
      const { rows: phases } = await q(
        `select ftp.id, ftp.seq, ftp.name, ftp.default_pct_split, ftp.default_fee
           from fee_template_phase ftp
           join project_type pt on pt.id = ftp.project_type_id
          where pt.org_id = $1 and upper(btrim(pt.code)) = upper(btrim($2))
            and pt.deleted_at is null and ftp.deleted_at is null
          order by ftp.seq`,
        [orgId, typeCode],
      );
      if (!phases.length) return { typeCode, phases: [], quoted: 0, costPct };
      const { rows: tasks } = await q(
        `select id, phase_id, seq, description, rate_band_code, default_hours, default_fee
           from fee_template_task
          where phase_id = any($1) and deleted_at is null
          order by seq`,
        [phases.map((phase) => phase.id)],
      );
      // `internal` is for instantiateTemplate only: cloning a template onto a
      // job must copy the real fees whoever registers it. Redacting here gave
      // an employee-registered job null task fees and a R0 quote.
      const billed = internal || capabilities.canViewBilled;
      return {
        typeCode,
        costPct,
        quoted: gate(
          toCents(phases.reduce((sum, phase) => sum + (num(phase.default_fee) ?? 0), 0)),
          billed,
        ),
        phases: phases.map((phase) => ({
          id: phase.id,
          seq: Number(phase.seq),
          name: phase.name,
          defaultPctSplit: num(phase.default_pct_split),
          defaultFee: gate(num(phase.default_fee), billed),
          tasks: tasks.filter((task) => task.phase_id === phase.id).map((task) => ({
            id: task.id,
            seq: Number(task.seq),
            description: task.description,
            rateBandCode: task.rate_band_code ?? null,
            defaultHours: num(task.default_hours),
            defaultFee: gate(num(task.default_fee), billed),
          })),
        })),
      };
    },

    /**
     * The firm rewrites what a type charges for. Owner-only (it is cost-tier
     * money: it decides what every future job of this type is quoted at).
     *
     * A whole-template replace rather than row-by-row edits: the editor shows
     * the template as one document, and a phase list has no natural key to
     * patch against. The old rows are soft-deleted, not removed, because a
     * job's `project_task.template_task_id` still points at them - jobs
     * already registered are copies and are deliberately untouched.
     *
     * A phase with no fee of its own takes the sum of its task fees (the
     * TOWNSHIP shape); a phase with a fee keeps it (the REZONING shape).
     * `template_version` is bumped so a job can say which version built it.
     */
    async replaceFeeTemplate(typeCode, input) {
      requireCapability("canViewCost", "only an owner can edit a fee template");
      const { rows: types } = await q(
        `select id from project_type
          where org_id = $1 and upper(btrim(code)) = upper(btrim($2))
            and deleted_at is null`,
        [orgId, typeCode],
      );
      if (!types[0]) return null;
      const phases = normaliseTemplateInput(input);
      // Checked before any row is rewritten, so a bad share cannot leave a
      // half-replaced template behind.
      const share = "costPct" in input ? costShare(input.costPct) : undefined;
      const total = Math.round(phases.reduce((sum, phase) => sum + phase.fee, 0) * 100) / 100;

      await q(
        `update fee_template_task set deleted_at = now()
          where deleted_at is null
            and phase_id in (select id from fee_template_phase
                              where project_type_id = $1 and deleted_at is null)`,
        [types[0].id],
      );
      await q(
        `update fee_template_phase set deleted_at = now()
          where project_type_id = $1 and deleted_at is null`,
        [types[0].id],
      );
      for (const [phaseIndex, phase] of phases.entries()) {
        const phaseId = sid("ftp");
        await q(
          `insert into fee_template_phase (
             id, project_type_id, seq, name, default_pct_split, default_fee, created_by
           ) values ($1, $2, $3, $4, $5, $6, $7)`,
          [phaseId, types[0].id, phaseIndex + 1, phase.name, pctSplit(phase, total), phase.fee, userId],
        );
        for (const [taskIndex, task] of phase.tasks.entries()) {
          await q(
            `insert into fee_template_task (
               id, phase_id, seq, description, default_fee, created_by
             ) values ($1, $2, $3, $4, $5, $6)`,
            [sid("ftt"), phaseId, taskIndex + 1, task.description, task.fee, userId],
          );
        }
      }
      await q(
        `update project_type set template_version = template_version + 1 where id = $1`,
        [types[0].id],
      );
      // Only when named, like the register: a client that does not know about
      // the cost share must not clear one by saying nothing. Restoring the
      // workbook's version therefore leaves it alone too - the workbook never
      // carried one, so there is nothing to restore it to.
      if (share !== undefined) {
        await q(
          `update project_type set default_cost_pct = $2 where id = $1`,
          [types[0].id, share],
        );
      }
      return this.getFeeTemplate(typeCode);
    },

    /** Put a type back to the workbook's content, or to nothing if it had none. */
    async resetFeeTemplate(typeCode) {
      requireCapability("canViewCost", "only an owner can edit a fee template");
      const seeded = FEE_TEMPLATES[typeCode]
        ?? Object.entries(FEE_TEMPLATES).find(
          ([code]) => code.trim().toUpperCase() === String(typeCode).trim().toUpperCase(),
        )?.[1];
      return this.replaceFeeTemplate(typeCode, seeded ?? { phases: [] });
    },

    async listProjectTypes() {
      const { rows } = await q(
        `select code, name, billing_basis_default, is_placeholder
           from project_type
          where org_id = $1 and deleted_at is null
          order by is_placeholder, name`,
        [orgId],
      );
      return rows.map((row) => ({
        code: row.code,
        name: row.name,
        billingBasisDefault: row.billing_basis_default,
        isPlaceholder: row.is_placeholder,
      }));
    },

    async listRateBands() {
      const { rows } = await q(
        `select code, label, hourly_rate, effective_from
           from rate_band
          where org_id = $1 and deleted_at is null
          order by code, effective_from desc`,
        [orgId],
      );
      return rows.map((row) => ({
        code: row.code,
        label: row.label,
        // The most restricted field in every competitor this proposal
        // researched - what staff cost/earn - stays null without
        // `canViewCost`, even for a role that can otherwise see billed $.
        hourlyRate: gate(num(row.hourly_rate), capabilities.canViewCost),
        effectiveFrom: row.effective_from,
      }));
    },

    /**
     * The register. Carries each job's money with it, because a list of jobs
     * with no realisation on it is the spreadsheet's view - you have to open
     * each one to find the one that is losing money.
     */
    async listRegister({ includeDeleted = false } = {}) {
      const { rows } = await q(
        `select ${REGISTER_COLUMNS}
           from project p
           left join drawing d on d.project_id = p.id and d.deleted_at is null
           ${FINANCIAL_LATERALS}
           ${PHASE_LATERAL}
           ${LAST_CERTIFICATE_LATERAL}
          where p.org_id = $1
            and ($2 or p.deleted_at is null)
          order by coalesce(p.opened_at, p.updated_at) desc`,
        [orgId, includeDeleted],
      );
      return rows.map((row) => registerRow(row, capabilities));
    },

    async getRegisterProject(projectId) {
      const { rows } = await q(
        `select ${REGISTER_COLUMNS}
           from project p
           left join drawing d on d.project_id = p.id and d.deleted_at is null
           ${FINANCIAL_LATERALS}
           ${PHASE_LATERAL}
           ${LAST_CERTIFICATE_LATERAL}
          where p.id = $2 and p.org_id = $1 and p.deleted_at is null`,
        [orgId, projectId],
      );
      return rows[0] ? registerRow(rows[0], capabilities) : null;
    },

    /**
     * Enough of every drawing to sketch it, and nothing else.
     *
     * `listProjects` refuses to carry a thumbnail, and both of its reasons
     * still hold: a firm with forty jobs must not pull forty documents to
     * draw a list, and a placeholder image would be a picture of a job
     * nobody drew. What has changed is that the geometry can be had without
     * the document. Rooms, walls, slabs and roofs are read out of the jsonb
     * here; openings, items, beams, stairs, groups, sheets and levels stay
     * in the database, where a picture forty pixels across has no use for
     * them. A job with no drawing is absent from this list rather than
     * present and blank.
     */
    async listDrawingPreviews() {
      const { rows } = await q(
        `select d.project_id,
                d.id        as drawing_id,
                d.revision,
                d.updated_at,
                d.doc -> 'rooms'    as rooms,
                d.doc -> 'segments' as segments,
                d.doc -> 'slabs'    as slabs,
                d.doc -> 'roofs'    as roofs
           from drawing d
           join project p on p.id = d.project_id
          where p.org_id = $1
            and p.deleted_at is null
            and d.deleted_at is null
          order by d.updated_at desc`,
        [orgId],
      );
      return rows.map(drawingPreviewRow);
    },

    /**
     * A job with no drawing. `code` is the firm's own identifier and is
     * checked against the index rather than trusted: the source workbook had
     * `P078` twice and `C036 ` beside `CO36.9`, and the cost of finding that
     * out during billing is what this refusal buys.
     */
    async createRegisterProject(fields, { allowMissingCode = false } = {}) {
      const clean = registerFields(fields);
      if (!clean.code && !allowMissingCode) throw new ValidationError("a project code is required");
      const projectId = fields.projectId || sid("prj");
      try {
        const { rows } = await q(
          `insert into project (
             id, org_id, name, opened_at, created_by,
             code, client_name, client_email, client_cell, client_address,
             property_description, type_code, budget_estimate, billing_basis,
             lead_user_id, status, fee_ceiling, projected_cost
           ) values ($1, $2, $3, coalesce($4, now()), $5,
                     $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        returning id`,
          [
            projectId, orgId, clean.name, clean.openedAt, userId,
            clean.code, clean.clientName, clean.clientEmail, clean.clientCell,
            clean.clientAddress, clean.propertyDescription, clean.typeCode,
            clean.budgetEstimate, clean.billingBasis, clean.leadUserId,
            clean.status || "open", clean.feeCeiling, clean.projectedCost,
          ],
        );
        // The task list and the fee schedule are cloned from the same template
        // in the same transaction, so the two cannot disagree on day one -
        // which is exactly what happened in the workbook, where the register
        // recorded R120 000 against a template totalling R54 445.80.
        if (clean.typeCode) await this.instantiateTemplate(rows[0].id, clean.typeCode);
        return this.getRegisterProject(rows[0].id);
      } catch (error) {
        if (error.code === "23505") throw new DuplicateCodeError(clean.code);
        throw error;
      }
    },

    /**
     * Only the keys present in `fields` move. A register form that posts back
     * every column would otherwise blank whatever it did not render.
     */
    async updateRegisterProject(projectId, fields) {
      const clean = registerFields(fields, { partial: true });
      const columns = {
        name: clean.name, code: clean.code, client_name: clean.clientName,
        client_email: clean.clientEmail, client_cell: clean.clientCell,
        client_address: clean.clientAddress,
        property_description: clean.propertyDescription,
        type_code: clean.typeCode, budget_estimate: clean.budgetEstimate,
        billing_basis: clean.billingBasis, lead_user_id: clean.leadUserId,
        status: clean.status, opened_at: clean.openedAt,
        fee_ceiling: clean.feeCeiling, projected_cost: clean.projectedCost,
      };
      const sets = [];
      const params = [projectId, orgId];
      for (const [column, value] of Object.entries(columns)) {
        if (value === undefined) continue;
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      }
      if (!sets.length) return this.getRegisterProject(projectId);
      try {
        const { rows } = await q(
          `update project set ${sets.join(", ")}, updated_at = now()
            where id = $1 and org_id = $2 and deleted_at is null
        returning id`,
          params,
        );
        if (!rows[0]) return null;
        return this.getRegisterProject(projectId);
      } catch (error) {
        if (error.code === "23505") throw new DuplicateCodeError(clean.code);
        throw error;
      }
    },

    // --- a job's task list --------------------------------------------------

    /**
     * Clone a type's template onto a job: every task becomes a `project_task`,
     * and every phase becomes a `fee_schedule_line`. One step, because a task
     * list and a fee schedule built from the same template at different times
     * is two chances to get a different answer.
     *
     * A placeholder type has no phases and this does nothing, which is the
     * settled decision rather than a gap: the job registers, the task list is
     * empty, and the fee schedule is entered by hand.
     *
     * Refuses to run twice. Re-instantiating would duplicate the task list and
     * silently double the quoted fee.
     */
    async instantiateTemplate(projectId, typeCode) {
      const template = await this.getFeeTemplate(typeCode, { internal: true });
      if (!template.phases.length) return { tasks: 0, scheduleLines: 0 };
      const { rows: existing } = await q(
        `select 1 from project_task where project_id = $1 and deleted_at is null limit 1`,
        [projectId],
      );
      if (existing[0]) return { tasks: 0, scheduleLines: 0 };

      let seq = 0;
      for (const phase of template.phases) {
        for (const task of phase.tasks) {
          seq += 1;
          await q(
            `insert into project_task (
               id, project_id, template_task_id, seq, phase_label, description,
               default_fee, created_by
             ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              sid("ptk"), projectId, task.id, seq, phase.name,
              task.description, task.defaultFee, userId,
            ],
          );
        }
      }
      await this.setFeeSchedule(projectId, template.phases.map((phase) => ({
        label: phase.name,
        quoted: phase.defaultFee ?? 0,
      })));
      // Remember what the template charged, and start the job's projected cost
      // from the type's usual cost share. `coalesce` so a cost somebody typed
      // while registering the job is never overwritten by a default, and a type
      // with no share leaves it null rather than inventing one.
      const templateQuote = toCents(
        template.phases.reduce((sum, phase) => sum + (phase.defaultFee ?? 0), 0),
      );
      const defaultCost = template.costPct === null || template.costPct === undefined
        ? null : toCents(templateQuote * template.costPct);
      await q(
        `update project
            set template_quote = $2,
                projected_cost = coalesce(projected_cost, $3)
          where id = $1`,
        [projectId, templateQuote, defaultCost],
      );
      return { tasks: seq, scheduleLines: template.phases.length };
    },

    async listProjectTasks(projectId) {
      const { rows } = await q(
        `select pt.id, pt.template_task_id, pt.seq, pt.phase_label, pt.description,
                pt.default_fee, pt.status, pt.assignee_id, pt.note,
                u.email as assignee_email,
                cl.id as certificate_line_id, cl.certificate_id, pc.status as certificate_status
           from project_task pt
           join project p on p.id = pt.project_id
           left join app_user u on u.id = pt.assignee_id
           left join lateral (
             select cl.id, cl.certificate_id
               from certificate_line cl
               join payment_certificate pc2 on pc2.id = cl.certificate_id and pc2.deleted_at is null
              where cl.project_task_id = pt.id and cl.deleted_at is null
              order by cl.created_at limit 1
           ) cl on true
           left join payment_certificate pc on pc.id = cl.certificate_id
          where pt.project_id = $2 and pt.deleted_at is null
            and p.org_id = $1 and p.deleted_at is null
          order by pt.seq`,
        [orgId, projectId],
      );
      return rows.map((row) => ({
        id: row.id,
        templateTaskId: row.template_task_id ?? null,
        seq: Number(row.seq),
        phaseLabel: row.phase_label ?? null,
        description: row.description,
        // A task fee is a slice of the quote: addScheduleLinesFromTasks turns
        // it into a certificate line, so it is billed-tier money wearing the
        // clothes of a to-do list.
        defaultFee: gate(num(row.default_fee), capabilities.canViewBilled),
        status: row.status,
        assigneeId: row.assignee_id ?? null,
        assigneeEmail: row.assignee_email ?? null,
        note: row.note ?? null,
        certificateId: row.certificate_id ?? null,
        certificateStatus: row.certificate_status ?? null,
      }));
    },

    /** A task somebody added that the template did not know about. */
    async addProjectTask(projectId, { description, phaseLabel = null, defaultFee = null }) {
      const project = await this.getProject(projectId);
      if (!project) return null;
      const text = trimmed(description);
      if (!text) throw new ValidationError("a task needs a description");
      // Adding the task is operational work; pricing it is not. Refused rather
      // than quietly dropped, because a fee typed and silently discarded is
      // worse than one rejected - it reads as accepted on the way out.
      if (defaultFee !== null && defaultFee !== "") {
        requireCapability("canViewBilled", "only an owner can put a fee on a task");
      }
      await q(
        `insert into project_task (
           id, project_id, seq, phase_label, description, default_fee, created_by
         ) select $1, $2, coalesce(max(seq), 0) + 1, $3, $4, $5, $6
             from project_task where project_id = $2 and deleted_at is null`,
        [
          sid("ptk"), projectId, trimmed(phaseLabel) ?? null, text,
          defaultFee === null || defaultFee === "" ? null : toCents(Number(defaultFee)), userId,
        ],
      );
      return this.listProjectTasks(projectId);
    },

    /**
     * Status, assignee and note. Striking a task is `status = 'not_required'`,
     * which is why there is no deleteProjectTask: a struck task stays on the
     * list as the record of a decision, and "we looked at this and it was not
     * needed" is the answer when the fee is queried.
     */
    async updateProjectTask(taskId, fields) {
      const columns = {
        status: "status" in fields ? trimmed(fields.status) : undefined,
        assignee_id: "assigneeId" in fields ? trimmed(fields.assigneeId) : undefined,
        note: "note" in fields ? trimmed(fields.note) : undefined,
      };
      if (columns.status !== undefined && !TASK_STATUSES.includes(columns.status)) {
        throw new ValidationError(`a task status is one of ${TASK_STATUSES.join(", ")}`);
      }
      const sets = [];
      const params = [taskId, orgId];
      for (const [column, value] of Object.entries(columns)) {
        if (value === undefined) continue;
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      }
      if (!sets.length) return null;
      const { rows } = await q(
        `update project_task pt set ${sets.join(", ")}
          where pt.id = $1 and pt.deleted_at is null
            and exists (select 1 from project p
                         where p.id = pt.project_id and p.org_id = $2
                           and p.deleted_at is null)
        returning pt.project_id`,
        params,
      );
      if (!rows[0]) return null;
      return this.listProjectTasks(rows[0].project_id);
    },

    // --- the fee schedule ---------------------------------------------------

    /**
     * The quote, phase by phase, against what has actually been claimed under
     * each one. Certificate lines are matched to a schedule line by `phase_ref`
     * against `label`, trimmed and case-folded, because the two are typed on
     * different days by different people.
     *
     * `unallocated` is the rest: certified money carrying a phase nobody
     * quoted, or none at all. That is the figure that makes the per-phase
     * variance trustworthy - without it, a schedule can add up to less than the
     * certificate total and read as if the job were under quote.
     */
    async listFeeSchedule(projectId) {
      const { rows } = await q(
        `select fsl.id, fsl.seq, fsl.label, fsl.quoted,
                coalesce(claimed.certified, 0)        as certified,
                coalesce(claimed.draft, 0)            as draft,
                coalesce(down.written_down, 0)        as written_down,
                coalesce(time_phase.uncertified, 0)   as uncertified_captured,
                coalesce(time_phase.captured, 0)      as captured
           from fee_schedule_line fsl
           join project p on p.id = fsl.project_id
           left join lateral (
             select coalesce(sum(cl.amount) filter (where pc.status = 'issued'), 0) as certified,
                    coalesce(sum(cl.amount) filter (where pc.status = 'draft'), 0)  as draft
               from certificate_line cl
               join payment_certificate pc
                 on pc.id = cl.certificate_id and pc.deleted_at is null
              where pc.project_id = fsl.project_id
                and cl.deleted_at is null
                and upper(btrim(cl.phase_ref)) = upper(btrim(fsl.label))
           ) claimed on true
           -- Matched on the phase the same trimmed, case-folded way, because a
           -- write-down carries the phase it reduced and a phase bar that
           -- ignored it would show money as still claimable that is gone.
           left join lateral (
             select coalesce(sum(wd.amount) filter (where pc.status = 'issued'), 0) as written_down
               from write_down wd
               join payment_certificate pc
                 on pc.id = wd.certificate_id and pc.deleted_at is null
              where pc.project_id = fsl.project_id
                and wd.deleted_at is null
                and upper(btrim(wd.phase_ref)) = upper(btrim(fsl.label))
           ) down on true
           left join lateral (
             select coalesce(sum(te.captured_amount), 0) as captured,
                    coalesce(sum(te.captured_amount) filter (
                      where not exists (select 1 from certificate_line cl
                                         where cl.time_entry_id = te.id
                                           and cl.deleted_at is null)
                    ), 0)                                as uncertified
               from time_entry te
              where te.project_id = fsl.project_id
                and te.deleted_at is null
                and upper(btrim(te.phase_ref)) = upper(btrim(fsl.label))
           ) time_phase on true
          where fsl.project_id = $2 and fsl.deleted_at is null
            and p.org_id = $1 and p.deleted_at is null
          order by fsl.seq`,
        [orgId, projectId],
      );
      const { rows: loose } = await q(
        `select coalesce(sum(cl.amount) filter (where pc.status = 'issued'), 0) as certified,
                coalesce(sum(cl.amount) filter (where pc.status = 'draft'), 0)  as draft
           from certificate_line cl
           join payment_certificate pc
             on pc.id = cl.certificate_id and pc.deleted_at is null
           join project p on p.id = pc.project_id
          where pc.project_id = $2 and cl.deleted_at is null
            and p.org_id = $1 and p.deleted_at is null
            and not exists (
              select 1 from fee_schedule_line fsl
               where fsl.project_id = pc.project_id and fsl.deleted_at is null
                 and upper(btrim(fsl.label)) = upper(btrim(cl.phase_ref))
            )`,
        [orgId, projectId],
      );
      const billed = capabilities.canViewBilled;
      // Totals are summed from the real (ungated) numbers first, then the
      // whole result is gated - summing already-nulled lines would silently
      // turn "hidden" into "zero", which is exactly the invented-number this
      // codebase's own "unknown is null, never 0" rule (SKILL.md decision 6)
      // exists to prevent.
      const lines = rows.map((row) => {
        const quoted = num(row.quoted) ?? 0;
        const certified = num(row.certified) ?? 0;
        const writtenDown = num(row.written_down) ?? 0;
        return {
          id: row.id,
          seq: Number(row.seq),
          label: row.label,
          quoted: gate(quoted, billed),
          certified: gate(certified, billed),
          draft: gate(num(row.draft) ?? 0, billed),
          // The same ladder as the job's own financials, one phase wide, so a
          // phase can be drawn as a miniature of the same bar instead of a
          // second chart with its own arithmetic. A job can sit comfortably
          // inside its fee overall and have spent one phase twice over.
          writtenDown: gate(writtenDown, billed),
          billed: gate(toCents(certified - writtenDown), billed),
          captured: gate(num(row.captured) ?? 0, billed),
          uncertifiedCaptured: gate(num(row.uncertified_captured) ?? 0, billed),
          // Positive is money still to claim, negative is an overrun on this
          // phase. Signed rather than absolute, because which way it points is
          // the entire content of the number.
          variance: gate(toCents(quoted - certified), billed),
        };
      });
      const quotedTotal = toCents(rows.reduce((total, row) => total + (num(row.quoted) ?? 0), 0));
      const certifiedTotal = toCents(
        rows.reduce((total, row) => total + (num(row.certified) ?? 0), 0),
      );
      return {
        lines,
        quoted: gate(quotedTotal, billed),
        certified: gate(certifiedTotal, billed),
        unallocated: {
          certified: gate(num(loose[0]?.certified) ?? 0, billed),
          draft: gate(num(loose[0]?.draft) ?? 0, billed),
        },
      };
    },

    /**
     * Replace-all, under one call. A fee schedule is revised the way a proposal
     * is reissued - the whole document, renumbered - rather than by editing one
     * line at a time, and a per-line PATCH would invite a half-applied revision
     * where the phases no longer sum to the fee that was agreed.
     *
     * The superseded rows are soft-deleted, not overwritten: what the client
     * was quoted in March is a question somebody asks in September.
     */
    async setFeeSchedule(projectId, lines) {
      const project = await this.getProject(projectId);
      if (!project) return null;
      if (!Array.isArray(lines)) throw new ValidationError("a fee schedule is a list of lines");
      const clean = lines.map((line, index) => {
        const label = trimmed(line.label);
        if (!label) throw new ValidationError(`line ${index + 1} needs a label`);
        const quoted = Number(line.quoted);
        if (!Number.isFinite(quoted)) {
          throw new ValidationError(`line ${index + 1} needs a quoted amount`);
        }
        return { label, quoted: toCents(quoted) };
      });
      await q(
        `update fee_schedule_line set deleted_at = now()
          where project_id = $1 and deleted_at is null`,
        [projectId],
      );
      for (const [index, line] of clean.entries()) {
        await q(
          `insert into fee_schedule_line (id, project_id, seq, label, quoted, created_by)
                values ($1, $2, $3, $4, $5, $6)`,
          [sid("fsl"), projectId, index + 1, line.label, line.quoted, userId],
        );
      }
      return this.listFeeSchedule(projectId);
    },

    // --- where the job has got to -----------------------------------------

    /**
     * The job's own sequence of phases, with the evidence for each one.
     *
     * Two sources, because a job can have either without the other: the fee
     * schedule is what was quoted phase by phase, and the task list is what
     * was to be done in each. For a templated job they are the same names
     * cloned in the same transaction. A phase that exists only on the task
     * list sorts after the quoted ones rather than being dropped - it is
     * still work somebody has to do, it just carries no fee of its own.
     *
     * `position` is relative to the phase the job is actually in, and it is
     * null for every phase when nobody has said. "Behind us" is derived from
     * a stated fact; it is not derived from the tasks being ticked.
     */
    async listProjectPhases(projectId) {
      const project = await this.getProject(projectId);
      if (!project) return null;
      const { rows } = await q(
        `with quoted as (
           select upper(btrim(fsl.label)) as key,
                  min(fsl.label)          as ref,
                  min(fsl.seq)            as seq,
                  sum(fsl.quoted)         as quoted
             from fee_schedule_line fsl
             join project p on p.id = fsl.project_id
                           and p.org_id = $1 and p.deleted_at is null
            where fsl.project_id = $2 and fsl.deleted_at is null
            group by upper(btrim(fsl.label))
         ),
         -- Task-only phases are offset past every quoted one rather than
         -- interleaved: their task seq and the schedule's line seq are two
         -- different numberings and mixing them would invent an order.
         extra as (
           select upper(btrim(pt.phase_label))  as key,
                  min(pt.phase_label)           as ref,
                  1000000 + min(pt.seq)         as seq,
                  null::numeric                 as quoted
             from project_task pt
            where pt.project_id = $2 and pt.deleted_at is null
              and pt.phase_label is not null and btrim(pt.phase_label) <> ''
              and not exists (select 1 from quoted where quoted.key = upper(btrim(pt.phase_label)))
            group by upper(btrim(pt.phase_label))
         ),
         phases as (select * from quoted union all select * from extra)
         select ph.ref, ph.seq, ph.quoted,
                coalesce(t.total, 0)     as tasks_total,
                coalesce(t.done, 0)      as tasks_done,
                coalesce(t.struck, 0)    as tasks_struck,
                coalesce(c.certified, 0) as certified,
                coalesce(c.draft, 0)     as draft,
                coalesce(te.captured, 0) as captured
           from phases ph
           left join lateral (
             select count(*)                                                 as total,
                    count(*) filter (where pt.status = 'done')               as done,
                    count(*) filter (where pt.status = 'not_required')       as struck
               from project_task pt
              where pt.project_id = $2 and pt.deleted_at is null
                and upper(btrim(pt.phase_label)) = ph.key
           ) t on true
           left join lateral (
             select coalesce(sum(cl.amount) filter (where pc.status = 'issued'), 0) as certified,
                    coalesce(sum(cl.amount) filter (where pc.status = 'draft'), 0)  as draft
               from certificate_line cl
               join payment_certificate pc
                 on pc.id = cl.certificate_id and pc.deleted_at is null
              where pc.project_id = $2 and cl.deleted_at is null
                and upper(btrim(cl.phase_ref)) = ph.key
           ) c on true
           left join lateral (
             -- Partial on purpose. A time entry's phase is optional, so this
             -- is "time somebody tagged to this phase", never "time this
             -- phase cost". The caller is told how much was left untagged.
             select coalesce(sum(e.captured_amount), 0) as captured
               from time_entry e
              where e.project_id = $2 and e.deleted_at is null
                and upper(btrim(e.phase_ref)) = ph.key
           ) te on true
          order by ph.seq`,
        [orgId, projectId],
      );

      const { rows: events } = await q(
        `select ppe.phase_ref, ppe.entered_at, ppe.note
           from project_phase_event ppe
           join project p on p.id = ppe.project_id
          where ppe.project_id = $2 and p.org_id = $1 and p.deleted_at is null
          order by ppe.entered_at desc, ppe.created_at desc`,
        [orgId, projectId],
      );
      const current = events[0] ?? null;
      const currentKey = current ? current.phase_ref.trim().toUpperCase() : null;
      const currentIndex = currentKey === null
        ? -1
        : rows.findIndex((row) => row.ref.trim().toUpperCase() === currentKey);

      const { rows: untagged } = await q(
        `select coalesce(sum(e.captured_amount), 0) as captured
           from time_entry e
           join project p on p.id = e.project_id
                         and p.org_id = $1 and p.deleted_at is null
          where e.project_id = $2 and e.deleted_at is null
            and (e.phase_ref is null or btrim(e.phase_ref) = '')`,
        [orgId, projectId],
      );

      return {
        // The phase somebody said we are in, even if it is not on the list -
        // a freehand phase is still an answer, and silently dropping it would
        // be worse than showing it as unlisted.
        current: current?.phase_ref ?? null,
        currentSince: current?.entered_at ?? null,
        currentNote: current?.note ?? null,
        currentListed: currentIndex >= 0,
        history: events.map((event) => ({
          phaseRef: event.phase_ref,
          enteredAt: event.entered_at,
          note: event.note ?? null,
        })),
        capturedUntagged: gate(num(untagged[0]?.captured) ?? 0, capabilities.canViewBilled),
        phases: rows.map((row, index) => {
          const quoted = num(row.quoted);
          const certified = num(row.certified) ?? 0;
          const billed = capabilities.canViewBilled;
          return {
            ref: row.ref,
            seq: index + 1,
            quoted: gate(quoted, billed),
            certified: gate(certified, billed),
            draft: gate(num(row.draft) ?? 0, billed),
            variance: gate(quoted === null ? null : toCents(quoted - certified), billed),
            captured: gate(num(row.captured) ?? 0, billed),
            // Operational, not money: how many tasks exist/are done/are
            // struck, and where the job sits relative to its current phase -
            // "phase progress" in the proposal's `can_view_hours` tier, kept
            // visible regardless of `can_view_billed`.
            tasksTotal: Number(row.tasks_total),
            tasksDone: Number(row.tasks_done),
            tasksStruck: Number(row.tasks_struck),
            position: currentIndex < 0 ? null
              : index < currentIndex ? "behind"
                : index === currentIndex ? "current" : "ahead",
          };
        }),
      };
    },

    /**
     * Advancing, or correcting. Append-only: moving back to an earlier phase
     * is a new event and not a deletion, because "we went back to public
     * participation in August" is the fact a fee query turns on.
     */
    async setProjectPhase(projectId, { phaseRef, note = null } = {}) {
      const project = await this.getProject(projectId);
      if (!project) return null;
      const ref = trimmed(phaseRef);
      if (!ref) throw new ValidationError("a phase is required");
      await q(
        `insert into project_phase_event (id, project_id, phase_ref, note, created_by)
              values ($1, $2, $3, $4, $5)`,
        [sid("ppe"), projectId, ref, trimmed(note), userId],
      );
      return this.listProjectPhases(projectId);
    },

    // --- the timesheet ----------------------------------------------------

    /**
     * One log for the practice, filtered - not a hidden sheet per person. The
     * workbook kept seven, most of them `veryHidden`, which is why nobody
     * could answer "what did this job cost" without opening all of them.
     *
     * Filtered by person, but not by whichever person the caller names: without
     * the billed capability the only readable log is your own. The money is
     * already nulled on a colleague's rows, so what leaks otherwise is who
     * spent how long on what - which is the substance of a timesheet, not
     * metadata about one.
     */
    async listTimeEntries({ projectId = null, personId = null, from = null, to = null } = {}) {
      const person = capabilities.canViewBilled ? personId : userId;
      const { rows } = await q(
        `select te.id, te.project_id, te.user_id, u.email as user_email,
                p.code as project_code, p.name as project_name,
                te.entry_date, te.started_at, te.ended_at, te.minutes,
                te.activity_type, te.description, te.phase_ref,
                te.prints_qty, te.travel_km, te.rate_band_code, te.rate_applied,
                te.pricing_rule, te.captured_amount, te.created_at,
                cl.id as certificate_line_id, cl.certificate_id
           from time_entry te
           join project p on p.id = te.project_id
           join app_user u on u.id = te.user_id
           left join certificate_line cl
                  on cl.time_entry_id = te.id and cl.deleted_at is null
          where p.org_id = $1
            and p.deleted_at is null
            and te.deleted_at is null
            and ($2::text is null or te.project_id = $2)
            and ($3::text is null or te.user_id = $3)
            and ($4::date is null or te.entry_date >= $4)
            and ($5::date is null or te.entry_date <= $5)
          order by te.entry_date desc, te.started_at desc nulls last, te.created_at desc`,
        [orgId, projectId, person, from, to],
      );
      return rows.map((row) => timeEntryRow(row, capabilities));
    },

    /**
     * What every person did over a period, and what it was worth. Owner-only:
     * it is a ranking of colleagues by money, which is exactly what the
     * billed gate exists to keep away from an employee.
     */
    async teamReport({ from, to, today }) {
      requireCapability("canViewBilled", "only an owner can see the team report");
      const { rows } = await q(
        `select te.id, te.project_id, te.user_id, u.email as user_email,
                p.code as project_code, p.name as project_name,
                te.entry_date, te.minutes, te.activity_type, te.description,
                te.captured_amount, te.created_at,
                exists (select 1 from certificate_line cl
                          join payment_certificate pc on pc.id = cl.certificate_id
                                                     and pc.deleted_at is null
                         where cl.time_entry_id = te.id and cl.deleted_at is null) as on_certificate,
                exists (select 1 from certificate_line cl
                          join payment_certificate pc on pc.id = cl.certificate_id
                                                     and pc.deleted_at is null
                                                     and pc.status = 'issued'
                         where cl.time_entry_id = te.id and cl.deleted_at is null) as billed_on_issued
           from time_entry te
           join project p on p.id = te.project_id
           join app_user u on u.id = te.user_id
          where p.org_id = $1
            and p.deleted_at is null
            and te.deleted_at is null
            and te.entry_date >= $2::date
            and te.entry_date <= $3::date`,
        [orgId, from, to],
      );
      return buildTeamReport({
        members: await this.listTeam(),
        entries: rows.map((row) => ({
          projectId: row.project_id,
          projectCode: row.project_code ?? null,
          projectName: row.project_name ?? null,
          userId: row.user_id,
          userEmail: row.user_email,
          date: row.entry_date,
          minutes: Number(row.minutes),
          activityType: row.activity_type,
          description: row.description,
          capturedAmount: num(row.captured_amount) ?? 0,
          createdDate: row.created_at ? String(row.created_at).slice(0, 10) : null,
          onCertificate: row.on_certificate,
          billedOnIssued: row.billed_on_issued,
        })),
        from, to, today,
      });
    },

    /**
     * Captured value, written once.
     *
     * The amount is computed here from the rule named on the way in and then
     * never touched again - there is no method on this store that updates it,
     * and a test asserts no statement in src/ does either. Overspend that
     * cannot be billed is a write_down against a certificate, which leaves
     * both numbers standing and answers "how much did this really cost".
     */
    async createTimeEntry(fields) {
      const projectId = String(fields.projectId || "");
      const project = await this.getProject(projectId);
      if (!project) return null;

      const minutes = Number(fields.minutes);
      if (!Number.isInteger(minutes) || minutes < 0) {
        throw new ValidationError("minutes must be a whole number >= 0");
      }
      const rule = fields.pricingRule || "tier_1920";
      let hourlyRate = fields.hourlyRate ?? null;
      const bandCode = trimmed(fields.rateBandCode) ?? null;
      if (rule === "band_hourly" && hourlyRate === null && bandCode) {
        const { rows } = await q(
          `select hourly_rate from rate_band
            where org_id = $1 and upper(btrim(code)) = upper(btrim($2))
              and deleted_at is null
            order by effective_from desc limit 1`,
          [orgId, bandCode],
        );
        if (!rows[0]) throw new ValidationError(`no rate band ${bandCode}`);
        hourlyRate = num(rows[0].hourly_rate);
      }
      const { capturedAmount, rateApplied } = priceEntry({ minutes, rule, hourlyRate });

      // Logging on somebody else's behalf is an owner's job - she reads a
      // handwritten day off a desk and types it in. Left ungated, `fields.userId`
      // let anyone attribute an hour to anyone, in any firm, which would put a
      // row that cannot be edited under a name that never agreed to it.
      const author = trimmed(fields.userId) ?? userId;
      if (author !== userId) {
        requireCapability("canViewBilled", "only an owner can log time for somebody else");
        const { rows: member } = await q(
          `select 1 from membership
            where user_id = $1 and org_id = $2 and deleted_at is null`,
          [author, orgId],
        );
        if (!member[0]) throw new ValidationError("no such person in this firm");
      }

      const description = trimmed(fields.description);
      const activityType = trimmed(fields.activityType);
      if (!description) throw new ValidationError("a description is required");
      if (!activityType) throw new ValidationError("an activity type is required");
      if (!fields.date) throw new ValidationError("a date is required");

      const { rows } = await q(
        `insert into time_entry (
           id, project_id, user_id, entry_date, started_at, ended_at, minutes,
           activity_type, description, phase_ref, prints_qty, travel_km,
           rate_band_code, rate_applied, pricing_rule, captured_amount, created_by
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      returning id`,
        [
          sid("te"), projectId, author, fields.date,
          trimmed(fields.start) ?? null, trimmed(fields.end) ?? null, minutes,
          activityType, description, trimmed(fields.phaseRef) ?? null,
          Number(fields.printsQty) || 0, Number(fields.travelKm) || 0,
          bandCode, rateApplied, rule, capturedAmount, userId,
        ],
      );
      return this.getTimeEntry(rows[0].id);
    },

    async getTimeEntry(entryId) {
      const { rows } = await q(
        `select te.id, te.project_id, te.user_id, u.email as user_email,
                p.code as project_code, p.name as project_name,
                te.entry_date, te.started_at, te.ended_at, te.minutes,
                te.activity_type, te.description, te.phase_ref,
                te.prints_qty, te.travel_km, te.rate_band_code, te.rate_applied,
                te.pricing_rule, te.captured_amount, te.created_at,
                cl.id as certificate_line_id, cl.certificate_id
           from time_entry te
           join project p on p.id = te.project_id
           join app_user u on u.id = te.user_id
           left join certificate_line cl
                  on cl.time_entry_id = te.id and cl.deleted_at is null
          where te.id = $2 and te.deleted_at is null
            and p.org_id = $1 and p.deleted_at is null`,
        [orgId, entryId],
      );
      return rows[0] ? timeEntryRow(rows[0], capabilities) : null;
    },

    /**
     * Soft delete, which is how a mistyped entry is corrected. Not the same
     * thing as editing one: the row stays, dated and attributed, and the sum
     * stops counting it. An entry already on a certificate line stays put -
     * unpicking a document that has gone out is a credit, not a delete.
     */
    async deleteTimeEntry(entryId) {
      const { rows: billed } = await q(
        `select cl.certificate_id
           from certificate_line cl
           join payment_certificate pc on pc.id = cl.certificate_id
          where cl.time_entry_id = $1 and cl.deleted_at is null
            and pc.status = 'issued' and pc.deleted_at is null`,
        [entryId],
      );
      if (billed[0]) throw new IssuedError(billed[0].certificate_id);
      const { rows } = await q(
        `update time_entry te
            set deleted_at = now()
          where te.id = $1 and te.deleted_at is null
            and exists (select 1 from project p
                         where p.id = te.project_id and p.org_id = $2
                           and p.deleted_at is null)
        returning te.id`,
        [entryId, orgId],
      );
      if (!rows[0]) return null;
      await q(
        `update certificate_line set deleted_at = now()
          where time_entry_id = $1 and deleted_at is null`,
        [entryId],
      );
      return { id: rows[0].id };
    },

    /**
     * Quoted, captured, billed - and the two ratios the customer actually
     * asked for. Realisation is what the firm kept of what it spent; burn is
     * how much of the quote the work has eaten. Neither is derived at render
     * time in three different components.
     */
    async projectFinancials(projectId) {
      const { rows } = await q(
        `select p.id,
                p.budget_estimate,
                p.projected_cost,
                p.template_quote,
                p.billing_basis,
                p.fee_ceiling,
                p.status,
                schedule.scheduled,
                schedule.schedule_lines,
                lines.certified_gross,
                lines.draft_gross,
                wds.written_down,
                wds.unexplained_written_down,
                wds.written_down_by_reason,
                time_totals.captured,
                time_totals.captured_minutes,
                time_totals.uncertified_captured,
                time_totals.broken_rows
           from project p
           ${FINANCIAL_LATERALS}
          where p.id = $2 and p.org_id = $1 and p.deleted_at is null`,
        [orgId, projectId],
      );
      return rows[0] ? financials(rows[0], capabilities) : null;
    },

    // --- certificates -----------------------------------------------------

    async listCertificates(projectId) {
      const { rows } = await q(
        `select pc.id, pc.project_id, pc.seq, pc.period_start, pc.period_end,
                pc.status, pc.vat_rate, pc.issued_at, pc.created_at,
                coalesce(l.subtotal, 0) as subtotal,
                coalesce(w.written_down, 0) as written_down
           from payment_certificate pc
           join project p on p.id = pc.project_id
           left join lateral (
             select coalesce(sum(cl.amount), 0) as subtotal
               from certificate_line cl
              where cl.certificate_id = pc.id and cl.deleted_at is null
           ) l on true
           left join lateral (
             select coalesce(sum(wd.amount), 0) as written_down
               from write_down wd
              where wd.certificate_id = pc.id and wd.deleted_at is null
           ) w on true
          where pc.project_id = $2 and pc.deleted_at is null
            and p.org_id = $1 and p.deleted_at is null
          order by pc.seq`,
        [orgId, projectId],
      );
      return rows.map((row) => certificateSummary(row, capabilities));
    },

    /** A certificate with everything on it. The document, not a row. */
    async getCertificate(certificateId) {
      const { rows } = await q(
        `select pc.id, pc.project_id, pc.seq, pc.period_start, pc.period_end,
                pc.status, pc.vat_rate, pc.issued_at, pc.created_at
           from payment_certificate pc
           join project p on p.id = pc.project_id
          where pc.id = $2 and pc.deleted_at is null
            and p.org_id = $1 and p.deleted_at is null`,
        [orgId, certificateId],
      );
      if (!rows[0]) return null;
      const { rows: lines } = await q(
        `select id, seq, source, description, phase_ref, pct, units, amount,
                time_entry_id, project_task_id
           from certificate_line
          where certificate_id = $1 and deleted_at is null
          order by seq`,
        [certificateId],
      );
      const { rows: downs } = await q(
        `select id, phase_ref, amount, pct, reason_code, note, created_at
           from write_down
          where certificate_id = $1 and deleted_at is null
          order by created_at`,
        [certificateId],
      );
      const document = certificateDocument(rows[0], lines, downs, capabilities);
      // Billed-tier throughout: the cap is the quote, and the quote is not
      // an employee's to read.
      document.ceiling = capabilities.canViewBilled
        ? await this.certificateCeiling(rows[0].project_id, certificateId, document.net)
        : null;
      return document;
    },

    /**
     * Where this certificate stands against a capped fee (`project.fee_ceiling`).
     *
     * `priorNet` is what every *other* live certificate on the job already
     * claims, drafts included: two drafts each fitting the cap on their own
     * would together bill past it. `excess` is how far this one's net goes
     * over the room left, and `proposedWriteDown` is that same figure - the
     * write-down (reason `fee_ceiling`) that brings the net exactly to the
     * cap. The hours stay on the certificate at their captured value and the
     * write-down says what is not being charged; the alternative, trimming
     * lines, would put "we did this work" and "you are paying for it" on the
     * same row and lose the first.
     *
     * Null when the job is not capped or has no fee to cap it at - "no ceiling"
     * and "a ceiling of nothing" are different answers.
     */
    async certificateCeiling(projectId, certificateId, thisNet) {
      const { rows } = await q(
        `select p.fee_ceiling, p.budget_estimate,
                (select coalesce(sum(fsl.quoted), 0) from fee_schedule_line fsl
                  where fsl.project_id = p.id and fsl.deleted_at is null) as scheduled,
                (select count(*) from fee_schedule_line fsl
                  where fsl.project_id = p.id and fsl.deleted_at is null) as schedule_lines,
                (select coalesce(sum(cl.amount), 0)
                   from certificate_line cl
                   join payment_certificate pc
                     on pc.id = cl.certificate_id and pc.deleted_at is null
                  where pc.project_id = p.id and pc.id <> $3
                    and cl.deleted_at is null) as other_lines,
                (select coalesce(sum(wd.amount), 0)
                   from write_down wd
                   join payment_certificate pc
                     on pc.id = wd.certificate_id and pc.deleted_at is null
                  where pc.project_id = p.id and pc.id <> $3
                    and wd.deleted_at is null) as other_downs
           from project p
          where p.id = $1 and p.org_id = $2 and p.deleted_at is null`,
        [projectId, orgId, certificateId],
      );
      const row = rows[0];
      if (!row || !row.fee_ceiling) return null;
      const quoted = Number(row.schedule_lines) ? num(row.scheduled) : num(row.budget_estimate);
      if (quoted === null) return null;
      const priorNet = toCents((num(row.other_lines) ?? 0) - (num(row.other_downs) ?? 0));
      const room = Math.max(0, toCents(quoted - priorNet));
      const excess = Math.max(0, toCents(thisNet - room));
      return { quoted, priorNet, room, net: thisNet, excess, proposedWriteDown: excess };
    },

    async createCertificate(projectId, { periodStart = null, periodEnd = null } = {}) {
      // Owner-only for now (PERMISSIONS-PROPOSAL.md open decision 3): nothing
      // in the current UI reaches this flow for a non-owner, and deciding
      // "which non-owner, on which project" now would be guessing ahead of a
      // real workflow.
      requireCapability("canViewBilled", "only an owner can create a certificate");
      const project = await this.getProject(projectId);
      if (!project) return null;
      const { rows } = await q(
        `insert into payment_certificate (id, project_id, seq, period_start, period_end, created_by)
         select $1, $2, coalesce(max(seq), 0) + 1, $3, $4, $5
           from payment_certificate
          where project_id = $2 and deleted_at is null
      returning id`,
        [sid("pc"), projectId, periodStart, periodEnd, userId],
      );
      return this.getCertificate(rows[0].id);
    },

    /**
     * A fee-schedule line, entered by hand for now. When fee templates land
     * these come from the phase split; until then a typed percentage and
     * amount is the honest version, and it is the same row either way.
     */
    async addScheduleLine(certificateId, { description, amount, pct = null, phaseRef = null }) {
      requireCapability("canViewBilled", "only an owner can add a certificate line");
      if (!await requireDraft(this, certificateId)) return null;
      const text = trimmed(description);
      if (!text) throw new ValidationError("a description is required");
      const value = Number(amount);
      if (!Number.isFinite(value)) throw new ValidationError("an amount is required");
      await q(
        `insert into certificate_line (
           id, certificate_id, seq, source, description, phase_ref, pct, amount, created_by
         ) select $1, $2, coalesce(max(seq), 0) + 1, 'schedule', $3, $4, $5, $6, $7
             from certificate_line where certificate_id = $2 and deleted_at is null`,
        [sid("cl"), certificateId, text, trimmed(phaseRef) ?? null, pct, toCents(value), userId],
      );
      return this.getCertificate(certificateId);
    },

    /**
     * Bill phase tasks. The templated replacement for typing a schedule line
     * by hand, and the reason `certificate_line.source` now has a fourth
     * value: a line that came off a task can be reconciled against the fee
     * schedule and marked as claimed, where a typed one can only be read.
     *
     * Each selection is `{ taskId, amount?, pct? }`. A task's own
     * `default_fee` is the default, and one of the two overrides is required
     * when it has none - the spatial-planning templates price the phase rather
     * than each task, so "bill task 7" has no amount of its own. A phase can
     * also be part-billed, which is what `pct` is for.
     *
     * The line carries `phase_ref = task.phase_label`, which is what lets the
     * fee schedule show it against the phase that was quoted.
     */
    async addScheduleLinesFromTasks(certificateId, selections) {
      requireCapability("canViewBilled", "only an owner can bill tasks onto a certificate");
      const certificate = await requireDraft(this, certificateId);
      if (!certificate) return null;
      if (!Array.isArray(selections) || !selections.length) {
        throw new ValidationError("select at least one task to bill");
      }
      const tasks = await this.listProjectTasks(certificate.projectId);
      const { rows: seqRows } = await q(
        `select coalesce(max(seq), 0) as seq from certificate_line
          where certificate_id = $1 and deleted_at is null`,
        [certificateId],
      );
      let seq = Number(seqRows[0].seq);

      for (const selection of selections) {
        const id = typeof selection === "string" ? selection : selection.taskId;
        const task = tasks.find((candidate) => candidate.id === id);
        // Null rather than an error for an unknown id: it is another firm's
        // task or a stale page, and both are the 404 every other read gives.
        if (!task) return null;
        if (task.certificateId) throw new ValidationError(`"${task.description}" is already billed`);

        const override = typeof selection === "object" ? selection : {};
        let amount = override.amount === undefined || override.amount === null || override.amount === ""
          ? null
          : Number(override.amount);
        if (amount === null && override.pct !== undefined && override.pct !== null && override.pct !== "") {
          const fraction = Number(override.pct);
          if (!Number.isFinite(fraction) || fraction <= 0) {
            throw new ValidationError("a percentage must be greater than zero");
          }
          if (task.defaultFee === null) {
            throw new ValidationError(`"${task.description}" has no fee to take a percentage of`);
          }
          amount = task.defaultFee * fraction;
        }
        if (amount === null) amount = task.defaultFee;
        if (amount === null || !Number.isFinite(amount)) {
          // The phase-priced templates carry no task fee, so this is a real
          // and common answer rather than a corrupt row. Say which task.
          throw new ValidationError(
            `"${task.description}" carries no fee of its own - enter an amount for it`,
          );
        }
        seq += 1;
        await q(
          `insert into certificate_line (
             id, certificate_id, seq, source, description, phase_ref,
             pct, amount, project_task_id, created_by
           ) values ($1, $2, $3, 'phase', $4, $5, $6, $7, $8, $9)`,
          [
            sid("cl"), certificateId, seq, task.description, task.phaseLabel,
            override.pct ? Number(override.pct) : null, toCents(amount), task.id, userId,
          ],
        );
      }
      return this.getCertificate(certificateId);
    },

    /**
     * The invoice macro, reimplemented. Pulls every unbilled time entry in the
     * range onto the certificate, oldest first.
     *
     * Two differences from the original, both deliberate. It does not stop at
     * sixteen lines - the macro did, and the seventeenth hour simply never
     * reached the client. And an entry already carrying a live line is skipped
     * rather than duplicated, which the unique index on `time_entry_id` also
     * enforces underneath; re-running an overlapping range is a no-op instead
     * of billing the overlap twice.
     */
    async addCertificateLinesFromTime(certificateId, { from = null, to = null, userId: staffId = null } = {}) {
      requireCapability("canViewBilled", "only an owner can pull time onto a certificate");
      const certificate = await requireDraft(this, certificateId);
      if (!certificate) return null;
      const { rows: entries } = await q(
        `select te.id, te.entry_date, te.description, te.phase_ref, te.captured_amount
           from time_entry te
           join project p on p.id = te.project_id
          where te.project_id = $1
            and te.deleted_at is null
            and p.org_id = $2
            and ($3::date is null or te.entry_date >= $3)
            and ($4::date is null or te.entry_date <= $4)
            and ($5::text is null or te.user_id = $5)
            and not exists (
              select 1 from certificate_line cl
               where cl.time_entry_id = te.id and cl.deleted_at is null
            )
          order by te.entry_date, te.created_at`,
        [certificate.projectId, orgId, from, to, staffId],
      );
      const { rows: seqRows } = await q(
        `select coalesce(max(seq), 0) as seq from certificate_line
          where certificate_id = $1 and deleted_at is null`,
        [certificateId],
      );
      let seq = Number(seqRows[0].seq);
      for (const entry of entries) {
        seq += 1;
        const amount = num(entry.captured_amount);
        await q(
          `insert into certificate_line (
             id, certificate_id, seq, source, description, phase_ref,
             units, amount, time_entry_id, created_by
           ) values ($1, $2, $3, 'time', $4, $5, $6, $7, $8, $9)`,
          [
            sid("cl"), certificateId, seq, entry.description,
            entry.phase_ref, certificateUnits(amount), amount, entry.id, userId,
          ],
        );
      }
      return this.getCertificate(certificateId);
    },

    /**
     * Value given up, with a reason. Either an amount or a percentage of the
     * current subtotal - the workbook's July certificate for P074 took 20% off
     * the bottom of the page, and that is the shape the firm already thinks in.
     *
     * The reason is required. It is the entire point: the customer does not
     * want the write-down stopped, they want to be told it is happening and
     * why, and a discount nobody can account for is the gap this exists to
     * close.
     */
    async addWriteDown(certificateId, { amount = null, pct = null, reasonCode, note = null, phaseRef = null }) {
      // Cost-tier information (what was given up, and why) as well as a
      // billed-tier write - gated on the same, wider capability the other
      // certificate writes use, since today's two roles never disagree on it.
      requireCapability("canViewBilled", "only an owner can record a write-down");
      if (!await requireDraft(this, certificateId)) return null;
      const reason = trimmed(reasonCode);
      if (!reason) throw new ValidationError("a reason is required for a write-down");
      let value = amount === null ? null : Number(amount);
      if (value === null) {
        const fraction = Number(pct);
        if (!Number.isFinite(fraction) || fraction <= 0) {
          throw new ValidationError("a write-down needs an amount or a percentage");
        }
        const { rows } = await q(
          `select coalesce(sum(amount), 0) as subtotal from certificate_line
            where certificate_id = $1 and deleted_at is null`,
          [certificateId],
        );
        value = toCents(num(rows[0].subtotal) * fraction);
      }
      if (!Number.isFinite(value) || value <= 0) {
        throw new ValidationError("a write-down must be greater than zero");
      }
      await q(
        `insert into write_down (id, certificate_id, phase_ref, amount, pct, reason_code, note, created_by)
              values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [sid("wd"), certificateId, trimmed(phaseRef) ?? null, toCents(value), pct, reason, trimmed(note) ?? null, userId],
      );
      return this.getCertificate(certificateId);
    },

    /** Issuing is one way. A correction is the next certificate. */
    async issueCertificate(certificateId) {
      requireCapability("canViewBilled", "only an owner can issue a certificate");
      // A capped fee is only a cap if issuing respects it. Refused with the
      // figure that fixes it, rather than issued and left for somebody to
      // notice the client was billed past the agreed fee.
      const before = await this.getCertificate(certificateId);
      if (before?.status === "draft" && before.ceiling?.excess > 0) {
        throw new ValidationError(
          `this job's fee is a ceiling, and this certificate goes R${before.ceiling.excess.toFixed(2)} `
          + `past it. Write down R${before.ceiling.excess.toFixed(2)} as "fee ceiling" first, `
          + "or take the ceiling off the job if the fee has been renegotiated",
        );
      }
      const { rows } = await q(
        `update payment_certificate pc
            set status = 'issued', issued_at = now(), updated_at = now()
          where pc.id = $1 and pc.status = 'draft' and pc.deleted_at is null
            and exists (select 1 from project p
                         where p.id = pc.project_id and p.org_id = $2
                           and p.deleted_at is null)
        returning pc.id`,
        [certificateId, orgId],
      );
      if (!rows[0]) {
        const current = await this.getCertificate(certificateId);
        if (!current) return null;
        throw new IssuedError(certificateId);
      }
      return this.getCertificate(certificateId);
    },
  };
}

/**
 * Everything that writes to a certificate goes through here first. Null for
 * "no such certificate in this org", matching every other read on this store,
 * so the route answers 404; issued is a different answer and throws.
 */
async function requireDraft(store, certificateId) {
  const certificate = await store.getCertificate(certificateId);
  if (!certificate) return null;
  if (certificate.status !== "draft") throw new IssuedError(certificateId);
  return certificate;
}

/** domain.md's phase/task vocabulary. `not_required` is a struck task. */
const TASK_STATUSES = ["not_started", "in_progress", "done", "not_required"];

// --- practice-ops SQL fragments ---------------------------------------------

// Shared by the register list, the single register read and the financials, so
// "captured" cannot come to mean one thing in a list and another on a page.
const FINANCIAL_LATERALS = `
  left join lateral (
    select coalesce(sum(te.captured_amount), 0)                   as captured,
           coalesce(sum(te.minutes), 0)                           as captured_minutes,
           coalesce(sum(te.captured_amount) filter (
             where not exists (select 1 from certificate_line cl
                                where cl.time_entry_id = te.id and cl.deleted_at is null)
           ), 0)                                                  as uncertified_captured,
           -- The workbook's damage, counted rather than hidden: somebody
           -- clocked on and never clocked off, or hours were logged and
           -- priced at nothing.
           --
           -- Having neither clock time is not damage. The duration can be
           -- typed straight in, and it is how most of a day gets recorded
           -- after the fact; flagging that would put a warning on the normal
           -- case and teach everyone to ignore the warnings.
           count(*) filter (
             where (te.started_at is not null and te.ended_at is null)
                or (te.minutes > 0 and te.captured_amount = 0)
           )                                                       as broken_rows
      from time_entry te
     where te.project_id = p.id and te.deleted_at is null
  ) time_totals on true
  left join lateral (
    select coalesce(sum(cl.amount) filter (where pc.status = 'issued'), 0) as certified_gross,
           coalesce(sum(cl.amount) filter (where pc.status = 'draft'), 0)  as draft_gross
      from certificate_line cl
      join payment_certificate pc on pc.id = cl.certificate_id and pc.deleted_at is null
     where pc.project_id = p.id and cl.deleted_at is null
  ) lines on true
  -- Grouped by reason first, then summed, because the total and the breakdown
  -- must be the same arithmetic. An amount with no reason beside it is trivia,
  -- and the reason is already stored - so it travels with the total rather than
  -- being a second request the caller may or may not make.
  left join lateral (
    select coalesce(sum(byreason.amount), 0)                              as written_down,
           coalesce(sum(byreason.amount) filter (
             where byreason.reason_code = 'legacy_unspecified'
           ), 0)                                                          as unexplained_written_down,
           coalesce(jsonb_agg(jsonb_build_object(
             'reasonCode', byreason.reason_code,
             'amount', byreason.amount
           ) order by byreason.amount desc), '[]'::jsonb)                 as written_down_by_reason
      from (
        select wd.reason_code, sum(wd.amount) as amount
          from write_down wd
          join payment_certificate pc on pc.id = wd.certificate_id and pc.deleted_at is null
         where pc.project_id = p.id and pc.status = 'issued' and wd.deleted_at is null
         group by wd.reason_code
      ) byreason
  ) wds on true
  left join lateral (
    select coalesce(sum(fsl.quoted), 0) as scheduled,
           count(*)                     as schedule_lines
      from fee_schedule_line fsl
     where fsl.project_id = p.id and fsl.deleted_at is null
  ) schedule on true
`;

/**
 * The last certificate that actually went out, which is where the next one's
 * period starts. Joined into the register rather than fetched per job, because
 * the question "what can I invoice right now" is asked of the whole list at
 * once and twelve round trips is how it stops being asked.
 */
const LAST_CERTIFICATE_LATERAL = `
  left join lateral (
    select pc.seq, pc.period_end, pc.issued_at
      from payment_certificate pc
     where pc.project_id = p.id and pc.deleted_at is null and pc.status = 'issued'
     order by pc.issued_at desc nulls last, pc.seq desc
     limit 1
  ) last_cert on true
`;

/**
 * The newest phase event, which is what "current phase" means. Joined into
 * the register listing rather than fetched per job, so a page that wants to
 * say where twelve jobs have got to does not make twelve round trips.
 */
const PHASE_LATERAL = `
  left join lateral (
    select ppe.phase_ref, ppe.entered_at
      from project_phase_event ppe
     where ppe.project_id = p.id
     order by ppe.entered_at desc, ppe.created_at desc
     limit 1
  ) phase on true
`;

const REGISTER_COLUMNS = `
  p.id, p.code, p.name, p.client_name, p.client_email, p.client_cell,
  p.client_address, p.property_description, p.type_code, p.budget_estimate,
  p.projected_cost, p.template_quote, p.billing_basis, p.fee_ceiling, p.lead_user_id, p.status, p.opened_at, p.updated_at,
  p.created_at, p.deleted_at, d.id as drawing_id,
  time_totals.captured, time_totals.captured_minutes,
  time_totals.uncertified_captured, time_totals.broken_rows,
  lines.certified_gross, lines.draft_gross,
  wds.written_down, wds.unexplained_written_down, wds.written_down_by_reason,
  schedule.scheduled, schedule.schedule_lines,
  phase.phase_ref as current_phase, phase.entered_at as phase_since,
  last_cert.seq as last_certificate_seq,
  last_cert.period_end as last_certificate_period_end,
  last_cert.issued_at as last_certificate_issued_at
`;

// --- practice-ops mapping ---------------------------------------------------

/** Settings key -> org column. The allow-list for updateOrgSettings. */
const ORG_SETTING_COLUMNS = {
  tradingName: "trading_name",
  addressLines: "address_lines",
  vatNumber: "vat_number",
  companyReg: "company_reg",
  bankName: "bank_name",
  bankBranch: "bank_branch",
  bankBranchCode: "bank_branch_code",
  bankAccountNo: "bank_account_no",
  contactName: "contact_name",
  contactCell: "contact_cell",
  contactEmail: "contact_email",
  popEmail: "pop_email",
};

function trimmed(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

/** A fee typed into the editor: blank is "no fee", anything else must be a non-negative number. */
function templateFee(value, what) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ValidationError(`${what} must be a number of rand, zero or more`);
  }
  return Math.round(parsed * 100) / 100;
}

/** Validate an edited template into `{ name, fee, tasks: [{ description, fee }] }`. */
function normaliseTemplateInput(input) {
  if (!input || !Array.isArray(input.phases)) {
    throw new ValidationError("a template is a list of phases");
  }
  return input.phases.map((phase, index) => {
    const name = trimmed(phase?.name);
    if (!name) throw new ValidationError(`phase ${index + 1} needs a name`);
    const rawTasks = Array.isArray(phase.tasks) ? phase.tasks : [];
    const tasks = rawTasks.map((task, taskIndex) => {
      const description = trimmed(task?.description);
      if (!description) {
        throw new ValidationError(`task ${taskIndex + 1} in "${name}" needs a description`);
      }
      return { description, fee: templateFee(task.fee, `the fee for "${description}"`) };
    });
    const own = templateFee(phase.fee, `the fee for "${name}"`);
    const summed = Math.round(tasks.reduce((sum, task) => sum + (task.fee ?? 0), 0) * 100) / 100;
    return { name, fee: own ?? summed, tasks };
  });
}

/**
 * A cost share typed into the template editor: blank is "not said", otherwise a
 * fraction of the fee from 0 to 1. Rejected rather than clamped, because 65
 * typed where 0.65 was meant would otherwise be stored as a cost of 6 500%.
 */
function costShare(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new ValidationError("the cost share must be a fraction of the fee, from 0 to 1");
  }
  return Math.round(parsed * 10000) / 10000;
}

/** `numeric` arrives as a string, exactly. Money is a Number at the JSON edge. */
function num(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Only the keys actually present move. A register form posts what it renders,
 * and a partial update that treated absence as "clear it" would empty the
 * client's phone number every time someone corrected a project code.
 */
function registerFields(fields, { partial = false } = {}) {
  const absent = partial ? undefined : null;
  const text = (key) => (key in fields ? trimmed(fields[key]) : absent);
  const money = (key) => {
    if (!(key in fields)) return absent;
    const raw = fields[key];
    // Explicitly null or blank is "no figure", which is a real answer: plenty
    // of time-and-materials work is opened with no budget at all. Number(null)
    // is 0, and a quote of zero would make every such job read as 100% burnt.
    if (raw === null || raw === undefined || raw === "") return null;
    const value = Number(raw);
    // Not silently dropped. "R120 000" typed into a number field is a mistake
    // worth a message, not a budget that quietly becomes nothing.
    if (!Number.isFinite(value)) throw new ValidationError(`${key} must be a number`);
    return toCents(value);
  };
  return {
    name: text("name"),
    code: text("code"),
    clientName: text("clientName"),
    clientEmail: text("clientEmail"),
    clientCell: text("clientCell"),
    clientAddress: text("clientAddress"),
    propertyDescription: text("propertyDescription"),
    typeCode: text("typeCode"),
    billingBasis: text("billingBasis"),
    // A flag, so absence is "unchanged" on update and false on create.
    feeCeiling: "feeCeiling" in fields
      ? (fields.feeCeiling === true || fields.feeCeiling === "true" || fields.feeCeiling === "on")
      : (partial ? undefined : false),
    leadUserId: text("leadUserId"),
    status: text("status"),
    openedAt: text("openedAt"),
    budgetEstimate: money("budgetEstimate"),
    projectedCost: money("projectedCost"),
  };
}

function registerRow(row, capabilities = capabilitiesFor("owner")) {
  return {
    id: row.id,
    code: row.code ?? null,
    name: row.name ?? null,
    clientName: row.client_name ?? null,
    clientEmail: row.client_email ?? null,
    clientCell: row.client_cell ?? null,
    clientAddress: row.client_address ?? null,
    propertyDescription: row.property_description ?? null,
    typeCode: row.type_code ?? null,
    budgetEstimate: gate(num(row.budget_estimate), capabilities.canViewBilled),
    projectedCost: gate(num(row.projected_cost), capabilities.canViewBilled),
    billingBasis: row.billing_basis ?? null,
    feeCeiling: Boolean(row.fee_ceiling),
    leadUserId: row.lead_user_id ?? null,
    status: row.status ?? null,
    openedAt: row.opened_at ?? null,
    updatedAt: row.updated_at ?? null,
    createdAt: row.created_at ?? null,
    deletedAt: row.deleted_at ?? null,
    // Null, not false: a job with no drawing is the normal case for most of
    // these disciplines, and the planner uses this to decide whether "open"
    // means a canvas or a register page.
    drawingId: row.drawing_id ?? null,
    // Null is "nobody has said", not "phase one". The register shows the gap.
    currentPhase: row.current_phase ?? null,
    phaseSince: row.phase_since ?? null,
    // The last certificate that went out, which is where the next one's period
    // starts. Dates and a sequence number, not money, so it reads for every
    // role - an employee can already see that a certificate exists.
    lastCertificate: row.last_certificate_seq === null || row.last_certificate_seq === undefined
      ? null
      : {
        seq: Number(row.last_certificate_seq),
        periodEnd: row.last_certificate_period_end ?? null,
        issuedAt: row.last_certificate_issued_at ?? null,
      },
    financials: financials(row, capabilities),
  };
}

/**
 * The two ratios, and the evidence behind them.
 *
 * `realisation` is what the firm kept of what the work cost it; `burn` is how
 * much of the quote that work has eaten. Both are null rather than zero when
 * their denominator is, because "no realisation yet" and "realised nothing"
 * are different sentences and a dashboard that prints 0% for the first is
 * lying about a job nobody has billed.
 *
 * `quoted` has one source at a time and says which. A fee schedule is the
 * agreed breakdown and outranks the register's estimate the moment it exists;
 * showing both as "the fee" would give the firm two numbers that drift, and
 * burn would mean something different on two screens.
 */
/**
 * `capabilities` defaults to full visibility so every existing internal
 * caller (and every test that built its expectations before this file
 * existed) keeps seeing what it always saw; the two call sites that read a
 * caller's own request thread the real value through explicitly.
 */
function financials(row, capabilities = capabilitiesFor("owner")) {
  const budgetEstimate = num(row.budget_estimate);
  const scheduleLines = Number(row.schedule_lines ?? 0);
  const quoted = scheduleLines ? num(row.scheduled) : budgetEstimate;
  const captured = num(row.captured) ?? 0;
  const certifiedGross = num(row.certified_gross) ?? 0;
  const writtenDown = num(row.written_down) ?? 0;
  const billedAmount = toCents(certifiedGross - writtenDown);
  // Ratios computed from the real numbers first, gated after - the same
  // "never sum already-redacted fields" rule listFeeSchedule follows, so a
  // hidden numerator/denominator cannot quietly read as a real 0% or 100%.
  const realisation = ratio(billedAmount, captured);
  const burn = ratio(captured, quoted);
  const gateBilled = (value) => gate(value, capabilities.canViewBilled);
  // Expected profit is the quote less the cost the firm typed in. Both must
  // exist: a missing cost is "not planned", not a cost of zero, and a profit
  // of the whole fee would flatter every job nobody has costed. It follows
  // the quote, so revising the schedule moves it without anyone re-typing.
  const projectedCost = num(row.projected_cost);
  const projectedProfit = quoted !== null && projectedCost !== null
    ? toCents(quoted - projectedCost) : null;
  // How far the job's own quote has moved from what its template charged on
  // the day it was registered. Only meaningful while the quote is still a fee
  // schedule; a job whose schedule was cleared is back on the register's
  // estimate, which the template never priced.
  const templateQuote = num(row.template_quote);
  const vsTemplate = templateQuote !== null && scheduleLines && quoted !== null
    ? toCents(quoted - templateQuote) : null;
  return {
    templateQuote: gateBilled(templateQuote),
    vsTemplate: gateBilled(vsTemplate),
    projectedCost: gateBilled(projectedCost),
    projectedProfit: gateBilled(projectedProfit),
    projectedMargin: gateBilled(projectedProfit === null ? null : ratio(projectedProfit, quoted)),
    quoted: gateBilled(quoted),
    quotedSource: scheduleLines ? "fee_schedule" : "budget_estimate",
    budgetEstimate: gateBilled(budgetEstimate),
    scheduleLines,
    captured: gateBilled(captured),
    // Hours, not currency - visible on `can_view_hours` alone, same as `burn`
    // below.
    capturedMinutes: Number(row.captured_minutes ?? 0),
    certifiedGross: gateBilled(certifiedGross),
    draftGross: gateBilled(num(row.draft_gross) ?? 0),
    writtenDown: gateBilled(writtenDown),
    unexplainedWrittenDown: gateBilled(num(row.unexplained_written_down) ?? 0),
    // The same total, split by why. Carried on the row so the fee bar can name
    // the reason on the notch it draws - an amount with no reason beside it is
    // trivia, and a second request per job to fetch it would mean the register
    // never bothers.
    writtenDownByReason: gateBilled(writtenDownByReason(row.written_down_by_reason)),
    billed: gateBilled(billedAmount),
    // The room a capped fee has left, counting only what has been issued. Null
    // where the job is not capped or has no fee; the certificate carries the
    // sharper reading that includes drafts.
    ceilingRoom: gateBilled(row.fee_ceiling && quoted !== null
      ? Math.max(0, toCents(quoted - billedAmount)) : null),
    uncertifiedCaptured: gateBilled(num(row.uncertified_captured) ?? 0),
    brokenRows: Number(row.broken_rows ?? 0),
    // Realisation is explicitly billed-tier in the proposal (it's the
    // firm's margin, expressed as a ratio rather than an amount); burn is
    // explicitly hours-tier ("burn %" is named in `can_view_hours`) and stays
    // visible without `can_view_billed`, matching Mosaic's Work Planner tier.
    realisation: gateBilled(realisation),
    burn,
  };
}

/**
 * jsonb in, `[{ reasonCode, amount }]` out, newest schema first. Empty when
 * nothing has been written down - an empty list, not null: "nothing was given
 * up" is a real answer, where null would read as "not asked".
 */
function writtenDownByReason(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => ({
    reasonCode: entry.reasonCode,
    amount: num(entry.amount) ?? 0,
  }));
}

function ratio(top, bottom) {
  if (!bottom) return null;
  return Math.round((top / bottom) * 10000) / 10000;
}

function timeEntryRow(row, capabilities = capabilitiesFor("owner")) {
  const billed = capabilities.canViewBilled;
  return {
    id: row.id,
    projectId: row.project_id,
    projectCode: row.project_code ?? null,
    projectName: row.project_name ?? null,
    userId: row.user_id,
    userEmail: row.user_email ?? null,
    date: row.entry_date,
    start: row.started_at ?? null,
    end: row.ended_at ?? null,
    // Duration is hours, not currency - visible either way (this is what
    // lets an employee log and see their own timesheet without ever seeing
    // what an hour costs).
    minutes: Number(row.minutes),
    activityType: row.activity_type,
    description: row.description,
    phaseRef: row.phase_ref ?? null,
    printsQty: Number(row.prints_qty ?? 0),
    travelKm: num(row.travel_km) ?? 0,
    rateBandCode: row.rate_band_code ?? null,
    rateApplied: gate(num(row.rate_applied), billed),
    pricingRule: row.pricing_rule,
    capturedAmount: gate(num(row.captured_amount) ?? 0, billed),
    createdAt: row.created_at ?? null,
    certificateId: row.certificate_id ?? null,
  };
}

function certificateSummary(row, capabilities = capabilitiesFor("owner")) {
  const subtotal = num(row.subtotal) ?? 0;
  const writtenDown = num(row.written_down) ?? 0;
  const billed = capabilities.canViewBilled;
  return {
    id: row.id,
    projectId: row.project_id,
    seq: Number(row.seq),
    periodStart: row.period_start ?? null,
    periodEnd: row.period_end ?? null,
    // Status and dates are process facts, not money - a certificate exists
    // and is draft/issued regardless of who is looking at it.
    status: row.status,
    vatRate: num(row.vat_rate) ?? 0,
    issuedAt: row.issued_at ?? null,
    createdAt: row.created_at ?? null,
    subtotal: gate(subtotal, billed),
    writtenDown: gate(writtenDown, billed),
    net: gate(toCents(subtotal - writtenDown), billed),
  };
}

/**
 * The certificate as it reads on paper: lines, then what was given up, then
 * VAT on what is left. The write-down sits between the subtotal and the net
 * rather than being folded into the lines, which is both how the firm already
 * writes it and the only arrangement where the client's discount and the
 * firm's lost value are both visible on one page.
 */
function certificateDocument(row, lines, downs, capabilities = capabilitiesFor("owner")) {
  const billed = capabilities.canViewBilled;
  // Write-down amount and reason are the cost-tier field this proposal
  // deliberately named ("the most locked-down field of all" in the
  // competitor research) - gated on `canViewCost`, not the wider
  // `canViewBilled` every other certificate figure uses. Today's two roles
  // never disagree between the two, but a future middle tier (billed
  // visible, cost still hidden) would.
  const cost = capabilities.canViewCost;
  // Totals are computed from the real amounts first, then gated - so a
  // write-down hidden by `canViewCost` cannot make the net read as if the
  // write-down never happened.
  const mappedLines = lines.map((line) => {
    const amount = num(line.amount) ?? 0;
    return {
      id: line.id,
      seq: Number(line.seq),
      source: line.source,
      description: line.description,
      phaseRef: line.phase_ref ?? null,
      pct: num(line.pct),
      units: num(line.units),
      amount: gate(amount, billed),
      timeEntryId: line.time_entry_id ?? null,
      projectTaskId: line.project_task_id ?? null,
    };
  });
  const realAmounts = lines.map((line) => num(line.amount) ?? 0);
  const writeDowns = downs.map((down) => ({
    id: down.id,
    phaseRef: down.phase_ref ?? null,
    amount: gate(num(down.amount) ?? 0, cost),
    pct: num(down.pct),
    reasonCode: gate(down.reason_code, cost),
    note: gate(down.note ?? null, cost),
    createdAt: down.created_at ?? null,
  }));
  const realWriteDowns = downs.map((down) => num(down.amount) ?? 0);
  const subtotal = toCents(realAmounts.reduce((total, amount) => total + amount, 0));
  const writtenDown = toCents(realWriteDowns.reduce((total, amount) => total + amount, 0));
  const net = toCents(subtotal - writtenDown);
  const vatRate = num(row.vat_rate) ?? 0;
  const vat = toCents(net * vatRate);
  return {
    id: row.id,
    projectId: row.project_id,
    seq: Number(row.seq),
    periodStart: row.period_start ?? null,
    periodEnd: row.period_end ?? null,
    status: row.status,
    vatRate,
    issuedAt: row.issued_at ?? null,
    createdAt: row.created_at ?? null,
    lines: mappedLines,
    writeDowns,
    subtotal: gate(subtotal, billed),
    writtenDown: gate(writtenDown, billed),
    net: gate(net, billed),
    vat: gate(vat, billed),
    total: gate(toCents(net + vat), billed),
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
    // The firm's own label (D063), null on a job the planner created before
    // the register gave it a code. The chrome prints it beside the drawing name.
    code: row.code ?? null,
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

/**
 * Outlines only. A room's name, its SKU and its finishes are the document's
 * business; a preview needs the shape and the storey it stands on. An entry
 * the document holds but cannot be drawn - a shape that is missing, a wall
 * with a non-numeric end - is dropped here rather than shipped for the
 * browser to trip over.
 */
function drawingPreviewRow(row) {
  const outlines = (list) => (Array.isArray(list) ? list : [])
    .filter((entry) => entry?.shape)
    .map((entry) => ({ shape: entry.shape, level: entry.level ?? null }));
  return {
    projectId: row.project_id,
    drawingId: row.drawing_id,
    revision: row.revision,
    updatedAt: row.updated_at ?? null,
    rooms: outlines(row.rooms),
    slabs: outlines(row.slabs),
    roofs: outlines(row.roofs),
    segments: (Array.isArray(row.segments) ? row.segments : [])
      .filter((seg) => [seg?.x1, seg?.y1, seg?.x2, seg?.y2].every(Number.isFinite))
      .map((seg) => ({
        x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2, level: seg.level ?? null,
      })),
  };
}
