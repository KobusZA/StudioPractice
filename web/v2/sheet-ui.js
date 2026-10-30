// DOM for multi-page plan sets: the import dialog, the per-level sheet chooser
// in the underlay panel, the reference panel for elevations and sections, and
// the small status bar ("sharpening", "re-pick the PDF").
//
// ui.js owns the planner state; this module is handed what it needs through
// `ctx` so it never imports underlay.js itself - ui.js imports that module with
// a cache-busting query, and a second import under another URL would be a
// second copy of the bitmaps.

import {
  REFERENCE_DPI,
  PLACEABLE_KINDS,
  PRINTED_SCALES,
  addSource,
  applyRevision,
  matchRevision,
  pagesOfSource,
  removeSource,
  replaceSource,
  sourceLoss,
  sourceOf,
  applyCorrectionToOthers,
  cleanSheetTitle,
  createSheetSet,
  defaultLevelForKind,
  formatPrintedScale,
  guessPrintedScale,
  isPlanPage,
  movePageToLevel,
  movePlansOnLevel,
  pagesForLevel,
  parsePrintedScale,
  parseSheetKind,
  placePage,
  recordCalibration,
  reorderPage,
  setPageShown,
  unplaceLoss,
  unplacePage,
  referenceDistanceMetres,
  correctionFactor,
  sameSheetGeometry,
  setCeilingHeight,
  setPageRole,
  setPageScale,
  suggestPrintedScale,
} from "./sheet-set.js";

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

/**
 * ctx: {
 *   doc(), levels() -> [{id, name, floorToCeiling}], activeLevel(),
 *   mount (element for the status chips),
 *   underlay: { openPdf, renderThumbnail, discardPendingPdf, commitPendingPdf, adoptSheetSet,
 *               ensureSheetBitmap, chooseSheet, hasOpenPdf, sheetSetNeedsPdf,
 *               renderReferencePage, setSharpListener, ensurePageLinework, snapReferencePixel },
 *   pdfSnap: { enabled, setEnabled, available, status, stats },
 *   setStatus(text, tone), changed() (persist, redraw), levelsChanged(), addFloor(), canAddFloor()
 * }
 */
export function createSheetUi(ctx) {
  const api = ctx.underlay;

  // --- status bar -----------------------------------------------------------
  const sharpChip = h("span", { class: "sheet-set-chip", hidden: true, text: "Sharpening…" });
  const snapCheck = h("input", { type: "checkbox", checked: true });
  const snapNote = h("span", { class: "sheet-set-snap-note" });
  const snapLabel = h("label", {
    class: "sheet-set-snap",
    hidden: true,
    title: "Pull calibration, alignment and tracing clicks onto the PDF's own corners and crossings",
  }, snapCheck, " Snap to PDF lines", snapNote);
  snapCheck.addEventListener("change", () => ctx.pdfSnap?.setEnabled(snapCheck.checked));
  const repickText = h("span", { text: "Plan PDF not loaded." });
  const repickButton = h("button", { type: "button", text: "Choose PDF…", onclick: () => pickPdfFile(repick) });
  const repickBar = h("div", { class: "sheet-set-repick", hidden: true }, repickText, repickButton);
  // The sheets list: every page of the PDF, on the plan corner. Drawn pages
  // and pages left off the plan are separate tabs.
  const sheetsList = h("div", { class: "sheet-set-list" });
  const sheetsToggle = h("button", { type: "button", class: "sheet-set-list-head", "aria-expanded": "true", onclick: () => {
    const collapsed = sheetsCard.classList.toggle("is-collapsed");
    sheetsToggle.setAttribute("aria-expanded", String(!collapsed));
  } }, "Sheets");
  const sheetsClose = h("button", {
    type: "button",
    class: "sheet-set-list-close",
    title: "Close the sheet list",
    "aria-label": "Close sheet list",
    text: "\u00d7",
    onclick: (e) => {
      e.stopPropagation();
      setListVisible(false);
    },
  });
  const sheetsHead = h("div", { class: "sheet-set-list-bar" }, sheetsToggle, snapLabel, sheetsClose);
  let listTab = "drawn";
  const tabDrawn = h("button", { type: "button", class: "sheet-set-tab is-on", role: "tab", "aria-selected": "true", text: "Drawn" });
  const tabOther = h("button", { type: "button", class: "sheet-set-tab", role: "tab", "aria-selected": "false", text: "Not drawn" });
  const sheetsTabs = h("div", { class: "sheet-set-tabs", role: "tablist", "aria-label": "Which sheets" }, tabDrawn, tabOther);
  function pickTab(tab) {
    if (listTab === tab) return;
    listTab = tab;
    listSignature = "";
    syncList();
  }
  for (const [button, tab] of [[tabDrawn, "drawn"], [tabOther, "other"]]) {
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      pickTab(tab);
    });
  }
  const sheetsCard = h("div", { class: "sheet-set-card", hidden: true }, sheetsHead, sheetsTabs, sheetsList);
  const loadChip = h("span", { class: "sheet-set-chip", hidden: true });
  const uploadText = h("span", { text: "Saving plan file…" });
  const retryButton = h("button", { type: "button", text: "Retry", hidden: true });
  const uploadChip = h("span", { class: "sheet-set-chip is-upload", hidden: true, role: "status" }, uploadText, retryButton);
  const chips = h("div", { class: "sheet-set-chips" }, repickBar, loadChip, uploadChip, sharpChip);
  const bar = h("div", { class: "sheet-set-status" }, chips, sheetsCard);

  // --- saving the plan file ---------------------------------------------------
  // The sheet is already on screen; this only tracks the upload behind it.
  let uploading = false;
  let uploadFailed = false;
  window.addEventListener("beforeunload", (e) => {
    if (!uploading && !uploadFailed) return;
    e.preventDefault();
    e.returnValue = "The plan file is not on the job yet.";
  });

  /**
   * Run `run(onProgress)` (resolves with the stored id, null on failure, undefined
   * when there was nothing to store) behind a "Saving plan file…" chip. On failure
   * the chip offers Retry; the caller has already put the explanation in the status line.
   */
  async function trackUpload(run) {
    uploading = true;
    uploadFailed = false;
    retryButton.hidden = true;
    uploadText.textContent = "Saving plan file…";
    uploadChip.hidden = false;
    let result;
    try {
      result = await run((pct) => {
        uploadText.textContent = `Saving plan file… ${pct}%`;
      });
    } catch {
      result = null;
    }
    uploading = false;
    if (result === null) {
      uploadFailed = true;
      uploadText.textContent = "Plan file not saved.";
      retryButton.hidden = false;
      retryButton.onclick = () => trackUpload(run);
    } else {
      uploadChip.hidden = true;
      ctx.changed();
    }
    return result;
  }

  /** What replacing the current underlay would throw away, in words. Empty when there is nothing there. */
  function underlayLoss() {
    const doc = ctx.doc();
    const set = doc.sheetSet;
    if (set) {
      const placed = set.pages.filter((p) => p.placement);
      const parts = [`${placed.length} placed sheet${placed.length === 1 ? "" : "s"}`];
      const verified = placed.filter((p) => p.verified).length;
      const marks = set.pages.filter((p) => p.anchor).length;
      const heights = Object.keys(set.ceilingHeights || {}).length;
      if (verified) parts.push(`${verified} scale check${verified === 1 ? "" : "s"}`);
      if (marks) parts.push(`${marks} alignment mark${marks === 1 ? "" : "s"}`);
      if (heights) parts.push(`${heights} ceiling height${heights === 1 ? "" : "s"}`);
      const names = (set.sources || []).map((s) => s.name);
      return { what: names.length > 1 ? `${names.length} plan files (${names.join(", ")})` : (names[0] || set.pdfName || "The current plan set"), parts };
    }
    if (doc.underlay) {
      const satellite = doc.underlay.source?.type === "satellite";
      return { what: satellite ? "The satellite view" : (doc.underlay.name || "The current image"), parts: [satellite ? "its placement" : "its scale and position"] };
    }
    return null;
  }

  /** Ask before an import takes the place of anything already on the plan. Resolves true to go ahead. */
  async function confirmReplace() {
    const loss = underlayLoss();
    if (!loss) return true;
    const list = loss.parts.length > 1 ? `${loss.parts.slice(0, -1).join(", ")} and ${loss.parts.at(-1)}` : loss.parts[0];
    const choice = await ask({
      title: "Replace the current underlay?",
      message: `${loss.what} will be replaced. This takes off ${list}. Your walls and the rest of the drawing are not affected.`,
      choices: [{ id: "no", label: "Keep current", primary: true }, { id: "yes", label: "Replace" }],
    });
    return choice === "yes";
  }
  const toastHost = h("div", { class: "sheet-set-toasts" });
  ctx.mount?.append(bar, toastHost);

  /** An in-page question instead of window.confirm. Resolves with the id of the chosen button. */
  function ask({ title, message, choices }) {
    return new Promise((resolve) => {
      const card = h("div", { class: "sheet-set-toast", role: "alertdialog", "aria-label": title });
      let settled = false;
      const dismiss = () => (choices.find((c) => c.id === "cancel") || choices.find((c) => c.primary) || choices[0])?.id;
      const done = (id) => {
        if (settled) return;
        settled = true;
        document.removeEventListener("keydown", onKey, true);
        card.remove();
        resolve(id);
      };
      // Capture runs before the plan's own keys, so Escape answers this
      // question and does not also cancel a drawing.
      const onKey = (ev) => {
        if (!card.isConnected) {
          document.removeEventListener("keydown", onKey, true);
          return;
        }
        if (ev.key !== "Escape") return;
        ev.preventDefault();
        ev.stopPropagation();
        done(dismiss());
      };
      document.addEventListener("keydown", onKey, true);
      card.append(
        h("strong", { text: title }),
        h("p", { text: message }),
        h("div", { class: "sheet-set-toast-actions" },
          choices.map((c) => h("button", { type: "button", class: c.primary ? "primary" : undefined, text: c.label, onclick: () => done(c.id) })))
      );
      toastHost.replaceChildren(card);
      card.querySelector("button.primary, button")?.focus();
    });
  }

  /** A short note that fades on its own. */
  function note(text) {
    const card = h("div", { class: "sheet-set-toast is-note", text });
    toastHost.replaceChildren(card);
    setTimeout(() => card.remove(), 5000);
  }
  /** A note with one button, for "removed - Undo". Goes away on its own, or when the button is used. */
  function toast(text, { actionLabel, onAction, ms = 8000 } = {}) {
    const card = h("div", { class: "sheet-set-toast is-note has-action" }, h("span", { text }));
    if (actionLabel && onAction) {
      card.append(h("button", { type: "button", class: "primary", text: actionLabel, onclick: () => {
        card.remove();
        onAction();
      } }));
    }
    toastHost.replaceChildren(card);
    setTimeout(() => card.remove(), ms);
    return () => card.remove();
  }
  api.setSharpListener((busy) => {
    sharpChip.hidden = !busy;
  });

  function pickPdfFile(handler) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) handler(file);
    });
    input.click();
  }

  /** Reopen the PDF for a saved sheet set; placements are already in the document. */
  async function repick(file) {
    const doc = ctx.doc();
    ctx.setStatus(`Reading ${file.name}…`, "ok");
    const result = await api.openPdf(file);
    if (!result.ok) {
      ctx.setStatus(result.message, "warn");
      return;
    }
    // Any file the drawing is still waiting for may be the one chosen: the first whose pages match.
    const waiting = api.sourcesNeedingFile(doc);
    const target = waiting.find((s) => sameSheetGeometry(pagesOfSource(doc.sheetSet, s.id), result.pages));
    if (!target) {
      api.discardPendingPdf();
      ctx.setStatus("That PDF has different pages from the ones this drawing was set up with. Choose the original file, or import again.", "warn");
      return;
    }
    api.attachSourceFile(doc, target.id, ctx.activeLevel());
    // Choosing the file is also how a drawing saved before files were stored
    // gains one. The id has to be on the document before the save below.
    api.ensureSheetBitmap(doc)?.then(() => ctx.changed());
    ctx.setStatus(`${target.name} loaded. Sheets are back in place.`, "ok");
    ctx.changed();
    trackUpload((onProgress) => ctx.rememberPdf?.(target.id, onProgress));
  }

  // --- import dialog --------------------------------------------------------

  let dialog = null;

  function closeDialog({ discard = true } = {}) {
    if (discard) api.discardPendingPdf();
    dialog?.remove();
    dialog = null;
  }

  async function openPicker() {
    pickPdfFile((file) => openImport(file));
  }

  /**
   * Read a PDF and ask what its pages are. `mode`:
   *   add      - another file beside the ones already on the drawing (the ordinary path once there is a set),
   *   new      - the first file, or one replacing an image or satellite view,
   *   replace  - swap one source's pages for this file (`sourceId`),
   *   revision - a new revision of one source, keeping placements (`sourceId`).
   */
  async function openImport(file, { mode = null, sourceId = null } = {}) {
    const doc = ctx.doc();
    const chosen = mode || (doc.sheetSet ? "add" : "new");
    ctx.setStatus(`Reading ${file.name}…`, "ok");
    const result = await api.openPdf(file);
    if (!result.ok) {
      ctx.setStatus(result.message, "warn");
      return;
    }
    ctx.setStatus(`${file.name}: ${result.pages.length} page${result.pages.length === 1 ? "" : "s"}.`, "ok");
    if (chosen === "revision") showRevisionDialog(result, sourceId);
    else showImportDialog(result, { mode: chosen, sourceId });
  }

  function showImportDialog(result, { mode = "new", sourceId = null } = {}) {
    // Replace any dialog still open, but keep the PDF openPdf just handed us.
    closeDialog({ discard: false });
    const levels = () => ctx.levels();
    const doc0Source = () => ctx.doc().sheetSet?.sources?.find((s) => s.id === sourceId);
    const rows = result.pages.map((p) => {
      const kind = p.title ? parseSheetKind(p.title) : "other";
      const role = PLACEABLE_KINDS.includes(kind) ? "plan" : kind === "elevations" ? "elevation" : kind === "sections" ? "section" : "unused";
      return {
        index: p.index,
        label: p.title ? cleanSheetTitle(p.title) : `Page ${p.index + 1}`,
        kind,
        role,
        levelId: role === "plan" ? defaultLevelForKind(kind, levels()) : null,
        printedScale: guessPrintedScale(kind),
        pixelWidth: p.pixelWidth,
        pixelHeight: p.pixelHeight,
        thumb: null,
      };
    });

    const body = h("div", { class: "sheet-set-rows" });
    const notice = h("div", { class: "sheet-set-notice", hidden: true });
    const importButton = h("button", { type: "button", class: "primary", text: "Import", onclick: doImport });

    /** One control: Plan on <floor>, Elevation, Section, or Don't use. */
    function useAsSelect(row) {
      const select = h("select", { "aria-label": "Use as" },
        levels().map((l) => h("option", { value: `plan:${l.id}`, text: `Plan on ${l.name || l.id}` })),
        row.role === "plan" && !row.levelId ? h("option", { value: "plan:", text: "Plan (no floor yet)" }) : null,
        h("option", { value: "elevation", text: "Elevation" }),
        h("option", { value: "section", text: "Section" }),
        h("option", { value: "other", text: "Other" }),
        h("option", { value: "unused", text: "Don't use" }));
      select.value = row.role === "plan" ? `plan:${row.levelId || ""}` : row.role;
      select.addEventListener("change", () => {
        const v = select.value;
        if (v.startsWith("plan:")) {
          row.role = "plan";
          row.levelId = v.slice(5) || null;
        } else {
          row.role = v;
          row.levelId = null;
        }
        refreshNotice();
      });
      return select;
    }

    function paintRows() {
      body.replaceChildren(
        ...rows.map((row) => {
          const thumb = h("img", { class: "sheet-set-thumb", alt: "", src: row.thumb || undefined });
          row.thumbEl = thumb;
          const slot = h("div", {
            class: row.thumb ? "sheet-set-thumb-slot" : "sheet-set-thumb-slot is-loading",
            "aria-busy": row.thumb ? "false" : "true",
            "aria-label": row.thumb ? undefined : "Loading page preview",
          }, thumb, h("span", { class: "sheet-set-thumb-spin", "aria-hidden": "true" }));
          row.thumbSlot = slot;
          const scale = h("input", { type: "text", class: "sheet-set-scale", list: "sheet-set-scales", value: formatPrintedScale(row.printedScale), "aria-label": "Printed scale" });
          scale.addEventListener("change", () => {
            const n = parsePrintedScale(scale.value);
            if (n) row.printedScale = n;
            scale.value = formatPrintedScale(row.printedScale);
          });
          const label = h("input", { type: "text", class: "sheet-set-label", value: row.label, "aria-label": "Sheet name" });
          label.addEventListener("input", () => {
            row.label = label.value;
          });
          return h("div", { class: "sheet-set-row-item" },
            slot,
            h("div", { class: "sheet-set-fields" },
              h("div", {}, label),
              h("div", {}, useAsSelect(row), scale)));
        })
      );
    }

    /** A plan whose floor does not exist yet: offer to add the floor instead of silently dropping it. */
    function refreshNotice() {
      const missing = rows.filter((r) => r.role === "plan" && !r.levelId);
      notice.replaceChildren();
      notice.hidden = !missing.length;
      if (!missing.length) return;
      notice.append(`${missing.map((r) => r.label).join(", ")} has no floor to go on yet. `);
      if (ctx.canAddFloor()) {
        notice.append(h("button", { type: "button", text: "+ Add floor", onclick: () => {
          ctx.addFloor();
          for (const r of rows) if (r.role === "plan" && !r.levelId) r.levelId = defaultLevelForKind(r.kind, levels()) || levels().at(-1)?.id || null;
          paintRows();
          refreshNotice();
        } }));
      } else {
        notice.append("No more floors can be added; pick a floor instead.");
      }
    }

    async function doImport() {
      const doc = ctx.doc();
      const placed = rows.filter((r) => r.role === "plan" && r.levelId);
      const refs = rows.filter((r) => r.role === "elevation" || r.role === "section" || r.role === "other");
      if (rows.some((r) => r.role === "plan" && !r.levelId)) {
        ctx.setStatus("Give each plan a floor, or choose Don't use for it.", "warn");
        return;
      }
      if (!placed.length && !refs.length) {
        ctx.setStatus("Use at least one page as a plan, elevation, section or other.", "warn");
        return;
      }
      const plans = `${placed.length} plan${placed.length === 1 ? "" : "s"}`;

      if (mode === "add" && doc.sheetSet) {
        // The ordinary path: nothing already on the drawing is touched.
        ctx.pushUndo?.();
        const { source } = addSource(doc.sheetSet, { name: result.name }, rows);
        closeDialog({ discard: false });
        api.attachSourceFile(doc, source.id, ctx.activeLevel());
        api.ensureSheetBitmap(doc)?.then(() => ctx.changed());
        listSignature = "";
        ctx.setStatus(
          `${result.name} added${placed.length ? `: ${plans} placed at the printed scale. Where a floor already had a sheet, the new ones wait behind it in the Sheets list` : ""}. Scale is unverified until you check it.`,
          "ok"
        );
        ctx.changed();
        trackUpload((onProgress) => ctx.rememberPdf?.(source.id, onProgress));
        return;
      }

      if (mode === "replace" && doc.sheetSet) {
        const oldSource = doc.sheetSet.sources?.find((s) => s.id === sourceId);
        if (!oldSource) {
          closeDialog();
          return;
        }
        const loss = sourceLoss(doc.sheetSet, sourceId);
        const list = loss.length > 1 ? `${loss.slice(0, -1).join(", ")} and ${loss.at(-1)}` : loss[0];
        const choice = await ask({
          title: "Replace this file?",
          message: `${oldSource.name} will be replaced by ${result.name}.${list ? ` This takes off ${list}.` : ""} The other plan files and your walls are not affected.`,
          choices: [{ id: "no", label: "Keep current", primary: true }, { id: "yes", label: "Replace" }],
        });
        if (choice !== "yes") return;
        ctx.pushUndo?.();
        replaceSource(doc.sheetSet, sourceId, { name: result.name }, rows);
        closeDialog({ discard: false });
        api.attachSourceFile(doc, sourceId, ctx.activeLevel());
        api.ensureSheetBitmap(doc)?.then(() => ctx.changed());
        listSignature = "";
        ctx.setStatus(`${oldSource.name} replaced by ${result.name}: ${plans} placed at the printed scale. Scale is unverified until you check it.`, "ok");
        ctx.changed();
        ctx.fitSheet?.();
        trackUpload((onProgress) => ctx.rememberPdf?.(sourceId, onProgress));
        return;
      }

      if (!(await confirmReplace())) return;
      const set = createSheetSet(result.name, rows);
      closeDialog({ discard: false });
      api.adoptSheetSet(doc, set, ctx.activeLevel());
      api.ensureSheetBitmap(doc)?.then(() => ctx.changed());
      ctx.setStatus(
        `${plans} placed at the printed scale. Scale is unverified - use Set scale on a known dimension to check it.`,
        "ok"
      );
      ctx.changed();
      ctx.fitSheet?.();
      // The sheet is on screen; the file goes up behind it.
      trackUpload((onProgress) => ctx.rememberPdf?.(set.sources[0].id, onProgress));
    }

    const scales = h("datalist", { id: "sheet-set-scales" }, PRINTED_SCALES.map((s) => h("option", { value: `1:${s}` })));
    const panel = h("div", { class: "panel library-panel sheet-set-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "sheet-set-title" },
      h("header", {},
        h("h2", {
          id: "sheet-set-title",
          text: mode === "add" ? `Add ${result.name}`
            : mode === "replace" ? `Replace ${doc0Source()?.name ?? "file"} with ${result.name}`
              : `Import ${result.name}`,
        }),
        h("span", { class: "sheet-set-count", text: `${rows.length} pages` }),
        h("button", { type: "button", text: "Cancel", onclick: () => closeDialog() }),
        importButton),
      h("p", { class: "sheet-set-help", text: "Choose what each page is used for, and the scale printed on it." }),
      notice,
      body,
      scales);
    dialog = h("div", { class: "library-overlay sheet-set-overlay" }, panel);
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) closeDialog();
    });
    document.body.append(dialog);
    paintRows();
    refreshNotice();

    // Thumbnails arrive one at a time so the dialog opens at once.
    (async () => {
      for (const row of rows) {
        if (!dialog) return;
        row.thumb = await api.renderThumbnail(row.index);
        if (!row.thumbEl?.isConnected) continue;
        if (row.thumb) row.thumbEl.src = row.thumb;
        row.thumbSlot?.classList.remove("is-loading");
        row.thumbSlot?.setAttribute("aria-busy", "false");
        row.thumbSlot?.removeAttribute("aria-label");
      }
    })();
  }

  /**
   * A new revision of a file, matched to the pages it replaces. A page the new
   * file still has, at the same size, is kept silently (placement, scale check,
   * alignment mark, floor, role). Everything else is a row to decide.
   */
  function showRevisionDialog(result, sourceId) {
    closeDialog({ discard: false });
    const doc = ctx.doc();
    const set = doc.sheetSet;
    const source = set?.sources?.find((s) => s.id === sourceId);
    if (!source) {
      api.discardPendingPdf();
      return;
    }
    const match = matchRevision(set, sourceId, result.pages);
    const newLabel = (n) => {
      const page = result.pages.find((q) => q.index === n);
      return page?.title ? cleanSheetTitle(page.title) : `Page ${n + 1}`;
    };
    const choices = new Map(match.rows.map((r) => [r.page.index, r.newIndex]));
    const auto = match.rows.filter((r) => r.auto);
    const asked = match.rows.filter((r) => !r.auto);

    const apply = h("button", { type: "button", class: "primary", text: "Load revision", onclick: () => doApply() });
    const list = h("div", { class: "sheet-set-rows" });
    for (const row of asked) {
      const select = h("select", { "aria-label": `New page for ${row.page.label}` },
        h("option", { value: "", text: "Drop" }),
        result.pages.map((n) => h("option", { value: String(n.index), text: newLabel(n.index) })));
      select.value = row.newIndex === null ? "" : String(row.newIndex);
      select.addEventListener("change", () => {
        choices.set(row.page.index, select.value === "" ? null : Number(select.value));
      });
      list.append(h("div", { class: "sheet-set-row-item" },
        h("div", { class: "sheet-set-fields" },
          h("div", {}, h("strong", { text: row.page.label }),
            h("span", { class: "sheet-set-count", text: row.newIndex === null ? " has no match in the new file" : " changed size" })),
          h("div", {}, "becomes ", select))));
    }
    if (!asked.length) list.append(h("p", { class: "sheet-set-help", text: "Every sheet has a matching page at the same size." }));

    const summary = [`${auto.length} sheet${auto.length === 1 ? "" : "s"} kept as they are`];
    if (match.unmatched.length) summary.push(`${match.unmatched.length} new page${match.unmatched.length === 1 ? "" : "s"} will arrive under Not on a floor`);

    async function doApply() {
      const chosen = new Map(choices);
      const dropping = match.rows.filter((r) => !Number.isInteger(chosen.get(r.page.index)));
      const lost = dropping.flatMap((r) => unplaceLoss(r.page).map((what) => `${r.page.label}: ${what}`));
      if (dropping.length) {
        const choice = await ask({
          title: "Drop sheets?",
          message: `${dropping.map((r) => r.page.label).join(", ")} ${dropping.length === 1 ? "has" : "have"} no page in ${result.name} and will come off the plan${lost.length ? `, taking ${lost.join("; ")}` : ""}.`,
          choices: [{ id: "no", label: "Go back", primary: true }, { id: "yes", label: "Drop them" }],
        });
        if (choice !== "yes") return;
      }
      ctx.pushUndo?.();
      const outcome = applyRevision(set, sourceId, { name: result.name }, result.pages, chosen);
      closeDialog({ discard: false });
      api.attachSourceFile(doc, sourceId, ctx.activeLevel());
      api.ensureSheetBitmap(doc)?.then(() => ctx.changed());
      listSignature = "";
      ctx.setStatus(
        `${result.name} loaded over ${source.name}: ${outcome.kept.length} sheet${outcome.kept.length === 1 ? "" : "s"} kept${outcome.dropped.length ? `, ${outcome.dropped.length} dropped` : ""}${outcome.added.length ? `, ${outcome.added.length} new page${outcome.added.length === 1 ? "" : "s"} not on a floor` : ""}.`,
        "ok"
      );
      ctx.changed();
      trackUpload((onProgress) => ctx.rememberPdf?.(sourceId, onProgress));
    }

    const panel = h("div", { class: "panel library-panel sheet-set-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "sheet-set-title" },
      h("header", {},
        h("h2", { id: "sheet-set-title", text: `Load ${result.name} as a new revision of ${source.name}` }),
        h("button", { type: "button", text: "Cancel", onclick: () => closeDialog() }),
        apply),
      h("p", { class: "sheet-set-help", text: `${summary.join(". ")}.` }),
      list);
    dialog = h("div", { class: "library-overlay sheet-set-overlay" }, panel);
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) closeDialog();
    });
    document.body.append(dialog);
  }

  // --- underlay panel: sheet chooser and printed scale -----------------------

  let panelRow = null;
  let sheetSelect = null;
  let scaleInput = null;
  let statusText = null;

  function ensurePanelRow(panel) {
    if (panelRow?.isConnected) return;
    sheetSelect = h("select", { "aria-label": "Sheet on this level" });
    sheetSelect.addEventListener("change", () => {
      if (api.chooseSheet(ctx.doc(), Number(sheetSelect.value))) ctx.changed();
    });
    scaleInput = h("input", { type: "text", list: "sheet-set-scales-panel", "aria-label": "Printed scale" });
    scaleInput.addEventListener("change", () => {
      const doc = ctx.doc();
      const n = parsePrintedScale(scaleInput.value);
      const index = doc.underlay?.sheetPage;
      if (n && Number.isInteger(index) && setPageScale(doc.sheetSet, index, n)) ctx.changed();
      syncPanel();
    });
    statusText = h("span", { class: "sheet-set-verify" });
    panelRow = h("div", { class: "sheet-set-panel-row" },
      h("label", {}, "Sheet ", sheetSelect),
      h("label", {}, "Printed ", scaleInput),
      statusText,
      h("datalist", { id: "sheet-set-scales-panel" }, PRINTED_SCALES.map((s) => h("option", { value: `1:${s}` }))));
    panel.insertBefore(panelRow, panel.querySelector(".hint"));
  }

  /** Refresh the sheet row in the underlay panel; call when the panel is showing. */
  function syncPanel(panel = ctx.underlayPanel) {
    const doc = ctx.doc();
    const index = doc.underlay?.sheetPage;
    const set = doc.sheetSet;
    if (!panel || !set || !Number.isInteger(index)) {
      panelRow?.setAttribute("hidden", "");
      return;
    }
    ensurePanelRow(panel);
    panelRow.removeAttribute("hidden");
    const page = set.pages.find((p) => p.index === index);
    const options = pagesForLevel(set, page.levelId);
    sheetSelect.replaceChildren(...options.map((p) => h("option", { value: String(p.index), text: p.label })));
    sheetSelect.value = String(index);
    sheetSelect.parentElement.hidden = options.length < 2;
    if (document.activeElement !== scaleInput) scaleInput.value = formatPrintedScale(page.printedScale);
    statusText.textContent = page.verified ? "scale verified" : "scale unverified";
    statusText.classList.toggle("is-unverified", !page.verified);
  }

  /**
   * After a two-point calibration: record the plot correction, then say what it
   * means. A result near 100% is just a confirmation. A result far from it most
   * often means the printed scale was wrong (a site plan guessed as 1:500 that
   * is really 1:100), so that is offered first; applying the factor to other
   * sheets is for a genuinely reduced plot.
   */
  async function afterCalibration() {
    const doc = ctx.doc();
    const index = doc.underlay?.sheetPage;
    const set = doc.sheetSet;
    if (!set || !Number.isInteger(index)) return;
    const page = set.pages.find((p) => p.index === index);
    const factor = recordCalibration(set, index, doc.underlay.metresPerPixel);
    if (!factor || !page) return;
    const pct = (factor * 100).toFixed(1);
    const others = set.pages.filter((p) => p.placement && p.index !== index && !p.verified);

    if (Math.abs(factor - 1) <= 0.02) {
      note(`Scale verified: ${page.label} matches 1:${page.printedScale} (${pct}%).`);
      ctx.changed();
      return;
    }

    const suggested = suggestPrintedScale(page.printedScale, factor);
    const choices = [];
    let message = `${page.label} measured ${pct}% of its printed 1:${page.printedScale} size.`;
    if (suggested) {
      message += ` That is almost exactly 1:${suggested}, so the printed scale is probably wrong rather than the plot.`;
      choices.push({ id: "fix", label: `Set to 1:${suggested}`, primary: true });
    }
    if (others.length) {
      message += ` Apply ${pct}% to ${others.length === 1 ? "the other unverified sheet" : `the other ${others.length} unverified sheets`} too? Each keeps its own printed scale.`;
      choices.push({ id: "apply", label: "Apply to other sheets", primary: !suggested });
    }
    choices.push({ id: "keep", label: "This sheet only" });

    const choice = await ask({ title: "Scale checked", message, choices });
    if (choice === "fix") {
      page.printedScale = suggested;
      set.scaleCorrection = correctionFactor(suggested, doc.underlay.metresPerPixel);
      ctx.setStatus(`${page.label} set to 1:${suggested} and verified.`, "ok");
    } else if (choice === "apply") {
      applyCorrectionToOthers(set, factor, index);
      ctx.setStatus(`Applied ${pct}% to ${others.length} other sheet${others.length === 1 ? "" : "s"}. They stay unverified until you check each.`, "ok");
    }
    ctx.changed();
  }

  const floorName = (id) => ctx.levels().find((l) => l.id === id)?.name || id || "no floor";
  const realLevelIds = () => ctx.levels().map((l) => l.id);

  /** Go to a page: a plan page switches floor and shows that sheet; an elevation or section opens the reference panel.
   * Fitting is off by default so a zoomed-in overlay check stays where it is. Import still fits the new sheet. */
  function goToPage(page, { fit = false } = {}) {
    const doc = ctx.doc();
    if (isPlanPage(page)) {
      const changedFloor = page.levelId && page.levelId !== ctx.activeLevel();
      ctx.goToLevel?.(page.levelId);
      api.chooseSheet(doc, page.index);
      if (doc.sheetSet?.hidden) doc.sheetSet.hidden = false;
      api.ensureSheetBitmap(doc)?.then(() => ctx.changed());
      ctx.changed();
      if (changedFloor) ctx.setStatus(`Now on ${floorName(page.levelId)}.`, "ok");
      if (fit) ctx.fitSheet?.();
    } else {
      openReference(page.index);
    }
  }

  /** Move one plan page to another floor. The view follows only when that page is the one on screen. */
  function moveSheet(page, levelId) {
    const doc = ctx.doc();
    const set = doc.sheetSet;
    if (!set || !levelId || levelId === page.levelId) return;
    const showing = doc.underlay?.sheetPage === page.index;
    ctx.pushUndo?.();
    const result = movePageToLevel(set, page.index, levelId, { follow: showing, levelIds: realLevelIds() });
    if (!result.ok) {
      ctx.setStatus(result.reason || "That sheet could not be moved.", "warn");
      return;
    }
    if (showing) {
      ctx.goToLevel?.(levelId);
      api.chooseSheet(doc, page.index);
      api.ensureSheetBitmap(doc)?.then(() => ctx.changed());
      ctx.setStatus(`${page.label} is now on ${floorName(levelId)}.`, "ok");
    } else {
      ctx.setStatus(`${page.label} moved to ${floorName(levelId)}. The view stays where it was.`, "ok");
    }
    listSignature = "";
    ctx.changed();
  }

  /** Move every plan page of a floor. More than one asks first. */
  async function moveFloor(fromId, toId, sourceId = null) {
    const doc = ctx.doc();
    const set = doc.sheetSet;
    if (!set || !toId || fromId === toId) return;
    const pages = pagesForLevel(set, fromId).filter((p) => isPlanPage(p) && (!sourceId || p.sourceId === sourceId));
    if (!pages.length) return;
    if (pages.length > 1) {
      const choice = await ask({
        title: "Move sheets?",
        message: `Move ${pages.length} sheets from ${floorName(fromId)} to ${floorName(toId)}? Their place on the plan stays the same.`,
        choices: [{ id: "no", label: "Cancel" }, { id: "yes", label: "Move", primary: true }],
      });
      if (choice !== "yes") return;
    }
    ctx.pushUndo?.();
    const result = movePlansOnLevel(set, fromId, toId, { levelIds: realLevelIds(), sourceId });
    if (!result.ok) return;
    if (result.showing !== null) {
      ctx.goToLevel?.(toId);
      api.chooseSheet(doc, result.showing);
      api.ensureSheetBitmap(doc)?.then(() => ctx.changed());
    }
    ctx.setStatus(`${result.moved.length} sheet${result.moved.length === 1 ? "" : "s"} moved from ${floorName(fromId)} to ${floorName(toId)}.`, "ok");
    listSignature = "";
    ctx.changed();
  }

  /** Elevation, section, other, or back to unused. A traced sheet is asked about first, because it leaves its floor. */
  async function assignRole(page, role) {
    const set = ctx.doc().sheetSet;
    const roles = ["elevation", "section", "other", "unused"];
    if (!set || !roles.includes(role)) return;
    if (page.role === role && !isPlanPage(page)) return;
    const where = role === "unused" ? "Not on a floor" : role === "other" ? "Other" : role === "elevation" ? "Elevations" : "Sections";
    if (isPlanPage(page)) {
      const loss = unplaceLoss(page);
      const choice = await ask({
        title: role === "unused" ? "Take this sheet off the plan?" : "Show this beside the plan?",
        message: `${page.label} comes off ${floorName(page.levelId)}${loss.length ? `, losing ${loss.join(" and ")}` : ""}. It stays in the list under ${where}.`,
        choices: [
          { id: "no", label: "Keep it", primary: true },
          { id: "yes", label: role === "unused" ? "Don't trace" : "Move" },
        ],
      });
      if (choice !== "yes") return;
    }
    ctx.pushUndo?.();
    if (!setPageRole(set, page.index, role).ok) return;
    const said = role === "elevation" ? `${page.label} is with the elevations.`
      : role === "section" ? `${page.label} is with the sections.`
        : role === "other" ? `${page.label} is with the other pages.`
          : `${page.label} is no longer shown beside the plan.`;
    ctx.setStatus(said, "ok");
    listSignature = "";
    refPanel?.refresh?.();
    ctx.changed();
  }

  function placeSheet(page, levelId) {
    const doc = ctx.doc();
    const set = doc.sheetSet;
    if (!set || !levelId) return;
    ctx.pushUndo?.();
    const result = placePage(set, page.index, levelId, { levelIds: realLevelIds(), follow: true });
    if (!result.ok) {
      ctx.setStatus("That sheet could not be placed.", "warn");
      return;
    }
    ctx.goToLevel?.(levelId);
    api.chooseSheet(doc, page.index);
    api.ensureSheetBitmap(doc)?.then(() => ctx.changed());
    ctx.setStatus(`${page.label} placed on ${floorName(levelId)} at its printed scale. Scale is unverified - use Set scale to check it.`, "ok");
    listTab = "drawn";
    listSignature = "";
    ctx.changed();
  }

  async function unplaceSheet(page) {
    const doc = ctx.doc();
    const set = doc.sheetSet;
    if (!set) return;
    const loss = unplaceLoss(page);
    if (loss.length) {
      const choice = await ask({
        title: "Take this sheet off the plan?",
        message: `${page.label} will lose ${loss.join(" and ")}. It stays in the list under Not on a floor.`,
        choices: [{ id: "no", label: "Keep it", primary: true }, { id: "yes", label: "Don't trace" }],
      });
      if (choice !== "yes") return;
    }
    ctx.pushUndo?.();
    if (!unplacePage(set, page.index).ok) return;
    ctx.setStatus(`${page.label} is no longer traced. It is under Not drawn.`, "ok");
    listTab = "other";
    listSignature = "";
    ctx.changed();
  }

  /** Every page of the PDF as a list grouped by floor, with the showing one marked. Rebuilt only when something it shows changed. */
  let listSignature = "";
  let listShown = true;
  /** Show or hide the sheets list (a ribbon command); with no value, toggle. */
  function setListVisible(visible = !listShown) {
    listShown = Boolean(visible);
    syncList();
    ctx.onListVisible?.(listShown);
    return listShown;
  }

  function pageFileOpen(page) {
    if (page.sourceId) return Boolean(api.isSourceOpen?.(page.sourceId));
    return Boolean(api.hasOpenPdf?.());
  }

  /** The eye is on, this floor is drawing the sheet, and its pixels are not ready yet. */
  function eyeWaiting(set, page, showing) {
    if (!page || set.hidden || !isPlanPage(page)) return false;
    const current = Number.isInteger(showing) ? set.pages.find((q) => q.index === showing) : null;
    if (!current?.levelId || page.levelId !== current.levelId) return false;
    const visible = page.index === showing ? !page.suppressed : Boolean(page.shown);
    if (!visible || api.isPageBitmapReady?.(page.index)) return false;
    return pageFileOpen(page);
  }

  function paintEye(button, waiting) {
    button.classList.toggle("is-busy", waiting);
    button.setAttribute("aria-busy", waiting ? "true" : "false");
  }

  function openSelect(select) {
    select.focus();
    try {
      select.showPicker?.();
    } catch {
      // Not allowed without a gesture in some browsers; focus is enough.
    }
  }

  function levelSelect(label, current, onPick, placeholder) {
    const select = h("select", { "aria-label": label, class: "sheet-set-list-select" },
      placeholder ? h("option", { value: "", text: placeholder }) : null,
      ctx.levels().map((l) => h("option", { value: l.id, text: l.name || l.id })));
    if (current && !ctx.levels().some((l) => l.id === current)) select.append(h("option", { value: current, text: current }));
    select.value = current || "";
    select.addEventListener("change", () => {
      const v = select.value;
      if (v) onPick(v);
    });
    for (const type of ["click", "dblclick", "keydown"]) select.addEventListener(type, (e) => e.stopPropagation());
    return select;
  }

  function syncList() {
    const doc = ctx.doc();
    const set = doc.sheetSet;
    sheetsCard.hidden = !set || !listShown;
    if (!set) {
      listSignature = "";
      return;
    }
    const showing = doc.underlay?.sheetPage;
    const levels = ctx.levels();
    const drawnCount = set.pages.filter((p) => isPlanPage(p)).length;
    const otherCount = set.pages.length - drawnCount;
    tabDrawn.textContent = `Drawn${drawnCount ? ` ${drawnCount}` : ""}`;
    tabOther.textContent = `Not drawn${otherCount ? ` ${otherCount}` : ""}`;
    tabDrawn.classList.toggle("is-on", listTab === "drawn");
    tabOther.classList.toggle("is-on", listTab === "other");
    tabDrawn.setAttribute("aria-selected", listTab === "drawn" ? "true" : "false");
    tabOther.setAttribute("aria-selected", listTab === "other" ? "true" : "false");
    const sig = JSON.stringify([
      listTab,
      showing,
      levels.map((l) => [l.id, l.name]),
      set.pages.map((p) => [p.index, p.label, p.levelId, p.role, p.verified, p.printedScale, p.shown, p.suppressed, p.sourceId]),
      (set.sources || []).map((s) => [s.id, s.name]),
    ]);
    if (sig === listSignature) {
      // Opacity is left out of the signature so dragging a slider does not rebuild it; follow outside changes here.
      for (const slider of sheetsList.querySelectorAll("input[data-opacity-page]")) {
        if (document.activeElement === slider) continue;
        const page = set.pages.find((q) => q.index === Number(slider.dataset.opacityPage));
        const value = String(Math.round((page?.placement?.opacity ?? 0.55) * 100));
        if (slider.value !== value) slider.value = value;
      }
      for (const eye of sheetsList.querySelectorAll("button[data-eye-page]")) {
        const page = set.pages.find((q) => q.index === Number(eye.dataset.eyePage));
        paintEye(eye, eyeWaiting(set, page, showing));
      }
      return;
    }
    listSignature = sig;

    const planRow = (p) => {
      const isShowing = p.index === showing;
      const name = h("input", { type: "text", class: "sheet-set-list-name", value: p.label, "aria-label": "Sheet name" });
      name.addEventListener("click", (e) => e.stopPropagation());
      name.addEventListener("dblclick", (e) => e.stopPropagation());
      name.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") name.blur();
      });
      name.addEventListener("change", () => {
        const next = name.value.trim();
        if (!next) {
          name.value = p.label;
          return;
        }
        ctx.pushUndo?.();
        p.label = next;
        if (p.placement) p.placement.name = `${sourceOf(set, p)?.name ?? set.pdfName} - ${next}`;
        listSignature = "";
        ctx.changed();
      });
      const floor = levelSelect("Floor", p.levelId, (id) => moveSheet(p, id));
      const fit = h("button", { type: "button", class: "sheet-set-list-fit", title: "Zoom to this sheet", "aria-label": "Zoom to this sheet", text: "⌖" });
      fit.addEventListener("click", (e) => {
        e.stopPropagation();
        goToPage(p, { fit: true });
      });
      const off = h("button", { type: "button", class: "sheet-set-list-off", title: "Take this sheet off the plan but keep it in the list", text: "Don't trace" });
      off.addEventListener("click", (e) => {
        e.stopPropagation();
        unplaceSheet(p);
      });
      const view = h("button", { type: "button", class: "sheet-set-list-fit", title: "Look at this page in the panel beside the plan", text: "View" });
      view.addEventListener("click", (e) => {
        e.stopPropagation();
        openReference(p.index);
      });
      view.addEventListener("dblclick", (e) => e.stopPropagation());
      const beside = h("select", { "aria-label": "Add to elevations and sections", class: "sheet-set-list-select" },
        h("option", { value: "", text: "Add to…" }),
        h("option", { value: "elevation", text: "Elevations" }),
        h("option", { value: "section", text: "Sections" }),
        h("option", { value: "other", text: "Other" }));
      beside.addEventListener("change", () => {
        const role = beside.value;
        beside.value = "";
        if (role) assignRole(p, role);
      });
      for (const type of ["click", "dblclick", "keydown"]) beside.addEventListener(type, (e) => e.stopPropagation());
      const visible = isShowing ? !p.suppressed : Boolean(p.shown);
      const waiting = eyeWaiting(set, p, showing);
      const eye = h("button", {
        type: "button",
        class: `sheet-set-list-eye${visible ? " is-on" : ""}${waiting ? " is-busy" : ""}`,
        "aria-pressed": visible ? "true" : "false",
        "aria-busy": waiting ? "true" : "false",
        "data-eye-page": String(p.index),
        "aria-label": visible ? "Hide this sheet" : "Show this sheet",
        title: visible
          ? (isShowing ? "Hide this sheet" : "Stop drawing this sheet under the current one")
          : (isShowing ? "Show this sheet" : "Draw this sheet under the current one"),
        text: visible ? "👁" : "◌",
      });
      eye.addEventListener("click", (e) => {
        e.stopPropagation();
        ctx.pushUndo?.();
        setPageShown(set, p.index, !visible, showing);
        listSignature = "";
        ctx.changed();
      });
      eye.addEventListener("dblclick", (e) => e.stopPropagation());
      const opacity = h("input", {
        type: "range", min: "5", max: "100", step: "5",
        class: "sheet-set-list-opacity",
        "aria-label": "Sheet opacity",
        title: "Opacity of this sheet",
        value: String(Math.round((p.placement?.opacity ?? 0.55) * 100)),
        "data-opacity-page": String(p.index),
      });
      let opacityUndone = false;
      opacity.addEventListener("input", () => {
        if (!opacityUndone) {
          ctx.pushUndo?.();
          opacityUndone = true;
        }
        p.placement.opacity = Math.min(1, Math.max(0.05, Number(opacity.value) / 100));
        ctx.changed();
      });
      opacity.addEventListener("change", () => {
        opacityUndone = false;
      });
      for (const type of ["click", "dblclick", "keydown", "pointerdown"]) opacity.addEventListener(type, (e) => e.stopPropagation());
      const grip = h("span", { class: "sheet-set-list-grip", draggable: "true", title: "Drag onto another sheet on this floor to change the draw order", "aria-label": "Reorder", text: "⠿" });
      grip.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        e.dataTransfer?.setData("application/x-sheet-reorder", String(p.index));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      });
      const row = h("div", {
        class: `sheet-set-list-row${isShowing ? " is-showing" : ""}`,
        tabindex: "0",
        draggable: "true",
        title: "Show this sheet. Double-click to zoom to it. Press m to change its floor.",
        "data-page": String(p.index),
      },
      h("div", { class: "sheet-set-list-line" },
        grip,
        h("span", { class: "sheet-set-list-dot", "aria-hidden": "true", text: isShowing ? "●" : "○" }),
        name,
        h("span", { class: "sheet-set-list-scale", text: `1:${p.printedScale}` }),
        h("span", { class: `sheet-set-list-verify${p.verified ? "" : " is-unverified"}`, title: p.verified ? "Scale checked" : "Scale not yet checked", text: p.verified ? "✓" : "?" }),
        view,
        eye));
      // On the showing row, under its name, so the slider and buttons are that
      // sheet's. Exactly one row carries them, so switching sheets does not
      // change the height of the list.
      if (isShowing) row.append(h("div", { class: "sheet-set-list-actions" }, opacity, floor, beside, fit, off));
      row.addEventListener("dragover", (e) => {
        if (!e.dataTransfer?.types?.includes("application/x-sheet-reorder")) return;
        e.preventDefault();
        row.classList.add("is-drop-target");
      });
      row.addEventListener("dragleave", () => row.classList.remove("is-drop-target"));
      row.addEventListener("drop", (e) => {
        row.classList.remove("is-drop-target");
        const from = Number(e.dataTransfer?.getData("application/x-sheet-reorder"));
        if (!e.dataTransfer?.types?.includes("application/x-sheet-reorder") || !Number.isInteger(from)) return;
        e.preventDefault();
        e.stopPropagation();
        const dragged = set.pages.find((q) => q.index === from);
        if (!dragged || from === p.index) return;
        if (!isPlanPage(dragged) || dragged.levelId !== p.levelId) {
          ctx.setStatus("A sheet can only be reordered among the sheets of its own floor.", "warn");
          return;
        }
        ctx.pushUndo?.();
        reorderPage(set, from, p.index);
        listSignature = "";
        ctx.changed();
      });
      row.addEventListener("click", () => goToPage(p));
      row.addEventListener("dblclick", () => goToPage(p, { fit: true }));
      row.addEventListener("keydown", (e) => {
        if (e.target !== row) return;
        if (e.key === "m" || e.key === "M") {
          e.preventDefault();
          openSelect(floor);
        } else if (e.key === "Enter") {
          e.preventDefault();
          goToPage(p);
        }
      });
      row.addEventListener("dragstart", (e) => {
        e.dataTransfer?.setData("text/plain", String(p.index));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      });
      return row;
    };

    const otherRow = (p) => {
      const place = levelSelect("Place on", "", (id) => placeSheet(p, id), "Place on…");
      const showAs = h("select", { "aria-label": "Show as", class: "sheet-set-list-select" },
        h("option", { value: "elevation", text: "Elevation" }),
        h("option", { value: "section", text: "Section" }),
        h("option", { value: "other", text: "Other" }),
        h("option", { value: "unused", text: "Not used" }));
      showAs.value = p.role === "elevation" || p.role === "section" || p.role === "other" ? p.role : "unused";
      showAs.addEventListener("change", () => {
        const role = showAs.value;
        if (role !== p.role) assignRole(p, role);
      });
      for (const type of ["click", "dblclick", "keydown"]) showAs.addEventListener(type, (e) => e.stopPropagation());
      const showLabel = h("label", { class: "sheet-set-list-showas" }, "Show as ", showAs);
      for (const type of ["click", "dblclick", "keydown"]) showLabel.addEventListener(type, (e) => e.stopPropagation());
      const row = h("div", {
        class: "sheet-set-list-row is-other",
        tabindex: "0",
        title: "Open this page beside the plan",
      },
      h("div", { class: "sheet-set-list-line" },
        h("span", { class: "sheet-set-list-dot", "aria-hidden": "true", text: "–" }),
        h("span", { class: "sheet-set-list-name is-text", text: p.label }),
        showLabel,
        place));
      row.addEventListener("click", () => goToPage(p));
      row.addEventListener("keydown", (e) => {
        if (e.target === row && e.key === "Enter") goToPage(p);
      });
      return row;
    };

    const heading = (text, count, extra, dropLevel) => {
      if (extra?.classList) extra.classList.add("sheet-set-list-move");
      const head = h("div", { class: "sheet-set-list-group" }, h("strong", { text }), h("span", { class: "sheet-set-list-count", text: count ? String(count) : "" }), extra);
      if (dropLevel) {
        head.addEventListener("dragover", (e) => {
          if (e.dataTransfer?.types?.includes("application/x-sheet-reorder")) return;
          e.preventDefault();
          head.classList.add("is-drop-target");
        });
        head.addEventListener("dragleave", () => head.classList.remove("is-drop-target"));
        head.addEventListener("drop", (e) => {
          if (e.dataTransfer?.types?.includes("application/x-sheet-reorder")) return;
          e.preventDefault();
          head.classList.remove("is-drop-target");
          const index = Number(e.dataTransfer?.getData("text/plain"));
          const page = set.pages.find((q) => q.index === index);
          if (page && isPlanPage(page)) moveSheet(page, dropLevel);
        });
      }
      return head;
    };

    const nodes = [];
    const sources = set.sources || [];
    const many = sources.length > 1;

    /** Drawn: plan pages by floor. Not drawn: elevations, sections, and pages left off the plan. */
    const groups = (pages, sourceId) => {
      const out = [];
      if (listTab === "drawn") {
        const floorIds = many ? [] : levels.map((l) => l.id);
        for (const p of pages) if (isPlanPage(p) && p.levelId && !floorIds.includes(p.levelId)) floorIds.push(p.levelId);
        // With several files each floor shows only the sheets of that file, so a floor is listed where it has some.
        const ordered = many ? [...levels.map((l) => l.id), ...floorIds].filter((id, i, a) => a.indexOf(id) === i && floorIds.includes(id)) : floorIds;
        for (const id of ordered) {
          const here = pages.filter((p) => isPlanPage(p) && p.levelId === id);
          const moveAll = here.length
            ? levelSelect(`Move all from ${floorName(id)} to`, "", (to) => moveFloor(id, to, many ? sourceId : null), "Move all…")
            : null;
          out.push(heading(floorName(id), here.length, moveAll, id), ...here.map(planRow));
        }
        return out;
      }
      const elevations = pages.filter((p) => p.role === "elevation");
      const sections = pages.filter((p) => p.role === "section");
      const others = pages.filter((p) => p.role === "other");
      if (elevations.length) out.push(heading("Elevations", elevations.length), ...elevations.map(otherRow));
      if (sections.length) out.push(heading("Sections", sections.length), ...sections.map(otherRow));
      if (others.length) out.push(heading("Other", others.length), ...others.map(otherRow));
      const shown = new Set([...elevations, ...sections, ...others]);
      const unused = pages.filter((p) => p.role === "unused" || (!isPlanPage(p) && !shown.has(p)));
      if (unused.length) out.push(heading("Not on a floor", unused.length), ...unused.map(otherRow));
      return out;
    };

    let anyRow = false;
    for (const source of sources) {
      const own = pagesOfSource(set, source.id);
      const rows = groups(own, source.id);
      if (rows.length) anyRow = true;
      const pageCount = listTab === "drawn" ? own.filter((p) => isPlanPage(p)).length : own.filter((p) => !isPlanPage(p)).length;
      const head = h("div", { class: "sheet-set-list-source" },
        h("div", { class: "sheet-set-list-source-top" },
          h("strong", { class: "sheet-set-list-source-name", title: source.name, text: source.name }),
          h("span", { class: "sheet-set-list-count", text: `${pageCount} page${pageCount === 1 ? "" : "s"}` })),
        h("div", { class: "sheet-set-list-source-actions" },
          sourceButton("Replace…", `Swap ${source.name} for another file. Other files stay.`, () => pickPdfFile((file) => openImport(file, { mode: "replace", sourceId: source.id }))),
          sourceButton("New revision…", `Match a newer ${source.name} to these sheets and keep their placement`, () => pickPdfFile((file) => openImport(file, { mode: "revision", sourceId: source.id }))),
          many ? sourceButton("Remove", `Take ${source.name} and its sheets off the drawing`, () => removeSourceFile(source)) : null));
      nodes.push(head, ...rows);
    }
    if (!anyRow) {
      nodes.push(h("p", {
        class: "sheet-set-list-empty",
        text: listTab === "drawn" ? "Nothing on the plan yet." : "Every page is on the plan.",
      }));
    }
    sheetsList.replaceChildren(...nodes);
  }

  function sourceButton(text, title, onClick) {
    const b = h("button", { type: "button", class: "sheet-set-list-source-btn", title, text });
    for (const type of ["click", "dblclick", "keydown"]) b.addEventListener(type, (e) => e.stopPropagation());
    b.addEventListener("click", onClick);
    return b;
  }

  /** Take one file and its pages off the drawing. Names what goes; the last file is removed with Remove… instead. */
  async function removeSourceFile(source) {
    const doc = ctx.doc();
    const set = doc.sheetSet;
    if (!set || (set.sources || []).length < 2) return;
    const loss = sourceLoss(set, source.id);
    const list = loss.length > 1 ? `${loss.slice(0, -1).join(", ")} and ${loss.at(-1)}` : loss[0];
    const choice = await ask({
      title: "Remove this file?",
      message: `${source.name} comes off the drawing${list ? `, taking ${list}` : ""}. The other plan files and your walls are not affected.`,
      choices: [{ id: "no", label: "Keep it", primary: true }, { id: "yes", label: "Remove file" }],
    });
    if (choice !== "yes") return;
    ctx.pushUndo?.();
    // Close the file while the renderer still knows which pages are its.
    api.dropSourceFile?.(source.id);
    if (!removeSource(set, source.id).ok) return;
    listSignature = "";
    ctx.setStatus(`${source.name} removed.`, "ok");
    ctx.changed();
  }

  // Page Up / Page Down step through the plan pages of the floor on screen, and stop at its ends.
  window.addEventListener("keydown", (e) => {
    if ((e.key !== "PageUp" && e.key !== "PageDown") || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const target = e.target;
    if (target?.closest?.("input, textarea, select, [contenteditable='true']") || dialog) return;
    const doc = ctx.doc();
    const set = doc.sheetSet;
    const current = set?.pages.find((p) => p.index === doc.underlay?.sheetPage);
    if (!set || !current || !isPlanPage(current)) return;
    const pages = pagesForLevel(set, current.levelId);
    if (pages.length < 2) return;
    const at = pages.findIndex((p) => p.index === current.index);
    const next = pages[at + (e.key === "PageDown" ? 1 : -1)];
    e.preventDefault();
    if (next) goToPage(next);
  });

  function syncSnap() {
    const snap = ctx.pdfSnap;
    if (!snap) {
      snapLabel.hidden = true;
      return;
    }
    const show = snap.available();
    snapLabel.hidden = !show;
    if (!show) return;
    if (document.activeElement !== snapCheck) snapCheck.checked = snap.enabled();
    const status = snap.status();
    if (status === "loading") snapNote.textContent = " (reading…)";
    else if (status === "empty") snapNote.textContent = " (no vector lines)";
    else if (status === "failed") snapNote.textContent = " (could not read)";
    else snapNote.textContent = "";
  }

  /** Refresh the status bar. Cheap; called on every render. */
  function sync() {
    const needs = api.sheetSetNeedsPdf(ctx.doc());
    const loading = ctx.loadingName?.() || null;
    loadChip.hidden = !loading;
    if (loading) loadChip.textContent = `Loading ${loading}…`;
    repickBar.hidden = !needs;
    if (needs) {
      const waiting = api.sourcesNeedingFile(ctx.doc());
      const first = waiting[0];
      const more = waiting.length > 1 ? ` (${waiting.length} files are waiting)` : "";
      repickText.textContent = first?.assetId
        ? `${first.name} is not loaded in this session.${more}`
        : `${first?.name ?? "The plan file"} was saved before plan files were stored. Choose it once and it will be kept.${more}`;
    }
    syncList();
    syncSnap();
  }

  // --- reference panel -------------------------------------------------------
  //
  // Any page can sit beside the plan, not over it. Elevations, sections and
  // other each hold as many sheets as you mark. The window is fixed to the
  // screen, so it can be dragged over the building cut and the inspector.
  // Wheel zooms at the pointer, drag pans the page. Measure takes two clicks
  // and reports the real length at the page's printed scale; "Use as floor to
  // ceiling" writes that length onto the level selected in the footer.

  const PX_PER_PT = REFERENCE_DPI / 72;
  const REF_MIN_ZOOM = 0.05;
  const REF_MAX_ZOOM = 4;
  /** Canvas pixels per point are capped so a zoomed A1 sheet stays within memory; CSS stretches the rest. */
  const REF_MAX_RENDER = 2.2;

  let refPanel = null;
  let refDispose = null;

  function closeReference() {
    refDispose?.();
    refDispose = null;
    refPanel?.remove();
    refPanel = null;
  }

  function openReference(pageIndex) {
    const doc = ctx.doc();
    const set = doc.sheetSet;
    const wanted = set?.pages.find((p) => p.index === pageIndex);
    if (!set?.pages?.length) {
      ctx.setStatus("Import a plan set first.", "warn");
      return;
    }
    if (!api.hasOpenPdf()) {
      ctx.setStatus(`${api.sourcesNeedingFile(doc)[0]?.name ?? set.pdfName} is not loaded in this session. Choose the PDF first.`, "warn");
      return;
    }
    if (refPanel) {
      refPanel.switchTo?.(pageIndex);
      return;
    }

    const extras = new Set();
    let group = "elevation";
    const remembered = { elevation: null, section: null, other: null };
    let current = wanted
      || set.pages.find((p) => p.role === "elevation")
      || set.pages.find((p) => p.role === "section")
      || set.pages.find((p) => p.role === "other")
      || null;
    let zoom = 0.3;
    let measuring = false;
    let points = [];
    let renderJob = null;
    let renderTimer = 0;
    let renderToken = 0;

    const wrapper = h("div", { class: "sheet-set-ref-page" });
    const svgNS = "http://www.w3.org/2000/svg";
    const overlay = document.createElementNS(svgNS, "svg");
    overlay.setAttribute("class", "sheet-set-ref-overlay");
    const scroller = h("div", { class: "sheet-set-ref-scroll" }, wrapper);
    const kindTabs = h("div", { class: "sheet-set-ref-kinds", role: "tablist", "aria-label": "Elevations, sections or other" });
    const pageTabs = h("div", { class: "sheet-set-ref-pages", role: "tablist", "aria-label": "Pages in this group" });
    const zoomLabel = h("span", { class: "sheet-set-zoom" });
    const measureButton = h("button", { type: "button", "aria-pressed": "false", title: "Click two points to measure a length at this page's printed scale", text: "Measure" });
    const refSnap = h("label", { class: "sheet-set-snap", title: "Snap measure clicks to this page's vector corners" },
      h("input", { type: "checkbox" }), " Snap");
    const refSnapCheck = refSnap.querySelector("input");
    refSnapCheck.checked = ctx.pdfSnap?.enabled() ?? true;
    refSnapCheck.addEventListener("change", () => ctx.pdfSnap?.setEnabled(refSnapCheck.checked));
    const readout = h("span", { class: "sheet-set-measure-readout", text: "" });
    const useButton = h("button", { type: "button", text: "Use as floor to ceiling", hidden: true });
    const scaleField = h("input", { type: "text", class: "sheet-set-scale", list: "sheet-set-scales-panel", "aria-label": "Printed scale of this page", title: "The scale printed on this sheet. Measurements use it." });

    // Ceiling height: typed from the section, or taken from a measurement the user chose to keep.
    const levelSelect = h("select", { "aria-label": "Level" }, ctx.levels().map((l) => h("option", { value: l.id, text: l.name || l.id })));
    levelSelect.value = ctx.activeLevel() || levelSelect.options[0]?.value || "";
    const ceiling = h("input", { type: "text", inputmode: "decimal", autocomplete: "off", "aria-label": "Floor to ceiling in millimetres", title: "Floor-to-ceiling height of the selected level, in millimetres" });
    const ceilingNote = h("span", { class: "sheet-set-ceiling-note" });
    const levelName = () => ctx.levels().find((l) => l.id === levelSelect.value)?.name || levelSelect.value;
    const showCeiling = () => {
      const level = ctx.levels().find((l) => l.id === levelSelect.value);
      const typed = set.ceilingHeights[levelSelect.value];
      const value = Number.isFinite(typed) ? typed : level?.floorToCeiling;
      ceiling.value = Number.isFinite(value) ? String(Math.round(value * 1000)) : "";
      ceilingNote.textContent = Number.isFinite(typed) ? "set by you" : Number.isFinite(level?.floorToCeiling) ? "template default" : "not set";
      const name = levelName();
      useButton.title = name
        ? `Save this measurement as the floor-to-ceiling height of ${name}`
        : "Save this measurement as the floor-to-ceiling height";
    };
    /** "1 700", "1700" and "1,7" (a decimal comma) are millimetres. Blank clears. */
    const parseCeilingMm = (text) => {
      const t = String(text ?? "").trim().replace(/\s/g, "").replace(/mm$/i, "");
      if (!t) return null;
      const n = Number(t.replace(",", "."));
      return Number.isFinite(n) ? n : NaN;
    };
    const saveCeiling = () => {
      const mm = parseCeilingMm(ceiling.value);
      if (Number.isNaN(mm)) {
        ctx.setStatus("Enter the floor-to-ceiling height in millimetres, e.g. 2700.", "warn");
        showCeiling();
        return;
      }
      const metres = mm === null ? null : mm / 1000;
      const prev = set.ceilingHeights[levelSelect.value];
      const prevMm = Number.isFinite(prev) ? Math.round(prev * 1000) : null;
      const nextMm = metres === null ? null : Math.round(metres * 1000);
      if (prevMm === nextMm) {
        showCeiling();
        return;
      }
      if (metres !== null && !(metres > 0 && metres < 20)) {
        ctx.setStatus("Enter the floor-to-ceiling height in millimetres, e.g. 2700.", "warn");
        showCeiling();
        return;
      }
      if (!levelSelect.value) {
        ctx.setStatus("Choose the level this height belongs to.", "warn");
        return;
      }
      ctx.pushUndo?.();
      if (!setCeilingHeight(set, levelSelect.value, metres)) {
        ctx.setStatus("Enter the floor-to-ceiling height in millimetres, e.g. 2700.", "warn");
        showCeiling();
        return;
      }
      ctx.levelsChanged();
      showCeiling();
      const name = levelName();
      ctx.setStatus(metres === null ? `Ceiling height cleared on ${name}.` : `Floor to ceiling set to ${Math.round(metres * 1000)} mm on ${name}.`, "ok");
    };
    levelSelect.addEventListener("change", showCeiling);
    ceiling.addEventListener("change", saveCeiling);
    ceiling.addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveCeiling();
    });

    const ptW = () => current.pixelWidth / PX_PER_PT;
    const ptH = () => current.pixelHeight / PX_PER_PT;

    function measuredMetres() {
      if (!current || points.length < 2) return null;
      const d = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
      return referenceDistanceMetres(d, current.printedScale);
    }

    function paintOverlay() {
      if (!current) {
        readout.textContent = "";
        useButton.hidden = true;
        return;
      }
      overlay.setAttribute("viewBox", `0 0 ${current.pixelWidth} ${current.pixelHeight}`);
      overlay.replaceChildren();
      const ink = "#b2451e";
      const dot = (p) => {
        const c = document.createElementNS(svgNS, "circle");
        c.setAttribute("cx", p.x);
        c.setAttribute("cy", p.y);
        c.setAttribute("r", 7 / Math.max(zoom, 0.05) / PX_PER_PT * 1.0);
        c.setAttribute("fill", ink);
        overlay.append(c);
      };
      if (points.length === 2) {
        const l = document.createElementNS(svgNS, "line");
        l.setAttribute("x1", points[0].x);
        l.setAttribute("y1", points[0].y);
        l.setAttribute("x2", points[1].x);
        l.setAttribute("y2", points[1].y);
        l.setAttribute("stroke", ink);
        l.setAttribute("stroke-width", "2");
        l.setAttribute("vector-effect", "non-scaling-stroke");
        overlay.append(l);
      }
      points.forEach(dot);
      const m = measuredMetres();
      readout.textContent = m ? `${Math.round(m * 1000).toLocaleString("en-ZA")} mm at 1:${current.printedScale}` : measuring ? (points.length ? "Click the second point" : "Click the first point") : "";
      useButton.hidden = !m;
    }

    function sizePage() {
      wrapper.style.width = `${Math.round(ptW() * zoom)}px`;
      wrapper.style.height = `${Math.round(ptH() * zoom)}px`;
      zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    }

    /** CSS stretches the old bitmap at once; the sharp render swaps in when the zoom settles. */
    function scheduleRender() {
      clearTimeout(renderTimer);
      renderTimer = setTimeout(renderNow, 150);
    }

    async function renderNow() {
      if (!current) return;
      renderJob?.cancel();
      const token = ++renderToken;
      const next = document.createElement("canvas");
      next.className = "sheet-set-ref-canvas";
      renderJob = api.renderReferencePage(current.index, next, Math.min(zoom, REF_MAX_RENDER));
      const ok = await renderJob.promise;
      if (!ok || token !== renderToken || !refPanel) return;
      wrapper.querySelector("canvas")?.remove();
      wrapper.prepend(next);
    }

    function setZoom(z, anchor) {
      if (!current) return;
      const before = zoom;
      zoom = Math.min(REF_MAX_ZOOM, Math.max(REF_MIN_ZOOM, z));
      if (zoom === before) return;
      const ax = anchor?.x ?? scroller.clientWidth / 2;
      const ay = anchor?.y ?? scroller.clientHeight / 2;
      const wx = (scroller.scrollLeft + ax) / before;
      const wy = (scroller.scrollTop + ay) / before;
      sizePage();
      scroller.scrollLeft = wx * zoom - ax;
      scroller.scrollTop = wy * zoom - ay;
      paintOverlay();
      scheduleRender();
    }

    function fit() {
      if (!current) return;
      zoom = Math.min(REF_MAX_ZOOM, Math.max(REF_MIN_ZOOM, (scroller.clientWidth - 2) / ptW()));
      sizePage();
      scroller.scrollLeft = 0;
      scroller.scrollTop = 0;
      paintOverlay();
      scheduleRender();
    }

    const GROUPS = [["elevation", "Elevations"], ["section", "Sections"], ["other", "Other"]];

    function groupOf(page) {
      if (!page) return null;
      if (page.role === "elevation" || page.role === "section") return page.role;
      if (page.role === "other" || extras.has(page.index)) return "other";
      return null;
    }

    function pagesIn(which) {
      if (which === "elevation" || which === "section") return set.pages.filter((p) => p.role === which);
      const more = set.pages.filter((p) => p.role === "other");
      for (const index of extras) {
        const page = set.pages.find((p) => p.index === index);
        if (page && page.role !== "elevation" && page.role !== "section" && page.role !== "other") more.push(page);
      }
      return more;
    }

    function showEmpty(which) {
      const name = which === "elevation" ? "Elevation" : which === "section" ? "Section" : "Other";
      const noun = which === "elevation" ? "elevations" : which === "section" ? "sections" : "other pages";
      wrapper.style.width = "";
      wrapper.style.height = "";
      wrapper.replaceChildren(h("p", {
        class: "sheet-set-ref-empty",
        text: `No ${noun} yet. On Not drawn, open Show as and choose ${name}.`,
      }));
    }

    function rebuildChrome() {
      kindTabs.replaceChildren(...GROUPS.map(([id, label]) => {
        const n = pagesIn(id).length;
        return h("button", {
          type: "button",
          role: "tab",
          "aria-selected": String(group === id),
          text: n ? `${label} ${n}` : label,
          onclick: () => switchGroup(id),
        });
      }));
      const list = pagesIn(group);
      pageTabs.hidden = list.length === 0;
      pageTabs.replaceChildren(...list.map((p) => h("button", {
        type: "button",
        role: "tab",
        "data-index": String(p.index),
        "aria-selected": String(p.index === current?.index),
        title: p.label,
        text: p.label,
        onclick: () => switchTo(p.index),
      })));
    }

    function switchGroup(id) {
      group = id;
      const list = pagesIn(id);
      const page = list.find((p) => p.index === remembered[id]) || list[0];
      if (page) switchTo(page.index);
      else {
        current = null;
        points = [];
        remembered[id] = null;
        rebuildChrome();
        showEmpty(id);
        paintOverlay();
      }
    }

    function switchTo(index) {
      const page = set.pages.find((p) => p.index === index);
      if (!page) return;
      if (page.role === "elevation" || page.role === "section" || page.role === "other") extras.delete(page.index);
      else extras.add(page.index);
      group = groupOf(page) || "other";
      remembered[group] = page.index;
      current = page;
      points = [];
      scaleField.value = formatPrintedScale(current.printedScale);
      wrapper.replaceChildren(overlay);
      rebuildChrome();
      if (ctx.pdfSnap?.enabled()) api.ensurePageLinework?.(current.index);
      fit();
    }

    function refresh() {
      if (current) {
        const page = set.pages.find((p) => p.index === current.index);
        const nextGroup = page ? groupOf(page) : null;
        if (page && nextGroup && pagesIn(nextGroup).some((p) => p.index === page.index)) {
          if (nextGroup !== group) group = nextGroup;
          remembered[group] = page.index;
          current = page;
          rebuildChrome();
          return;
        }
      }
      const list = pagesIn(group);
      if (list[0]) switchTo(list[0].index);
      else switchGroup(group);
    }

    measureButton.addEventListener("click", () => {
      measuring = !measuring;
      points = [];
      measureButton.setAttribute("aria-pressed", String(measuring));
      scroller.classList.toggle("is-measuring", measuring);
      paintOverlay();
    });
    scroller.addEventListener("click", (e) => {
      if (!current || !measuring || panMoved) return;
      const r = wrapper.getBoundingClientRect();
      let point = { x: ((e.clientX - r.left) / zoom) * PX_PER_PT, y: ((e.clientY - r.top) / zoom) * PX_PER_PT };
      if (ctx.pdfSnap?.enabled()) {
        api.ensurePageLinework?.(current.index);
        const radius = (10 / Math.max(zoom, 0.05)) * PX_PER_PT;
        const hit = api.snapReferencePixel?.(current.index, point.x, point.y, radius);
        if (hit) point = { x: hit.x, y: hit.y };
      }
      points = points.length >= 2 ? [point] : [...points, point];
      paintOverlay();
    });
    useButton.addEventListener("click", () => {
      const m = measuredMetres();
      if (!m) return;
      ceiling.value = String(Math.round(m * 1000));
      saveCeiling();
    });
    scaleField.addEventListener("change", () => {
      if (!current) return;
      const n = parsePrintedScale(scaleField.value);
      if (n && n !== current.printedScale) {
        ctx.pushUndo?.();
        setPageScale(set, current.index, n);
        ctx.changed();
      }
      scaleField.value = formatPrintedScale(current.printedScale);
      paintOverlay();
    });

    // Wheel zooms at the pointer; dragging pans (unless measuring).
    scroller.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = scroller.getBoundingClientRect();
      setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), { x: e.clientX - r.left, y: e.clientY - r.top });
    }, { passive: false });
    let panFrom = null;
    let panMoved = false;
    scroller.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      panFrom = { x: e.clientX, y: e.clientY, left: scroller.scrollLeft, top: scroller.scrollTop };
      panMoved = false;
      scroller.setPointerCapture(e.pointerId);
    });
    scroller.addEventListener("pointermove", (e) => {
      if (!panFrom) return;
      const dx = e.clientX - panFrom.x;
      const dy = e.clientY - panFrom.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) panMoved = true;
      if (measuring && !panMoved) return;
      scroller.scrollLeft = panFrom.left - dx;
      scroller.scrollTop = panFrom.top - dy;
    });
    const endPan = () => {
      panFrom = null;
      setTimeout(() => (panMoved = false), 0);
    };
    scroller.addEventListener("pointerup", endPan);
    scroller.addEventListener("pointercancel", endPan);

    const dragHandle = h("span", { class: "sheet-set-ref-drag", title: "Drag to move this panel", "aria-label": "Move panel", text: "⠿" });
    const resizeHandle = h("div", { class: "sheet-set-ref-resize", title: "Drag to resize", "aria-label": "Resize panel" });
    const panel = h("div", { class: "sheet-set-ref-window", role: "dialog", "aria-label": "Reference sheets" },
      h("div", { class: "sheet-set-ref-head" },
        dragHandle,
        kindTabs,
        measureButton,
        refSnap,
        h("button", { type: "button", text: "Fit", title: "Fit the page to the width", onclick: fit }),
        h("button", { type: "button", "aria-label": "Zoom out", text: "−", onclick: () => setZoom(zoom / 1.25) }),
        zoomLabel,
        h("button", { type: "button", "aria-label": "Zoom in", text: "+", onclick: () => setZoom(zoom * 1.25) }),
        h("button", { type: "button", text: "Close", onclick: closeReference })),
      pageTabs,
      scroller,
      h("div", { class: "sheet-set-ref-foot" },
        h("label", {}, "Printed ", scaleField),
        readout,
        useButton,
        h("span", { class: "sheet-set-ref-spacer" }),
        h("label", {}, "Level ", levelSelect),
        h("label", {}, "Floor to ceiling ", ceiling, " mm"),
        ceilingNote),
      resizeHandle);

    const clamp = (n, a, b) => Math.min(Math.max(n, a), b);
    function placePanel() {
      if (panel.dataset.placed) return;
      const r = panel.getBoundingClientRect();
      panel.style.left = `${r.left}px`;
      panel.style.top = `${r.top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.width = `${r.width}px`;
      panel.style.height = `${r.height}px`;
      panel.dataset.placed = "1";
    }
    function trackPointer(startEvent, onMove) {
      startEvent.preventDefault();
      startEvent.stopPropagation();
      const id = startEvent.pointerId;
      const target = startEvent.currentTarget;
      target.setPointerCapture?.(id);
      const move = (ev) => {
        if (ev.pointerId === id) onMove(ev);
      };
      const end = (ev) => {
        if (ev.pointerId !== id) return;
        target.removeEventListener("pointermove", move);
        target.removeEventListener("pointerup", end);
        target.removeEventListener("pointercancel", end);
      };
      target.addEventListener("pointermove", move);
      target.addEventListener("pointerup", end);
      target.addEventListener("pointercancel", end);
    }
    function startMove(e) {
      if (e.button !== 0) return;
      placePanel();
      const start = { x: e.clientX, y: e.clientY, left: parseFloat(panel.style.left), top: parseFloat(panel.style.top) };
      trackPointer(e, (ev) => {
        const maxL = Math.max(0, window.innerWidth - panel.offsetWidth);
        const maxT = Math.max(0, window.innerHeight - panel.offsetHeight);
        panel.style.left = `${clamp(start.left + ev.clientX - start.x, 0, maxL)}px`;
        panel.style.top = `${clamp(start.top + ev.clientY - start.y, 0, maxT)}px`;
      });
    }
    dragHandle.addEventListener("pointerdown", startMove);
    panel.querySelector(".sheet-set-ref-head").addEventListener("pointerdown", (e) => {
      if (e.target.closest("button, input, select, label, .sheet-set-ref-drag")) return;
      startMove(e);
    });
    resizeHandle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      placePanel();
      const start = { x: e.clientX, y: e.clientY, left: parseFloat(panel.style.left), top: parseFloat(panel.style.top), w: panel.offsetWidth, h: panel.offsetHeight };
      trackPointer(e, (ev) => {
        const minW = Math.min(320, window.innerWidth);
        const minH = Math.min(220, window.innerHeight);
        let width = clamp(start.w + ev.clientX - start.x, minW, window.innerWidth);
        let height = clamp(start.h + ev.clientY - start.y, minH, window.innerHeight);
        let left = start.left;
        let top = start.top;
        if (left + width > window.innerWidth) left = Math.max(0, window.innerWidth - width);
        if (top + height > window.innerHeight) top = Math.max(0, window.innerHeight - height);
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.style.width = `${width}px`;
        panel.style.height = `${height}px`;
      });
    });

    panel.switchTo = (i) => {
      if (Number.isInteger(i)) switchTo(i);
    };
    panel.refresh = refresh;
    refPanel = panel;
    refDispose = () => {
      clearTimeout(renderTimer);
      renderToken++;
      renderJob?.cancel();
    };
    document.body.append(panel);
    showCeiling();
    // Layout is known only once attached.
    requestAnimationFrame(() => {
      if (current) switchTo(current.index);
      else switchGroup("elevation");
    });
  }

  return {
    ask, toast, confirmReplace, trackUpload,
    goToSheet: (index, options) => {
      const page = ctx.doc().sheetSet?.pages.find((p) => p.index === index);
      if (page) goToPage(page, options);
    },
    setListVisible, listVisible: () => listShown, openPicker, importFile: openImport, openReference: () => openReference(), syncPanel, afterCalibration, sync, closeDialog, closeReference };
}
