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
import { HINTS, firstTabId, renderRibbon } from "./ribbon.js?v=20260917-measure";
import { closeOverflowMenus, decorateRibbon, fitRibbon } from "./ribbon-fit.js?v=20260917-section";
import {
  lookUpLevelId,
  ghostContext,
  MAX_FLOORS_TO_ADD,
  floorsAvailableToAdd as floorsAvailableToAddFor,
  canAddFloor as canAddFloorFor,
  visibleLevels as visibleLevelsFor,
  mergedLevels,
  validateLevelInsert,
  insertLevel as insertLevelInto,
  buildHouseStations,
  inspectorStations,
  selectedInspectorStationId,
} from "./level-view.js";
import { isFoundationLevel as levelIsFoundation, placementHintOverride } from "./placement-warn.js";
import {
  alignSelection,
  attachSelection,
  copySelection,
  cutSelection,
  detachSelection,
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
  underlayPixelFromWorld,
  underlayWorldFromPixel,
} from "./underlay.js?v=20260917-calibrate";
import { pickedDimension, planDimensionLines } from "./dimensions.js?v=20260917-measure";
import { area as polyArea, bbox, clipSegToRect, distToSeg, headingDeg, pointInPoly, roundGrid } from "./geom.js?v=20260915-offset";
import { SNAP_PIXEL_TOL, GAP_MAX_M, NICE_MIN_STEP_M, PROBE_VECTORS, applyNicePoint, bestEndpointSnap, collectSnapEdges, collectSnapTargets, nearestAlignments, resolveProbes, snapLengthFrom, snapPoint } from "./snap.js";
import { DEFAULT_ROOF_PITCH, roofGuideLines } from "./roof.js";
import {
  ATTACHABLE_KINDS,
  PlanStore,
  ROOM_USES,
  collectionFor,
  effectiveLevel,
  emptyDoc,
  nid,
  normalizeDoc,
  objectByRef,
  rectShape,
  roomArea,
  roomCentroid,
  roomMinDimension,
  roomPerimeter,
  roomPolygon,
  shapePolygon,
} from "./model.js";
import { deriveWalls, drawnWallThickness, isStripFooting, statusVisible } from "./walls.js";
import {
  openingDraftAt,
  openingOnWall,
  openingSideGaps,
  roomEdgeSegment,
  wallForOpening,
  wallNormal,
  wallT,
} from "./openings.js";
import {
  attachPreview,
  attachReport,
  attachTargetLevels,
  compile,
  drawnObjectHeight,
  objectLabel,
  resolvedBase,
} from "./compile.js";
import { exportDxf } from "./dxf.js";
import { exportIfc } from "./ifc.js";
import { boqRows, bomRows, scheduleTotal } from "./schedule.js";
import { createMassingView, lookFromClicks, EYE_HEIGHT_M } from "./massing.js";
import { drawLookPlan, lookPlanCaption } from "./look-plan.js";
import { sectionFromClicks } from "./section.js";
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
import {
  AuthRequiredError, DocSync, docSignature, httpTransport, syncStateLabel,
} from "./sync.js";
import { CloudError, createCloud, importLocalDocument } from "./cloud.js";
import {
  NavigationBlocked, createJob, duplicateJob, jobRowFields, openJob, renameJob, splitLibrary,
} from "./library.js";

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
  scheduleOverlay: document.getElementById("v2-schedule-overlay"),
  scheduleTitle: document.getElementById("v2-schedule-title"),
  scheduleKicker: document.getElementById("v2-schedule-kicker"),
  scheduleBody: document.getElementById("v2-schedule-body"),
  scheduleClose: document.getElementById("v2-schedule-close"),
  healthDot: document.getElementById("v2-health-dot"),
  healthLabel: document.getElementById("v2-health-label"),
  jobName: document.getElementById("v2-job-name"),
  syncState: document.getElementById("v2-sync-state"),
  conflict: document.getElementById("v2-conflict"),
  conflictText: document.getElementById("v2-conflict-text"),
  conflictTheirs: document.getElementById("v2-conflict-theirs"),
  conflictMine: document.getElementById("v2-conflict-mine"),
  libraryOverlay: document.getElementById("v2-library-overlay"),
  libraryList: document.getElementById("v2-library-list"),
  libraryMessage: document.getElementById("v2-library-message"),
  libraryNew: document.getElementById("v2-library-new"),
  librarySignOut: document.getElementById("v2-library-signout"),
  libraryClose: document.getElementById("v2-library-close"),
  auth: document.getElementById("v2-auth"),
  authForm: document.getElementById("v2-auth-form"),
  authTitle: document.getElementById("v2-auth-title"),
  authKicker: document.getElementById("v2-auth-kicker"),
  authEmail: document.getElementById("v2-auth-email"),
  authPassword: document.getElementById("v2-auth-password"),
  authOrg: document.getElementById("v2-auth-org"),
  authOrgWrap: document.getElementById("v2-auth-org-wrap"),
  authError: document.getElementById("v2-auth-error"),
  authSubmit: document.getElementById("v2-auth-submit"),
  authToggle: document.getElementById("v2-auth-toggle"),
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
  levelPanel: document.getElementById("v2-level-panel"),
  levelHint: document.getElementById("v2-level-hint"),
  levelName: document.getElementById("v2-level-name"),
  levelElevation: document.getElementById("v2-level-elevation"),
  levelConfirm: document.getElementById("v2-level-confirm"),
  levelCancel: document.getElementById("v2-level-cancel"),
  attachPanel: document.getElementById("v2-attach-panel"),
  attachHint: document.getElementById("v2-attach-hint"),
  attachList: document.getElementById("v2-attach-list"),
  attachConfirm: document.getElementById("v2-attach-confirm"),
  attachCancel: document.getElementById("v2-attach-cancel"),
  attachReport: document.getElementById("v2-attach-report"),
  attachCount: document.getElementById("v2-attach-count"),
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
  levelIsolate: document.getElementById("v2-level-isolate"),
  planOptions: document.getElementById("v2-plan-options"),
  inspectKicker: document.getElementById("v2-inspect-kicker"),
  inspectEmpty: document.getElementById("v2-inspect-empty"),
  inspectFields: document.getElementById("v2-inspect-fields"),
  checkOverlay: document.getElementById("v2-check-overlay"),
  checkClose: document.getElementById("v2-check-close"),
  aboutOverlay: document.getElementById("v2-about-overlay"),
  aboutOpen: document.getElementById("v2-about-open"),
  aboutClose: document.getElementById("v2-about-close"),
  aboutOk: document.getElementById("v2-about-ok"),
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
  ctxRidge: document.getElementById("v2-ctx-ridge"),
  ctxRidgeWrap: document.getElementById("v2-ctx-ridge-wrap"),
  ctxType: document.getElementById("v2-ctx-type"),
  ctxTypeWrap: document.getElementById("v2-ctx-type-wrap"),
  ctxStatusWrap: document.getElementById("v2-ctx-status-wrap"),
  ctxOLevel: document.getElementById("v2-ctx-olevel"),
  ctxOLevelWrap: document.getElementById("v2-ctx-olevel-wrap"),
  ctxAttach: document.getElementById("v2-ctx-attach"),
  ctxAttachWrap: document.getElementById("v2-ctx-attach-wrap"),
  ctxFlip: document.getElementById("v2-ctx-flip"),
  massOverlay: document.getElementById("v2-mass-overlay"),
  massTitle: document.getElementById("v2-mass-title"),
  massCanvas: document.getElementById("v2-mass-canvas"),
  massEmpty: document.getElementById("v2-mass-empty"),
  massCaption: document.getElementById("v2-mass-caption"),
  massClose: document.getElementById("v2-mass-close"),
  massPanel: document.querySelector("#v2-mass-overlay .mass-panel"),
  massPlanWrap: document.getElementById("v2-mass-plan-wrap"),
  massPlanCanvas: document.getElementById("v2-mass-plan-canvas"),
  massViewLabel: document.getElementById("v2-mass-view-label"),
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

// `templatePack` is the pack exactly as build-pack.js produced it from the
// template. `pack` is what everything downstream reads: the same object with
// the document's own inserted levels folded into `levels`, so every existing
// consumer (compile.js, walls.js, the level switcher) sees one level stack
// without knowing where each storey came from. The document stays the only
// place a user level is stored - see syncPackLevels().
let templatePack = null;
let pack = null;
// The rate book BOQ prices against (SCHEMA.md #4: rates are referenced, never
// embedded in the pack). Missing entirely, or missing a given SKU, both read
// as "no rate on file" - schedule.js's findRate()/boqRows() already treat a
// null rate as "-", never a guessed 0.
let rateBook = null;
// The document's save path. Every mutation still calls store.persist(); what
// persist() reaches is a sink that coalesces writes and reports whether they
// landed.
//
// No transport yet: which drawing this writes to is not known until the server
// says which job we are in, so openJob() attaches one. Before that there is
// nothing open and nothing to write.
const sync = new DocSync({ onState: drawSyncState });
const store = new PlanStore(emptyDoc(), { sink: sync });
const cloud = createCloud();

// The job currently open, as the server described it. Null until sign-in.
let openProject = null;
let openDrawingId = null;

let tool = "select";
let placeSkuId = null;
let placeStatus = "planned";
let planStatusFilter = "both";
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
// Output > Views > Camera: the stand point while tool === "camera", waiting
// on the look-at click. Same two-click shape as Set scale.
let cameraDraft = null;
// Document > Views > Section: the first end of the cut while tool === "section".
let sectionDraft = null;
// Document > Annotate > Dimensions: the first click while tool === "measure".
let measureDraft = null;
// Completed two-point strings kept while the measure tool stays armed, so a
// second pair can sit next to the first until Escape (or the button again)
// leaves the tool.
let userDimensions = [];
// Modify > Attach base: the refs waiting for a target while tool === "attach",
// plus the candidate under the pointer so the hint can preview what the click
// will do before it commits anything.
let attachPick = null;
let sizeDraft = null;
let hover = null;
let hoverPoint = null;
let wallsCache = [];

// While a wall, beam, room, slab or roof tool is armed, the nearest
// join/alignment (and, when not latched, how far the pointer is from it).
// Drawn as tracking lines; cleared when the tool is not snap-aware.
let snapGuide = null;

// Which side each axis' live measurement is pinned to, set by the arrow keys
// (same key again unpins). Null keeps the nearest-object measurement, which
// is right most of the time but can only ever report one side of an axis: a
// point with a wall above and a wall below only ever shows the closer of the
// two. Pinning asks for the other one explicitly, and reports an empty side
// as a faded string rather than nothing at all.
const probeSide = { h: null, v: null };

const PROBE_KEYS = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

function probeAxis(side) {
  return side === "left" || side === "right" ? "h" : "v";
}

// The level the plan is currently showing/editing. A two-storey house drawn
// on one canvas with no level concept would draw its ground and first floor
// walls on top of each other - silently wrong rather than obviously missing a
// feature, so this is the first thing built once real (multi-level) template
// data existed to test it against.
let activeLevel = null;

// Off (default): ghost the neighbouring level, like Revit's look-down
// underlay — or look-up when nothing sits below, so a foundation plan can
// still see the walls it carries. On: draw only the active level. Hit-testing
// always stays on the active level either way. The widget checkbox and the
// ribbon command share this flag.
let isolateCurrentLevel = window.localStorage.getItem("v2-level-isolate") === "1";

// Document -> Annotate -> Dimensions: automatic room/overall strings, shown
// while the two-point measure tool is armed so the pick has the existing
// layout sizes next to it.
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
  titleEl: el.massTitle,
  onDraw: syncLookPlan,
});

function syncLookPlan(cam, payload) {
  const isLook = cam?.mode === "look";
  if (el.massPanel) el.massPanel.classList.toggle("mass-panel--look", isLook);
  if (el.massPlanWrap) el.massPlanWrap.hidden = !isLook;
  if (el.massViewLabel) el.massViewLabel.textContent = isLook ? "What you will see" : cam?.mode === "section" ? "Section" : "3D";
  if (!isLook || !el.massPlanCanvas) return;
  drawLookPlan(el.massPlanCanvas, payload, cam);
  if (el.massCaption) {
    el.massCaption.textContent = `${lookPlanCaption(payload, cam)} · drag to look around · scroll to zoom`;
  }
}

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
    templatePack = normalizePackUnits(await res.json());
    pack = templatePack;
  } catch (err) {
    el.healthDot.classList.remove("ok");
    el.healthLabel.textContent = `Pack failed to load: ${err.message}`;
    return;
  }

  // Best-effort: a missing or unreachable rate book means every BOQ line
  // prices at "-", not that the pack itself failed to load.
  try {
    const rateRes = await fetch("../samples/tsp-rates.json");
    if (rateRes.ok) rateBook = await rateRes.json();
  } catch {
    rateBook = null;
  }
  el.healthDot.classList.add("ok");
  el.healthLabel.textContent = `${pack.skus.length} SKUs loaded`;
  el.packName.textContent = pack.name;

  store.doc.packId = pack.id;
  drawJobName();
  syncPackLevels();

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
  wireSchedule();
  wireAbout();
  wireSheets();
  wireJobName();
  wireAuth();
  wireLibrary();
  wireConflict();
  wireRibbonFit();
  resizeCanvas();
  new ResizeObserver(resizeCanvas).observe(el.canvasWrap);
  render();

  // Everything above is the editor, which is the same whoever is signed in.
  // This is what gives it a job to edit.
  await restoreSession();
}

// --- the account, and the job it owns ---------------------------------

/**
 * Boot's last step, and the sign-out path's landing point. There is no
 * anonymous mode to fall back to: the server is the system of record, so a
 * drawing has nowhere to be saved until an account owns it, and an editor that
 * accepted work it could not keep is the failure this plan was written about.
 */
async function restoreSession() {
  let session;
  try {
    session = await cloud.session();
  } catch (error) {
    // Unreachable is not signed out. Saying "sign in" to someone whose wifi
    // dropped sends them to type a password that will not go anywhere either.
    showAuth({ message: offlineMessage(error), signedOut: false });
    return;
  }
  if (!session) {
    showAuth();
    return;
  }
  await enterApp();
}

/**
 * Signed in: recover anything left in the old browser slot, then land somewhere.
 * The import runs first so that the recovered work is a candidate for being the
 * job we land in, rather than appearing behind it.
 *
 * Landing is the last job this account opened - the server's `opened_at`, which
 * `GET /api/projects/:id` maintains - because that is the job the person was in
 * when they closed the tab. A firm with no jobs at all gets the library and its
 * New button, not a canvas that looks like a drawing but belongs to no row.
 */
async function enterApp() {
  try {
    const recovered = await importLocalDocument({ storage: window.localStorage, cloud });
    if (recovered?.reason === "unreadable") {
      // Left in place on purpose - it is somebody's only copy - so say so
      // rather than letting it look imported.
      setStatusMessage("A drawing in this browser could not be read, and was left alone", "warn");
    }
    const projects = await cloud.listProjects();
    hideAuth();
    const mostRecent = projects.find((p) => p.openedAt) || projects[0];
    if (mostRecent) {
      await openJob({ cloud, sync, projectId: mostRecent.id, apply: applyOpenedJob });
      return;
    }
    await openLibrary({
      message: "No jobs yet. New job starts one - it saves to your firm's account as you draw.",
    });
  } catch (error) {
    if (error instanceof CloudError && error.authRequired) {
      showAuth({ message: "That session has expired. Sign in again." });
      return;
    }
    if (error instanceof NavigationBlocked) {
      // Reachable when a session is re-established with a queue still standing:
      // whatever is unconfirmed stays open rather than being replaced.
      setStatusMessage(error.message, "warn");
      return;
    }
    if (!(error instanceof CloudError)) {
      // A bug on this side, not a server that is down. Blaming the network for
      // it sends someone to check their wifi over a broken build, so it is
      // reported as what it is and left in the console to be read.
      console.error("opening a job failed", error);
      showAuth({ message: `This app hit an error opening your job: ${error?.message || error}` });
      return;
    }
    showAuth({ message: offlineMessage(error), signedOut: false });
  }
}

/**
 * Put a job the server just handed us into the editor, and point the save path
 * at it. The order matters: the document is in place before the transport is
 * attached, so the first thing sync knows about this drawing is that the server
 * already holds exactly it - and nothing is queued as if it were an edit.
 */
function applyOpenedJob({ project, drawing }) {
  openProject = project;
  openDrawingId = drawing.id;

  clearUnderlay(store.doc);
  store.doc = normalizeDoc(drawing.doc);
  if (!store.doc.packId) store.doc.packId = pack.id;
  store.clearSelection();
  // A job's undo history is its own. Carrying the previous job's stack across
  // would let Ctrl+Z paste one drawing into another.
  store.undoStack = [];
  underlaySelected = false;

  sync.attach({
    transport: httpTransport({
      drawingId: drawing.id,
      onAuthRequired: () => showAuth({ message: "That session has expired. Sign in again." }),
    }),
    // What the server holds, not the normalised copy in the store: see
    // reconcileNormalisation() below.
    doc: drawing.doc,
    revision: drawing.revision,
  });
  reconcileNormalisation(drawing.doc);

  // Sheets belong to the document, so the one being edited in the Sheets panel
  // belongs to the document that just closed.
  activeSheetId = store.doc.sheets?.[0]?.id || null;

  activeLevel = pack.system.defaultLevel;
  syncPackLevels();
  drawLevelSwitcher();
  drawJobName();
  render();
}

function offlineMessage(error) {
  return error instanceof CloudError && error.status === 0
    ? "No connection to the server. Your work is saved there, so this waits rather than opening something it cannot keep."
    : `The server could not be reached: ${error?.message || "unknown error"}`;
}

// --- the sign-in veil -------------------------------------------------

// Which of the two the form is doing. Sign-in first: creating a second account
// for a firm that already has one is the more expensive mistake.
let authMode = "sign-in";

function showAuth({ message = "", signedOut = true } = {}) {
  if (!el.auth) return;
  el.auth.hidden = false;
  setAuthError(message);
  // A dropped connection is not a credentials problem, so do not invite a
  // password that has nowhere to go; offer the retry instead.
  el.authForm?.classList.toggle("is-unreachable", !signedOut);
  el.authSubmit.textContent = signedOut ? submitLabel() : "Try again";
  el.authSubmit.dataset.retry = signedOut ? "" : "1";
  if (signedOut) el.authEmail?.focus();
}

function hideAuth() {
  if (!el.auth) return;
  el.auth.hidden = true;
  setAuthError("");
}

function setAuthError(message) {
  if (!el.authError) return;
  el.authError.textContent = message || "";
  el.authError.hidden = !message;
}

function submitLabel() {
  return authMode === "sign-in" ? "Sign in" : "Create account";
}

function drawAuthMode() {
  el.authTitle.textContent = authMode === "sign-in" ? "Sign in" : "Create an account";
  el.authKicker.textContent = authMode === "sign-in"
    ? "Your jobs are saved to your firm's account."
    : "One account per person, one firm per account.";
  el.authSubmit.textContent = submitLabel();
  el.authSubmit.dataset.retry = "";
  el.authToggle.textContent = authMode === "sign-in" ? "Create an account" : "I have an account";
  el.authOrgWrap.hidden = authMode === "sign-in";
  el.authPassword.autocomplete = authMode === "sign-in" ? "current-password" : "new-password";
  setAuthError("");
}

function wireAuth() {
  if (!el.authForm) return;

  el.authToggle.addEventListener("click", () => {
    authMode = authMode === "sign-in" ? "sign-up" : "sign-in";
    drawAuthMode();
  });

  el.authForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (el.authSubmit.disabled) return;

    // The unreachable-server case: there is nothing to submit, only something
    // to try again.
    if (el.authSubmit.dataset.retry === "1") {
      el.authSubmit.dataset.retry = "";
      await restoreSession();
      return;
    }

    const email = el.authEmail.value.trim();
    const password = el.authPassword.value;
    const orgName = el.authOrg.value.trim();

    el.authSubmit.disabled = true;
    el.authSubmit.textContent = authMode === "sign-in" ? "Signing in…" : "Creating…";
    setAuthError("");
    try {
      if (authMode === "sign-in") await cloud.signIn({ email, password });
      else await cloud.signUp({ email, password, orgName });
      // Not kept anywhere: the session is an httpOnly cookie, and this field
      // is the only place the password ever existed.
      el.authPassword.value = "";
      await enterApp();
    } catch (error) {
      setAuthError(error instanceof CloudError
        ? error.message
        : "Something went wrong signing in");
    } finally {
      el.authSubmit.disabled = false;
      el.authSubmit.textContent = submitLabel();
    }
  });

  drawAuthMode();
}

// --- the job library ---------------------------------------------------
//
// What replaced Open, New, Save As, Clear and the download. The decisions live
// in library.js so they can be tested without a DOM; this is the drawing of it,
// plus the honest refusals: nothing here opens another job while a write is
// unconfirmed, and nothing that needs the server is offered while there is no
// connection to it.

// The last list the server sent, so a row's action does not have to re-fetch to
// know what it is acting on.
let libraryProjects = [];
// The row whose name is currently an input, if any. Inline rename, one at a time.
let renamingProjectId = null;

/**
 * Why New / Duplicate / Delete / Rename cannot run right now, or null. Geometry
 * editing offline is step 7 and a merge engine is not being built here, so the
 * honest thing while the queue is backed up is to disable the commands that
 * need the server and say which they are.
 */
function connectionBlocked() {
  if (sync.state?.kind === "offline") {
    return "No connection to the server. New, Duplicate, Delete and Rename need one.";
  }
  if (sync.state?.kind === "conflict") {
    return "This drawing changed somewhere else. Choose which version to keep first.";
  }
  return null;
}

async function openLibrary({ message = "" } = {}) {
  if (!el.libraryOverlay) return;
  el.libraryOverlay.hidden = false;
  setLibraryMessage(message);
  await refreshLibrary({ keepMessage: Boolean(message) });
}

function closeLibrary() {
  if (!el.libraryOverlay) return;
  // With no job open there is nothing behind this but a canvas that belongs to
  // no row and cannot be saved, so the way out is New or Open, not Close.
  if (!openDrawingId) {
    setLibraryMessage("Open a job or start a new one - there is nothing open behind this.");
    return;
  }
  el.libraryOverlay.hidden = true;
  renamingProjectId = null;
}

/**
 * Deleted jobs are asked for too. A soft delete that disappeared from every
 * surface would not be undoable from anywhere, and the library is where §5 says
 * the undo lives.
 */
async function refreshLibrary({ keepMessage = false } = {}) {
  try {
    libraryProjects = await cloud.listProjects({ includeDeleted: true });
    if (!keepMessage) setLibraryMessage("");
  } catch (error) {
    libraryProjects = [];
    setLibraryMessage(libraryErrorMessage(error));
  }
  renderLibrary();
}

function setLibraryMessage(text) {
  if (!el.libraryMessage) return;
  el.libraryMessage.textContent = text || "";
  el.libraryMessage.hidden = !text;
}

function libraryErrorMessage(error) {
  if (error instanceof NavigationBlocked) return error.message;
  if (error instanceof CloudError && error.status === 0) {
    return "No connection to the server. The job list lives there, so it cannot be shown from here.";
  }
  if (error instanceof CloudError) return error.message;
  console.error("library command failed", error);
  return `This app hit an error: ${error?.message || error}`;
}

function renderLibrary() {
  if (!el.libraryList) return;
  const { jobs, deleted } = splitLibrary(libraryProjects);
  const blocked = connectionBlocked();

  el.libraryList.innerHTML = "";
  if (el.libraryNew) {
    el.libraryNew.disabled = Boolean(blocked);
    el.libraryNew.title = blocked || "Start a job and open it.";
  }
  if (el.libraryClose) {
    el.libraryClose.disabled = !openDrawingId;
    el.libraryClose.title = openDrawingId ? "" : "Open a job or start a new one first.";
  }

  if (!jobs.length && !deleted.length) {
    const empty = document.createElement("p");
    empty.className = "library-empty hint";
    empty.textContent = "No jobs on this account yet.";
    el.libraryList.appendChild(empty);
    return;
  }

  for (const project of jobs) el.libraryList.appendChild(libraryRow(project, blocked));

  if (deleted.length) {
    const heading = document.createElement("p");
    heading.className = "library-section";
    heading.textContent = "Deleted";
    el.libraryList.appendChild(heading);
    for (const project of deleted) el.libraryList.appendChild(libraryRow(project, blocked));
  }
}

function libraryRow(project, blocked) {
  const fields = jobRowFields(project);
  const isOpen = project.id === openProject?.id;

  const row = document.createElement("div");
  row.className = "library-row";
  row.classList.toggle("is-open", isOpen);
  row.classList.toggle("is-deleted", fields.deleted);

  if (renamingProjectId === project.id) {
    row.appendChild(renameField(project, fields));
  } else {
    const main = document.createElement("button");
    main.type = "button";
    main.className = "library-row-main";
    const name = document.createElement("span");
    name.className = "library-row-name";
    name.textContent = fields.nameLabel;
    const meta = document.createElement("span");
    meta.className = "library-row-meta";
    meta.textContent = [
      fields.erfLabel,
      fields.deleted ? "Deleted" : isOpen ? "Open now" : null,
      fields.lastOpened ? `Last opened ${fields.lastOpened}` : "Never opened",
    ].filter(Boolean).join(" · ");
    main.append(name, meta);
    main.disabled = fields.deleted || isOpen;
    main.title = fields.deleted
      ? "Restore this job before opening it."
      : isOpen ? "This job is open." : "Open this job.";
    main.addEventListener("click", () => runOpenJob(project));
    row.appendChild(main);
  }

  row.appendChild(rowActions(project, fields, { isOpen, blocked }));
  return row;
}

function renameField(project, fields) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "library-row-name-input";
  input.value = fields.name || "";
  input.placeholder = "Name this job";
  input.maxLength = 120;
  // Blur commits and Escape abandons, which is what an inline field in a list
  // does everywhere else. A rename that needed a separate Save button would be
  // a second save concept in an app that just removed the first.
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      renamingProjectId = null;
      renderLibrary();
    }
  });
  input.addEventListener("blur", () => {
    if (renamingProjectId !== project.id) return;
    runRename(project, input.value);
  });
  setTimeout(() => input.focus(), 0);
  return input;
}

function rowActions(project, fields, { isOpen, blocked }) {
  const actions = document.createElement("div");
  actions.className = "library-row-actions";

  const button = (label, title, disabled, onClick) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.title = title;
    btn.disabled = Boolean(disabled);
    if (!disabled) btn.addEventListener("click", onClick);
    actions.appendChild(btn);
    return btn;
  };

  if (fields.deleted) {
    button("Restore", blocked || "Bring this job back into the library.", blocked,
      () => runRestore(project));
    return actions;
  }

  // Offline caching is step 7. A badge that said "available on site" before the
  // cache exists would be the plausible default this app refuses: it would be
  // believed on the way to a plot with no signal.
  button("On site", "Marking a job for offline use lands with the offline step.", true, () => {});

  button("Rename", blocked || "Rename this job. The title block follows.", blocked, () => {
    renamingProjectId = project.id;
    renderLibrary();
  });
  button("Duplicate", blocked || "Copy this job to a new one, ending in \" (copy)\".", blocked,
    () => runDuplicate(project));
  button(
    "Delete",
    blocked || (isOpen ? "This job is open. Open another one first." : "Delete this job. Restore brings it back."),
    blocked || isOpen,
    () => runDelete(project),
  );
  return actions;
}

// --- the file commands -------------------------------------------------

/** `file-new`. A new row with a new drawing, and a navigation to it. */
async function runNewJob() {
  const blocked = connectionBlocked();
  if (blocked) {
    setLibraryMessage(blocked);
    setStatusMessage(blocked, "warn");
    return;
  }
  await runLibraryCommand(async () => {
    const doc = emptyDoc();
    doc.packId = pack.id;
    await createJob({
      cloud, sync, doc, packId: pack.id, openDrawingId, apply: applyOpenedJob,
    });
    closeLibraryAfterNavigation();
    setStatusMessage("New job started. It saves as you draw.", "ok");
  });
}

/** `file-open`. Flush, then attach to the other job - never the other way round. */
async function runOpenJob(project) {
  await runLibraryCommand(async () => {
    await openJob({ cloud, sync, projectId: project.id, apply: applyOpenedJob });
    closeLibraryAfterNavigation();
    setStatusMessage(`Opened ${store.doc.name || "an unnamed job"}.`, "ok");
  });
}

async function runRename(project, typed) {
  const name = typed.trim();
  renamingProjectId = null;
  const isOpen = project.id === openProject?.id;
  if (name === (project.name || "")) {
    renderLibrary();
    return;
  }
  await runLibraryCommand(async () => {
    const renamed = await renameJob({
      cloud, sync, projectId: project.id, name, open: isOpen, adopt: adoptRenamedDrawing,
    });
    if (isOpen) openProject = renamed;
    await refreshLibrary();
  });
}

/**
 * The rename came back having written `doc.name` and bumped the revision. Adopt
 * both, or the next autosave arrives with a stale If-Match and the job conflicts
 * with its own rename.
 */
function adoptRenamedDrawing(drawing) {
  store.doc.name = drawing.doc?.name ?? null;
  sync.adopt(drawing.doc, drawing.revision);
  reconcileNormalisation(drawing.doc);
  drawJobName();
  drawActiveSheet();
}

/** `file-duplicate`, the old Save As. It does not navigate: the copy is a row. */
async function runDuplicate(project) {
  await runLibraryCommand(async () => {
    const copy = await duplicateJob({
      cloud,
      projectId: project.id,
      sourceDrawingId: project.drawingId ?? null,
    });
    await refreshLibrary();
    setLibraryMessage(`Copied to "${copy.name}". Open it when you want it.`);
  });
}

async function runDelete(project) {
  await runLibraryCommand(async () => {
    await cloud.deleteProject(project.id);
    await refreshLibrary();
    // Not gone - moved. Saying so is the difference between a soft delete and a
    // shredder.
    setLibraryMessage(`"${project.name || "That job"}" is in Deleted below. Restore brings it back.`);
  });
}

async function runRestore(project) {
  await runLibraryCommand(async () => {
    await cloud.restoreProject(project.id);
    await refreshLibrary();
  });
}

/**
 * Demo house is a job of its own now. It used to overwrite whatever was open,
 * which is precisely the data loss the library exists to stop.
 */
async function runDemoHouse() {
  const blocked = connectionBlocked();
  if (blocked) {
    setStatusMessage(blocked, "warn");
    return;
  }
  await runLibraryCommand(async () => {
    await createJob({
      cloud,
      sync,
      doc: demoDoc(),
      name: "Demo house",
      packId: pack.id,
      openDrawingId,
      apply: applyOpenedJob,
    });
    closeLibraryAfterNavigation();
    setStatusMessage("Demo house created as its own job. Your other job is untouched.", "ok");
  });
}

/**
 * Sign-out revokes the session, so anything still queued would 401 on its way
 * out. It is flushed first and the sign-out is abandoned if that fails: losing
 * the queue here would be indistinguishable from losing the work.
 */
async function runSignOut() {
  try {
    await sync.flush();
    if (sync.isDirty()) {
      setLibraryMessage("This job has changes that have not reached the server. Signing out now would lose them.");
      return;
    }
    await cloud.signOut();
  } catch (error) {
    setLibraryMessage(libraryErrorMessage(error));
    return;
  }
  // Nothing to draw into and nowhere to draw it: the document goes back to
  // empty, and the save path is pointed at a transport that refuses rather than
  // at a drawing this browser is no longer allowed to write to.
  openProject = null;
  openDrawingId = null;
  libraryProjects = [];
  clearUnderlay(store.doc);
  store.doc = emptyDoc();
  store.doc.packId = pack.id;
  store.clearSelection();
  store.undoStack = [];
  activeSheetId = null;
  sync.attach({ transport: signedOutTransport(), doc: store.doc, revision: 0 });
  closeLibraryAfterNavigation();
  drawJobName();
  syncPackLevels();
  drawLevelSwitcher();
  render();
  showAuth({ message: "Signed out. Your jobs are on the account, not in this browser." });
}

function signedOutTransport() {
  return {
    read: () => null,
    put: () => { throw new AuthRequiredError(); },
  };
}

/**
 * Every library command in one wrapper, because they all fail the same three
 * ways: the app refused (a queue still standing), the server refused, or this
 * side has a bug. None of them may leave the list looking like it succeeded.
 */
async function runLibraryCommand(run) {
  try {
    await run();
  } catch (error) {
    const message = libraryErrorMessage(error);
    setLibraryMessage(message);
    setStatusMessage(message, "warn");
    if (error instanceof CloudError && error.authRequired) {
      showAuth({ message: "That session has expired. Sign in again." });
    }
    renderLibrary();
  }
}

function closeLibraryAfterNavigation() {
  renamingProjectId = null;
  if (el.libraryOverlay) el.libraryOverlay.hidden = true;
}

function wireLibrary() {
  el.libraryClose?.addEventListener("click", closeLibrary);
  el.libraryOverlay?.addEventListener("click", (event) => {
    if (event.target === el.libraryOverlay) closeLibrary();
  });
  el.libraryNew?.addEventListener("click", runNewJob);
  el.librarySignOut?.addEventListener("click", runSignOut);
}

// --- the job's name and its save state --------------------------------

/**
 * Whatever sync.js reports, in its own words. The wording lives there so this
 * file cannot drift into calling an unconfirmed write "Saved".
 */
function drawSyncState(state) {
  if (!el.syncState) return;
  el.syncState.textContent = syncStateLabel(state);
  el.syncState.dataset.kind = state?.kind || "saved";
  el.syncState.title = state?.kind === "conflict"
    ? "This drawing changed somewhere else. Reload it to take those changes, or keep editing to overwrite them."
    : "";
  drawConflictBar(state);
  // The library's commands are disabled by the same state, so it has to hear
  // about a dropped connection too - but not mid-rename, where re-rendering
  // would blur the field and commit whatever had been typed so far.
  if (el.libraryOverlay && !el.libraryOverlay.hidden && !renamingProjectId) renderLibrary();
}

/**
 * A 409 is the one save state the user has to answer, so it gets a bar with two
 * buttons rather than a word in the chrome. Neither is a default and neither is
 * pre-selected: choosing for them is the silent merge §4 refuses.
 */
function drawConflictBar(state) {
  if (!el.conflict) return;
  const conflicted = state?.kind === "conflict";
  el.conflict.hidden = !conflicted;
  if (!conflicted) return;
  el.conflictText.textContent = state.conflict?.doc
    ? "This drawing changed somewhere else — another tab, or the tablet on site."
    : "This drawing changed somewhere else, and that version could not be read.";
  // Nothing to reload if their document did not arrive with the refusal.
  el.conflictTheirs.disabled = !state.conflict?.doc;
}

function wireConflict() {
  el.conflictTheirs?.addEventListener("click", () => {
    const theirs = sync.state?.conflict?.doc;
    if (!theirs) return;
    // Their document becomes the open one and the local queue is dropped, which
    // is the whole point of choosing this button.
    applyTheirDocument(theirs);
    setStatusMessage("Reloaded the version saved elsewhere");
  });

  el.conflictMine?.addEventListener("click", async () => {
    // Their revision is adopted only so the next If-Match matches; the queued
    // documents are still sent, in order.
    await sync.resolveWithMine();
    setStatusMessage("Saved your version over the one from elsewhere");
  });
}

function applyTheirDocument(theirDoc) {
  clearUnderlay(store.doc);
  store.doc = normalizeDoc(theirDoc);
  if (!store.doc.packId) store.doc.packId = pack.id;
  store.clearSelection();
  // The undo stack describes edits to a document that is no longer open.
  store.undoStack = [];
  underlaySelected = false;

  // Adopted against what the server actually holds, not against the normalised
  // copy in the store: those two can differ, and calling the difference saved
  // would leave a change that never gets written.
  sync.resolveWithTheirs(theirDoc);
  reconcileNormalisation(theirDoc);

  syncPackLevels();
  drawLevelSwitcher();
  drawJobName();
  render();
}

/**
 * Normalising an incoming document can fill in keys it never had - an id, a
 * room's default SKUs, a level. That difference is a real change the server has
 * not seen, so it queues as one rather than being assumed away; if there is no
 * difference this does nothing, because the signature matches.
 */
function reconcileNormalisation(serverDoc) {
  if (docSignature(store.doc) !== docSignature(serverDoc)) store.persist();
}

function drawJobName() {
  if (!el.jobName) return;
  const name = store.doc.name || "";
  if (el.jobName.value !== name) el.jobName.value = name;
}

function wireJobName() {
  el.jobName?.addEventListener("input", () => {
    // Blank means unnamed, not the string "": the title block prints an
    // em-dash for a fact the document does not have.
    const typed = el.jobName.value.trim();
    store.doc.name = typed || null;
    store.persist();
    drawActiveSheet();
  });

  // Two things a browser tab does that a save schedule has to respect: it gets
  // hidden (the phone locked, the tab switched) and it goes away.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") sync.flush();
  });
  window.addEventListener("beforeunload", (ev) => {
    sync.flush();
    if (!sync.isDirty()) return;
    // Only reached when a write is still unconfirmed, which is the one case
    // where the browser's own warning is telling the truth.
    ev.preventDefault();
    ev.returnValue = "";
  });
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
  get cam() { return cam; },
  get placeSkuId() { return placeSkuId; },
  get hoverPoint() { return hoverPoint; },
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
 * The grid step used when moving a selection. Draw tools prefer the
 * millimetre magnets in snap.js instead: those round a length from the
 * start of the run, which a world grid cannot do once the start is off-grid.
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
 * The point a live length should round from: the wall/beam start, the
 * anchored end of a stretch, or the first corner of a room/slab/roof drag.
 */
function snapFrom() {
  if (drag?.kind === "wall-new") return { x: drag.x1, y: drag.y1 };
  if (drag?.kind === "segment-end") return { x: drag.fx, y: drag.fy };
  if (drag?.kind?.endsWith("-new") && drag.x0 != null) return { x: drag.x0, y: drag.y0 };
  if (beamStart) return beamStart;
  if (measureDraft?.a) return measureDraft.a;
  return null;
}

/**
 * Resolve a candidate world point to where it should actually land: an exact
 * join with another wall/beam endpoint or room corner, an alignment guide
 * (same X or Y as one of those points), or - failing both - a round millimetre
 * offset from the run's start / a nearby object. Round lengths (3500 mm) are
 * magnetic; 1 mm values stay reachable once the zoom tightens the magnet.
 * Always writes `snapGuide` so tracking lines and offset labels can follow
 * the pointer before the first click, not only mid-drag.
 */
function applySnap(wx, wy, exclude) {
  const targets = collectSnapTargets(store.doc, snapOpts(exclude));
  const edges = collectSnapEdges(store.doc, snapOpts(exclude));
  const tol = SNAP_PIXEL_TOL / cam.scale;
  const result = snapPoint(wx, wy, targets, tol);
  const align = nearestAlignments(wx, wy, targets, edges);
  const from = snapFrom();
  const originsX = [];
  const originsY = [];
  if (from) {
    originsX.push(from.x);
    originsY.push(from.y);
  }
  const near = align.nearest && align.dist <= GAP_MAX_M;
  if (near) {
    originsX.push(align.nearest.x);
    originsY.push(align.nearest.y);
  }
  originsX.push(0);
  originsY.push(0);
  const point = applyNicePoint(wx, wy, {
    join: result,
    from,
    originsX,
    originsY,
    tolWorld: tol,
    minStep: NICE_MIN_STEP_M,
  });
  const origin = near ? align.nearest : null;
  snapGuide = {
    x: point.x,
    y: point.y,
    // Infinite tracking lines only when actually latched. Unsnapped gaps
    // use the origin mark + dimension string instead, so a leftover X from
    // one corner and a leftover Y from another cannot meet in empty space.
    guideX: result.guideX ?? null,
    guideY: result.guideY ?? null,
    // The point that put the guide there, so drawSnapGuide can show how far
    // along the line it actually sits instead of just tracking off-screen.
    guideXPoint: result.guideXPoint ?? null,
    guideYPoint: result.guideYPoint ?? null,
    snapped: result.snapped,
    snapX: result.guideX != null,
    snapY: result.guideY != null,
    origin,
    dx: origin ? point.x - origin.x : null,
    dy: origin ? point.y - origin.y : null,
    probes: buildProbes(point, edges),
    tol,
  };
  return point;
}

function buildProbes(point, edges) {
  return resolveProbes(point.x, point.y, [probeSide.h, probeSide.v].filter(Boolean), edges);
}

function snapPreviewTool() {
  return tool === "wall" || tool === "beam" || tool === "room" || tool === "slab"
    || tool === "roof" || tool === "property" || tool === "sg-ref" || tool === "camera" || tool === "section"
    || tool === "measure";
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

function placementStatus() {
  return placeStatus === "existing" ? "existing" : "planned";
}

function planObjectVisible(obj) {
  return statusVisible(obj?.status, planStatusFilter);
}

function planRefVisible(ref) {
  if (!ref) return false;
  const obj = objByRef(ref);
  if (!obj || !planObjectVisible(obj)) return false;
  if (ref.kind === "opening") {
    const wall = wallForOpening(store.doc, pack, wallsCache, obj);
    if (!wall || !planObjectVisible(wall)) return false;
  }
  return true;
}

function pruneInvisibleSelection() {
  if (!store.selected.length) return;
  const kept = store.selected.filter(planRefVisible);
  if (kept.length === store.selected.length) return;
  if (!kept.length) {
    store.clearSelection();
    return;
  }
  const primaryKept = store.primary && kept.some((r) => r.kind === store.primary.kind && r.id === store.primary.id);
  store.setSelection(kept, primaryKept ? store.primary : kept[0]);
}

function snapOpts(extra = {}) {
  return { ...extra, include: planObjectVisible };
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

/** Thin wrappers over level-view.js's pure floor-reveal logic, binding it to
 * this document's pack and `doc.floorsRevealed`. Kept pure and testable in
 * level-view.js; only the wiring to `pack`/`store` lives here.
 * `drawLevelSwitcher()` is the only place `visibleLevels()` should feed the
 * widget from; everything downstream (station build, house geometry,
 * keyboard paging, the inspector cut list) reads its result via
 * `widgetLevels` / `houseStations`. */
function floorsAvailableToAdd() {
  return floorsAvailableToAddFor(pack.levels);
}
function canAddFloor() {
  return canAddFloorFor(pack.levels, store.doc?.floorsRevealed);
}
function visibleLevels() {
  return visibleLevelsFor(pack.levels, store.doc?.floorsRevealed);
}

/** Reveals the next template storey, capped at MAX_FLOORS_TO_ADD. No-ops
 * past the cap or once the template has no more storeys to offer. */
function addFloor() {
  if (!canAddFloor()) return;
  store.doc.floorsRevealed = (store.doc.floorsRevealed || 0) + 1;
  store.persist();
  drawLevelSwitcher();
  drawRibbon();
  render();
}

// --- Insert level -------------------------------------------------------
//
// The template's four storeys are the default stack, not the limit
// (PHILOSOPHY.md): a third storey, a mezzanine or a different floor-to-floor
// is a storey the user supplies. Open while the panel is showing.
let levelInsertOpen = false;

/** Fold `doc.levels` into the pack every consumer reads. Called after boot and
 * after any change to the document's own levels; `templatePack` is never
 * mutated, so a re-export of the template cannot be polluted by a job. */
function syncPackLevels() {
  const own = store.doc?.levels || [];
  pack = own.length
    ? { ...templatePack, levels: mergedLevels(templatePack.levels, own) }
    : templatePack;
}

function openLevelInsert() {
  levelInsertOpen = true;
  if (el.levelName) el.levelName.value = "";
  if (el.levelElevation) el.levelElevation.value = "";
  render();
  el.levelName?.focus();
}

function closeLevelInsert() {
  levelInsertOpen = false;
  render();
}

function syncLevelPanel() {
  if (!el.levelPanel) return;
  el.levelPanel.hidden = !levelInsertOpen;
}

/** Commit the panel's two fields, or report the one reason they were refused. */
function commitLevelInsert() {
  const spec = { name: el.levelName?.value, elevation: el.levelElevation?.value };
  const check = validateLevelInsert(pack.levels || [], spec);
  if (!check.ok) {
    if (el.levelHint) el.levelHint.textContent = check.message;
    setStatusMessage(check.message, "warn");
    return;
  }
  store.pushUndo();
  store.doc.levels = insertLevelInto(store.doc.levels, spec);
  syncPackLevels();
  store.persist();
  levelInsertOpen = false;
  if (el.levelHint) el.levelHint.textContent = "Name the storey and its elevation above the ground floor.";
  drawLevelSwitcher();
  drawRibbon();
  render();
  // Floor-to-ceiling is null on an inserted level, so say so once here rather
  // than letting the Part C check be the first place the user learns it.
  setStatusMessage(
    `${String(spec.name).trim()} inserted. Its floor-to-ceiling height is unknown, so Part C reports "cannot check" on this storey until the firm supplies one.`,
    "warn"
  );
}

/** True if `levelId` is a below-datum (foundation-kind) level. Same test as
 * `buildHouseStations`'s `isFoundation`, so the level switcher and the
 * ribbon's placement warning never disagree on what counts as a foundation
 * storey. */
function isFoundationLevel(levelId) {
  const level = (pack.levels || []).find((l) => l.id === levelId);
  return levelIsFoundation(level);
}

/** The category (or categories) the currently armed tool would place, from
 * whichever source is live: a ribbon function's declared categories, or a
 * single type picked directly from the palette. Null while nothing is armed. */
function armedCategories() {
  if (paletteFilter) return paletteFilter;
  const sku = skuById(placeSkuId);
  return sku ? [sku.category] : null;
}

/** Warning copy when the armed tool does not belong on the current cut
 * (a roof on "00 FOUNDATION", a foundation on a ceiling plan). Null when
 * the pair is not something the app can rule out. */
function placementCutWarning() {
  const level = (pack.levels || []).find((l) => l.id === activeLevel);
  return placementHintOverride({
    tool,
    stationKind: houseStations[activeStationIndex()]?.kind,
    level,
    categories: armedCategories(),
  });
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
// The filtered `visibleLevels()` result the current `houseStations` was
// built from - `selectStationIndex()` must resolve a station's `levelIndex`
// against this, not the full `orderedLevels()`, or an index built from a
// floors-revealed-filtered list would resolve against the wrong level once
// any storey is hidden.
let widgetLevels = [];
let houseZToY = () => 0;
let houseYToZ = () => 0;
let houseCutGroup = null;
let houseGhostGroup = null;
let houseGhostBg = null;
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
  const levels = visibleLevels();
  widgetLevels = levels;
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
      .house-ghost.on { opacity: 1; }
      .house-ghost line { stroke: #b2451e; stroke-width: 1.1; stroke-dasharray: 3.2 2.4; opacity: 0.55; }
      .house-ghost-chip { fill: #f6f1e8; stroke: #c0b4a2; stroke-width: 0.8; }
      .house-ghost text { fill: #1a1612; font-size: 14px; font-weight: 600; font-family: "Source Sans 3", sans-serif; }
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

  houseGhostLabel = svgEl("text", { x: String(xLeft + 8), y: "-5" });
  houseGhostBg = svgEl("rect", { class: "house-ghost-chip", rx: "2.5", ry: "2.5" });
  houseGhostGroup = svgEl("g", { class: "house-ghost" });
  houseGhostGroup.append(
    svgEl("line", { x1: xLeft, y1: 0, x2: HOUSE_RAIL_X - 7, y2: 0 }),
    houseGhostBg,
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
function selectStationIndex(idx, { keepSelection = false } = {}) {
  const s = houseStations[idx];
  if (!s) return;
  const level = widgetLevels[s.levelIndex];
  const levelChanged = level && level.id !== activeLevel;
  if (s.id === activeStationId && !levelChanged) return;
  activeStationId = s.id;
  if (levelChanged) {
    activeLevel = level.id;
    beamStart = null;
    drag = null;
    if (!keepSelection) store.clearSelection();
    drawRibbon();
  } else {
    // Same storey, different cut (floor → ceiling). The armed tool may now
    // be the wrong kind of work for this plan — refresh the hint without
    // rebuilding the whole ribbon.
    updateRibbonHint();
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
  const cutY = houseZToY(s.elevation);
  houseGhostGroup.setAttribute("transform", `translate(0 ${cutY})`);
  layoutHouseGhostLabel(s.label, cutY);
  houseGhostGroup.classList.add("on");
}

/** Paper chip beside the dashed preview cut. The old 8.5px copper text sat
 * at 40% opacity and was clipped by the viewBox, so long names such as
 * "First Floor (inferred) · Floor" were unreadable on hover. */
function layoutHouseGhostLabel(label, cutY) {
  if (!houseGhostLabel || !houseGhostBg) return;
  const xLeft = HOUSE_X0 - 8;
  const x = xLeft + 8;
  const padX = 4.5;
  const chipH = 16;
  const maxW = HOUSE_RAIL_X - 12 - x;
  houseGhostLabel.setAttribute("x", String(x));
  houseGhostLabel.setAttribute("font-size", "14");
  houseGhostLabel.textContent = label;
  let tw = houseGhostLabel.getComputedTextLength();
  if (tw > maxW - padX * 2) {
    houseGhostLabel.setAttribute("font-size", "12");
    tw = houseGhostLabel.getComputedTextLength();
  }
  const w = Math.min(maxW, tw + padX * 2);
  // Roof/eaves sits near the top of the viewBox; flip the chip under the
  // dashed line so it is not clipped off the drawing.
  const above = cutY - chipH - 2 >= 1;
  const chipY = above ? -chipH - 2 : 3;
  houseGhostLabel.setAttribute("y", String(chipY + 12.2));
  houseGhostBg.setAttribute("x", String(x - padX));
  houseGhostBg.setAttribute("y", String(chipY));
  houseGhostBg.setAttribute("width", String(w));
  houseGhostBg.setAttribute("height", String(chipH));
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
    // Arrows deliberately do not page the cut: they pin which side the live
    // measurements report (see probeSide), which is wanted far more often
    // than stepping a storey. PageUp/PageDown/Home/End still page.
    if (e.key === "PageUp") {
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

  el.levelIsolate?.addEventListener("change", () => {
    setIsolateCurrentLevel(el.levelIsolate.checked);
  });
  syncLevelIsolateControl();
}

/** Widget checkbox and ribbon share one flag; keep the box in the same
 * state the plan is actually drawing. */
function syncLevelIsolateControl() {
  if (el.levelIsolate) el.levelIsolate.checked = isolateCurrentLevel;
}

function setIsolateCurrentLevel(on) {
  isolateCurrentLevel = Boolean(on);
  window.localStorage.setItem("v2-level-isolate", isolateCurrentLevel ? "1" : "0");
  syncLevelIsolateControl();
  drawRibbon();
  render();
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

/** Centred "Nothing drawn" copy is only for an idle plan. Hide it once the user
 * is working on the canvas: geometry, a selection, an armed tool, a draft, or
 * a visible underlay to trace. */
function shouldHidePlanEmpty() {
  if (store.hasContent()) return true;
  if (store.selected.length) return true;
  if (underlaySelected || underlayIsVisible()) return true;
  if (drag || beamStart || siteDraft?.length || sgPick || attachPick || calibration) return true;
  if (activeFunction) return true;
  if (tool !== "select") return true;
  return false;
}

function draw() {
  const rect = el.canvasWrap.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  if (!pack) return;

  drawUnderlay(ctx, store.doc, worldToScreen, cam.scale);
  drawGrid(rect);
  drawSiteLines();
  const walls = currentWalls();
  pruneInvisibleSelection();
  const levelWalls = walls.filter(onActiveLevel);

  ctx.save();
  // While picking an attach target, everything that cannot be picked fades and
  // the candidates are re-drawn on top: the wrong thing is never clickable
  // rather than clickable-and-then-refused.
  if (attachPick) ctx.globalAlpha = 0.3;
  if (!isolateCurrentLevel) {
    const ghost = ghostContext(pack.levels, activeLevel);
    if (ghost) drawPlanLevel(ghost.levelId, walls, { ghost: true, look: ghost.look });
  }
  drawPlanLevel(activeLevel, walls);
  ctx.restore();
  if (attachPick) drawAttachCandidates();
  if (showDimensions) drawDimensions();
  if (tool === "measure") drawUserDimensions();

  drawSelectionHighlights(levelWalls);
  if (hover && !store.isSelected(hover.kind, hover.id) && tool === "select" && !drag) drawHover(hover);
  if (drag?.kind === "marquee") drawMarquee();
  if (drag?.kind === "wall-new") drawWallDraft();
  if (drag?.kind?.endsWith("-new") && drag.kind !== "wall-new") drawShapeDraft();
  if (beamStart) drawBeamStart();
  if (tool === "property" && siteDraft) drawPropertyDraft();
  if (tool === "sg-ref" && sgPick) drawSgPick();
  if (tool === "camera" && cameraDraft?.a) drawCameraDraft();
  if (tool === "section" && sectionDraft?.a) drawSectionDraft();
  if (tool === "measure" && measureDraft?.a) drawMeasureDraft();
  drawSnapGuide(rect);
  drawEndpointHandles();
  drawUnderlayHandles();
  if (calibration?.a) drawCalibration();
  drawOpeningDraft(walls);

  el.empty.hidden = shouldHidePlanEmpty();
  el.legend.hidden = !store.hasContent();
  el.canvasWrap.classList.toggle("tool-opening", tool === "door" || tool === "window");
}

/** Selection outline plus the four corner-scale handles and the free-rotate handle. */
const UNDERLAY_DRAG_KINDS = new Set(["underlay-move", "underlay-scale", "underlay-rotate"]);

/** Corner handles while the sheet is selected, and again once both scale points are down so the measured length can be resized into. */
function underlayHandlesActive() {
  if (!underlayIsVisible()) return false;
  if (tool === "select" && underlaySelected) return true;
  if (tool === "calibrate" && calibration?.b) return true;
  return false;
}

function drawUnderlayHandles() {
  if (!underlayHandlesActive()) return;
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
  const a = liveCalibrationPoint(calibration.a);
  if (!a) return;
  const target = liveCalibrationPoint(calibration.b) || hoverPoint;
  const [ax, ay] = worldToScreen(a.x, a.y);
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
  if (target) drawLengthLabel(a.x, a.y, target.x, target.y);
}

function drawCameraDraft() {
  const target = hoverPoint;
  const [ax, ay] = worldToScreen(cameraDraft.a.x, cameraDraft.a.y);
  ctx.save();
  ctx.strokeStyle = COLOUR.hover;
  ctx.fillStyle = COLOUR.hover;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(ax, ay, 5, 0, Math.PI * 2);
  ctx.fill();
  if (target) {
    const [bx, by] = worldToScreen(target.x, target.y);
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
    const ang = Math.atan2(by - ay, bx - ax);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - 12 * Math.cos(ang - 0.4), by - 12 * Math.sin(ang - 0.4));
    ctx.lineTo(bx - 12 * Math.cos(ang + 0.4), by - 12 * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawSectionDraft() {
  const target = hoverPoint;
  const [ax, ay] = worldToScreen(sectionDraft.a.x, sectionDraft.a.y);
  ctx.save();
  ctx.strokeStyle = COLOUR.hover;
  ctx.fillStyle = COLOUR.hover;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(ax, ay, 4, 0, Math.PI * 2);
  ctx.fill();
  if (target) {
    const [bx, by] = worldToScreen(target.x, target.y);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(bx, by, 4, 0, Math.PI * 2);
    ctx.fill();
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const lx = -dy / len;
    const ly = dx / len;
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(mx + lx * 22, my + ly * 22);
    ctx.stroke();
    const tx = mx + lx * 22;
    const ty = my + ly * 22;
    const ang = Math.atan2(ly, lx);
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - 10 * Math.cos(ang - 0.45), ty - 10 * Math.sin(ang - 0.45));
    ctx.lineTo(tx - 10 * Math.cos(ang + 0.45), ty - 10 * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

let lastRibbonHasSelection = null;

function render() {
  draw();
  syncSizeHud();
  syncPlanContext();
  syncUnderlayPanel();
  syncCalibratePanel();
  syncSgPanel();
  syncLevelPanel();
  syncAttachPanel();
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
        : "Drag a corner to resize — the measured length updates — or type the real distance and Set scale.";
  }
  if (bSet && !calibration.distanceEdited && el.calibrateDistance && document.activeElement !== el.calibrateDistance) {
    const guess = calibrationDistanceGuess(liveCalibrationPoint(calibration.a), liveCalibrationPoint(calibration.b));
    if (guess) el.calibrateDistance.value = guess.toFixed(2);
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
 * reads as context, not as the plan you are editing. Look-up ghosts are
 * wall/beam markers only: a faded thick wall on a foundation cut would
 * read as a second foundation, not as "the wall that sits on this". */
function drawPlanLevel(levelId, walls, { ghost = false, look = "down" } = {}) {
  ctx.save();
  if (ghost && look === "up") {
    for (const wall of walls.filter((w) => w.level === levelId && planObjectVisible(w))) drawWall(wall, { marker: true });
    for (const beam of store.doc.beams.filter((b) => onLevel(b, levelId) && planObjectVisible(b))) drawBeam(beam, { marker: true });
    ctx.restore();
    return;
  }
  if (ghost) ctx.globalAlpha = 0.28;
  for (const slab of store.doc.slabs.filter((s) => onLevel(s, levelId) && planObjectVisible(s))) {
    drawPolyFill(shapePolygon(slab.shape), COLOUR.slab, statusStroke(objectStatus(slab)));
  }
  for (const roof of store.doc.roofs.filter((r) => onLevel(r, levelId) && planObjectVisible(r))) {
    const poly = shapePolygon(roof.shape);
    drawPolyFill(poly, COLOUR.roof, statusStroke(objectStatus(roof)));
    drawRoofGuides(bbox(poly), roof.form, roof.ridge);
  }
  for (const room of store.doc.rooms.filter((r) => onLevel(r, levelId) && planObjectVisible(r))) {
    if (ghost) drawRoomGhost(room);
    else drawRoom(room);
  }
  for (const wall of walls.filter((w) => w.level === levelId && planObjectVisible(w))) drawWall(wall);
  for (const beam of store.doc.beams.filter((b) => onLevel(b, levelId) && planObjectVisible(b))) drawBeam(beam);
  if (!ghost) {
    for (const item of store.doc.items.filter((i) => onLevel(i, levelId) && planObjectVisible(i))) drawItem(item);
  }
  for (const opening of store.doc.openings.filter((o) => openingOnLevel(o, walls, levelId) && planObjectVisible(o))) {
    const wall = wallForOpening(store.doc, pack, walls, opening);
    if (wall && !planObjectVisible(wall)) continue;
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

function drawWall(wall, { marker = false } = {}) {
  const [ax, ay] = worldToScreen(wall.x1, wall.y1);
  const [bx, by] = worldToScreen(wall.x2, wall.y2);
  ctx.save();
  if (marker) {
    drawAboveMarker(ax, ay, bx, by);
  } else {
    ctx.strokeStyle = wall.drawn ? statusStroke(wall.status) : COLOUR.wall;
    ctx.lineWidth = Math.max(2, wall.thickness * cam.scale);
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  ctx.restore();
}

/** Dashed centreline plus end ticks: "a wall sits here above this cut." */
function drawAboveMarker(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const tx = (-dy / len) * 5;
  const ty = (dx / len) * 5;
  ctx.strokeStyle = "#b2451e";
  ctx.lineWidth = 1.6;
  ctx.lineCap = "butt";
  ctx.setLineDash([6, 4]);
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(ax - tx, ay - ty);
  ctx.lineTo(ax + tx, ay + ty);
  ctx.moveTo(bx - tx, by - ty);
  ctx.lineTo(bx + tx, by + ty);
  ctx.stroke();
}

function drawOpeningDraft(walls) {
  if (tool !== "door" && tool !== "window") return;
  if (!hoverPoint || !placeSkuId) return;
  const levelWalls = walls.filter(onActiveLevel);
  const draft = openingDraftAt(store.doc, pack, levelWalls, placeSkuId, hoverPoint.x, hoverPoint.y);
  if (!draft) return;
  drawOpening(draft, walls, { preview: true });
  drawOpeningSideGaps(draft, walls);
}

/** How far the previewed door/window sits from both ends of its host wall. */
function drawOpeningSideGaps(draft, walls) {
  const wall = wallForOpening(store.doc, pack, walls, draft);
  if (!wall) return;
  const placed = openingOnWall(store.doc, pack, draft, wall);
  if (!placed) return;
  const neighbors = [];
  for (const opening of store.doc.openings || []) {
    if (!openingOnLevel(opening, walls, activeLevel)) continue;
    const host = wallForOpening(store.doc, pack, walls, opening);
    if (!host || host.id !== wall.id) continue;
    const next = openingOnWall(store.doc, pack, opening, host);
    if (next) neighbors.push(next);
  }
  for (const gap of openingSideGaps(wall, placed, neighbors)) {
    drawGapDimension(gap.x1, gap.y1, gap.x2, gap.y2);
  }
}

function drawOpening(opening, walls, { preview = false } = {}) {
  const wall = wallForOpening(store.doc, pack, walls, opening);
  if (!wall) return;
  const placed = openingOnWall(store.doc, pack, opening, wall);
  if (!placed?.sku) return;
  const { sku, width, a, b } = placed;
  const [sax, say] = worldToScreen(a.x, a.y);
  const [sbx, sby] = worldToScreen(b.x, b.y);
  ctx.save();
  ctx.globalAlpha = preview ? 0.55 : 1;
  ctx.lineCap = "butt";
  ctx.strokeStyle = "#f3eee4";
  ctx.lineWidth = Math.max(4, (wall.thickness || 0.22) * cam.scale + 2);
  ctx.beginPath();
  ctx.moveTo(sax, say);
  ctx.lineTo(sbx, sby);
  ctx.stroke();
  ctx.strokeStyle = sku.category === "window" ? COLOUR.window : COLOUR.door;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(sax, say);
  ctx.lineTo(sbx, sby);
  ctx.stroke();
  if (sku.category === "window") {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const n = wallNormal(wall, 1);
    const sill = 0.08;
    const [px, py] = worldToScreen(mx - n.x * sill, my - n.y * sill);
    const [qx, qy] = worldToScreen(mx + n.x * sill, my + n.y * sill);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(qx, qy);
    ctx.stroke();
  }
  if (sku.category === "door") {
    const n = wallNormal(wall, opening.swing || 1);
    const [hx, hy] = worldToScreen(a.x, a.y);
    const [ex, ey] = worldToScreen(a.x + n.x * width, a.y + n.y * width);
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(ex, ey);
    ctx.lineTo(sbx, sby);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDimensions() {
  const boxes = store.doc.rooms.filter((r) => onActiveLevel(r) && planObjectVisible(r)).map((r) => bbox(roomPolygon(r)));
  for (const line of planDimensionLines(boxes)) drawDimensionLine(line);
}

function measureLivePoint() {
  if (snapGuide) return { x: snapGuide.x, y: snapGuide.y };
  return hoverPoint;
}

function drawUserDimensions() {
  for (const dim of userDimensions) drawPickedDimension(dim.a, dim.b, dim.label);
}

function drawMeasureDraft() {
  const target = measureLivePoint();
  if (!target) {
    const [ax, ay] = worldToScreen(measureDraft.a.x, measureDraft.a.y);
    ctx.save();
    ctx.fillStyle = COLOUR.hover;
    ctx.beginPath();
    ctx.arc(ax, ay, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  const live = pickedDimension(measureDraft.a, target);
  drawPickedDimension(measureDraft.a, target, live?.label);
}

function drawPickedDimension(a, b, label) {
  const [ax, ay] = worldToScreen(a.x, a.y);
  const [bx, by] = worldToScreen(b.x, b.y);
  ctx.save();
  ctx.strokeStyle = COLOUR.hover;
  ctx.fillStyle = COLOUR.hover;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(ax, ay, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(bx, by, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.restore();
  if (label) drawLengthLabel(a.x, a.y, b.x, b.y);
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

function drawBeam(beam, { marker = false } = {}) {
  const [ax, ay] = worldToScreen(beam.x1, beam.y1);
  const [bx, by] = worldToScreen(beam.x2, beam.y2);
  ctx.save();
  if (marker) {
    drawAboveMarker(ax, ay, bx, by);
  } else {
    const sku = skuById(beam.sku);
    ctx.strokeStyle = statusStroke(objectStatus(beam));
    ctx.lineWidth = Math.max(3, (sku?.geometry?.width || 0.11) * cam.scale);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
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

/** The pickable attach targets, at full strength over the faded plan, with the
 * one under the pointer heavier still. */
function drawAttachCandidates() {
  const hoverKey = attachPick.hover ? attachRefKey(attachPick.hover) : null;
  ctx.save();
  ctx.lineCap = "round";
  for (const ref of attachPick.candidates) {
    const obj = objByRef(ref);
    if (!obj) continue;
    const [ax, ay] = worldToScreen(obj.x1, obj.y1);
    const [bx, by] = worldToScreen(obj.x2, obj.y2);
    const active = attachRefKey(ref) === hoverKey;
    ctx.strokeStyle = active ? COLOUR.hover : COLOUR.selection;
    ctx.lineWidth = active ? 6 : 3;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  ctx.restore();
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

/** Rubber-band rectangle while dragging a new room, slab or roof. Roofs
 * also show the ridge/hip/fall that commitRoof() will apply (gable along
 * the long side), so the eaves you are sizing are not a blank box. */
function drawShapeDraft() {
  const r = drag?.rect;
  if (!r || r.w < 0.05 || r.h < 0.05) return;
  const [sx, sy] = worldToScreen(r.x, r.y);
  const [ex, ey] = worldToScreen(r.x + r.w, r.y + r.h);
  const isRoof = drag.kind === "roof-new";
  ctx.save();
  ctx.fillStyle = isRoof ? COLOUR.roof : drag.kind === "slab-new" ? COLOUR.slab : "rgba(180, 69, 30, 0.08)";
  ctx.strokeStyle = isRoof ? "#3a5f7a" : statusStroke(placementStatus());
  ctx.lineWidth = 1.4;
  ctx.setLineDash([5, 4]);
  ctx.fillRect(sx, sy, ex - sx, ey - sy);
  ctx.strokeRect(sx, sy, ex - sx, ey - sy);
  ctx.restore();
  if (isRoof) drawRoofGuides(r, "gable", "long");
}

function drawRoofGuides(rect, form, ridge) {
  const lines = roofGuideLines(rect, form, ridge);
  if (!lines.length) return;
  ctx.save();
  ctx.strokeStyle = "#3a5f7a";
  for (const line of lines) {
    const [ax, ay] = worldToScreen(line.x1, line.y1);
    const [bx, by] = worldToScreen(line.x2, line.y2);
    ctx.lineWidth = line.kind === "ridge" || line.kind === "high" ? 1.6 : 1.2;
    ctx.setLineDash(line.kind === "high" ? [] : [5, 4]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
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

/** Live snap-gap dimension: a string offset beside the tracking line, with
 * arrowheads at both witnesses, like `<-- 240 mm -->`. `kind` is the
 * measured axis (`h` = east-west gap, `v` = north-south) so the string
 * sits above a horizontal gap and to the left of a vertical one. */
function drawGapDimension(x1, y1, x2, y2, kind) {
  const len = segmentLength(x1, y1, x2, y2);
  if (len < 0.005) return;
  const [ax, ay] = worldToScreen(x1, y1);
  const [bx, by] = worldToScreen(x2, y2);
  const mm = Math.round(len * 1000);
  const label = `${mm} mm`;
  const off = 20;
  const dx = bx - ax;
  const dy = by - ay;
  const span = Math.hypot(dx, dy) || 1;
  // Offset towards the top-left of the sheet so a horizontal string sits
  // above the gap and a vertical one to its left, matching the old axis
  // kinds, and so an angled wall's strings sit beside the wall rather than
  // on top of the opening.
  let nx = -dy / span;
  let ny = dx / span;
  if (ny > 1e-6 || (Math.abs(ny) <= 1e-6 && nx > 0)) {
    nx = -nx;
    ny = -ny;
  }
  if (kind === "v") {
    nx = -1;
    ny = 0;
  } else if (kind === "h") {
    nx = 0;
    ny = -1;
  }
  const ox = nx * off;
  const oy = ny * off;
  const p1 = { x: ax + ox, y: ay + oy };
  const p2 = { x: bx + ox, y: by + oy };
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;

  ctx.save();
  ctx.strokeStyle = "#3a5f7a";
  ctx.fillStyle = "#3a5f7a";
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(p1.x, p1.y);
  ctx.moveTo(bx, by);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  drawGapArrow(p1.x, p1.y, p2.x, p2.y);
  drawGapArrow(p2.x, p2.y, p1.x, p1.y);

  ctx.font = "600 11px Source Sans 3, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const textW = ctx.measureText(label).width + 8;
  const tight = span < textW + 16;
  ctx.translate(mx, my);
  let angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  if (kind === "v") angle = -Math.PI / 2;
  else if (kind === "h") angle = 0;
  else {
    if (angle >= Math.PI / 2) angle -= Math.PI;
    if (angle < -Math.PI / 2) angle += Math.PI;
  }
  ctx.rotate(angle);
  // Tight gaps cannot fit the number between the arrows; park it beside
  // the string (further along the same offset) so the arrows still read.
  const shift = tight ? -14 : 0;
  ctx.fillStyle = "rgba(244, 237, 225, 0.92)";
  ctx.fillRect(-textW / 2, -8 + shift, textW, 16);
  ctx.fillStyle = "#3a5f7a";
  ctx.fillText(label, 0, shift);
  ctx.restore();
}

function drawGapArrow(tipX, tipY, fromX, fromY) {
  const a = Math.atan2(tipY - fromY, tipX - fromX);
  const size = 7;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - size * Math.cos(a - 0.4), tipY - size * Math.sin(a - 0.4));
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - size * Math.cos(a + 0.4), tipY - size * Math.sin(a + 0.4));
  ctx.stroke();
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
  if (!sel || drag || attachPick) return;
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
    // Shift keeps the current heading: length along that ray prefers round
    // millimetres rather than joins, since the user has already committed to
    // an angle and just wants a clean dimension.
    snapGuide = null;
    const dx = origin.mx - origin.fx;
    const dy = origin.my - origin.fy;
    const denom = dx * dx + dy * dy;
    const tol = SNAP_PIXEL_TOL / cam.scale;
    if (denom > 1e-8) {
      const t = ((x - origin.fx) * dx + (y - origin.fy) * dy) / denom;
      const along = snapLengthFrom(
        { x: origin.fx, y: origin.fy },
        { x: origin.fx + dx * t, y: origin.fy + dy * t },
        tol,
      );
      nx = along.x;
      ny = along.y;
    } else {
      const p = applySnap(x, y, undefined);
      nx = p.x;
      ny = p.y;
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

/** Tracking lines for the live snap preview. Drawn whenever a draw tool is
 * armed, including before the first click. Gap labels measure to one nearby
 * corner or wall face (marked with a square), never to a phantom alignment. */
function drawSnapGuide(rect) {
  if (!snapGuide) return;
  const g = snapGuide;
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  if (g.snapX && g.guideX != null) {
    ctx.strokeStyle = "#3a5f7a";
    const [sx] = worldToScreen(g.guideX, 0);
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, rect.height);
    ctx.stroke();
  }
  if (g.snapY && g.guideY != null) {
    ctx.strokeStyle = "#3a5f7a";
    const [, sy] = worldToScreen(0, g.guideY);
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(rect.width, sy);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  if (g.origin) {
    const [ox, oy] = worldToScreen(g.origin.x, g.origin.y);
    ctx.strokeStyle = "#3a5f7a";
    ctx.fillStyle = "#f4ede1";
    ctx.lineWidth = 1.4;
    ctx.fillRect(ox - 4, oy - 4, 8, 8);
    ctx.strokeRect(ox - 4, oy - 4, 8, 8);
  }
  // Mark whichever point actually put the axis guide there, distinct from
  // `origin` (the nearest-of-all gap target) - an aligned guide can be
  // latched onto a completely different, further-away point.
  for (const guidePoint of new Set([g.snapX ? g.guideXPoint : null, g.snapY ? g.guideYPoint : null])) {
    if (!guidePoint) continue;
    const [qx, qy] = worldToScreen(guidePoint.x, guidePoint.y);
    ctx.strokeStyle = "#3a5f7a";
    ctx.fillStyle = "#f4ede1";
    ctx.lineWidth = 1.4;
    ctx.fillRect(qx - 4, qy - 4, 8, 8);
    ctx.strokeRect(qx - 4, qy - 4, 8, 8);
  }
  const [px, py] = worldToScreen(g.x, g.y);
  ctx.fillStyle = g.snapped ? "#3a5f7a" : "rgba(58, 95, 122, 0.7)";
  ctx.strokeStyle = "#3a5f7a";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(px, py, g.snapped ? 4 : 3, 0, Math.PI * 2);
  if (g.snapped) ctx.fill();
  else {
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();

  const minLabel = Math.max(0.05, g.tol || 0);
  // A pinned axis replaces that axis' automatic measurement: the user has
  // said which side they want, so the nearest-object string for the same
  // axis would only be a second number arguing with it.
  const pinned = { h: null, v: null };
  for (const probe of g.probes || []) pinned[probeAxis(probe.side)] = probe;

  if (!pinned.h && g.origin && g.dx != null && !g.snapX && Math.abs(g.dx) > minLabel) {
    drawGapDimension(g.origin.x, g.y, g.x, g.y, "h");
  }
  if (!pinned.v && g.origin && g.dy != null && !g.snapY && Math.abs(g.dy) > minLabel) {
    drawGapDimension(g.x, g.origin.y, g.x, g.y, "v");
  }
  // The alignment guide itself only says "your X/Y matches something else
  // on the sheet" - it says nothing about *how far* along that line the
  // matched point is (it could be off the top of the current view, as far
  // as the line is drawn). Label that distance whenever it's non-trivial.
  if (!pinned.v && g.snapX && g.guideXPoint && Math.abs(g.y - g.guideXPoint.y) > minLabel) {
    drawGapDimension(g.x, g.guideXPoint.y, g.x, g.y, "v");
  }
  if (!pinned.h && g.snapY && g.guideYPoint && Math.abs(g.x - g.guideYPoint.x) > minLabel) {
    drawGapDimension(g.guideYPoint.x, g.y, g.x, g.y, "h");
  }
  for (const kind of ["h", "v"]) {
    const probe = pinned[kind];
    if (!probe) continue;
    if (probe.to && probe.dist > minLabel) {
      drawGapDimension(probe.to.x, probe.to.y, probe.from.x, probe.from.y, kind);
    } else {
      drawEmptyProbe(probe.from.x, probe.from.y, probe.side);
    }
  }
}

/** A pinned direction with nothing in it: the measurement line still points
 * that way, fading out instead of carrying a number, so "I asked and there
 * is nothing there" reads differently from "I never asked". */
function drawEmptyProbe(x, y, side) {
  const v = PROBE_VECTORS[side];
  if (!v) return;
  const [sx, sy] = worldToScreen(x, y);
  const len = 80;
  const ex = sx + v.dx * len;
  const ey = sy + v.dy * len;
  const fade = ctx.createLinearGradient(sx, sy, ex, ey);
  fade.addColorStop(0, "rgba(58, 95, 122, 0.55)");
  fade.addColorStop(1, "rgba(58, 95, 122, 0)");
  ctx.save();
  ctx.setLineDash([]);
  ctx.strokeStyle = fade;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
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
    if (!planObjectVisible(room)) continue;
    if (test(bbox(roomPolygon(room)))) hits.push({ kind: "room", id: room.id });
  }
  for (const slab of store.doc.slabs.filter(onActiveLevel)) {
    if (!planObjectVisible(slab)) continue;
    if (test(bbox(shapePolygon(slab.shape)))) hits.push({ kind: "slab", id: slab.id });
  }
  for (const roof of store.doc.roofs.filter(onActiveLevel)) {
    if (!planObjectVisible(roof)) continue;
    if (test(bbox(shapePolygon(roof.shape)))) hits.push({ kind: "roof", id: roof.id });
  }
  for (const seg of store.doc.segments.filter(onActiveLevel)) {
    if (!planObjectVisible(seg)) continue;
    const segBox = { x: Math.min(seg.x1, seg.x2), y: Math.min(seg.y1, seg.y2), w: Math.max(0.02, Math.abs(seg.x2 - seg.x1)), h: Math.max(0.02, Math.abs(seg.y2 - seg.y1)) };
    if (test(segBox)) hits.push({ kind: "segment", id: seg.id });
  }
  for (const beam of store.doc.beams.filter(onActiveLevel)) {
    if (!planObjectVisible(beam)) continue;
    const beamBox = { x: Math.min(beam.x1, beam.x2), y: Math.min(beam.y1, beam.y2), w: Math.max(0.02, Math.abs(beam.x2 - beam.x1)), h: Math.max(0.02, Math.abs(beam.y2 - beam.y1)) };
    if (test(beamBox)) hits.push({ kind: "beam", id: beam.id });
  }
  for (const item of store.doc.items.filter(onActiveLevel)) {
    if (!planObjectVisible(item)) continue;
    const sku = skuById(item.sku);
    if (sku && test(itemRect(item, sku))) hits.push({ kind: "item", id: item.id });
  }
  for (const opening of store.doc.openings) {
    if (!planObjectVisible(opening)) continue;
    const wall = wallForOpening(store.doc, pack, wallsCache, opening);
    if (!wall || wall.level !== activeLevel || !planObjectVisible(wall)) continue;
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

/** Corner-scale or rotate handle under the pointer, only while the underlay handles are shown. */
function underlayHandleHit(wx, wy) {
  if (!underlayHandlesActive()) return null;
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
    if (!planObjectVisible(item)) continue;
    const sku = skuById(item.sku);
    if (!sku) continue;
    const box = itemRect(item, sku);
    if (wx >= box.x - pxTol && wx <= box.x + box.w + pxTol && wy >= box.y - pxTol && wy <= box.y + box.h + pxTol) {
      return { kind: "item", id: item.id };
    }
  }
  for (let i = store.doc.openings.length - 1; i >= 0; i -= 1) {
    const opening = store.doc.openings[i];
    if (!planObjectVisible(opening)) continue;
    const wall = wallForOpening(store.doc, pack, wallsCache, opening);
    if (!wall || wall.level !== activeLevel || !planObjectVisible(wall)) continue;
    const [px, py] = anchorPoint(opening, wall);
    if (Math.hypot(px - wx, py - wy) < 0.3) return { kind: "opening", id: opening.id };
  }
  const beams = store.doc.beams.filter(onActiveLevel);
  for (let i = beams.length - 1; i >= 0; i -= 1) {
    const beam = beams[i];
    if (!planObjectVisible(beam)) continue;
    const sku = skuById(beam.sku);
    const tol = Math.max(0.15, (sku?.geometry?.width || 0.11) / 2 + 0.05);
    if (distToSeg(beam.x1, beam.y1, beam.x2, beam.y2, wx, wy) < tol) return { kind: "beam", id: beam.id };
  }
  const segments = store.doc.segments.filter(onActiveLevel);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const seg = segments[i];
    if (!planObjectVisible(seg)) continue;
    const sku = skuById(seg.sku);
    const tol = Math.max(0.18, drawnWallThickness(sku) / 2 + 0.08);
    if (distToSeg(seg.x1, seg.y1, seg.x2, seg.y2, wx, wy) < tol) return { kind: "segment", id: seg.id };
  }
  const slabs = store.doc.slabs.filter(onActiveLevel);
  for (let i = slabs.length - 1; i >= 0; i -= 1) {
    const slab = slabs[i];
    if (!planObjectVisible(slab)) continue;
    if (pointInPoly(wx, wy, shapePolygon(slab.shape))) return { kind: "slab", id: slab.id };
  }
  // Rooms before roofs: a roof typically envelopes the whole footprint, so
  // without this a click anywhere inside the building would always hit the
  // roof instead of the room underneath it.
  const rooms = store.doc.rooms.filter(onActiveLevel);
  for (let i = rooms.length - 1; i >= 0; i -= 1) {
    const room = rooms[i];
    if (!planObjectVisible(room)) continue;
    if (pointInPoly(wx, wy, roomPolygon(room))) return { kind: "room", id: room.id };
  }
  const roofs = store.doc.roofs.filter(onActiveLevel);
  for (let i = roofs.length - 1; i >= 0; i -= 1) {
    const roof = roofs[i];
    if (!planObjectVisible(roof)) continue;
    if (pointInPoly(wx, wy, shapePolygon(roof.shape))) return { kind: "roof", id: roof.id };
  }
  return null;
}

/**
 * Nearest wall or beam under the pointer while the attach pick is armed, valid
 * target or not - hovering an invalid one is how its reason gets explained.
 *
 * Its own hit test rather than hitTest(): a target may sit on the storey below,
 * which the normal active-level-only hit test deliberately ignores.
 */
function attachObjectAt(wx, wy) {
  const mine = new Set((attachPick?.refs || []).map(attachRefKey));
  let best = null;
  let bestD = Infinity;
  for (const kind of ATTACHABLE_KINDS) {
    for (const obj of collectionFor(store.doc, kind) || []) {
      const ref = { kind, id: obj.id };
      if (mine.has(attachRefKey(ref))) continue;
      if (!planObjectVisible(obj)) continue;
      const sku = skuById(obj.sku);
      const tol = Math.max(0.18, drawnWallThickness(sku) / 2 + 0.08);
      const d = distToSeg(obj.x1, obj.y1, obj.x2, obj.y2, wx, wy);
      if (d < tol && d < bestD) {
        best = ref;
        bestD = d;
      }
    }
  }
  return best;
}

// --- palette ---------------------------------------------------------------

const CATEGORY_LABEL = {
  wall: "Walls", boundarywall: "Boundary walls", foundation: "Foundations", floor: "Floors",
  ceiling: "Ceilings", roof: "Roofs", door: "Doors", window: "Windows", beam: "Beams",
  column: "Columns", stair: "Stairs", sanitary: "Sanitary", waterheater: "Water heating",
  drainage: "Drainage", electrical: "Electrical", furniture: "Furniture", casework: "Casework",
  pool: "Pool", carport: "Carport",
};

/** One word for the Inspector header: what is selected, not which type. */
const INSPECT_KIND_LABEL = {
  wall: "Wall",
  boundarywall: "Boundary wall",
  foundation: "Foundation",
  floor: "Floor",
  ceiling: "Ceiling",
  roof: "Roof",
  door: "Door",
  window: "Window",
  beam: "Beam",
  column: "Column",
  stair: "Stair",
  sanitary: "Sanitary",
  waterheater: "Water heater",
  drainage: "Drainage",
  electrical: "Electrical",
  furniture: "Furniture",
  casework: "Casework",
  pool: "Pool",
  carport: "Carport",
};

function inspectKindLabel(kind, sku) {
  if (kind === "room") return "Room";
  const cat = sku?.category;
  if (cat && INSPECT_KIND_LABEL[cat]) return INSPECT_KIND_LABEL[cat];
  if (kind === "segment" || kind === "wall") return "Wall";
  if (kind === "opening") return "Opening";
  if (kind === "slab") return "Floor";
  if (kind === "roof") return "Roof";
  if (kind === "beam") return "Beam";
  if (kind === "item") return "Item";
  return "";
}

function skuDimLabel(sku) {
  const g = sku.geometry || {};
  if (g.width && g.height && (sku.category === "door" || sku.category === "window")) {
    return `${Math.round(g.width * 1000)} × ${Math.round(g.height * 1000)} mm`;
  }
  if (isStripFooting(sku) && g.width && g.depth) {
    return `${Math.round(g.width * 1000)} × ${Math.round(g.depth * 1000)} mm`;
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
 * Overridden by a warning when the armed tool does not belong on the current
 * cut (a roof on "00 FOUNDATION", a foundation on a ceiling plan — see
 * `placementCutWarning`). This only flags the one thing the app can rule
 * out; it never guesses which of the remaining levels the object actually
 * belongs on, and it never moves the level switcher itself - the user stays
 * in control of the cut. */
function updateRibbonHint() {
  if (!el.ribbonHint) return;
  // While the attach target pick is armed the hint is the live preview of what
  // the hovered candidate would do, or why it cannot be picked.
  if (attachPick) {
    const hoverText = attachPick.hover ? attachHoverText(attachPick.hover) : null;
    el.ribbonHint.hidden = false;
    el.ribbonHint.classList.toggle("ribbon-hint-warn", Boolean(hoverText?.warn));
    el.ribbonHint.textContent = hoverText ? hoverText.text : HINTS.attach;
    return;
  }
  if (tool === "camera") {
    el.ribbonHint.hidden = false;
    el.ribbonHint.classList.remove("ribbon-hint-warn");
    el.ribbonHint.textContent = cameraDraft?.a
      ? "Click what you look at."
      : HINTS["view-camera"];
    return;
  }
  if (tool === "section") {
    el.ribbonHint.hidden = false;
    el.ribbonHint.classList.remove("ribbon-hint-warn");
    el.ribbonHint.textContent = sectionDraft?.a
      ? "Click the other end of the cut. Look is to the left of the line."
      : HINTS.section;
    return;
  }
  if (tool === "measure") {
    el.ribbonHint.hidden = false;
    el.ribbonHint.classList.remove("ribbon-hint-warn");
    el.ribbonHint.textContent = measureDraft?.a
      ? "Click the other end."
      : HINTS.dimensions;
    return;
  }
  const cutWarning = placementCutWarning();
  if (cutWarning) {
    el.ribbonHint.hidden = false;
    el.ribbonHint.classList.add("ribbon-hint-warn");
    el.ribbonHint.textContent = cutWarning;
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
  if (item.id === "add-floor") {
    if (!canAddFloor()) {
      const cappedByTemplate = floorsAvailableToAdd() < MAX_FLOORS_TO_ADD;
      return {
        disabled: true,
        title: cappedByTemplate
          ? "The template defines no more storeys above this one."
          : `Every storey this document can add (${MAX_FLOORS_TO_ADD}) is already shown.`,
      };
    }
    const revealed = store.doc?.floorsRevealed || 0;
    return { title: `Reveal the next storey (${revealed} of ${Math.min(MAX_FLOORS_TO_ADD, floorsAvailableToAdd())} added).` };
  }
  if (item.id === "level-isolate") {
    const ghost = pack ? ghostContext(pack.levels, activeLevel) : null;
    return {
      active: isolateCurrentLevel,
      title: isolateCurrentLevel
        ? "Showing this level only. Click to ghost the neighbouring level."
        : ghost?.look === "up"
          ? "Ghosting the walls above. Click to show this level only."
          : ghost
            ? "Ghosting the floor below. Click to show this level only."
            : "Nothing next to this cut to ghost. Click to keep this level only.",
    };
  }
  // Attach/detach act on a wall or beam, so say which is missing rather than
  // letting the click fail with the same information a tooltip could have given.
  if (item.id === "attach" || item.id === "detach") {
    const refs = store.selected.filter((ref) => ATTACHABLE_KINDS.has(ref.kind));
    if (!refs.length) return { disabled: true, title: "Select a wall or beam first." };
    if (item.id === "attach") return { active: Boolean(attachPick), title: HINTS.attach };
    const attached = refs.filter((ref) => objByRef(ref)?.baseAttach);
    return {
      disabled: !attached.length,
      title: attached.length ? HINTS.detach : "Nothing selected is attached to anything.",
    };
  }
  if (item.id === "view-camera") {
    return { active: tool === "camera", title: HINTS["view-camera"] };
  }
  if (item.id === "section") {
    return { active: tool === "section", title: HINTS.section };
  }
  if (item.id === "dimensions") {
    return { active: tool === "measure", title: HINTS.dimensions };
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
  measureDraft = null;
  userDimensions = [];
  showDimensions = false;
  underlaySelected = false;
  syncToolButtons();
  drawRibbon();
  renderPalette();
  render();
}

/** One entry point so the ribbon, the keyboard and the header buttons agree. */
function runCommand(name) {
  switch (name) {
    // Undo can restore a document with a different level stack (an inserted
    // level, or one that had not been inserted yet), so the merged pack has to
    // be rebuilt before anything redraws.
    case "undo": store.undo(); syncPackLevels(); drawLevelSwitcher(); break;
    case "group": store.groupSelection(); store.persist(); break;
    case "ungroup": store.ungroupSelection(); store.persist(); break;
    case "delete": deleteSelection(); break;
    case "compile": runCompile(); return;
    case "boq": runBoq(); return;
    case "bom": runBom(); return;
    case "export-dxf": runExportDxf(); return;
    case "export-ifc": runExportIfc(); return;
    case "gaps": case "check":
      activeTab = "check";
      drawRibbon();
      openCheck();
      return;
    case "view-3d": openMassing(); return;
    case "view-camera": startCameraLook(); return;
    case "section": startSectionCut(); return;
    case "sheets": openSheets(); return;
    case "underlay": openUnderlayPicker(); return;
    case "underlay-adjust": startUnderlayAdjust(); return;
    case "calibrate": startCalibration(); return;
    case "underlay-toggle": toggleUnderlayVisibility(); return;
    case "level-isolate":
      setIsolateCurrentLevel(!isolateCurrentLevel);
      return;
    case "add-floor": addFloor(); return;
    case "insert-level": openLevelInsert(); return;
    case "underlay-off": removeUnderlay(); return;
    case "property-line": startPropertyLineDraw(); return;
    case "sg-coords": startSgPick(); return;
    case "building-line": runAutoBuildingLine(); return;
    case "dimensions":
      if (tool === "measure") stopMeasure();
      else startMeasure();
      return;
    case "attach": startAttachPick(); return;
    case "detach": runDetach(); return;
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

function openMassing(view) {
  if (!view && (tool === "camera" || tool === "section")) {
    cameraDraft = null;
    sectionDraft = null;
    tool = "select";
    if (activeFunction === "view-camera" || activeFunction === "section") activeFunction = null;
    syncToolButtons();
    drawRibbon();
  }
  if (view?.mode === "look") massView.setLook(view);
  else if (view?.mode === "section") massView.setSection(view);
  else massView.setOrbit();
  massView.setPayload(compile(store.doc, pack));
  el.massOverlay.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => massView.resize()));
}

function closeMassing() {
  el.massOverlay.hidden = true;
}

function cameraEyeZ() {
  const level = (pack.levels || []).find((l) => l.id === activeLevel);
  const z0 = Number(level?.elevation);
  return (Number.isFinite(z0) ? z0 : 0) + EYE_HEIGHT_M;
}

function startCameraLook() {
  cameraDraft = { a: null };
  tool = "camera";
  activeFunction = "view-camera";
  underlaySelected = false;
  store.clearSelection();
  syncToolButtons();
  drawRibbon();
  setStatusMessage("Click where you stand, then click what you look at.", "ok");
  render();
}

function finishCameraLook(target) {
  const look = lookFromClicks(cameraDraft.a, target, cameraEyeZ());
  if (!look) {
    setStatusMessage("Stand and look-at need to be different points.", "warn");
    return;
  }
  cameraDraft = null;
  tool = "select";
  activeFunction = null;
  syncToolButtons();
  drawRibbon();
  openMassing(look);
}

function startSectionCut() {
  sectionDraft = { a: null };
  tool = "section";
  activeFunction = "section";
  underlaySelected = false;
  store.clearSelection();
  syncToolButtons();
  drawRibbon();
  setStatusMessage("Click two points to cut. Look is to the left of the line.", "ok");
  render();
}

function finishSectionCut(target) {
  const cut = sectionFromClicks(sectionDraft.a, target);
  if (!cut) {
    setStatusMessage("The two ends of the cut need to be different points.", "warn");
    return;
  }
  sectionDraft = null;
  tool = "select";
  activeFunction = null;
  syncToolButtons();
  drawRibbon();
  openMassing(cut);
}

function startMeasure() {
  measureDraft = { a: null };
  userDimensions = [];
  tool = "measure";
  activeFunction = "dimensions";
  showDimensions = true;
  underlaySelected = false;
  store.clearSelection();
  syncToolButtons();
  drawRibbon();
  setStatusMessage(HINTS.dimensions, "ok");
  render();
}

function stopMeasure() {
  measureDraft = null;
  userDimensions = [];
  showDimensions = false;
  if (tool === "measure") tool = "select";
  if (activeFunction === "dimensions") activeFunction = null;
  syncToolButtons();
  drawRibbon();
  render();
}

function finishMeasure(target) {
  const dim = pickedDimension(measureDraft.a, target);
  if (!dim) {
    setStatusMessage("The two points need to be different.", "warn");
    return;
  }
  userDimensions.push(dim);
  measureDraft = { a: null };
  setStatusMessage(dim.label, "ok");
  updateRibbonHint();
  render();
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
  let massResizeFrame = 0;
  const onMassResize = () => {
    cancelAnimationFrame(massResizeFrame);
    massResizeFrame = requestAnimationFrame(() => massView.resize());
  };
  const massWrap = el.massCanvas?.parentElement;
  if (massWrap) new ResizeObserver(onMassResize).observe(massWrap);
  if (el.massPlanWrap) new ResizeObserver(onMassResize).observe(el.massPlanWrap);
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
  renderAttachReport();
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

function openAbout() {
  if (el.aboutOverlay) el.aboutOverlay.hidden = false;
}

function closeAbout() {
  if (el.aboutOverlay) el.aboutOverlay.hidden = true;
}

function wireAbout() {
  el.aboutOpen?.addEventListener("click", openAbout);
  el.aboutClose?.addEventListener("click", closeAbout);
  el.aboutOk?.addEventListener("click", closeAbout);
  el.aboutOverlay?.addEventListener("click", (event) => {
    if (event.target === el.aboutOverlay) closeAbout();
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
  setStatusMessage("Click two points a known distance apart. Then type the real length, or drag a corner to resize.", "ok");
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

/** Pin a click to both world space and the sheet pixel it landed on. */
function captureCalibrationPoint(wx, wy) {
  const pixel = underlayPixelFromWorld(store.doc.underlay, wx, wy);
  return { x: wx, y: wy, pixel };
}

/** World position of a calibration pick — follows the sheet when it is resized. */
function liveCalibrationPoint(pt) {
  if (!pt) return null;
  if (pt.pixel && store.doc.underlay) return underlayWorldFromPixel(store.doc.underlay, pt.pixel.x, pt.pixel.y);
  return { x: pt.x, y: pt.y };
}

/** The distance calibration would report right now, using the (probably wrong) current scale - a starting guess for the field, and what the live label shows while the second point is still being placed. */
function calibrationDistanceGuess(a, b) {
  if (!store.doc.underlay || !a || !b) return null;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Second half of calibration: both points are down, so show the real-distance field instead of blocking on window.prompt. */
function promptCalibrationDistance() {
  const guess = calibrationDistanceGuess(liveCalibrationPoint(calibration.a), liveCalibrationPoint(calibration.b));
  if (el.calibrateDistance) el.calibrateDistance.value = guess ? guess.toFixed(2) : "";
  render();
}

function confirmCalibration() {
  if (!calibration?.a || !calibration?.b) return;
  const a = liveCalibrationPoint(calibration.a);
  const b = liveCalibrationPoint(calibration.b);
  const result = calibrate(store.doc, a, b, Number(el.calibrateDistance?.value));
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

// --- attach base ---------------------------------------------------------
//
// Modify > Attach base: sit the selected walls/beams on top of one other wall
// or beam, so their base elevation follows it. Everything about what may attach
// to what, and what a given attach would do, comes from compile.js's
// attachPreview - this layer only arms the pick, shows the consequence before
// the click, and hands the target to modify.js.

/** Why a hovered candidate cannot take this selection - one message per cause. */
const ATTACH_HOVER_REASON = {
  "target-attached": "That is already attached to something else, and attach chains are one level deep.",
  cycle: "That would create an attach cycle.",
  "level-too-far": "That is more than one level below.",
  "no-height": "That top is already at or above the selection's own top - pick something lower.",
  "target-height-unknown": "The template states no height for that type, so where its top is is unknown.",
  self: "That is part of the selection.",
  "not-attachable": "Only a wall or beam has a top to attach to.",
  "missing-target": "That no longer exists.",
};

function attachRefKey(ref) {
  return `${ref.kind}:${ref.id}`;
}

/**
 * Arm the target pick. Candidates are resolved once, here, rather than per
 * frame: nothing can edit the document while the pick is armed.
 */
function startAttachPick() {
  const refs = store.selected.filter((ref) => ATTACHABLE_KINDS.has(ref.kind));
  if (!refs.length) {
    setStatusMessage("Select the walls or beams to attach first, then pick what they sit on.", "warn");
    return;
  }
  const objs = refs.map(objByRef).filter(Boolean);
  const taken = new Set(refs.map(attachRefKey));
  const candidates = [];
  for (const kind of ATTACHABLE_KINDS) {
    for (const row of collectionFor(store.doc, kind) || []) {
      const ref = { kind, id: row.id };
      if (taken.has(attachRefKey(ref))) continue;
      if (objs.some((obj) => attachPreview(store.doc, pack, obj, ref).ok)) candidates.push(ref);
    }
  }
  if (!candidates.length) {
    const levels = attachTargetLevels(pack, objs[0]).map((id) => (pack.levels || []).find((l) => l.id === id)?.name || id);
    setStatusMessage(`Nothing on ${levels.join(" or ")} can take this selection's base.`, "warn");
    return;
  }
  attachPick = { refs, candidates, hover: null };
  tool = "attach";
  activeFunction = "attach";
  underlaySelected = false;
  beamStart = null;
  fillAttachList();
  syncToolButtons();
  drawRibbon();
  render();
}

function cancelAttachPick() {
  attachPick = null;
  if (tool === "attach") tool = "select";
  if (activeFunction === "attach") activeFunction = null;
  syncToolButtons();
  drawRibbon();
  render();
}

function isAttachCandidate(ref) {
  return Boolean(ref && attachPick?.candidates.some((c) => c.kind === ref.kind && c.id === ref.id));
}

/**
 * What picking `targetRef` would do, worded for the armed-tool hint. Shown
 * while hovering, before the click: seeing the consequence first is the whole
 * point, rather than explaining an unexpected change afterwards.
 */
function attachHoverText(targetRef) {
  const objs = attachPick.refs.map(objByRef).filter(Boolean);
  const previews = objs.map((obj) => attachPreview(store.doc, pack, obj, targetRef));
  const ok = previews.filter((p) => p.ok);
  const label = objectLabel(pack, objByRef(targetRef));
  if (!ok.length) {
    return { warn: true, text: ATTACH_HOVER_REASON[previews[0]?.reason] || "That cannot take this selection's base." };
  }
  if (objs.length === 1) {
    const [only] = ok;
    return {
      warn: false,
      text: `On "${label}": base rises ${only.rise.toFixed(2)} m to ${only.elevation.toFixed(2)} m; height reduces to ${only.height.toFixed(2)} m.`,
    };
  }
  const skipped = previews.length - ok.length;
  return {
    warn: skipped > 0,
    text: `On "${label}": ${ok.length} of ${previews.length} will attach${skipped ? `, ${skipped} would be invalid and will be skipped` : ""}.`,
  };
}

/**
 * The named-list alternative to clicking: the same candidate set, chosen by
 * name, so a thin foundation strip at low zoom does not have to be hit
 * pixel-perfectly.
 */
function fillAttachList() {
  if (!el.attachList || !attachPick) return;
  el.attachList.innerHTML = attachPick.candidates.map((ref) => {
    const obj = objByRef(ref);
    const level = (pack.levels || []).find((l) => l.id === effectiveLevel(obj, pack))?.name || effectiveLevel(obj, pack);
    return `<option value="${escapeHtml(attachRefKey(ref))}">${escapeHtml(`${objectLabel(pack, obj)} — ${level}`)}</option>`;
  }).join("");
}

function syncAttachPanel() {
  if (!el.attachPanel) return;
  el.attachPanel.hidden = !attachPick;
  if (!attachPick) return;
  const count = attachPick.refs.length;
  if (el.attachHint) {
    el.attachHint.textContent = attachPick.pending
      ? attachPick.pending.message
      : `${count} object${count === 1 ? "" : "s"} selected. Click a highlighted wall or beam, or pick one by name.`;
  }
  if (el.attachConfirm) el.attachConfirm.textContent = attachPick.pending ? "Confirm attach" : "Attach";
}

/**
 * First half of an attach: run the validity pass, show what it would do, and
 * change nothing. A partly-valid batch is then a decision taken here rather
 * than something discovered later in the Check panel. Follows the same
 * "summarise in a panel, don't block on a dialog" shape as calibration.
 */
function proposeAttach(targetRef) {
  const preview = attachSelection(store.doc, attachPick.refs, { pack, targetRef });
  if (!preview.ok) {
    setStatusMessage(preview.message, "warn");
    return;
  }
  attachPick.pending = { targetRef, message: preview.message };
  setStatusMessage(preview.message, "ok");
  render();
}

/** Second half: apply exactly what the summary above described. */
function commitAttach(targetRef) {
  store.pushUndo();
  const result = attachSelection(store.doc, attachPick.refs, { pack, targetRef, commit: true });
  if (!result.ok) {
    store.undoStack.pop();
    setStatusMessage(result.message, "warn");
    return;
  }
  store.persist();
  cancelAttachPick();
  setStatusMessage(result.message, "ok");
}

function runDetach() {
  store.pushUndo();
  const result = detachSelection(store.doc, store.selected, { pack });
  if (!result.ok) {
    store.undoStack.pop();
    setStatusMessage(result.message, "warn");
    return;
  }
  store.persist();
  setStatusMessage(result.message, "ok");
  render();
}

/** One line per selected wall/beam, for the Inspector's read-only Base row. */
function attachStateText(obj) {
  const base = resolvedBase(store.doc, pack, obj, drawnObjectHeight(pack, obj));
  const level = (pack.levels || []).find((l) => l.id === effectiveLevel(obj, pack));
  const levelLabel = level?.name || effectiveLevel(obj, pack) || "level";
  if (base.warning) return `Attached, but unresolved — falls back to ${levelLabel}. See Check.`;
  if (base.attachedTo) {
    return `On "${base.attachedTo.label}" at ${base.elevation.toFixed(2)} m, ${base.height.toFixed(2)} m high`;
  }
  return `Not attached — ${levelLabel} + ${(obj.baseOffset || 0).toFixed(2)} m`;
}

/** Attach state in the Check panel as well as on the object, so a broken
 * attach is findable without knowing which object to select first. */
function renderAttachReport() {
  if (!el.attachReport) return;
  const rows = attachReport(store.doc, pack);
  const broken = rows.filter((r) => r.warning).length;
  el.attachCount.textContent = rows.length
    ? `${rows.length} attached${broken ? ` · ${broken} unresolved` : ""}`
    : "None";
  if (!rows.length) {
    el.attachReport.innerHTML = '<p class="hint">No object\'s base follows another one. Every elevation here is its level\'s datum.</p>';
    return;
  }
  el.attachReport.innerHTML = rows.map((row) => `
    <div class="attach-row${row.warning ? " attach-broken" : ""}">
      <span>${escapeHtml(row.label)}</span>
      <span>${escapeHtml(row.warning
        ? row.warning
        : `on "${row.attachedTo.label}" — base ${row.elevation.toFixed(2)} m, ${row.height.toFixed(2)} m high`)}</span>
    </div>
  `).join("");
}

el.levelConfirm?.addEventListener("click", () => commitLevelInsert());
el.levelCancel?.addEventListener("click", () => {
  closeLevelInsert();
  setStatusMessage("Insert level cancelled; the level stack is unchanged.", "warn");
});
for (const input of [el.levelName, el.levelElevation]) {
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commitLevelInsert();
    if (e.key === "Escape") closeLevelInsert();
  });
}

el.attachCancel?.addEventListener("click", () => {
  cancelAttachPick();
  setStatusMessage("Attach cancelled; nothing changed.", "warn");
});

el.attachConfirm?.addEventListener("click", () => {
  if (!attachPick) return;
  if (attachPick.pending) {
    commitAttach(attachPick.pending.targetRef);
    return;
  }
  const [kind, id] = String(el.attachList?.value || "").split(":");
  const ref = attachPick.candidates.find((c) => c.kind === kind && c.id === id);
  if (!ref) {
    setStatusMessage("Pick a target from the list first.", "warn");
    return;
  }
  proposeAttach(ref);
});

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

// Drags that edit geometry already in the document mutate it live, off the
// speculative undo entry pushed on pointer-down. Cancelling one therefore
// means rolling that entry back, not just forgetting the drag.
const REVERTIBLE_DRAGS = new Set(["move", "segment-end", "underlay-move", "underlay-scale", "underlay-rotate"]);

/**
 * Escape: throw away whatever is half-drawn and step back to Select, which is
 * what the ribbon hints ("Esc to stop", "Esc to cancel") promise. A draft can
 * live in any of several places - a pointer drag, the beam's first click, the
 * property-line and calibration point lists, an armed target pick - so all of
 * them are dropped here rather than tool by tool.
 */
function cancelDrawing() {
  // Nothing mid-flight? Escape is then about the current selection, not the
  // tool state - deselect whatever is selected instead of being a no-op.
  const wasDrawing = Boolean(
    drag || beamStart || siteDraft || calibration || sgPick || attachPick ||     cameraDraft || sectionDraft || measureDraft ||
    (tool !== "select") || activeFunction
  );

  if (REVERTIBLE_DRAGS.has(drag?.kind)) {
    // undo() clears the selection; the user only cancelled a move, so put the
    // same objects back under the pointer.
    const selection = store.selected.slice();
    const primary = store.primary;
    store.undo();
    store.setSelection(selection, primary);
  }
  drag = null;
  beamStart = null;
  sizeDraft = null;
  snapGuide = null;
  underlaySelected = false;
  calibration = null;
  siteDraft = null;
  sgPick = null;
  attachPick = null;
  cameraDraft = null;
  sectionDraft = null;
  measureDraft = null;
  userDimensions = [];
  showDimensions = false;
  if (tool !== "select") {
    tool = "select";
    syncToolButtons();
  }
  if (activeFunction) {
    activeFunction = null;
    renderPalette();
  }
  if (!wasDrawing && store.selected.length) {
    store.clearSelection();
  }
  drawRibbon();
  render();
}

function wireToolbar() {
  document.querySelectorAll("[data-tool]").forEach((btn) => {
    btn.addEventListener("click", () => {
      tool = btn.dataset.tool;
      if (tool !== "select") placeSkuId = placeSkuId || defaultSkuFor(tool);
      else if (activeFunction) {
        // Stepping back to Select un-arms the draw tool so the next-step
        // hint does not keep pointing at it. The type list stays on the last
        // category so a selected wall can still be retyped.
        activeFunction = null;
        showDimensions = false;
        measureDraft = null;
        userDimensions = [];
        drawRibbon();
        renderPalette();
      }
      beamStart = null;
      siteDraft = null;
      sgPick = null;
      attachPick = null;
      cameraDraft = null;
      sectionDraft = null;
      measureDraft = null;
      userDimensions = [];
      syncToolButtons();
      render();
    });
  });
  document.querySelectorAll("[data-plan-status]").forEach((btn) => {
    btn.addEventListener("click", () => {
      planStatusFilter = btn.dataset.planStatus || "both";
      if (planStatusFilter === "existing" || planStatusFilter === "planned") {
        placeStatus = planStatusFilter;
      }
      document.querySelectorAll("[data-plan-status]").forEach((b) => b.classList.toggle("active", b === btn));
      render();
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
  // Three navigations, not three ways of replacing what is on screen. Clear
  // used to blank the open job and keep its id; New mints a row of its own and
  // leaves the previous one exactly as it was.
  document.getElementById("v2-new").addEventListener("click", runNewJob);
  document.getElementById("v2-open").addEventListener("click", () => openLibrary());
  document.getElementById("v2-demo").addEventListener("click", runDemoHouse);
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
  el.canvas.addEventListener("pointerleave", () => {
    hoverPoint = null;
    hover = null;
    if (tool === "door" || tool === "window" || (tool === "camera" && cameraDraft?.a) || (tool === "section" && sectionDraft?.a) || (tool === "measure" && measureDraft?.a)) render();
  });
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

  // Endpoint handles are the selection's own; while a target pick or draw
  // tool is armed the click belongs to that tool, not to stretching a wall.
  const handle = (attachPick || tool !== "select") ? null : endpointHandleHit(wx, wy);
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

  if (underlayHandlesActive()) {
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
    if (!calibration.a) calibration.a = captureCalibrationPoint(wx, wy);
    else if (!calibration.b) {
      calibration.b = captureCalibrationPoint(wx, wy);
      promptCalibrationDistance();
      return;
    } else if (hitUnderlay(wx, wy)) {
      store.pushUndo();
      drag = {
        kind: "underlay-move",
        x0: wx,
        y0: wy,
        ox: store.doc.underlay.x,
        oy: store.doc.underlay.y,
        moved: false,
      };
      el.canvas.setPointerCapture(ev.pointerId);
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
  if (tool === "camera") {
    const p = applySnap(wx, wy);
    if (!cameraDraft?.a) {
      cameraDraft = { a: p };
      updateRibbonHint();
      render();
      return;
    }
    finishCameraLook(p);
    return;
  }
  if (tool === "section") {
    const p = applySnap(wx, wy);
    if (!sectionDraft?.a) {
      sectionDraft = { a: p };
      updateRibbonHint();
      render();
      return;
    }
    finishSectionCut(p);
    return;
  }
  if (tool === "measure") {
    const p = applySnap(wx, wy);
    if (!measureDraft?.a) {
      measureDraft = { a: p };
      updateRibbonHint();
      render();
      return;
    }
    finishMeasure(p);
    return;
  }
  if (tool === "attach") {
    const target = attachObjectAt(wx, wy);
    if (!target) {
      setStatusMessage("Click one of the highlighted walls or beams, or pick one by name.", "warn");
      return;
    }
    // A dimmed object was still clicked: answer with the reason it cannot take
    // this base, not with a restatement of what is pickable.
    if (!isAttachCandidate(target)) {
      setStatusMessage(attachHoverText(target).text, "warn");
      return;
    }
    proposeAttach(target);
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
  const p0 = applySnap(wx, wy);
  drag = { kind: `${tool}-new`, x0: p0.x, y0: p0.y, rect: null };
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
    if (calibration?.b && !drag) {
      const uHandle = underlayHandleHit(wx, wy);
      el.canvas.style.cursor = uHandle?.kind === "underlay-rotate" ? "grab"
        : uHandle?.kind === "underlay-scale" ? "nwse-resize"
        : hitUnderlay(wx, wy) ? "move"
        : "crosshair";
    }
    if (calibration?.a) render();
    return;
  }
  if (tool === "camera") {
    if (cameraDraft?.a) render();
    return;
  }
  if (tool === "section") {
    if (sectionDraft?.a) render();
    return;
  }
  if (tool === "measure") {
    applySnap(wx, wy);
    el.canvas.style.cursor = "crosshair";
    render();
    return;
  }
  if (tool === "property" || tool === "sg-ref") {
    applySnap(wx, wy);
    render();
    return;
  }
  if (tool === "attach" && attachPick) {
    const next = attachObjectAt(wx, wy);
    const changed = attachRefKey(next || { kind: "", id: "" }) !== attachRefKey(attachPick.hover || { kind: "", id: "" });
    attachPick.hover = next;
    el.canvas.style.cursor = isAttachCandidate(next) ? "pointer" : "default";
    // The hint is the pre-commit preview, so it has to follow the pointer.
    if (changed) updateRibbonHint();
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
      const targets = collectSnapTargets(store.doc, snapOpts(exclude));
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
        // Same shape applySnap() builds, so drawSnapGuide's tracking lines
        // and "how far along this guide" label render identically whether
        // the guide came from drawing a new object or moving an existing
        // one.
        snapGuide = {
          ...best.guide,
          snapX: best.guide.guideX != null,
          snapY: best.guide.guideY != null,
        };
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
    const p = applySnap(wx, wy);
    drag.rect = rectFromDrag(drag.x0, drag.y0, p.x, p.y);
    render();
    return;
  }
  if (!drag && (snapPreviewTool() || beamStart)) applySnap(wx, wy);
  else if (!drag) snapGuide = null;
  render();
}

function rectFromDrag(x0, y0, wx, wy) {
  // x0/y0 and wx/wy are already snapped or grid-rounded by applySnap.
  // Rounding again here would pull an exact wall-corner join back onto
  // the grid and undo the snap.
  const x = Math.min(x0, wx);
  const y = Math.min(y0, wy);
  const w = sizeDraft?.lockW ? parseMetres(sizeDraft.typedW, 1) : Math.abs(wx - x0);
  const h = sizeDraft?.lockH ? parseMetres(sizeDraft.typedH, 1) : Math.abs(wy - y0);
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
  if (hoverPoint && snapPreviewTool()) applySnap(hoverPoint.x, hoverPoint.y);
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
    // Escape still has to get through from a field: the size HUD is part of
    // drawing, so typing a width there must not trap the draft.
    if (typing && ev.key === "Escape") document.activeElement.blur();
    else if (typing) return;

    if (ev.key === "Escape") {
      if (el.aboutOverlay && !el.aboutOverlay.hidden) {
        closeAbout();
        return;
      }
      if (el.massOverlay && !el.massOverlay.hidden) {
        closeMassing();
        return;
      }
      if (el.checkOverlay && !el.checkOverlay.hidden) {
        closeCheck();
        return;
      }
      cancelDrawing();
    } else if (PROBE_KEYS[ev.key]) {
      ev.preventDefault();
      const side = PROBE_KEYS[ev.key];
      const axis = probeAxis(side);
      probeSide[axis] = probeSide[axis] === side ? null : side;
      const pinned = [probeSide.h, probeSide.v].filter(Boolean);
      setStatusMessage(pinned.length
        ? `Measuring ${pinned.join(" and ")} - same arrow again to go back to nearest`
        : "Measuring to the nearest object");
      // Re-resolve from the last pointer position so the new side appears
      // straight away, without waiting for the mouse to twitch.
      if (hoverPoint && (snapPreviewTool() || beamStart)) applySnap(hoverPoint.x, hoverPoint.y);
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
    status: placementStatus(),
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
    status: placementStatus(),
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
    pitch: DEFAULT_ROOF_PITCH,
    ridge: "long",
    status: placementStatus(),
    shape: rectShape(rect.x, rect.y, rect.w, rect.h),
  });
}

function commitWall(d) {
  const len = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
  if (len < MIN_TRACE) return;
  store.pushUndo();
  const id = nid("s");
  store.doc.segments.push({ id, sku: placeSkuId, level: activeLevel, x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, status: placementStatus() });
  store.selectOne({ kind: "segment", id });
}

function commitBeam(a, b) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 0.3) return;
  store.pushUndo();
  store.doc.beams.push({ id: nid("b"), sku: placeSkuId, level: activeLevel, x1: a.x, y1: a.y, x2: b.x, y2: b.y, status: placementStatus() });
  store.persist();
}

function placeOpening(wx, wy) {
  const walls = currentWalls().filter(onActiveLevel);
  const draft = openingDraftAt(store.doc, pack, walls, placeSkuId, wx, wy);
  if (!draft) return;
  store.pushUndo();
  store.doc.openings.push({ id: nid("o"), status: placementStatus(), ...draft });
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
    status: placementStatus(),
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
  if (el.hudHint) {
    el.hudHint.textContent = drag.kind === "roof-new"
      ? "Drag the eaves. Corners snap to walls; draw past them for an overhang."
      : "Drag to size, or type metres. Tab switches width / height.";
  }
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

function syncPlanFilterButtons() {
  document.querySelectorAll(".planner-tools [data-plan-status]").forEach((b) => {
    b.classList.toggle("active", b.dataset.planStatus === planStatusFilter);
  });
}

function syncInspectStatus(obj, draft) {
  const show = Boolean(el.ctxStatusWrap) && (draft || obj);
  setHidden(el.ctxStatusWrap, !show);
  if (!show) return;
  const status = draft ? placementStatus() : objectStatus(obj);
  for (const input of el.ctxStatusWrap.querySelectorAll("input[name='v2-ctx-status']")) {
    input.checked = input.value === status;
  }
}

function syncInspectKicker(text) {
  if (!el.inspectKicker) return;
  el.inspectKicker.textContent = text || "—";
}

function syncObjectLevel(obj) {
  const stations = inspectorStations(
    houseStations.length ? houseStations : buildHouseStations(visibleLevels()),
    pack.levels || [],
    obj?.level
  );
  const show = stations.length >= 2 && obj;
  setHidden(el.ctxOLevelWrap, !show);
  if (!show) return;
  el.ctxOLevel.innerHTML = stations
    .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.label)}</option>`)
    .join("");
  const id = selectedInspectorStationId(stations, obj.level || pack.system.defaultLevel, activeStationId);
  if (document.activeElement !== el.ctxOLevel) el.ctxOLevel.value = id;
}

function syncPlanContext() {
  syncPlanFilterButtons();
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
  } else if (draft) {
    syncInspectKicker(inspectKindLabel("wall", skuById(placeSkuId)));
  } else if (obj) {
    syncInspectKicker(inspectKindLabel(ref.kind, skuById(obj.sku)));
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
  const pitched = Boolean(roof && obj && obj.form !== "flat");
  setHidden(el.ctxPitchWrap, !pitched);
  setHidden(el.ctxRidgeWrap, !pitched);
  setHidden(el.ctxTypeWrap, !showType);
  syncInspectStatus(showInspect && !multi ? obj : null, draft);
  setHidden(el.ctxFlip, !(opening && skuById(obj.sku)?.category === "door"));
  const attachable = Boolean(obj && ATTACHABLE_KINDS.has(ref.kind));
  setHidden(el.ctxAttachWrap, !attachable);
  if (attachable && el.ctxAttach) el.ctxAttach.textContent = attachStateText(obj);
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
    if (el.ctxRidge && document.activeElement !== el.ctxRidge) el.ctxRidge.value = obj.ridge === "short" ? "short" : "long";
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

el.ctxStatusWrap?.addEventListener("change", (e) => {
  const next = e.target?.value;
  if (next !== "existing" && next !== "planned") return;
  placeStatus = next;
  if (drag?.kind === "wall-new" || drag?.kind?.endsWith("-new")) {
    render();
    return;
  }
  if (!store.selected.length) return;
  store.pushUndo();
  for (const ref of store.selected) {
    const obj = objByRef(ref);
    if (obj) obj.status = next;
  }
  store.persist();
  render();
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
  roof.pitch = Number(e.target.value) || DEFAULT_ROOF_PITCH;
  store.persist();
  render();
});

el.ctxRidge?.addEventListener("change", (e) => {
  const roof = soleOf("roof");
  if (!roof) return;
  store.pushUndo();
  roof.ridge = e.target.value === "short" ? "short" : "long";
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
  const stations = inspectorStations(
    houseStations.length ? houseStations : buildHouseStations(visibleLevels()),
    pack.levels || [],
    obj.level
  );
  const station = stations.find((s) => s.id === e.target.value);
  if (!station?.levelId) return;
  const newLevel = station.levelId;
  if (newLevel !== obj.level) {
    store.pushUndo();
    obj.level = newLevel;
    store.persist();
  }
  // Jump the active cut (not only the storey) to the chosen station, rather
  // than leaving the object selected-but-invisible, or snapping a ceiling
  // pick back to that storey's floor.
  const idx = houseStations.findIndex((s) => s.id === station.id);
  if (idx >= 0) {
    selectStationIndex(idx, { keepSelection: true });
    return;
  }
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
el.calibrateDistance?.addEventListener("input", () => {
  if (calibration) calibration.distanceEdited = true;
});
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
  // The panel is shared with the IFC export, which renames it while it owns it.
  el.compilePanel.querySelector("h2").textContent = "Compile result";
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

// --- BOQ / BOM ----------------------------------------------------------
//
// Output > Schedules. Its own overlay (v2-schedule-overlay), not a Check tab:
// compliance and data-quality gaps are about the pack's SKUs, never about
// pricing or counting what was drawn, and a customer looking at a quote
// should not have to scroll past a "cannot check" zoning finding to reach it.
//
// Both BOQ and BOM read compile()'s instances - schedule.js only rolls the
// per-element rows up into one line per SKU and, for BOQ, joins a rate book.
// Neither re-derives a quantity of its own. See schedule.js's header for what
// tells the two views apart.
//
// Every rolled-up line expands to the individual elements behind it, and
// every element with a selection kind (schedule.js/compile.js's `row.kind` -
// null for a room-derived wall or a recipe-implied quantity nobody drew) can
// be located: switch to its level, select it, and pan the plan to it.

let scheduleRowsCache = [];

/** shared money formatter for the priced BOQ view - ZAR unless the loaded
 *  rate book states otherwise. */
function money(rate, symbol) {
  const n = Number(rate) || 0;
  return `${symbol}${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtQty(qty, unit) {
  if (unit === "ea") return String(Math.round(qty));
  return `${(Number(qty) || 0).toFixed(2)} ${unit}`;
}

function levelName(levelId) {
  if (!levelId) return "—";
  return (pack?.levels || []).find((l) => l.id === levelId)?.name || levelId;
}

function elementRowHtml(groupIndex, element, elementIndex) {
  const label = `${element.id}${element.status ? ` · ${element.status}` : ""}`;
  const locatable = Boolean(element.kind);
  return `
    <div class="schedule-element">
      <span class="schedule-element-id">${escapeHtml(label)}</span>
      <span>${escapeHtml(levelName(element.level))}</span>
      <button type="button" class="schedule-locate" data-group="${groupIndex}" data-element="${elementIndex}"
        ${locatable ? "" : "disabled"} title="${locatable ? "Select this element and pan the plan to it" : "Not a drawn element - nothing to select"}">
        Show on plan
      </button>
    </div>`;
}

function scheduleRowsHtml(rows, { priced }) {
  const symbol = rateBook?.symbol || "R";
  const colspan = priced ? 7 : 5;
  const head = priced
    ? `<tr><th></th><th>Model</th><th class="wrap">Description</th><th>Category</th><th class="num">Qty</th><th>Unit</th><th class="num">Rate</th><th class="num">Amount</th></tr>`
    : `<tr><th></th><th>Model</th><th class="wrap">Description</th><th>Category</th><th class="num">Qty</th><th>Unit</th></tr>`;
  const body = rows.map((row, i) => {
    const first = `
      <td class="schedule-caret">▸</td>
      <td>${escapeHtml(row.model || "")}</td>
      <td class="wrap">${escapeHtml(row.description || "")}</td>
      <td>${escapeHtml(row.category || "")}</td>
      <td class="num">${fmtQty(row.qty, row.unit)}</td>
      <td>${escapeHtml(row.unit || "")}</td>`;
    const priceCells = priced
      ? `
      <td class="num">${row.priced ? money(row.rate, symbol) : "—"}</td>
      <td class="num">${row.priced ? money(row.amount, symbol) : "—"}</td>`
      : "";
    const elements = (row.elements || [])
      .map((el, j) => elementRowHtml(i, el, j))
      .join("");
    return `
      <tr class="schedule-group-row" data-group="${i}">${first}${priceCells}</tr>
      <tr class="schedule-elements-row" data-group="${i}" hidden>
        <td colspan="${colspan}"><div class="schedule-elements">${elements || '<p class="hint">Nothing drawn against this line yet.</p>'}</div></td>
      </tr>`;
  }).join("");
  const foot = priced
    ? `<tr class="total"><td colspan="${colspan - 1}">Total (priced lines only)</td><td class="num">${money(scheduleTotal(rows), symbol)}</td></tr>`
    : "";
  return `<table class="cost-table"><thead>${head}</thead><tbody>${body}${foot}</tbody></table>`;
}

function openSchedule(title, rows, { priced }) {
  scheduleRowsCache = rows;
  if (el.scheduleOverlay) el.scheduleOverlay.hidden = false;
  if (el.scheduleTitle) el.scheduleTitle.textContent = title;
  if (el.scheduleKicker) el.scheduleKicker.textContent = `${rows.length} lines`;
  if (el.scheduleBody) {
    el.scheduleBody.innerHTML = `<div class="table-wrap">${scheduleRowsHtml(rows, { priced })}</div>`;
  }
}

function closeSchedule() {
  if (el.scheduleOverlay) el.scheduleOverlay.hidden = true;
}

function runBoq() {
  const out = compile(store.doc, pack);
  if (!out) return;
  const rows = boqRows(out, rateBook);
  const unpriced = rows.filter((r) => !r.priced).length;
  openSchedule("BOQ — bill of quantities", rows, { priced: true });
  const warnings = [
    !rateBook ? 'No rate book loaded — every line prices at "—".' : null,
    rateBook && unpriced ? `${unpriced} of ${rows.length} lines have no rate on file and price at "—".` : null,
  ].filter(Boolean);
  if (warnings.length && el.scheduleBody) {
    el.scheduleBody.insertAdjacentHTML("afterbegin",
      `<div class="compile-warnings">${warnings.map((w) => `<p class="warn">⚠ ${escapeHtml(w)}</p>`).join("")}</div>`);
  }
  window.__boq = rows;
  // eslint-disable-next-line no-console
  console.log("v2 BOQ:", rows);
}

function runBom() {
  const out = compile(store.doc, pack);
  if (!out) return;
  const rows = bomRows(out);
  openSchedule("BOM — bill of materials", rows, { priced: false });
  window.__bom = rows;
  // eslint-disable-next-line no-console
  console.log("v2 BOM:", rows);
}

/** Centre of a doc entity in plan coordinates, or null when its kind has no
 *  plan geometry of its own to pan to (should not happen for a `kind` that
 *  passed the `locatable` check, but a stale reference is still possible). */
function elementCenter(ref, obj) {
  switch (ref.kind) {
    case "room": return roomCentroid(obj);
    case "slab": case "roof": {
      const poly = shapePolygon(obj.shape);
      if (poly.length < 3) return null;
      const sum = poly.reduce((s, p) => ({ x: s.x + p[0], y: s.y + p[1] }), { x: 0, y: 0 });
      return { x: sum.x / poly.length, y: sum.y / poly.length };
    }
    case "segment": case "beam":
      return { x: (obj.x1 + obj.x2) / 2, y: (obj.y1 + obj.y2) / 2 };
    case "item": case "stair":
      return Number.isFinite(obj.x) && Number.isFinite(obj.y) ? { x: obj.x, y: obj.y } : null;
    case "opening": {
      const walls = deriveWalls(store.doc, pack);
      const wall = wallForOpening(store.doc, pack, walls, obj);
      if (!wall) return null;
      const placed = openingOnWall(store.doc, pack, obj, wall);
      return { x: (placed.a.x + placed.b.x) / 2, y: (placed.a.y + placed.b.y) / 2 };
    }
    default: return null;
  }
}

/** Output > Schedules > (expand a line) > Show on plan. Switches to the
 *  element's level if needed, selects it, pans the canvas to it, and closes
 *  the schedule overlay so the result is what the click was for. */
function locateScheduleElement(ref) {
  const obj = objectByRef(store.doc, ref);
  if (!obj) {
    setStatusMessage("That element is no longer in the drawing.", "warn");
    return;
  }
  const objLevel = ref.kind === "opening"
    ? wallForOpening(store.doc, pack, deriveWalls(store.doc, pack), obj)?.level
    : effectiveLevel(obj, pack);
  if (objLevel && objLevel !== activeLevel) {
    activeLevel = objLevel;
    drawLevelSwitcher();
  }
  const center = elementCenter(ref, obj);
  if (center && el.canvas) {
    const rect = el.canvas.getBoundingClientRect();
    cam.scale = Math.max(cam.scale, 90);
    cam.ox = rect.width / 2 - center.x * cam.scale;
    cam.oy = rect.height / 2 - center.y * cam.scale;
  }
  store.setSelection([ref], ref);
  closeSchedule();
  drawRibbon();
  render();
}

function wireSchedule() {
  el.scheduleClose?.addEventListener("click", closeSchedule);
  el.scheduleOverlay?.addEventListener("click", (event) => {
    if (event.target === el.scheduleOverlay) closeSchedule();
  });
  el.scheduleBody?.addEventListener("click", (event) => {
    const locateBtn = event.target.closest(".schedule-locate");
    if (locateBtn) {
      if (locateBtn.disabled) return;
      const row = scheduleRowsCache[Number(locateBtn.dataset.group)];
      const element = row?.elements?.[Number(locateBtn.dataset.element)];
      if (element?.kind) locateScheduleElement({ kind: element.kind, id: element.id });
      return;
    }
    const groupRow = event.target.closest(".schedule-group-row");
    if (groupRow) {
      const elementsRow = el.scheduleBody.querySelector(
        `.schedule-elements-row[data-group="${groupRow.dataset.group}"]`,
      );
      if (elementsRow) elementsRow.hidden = !elementsRow.hidden;
      groupRow.classList.toggle("open", elementsRow && !elementsRow.hidden);
    }
  });
}

function downloadText(fileName, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function showExportPanel(title, fileName, report, extraHints) {
  const c = report.counts;
  const notes = [
    ...(report.unmappedTypes || []).map((m) => ["warn", m]),
    ...(report.skipped || []).map((m) => ["warn", m]),
    ...(report.warnings || []).map((m) => ["warn", m]),
  ];
  openCheck();
  el.compilePanel.hidden = false;
  el.compilePanel.querySelector("h2").textContent = title;
  el.compileKicker.textContent = fileName || "not exported";
  el.compileOut.innerHTML = `
    ${notes.length ? `<div class="compile-warnings">${notes.map(([, m]) => `<p class="warn">⚠ ${escapeHtml(m)}</p>`).join("")}</div>` : ""}
    <dl class="meta">
      <div><dt>Levels</dt><dd>${c.levels} storeys</dd></div>
      <div><dt>Walls</dt><dd>${c.walls}</dd></div>
      <div><dt>Openings</dt><dd>${c.doors} doors, ${c.windows} windows</dd></div>
      <div><dt>Rooms</dt><dd>${c.rooms}</dd></div>
    </dl>
    ${extraHints}
    ${report.notExported?.length ? `<p class="hint">Still in the drawing but not in this file: ${escapeHtml(report.notExported.join(", "))}.</p>` : ""}
  `;
}

// --- CAD export -----------------------------------------------------------
//
// Output > Exchange > Export CAD. A DXF is 2D linework. Revit inserts it with
// Insert → Link CAD; File → Open will not, because that command only lists
// Revit projects. No add-in is involved.

function runExportDxf() {
  const result = exportDxf(store.doc, pack);
  if (!result) {
    setStatusMessage("Load a SKU pack before exporting.", "warn");
    return;
  }
  const { text, fileName, report } = result;
  if (text) {
    downloadText(fileName, text, "application/dxf");
    setStatusMessage(`${fileName}: in Revit, Insert → Link CAD. File → Open will not load a DXF.`);
  } else {
    setStatusMessage("Nothing could be exported - see the report.", "warn");
  }
  showExportPanel("CAD export", text ? fileName : "not exported", report, `
    <p class="hint"><strong>This is not a .rvt</strong> and not a model. It is a 2D CAD drawing of the plan (millimetres, one layer per storey).</p>
    <p class="hint">In Revit, with <em>no add-in</em>: open the firm's template, then <strong>Insert → Link CAD</strong> (or Import CAD). Set Files of type to DXF. File → Open will ignore this file the same way it ignores IFC.</p>
  `);
}

// --- IFC export -----------------------------------------------------------
//
// Still available for a machine that can File → Open → IFC. The receiving
// Revit user is not assumed to have this add-in.

function runExportIfc() {
  const result = exportIfc(store.doc, pack);
  if (!result) {
    setStatusMessage("Load a SKU pack before exporting.", "warn");
    return;
  }

  const { text, fileName, report } = result;
  if (text) {
    downloadText(fileName, text, "application/x-step");
    setStatusMessage(`${fileName}: in Revit, File → Open → IFC (not Open → Project), then Save As .rvt.`);
  } else {
    setStatusMessage("Nothing could be exported - see the report.", "warn");
  }
  showExportPanel("IFC export", text ? fileName : "not exported", report, `
    <p class="hint"><strong>This is not a .rvt.</strong> File → Open → Project will not load it. Use File → Open → IFC, then File → Save As a project.</p>
  `);
}

// --- demo doc ------------------------------------------------------------

/**
 * The demo geometry as a document, built and returned rather than installed.
 *
 * It used to be written straight into `store.doc`, keeping the open job's
 * drawing id so it replaced that job's contents - which is the data loss §5 was
 * written about. Now runDemoHouse() hands this to createJob() and the demo lands
 * in a row of its own, with the id `emptyDoc()` minted for it.
 */
function demoDoc() {
  const wallSku = pack.system.defaultWallSku;
  const floorSku = pack.system.defaultFloorSku;
  const roofSku = pack.system.defaultRoofSku;
  const level = pack.system.defaultLevel;
  const upperLevel = lookUpLevelId(pack.levels, level);

  const doc = {
    ...emptyDoc(),
    // Named, so the title block prints something real - and because the job's
    // own name follows the document's, this names the row too.
    name: "Demo house",
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
    doc.rooms.push({
      id: nid("r"), name: "Landing", use: "other", level: upperLevel, wallSku, floorSku,
      status: "planned", shape: rectShape(0, 0, 4, 3),
    });
  }

  // Anchor the door on the shared wall between the two rooms, and the window
  // on the bedroom's south external wall - resolved live from the geometry
  // rather than hardcoded, so it survives the L-shape's exact edge indices.
  const walls = deriveWalls(doc, pack);
  const shared = walls.find((w) => w.shared);
  const bedroom = doc.rooms[1];
  if (shared) {
    doc.openings[0].wallId = shared.id;
    doc.openings[0].t = wallT(shared, shared.x1 + (shared.x2 - shared.x1) * 0.5, shared.y1 + (shared.y2 - shared.y1) * 0.5);
  }
  const southEdgeIndex = southMostEdgeIndex(bedroom);
  doc.openings[1].roomId = bedroom.id;
  doc.openings[1].edgeIndex = southEdgeIndex;
  doc.openings[1].t = 0.5;

  return doc;
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
