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
        // With nothing loaded this group is the two ways in, and nothing
        // else. Once a sheet is loaded, Edit sheet sits past a divider. It
        // selects the sheet, which opens Modify | Sheet (SHEET_TAB below).
        // Hide and Model / Sheet are on the plan strip. DWG and CAD live on Output.
        items: [
          // `anchor` items are the group's lead buttons: they render large,
          // stacked or side by side depending on room (see ribbon-fit.js).
          { id: "underlay", label: "PDF / image", command: "underlay", anchor: true },
          { id: "satellite", label: "Satellite", command: "satellite", anchor: true },
          { id: "underlay-adjust", label: "Edit sheet", command: "underlay-adjust", anchor: true, needsUnderlay: true, splitBefore: true },
          { id: "trace-view", label: "Model", command: "trace-view", contextOnly: true },
          { id: "calibrate", label: "Set scale", command: "calibrate", contextOnly: true },
          { id: "reference", label: "Elevations & sections", command: "reference", contextOnly: true },
          { id: "align-floors", label: "Align sheets", command: "align-floors", contextOnly: true },
          { id: "sheet-list", label: "Sheet list", command: "sheet-list", contextOnly: true },
          { id: "underlay-toggle", label: "Hide", command: "underlay-toggle", contextOnly: true },
          { id: "underlay-off", label: "Remove…", command: "underlay-off", contextOnly: true },
        ],
      },
      {
        label: "Levels",
        items: [
          { id: "level-isolate", label: "This level only", command: "level-isolate" },
          // Two different jobs: "+ Add floor" reveals a storey the template
          // already defines, "Insert level" adds one it does not. The template
          // is the default stack, not the limit (PHILOSOPHY.md).
          { id: "add-floor", label: "+ Add floor", command: "add-floor" },
          { id: "levels", label: "Insert level", command: "insert-level" },
        ],
      },
      {
        label: "Walls",
        items: [
          { id: "walls", label: "Walls", tool: "wall", categories: ["wall"] },
          { id: "boundary", label: "Boundary", tool: "wall", categories: ["boundarywall", "fence"] },
          { id: "foundations", label: "Foundations", tool: "wall", categories: ["foundation"] },
        ],
      },
      {
        // The room names a space the walls already enclose. It sits with the
        // walls, not with the drawing marks.
        label: "Rooms",
        items: [
          { id: "rooms", label: "Room", tool: "room", categories: ["floor"] },
          { id: "room-sep", label: "Separate", command: "room-sep" },
        ],
      },
      {
        // A drawing action, next to the walls it finishes. Document → Project
        // keeps the paperwork (project information) only.
        label: "Finishes",
        items: [
          { id: "wall-finishes", label: "Wall finishes", command: "wall-finishes" },
          { id: "finishes", label: "Floor finishes", command: "finishes" },
        ],
      },
      {
        label: "Floors & roofs",
        items: [
          { id: "floors", label: "Floors", tool: "slab", categories: ["floor", "pool"] },
          { id: "roofs", label: "Roofs", tool: "roof", categories: ["roof", "carport"] },
          { id: "roof-cut", label: "Cut roof", tool: "roof-cut" },
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
        // Opt in to the tall icon-over-caption buttons. Every other one- or
        // two-command group stacks as small rows (see renderRibbon).
        label: "Openings",
        large: true,
        items: [
          { id: "doors", label: "Doors", tool: "door", categories: ["door", "opening"] },
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
          // 2.5D routing.
          // The four buttons above already place a component with the palette
          // filtered to one trade. Draw route is the other create action.
          // The rest edit a route that exists, so they live on the contextual
          // Modify | Services tab (`contextOnly`), not on this row.
          { id: "service-route", label: "Draw route", command: "service-route" },
          { id: "service-node", label: "Add node", command: "service-node", contextOnly: true },
          { id: "service-rise", label: "Rise / drop", command: "service-rise", contextOnly: true },
          { id: "service-connect", label: "Connect", command: "service-connect", contextOnly: true },
          { id: "service-type", label: "Change size / type", command: "service-type", contextOnly: true },
          { id: "service-slope", label: "Drainage slope", command: "service-slope", contextOnly: true },
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
        label: "Lines",
        items: [
          { id: "model-lines", label: "Model", command: "model-lines" },
          { id: "annot-lines", label: "Annotate", command: "annot-lines" },
        ],
      },
      {
        label: "Annotate",
        items: [
          { id: "dimensions", label: "Dimensions", command: "dimensions" },
          { id: "revision", label: "Revision cloud", command: "revision" },
          { id: "region", label: "Region", command: "region" },
        ],
      },
      {
        label: "Views",
        items: [
          { id: "section", label: "Section", command: "section" },
          { id: "elevation", label: "Elevation", command: "elevation" },
          { id: "grids", label: "Grids", todo: "Week 3, with the TSP grid head." },
        ],
      },
      {
        label: "Project",
        items: [
          { id: "project-info", label: "Project information", command: "project-info" },
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
          // `needsSelection` items grey out until something is selected.
          // Align, Join, Split and the trims ask you to pick as you go, so
          // they stay live.
          { id: "move", label: "Move", command: "move", needsSelection: true },
          { id: "select-similar", label: "Select same type", command: "select-similar", needsSelection: true },
          { id: "rotate", label: "Rotate", command: "rotate", needsSelection: true },
          { id: "mirror", label: "Mirror", command: "mirror", needsSelection: true },
          { id: "copy", label: "Copy", command: "copy", needsSelection: true },
          { id: "align", label: "Align", command: "align" },
          { id: "merge", label: "Merge", command: "merge" },
          { id: "split", label: "Split", command: "split" },
          { id: "cut", label: "Cut", command: "cut" },
          { id: "join", label: "Join", command: "join" },
          { id: "trim-corner", label: "Trim to corner", tool: "trim-corner" },
          { id: "trim-single", label: "Trim single", tool: "trim-single" },
          { id: "trim-circle", label: "Trim circle", tool: "trim-circle" },
          { id: "attach", label: "Attach base", command: "attach", needsSelection: true },
          { id: "detach", label: "Detach base", command: "detach", needsSelection: true },
          // Defined here once, shown only on the contextual tabs
          // (`contextOnly`): they act on one kind of selection.
          // "Split here" drags along the selected wall. "Split" above picks as you go.
          { id: "split-wall", label: "Split here", command: "split-wall", contextOnly: true },
          { id: "snap", label: "Snap end", command: "snap", needsSelection: true, contextOnly: true },
          // Opens the elevation strip under the plan. The name says that.
          { id: "edit-face", label: "Show face", command: "edit-face", contextOnly: true },
          { id: "flip-face", label: "Flip face", command: "flip-face", contextOnly: true },
          { id: "second-screen", label: "Second screen", command: "second-screen", contextOnly: true },
          { id: "flip-hinge", label: "Flip hinge", command: "flip-hinge", contextOnly: true },
          { id: "flip-swing", label: "Flip swing", command: "flip-swing", contextOnly: true },
          { id: "roof-cut-here", label: "Cut into this roof", command: "roof-cut-here", contextOnly: true },
          { id: "edit-poly", label: "Edit as polygon", command: "edit-poly", contextOnly: true },
          { id: "follow-walls", label: "Follow external walls", command: "follow-walls", contextOnly: true },
          // Shown on a contextual tab only while more than one thing is selected.
          { id: "mark-existing", label: "Existing", command: "mark-existing", contextOnly: true },
          { id: "mark-proposed", label: "Proposed", command: "mark-proposed", contextOnly: true },
        ],
      },
      {
        label: "Arrange",
        items: [
          { id: "group", label: "Group", command: "group", needsSelection: true },
          { id: "ungroup", label: "Ungroup", command: "ungroup", needsSelection: true },
          { id: "undo", label: "Undo", command: "undo" },
          { id: "redo", label: "Redo", command: "redo" },
          { id: "delete", label: "Delete", command: "delete", needsSelection: true },
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
          { id: "view-camera", label: "Camera", command: "view-camera" },
          { id: "callout", label: "Call out", command: "callout" },
          { id: "view-section", label: "Section", command: "view-section" },
        ],
      },
      {
        label: "Schedules",
        items: [
          { id: "boq", label: "BOQ", command: "boq" },
          { id: "bom", label: "BOM", command: "bom" },
        ],
      },
      {
        label: "Exchange",
        items: [
          { id: "export-dxf", label: "Export CAD", command: "export-dxf" },
          { id: "export-ifc", label: "Export IFC", command: "export-ifc" },
          // Import formats, still unbuilt. They used to sit on Add drawing;
          // a file format belongs with the other exchange commands.
          { id: "dwg", label: "DWG", todo: "DWG is vector; the raster underlay lands first and a DWG parser follows." },
          { id: "cad", label: "CAD", todo: "DXF shares the DWG parser and lands with it." },
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
 * rather than duplicated per tab.
 */
export const HINTS = {
  underlay: "Load a PDF or image to trace.",
  satellite: "Load a satellite view of an address or coordinates, already at true scale.",
  "sheet-list": "Show or hide the list of pages in the inspector.",
  "align-floors": "Click the same point on each sheet, such as a building corner. That lines up different floors, or two drawings of one floor — walls on one sheet, something else on the other. The other sheets move onto the one that stays put. Walls already drawn on a moved floor move with that sheet. A second drawing of the same floor moves on its own, and the walls stay with the sheet that does not move.",
  reference: "Open the elevations and sections from the imported PDF, and type each floor-to-ceiling height.",
  calibrate: "Click two points on the sheet, then type the real distance or drag a corner to resize.",
  "underlay-adjust": "Edit this sheet. Its scale, alignment and removal are on Modify | Sheet.",
  "underlay-toggle": "Hide the sheet without removing it.",
  "trace-view": "Switch between the sheet and the modelled walls. The sheet view keeps PDF openings visible.",
  "underlay-off": "Remove the sheet, or the whole imported plan set, from the plan. Asks first, and can be undone for a few seconds.",
  "level-isolate": "Show only this cut. A ceiling plan keeps the ceiling and walls; a roof plan keeps the roof. Off ghosts the neighbouring level. The tracing sheet stays; Hide sheet takes it off.",
  walls: "Click to start a wall, click again to end. Draw on the centreline or a face. Space flips the face. Esc to stop.",
  boundary: "Click to start a boundary wall or a fence, click again to end. Draw on the centreline or a face. Space flips the face. Esc to stop.",
  foundations: "Click to start a foundation, click again to end. Draw on the centreline or a face. Space flips the face. Esc to stop.",
  floors: "Click around a room to draw a floor slab.",
  roofs: "Click around the outline to draw a roof.",
  "roof-cut": "Click inside a roof, then around the part to cut. Enter closes it. Hole leaves the roof with an opening. Remove takes that part off. Esc steps back.",
  ceilings: "Draws at floor-to-ceiling height above this level, not at floor level.",
  doors: "Click a wall to place a door.",
  windows: "Click a wall to place a window.",
  stairs: "Click to place a stair.",
  electrical: "Click to place an electrical fitting.",
  plumbing: "Click to place sanitary ware.",
  waterheater: "Click to place a water heater.",
  drainage: "Click to place a drainage fitting.",
  "service-route": "Click to start a route, click to add points. Enter or Esc finishes. Click an existing point to join it.",
  "service-node": "Click on a route run to add a node there. Drag a node to move it; select it and press Delete to remove it (the run joins up). Use Rise / drop on a node to change its height.",
  "service-rise": "Select a route point, then rise or drop it to a new height or level.",
  "service-connect": "Select a route point, then click a placed component to connect it. The point moves onto the component.",
  "service-type": "Select one or more routes, then pick a size or type in the inspector.",
  "service-slope": "Select drainage runs, then set the fall. Flow runs from the first point to the second.",
  furniture: "Click to place. Beds, tables and sofas are layout outlines, not joinery.",
  casework: "Click a wall to start the run, then the other end. A cupboard cannot sit off the wall. Wall units are dashed (off the floor). An island is a click to place.",
  rooms: "Click inside the walls. The area is already shown; this names the room. Set its use in the inspector. Where there are no walls, click each corner and press Enter.",
  "room-sep": "Click one end, then the other. Ends snap to wall corners and faces. Type a length, as with a wall. A separation line bounds a room where there is no wall.",
  region: "Click each corner of the patch, then Enter. Pick Brick red, Concrete or Concrete 2 in the inspector. The patch stays ink on the drawing.",
  finishes: "Picture of this floor. Add a finish, then cover the whole floor or draw an area. Floor types stay on Floors.",
  dimensions: "Click two points. The dimension stays on this level and prints on its sheet. Select it and press Delete to remove it.",
  move: "Click the point to move from, then where it should land. Joined walls stay joined. Disjoin, or hold Alt, to pull them apart. Esc cancels.",
  copy: "Click the point to copy from, then where the copy should land. Esc cancels.",
  "trim-corner": "Click each wall on the part you want to keep. Esc cancels.",
  "trim-single": "Click the wall that stays, then the wall to trim, on the part you want to keep. Esc cancels.",
  "trim-circle": "Move the circle over a corner. A line that crosses inside it loses its shorter part. A line that stops short stretches to a meeting inside the circle. Click applies it. [ and ] resize the circle. Esc stops.",
  rotate: "Select something first, then rotate.",
  attach: "Click a wall or beam on this storey or the one below to sit the selection on top of it. Esc to cancel.",
  detach: "Stop following what the selection sits on, leaving it at the elevation it already has.",
  "view-3d": "Open a massing view of the current plan.",
  "view-camera": "Click where you stand, then click what you look at.",
  section: "Click two points to cut. Look is to the left of the line; draw the other way to flip.",
  elevation: "Pick a compass side to extrude an orthographic elevation from the plan.",
  callout: "Click two opposite corners to box a detail crop of the plan.",
  revision: "Click two opposite corners. The cloud stays on the plan, where you can select it. Link it to a revision from the Sheets panel.",
  "model-lines": "Click one end, then the other. A model line is a modelled fact, like a wall with no thickness.",
  "annot-lines": "Click one end, then the other. An annotation line is a mark on this drawing only, never exported.",
  compile: "Build the bill of quantities from what you have drawn.",
  boq: "Bill of quantities: priced schedule of what you have drawn, one line per SKU.",
  bom: "Bill of materials: unpriced takeoff of what you have drawn, one line per SKU.",
  gaps: "List facts the template still needs before compliance can run.",
  sheets: "Manage print sheets (A0–A4) and their title blocks.",
  "export-dxf": "Download a DXF. In Revit: open the template, then Insert → Link CAD (not File → Open).",
  "export-ifc": "Download an IFC. File → Open will ignore it unless you pick Open → IFC, then Save As a project.",
};

/**
 * How many steps ahead of the others a group gives up size when the window is
 * too narrow (see ribbon-fit.js). Positive = shrinks early (set up once per
 * job); negative = protected (drawn all day). Unlisted groups are 0.
 */
export const GROUP_PRIORITY = {
  "Add drawing": 2,
  Sheet: 2,
  Levels: 1,
  Walls: -1,
  // The contextual tabs' Edit group is the one drawn all day: last to shrink.
  Edit: -1,
  // 3 ties Add drawing's first mixed step (shrink key step - 3). These groups
  // sit to its right, and a tie shrinks the rightmost, so they give up a step
  // before PDF / image and Satellite leave side by side. They are already
  // compact stacks, except Openings, which stays large until the row overflows.
  Finishes: 3,
  "Floors & roofs": 3,
  Ceilings: 3,
  Openings: 3,
  Structure: 1,
  Components: 1,
};

/** First tab id: the permanent tab a first load opens on. */
export function firstTabId() {
  return RIBBON[0].id;
}

/** The id of the contextual tab while it is on the row. */
export const CONTEXT_TAB_ID = "context";

const EDIT_COMMON = ["move", "copy", "rotate", "mirror", "align", "delete"];

/**
 * Contextual tabs, by selection kind: a view over the RIBBON items above, not
 * a second copy of them. Only ids and placement live here; label, command,
 * glyph and hint all follow the id back to RIBBON, so a command is still
 * defined once.
 *
 * A room and a site boundary get no tab: Delete is on Modify and the rest is
 * in the inspector.
 */
export const CONTEXT_TABS = {
  wall: {
    label: "Walls",
    groups: [
      { label: "Edit", items: EDIT_COMMON },
      // Wall finishes is not a height. The trims also extend a wall that
      // stops short, so they sit together under that name.
      { label: "Wall", items: ["split-wall", "snap", "join", "select-similar"] },
      { label: "Trim and extend", items: ["trim-corner", "trim-single", "trim-circle"] },
      { label: "View", items: ["edit-face", "flip-face", "second-screen"] },
      { label: "Finishes", items: ["wall-finishes"] },
      { label: "Height", items: ["attach", "detach"] },
      { label: "Arrange", items: ["group", "ungroup"] },
    ],
  },
  door: {
    label: "Doors",
    // A door stays in its wall, so Rotate flips the hinge and Mirror flips
    // the swing. Those two are the Door buttons; listing them again here
    // would show the same action twice.
    groups: [
      { label: "Edit", items: ["move", "copy", "align", "delete", "select-similar"] },
      { label: "Door", items: ["flip-hinge", "flip-swing"] },
    ],
  },
  window: {
    label: "Windows",
    groups: [{ label: "Edit", items: [...EDIT_COMMON, "select-similar"] }],
  },
  floor: {
    label: "Floors",
    groups: [
      { label: "Edit", items: EDIT_COMMON },
      { label: "Floor", items: ["edit-poly", "follow-walls", "finishes"] },
    ],
  },
  roof: {
    label: "Roofs",
    groups: [
      { label: "Edit", items: EDIT_COMMON },
      { label: "Roof", items: ["roof-cut-here", "edit-poly"] },
    ],
  },
  service: {
    label: "Services",
    groups: [
      { label: "Edit", items: ["move", "delete"] },
      { label: "Route", items: ["service-node", "service-rise", "service-connect", "service-type", "service-slope"] },
    ],
  },
};

/**
 * Modify | Sheet: open while the sheet is selected (Adjust) or Set scale /
 * Align sheets is running. Kept apart from CONTEXT_TABS because the sheet is
 * not in `store.selected`; ui.js opens it from the underlay mode instead.
 * Hide / Show and Model / Sheet are view toggles, so they are on the plan strip.
 */
export const SHEET_TAB = {
  label: "Sheet",
  groups: [
    { label: "This sheet", items: ["calibrate", "underlay-off"] },
    { label: "Plan set", items: ["sheet-list", "align-floors", "reference"] },
  ],
};

/** The Modify | Sheet tab, resolved against RIBBON like every other. */
export function sheetTab() {
  return { id: CONTEXT_TAB_ID, key: "sheet", label: SHEET_TAB.label, groups: resolveGroups(SHEET_TAB.groups) };
}

/** What a selection kind with no tab of its own can still take from the Edit group. */
const EDIT_OF_KIND = { room: ["delete"] };

function editIdsOf(kind) {
  const group = CONTEXT_TABS[kind]?.groups.find((g) => g.label === "Edit");
  return group ? group.items : (EDIT_OF_KIND[kind] || EDIT_COMMON);
}

/** Resolve a tab's item ids against RIBBON, dropping any that do not exist. */
function resolveGroups(groups) {
  return groups
    .map((group) => ({ ...group, items: group.items.map((id) => ITEM_INDEX.get(id)).filter(Boolean) }))
    .filter((group) => group.items.length);
}

/**
 * The contextual tab for a selection, or null when its kinds have none.
 * `kinds` is a set of CONTEXT_TABS keys, plus "room" and "other". A room and
 * a site boundary get no tab. Anything else with no tab of its own (a beam,
 * a column, furniture, a stair) gets Modify | Selection, holding the shared
 * Edit actions. A mixed selection gets Multi-Select: the intersection of the
 * kinds' Edit groups, in the first kind's order.
 */
export function selectionTab(kinds) {
  const list = [...kinds];
  if (!list.length) return null;
  if (list.length === 1) {
    if (list[0] === "room") return null;
    const def = CONTEXT_TABS[list[0]];
    if (def) return { id: CONTEXT_TAB_ID, key: list[0], label: def.label, groups: resolveGroups(def.groups) };
    const groups = resolveGroups([{ label: "Edit", items: editIdsOf(list[0]) }]);
    return groups.length ? { id: CONTEXT_TAB_ID, key: "selection", label: "Selection", groups } : null;
  }
  const shared = editIdsOf(list[0]).filter((id) => list.every((kind) => editIdsOf(kind).includes(id)));
  const groups = resolveGroups([{ label: "Edit", items: shared }]);
  return groups.length ? { id: CONTEXT_TAB_ID, key: "multi", label: "Multi-Select", groups } : null;
}

/**
 * Existing and Proposed on the open tab: a selection of one or many, and
 * the tab shown while placing. The inspector only names the current status.
 */
export function tabWithStatus(tab) {
  if (!tab) return tab;
  if (tab.groups.some((group) => group.label === "Status")) return tab;
  const items = ["mark-existing", "mark-proposed"].map((id) => ITEM_INDEX.get(id)).filter(Boolean);
  if (!items.length) return tab;
  return { ...tab, groups: [...tab.groups, { label: "Status", items }] };
}

/**
 * A RIBBON item that arms a drawing tool on Build, i.e. places something.
 * Cut roof edits a roof that is already there, so it keeps Modify | Roofs
 * instead of opening Place Cut roof.
 */
const NOT_PLACING = new Set(["roof-cut"]);

export function isPlacingItem(item) {
  return Boolean(item?.tool && item.tabId === "build" && !NOT_PLACING.has(item.id));
}

/** "Walls" becomes "Wall", "Doors" "Door". Caption words that are not plural stay. */
function singular(label) {
  return /[^s]s$/i.test(label) ? label.slice(0, -1) : label;
}

/**
 * Captions that do not singularise into the thing you place. "Staircase"
 * is not "Staircas", and "Water heating" is the trade, not the heater.
 */
const PLACE_NAMES = {
  stairs: "Stair",
  waterheater: "Water heater",
};

function placeName(item) {
  return PLACE_NAMES[item.id] || singular(item.label);
}

/**
 * The tab shown while a draw tool is armed: Place Wall, Place Door, and so
 * on. Derived from the item that armed it, never written out by hand. It
 * shows the group that item came from, so the wrong type is one click away.
 */
export function placingTab(itemId) {
  const item = ITEM_INDEX.get(itemId);
  if (!isPlacingItem(item)) return null;
  const group = RIBBON.find((t) => t.id === item.tabId)?.groups.find((g) => g.label === item.group);
  const items = (group?.items || [item]).filter((it) => !it.contextOnly).map((it) => ITEM_INDEX.get(it.id));
  return {
    id: CONTEXT_TAB_ID,
    key: `place:${item.id}`,
    label: `Place ${placeName(item)}`,
    groups: [{ label: item.group, large: group?.large, items }],
  };
}

/** A permanent tab's groups: what only a contextual tab shows is left out. */
function permanentGroups(tab) {
  return tab.groups
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.contextOnly) }))
    .filter((group) => group.items.length);
}

/**
 * Render the tab strip and the active tab's functions.
 * Renders every RIBBON tab/item as-is, including the grey roadmap items.
 * `state.contextTab` is the green tab for the selection or the armed draw
 * tool (see `selectionTab` / `placingTab`), or null. It sits right after the
 * permanent Modify tab, and `state.activeTab === CONTEXT_TAB_ID` shows it.
 * `state.hasSelection()` greys out the `needsSelection` items.
 * `state.hasUnderlay()` shows the `needsUnderlay` items (the Edit sheet button).
 * `state.skuCount(categories)` decides whether a catalog-backed function has
 * anything behind it: a function pointing at an empty category is disabled and
 * says so, rather than opening a blank palette.
 */
export function renderRibbon(tabsEl, functionsEl, state) {
  const context = state.contextTab || null;
  const hasSelection = Boolean(state.hasSelection?.());

  tabsEl.innerHTML = "";
  tabsEl.setAttribute("role", "tablist");
  tabsEl.setAttribute("aria-label", "Ribbon tabs");
  const addTab = (id, label, className) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = className;
    btn.textContent = label;
    btn.dataset.tab = id;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", id === state.activeTab ? "true" : "false");
    btn.classList.toggle("active", id === state.activeTab);
    btn.addEventListener("click", () => state.onTab(id));
    tabsEl.appendChild(btn);
  };
  for (const tab of RIBBON) {
    addTab(tab.id, tab.label, "tab");
    if (tab.id === "modify" && context) addTab(CONTEXT_TAB_ID, `Modify | ${context.label}`, "tab tab-context");
  }

  const shown = state.activeTab === CONTEXT_TAB_ID && context
    ? context
    : RIBBON.find((t) => t.id === state.activeTab) || RIBBON[0];
  functionsEl.innerHTML = "";
  functionsEl.classList.toggle("is-contextual", shown === context);
  if (!shown) return;
  const groups = shown === context ? shown.groups : permanentGroups(shown);

  for (const group of groups) {
    const wrap = document.createElement("div");
    wrap.className = "ribbon-group";
    // How the group lays out (and how ribbon-fit.js shrinks it) follows from
    // what is in it: anchors -> "mixed", an opted-in one- or two-command group
    // -> "large", everything else (including one- and two-command groups) -> "stack".
    const hasAnchors = group.items.some((it) => it.anchor);
    const large = group.large && group.items.length <= 2;
    wrap.dataset.kind = hasAnchors ? "mixed" : large ? "large" : "stack";
    wrap.dataset.prio = String(GROUP_PRIORITY[group.label] ?? 0);

    const items = document.createElement("div");
    items.className = "ribbon-group-items";
    let anchorsEl = null;
    let restEl = null;
    if (hasAnchors) {
      anchorsEl = document.createElement("div");
      anchorsEl.className = "ribbon-anchors";
      restEl = document.createElement("div");
      restEl.className = "ribbon-rest";
      items.append(anchorsEl, restEl);
    }
    // Commands listed on the group stay out of the row and open from More.
    const menuIds = new Set(group.menu || []);
    const menuEl = document.createElement("div");
    menuEl.className = "ribbon-menu";
    let menuCount = 0;
    for (const item of group.items) {
      // Acts on a loaded sheet: with none, it is not on the row at all.
      if (item.needsUnderlay && !state.hasUnderlay?.()) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = item.anchor ? "ribbon-item anchor" : "ribbon-item";
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
      } else if (item.needsSelection && !hasSelection) {
        btn.disabled = true;
        btn.title = "Select something first.";
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
      if (menuIds.has(item.id)) {
        menuEl.appendChild(btn);
        menuCount += 1;
      } else {
        const home = hasAnchors ? (item.anchor ? anchorsEl : restEl) : items;
        if (item.splitBefore && home.childElementCount) {
          const split = document.createElement("span");
          split.className = "ribbon-anchor-split";
          split.setAttribute("aria-hidden", "true");
          home.appendChild(split);
        }
        home.appendChild(btn);
      }
    }
    if (menuCount) {
      // The menu is a child of the More button's cell, so it opens under
      // that button rather than at the left edge of the group.
      const moreWrap = document.createElement("div");
      moreWrap.className = "ribbon-more";
      const more = document.createElement("button");
      more.type = "button";
      more.className = "ribbon-more-btn";
      more.textContent = "More";
      more.setAttribute("aria-haspopup", "menu");
      more.setAttribute("aria-expanded", "false");
      moreWrap.append(more, menuEl);
      (restEl || items).appendChild(moreWrap);
    }
    // Only the anchors left (nothing loaded): no empty second column.
    if (restEl && !restEl.children.length) restEl.remove();

    const label = document.createElement("span");
    label.className = "ribbon-group-label";
    label.textContent = group.label;

    wrap.append(items, label);
    functionsEl.appendChild(wrap);
  }
}
