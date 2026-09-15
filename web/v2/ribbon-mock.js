// Evaluation mock: Simple vs Full ribbon. Does not change the live planner.
// Full is the current RIBBON. Simple is a filtered, task-ordered overlay.

import { RIBBON, renderRibbon } from "./ribbon.js";

const EMPTY_CATEGORIES = new Set(["boundarywall", "beam", "furniture"]);

const HINTS = {
  underlay: "Load a PDF or image to trace.",
  calibrate: "Click two points on the sheet, then type the real distance.",
  "underlay-adjust": "Drag the sheet to move, a corner to resize, the top handle to rotate.",
  "underlay-toggle": "Hide the sheet without removing it.",
  "underlay-off": "Remove the sheet from the plan.",
  walls: "Click to start a wall, click again to end. Esc to stop.",
  floors: "Click around a room to draw a floor slab.",
  roofs: "Click around the outline to draw a roof.",
  ceilings: "Draws at floor-to-ceiling height above this level, not at floor level.",
  doors: "Click a wall to place a door.",
  windows: "Click a wall to place a window.",
  stairs: "Click to place a stair.",
  electrical: "Click to place an electrical fitting.",
  plumbing: "Click to place sanitary ware.",
  waterheater: "Click to place a water heater.",
  drainage: "Click to place a drainage fitting.",
  rooms: "Click inside enclosed walls to tag a room.",
  dimensions: "Click two points to measure.",
  rotate: "Select something first, then rotate.",
  "view-3d": "Open a massing view of the current plan.",
  compile: "Build the bill of quantities from what you have drawn.",
  gaps: "List facts the template still needs before compliance can run.",
};

const SIMPLE = [
  {
    id: "draw",
    label: "Draw",
    groups: [
      {
        label: "Sheet",
        collapseAfterLoad: true,
        items: [
          { id: "underlay", label: "PDF / image", command: "underlay", primary: true },
          { id: "calibrate", label: "Set scale", command: "calibrate" },
          { id: "underlay-adjust", label: "Move / rotate", command: "underlay-adjust" },
          { id: "underlay-toggle", label: "Hide", command: "underlay-toggle" },
        ],
      },
      {
        label: "Levels",
        items: [{ id: "level-isolate", label: "This storey only", command: "level-isolate" }],
      },
      {
        label: "Walls",
        items: [{ id: "walls", label: "Walls", tool: "wall", categories: ["wall"], primary: true }],
      },
      {
        label: "Floors & roofs",
        items: [
          { id: "floors", label: "Floors", tool: "slab", categories: ["floor", "pool"] },
          { id: "roofs", label: "Roofs", tool: "roof", categories: ["roof", "carport"] },
        ],
      },
      {
        label: "Ceilings",
        items: [{ id: "ceilings", label: "Ceiling", tool: "slab", categories: ["ceiling"] }],
      },
      {
        label: "Openings",
        items: [
          { id: "doors", label: "Doors", tool: "door", categories: ["door"], primary: true },
          { id: "windows", label: "Windows", tool: "window", categories: ["window"], primary: true },
        ],
      },
      {
        label: "Circulation",
        items: [{ id: "stairs", label: "Staircase", tool: "place", categories: ["stair"] }],
      },
      {
        label: "Services",
        items: [
          { id: "electrical", label: "Electrical", tool: "place", categories: ["electrical"] },
          { id: "plumbing", label: "Plumbing", tool: "place", categories: ["sanitary"] },
          { id: "waterheater", label: "Water heating", tool: "place", categories: ["waterheater"] },
          { id: "drainage", label: "Drainage", tool: "place", categories: ["drainage"] },
        ],
      },
    ],
  },
  {
    id: "annotate",
    label: "Annotate",
    groups: [
      {
        label: "Rooms",
        items: [{ id: "rooms", label: "Room", tool: "room", categories: ["floor"] }],
      },
      {
        label: "Measure",
        items: [{ id: "dimensions", label: "Dimensions", command: "dimensions" }],
      },
    ],
  },
  {
    id: "modify",
    label: "Modify",
    needsSelection: true,
    groups: [
      {
        label: "Edit",
        items: [
          { id: "rotate", label: "Rotate", command: "rotate" },
          { id: "mirror", label: "Mirror", command: "mirror" },
          { id: "copy", label: "Copy", command: "copy" },
          { id: "align", label: "Align", command: "align" },
          { id: "split", label: "Split", command: "split" },
          { id: "join", label: "Join", command: "join" },
        ],
      },
      {
        label: "Arrange",
        items: [
          { id: "group", label: "Group", command: "group" },
          { id: "ungroup", label: "Ungroup", command: "ungroup" },
          { id: "delete", label: "Delete", command: "delete" },
        ],
      },
    ],
  },
  {
    id: "issue",
    label: "Issue",
    groups: [
      {
        label: "Views",
        items: [{ id: "view-3d", label: "3D", command: "view-3d" }],
      },
      {
        label: "Quantities",
        items: [{ id: "boq", label: "Quantities", command: "compile" }],
      },
      {
        label: "Check",
        items: [{ id: "gaps", label: "Data quality", command: "gaps" }],
      },
    ],
  },
];

const state = {
  view: "compare",
  scenario: "empty",
  activeTabSimple: "draw",
  activeTabFull: "build",
  activeFunction: null,
  hint: "Click a function to see the next-step hint.",
};

function skuCount(categories) {
  return categories.some((c) => EMPTY_CATEGORIES.has(c)) ? 0 : 4;
}

function sheetLoaded() {
  return state.scenario !== "empty";
}

function hasSelection() {
  return state.scenario === "selected";
}

function underlayState(item) {
  const ids = new Set(["underlay-adjust", "calibrate", "underlay-toggle", "underlay-off"]);
  if (!ids.has(item.id)) return null;
  if (!sheetLoaded()) return { disabled: true, title: "Load a PDF or image first." };
  if (item.id === "underlay-toggle") {
    return { label: "Hide", title: HINTS["underlay-toggle"] };
  }
  if (item.id === "underlay-adjust") {
    return { title: HINTS["underlay-adjust"] };
  }
  if (item.id === "calibrate") {
    return { title: HINTS.calibrate };
  }
  return null;
}

function countRibbon(tabs, opts) {
  let live = 0;
  let disabled = 0;
  let hidden = 0;
  for (const tab of tabs) {
    for (const group of tab.groups) {
      for (const item of group.items) {
        const vis = visibleItem(item, group, opts);
        if (!vis) {
          hidden += 1;
          continue;
        }
        if (item.todo || emptyItem(item) || extraDisabled(item, opts)) disabled += 1;
        else live += 1;
      }
    }
  }
  return { live, disabled, hidden, tabs: tabs.length };
}

function emptyItem(item) {
  return item.categories && skuCount(item.categories) === 0;
}

function extraDisabled(item, opts) {
  if (opts?.mode === "simple" && opts?.needsSelection && !hasSelection()) {
    if (item.command && ["rotate", "mirror", "copy", "align", "split", "join", "group", "ungroup", "delete"].includes(item.command)) {
      return true;
    }
  }
  const extra = underlayState(item);
  return Boolean(extra?.disabled);
}

function visibleItem(item, group, opts) {
  if (opts?.mode !== "simple") return true;
  if (item.todo) return false;
  if (emptyItem(item)) return false;
  if (group.collapseAfterLoad && sheetLoaded()) {
    return item.id !== "underlay";
  }
  if (!sheetLoaded() && group.collapseAfterLoad) {
    return item.id === "underlay";
  }
  return true;
}

function simpleTabsForState() {
  return SIMPLE.map((tab) => ({
    ...tab,
    groups: tab.groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => visibleItem(item, group, { mode: "simple" })),
      }))
      .filter((group) => group.items.length),
  })).filter((tab) => tab.groups.length);
}

const SCALE_STEPS = ["large", "stack", "icon", "collapsed"];

function glyphSvg(id) {
  const paths = GLYPHS[id] || GLYPHS.generic;
  return `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

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

function fillItemFace(btn, id, caption) {
  btn.replaceChildren();
  btn.insertAdjacentHTML("afterbegin", glyphSvg(id));
  const cap = document.createElement("span");
  cap.className = "caption";
  cap.textContent = caption;
  btn.append(cap);
}

function overflowing(el) {
  const groups = [...el.querySelectorAll(":scope > .ribbon-group")];
  if (!groups.length) return false;
  const parentBox = el.getBoundingClientRect();
  const lastBox = groups[groups.length - 1].getBoundingClientRect();
  return lastBox.right > parentBox.right + 2;
}

function closeOverflowMenus(except) {
  document.querySelectorAll(".ribbon-group.is-open").forEach((g) => {
    if (g !== except) g.classList.remove("is-open");
  });
}

function decorateRibbon(functionsEl) {
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

function compactRight(groups, from, to, keepFirst) {
  const end = keepFirst ? 1 : 0;
  for (let i = groups.length - 1; i >= end; i -= 1) {
    if (groups[i].dataset.scale === from) {
      groups[i].dataset.scale = to;
      return true;
    }
  }
  return false;
}

function fitRibbon(el) {
  if (!el || el.hidden || !el.offsetParent) return "";
  closeOverflowMenus();
  const groups = [...el.querySelectorAll(":scope > .ribbon-group")];
  for (const g of groups) g.dataset.scale = "large";
  while (overflowing(el) && compactRight(groups, "large", "stack")) { /* shrink rightmost first */ }
  while (overflowing(el) && compactRight(groups, "stack", "icon")) { /* then icons only */ }
  while (overflowing(el) && collapseWideIconGroup(groups)) { /* dropdown only if it saves width */ }
  return fitSummary(groups);
}

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

function fitSummary(groups) {
  const tally = { large: 0, stack: 0, icon: 0, collapsed: 0 };
  for (const g of groups) tally[g.dataset.scale] += 1;
  return SCALE_STEPS.filter((s) => tally[s]).map((s) => `${tally[s]} ${s}`).join(", ") || "empty";
}

function renderMockRibbon(tabsEl, functionsEl, tabs, mode) {
  const activeTab = mode === "simple" ? state.activeTabSimple : state.activeTabFull;
  const known = new Set(tabs.map((t) => t.id));
  const current = known.has(activeTab) ? activeTab : tabs[0]?.id;

  tabsEl.innerHTML = "";
  for (const tab of tabs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tab";
    btn.textContent = tab.label;
    btn.classList.toggle("active", tab.id === current);
    btn.addEventListener("click", () => {
      if (mode === "simple") state.activeTabSimple = tab.id;
      else state.activeTabFull = tab.id;
      draw();
    });
    tabsEl.appendChild(btn);
  }

  const tab = tabs.find((t) => t.id === current) || tabs[0];
  functionsEl.innerHTML = "";
  if (!tab) return;

  if (mode === "simple" && tab.needsSelection && !hasSelection()) {
    const note = document.createElement("p");
    note.className = "mock-select-hint";
    note.textContent = "Select a wall, door or slab on the plan, then these tools unlock.";
    functionsEl.appendChild(note);
    return;
  }

  for (const group of tab.groups) {
    const wrap = document.createElement("div");
    wrap.className = "ribbon-group";
    const items = document.createElement("div");
    items.className = "ribbon-group-items";
    for (const item of group.items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ribbon-item";
      btn.dataset.function = item.id;
      const extra = underlayState(item) || {};
      fillItemFace(btn, item.id, extra.label || item.label);
      const empty = emptyItem(item);
      const selLocked = mode === "simple" && tab.needsSelection && !hasSelection();
      if (item.todo) {
        btn.disabled = true;
        btn.title = `Not built yet. ${item.todo}`;
      } else if (empty) {
        btn.disabled = true;
        btn.title = `The template has no ${item.categories.join(" or ")} types.`;
      } else if (extra.disabled || selLocked) {
        btn.disabled = true;
        btn.title = selLocked ? "Select something on the plan first." : extra.title || "";
      } else {
        btn.classList.toggle("active", item.id === state.activeFunction);
        btn.title = extra.title || HINTS[item.id] || item.label;
        btn.addEventListener("click", () => {
          state.activeFunction = item.id;
          state.hint = HINTS[item.id] || extra.title || `${item.label}`;
          draw();
        });
      }
      items.appendChild(btn);
    }
    const label = document.createElement("span");
    label.className = "ribbon-group-label";
    label.textContent = group.label;
    wrap.append(items, label);
    functionsEl.appendChild(wrap);
  }
  decorateRibbon(functionsEl);
}

function renderFull(tabsEl, functionsEl) {
  renderRibbon(tabsEl, functionsEl, {
    mode: "full",
    activeTab: state.activeTabFull,
    activeFunction: state.activeFunction,
    skuCount,
    commandState: underlayState,
    onTab: (id) => {
      state.activeTabFull = id;
      draw();
    },
    onFunction: (item) => {
      state.activeFunction = item.id;
      state.hint = HINTS[item.id] || item.hint || item.label;
      draw();
    },
  });
}

function statsLine(prefix, tabs, opts) {
  const c = countRibbon(tabs, opts);
  return `${prefix}: ${c.tabs} tabs · ${c.live} live · ${c.disabled} disabled${c.hidden ? ` · ${c.hidden} hidden` : ""}`;
}

function draw() {
  const simplePane = document.getElementById("mock-simple");
  const fullPane = document.getElementById("mock-full");
  const simpleTabs = document.getElementById("mock-simple-tabs");
  const simpleFn = document.getElementById("mock-simple-functions");
  const fullTabs = document.getElementById("mock-full-tabs");
  const fullFn = document.getElementById("mock-full-functions");
  const hint = document.getElementById("mock-hint");
  const stats = document.getElementById("mock-stats");
  const headerModify = document.getElementById("mock-header-modify");

  const showSimple = state.view !== "full";
  const showFull = state.view !== "simple";
  simplePane.hidden = !showSimple;
  fullPane.hidden = !showFull;

  if (showSimple) renderMockRibbon(simpleTabs, simpleFn, simpleTabsForState(), "simple");
  if (showFull) {
    renderFull(fullTabs, fullFn);
    decorateRibbon(fullFn);
  }

  hint.textContent = state.hint;
  headerModify.hidden = !(state.view !== "full" && hasSelection());

  const simpleCount = statsLine("Simple", SIMPLE, { mode: "simple" });
  const fullCount = statsLine("Full", RIBBON, { mode: "full" });
  stats.textContent = state.view === "simple" ? simpleCount : state.view === "full" ? fullCount : `${simpleCount}  ·  ${fullCount}`;

  requestAnimationFrame(() => {
    const fits = [];
    if (showSimple) {
      const f = fitRibbon(simpleFn);
      if (f) fits.push(`Simple fit: ${f}`);
    }
    if (showFull) {
      const f = fitRibbon(fullFn);
      if (f) fits.push(`Full fit: ${f}`);
    }
    if (fits.length) stats.textContent += `  ·  ${fits.join("  ·  ")}`;
  });
}

function bind() {
  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.view = btn.dataset.view;
      document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b === btn));
      draw();
    });
  });
  document.querySelectorAll("[data-scenario]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.scenario = btn.dataset.scenario;
      document.querySelectorAll("[data-scenario]").forEach((b) => b.classList.toggle("active", b === btn));
      if (state.scenario === "empty") state.activeFunction = null;
      draw();
    });
  });
  draw();
  document.addEventListener("click", () => closeOverflowMenus());
  window.addEventListener("resize", () => {
    const simpleFit = fitRibbon(document.getElementById("mock-simple-functions"));
    const fullFit = fitRibbon(document.getElementById("mock-full-functions"));
    const statsEl = document.getElementById("mock-stats");
    const parts = [];
    if (simpleFit) parts.push(`Simple fit: ${simpleFit}`);
    if (fullFit) parts.push(`Full fit: ${fullFit}`);
    if (parts.length && statsEl) {
      const base = statsEl.textContent.split("  ·  Simple fit:")[0].split("  ·  Full fit:")[0];
      statsEl.textContent = `${base}  ·  ${parts.join("  ·  ")}`;
    }
  });
}

bind();
