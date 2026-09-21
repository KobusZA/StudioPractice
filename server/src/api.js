// The HTTP surface. Thin on purpose: a handler authenticates, then asks an
// org-scoped store for something. No handler names an org id, and none of them
// can - see store.js.

import {
  AuthError, RateLimiter, SESSION_COOKIE, SESSION_TTL_MS,
  refreshOfflineLease, resolveSession, revokeSession, signIn, signUp,
} from "./auth.js";
import { ConflictError, openStore } from "./store.js";
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

    ["GET", "/api/drawings/:id", handleGetDrawing],
    ["PUT", "/api/drawings/:id", handlePutDrawing],

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
  const drawing = await store.getDrawingForProject(params.id);
  if (!drawing) throw new HttpError(404, "That job has no drawing");
  await store.touchOpened(params.id);
  sendJson(res, 200, { project, drawing }, { ETag: revisionTag(drawing.revision) });
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
