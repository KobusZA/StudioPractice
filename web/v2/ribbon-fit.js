// Ribbon layout: icon glyphs and the Excel-style shrink-to-width behaviour.
//
// Kept separate from ribbon.js on purpose. ribbon.js owns *what* a function
// is - label, command, tool, categories, todo - the information architecture.
// This module owns how a rendered ribbon fits the available width, which is
// layout, not IA. Ported from ribbon-mock.js once Simple was live as the
// default density and still felt right to keep.
//
// decorateRibbon() runs once after every render: it fills in an icon for any
// ribbon-item that does not already have one, and gives each group an
// overflow button (a dropdown trigger) for when the group has to collapse.
//
// fitRibbon() runs after decoration, and again on resize: it walks the
// groups right-to-left, shrinking each from large -> stack -> icon ->
// collapsed until the row fits on one line, or there is nothing left to
// shrink. It always resets every group to "large" first, so it is safe to
// call repeatedly (tab switches, a sheet loading and changing which items
// show, window resize) without compounding a previous shrink.

const GLYPHS = {
  generic: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  underlay: '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 15l4-4 3 3 4-5 5 6"/>',
  calibrate: '<path d="M4 20L20 4"/><path d="M8 20h-4v-4M16 4h4v4"/>',
  "underlay-adjust": '<rect x="5" y="7" width="14" height="10" rx="1"/><path d="M12 4v3M12 17v3"/>',
  "underlay-toggle": '<path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.2"/>',
  "underlay-off": '<path d="M6 6l12 12M18 6L6 18"/>',
  dwg: '<path d="M7 4h7l5 5v11H7z"/><path d="M14 4v5h5"/>',
  cad: '<path d="M7 4h7l5 5v11H7z"/><path d="M14 4v5h5"/>',
  levels: '<path d="M4 8h16M4 12h16M4 16h16"/>',
  "level-isolate": '<path d="M4 7h16M4 12h16M4 17h16"/><rect x="5" y="10" width="14" height="4" fill="currentColor" stroke="none"/>',
  walls: '<path d="M4 8h16M4 16h16M9 4v16M15 4v16"/>',
  boundary: '<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 2"/>',
  foundations: '<path d="M4 18h16M6 18V9l6-4 6 4v9"/>',
  floors: '<rect x="4" y="10" width="16" height="8"/><path d="M4 10l8-5 8 5"/>',
  roofs: '<path d="M3 13l9-8 9 8"/><path d="M6 13v7h12v-7"/>',
  ceilings: '<path d="M4 7h16M6 7v4M18 7v4M8 11h8"/>',
  doors: '<rect x="7" y="3" width="10" height="18"/><circle cx="15" cy="13" r="0.8" fill="currentColor" stroke="none"/>',
  windows: '<rect x="4" y="5" width="16" height="14"/><path d="M12 5v14M4 12h16"/>',
  beams: '<path d="M4 11h16v3H4z"/><path d="M7 8v8M17 8v8"/>',
  columns: '<path d="M9 4h6M10 4v16M14 4v16M8 20h8"/>',
  stairs: '<path d="M4 20h4v-4h4v-4h4V8h4V4"/>',
  ramp: '<path d="M4 20h16V8z"/>',
  railings: '<path d="M4 20V8M12 20V8M20 20V8M4 8h16"/>',
  electrical: '<path d="M10 2l-2 10h4l-2 10"/>',
  plumbing: '<path d="M8 4v6a4 4 0 008 0V4M12 14v6"/>',
  waterheater: '<rect x="7" y="4" width="10" height="16" rx="3"/><path d="M12 9v4"/>',
  drainage: '<path d="M4 6h16M6 6v6a6 6 0 0012 0V6"/>',
  furniture: '<path d="M5 11h14v8H5zM5 11V8h14v3M9 19v2M15 19v2"/>',
  casework: '<rect x="4" y="5" width="16" height="15"/><path d="M12 5v15M4 12h16"/>',
  rooms: '<rect x="4" y="5" width="16" height="14"/><path d="M4 10h16"/>',
  "room-sep": '<path d="M4 12h16M12 4v16"/>',
  "model-lines": '<path d="M5 19L19 5"/>',
  "annot-lines": '<path d="M5 19L19 5"/><path d="M7 7h3M14 17h3"/>',
  dimensions: '<path d="M5 8v8M19 8v8M5 12h14"/>',
  revision: '<path d="M5 16c3-8 11-8 14 0"/>',
  region: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  section: '<path d="M4 4l16 16M8 4h-4v4M16 20h4v-4"/>',
  elevation: '<rect x="5" y="8" width="14" height="12"/><path d="M5 12h14M9 8v12"/>',
  grids: '<path d="M4 8h16M4 16h16M8 4v16M16 4v16"/>',
  "project-info": '<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h.01"/>',
  finishes: '<path d="M4 18h16M6 18l4-10 4 6 2-3 4 7"/>',
  "property-line": '<path d="M4 18L12 4l8 14"/>',
  "sg-coords": '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
  "building-line": '<rect x="6" y="7" width="12" height="12"/><path d="M3 20h18"/>',
  contours: '<path d="M4 16c3-2 5 2 8 0s5 2 8 0"/>',
  contour: '<path d="M4 16c3-2 5 2 8 0s5 2 8 0"/>',
  platform: '<path d="M4 18h16M6 18l3-8h6l3 8"/>',
  rotate: '<path d="M20 12a8 8 0 11-3-6.3"/><path d="M20 4v5h-5"/>',
  mirror: '<path d="M12 4v16M6 8l6 4-6 4M18 8l-6 4 6 4"/>',
  copy: '<rect x="8" y="8" width="11" height="11"/><path d="M5 16V5h11"/>',
  align: '<path d="M4 6h16M4 12h10M4 18h16"/>',
  merge: '<path d="M6 6v12M18 6v12M6 12h12"/>',
  split: '<path d="M12 4v16M6 9l6 3 6-3M6 15l6-3 6 3"/>',
  cut: '<path d="M5 5l14 14M9 15a3 3 0 11-4 4 3 3 0 014-4zM19 5a3 3 0 11-4 4 3 3 0 014-4z"/>',
  join: '<path d="M5 12h14M8 8l-3 4 3 4M16 8l3 4-3 4"/>',
  group: '<rect x="4" y="6" width="7" height="12"/><rect x="13" y="6" width="7" height="12"/>',
  ungroup: '<rect x="3" y="7" width="7" height="10"/><rect x="14" y="7" width="7" height="10"/>',
  undo: '<path d="M9 13H5V9"/><path d="M5 13a8 8 0 111.5 4.5"/>',
  delete: '<path d="M5 7h14M9 7V5h6v2M8 7l1 13h6l1-13"/>',
  "view-3d": '<path d="M12 4l8 4v8l-8 4-8-4V8z"/><path d="M12 12V20M12 12l8-4M12 12L4 8"/>',
  callout: '<circle cx="8" cy="8" r="3"/><path d="M10.5 10.5L20 20"/>',
  "view-section": '<path d="M4 4l16 16M8 4h-4v4M16 20h4v-4"/>',
  boq: '<path d="M7 4h10v16H7z"/><path d="M9 9h6M9 13h6M9 17h4"/>',
  bom: '<path d="M7 4h10v16H7z"/><path d="M9 9h6M9 13h6M9 17h4"/>',
  sheets: '<rect x="5" y="4" width="10" height="14"/><path d="M9 8h10v14H9"/>',
  "print-boq": '<rect x="6" y="10" width="12" height="8"/><path d="M8 10V6h8v4M8 18v3h8v-3"/>',
  "print-bom": '<rect x="6" y="10" width="12" height="8"/><path d="M8 10V6h8v4M8 18v3h8v-3"/>',
  "part-c": '<rect x="5" y="5" width="14" height="14"/><path d="M8 12h8"/>',
  "part-o": '<circle cx="12" cy="12" r="7"/><path d="M8 12h8"/>',
  "part-m": '<path d="M4 20h4v-4h4v-4h4V8h4"/>',
  zoning: '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>',
  gaps: '<path d="M8 7h8M8 12h5M8 17h8"/>',
};

function glyphSvg(id) {
  const paths = GLYPHS[id] || GLYPHS.generic;
  return `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function fillItemFace(btn, id, caption) {
  btn.replaceChildren();
  btn.insertAdjacentHTML("afterbegin", glyphSvg(id));
  const cap = document.createElement("span");
  cap.className = "caption";
  cap.textContent = caption;
  btn.append(cap);
}

/** Close every open overflow dropdown, e.g. on an outside click or before a re-fit. */
export function closeOverflowMenus(except) {
  document.querySelectorAll(".ribbon-group.is-open").forEach((g) => {
    if (g !== except) g.classList.remove("is-open");
  });
}

/**
 * Give every ribbon-item an icon (if `renderRibbon` did not already add one)
 * and every group an overflow button, ready for `fitRibbon` to show once the
 * group collapses. Idempotent: safe to call after every render.
 */
export function decorateRibbon(functionsEl) {
  if (!functionsEl) return;
  for (const group of functionsEl.querySelectorAll(":scope > .ribbon-group")) {
    group.dataset.scale = "large";
    for (const btn of group.querySelectorAll(".ribbon-item")) {
      if (btn.querySelector(".glyph")) continue;
      const id = btn.dataset.function || "generic";
      fillItemFace(btn, id, btn.textContent.trim());
    }
    if (!group.querySelector(".ribbon-overflow-btn")) {
      const ov = document.createElement("button");
      ov.type = "button";
      ov.className = "ribbon-overflow-btn";
      const name = group.querySelector(".ribbon-group-label")?.textContent || "More";
      ov.innerHTML = `${glyphSvg("generic")}<span class="caption">${name}</span>`;
      ov.title = `${name} — more commands`;
      ov.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = group.classList.contains("is-open");
        closeOverflowMenus();
        group.classList.toggle("is-open", !open);
      });
      const label = group.querySelector(".ribbon-group-label");
      group.insertBefore(ov, label);
    }
  }
}

function overflowing(el) {
  const groups = [...el.querySelectorAll(":scope > .ribbon-group")];
  if (!groups.length) return false;
  const parentBox = el.getBoundingClientRect();
  const lastBox = groups[groups.length - 1].getBoundingClientRect();
  return lastBox.right > parentBox.right + 2;
}

function compactRight(groups, from, to) {
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    if (groups[i].dataset.scale === from) {
      groups[i].dataset.scale = to;
      return true;
    }
  }
  return false;
}

/** Fold an icon-scale group into its dropdown, but only if that group is
 * wide enough (4+ items) for the fold to actually save row width. */
function collapseWideIconGroup(groups) {
  for (let i = groups.length - 1; i >= 1; i -= 1) {
    const g = groups[i];
    if (g.dataset.scale !== "icon") continue;
    if (g.querySelectorAll(".ribbon-item").length < 4) continue;
    g.dataset.scale = "collapsed";
    return true;
  }
  return false;
}

/**
 * Shrink groups right-to-left until the row fits on one line: large -> stack
 * (three rows, smaller glyph, caption still visible) -> icon (caption
 * hidden) -> collapsed (folds into a dropdown). Call after every render and
 * on window resize.
 */
export function fitRibbon(el) {
  if (!el || el.hidden || !el.offsetParent) return;
  closeOverflowMenus();
  const groups = [...el.querySelectorAll(":scope > .ribbon-group")];
  if (!groups.length) return;
  for (const g of groups) g.dataset.scale = "large";
  while (overflowing(el) && compactRight(groups, "large", "stack")) { /* shrink rightmost first */ }
  while (overflowing(el) && compactRight(groups, "stack", "icon")) { /* then icons only */ }
  while (overflowing(el) && collapseWideIconGroup(groups)) { /* dropdown only if it saves width */ }
}
