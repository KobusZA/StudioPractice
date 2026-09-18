// The job library's behaviour, with no DOM in it.
//
// ui.js draws the rows and the buttons; what actually happens when a job is
// opened, created, duplicated or renamed lives here, so it is testable the way
// the rest of this codebase is - no browser, no server, an injected `cloud` and
// an injected `sync` (§12 of CLOUD-DOCUMENTS-PLAN.md).
//
// One rule runs through all of it: **every switch of job flushes first, and
// refuses to navigate while anything is unconfirmed.** DocSync.attach() would
// throw anyway; going through here means the user gets a sentence about it, and
// the queued documents stay queued for the job they belong to. Turning that
// into a silent discard is the data loss this whole plan exists to stop.
//
// This is not a data layer either. It is the four commands that replaced Save
// and Open, expressed against cloud.js, which is ordinary request-and-response.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A navigation the app declined, with the reason to show. Distinct from a
 * CloudError: nothing failed, the app refused, and the open job is untouched.
 */
export class NavigationBlocked extends Error {
  constructor(message) {
    super(message);
    this.name = "NavigationBlocked";
  }
}

export const UNCONFIRMED_MESSAGE =
  "This job still has changes the server has not confirmed. It stays open until they land - "
  + "check your connection and try again.";

export const CONFLICT_MESSAGE =
  "This drawing changed somewhere else. Choose which version to keep before opening another job.";

/**
 * The one gate in front of every navigation. Write what is pending, then check:
 * a queue that survived the flush means the write did not land, and adopting
 * another job's document now would drop it.
 */
export async function flushForNavigation(sync) {
  if (!sync) return;
  const state = await sync.flush();
  // A conflict is not "still saving" - it is a question the user has already
  // been asked and has not answered - so it gets its own sentence.
  if (state?.kind === "conflict") throw new NavigationBlocked(CONFLICT_MESSAGE);
  if (sync.isDirty()) throw new NavigationBlocked(UNCONFIRMED_MESSAGE);
}

/**
 * Open an existing job. `apply` receives `{ project, drawing }` exactly as the
 * server described it and is what puts it into the editor - see
 * applyOpenedJob() in ui.js.
 */
export async function openJob({ cloud, sync, projectId, apply }) {
  await flushForNavigation(sync);
  const opened = await cloud.openProject(projectId);
  if (!opened?.drawing) throw new Error("That job came back without a drawing");
  apply?.(opened);
  return opened;
}

/**
 * `file-new`, and what Clear became. The document is minted by the caller
 * (`emptyDoc()`, or the demo geometry) because its `id` is the drawing's
 * identity and this module has no business inventing one.
 *
 * `openDrawingId` is passed so the one mistake that would matter is impossible
 * rather than merely unlikely: Clear used to keep the open drawing's id on
 * purpose, and a *new row* carrying it would either collide or overwrite the
 * job it was supposed to leave alone.
 */
export async function createJob({
  cloud, sync, doc, name = null, packId = null, openDrawingId = null, apply,
}) {
  if (!doc?.id) throw new Error("a new job needs a document with an id");
  if (openDrawingId && doc.id === openDrawingId) {
    throw new Error("a new job cannot reuse the open drawing's id");
  }
  await flushForNavigation(sync);
  const payload = { ...doc, packId: doc.packId ?? packId ?? null };
  const project = await cloud.createProject({ name, doc: payload, packId: payload.packId });
  if (!project?.drawing) throw new Error("The new job came back without a drawing");
  const opened = { project, drawing: project.drawing };
  apply?.(opened);
  return opened;
}

/**
 * `file-duplicate` - the old Save As. The server mints new ids for the copy and
 * appends " (copy)"; this checks that it did, because a copy that came back
 * wearing the original's drawing id would mean the next save into either one
 * writes over the other.
 *
 * It does not navigate. Duplicating is something you do *to* a job in the list,
 * and the open job has no reason to close.
 */
export async function duplicateJob({ cloud, projectId, sourceDrawingId = null }) {
  const copy = await cloud.duplicateProject(projectId);
  if (!copy) throw new Error("That job could not be duplicated");
  const copyDrawingId = copy.drawing?.id ?? copy.drawingId ?? null;
  if (sourceDrawingId && copyDrawingId && copyDrawingId === sourceDrawingId) {
    throw new Error("the copy came back with the original's drawing id");
  }
  return copy;
}

/**
 * `file-rename`. The server writes `project.name` and `doc.name` together and
 * bumps the drawing's revision, so renaming the *open* job means adopting what
 * came back - otherwise the next autosave arrives with a stale `If-Match` and
 * reads as a conflict with itself.
 *
 * Renaming a job that is not open needs none of that: nothing here is attached
 * to its drawing.
 */
export async function renameJob({
  cloud, sync, projectId, name, open = false, adopt,
}) {
  if (open) await flushForNavigation(sync);
  const project = await cloud.renameProject(projectId, name);
  if (!project) throw new Error("That job could not be renamed");
  if (open && project.drawing) adopt?.(project.drawing);
  return project;
}

/**
 * The library list, split the way it is drawn: live jobs, then the deleted ones
 * that Restore brings back. Nothing is dropped - a soft delete that vanished
 * from every surface would not be undoable from anywhere.
 */
export function splitLibrary(projects = []) {
  return {
    jobs: projects.filter((p) => !p.deletedAt),
    deleted: projects.filter((p) => p.deletedAt),
  };
}

/**
 * What a row shows. Name, erf and dates - facts the server sent. No thumbnail:
 * rendering one needs the geometry, and a placeholder image is exactly the
 * plausible default this codebase refuses everywhere else.
 */
export function jobRowFields(project) {
  return {
    id: project.id,
    // Blank stays blank. "Untitled Project" is a name nobody typed, and the
    // title block prints an em-dash for the same reason.
    name: project.name || null,
    nameLabel: project.name || "—",
    erf: project.erf || null,
    erfLabel: project.erf ? `Erf ${project.erf}` : null,
    lastOpened: shortDateTime(project.openedAt || project.updatedAt),
    created: shortDateTime(project.createdAt),
    deleted: Boolean(project.deletedAt),
  };
}

/**
 * A date a builder can read, from whatever the driver handed back - a string
 * from JSON or a Date from `pg`. Null in, null out: an unknown date is not
 * rendered as today.
 */
export function shortDateTime(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${hh}:${mm}`;
}
