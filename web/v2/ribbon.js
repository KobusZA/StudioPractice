// Toolbar information architecture, transcribed from the customer's
// "TSP Build Pro - Business Requirements" sheet (02 Sept 2026).
//
// Their four toolbars are reproduced in their order and wording, plus a fifth
// Check tab that the sheet does not ask for. Compliance checking is the thing
// Revit cannot do, so it gets a tab rather than being hidden in a panel.
//
// A function is one of three things:
//   categories  - filters the type list and arms a drawing tool
//   command     - runs something immediately
//   todo        - not built yet; renders disabled with the reason on hover,
//                 because a greyed button with an honest tooltip reads as a
//                 roadmap and a missing button reads as a gap.

export const RIBBON = [
  {
    id: "build",
    label: "Build",
    groups: [
      {
        label: "Add drawing",
        items: [
          { id: "underlay", label: "PDF / image", command: "underlay" },
          { id: "underlay-adjust", label: "Move / rotate", command: "underlay-adjust" },
          { id: "calibrate", label: "Set scale", command: "calibrate" },
          { id: "underlay-toggle", label: "Hide", command: "underlay-toggle" },
          { id: "underlay-off", label: "Remove", command: "underlay-off" },
          { id: "dwg", label: "DWG", todo: "DWG is vector; the raster underlay lands first and a DWG parser follows." },
          { id: "cad", label: "CAD", todo: "DXF shares the DWG parser and lands with it." },
        ],
      },
      {
        label: "Levels",
        items: [
          { id: "level-isolate", label: "This storey only", command: "level-isolate" },
          { id: "levels", label: "Insert level", todo: "Levels come from the template; adding new ones is week 3 with sections." },
        ],
      },
      {
        label: "Walls",
        items: [
          { id: "walls", label: "Walls", tool: "wall", categories: ["wall"] },
          { id: "boundary", label: "Boundary", tool: "wall", categories: ["boundarywall"] },
          { id: "foundations", label: "Foundations", tool: "wall", categories: ["foundation"] },
        ],
      },
      {
        label: "Floors & roofs",
        items: [
          { id: "floors", label: "Floors", tool: "slab", categories: ["floor", "pool"] },
          { id: "roofs", label: "Roofs", tool: "roof", categories: ["roof", "carport"] },
        ],
      },
      {
        // Deliberately its own group, not folded into "Floors & roofs": a
        // ceiling reads at floor-to-ceiling height above the active level's
        // datum, not flush with it, and drawing it right next to Floors
        // invited exactly that confusion. See compile.js's ceilingHeightFor.
        label: "Ceilings",
        items: [
          { id: "ceilings", label: "Ceiling", tool: "slab", categories: ["ceiling"], hint: "Draws at floor-to-ceiling height above this level, not at floor level." },
        ],
      },
      {
        label: "Openings",
        items: [
          { id: "doors", label: "Doors", tool: "door", categories: ["door"] },
          { id: "windows", label: "Windows", tool: "window", categories: ["window"] },
        ],
      },
      {
        label: "Structure",
        items: [
          { id: "beams", label: "Beams", tool: "beam", categories: ["beam"] },
          { id: "columns", label: "Columns", tool: "beam", categories: ["column"] },
          { id: "stairs", label: "Staircase", tool: "place", categories: ["stair"] },
          { id: "ramp", label: "Ramp", todo: "No ramp type exists in the template; the firm must supply one." },
          { id: "railings", label: "Railings", todo: "Railings are a stair sub-object, not a SKU category yet." },
        ],
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
      {
        label: "Components",
        items: [
          { id: "furniture", label: "Furniture", tool: "place", categories: ["furniture"] },
          { id: "casework", label: "Casework", tool: "place", categories: ["casework"] },
        ],
      },
    ],
  },
  {
    id: "document",
    label: "Document",
    groups: [
      {
        label: "Rooms",
        items: [
          { id: "rooms", label: "Room", tool: "room", categories: ["floor"] },
          { id: "room-sep", label: "Separate", todo: "Room separation lines follow the polygon editor." },
        ],
      },
      {
        label: "Lines",
        items: [
          { id: "model-lines", label: "Model", todo: "Week 3, with the sheet system." },
          { id: "annot-lines", label: "Annotate", todo: "Week 3, with the sheet system." },
        ],
      },
      {
        label: "Annotate",
        items: [
          { id: "dimensions", label: "Dimensions", command: "dimensions" },
          { id: "revision", label: "Revision cloud", todo: "Week 3, with the title block revision history." },
          { id: "region", label: "Region", todo: "Week 3, with the filled-region colour conventions." },
        ],
      },
      {
        label: "Views",
        items: [
          { id: "section", label: "Section", todo: "Week 3: one section extruded from the plan." },
          { id: "elevation", label: "Elevation", todo: "Week 3: one elevation extruded from the plan." },
          { id: "grids", label: "Grids", todo: "Week 3, with the TSP grid head." },
        ],
      },
      {
        label: "Project",
        items: [
          { id: "project-info", label: "Project information", todo: "Week 3: feeds the title block." },
          { id: "finishes", label: "Floor finishes", todo: "Needs a finishes SKU category; none in the template." },
        ],
      },
      {
        label: "Site",
        items: [
          { id: "property-line", label: "Property line", command: "property-line" },
          { id: "sg-coords", label: "SG diagram coordinates", command: "sg-coords" },
          { id: "building-line", label: "Building line", command: "building-line" },
          { id: "contours", label: "Contours", todo: "Tier 3: needs a terrain model." },
        ],
      },
    ],
  },
  {
    id: "modify",
    label: "Site & modify",
    groups: [
      {
        label: "Site",
        items: [
          { id: "contour", label: "Contour", todo: "Tier 3: needs a terrain model." },
          { id: "platform", label: "Platform cut-out", todo: "A cut and fill platform needs the terrain model that contours provide." },
        ],
      },
      {
        label: "Modify",
        items: [
          { id: "rotate", label: "Rotate", command: "rotate" },
          { id: "mirror", label: "Mirror", command: "mirror" },
          { id: "copy", label: "Copy", command: "copy" },
          { id: "align", label: "Align", command: "align" },
          { id: "merge", label: "Merge", command: "merge" },
          { id: "split", label: "Split", command: "split" },
          { id: "cut", label: "Cut", command: "cut" },
          { id: "join", label: "Join", command: "join" },
          { id: "attach", label: "Attach base", command: "attach" },
          { id: "detach", label: "Detach base", command: "detach" },
        ],
      },
      {
        label: "Arrange",
        items: [
          { id: "group", label: "Group", command: "group" },
          { id: "ungroup", label: "Ungroup", command: "ungroup" },
          { id: "undo", label: "Undo", command: "undo" },
          { id: "delete", label: "Delete", command: "delete" },
        ],
      },
    ],
  },
  {
    id: "output",
    label: "Output",
    groups: [
      {
        label: "Views",
        items: [
          { id: "view-3d", label: "3D", command: "view-3d" },
          { id: "callout", label: "Call out", todo: "Week 3, with the TSP callout head." },
          { id: "view-section", label: "Section", todo: "Week 3: placing a section view on a sheet, once sheets exist." },
        ],
      },
      {
        label: "Schedules",
        items: [
          { id: "boq", label: "BOQ", command: "compile" },
          { id: "bom", label: "BOM", command: "compile" },
        ],
      },
      {
        label: "Print",
        items: [
          { id: "sheets", label: "Sheets (A0–A4)", command: "sheets" },
          { id: "print-boq", label: "Print BOQ", todo: "Week 3, with the vector PDF export." },
          { id: "print-bom", label: "Print BOM", todo: "Week 3, with the vector PDF export." },
        ],
      },
    ],
  },
  {
    id: "check",
    label: "Check",
    groups: [
      {
        label: "Compliance",
        items: [
          { id: "part-c", label: "Part C dimensions", command: "check" },
          { id: "part-o", label: "Part O light & vent", command: "check" },
          { id: "part-m", label: "Part M stairs", command: "check" },
          { id: "zoning", label: "Zoning & setbacks", command: "check" },
        ],
      },
      {
        label: "Data",
        items: [
          { id: "gaps", label: "Data quality", command: "gaps" },
        ],
      },
    ],
  },
];

/** Every function keyed by id, for restoring the active one after a re-render. */
export function ribbonItems() {
  const out = new Map();
  for (const tab of RIBBON) {
    for (const group of tab.groups) {
      for (const item of group.items) out.set(item.id, { ...item, tabId: tab.id, group: group.label });
    }
  }
  return out;
}

const ITEM_INDEX = ribbonItems();

/**
 * Next-step hints shown over the canvas once a tool is armed (a
 * category/tool function became the active function). This is real UX -
 * "what do I do now" - not a decoration, so it lives with the item ids
 * rather than duplicated per density.
 */
export const HINTS = {
  underlay: "Load a PDF or image to trace.",
  calibrate: "Click two points on the sheet, then type the real distance.",
  "underlay-adjust": "Drag the sheet to move, a corner to resize, the top handle to rotate.",
  "underlay-toggle": "Hide the sheet without removing it.",
  "underlay-off": "Remove the sheet from the plan.",
  "level-isolate": "Show this storey only. Off ghosts the floor below, so upper walls can align to the footprint they sit on.",
  walls: "Click to start a wall, click again to end. Esc to stop.",
  boundary: "Click to start a boundary wall, click again to end. Esc to stop.",
  foundations: "Click to start a foundation, click again to end. Esc to stop.",
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
  furniture: "Click to place a piece of furniture.",
  casework: "Click to place casework.",
  rooms: "Click inside enclosed walls to tag a room.",
  dimensions: "Click two points to measure.",
  rotate: "Select something first, then rotate.",
  attach: "Click a wall or beam on this storey or the one below to sit the selection on top of it. Esc to cancel.",
  detach: "Stop following what the selection sits on, leaving it at the elevation it already has.",
  "view-3d": "Open a massing view of the current plan.",
  compile: "Build the bill of quantities from what you have drawn.",
  gaps: "List facts the template still needs before compliance can run.",
  sheets: "Manage print sheets (A0–A4) and their title blocks.",
};

/**
 * Simple density: a task-ordered *view* over the RIBBON items above, not a
 * second copy of them. Only ids, tab/group placement and the "collapse once
 * a sheet is loaded" behaviour live here; label, command, tool, categories
 * and todo all still come from RIBBON, so there is exactly one place that
 * defines what a function actually does.
 */
const SIMPLE_TABS = [
  {
    id: "draw",
    label: "Draw",
    groups: [
      { label: "Sheet", collapseAfterLoad: true, items: ["underlay", "calibrate", "underlay-adjust", "underlay-toggle"] },
      { label: "Levels", items: ["level-isolate"] },
      { label: "Walls", items: ["walls"] },
      { label: "Floors & roofs", items: ["floors", "roofs"] },
      { label: "Ceilings", items: ["ceilings"] },
      { label: "Openings", items: ["doors", "windows"] },
      { label: "Circulation", items: ["stairs"] },
      { label: "Services", items: ["electrical", "plumbing", "waterheater", "drainage"] },
    ],
  },
  {
    id: "annotate",
    label: "Annotate",
    groups: [
      { label: "Rooms", items: ["rooms"] },
      { label: "Measure", items: ["dimensions"] },
    ],
  },
  {
    id: "modify",
    label: "Modify",
    needsSelection: true,
    groups: [
      { label: "Edit", items: ["rotate", "mirror", "copy", "align", "split", "join"] },
      { label: "Elevation", items: ["attach", "detach"] },
      { label: "Arrange", items: ["group", "ungroup", "delete"] },
    ],
  },
  {
    id: "issue",
    label: "Issue",
    groups: [
      { label: "Views", items: ["view-3d"] },
      { label: "Quantities", items: ["boq"] },
      { label: "Print", items: ["sheets"] },
      { label: "Check", items: ["gaps"] },
    ],
  },
];

/** First tab id for a density, so switching modes lands somewhere real. */
export function firstTabId(mode) {
  return (mode === "simple" ? SIMPLE_TABS : RIBBON)[0]?.id;
}

function visibleInSimple(item, group, state, sheetLoaded) {
  if (!item) return false;
  if (item.todo) return false;
  if (item.categories && state.skuCount(item.categories) === 0) return false;
  if (group.collapseAfterLoad) return sheetLoaded ? item.id !== "underlay" : item.id === "underlay";
  return true;
}

/**
 * Resolve the Simple layout against the live RIBBON items, dropping
 * unfinished (todo) and empty-catalog items entirely rather than greying
 * them out - a missing Ramp should not look like a broken Walls button.
 */
function simpleTabsForState(state) {
  const sheetLoaded = Boolean(state.sheetLoaded?.());
  return SIMPLE_TABS.map((tab) => ({
    ...tab,
    groups: tab.groups
      .map((group) => ({
        ...group,
        items: group.items.map((id) => ITEM_INDEX.get(id)).filter((item) => visibleInSimple(item, group, state, sheetLoaded)),
      }))
      .filter((group) => group.items.length),
  })).filter((tab) => tab.groups.length);
}

/**
 * Render the tab strip and the active tab's functions.
 * `state.mode` is "simple" (default) or "full". Simple filters RIBBON down to
 * a task-ordered subset via `state.skuCount`/`state.sheetLoaded`, hides todo
 * and empty-catalog items outright, and gates the Modify tab on
 * `state.hasSelection()`. Full renders every RIBBON tab/item as-is, including
 * the grey roadmap items.
 * `state.skuCount(categories)` decides whether a catalog-backed function has
 * anything behind it: a function pointing at an empty category is disabled and
 * says so, rather than opening a blank palette.
 */
export function renderRibbon(tabsEl, functionsEl, state) {
  const mode = state.mode === "full" ? "full" : "simple";
  const tabs = mode === "simple" ? simpleTabsForState(state) : RIBBON;

  tabsEl.innerHTML = "";
  for (const tab of tabs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tab";
    btn.textContent = tab.label;
    btn.classList.toggle("active", tab.id === state.activeTab);
    btn.addEventListener("click", () => state.onTab(tab.id));
    tabsEl.appendChild(btn);
  }

  const tab = tabs.find((t) => t.id === state.activeTab) || tabs[0];
  functionsEl.innerHTML = "";
  if (!tab) return;

  const selectionLocked = mode === "simple" && tab.needsSelection && !state.hasSelection?.();
  if (selectionLocked) {
    const note = document.createElement("p");
    note.className = "ribbon-select-hint";
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

      const extra = state.commandState?.(item) || {};
      btn.textContent = extra.label || item.label;

      const empty = item.categories && state.skuCount(item.categories) === 0;
      if (item.todo) {
        btn.disabled = true;
        btn.title = `Not built yet. ${item.todo}`;
      } else if (empty) {
        btn.disabled = true;
        btn.title = `The template has no ${item.categories.join(" or ")} types.`;
      } else if (extra.disabled) {
        btn.disabled = true;
        btn.title = extra.title || "Load a PDF or image first.";
      } else {
        btn.classList.toggle("active", extra.active || item.id === state.activeFunction);
        if (extra.title) btn.title = extra.title;
        else if (HINTS[item.id]) btn.title = HINTS[item.id];
        else if (item.categories) {
          btn.title = item.hint ? `${item.hint} (${state.skuCount(item.categories)} types)` : `${state.skuCount(item.categories)} types`;
        }
        btn.addEventListener("click", () => state.onFunction(item));
      }
      items.appendChild(btn);
    }

    const label = document.createElement("span");
    label.className = "ribbon-group-label";
    label.textContent = group.label;

    wrap.append(items, label);
    functionsEl.appendChild(wrap);
  }
}
