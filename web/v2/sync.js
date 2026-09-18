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
