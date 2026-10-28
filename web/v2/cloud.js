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

    // --- the rate book --------------------------------------------------

    /**
     * What a BOQ prices this job's drawing against. Rates are referenced, never
     * embedded in the pack or the saved document (SCHEMA.md #4), so this is a
     * separate read rather than part of the drawing.
     */
    async rateBook(rateBookId) {
      const body = await call("GET", `/api/rate-books/${encodeURIComponent(rateBookId)}`);
      return body?.rateBook ?? null;
    },

    /** The book a job registered today would be priced against, or null. */
    async defaultRateBookId() {
      const body = await call("GET", "/api/rate-books");
      return (body?.rateBooks ?? []).find((book) => book.isDefault)?.id ?? null;
    },

    /**
     * Add one line to the firm's default rate book (the "Save to firm library"
     * on a finish product). Owner-only: the server refuses anyone else, and the
     * whole book is written back the way the rate book page does. A model the
     * book already prices is left as it is, never overwritten.
     * Resolves `{ added, bookName }`; `added` is false when it was already there.
     */
    async addRateBookLine(line) {
      const books = (await call("GET", "/api/rate-books"))?.rateBooks ?? [];
      const header = books.find((book) => book.isDefault);
      if (!header) throw new CloudError(404, "The firm has no default rate book to add to");
      const book = (await call("GET", `/api/rate-books/${encodeURIComponent(header.id)}`))?.rateBook;
      const rates = book?.rates ?? [];
      if (rates.some((r) => (r.model || "").toUpperCase() === String(line.model).toUpperCase())) {
        return { added: false, bookName: book?.name ?? header.name };
      }
      await call("PUT", `/api/rate-books/${encodeURIComponent(header.id)}`, {
        name: book.name,
        effectiveFrom: book.effectiveFrom,
        note: book.note,
        symbol: book.symbol,
        rates: [...rates, line],
      });
      return { added: true, bookName: book.name };
    },

    /**
     * Store the open plan file on the job. The bytes are not part of the
     * drawing save: the drawing only records the id this returns.
     */
    async saveUnderlay(projectId, bytes, mime, { onProgress } = {}) {
      const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/assets`;
      // fetch cannot report upload progress, so an XHR is used only when asked.
      if (typeof onProgress === "function" && typeof XMLHttpRequest !== "undefined") {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", url);
          xhr.withCredentials = true;
          xhr.setRequestHeader("Content-Type", mime || "application/octet-stream");
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && e.total > 0) onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
          };
          xhr.onerror = () => reject(new CloudError(0, "No connection to the server"));
          xhr.onabort = () => reject(new CloudError(0, "No connection to the server"));
          xhr.onload = () => {
            const payload = xhr.responseText ? safeParse(xhr.responseText) : null;
            if (xhr.status >= 200 && xhr.status < 300) resolve(payload?.asset ?? null);
            else reject(new CloudError(xhr.status, payload?.error));
          };
          xhr.send(bytes);
        });
      }
      let res;
      try {
        res = await fetchImpl(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}/assets`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": mime || "application/octet-stream" },
          body: bytes,
        });
      } catch {
        throw new CloudError(0, "No connection to the server");
      }
      const text = await res.text();
      const payload = text ? safeParse(text) : null;
      if (!res.ok) throw new CloudError(res.status, payload?.error);
      return payload?.asset ?? null;
    },

    /** The file already on this job with these bytes, or null. Asked before an upload so a copy is not sent twice. */
    async findUnderlay(projectId, sha256, mime) {
      const body = await call("POST", `/api/projects/${encodeURIComponent(projectId)}/assets/lookup`, { sha256, mime });
      return body?.asset ?? null;
    },

    /** The stored file. `{ bytes, mime }`, or throws the same way a JSON call does. */
    async fetchAsset(assetId) {
      let res;
      try {
        res = await fetchImpl(`${baseUrl}/api/assets/${encodeURIComponent(assetId)}`, {
          credentials: "include",
        });
      } catch {
        throw new CloudError(0, "No connection to the server");
      }
      if (!res.ok) {
        const text = await res.text();
        const payload = text ? safeParse(text) : null;
        throw new CloudError(res.status, payload?.error);
      }
      return {
        bytes: await res.arrayBuffer(),
        mime: (res.headers.get("content-type") || "").split(";")[0].trim(),
      };
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
