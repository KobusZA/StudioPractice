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
// fitRibbon() runs after decoration, and again on resize: it steps groups
// down their ladders (comfort first, then size, then captions, then a
// dropdown) in priority order until the row fits on one line, then hands
// space back so nothing is left empty. It always starts from the best look,
// so it is safe to call repeatedly (tab switches, a sheet loading and
// changing which items show, window resize) without compounding a shrink.

const GLYPHS = {
  generic: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  underlay: '<path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5z"/><path d="M14 3v4.5h4.5"/><path d="M12 11v6M9.5 14.5 12 17l2.5-2.5"/>',
  satellite: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17"/>',
  calibrate: '<path d="M4 20L20 4"/><path d="M8 20h-4v-4M16 4h4v4"/>',
  "underlay-adjust": '<rect x="6" y="3" width="12" height="18" rx="1"/><path d="M6 16h12"/>',
  "underlay-toggle": '<path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.2"/>',
  "trace-view": '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M8 12h8M12 8v8"/>',
  "underlay-off": '<path d="M6 6l12 12M18 6L6 18"/>',
  dwg: '<path d="M7 4h7l5 5v11H7z"/><path d="M14 4v5h5"/>',
  cad: '<path d="M7 4h7l5 5v11H7z"/><path d="M14 4v5h5"/>',
  "add-floor": '<path d="M3 14h12M3 19h12"/><path d="M3 9h7" stroke-dasharray="2 2"/><path d="M18 4v6M15 7h6"/>',
  "remove-floor": '<path d="M3 14h12M3 19h12"/><path d="M15 7h6"/>',
  levels: '<path d="M3 5h18M3 19h18"/><path d="M3 12h9"/><path d="M15 12h6M18 9v6"/>',
  "level-isolate": '<path d="M4 7h16M4 12h16M4 17h16"/><rect x="5" y="10" width="14" height="4" fill="currentColor" stroke="none"/>',
  walls: '<path d="M3 19V5h12v4.67h3v4.66h3V19z"/><path d="M3 9.67h12M3 14.33h15"/><path stroke-width="1.3" d="M9 5v4.67M6 9.67v4.66M12 9.67v4.66M9 14.33V19M15 14.33V19"/>',
  boundary: '<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 2.4"/>',
  foundations: '<path d="M9 3v11M15 3v11"/><path d="M5 14h14v5H5z"/>',
  floors: '<path d="M3 14 8 9h13l-5 5z"/><path d="M3 14v3h13v-3M16 17l5-5v-3"/>',
  roofs: '<path d="M2 13 12 5l10 8"/><path d="M5 11v8h14v-8"/>',
  ceilings: '<path d="M3 5h18v3H3z"/><path d="M7 11v2M12 11v4M17 11v2"/>',
  doors: '<path d="M6.5 21V3h11v18"/><path d="M4 21h16"/><circle cx="14.8" cy="12.5" r="1" fill="currentColor" stroke="none"/>',
  windows: '<path d="M6 3h12v15H6z"/><path d="M12 3v15M6 10.5h12"/><path d="M4.5 20.5h15"/>',
  beams: '<path d="M4 11h16v3H4z"/><path d="M7 8v8M17 8v8"/>',
  columns: '<path d="M5 4h14M5 20h14"/><path d="M8 4v16M16 4v16"/>',
  stairs: '<path d="M3 20h5v-5h5v-5h5V5h3"/>',
  electrical: '<path d="M13 2 5 14h6l-1 8 8-12h-6z"/>',
  plumbing: '<path d="M12 3c3.5 4.5 6 7.8 6 11a6 6 0 0 1-12 0c0-3.2 2.5-6.5 6-11z"/>',
  drainage: '<circle cx="12" cy="12" r="8"/><path d="M8 10h8M8 14h8"/>',
  "service-route": '<path d="M5 18h6V6h8"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/>',
  "service-node": '<path d="M3 17l7-6 11 3"/><circle cx="3" cy="17" r="1.6"/><circle cx="21" cy="14" r="1.6"/><circle cx="10" cy="11" r="2.4"/>',
  "service-rise": '<path d="M12 20V6M7 11l5-5 5 5"/><path d="M5 20h14"/>',
  "service-connect": '<circle cx="7" cy="12" r="3"/><circle cx="17" cy="12" r="3"/><path d="M10 12h4"/>',
  "service-type": '<path d="M4 8h16M4 16h16"/><circle cx="12" cy="12" r="3"/>',
  "service-slope": '<path d="M4 8l16 8"/><path d="M4 8v8h16"/>',
  furniture: '<path d="M5.5 11V7A1.5 1.5 0 0 1 7 5.5h10A1.5 1.5 0 0 1 18.5 7v4"/><path d="M12 5.5V11"/><path d="M2.5 11a1.5 1.5 0 0 1 3 0v3h13v-3a1.5 1.5 0 0 1 3 0v6h-19z"/><path d="M4.5 17v2.5M19.5 17v2.5"/>',
  "scale-person": '<circle cx="12" cy="5" r="2"/><path d="M12 7v6M8 10h8M9 20l3-7 3 7"/>',
  "scale-car": '<path d="M4 15h16v3H4z"/><path d="M6 15l2-4h8l2 4"/><circle cx="7.5" cy="18" r="1.4"/><circle cx="16.5" cy="18" r="1.4"/>',
  casework: '<rect x="3" y="6" width="18" height="13" rx="1"/><path d="M12 6v13M9.5 12h.01M14.5 12h.01"/>',
  rooms: '<path d="M4 4h16v16H4z"/>',
  "room-sep": '<path d="M4 4h16v16H4z"/><path d="M12 4v16" stroke-dasharray="2.5 2.2"/>',
  "model-lines": '<path d="M5 19L19 5"/>',
  "annot-lines": '<path d="M5 19L19 5"/><path d="M7 7h3M14 17h3"/>',
  dimensions: '<path d="M5 8v8M19 8v8M5 12h14"/>',
  revision: '<path d="M5 16c3-8 11-8 14 0"/>',
  region: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  section: '<path d="M4 4l16 16M8 4h-4v4M16 20h4v-4"/>',
  elevation: '<rect x="5" y="8" width="14" height="12"/><path d="M5 12h14M9 8v12"/>',
  grids: '<path d="M4 8h16M4 16h16M8 4v16M16 4v16"/>',
  "project-info": '<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h.01"/>',
  finishes: '<path d="M4 4h16v16H4z"/><path d="M4 12h16M12 4v16"/>',
  "property-line": '<path d="M4 18L12 4l8 14"/>',
  "sg-coords": '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
  "building-line": '<rect x="6" y="7" width="12" height="12"/><path d="M3 20h18"/>',
  contours: '<path d="M4 16c3-2 5 2 8 0s5 2 8 0"/>',
  contour: '<path d="M4 16c3-2 5 2 8 0s5 2 8 0"/>',
  platform: '<path d="M4 18h16M6 18l3-8h6l3 8"/>',
  move: '<path d="M12 4v16M4 12h16M12 4l-3 3M12 4l3 3M12 20l-3-3M12 20l3-3M4 12l3-3M4 12l3 3M20 12l-3-3M20 12l-3 3"/>',
  rotate: '<path d="M20 12a8 8 0 11-3-6.3"/><path d="M20 4v5h-5"/>',
  mirror: '<path d="M12 4v16M6 8l6 4-6 4M18 8l-6 4 6 4"/>',
  copy: '<rect x="8" y="8" width="11" height="11"/><path d="M5 16V5h11"/>',
  align: '<path d="M4 6h16M4 12h10M4 18h16"/>',
  merge: '<path d="M6 6v12M18 6v12M6 12h12"/>',
  split: '<path d="M12 4v16M6 9l6 3 6-3M6 15l6-3 6 3"/>',
  cut: '<path d="M5 5l14 14M9 15a3 3 0 11-4 4 3 3 0 014-4zM19 5a3 3 0 11-4 4 3 3 0 014-4z"/>',
  join: '<path d="M5 12h14M8 8l-3 4 3 4M16 8l3 4-3 4"/>',
  "split-wall": '<path d="M12 4v16M6 9l6 3 6-3M6 15l6-3 6 3"/>',
  // Contextual-tab commands. Same 24x24 stroked style as the rest.
  snap: '<path d="M4 12h7"/><circle cx="14" cy="12" r="2.4"/><path d="M20 6v12M17 9l3-3 3 3"/>',
  "edit-face": '<rect x="5" y="6" width="14" height="13" rx="1"/><path d="M5 11h14M9 6v13"/>',
  "flip-face": '<path d="M12 4v16"/><path d="M8 8L4 12l4 4M16 8l4 4-4 4"/>',
  "second-screen": '<rect x="3" y="6" width="10" height="8" rx="1"/><rect x="14" y="10" width="7" height="8" rx="1"/><path d="M6 18h4"/>',
  "add-finish": '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M12 9v6M9 12h6"/>',
  "finish-done": '<path d="M5 12l5 5L19 7"/>',
  "flip-hinge": '<path d="M5 4v16"/><path d="M5 5h10a4 4 0 014 4v6"/><path d="M16 12l3 3 3-3"/>',
  "flip-swing": '<path d="M4 12h16"/><path d="M8 12a6 6 0 016-6M8 12a6 6 0 006 6"/><path d="M14 3l2 3-3 1M14 21l2-3-3-1"/>',
  "roof-cut": '<path d="M2 15 12 7l10 8"/><path d="M14 3 9 21" stroke-dasharray="2.5 2"/>',
  "roof-cut-here": '<path d="M3 13l9-8 9 8"/><rect x="9" y="10" width="6" height="5" stroke-dasharray="2 2"/>',
  "edit-poly": '<path d="M5 17l3-10 9 2 2 8z"/><circle cx="5" cy="17" r="1.4"/><circle cx="8" cy="7" r="1.4"/><circle cx="17" cy="9" r="1.4"/><circle cx="19" cy="17" r="1.4"/>',
  "follow-walls": '<rect x="4" y="4" width="16" height="16" rx="1"/><rect x="8" y="8" width="8" height="8" stroke-dasharray="2 2"/><path d="M10 12h4"/>',
  "mark-existing": '<rect x="5" y="5" width="14" height="14" rx="1"/><path d="M8 12.5l2.5 2.5 5.5-6"/>',
  "mark-proposed": '<rect x="5" y="5" width="14" height="14" rx="1" stroke-dasharray="3 2"/><path d="M8 12h8"/>',
  "exit-modify": '<path d="M14 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H14"/><path d="M10 12h10M16.5 8.5 20 12l-3.5 3.5"/>',
  "select-similar": '<rect x="4" y="5" width="7" height="7"/><rect x="13" y="12" width="7" height="7"/><path d="M13 8h4M7 15v4"/>',
  "trim-corner": '<path d="M5 5v14h14"/><path d="M5 19L19 5" stroke-dasharray="2 2"/>',
  "trim-single": '<path d="M4 12h16"/><path d="M12 12v8"/><path d="M12 4v5" stroke-dasharray="2 2"/>',
  "trim-circle": '<circle cx="12" cy="12" r="6" stroke-dasharray="3 2"/><path d="M4 12h16M12 4v16"/>',
  attach: '<path d="M4 20h16"/><rect x="7" y="10" width="10" height="6"/><path d="M12 4v6M9 7l3-3 3 3"/>',
  detach: '<path d="M4 20h16"/><rect x="7" y="6" width="10" height="6"/><path d="M12 14v4M9 15l3 3 3-3"/>',
  "wall-finishes": '<rect x="4" y="3" width="13" height="5" rx="1"/><path d="M17 5.5h3v5h-8v3"/><path d="M11 13.5h2V21h-2z"/>',
  group: '<rect x="4" y="6" width="7" height="12"/><rect x="13" y="6" width="7" height="12"/>',
  ungroup: '<rect x="3" y="7" width="7" height="10"/><rect x="14" y="7" width="7" height="10"/>',
  undo: '<path d="M9 13H5V9"/><path d="M5 13a8 8 0 111.5 4.5"/>',
  redo: '<path d="M15 13h4V9"/><path d="M19 13a8 8 0 10-1.5 4.5"/>',
  delete: '<path d="M5 7h14M9 7V5h6v2M8 7l1 13h6l1-13"/>',
  "view-3d": '<path d="M12 4l8 4v8l-8 4-8-4V8z"/><path d="M12 12V20M12 12l8-4M12 12L4 8"/>',
  "view-camera": '<path d="M4 9h11v8H4z"/><path d="M15 12l5-3v8l-5-3z"/><circle cx="9.5" cy="13" r="2"/>',
  callout: '<circle cx="8" cy="8" r="3"/><path d="M10.5 10.5L20 20"/>',
  "view-section": '<path d="M4 4l16 16M8 4h-4v4M16 20h4v-4"/>',
  boq: '<path d="M7 4h10v16H7z"/><path d="M9 9h6M9 13h6M9 17h4"/>',
  bom: '<path d="M7 4h10v16H7z"/><path d="M9 9h6M9 13h6M9 17h4"/>',
  sheets: '<rect x="5" y="4" width="10" height="14"/><path d="M9 8h10v14H9"/>',
  "print-boq": '<rect x="6" y="10" width="12" height="8"/><path d="M8 10V6h8v4M8 18v3h8v-3"/>',
  "print-bom": '<rect x="6" y="10" width="12" height="8"/><path d="M8 10V6h8v4M8 18v3h8v-3"/>',
  check: '<path d="M5 12l4.5 4.5L19 7"/>',
  "part-c": '<rect x="5" y="5" width="14" height="14"/><path d="M8 12h8"/>',
  "part-o": '<circle cx="12" cy="12" r="7"/><path d="M8 12h8"/>',
  "part-m": '<path d="M4 20h4v-4h4v-4h4V8h4"/>',
  zoning: '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>',
  gaps: '<path d="M8 7h8M8 12h5M8 17h8"/>',
  more: '<circle cx="6" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
};

function glyphSvg(id) {
  const paths = GLYPHS[id] || GLYPHS.generic;
  return `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
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
  document.querySelectorAll(".ribbon-group.is-open, .ribbon-group.is-menu-open").forEach((g) => {
    if (g === except) return;
    g.classList.remove("is-open");
    g.classList.remove("is-menu-open");
    g.querySelector(".ribbon-more-btn")?.setAttribute("aria-expanded", "false");
  });
}

/**
 * Give every ribbon-item an icon (if `renderRibbon` did not already add one)
 * and every group an overflow button, ready for `fitRibbon` to show once the
 * group collapses. Idempotent: safe to call after every render.
 */
export function decorateRibbon(functionsEl) {
  if (!functionsEl) return;
  for (const group of functionsEl.querySelectorAll(":scope > .ribbon-group:not(.ribbon-settings)")) {
    for (const btn of group.querySelectorAll(".ribbon-item")) {
      if (btn.querySelector(".glyph")) continue;
      const id = btn.dataset.function || "generic";
      fillItemFace(btn, id, btn.textContent.trim());
    }
    if (!group.querySelector(".ribbon-overflow-btn")) {
      const ov = document.createElement("button");
      ov.type = "button";
      ov.className = "ribbon-overflow-btn";
      const labelEl = group.querySelector(".ribbon-group-label");
      const name = labelEl?.dataset.full || labelEl?.textContent || "More";
      // The folded group keeps its lead tool's face, and stays lit while one
      // of its tools is the active one.
      const lead = group.querySelector(".ribbon-item.anchor") || group.querySelector(".ribbon-item");
      ov.innerHTML = `${glyphSvg(lead?.dataset.function || "generic")}<span class="caption">${name}</span>`;
      ov.title = `${name} — more commands`;
      ov.classList.toggle("active", Boolean(group.querySelector(".ribbon-item.active")));
      ov.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = group.classList.contains("is-open");
        closeOverflowMenus();
        group.classList.toggle("is-open", !open);
      });
      const label = group.querySelector(".ribbon-group-label");
      group.insertBefore(ov, label);
    }
    const more = group.querySelector(".ribbon-more-btn");
    const menuButtons = [...group.querySelectorAll(".ribbon-menu .ribbon-item")];
    if (more && menuButtons.length && !more.querySelector(".glyph")) {
      fillItemFace(more, "more", "More");
      more.title = menuButtons.map((b) => b.querySelector(".caption")?.textContent || b.textContent.trim()).join(", ");
      more.classList.toggle("active", menuButtons.some((b) => b.classList.contains("active")));
      more.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = group.classList.contains("is-menu-open");
        closeOverflowMenus();
        group.classList.toggle("is-menu-open", !open);
        more.setAttribute("aria-expanded", String(!open));
      });
    }
  }
}

// --- Fitting -----------------------------------------------------------
//
// Every group has a "kind" (set by renderRibbon from what is in it) and a
// ladder of steps for that kind. Step 0 is the best look; each step gives up
// a little more. Comfort (row height, padding, column width) goes before
// button size, captions go before the buttons, and a dropdown is the last
// resort. CSS reads the attributes below, so this module owns the ladder and
// v2.css owns what each attribute looks like.
//
//   data-big       "1" = large icon-over-caption buttons (kind "large", opted in)
//   data-comfort   "comfy" | "narrow" | "tight"   (small buttons)
//   data-lone      "tile" = a small button alone in its column turns into a
//                  short icon-over-caption tile, its caption wrapping onto
//                  two lines, so it keeps its name in half the width
//   data-anchors   "inline" = the lead button joins the small rows (kind "mixed")
//   data-icons     "" | "rest" | "all"            (captions hidden)
//   data-scale     "collapsed"                    (group folds into a dropdown)

export const LADDERS = {
  // Opted-in groups: large buttons, then stacked small ones, then icons.
  large: [
    { big: "1", comfort: "comfy" },
    { big: "1", comfort: "tight" },
    { big: "0", comfort: "tight" },
    { big: "0", comfort: "tight", icons: "all" },
  ],
  // No lead button: always a three-row grid.
  stack: [
    { comfort: "comfy" },
    { comfort: "comfy", lone: "tile" },
    { comfort: "narrow", lone: "tile" },
    { comfort: "tight", lone: "tile" },
    { comfort: "tight", icons: "all" },
    { collapsed: true },
  ],
  // A lead button and at most two others (Room and Room separator). Names
  // stay as long as they can: the lone one wraps into a tile, then the lead
  // joins the others as one labelled column, and only then icons.
  mixed: [
    {},
    { lone: "tile" },
    { anchors: "inline" },
    { anchors: "inline", icons: "all" },
    { collapsed: true },
  ],
  // A lead button and three or more others (Walls and its openings). Too
  // many to fold into one column, so the lead stays large while the rest
  // tighten and then drop their captions.
  wide: [
    {},
    { lone: "tile" },
    { lone: "tile", comfort: "tight" },
    { comfort: "tight", icons: "rest" },
    { collapsed: true },
  ],
  // The running command's controls. Tighten the spacing first, while every
  // control stays on the row; folding Top and Height into a menu is last,
  // after every other group has already given up what it can.
  settings: [
    {},
    { density: "tight" },
    { density: "fold" },
  ],
};

const ATTRS = ["big", "comfort", "lone", "anchors", "icons", "density"];

/** Lowest key shrinks first. */
export function shrinkKey(kind, prio, step) {
  // Tighten before any other group moves; fold only once the rest are spent.
  if (kind === "settings") return step === 0 ? -4 : 30 + step;
  return step - prio;
}

export function maxStep(kind) {
  return (LADDERS[kind] || LADDERS.stack).length - 1;
}

/**
 * Decide each group's step. Pure: `groups` is [{ kind, prio }] and `fits(steps)`
 * answers whether the row fits at those steps, so this can be tested without
 * a browser.
 *
 * 1. Shrink one step at a time, always the group with the lowest shrinkKey
 *    (ties go to the rightmost), until the row fits.
 * 2. Grow back: a step is coarse and can free more room than it needed, so
 *    hand steps back, most recently favoured group first, keeping each only
 *    if the row still fits. That removes dead space on the right.
 */
export function planSteps(groups, fits) {
  const steps = groups.map(() => 0);
  let guard = 400;
  while (!fits(steps) && guard-- > 0) {
    let pick = -1;
    let pickKey = Infinity;
    groups.forEach((g, i) => {
      if (steps[i] >= maxStep(g.kind)) return;
      const key = shrinkKey(g.kind, g.prio, steps[i]);
      if (key <= pickKey) {
        pickKey = key;
        pick = i;
      }
    });
    if (pick < 0) return steps; // nothing left to shrink
    steps[pick] += 1;
  }
  if (!fits(steps)) return steps;

  const blocked = new Set();
  for (let g2 = 400; g2-- > 0;) {
    let pick = -1;
    let pickKey = -Infinity;
    groups.forEach((g, i) => {
      if (steps[i] === 0 || blocked.has(i)) return;
      const key = shrinkKey(g.kind, g.prio, steps[i] - 1);
      if (key > pickKey) {
        pickKey = key;
        pick = i;
      }
    });
    if (pick < 0) break;
    steps[pick] -= 1;
    if (fits(steps)) blocked.clear();
    else {
      steps[pick] += 1;
      blocked.add(pick);
    }
  }
  return steps;
}

function applyStep(group, step) {
  const kind = group.dataset.kind || "stack";
  const ladder = LADDERS[kind] || LADDERS.stack;
  const s = ladder[Math.min(step, ladder.length - 1)];
  for (const a of ATTRS) delete group.dataset[a];
  delete group.dataset.scale;
  group.dataset.step = String(step);
  const label = group.querySelector(":scope > .ribbon-group-label");
  if (label?.dataset.short) label.textContent = s.icons ? label.dataset.short : label.dataset.full;
  if (s.collapsed) {
    group.dataset.scale = "collapsed";
    return;
  }
  for (const a of ATTRS) if (s[a]) group.dataset[a] = s[a];
}

function overflowing(el) {
  const groups = [...el.querySelectorAll(":scope > .ribbon-group")];
  if (!groups.length) return false;
  const parentBox = el.getBoundingClientRect();
  const lastBox = groups[groups.length - 1].getBoundingClientRect();
  // The window, not just the row: a row that grows with its content reports
  // itself as fitting while its tail sits past the screen.
  const limit = Math.min(parentBox.right, window.innerWidth);
  return lastBox.right > limit + 2;
}

/**
 * Fit the active tab's groups on one line, using `planSteps`. Call after every
 * render and on window resize. It always starts from step 0, so repeated
 * calls (tab switches, a sheet loading, resizes) never compound.
 */
export function fitRibbon(el) {
  if (!el || el.hidden || !el.offsetParent) return;
  closeOverflowMenus();
  // The running command's settings join the plan (kind "settings"): they
  // tighten before anything else and fold Top and Height into a menu only
  // at the end. The underlay mode strip stays fixed. Overflow is measured
  // against the last group, so a fixed strip on the end still counts.
  const groups = [...el.querySelectorAll(":scope > .ribbon-group")].filter((g) => g.dataset.fit !== "fixed");
  if (!groups.length) return;
  const plan = groups.map((g) => ({ kind: g.dataset.kind || "stack", prio: Number(g.dataset.prio) || 0 }));
  const fits = (steps) => {
    steps.forEach((s, i) => applyStep(groups[i], s));
    return !overflowing(el);
  };
  const steps = planSteps(plan, fits);
  // The last probe may not be the chosen plan, so apply it explicitly.
  steps.forEach((s, i) => applyStep(groups[i], s));
}

