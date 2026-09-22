// The HTTP surface. Thin on purpose: a handler authenticates, then asks an
// org-scoped store for something. No handler names an org id, and none of them
// can - see store.js.

import {
  AuthError, RateLimiter, SESSION_COOKIE, SESSION_TTL_MS,
  refreshOfflineLease, resolveSession, revokeSession, signIn, signUp,
} from "./auth.js";
import {
  ConflictError, DuplicateCodeError, IssuedError, ValidationError, openStore,
} from "./store.js";
import {
  ACTIVITY_TYPES, BILLING_BASES, PROJECT_STATUSES, WRITE_DOWN_REASONS,
} from "./defaults.js";
import { withTransaction } from "./db.js";
import {
  HttpError, clearedCookie, createRouter, parseCookies, readJsonBody, sendJson, sessionCookie,
} from "./http.js";
import { generateVisualization } from "./visualize.js";

/**
 * `env` is a parameter rather than a read of `process.env` inside so that the
 * cookie rule below can be tested, which matters more than it looks: `Secure`
 * is a property of the *connection*, not of the build. A production image
 * reached over plain HTTP - a compose stack on a laptop, a container behind a
 * proxy that terminates TLS elsewhere - sets a cookie the browser then refuses
 * to store, and sign-in fails with nothing in any log to say why. So NODE_ENV is
 * the default, `COOKIE_SECURE` is the explicit answer when the two disagree, and
 * the runbook says to set it to 1 the moment there is HTTPS in front.
 */
export function createApi(pool, options = {}, env = process.env) {
  const secureCookies = options.secureCookies
    ?? envFlag(env.COOKIE_SECURE, env.NODE_ENV === "production");
  const allowedOrigins = options.allowedOrigins
    ?? String(env.ALLOWED_ORIGINS || "").split(",").filter(Boolean);
  const rateLimiter = options.rateLimiter ?? new RateLimiter();
  const openaiApiKey = options.openaiApiKey ?? env.OPENAI_API_KEY;
  const openaiFetch = options.openaiFetch ?? globalThis.fetch.bind(globalThis);

  const match = createRouter([
    ["POST", "/api/auth/sign-up", handleSignUp],
    ["POST", "/api/auth/sign-in", handleSignIn],
    ["POST", "/api/auth/sign-out", handleSignOut],
    ["GET", "/api/auth/session", handleSession],

    ["GET", "/api/projects", handleListProjects],
    ["POST", "/api/projects", handleCreateProject],
    ["GET", "/api/projects/:id", handleOpenProject],
    ["PATCH", "/api/projects/:id", handleRenameProject],
    ["DELETE", "/api/projects/:id", handleDeleteProject],
    ["POST", "/api/projects/:id/duplicate", handleDuplicateProject],
    ["POST", "/api/projects/:id/restore", handleRestoreProject],

    ["POST", "/api/projects/:id/drawing", handleAttachDrawing],
    ["GET", "/api/drawings/:id", handleGetDrawing],
    ["PUT", "/api/drawings/:id", handlePutDrawing],

    // Practice operations. The register is a separate create path from
    // /api/projects on purpose: that one is the planner's, and it requires a
    // document because a canvas with no drawing cannot be saved. A strata
    // report has no geometry and must not have to invent an empty one.
    ["GET", "/api/practice/reference", handleReference],
    ["GET", "/api/register", handleListRegister],
    ["POST", "/api/register", handleCreateRegisterProject],
    ["GET", "/api/register/:id", handleGetRegisterProject],
    ["PATCH", "/api/register/:id", handleUpdateRegisterProject],
    ["GET", "/api/projects/:id/financials", handleFinancials],
    ["GET", "/api/projects/:id/fee-schedule", handleGetFeeSchedule],
    ["PUT", "/api/projects/:id/fee-schedule", handleSetFeeSchedule],

    ["GET", "/api/time-entries", handleListTimeEntries],
    ["POST", "/api/time-entries", handleCreateTimeEntry],
    ["DELETE", "/api/time-entries/:id", handleDeleteTimeEntry],

    ["GET", "/api/projects/:id/certificates", handleListCertificates],
    ["POST", "/api/projects/:id/certificates", handleCreateCertificate],
    ["GET", "/api/certificates/:id", handleGetCertificate],
    ["POST", "/api/certificates/:id/lines", handleAddScheduleLine],
    ["POST", "/api/certificates/:id/lines-from-time", handleAddLinesFromTime],
    ["POST", "/api/certificates/:id/write-downs", handleAddWriteDown],
    ["POST", "/api/certificates/:id/issue", handleIssueCertificate],

    ["POST", "/api/visualize", handleVisualize],
  ]);

  const context = {
    pool, secureCookies, allowedOrigins, rateLimiter, openaiApiKey, openaiFetch,
  };

  /** Returns true when it handled the request, so a static handler can follow. */
  return async function api(req, res) {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/api/")) return false;

    applyCors(req, res, allowedOrigins);
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return true;
    }

    const route = match(req.method, url.pathname);
    if (!route) {
      sendJson(res, 404, { error: "No such endpoint" });
      return true;
    }

    try {
      await route.handler({ req, res, url, params: route.params, ...context });
    } catch (error) {
      if (error instanceof ConflictError) {
        // The row moved under this writer. Send theirs, because the user is
        // about to choose between two documents and cannot choose blind.
        sendJson(res, 409, {
          error: "This drawing changed elsewhere",
          revision: error.current.revision,
          drawing: error.current,
        });
      } else if (error instanceof DuplicateCodeError) {
        // Named, because "that code is already in use" sends someone to the
        // register and a bare 409 sends them to look for a bug.
        sendJson(res, 409, { error: error.message, code: error.projectCode });
      } else if (error instanceof IssuedError) {
        sendJson(res, 409, {
          error: "That certificate has been issued and cannot be changed",
          certificateId: error.certificateId,
        });
      } else if (error instanceof ValidationError) {
        sendJson(res, 400, { error: error.message });
      } else if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message, ...error.extra });
      } else if (error instanceof AuthError) {
        sendJson(res, error.status, { error: error.message, code: error.code });
      } else {
        // Never the message: a driver error can carry a query, and a query here
        // carries another firm's ids.
        console.error("unhandled", error);
        sendJson(res, 500, { error: "Something went wrong" });
      }
    }
    return true;
  };
}

// --- auth ------------------------------------------------------------------

async function handleSignUp({ req, res, pool, secureCookies }) {
  const body = (await readJsonBody(req)) || {};
  const account = await signUp(pool, body);
  setSession(res, account.token, secureCookies);
  sendJson(res, 201, sessionPayload(account));
}

async function handleSignIn({ req, res, pool, secureCookies, rateLimiter }) {
  const body = (await readJsonBody(req)) || {};
  // Keyed by address and email together: one shared office IP must not lock
  // out a colleague, and one leaked address must not be attackable from a
  // thousand hosts.
  const key = `${clientAddress(req)}|${String(body.email || "").toLowerCase()}`;
  if (!rateLimiter.check(key)) {
    throw new AuthError(429, "Too many sign-in attempts. Try again shortly.");
  }
  const account = await signIn(pool, body);
  rateLimiter.clear(key);
  setSession(res, account.token, secureCookies);
  sendJson(res, 200, sessionPayload(account));
}

async function handleSignOut({ req, res, pool, secureCookies }) {
  await revokeSession(pool, parseCookies(req.headers.cookie)[SESSION_COOKIE]);
  res.setHeader("Set-Cookie", clearedCookie(SESSION_COOKIE, { secure: secureCookies }));
  sendJson(res, 200, { signedIn: false });
}

async function handleSession({ req, res, pool }) {
  const session = await currentSession(pool, req);
  if (!session) return sendJson(res, 200, { signedIn: false });
  // Being here, online, is what renews the offline lease (§6).
  const offlineUntil = await refreshOfflineLease(pool, session.sessionId);
  sendJson(res, 200, { signedIn: true, ...sessionPayload({ ...session, offlineUntil }) });
}

// --- the library -----------------------------------------------------------

async function handleListProjects({ req, res, pool, url }) {
  const store = await requireStore(pool, req);
  const includeDeleted = url.searchParams.get("deleted") === "1";
  sendJson(res, 200, { projects: await store.listProjects({ includeDeleted }) });
}

async function handleCreateProject({ req, res, pool }) {
  const session = await requireSession(pool, req);
  const body = (await readJsonBody(req)) || {};
  const doc = requireDoc(body.doc);
  // A job and its drawing are one unit: a project with no drawing would open
  // to an empty canvas that cannot be saved.
  const created = await withTransaction(pool, (client) => (
    openStore(client, session).createProject({
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : null,
      packId: body.packId ?? doc.packId ?? null,
      doc,
      drawingId: typeof doc.id === "string" && doc.id ? doc.id : undefined,
    })
  ));
  sendJson(res, 201, { project: created });
}

/**
 * Open: the project, its drawing, and the revision the client must send back on
 * its first save. Marks the job as opened, which is what the library orders by.
 */
async function handleOpenProject({ req, res, pool, params }) {
  const store = await requireStore(pool, req);
  const project = await store.getProject(params.id);
  if (!project) throw new HttpError(404, "No such job");
  // `drawing: null` rather than a 404. Most of the disciplines this practice
  // works in never produce one, and a register job that 404s on open is a job
  // the rest of the application cannot reach at all. The planner reads this
  // and asks to attach a drawing; everything else ignores it.
  const drawing = await store.getDrawingForProject(params.id);
  await store.touchOpened(params.id);
  const headers = drawing ? { ETag: revisionTag(drawing.revision) } : {};
  sendJson(res, 200, { project, drawing: drawing ?? null }, headers);
}

/** A canvas for a job that did not start with one. */
async function handleAttachDrawing({ req, res, pool, params }) {
  const session = await requireSession(pool, req);
  const body = (await readJsonBody(req)) || {};
  const doc = requireDoc(body.doc);
  const drawing = await withTransaction(pool, (client) => (
    openStore(client, session).createDrawingForProject(params.id, {
      doc,
      packId: body.packId ?? doc.packId ?? null,
      drawingId: typeof doc.id === "string" && doc.id ? doc.id : undefined,
    })
  ));
  if (!drawing) throw new HttpError(404, "No such job");
  sendJson(res, 201, { drawing }, { ETag: revisionTag(drawing.revision) });
}

async function handleRenameProject({ req, res, pool, params }) {
  const session = await requireSession(pool, req);
  const body = (await readJsonBody(req)) || {};
  if (!("name" in body)) throw new HttpError(400, "A name is required");
  const renamed = await withTransaction(pool, (client) => (
    openStore(client, session).renameProject(params.id, body.name)
  ));
  if (!renamed) throw new HttpError(404, "No such job");
  // The drawing's revision moved, because doc.name lives in the document. The
  // client adopts the one returned here or its next autosave collides with its
  // own rename.
  sendJson(res, 200, { project: renamed });
}

async function handleDuplicateProject({ req, res, pool, params }) {
  const session = await requireSession(pool, req);
  const copy = await withTransaction(pool, (client) => (
    openStore(client, session).duplicateProject(params.id)
  ));
  if (!copy) throw new HttpError(404, "No such job");
  sendJson(res, 201, { project: copy });
}

/**
 * Soft delete. The HTTP verb is DELETE because that is what the client is
 * asking for; the statement underneath is an UPDATE, and the response says so
 * by offering the restore path.
 */
async function handleDeleteProject({ req, res, pool, params }) {
  const session = await requireSession(pool, req);
  const deleted = await withTransaction(pool, (client) => (
    openStore(client, session).deleteProject(params.id)
  ));
  if (!deleted) throw new HttpError(404, "No such job");
  sendJson(res, 200, { deleted: deleted.id, restore: `/api/projects/${deleted.id}/restore` });
}

async function handleRestoreProject({ req, res, pool, params }) {
  const session = await requireSession(pool, req);
  const restored = await withTransaction(pool, (client) => (
    openStore(client, session).restoreProject(params.id)
  ));
  if (!restored) throw new HttpError(404, "No such deleted job");
  sendJson(res, 200, { project: restored });
}

// --- the drawing -----------------------------------------------------------

async function handleGetDrawing({ req, res, pool, params }) {
  const store = await requireStore(pool, req);
  const drawing = await store.getDrawing(params.id);
  if (!drawing) throw new HttpError(404, "No such drawing");
  sendJson(res, 200, { drawing }, { ETag: revisionTag(drawing.revision) });
}

/**
 * The autosave target. `If-Match` is required rather than optional: a write
 * with no stated expectation is a write that would overwrite a colleague's
 * work without either of them finding out, and 428 tells the client to go and
 * read the revision it should have kept.
 */
async function handlePutDrawing({ req, res, pool, params }) {
  const session = await requireSession(pool, req);
  const ifMatch = parseIfMatch(req.headers["if-match"]);
  if (ifMatch === null) {
    throw new HttpError(428, "An If-Match revision is required to save a drawing");
  }
  const body = (await readJsonBody(req)) || {};
  const doc = requireDoc(body.doc);
  if (doc.id && doc.id !== params.id) {
    // The document's own identity is the drawing's identity (§2). A mismatch
    // means the client is about to write one job over another.
    throw new HttpError(400, "That document's id does not match this drawing");
  }
  const saved = await withTransaction(pool, (client) => (
    openStore(client, session).putDrawing(params.id, { doc, packId: body.packId, ifMatch })
  ));
  if (!saved) throw new HttpError(404, "No such drawing");
  sendJson(res, 200, { drawing: saved }, { ETag: revisionTag(saved.revision) });
}

// --- the register ----------------------------------------------------------

/**
 * Everything the practice-ops screens need to render a form, in one call: the
 * firm's own type list and tariff bands from its rows, and the closed
 * vocabularies from the source module. Sent together because a register form
 * that arrives before its type dropdown does is a form that offers free text,
 * which is how the workbook ended up with `DISPUTE`, `Dispute` and `dispute`.
 */
async function handleReference({ req, res, pool }) {
  const store = await requireStore(pool, req);
  sendJson(res, 200, {
    projectTypes: await store.listProjectTypes(),
    rateBands: await store.listRateBands(),
    activityTypes: ACTIVITY_TYPES,
    writeDownReasons: WRITE_DOWN_REASONS,
    billingBases: BILLING_BASES,
    projectStatuses: PROJECT_STATUSES,
  });
}

async function handleListRegister({ req, res, pool, url }) {
  const store = await requireStore(pool, req);
  const includeDeleted = url.searchParams.get("deleted") === "1";
  sendJson(res, 200, { projects: await store.listRegister({ includeDeleted }) });
}

async function handleGetRegisterProject({ req, res, pool, params }) {
  const store = await requireStore(pool, req);
  const project = await store.getRegisterProject(params.id);
  if (!project) throw new HttpError(404, "No such job");
  sendJson(res, 200, { project });
}

async function handleCreateRegisterProject({ req, res, pool }) {
  const session = await requireSession(pool, req);
  const body = (await readJsonBody(req)) || {};
  const project = await withTransaction(pool, (client) => (
    openStore(client, session).createRegisterProject(body)
  ));
  sendJson(res, 201, { project });
}

async function handleUpdateRegisterProject({ req, res, pool, params }) {
  const session = await requireSession(pool, req);
  const body = (await readJsonBody(req)) || {};
  const project = await withTransaction(pool, (client) => (
    openStore(client, session).updateRegisterProject(params.id, body)
  ));
  if (!project) throw new HttpError(404, "No such job");
  sendJson(res, 200, { project });
}

async function handleFinancials({ req, res, pool, params }) {
  const store = await requireStore(pool, req);
  const financials = await store.projectFinancials(params.id);
  if (!financials) throw new HttpError(404, "No such job");
  sendJson(res, 200, { financials });
}

async function handleGetFeeSchedule({ req, res, pool, params }) {
  const store = await requireStore(pool, req);
  const project = await store.getProject(params.id);
  if (!project) throw new HttpError(404, "No such job");
  sendJson(res, 200, { feeSchedule: await store.listFeeSchedule(params.id) });
}

/**
 * PUT, not PATCH, and no per-line route. The schedule is the agreed breakdown
 * of one fee, and a client that could add a phase without restating the rest
 * would be able to leave a revision half applied - phases that no longer sum
 * to the number the firm quoted.
 */
async function handleSetFeeSchedule({ req, res, pool, params }) {
  const session = await requireSession(pool, req);
  const body = (await readJsonBody(req)) || {};
  const feeSchedule = await withTransaction(pool, (client) => (
    openStore(client, session).setFeeSchedule(params.id, body.lines)
  ));
  if (!feeSchedule) throw new HttpError(404, "No such job");
  sendJson(res, 200, { feeSchedule });
}

// --- the timesheet ---------------------------------------------------------

async function handleListTimeEntries({ req, res, pool, url }) {
  const store = await requireStore(pool, req);
  sendJson(res, 200, {
    entries: await store.listTimeEntries({
      projectId: blankToNull(url.searchParams.get("project")),
      personId: blankToNull(url.searchParams.get("person")),
      from: blankToNull(url.searchParams.get("from")),
      to: blankToNull(url.searchParams.get("to")),
    }),
  });
}

/**
 * Logging time. The response carries the project's financials back with the
 * entry, so the timesheet can show burn against the fee as the row lands
 * rather than on a page somebody visits once a month. That warning, at that
 * moment, is worth more than the overview it would otherwise appear on.
 */
async function handleCreateTimeEntry({ req, res, pool }) {
  const session = await requireSession(pool, req);
  const body = (await readJsonBody(req)) || {};
  const result = await withTransaction(pool, async (client) => {
    const store = openStore(client, session);
    const entry = await store.createTimeEntry(body);
    if (!entry) return null;
    return { entry, financials: await store.projectFinancials(entry.projectId) };
  });
  if (!result) throw new HttpError(404, "No such job");
  sendJson(res, 201, result);
}

async function handleDeleteTimeEntry({ req, res, pool, params }) {
  const session = await requireSession(pool, req);
  const deleted = await withTransaction(pool, (client) => (
    openStore(client, session).deleteTimeEntry(params.id)
  ));
  if (!deleted) throw new HttpError(404, "No such time entry");
  sendJson(res, 200, { deleted: deleted.id });
}

// --- certificates ----------------------------------------------------------

async function handleListCertificates({ req, res, pool, params }) {
  const store = await requireStore(pool, req);
  const project = await store.getProject(params.id);
  if (!project) throw new HttpError(404, "No such job");
  sendJson(res, 200, { certificates: await store.listCertificates(params.id) });
}

async function handleCreateCertificate({ req, res, pool, params }) {
  const session = await requireSession(pool, req);
  const body = (await readJsonBody(req)) || {};
  const certificate = await withTransaction(pool, (client) => (
    openStore(client, session).createCertificate(params.id, {
      periodStart: blankToNull(body.periodStart),
      periodEnd: blankToNull(body.periodEnd),
    })
  ));
  if (!certificate) throw new HttpError(404, "No such job");
  sendJson(res, 201, { certificate });
}

async function handleGetCertificate({ req, res, pool, params }) {
  const store = await requireStore(pool, req);
  const certificate = await store.getCertificate(params.id);
  if (!certificate) throw new HttpError(404, "No such certificate");
  sendJson(res, 200, { certificate });
}

async function handleAddScheduleLine({ req, res, pool, params }) {
  const session = await requireSession(pool, req);
  const body = (await readJsonBody(req)) || {};
  const certificate = await withTransaction(pool, (client) => (
    openStore(client, session).addScheduleLine(params.id, body)
  ));
  if (!certificate) throw new HttpError(404, "No such certificate");
  sendJson(res, 200, { certificate });
}

async function handleAddLinesFromTime({ req, res, pool, params }) {
  const session = await requireSession(pool, req);
  const body = (await readJsonBody(req)) || {};
  const certificate = await withTransaction(pool, (client) => (
    openStore(client, session).addCertificateLinesFromTime(params.id, {
      from: blankToNull(body.from),
      to: blankToNull(body.to),
    })
  ));
  if (!certificate) throw new HttpError(404, "No such certificate");
  sendJson(res, 200, { certificate });
}

async function handleAddWriteDown({ req, res, pool, params }) {
  const session = await requireSession(pool, req);
  const body = (await readJsonBody(req)) || {};
  const certificate = await withTransaction(pool, (client) => (
    openStore(client, session).addWriteDown(params.id, body)
  ));
  if (!certificate) throw new HttpError(404, "No such certificate");
  sendJson(res, 200, { certificate });
}

async function handleIssueCertificate({ req, res, pool, params }) {
  const session = await requireSession(pool, req);
  const certificate = await withTransaction(pool, (client) => (
    openStore(client, session).issueCertificate(params.id)
  ));
  if (!certificate) throw new HttpError(404, "No such certificate");
  sendJson(res, 200, { certificate });
}

// --- visualization ---------------------------------------------------------

async function handleVisualize({ req, res, pool, rateLimiter, openaiApiKey, openaiFetch }) {
  const session = await requireSession(pool, req);
  if (!String(openaiApiKey || "").trim()) {
    throw new HttpError(503, "Visualization is not configured");
  }
  if (!rateLimiter.check(`visualize|${session.userId}`)) {
    throw new AuthError(429, "Too many visualization requests. Try again shortly.");
  }
  const body = (await readJsonBody(req)) || {};
  try {
    const image = await generateVisualization({
      apiKey: openaiApiKey,
      image: body.image,
      fetch: openaiFetch,
    });
    sendJson(res, 200, { image });
  } catch (error) {
    if (error.status === 400) throw new HttpError(400, "A drawing image is required");
    if (error.status === 503) throw new HttpError(503, "Visualization is not configured");
    if (error.status === 402) throw new HttpError(402, error.message);
    console.error("visualize failed", error.status || 502, error.code || "");
    throw new HttpError(502, "The visualization could not be generated");
  }
}

// --- shared ----------------------------------------------------------------

/**
 * An empty form field is "no filter", not a value.
 *
 * A blank date input posts `""`, and `"" ?? null` is still `""`, which reaches
 * Postgres as `''::date` and fails the whole statement. The visible symptom is
 * a button that appears to do nothing - which is exactly how "pull unbilled
 * time" behaved before this existed.
 */
function blankToNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/** `1`/`true` on, `0`/`false` off, unset falls back - never a truthy string. */
function envFlag(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const raw = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function sessionPayload(session) {
  return {
    userId: session.userId,
    email: session.email,
    orgId: session.orgId ?? null,
    orgName: session.orgName ?? null,
    role: session.role ?? null,
    memberSince: session.memberSince ? new Date(session.memberSince).toISOString() : null,
    offlineUntil: session.offlineUntil ?? null,
  };
}

function setSession(res, token, secure) {
  res.setHeader("Set-Cookie", sessionCookie(SESSION_COOKIE, token, {
    maxAgeMs: SESSION_TTL_MS,
    secure,
  }));
}

function currentSession(pool, req) {
  return resolveSession(pool, parseCookies(req.headers.cookie)[SESSION_COOKIE]);
}

async function requireSession(pool, req) {
  const session = await currentSession(pool, req);
  if (!session) throw new AuthError(401, "Sign in to continue");
  return session;
}

/** The only way a handler gets at a firm's rows. */
async function requireStore(pool, req) {
  return openStore(pool, await requireSession(pool, req));
}

function requireDoc(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new HttpError(400, "A document object is required");
  }
  return doc;
}

/**
 * `If-Match: "7"`, `If-Match: 7`, or `W/"7"`. Returns null when the header is
 * absent or unusable - not 0, which is a revision a caller could legitimately
 * have held. `*` is rejected: it means "any existing version", which is the
 * blind overwrite this header exists to prevent.
 */
function parseIfMatch(header) {
  if (header === undefined || header === null) return null;
  const raw = String(header).trim().replace(/^W\//, "").replace(/^"|"$/g, "");
  if (!/^\d+$/.test(raw)) return null;
  return raw;
}

function revisionTag(revision) {
  return `"${revision}"`;
}

function clientAddress(req) {
  // Only trusted behind a proxy that sets it; direct exposure means this header
  // is client-controlled and the socket address is the honest value.
  const forwarded = process.env.TRUST_PROXY === "1" && req.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

/**
 * The planner is served from this same origin in the normal case, so CORS is
 * off unless an origin is explicitly allowed - which is for developing the
 * client on a different port. An allowlist, never a reflected `*`, because
 * these responses carry a credentialed cookie.
 */
function applyCors(req, res, allowedOrigins) {
  const origin = req.headers.origin;
  if (!origin || !allowedOrigins.includes(origin)) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,If-Match");
  res.setHeader("Access-Control-Expose-Headers", "ETag");
  res.setHeader("Vary", "Origin");
}
