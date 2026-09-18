// The drawing's save path: one coalescing writer between PlanStore and
// wherever the document actually lives.
//
// PlanStore used to call storage.setItem() and swallow the error, which is
// defensible for localStorage and indefensible over a network: a write that
// failed would leave the editor looking saved. So every mutation still calls
// store.persist(), but persist() now hands the document to a sink, and the sink
// reports one of a small set of states the chrome must show honestly. An
// unconfirmed write is unknown, and unknown never renders as "Saved".
//
// Scope, deliberately: this file is for the drawing and nothing else. Its
// contract is coalesce-then-overwrite with an If-Match revision, which suits a
// canvas someone is dragging walls around in. A quote or a legal document is a
// record - issued once, immutable after, worthless without an audit trail - and
// must get ordinary CRUD instead. Reusing this scheduler for one would trade
// that audit property for convenience, silently.
//
// The timer and the transport are injected so the scheduler is testable without
// a network and without waiting in real time.

import { DOC_STORE_KEY } from "./model.js";

/**
 * What the chrome is allowed to say.
 *
 *  saved    - the transport confirmed this exact document.
 *  pending  - edited, waiting out the debounce. Not saved.
 *  saving   - a write is in flight. Not saved.
 *  offline  - the write failed; the documents behind it are queued, in order.
 *  conflict - the row moved under us. Writing has stopped and the user chooses.
 */
export const SYNC_KINDS = ["saved", "pending", "saving", "offline", "conflict"];

export const DEFAULT_DEBOUNCE_MS = 1500;

/**
 * The signature that decides whether a write is needed at all, and the
 * beforeunload guard. Carried over unchanged from the file-based spec: the
 * serialised document is the payload, so the serialised document is the
 * comparison.
 */
export function docSignature(doc) {
  return JSON.stringify(doc);
}

export function syncStateLabel(state) {
  const queued = state?.queued || 0;
  switch (state?.kind) {
    case "saved": return "Saved";
    case "pending":
    case "saving": return "Saving…";
    case "offline": return `Offline — ${queued} change${queued === 1 ? "" : "s"} queued`;
    case "conflict": return "Changed elsewhere";
    default: return "—";
  }
}

/**
 * Writes the document to `localStorage` under the key it has always used, in
 * the format it has always used: a bare document, so the one-time import of
 * whatever a tester already has can still read it. Revisions are counted in
 * memory only - nothing local can hand out an authoritative one - so this
 * transport never reports a conflict. Quota and private mode throw, which the
 * scheduler treats as a failed write and reports rather than hides.
 */
export function localTransport(storage, { key = DOC_STORE_KEY } = {}) {
  let revision = 0;
  return {
    read() {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    },
    async put({ doc }) {
      storage.setItem(key, JSON.stringify(doc));
      revision += 1;
      return { ok: true, revision };
    },
  };
}

/**
 * The real transport: `GET`/`PUT /api/drawings/:id` with an `If-Match`
 * revision, against the server that is now the system of record.
 *
 * The three outcomes the scheduler distinguishes map onto HTTP exactly, which
 * is why the contract was written this way before a network existed:
 *
 *   200  the write landed; adopt the revision it returns.
 *   409  the row moved under us. Their revision and their document come back
 *        with the refusal, because the user is about to choose between two
 *        documents and cannot choose blind. Never merged.
 *   else the write did not happen - a dropped connection, a 500, a 502 from
 *        something in front of the server - so it throws and the scheduler
 *        queues, reporting "Offline - N changes queued" rather than "Saved".
 *
 * A 401 is deliberately not a queued write: the session expired, the document
 * is not going to land however long the queue waits, and saying so is the only
 * honest option. It surfaces as `authRequired` so the chrome can ask for a
 * sign-in rather than showing a save state that will never resolve.
 */
export function httpTransport({
  drawingId,
  baseUrl = "",
  fetch: fetchImpl = globalThis.fetch?.bind(globalThis),
  onAuthRequired = () => {},
} = {}) {
  if (!drawingId) throw new Error("httpTransport needs a drawingId");
  const url = `${baseUrl}/api/drawings/${encodeURIComponent(drawingId)}`;

  async function request(method, { body, headers = {}, keepalive = false } = {}) {
    const res = await fetchImpl(url, {
      method,
      // The session is an httpOnly cookie, so it has to be asked for by name.
      credentials: "include",
      keepalive,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res;
  }

  return {
    drawingId,

    async read() {
      const res = await request("GET");
      if (res.status === 404) return null;
      if (res.status === 401) {
        onAuthRequired();
        throw new AuthRequiredError();
      }
      if (!res.ok) throw new Error(`GET drawing failed: ${res.status}`);
      const body = await res.json();
      return body?.drawing ?? null;
    },

    /**
     * `keepalive` is set for the visibilitychange and beforeunload flush, which
     * is the one path where the page may be gone before the response arrives.
     */
    async put({ doc, revision, keepalive = false }) {
      const res = await request("PUT", {
        body: { doc },
        headers: { "If-Match": String(revision ?? 0) },
        keepalive,
      });

      if (res.status === 401) {
        onAuthRequired();
        throw new AuthRequiredError();
      }
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        return {
          ok: false,
          conflict: true,
          revision: body?.revision ?? null,
          doc: body?.drawing?.doc ?? null,
        };
      }
      if (!res.ok) {
        // Includes 428 (no If-Match) and 400 (the document's id is not this
        // drawing's). Both are bugs on this side rather than conditions to wait
        // out, but the honest report to the user is still "not saved".
        throw new Error(`PUT drawing failed: ${res.status}`);
      }

      const body = await res.json();
      return { ok: true, revision: body?.drawing?.revision ?? null };
    },
  };
}

export class AuthRequiredError extends Error {
  constructor() {
    super("Sign in to keep saving");
    this.name = "AuthRequiredError";
    this.authRequired = true;
  }
}

/**
 * A transport returns `{ ok: true, revision }`, or `{ ok: false, conflict:
 * true, revision, doc }` when the row moved, or throws for anything that
 * amounts to "the write did not happen" - no network, quota, a 500.
 */
export class DocSync {
  constructor({
    transport,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (handle) => clearTimeout(handle),
    onState = () => {},
    revision = 0,
  } = {}) {
    this.transport = transport;
    this.debounceMs = debounceMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.onState = onState;
    this.revision = revision;

    this.queue = [];
    this.timer = null;
    this.inFlight = null;
    this.conflict = null;
    this.savedSignature = null;
    this.state = { kind: "saved", queued: 0, revision, conflict: null };
  }

  // --- the PlanStore sink interface --------------------------------------

  /**
   * Called by every mutation, via store.persist(). Cheap on purpose: it
   * serialises, compares, and schedules. Nothing here awaits.
   */
  save(doc) {
    const signature = docSignature(doc);
    if (signature === this.savedSignature && !this.queue.length) return;
    this.#enqueue({ doc: JSON.parse(signature), signature, id: doc?.id ?? null, sent: false });
    this.#schedule();
  }

  /**
   * Whatever the transport has, unnormalised. Null when it has nothing. The
   * signature is left unset on purpose: normalising can fill in an id the
   * stored document lacked, and that difference is a real, unconfirmed change.
   */
  load() {
    if (typeof this.transport?.read !== "function") return null;
    return this.transport.read();
  }

  /**
   * Declare that the transport already holds exactly this document - the boot
   * path after a load, and the landing point of both conflict resolutions.
   */
  adopt(doc, revision = this.revision) {
    this.#cancelTimer();
    this.savedSignature = docSignature(doc);
    this.revision = revision;
    this.queue = [];
    this.conflict = null;
    this.#setState("saved");
  }

  /**
   * Point this sync at a different drawing, which the transport already holds.
   * The navigation primitive: opening another job swaps the transport and
   * adopts that job's document and revision in one step.
   *
   * It refuses while anything is unconfirmed, because adopting would drop the
   * queue and those queued documents belong to the job being left. The caller
   * flushes first and handles the failure; turning that into a silent discard
   * is exactly the data loss this whole plan exists to stop.
   */
  attach({ transport, doc, revision }) {
    if (this.isDirty()) throw new Error("attach() while a write is unconfirmed");
    this.transport = transport;
    this.adopt(doc, revision);
  }

  /** True when the editor holds something the transport has not confirmed. */
  isDirty() {
    return Boolean(this.queue.length || this.inFlight);
  }

  // --- flushing ----------------------------------------------------------

  /**
   * Write now: the visibilitychange and beforeunload path, and what a test
   * calls instead of waiting out the debounce.
   */
  async flush() {
    this.#cancelTimer();
    if (this.inFlight) await this.inFlight;
    if (!this.queue.length || this.conflict) return this.state;
    this.inFlight = this.#drain();
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
    return this.state;
  }

  /** Retry after the network came back. */
  retry() {
    return this.flush();
  }

  // --- conflict resolution, never automatic ------------------------------

  /**
   * The user chose *reload theirs*. The caller has already put their document
   * into the store; the local queue is dropped, which is the whole point.
   */
  resolveWithTheirs(doc) {
    this.adopt(doc, this.conflict?.revision ?? this.revision);
  }

  /**
   * The user chose *overwrite with mine*. Their revision is adopted only so the
   * next If-Match matches; the queued documents are still sent, in order.
   */
  resolveWithMine() {
    if (this.conflict) {
      this.revision = this.conflict.revision ?? this.revision;
      this.conflict = null;
    }
    return this.flush();
  }

  // --- internals ---------------------------------------------------------

  /**
   * A further edit replaces the last queued document only while that document
   * has never been attempted - that is the coalescing a canvas needs. Anything
   * already sent keeps its place, so a write that is in flight or has failed is
   * still the document the transport sees next, in the order it was made.
   */
  #enqueue(entry) {
    const last = this.queue[this.queue.length - 1];
    if (last && !last.sent) this.queue[this.queue.length - 1] = entry;
    else this.queue.push(entry);
  }

  #schedule() {
    if (this.conflict) {
      this.#setState("conflict");
      return;
    }
    this.#cancelTimer();
    this.#setState(this.state.kind === "offline" ? "offline" : "pending");
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.flush();
    }, this.debounceMs);
  }

  #cancelTimer() {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  async #drain() {
    while (this.queue.length && !this.conflict) {
      const entry = this.queue[0];
      entry.sent = true;
      this.#setState("saving");
      let result;
      try {
        result = await this.transport.put({
          id: entry.id,
          doc: entry.doc,
          revision: this.revision,
        });
      } catch (error) {
        this.#setState("offline", { error });
        return;
      }
      if (result?.conflict) {
        this.conflict = { revision: result.revision ?? null, doc: result.doc ?? null };
        this.#setState("conflict");
        return;
      }
      if (!result?.ok) {
        this.#setState("offline", { error: result?.error ?? null });
        return;
      }
      if (this.queue[0] === entry) this.queue.shift();
      this.revision = result.revision ?? this.revision;
      this.savedSignature = entry.signature;
    }
    if (!this.conflict) this.#setState("saved");
  }

  #setState(kind, extra = {}) {
    this.state = {
      kind,
      queued: this.queue.length,
      revision: this.revision,
      conflict: this.conflict,
      ...extra,
    };
    this.onState(this.state);
  }
}
