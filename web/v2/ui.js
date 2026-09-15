// Canvas UI for the v2 core. Standalone page (web/v2/index.html) so the
// existing app in web/app.js / web/planner.js is untouched while this proves
// the v2 store, wall derivation and compile pipeline end to end.
//
// Scope trims versus v1, called out here rather than left silent:
//  - Existing rect-shaped objects resize via the plan options strip (length,
//    angle, width, height), not drag handles. Identity and type live in the
//    Inspector. New rooms/slabs/roofs still drag-to-size with the HUD.
//  - No modal type picker; clicking a type SKU sets the active tool/SKU
//    directly, or retypes the current selection if the category matches.
//  - Marquee selection uses each shape's bounding box, not exact polygon
//    overlap. Exact for rectangles, which is everything this UI draws.
//  - Free-angle walls are drawable (a v1 impossibility) but not snapped to
//    common angles; hold Shift while dragging an end to keep the current
//    heading. Length is labelled on the visible part of the wall (so zooming
//    into an end does not hide it), and in the options strip with angle.

import { complianceGaps, normalizePackUnits } from "./schema.js";
import { RULE_PACK, evaluateCompliance, groupFindingsByPart, summarizeFindings } from "./rules.js";
import { deriveBuildingLine, setBuildingLine, setPropertyLine, setSgReference } from "./site.js?v=20260915-offset";
import { HINTS, firstTabId, renderRibbon } from "./ribbon.js?v=20260915-level-isolate";
import { closeOverflowMenus, decorateRibbon, fitRibbon } from "./ribbon-fit.js?v=20260915-level-isolate";
import { lookDownLevelId, lookUpLevelId } from "./level-view.js";
import {
  alignSelection,
  copySelection,
  cutSelection,
  joinSelection,
  mergeSelection,
  mirrorSelection,
  rotateSelection,
  splitSelection,
} from "./modify.js";
import {
  calibrate,
  clearUnderlay,
  drawUnderlay,
  loadUnderlayFile,
  moveUnderlayTo,
  rotateUnderlayBy,
  scaleUnderlayFromCorner,
  setUnderlayOpacity,
  setUnderlayRotation,
  toggleUnderlayHidden,
  underlayBitmap,
  underlayCorners,
} from "./underlay.js";
import { planDimensionLines } from "./dimensions.js";
import { area as polyArea, bbox, clipSegToRect, distToSeg, headingDeg, pointInPoly, roundGrid } from "./geom.js?v=20260915-offset";
import { SNAP_PIXEL_TOL, bestEndpointSnap, collectSnapTargets, snapPoint } from "./snap.js";
import {
  PlanStore,
  ROOM_USES,
  collectionFor,
  effectiveLevel,
  emptyDoc,
  nid,
  rectShape,
  roomArea,
  roomMinDimension,
  roomPerimeter,
  roomPolygon,
  shapePolygon,
} from "./model.js";
import { deriveWalls } from "./walls.js";
import {
  nearestPlaceWall,
  roomEdgeSegment,
  swingToward,
  wallForOpening,
  wallT,
} from "./openings.js";
import { compile } from "./compile.js";
import { createMassingView } from "./massing.js";
import {
  SHEET_SIZES,
  STANDARD_SCALES,
  addRevision,
  createSheet,
  ensureSheets,
  removeSheet,
  sheetById,
  sheetScale,
  titleBlockFields,
  titleBlockLayout,
} from "./sheets.js";

const GRID = 0.1;
const MIN_ROOM = 1;
const MIN_TRACE = 0.3;
const HANDLE = 8;

const el = {
  canvasWrap: document.getElementById("v2-canvas-wrap"),
  canvas: document.getElementById("v2-canvas"),
  empty: document.getElementById("v2-empty"),
  legend: document.getElementById("v2-legend"),
  skuList: document.getElementById("v2-sku-list"),
  search: document.getElementById("v2-search"),
  packName: document.getElementById("v2-pack-name"),
  gaps: document.getElementById("v2-gaps"),
  gapCount: document.getElementById("v2-gap-count"),
  rules: document.getElementById("v2-rules"),
  rulesCount: document.getElementById("v2-rules-count"),
  compilePanel: document.getElementById("v2-compile-panel"),
  compileKicker: document.getElementById("v2-compile-kicker"),
  compileOut: document.getElementById("v2-compile-out"),
  healthDot: document.getElementById("v2-health-dot"),
  healthLabel: document.getElementById("v2-health-label"),
  sizeHud: document.getElementById("v2-size-hud"),
  hudWLabel: document.getElementById("v2-hud-w-label"),
  hudWName: document.getElementById("v2-hud-w-name"),
  hudW: document.getElementById("v2-hud-w"),
  hudH: document.getElementById("v2-hud-h"),
  hudHint: document.getElementById("v2-hud-hint"),
  underlayPanel: document.getElementById("v2-underlay-panel"),
  underlayOpacity: document.getElementById("v2-underlay-opacity"),
  underlayRotation: document.getElementById("v2-underlay-rotation"),
  underlayRotateCcw: document.getElementById("v2-underlay-rotate-ccw"),
  underlayRotateCw: document.getElementById("v2-underlay-rotate-cw"),
  calibratePanel: document.getElementById("v2-calibrate-panel"),
  calibrateHint: document.getElementById("v2-calibrate-hint"),
  calibrateDistanceWrap: document.getElementById("v2-calibrate-distance-wrap"),
  calibrateDistance: document.getElementById("v2-calibrate-distance"),
  calibrateConfirm: document.getElementById("v2-calibrate-confirm"),
  calibrateCancel: document.getElementById("v2-calibrate-cancel"),
  sgPanel: document.getElementById("v2-sg-panel"),
  sgHint: document.getElementById("v2-sg-hint"),
  sgFieldsWrap: document.getElementById("v2-sg-fields-wrap"),
  sgErf: document.getElementById("v2-sg-erf"),
  sgX: document.getElementById("v2-sg-x"),
  sgY: document.getElementById("v2-sg-y"),
  sgConfirm: document.getElementById("v2-sg-confirm"),
  sgCancel: document.getElementById("v2-sg-cancel"),
  ribbonTabs: document.getElementById("v2-ribbon-tabs"),
  ribbonFunctions: document.getElementById("v2-ribbon-functions"),
  ribbonHint: document.getElementById("v2-ribbon-hint"),
  headerModify: document.getElementById("v2-header-modify"),
  hmRotate: document.getElementById("v2-hm-rotate"),
  hmCopy: document.getElementById("v2-hm-copy"),
  hmDelete: document.getElementById("v2-hm-delete"),
  paletteTitle: document.getElementById("v2-palette-title"),
  levelWidget: document.getElementById("v2-level-widget"),
  levelHouse: document.getElementById("v2-level-house"),
  levelStations: document.getElementById("v2-level-stations"),
  cutName: document.getElementById("v2-cut-name"),
  cutElev: document.getElementById("v2-cut-elev"),
  cutKind: document.getElementById("v2-cut-kind"),
  planOptions: document.getElementById("v2-plan-options"),
  inspectKicker: document.getElementById("v2-inspect-kicker"),
  inspectEmpty: document.getElementById("v2-inspect-empty"),
  inspectFields: document.getElementById("v2-inspect-fields"),
  checkOverlay: document.getElementById("v2-check-overlay"),
  checkClose: document.getElementById("v2-check-close"),
  ctxName: document.getElementById("v2-ctx-name"),
  ctxNameWrap: document.getElementById("v2-ctx-name-wrap"),
  ctxUse: document.getElementById("v2-ctx-use"),
  ctxUseWrap: document.getElementById("v2-ctx-use-wrap"),
  ctxLen: document.getElementById("v2-ctx-len"),
  ctxLenWrap: document.getElementById("v2-ctx-len-wrap"),
  ctxAng: document.getElementById("v2-ctx-ang"),
  ctxAngWrap: document.getElementById("v2-ctx-ang-wrap"),
  ctxW: document.getElementById("v2-ctx-w"),
  ctxWWrap: document.getElementById("v2-ctx-w-wrap"),
  ctxH: document.getElementById("v2-ctx-h"),
  ctxHWrap: document.getElementById("v2-ctx-h-wrap"),
  ctxForm: document.getElementById("v2-ctx-form"),
  ctxFormWrap: document.getElementById("v2-ctx-form-wrap"),
  ctxPitch: document.getElementById("v2-ctx-pitch"),
  ctxPitchWrap: document.getElementById("v2-ctx-pitch-wrap"),
  ctxType: document.getElementById("v2-ctx-type"),
  ctxTypeWrap: document.getElementById("v2-ctx-type-wrap"),
  ctxOLevel: document.getElementById("v2-ctx-olevel"),
  ctxOLevelWrap: document.getElementById("v2-ctx-olevel-wrap"),
  ctxFlip: document.getElementById("v2-ctx-flip"),
  massOverlay: document.getElementById("v2-mass-overlay"),
  massCanvas: document.getElementById("v2-mass-canvas"),
  massEmpty: document.getElementById("v2-mass-empty"),
  massCaption: document.getElementById("v2-mass-caption"),
  massClose: document.getElementById("v2-mass-close"),
  sheetOverlay: document.getElementById("v2-sheet-overlay"),
  sheetClose: document.getElementById("v2-sheet-close"),
  sheetAdd: document.getElementById("v2-sheet-add"),
  sheetList: document.getElementById("v2-sheet-list"),
  sheetFields: document.getElementById("v2-sheet-fields"),
  sheetEmptyFields: document.getElementById("v2-sheet-empty-fields"),
  sheetSize: document.getElementById("v2-sheet-size"),
  sheetTitle: document.getElementById("v2-sheet-title"),
  sheetScale: document.getElementById("v2-sheet-scale"),
  sheetDate: document.getElementById("v2-sheet-date"),
  sheetDrawn: document.getElementById("v2-sheet-drawn"),
  sheetChecked: document.getElementById("v2-sheet-checked"),
  sheetDelete: document.getElementById("v2-sheet-delete"),
  sheetCanvas: document.getElementById("v2-sheet-canvas"),
  sheetEmpty: document.getElementById("v2-sheet-empty"),
  sheetRevList: document.getElementById("v2-sheet-rev-list"),
  sheetRevDesc: document.getElementById("v2-sheet-rev-desc"),
  sheetRevAdd: document.getElementById("v2-sheet-rev-add"),
};

const ctx = el.canvas.getContext("2d");

let pack = null;
const store = new PlanStore(emptyDoc(), { storage: window.localStorage });

let tool = "select";
let placeSkuId = null;
let placeStatus = "planned";
let placeRotation = 0;
let cam = { scale: 48, ox: 80, oy: 60 };
let drag = null;
let beamStart = null;
// Site > Property line: the vertices clicked so far, while tool === "property".
// Closed by clicking near the first point again, Enter, or double-click.
let siteDraft = null;
// Site > SG diagram coordinates: the plan point clicked, while tool === "sg-ref",
// waiting on the erf number and real coordinate fields in the SG panel.
let sgPick = null;
let sizeDraft = null;
let hover = null;
let hoverPoint = null;
let wallsCache = [];

// While drawing/moving a wall or beam, the nearest join/alignment point found
// by applySnap() - drawn as a crosshair guide, cleared once the drag ends or
// nothing is close enough. See snap.js.
let snapGuide = null;

// The level the plan is currently showing/editing. A two-storey house drawn
// on one canvas with no level concept would draw its ground and first floor
// walls on top of each other - silently wrong rather than obviously missing a
// feature, so this is the first thing built once real (multi-level) template
// data existed to test it against.
let activeLevel = null;

// Off (default): ghost the storey immediately below, like Revit's look-down
// underlay. On: draw only the active cut. Hit-testing always stays on the
// active level either way.
let isolateCurrentLevel = window.localStorage.getItem("v2-level-isolate") === "1";

// Document -> Annotate -> Dimensions: a persistent on/off toggle, not a
// one-shot command, so it keeps its own state alongside `activeFunction`.
let showDimensions = false;

// The underlay is not a doc entity with a ref (it's a singleton on the doc,
// not an array member), so it gets its own selection flag rather than going
// through store.selected/PlanStore. True only while the Select tool has it
// picked, which is when its move/scale/rotate handles are live.
let underlaySelected = false;

// Ribbon state. `paletteFilter` is the set of SKU categories the last
// type-picking function exposed. Select leaves it in place so the list
// stays on Walls/Doors instead of dumping every SKU. Null is the idle
// state (nothing chosen yet): show a prompt, not the whole pack.
// `lastPaletteLabel` is the ribbon wording for that filter ("Walls"),
// restored when search is cleared.
// Density: "simple" (default) is a task-ordered, filtered view of the same
// RIBBON items in ribbon.js; "full" is every BRD tab/item, todos included.
// Persisted so a firm that prefers Full does not get reset to Simple on
// reload.
let density = window.localStorage.getItem("v2-density") === "full" ? "full" : "simple";
let activeTab = firstTabId(density);
let activeFunction = null;
let paletteFilter = null;
let lastPaletteLabel = null;

// Output > Views > 3D. Independent of the compliance engine and the sheet
// system - see massing.js - so it can open over the plan without either.
const massView = createMassingView({
  canvas: el.massCanvas,
  emptyEl: el.massEmpty,
  captionEl: el.massCaption,
});

// Output > Print > Sheets. The id of the sheet currently shown/edited in the
// Sheets panel; null once the last sheet is deleted or before any exists.
let activeSheetId = null;

// --- bootstrap --------------------------------------------------------

async function boot() {
  try {
    const res = await fetch("../samples/tsp-pack.json");
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    // The pack on disk states geometry in millimetres (sp.pack/3); everything
    // downstream of here (walls.js, compile.js, openings.js, ...) still works in
    // metres, so this is the one place that boundary gets crossed.
    pack = normalizePackUnits(await res.json());
  } catch (err) {
    el.healthDot.classList.remove("ok");
    el.healthLabel.textContent = `Pack failed to load: ${err.message}`;
    return;
  }
  el.healthDot.classList.add("ok");
  el.healthLabel.textContent = `${pack.skus.length} SKUs loaded`;
  el.packName.textContent = pack.name;

  if (!store.load()) {
    store.doc.packId = pack.id;
  }

  activeLevel = pack.system.defaultLevel;
  if (el.ctxUse) {
    el.ctxUse.innerHTML = ROOM_USES
      .map((u) => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.label)}</option>`)
      .join("");
  }
  document.querySelectorAll("[data-density]").forEach((b) => b.classList.toggle("active", b.dataset.density === density));
  drawLevelSwitcher();
  renderGapReport();
  drawRibbon();
  renderPalette();
  wireToolbar();
  wireCanvas();
  wireKeyboard();
  wireMassing();
  wireCheck();
  wireSheets();
  wireRibbonFit();
  resizeCanvas();
  new ResizeObserver(resizeCanvas).observe(el.canvasWrap);
  render();
}

/** Close an open group dropdown on any outside click, and re-run the
 * shrink-to-width fit whenever the window (not just the canvas) resizes. */
function wireRibbonFit() {
  document.addEventListener("click", () => closeOverflowMenus());
  window.addEventListener("resize", () => fitRibbon(el.ribbonFunctions));
}

boot();

// Debug hook for the smoke-test harness only; harmless to leave in a preview page.
window.__debug = {
  get pack() { return pack; },
  get doc() { return store.doc; },
  get store() { return store; },
  get tool() { return tool; },
};

// --- geometry helpers ----------------------------------------------------

function skuById(id) {
  return pack?.skus.find((s) => s.id === id) || null;
}

function worldToScreen(x, y) {
  return [cam.ox + x * cam.scale, cam.oy + y * cam.scale];
}

function screenToWorld(px, py) {
  return [(px - cam.ox) / cam.scale, (py - cam.oy) / cam.scale];
}

function pointerWorld(ev) {
  const rect = el.canvas.getBoundingClientRect();
  return screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top);
}

/**
 * The grid step new points round to, tied to zoom. Zoomed out, a coarse 0.1 m
 * step keeps drags predictable; zoomed in, cam.scale is large enough that a
 * screen pixel covers a much smaller distance, so the step shrinks to match -
 * fine placement is only useful once you can actually see it.
 */
function activeGrid() {
  if (cam.scale >= 800) return 0.001;
  if (cam.scale >= 400) return 0.005;
  if (cam.scale >= 140) return 0.01;
  if (cam.scale >= 90) return 0.02;
  if (cam.scale >= 60) return 0.05;
  return GRID;
}

/**
 * Resolve a candidate world point to where it should actually land: an exact
 * join with another wall/beam endpoint or room corner, an alignment guide
 * (same X or Y as one of those points), or - failing both - the current
 * zoom-scaled grid. Updates `snapGuide` as a side effect so the caller just
 * has to re-render.
 */
function applySnap(wx, wy, exclude) {
  const targets = collectSnapTargets(store.doc, exclude);
  const tol = SNAP_PIXEL_TOL / cam.scale;
  const result = snapPoint(wx, wy, targets, tol);
  if (result.snapped) {
    snapGuide = result;
    return { x: result.x, y: result.y };
  }
  snapGuide = null;
  return { x: roundGrid(wx, activeGrid()), y: roundGrid(wy, activeGrid()) };
}

function itemRect(item, sku) {
  const g = sku.geometry || {};
  const w = g.width || 0.4;
  const d = g.depth || g.width || 0.4;
  const rot = Math.abs(((item.rotation || 0) / 90) % 2);
  return rot ? { x: item.x, y: item.y, w: d, h: w } : { x: item.x, y: item.y, w, h: d };
}

function objectStatus(obj) {
  return obj?.status === "existing" ? "existing" : "planned";
}

function currentWalls() {
  wallsCache = pack ? deriveWalls(store.doc, pack) : [];
  return wallsCache;
}

/** True if a shaped/drawn object (room, slab, roof, segment, beam, item) sits on the active level. */
function onActiveLevel(obj) {
  return effectiveLevel(obj, pack) === activeLevel;
}

/**
 * An opening has no level of its own - it belongs to whichever wall hosts it,
 * which is itself either a drawn segment's level or its bounding room's level.
 * `walls` is the full (unfiltered) derivation so a host is always found.
 */
function openingOnActiveLevel(opening, walls) {
  const wall = wallForOpening(store.doc, pack, walls, opening);
  return !!wall && wall.level === activeLevel;
}

/**
 * Levels bottom-to-top, so the slider moves the way the building does. Sorts
 * by elevation when every level states one; falls back to pack order (e.g. an
 * inferred pack pending Export Catalog) rather than guessing.
 */
function orderedLevels() {
  const levels = pack.levels || [];
  if (!levels.every((l) => Number.isFinite(l.elevation))) return levels;
  return [...levels].sort((a, b) => a.elevation - b.elevation);
}

/** True if `levelId` is a below-datum (foundation-kind) level. Same test as
 * `buildHouseStations`'s `isFoundation`, kept in one place so the level
 * switcher and the ribbon's foundation warning never disagree on what
 * counts as a foundation storey. */
function isFoundationLevel(levelId) {
  const level = (pack.levels || []).find((l) => l.id === levelId);
  return Number.isFinite(level?.elevation) && level.elevation < 0;
}

/** Categories that belong on a foundation storey: the foundation itself and
 * a boundary wall (a property-line fact, not tied to a storey). Everything
 * else - rooms, floors, ceilings, roofs, openings, services - is the
 * "ordinary walls, rooms and ceilings underground" mistake `defaultLevelId`
 * in build-pack.js already exists to steer new documents away from. */
const FOUNDATION_OK_CATEGORIES = new Set(["foundation", "boundarywall"]);

/** The category (or categories) the currently armed tool would place, from
 * whichever source is live: a ribbon function's declared categories, or a
 * single type picked directly from the palette. Null while nothing is armed. */
function armedCategories() {
  if (paletteFilter) return paletteFilter;
  const sku = skuById(placeSkuId);
  return sku ? [sku.category] : null;
}

/** True if the armed tool would place something a foundation storey should
 * not carry, while the plan is currently cut at a foundation level. */
function foundationLevelMismatch() {
  if (tool === "select" || !isFoundationLevel(activeLevel)) return false;
  const categories = armedCategories();
  return Boolean(categories && categories.some((c) => !FOUNDATION_OK_CATEGORIES.has(c)));
}

// --- level widget: house cutaway + elevation-accurate rail ---------------
// Ported in full from level-slider-mock.html. The house is a schematic
// single-bay cutaway - not the real plan geometry, and the roof rise is a
// fixed constant since nothing here has real roof geometry to draw - used
// only to give the rail a physical floor/ceiling/roof reference instead of
// the flat evenly-spaced-tick rail this replaces. Real geometry stays on the
// plan canvas.
const SVG_NS = "http://www.w3.org/2000/svg";
const HOUSE_VB = { w: 248, h: 318, padTop: 16, padBot: 22 };
const HOUSE_ROOF_RISE = 1.65;
const HOUSE_SLAB = 0.2;
const HOUSE_CEIL = 0.09;
const HOUSE_WALL_T = 6.5;
const HOUSE_X0 = 28;
const HOUSE_X1 = HOUSE_X0 + HOUSE_WALL_T;
const HOUSE_BREAK_X = 132;
const HOUSE_RAIL_X = 214;
const HOUSE_RAIL_GRAB = 12;

let houseStations = [];
let houseZToY = () => 0;
let houseYToZ = () => 0;
let houseCutGroup = null;
let houseGhostGroup = null;
let houseGhostLabel = null;
let houseDragging = false;
/** Which station (may be a level's ceiling or the roof, not just its floor)
 * the widget currently shows as cut. Kept separate from `activeLevel`
 * because a ceiling/roof cut still edits the level that owns it. */
let activeStationId = null;

function svgEl(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function houseKindPhrase(kind) {
  if (kind === "ceiling") return "ceiling plan";
  if (kind === "roof") return "roof plan";
  if (kind === "foundation") return "foundation plan";
  return "floor plan";
}

/**
 * One "floor" station per level (foundation-kind below datum), plus a
 * "ceiling" station where the level states one, plus a synthetic roof
 * station above the top level. Each carries the index of the real level it
 * belongs to: editing is still per-level, the ceiling/roof cuts are purely
 * a richer read of where that level's rail position falls physically.
 */
function buildHouseStations(levels) {
  const out = [];
  levels.forEach((level, i) => {
    const isFoundation = level.elevation < 0;
    out.push({
      id: `${level.id}::floor`,
      levelIndex: i,
      kind: isFoundation ? "foundation" : "floor",
      elevation: level.elevation,
      label: isFoundation ? level.name : `${level.name} · floor`,
    });
    if (Number.isFinite(level.floorToCeiling)) {
      out.push({
        id: `${level.id}::ceiling`,
        levelIndex: i,
        kind: "ceiling",
        elevation: level.elevation + level.floorToCeiling,
        label: `${level.name} · ceiling`,
      });
    }
  });
  const top = levels[levels.length - 1];
  out.push({
    id: "roof",
    levelIndex: levels.length - 1,
    kind: "roof",
    elevation: top.elevation + top.floorToFloor + 0.12,
    label: "Roof · eaves",
  });
  return out;
}

function nearestStationIndex(z) {
  let best = 0;
  let dist = Infinity;
  houseStations.forEach((s, i) => {
    const d = Math.abs(s.elevation - z);
    if (d < dist) { dist = d; best = i; }
  });
  return best;
}

/** Index of `activeStationId` in `houseStations`, falling back to the active
 * level's floor station when the id is stale (a fresh rebuild, a level was
 * removed, etc). */
function activeStationIndex() {
  let idx = houseStations.findIndex((s) => s.id === activeStationId);
  if (idx === -1) idx = houseStations.findIndex((s) => s.id === `${activeLevel}::floor`);
  return Math.max(0, idx);
}

/**
 * Full rebuild of the house widget: called whenever the level set itself may
 * have changed (pack load, demo house, "on level" edits) or on startup.
 * Cheap enough to always rebuild in full rather than diff the previous
 * levels, matching how the mock's own mount() works.
 */
function drawLevelSwitcher() {
  const levels = orderedLevels();
  const hasWidget = el.levelWidget && el.levelHouse;
  if (el.levelWidget) el.levelWidget.hidden = levels.length < 2;
  if (!levels.length || !hasWidget) return;

  houseStations = buildHouseStations(levels);
  // drawLevelSwitcher() is only ever called for changes external to this
  // widget (pack load, demo house, "on level" edits) - the widget's own
  // interactions go through selectStationIndex()/renderLevelCut() instead -
  // so the cut always snaps back to the active level's floor here.
  activeStationId = `${activeLevel}::floor`;

  const topLevel = levels[levels.length - 1];
  const eavesZ = topLevel.elevation + topLevel.floorToFloor;
  const ridgeZ = eavesZ + HOUSE_ROOF_RISE;
  const zMin = levels[0].elevation - 0.55;
  const zMax = ridgeZ + 0.45;

  houseZToY = (z) => {
    const t = (z - zMin) / (zMax - zMin);
    return HOUSE_VB.padTop + (1 - t) * (HOUSE_VB.h - HOUSE_VB.padTop - HOUSE_VB.padBot);
  };
  houseYToZ = (y) => {
    const t = 1 - (y - HOUSE_VB.padTop) / (HOUSE_VB.h - HOUSE_VB.padTop - HOUSE_VB.padBot);
    return zMin + t * (zMax - zMin);
  };

  const groundY = houseZToY(0);
  const foundY = houseZToY(levels[0].elevation);
  const eavesY = houseZToY(eavesZ);
  const ridgeY = houseZToY(ridgeZ);
  const footY = houseZToY(levels[0].elevation - 0.2);

  function breakLine(x, y0, y1) {
    const mid = (y0 + y1) / 2;
    return `<path class="house-break" d="
      M ${x} ${y0}
      L ${x} ${mid - 10}
      L ${x + 5} ${mid - 6}
      L ${x - 5} ${mid + 6}
      L ${x} ${mid + 10}
      L ${x} ${y1}" />`;
  }

  const occupied = levels.filter((l) => l.elevation >= 0);
  const openings = occupied.map((l) => {
    const sill = houseZToY(l.elevation + 0.95);
    const head = houseZToY(l.elevation + 2.2);
    const oh = head - sill;
    if (oh <= 1) return "";
    return `<rect class="house-void" x="${HOUSE_X0 - 0.3}" y="${sill}" width="${HOUSE_WALL_T + 0.6}" height="${oh}" />`;
  }).join("");

  const floors = occupied.map((l) => {
    const y = houseZToY(l.elevation);
    const h = Math.max(1.8, houseZToY(l.elevation - HOUSE_SLAB) - y);
    return `<rect class="house-poche" x="${HOUSE_X1}" y="${y}" width="${HOUSE_BREAK_X - HOUSE_X1}" height="${h}" />`;
  }).join("");

  const ceilings = occupied.filter((l) => Number.isFinite(l.floorToCeiling)).map((l) => {
    const y = houseZToY(l.elevation + l.floorToCeiling);
    const h = Math.max(1, houseZToY(l.elevation + l.floorToCeiling - HOUSE_CEIL) - y);
    return `<rect class="house-ceiling" x="${HOUSE_X1}" y="${y}" width="${HOUSE_BREAK_X - HOUSE_X1}" height="${h}" />`;
  }).join("");

  const eaveX = HOUSE_X0 - 11;
  const eaveY = eavesY + 2;
  const roofEndX = HOUSE_BREAK_X + 2;
  const roofT = (roofEndX - eaveX) / 130;
  const roofEndY = eaveY - (eaveY - ridgeY) * roofT;

  const ticks = houseStations.map((s) => {
    const y = houseZToY(s.elevation);
    return `<line class="house-tick" x1="${HOUSE_RAIL_X - 3.5}" y1="${y}" x2="${HOUSE_RAIL_X + 3.5}" y2="${y}" />`;
  }).join("");

  el.levelHouse.innerHTML = `
    <defs>
      <pattern id="v2-house-earth" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(32)">
        <line x1="0" y1="0" x2="0" y2="5" stroke="#d2c6b4" stroke-width="0.55" />
      </pattern>
    </defs>
    <style>
      .house-earth { fill: url(#v2-house-earth); }
      .house-grade { stroke: #1a1612; stroke-width: 0.9; fill: none; }
      .house-poche { fill: #2c2824; stroke: #1a1612; stroke-width: 0.55; }
      .house-void { fill: #f6f1e8; stroke: #1a1612; stroke-width: 0.55; }
      .house-ceiling { fill: #cfc6b8; stroke: #1a1612; stroke-width: 0.4; }
      .house-stroke { fill: none; stroke: #1a1612; stroke-width: 0.9; }
      .house-break { fill: none; stroke: #1a1612; stroke-width: 0.7; }
      .house-rail { stroke: #c0b4a2; stroke-width: 1; }
      .house-tick { stroke: #8a7d6c; stroke-width: 1; }
      .house-cut { stroke: #b2451e; stroke-width: 1.1; stroke-dasharray: 3.2 2.4; fill: none; }
      .house-cut-cap { fill: #b2451e; }
      .house-thumb { fill: #f6f1e8; stroke: #b2451e; stroke-width: 1.2; }
      .house-rail-band, .house-thumb-hit { fill: transparent; cursor: ns-resize; }
      .house-ghost { opacity: 0; pointer-events: none; }
      .house-ghost.on { opacity: 0.4; }
      .house-ghost line { stroke: #b2451e; stroke-width: 1.1; stroke-dasharray: 3.2 2.4; }
      .house-ghost text { fill: #b2451e; font-size: 8.5px; font-family: "Source Sans 3", sans-serif; }
      @media (prefers-reduced-motion: no-preference) {
        .house-cut-group { transition: transform 120ms ease-out; }
        .house-ghost { transition: transform 120ms ease-out, opacity 120ms ease-out; }
      }
    </style>
    <rect class="house-earth" x="${HOUSE_X0 - 16}" y="${groundY}" width="${HOUSE_BREAK_X - HOUSE_X0 + 22}" height="${HOUSE_VB.h - groundY - 10}" />
    <line class="house-grade" x1="${HOUSE_X0 - 16}" y1="${groundY}" x2="${HOUSE_BREAK_X + 6}" y2="${groundY}" />
    <rect class="house-poche" x="${HOUSE_X0 - 6}" y="${groundY}" width="${HOUSE_WALL_T + 12}" height="${footY - groundY}" />
    <rect class="house-poche" x="${HOUSE_X1}" y="${foundY}" width="${HOUSE_BREAK_X - HOUSE_X1}" height="${Math.max(1.6, houseZToY(levels[0].elevation - 0.16) - foundY)}" />
    <rect class="house-poche" x="${HOUSE_X0}" y="${eavesY}" width="${HOUSE_WALL_T}" height="${groundY - eavesY}" />
    ${openings}
    ${floors}
    ${ceilings}
    <path class="house-poche" d="
      M ${eaveX} ${eaveY}
      L ${roofEndX} ${roofEndY}
      L ${roofEndX} ${roofEndY + 5.5}
      L ${eaveX + 2.5} ${eaveY + 5.5}
      Z" />
    <path class="house-stroke" d="M ${eaveX} ${eaveY} L ${roofEndX} ${roofEndY}" />
    ${breakLine(HOUSE_BREAK_X, ridgeY + 4, footY)}
    <line class="house-rail" x1="${HOUSE_RAIL_X}" y1="${houseZToY(ridgeZ)}" x2="${HOUSE_RAIL_X}" y2="${houseZToY(levels[0].elevation)}" />
    ${ticks}
    <rect class="house-rail-band" x="${HOUSE_RAIL_X - HOUSE_RAIL_GRAB}" y="${houseZToY(ridgeZ) - 12}"
          width="${HOUSE_RAIL_GRAB * 2}" height="${houseZToY(levels[0].elevation) - houseZToY(ridgeZ) + 24}" />
    <g id="v2-house-cut-layer"></g>
  `;

  const cutLayer = el.levelHouse.querySelector("#v2-house-cut-layer");
  const xLeft = HOUSE_X0 - 8;

  houseGhostLabel = svgEl("text", { x: HOUSE_BREAK_X + 6, y: -3 });
  houseGhostGroup = svgEl("g", { class: "house-ghost" });
  houseGhostGroup.append(
    svgEl("line", { x1: xLeft, y1: 0, x2: HOUSE_RAIL_X - 7, y2: 0 }),
    houseGhostLabel,
  );

  houseCutGroup = svgEl("g", { class: "house-cut-group" });
  houseCutGroup.append(
    svgEl("line", { class: "house-cut", x1: xLeft, y1: 0, x2: HOUSE_BREAK_X, y2: 0 }),
    svgEl("polygon", { class: "house-cut-cap", points: `${xLeft},0 ${xLeft - 4.5},-2.8 ${xLeft - 4.5},2.8` }),
    svgEl("line", { class: "house-cut", x1: HOUSE_BREAK_X, y1: 0, x2: HOUSE_RAIL_X - 7, y2: 0 }),
    svgEl("rect", { class: "house-thumb", x: HOUSE_RAIL_X - 5, y: -5, width: 10, height: 10 }),
    svgEl("rect", { class: "house-thumb-hit", x: HOUSE_RAIL_X - HOUSE_RAIL_GRAB, y: -12, width: HOUSE_RAIL_GRAB * 2, height: 24 }),
  );
  const startIdx = activeStationIndex();
  houseCutGroup.setAttribute("transform", `translate(0 ${houseZToY(houseStations[startIdx].elevation)})`);
  cutLayer.append(houseGhostGroup, houseCutGroup);

  el.levelHouse.setAttribute("aria-valuemin", "0");
  el.levelHouse.setAttribute("aria-valuemax", String(houseStations.length - 1));

  if (el.levelStations) {
    el.levelStations.innerHTML = [...houseStations].reverse().map((s) => `
      <li>
        <button type="button" data-id="${escapeHtml(s.id)}">
          <span>${escapeHtml(s.label)}</span>
          <span class="level-station-elev">${s.elevation.toFixed(2)}</span>
        </button>
      </li>
    `).join("");
  }

  renderLevelCut();
}

/**
 * Repositions the cut and refreshes labels for the current activeStationId,
 * without rebuilding the whole SVG - used for selection, keyboard paging and
 * the drag/click handlers, where the level set itself hasn't changed.
 */
function renderLevelCut() {
  if (!houseStations.length || !houseCutGroup) return;
  const idx = activeStationIndex();
  const s = houseStations[idx];
  houseCutGroup.setAttribute("transform", `translate(0 ${houseZToY(s.elevation)})`);
  el.levelHouse.setAttribute("aria-valuenow", String(idx));
  el.levelHouse.setAttribute("aria-valuetext", s.label);
  if (el.cutName) el.cutName.textContent = s.label;
  if (el.cutElev) el.cutElev.textContent = `${s.elevation.toFixed(2)} m`;
  if (el.cutKind) el.cutKind.textContent = houseKindPhrase(s.kind);
  for (const btn of el.levelStations?.querySelectorAll("button") || []) {
    if (btn.dataset.id === s.id) btn.setAttribute("aria-current", "true");
    else btn.removeAttribute("aria-current");
  }
}

/** Commits to station `idx`: switches the active level when it belongs to a
 * different one from the one currently shown (a ceiling/roof cut still
 * edits the level that owns it). No-ops if neither the station nor the
 * level actually changes. */
function selectStationIndex(idx) {
  const s = houseStations[idx];
  if (!s) return;
  const levels = orderedLevels();
  const level = levels[s.levelIndex];
  const levelChanged = level && level.id !== activeLevel;
  if (s.id === activeStationId && !levelChanged) return;
  activeStationId = s.id;
  if (levelChanged) {
    activeLevel = level.id;
    beamStart = null;
    drag = null;
    store.clearSelection();
    updateRibbonHint();
    drawRibbon();
  }
  renderLevelCut();
  render();
}

function houseLocalPoint(clientX, clientY) {
  const pt = el.levelHouse.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = el.levelHouse.getScreenCTM();
  return ctm ? pt.matrixTransform(ctm.inverse()) : null;
}

function showHouseGhost(idx) {
  if (!houseGhostGroup || !houseStations[idx]) return;
  if (idx === activeStationIndex()) { hideHouseGhost(); return; }
  const s = houseStations[idx];
  houseGhostGroup.setAttribute("transform", `translate(0 ${houseZToY(s.elevation)})`);
  houseGhostLabel.textContent = s.label;
  houseGhostGroup.classList.add("on");
}

function hideHouseGhost() {
  if (houseGhostGroup) houseGhostGroup.classList.remove("on");
}

/** Next station in `dir` that starts a storey, so PgUp/PgDn skip ceilings. */
function houseStoreyStep(dir) {
  const idx = activeStationIndex();
  for (let i = idx + dir; i >= 0 && i < houseStations.length; i += dir) {
    if (houseStations[i].kind === "floor" || houseStations[i].kind === "foundation") return i;
  }
  return dir > 0 ? houseStations.length - 1 : 0;
}

/**
 * Drag-to-scrub, click-to-jump and keyboard paging for the house rail, plus
 * the stations list clicks. Wired once at startup: `el.levelHouse` persists
 * across rebuilds, only its children (and the cached cutGroup/ghostGroup
 * refs, refreshed by drawLevelSwitcher()) are replaced.
 */
function wireLevelWidget() {
  if (!el.levelHouse) return;

  el.levelHouse.addEventListener("pointerdown", (e) => {
    const loc = houseLocalPoint(e.clientX, e.clientY);
    if (!loc || !houseStations.length) return;
    // Only the rail is a drag handle. The house is a drawing first, so
    // clicking it picks a station without turning the widget into a scrub
    // surface end to end.
    if (loc.x >= HOUSE_RAIL_X - HOUSE_RAIL_GRAB) {
      houseDragging = true;
      el.levelHouse.setPointerCapture(e.pointerId);
    }
    hideHouseGhost();
    selectStationIndex(nearestStationIndex(houseYToZ(loc.y)));
  });
  el.levelHouse.addEventListener("pointermove", (e) => {
    const loc = houseLocalPoint(e.clientX, e.clientY);
    if (!loc || !houseStations.length) return;
    if (houseDragging) selectStationIndex(nearestStationIndex(houseYToZ(loc.y)));
    else showHouseGhost(nearestStationIndex(houseYToZ(loc.y)));
  });
  el.levelHouse.addEventListener("pointerup", () => { houseDragging = false; });
  el.levelHouse.addEventListener("pointercancel", () => { houseDragging = false; });
  el.levelHouse.addEventListener("pointerleave", () => { if (!houseDragging) hideHouseGhost(); });

  el.levelHouse.addEventListener("keydown", (e) => {
    if (!houseStations.length) return;
    hideHouseGhost();
    const idx = activeStationIndex();
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      e.preventDefault();
      selectStationIndex(Math.min(houseStations.length - 1, idx + 1));
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      e.preventDefault();
      selectStationIndex(Math.max(0, idx - 1));
    } else if (e.key === "PageUp") {
      e.preventDefault();
      selectStationIndex(houseStoreyStep(1));
    } else if (e.key === "PageDown") {
      e.preventDefault();
      selectStationIndex(houseStoreyStep(-1));
    } else if (e.key === "Home") {
      e.preventDefault();
      selectStationIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      selectStationIndex(houseStations.length - 1);
    }
  });

  el.levelStations?.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const idx = houseStations.findIndex((s) => s.id === btn.dataset.id);
    if (idx !== -1) selectStationIndex(idx);
  });
}

// --- canvas sizing and drawing --------------------------------------------

function resizeCanvas() {
  const rect = el.canvasWrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  el.canvas.width = Math.max(1, Math.round(rect.width * dpr));
  el.canvas.height = Math.max(1, Math.round(rect.height * dpr));
  el.canvas.style.width = `${rect.width}px`;
  el.canvas.style.height = `${rect.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render();
}

const COLOUR = {
  existing: "#8a8074",
  planned: "#b2451e",
  mixed: "#3a5f7a",
  wall: "#1a1612",
  door: "#b2451e",
  window: "#3a5f7a",
  selection: "#243044",
  hover: "#8d3416",
  slab: "rgba(58, 95, 122, 0.14)",
  roof: "rgba(154, 107, 31, 0.10)",
  // Site: distinct from every drawable category above, since a property
  // line and a building line are boundaries to check against, not things
  // that get a schedule row.
  propertyLine: "#5b7553",
  buildingLine: "#8d6f3a",
};

function statusStroke(status) {
  return COLOUR[status] || COLOUR.planned;
}

function draw() {
  const rect = el.canvasWrap.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  if (!pack) return;

  drawUnderlay(ctx, store.doc, worldToScreen, cam.scale);
  drawGrid(rect);
  drawSiteLines();
  const walls = currentWalls();
  const levelWalls = walls.filter(onActiveLevel);

  if (!isolateCurrentLevel) {
    const below = lookDownLevelId(pack.levels, activeLevel);
    if (below) drawPlanLevel(below, walls, { ghost: true });
  }
  drawPlanLevel(activeLevel, walls);
  if (showDimensions) drawDimensions();

  drawSelectionHighlights(levelWalls);
  if (hover && !store.isSelected(hover.kind, hover.id) && tool === "select" && !drag) drawHover(hover);
  if (drag?.kind === "marquee") drawMarquee();
  if (drag?.kind === "wall-new") drawWallDraft();
  if (beamStart) drawBeamStart();
  if (tool === "property" && siteDraft) drawPropertyDraft();
  if (tool === "sg-ref" && sgPick) drawSgPick();
  drawSnapGuide(rect);
  drawEndpointHandles();
  drawUnderlayHandles();
  if (calibration?.a) drawCalibration();

  el.empty.hidden = store.hasContent();
  el.legend.hidden = !store.hasContent();
}

/** Selection outline plus the four corner-scale handles and the free-rotate handle. */
const UNDERLAY_DRAG_KINDS = new Set(["underlay-move", "underlay-scale", "underlay-rotate"]);

function drawUnderlayHandles() {
  if (!underlaySelected || !underlayIsVisible()) return;
  if (tool !== "select") return; // mid-calibration, the crosshair owns the canvas instead
  if (drag && !UNDERLAY_DRAG_KINDS.has(drag.kind)) return;
  const corners = underlayCorners(store.doc);
  if (!corners) return;

  ctx.save();
  ctx.strokeStyle = COLOUR.selection;
  ctx.lineWidth = 1.6;
  ctx.setLineDash([]);
  ctx.beginPath();
  corners.forEach(({ x, y }, i) => {
    const [sx, sy] = worldToScreen(x, y);
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  ctx.closePath();
  ctx.stroke();

  for (const { x, y } of corners) {
    const [sx, sy] = worldToScreen(x, y);
    ctx.fillStyle = "#f4ede1";
    ctx.fillRect(sx - HANDLE / 2, sy - HANDLE / 2, HANDLE, HANDLE);
    ctx.strokeRect(sx - HANDLE / 2, sy - HANDLE / 2, HANDLE, HANDLE);
  }

  const topMid = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
  const rot = underlayRotateHandlePoint(corners);
  const [tmx, tmy] = worldToScreen(topMid.x, topMid.y);
  const [rsx, rsy] = worldToScreen(rot.x, rot.y);
  ctx.beginPath();
  ctx.moveTo(tmx, tmy);
  ctx.lineTo(rsx, rsy);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(rsx, rsy, HANDLE / 2 + 1, 0, Math.PI * 2);
  ctx.fillStyle = "#f4ede1";
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/**
 * The line grows live to the cursor while the second point is still being
 * chosen, then freezes on calibration.b once it is clicked - and either way
 * shows a distance label (reusing the same label walls draw while dragging)
 * so the user can see what they are about to measure before they type
 * anything.
 */
function drawCalibration() {
  const target = calibration.b || hoverPoint;
  const [ax, ay] = worldToScreen(calibration.a.x, calibration.a.y);
  ctx.save();
  ctx.strokeStyle = COLOUR.hover;
  ctx.fillStyle = COLOUR.hover;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(ax, ay, 4, 0, Math.PI * 2);
  ctx.fill();
  if (target) {
    const [bx, by] = worldToScreen(target.x, target.y);
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(bx, by, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  if (target) drawLengthLabel(calibration.a.x, calibration.a.y, target.x, target.y);
}

let lastRibbonHasSelection = null;

function render() {
  draw();
  syncSizeHud();
  syncPlanContext();
  syncUnderlayPanel();
  syncCalibratePanel();
  syncSgPanel();
  syncHeaderModify();
  // Simple's Modify tab gates its whole content on selection; refresh it
  // only when that flips (not on every render(), which pointer drags call
  // continuously) so the tab unlocks the moment something is picked.
  const hasSel = store.selected.length > 0;
  if (density === "simple" && activeTab === "modify" && hasSel !== lastRibbonHasSelection) {
    drawRibbon();
  }
  lastRibbonHasSelection = hasSel;
}

/** Rotate / Copy / Delete on the plan header, selection-aware: they only show
 * once something is selected, so people do not have to hunt the Modify tab
 * for the three operations they reach for constantly. */
function syncHeaderModify() {
  if (!el.headerModify) return;
  el.headerModify.hidden = !store.selected.length;
}

/** Opacity slider + rotation field, shown only while the underlay is the active selection (and not mid-calibration - the two panels would otherwise overlap). */
function syncUnderlayPanel() {
  if (!el.underlayPanel) return;
  const show = tool === "select" && underlaySelected && underlayIsVisible();
  el.underlayPanel.hidden = !show;
  if (!show) return;
  const u = store.doc.underlay;
  if (document.activeElement !== el.underlayOpacity) {
    el.underlayOpacity.value = String(Math.round((u.opacity ?? 0.55) * 100));
  }
  if (document.activeElement !== el.underlayRotation) {
    el.underlayRotation.value = String(Math.round(((u.rotation || 0) % 360) * 10) / 10);
  }
}

/** Set-scale panel: the hint and the real-distance field track which of the two points have been clicked. */
function syncCalibratePanel() {
  if (!el.calibratePanel) return;
  const show = tool === "calibrate";
  el.calibratePanel.hidden = !show;
  if (!show) return;
  const bSet = Boolean(calibration?.b);
  setHidden(el.calibrateDistanceWrap, !bSet);
  setHidden(el.calibrateConfirm, !bSet);
  if (el.calibrateHint) {
    el.calibrateHint.textContent = !calibration?.a
      ? "Click the first point of a known distance."
      : !bSet
        ? "Click the second point."
        : "Enter the real distance between those two points.";
  }
}

/** SG reference panel: the field row only appears once a plan point has been picked. */
function syncSgPanel() {
  if (!el.sgPanel) return;
  const show = tool === "sg-ref";
  el.sgPanel.hidden = !show;
  if (!show) return;
  const picked = Boolean(sgPick);
  setHidden(el.sgFieldsWrap, !picked);
  if (el.sgHint) {
    el.sgHint.textContent = picked
      ? "Enter the erf number and the real-world coordinate for this point."
      : "Click the point on your drawing that matches a known SG diagram coordinate.";
  }
}

function drawGrid(rect) {
  ctx.save();
  ctx.strokeStyle = "rgba(26, 22, 18, 0.06)";
  ctx.lineWidth = 1;
  const [wx0, wy0] = screenToWorld(0, 0);
  const [wx1, wy1] = screenToWorld(rect.width, rect.height);
  const step =
    cam.scale < 24 ? 5
    : cam.scale < 60 ? 1
    : cam.scale < 90 ? 0.5
    : cam.scale < 140 ? 0.2
    : cam.scale < 400 ? 0.1
    : cam.scale < 800 ? 0.01
    : 0.001;
  for (let x = Math.floor(wx0 / step) * step; x <= wx1; x += step) {
    const [sx] = worldToScreen(x, 0);
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, rect.height);
    ctx.stroke();
  }
  for (let y = Math.floor(wy0 / step) * step; y <= wy1; y += step) {
    const [, sy] = worldToScreen(0, y);
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(rect.width, sy);
    ctx.stroke();
  }
  ctx.restore();
}

function pathForPoly(poly) {
  ctx.beginPath();
  poly.forEach(([x, y], i) => {
    const [sx, sy] = worldToScreen(x, y);
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  ctx.closePath();
}

function onLevel(obj, levelId) {
  return effectiveLevel(obj, pack) === levelId;
}

function openingOnLevel(opening, walls, levelId) {
  const wall = wallForOpening(store.doc, pack, walls, opening);
  return !!wall && wall.level === levelId;
}

/** One storey's geometry. Ghosted geometry is faded and unlabelled so it
 * reads as context, not as the plan you are editing. */
function drawPlanLevel(levelId, walls, { ghost = false } = {}) {
  ctx.save();
  if (ghost) ctx.globalAlpha = 0.28;
  for (const slab of store.doc.slabs.filter((s) => onLevel(s, levelId))) {
    drawPolyFill(shapePolygon(slab.shape), COLOUR.slab, statusStroke(objectStatus(slab)));
  }
  for (const roof of store.doc.roofs.filter((r) => onLevel(r, levelId))) {
    drawPolyOutline(shapePolygon(roof.shape), statusStroke(objectStatus(roof)), true);
  }
  for (const room of store.doc.rooms.filter((r) => onLevel(r, levelId))) {
    if (ghost) drawRoomGhost(room);
    else drawRoom(room);
  }
  for (const wall of walls.filter((w) => w.level === levelId)) drawWall(wall);
  for (const beam of store.doc.beams.filter((b) => onLevel(b, levelId))) drawBeam(beam);
  if (!ghost) {
    for (const item of store.doc.items.filter((i) => onLevel(i, levelId))) drawItem(item);
  }
  for (const opening of store.doc.openings.filter((o) => openingOnLevel(o, walls, levelId))) {
    drawOpening(opening, walls);
  }
  ctx.restore();
}

function drawRoomGhost(room) {
  const poly = roomPolygon(room);
  if (poly.length < 3) return;
  drawPolyFill(poly, "rgba(26, 22, 18, 0.04)", COLOUR.existing);
}

function drawPolyFill(poly, fill, stroke) {
  if (poly.length < 3) return;
  ctx.save();
  pathForPoly(poly);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.restore();
}

function drawPolyOutline(poly, stroke, dashed) {
  if (poly.length < 3) return;
  ctx.save();
  if (dashed) ctx.setLineDash([6, 5]);
  pathForPoly(poly);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.restore();
}

function drawRoom(room) {
  const poly = roomPolygon(room);
  if (poly.length < 3) return;
  drawPolyFill(poly, "rgba(180, 69, 30, 0.06)", statusStroke(objectStatus(room)));
  const [cx, cy] = worldToScreen(...centroidOf(poly));
  ctx.save();
  ctx.fillStyle = "#1a1612";
  ctx.font = "600 12px Source Sans 3, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(room.name || "Room", cx, cy - 4);
  ctx.font = "11px Source Sans 3, sans-serif";
  ctx.fillStyle = "#5c5348";
  ctx.fillText(`${roomArea(room).toFixed(1)} m²`, cx, cy + 12);
  ctx.restore();
}

function centroidOf(poly) {
  const b = bbox(poly);
  return [b.x + b.w / 2, b.y + b.h / 2];
}

function drawWall(wall) {
  const [ax, ay] = worldToScreen(wall.x1, wall.y1);
  const [bx, by] = worldToScreen(wall.x2, wall.y2);
  ctx.save();
  ctx.strokeStyle = wall.drawn ? statusStroke(wall.status) : COLOUR.wall;
  ctx.lineWidth = Math.max(2, wall.thickness * cam.scale);
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.restore();
}

function drawOpening(opening, walls) {
  const wall = wallForOpening(store.doc, pack, walls, opening);
  if (!wall) return;
  const sku = skuById(opening.sku);
  if (!sku) return;
  const width = sku.geometry?.width || 0.9;
  const t = wallT(wall, ...anchorPoint(opening, wall));
  const half = (width / 2) / (wall.length || 1);
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  const ax = wall.x1 + dx * (t - half);
  const ay = wall.y1 + dy * (t - half);
  const bx = wall.x1 + dx * (t + half);
  const by = wall.y1 + dy * (t + half);
  const [sax, say] = worldToScreen(ax, ay);
  const [sbx, sby] = worldToScreen(bx, by);
  ctx.save();
  ctx.strokeStyle = sku.category === "window" ? COLOUR.window : COLOUR.door;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(sax, say);
  ctx.lineTo(sbx, sby);
  ctx.stroke();
  if (sku.category === "door") {
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * (opening.swing || 1);
    const ny = (dx / len) * (opening.swing || 1);
    const [hx, hy] = worldToScreen(ax, ay);
    const [ex, ey] = worldToScreen(ax + nx * width, ay + ny * width);
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(ex, ey);
    ctx.moveTo(ex, ey);
    ctx.lineTo(sbx, sby);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDimensions() {
  const boxes = store.doc.rooms.filter(onActiveLevel).map((r) => bbox(roomPolygon(r)));
  for (const line of planDimensionLines(boxes)) drawDimensionLine(line);
}

/** A dimension string: extension lines from the object to the offset line, end ticks, and a centred label. */
function drawDimensionLine(line) {
  const [x1, y1] = worldToScreen(line.x1, line.y1);
  const [x2, y2] = worldToScreen(line.x2, line.y2);
  const colour = line.overall ? "#1a1612" : "#5c5347";
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = line.overall ? 1.2 : 1;

  for (const [ex, ey] of line.extFrom) {
    const [sx, sy] = worldToScreen(ex, ey);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(line.kind === "h" ? sx : x1, line.kind === "h" ? y1 : sy);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  for (const [tx, ty] of [[x1, y1], [x2, y2]]) {
    ctx.beginPath();
    ctx.arc(tx, ty, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  ctx.font = line.overall ? "bold 12px 'Source Sans 3', sans-serif" : "11px 'Source Sans 3', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const padding = 3;
  const width = ctx.measureText(line.label).width + padding * 2;
  ctx.save();
  ctx.translate(mx, my);
  if (line.kind === "v") ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = "#f4ede1";
  ctx.fillRect(-width / 2, -8, width, 16);
  ctx.fillStyle = colour;
  ctx.fillText(line.label, 0, 0);
  ctx.restore();
  ctx.restore();
}

function anchorPoint(opening, wall) {
  if (opening.wallId) {
    const t = Math.min(1, Math.max(0, Number(opening.t) || 0.5));
    return [wall.x1 + (wall.x2 - wall.x1) * t, wall.y1 + (wall.y2 - wall.y1) * t];
  }
  const room = store.doc.rooms.find((r) => r.id === opening.roomId);
  if (!room) return [wall.x1, wall.y1];
  const edge = roomEdgeSegment(room, opening.edgeIndex ?? 0);
  const t = Math.min(1, Math.max(0, Number(opening.t) || 0.5));
  return [edge.x1 + (edge.x2 - edge.x1) * t, edge.y1 + (edge.y2 - edge.y1) * t];
}

function drawBeam(beam) {
  const [ax, ay] = worldToScreen(beam.x1, beam.y1);
  const [bx, by] = worldToScreen(beam.x2, beam.y2);
  const sku = skuById(beam.sku);
  ctx.save();
  ctx.strokeStyle = statusStroke(objectStatus(beam));
  ctx.lineWidth = Math.max(3, (sku?.geometry?.width || 0.11) * cam.scale);
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.restore();
}

function drawItem(item) {
  const sku = skuById(item.sku);
  if (!sku) return;
  const box = itemRect(item, sku);
  const [sx, sy] = worldToScreen(box.x, box.y);
  const [ex, ey] = worldToScreen(box.x + box.w, box.y + box.h);
  ctx.save();
  ctx.fillStyle = "rgba(58, 95, 122, 0.12)";
  ctx.strokeStyle = statusStroke(objectStatus(item));
  ctx.lineWidth = 1.2;
  ctx.fillRect(sx, sy, ex - sx, ey - sy);
  ctx.strokeRect(sx, sy, ex - sx, ey - sy);
  ctx.font = "10px Source Sans 3, sans-serif";
  ctx.fillStyle = "#5c5348";
  ctx.fillText(sku.name, sx, sy - 3);
  ctx.restore();
}

function refsToDraw() {
  return store.selected.length ? store.selected : (store.primary ? [store.primary] : []);
}

function drawSelectionHighlights(walls) {
  for (const ref of refsToDraw()) {
    const obj = objByRef(ref);
    if (!obj) continue;
    ctx.save();
    ctx.strokeStyle = COLOUR.selection;
    ctx.lineWidth = 2.4;
    ctx.setLineDash([]);
    if (ref.kind === "room" || ref.kind === "slab" || ref.kind === "roof") {
      pathForPoly(shapePolygon(obj.shape));
      ctx.stroke();
    } else if (ref.kind === "segment" || ref.kind === "beam") {
      const [ax, ay] = worldToScreen(obj.x1, obj.y1);
      const [bx, by] = worldToScreen(obj.x2, obj.y2);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      drawLengthLabel(obj.x1, obj.y1, obj.x2, obj.y2);
    } else if (ref.kind === "item") {
      const sku = skuById(obj.sku);
      if (sku) {
        const box = itemRect(obj, sku);
        const [sx, sy] = worldToScreen(box.x, box.y);
        const [ex, ey] = worldToScreen(box.x + box.w, box.y + box.h);
        ctx.strokeRect(sx - 2, sy - 2, ex - sx + 4, ey - sy + 4);
      }
    } else if (ref.kind === "opening") {
      const wall = wallForOpening(store.doc, pack, walls, obj);
      if (wall) {
        const [px, py] = worldToScreen(...anchorPoint(obj, wall));
        ctx.beginPath();
        ctx.arc(px, py, HANDLE, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

function drawHover(ref) {
  const obj = objByRef(ref);
  if (!obj) return;
  ctx.save();
  ctx.strokeStyle = COLOUR.hover;
  ctx.lineWidth = 1.4;
  ctx.setLineDash([3, 3]);
  if (ref.kind === "room" || ref.kind === "slab" || ref.kind === "roof") {
    pathForPoly(shapePolygon(obj.shape));
    ctx.stroke();
  } else if (ref.kind === "segment" || ref.kind === "beam") {
    const [ax, ay] = worldToScreen(obj.x1, obj.y1);
    const [bx, by] = worldToScreen(obj.x2, obj.y2);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  } else if (ref.kind === "item") {
    const sku = skuById(obj.sku);
    if (sku) {
      const box = itemRect(obj, sku);
      const [sx, sy] = worldToScreen(box.x, box.y);
      const [ex, ey] = worldToScreen(box.x + box.w, box.y + box.h);
      ctx.strokeRect(sx - 2, sy - 2, ex - sx + 4, ey - sy + 4);
    }
  }
  ctx.restore();
}

function drawMarquee() {
  const box = marqueeBox(drag.x0, drag.y0, drag.x1, drag.y1);
  const [sx, sy] = worldToScreen(box.x, box.y);
  const [ex, ey] = worldToScreen(box.x + box.w, box.y + box.h);
  ctx.save();
  ctx.strokeStyle = box.crossing ? "#8d3416" : "#243044";
  ctx.setLineDash(box.crossing ? [5, 4] : []);
  ctx.lineWidth = 1;
  ctx.fillStyle = "rgba(36, 48, 68, 0.06)";
  ctx.fillRect(sx, sy, ex - sx, ey - sy);
  ctx.strokeRect(sx, sy, ex - sx, ey - sy);
  ctx.restore();
}

function drawWallDraft() {
  const [ax, ay] = worldToScreen(drag.x1, drag.y1);
  const [bx, by] = worldToScreen(drag.x2 ?? drag.x1, drag.y2 ?? drag.y1);
  ctx.save();
  ctx.strokeStyle = "#8d3416";
  ctx.lineWidth = 3;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.restore();
  drawLengthLabel(drag.x1, drag.y1, drag.x2 ?? drag.x1, drag.y2 ?? drag.y1);
}

function segmentLength(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

function drawLengthLabel(x1, y1, x2, y2) {
  const len = segmentLength(x1, y1, x2, y2);
  if (len < 0.05) return;
  const [ax, ay] = worldToScreen(x1, y1);
  const [bx, by] = worldToScreen(x2, y2);
  const pad = 18;
  const clipped = clipSegToRect(ax, ay, bx, by, pad, pad, el.canvasWrap.clientWidth - pad, el.canvasWrap.clientHeight - pad);
  if (!clipped) return;
  const sx = (clipped.x1 + clipped.x2) / 2;
  const sy = (clipped.y1 + clipped.y2) / 2;
  const label = `${len.toFixed(2)} m`;
  ctx.save();
  ctx.font = "600 12px Source Sans 3, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const width = ctx.measureText(label).width + 8;
  ctx.fillStyle = "rgba(244, 237, 225, 0.92)";
  ctx.fillRect(sx - width / 2, sy - 22, width, 16);
  ctx.fillStyle = "#1a1612";
  ctx.fillText(label, sx, sy - 8);
  ctx.restore();
}

function soleLinearSelection() {
  if (store.selected.length !== 1) return null;
  const ref = store.selected[0];
  if (ref.kind !== "segment" && ref.kind !== "beam") return null;
  const obj = objByRef(ref);
  return obj ? { ref, obj } : null;
}

function drawEndpointHandles() {
  const sel = soleLinearSelection();
  if (!sel || drag) return;
  const { obj } = sel;
  for (const [x, y] of [[obj.x1, obj.y1], [obj.x2, obj.y2]]) {
    const [hx, hy] = worldToScreen(x, y);
    ctx.save();
    ctx.fillStyle = "#f4ede1";
    ctx.strokeStyle = COLOUR.selection;
    ctx.lineWidth = 1.6;
    ctx.fillRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
    ctx.strokeRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
    ctx.restore();
  }
}

function endpointHandleHit(wx, wy) {
  const sel = soleLinearSelection();
  if (!sel) return null;
  const { ref, obj } = sel;
  const tol = (HANDLE / 2 + 2) / cam.scale;
  if (Math.hypot(obj.x1 - wx, obj.y1 - wy) <= tol) {
    return { kind: "handle", id: ref.id, target: ref.kind, end: 1 };
  }
  if (Math.hypot(obj.x2 - wx, obj.y2 - wy) <= tol) {
    return { kind: "handle", id: ref.id, target: ref.kind, end: 2 };
  }
  return null;
}

function setSegmentLength(seg, length) {
  const cur = segmentLength(seg.x1, seg.y1, seg.x2, seg.y2);
  const next = Math.max(MIN_TRACE, roundGrid(Number(length) || cur, activeGrid()));
  if (cur < 1e-6) {
    seg.x2 = roundGrid(seg.x1 + next, activeGrid());
    seg.y2 = seg.y1;
    return;
  }
  const s = next / cur;
  seg.x2 = roundGrid(seg.x1 + (seg.x2 - seg.x1) * s, activeGrid());
  seg.y2 = roundGrid(seg.y1 + (seg.y2 - seg.y1) * s, activeGrid());
}

function setSegmentHeading(seg, deg) {
  const len = segmentLength(seg.x1, seg.y1, seg.x2, seg.y2) || MIN_TRACE;
  const rad = (Number(deg) * Math.PI) / 180;
  const grid = activeGrid();
  seg.x2 = roundGrid(seg.x1 + Math.cos(rad) * len, grid);
  seg.y2 = roundGrid(seg.y1 + Math.sin(rad) * len, grid);
}

function applySegmentEnd(obj, end, x, y, lockAxis, origin, ref) {
  let nx;
  let ny;
  if (lockAxis && origin) {
    // Shift keeps the current heading: precision here is the zoom-scaled
    // grid rather than joins, since the user has already committed to an
    // angle and just wants a clean length along it.
    snapGuide = null;
    nx = roundGrid(x, activeGrid());
    ny = roundGrid(y, activeGrid());
    const dx = origin.mx - origin.fx;
    const dy = origin.my - origin.fy;
    const denom = dx * dx + dy * dy;
    if (denom > 1e-8) {
      const t = ((x - origin.fx) * dx + (y - origin.fy) * dy) / denom;
      nx = roundGrid(origin.fx + dx * t, activeGrid());
      ny = roundGrid(origin.fy + dy * t, activeGrid());
    }
  } else {
    const exclude = ref?.kind === "segment" ? { excludeSegmentIds: new Set([ref.id]) }
      : ref?.kind === "beam" ? { excludeBeamIds: new Set([ref.id]) } : undefined;
    const snapped = applySnap(x, y, exclude);
    nx = snapped.x;
    ny = snapped.y;
  }
  const next = end === 1
    ? { x1: nx, y1: ny, x2: obj.x2, y2: obj.y2 }
    : { x1: obj.x1, y1: obj.y1, x2: nx, y2: ny };
  if (segmentLength(next.x1, next.y1, next.x2, next.y2) < MIN_TRACE) return;
  obj.x1 = next.x1;
  obj.y1 = next.y1;
  obj.x2 = next.x2;
  obj.y2 = next.y2;
}

/** Crosshair + dot showing what applySnap() just latched onto. */
function drawSnapGuide(rect) {
  if (!snapGuide || !drag) return;
  ctx.save();
  ctx.strokeStyle = "#3a5f7a";
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  if (snapGuide.guideX !== null && snapGuide.guideX !== undefined) {
    const [sx] = worldToScreen(snapGuide.guideX, 0);
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, rect.height);
    ctx.stroke();
  }
  if (snapGuide.guideY !== null && snapGuide.guideY !== undefined) {
    const [, sy] = worldToScreen(0, snapGuide.guideY);
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(rect.width, sy);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const [px, py] = worldToScreen(snapGuide.x, snapGuide.y);
  ctx.fillStyle = "#3a5f7a";
  ctx.beginPath();
  ctx.arc(px, py, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** The property line and, once derived or drawn, the building line - both
 * closed polygons, drawn under everything else the plan can hold since they
 * describe the site, not the building. */
function drawSiteLines() {
  const site = store.doc.site;
  if (!site) return;
  if (site.propertyLine) drawPolyOutline(shapePolygon(site.propertyLine), COLOUR.propertyLine, true);
  if (site.buildingLine) drawPolyOutline(shapePolygon(site.buildingLine), COLOUR.buildingLine, true);
}

/** Live preview while drawing a property line: the vertices placed so far,
 * plus a rubber-band segment out to the cursor, echoing drawBeamStart's dot
 * but for an open polyline rather than a single point. */
function drawPropertyDraft() {
  ctx.save();
  ctx.strokeStyle = COLOUR.propertyLine;
  ctx.fillStyle = COLOUR.propertyLine;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  siteDraft.forEach(({ x, y }, i) => {
    const [sx, sy] = worldToScreen(x, y);
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  if (hoverPoint) {
    const [hx, hy] = worldToScreen(hoverPoint.x, hoverPoint.y);
    ctx.lineTo(hx, hy);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  for (const { x, y } of siteDraft) {
    const [sx, sy] = worldToScreen(x, y);
    ctx.beginPath();
    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** The plan point picked for the SG reference, before the erf/coordinate
 * fields in the panel are confirmed. */
function drawSgPick() {
  const [sx, sy] = worldToScreen(sgPick.x, sgPick.y);
  ctx.save();
  ctx.strokeStyle = "#8d3416";
  ctx.fillStyle = "#8d3416";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(sx - 7, sy);
  ctx.lineTo(sx + 7, sy);
  ctx.moveTo(sx, sy - 7);
  ctx.lineTo(sx, sy + 7);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(sx, sy, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBeamStart() {
  const [sx, sy] = worldToScreen(beamStart.x, beamStart.y);
  ctx.save();
  ctx.fillStyle = "#8d3416";
  ctx.beginPath();
  ctx.arc(sx, sy, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function objByRef(ref) {
  const list = collectionFor(store.doc, ref.kind);
  return list?.find((row) => row.id === ref.id) || null;
}

// --- marquee -------------------------------------------------------------

function marqueeBox(x0, y0, x1, y1) {
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    w: Math.abs(x1 - x0),
    h: Math.abs(y1 - y0),
    crossing: x1 < x0,
  };
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function rectContains(outer, inner) {
  return inner.x >= outer.x - 1e-6 && inner.y >= outer.y - 1e-6
    && inner.x + inner.w <= outer.x + outer.w + 1e-6
    && inner.y + inner.h <= outer.y + outer.h + 1e-6;
}

function refsInMarquee(box) {
  if (box.w < GRID / 2 && box.h < GRID / 2) return [];
  const test = (b) => (box.crossing ? rectsOverlap(box, b) : rectContains(box, b));
  const hits = [];
  for (const room of store.doc.rooms.filter(onActiveLevel)) {
    if (test(bbox(roomPolygon(room)))) hits.push({ kind: "room", id: room.id });
  }
  for (const slab of store.doc.slabs.filter(onActiveLevel)) {
    if (test(bbox(shapePolygon(slab.shape)))) hits.push({ kind: "slab", id: slab.id });
  }
  for (const roof of store.doc.roofs.filter(onActiveLevel)) {
    if (test(bbox(shapePolygon(roof.shape)))) hits.push({ kind: "roof", id: roof.id });
  }
  for (const seg of store.doc.segments.filter(onActiveLevel)) {
    const segBox = { x: Math.min(seg.x1, seg.x2), y: Math.min(seg.y1, seg.y2), w: Math.max(0.02, Math.abs(seg.x2 - seg.x1)), h: Math.max(0.02, Math.abs(seg.y2 - seg.y1)) };
    if (test(segBox)) hits.push({ kind: "segment", id: seg.id });
  }
  for (const beam of store.doc.beams.filter(onActiveLevel)) {
    const beamBox = { x: Math.min(beam.x1, beam.x2), y: Math.min(beam.y1, beam.y2), w: Math.max(0.02, Math.abs(beam.x2 - beam.x1)), h: Math.max(0.02, Math.abs(beam.y2 - beam.y1)) };
    if (test(beamBox)) hits.push({ kind: "beam", id: beam.id });
  }
  for (const item of store.doc.items.filter(onActiveLevel)) {
    const sku = skuById(item.sku);
    if (sku && test(itemRect(item, sku))) hits.push({ kind: "item", id: item.id });
  }
  for (const opening of store.doc.openings) {
    const wall = wallForOpening(store.doc, pack, wallsCache, opening);
    if (!wall || wall.level !== activeLevel) continue;
    const [px, py] = anchorPoint(opening, wall);
    if (px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h) {
      hits.push({ kind: "opening", id: opening.id });
    }
  }
  return hits;
}

// --- underlay hit testing ---------------------------------------------

/** A hidden sheet is not drawn and must not steal clicks either. */
function underlayIsVisible() {
  return Boolean(store.doc.underlay && underlayBitmap() && !store.doc.underlay.hidden);
}

/** True if the point falls inside the placed (and possibly rotated) sheet. */
function hitUnderlay(wx, wy) {
  if (!underlayIsVisible()) return false;
  const corners = underlayCorners(store.doc);
  if (!corners) return false;
  return pointInPoly(wx, wy, corners.map((c) => [c.x, c.y]));
}

function underlayCentreWorld() {
  const corners = underlayCorners(store.doc);
  if (!corners) return null;
  return { x: (corners[0].x + corners[2].x) / 2, y: (corners[0].y + corners[2].y) / 2 };
}

/**
 * The rotate handle sits a fixed screen distance above the top edge's
 * midpoint, so it stays reachable regardless of the sheet's real-world size
 * or the current zoom.
 */
function underlayRotateHandlePoint(corners) {
  const centre = { x: (corners[0].x + corners[2].x) / 2, y: (corners[0].y + corners[2].y) / 2 };
  const topMid = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
  const dx = topMid.x - centre.x;
  const dy = topMid.y - centre.y;
  const len = Math.hypot(dx, dy) || 1;
  const extra = 24 / cam.scale;
  return { x: topMid.x + (dx / len) * extra, y: topMid.y + (dy / len) * extra };
}

/** Corner-scale or rotate handle under the pointer, only while the underlay is the active selection. */
function underlayHandleHit(wx, wy) {
  if (!underlaySelected || !underlayIsVisible()) return null;
  const corners = underlayCorners(store.doc);
  if (!corners) return null;
  const tol = (HANDLE / 2 + 4) / cam.scale;
  for (let i = 0; i < corners.length; i += 1) {
    if (Math.hypot(corners[i].x - wx, corners[i].y - wy) <= tol) {
      return { kind: "underlay-scale", corner: i };
    }
  }
  const rotHandle = underlayRotateHandlePoint(corners);
  if (Math.hypot(rotHandle.x - wx, rotHandle.y - wy) <= tol) {
    return { kind: "underlay-rotate" };
  }
  return null;
}

// --- hit testing -----------------------------------------------------------

function hitTest(wx, wy) {
  const pxTol = 6 / cam.scale;

  const items = store.doc.items.filter(onActiveLevel);
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    const sku = skuById(item.sku);
    if (!sku) continue;
    const box = itemRect(item, sku);
    if (wx >= box.x - pxTol && wx <= box.x + box.w + pxTol && wy >= box.y - pxTol && wy <= box.y + box.h + pxTol) {
      return { kind: "item", id: item.id };
    }
  }
  for (let i = store.doc.openings.length - 1; i >= 0; i -= 1) {
    const opening = store.doc.openings[i];
    const wall = wallForOpening(store.doc, pack, wallsCache, opening);
    if (!wall || wall.level !== activeLevel) continue;
    const [px, py] = anchorPoint(opening, wall);
    if (Math.hypot(px - wx, py - wy) < 0.3) return { kind: "opening", id: opening.id };
  }
  const beams = store.doc.beams.filter(onActiveLevel);
  for (let i = beams.length - 1; i >= 0; i -= 1) {
    const beam = beams[i];
    const sku = skuById(beam.sku);
    const tol = Math.max(0.15, (sku?.geometry?.width || 0.11) / 2 + 0.05);
    if (distToSeg(beam.x1, beam.y1, beam.x2, beam.y2, wx, wy) < tol) return { kind: "beam", id: beam.id };
  }
  const segments = store.doc.segments.filter(onActiveLevel);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const seg = segments[i];
    const sku = skuById(seg.sku);
    const tol = Math.max(0.18, (sku?.geometry?.thickness || sku?.geometry?.width || 0.22) / 2 + 0.08);
    if (distToSeg(seg.x1, seg.y1, seg.x2, seg.y2, wx, wy) < tol) return { kind: "segment", id: seg.id };
  }
  const slabs = store.doc.slabs.filter(onActiveLevel);
  for (let i = slabs.length - 1; i >= 0; i -= 1) {
    const slab = slabs[i];
    if (pointInPoly(wx, wy, shapePolygon(slab.shape))) return { kind: "slab", id: slab.id };
  }
  // Rooms before roofs: a roof typically envelopes the whole footprint, so
  // without this a click anywhere inside the building would always hit the
  // roof instead of the room underneath it.
  const rooms = store.doc.rooms.filter(onActiveLevel);
  for (let i = rooms.length - 1; i >= 0; i -= 1) {
    const room = rooms[i];
    if (pointInPoly(wx, wy, roomPolygon(room))) return { kind: "room", id: room.id };
  }
  const roofs = store.doc.roofs.filter(onActiveLevel);
  for (let i = roofs.length - 1; i >= 0; i -= 1) {
    const roof = roofs[i];
    if (pointInPoly(wx, wy, shapePolygon(roof.shape))) return { kind: "roof", id: roof.id };
  }
  return null;
}

// --- palette ---------------------------------------------------------------

const CATEGORY_LABEL = {
  wall: "Walls", boundarywall: "Boundary walls", foundation: "Foundations", floor: "Floors",
  ceiling: "Ceilings", roof: "Roofs", door: "Doors", window: "Windows", beam: "Beams",
  column: "Columns", stair: "Stairs", sanitary: "Sanitary", waterheater: "Water heating",
  drainage: "Drainage", electrical: "Electrical", furniture: "Furniture", casework: "Casework",
  pool: "Pool", carport: "Carport",
};

function skuDimLabel(sku) {
  const g = sku.geometry || {};
  if (g.width && g.height && (sku.category === "door" || sku.category === "window")) {
    return `${Math.round(g.width * 1000)} × ${Math.round(g.height * 1000)} mm`;
  }
  if (g.thickness) return `${Math.round(g.thickness * 1000)} mm`;
  if (g.width) return `${Math.round(g.width * 1000)} mm`;
  return sku.unit;
}

function renderPalette() {
  const q = (el.search.value || "").trim().toLowerCase();
  el.paletteTitle.textContent = q || !lastPaletteLabel ? "Types" : lastPaletteLabel;
  if (!q && !paletteFilter) {
    el.skuList.innerHTML = `<p class="hint palette-idle">Pick Walls, Doors or another tool on the ribbon to see types.</p>`;
    return;
  }
  const groups = new Map();
  for (const sku of pack.skus) {
    // A search term reaches every type; browsing stays inside the last
    // ribbon function, so 64 electrical points never bury 3 wall types.
    if (!q && paletteFilter && !paletteFilter.includes(sku.category)) continue;
    const hay = `${sku.id} ${sku.name} ${sku.category}`.toLowerCase();
    if (q && !hay.includes(q)) continue;
    if (!groups.has(sku.category)) groups.set(sku.category, []);
    groups.get(sku.category).push(sku);
  }
  el.skuList.innerHTML = "";
  if (!groups.size) {
    el.skuList.innerHTML = `<p class="hint palette-idle">No types match.</p>`;
    return;
  }
  for (const [cat, skus] of groups) {
    const wrap = document.createElement("div");
    wrap.className = "planner-sku-group";
    wrap.innerHTML = `<h3>${escapeHtml(CATEGORY_LABEL[cat] || cat)}</h3>`;
    for (const sku of skus) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sku-item";
      if (placeSkuId === sku.id) btn.classList.add("active");
      btn.innerHTML = `<span class="sku-name">${escapeHtml(sku.name)}</span><span class="sku-meta">${escapeHtml(sku.id)} · ${escapeHtml(skuDimLabel(sku))}</span>`;
      btn.addEventListener("click", () => onSkuClick(sku));
      wrap.appendChild(btn);
    }
    el.skuList.appendChild(wrap);
  }
}

function onSkuClick(sku) {
  if (applySkuToSelection(sku)) {
    render();
    return;
  }
  placeSkuId = sku.id;
  beamStart = null;
  if (sku.category === "wall" || sku.category === "foundation" || sku.category === "boundarywall") {
    tool = "wall";
  } else if (sku.category === "floor" || sku.category === "pool") {
    tool = "slab";
  } else if (sku.category === "roof" || sku.category === "carport") {
    tool = "roof";
  } else if (sku.category === "door" || sku.category === "window") {
    tool = sku.category;
  } else if (sku.category === "beam" || sku.category === "column") {
    tool = "beam";
  } else {
    tool = "place";
  }
  syncToolButtons();
  renderPalette();
  updateRibbonHint();
  render();
}

/** Retype an already-selected object from the palette, v1's applySkuToSelection. */
function applySkuToSelection(sku) {
  if (store.selected.length !== 1) return false;
  const ref = store.primary;
  const obj = objByRef(ref);
  if (!obj) return false;

  if (ref.kind === "room") {
    if (sku.category === "wall" || sku.category === "boundarywall") { store.pushUndo(); obj.wallSku = sku.id; }
    else if (sku.category === "floor") { store.pushUndo(); obj.floorSku = sku.id; }
    else return false;
  } else if (ref.kind === "slab" && (sku.category === "floor" || sku.category === "pool")) {
    store.pushUndo(); obj.sku = sku.id;
  } else if (ref.kind === "roof" && (sku.category === "roof" || sku.category === "carport")) {
    store.pushUndo(); obj.sku = sku.id;
  } else if (ref.kind === "segment" && (sku.category === "wall" || sku.category === "foundation" || sku.category === "boundarywall")) {
    store.pushUndo(); obj.sku = sku.id;
  } else if (ref.kind === "opening" && skuById(obj.sku)?.category === sku.category) {
    store.pushUndo(); obj.sku = sku.id;
  } else if (ref.kind === "item" && skuById(obj.sku)?.category === sku.category) {
    store.pushUndo(); obj.sku = sku.id;
  } else if (ref.kind === "beam" && (sku.category === "beam" || sku.category === "column")) {
    store.pushUndo(); obj.sku = sku.id;
  } else {
    return false;
  }
  store.persist();
  return true;
}

el.search.addEventListener("input", renderPalette);

// --- compliance rule engine -------------------------------------------------

const PART_LABEL = { C: "Part C dimensions", O: "Part O light & vent", M: "Part M stairs", Zoning: "Zoning & setbacks" };
const SEVERITY_LABEL = { pass: "Pass", fail: "Fail", advisory: "Advisory", unknown: "Cannot check" };

/** Re-run the Week 2 rule engine against the current document and render it
 * into the Check panel. Called each time Check opens, since findings depend
 * on the drawn document (rooms, openings, stairs), not just the static pack
 * that renderGapReport() covers. */
function renderRulesReport() {
  if (!el.rules) return;
  const findings = evaluateCompliance(store.doc, pack);
  const counts = summarizeFindings(findings);
  el.rulesCount.textContent = findings.length
    ? `${counts.fail} fail · ${counts.unknown} cannot check · ${counts.advisory} advisory · ${counts.pass} pass`
    : "Nothing to check yet";
  if (!findings.length) {
    el.rules.innerHTML = '<p class="hint">Draw a room, opening or stair, then reopen Check.</p>';
    return;
  }
  const byPart = groupFindingsByPart(findings);
  el.rules.innerHTML = [...byPart.entries()].map(([part, list]) => `
    <div class="rules-part">
      <h3>${escapeHtml(PART_LABEL[part] || part)}</h3>
      ${list.map((f) => `
        <div class="rule-row rule-${f.severity}">
          <span class="rule-badge">${escapeHtml(SEVERITY_LABEL[f.severity])}</span>
          <span class="rule-message">${escapeHtml(f.message)}</span>
        </div>
      `).join("")}
    </div>
  `).join("");
}

// --- gap report ------------------------------------------------------------

function renderGapReport() {
  const gaps = complianceGaps(pack);
  const total = gaps.reduce((s, g) => s + g.missing.length, 0);
  el.gapCount.textContent = total ? `${total} unknown` : "Complete";
  if (!gaps.length) {
    el.gaps.innerHTML = '<p class="hint">Every compliance fact in this pack is known.</p>';
    return;
  }
  el.gaps.innerHTML = `<p class="hint">Facts the firm has not supplied yet. The compliance engine above treats these as "cannot check", not a pass.</p>${
    gaps.map((g) => `<div class="gap-row"><span>${escapeHtml(g.id)}</span><span class="gap-missing">${escapeHtml(g.missing.join(", "))}</span></div>`).join("")
  }`;
}

// --- ribbon ------------------------------------------------------------

function skuCount(categories) {
  return pack.skus.filter((s) => categories.includes(s.category)).length;
}

function drawRibbon() {
  renderRibbon(el.ribbonTabs, el.ribbonFunctions, {
    mode: density,
    activeTab,
    activeFunction,
    skuCount,
    commandState: ribbonCommandState,
    hasSelection: () => store.selected.length > 0,
    sheetLoaded: () => Boolean(store.doc.underlay),
    onTab: (id) => {
      activeTab = id;
      if (id === "check") openCheck();
      drawRibbon();
    },
    onFunction: onRibbonFunction,
  });
  decorateRibbon(el.ribbonFunctions);
  // Measuring box widths needs layout, which is not settled until the
  // browser has painted this render, so the fit runs a frame later.
  requestAnimationFrame(() => fitRibbon(el.ribbonFunctions));
  updateRibbonHint();
}

/** Next-step hint overlaid on the canvas, shown once a tool is armed
 * (a category/tool function is active). One-shot commands (rotate,
 * compile, ...) already surface their own feedback, so they do not set this.
 *
 * Overridden by a warning when the armed tool would place something on the
 * active level's foundation storey (a roof, room, ceiling, opening... on
 * "00 FOUNDATION" is never right - see `foundationLevelMismatch`). This only
 * flags the one thing the app can rule out; it never guesses which of the
 * remaining levels the object actually belongs on, and it never moves the
 * level switcher itself - the user stays in control of the cut. */
function updateRibbonHint() {
  if (!el.ribbonHint) return;
  if (foundationLevelMismatch()) {
    const level = (pack.levels || []).find((l) => l.id === activeLevel);
    el.ribbonHint.hidden = false;
    el.ribbonHint.classList.add("ribbon-hint-warn");
    el.ribbonHint.textContent = `The level switcher is on "${level?.name || activeLevel}", a foundation storey. Switch levels before placing this here.`;
    return;
  }
  el.ribbonHint.classList.remove("ribbon-hint-warn");
  const hint = activeFunction && HINTS[activeFunction];
  el.ribbonHint.hidden = !hint;
  el.ribbonHint.textContent = hint || "";
}

function setDensity(next) {
  if (next !== "simple" && next !== "full") return;
  density = next;
  window.localStorage.setItem("v2-density", density);
  activeTab = firstTabId(density);
  drawRibbon();
}

/** Hide/show and scale live on the ribbon, so those buttons reflect whether a sheet is loaded, visible, or currently being calibrated. */
function ribbonCommandState(item) {
  if (item.id === "level-isolate") {
    const below = lookDownLevelId(pack?.levels, activeLevel);
    return {
      active: isolateCurrentLevel,
      title: isolateCurrentLevel
        ? "Showing this storey only. Click to ghost the floor below."
        : below
          ? "Ghosting the floor below. Click to show this storey only."
          : "Nothing below this cut to ghost. Click to keep this storey only.",
    };
  }
  const ids = new Set(["underlay-adjust", "calibrate", "underlay-toggle", "underlay-off"]);
  if (!ids.has(item.id)) return null;
  const loaded = Boolean(store.doc.underlay);
  if (!loaded) return { disabled: true, title: "Load a PDF or image first." };
  const hidden = Boolean(store.doc.underlay.hidden);
  if (item.id === "underlay-toggle") {
    return {
      label: hidden ? "Show" : "Hide",
      title: hidden ? "Show the underlay" : "Hide the underlay without removing it",
    };
  }
  if (item.id === "underlay-adjust") {
    return {
      active: underlaySelected && tool === "select",
      disabled: hidden,
      title: hidden ? "Show the underlay first." : "Move, rotate or drag a corner to resize.",
    };
  }
  if (item.id === "calibrate") {
    return {
      active: tool === "calibrate",
      title: "Click two points and enter the real distance between them.",
    };
  }
  return null;
}

function onRibbonFunction(item) {
  if (item.command) {
    runCommand(item.command);
    return;
  }
  activeFunction = item.id;
  paletteFilter = item.categories || null;
  lastPaletteLabel = item.categories ? item.label : lastPaletteLabel;
  tool = item.tool || "select";
  placeSkuId = pack.skus.find((s) => (item.categories || []).includes(s.category))?.id ?? null;
  beamStart = null;
  underlaySelected = false;
  syncToolButtons();
  drawRibbon();
  renderPalette();
  render();
}

/** One entry point so the ribbon, the keyboard and the header buttons agree. */
function runCommand(name) {
  switch (name) {
    case "undo": store.undo(); break;
    case "group": store.groupSelection(); store.persist(); break;
    case "ungroup": store.ungroupSelection(); store.persist(); break;
    case "delete": deleteSelection(); break;
    case "compile": runCompile(); return;
    case "gaps": case "check":
      activeTab = "check";
      drawRibbon();
      openCheck();
      return;
    case "view-3d": openMassing(); return;
    case "sheets": openSheets(); return;
    case "underlay": openUnderlayPicker(); return;
    case "underlay-adjust": startUnderlayAdjust(); return;
    case "calibrate": startCalibration(); return;
    case "underlay-toggle": toggleUnderlayVisibility(); return;
    case "level-isolate":
      isolateCurrentLevel = !isolateCurrentLevel;
      window.localStorage.setItem("v2-level-isolate", isolateCurrentLevel ? "1" : "0");
      drawRibbon();
      render();
      return;
    case "underlay-off": removeUnderlay(); return;
    case "property-line": startPropertyLineDraw(); return;
    case "sg-coords": startSgPick(); return;
    case "building-line": runAutoBuildingLine(); return;
    case "dimensions":
      showDimensions = !showDimensions;
      activeFunction = showDimensions ? "dimensions" : null;
      drawRibbon();
      break;
    case "rotate": case "mirror": case "copy": case "align":
    case "merge": case "split": case "cut": case "join":
      modifySelection(name);
      break;
    default: return;
  }
  render();
}

const MODIFY_OPS = {
  rotate: rotateSelection,
  mirror: mirrorSelection,
  copy: copySelection,
  align: alignSelection,
  merge: mergeSelection,
  split: splitSelection,
  cut: cutSelection,
  join: joinSelection,
};

/**
 * Modify operations are all-or-nothing: a refusal must leave the document and
 * the undo stack untouched, so the snapshot is taken first and popped back if
 * the operation declines.
 */
function modifySelection(op) {
  const run = MODIFY_OPS[op];
  if (!run) return;
  store.pushUndo();
  const result = run(store.doc, store.selected, { anchorRef: store.primary });
  if (!result.ok) {
    store.undoStack.pop();
    setStatusMessage(result.message, "warn");
    return;
  }
  if (result.refs) store.setSelection(result.refs, result.refs[0]);
  else store.setSelection(store.selected, store.primary);
  store.persist();
  setStatusMessage(result.message, "ok");
}

// --- 3D massing ----------------------------------------------------------

function openMassing() {
  massView.setPayload(compile(store.doc, pack));
  el.massOverlay.hidden = false;
  requestAnimationFrame(() => massView.resize());
}

function closeMassing() {
  el.massOverlay.hidden = true;
}

function wireMassing() {
  el.massClose.addEventListener("click", closeMassing);
  el.massOverlay.addEventListener("click", (event) => {
    if (event.target === el.massOverlay) closeMassing();
  });
  document.querySelectorAll("[data-mass-status]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-mass-status]").forEach((b) => b.classList.toggle("active", b === btn));
      massView.setStatusFilter(btn.dataset.massStatus || "both");
    });
  });
  new ResizeObserver(() => massView.resize()).observe(el.massCanvas);
}

// --- sheets ---------------------------------------------------------------
//
// Output > Print > Sheets. sheets.js owns the title block data (paper size,
// scale, revisions); this section is only the panel that lists a document's
// sheets, edits the active one's fields, and draws it. The drawn plan is a
// schematic - wall centrelines and room outlines only, no openings, no
// dimensions, no per-level split - because the point of this panel is the
// title block, and a full drafted plan view is `view-section`'s and
// `callout`'s job once they land.

function activeSheet() {
  return activeSheetId ? sheetById(store.doc, activeSheetId) : null;
}

function openSheets() {
  ensureSheets(store.doc);
  if (!activeSheet() && store.doc.sheets.length) activeSheetId = store.doc.sheets[0].id;
  el.sheetOverlay.hidden = false;
  renderSheets();
  requestAnimationFrame(drawActiveSheet);
}

function closeSheets() {
  el.sheetOverlay.hidden = true;
}

function renderSheetList() {
  const sheets = ensureSheets(store.doc);
  el.sheetList.innerHTML = sheets.map((s) => `
    <button type="button" class="sheet-list-item${s.id === activeSheetId ? " active" : ""}" data-sheet-id="${escapeHtml(s.id)}">
      <strong>${escapeHtml(s.number)}</strong>
      <span>${escapeHtml(s.name)} · ${escapeHtml(s.size)}</span>
    </button>
  `).join("") || '<p class="hint">No sheets yet.</p>';
  el.sheetList.querySelectorAll("[data-sheet-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeSheetId = btn.dataset.sheetId;
      renderSheets();
      drawActiveSheet();
    });
  });
}

function renderSheetFields() {
  const sheet = activeSheet();
  const has = Boolean(sheet);
  el.sheetFields.hidden = !has;
  if (el.sheetEmptyFields) el.sheetEmptyFields.hidden = has;
  el.sheetDelete.hidden = !has;
  if (!has) return;

  if (!el.sheetSize.options.length) {
    el.sheetSize.innerHTML = SHEET_SIZES.map((s) => `<option value="${s}">${s}</option>`).join("");
  }
  if (!el.sheetScale.options.length) {
    el.sheetScale.innerHTML = `<option value="">Auto (fits the plan)</option>${
      STANDARD_SCALES.map((n) => `<option value="${n}">1:${n}</option>`).join("")
    }`;
  }
  el.sheetSize.value = sheet.size;
  el.sheetTitle.value = sheet.drawingTitle || "";
  el.sheetScale.value = sheet.scaleOverride || "";
  el.sheetDate.value = sheet.date || "";
  el.sheetDrawn.value = sheet.drawnBy || "";
  el.sheetChecked.value = sheet.checkedBy || "";

  el.sheetRevList.innerHTML = (sheet.revisions || []).length
    ? sheet.revisions.map((r) => `
        <div class="sheet-rev-row">
          <span class="sheet-rev-letter">${escapeHtml(r.rev)}</span>
          <span>${escapeHtml(r.description || "—")}</span>
          <span class="sheet-rev-date">${escapeHtml(r.date)}${r.by ? ` · ${escapeHtml(r.by)}` : ""}</span>
        </div>
      `).join("")
    : '<p class="hint">No revisions issued yet.</p>';
}

function renderSheets() {
  renderSheetList();
  renderSheetFields();
}

/** Bounding box of every plan point compile() emits, ignoring elevation -
 * the sheet draws one schematic plan, not a per-level split. Returns null
 * for an empty document so the caller can fall back rather than divide by
 * a zero extent. */
function planExtentFromPayload(payload) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const form of payload?.sketchForms || []) {
    for (const loop of form.profileLoops || []) {
      for (const curve of loop.curves || []) {
        for (const pt of [curve.start, curve.end]) {
          if (!pt) continue;
          minX = Math.min(minX, pt[0]); maxX = Math.max(maxX, pt[0]);
          minY = Math.min(minY, pt[1]); maxY = Math.max(maxY, pt[1]);
        }
      }
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function drawActiveSheet() {
  const canvas = el.sheetCanvas;
  if (!canvas) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const sheet = activeSheet();
  if (el.sheetEmpty) el.sheetEmpty.hidden = Boolean(sheet);
  if (!width || !height || !sheet) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  const sctx = canvas.getContext("2d");
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  sctx.clearRect(0, 0, width, height);

  const layout = titleBlockLayout(sheet.size);
  const pxPerMm = Math.min(width / layout.paper.w, height / layout.paper.h) * 0.94;
  const offX = (width - layout.paper.w * pxPerMm) / 2;
  const offY = (height - layout.paper.h * pxPerMm) / 2;
  const mm = (v) => v * pxPerMm;

  sctx.fillStyle = "#fdfaf3";
  sctx.fillRect(offX, offY, mm(layout.paper.w), mm(layout.paper.h));
  sctx.strokeStyle = "#1a1612";
  sctx.lineWidth = 1.5;
  sctx.strokeRect(offX, offY, mm(layout.paper.w), mm(layout.paper.h));
  sctx.lineWidth = 1;
  const innerW = layout.paper.w - layout.border * 2;
  const innerH = layout.paper.h - layout.border * 2;
  sctx.strokeRect(offX + mm(layout.border), offY + mm(layout.border), mm(innerW), mm(innerH));

  const tbX = offX + mm(layout.paper.w - layout.border - layout.titleBlockWidth);
  const tbW = mm(layout.titleBlockWidth);
  const tbY = offY + mm(layout.border);
  const tbH = mm(innerH);
  sctx.strokeRect(tbX, tbY, tbW, tbH);

  const payload = compile(store.doc, pack) || { sketchForms: [] };
  const extent = planExtentFromPayload(payload);
  const fields = titleBlockFields(store.doc, pack, sheet, extent ? { w: extent.w, h: extent.h } : null);

  const rowH = tbH / layout.rows.length;
  sctx.textBaseline = "middle";
  layout.rows.forEach((row, i) => {
    const y = tbY + rowH * i;
    sctx.strokeStyle = "#8a7d6c";
    sctx.beginPath();
    sctx.moveTo(tbX, y);
    sctx.lineTo(tbX + tbW, y);
    sctx.stroke();
    sctx.font = `${Math.max(8, rowH * 0.24)}px "Source Sans 3", sans-serif`;
    sctx.fillStyle = "#8a7d6c";
    sctx.fillText(row.label, tbX + 5, y + rowH * 0.28);
    sctx.font = `600 ${Math.max(9, rowH * 0.3)}px "Source Sans 3", sans-serif`;
    sctx.fillStyle = "#1a1612";
    sctx.fillText(String(fields[row.key] ?? "—"), tbX + 5, y + rowH * 0.66, tbW - 10);
  });

  if (!extent || extent.w <= 0 || extent.h <= 0) return;

  const areaX = offX + mm(layout.border);
  const areaY = offY + mm(layout.border);
  const areaW = mm(innerW - layout.titleBlockWidth);
  const areaH = mm(innerH);
  const scaleN = sheetScale(sheet, { w: extent.w, h: extent.h });
  const pxPerM = pxPerMm * (1000 / scaleN);
  const midX = (extent.minX + extent.maxX) / 2;
  const midY = (extent.minY + extent.maxY) / 2;
  const cx = areaX + areaW / 2;
  const cy = areaY + areaH / 2;
  const project = (x, y) => [cx + (x - midX) * pxPerM, cy + (y - midY) * pxPerM];

  sctx.save();
  sctx.beginPath();
  sctx.rect(areaX, areaY, areaW, areaH);
  sctx.clip();
  for (const form of payload.sketchForms || []) {
    const kind = (form.kind || "").toLowerCase();
    if (kind === "room") {
      for (const loop of form.profileLoops || []) {
        const pts = (loop.curves || []).map((c) => c.start).filter(Boolean).map(([x, y]) => project(x, y));
        if (pts.length < 3) continue;
        sctx.beginPath();
        pts.forEach((p, i) => (i ? sctx.lineTo(p[0], p[1]) : sctx.moveTo(p[0], p[1])));
        sctx.closePath();
        sctx.fillStyle = "rgba(178,69,30,0.08)";
        sctx.fill();
      }
    } else if (kind === "wall") {
      for (const loop of form.profileLoops || []) {
        for (const curve of loop.curves || []) {
          if (!curve.start || !curve.end) continue;
          const a = project(curve.start[0], curve.start[1]);
          const b = project(curve.end[0], curve.end[1]);
          sctx.beginPath();
          sctx.moveTo(a[0], a[1]);
          sctx.lineTo(b[0], b[1]);
          sctx.strokeStyle = "#1a1612";
          sctx.lineWidth = Math.max(1, (form.thickness || 0.22) * pxPerM);
          sctx.lineCap = "square";
          sctx.stroke();
        }
      }
    }
  }
  sctx.restore();
}

function wireSheets() {
  el.sheetClose?.addEventListener("click", closeSheets);
  el.sheetOverlay?.addEventListener("click", (event) => {
    if (event.target === el.sheetOverlay) closeSheets();
  });
  el.sheetAdd?.addEventListener("click", () => {
    const { sheet } = createSheet(store.doc, { size: "A1" });
    activeSheetId = sheet.id;
    store.persist();
    renderSheets();
    drawActiveSheet();
  });
  el.sheetDelete?.addEventListener("click", () => {
    const sheet = activeSheet();
    if (!sheet) return;
    removeSheet(store.doc, sheet.id);
    activeSheetId = store.doc.sheets[0]?.id || null;
    store.persist();
    renderSheets();
    drawActiveSheet();
  });
  const field = (input, apply) => {
    input?.addEventListener("change", () => {
      const sheet = activeSheet();
      if (!sheet) return;
      apply(sheet, input.value);
      store.persist();
      renderSheetList();
      drawActiveSheet();
    });
  };
  field(el.sheetSize, (sheet, value) => { sheet.size = value; });
  field(el.sheetTitle, (sheet, value) => { sheet.drawingTitle = value; });
  field(el.sheetScale, (sheet, value) => { sheet.scaleOverride = value ? Number(value) : null; });
  field(el.sheetDate, (sheet, value) => { sheet.date = value; });
  field(el.sheetDrawn, (sheet, value) => { sheet.drawnBy = value; });
  field(el.sheetChecked, (sheet, value) => { sheet.checkedBy = value; });
  el.sheetRevAdd?.addEventListener("click", () => {
    const sheet = activeSheet();
    if (!sheet) return;
    const description = el.sheetRevDesc.value.trim();
    if (!description) return;
    addRevision(sheet, { description });
    el.sheetRevDesc.value = "";
    store.persist();
    renderSheetFields();
    drawActiveSheet();
  });
  new ResizeObserver(drawActiveSheet).observe(el.sheetCanvas);
}

function openCheck() {
  if (el.checkOverlay) el.checkOverlay.hidden = false;
  renderRulesReport();
}

function closeCheck() {
  if (el.checkOverlay) el.checkOverlay.hidden = true;
}

function wireCheck() {
  el.checkClose?.addEventListener("click", closeCheck);
  el.checkOverlay?.addEventListener("click", (event) => {
    if (event.target === el.checkOverlay) closeCheck();
  });
}

// --- underlay -----------------------------------------------------------

let calibration = null;

function openUnderlayPicker() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/pdf,image/*";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    setStatusMessage(`Reading ${file.name}…`, "ok");
    const result = await loadUnderlayFile(store.doc, file);
    setStatusMessage(result.message, result.ok ? "ok" : "warn");
    if (result.ok) {
      store.persist();
      drawRibbon();
      startCalibration();
    }
    render();
  });
  input.click();
}

function startCalibration() {
  if (!store.doc.underlay) {
    setStatusMessage("Load an underlay first.", "warn");
    return;
  }
  if (store.doc.underlay.hidden) {
    store.doc.underlay.hidden = false;
    store.persist();
  }
  calibration = { a: null, b: null };
  tool = "calibrate";
  underlaySelected = false;
  store.clearSelection();
  syncToolButtons();
  drawRibbon();
  setStatusMessage("Click two points a known distance apart, then enter the real length.", "ok");
  render();
}

function startUnderlayAdjust() {
  if (!store.doc.underlay) {
    setStatusMessage("Load an underlay first.", "warn");
    return;
  }
  if (store.doc.underlay.hidden) {
    setStatusMessage("Show the underlay first.", "warn");
    return;
  }
  calibration = null;
  tool = "select";
  underlaySelected = true;
  store.clearSelection();
  syncToolButtons();
  drawRibbon();
  setStatusMessage("Drag a corner to resize, the top handle to rotate, or the sheet to move it.", "ok");
  render();
}

/** The distance calibration would report right now, using the (probably wrong) current scale - a starting guess for the field, and what the live label shows while the second point is still being placed. */
function calibrationDistanceGuess(a, b) {
  if (!store.doc.underlay || !a || !b) return null;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Second half of calibration: both points are down, so show the real-distance field instead of blocking on window.prompt. */
function promptCalibrationDistance() {
  const guess = calibrationDistanceGuess(calibration.a, calibration.b);
  if (el.calibrateDistance) el.calibrateDistance.value = guess ? guess.toFixed(2) : "";
  render();
  requestAnimationFrame(() => el.calibrateDistance?.focus());
}

function confirmCalibration() {
  if (!calibration?.a || !calibration?.b) return;
  const result = calibrate(store.doc, calibration.a, calibration.b, Number(el.calibrateDistance?.value));
  setStatusMessage(result.message, result.ok ? "ok" : "warn");
  if (result.ok) {
    calibration = null;
    tool = "select";
    underlaySelected = true;
    store.persist();
    syncToolButtons();
    drawRibbon();
  }
  render();
}

function cancelCalibration() {
  if (tool !== "calibrate") return;
  calibration = null;
  tool = "select";
  syncToolButtons();
  drawRibbon();
  render();
}

// --- site: property line, SG reference, building line ---------------------

function startPropertyLineDraw() {
  siteDraft = [];
  tool = "property";
  underlaySelected = false;
  store.clearSelection();
  syncToolButtons();
  drawRibbon();
  setStatusMessage("Click each corner of the property boundary, then click the first point again (or press Enter) to close it.", "ok");
  render();
}

function finishPropertyLine() {
  if (!siteDraft || siteDraft.length < 3) {
    setStatusMessage("A property line needs at least 3 points.", "warn");
    return;
  }
  store.pushUndo();
  setPropertyLine(store.doc, siteDraft.map((p) => [p.x, p.y]));
  siteDraft = null;
  tool = "select";
  store.persist();
  syncToolButtons();
  drawRibbon();
  setStatusMessage("Property line set. Run Building line to derive the setback, or draw one by hand.", "ok");
  render();
}

function startSgPick() {
  sgPick = null;
  tool = "sg-ref";
  underlaySelected = false;
  store.clearSelection();
  syncToolButtons();
  drawRibbon();
  const existing = store.doc.site?.sgReference;
  if (el.sgErf) el.sgErf.value = store.doc.site?.erfNumber || "";
  if (el.sgX) el.sgX.value = existing ? String(existing.real[0]) : "";
  if (el.sgY) el.sgY.value = existing ? String(existing.real[1]) : "";
  setStatusMessage("Click the point on your drawing that matches a known SG diagram coordinate.", "ok");
  render();
}

function confirmSgReference() {
  if (!sgPick) return;
  const erfNumber = el.sgErf?.value.trim() || null;
  const x = Number(el.sgX?.value);
  const y = Number(el.sgY?.value);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    setStatusMessage("Enter numeric real-world X and Y coordinates.", "warn");
    return;
  }
  store.pushUndo();
  setSgReference(store.doc, { erfNumber, real: [x, y], plan: [sgPick.x, sgPick.y] });
  sgPick = null;
  tool = "select";
  store.persist();
  syncToolButtons();
  drawRibbon();
  setStatusMessage(erfNumber ? `SG reference set for erf ${erfNumber}.` : "SG reference set.", "ok");
  render();
}

function cancelSgReference() {
  if (tool !== "sg-ref") return;
  sgPick = null;
  tool = "select";
  syncToolButtons();
  drawRibbon();
  render();
}

/** Site > Building line: derive it from the property line and the rule
 * pack's setback for the pack's current municipality. A command, not a draw
 * tool - drawing one by hand is still possible by editing the document, but
 * there is no UI for that override yet (see SCHEMA.md's Week 2 note). */
function runAutoBuildingLine() {
  const result = deriveBuildingLine(store.doc, pack, RULE_PACK);
  if (!result.ok) {
    setStatusMessage(`Could not derive a building line: ${result.reason}.`, "warn");
    return;
  }
  store.pushUndo();
  setBuildingLine(store.doc, result.points, { derived: true });
  store.persist();
  setStatusMessage(`Building line set ${result.setback.toFixed(1)} m inside the property line.`, "ok");
  render();
}

function removeUnderlay() {
  clearUnderlay(store.doc);
  underlaySelected = false;
  if (tool === "calibrate") {
    calibration = null;
    tool = "select";
    syncToolButtons();
  }
  store.persist();
  setStatusMessage("Underlay removed.", "ok");
  drawRibbon();
  render();
}

function toggleUnderlayVisibility() {
  if (!store.doc.underlay) {
    setStatusMessage("Load an underlay first.", "warn");
    return;
  }
  toggleUnderlayHidden(store.doc);
  if (store.doc.underlay.hidden) {
    underlaySelected = false;
    if (tool === "calibrate") {
      calibration = null;
      tool = "select";
      syncToolButtons();
    }
  }
  store.persist();
  setStatusMessage(store.doc.underlay.hidden ? "Underlay hidden." : "Underlay shown.", "ok");
  drawRibbon();
  render();
}

let statusTimer = null;

function setStatusMessage(text, tone) {
  el.healthLabel.textContent = text;
  el.healthDot.classList.toggle("ok", tone !== "warn");
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    el.healthLabel.textContent = `${pack.skus.length} SKUs loaded`;
    el.healthDot.classList.add("ok");
  }, 4000);
}

// --- toolbar -----------------------------------------------------------

function syncToolButtons() {
  document.querySelectorAll("[data-tool]").forEach((btn) => btn.classList.toggle("active", btn.dataset.tool === tool));
}

function wireToolbar() {
  document.querySelectorAll("[data-tool]").forEach((btn) => {
    btn.addEventListener("click", () => {
      tool = btn.dataset.tool;
      if (tool !== "select") placeSkuId = placeSkuId || defaultSkuFor(tool);
      else if (activeFunction && activeFunction !== "dimensions") {
        // Stepping back to Select un-arms the draw tool so the next-step
        // hint does not keep pointing at it. The type list stays on the last
        // category so a selected wall can still be retyped.
        activeFunction = null;
        drawRibbon();
        renderPalette();
      }
      beamStart = null;
      siteDraft = null;
      sgPick = null;
      syncToolButtons();
      render();
    });
  });
  document.querySelectorAll("[data-status]").forEach((btn) => {
    btn.addEventListener("click", () => {
      placeStatus = btn.dataset.status;
      document.querySelectorAll("[data-status]").forEach((b) => b.classList.toggle("active", b === btn));
      if (store.selected.length) {
        store.pushUndo();
        for (const ref of store.selected) {
          const obj = objByRef(ref);
          if (obj) obj.status = placeStatus;
        }
        store.persist();
        render();
      }
    });
  });
  document.getElementById("v2-undo").addEventListener("click", () => runCommand("undo"));
  document.querySelectorAll("[data-density]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setDensity(btn.dataset.density);
      document.querySelectorAll("[data-density]").forEach((b) => b.classList.toggle("active", b === btn));
    });
  });
  el.hmRotate?.addEventListener("click", () => runCommand("rotate"));
  el.hmCopy?.addEventListener("click", () => runCommand("copy"));
  el.hmDelete?.addEventListener("click", () => runCommand("delete"));
  document.getElementById("v2-demo").addEventListener("click", loadDemo);
  document.getElementById("v2-clear").addEventListener("click", () => {
    store.pushUndo();
    clearUnderlay(store.doc);
    store.doc = emptyDoc();
    store.doc.packId = pack.id;
    store.clearSelection();
    underlaySelected = false;
    store.persist();
    render();
  });
  document.getElementById("v2-compile").addEventListener("click", runCompile);
  wireLevelWidget();
}

function defaultSkuFor(nextTool) {
  const map = { room: "floor", wall: "wall", slab: "floor", roof: "roof", door: "door", window: "window", beam: "beam" };
  const cat = map[nextTool];
  return cat ? pack.skus.find((s) => s.category === cat)?.id || null : null;
}

// --- pointer interaction -----------------------------------------------

function wireCanvas() {
  el.canvas.addEventListener("pointerdown", onPointerDown);
  el.canvas.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  el.canvas.addEventListener("wheel", onWheel, { passive: false });
  el.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
}

function onWheel(ev) {
  ev.preventDefault();
  const rect = el.canvas.getBoundingClientRect();
  const px = ev.clientX - rect.left;
  const py = ev.clientY - rect.top;
  const [wx, wy] = screenToWorld(px, py);
  const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
  cam.scale = Math.min(3000, Math.max(12, cam.scale * factor));
  const [nx, ny] = worldToScreen(wx, wy);
  cam.ox += px - nx;
  cam.oy += py - ny;
  render();
}

function onPointerDown(ev) {
  if (ev.button === 1 || ev.altKey) {
    drag = { kind: "pan", startX: ev.clientX, startY: ev.clientY, ox0: cam.ox, oy0: cam.oy };
    el.canvas.setPointerCapture(ev.pointerId);
    return;
  }
  const [wx, wy] = pointerWorld(ev);

  const handle = endpointHandleHit(wx, wy);
  if (handle && !ev.shiftKey) {
    const obj = objByRef({ kind: handle.target, id: handle.id });
    if (obj) {
      store.pushUndo();
      drag = {
        kind: "segment-end",
        id: handle.id,
        target: handle.target,
        end: handle.end,
        fx: handle.end === 1 ? obj.x2 : obj.x1,
        fy: handle.end === 1 ? obj.y2 : obj.y1,
        mx: handle.end === 1 ? obj.x1 : obj.x2,
        my: handle.end === 1 ? obj.y1 : obj.y2,
      };
      el.canvas.setPointerCapture(ev.pointerId);
      render();
      return;
    }
  }

  if (tool === "select" && underlaySelected) {
    const uHandle = underlayHandleHit(wx, wy);
    if (uHandle) {
      store.pushUndo();
      if (uHandle.kind === "underlay-scale") {
        const corners = underlayCorners(store.doc);
        const draggedIndex = uHandle.corner;
        const anchorWorld = corners[(draggedIndex + 2) % 4];
        const corner = corners[draggedIndex];
        const dx = corner.x - anchorWorld.x;
        const dy = corner.y - anchorWorld.y;
        const len = Math.hypot(dx, dy) || 1;
        const diagUnit = { x: dx / len, y: dy / len };
        // The pointer rarely lands exactly on the corner pixel; grabOffset
        // corrects for that so the sheet does not jump the instant the drag
        // starts (see scaleUnderlayFromCorner's doc comment).
        const clickProjected = (wx - anchorWorld.x) * diagUnit.x + (wy - anchorWorld.y) * diagUnit.y;
        const grabOffset = len - clickProjected;
        drag = { kind: "underlay-scale", draggedIndex, anchorWorld, diagUnit, grabOffset, moved: false };
      } else {
        const centre = underlayCentreWorld();
        drag = {
          kind: "underlay-rotate",
          cx: centre.x,
          cy: centre.y,
          startAngle: Math.atan2(wy - centre.y, wx - centre.x),
          startRotation: store.doc.underlay.rotation || 0,
          moved: false,
        };
      }
      el.canvas.setPointerCapture(ev.pointerId);
      render();
      return;
    }
  }

  if (tool === "calibrate") {
    if (!calibration.a) calibration.a = { x: wx, y: wy };
    else if (!calibration.b) {
      calibration.b = { x: wx, y: wy };
      promptCalibrationDistance();
      return;
    }
    render();
    return;
  }
  if (tool === "property") {
    const p = applySnap(wx, wy);
    // Closing the loop: click near the first vertex again, once there are
    // enough points to make a polygon.
    if (siteDraft.length >= 3) {
      const first = siteDraft[0];
      if (Math.hypot(p.x - first.x, p.y - first.y) * cam.scale < HANDLE * 1.5) {
        finishPropertyLine();
        return;
      }
    }
    siteDraft.push(p);
    render();
    return;
  }
  if (tool === "sg-ref") {
    sgPick = applySnap(wx, wy);
    render();
    return;
  }
  if (tool === "room" || tool === "slab" || tool === "roof") {
    underlaySelected = false;
    startNewShapeDrag(wx, wy);
    return;
  }
  if (tool === "wall") {
    underlaySelected = false;
    sizeDraft = { lockW: false, lockH: false, typedW: "", typedH: "", axis: "w" };
    const p0 = applySnap(wx, wy);
    drag = { kind: "wall-new", x1: p0.x, y1: p0.y, x2: p0.x, y2: p0.y };
    render();
    return;
  }
  if (tool === "door" || tool === "window") {
    underlaySelected = false;
    placeOpening(wx, wy);
    return;
  }
  if (tool === "beam") {
    underlaySelected = false;
    if (!beamStart) {
      beamStart = applySnap(wx, wy);
    } else {
      commitBeam(beamStart, applySnap(wx, wy));
      beamStart = null;
      snapGuide = null;
    }
    render();
    return;
  }
  if (tool === "place") {
    underlaySelected = false;
    placeItem(wx, wy);
    return;
  }

  const hit = hitTest(wx, wy);
  if (hit) {
    if (underlaySelected) drawRibbon();
    underlaySelected = false;
    if (ev.shiftKey) {
      store.toggleRefs([hit], hit);
    } else if (!(store.isSelected(hit.kind, hit.id) && store.selected.length > 1)) {
      store.selectOne(hit);
    }
    store.pushUndo();
    drag = { kind: "move", snaps: store.snapshotMoveTargets(store.selected), x0: wx, y0: wy, moved: false };
  } else if (tool === "select" && underlaySelected && hitUnderlay(wx, wy)) {
    store.pushUndo();
    drag = {
      kind: "underlay-move",
      x0: wx,
      y0: wy,
      ox: store.doc.underlay.x,
      oy: store.doc.underlay.y,
      moved: false,
    };
  } else {
    const wasUnderlay = underlaySelected;
    underlaySelected = false;
    if (!ev.shiftKey) store.clearSelection();
    drag = { kind: "marquee", x0: wx, y0: wy, x1: wx, y1: wy, shift: ev.shiftKey };
    if (wasUnderlay) drawRibbon();
  }
  render();
}

function startNewShapeDrag(wx, wy) {
  if (!placeSkuId) placeSkuId = defaultSkuFor(tool);
  sizeDraft = { lockW: false, lockH: false, typedW: "", typedH: "", axis: "w" };
  drag = { kind: `${tool}-new`, x0: wx, y0: wy, rect: null };
  render();
}

function onPointerMove(ev) {
  if (drag?.kind === "pan") {
    cam.ox = drag.ox0 + (ev.clientX - drag.startX);
    cam.oy = drag.oy0 + (ev.clientY - drag.startY);
    render();
    return;
  }
  const [wx, wy] = pointerWorld(ev);
  hoverPoint = { x: wx, y: wy };

  if (drag?.kind === "underlay-move") {
    const dx = wx - drag.x0;
    const dy = wy - drag.y0;
    if (Math.hypot(dx, dy) * cam.scale > 2) drag.moved = true;
    moveUnderlayTo(store.doc, drag.ox + dx, drag.oy + dy);
    render();
    return;
  }
  if (drag?.kind === "underlay-scale") {
    drag.moved = true;
    scaleUnderlayFromCorner(store.doc, drag.draggedIndex, drag.anchorWorld, drag.diagUnit, drag.grabOffset, { x: wx, y: wy });
    render();
    return;
  }
  if (drag?.kind === "underlay-rotate") {
    drag.moved = true;
    const angle = Math.atan2(wy - drag.cy, wx - drag.cx);
    let deg = drag.startRotation + ((angle - drag.startAngle) * 180) / Math.PI;
    if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
    setUnderlayRotation(store.doc, deg);
    render();
    return;
  }

  if (tool === "calibrate") {
    if (calibration?.a) render();
    return;
  }
  if (tool === "property" || tool === "sg-ref") {
    render();
    return;
  }
  hover = hitTest(wx, wy);

  if (drag?.kind === "marquee") {
    drag.x1 = wx;
    drag.y1 = wy;
    render();
    return;
  }
  if (drag?.kind === "move") {
    let dx = wx - drag.x0;
    let dy = wy - drag.y0;
    if (Math.hypot(dx, dy) * cam.scale > 2) drag.moved = true;
    let grid = activeGrid();
    snapGuide = null;
    // Endpoint-to-endpoint snapping only makes sense for a single wall or
    // beam: with a mixed/multi selection there's no single pair of
    // endpoints to test, so those still fall back to plain grid rounding.
    if (drag.snaps.length === 1 && drag.snaps[0].x1 !== undefined) {
      const single = drag.snaps[0];
      const exclude = single.ref.kind === "segment" ? { excludeSegmentIds: new Set([single.ref.id]) }
        : { excludeBeamIds: new Set([single.ref.id]) };
      const targets = collectSnapTargets(store.doc, exclude);
      const tol = SNAP_PIXEL_TOL / cam.scale;
      const points = [
        { x: single.x1 + dx, y: single.y1 + dy },
        { x: single.x2 + dx, y: single.y2 + dy },
      ];
      const best = bestEndpointSnap(points, targets, tol);
      if (best) {
        dx += best.dx;
        dy += best.dy;
        grid = null; // best.dx/dy already lands exactly on the target
        snapGuide = best.guide;
      }
    }
    store.applyMoveSnapshot(drag.snaps, dx, dy, grid);
    render();
    return;
  }
  if (drag?.kind === "segment-end") {
    const obj = objByRef({ kind: drag.target, id: drag.id });
    if (obj) applySegmentEnd(obj, drag.end, wx, wy, ev.shiftKey, drag, { kind: drag.target, id: drag.id });
    render();
    return;
  }
  if (!drag && tool === "select") {
    const uHandle = underlayHandleHit(wx, wy);
    el.canvas.style.cursor = endpointHandleHit(wx, wy) ? "ew-resize"
      : uHandle?.kind === "underlay-rotate" ? "grab"
      : uHandle?.kind === "underlay-scale" ? "nwse-resize"
      : hover ? "move"
      : underlaySelected && hitUnderlay(wx, wy) ? "move"
      : "default";
  }
  if (drag?.kind === "wall-new") {
    const p = applySnap(wx, wy);
    drag.x2 = p.x;
    drag.y2 = p.y;
    if (sizeDraft?.lockW) setWallDraftLength(parseMetres(sizeDraft.typedW, wallDraftLength() || 1));
    render();
    return;
  }
  if (drag?.kind?.endsWith("-new") && drag.kind !== "wall-new") {
    drag.rect = rectFromDrag(drag.x0, drag.y0, wx, wy);
    render();
    return;
  }
  render();
}

function rectFromDrag(x0, y0, wx, wy) {
  const grid = activeGrid();
  const x = roundGrid(Math.min(x0, wx), grid);
  const y = roundGrid(Math.min(y0, wy), grid);
  const w = sizeDraft?.lockW ? parseMetres(sizeDraft.typedW, 1) : roundGrid(Math.abs(wx - x0), grid);
  const h = sizeDraft?.lockH ? parseMetres(sizeDraft.typedH, 1) : roundGrid(Math.abs(wy - y0), grid);
  return { x, y, w, h };
}

function onPointerUp(ev) {
  if (drag?.kind === "pan") { drag = null; return; }
  if (!drag) return;

  if (drag.kind === "marquee") {
    const box = marqueeBox(drag.x0, drag.y0, drag.x1, drag.y1);
    const hits = refsInMarquee(box);
    if (drag.shift) store.toggleRefs(hits);
    else store.setSelection(hits);
  } else if (drag.kind === "move") {
    if (!drag.moved) store.undoStack.pop(); // no-op click: drop the speculative undo entry
  } else if (drag.kind === "underlay-move" || drag.kind === "underlay-scale" || drag.kind === "underlay-rotate") {
    if (!drag.moved) store.undoStack.pop(); // no-op click: drop the speculative undo entry
  } else if (drag.kind === "segment-end") {
    store.persist();
  } else if (drag.kind === "room-new") {
    commitRoom(drag.rect);
  } else if (drag.kind === "slab-new") {
    commitSlab(drag.rect);
  } else if (drag.kind === "roof-new") {
    commitRoof(drag.rect);
  } else if (drag.kind === "wall-new") {
    commitWall(drag);
  }

  drag = null;
  sizeDraft = null;
  snapGuide = null;
  store.pruneGroups();
  store.persist();
  render();
}

function deleteSelection() {
  if (!store.selected.length) return;
  store.pushUndo();
  for (const ref of store.selected) {
    const arr = collectionFor(store.doc, ref.kind);
    const idx = arr?.findIndex((row) => row.id === ref.id) ?? -1;
    if (idx >= 0) arr.splice(idx, 1);
  }
  store.pruneGroups();
  store.clearSelection();
  store.persist();
}

function wireKeyboard() {
  window.addEventListener("keydown", (ev) => {
    const tag = document.activeElement?.tagName;
    const typing = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";

    if (handleSizeTyping(ev)) return;
    if (typing) return;

    if (ev.key === "Escape") {
      if (el.massOverlay && !el.massOverlay.hidden) {
        closeMassing();
        return;
      }
      if (el.checkOverlay && !el.checkOverlay.hidden) {
        closeCheck();
        return;
      }
      drag = null;
      beamStart = null;
      sizeDraft = null;
      snapGuide = null;
      underlaySelected = false;
      if (tool === "calibrate") {
        calibration = null;
        tool = "select";
        syncToolButtons();
      }
      if (tool === "property") {
        siteDraft = null;
        tool = "select";
        syncToolButtons();
      }
      if (tool === "sg-ref") {
        sgPick = null;
        tool = "select";
        syncToolButtons();
      }
      drawRibbon();
      render();
    } else if (ev.key === "Enter" && tool === "property" && siteDraft?.length >= 3) {
      finishPropertyLine();
    } else if ((ev.key === "Delete" || ev.key === "Backspace") && store.selected.length) {
      deleteSelection();
      render();
    } else if ((ev.key === "Delete" || ev.key === "Backspace") && underlaySelected) {
      removeUnderlay();
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") {
      ev.preventDefault();
      store.undo();
      render();
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "a") {
      ev.preventDefault();
      store.selectAll();
      render();
    } else if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key.toLowerCase() === "g") {
      ev.preventDefault();
      store.ungroupSelection();
      store.persist();
      render();
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "g") {
      ev.preventDefault();
      store.groupSelection();
      store.persist();
      render();
    } else if (ev.key.toLowerCase() === "r" && store.primary?.kind === "item") {
      const obj = objByRef(store.primary);
      if (obj) {
        store.pushUndo();
        obj.rotation = ((obj.rotation || 0) + 90) % 360;
        store.persist();
        render();
      }
    }
  });
}

// --- object creation ------------------------------------------------------

function commitRoom(rect) {
  if (!rect || rect.w < MIN_ROOM || rect.h < MIN_ROOM) return;
  store.pushUndo();
  store.doc.rooms.push({
    id: nid("r"),
    name: "Room",
    use: "other",
    level: activeLevel,
    wallSku: pack.system.defaultWallSku,
    floorSku: pack.system.defaultFloorSku,
    status: placeStatus,
    shape: rectShape(rect.x, rect.y, rect.w, rect.h),
  });
}

function commitSlab(rect) {
  if (!rect || rect.w < 0.3 || rect.h < 0.3) return;
  store.pushUndo();
  store.doc.slabs.push({
    id: nid("sl"),
    sku: placeSkuId,
    level: activeLevel,
    status: placeStatus,
    shape: rectShape(rect.x, rect.y, rect.w, rect.h),
  });
}

function commitRoof(rect) {
  if (!rect || rect.w < 0.3 || rect.h < 0.3) return;
  store.pushUndo();
  store.doc.roofs.push({
    id: nid("rf"),
    sku: placeSkuId,
    level: activeLevel,
    form: "gable",
    pitch: 30,
    ridge: "long",
    status: placeStatus,
    shape: rectShape(rect.x, rect.y, rect.w, rect.h),
  });
}

function commitWall(d) {
  const len = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
  if (len < MIN_TRACE) return;
  store.pushUndo();
  const id = nid("s");
  store.doc.segments.push({ id, sku: placeSkuId, level: activeLevel, x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, status: placeStatus });
  store.selectOne({ kind: "segment", id });
}

function commitBeam(a, b) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 0.3) return;
  store.pushUndo();
  store.doc.beams.push({ id: nid("b"), sku: placeSkuId, level: activeLevel, x1: a.x, y1: a.y, x2: b.x, y2: b.y, status: placeStatus });
  store.persist();
}

function placeOpening(wx, wy) {
  const walls = currentWalls().filter(onActiveLevel);
  const wall = nearestPlaceWall(walls, pack, wx, wy, placeSkuId);
  if (!wall) return;
  store.pushUndo();
  const swing = swingToward(wall, wx, wy);
  const t = wallT(wall, wx, wy);
  let row;
  if (wall.drawn) {
    row = { id: nid("o"), sku: placeSkuId, wallId: wall.id, t, swing, status: placeStatus };
  } else {
    const edge = wall.edges[0];
    const room = store.doc.rooms.find((r) => r.id === edge.roomId);
    const edgeSeg = roomEdgeSegment(room, edge.edgeIndex);
    row = {
      id: nid("o"),
      sku: placeSkuId,
      roomId: edge.roomId,
      edgeIndex: edge.edgeIndex,
      t: wallT(edgeSeg, wx, wy),
      swing,
      status: placeStatus,
    };
  }
  store.doc.openings.push(row);
  store.persist();
  render();
}

function placeItem(wx, wy) {
  store.pushUndo();
  const p = applySnap(wx, wy);
  store.doc.items.push({
    id: nid("i"),
    sku: placeSkuId,
    level: activeLevel,
    x: p.x,
    y: p.y,
    rotation: placeRotation,
    status: placeStatus,
  });
  store.persist();
  render();
}

// --- size HUD --------------------------------------------------------------

function parseMetres(raw, fallback) {
  const n = Number(String(raw ?? "").trim().replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(0.1, roundGrid(n, activeGrid()));
}

function wallDraftLength() {
  if (drag?.kind !== "wall-new") return 0;
  return segmentLength(drag.x1, drag.y1, drag.x2, drag.y2);
}

function setWallDraftLength(length) {
  const grid = activeGrid();
  const next = Math.max(MIN_TRACE, roundGrid(Number(length) || MIN_TRACE, grid));
  const cur = wallDraftLength();
  if (cur < 1e-6) {
    drag.x2 = roundGrid(drag.x1 + next, grid);
    drag.y2 = drag.y1;
    return;
  }
  const s = next / cur;
  drag.x2 = roundGrid(drag.x1 + (drag.x2 - drag.x1) * s, grid);
  drag.y2 = roundGrid(drag.y1 + (drag.y2 - drag.y1) * s, grid);
}

function setWallDraftHeading(deg) {
  const len = wallDraftLength() || MIN_TRACE;
  const rad = (Number(deg) * Math.PI) / 180;
  const grid = activeGrid();
  drag.x2 = roundGrid(drag.x1 + Math.cos(rad) * len, grid);
  drag.y2 = roundGrid(drag.y1 + Math.sin(rad) * len, grid);
}

function parseDegrees(raw, fallback) {
  const n = Number(String(raw ?? "").trim().replace(",", "."));
  if (!Number.isFinite(n)) return fallback;
  let d = n % 360;
  if (d < 0) d += 360;
  return d;
}

function syncSizeHud() {
  const rectDraft = drag && drag.kind?.endsWith("-new") && drag.kind !== "wall-new" && drag.rect;
  el.sizeHud.hidden = !rectDraft;
  if (!rectDraft) return;
  el.sizeHud.classList.remove("length-only");
  if (el.hudWName) el.hudWName.textContent = "Width";
  if (el.hudHint) el.hudHint.textContent = "Drag to size, or type metres. Tab switches width / height.";
  if (document.activeElement !== el.hudW) el.hudW.value = sizeDraft?.lockW ? sizeDraft.typedW : drag.rect.w.toFixed(1);
  if (document.activeElement !== el.hudH) el.hudH.value = sizeDraft?.lockH ? sizeDraft.typedH : drag.rect.h.toFixed(1);
}

function handleSizeTyping(ev) {
  if (!drag || !drag.kind?.endsWith("-new")) return false;
  if (ev.target !== el.hudW && ev.target !== el.hudH) return false;
  if (!sizeDraft) sizeDraft = { lockW: false, lockH: false, typedW: "", typedH: "", axis: "w" };
  if (ev.key === "Tab" && drag.kind !== "wall-new") {
    ev.preventDefault();
    (ev.target === el.hudW ? el.hudH : el.hudW).focus();
    return true;
  }
  return false;
}

el.hudW.addEventListener("input", (ev) => {
  if (!sizeDraft) return;
  sizeDraft.lockW = true;
  sizeDraft.typedW = ev.target.value;
  if (drag?.rect) drag.rect.w = parseMetres(sizeDraft.typedW, drag.rect.w);
  render();
});
el.hudH.addEventListener("input", (ev) => {
  if (!sizeDraft) return;
  sizeDraft.lockH = true;
  sizeDraft.typedH = ev.target.value;
  if (drag?.rect) drag.rect.h = parseMetres(sizeDraft.typedH, drag.rect.h);
  render();
});

// --- plan header (selection properties) --------------------------------

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let planContextKey = "";

function setHidden(node, hidden) {
  if (node) node.hidden = hidden;
}

function catsForContext(kind, skuId) {
  if (kind === "beam") return ["beam", "column"];
  if (kind === "segment" || kind === "wall") return ["wall", "foundation", "boundarywall"];
  if (kind === "roof") return ["roof", "carport"];
  const cat = skuById(skuId)?.category;
  if (kind === "slab") return cat ? [cat] : ["floor", "pool", "ceiling"];
  if (kind === "opening" || kind === "item") return cat ? [cat] : [];
  return [];
}

function fillContextTypeSelect(kind, skuId) {
  const cats = catsForContext(kind, skuId);
  const skus = pack.skus
    .filter((s) => cats.includes(s.category))
    .sort((a, b) => a.name.localeCompare(b.name));
  el.ctxType.innerHTML = skus
    .map((s) => `<option value="${escapeHtml(s.id)}"${s.id === skuId ? " selected" : ""}>${escapeHtml(s.name)}</option>`)
    .join("");
  if (skuId && !skus.some((s) => s.id === skuId)) {
    el.ctxType.insertAdjacentHTML("afterbegin", `<option value="${escapeHtml(skuId)}" selected>${escapeHtml(skuById(skuId)?.name || skuId)}</option>`);
  }
}

function syncStatusButtons() {
  let status = placeStatus;
  if (store.selected.length === 1) {
    const obj = objByRef(store.primary);
    if (obj) status = objectStatus(obj);
  }
  document.querySelectorAll(".planner-tools [data-status]").forEach((b) => {
    b.classList.toggle("active", b.dataset.status === status);
  });
}

function syncInspectKicker(text) {
  if (!el.inspectKicker) return;
  el.inspectKicker.textContent = text || "—";
}

function syncObjectLevel(obj) {
  const levels = pack.levels || [];
  const show = levels.length >= 2 && obj;
  setHidden(el.ctxOLevelWrap, !show);
  if (!show) return;
  const html = levels
    .map((l) => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.name)}</option>`)
    .join("");
  if (el.ctxOLevel.options.length !== levels.length) el.ctxOLevel.innerHTML = html;
  const id = obj.level || pack.system.defaultLevel;
  if (document.activeElement !== el.ctxOLevel) el.ctxOLevel.value = id;
}

function syncPlanContext() {
  syncStatusButtons();
  const draft = drag?.kind === "wall-new";
  const refs = store.selected;
  const ref = !draft && refs.length === 1 ? store.primary : null;
  const obj = ref ? objByRef(ref) : null;
  const linear = draft || (obj && (ref.kind === "segment" || ref.kind === "beam"));
  const room = Boolean(obj && ref.kind === "room");
  const slab = Boolean(obj && ref.kind === "slab");
  const roof = Boolean(obj && ref.kind === "roof");
  const opening = Boolean(obj && ref.kind === "opening");
  const item = Boolean(obj && ref.kind === "item");
  const rect = (room || slab || roof) && obj.shape?.kind === "rect";
  const multi = !draft && refs.length > 1;
  const showType = linear || slab || roof || opening || item;
  const showGeom = linear || rect;
  const showInspect = Boolean(el.inspectFields) && (linear || room || slab || roof || opening || item);

  if (multi) {
    const group = store.groupForRef(refs[0]);
    syncInspectKicker(group ? group.name : `${refs.length} selected`);
  } else if (room) {
    syncInspectKicker(obj.name);
  } else if (obj) {
    syncInspectKicker(skuById(obj.sku)?.name || "");
  } else if (draft) {
    syncInspectKicker(skuById(placeSkuId)?.name || "Wall");
  } else {
    syncInspectKicker("");
  }

  setHidden(el.planOptions, !showGeom);
  setHidden(el.inspectFields, !showInspect);
  setHidden(el.inspectEmpty, showInspect);
  if (el.inspectEmpty && !showInspect) {
    el.inspectEmpty.textContent = multi
      ? "Type and identity apply to one object at a time."
      : "Select a wall, room, roof or opening to edit its type and identity.";
  }

  if (!showInspect && !showGeom) {
    planContextKey = "";
    return;
  }

  setHidden(el.ctxNameWrap, !room);
  setHidden(el.ctxUseWrap, !room);
  setHidden(el.ctxLenWrap, !linear);
  setHidden(el.ctxAngWrap, !linear);
  setHidden(el.ctxWWrap, !rect);
  setHidden(el.ctxHWrap, !rect);
  setHidden(el.ctxFormWrap, !roof);
  setHidden(el.ctxPitchWrap, !roof);
  setHidden(el.ctxTypeWrap, !showType);
  setHidden(el.ctxFlip, !(opening && skuById(obj.sku)?.category === "door"));
  syncObjectLevel(obj && ref.kind !== "opening" ? obj : null);

  const skuId = draft ? placeSkuId : obj?.sku;
  const kind = draft ? "wall" : ref?.kind;
  const key = showType ? `${kind}:${skuId}:${draft ? "draft" : ref.id}` : "";
  if (showType && key !== planContextKey) {
    planContextKey = key;
    fillContextTypeSelect(kind, skuId);
  } else if (showType && skuId && el.ctxType.value !== skuId) {
    el.ctxType.value = skuId;
  } else if (!showType) {
    planContextKey = "";
  }

  if (linear) {
    const x1 = draft ? drag.x1 : obj.x1;
    const y1 = draft ? drag.y1 : obj.y1;
    const x2 = draft ? (drag.x2 ?? drag.x1) : obj.x2;
    const y2 = draft ? (drag.y2 ?? drag.y1) : obj.y2;
    const len = segmentLength(x1, y1, x2, y2);
    const ang = headingDeg(x1, y1, x2, y2);
    if (document.activeElement !== el.ctxLen) {
      el.ctxLen.value = (draft && sizeDraft?.lockW) ? sizeDraft.typedW : (len < 0.05 ? "" : len.toFixed(2));
    }
    if (document.activeElement !== el.ctxAng) {
      el.ctxAng.value = len < 0.05 ? "" : ang.toFixed(1);
    }
  }
  if (room && document.activeElement !== el.ctxName) el.ctxName.value = obj.name;
  if (room && document.activeElement !== el.ctxUse) el.ctxUse.value = obj.use;
  if (rect) {
    if (document.activeElement !== el.ctxW) el.ctxW.value = obj.shape.w.toFixed(2);
    if (document.activeElement !== el.ctxH) el.ctxH.value = obj.shape.h.toFixed(2);
  }
  if (roof) {
    if (document.activeElement !== el.ctxForm) el.ctxForm.value = obj.form;
    if (document.activeElement !== el.ctxPitch) el.ctxPitch.value = String(obj.pitch);
  }
}

el.ctxLen?.addEventListener("input", (ev) => {
  if (drag?.kind === "wall-new") {
    if (!sizeDraft) sizeDraft = { lockW: false, lockH: false, typedW: "", typedH: "", axis: "w" };
    sizeDraft.lockW = true;
    sizeDraft.typedW = ev.target.value;
    setWallDraftLength(parseMetres(sizeDraft.typedW, wallDraftLength() || 1));
    render();
  }
});

el.ctxLen?.addEventListener("change", (ev) => {
  if (drag?.kind === "wall-new") return;
  const sel = soleLinearSelection();
  if (!sel) return;
  store.pushUndo();
  setSegmentLength(sel.obj, parseMetres(ev.target.value, segmentLength(sel.obj.x1, sel.obj.y1, sel.obj.x2, sel.obj.y2)));
  store.persist();
  render();
});

el.ctxAng?.addEventListener("change", (ev) => {
  if (drag?.kind === "wall-new") {
    const cur = headingDeg(drag.x1, drag.y1, drag.x2 ?? drag.x1, drag.y2 ?? drag.y1);
    setWallDraftHeading(parseDegrees(ev.target.value, cur));
    render();
    return;
  }
  const sel = soleLinearSelection();
  if (!sel) return;
  store.pushUndo();
  const cur = headingDeg(sel.obj.x1, sel.obj.y1, sel.obj.x2, sel.obj.y2);
  setSegmentHeading(sel.obj, parseDegrees(ev.target.value, cur));
  store.persist();
  render();
});

el.ctxType?.addEventListener("change", () => {
  const sku = skuById(el.ctxType.value);
  if (!sku) return;
  if (drag?.kind === "wall-new") {
    placeSkuId = sku.id;
    renderPalette();
    render();
    return;
  }
  if (applySkuToSelection(sku)) {
    renderPalette();
    render();
  }
});

function soleOf(kind) {
  if (store.selected.length !== 1) return null;
  const ref = store.primary;
  if (ref.kind !== kind) return null;
  return objByRef(ref);
}

el.ctxName?.addEventListener("change", (e) => {
  const room = soleOf("room");
  if (!room) return;
  store.pushUndo();
  room.name = e.target.value.trim() || "Room";
  store.persist();
  render();
});

el.ctxUse?.addEventListener("change", (e) => {
  const room = soleOf("room");
  if (!room) return;
  store.pushUndo();
  room.use = e.target.value;
  store.persist();
  render();
});

el.ctxW?.addEventListener("change", (e) => {
  const obj = soleOf("room") || soleOf("slab") || soleOf("roof");
  if (!obj?.shape || obj.shape.kind !== "rect") return;
  store.pushUndo();
  obj.shape.w = parseMetres(e.target.value, obj.shape.w);
  store.persist();
  render();
});

el.ctxH?.addEventListener("change", (e) => {
  const obj = soleOf("room") || soleOf("slab") || soleOf("roof");
  if (!obj?.shape || obj.shape.kind !== "rect") return;
  store.pushUndo();
  obj.shape.h = parseMetres(e.target.value, obj.shape.h);
  store.persist();
  render();
});

el.ctxForm?.addEventListener("change", (e) => {
  const roof = soleOf("roof");
  if (!roof) return;
  store.pushUndo();
  roof.form = e.target.value;
  store.persist();
  render();
});

el.ctxPitch?.addEventListener("change", (e) => {
  const roof = soleOf("roof");
  if (!roof) return;
  store.pushUndo();
  roof.pitch = Number(e.target.value) || 30;
  store.persist();
  render();
});

el.ctxFlip?.addEventListener("click", () => {
  const opening = soleOf("opening");
  if (!opening) return;
  store.pushUndo();
  opening.swing = (opening.swing || 1) * -1;
  store.persist();
  render();
});

el.ctxOLevel?.addEventListener("change", (e) => {
  if (store.selected.length !== 1) return;
  const obj = objByRef(store.primary);
  if (!obj || store.primary.kind === "opening") return;
  store.pushUndo();
  const newLevel = e.target.value;
  obj.level = newLevel;
  store.persist();
  // Jump the active level (and slider) to match, rather than leaving the
  // object selected-but-invisible on a level the canvas is no longer
  // showing - the "moved a ceiling and it vanished" failure mode.
  if (newLevel !== activeLevel) {
    activeLevel = newLevel;
    drawLevelSwitcher();
    updateRibbonHint();
    drawRibbon();
  }
  render();
});

// --- underlay properties (opacity, rotation) ----------------------------

el.underlayOpacity?.addEventListener("input", (ev) => {
  if (!store.doc.underlay) return;
  setUnderlayOpacity(store.doc, Number(ev.target.value) / 100);
  render();
});
el.underlayOpacity?.addEventListener("change", () => {
  if (!store.doc.underlay) return;
  store.persist();
});

el.underlayRotation?.addEventListener("change", (ev) => {
  if (!store.doc.underlay) return;
  store.pushUndo();
  setUnderlayRotation(store.doc, parseDegrees(ev.target.value, store.doc.underlay.rotation || 0));
  store.persist();
  render();
});

el.underlayRotateCcw?.addEventListener("click", () => {
  if (!store.doc.underlay) return;
  store.pushUndo();
  rotateUnderlayBy(store.doc, -90);
  store.persist();
  render();
});
el.underlayRotateCw?.addEventListener("click", () => {
  if (!store.doc.underlay) return;
  store.pushUndo();
  rotateUnderlayBy(store.doc, 90);
  store.persist();
  render();
});

// --- set-scale panel -----------------------------------------------------

el.calibrateConfirm?.addEventListener("click", confirmCalibration);
el.calibrateCancel?.addEventListener("click", cancelCalibration);
el.calibrateDistance?.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") {
    ev.preventDefault();
    confirmCalibration();
  }
});

// --- SG reference panel ----------------------------------------------------

el.sgConfirm?.addEventListener("click", confirmSgReference);
el.sgCancel?.addEventListener("click", cancelSgReference);

// --- compile ----------------------------------------------------------

function runCompile() {
  const out = compile(store.doc, pack);
  if (!out) return;
  openCheck();
  el.compilePanel.hidden = false;
  const walls = out.walls || [];
  const external = walls.filter((w) => w.external).length;
  const doors = out.instances.filter((r) => r.category === "Doors").length;
  const windows = out.instances.filter((r) => r.category === "Windows").length;
  const implied = out.instances.filter((r) => r.implied);
  const totalArea = out.rooms.reduce((s, r) => s + r.area, 0);

  el.compileKicker.textContent = `${out.instances.length} instances`;
  const warnings = out.warnings || [];
  el.compileOut.innerHTML = `
    ${warnings.length ? `<div class="compile-warnings">${warnings.map((w) => `<p class="warn">⚠ ${escapeHtml(w)}</p>`).join("")}</div>` : ""}
    <dl class="meta">
      <div><dt>Rooms</dt><dd>${out.rooms.length} (${totalArea.toFixed(1)} m² total)</dd></div>
      <div><dt>Walls</dt><dd>${walls.length} (${external} external)</dd></div>
      <div><dt>Openings</dt><dd>${doors} doors, ${windows} windows</dd></div>
      <div><dt>Implied quantities</dt><dd>${implied.length ? implied.map((r) => `${r.model} (${(r.length ?? r.area ?? 0).toFixed(1)})`).join(", ") : "none"}</dd></div>
    </dl>
    <p class="hint">Full extract logged to the console as <code>window.__extract</code>.</p>
    <pre>${escapeHtml(JSON.stringify(out.instances.slice(0, 6), null, 2))}${out.instances.length > 6 ? "\n…" : ""}</pre>
  `;
  window.__extract = out;
  // eslint-disable-next-line no-console
  console.log("v2 compile:", out);
  console.table(out.instances.map(({ profileLoops, ...rest }) => rest));
}

// --- demo doc ------------------------------------------------------------

function loadDemo() {
  store.pushUndo();
  const wallSku = pack.system.defaultWallSku;
  const floorSku = pack.system.defaultFloorSku;
  const roofSku = pack.system.defaultRoofSku;
  const level = pack.system.defaultLevel;
  const upperLevel = lookUpLevelId(pack.levels, level);
  activeLevel = level;
  drawLevelSwitcher();

  store.doc = {
    ...emptyDoc(),
    packId: pack.id,
    rooms: [
      {
        id: nid("r"), name: "Bathroom", use: "bathroom", level, wallSku, floorSku,
        status: "existing", shape: rectShape(0, 0, 4, 3),
      },
      {
        // L-shaped bedroom: a rectangle union, the shape v1 could never draw.
        id: nid("r"), name: "Bedroom", use: "bedroom", level, wallSku, floorSku,
        status: "planned",
        shape: { kind: "rects", rects: [{ x: 4, y: 0, w: 4, h: 3 }, { x: 4, y: 3, w: 3, h: 3 }] },
      },
    ],
    segments: [
      { id: nid("s"), sku: skuByCategory("foundation"), level, x1: 0, y1: -0.4, x2: 7, y2: -0.4, status: "existing" },
    ],
    openings: [
      { id: nid("o"), sku: skuByCategory("door"), roomId: null, wallId: null, t: 0.5, swing: 1, status: "planned" },
      { id: nid("o"), sku: skuByCategory("window"), roomId: null, wallId: null, t: 0.5, swing: 1, status: "planned" },
    ],
    slabs: [
      { id: nid("sl"), sku: floorSku, level, status: "planned", shape: rectShape(7.2, 0, 2, 2.4) },
    ],
    roofs: [
      { id: nid("rf"), sku: roofSku, level, form: "gable", pitch: 30, ridge: "long", status: "planned", shape: rectShape(-0.4, -0.4, 8, 6.8) },
    ],
    items: [
      { id: nid("i"), sku: skuByCategory("sanitary"), level, x: 0.4, y: 2.35, rotation: 0, status: "existing" },
      { id: nid("i"), sku: skuByCategory("electrical"), level, x: 5.5, y: 0.4, rotation: 0, status: "planned" },
    ],
    beams: [],
    groups: [],
  };

  // A second-storey room over the same footprint - the everyday case the
  // level switcher exists for. Without it, ground- and first-floor walls
  // sharing a footprint would merge into one "shared" wall spanning two
  // storeys instead of drawing as two separate levels.
  if (upperLevel) {
    store.doc.rooms.push({
      id: nid("r"), name: "Landing", use: "other", level: upperLevel, wallSku, floorSku,
      status: "planned", shape: rectShape(0, 0, 4, 3),
    });
  }

  // Anchor the door on the shared wall between the two rooms, and the window
  // on the bedroom's south external wall - resolved live from the geometry
  // rather than hardcoded, so it survives the L-shape's exact edge indices.
  const walls = deriveWalls(store.doc, pack);
  const shared = walls.find((w) => w.shared);
  const bedroom = store.doc.rooms[1];
  if (shared) {
    store.doc.openings[0].wallId = shared.id;
    store.doc.openings[0].t = wallT(shared, shared.x1 + (shared.x2 - shared.x1) * 0.5, shared.y1 + (shared.y2 - shared.y1) * 0.5);
  }
  const southEdgeIndex = southMostEdgeIndex(bedroom);
  store.doc.openings[1].roomId = bedroom.id;
  store.doc.openings[1].edgeIndex = southEdgeIndex;
  store.doc.openings[1].t = 0.5;

  store.clearSelection();
  store.persist();
  render();
}

function southMostEdgeIndex(room) {
  const poly = roomPolygon(room);
  let best = 0;
  let bestY = Infinity;
  poly.forEach(([, y1], i) => {
    const [, y2] = poly[(i + 1) % poly.length];
    const midY = (y1 + y2) / 2;
    if (Math.abs(y1 - y2) < 1e-6 && midY < bestY) {
      bestY = midY;
      best = i;
    }
  });
  return best;
}

function skuByCategory(cat) {
  return pack.skus.find((s) => s.category === cat)?.id || pack.skus[0].id;
}
