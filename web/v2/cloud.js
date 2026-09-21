// The client half of the system of record: accounts and the job library.
//
// Deliberately not in sync.js. That file is the drawing's save path, and its
// contract - coalesce, then overwrite against an If-Match revision - is right
// for a canvas someone is dragging walls around in and wrong for anything that
// is a record. Keeping the two apart is what stops a quote or a legal document
// from inheriting a scheduler built for geometry (SCHEMA.md, and §14 of the
// plan). What lives here is ordinary request-and-response.

import { DOC_STORE_KEY, hasJobContent, normalizeDoc } from "./model.js";

/** The name the plan gives whatever was already in the browser's one slot. */
export const RECOVERED_NAME = "Recovered drawing";

export class CloudError extends Error {
  constructor(status, message) {
    super(message || "The server could not be reached");
    this.name = "CloudError";
    this.status = status;
    this.authRequired = status === 401;
  }
}

export function createCloud({
  baseUrl = "",
  fetch: fetchImpl = globalThis.fetch?.bind(globalThis),
} = {}) {
  async function call(method, path, body) {
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        // The session is an httpOnly cookie. Nothing here holds a token.
        credentials: "include",
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      // No network at all. Status 0 rather than a guess at what it might have
      // been, so a caller can tell "unreachable" from "refused".
      throw new CloudError(0, "No connection to the server");
    }
    const text = await res.text();
    const payload = text ? safeParse(text) : null;
    if (!res.ok) throw new CloudError(res.status, payload?.error);
    return payload;
  }

  return {
    // --- accounts -----------------------------------------------------

    /** Null when signed out. Also renews the offline lease, server-side. */
    async session() {
      const body = await call("GET", "/api/auth/session");
      return body?.signedIn ? body : null;
    },

    signUp({ email, password, orgName }) {
      return call("POST", "/api/auth/sign-up", { email, password, orgName });
    },

    signIn({ email, password }) {
      return call("POST", "/api/auth/sign-in", { email, password });
    },

    signOut() {
      return call("POST", "/api/auth/sign-out");
    },

    // --- the library --------------------------------------------------

    async listProjects({ includeDeleted = false } = {}) {
      const body = await call("GET", `/api/projects${includeDeleted ? "?deleted=1" : ""}`);
      return body?.projects ?? [];
    },

    /**
     * The document goes up as it is, ids included: `emptyDoc()` already minted
     * the drawing's identity, and the server keys the row by it rather than
     * handing out one of its own (§2).
     */
    async createProject({ name = null, doc, packId = null }) {
      const body = await call("POST", "/api/projects", { name, doc, packId });
      return body?.project ?? null;
    },

    /** The project, its drawing, and the revision the first save must match. */
    async openProject(projectId) {
      return call("GET", `/api/projects/${encodeURIComponent(projectId)}`);
    },

    async renameProject(projectId, name) {
      const body = await call("PATCH", `/api/projects/${encodeURIComponent(projectId)}`, { name });
      return body?.project ?? null;
    },

    async duplicateProject(projectId) {
      const body = await call("POST", `/api/projects/${encodeURIComponent(projectId)}/duplicate`);
      return body?.project ?? null;
    },

    /** Soft, and the response carries the path that undoes it. */
    deleteProject(projectId) {
      return call("DELETE", `/api/projects/${encodeURIComponent(projectId)}`);
    },

    restoreProject(projectId) {
      return call("POST", `/api/projects/${encodeURIComponent(projectId)}/restore`);
    },

    /** Snapshot in, photorealistic visualization out. The key stays on the server. */
    async visualize({ image }) {
      const body = await call("POST", "/api/visualize", { image });
      return body?.image ?? null;
    },
  };
}

/**
 * Whatever sits in the old `localStorage` key is real work - in your browser
 * and in any tester's - so on the first successful sign-in it becomes a project
 * rather than being dropped (§9).
 *
 * Three rules, and each one is there because the alternative loses something:
 *
 *  - The key is removed only *after* the upload is confirmed. A failed upload
 *    leaves it exactly where it was, so the next sign-in tries again.
 *  - An empty document is discarded without an upload, but the key is still
 *    cleared: otherwise every future sign-in re-checks a document that will
 *    never be worth keeping. `hasJobContent()` is what decides, so a job that
 *    is so far only a site boundary or only openings still counts as work.
 *  - A document that will not parse is left in place untouched. It is somebody's
 *    only copy of something, and a clear-on-failure would be the one action
 *    that cannot be undone.
 */
export async function importLocalDocument({ storage, cloud, key = DOC_STORE_KEY }) {
  if (!storage) return null;

  let raw;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { imported: null, reason: "unreadable" };
  }

  const doc = normalizeDoc(parsed);
  if (!hasJobContent(doc)) {
    storage.removeItem(key);
    return { imported: null, reason: "empty" };
  }

  // The document may predate identity and have been given an id by
  // normalizeDoc() just now; either way that id becomes the drawing's.
  const project = await cloud.createProject({
    name: doc.name || RECOVERED_NAME,
    doc,
    packId: doc.packId ?? null,
  });
  storage.removeItem(key);
  return { imported: project, reason: "recovered" };
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
