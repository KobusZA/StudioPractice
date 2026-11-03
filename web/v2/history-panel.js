// The history list. Rows are not controls: undo and redo live on the buttons
// outside this markup, and a click here does not move the drawing.

/** "Deleted room Bedroom" / "Deleted room Bedroom and a door" / "Deleted a, b, and 2 more". */
export function historyAction(verb, names) {
  const list = (names || []).map((name) => String(name || "").trim()).filter(Boolean);
  if (!list.length) return verb;
  if (list.length === 1) return `${verb} ${list[0]}`;
  if (list.length === 2) return `${verb} ${list[0]} and ${list[1]}`;
  if (list.length === 3) return `${verb} ${list[0]}, ${list[1]}, and ${list[2]}`;
  return `${verb} ${list[0]}, ${list[1]}, and ${list.length - 2} more`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Applied steps oldest-first, then undone steps with the one Redo will
 * restore sitting directly under the current step. When every step is
 * undone, a pinned "As opened" row is current.
 */
export function historyIconKind(label) {
  const text = String(label || "");
  if (text === "As opened") return "open";
  if (/^(Deleted|Removed|Cleared|Took)\b/.test(text)) return "delete";
  if (/^(Rotated|Flipped)\b/.test(text)) return "rotate";
  if (/^(Moved|Aligned)\b/.test(text)) return "move";
  if (/^(Drew|Placed|Added|Connected)\b/.test(text)) return "add";
  if (/^Renamed\b/.test(text)) return "rename";
  if (/^(Grouped|Ungrouped)\b/.test(text)) return "group";
  if (/^(Pinned|Unpinned)\b/.test(text)) return "pin";
  return "edit";
}

const ICONS = {
  open: `<path d="M3 2.5h6l4 4V13.5H3z"/><path d="M9 2.5V6.5h4"/>`,
  delete: `<path d="M3.5 4.5h9M6 4.5V3.2h4v1.3M4.6 4.5l.6 9h5.6l.6-9"/>`,
  move: `<path d="M8 2v12M2 8h12M8 2L6.2 3.8M8 2l1.8 1.8M8 14l-1.8-1.8M8 14l1.8-1.8M2 8l1.8-1.8M2 8l1.8 1.8M14 8l-1.8-1.8M14 8l-1.8 1.8"/>`,
  add: `<path d="M8 2.5v11M2.5 8h11"/>`,
  rename: `<path d="M3 12.6l7.2-7.2 1.7 1.7L4.7 14.3H3z"/>`,
  rotate: `<path d="M12.6 6.2a4.6 4.6 0 1 0 .4 3.6"/><path d="M12.6 3.2v3h-3"/>`,
  edit: `<path d="M2.5 12.5l.8-3.2L10.2 2.4l3.4 3.4-6.9 6.9-4.2-.2z"/>`,
  pin: `<path d="M6 2.5h4l-.6 4.2 2.1 2.1H4.5l2.1-2.1zM8 8.8v4.7"/>`,
  group: `<path d="M3 6.5h6.5V13H3zM6.5 3H13v6.5"/>`,
};

function rowOf(entry, removed) {
  const label = entry.label || "Edit";
  return { label, removed, icon: historyIconKind(label) };
}

export function historyView(undoStack, redoStack) {
  const applied = (undoStack || []).filter((entry) => !entry.pending).map((entry) => rowOf(entry, false));
  const undone = [...(redoStack || [])].reverse().map((entry) => rowOf(entry, true));
  const rows = [...applied, ...undone];
  if (!applied.length) rows.unshift({ label: "As opened", removed: false, pinned: true, icon: "open" });
  const current = applied.length ? applied.length - 1 : 0;
  return { rows, current };
}

function rowIcon(kind) {
  return `<svg class="history-ico" data-icon="${kind}" viewBox="0 0 16 16" aria-hidden="true">${ICONS[kind] || ICONS.edit}</svg>`;
}

/** List markup only. No buttons, links, or jump targets. */
export function historyListHtml(undoStack, redoStack) {
  const { rows, current } = historyView(undoStack, redoStack);
  return rows.map((row, index) => {
    const cls = ["history-row"];
    if (index === current) cls.push("is-current");
    if (row.removed) cls.push("is-removed");
    const currentAttr = index === current ? ` aria-current="step"` : "";
    const removed = row.removed ? `<span class="visually-hidden">Removed</span>` : "";
    return `<div class="${cls.join(" ")}" role="listitem"${currentAttr}>${rowIcon(row.icon)}<span class="history-label">${escapeHtml(row.label)}</span>${removed}</div>`;
  }).join("");
}
