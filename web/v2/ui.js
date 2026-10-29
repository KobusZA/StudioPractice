// Canvas UI for the v2 core. Standalone page (web/v2/index.html) so the
// existing app in web/app.js / web/planner.js is untouched while this proves
// the v2 store, wall derivation and compile pipeline end to end.
//
// Scope trims versus v1, called out here rather than left silent:
//  - A rectangle resizes from the options strip until you drag it. Dragging a
//    corner or an edge turns it into a polygon: Corner adds a point, Line moves
//    the edge, with the same cursors as a floor finish. Identity and type live
//    in the Inspector. New rooms/slabs/roofs are two-click rectangles with the HUD.
//  - No modal type picker; clicking a type SKU sets the active tool/SKU
//    directly, or retypes the current selection if the category matches.
//  - Marquee selection uses each shape's bounding box, not exact polygon
//    overlap. Exact for rectangles, which is everything this UI draws.
//  - Free-angle walls are drawable (a v1 impossibility) but not snapped to
//    common angles; hold Shift while dragging an end to keep the current
//    heading. Walls are click–click and chain from the last end. Length is
//    labelled on the visible part of the wall (so zooming into an end does
//    not hide it), and in the options strip with angle.

import { complianceGaps, normalizePackUnits, GEOMETRY_LENGTH_KEYS } from "./schema.js";
import { RULE_PACK, evaluateCompliance, groupFindingsByPart, summarizeFindings } from "./rules.js";
import { deriveBuildingLine, hitPropertyLine, setBuildingLine, setPropertyLine, setSgReference } from "./site.js?v=20261015-property";
import { HINTS, firstTabId, renderRibbon } from "./ribbon.js?v=20261026-inspector";
import { closeOverflowMenus, decorateRibbon, fitRibbon } from "./ribbon-fit.js?v=20261022-ribbon-fit";
import {
  ghostContext,
  MAX_FLOORS_TO_ADD,
  floorsAvailableToAdd as floorsAvailableToAddFor,
  canAddFloor as canAddFloorFor,
  visibleLevels as visibleLevelsFor,
  mergedLevels,
  validateLevelInsert,
  insertLevel as insertLevelInto,
  applyLevelElevations,
  levelAboveRise,
  defaultWallTop,
  onPlanOf,
  fflLabel,
  isReferenceLevel,
  validateLevelEdit,
  setLevelElevation,
  buildHouseStations,
  inspectorStations,
  selectedInspectorStationId,
  isolateShows,
} from "./level-view.js?v=20261028-level";
import { foundationStorey, foundationsOffStorey, isFoundationLevel as levelIsFoundation, placementHintOverride } from "./placement-warn.js";
import {
  alignSelection,
  attachSelection,
  copySelection,
  cutSelection,
  detachSelection,
  joinSelection,
  mergeSelection,
  mirrorSelection,
  retypeSelection,
  rotateSelection,
  splitSelection,
} from "./modify.js?v=20261022-wall-loc";
import {
  calibrate,
  activateSheetForLevel,
  alignmentPointWorld,
  markAlignmentPoint,
  adoptSheetSet,
  chooseSheet,
  clearUnderlay,
  commitPendingPdf,
  attachSourceFile,
  dropSourceFile,
  isSourceOpen,
  sourcesNeedingFile,
  ghostSheetIndexes,
  setGhostSheets,
  discardPendingPdf,
  drawUnderlay,
  ensureSheetBitmap,
  isPageBitmapReady,
  hasOpenPdf,
  isSatelliteUnderlay,
  openPdf,
  sessionPdfBytes,
  setPdfRestorePending,
  isPdfRestorePending,
  showStoredUnderlay,
  renderReferencePage,
  renderThumbnail,
  setSharpListener,
  setSharpReady,
  sheetSetNeedsPdf,
  loadSatelliteUnderlay,
  loadUnderlayFile,
  moveUnderlayTo,
  restoreSatelliteUnderlay,
  rotateUnderlayBy,
  scaleUnderlayFromCorner,
  setUnderlayOpacity,
  setUnderlayRotation,
  setUnderlayPinned,
  stashUnderlay,
  restoreStashedUnderlay,
  toggleUnderlayHidden,
  isUnderlayHidden,
  setUnderlayHidden,
  setShownSheetsReady,
  underlayBitmap,
  underlayCorners,
  underlayFrameBounds,
  underlayPixelFromWorld,
  underlayWorldFromPixel,
  ensurePageLinework,
  pageLinework,
  pageLineworkStatus,
  setLineworkListener,
  snapUnderlayWorld,
  snapReferencePixel,
} from "./underlay.js?v=20261028-eye";
import { alignablePages, applyCeilingHeights, setCeilingHeight, isPlanPage, mirrorLegacySource, pagesOfSource, sameSheetGeometry } from "./sheet-set.js";
import { createSheetUi } from "./sheet-ui.js?v=20261029-snap-header";
import { SATELLITE_ATTRIBUTION, locateSuggestion, suggestAddresses } from "./satellite.js?v=20261015-geocode";
import { pickedDimension, planDimensionLines } from "./dimensions.js?v=20260917-measure";
import {
  MIN_TRACE,
  canCommitLine,
  canCommitRect,
  centerlineFromLocation,
  chainStart,
  cycleWallLocation,
  flipWallLocation,
  hasClickDraft,
  isFaceLocation,
  lineLength,
  locationLineOf,
  normalizeWallLocation,
  rectFromCorners,
  setLineHeading,
  setLineLength,
} from "./click-draw.js?v=20261022-wall-loc";
import { area as polyArea, bbox, clampToPoly, clipSegToRect, distToSeg, fitPolygonToHost, formatLengthMm, headingDeg, parseLengthMm, pointInPoly, roundGrid, translatePolyEdge } from "./geom.js?v=20261029-fit-host";
import { SNAP_PIXEL_TOL, GAP_MAX_M, ALIGN_ORIGIN_MAX_M, NICE_MIN_STEP_M, PROBE_VECTORS, applyNicePoint, bestEndpointSnap, collectSnapEdges, collectSnapTargets, isExactPointSnap, nearestAlignments, resolveProbes, snapEdgeToLine, snapLengthFrom, snapNiceDelta, snapPoint, snapToFace } from "./snap.js?v=20261029-edge-line";
import { DEFAULT_ROOF_PITCH, roofGuideLines } from "./roof.js";
import {
  ATTACHABLE_KINDS,
  PlanStore,
  ROOM_USES,
  collectionFor,
  effectiveLevel,
  emptyDoc,
  hasPlanDrawing,
  nid,
  normalizeDoc,
  objectByRef,
  rectShape,
  roomArea,
  roomCentroid,
  roomMinDimension,
  roomPerimeter,
  polyShape,
  shapeAsPoly,
  roomPolygon,
  roomUse,
  shapePolygon,
  finishRegionPolygon,
  finishRegionSlab,
  hostedFinishRegionsOf,
  carryFinishRegionsToLevel,
  translateShape,
} from "./model.js";
import { enclosedFace, syncRoomBounds } from "./room-bound.js";
import { REGION_CONVENTIONS, regionConvention } from "./region.js";
import { ELEVATION_SNAP, applyBandEdit, applyOpeningEdit, applyOutlinePoints, applyWallTopEdit, axisAlignedOutline, elevationModel, faceRefForSelection, snapElevation, translateOutlineEdge } from "./wall-elevation.js";
import { createFinishRegion, createFinishRun, finishProductById, libraryLine, planWallFinishMarks, presetFromRoom, rulesFromPreset, savePreset } from "./finish-model.js?v=20261029-finish-plan";
import { FINISH_CATEGORIES, finishId, finishSwatch, normalizeFinishProducts, normalizeFinishSettings } from "./finish-data.js";
import { HEIGHT_PRESETS, faceFinishHtml, finishCalloutHtml, openingCalloutHtml, floorProductSuggestions, parseTarget, productsHtml, roomFinishHtml, slabFinishHtml, targetOptions } from "./finish-panel.js?v=20261029-edge-square";
import { clampElevationView, edgeResizeCursor, elevationSvg, zoomElevationView } from "./wall-elevation-render.js?v=20261029-elev-view";
import { CORNER_JOIN_TOL, deriveWalls, drawnSegmentFromWall, drawnWallThickness, isStripFooting, skuDrawnHeight, statusVisible } from "./walls.js";
import { findJoinTarget, resolveJoin, sideTowardTarget } from "./wall-join.js?v=20261022-corner-b";
import {
  doorSwing,
  openingDraftAt,
  openingOnWall,
  openingSideGaps,
  openingSize,
  openingSymbolSegments,
  slideOpening,
  pointInDoorSwing,
  pointInOpeningCut,
  pointOnOpeningSymbol,
  wallForOpening,
  wallNormal,
} from "./openings.js?v=20261029-opening-move";
import {
  attachPreview,
  attachReport,
  attachTargetLevels,
  compile,
  drawnObjectHeight,
  levelElevation,
  objectLabel,
  resolvedBase,
} from "./compile.js";
import { exportDxf } from "./dxf.js";
import { exportIfc } from "./ifc.js";
import { boqRows, bomRows, scheduleTotal } from "./schedule.js";
import { createMassingView, lookFromClicks, EYE_HEIGHT_M, facesFromPayload, faceStyle, massingLayer, hatchPolygon, strokeFaceEdges } from "./massing.js";
import { drawLookPlan, lookPlanCaption } from "./look-plan.js";
import { sectionFromClicks, createSection, ensureSections, sectionById, clipFacesForSection, sectionUV } from "./section.js";
import { ELEVATION_DIRECTIONS, elevationDirectionLabel, createElevation, ensureElevations, elevationById } from "./elevation.js";
import { calloutFromClicks, createCallout, ensureCallouts, calloutById, calloutExtent } from "./callout.js";
import {
  revisionCloudFromClicks,
  createRevisionCloud,
  ensureRevisionClouds,
  linkRevisionCloud,
  revisionCloudsForSheet,
  revisionCloudViewBox,
  cloudArcs,
} from "./revision.js";
import {
  SHEET_SIZES,
  STANDARD_SCALES,
  addRevision,
  createSheet,
  ensureSheets,
  removeSheet,
  setSheetView,
  sheetById,
  sheetScale,
  sheetView,
  planFormsForLevel,
  scaleBarMetres,
  titleBlockFields,
  titleBlockLayout,
} from "./sheets.js";
import {
  AuthRequiredError, DocSync, docSignature, httpTransport, syncStateLabel,
} from "./sync.js";
import { CloudError, createCloud, importLocalDocument } from "./cloud.js";
import {
  NavigationBlocked, createJob, duplicateJob, flushForNavigation, jobRowFields, openJob, renameJob, splitLibrary,
} from "./library.js";
import { drawingBounds } from "./samples.js";
import { accountCard, formatDate } from "./profile.js";
import {
  addRoutePoint,
  applyDrainageFall,
  connectNode,
  createNetwork,
  createRiser,
  deleteServiceRefs,
  liftNode,
  liftRun,
  projectOnEdge,
  removeServiceNode,
  splitServiceEdge,
  disconnectNode,
  edgeHomeLevel,
  edgeLevels,
  modifyRefusal,
  parseGradient,
  rehomeConnectedNodes,
  reverseEdge,
  routeProfile,
  serviceMassingRoutes,
  serviceMassingNodes,
  serviceElementCentre,
  networkOf,
  serviceStatus,
  nodeMap,
  setEdgeChase,
  setEdgeMode,
  setEdgeSku,
  setNodeLevel,
  setNodeOffset,
} from "./services.js";
import { SERVICE_SYSTEM_INFO, pruneServices, serviceLayerVisible, serviceSystemsPresent } from "./service-model.js";
import { serviceInspectorModel, servicePanelHtml } from "./service-panel.js";
import { clearanceText, justifyPoint, pipeRadius, runWallRelation, serviceWallFlags, setRunClearance } from "./service-walls.js";
import { profileObstructions } from "./service-obstructions.js";
import { drawServiceDraft, drawServiceGhost, drawServiceHover, drawServiceLevel, drawServiceMoveRuns, drawServiceProfile, drawServiceSelection, servicePlanWidth } from "./service-render.js";

const GRID = 0.1;
const HANDLE = 8;

const el = {
  canvasWrap: document.getElementById("v2-canvas-wrap"),
  canvas: document.getElementById("v2-canvas"),
  empty: document.getElementById("v2-empty"),
  legend: document.getElementById("v2-legend"),
  serviceVis: document.getElementById("v2-service-vis"),
  serviceVisList: document.getElementById("v2-service-vis-list"),
  finishVis: document.getElementById("v2-finish-vis"),
  finishVisList: document.getElementById("v2-finish-vis-list"),
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
  schedulePeek: document.getElementById("v2-schedule-peek"),
  schedule3d: document.getElementById("v2-schedule-3d"),
  schedule3dCanvas: document.getElementById("v2-schedule-3d-canvas"),
  schedule3dEmpty: document.getElementById("v2-schedule-3d-empty"),
  schedule3dNote: document.getElementById("v2-schedule-3d-note"),
  schedule3dDrawing: document.getElementById("v2-schedule-3d-drawing"),
  healthDot: document.getElementById("v2-health-dot"),
  healthLabel: document.getElementById("v2-health-label"),
  aboutCatalogue: document.getElementById("v2-about-catalogue"),
  jobName: document.getElementById("v2-job-name"),
  jobCode: document.getElementById("v2-job-code"),
  practiceLink: document.getElementById("v2-practice-link"),
  practiceSep: document.getElementById("v2-practice-sep"),
  syncState: document.getElementById("v2-sync-state"),
  conflict: document.getElementById("v2-conflict"),
  conflictText: document.getElementById("v2-conflict-text"),
  conflictTheirs: document.getElementById("v2-conflict-theirs"),
  conflictMine: document.getElementById("v2-conflict-mine"),
  libraryOverlay: document.getElementById("v2-library-overlay"),
  libraryList: document.getElementById("v2-library-list"),
  libraryMessage: document.getElementById("v2-library-message"),
  libraryTitle: document.getElementById("v2-library-title"),
  libraryKicker: document.getElementById("v2-library-kicker"),
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
  modeBar: document.getElementById("v2-mode-bar"),
  modeName: document.getElementById("v2-mode-name"),
  modeStep: document.getElementById("v2-mode-step"),
  modePrompt: document.getElementById("v2-mode-prompt"),
  modeSheet: document.getElementById("v2-mode-sheet"),
  modeCancel: document.getElementById("v2-mode-cancel"),
  modeDone: document.getElementById("v2-mode-done"),
  modeEsc: document.getElementById("v2-mode-esc"),
  modeClose: document.getElementById("v2-mode-close"),
  modeSnapNote: document.getElementById("v2-mode-snap-note"),
  underlayOpacity: document.getElementById("v2-underlay-opacity"),
  underlayRotation: document.getElementById("v2-underlay-rotation"),
  underlayRotateCcw: document.getElementById("v2-underlay-rotate-ccw"),
  underlayRotateCw: document.getElementById("v2-underlay-rotate-cw"),
  underlayPin: document.getElementById("v2-underlay-pin"),
  calibrateDistanceWrap: document.getElementById("v2-calibrate-distance-wrap"),
  calibrateDistance: document.getElementById("v2-calibrate-distance"),
  calibrateRestart: document.getElementById("v2-calibrate-restart"),
  alignSheets: document.getElementById("v2-align-sheets"),
  alignNext: document.getElementById("v2-align-next"),
  alignClear: document.getElementById("v2-align-clear"),
  calibrateSnap: document.getElementById("v2-calibrate-snap"),
  calibrateSnapWrap: document.getElementById("v2-calibrate-snap-wrap"),
  satellitePanel: document.getElementById("v2-satellite-panel"),
  satelliteHint: document.getElementById("v2-satellite-hint"),
  satelliteQuery: document.getElementById("v2-satellite-query"),
  satelliteSuggest: document.getElementById("v2-satellite-suggest"),
  satelliteConfirm: document.getElementById("v2-satellite-confirm"),
  satelliteCancel: document.getElementById("v2-satellite-cancel"),
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
  foundationReport: document.getElementById("v2-foundation-report"),
  foundationCount: document.getElementById("v2-foundation-count"),
  ribbonTabs: document.getElementById("v2-ribbon-tabs"),
  ribbonFunctions: document.getElementById("v2-ribbon-functions"),
  ribbonHint: document.getElementById("v2-ribbon-hint"),
  headerModify: document.getElementById("v2-header-modify"),
  hmRotate: document.getElementById("v2-hm-rotate"),
  hmCopy: document.getElementById("v2-hm-copy"),
  hmDelete: document.getElementById("v2-hm-delete"),
  paletteTitle: document.getElementById("v2-palette-title"),
  inspectBack: document.getElementById("v2-inspect-back"),
  levelWidget: document.getElementById("v2-level-widget"),
  levelHouse: document.getElementById("v2-level-house"),
  levelStations: document.getElementById("v2-level-stations"),
  cutName: document.getElementById("v2-cut-name"),
  cutElev: document.getElementById("v2-cut-elev"),
  cutKind: document.getElementById("v2-cut-kind"),
  levelIsolate: document.getElementById("v2-level-isolate"),
  planOptions: document.getElementById("v2-plan-options"),
  wallLoc: document.getElementById("v2-wall-loc"),
  wallCorner: document.getElementById("v2-wall-corner"),
  wallOpts: document.getElementById("v2-wall-opts"),
  floorEdgeMode: document.getElementById("v2-floor-edge-mode"),
  inspectKicker: document.getElementById("v2-inspect-kicker"),
  inspectEmpty: document.getElementById("v2-inspect-empty"),
  inspectFields: document.getElementById("v2-inspect-fields"),
  serviceFields: document.getElementById("v2-service-fields"),
  serviceProfileDock: document.getElementById("v2-service-profile-dock"),
  serviceProfileTitle: document.getElementById("v2-service-profile-title"),
  serviceProfileCanvas: document.getElementById("v2-service-profile-canvas"),
  ctxProperty: document.getElementById("v2-ctx-property"),
  dockContext: document.getElementById("v2-dock-context"),
  ctxTypePicker: document.getElementById("v2-ctx-type-picker"),
  typeCurrent: document.getElementById("v2-type-current"),
  typeCurrentName: document.getElementById("v2-type-current-name"),
  typeCurrentMeta: document.getElementById("v2-type-current-meta"),
  typeFlyout: document.getElementById("v2-type-flyout"),
  checkOverlay: document.getElementById("v2-check-overlay"),
  checkClose: document.getElementById("v2-check-close"),
  aboutOverlay: document.getElementById("v2-about-overlay"),
  aboutOpen: document.getElementById("v2-about-open"),
  aboutClose: document.getElementById("v2-about-close"),
  aboutOk: document.getElementById("v2-about-ok"),
  account: document.getElementById("v2-account"),
  accountOpen: document.getElementById("v2-account-open"),
  accountOverlay: document.getElementById("v2-account-overlay"),
  accountClose: document.getElementById("v2-account-close"),
  accountAvatar: document.getElementById("v2-account-avatar"),
  accountAvatarLg: document.getElementById("v2-account-avatar-lg"),
  accountName: document.getElementById("v2-account-name"),
  accountEmail: document.getElementById("v2-account-email"),
  accountPlan: document.getElementById("v2-account-plan"),
  accountRole: document.getElementById("v2-account-role"),
  accountLicenseLeft: document.getElementById("v2-account-license-left"),
  accountMeter: document.getElementById("v2-account-meter"),
  accountLicenseRenews: document.getElementById("v2-account-license-renews"),
  accountSeats: document.getElementById("v2-account-seats"),
  accountFirm: document.getElementById("v2-account-firm"),
  accountAddress: document.getElementById("v2-account-address"),
  accountMember: document.getElementById("v2-account-member"),
  accountJobs: document.getElementById("v2-account-jobs"),
  accountJobsBtn: document.getElementById("v2-account-jobs-btn"),
  accountSignOut: document.getElementById("v2-account-signout"),
  ctxName: document.getElementById("v2-ctx-name"),
  ctxNameWrap: document.getElementById("v2-ctx-name-wrap"),
  ctxUse: document.getElementById("v2-ctx-use"),
  ctxUseWrap: document.getElementById("v2-ctx-use-wrap"),
  ctxRegion: document.getElementById("v2-ctx-region"),
  ctxRegionWrap: document.getElementById("v2-ctx-region-wrap"),
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
  ctxTop: document.getElementById("v2-ctx-top"),
  ctxTopWrap: document.getElementById("v2-ctx-top-wrap"),
  ctxWallH: document.getElementById("v2-ctx-wallh"),
  ctxWallHWrap: document.getElementById("v2-ctx-wallh-wrap"),
  ctxSill: document.getElementById("v2-ctx-sill"),
  ctxSillWrap: document.getElementById("v2-ctx-sill-wrap"),
  ctxOWidth: document.getElementById("v2-ctx-owidth"),
  ctxOWidthWrap: document.getElementById("v2-ctx-owidth-wrap"),
  ctxOHeight: document.getElementById("v2-ctx-oheight"),
  ctxOHeightWrap: document.getElementById("v2-ctx-oheight-wrap"),
  ctxOSizeNote: document.getElementById("v2-ctx-osize-note"),
  ctxConvert: document.getElementById("v2-ctx-convert"),
  ctxOOffset: document.getElementById("v2-ctx-ooffset"),
  ctxOOffsetWrap: document.getElementById("v2-ctx-ooffset-wrap"),
  ctxElevWrap: document.getElementById("v2-ctx-elev-wrap"),
  ctxElev: document.getElementById("v2-ctx-elev"),
  ctxElevCallout: document.getElementById("v2-ctx-elev-callout"),
  ctxElevOpen: document.getElementById("v2-ctx-elev-open"),
  ctxFinish: document.getElementById("v2-ctx-finish"),
  ctxShapePoly: document.getElementById("v2-ctx-shape-poly"),
  ctxShapePolyHint: document.getElementById("v2-ctx-shape-poly-hint"),
  elevBody: document.getElementById("v2-elevation-body"),
  elevFit: document.getElementById("v2-elev-fit"),
  elevInfo: document.getElementById("v2-elev-info"),
  elevInfoNote: document.getElementById("v2-elev-info-note"),
  elevFlip: document.getElementById("v2-elev-flip"),
  elevEdgeMode: document.getElementById("v2-elev-edge-mode"),
  levelParent: document.getElementById("v2-level-parent"),
  levelReference: document.getElementById("v2-level-reference"),
  ctxAttach: document.getElementById("v2-ctx-attach"),
  ctxAttachWrap: document.getElementById("v2-ctx-attach-wrap"),
  ctxFlip: document.getElementById("v2-ctx-flip"),
  ctxHinge: document.getElementById("v2-ctx-hinge"),
  massOverlay: document.getElementById("v2-mass-overlay"),
  massTitle: document.getElementById("v2-mass-title"),
  massCanvas: document.getElementById("v2-mass-canvas"),
  massEmpty: document.getElementById("v2-mass-empty"),
  massCaption: document.getElementById("v2-mass-caption"),
  massGenerate: document.getElementById("v2-mass-generate"),
  massShow3d: document.getElementById("v2-mass-show-3d"),
  massRender: document.getElementById("v2-mass-render"),
  massRenderImg: document.getElementById("v2-mass-render-img"),
  massRenderStatus: document.getElementById("v2-mass-render-status"),
  massClose: document.getElementById("v2-mass-close"),
  massPanel: document.querySelector("#v2-mass-overlay .mass-panel"),
  massPlanWrap: document.getElementById("v2-mass-plan-wrap"),
  massPlanCanvas: document.getElementById("v2-mass-plan-canvas"),
  massViewLabel: document.getElementById("v2-mass-view-label"),
  massServices: document.getElementById("v2-mass-services"),
  typeDetailOverlay: document.getElementById("v2-type-detail-overlay"),
  typeDetailPanel: document.querySelector("#v2-type-detail-overlay .type-detail-panel"),
  typeDetailName: document.getElementById("v2-type-detail-name"),
  typeDetailMeta: document.getElementById("v2-type-detail-meta"),
  typeDetailClose: document.getElementById("v2-type-detail-close"),
  typeDetailPrev: document.getElementById("v2-type-detail-prev"),
  typeDetailNext: document.getElementById("v2-type-detail-next"),
  typeDetailCount: document.getElementById("v2-type-detail-count"),
  typeDetailNav: document.getElementById("v2-type-detail-nav"),
  typeDetailMediaFrame: document.getElementById("v2-type-detail-media-frame"),
  typeDetailPlaceholder: document.getElementById("v2-type-detail-placeholder"),
  typeDetailPlaceholderIcon: document.getElementById("v2-type-detail-placeholder-icon"),
  typeDetailImg: document.getElementById("v2-type-detail-img"),
  typeDetailCategory: document.getElementById("v2-type-detail-category"),
  typeDetailDims: document.getElementById("v2-type-detail-dims"),
  typeDetailUse: document.getElementById("v2-type-detail-use"),
  sheetOverlay: document.getElementById("v2-sheet-overlay"),
  sheetClose: document.getElementById("v2-sheet-close"),
  sheetAdd: document.getElementById("v2-sheet-add"),
  sheetList: document.getElementById("v2-sheet-list"),
  sheetFields: document.getElementById("v2-sheet-fields"),
  sheetEmptyFields: document.getElementById("v2-sheet-empty-fields"),
  sheetView: document.getElementById("v2-sheet-view"),
  sheetLevel: document.getElementById("v2-sheet-level"),
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
  sheetCloudList: document.getElementById("v2-sheet-cloud-list"),
  projectInfoOverlay: document.getElementById("v2-project-info-overlay"),
  projectInfoClose: document.getElementById("v2-project-info-close"),
  projectInfoJobNumber: document.getElementById("v2-project-info-job-number"),
  projectInfoClientName: document.getElementById("v2-project-info-client-name"),
  elevationOverlay: document.getElementById("v2-elevation-overlay"),
  elevationClose: document.getElementById("v2-elevation-close"),
  elevationDirections: document.getElementById("v2-elevation-directions"),
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
// Pan is a view gesture, not a draw tool. The tool and any draft stay put
// and come back when Pan is pressed again or Escape is pressed.
let panMode = false;
let placeSkuId = null;
let placeStatus = "planned";
let planStatusFilter = "both";
// Systems the user has switched off on the plan. A view choice for this
// session: the routes stay in the document and come back when switched on.
const hiddenServiceSystems = new Set();
// Plan-only. "floor" hides floor-finish polygons, "wall" hides the stripes
// that stand for a finish on a wall face. The elevation, the panel and the
// bill keep them either way.
const hiddenFinishLayers = new Set();
let serviceVisKey = "";
let finishVisKey = "";
const SERVICE_CHIP = {
  coldWater: "Cold water",
  hotWater: "Hot water",
  drainage: "Drainage",
  electrical: "Electrical",
  gas: "Gas",
};
let placeRotation = 0;
let cam = { scale: 48, ox: 80, oy: 60 };
// Pixels per metre. 3000 is a few millimetres across the screen. 3 is far
// enough out that the 200 m satellite, and the ground around it, fit on a
// laptop; the old floor of 12 stopped at roughly 100 m.
const MIN_VIEW_SCALE = 0.1; // a 1:500 A1 site plan is ~420 m across, so the floor has to allow it
const MAX_VIEW_SCALE = 3000;
let drag = null;
// Click–click wall: first click writes the start, the free end follows the
// pointer with the button up, second click commits and chains from that end.
let wallDraft = null;
// Where the line under the cursor sits on the wall being drawn: "center",
// "exterior" or "interior" (see click-draw.js). The stored segment is always
// the centreline, and a face choice is kept on it as `location`. Remembered
// for the session.
let wallLocation = "center";
// Who owns the corner square where the wall being drawn meets an existing one:
// "past", "against" or "center" (see wall-join.js). Remembered for the session.
let wallCorner = "against";
// Space on a wall that started against another: the side is chosen from that
// wall, so this swaps it for the draft instead of changing the setting.
let wallSideFlip = false;
// Which jamb a door hinges from while the door tool is armed. The click is
// the centre, so both ends are the same distance from the pointer; Space
// flips this and the preview follows. 1 hinges at the low-t end.
let doorHandSign = 1;
// Click–click room/slab/roof rectangle: first click is one corner, second
// click is the opposite. Not a press-and-hold box.
let shapeDraft = null;
let beamStart = null;
// Document > Lines > Model / Annotate: the first click of a line, while
// tool === "model-line" or "annot-line". Same bare-point shape as beamStart -
// a line is a beam-shaped click-click with no SKU, not a chained wall.
let lineStart = null;
// Site > Property line: the vertices clicked so far, while tool === "property".
// Closed by clicking near the first point again, Enter, or double-click.
let siteDraft = null;
// Document > Rooms, when the click is not already inside walls: corners so far.
let roomDraft = null;
// Document > Annotate > Region: corners so far.
let regionDraft = null;
// The drawn boundary is selected. Corners can be dragged; the line itself moves.
let propertySelected = false;
let propertyHover = null;
// Site > SG diagram coordinates: the plan point clicked, while tool === "sg-ref",
// waiting on the erf number and real coordinate fields in the SG panel.
let sgPick = null;
// Output > Views > Camera: the stand point while tool === "camera", waiting
// on the look-at click. Same two-click shape as Set scale.
let cameraDraft = null;
// Document > Views > Section: the first end of the cut while tool === "section".
let sectionDraft = null;
// Output > Views > Call out: the first corner of the crop box while
// tool === "callout". Same click-click shape as Section's cut - a box needs
// two opposite corners exactly as a cut needs two endpoints.
let calloutDraft = null;
// Document > Annotate > Revision cloud: the first corner of the cloud box
// while tool === "revision". Same click-click shape as callout's crop box -
// see revision.js's header for why a cloud is not itself a sheet viewport.
let revisionCloudDraft = null;
// Document > Annotate > Dimensions: the first click while tool === "measure".
let measureDraft = null;
// Completed two-point strings kept while the measure tool stays armed, so a
// second pair can sit next to the first until Escape (or the button again)
// leaves the tool.
// Modify > Attach base: the refs waiting for a target while tool === "attach",
// plus the candidate under the pointer so the hint can preview what the click
// will do before it commits anything.
let attachPick = null;
// Services > Draw route: the last point placed, while tool === "service-route".
// Click-click like a wall: each click commits its run and chains from there.
// `createdStart` / `undoDepth` let Enter or Esc drop a run that never got past
// its first point instead of leaving a stray node behind.
let serviceRoute = null;
// Services > Connect: the route point waiting for a component to be clicked.
let serviceConnect = null;
// What the next run is drawn with. Heights are typed, never guessed: the
// default 0.00 m is shown in the field, and clearing it leaves new points
// unresolved rather than on the floor.
const serviceUi = {
  system: "coldWater", networkId: null, sku: null, offsetText: "0.00", mode: "measured",
  // How new route points sit against a wall: "off", "clear" (pipe edge
  // justOffsetText mm from the face) or "centre" (in the wall, as a chase).
  justMode: "off", justOffsetText: "150",
};
let serviceDockKey = "";
// Route profile interaction state (see onProfileDown).
let profileEdgeId = null;
let profileLayout = null;
let profileDrag = null;
let profileHoverGhost = null;
// null = automatic (Slope for drainage, Step for everything else).
let profileModePref = null;
let sizeDraft = null;
let hover = null;
let hoverPoint = null;
let wallsCache = [];
// Wall elevation: the face the strip under the plan is showing, and a drag in
// progress. `elevationOpen` is the "Open elevation" toggle; the face itself
// follows the selection (see wall-elevation.js).
let elevationOpen = false;
let elevationFace = null;
let elevationDrag = null;
let elevationKey = "";
let elevPreviewKey = "";
// Finishes: the inspector section's last markup and whether Products is open,
// and, while a floor finish region is being drawn, its { category, productId }
// (finishing the draft then writes doc.finishRegions).
let finishKey = "";
let finishProductsOpen = false;
// "floor" or "face" while the add-a-finish sheet covers that section.
let finishAddOpen = null;
let finishPanelHost = "";
let regionFinish = null;
// The floor finish region whose corners are being edited on the plan, and the
// corner Delete would remove. A region is edited through its floor: it is only
// live while that floor (or room) is the one thing selected.
let editingRegionId = null;
let selectedRegionVertex = null;
// The card under the pointer, or the region under the pointer on the plan.
// Kept off the markup key so a hover does not rebuild the inspector.
let hoverFinishRegionId = null;
// Which floor is showing its unfinished part, and which card just saved a product.
let bareFinishHost = null;
let finishSavedRegionId = null;
// The wall finish picked in the panel or the elevation, the one the pointer is
// over in the panel, and the one just saved.
let selectedBandId = null;
let hoverBandId = null;
let finishSavedBandId = null;
// The note open on the inspector elevation: a finish, or a window or door.
// A click there stays on the graph. Closing a window note keeps it closed
// until another opening is selected, or this one is clicked again.
let previewCallout = null;
let openingCalloutClosed = null;
// A wall finish being drawn on the elevation: corners in viewing coordinates
// (along the face, up from the base), the same click-the-corners flow as a floor.
let elevFinishDraft = null;
// The corner picked on a drawn wall finish, so Delete removes that corner.
let selectedElevVertex = null;
// What dragging an edge does. Line moves both ends together, and is the usual
// edit, so it starts selected. Corner adds a node. Shift uses the other one
// for a single drag, as Step and Slope do.
let elevEdgeMode = "line";
let floorEdgeMode = "line";
let finishSavedTimer = 0;
let finishScrolledId = null;
let bareLayer = null;

// While a wall, beam, room, slab or roof tool is armed, the nearest
// join/alignment (and, when not latched, how far the pointer is from it).
// Drawn as tracking lines; cleared when the tool is not snap-aware.
let snapGuide = null;
// Screen boxes of labels already painted this frame, so a snap string can
// step aside from a room or floor edge length instead of drawing through it.
let labelOccupied = [];
// Snap calibration / tracing clicks to the PDF's own endpoints and crossings.
// Session-only; on by default once a plan-set page is showing.
let snapToPdf = true;

function pdfSnapAvailable() {
  return hasOpenPdf() && Number.isInteger(store.doc?.underlay?.sheetPage) && underlayIsVisible();
}

function requestPdfLinework(pageIndex = store.doc?.underlay?.sheetPage) {
  if (!snapToPdf || !hasOpenPdf() || !Number.isInteger(pageIndex)) return;
  if (pageLineworkStatus(pageIndex) !== "idle") return;
  ensurePageLinework(pageIndex);
}

function pdfSnapTarget(wx, wy) {
  if (!snapToPdf || !pdfSnapAvailable()) return null;
  requestPdfLinework();
  return snapUnderlayWorld(store.doc.underlay, wx, wy, SNAP_PIXEL_TOL / cam.scale);
}

/** True while a click would miss PDF corners because the page is still being read. */
function pdfLineworkPending() {
  if (!snapToPdf || !pdfSnapAvailable()) return false;
  const status = pageLineworkStatus(store.doc.underlay.sheetPage);
  return status === "idle" || status === "loading";
}

/** Draw, trace, and sheet-alignment clicks. These are the ones that must wait for the index. */
function clickSnapsToPdf() {
  return snapPreviewTool() || tool === "align" || tool === "calibrate" || tool === "region" || tool === "separation";
}

function applyPdfPick(wx, wy) {
  const hit = pdfSnapTarget(wx, wy);
  return hit ? { x: hit.x, y: hit.y, kind: hit.kind } : { x: wx, y: wy };
}

function setSnapToPdf(on) {
  snapToPdf = Boolean(on);
  if (snapToPdf) requestPdfLinework();
  render();
}
// Route points being dragged: they must not snap to themselves, but the rest of
// the route (and every wall) is a target. Set only around the snap call.
let serviceMoveIds = null;

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
// still see the walls it carries. On: this cut only. The neighbour, the
// tracing sheet, and (on a ceiling or roof cut) the rest of the storey are
// not drawn. Hit-testing stays on what is drawn. The widget checkbox and
// the ribbon command share this flag.
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
// Flat, on-screen order of the palette's current listing, rebuilt by
// renderPalette(). Backs the type detail overlay's prev/next and side rail
// so "other options" always matches what the palette shows right now.
let paletteSkuOrder = [];
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
  syncGenerateEnabled();
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
    el.healthDot.hidden = false;
    el.healthDot.title = "The template catalogue did not load.";
    el.healthLabel.textContent = `Pack failed to load: ${err.message}`;
    return;
  }

  await loadRateBook(null);
  el.healthDot.classList.add("ok");
  // The count is about the app, not about the job on screen. Once the pack is
  // in there is nothing to report, so the chrome says nothing: the label is
  // free for passing messages and the number lives in About.
  el.healthDot.hidden = true;
  el.healthLabel.textContent = "";
  drawPackHealth();
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
  if (el.ctxRegion) {
    el.ctxRegion.innerHTML = `<option value="">Not set</option>${
      REGION_CONVENTIONS.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.id)}</option>`).join("")
    }`;
  }
  drawDensityButtons();
  drawLevelSwitcher();
  renderGapReport();
  drawRibbon();
  renderPalette();
  wireToolbar();
  wireCanvas();
  wireKeyboard();
  wireMassing();
  wireTypeDetail();
  wireCheck();
  wireSchedule();
  wireAbout();
  wireAccount();
  wireSheets();
  wireProjectInfo();
  wireElevationPicker();
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

/**
 * The prices a BOQ of the open job reads. A job records which book priced it
 * when it was registered; a job that names none is priced off the firm's
 * default as it stands today, which is the honest reading of a job opened
 * before any book was recorded.
 *
 * With no job open - signed out, or the standalone web/v2/index.html demo -
 * this falls back to the sample catalogue, so the editor still prices
 * something without an account behind it.
 *
 * Best-effort throughout: a book that will not load (unreachable, or a role
 * that is not allowed the firm's cost base) means "-" on every line and no
 * total, not a failed boot. schedule.js's findRate() already treats a missing
 * rate that way, and runBoq() says which of the two happened.
 */
async function loadRateBook(project) {
  rateBook = null;
  try {
    if (!project) {
      const res = await fetch("../samples/tsp-rates.json");
      if (res.ok) rateBook = await res.json();
      return;
    }
    const id = project.rateBookId ?? await cloud.defaultRateBookId();
    if (id) rateBook = await cloud.rateBook(id);
  } catch {
    rateBook = null;
  }
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
    currentSession = null;
    drawAccount();
    showAuth();
    return;
  }
  currentSession = session;
  await enterApp();
}

/**
 * Signed in: recover anything left in the old browser slot, then land on the
 * job list. The canvas is a drawing that already has a row; opening one is a
 * choice, not the default. Reconnects that already have a job attached stay
 * there — the retry after a dropped connection must not yank the work away.
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
    const jobs = splitLibrary(projects).jobs;
    setAccountJobCount(jobs.length);
    const requestedId = new URLSearchParams(location.search).get("project");
    // Nothing to open, and no link to one: a list that says "no drawings" is a
    // dead end. A job starts in practice operations, so that is where a firm
    // with no drawings belongs.
    if (!openDrawingId && !requestedId && !jobs.some((p) => p.drawingId)) {
      location.replace("/practice/index.html");
      return;
    }
    // Cover the editor before the login veil lifts, unless this is a reconnect
    // that already has a job on screen, or a link that is about to open one.
    if (!openDrawingId && !requestedId && el.libraryOverlay) {
      el.libraryOverlay.hidden = false;
      document.body.classList.add("library-home");
    }
    hideAuth();
    if (openDrawingId) return;
    if (requestedId) {
      try {
        await openJob({ cloud, sync, projectId: requestedId, apply: applyOpenedJob });
        closeLibraryAfterNavigation();
        setStatusMessage(`Opened ${store.doc.name || openProject?.code || "this job"}.`, "ok");
        return;
      } catch (error) {
        // A missing canvas is a register job that has not grown a drawing yet.
        // The library is the honest landing; the auth screen is for a session
        // or a server that is actually gone.
        if (error instanceof NavigationBlocked) throw error;
        if (error instanceof CloudError && (error.authRequired || error.status === 0)) throw error;
        await openLibrary({
          message: error?.message || "That job could not be opened.",
        });
        return;
      }
    }
    await openLibrary();
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

  // Not awaited: nothing on screen reads a price until somebody runs a BOQ,
  // and the editor must not wait on the firm's price list to open a drawing.
  loadRateBook(project);

  clearUnderlay(store.doc);
  // A fetch started for the job being left must not open its PDF onto this one.
  underlayFetchToken += 1;
  underlayFetchFor = null;
  setPdfRestorePending(false);
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
  const address = new URL(location.href);
  address.searchParams.set("project", project.id);
  const next = `${address.pathname}${address.search}`;
  if (next !== `${location.pathname}${location.search}`) history.replaceState(null, "", next);
  frameDrawing(store.doc);
  render();
}

/** After Open / Create, put the whole drawing on screen. A plan sheet counts even when nothing has been traced yet, so the PDF is in view. New empty jobs stay put. */
function frameDrawing(doc) {
  const b = unionBounds(drawingBounds(doc), underlayFrameBounds(doc, activeLevel));
  if (!b || !el.canvas) return;
  const rect = el.canvas.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return;
  const pad = 1.4;
  const w = Math.max(1, b.maxX - b.minX + pad * 2);
  const h = Math.max(1, b.maxY - b.minY + pad * 2);
  cam.scale = Math.min(90, Math.max(MIN_VIEW_SCALE, Math.min((rect.width - 48) / w, (rect.height - 48) / h)));
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  cam.ox = rect.width / 2 - cx * cam.scale;
  cam.oy = rect.height / 2 - cy * cam.scale;
}

function unionBounds(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
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
  if (signedOut) {
    currentSession = null;
    setAccountOpen(false);
    drawAccount();
  }
  if (el.libraryOverlay) el.libraryOverlay.hidden = true;
  document.body.classList.remove("library-home");
  if (!el.auth) return;
  el.auth.hidden = false;
  document.body.classList.add("login-active", "auth-pending");
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
  document.body.classList.remove("login-active", "auth-pending");
  setAuthError("");
  syncLibrarySurface();
  resizeCanvas();
  // The ribbon's boot-time fit ran while .chrome was still display:none
  // (body.auth-pending), so every group measured as zero-width and stayed
  // at its unshrunk "large" scale — the ribbon then looks like it belongs to
  // a much wider window until something re-triggers fitRibbon (a resize, or
  // a Simple/Full click, which redraws and refits). Now that the chrome is
  // actually visible, refit for real once layout has settled.
  requestAnimationFrame(() => fitRibbon(el.ribbonFunctions));
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

function initAuthGlint(card) {
  if (!card || card.dataset.glintInit) return;
  card.dataset.glintInit = "1";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) return;

  const GLINT_DUR = 0.48;
  const PAIR_GAP = 120;
  const IDLE_MIN = 1800;
  const IDLE_MAX = 4500;

  const glints = {
    top: card.querySelector(".auth-glint-top"),
    bottom: card.querySelector(".auth-glint-bottom"),
    left: card.querySelector(".auth-glint-left"),
    right: card.querySelector(".auth-glint-right"),
  };
  if (!glints.top) return;

  let glintTimer = null;

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function sizeCard() {
    card.style.setProperty("--login-card-w", `${card.offsetWidth}px`);
    card.style.setProperty("--login-card-h", `${card.offsetHeight}px`);
  }

  sizeCard();
  new ResizeObserver(sizeCard).observe(card);

  function runGlint(node, animClass) {
    node.classList.remove("run-h-ltr", "run-h-rtl", "run-v-ttb", "run-v-btt");
    void node.offsetWidth;
    node.style.setProperty("--login-glint-dur", `${GLINT_DUR}s`);
    node.classList.add(animClass);
    node.addEventListener("animationend", () => node.classList.remove(animClass), { once: true });
  }

  function burstGlint() {
    const horizontal = Math.random() < 0.62;
    const ltr = Math.random() < 0.5;
    const hAnim = ltr ? "run-h-ltr" : "run-h-rtl";
    const vAnim = Math.random() < 0.5 ? "run-v-ttb" : "run-v-btt";
    const side = Math.random() < 0.5 ? glints.left : glints.right;

    if (horizontal) {
      runGlint(glints.top, hAnim);
      setTimeout(() => runGlint(glints.bottom, hAnim), PAIR_GAP);
    } else {
      runGlint(side, vAnim);
    }

    const sweepMs = horizontal ? GLINT_DUR * 1000 + PAIR_GAP + 80 : GLINT_DUR * 1000 + 80;
    glintTimer = setTimeout(scheduleGlint, sweepMs + rand(IDLE_MIN, IDLE_MAX));
  }

  function scheduleGlint() {
    if (glintTimer) clearTimeout(glintTimer);
    glintTimer = setTimeout(burstGlint, rand(600, 1400));
  }

  scheduleGlint();
}

function wireAuth() {
  if (!el.authForm) return;
  initAuthGlint(el.authForm);

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
      currentSession = authMode === "sign-in"
        ? await cloud.signIn({ email, password })
        : await cloud.signUp({ email, password, orgName });
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

// --- the account menu --------------------------------------------------
//
// Who is signed in, what the firm is paying for, and how many jobs sit on
// the account. Session facts come from the server; the licence meter is
// preview chrome (see profile.js) so the same account always looks the same.

let currentSession = null;
let accountJobCount = 0;

function setAccountJobCount(count) {
  accountJobCount = Number(count) || 0;
  drawAccount();
}

function setAccountOpen(open) {
  if (!el.accountOverlay || !el.accountOpen) return;
  el.accountOverlay.hidden = !open;
  el.accountOpen.setAttribute("aria-expanded", open ? "true" : "false");
}

function accountIsOpen() {
  return Boolean(el.accountOverlay && !el.accountOverlay.hidden);
}

function drawAccount() {
  if (!el.account) return;
  if (!currentSession) {
    setAccountOpen(false);
    el.account.hidden = true;
    return;
  }
  el.account.hidden = false;
  const card = accountCard(currentSession, { jobCount: accountJobCount });
  const setText = (node, value) => { if (node) node.textContent = value; };
  setText(el.accountAvatar, card.initials);
  setText(el.accountAvatarLg, card.initials);
  setText(el.accountName, card.name);
  setText(el.accountEmail, card.email);
  setText(el.accountPlan, card.license.level);
  setText(el.accountRole, card.role);
  setText(el.accountLicenseLeft, `${card.licenseLeft} left`);
  setText(el.accountLicenseRenews, `Renews ${card.licenseRenews}`);
  setText(el.accountSeats, `${card.license.seatsUsed} of ${card.license.seatsIncluded} seats`);
  setText(el.accountFirm, card.orgName);
  setText(el.accountAddress, card.address.lines.join("\n"));
  setText(el.accountMember, card.memberSince
    ? `${card.memberFor} · since ${formatDate(card.memberSince)}`
    : "—");
  setText(el.accountJobs, card.jobCount === 1 ? "1 live job" : `${card.jobCount} live jobs`);
  if (el.accountMeter) el.accountMeter.style.width = `${Math.round(card.license.yearProgress * 100)}%`;
  if (el.accountOpen) {
    el.accountOpen.title = `${card.name} · ${card.license.level}`;
  }
}

function wireAccount() {
  if (!el.accountOpen) return;

  el.accountOpen.addEventListener("click", async () => {
    if (accountIsOpen()) {
      setAccountOpen(false);
      return;
    }
    drawAccount();
    setAccountOpen(true);
    try {
      const projects = await cloud.listProjects();
      setAccountJobCount(splitLibrary(projects).jobs.length);
    } catch {
      // Stale count is still a count; the page stays up.
    }
  });

  el.accountClose?.addEventListener("click", () => setAccountOpen(false));
  el.accountJobsBtn?.addEventListener("click", () => {
    setAccountOpen(false);
    openLibrary();
  });
  el.accountSignOut?.addEventListener("click", () => {
    setAccountOpen(false);
    runSignOut();
  });
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
  syncLibrarySurface();
  setLibraryMessage(message);
  await refreshLibrary({ keepMessage: Boolean(message) });
}

function closeLibrary() {
  if (!el.libraryOverlay) return;
  // With no job open there is nothing behind this but a canvas that belongs to
  // no row and cannot be saved, so the way out is New or Open, not Close.
  if (!openDrawingId) {
    setLibraryMessage("Open a drawing or start a new one — there is nothing open behind this.");
    return;
  }
  el.libraryOverlay.hidden = true;
  renamingProjectId = null;
  syncLibrarySurface();
}

/**
 * The same overlay is the post-login landing and the in-editor Open dialog.
 * With no drawing attached it is a page, not a veil over a canvas that cannot
 * be saved.
 */
function syncLibrarySurface() {
  const visible = Boolean(el.libraryOverlay && !el.libraryOverlay.hidden);
  const home = visible && !openDrawingId;
  const wasHome = document.body.classList.contains("library-home");
  document.body.classList.toggle("library-home", home);
  // body.library-home hides .chrome the same way auth-pending does, so
  // fitRibbon measured everything as zero-width while it was up. When it
  // comes back down and the chrome is visible again, refit for real rather
  // than leaving every group stuck at its unshrunk "large" scale.
  if (wasHome && !home) requestAnimationFrame(() => fitRibbon(el.ribbonFunctions));
  if (el.libraryTitle) el.libraryTitle.textContent = home ? "Your drawings" : "Jobs";
  if (el.libraryKicker) {
    el.libraryKicker.hidden = !home;
    el.libraryKicker.textContent = "Open a drawing, or start a job.";
  }
  if (el.libraryClose) {
    el.libraryClose.hidden = !openDrawingId;
    el.libraryClose.disabled = !openDrawingId;
    el.libraryClose.title = openDrawingId ? "" : "Open a drawing first.";
  }
  if (el.libraryNew) el.libraryNew.textContent = "New job";
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
  setAccountJobCount(splitLibrary(libraryProjects).jobs.length);
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
    el.libraryNew.title = blocked || "Jobs are started in practice operations.";
  }
  if (el.libraryClose) {
    el.libraryClose.hidden = !openDrawingId;
    el.libraryClose.disabled = !openDrawingId;
    el.libraryClose.title = openDrawingId ? "" : "Open a drawing first.";
  }

  if (!jobs.length && !deleted.length) {
    const empty = document.createElement("p");
    empty.className = "library-empty hint";
    empty.textContent = "No drawings yet. Start a job in practice operations, then press Start a drawing on it.";
    el.libraryList.appendChild(empty);
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

/**
 * `file-new`. A job starts in practice operations, where it gets a code, a
 * type, a billing basis and a client; the drawing is attached from there. This
 * flushes first so leaving cannot drop an unconfirmed change.
 */
async function runNewJob() {
  const blocked = connectionBlocked();
  if (blocked) {
    setLibraryMessage(blocked);
    setStatusMessage(blocked, "warn");
    return;
  }
  await runLibraryCommand(async () => {
    await flushForNavigation(sync);
    location.assign("/practice/index.html?new=1");
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
 * Sign-out revokes the session, so anything still queued would 401 on its way
 * out. It is flushed first and the sign-out is abandoned if that fails: losing
 * the queue here would be indistinguishable from losing the work.
 */
async function runSignOut() {
  try {
    await sync.flush();
    if (sync.isDirty()) {
      const message = "This job has changes that have not reached the server. Signing out now would lose them.";
      setLibraryMessage(message);
      setStatusMessage(message, "warn");
      return;
    }
    await cloud.signOut();
  } catch (error) {
    const message = libraryErrorMessage(error);
    setLibraryMessage(message);
    setStatusMessage(message, "warn");
    return;
  }
  // Nothing to draw into and nowhere to draw it: the document goes back to
  // empty, and the save path is pointed at a transport that refuses rather than
  // at a drawing this browser is no longer allowed to write to.
  openProject = null;
  openDrawingId = null;
  currentSession = null;
  accountJobCount = 0;
  setAccountOpen(false);
  drawAccount();
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
  syncLibrarySurface();
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
  sizeJobName();
  if (el.jobCode) {
    const code = openProject?.code || "";
    el.jobCode.textContent = code;
    el.jobCode.hidden = !code;
  }
  if (el.practiceLink) {
    const id = openProject?.id;
    el.practiceLink.hidden = !id;
    if (el.practiceSep) el.practiceSep.hidden = !id;
    if (id) el.practiceLink.href = `/practice/index.html?project=${encodeURIComponent(id)}`;
  }
}

/** Keep the name field as wide as what is in it, so the save state beside it
 *  stays attached to the name it describes. The CSS min/max still bound it. */
function sizeJobName() {
  if (!el.jobName) return;
  const shown = el.jobName.value || el.jobName.placeholder || "";
  el.jobName.style.width = `${shown.length + 1}ch`;
}

function wireJobName() {
  el.jobName?.addEventListener("input", () => {
    // Blank means unnamed, not the string "": the title block prints an
    // em-dash for a fact the document does not have.
    const typed = el.jobName.value.trim();
    store.doc.name = typed || null;
    sizeJobName();
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
  get wallDraft() { return wallDraft; },
  get shapeDraft() { return shapeDraft; },
  get beamStart() { return beamStart; },
  get lineStart() { return lineStart; },
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
  if (wallDraft) return { x: wallDraft.x1, y: wallDraft.y1 };
  if (drag?.kind === "segment-end") return { x: drag.fx, y: drag.fy };
  if (drag?.kind === "property-vertex" && drag.origin) {
    const prev = drag.origin[(drag.index - 1 + drag.origin.length) % drag.origin.length];
    return { x: prev[0], y: prev[1] };
  }
  if (shapeDraft?.x0 != null) return { x: shapeDraft.x0, y: shapeDraft.y0 };
  if (beamStart) return beamStart;
  if (measureDraft?.a) return measureDraft.a;
  const routeFrom = serviceRouteFrom();
  if (routeFrom) return { x: routeFrom.x, y: routeFrom.y };
  if (regionDraft?.length) return regionDraft[regionDraft.length - 1];
  if (roomDraft?.length) return roomDraft[roomDraft.length - 1];
  return null;
}

/** The start of a two-point line being drawn, whose length label sits on the run. */
function drawingLineFrom() {
  if (wallDraft) return { x: wallDraft.x1, y: wallDraft.y1 };
  if (beamStart) return beamStart;
  if (lineStart) return lineStart;
  if (measureDraft?.a) return measureDraft.a;
  if (regionDraft?.length) return regionDraft[regionDraft.length - 1];
  if (roomDraft?.length) return roomDraft[roomDraft.length - 1];
  return null;
}

/** The slab or room outline a finish region must stay inside. */
function finishHostPoly() {
  if (!regionFinish) return null;
  if (regionFinish.slabId) {
    const slab = (store.doc.slabs || []).find((s) => s.id === regionFinish.slabId);
    return slab ? shapePolygon(slab.shape) : null;
  }
  if (regionFinish.roomId) {
    const room = (store.doc.rooms || []).find((r) => r.id === regionFinish.roomId);
    return room ? roomPolygon(room) : null;
  }
  return null;
}

/** The node a route in progress chains from, or null if it is gone (undo, delete). */
function serviceRouteFrom() {
  if (!serviceRoute?.fromNodeId) return null;
  return (store.doc.serviceNodes || []).find((n) => n.id === serviceRoute.fromNodeId) || null;
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
  let targets = collectSnapTargets(store.doc, snapOpts(exclude));
  // Corners already placed on the finish being drawn are not in the document
  // yet. They still align, the same way the other corners of a floor do.
  if (tool === "region" && regionDraft?.length) {
    for (const placed of regionDraft) targets.push({ x: placed.x, y: placed.y, kind: "corner" });
  }
  // A face-drawn wall starting on another wall's centreline end would sit half
  // a thickness across that wall; its face corners are the points that line up.
  if (tool === "wall" && isFaceLocation(wallLocation)) targets = targets.filter((p) => p.kind !== "endpoint");
  const edges = collectSnapEdges(store.doc, snapOpts(exclude));
  const tol = SNAP_PIXEL_TOL / cam.scale;
  const pdfHit = pdfSnapTarget(wx, wy);
  if (pdfHit) targets.push(pdfHit);
  let result = snapPoint(wx, wy, targets, tol);
  // A corner wins; failing that, a point anywhere along a wall's face beats a
  // same-X/Y guide, so a wall can start against the side or end of another.
  if (!isExactPointSnap(result)) {
    const onFace = snapToFace(wx, wy, edges, tol);
    if (onFace.snapped) result = onFace;
  }
  // An exact join already fully determines the point (both axes locked to
  // the same target corner) - an edge-alignment origin has nothing left to
  // contribute, and showing one anyway would draw a second, unrelated
  // dimension next to a corner that is already snapped.
  const exactJoin = isExactPointSnap(result);
  const align = exactJoin ? { nearest: null, dist: Infinity } : nearestAlignments(wx, wy, targets, edges);
  const from = snapFrom();
  const originsX = [];
  const originsY = [];
  if (from) {
    originsX.push(from.x);
    originsY.push(from.y);
  }
  // Gates two different things at two different radii: `nearForOrigin` is
  // whether the alignment point is close enough to trust as the anchor for
  // round-length snapping (tight - it would otherwise steal the rounding
  // away from the run's own start point), `near` is only whether it is
  // close enough to be worth drawing as an informational gap dimension
  // (looser - "6000 mm to that wall" is useful from well across the site).
  const nearForOrigin = align.nearest && align.dist <= ALIGN_ORIGIN_MAX_M;
  if (nearForOrigin) {
    originsX.push(align.nearest.x);
    originsY.push(align.nearest.y);
  }
  const near = align.nearest && align.dist <= GAP_MAX_M;
  originsX.push(0);
  originsY.push(0);
  let point = applyNicePoint(wx, wy, {
    join: result,
    from,
    originsX,
    originsY,
    tolWorld: tol,
    minStep: NICE_MIN_STEP_M,
  });
  // A route drawn beside a wall keeps its justification. "Clear" lands the pipe
  // edge the chosen distance from the face, unless a corner has already locked
  // the point. "In the wall" is stricter: the point is on a wall's centreline or
  // it is not placed at all, so a click in open space cannot sneak a free point in.
  let chaseHeld = false;
  if (tool === "service-route" && serviceUi.justMode === "centre") {
    const j = justifyPoint(serviceWalls(), point.x, point.y, { mode: "centre", radius: routeRadius() });
    chaseHeld = Boolean(j);
    if (j) point = { x: j.x, y: j.y };
  } else if (tool === "service-route" && serviceUi.justMode === "clear" && !exactJoin) {
    const j = justifyPoint(serviceWalls(), point.x, point.y, {
      mode: "clear",
      offset: (Number(String(serviceUi.justOffsetText).replace(",", ".")) || 0) / 1000,
      radius: routeRadius(),
    });
    if (j) point = { x: j.x, y: j.y };
  }
  if (tool === "region" && regionFinish) {
    const host = finishHostPoly();
    if (host?.length >= 3) {
      const hostEdges = [];
      for (let i = 0; i < host.length; i += 1) {
        const a = host[i];
        const b = host[(i + 1) % host.length];
        hostEdges.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
      }
      const hostTol = tol * 1.8;
      if (!isExactPointSnap(result)) {
        const onHost = snapToFace(point.x, point.y, hostEdges, hostTol);
        if (onHost.snapped) point = { x: onHost.x, y: onHost.y };
      }
      const clamped = clampToPoly(point.x, point.y, host);
      point = { x: clamped.x, y: clamped.y };
      const first = regionDraft?.[0];
      if (first && Math.hypot(point.x - first.x, point.y - first.y) <= hostTol) {
        point = { x: first.x, y: first.y };
      }
    }
  }
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
    // So drawSnapGuide can tell a hard endpoint/corner join apart from a
    // same-X/Y alignment guide - both otherwise look like the same dashed
    // line + square marker, which is what made an alignment guide read as
    // "snapped to the middle of that wall".
    exactJoin,
    origin,
    dx: origin ? point.x - origin.x : null,
    dy: origin ? point.y - origin.y : null,
    probes: buildProbes(point, edges),
    tol,
    // True only while "In the wall" has actually put this point inside a wall.
    chaseHeld,
  };
  return point;
}

function buildProbes(point, edges) {
  return resolveProbes(point.x, point.y, [probeSide.h, probeSide.v].filter(Boolean), edges);
}

function snapPreviewTool() {
  return tool === "wall" || tool === "beam" || tool === "room" || tool === "slab"
    || tool === "roof" || tool === "property" || tool === "sg-ref" || tool === "camera" || tool === "section"
    || tool === "callout" || tool === "revision" || tool === "model-line" || tool === "annot-line"
    || tool === "measure" || tool === "service-route" || tool === "region";
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

function serviceSystemShown(system) {
  return serviceLayerVisible(system, hiddenServiceSystems);
}

function finishLayerShown(layer) {
  return !hiddenFinishLayers.has(layer);
}

function planObjectVisible(obj) {
  // A route point or run has no status of its own: it is its network's.
  // A system the user has switched off is neither drawn nor pickable.
  if (obj?.networkId) {
    const system = networkOf(store.doc, obj.networkId)?.system;
    if (!serviceSystemShown(system)) return false;
    return statusVisible(serviceStatus(store.doc, obj), planStatusFilter);
  }
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

/** House-rail cut the plan is actually showing. Empty before the widget
 * builds; a floor plan is the right default for that moment. */
function activeStationKind() {
  return houseStations[activeStationIndex()]?.kind || "floor";
}

/** Which slice of a storey an object is, for "Show only this level". */
function objectPlanRole(obj) {
  if (!obj || typeof obj !== "object") return "wall";
  if (obj.networkId) return "service";
  if (obj.separation || (obj.rect && Object.prototype.hasOwnProperty.call(obj, "sheetId"))) return "line";
  if (obj.shape && Object.prototype.hasOwnProperty.call(obj, "convention") && !obj.use) return "line";
  if (obj.shape && obj.use) return "room";
  if (obj.shape && (obj.form || obj.ridge)) return "roof";
  if (obj.shape) return skuById(obj.sku)?.category === "ceiling" ? "ceiling" : "floor";
  if (obj.kind === "model" || obj.kind === "annotation") return "line";
  if (Number.isFinite(obj.x1) && Number.isFinite(obj.y1)) {
    const cat = skuById(obj.sku)?.category;
    return cat === "beam" || cat === "column" ? "beam" : "wall";
  }
  if (obj.wallId || Number.isFinite(obj.t)) return "opening";
  return "item";
}

/** True when this object is part of the cut on screen. Off, everything on
 * the active level stays. On, a ceiling or roof cut drops the rest of the
 * storey. */
function keptByCut(obj, role = objectPlanRole(obj)) {
  return !isolateCurrentLevel || isolateShows(activeStationKind(), role);
}

/** Drawn and pickable on the plan right now: status, active level, and cut. */
function refShownOnPlan(ref) {
  const obj = objByRef(ref);
  if (!obj || !planObjectVisible(obj)) return false;
  if (ref.kind === "opening") {
    const wall = wallForOpening(store.doc, pack, wallsCache, obj);
    if (!wall || !onPlanOf(pack.levels, wall.level, activeLevel) || !planObjectVisible(wall)) return false;
    return keptByCut(obj, "opening");
  }
  return onActiveLevel(obj) && keptByCut(obj);
}

function pruneInvisibleSelection() {
  if (!store.selected.length) return;
  const kept = store.selected.filter((ref) => planRefVisible(ref) && (!isolateCurrentLevel || refShownOnPlan(ref)));
  if (kept.length === store.selected.length) return;
  if (!kept.length) {
    store.clearSelection();
    return;
  }
  const primaryKept = store.primary && kept.some((r) => r.kind === store.primary.kind && r.id === store.primary.id);
  store.setSelection(kept, primaryKept ? store.primary : kept[0]);
}

/** Plan thickness of a drawn segment, for the face corners snapping needs.
 * Zero when the SKU is unknown, which `faceCorners` reads as "no faces". */
function segmentThickness(seg) {
  const sku = skuById(seg?.sku);
  return sku ? drawnWallThickness(sku) : 0;
}

/** SKU category ("wall", "foundation", "boundarywall", "beam"...) of a drawn
 * segment or beam, for the snap-target caption to name what it caught. */
function segmentCategory(seg) {
  return skuById(seg?.sku)?.category || null;
}

function snapOpts(extra = {}) {
  return {
    ...extra,
    // Finish corners align while a finish is drawn or a corner of one is
    // dragged. A wall or a floor corner does not join onto a tile.
    finishes: tool === "region" || drag?.kind === "region-vertex" || drag?.kind === "region-edge",
    // Route points are targets for the route tool only (and for a route point
    // being dragged); a wall never snaps to a pipe.
    services: tool === "service-route" || Boolean(serviceMoveIds),
    include: (obj) => !(serviceMoveIds && obj.networkId && !obj.fromNode && serviceMoveIds.has(obj.id))
      && planObjectVisible(obj)
      && (obj.networkId ? onActiveLevel(obj) : (!isolateCurrentLevel || (onActiveLevel(obj) && keptByCut(obj)))),
    thicknessOf: segmentThickness,
    categoryOf: segmentCategory,
  };
}

function currentWalls() {
  if (pack) syncRoomBounds(store.doc, pack);
  wallsCache = pack ? deriveWalls(store.doc, pack) : [];
  return wallsCache;
}

/** The walls of the active storey a service run can sit against. A footing is not one. */
function serviceWalls() {
  return wallsCache.filter((w) => w.category !== "foundation" && w.thickness > 0 && onActiveLevel(w));
}

/** The pipe radius of the type the next run will be drawn with, or 0 when none is chosen. */
function routeRadius() {
  return pipeRadius(pack, { sku: serviceUi.sku }) || 0;
}

/** True if a shaped/drawn object (room, slab, roof, segment, beam, item) sits on the active level. */
function onActiveLevel(obj) {
  // A run belongs to the storeys its ends are on, not to a level of its own.
  if (obj?.fromNode) return edgeLevels(store.doc, pack, obj).includes(activeLevel);
  return onPlanOf(pack.levels, effectiveLevel(obj, pack), activeLevel);
}

/**
 * An opening has no level of its own - it belongs to whichever wall hosts it,
 * which is itself either a drawn segment's level or its bounding room's level.
 * `walls` is the full (unfiltered) derivation so a host is always found.
 */
function openingOnActiveLevel(opening, walls) {
  const wall = wallForOpening(store.doc, pack, walls, opening);
  return !!wall && onPlanOf(pack.levels, wall.level, activeLevel);
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
  const typedCeilings = Object.keys(store.doc?.sheetSet?.ceilingHeights || {}).length > 0;
  const elevEdits = store.doc?.levelElevations || {};
  const editedElevations = Object.keys(elevEdits).length > 0;
  pack = own.length || typedCeilings || editedElevations
    ? {
        ...templatePack,
        levels: applyLevelElevations(
          applyCeilingHeights(mergedLevels(templatePack.levels, own), store.doc?.sheetSet),
          elevEdits
        ),
      }
    : templatePack;
}

/** Turn a station's elevation into a millimetre field; Enter commits, Escape cancels. */
function editStationElevation(span, station) {
  if (station.kind === "roof") return;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "level-station-elev";
  input.inputMode = "decimal";
  input.value = String(Math.round(station.elevation * 1000));
  span.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    if (commit) commitStationEdit(station, input.value);
    else drawLevelSwitcher();
  };
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") finish(true);
    else if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(false));
}

function commitStationEdit(station, text) {
  const n = Number(String(text).trim().replace(",", "."));
  if (String(text).trim() === "" || !Number.isFinite(n)) {
    setStatusMessage("Enter the elevation in millimetres, e.g. 3000.", "warn");
    drawLevelSwitcher();
    return;
  }
  const metres = n / 1000;
  if (station.kind === "ceiling") {
    const level = (pack.levels || []).find((l) => l.id === station.levelId);
    const height = metres - (level?.elevation ?? 0);
    if (!store.doc.sheetSet) {
      setStatusMessage("Floor-to-ceiling can only be typed once a sheet set is loaded.", "warn");
    } else {
      store.pushUndo();
      if (!setCeilingHeight(store.doc.sheetSet, station.levelId, height)) {
        setStatusMessage("Ceiling must sit above its floor, within 20 m.", "warn");
      } else {
        store.persist();
      }
    }
  } else {
    const check = validateLevelEdit(pack.levels || [], station.levelId, metres);
    if (!check.ok) {
      setStatusMessage(check.message, "warn");
    } else {
      store.pushUndo();
      store.doc.levelElevations = setLevelElevation(store.doc.levelElevations, station.levelId, metres);
      store.persist();
      setStatusMessage(check.message, "ok");
    }
  }
  syncPackLevels();
  drawLevelSwitcher();
  drawRibbon();
  render();
}

function openLevelInsert() {
  levelInsertOpen = true;
  if (el.levelName) el.levelName.value = "";
  if (el.levelElevation) el.levelElevation.value = "";
  if (el.levelReference) el.levelReference.checked = false;
  if (el.levelParent) {
    const storeys = (pack.levels || []).filter((l) => l.elevation >= 0 && !l.parentId && !isReferenceLevel(l));
    el.levelParent.innerHTML = [`<option value="">None (its own storey)</option>`]
      .concat(storeys.map((l) => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.name || l.id)}</option>`))
      .join("");
  }
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
  // Elevation is typed in mm (like every other length in the UI) but stored
  // internally, and validated by validateLevelInsert, in metres. Levels can
  // sit below datum (foundations), so this allows zero/negative unlike
  // parseLengthMm, which is only for strictly-positive object dimensions.
  const elevationRaw = String(el.levelElevation?.value ?? "").trim();
  const elevationN = elevationRaw === "" ? NaN : Number(elevationRaw.replace(",", "."));
  const elevation = Number.isFinite(elevationN) ? elevationN / 1000 : "";
  const spec = {
    name: el.levelName?.value,
    elevation,
    kind: el.levelReference?.checked ? "reference" : null,
    parentId: el.levelParent?.value || null,
  };
  if (elevationRaw === "") {
    const message = "Enter the level's elevation in millimetres above the ground floor, e.g. 6000.";
    if (el.levelHint) el.levelHint.textContent = message;
    setStatusMessage(message, "warn");
    return;
  }
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
 * single type picked directly from the palette. A foundation SKU wins over
 * the ribbon filter, so picking one from search still counts as drawing a
 * foundation. Null while nothing is armed. */
function armedCategories() {
  const sku = skuById(placeSkuId);
  if (sku?.category === "foundation") return ["foundation"];
  if (paletteFilter) return paletteFilter;
  return sku ? [sku.category] : null;
}

/** Warning copy when the armed tool does not belong on the current cut
 * (a roof on "00 FOUNDATION", a foundation on the ground floor). Null when
 * the pair is not something the app can rule out. */
function placementCutWarning() {
  const level = (pack.levels || []).find((l) => l.id === activeLevel);
  return placementHintOverride({
    tool,
    stationKind: houseStations[activeStationIndex()]?.kind,
    level,
    levels: visibleLevels(),
    categories: armedCategories(),
  });
}

/** True when the armed type is a foundation and this cut is not its storey.
 * Clears any wall already started, so the second click cannot file it on
 * the ground floor after the ribbon hint has been replaced by "click to end". */
function refuseWrongFoundation() {
  if (skuById(placeSkuId)?.category !== "foundation") return false;
  const warning = placementCutWarning();
  if (!warning) return false;
  wallDraft = null;
  sizeDraft = null;
  snapGuide = null;
  setStatusMessage(warning, "warn");
  updateRibbonHint();
  return true;
}

/** Foundations belong on the below-datum storey the pack already names.
 * Arming one moves the cut there. Switching back is still possible; the
 * status line says why a foundation will not start on that plan. */
function offerFoundationPlan() {
  const cats = armedCategories();
  if (!cats?.length || cats.some((c) => c !== "foundation")) return;
  const home = foundationStorey(visibleLevels());
  if (!home || home.id === activeLevel) return;
  const idx = houseStations.findIndex((s) => s.levelId === home.id && (s.kind === "foundation" || s.kind === "floor"));
  if (idx < 0) return;
  selectStationIndex(idx);
  const name = home.name || home.id;
  setStatusMessage(`Foundations draw on "${name}". The level switcher moved there.`);
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
          <span class="level-station-elev">${formatLengthMm(s.elevation)}</span>
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
  if (el.cutElev) el.cutElev.textContent = `${formatLengthMm(s.elevation)} mm`;
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
    lineStart = null;
    wallDraft = null;
    shapeDraft = null;
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
  if (skuById(placeSkuId)?.category === "foundation") {
    const warning = placementCutWarning();
    if (warning) setStatusMessage(warning, "warn");
  }
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

  el.levelStations?.addEventListener("dblclick", (e) => {
    const span = e.target.closest(".level-station-elev");
    const btn = e.target.closest("button");
    if (!span || !btn) return;
    const station = houseStations.find((s) => s.id === btn.dataset.id);
    if (station) editStationElevation(span, station);
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
 * is working on the canvas: any mark (services included; those do not turn on
 * the Existing / Proposed legend), a selection, an armed tool, a draft, or a
 * visible underlay to trace. */
function shouldHidePlanEmpty() {
  if (hasPlanDrawing(store.doc)) return true;
  if (store.selected.length) return true;
  if (underlaySelected || underlayIsVisible()) return true;
  if (drag || wallDraft || shapeDraft || beamStart || siteDraft?.length || sgPick || attachPick || calibration) return true;
  if (activeFunction) return true;
  if (tool !== "select") return true;
  return false;
}

function draw() {
  labelOccupied = [];
  const rect = el.canvasWrap.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  if (!pack) return;

  if (underlayIsVisible()) drawUnderlay(ctx, store.doc, worldToScreen, cam.scale);
  drawGrid(rect);
  drawSiteLines();
  const walls = currentWalls();
  pruneInvisibleSelection();
  const levelWalls = walls.filter((w) => onActiveLevel(w) && keptByCut(w, "wall"));

  ctx.save();
  // While picking an attach target, everything that cannot be picked fades and
  // the candidates are re-drawn on top: the wrong thing is never clickable
  // rather than clickable-and-then-refused.
  if (attachPick) ctx.globalAlpha = 0.3;
  if (!isolateCurrentLevel) {
    const ghost = ghostContext(pack.levels, activeLevel);
    if (ghost) drawPlanLevel(ghost.levelId, walls, { ghost: true, look: ghost.look });
  }
  drawPlanLevel(activeLevel, walls, {
    allow: (role) => !isolateCurrentLevel || isolateShows(activeStationKind(), role),
  });
  ctx.restore();
  if (attachPick) drawAttachCandidates();
  if (showDimensions) drawDimensions();
  drawSavedDimensions();
  if (tool === "measure" && measureDraft?.a) drawMeasureDraft();

  drawSelectionHighlights(levelWalls);
  const serviceRefs = refsToDraw().filter((r) => (r.kind === "serviceNode" || r.kind === "serviceEdge") && refShownOnPlan(r));
  if (serviceRefs.length) {
    drawServiceSelection(ctx, { doc: store.doc, pack, refs: serviceRefs, worldToScreen, color: COLOUR.selection, levelId: activeLevel, scale: cam.scale });
  }
  if (hover && refShownOnPlan(hover) && !store.isSelected(hover.kind, hover.id) && tool === "select" && !drag) {
    if (hover.kind === "serviceNode" || hover.kind === "serviceEdge") drawServiceHover(ctx, { doc: store.doc, pack, ref: hover, worldToScreen, color: COLOUR.hover, scale: cam.scale });
    else drawHover(hover);
  }
  const ghost = serviceGhost();
  if (ghost) drawServiceGhost(ctx, { x: ghost.x, y: ghost.y, worldToScreen, colour: COLOUR.selection, doc: store.doc, pack, edgeId: ghost.edgeId, scale: cam.scale });
  if (tool === "service-route" && serviceRoute && serviceSystemShown(serviceUi.system)) {
    const from = serviceRouteFrom();
    if (from && hoverPoint) {
      // End on the snapped point, so what is drawn is what a click would place.
      const to = snapGuide ? { x: snapGuide.x, y: snapGuide.y } : hoverPoint;
      const offWall = serviceUi.justMode === "centre" && !snapGuide?.chaseHeld;
      const rel = offWall ? null : runWallRelation(serviceWalls(), from, to, routeRadius() || null);
      drawServiceDraft(ctx, {
        from, to,
        colour: offWall ? "#b2451e" : (SERVICE_SYSTEM_INFO[serviceUi.system]?.colour || "#2675b8"),
        worldToScreen,
        note: offWall ? "not in a wall" : clearanceText(rel),
        width: servicePlanWidth(pack, serviceUi.sku, cam.scale),
      });
    }
  }
  if (drag?.kind === "move" && drag.moved && drag.snaps.length && drag.snaps.every((s) => s.ref.kind === "serviceNode")) {
    // Where a moved run now sits against a wall, measured from the pipe's edge.
    const moveNotes = new Map();
    const moved = new Set(drag.snaps.map((s) => s.ref.id));
    const movedNodes = nodeMap(store.doc);
    const wallsHere = serviceWalls();
    for (const e of store.doc.serviceEdges || []) {
      if (!moved.has(e.fromNode) && !moved.has(e.toNode)) continue;
      const a = movedNodes.get(e.fromNode);
      const b = movedNodes.get(e.toNode);
      const text = a && b ? clearanceText(runWallRelation(wallsHere, a, b, pipeRadius(pack, e))) : "";
      if (text) moveNotes.set(e.id, text);
    }
    drawServiceMoveRuns(ctx, {
      notes: moveNotes,
      doc: store.doc,
      pack,
      nodeIds: drag.snaps.map((s) => s.ref.id),
      worldToScreen,
      colour: COLOUR.selection,
      levelId: activeLevel,
      skipEdgeIds: new Set(serviceRefs.filter((r) => r.kind === "serviceEdge").map((r) => r.id)),
    });
  }
  if (drag?.kind === "marquee") drawMarquee();
  if (wallDraft) drawWallDraft();
  if (tool === "wall") drawWallCornerTag();
  if (shapeDraft) drawShapeDraft();
  if (beamStart) drawBeamStart();
  if (lineStart) drawLineDraft();
  if (tool === "property" && siteDraft) drawPropertyDraft();
  if (tool === "region" && regionFinish) drawFinishHost();
  if (tool === "select") {
    drawBareFinish();
    drawHoveredFinishRegion();
    drawEditingFinishRegion();
    drawShapeEdgeLengths();
  }
  if (tool === "room" && roomDraft?.length) drawPolyDraft(roomDraft, "#b2451e");
  if (tool === "region" && regionDraft?.length) drawPolyDraft(regionDraft, "#8a7d6c");
  if (tool === "sg-ref" && sgPick) drawSgPick();
  if (tool === "camera" && cameraDraft?.a) drawCameraDraft();
  if (tool === "section" && sectionDraft?.a) drawSectionDraft();
  if (tool === "callout" && calloutDraft?.a) drawCalloutDraft();
  if (tool === "revision" && revisionCloudDraft?.a) drawRevisionCloudDraft();
  if (tool === "measure" && measureDraft?.a) drawMeasureDraft();
  drawLocateFlash();
  drawSnapGuide(rect);
  drawEndpointHandles();
  drawPropertyChrome();
  drawUnderlayHandles();
  if (calibration?.a) drawCalibration();
  drawAlignmentMarks();
  if ((tool === "calibrate" || tool === "align") && hoverPoint?.kind?.startsWith("pdf")) {
    drawPdfSnapMarker(hoverPoint.x, hoverPoint.y, hoverPoint.kind);
  }
  drawOpeningDraft(walls);
  if (isSatelliteUnderlay(store.doc) && underlayIsVisible()) drawSatelliteAttribution(rect);
  if (store.doc.sheetSet && underlayIsVisible()) drawSheetCaption(rect);

  el.empty.hidden = shouldHidePlanEmpty();
  el.legend.hidden = !store.hasContent();
  syncServiceVisibility();
  syncFinishVisibility();
  el.canvasWrap.classList.toggle("tool-opening", tool === "door" || tool === "window");
  el.canvasWrap.classList.toggle("tool-align", tool === "align");
}

/** Selection outline plus the four corner-scale handles and the free-rotate handle. */
const UNDERLAY_DRAG_KINDS = new Set(["underlay-move", "underlay-scale", "underlay-rotate"]);

/** Corner handles while the sheet is selected, and again once both scale points are down so the measured length can be resized into. */
function underlayHandlesActive() {
  if (!underlayIsVisible()) return false;
  // A pinned sheet has no handles to grab, which is how it reads as locked.
  if (store.doc.underlay?.pinned) return false;
  if (tool === "select" && underlaySelected) return true;
  if (tool === "calibrate" && calibration?.b) return true;
  return false;
}

function drawUnderlayHandles() {
  const pinnedView = tool === "select" && underlaySelected && underlayIsVisible() && Boolean(store.doc.underlay?.pinned);
  if (!underlayHandlesActive() && !pinnedView) return;
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

  if (pinnedView) {
    ctx.restore();
    return;
  }

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

/** Copper cross + ring on a PDF endpoint or crossing, distinct from the steel wall snap. */
function drawPdfSnapMarker(wx, wy, kind) {
  const [sx, sy] = worldToScreen(wx, wy);
  ctx.save();
  ctx.strokeStyle = "#b2451e";
  ctx.fillStyle = "#fffdf8";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(sx, sy, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx - 9, sy);
  ctx.lineTo(sx + 9, sy);
  ctx.moveTo(sx, sy - 9);
  ctx.lineTo(sx, sy + 9);
  ctx.stroke();
  const note = kind === "pdf-cross" ? "PDF crossing" : "PDF corner";
  drawSnapTag(sx + 10, sy - 10, note);
  ctx.restore();
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

/** Rubber-band crop box while the second corner is still being chosen - a
 * rectangle preview, not a line, because a callout boxes an area rather than
 * cutting along one. */
function drawCalloutDraft() {
  const target = hoverPoint;
  if (!target) return;
  const [ax, ay] = worldToScreen(calloutDraft.a.x, calloutDraft.a.y);
  const [bx, by] = worldToScreen(target.x, target.y);
  ctx.save();
  ctx.strokeStyle = COLOUR.hover;
  ctx.fillStyle = "rgba(180, 69, 30, 0.06)";
  ctx.lineWidth = 1.6;
  ctx.setLineDash([6, 4]);
  const x = Math.min(ax, bx);
  const y = Math.min(ay, by);
  ctx.fillRect(x, y, Math.abs(bx - ax), Math.abs(by - ay));
  ctx.strokeRect(x, y, Math.abs(bx - ax), Math.abs(by - ay));
  ctx.restore();
}

/** Rubber-band cloud box while the second corner is still being chosen -
 * scalloped, via `cloudArcs()`, rather than a plain rectangle, so the draft
 * already reads as "a revision cloud" and not "a callout crop". */
function drawRevisionCloudDraft() {
  const target = hoverPoint;
  if (!target) return;
  const rect = {
    minX: Math.min(revisionCloudDraft.a.x, target.x),
    minY: Math.min(revisionCloudDraft.a.y, target.y),
    maxX: Math.max(revisionCloudDraft.a.x, target.x),
    maxY: Math.max(revisionCloudDraft.a.y, target.y),
  };
  ctx.save();
  ctx.strokeStyle = COLOUR.hover;
  ctx.lineWidth = 1.4;
  for (const arc of cloudArcs(rect)) {
    const [cx, cy] = worldToScreen(arc.cx, arc.cy);
    const r = arc.r * cam.scale;
    ctx.beginPath();
    ctx.arc(cx, cy, r, arc.startAngle, arc.endAngle);
    ctx.stroke();
  }
  ctx.restore();
}

let lastRibbonHasSelection = null;
let lastRibbonDoor = null;

function render() {
  if (tool !== "select" || !propertyRing()) propertySelected = false;
  syncSheets();
  draw();
  syncSizeHud();
  syncPlanContext();
  syncModeBar();
  syncSatellitePanel();
  syncSgPanel();
  syncLevelPanel();
  restoreSatelliteBitmap();
  restoreStoredUnderlay();
  syncAttachPanel();
  syncHeaderModify();
  // Simple's Modify tab gates its whole content on selection; refresh it
  // only when that flips (not on every render(), which pointer drags call
  // continuously) so the tab unlocks the moment something is picked.
  const hasSel = store.selected.length > 0;
  const doorNow = Boolean(selectedDoor());
  if ((density === "simple" && activeTab === "modify" && hasSel !== lastRibbonHasSelection) || doorNow !== lastRibbonDoor) {
    drawRibbon();
  }
  lastRibbonHasSelection = hasSel;
  lastRibbonDoor = doorNow;
  const hintKey = `${tool}|${activeFunction || ""}|${store.selected.length}|${store.primary?.kind || ""}|${store.primary?.id || ""}|${panMode ? 1 : 0}`;
  if (hintKey !== lastPlanHintKey) {
    lastPlanHintKey = hintKey;
    updateRibbonHint();
  }
  placeFloorEdgeMode();
}

let lastPlanHintKey = "";

/** Rotate / Copy / Delete on the plan header, selection-aware: they only show
 * once something is selected, so people do not have to hunt the Modify tab
 * for the three operations they reach for constantly. */
function syncHeaderModify() {
  if (!el.headerModify) return;
  const model = store.selected.length > 0;
  const canDelete = model || propertySelected;
  el.headerModify.hidden = !canDelete;
  const door = selectedDoor();
  if (el.hmRotate) {
    el.hmRotate.hidden = !model;
    el.hmRotate.textContent = door ? "Flip hinge" : "Rotate";
    el.hmRotate.title = door ? "Flip which end the door hinges from" : "Rotate the selection 90°";
  }
  if (el.hmCopy) {
    el.hmCopy.hidden = !model;
    el.hmCopy.textContent = door ? "Flip swing" : "Copy";
    el.hmCopy.title = door ? "Flip which side of the wall the door opens to" : "Copy the selection";
  }
  if (el.hmDelete) el.hmDelete.hidden = !canDelete;
}

/** The one selected door, or null. A door has no free position: drag moves it, and the header buttons flip it. */
function selectedDoor() {
  const doors = selectedDoors();
  return doors?.length === 1 ? doors[0] : null;
}

/** Every selected opening, when the selection is doors only. Null otherwise,
 * so Rotate and Mirror keep their normal meaning for anything else. */
function selectedDoors() {
  if (!store.selected.length || !store.selected.every((r) => r.kind === "opening")) return null;
  const doors = [];
  for (const ref of store.selected) {
    const obj = objByRef(ref);
    if (skuById(obj?.sku)?.category !== "door") return null;
    doors.push(obj);
  }
  return doors;
}

/** Flip the hinge or the swing of the selected doors. Missing `hand` still
 * means the low-t jamb, so the first flip moves it. */
function flipDoors(which) {
  const doors = selectedDoors();
  if (!doors) return false;
  store.pushUndo();
  for (const opening of doors) {
    if (which === "hinge") opening.hand = opening.hand === -1 ? 1 : -1;
    else opening.swing = -(opening.swing || 1);
  }
  store.persist();
  const one = doors.length === 1;
  setStatusMessage(which === "hinge"
    ? (one
      ? (doors[0].hand === -1
        ? "The door hinges at the other end of the opening."
        : "The door hinges at the first end of the opening.")
      : `Flipped the hinge on ${doors.length} doors.`)
    : (one
      ? "Swing flipped to the other side of the wall."
      : `Flipped the swing on ${doors.length} doors.`));
  return true;
}

// --- underlay mode bar -----------------------------------------------------
//
// Set scale, Adjust and Align sheets are modes: they change what a click on
// the plan means. One docked strip says which one is on, which step it is on,
// what to click next, and how to leave. Cancel puts the sheets back as they
// were when the mode began; Done keeps the work.

const MODE_NAMES = { scale: "Set scale", adjust: "Adjust", align: "Align sheets" };
let barMode = null;
let barSnapshot = null;
let alignSheetsSignature = "";

function currentUnderlayMode() {
  if (tool === "calibrate") return "scale";
  if (tool === "align") return "align";
  if (tool === "select" && underlaySelected && underlayIsVisible()) return "adjust";
  return null;
}

/** Placements and alignment marks as they are now, so Cancel can put them back in place (the objects are shared with doc.sheetSet, so they are restored, not replaced). */
function captureUnderlayState() {
  const doc = store.doc;
  const pages = doc.sheetSet?.pages || [];
  const placements = new Map();
  for (const page of pages) if (page.placement) placements.set(page.placement, { ...page.placement, pinned: Boolean(page.placement.pinned) });
  if (doc.underlay && !placements.has(doc.underlay)) placements.set(doc.underlay, { ...doc.underlay, pinned: Boolean(doc.underlay.pinned) });
  return {
    placements,
    anchors: pages.map((page) => [page, page.anchor ? { ...page.anchor } : null]),
    showing: Number.isInteger(doc.underlay?.sheetPage) ? doc.underlay.sheetPage : null,
  };
}

function restoreUnderlayState(state) {
  for (const [placement, copy] of state.placements) Object.assign(placement, copy);
  for (const [page, anchor] of state.anchors) page.anchor = anchor;
}

/** Sheets an alignment runs across: every placed floor plan, including two drawings of the same floor, plus whatever is showing. */
function alignPages() {
  const set = store.doc.sheetSet;
  if (!set) return [];
  return alignablePages(set, store.doc.underlay?.sheetPage);
}

function syncModeBar() {
  if (!el.modeBar) return;
  const mode = currentUnderlayMode();
  if (mode !== barMode) {
    barMode = mode;
    barSnapshot = mode ? captureUnderlayState() : null;
  }
  el.modeBar.hidden = !mode;
  el.canvasWrap.classList.toggle("in-underlay-mode", Boolean(mode));
  if (!mode) return;

  const u = store.doc.underlay;
  const set = store.doc.sheetSet;
  const showingPage = set?.pages.find((p) => p.index === u?.sheetPage) || null;
  const bar = el.modeBar;
  for (const group of bar.querySelectorAll(".mode-controls")) group.hidden = group.dataset.mode !== mode;
  el.modeName.textContent = MODE_NAMES[mode];

  let step = "";
  let prompt = "";
  let primary = "Done";
  let primaryDisabled = false;
  let escLabel = "Esc";

  if (mode === "scale") {
    const aSet = Boolean(calibration?.a);
    const bSet = Boolean(calibration?.b);
    const n = !aSet ? 1 : !bSet ? 2 : 3;
    step = `${n} of 3`;
    prompt = [
      "Click the first point of a dimension you know.",
      "Click the second point.",
      "Type the real distance, or drag a corner to resize.",
    ][n - 1];
    primary = "Set scale";
    primaryDisabled = n < 3;
    setHidden(el.calibrateDistanceWrap, !bSet);
    setHidden(el.calibrateRestart, !aSet);
    if (bSet && !calibration.distanceEdited && el.calibrateDistance && document.activeElement !== el.calibrateDistance) {
      const guess = calibrationDistanceGuess(liveCalibrationPoint(calibration.a), liveCalibrationPoint(calibration.b));
      if (guess) el.calibrateDistance.value = formatLengthMm(guess);
    }
    if (bSet && el.calibrateDistance && !bar.dataset.distanceFocused) {
      bar.dataset.distanceFocused = "1";
      setTimeout(() => {
        el.calibrateDistance.focus();
        el.calibrateDistance.select();
      }, 0);
    }
    if (!bSet) delete bar.dataset.distanceFocused;
  } else {
    delete bar.dataset.distanceFocused;
  }

  if (mode === "adjust") {
    const pinned = Boolean(u?.pinned);
    step = showingPage?.label || u?.name || "";
    prompt = pinned
      ? "Pinned. Unpin to move, resize or rotate."
      : "Drag to move. Corners resize, the top handle rotates.";
    escLabel = "Esc = Done";
    sheetUi.syncPanel(el.modeSheet);
    if (u && document.activeElement !== el.underlayOpacity) el.underlayOpacity.value = String(Math.round((u.opacity ?? 0.55) * 100));
    if (u && document.activeElement !== el.underlayRotation) el.underlayRotation.value = String(Math.round(((u.rotation || 0) % 360) * 10) / 10);
    el.underlayPin.setAttribute("aria-pressed", String(pinned));
    el.underlayPin.textContent = pinned ? "Pinned" : "Pin";
    for (const control of [el.underlayRotation, el.underlayRotateCcw, el.underlayRotateCw]) control.disabled = pinned;
  }

  if (mode === "align") {
    const pages = alignPages();
    const marked = pages.filter((p) => p.anchor).length;
    const here = pages.find((p) => p.index === u?.sheetPage);
    const unmarked = pages.filter((p) => !p.anchor);
    step = `${marked} of ${pages.length} marked`;
    if (pages.length < 2) prompt = "Only one sheet is placed. Place another drawing of this floor, or another floor, to align them.";
    else if (marked === 0) prompt = `Click a point that is on every sheet, such as a building corner, on ${here?.label || "this sheet"}.`;
    else if (marked === pages.length) prompt = "Aligned. Check the faint overlay of the other sheet, then Done.";
    else if (here?.anchor) prompt = `Marked. Switch to ${unmarked[0].label} and click the same point.`;
    else prompt = `Click the same point on ${here?.label || "this sheet"}.`;
    primaryDisabled = marked === 1;

    const signature = JSON.stringify([u?.sheetPage, pages.map((p) => [p.index, p.label, Boolean(p.anchor)])]);
    if (signature !== alignSheetsSignature) {
      alignSheetsSignature = signature;
      el.alignSheets.replaceChildren(...pages.map((p) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `${p.anchor ? "✓" : "○"} ${p.label}`;
        button.classList.toggle("is-on", p.index === u?.sheetPage);
        button.addEventListener("click", () => sheetUi.goToSheet(p.index, { fit: false }));
        return button;
      }));
    }
    setHidden(el.alignNext, !(here?.anchor && unmarked.length));
    if (!el.alignNext.hidden) el.alignNext.dataset.index = String(unmarked[0].index);
    setHidden(el.alignClear, !marked);
  } else {
    alignSheetsSignature = "";
  }

  const snapping = (mode === "scale" || mode === "align") && pdfSnapAvailable();
  if (el.calibrateSnapWrap) el.calibrateSnapWrap.hidden = !snapping;
  if (el.calibrateSnap && document.activeElement !== el.calibrateSnap) el.calibrateSnap.checked = snapToPdf;
  if (snapping && el.modeSnapNote) {
    const status = pageLineworkStatus(u.sheetPage);
    el.modeSnapNote.textContent = status === "loading" ? " (reading…)" : status === "empty" ? " (no vector lines)" : status === "failed" ? " (could not read)" : "";
  }

  el.modeStep.textContent = step;
  el.modePrompt.textContent = prompt;
  el.modeDone.textContent = primary;
  el.modeDone.disabled = primaryDisabled;
  el.modeEsc.textContent = escLabel;
  el.modeCancel.hidden = mode === "adjust" && !barSnapshotChanged();
}

/** Adjust only offers Cancel once something moved, so the common case is a single Done. */
function barSnapshotChanged() {
  if (!barSnapshot) return false;
  for (const [placement, copy] of barSnapshot.placements) {
    for (const key of Object.keys(copy)) if (placement[key] !== copy[key]) return true;
  }
  return false;
}

/** Leave the mode with what was done kept. */
function doneUnderlayMode() {
  const mode = currentUnderlayMode();
  if (!mode) return;
  if (mode === "scale") {
    confirmCalibration();
    return;
  }
  if (mode === "align") {
    const pages = alignPages();
    const marked = pages.filter((p) => p.anchor).length;
    setStatusMessage(marked >= 2 ? "Sheets aligned." : "Nothing marked, so nothing was aligned.", marked >= 2 ? "ok" : "warn");
    tool = "select";
    setGhostSheets([]);
  } else {
    underlaySelected = false;
  }
  store.persist();
  syncToolButtons();
  drawRibbon();
  render();
}

/** Leave the mode and put the sheets back as they were when it began. */
function cancelUnderlayMode(message) {
  const mode = currentUnderlayMode();
  if (!mode) return;
  const snapshot = barSnapshot;
  if (snapshot) {
    restoreUnderlayState(snapshot);
    if (mode === "align" && snapshot.showing !== null && store.doc.underlay?.sheetPage !== snapshot.showing) {
      sheetUi.goToSheet(snapshot.showing, { fit: false });
    }
  }
  calibration = null;
  if (tool === "calibrate" || tool === "align") tool = "select";
  underlaySelected = false;
  setGhostSheets([]);
  store.persist();
  syncToolButtons();
  drawRibbon();
  render();
  sheetUi.toast(message || `${MODE_NAMES[mode]} cancelled, nothing changed.`, { ms: 4000 });
}

/** Starting a mode while another is on: Adjust is kept (its work is the sheet's new place), the others are cancelled and the user is told. */
function leaveUnderlayMode(next) {
  const mode = currentUnderlayMode();
  if (!mode || mode === next) return;
  if (mode === "adjust") {
    underlaySelected = false;
    return;
  }
  cancelUnderlayMode(next ? `${MODE_NAMES[mode]} cancelled, nothing changed. ${MODE_NAMES[next]} is on.` : undefined);
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
    cam.scale < 0.5 ? 500
    : cam.scale < 2 ? 100
    : cam.scale < 8 ? 20
    : cam.scale < 24 ? 5
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
  return onPlanOf(pack.levels, effectiveLevel(obj, pack), levelId);
}

function openingOnLevel(opening, walls, levelId) {
  const wall = wallForOpening(store.doc, pack, walls, opening);
  return !!wall && onPlanOf(pack.levels, wall.level, levelId);
}

/** One storey's geometry. Ghosted geometry is faded and unlabelled so it
 * reads as context, not as the plan you are editing. Look-up ghosts are
 * wall/beam markers only: a faded thick wall on a foundation cut would
 * read as a second foundation, not as "the wall that sits on this". */
function drawPlanLevel(levelId, walls, { ghost = false, look = "down", allow = () => true } = {}) {
  ctx.save();
  if (ghost && look === "up") {
    for (const wall of walls.filter((w) => onPlanOf(pack.levels, w.level, levelId) && planObjectVisible(w))) drawWall(wall, { marker: true });
    for (const beam of store.doc.beams.filter((b) => onLevel(b, levelId) && planObjectVisible(b))) drawBeam(beam, { marker: true });
    ctx.restore();
    return;
  }
  if (ghost) ctx.globalAlpha = 0.28;
  for (const slab of store.doc.slabs.filter((s) => onLevel(s, levelId) && planObjectVisible(s))) {
    const role = skuById(slab.sku)?.category === "ceiling" ? "ceiling" : "floor";
    if (!allow(role)) continue;
    drawPolyFill(shapePolygon(slab.shape), COLOUR.slab, statusStroke(objectStatus(slab)));
  }
  if (allow("roof")) {
    for (const roof of store.doc.roofs.filter((r) => onLevel(r, levelId) && planObjectVisible(r))) {
      const poly = shapePolygon(roof.shape);
      drawPolyFill(poly, COLOUR.roof, statusStroke(objectStatus(roof)));
      drawRoofGuides(bbox(poly), roof.form, roof.ridge);
    }
  }
  if (allow("room")) {
    for (const room of store.doc.rooms.filter((r) => onLevel(r, levelId) && planObjectVisible(r))) {
      if (ghost) drawRoomGhost(room);
      else drawRoom(room);
      drawSplitLevelLabel(room, levelId, ghost);
    }
  }
  if (allow("wall")) {
    const levelWalls = walls.filter((w) => onPlanOf(pack.levels, w.level, levelId) && planObjectVisible(w));
    for (const wall of levelWalls) drawWall(wall);
    if (!ghost && finishLayerShown("wall")) drawWallFinishMarks(levelWalls);
  }
  if (allow("beam")) {
    for (const beam of store.doc.beams.filter((b) => onLevel(b, levelId) && planObjectVisible(b))) drawBeam(beam);
  }
  // A model line ghosts like a wall/beam - it is a modelled fact, even
  // though it is 2D - but an annotation line does not: it is a note about
  // *this* level's plan, not context worth showing while looking at another
  // one, the same reason an item (furniture) is skipped when ghosted below.
  if (allow("line")) {
    for (const line of store.doc.lines.filter((l) => onLevel(l, levelId) && planObjectVisible(l))) {
      if (ghost && line.kind === "annotation") continue;
      drawLine(line);
    }
    if (!ghost) {
      for (const line of (store.doc.separations || []).filter((l) => onLevel(l, levelId) && planObjectVisible(l))) {
        drawSeparation(line);
      }
      for (const region of (store.doc.regions || []).filter((r) => onLevel(r, levelId) && planObjectVisible(r))) {
        drawRegion(region);
      }
      for (const region of (store.doc.finishRegions || []).filter((r) => onLevel(r, levelId))) {
        if (finishLayerShown("floor") || editingFinishRegion()?.id === region.id) drawFinishRegion(region);
      }
      for (const cloud of (store.doc.revisionClouds || []).filter((c) => onLevel(c, levelId))) {
        drawCloudMark(cloud.rect, cloud.rev || "");
      }
    }
  }
  if (!ghost && allow("item")) {
    for (const item of store.doc.items.filter((i) => onLevel(i, levelId) && planObjectVisible(i))) drawItem(item);
  }
  if (allow("opening")) {
    for (const opening of store.doc.openings.filter((o) => openingOnLevel(o, walls, levelId) && planObjectVisible(o))) {
      const wall = wallForOpening(store.doc, pack, walls, opening);
      if (wall && !planObjectVisible(wall)) continue;
      drawOpening(opening, walls);
    }
  }
  // Services last, so a route reads over the walls it runs through. A ghosted
  // storey shows its runs faded (context for lining this floor up with it); only
  // the active storey carries points, risers and labels.
  if (allow("service")) {
    drawServiceLevel(ctx, {
      doc: store.doc, pack, levelId, worldToScreen, scale: cam.scale, ghost, visible: planObjectVisible,
      activeLevel,
      wallFlags: !ghost && levelId === activeLevel ? serviceWallFlags(store.doc, pack, serviceWalls(), activeLevel) : null,
    });
  }
  ctx.restore();
}

/** "FFL -0.150" on a room that sits on a split level but draws on its parent's plan. */
function drawSplitLevelLabel(room, planLevelId, ghost) {
  const roomLevel = effectiveLevel(room, pack);
  if (ghost || roomLevel === planLevelId) return;
  const label = fflLabel(pack.levels, roomLevel);
  const poly = roomPolygon(room);
  if (!label || poly.length < 3) return;
  const b = bbox(poly);
  const [sx, sy] = worldToScreen(b.x + b.w / 2, b.y + b.h / 2);
  ctx.save();
  ctx.font = "600 11px sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = COLOUR.selection;
  ctx.fillText(label, sx, sy + 14);
  ctx.restore();
}

function drawRoomGhost(room) {
  const poly = roomPolygon(room);
  if (poly.length < 3) return;
  drawPolyFill(poly, "rgba(26, 22, 18, 0.04)", COLOUR.existing);
}

/** Paint a finish, cut to the floor or room it sits on, so a moved outline cannot leave colour outside it. */
function drawFinishRegion(region) {
  const poly = finishRegionPolygon(store.doc, region);
  if (poly.length < 3) return;
  const paint = finishRegionPaint(region);
  clipToFinishHost(region, () => {
    drawPolyFill(poly, paint.fill, paint.stroke);
    drawFloorFinishLabel(region, poly);
  });
}

/** The category name, the same words a wall finish uses on the plan. */
function finishCategoryLabel(item) {
  const category = item?.category || finishProductById(store.doc, item?.productId)?.category;
  return FINISH_CATEGORIES[category]?.label || "";
}

/** True while this floor is the one on screen, the same moment its walls are named. */
function floorFinishNamed(region) {
  if (store.selected.length !== 1 || !store.primary) return false;
  const ref = store.primary;
  if (ref.kind === "room") return region.roomId === ref.id;
  if (ref.kind === "slab") return finishRegionSlab(store.doc, region)?.id === ref.id;
  return false;
}

/**
 * Name a floor finish inside its area. A label that would land on the room's
 * own name sits just below the area figure instead.
 */
function drawFloorFinishLabel(region, poly) {
  if (!floorFinishNamed(region)) return;
  const label = finishCategoryLabel(region);
  if (!label) return;
  const box = bbox(poly);
  const [x0, y0] = worldToScreen(box.x, box.y);
  const [x1, y1] = worldToScreen(box.x + box.w, box.y + box.h);
  if (Math.abs(x1 - x0) < 36 || Math.abs(y1 - y0) < 16) return;
  let [cx, cy] = worldToScreen(...centroidOf(poly));
  const room = region.roomId ? (store.doc.rooms || []).find((r) => r.id === region.roomId) : null;
  if (room) {
    const [rx, ry] = worldToScreen(...centroidOf(roomPolygon(room)));
    if (Math.hypot(cx - rx, cy - ry) < 28) {
      cx = rx;
      cy = ry + 28;
    }
  }
  ctx.save();
  ctx.font = "600 11px Source Sans 3, sans-serif";
  ctx.fillStyle = "#1a1612";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, cy);
  ctx.restore();
}

/** Run `draw` with the canvas clipped to the region's floor, or its room when it has no floor. */
function clipToFinishHost(region, draw) {
  const host = finishRegionHost(region);
  ctx.save();
  if (host.length >= 3) {
    pathForPoly(host);
    ctx.clip();
  }
  draw();
  ctx.restore();
}

function finishRegionPaint(region) {
  const category = region.category || finishProductById(store.doc, region.productId)?.category;
  const hex = finishSwatch(category);
  const n = Number.parseInt(hex.slice(1), 16);
  return {
    fill: `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.28)`,
    stroke: hex,
  };
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

function drawPolyOutline(poly, stroke, dashed, width = 1.4, halo = false) {
  if (poly.length < 3) return;
  ctx.save();
  if (halo) {
    // Light underlay so the line stays readable over satellite imagery.
    pathForPoly(poly);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = width + 3;
    ctx.stroke();
  }
  if (dashed) ctx.setLineDash([6, 5]);
  pathForPoly(poly);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
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
  ctx.fillText(room.name || "Room", cx, cy - 14);
  ctx.font = "11px Source Sans 3, sans-serif";
  ctx.fillStyle = "#5c5348";
  const useLabel = room.use && room.use !== "other" ? roomUse(room.use).label : "Use not set";
  ctx.fillText(useLabel, cx, cy);
  ctx.fillText(`${roomArea(room).toFixed(1)} m²`, cx, cy + 14);
  const floorLabel = roomFloorRuleLabel(room, poly);
  if (floorLabel) {
    ctx.font = "600 11px Source Sans 3, sans-serif";
    ctx.fillStyle = "#1a1612";
    ctx.fillText(floorLabel, cx, cy + 28);
  }
  ctx.restore();
}

/**
 * A floor rule covers the room with no area of its own to paint, so its name
 * sits under the room's area. A drawn finish that already covers the middle
 * names itself there.
 */
function roomFloorRuleLabel(room, poly) {
  if (store.selected.length !== 1 || store.primary?.kind !== "room" || store.primary.id !== room.id) return "";
  if (!finishLayerShown("floor")) return "";
  const labels = [];
  for (const rule of room.finishes || []) {
    if (rule.surface !== "floor") continue;
    const label = finishCategoryLabel(rule);
    if (label && !labels.includes(label)) labels.push(label);
  }
  if (!labels.length) return "";
  const [cx, cy] = centroidOf(poly);
  const covered = (store.doc.finishRegions || []).some((region) => {
    if (region.roomId !== room.id) return false;
    const outline = finishRegionPolygon(store.doc, region);
    return outline.length >= 3 && pointInPoly(cx, cy, outline);
  });
  return covered ? "" : labels.join(", ");
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

/** The face on screen is the one the elevation is showing, or every face of a selected room. */
function wallFinishEmphasized(mark) {
  const face = selectedElevationFace();
  if (face && face.wallId === mark.wallId && face.side === mark.side) return true;
  const roomId = store.selected.length === 1 && store.primary?.kind === "room" ? store.primary.id : null;
  return Boolean(roomId && mark.roomIds.includes(roomId));
}

/**
 * A finish on a wall has no area in plan, so it is a line just outside the
 * wall face, on the finished side, in the same colour as the elevation.
 * A skirting is dashed, and sits a step further out when a face finish is
 * already on that stretch. Selecting the wall (or its room) thickens the
 * line and names the finish.
 */
function drawWallFinishMarks(walls) {
  const marks = planWallFinishMarks(store.doc, pack, walls);
  if (!marks.length) return;
  const faces = marks.filter((m) => !m.skirting);
  const skirts = marks.filter((m) => m.skirting);
  ctx.save();
  ctx.lineCap = "butt";
  for (const mark of [...faces, ...skirts]) {
    const wall = walls.find((w) => w.id === mark.wallId);
    if (!wall) continue;
    const [ax, ay] = worldToScreen(mark.x1, mark.y1);
    const [bx, by] = worldToScreen(mark.x2, mark.y2);
    const [nx, ny] = worldToScreen(mark.x1 + mark.nx, mark.y1 + mark.ny);
    let dx = nx - ax;
    let dy = ny - ay;
    const nlen = Math.hypot(dx, dy) || 1;
    dx /= nlen;
    dy /= nlen;
    const half = Math.max(2, (wall.thickness || 0.22) * cam.scale) / 2;
    const off = half + 3 + (mark.beside ? 5 : 0);
    const emphasized = wallFinishEmphasized(mark);
    ctx.beginPath();
    ctx.moveTo(ax + dx * off, ay + dy * off);
    ctx.lineTo(bx + dx * off, by + dy * off);
    ctx.strokeStyle = finishSwatch(mark.category);
    ctx.lineWidth = mark.skirting ? (emphasized ? 2.2 : 1.25) : (emphasized ? 3.4 : 1.7);
    ctx.setLineDash(mark.skirting ? [5, 4] : []);
    ctx.stroke();
    const label = emphasized && !(mark.skirting && mark.beside) && Math.hypot(bx - ax, by - ay) >= 36;
    if (!label) continue;
    ctx.setLineDash([]);
    ctx.font = "600 11px Source Sans 3, sans-serif";
    ctx.fillStyle = "#1a1612";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Dark type on the wall stroke vanishes, and a longer name (Render)
    // reaches further back than a short one. Keep the usual offset unless
    // the near edge would cross the wall; then step the name out.
    const halfText = ctx.measureText(mark.label).width / 2;
    const textOff = Math.max(off + 11, half + halfText + 3);
    ctx.fillText(mark.label, (ax + bx) / 2 + dx * textOff, (ay + by) / 2 + dy * textOff);
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
  if (!keptByCut(null, "opening")) return;
  if (!hoverPoint || !placeSkuId) return;
  const levelWalls = walls.filter(onActiveLevel);
  const draft = openingDraftAt(store.doc, pack, levelWalls, placeSkuId, hoverPoint.x, hoverPoint.y, doorHandSign);
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
  const { sku, a, b } = placed;
  const [sax, say] = worldToScreen(a.x, a.y);
  const [sbx, sby] = worldToScreen(b.x, b.y);
  ctx.save();
  ctx.globalAlpha = preview ? 0.55 : 1;
  ctx.lineCap = "butt";
  ctx.setLineDash([]);
  ctx.strokeStyle = "#f3eee4";
  ctx.lineWidth = Math.max(4, (wall.thickness || 0.22) * cam.scale + 2);
  ctx.beginPath();
  ctx.moveTo(sax, say);
  ctx.lineTo(sbx, sby);
  ctx.stroke();
  if (sku.category === "window") {
    ctx.strokeStyle = COLOUR.window;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sax, say);
    ctx.lineTo(sbx, sby);
    ctx.stroke();
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
  if (sku.category === "door") drawDoorPlanSymbol(wall, placed, opening);
  ctx.restore();
}

/**
 * SANS 10143 plan symbol for a side-hung door: the wall stops at each jamb,
 * the leaf is a thin line open at 90°, and the swing is a thin quarter-circle
 * centred on the hinge.
 */
function drawDoorPlanSymbol(wall, placed, opening) {
  const swing = doorSwing(wall, placed, opening);
  ctx.setLineDash([]);
  ctx.strokeStyle = wall.drawn ? statusStroke(wall.status) : COLOUR.wall;
  ctx.lineWidth = 1.5;
  strokeJamb(wall, swing.hinge);
  strokeJamb(wall, swing.free);
  ctx.strokeStyle = COLOUR.door;
  ctx.lineWidth = 1.25;
  strokeWorldLine(swing.hinge.x, swing.hinge.y, swing.leaf.x, swing.leaf.y);
  strokeSwingArc(swing.hinge, swing.free, swing.leaf);
}

function strokeJamb(wall, point) {
  const n = wallNormal(wall, 1);
  const half = (wall.thickness || 0.22) / 2;
  strokeWorldLine(point.x - n.x * half, point.y - n.y * half, point.x + n.x * half, point.y + n.y * half);
}

function strokeSwingArc(hinge, free, leaf) {
  const [hx, hy] = worldToScreen(hinge.x, hinge.y);
  const [fx, fy] = worldToScreen(free.x, free.y);
  const [lx, ly] = worldToScreen(leaf.x, leaf.y);
  const radius = Math.hypot(fx - hx, fy - hy);
  if (!(radius > 0.5)) return;
  const from = Math.atan2(fy - hy, fx - hx);
  const to = Math.atan2(ly - hy, lx - hx);
  let sweep = to - from;
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  while (sweep < -Math.PI) sweep += Math.PI * 2;
  ctx.beginPath();
  ctx.arc(hx, hy, radius, from, from + sweep, sweep < 0);
  ctx.stroke();
}

function drawDimensions() {
  const boxes = store.doc.rooms.filter((r) => onActiveLevel(r) && planObjectVisible(r) && keptByCut(r, "room")).map((r) => bbox(roomPolygon(r)));
  for (const line of planDimensionLines(boxes)) drawDimensionLine(line);
}

function measureLivePoint() {
  if (snapGuide) return { x: snapGuide.x, y: snapGuide.y };
  return hoverPoint;
}

function drawSavedDimensions() {
  for (const dim of store.doc.dimensions || []) {
    if (!onActiveLevel(dim) || !planObjectVisible(dim) || !keptByCut(dim, "line")) continue;
    const selected = store.isSelected("dimension", dim.id);
    drawPickedDimension(
      { x: dim.x1, y: dim.y1 },
      { x: dim.x2, y: dim.y2 },
      `${formatLengthMm(Math.hypot(dim.x2 - dim.x1, dim.y2 - dim.y1))} mm`,
      selected,
    );
  }
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

function drawPickedDimension(a, b, label, selected = false) {
  const [ax, ay] = worldToScreen(a.x, a.y);
  const [bx, by] = worldToScreen(b.x, b.y);
  ctx.save();
  ctx.strokeStyle = selected ? COLOUR.selection : COLOUR.hover;
  ctx.fillStyle = selected ? COLOUR.selection : COLOUR.hover;
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

/** How far from a wall's line a click still belongs to that wall. */
function wallHitTol(sku, thickness) {
  const t = Number.isFinite(thickness) ? thickness : (drawnWallThickness(sku) || 0.22);
  return Math.max(0.18, t / 2 + 0.08);
}

/** Host wall and placement of an opening that can be picked on this plan. */
function openingHosted(opening) {
  if (!planObjectVisible(opening) || !keptByCut(opening, "opening")) return null;
  const wall = wallForOpening(store.doc, pack, wallsCache, opening);
  if (!wall || !onPlanOf(pack.levels, wall.level, activeLevel) || !planObjectVisible(wall)) return null;
  const placed = openingOnWall(store.doc, pack, opening, wall);
  return placed ? { wall, placed } : null;
}

function openingPickTol() {
  return Math.max(0.15, 8 / cam.scale);
}

/** The door or window under the pointer, matching the symbol that is drawn. */
function openingAt(wx, wy) {
  const strokeTol = openingPickTol();
  for (let i = store.doc.openings.length - 1; i >= 0; i -= 1) {
    const opening = store.doc.openings[i];
    const host = openingHosted(opening);
    if (!host) continue;
    // The cut through the wall uses the wall's own reach. A thinner reach
    // lets the outer part of the wall stroke, where the door is drawn, select
    // the wall instead.
    const cutTol = Math.max(strokeTol, wallHitTol(host.placed.sku, host.wall.thickness), 0.28);
    if (pointInOpeningCut(host.placed, wx, wy, cutTol)) return { kind: "opening", id: opening.id };
    if (pointInDoorSwing(host.wall, host.placed, opening, wx, wy, strokeTol)) {
      return { kind: "opening", id: opening.id };
    }
    if (pointOnOpeningSymbol(host.wall, host.placed, opening, wx, wy, strokeTol)) {
      return { kind: "opening", id: opening.id };
    }
  }
  return null;
}

function openingSymbolBox(opening, wall, placed) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [a, b] of openingSymbolSegments(wall, placed, opening)) {
    minX = Math.min(minX, a.x, b.x);
    minY = Math.min(minY, a.y, b.y);
    maxX = Math.max(maxX, a.x, b.x);
    maxY = Math.max(maxY, a.y, b.y);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: Math.max(0.02, maxX - minX), h: Math.max(0.02, maxY - minY) };
}

function strokeOpeningSymbol(opening, wall) {
  const placed = openingOnWall(store.doc, pack, opening, wall);
  if (!placed) return;
  for (const [a, b] of openingSymbolSegments(wall, placed, opening)) {
    strokeWorldLine(a.x, a.y, b.x, b.y);
  }
  if (placed.sku?.category !== "door") return;
  const swing = doorSwing(wall, placed, opening);
  strokeJamb(wall, swing.hinge);
  strokeJamb(wall, swing.free);
  strokeSwingArc(swing.hinge, swing.free, swing.leaf);
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

/** A model line reads as a thin real edge (solid); an annotation line reads
 * as a drafting note (dashed, lighter) - the same visual distinction Revit
 * draws between a model line and a detail line. Neither carries a SKU, so
 * unlike `drawBeam()` there is no width to size the stroke against. */
function drawLine(line) {
  const [ax, ay] = worldToScreen(line.x1, line.y1);
  const [bx, by] = worldToScreen(line.x2, line.y2);
  ctx.save();
  ctx.strokeStyle = line.kind === "annotation" ? "#5a5044" : statusStroke(objectStatus(line));
  ctx.lineWidth = 1;
  ctx.setLineDash(line.kind === "annotation" ? [6, 4] : []);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.restore();
}

function drawSeparation(line) {
  const [ax, ay] = worldToScreen(line.x1, line.y1);
  const [bx, by] = worldToScreen(line.x2, line.y2);
  ctx.save();
  ctx.strokeStyle = "#6a5a48";
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.restore();
}

function drawRegion(region) {
  const poly = shapePolygon(region.shape);
  if (poly.length < 3) return;
  const look = regionConvention(region.convention);
  ctx.save();
  pathForPoly(poly);
  if (look) {
    ctx.fillStyle = look.fill;
    ctx.fill();
    ctx.strokeStyle = look.stroke;
  } else {
    ctx.strokeStyle = "#8a7d6c";
  }
  ctx.lineWidth = 1;
  ctx.setLineDash(look ? [] : [4, 3]);
  ctx.stroke();
  ctx.restore();
}

function drawCloudMark(rect, label) {
  ctx.save();
  ctx.strokeStyle = "#b2451e";
  ctx.lineWidth = 1.4;
  ctx.setLineDash([]);
  for (const arc of cloudArcs(rect)) {
    const [sx, sy] = worldToScreen(arc.cx, arc.cy);
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(1.5, arc.r * cam.scale), arc.startAngle, arc.endAngle);
    ctx.stroke();
  }
  if (label) {
    const [tx, ty] = worldToScreen(rect.maxX, rect.minY);
    ctx.font = "600 11px Source Sans 3, sans-serif";
    ctx.fillStyle = "#b2451e";
    ctx.fillText(label, tx + 4, ty - 4);
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
    if (!refShownOnPlan(ref)) continue;
    const obj = objByRef(ref);
    if (!obj) continue;
    ctx.save();
    ctx.strokeStyle = COLOUR.selection;
    ctx.lineWidth = 2.4;
    ctx.setLineDash([]);
    if (ref.kind === "room" || ref.kind === "slab" || ref.kind === "roof") {
      pathForPoly(shapePolygon(obj.shape));
      ctx.stroke();
      // While the covering finish is the thing being dragged, its own corners
      // are the handles. The floor's would sit on the same spots.
      const showCorners = refsToDraw().length === 1 && !editingCoveringFinish();
      const corners = showCorners ? shapeOutlinePoints(obj) : null;
      if (corners) {
        ctx.fillStyle = "#f4ede1";
        ctx.lineWidth = 1.6;
        for (const [x, y] of corners) {
          const [hx, hy] = worldToScreen(x, y);
          ctx.fillRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
          ctx.strokeRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
        }
      }
    } else if (ref.kind === "region") {
      pathForPoly(shapePolygon(obj.shape));
      ctx.stroke();
    } else if (ref.kind === "revisionCloud") {
      ctx.strokeRect(
        ...(() => {
          const [ax, ay] = worldToScreen(obj.rect.minX, obj.rect.minY);
          const [bx, by] = worldToScreen(obj.rect.maxX, obj.rect.maxY);
          return [Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay)];
        })(),
      );
    } else if (ref.kind === "segment" || ref.kind === "beam" || ref.kind === "line" || ref.kind === "dimension" || ref.kind === "separation") {
      const [ax, ay] = worldToScreen(obj.x1, obj.y1);
      const [bx, by] = worldToScreen(obj.x2, obj.y2);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      if (ref.kind === "segment" && isFaceLocation(obj.location)) {
        const f = locationLineOf(obj, segmentThickness(obj));
        ctx.lineWidth = 1.2;
        ctx.setLineDash([2, 3]);
        strokeWorldLine(f.x1, f.y1, f.x2, f.y2);
        ctx.setLineDash([]);
      }
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
      if (wall) strokeOpeningSymbol(obj, wall);
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
  } else if (ref.kind === "segment" || ref.kind === "beam" || ref.kind === "line") {
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
  } else if (ref.kind === "opening") {
    const wall = wallForOpening(store.doc, pack, wallsCache, obj);
    if (wall) strokeOpeningSymbol(obj, wall);
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

/** Rubber-band rectangle while a room, slab or roof waits on its second click.
 * Roofs also show the ridge/hip/fall that commitRoof() will apply (gable along
 * the long side), so the eaves you are sizing are not a blank box. */
function drawShapeDraft() {
  const r = shapeDraft?.rect;
  if (!r || r.w < 0.05 || r.h < 0.05) return;
  const [sx, sy] = worldToScreen(r.x, r.y);
  const [ex, ey] = worldToScreen(r.x + r.w, r.y + r.h);
  const isRoof = shapeDraft.kind === "roof-new";
  ctx.save();
  ctx.fillStyle = isRoof ? COLOUR.roof : shapeDraft.kind === "slab-new" ? COLOUR.slab : "rgba(180, 69, 30, 0.08)";
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

/** The location line the cursor is tracking, and the centreline that would be stored. */
function wallDraftLines() {
  const a = { x: wallDraft.x1, y: wallDraft.y1 };
  const b = { x: wallDraft.x2 ?? wallDraft.x1, y: wallDraft.y2 ?? wallDraft.y1 };
  const thickness = drawnWallThickness(skuById(placeSkuId));
  const location = effectiveWallLocation(a, b, thickness);
  const plan = wallJoinPlan(a, b, thickness, centerlineFromLocation(a, b, thickness, location));
  return { a, b, thickness, location, center: plan.center, moves: plan.moves };
}

/** Drawn walls of the kind being drawn, on this level, that a new one can join. */
function wallJoinPool() {
  const category = skuById(placeSkuId)?.category;
  return (store.doc.segments || []).filter((s) => onActiveLevel(s) && planObjectVisible(s)
    && segmentCategory(s) === category);
}

/**
 * The face the wall is drawn on. A face-drawn wall that starts on another
 * wall's end sits against it whichever way it is dragged; everything else
 * uses the chosen setting. A chain keeps the setting from corner to corner.
 */
function effectiveWallLocation(a, b, thickness) {
  if (!isFaceLocation(wallLocation) || wallDraft?.chained) return wallLocation;
  const target = findJoinTarget(wallJoinPool(), a, segmentThickness, { reach: thickness });
  // The side is decided once, from the first real stretch of drag, and kept
  // for this wall: re-deriving it on every mouse move made the wall jump
  // across the line as the pointer moved.
  let auto = wallDraft?.lockedSide || null;
  if (!auto) {
    auto = sideTowardTarget({ start: a, end: b, target });
    if (auto && wallDraft && lineLength(a, b) >= MIN_TRACE) wallDraft.lockedSide = auto;
  }
  if (!auto) return wallLocation;
  return wallSideFlip ? flipWallLocation(auto) : auto;
}

/** True while a face-drawn wall's side is being taken from the wall it started on. */
function wallStartedAgainstWall() {
  if (!wallDraft || wallDraft.chained || !isFaceLocation(wallLocation)) return false;
  const a = { x: wallDraft.x1, y: wallDraft.y1 };
  const b = { x: wallDraft.x2 ?? wallDraft.x1, y: wallDraft.y2 ?? wallDraft.y1 };
  const target = findJoinTarget(wallJoinPool(), a, segmentThickness, { reach: drawnWallThickness(skuById(placeSkuId)) });
  return Boolean(sideTowardTarget({ start: a, end: b, target }));
}

/** Does the start or end of the wall being drawn, or the pointer, touch another wall's end? */
function wallCornerRelevant() {
  if (tool !== "wall") return false;
  const thickness = drawnWallThickness(skuById(placeSkuId));
  const pool = wallJoinPool();
  const touches = (p) => {
    const target = p && findJoinTarget(pool, p, segmentThickness, { reach: thickness });
    return Boolean(target && target.end != null);
  };
  if (wallDraft) {
    const a = { x: wallDraft.x1, y: wallDraft.y1 };
    const b = { x: wallDraft.x2 ?? wallDraft.x1, y: wallDraft.y2 ?? wallDraft.y1 };
    return touches(a) || (lineLength(a, b) >= MIN_TRACE && touches(b));
  }
  return touches(hoverPoint);
}

/**
 * While a wall is being drawn, the Draw on / Corner choices sit beside its
 * start - on the side away from where the line is heading - instead of in the
 * bar at the top of the plan. Before the first click they stay in the bar.
 */
const WALL_CORNER_ORDER = ["past", "against", "center"]; // same left-to-right order as the buttons
const WALL_CORNER_NAMES = { against: "Against old wall", past: "Past old wall", center: "On the line" };

function cycleWallCorner(dir) {
  const i = WALL_CORNER_ORDER.indexOf(wallCorner);
  wallCorner = WALL_CORNER_ORDER[(i + dir + WALL_CORNER_ORDER.length) % WALL_CORNER_ORDER.length];
  setStatusMessage(`Corner: ${WALL_CORNER_NAMES[wallCorner]}`);
  render();
}

/** A small tag beside the cursor naming the corner option, shown wherever a
 * wall meets another wall's end (before the first click as well as during),
 * with the key that steps through them. */
function drawWallCornerTag() {
  if (!hoverPoint || !wallCornerRelevant()) return;
  // Mid-draw the Corner buttons float beside the wall's start and the
  // dimension labels sit at the cursor, so the tag would only overlap them.
  if (wallDraft) return;
  const [sx, sy] = worldToScreen(hoverPoint.x, hoverPoint.y);
  const label = `${WALL_CORNER_NAMES[wallCorner]}  \u00b7  Tab`;
  ctx.save();
  ctx.font = "600 11px Source Sans 3, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(label).width + 12;
  const h = 18;
  const x = Math.min(sx + 16, el.canvasWrap.clientWidth - w - 4);
  const y = Math.min(sy + 18, el.canvasWrap.clientHeight - h - 4);
  ctx.fillStyle = "rgba(28, 26, 23, 0.88)";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#f4ede1";
  ctx.fillText(label, x + 6, y + h / 2);
  ctx.restore();
}

const wallOptsSide = { draft: null, locked: false, sx: -1, sy: 1 };
function positionWallOpts() {
  const box = el.wallOpts;
  if (!box) return;
  const floating = tool === "wall" && Boolean(wallDraft) && !box.hidden;
  box.classList.toggle("floating", floating);
  if (!floating) {
    box.style.left = "";
    box.style.top = "";
    return;
  }
  const rect = el.canvas.getBoundingClientRect();
  const [ax, ay] = worldToScreen(wallDraft.x1, wallDraft.y1);
  const [bx, by] = worldToScreen(wallDraft.x2 ?? wallDraft.x1, wallDraft.y2 ?? wallDraft.y1);
  const w = box.offsetWidth;
  const h = box.offsetHeight;
  const gap = 14;
  // Pick the side once the line has some length, then keep it for the whole
  // wall so the buttons never jump away as the cursor approaches them.
  if (wallOptsSide.draft !== wallDraft) {
    wallOptsSide.draft = wallDraft;
    wallOptsSide.locked = false;
    wallOptsSide.sx = -1;
    wallOptsSide.sy = 1;
  }
  if (!wallOptsSide.locked && Math.hypot(bx - ax, by - ay) > 40) {
    wallOptsSide.locked = true;
    wallOptsSide.sx = bx - ax >= 0 ? -1 : 1;
    wallOptsSide.sy = by - ay >= 0 ? -1 : 1;
  }
  const x = Math.min(Math.max(ax + (wallOptsSide.sx < 0 ? -w - gap : gap), 4), Math.max(4, rect.width - w - 4));
  const y = Math.min(Math.max(ay + (wallOptsSide.sy < 0 ? -h - gap : gap), 4), Math.max(4, rect.height - h - 4));
  box.style.left = `${rect.left + x}px`;
  box.style.top = `${rect.top + y}px`;
}

/**
 * The corners a new wall from `a` to `b` makes with drawn walls of the same
 * kind on this level: its centreline trimmed or extended at either end, and
 * the existing ends that move to suit. An existing end shared with a third
 * wall stays put, so a junction is never pulled apart.
 */
function wallJoinPlan(a, b, thickness, center) {
  const plan = { center: { ...center }, moves: [] };
  if (wallCorner === "center" || lineLength(a, b) < MIN_TRACE) return plan;
  const pool = wallJoinPool();
  let startSeg = null;
  for (const at of ["start", "end"]) {
    const point = at === "start" ? a : b;
    const target = findJoinTarget(pool, point, segmentThickness, {
      reach: thickness,
      exclude: (s) => s === startSeg,
    });
    if (!target) continue;
    if (at === "start") startSeg = target.seg;
    const res = resolveJoin({ line: center, thickness, at, target, mode: wallCorner });
    if (!res) continue;
    if (at === "start") {
      plan.center.x1 = res.point.x;
      plan.center.y1 = res.point.y;
    } else {
      plan.center.x2 = res.point.x;
      plan.center.y2 = res.point.y;
    }
    if (res.targetEnd && !endShared(target.seg, target.end)) {
      plan.moves.push({ seg: target.seg, end: target.end, to: res.targetEnd });
    }
  }
  return plan;
}

function endShared(seg, end) {
  const x = end === 2 ? seg.x2 : seg.x1;
  const y = end === 2 ? seg.y2 : seg.y1;
  const level = effectiveLevel(seg, pack);
  return (store.doc.segments || []).some((s) => s !== seg && effectiveLevel(s, pack) === level
    && (Math.hypot(s.x1 - x, s.y1 - y) <= CORNER_JOIN_TOL || Math.hypot(s.x2 - x, s.y2 - y) <= CORNER_JOIN_TOL));
}

function drawWallDraft() {
  const { a, b, thickness, location, center, moves } = wallDraftLines();
  // An old wall running on to meet this one: show the piece it gains.
  for (const move of moves) {
    const from = move.end === 2 ? { x: move.seg.x2, y: move.seg.y2 } : { x: move.seg.x1, y: move.seg.y1 };
    if (segmentLength(from.x, from.y, move.to.x, move.to.y) < 0.005) continue;
    ctx.save();
    ctx.strokeStyle = statusStroke(objectStatus(move.seg));
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = Math.max(2, segmentThickness(move.seg) * cam.scale);
    ctx.lineCap = "butt";
    strokeWorldLine(from.x, from.y, move.to.x, move.to.y);
    ctx.restore();
  }
  if (segmentLength(center.x1, center.y1, center.x2, center.y2) >= 0.05) {
    const [cx1, cy1] = worldToScreen(center.x1, center.y1);
    const [cx2, cy2] = worldToScreen(center.x2, center.y2);
    ctx.save();
    ctx.strokeStyle = statusStroke(placementStatus());
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = Math.max(2, thickness * cam.scale);
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(cx1, cy1);
    ctx.lineTo(cx2, cy2);
    ctx.stroke();
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#5c2410";
    for (const face of ["exterior", "interior"]) {
      const f = locationLineOf(center, thickness, face);
      strokeWorldLine(f.x1, f.y1, f.x2, f.y2);
    }
    ctx.restore();
  }
  // The location line: solid when it is a face, so it reads as the edge it is,
  // dashed when it is the centreline.
  const face = isFaceLocation(location);
  ctx.save();
  ctx.strokeStyle = "#8d3416";
  ctx.lineWidth = face ? 2.4 : 1.5;
  ctx.setLineDash(face ? [] : [6, 4]);
  strokeWorldLine(a.x, a.y, b.x, b.y);
  ctx.restore();
  drawLengthLabel(a.x, a.y, b.x, b.y);
}

function strokeWorldLine(x1, y1, x2, y2) {
  const [ax, ay] = worldToScreen(x1, y1);
  const [bx, by] = worldToScreen(x2, y2);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
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
  const label = `${formatLengthMm(len)} mm`;
  ctx.save();
  ctx.font = "600 12px Source Sans 3, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const width = ctx.measureText(label).width + 8;
  const box = { x: sx - width / 2, y: sy - 22, w: width, h: 16 };
  labelOccupied.push(box);
  ctx.fillStyle = "rgba(244, 237, 225, 0.92)";
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.fillStyle = "#1a1612";
  ctx.fillText(label, sx, sy - 8);
  ctx.restore();
}

/** Axis-aligned box of a label drawn at (mx, my) after `ctx.rotate(angle)`. */
function rotatedLabelBox(mx, my, angle, textW, shift) {
  const hw = textW / 2;
  const y0 = -8 + shift;
  const y1 = 8 + shift;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const lx of [-hw, hw]) {
    for (const ly of [y0, y1]) {
      const x = mx + lx * c - ly * s;
      const y = my + lx * s + ly * c;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Live snap-gap dimension: a string offset beside the tracking line, with
 * arrowheads at both witnesses, like `<-- 240 mm -->`. `kind` is the
 * measured axis (`h` = east-west gap, `v` = north-south) so the string
 * sits above a horizontal gap and to the left of a vertical one. */
function drawGapDimension(x1, y1, x2, y2, kind, note = "", flip = false) {
  const len = segmentLength(x1, y1, x2, y2);
  if (len < 0.005) return;
  const [ax, ay] = worldToScreen(x1, y1);
  const [bx, by] = worldToScreen(x2, y2);
  // `note` names what the far end of the string actually is. A bare "300 mm"
  // beside a 600 mm footing leaves the reader guessing whether it measures to
  // the centreline it is aligned with or the face they can see.
  const label = note ? `${formatLengthMm(len)} mm · ${note}` : `${formatLengthMm(len)} mm`;
  const dx = bx - ax;
  const dy = by - ay;
  const span = Math.hypot(dx, dy) || 1;
  // Offset towards the top-left of the sheet so a horizontal string sits
  // above the gap and a vertical one to its left, matching the old axis
  // kinds, and so an angled wall's strings sit beside the wall rather than
  // on top of the opening.
  let baseNx = -dy / span;
  let baseNy = dx / span;
  if (baseNy > 1e-6 || (Math.abs(baseNy) <= 1e-6 && baseNx > 0)) {
    baseNx = -baseNx;
    baseNy = -baseNy;
  }
  if (kind === "v") {
    baseNx = -1;
    baseNy = 0;
  } else if (kind === "h") {
    baseNx = 0;
    baseNy = -1;
  }

  ctx.save();
  ctx.font = "600 11px Source Sans 3, sans-serif";
  const textW = ctx.measureText(label).width + 8;
  const tight = span < textW + 16;
  // Tight gaps cannot fit the number between the arrows; park it beside
  // the string (further along the same offset) so the arrows still read.
  const shift = tight ? (flip ? 14 : -14) : 0;
  const place = (sideFlip, dist) => {
    let px = baseNx;
    let py = baseNy;
    if (sideFlip) {
      px = -px;
      py = -py;
    }
    const ox = px * dist;
    const oy = py * dist;
    const q1 = { x: ax + ox, y: ay + oy };
    const q2 = { x: bx + ox, y: by + oy };
    const qx = (q1.x + q2.x) / 2;
    const qy = (q1.y + q2.y) / 2;
    let qAngle = Math.atan2(q2.y - q1.y, q2.x - q1.x);
    if (kind === "v") qAngle = -Math.PI / 2;
    else if (kind === "h") qAngle = 0;
    else {
      if (qAngle >= Math.PI / 2) qAngle -= Math.PI;
      if (qAngle < -Math.PI / 2) qAngle += Math.PI;
    }
    return {
      p1: q1,
      p2: q2,
      mx: qx,
      my: qy,
      angle: qAngle,
      box: rotatedLabelBox(qx, qy, qAngle, textW, shift),
    };
  };
  // The edge length of the room or floor already sits on this line while it
  // is being moved, and a second gap (the bare distance, then the named one)
  // would land on the same spot. Prefer the usual side; step to the other
  // side, then further out, until the words no longer share a box.
  const hits = (box) => labelOccupied.some((r) => rectsOverlap(
    { x: box.x - 4, y: box.y - 4, w: box.w + 8, h: box.h + 8 },
    r,
  ));
  let chosen = place(flip, 20);
  for (const dist of [20, 42, 68]) {
    const preferred = place(flip, dist);
    const other = place(!flip, dist);
    if (!hits(preferred.box)) {
      chosen = preferred;
      break;
    }
    if (!hits(other.box)) {
      chosen = other;
      break;
    }
    chosen = preferred;
  }
  labelOccupied.push(chosen.box);
  const { p1, p2, mx, my, angle } = chosen;

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

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.translate(mx, my);
  ctx.rotate(angle);
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

// --- room / slab / roof polygon editing -------------------------------------
//
// Corners and edges use the same Corner / Line control as a floor finish.
// Corner adds a point on an edge (copy cursor). Line moves that edge (the
// resize cursor). Shift uses the other one for a single drag. A rectangle
// stays a rectangle until a drag changes it, then it becomes a polygon.
// `selectedShapeVertex` remembers which corner Delete should remove; it is
// reset on the next click so a stale one never survives to delete the wrong thing.
let selectedShapeVertex = null;

function shapeEditTol() {
  return (HANDLE / 2 + 2) / cam.scale;
}

/** The outline to hit-test: stored corners, or the rectangle's four corners. */
function shapeOutlinePoints(obj) {
  if (!obj?.shape) return null;
  if (obj.shape.kind === "poly" && Array.isArray(obj.shape.points) && obj.shape.points.length >= 3) return obj.shape.points;
  const poly = shapePolygon(obj.shape);
  return poly.length >= 3 ? poly : null;
}

/** The sole selection, when it is a room, floor or roof with an outline. */
function editableShapeRef() {
  if (store.selected.length !== 1 || !store.primary) return null;
  const ref = store.primary;
  if (!["room", "slab", "roof"].includes(ref.kind)) return null;
  const obj = objByRef(ref);
  const points = shapeOutlinePoints(obj);
  if (!points) return null;
  return { ref, obj, points };
}

/** Turn a rectangle into the polygon being edited. Returns its corner list. */
function materializeShapePoly(editable) {
  if (editable.obj.shape?.kind === "poly" && Array.isArray(editable.obj.shape.points)) return editable.obj.shape.points;
  const next = shapeAsPoly(editable.obj.shape);
  if (!next) return null;
  editable.obj.shape = next;
  editable.points = next.points;
  return next.points;
}

/** The point on an edge nearest the pointer, so a new corner sits on the line. */
function pointOnRingEdge(points, edgeIndex, wx, wy) {
  const [ax, ay] = points[edgeIndex];
  const [bx, by] = points[(edgeIndex + 1) % points.length];
  const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
  const t = Math.max(0, Math.min(1, ((wx - ax) * (bx - ax) + (wy - ay) * (by - ay)) / len2));
  return [ax + (bx - ax) * t, ay + (by - ay) * t];
}

function outlineHostWord(ref) {
  if (ref?.kind === "room") return "room";
  if (ref?.kind === "roof") return "roof";
  return "floor";
}

function hitPolyVertexIndex(points, wx, wy, tol) {
  let best = null;
  let bestD = tol;
  points.forEach(([x, y], i) => {
    const d = Math.hypot(x - wx, y - wy);
    if (d <= bestD) { bestD = d; best = i; }
  });
  return best;
}

function hitPolyEdgeIndex(points, wx, wy, tol) {
  let best = null;
  let bestD = tol;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    const d = distToSeg(x1, y1, x2, y2, wx, wy);
    if (d <= bestD) { bestD = d; best = i; }
  }
  return best;
}

// --- floor finish regions: editing on the plan --------------------------------
//
// Tiles, waterproofing and the like are polygons stored in doc.finishRegions
// (finish-model.js). They are edited through the floor they sit on: with that
// floor (or room) selected, click inside a region, or press "Edit corners" in
// the inspector, and its corners show. Drag a corner. Drag an edge to add one,
// or, with Line, to move that edge. Shift uses the other for a single drag.
// Delete removes the selected corner, drag inside to move the region. Corners
// stay inside the floor. Moving the floor itself carries its regions.
//
// A finish that covers the whole floor has no outline of its own. A click on
// it edits the floor, and the finish follows. Edit corners is what picks the
// finish up, and Done puts it down.

/** Regions of the floor or room that is the one thing selected. */
function regionsOfSelection() {
  if (store.selected.length !== 1 || !store.primary) return [];
  const ref = store.primary;
  const regions = store.doc.finishRegions || [];
  if (ref.kind === "slab") return regions.filter((r) => finishRegionSlab(store.doc, r)?.id === ref.id);
  if (ref.kind === "room") return regions.filter((r) => r.roomId === ref.id);
  return [];
}

/** The region being edited; dropped as soon as its floor is no longer the selection. */
function editingFinishRegion() {
  if (!editingRegionId) return null;
  const region = regionsOfSelection().find((r) => r.id === editingRegionId) || null;
  if (!region || tool !== "select") {
    editingRegionId = null;
    selectedRegionVertex = null;
    return null;
  }
  return region;
}

/**
 * Drop corners the floor (or room) no longer contains. A moved outline cuts the
 * finish, and the vertices past that cut — both ends — would otherwise stay as
 * handles. A whole-floor region has no corners of its own.
 */
function trimFinishToHost(region) {
  if (!region || region.whole) return false;
  const host = finishRegionHost(region);
  const poly = shapePolygon(region.shape);
  const fitted = fitPolygonToHost(poly, host);
  if (fitted === poly || fitted.length < 3) return false;
  region.shape = polyShape(fitted.map(([x, y]) => [x, y]));
  if (selectedRegionVertex?.id === region.id && selectedRegionVertex.index >= fitted.length) {
    selectedRegionVertex = null;
  }
  return true;
}

/** Corners of every finish on this floor, taken before a drag changes them. */
function finishShapeSnapshot(ref) {
  return hostedFinishRegionsOf(store.doc, [ref]).filter((region) => !region.whole).map((region) => ({
    id: region.id,
    points: shapePolygon(region.shape).map((p) => [p[0], p[1]]),
  }));
}

/**
 * Fit each snapshotted finish to the floor as it is now. Dragging the floor
 * back out uses the original corners, so a point that left and comes back
 * is drawn again before the mouse is released.
 */
function applyFinishShapeSnapshot(snap) {
  for (const entry of snap || []) {
    const region = (store.doc.finishRegions || []).find((r) => r.id === entry.id);
    if (!region || region.whole) continue;
    const fitted = fitPolygonToHost(entry.points, finishRegionHost(region));
    if (fitted.length < 3) continue;
    region.shape = polyShape(fitted.map(([x, y]) => [x, y]));
    if (selectedRegionVertex?.id === region.id && selectedRegionVertex.index >= fitted.length) {
      selectedRegionVertex = null;
    }
  }
}

/** The outline a region's corners may not leave: its floor, else its room. */
function finishRegionHost(region) {
  const slab = finishRegionSlab(store.doc, region);
  if (slab) return shapePolygon(slab.shape);
  const room = region.roomId ? (store.doc.rooms || []).find((r) => r.id === region.roomId) : null;
  return room ? roomPolygon(room) : [];
}

/** A point inside, or sitting on the boundary (a finish edge often lies on the floor). */
function pointOnOrInRing(x, y, poly) {
  if (pointInPoly(x, y, poly)) return true;
  const c = clampToPoly(x, y, poly);
  return Math.hypot(c.x - x, c.y - y) <= 0.02;
}

/**
 * The finish has no outline of its own: it is the floor, or a polygon that
 * still fills that floor. Dragging it and dragging the floor are the same
 * gesture until one of them is chosen.
 */
function regionCoversHost(region) {
  if (!region) return false;
  if (region.whole) return true;
  const host = finishRegionHost(region);
  const poly = finishRegionPolygon(store.doc, region);
  if (host.length < 3 || poly.length < 3) return false;
  const hostArea = Math.abs(polyArea(host));
  const finishArea = Math.abs(polyArea(poly));
  if (!(hostArea > 1e-4) || Math.abs(hostArea - finishArea) / hostArea > 0.01) return false;
  return host.every(([x, y]) => pointOnOrInRing(x, y, poly)) && poly.every(([x, y]) => pointOnOrInRing(x, y, host));
}

/** The finish on the selected floor that still covers the whole outline. */
function coveringFinishRegion() {
  const regions = regionsOfSelection();
  return regions.find((r) => r.whole) || regions.find((r) => regionCoversHost(r)) || null;
}

/** The finish being edited, when it is the one that covers the floor. */
function editingCoveringFinish() {
  const region = editingFinishRegion();
  return region && regionCoversHost(region) ? region : null;
}

/** The corners to hit-test: the stored ones for a free polygon, else the outline it resolves to. */
function finishRegionRing(region) {
  if (region.shape?.kind === "poly" && !region.whole && Array.isArray(region.shape.points)) return region.shape.points;
  return finishRegionPolygon(store.doc, region);
}

/** Make the region a plain editable polygon (a whole-floor or rectangle region stops being one). */
function finishRegionPoints(region) {
  if (region.shape?.kind !== "poly" || region.whole || !Array.isArray(region.shape.points)) {
    region.shape = polyShape(finishRegionPolygon(store.doc, region).map(([x, y]) => [x, y]));
    delete region.whole;
  }
  return region.shape.points;
}

/** Line moves the edge. Corner inserts a node. Shift swaps them for this drag. */
function floorEdgeMoves(ev) {
  return ev.shiftKey ? floorEdgeMode !== "line" : floorEdgeMode === "line";
}

/**
 * The part of a drag that pushes an edge squarely, the way the resize cursor
 * points. Movement along the edge is dropped, so a rectangle is not skewed
 * into a different shape.
 */
function perpendicularEdgeMove(x1, y1, x2, y2, dx, dy) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const nx = -(y2 - y1) / len;
  const ny = (x2 - x1) / len;
  const along = dx * nx + dy * ny;
  return { dx: nx * along, dy: ny * along, nx, ny };
}

/**
 * Where a whole edge should sit. It lines up with another edge, never with a
 * corner that happens to share an X or Y. With nothing parallel nearby, the
 * offset rounds to a millimetre and no alignment line is drawn.
 */
function applyEdgeSnap(a0, b0, push, exclude) {
  const x1 = a0[0] + push.dx;
  const y1 = a0[1] + push.dy;
  const edges = collectSnapEdges(store.doc, snapOpts(exclude));
  const tol = SNAP_PIXEL_TOL / cam.scale;
  const hit = snapEdgeToLine(x1, y1, b0[0] + push.dx, b0[1] + push.dy, edges, tol);
  let x = hit.x;
  let y = hit.y;
  if (!hit.snapped) {
    const along0 = push.dx * push.nx + push.dy * push.ny;
    const along = snapNiceDelta(along0, tol, NICE_MIN_STEP_M);
    x = a0[0] + push.nx * along;
    y = a0[1] + push.ny * along;
    snapGuide = null;
    return { x, y };
  }
  snapGuide = {
    x,
    y,
    guideX: hit.guideX,
    guideY: hit.guideY,
    guideXPoint: hit.guideXPoint,
    guideYPoint: hit.guideYPoint,
    guideLine: hit.guideLine,
    snapped: true,
    snapX: hit.guideX != null,
    snapY: hit.guideY != null,
    exactJoin: false,
    origin: null,
    dx: null,
    dy: null,
    probes: [],
    tol,
    chaseHeld: false,
  };
  return { x, y };
}

/** Begin a corner, edge or whole-region drag on the region being edited. */
function beginFinishRegionDrag(ev, wx, wy) {
  const region = editingFinishRegion();
  selectedRegionVertex = null;
  if (!region) return false;
  const ring = finishRegionRing(region);
  if (ring.length < 3) return false;
  const grab = (next) => {
    drag = { ...next, id: region.id, moved: false };
    el.canvas.setPointerCapture(ev.pointerId);
    return true;
  };
  const vi = hitPolyVertexIndex(ring, wx, wy, shapeEditTol());
  if (vi != null) {
    store.pushUndo();
    finishRegionPoints(region);
    selectedRegionVertex = { id: region.id, index: vi };
    return grab({ kind: "region-vertex", index: vi });
  }
  const ei = hitPolyEdgeIndex(ring, wx, wy, propertyPickTol());
  if (ei != null) {
    store.pushUndo();
    const points = finishRegionPoints(region);
    if (floorEdgeMoves(ev)) {
      return grab({
        kind: "region-edge",
        index: ei,
        grabX: wx,
        grabY: wy,
        origin: points.map((p) => [p[0], p[1]]),
      });
    }
    const insertAt = ei + 1;
    // The new corner sits on the edge it was added to, not where the pointer happens to be.
    points.splice(insertAt, 0, pointOnRingEdge(points, ei, wx, wy));
    selectedRegionVertex = { id: region.id, index: insertAt };
    return grab({ kind: "region-vertex", index: insertAt, inserted: true });
  }
  // Shift inside the region, off its edges, still adds the floor to the selection.
  if (ev.shiftKey) return false;
  if (pointInPoly(wx, wy, finishRegionPolygon(store.doc, region))) {
    store.pushUndo();
    return grab({
      kind: "region-move",
      x0: wx,
      y0: wy,
      origin: polyShape(finishRegionPolygon(store.doc, region).map(([x, y]) => [x, y])),
    });
  }
  return false;
}

/** The region of the selected floor under the pointer, so its card and outline match. */
function syncFinishRegionHover(wx, wy) {
  if (!finishLayerShown("floor") && !editingFinishRegion()) {
    hoverFinishRegionId = null;
    return;
  }
  const regions = regionsOfSelection();
  let next = null;
  for (let i = regions.length - 1; i >= 0; i -= 1) {
    // A finish that still covers the floor is not a separate thing under the
    // pointer. Lighting it up would look like the drag was about to grab it.
    if (regionCoversHost(regions[i]) && regions[i].id !== editingRegionId) continue;
    const poly = finishRegionPolygon(store.doc, regions[i]);
    if (poly.length >= 3 && pointInPoly(wx, wy, poly)) { next = regions[i].id; break; }
  }
  hoverFinishRegionId = next;
}

/** A press inside a region of the selected floor picks it for editing; elsewhere puts it down. */
function pickFinishRegionAt(wx, wy) {
  if (!finishLayerShown("floor") && !editingRegionId) return;
  const regions = regionsOfSelection();
  if (!regions.length) { editingRegionId = null; return; }
  for (let i = regions.length - 1; i >= 0; i -= 1) {
    if (!pointInPoly(wx, wy, finishRegionPolygon(store.doc, regions[i]))) continue;
    // The covering finish shares the floor. A click stays on the floor until
    // Edit corners picks the finish up.
    if (regionCoversHost(regions[i])) continue;
    if (editingRegionId !== regions[i].id) {
      editingRegionId = regions[i].id;
      finishKey = "";
    }
    return;
  }
  if (editingRegionId) {
    const current = regions.find((r) => r.id === editingRegionId);
    const poly = current ? finishRegionPolygon(store.doc, current) : [];
    if (current && regionCoversHost(current) && poly.length >= 3 && pointInPoly(wx, wy, poly)) return;
    editingRegionId = null;
    finishKey = "";
  }
}

/** A finish region's drag, from pointer move. Returns true when it handled the drag. */
function dragFinishRegion(wx, wy) {
  if (drag?.kind !== "region-vertex" && drag?.kind !== "region-move" && drag?.kind !== "region-edge") return false;
  const region = (store.doc.finishRegions || []).find((r) => r.id === drag.id);
  if (!region) return true;
  if (drag.kind === "region-edge") {
    const origin = drag.origin;
    const i = drag.index;
    const j = (i + 1) % origin.length;
    const a0 = origin[i];
    const b0 = origin[j];
    const live = region.shape?.points;
    const a = live?.[i] || a0;
    const b = live?.[j] || b0;
    const push = perpendicularEdgeMove(a0[0], a0[1], b0[0], b0[1], wx - drag.grabX, wy - drag.grabY);
    const p = applyEdgeSnap(a0, b0, push, {
      activeShape: { kind: "finish", id: region.id, x: a[0], y: a[1], also: { x: b[0], y: b[1] } },
    });
    const along = (p.x - a0[0]) * push.nx + (p.y - a0[1]) * push.ny;
    const host = finishRegionHost(region);
    const next = translatePolyEdge(origin, i, push.nx * along, push.ny * along, host);
    const at = next[i];
    if (Math.hypot(at[0] - a0[0], at[1] - a0[1]) * cam.scale > 2) drag.moved = true;
    if (drag.moved) {
      // The floor stopped the line short of the other edge, so it is not aligned.
      if (snapGuide && (Math.abs(at[0] - p.x) > 1e-6 || Math.abs(at[1] - p.y) > 1e-6)) snapGuide = null;
      region.shape.points = next;
    } else snapGuide = null;
  } else if (drag.kind === "region-vertex") {
    const pt = region.shape?.points?.[drag.index];
    if (pt) {
      // The corner under the pointer is not a target (it would join to itself).
      // The region's other corners stay, so a shared X or Y draws a guide.
      const p = applySnap(wx, wy, {
        activeShape: { kind: "finish", id: region.id, x: pt[0], y: pt[1] },
      });
      if (Math.hypot(p.x - pt[0], p.y - pt[1]) * cam.scale > 2) drag.moved = true;
      if (drag.moved) {
        const host = finishRegionHost(region);
        const at = host.length >= 3 ? clampToPoly(p.x, p.y, host) : p;
        // The corner cannot leave the floor. A guide whose axis the clamp
        // had to give up is no longer where the corner sits.
        if (snapGuide && (Math.abs(at.x - p.x) > 1e-6 || Math.abs(at.y - p.y) > 1e-6)) {
          if (Math.abs(at.x - p.x) > 1e-6) {
            snapGuide.guideX = null;
            snapGuide.snapX = false;
            snapGuide.guideXPoint = null;
          }
          if (Math.abs(at.y - p.y) > 1e-6) {
            snapGuide.guideY = null;
            snapGuide.snapY = false;
            snapGuide.guideYPoint = null;
          }
          snapGuide.x = at.x;
          snapGuide.y = at.y;
          snapGuide.exactJoin = false;
          snapGuide.snapped = Boolean(snapGuide.snapX || snapGuide.snapY);
        }
        region.shape.points[drag.index] = [at.x, at.y];
      }
    }
  } else {
    const dx = wx - drag.x0;
    const dy = wy - drag.y0;
    if (Math.hypot(dx, dy) * cam.scale > 2) drag.moved = true;
    if (drag.moved) {
      delete region.whole;
      region.shape = translateShape(drag.origin, dx, dy, activeGrid());
    }
  }
  render();
  return true;
}

/** Amber on the part of the selected floor that no finish covers. */
function drawBareFinish() {
  if (!bareFinishHost || store.selected.length !== 1 || !store.primary) return;
  const ref = store.primary;
  if (ref.kind !== bareFinishHost.kind || ref.id !== bareFinishHost.id) return;
  let host = [];
  if (ref.kind === "slab") {
    const slab = (store.doc.slabs || []).find((s) => s.id === ref.id);
    host = slab ? shapePolygon(slab.shape) : [];
  } else if (ref.kind === "room") {
    const room = (store.doc.rooms || []).find((r) => r.id === ref.id);
    host = room ? roomPolygon(room) : [];
  }
  if (host.length < 3) return;
  const dpr = window.devicePixelRatio || 1;
  if (!bareLayer) bareLayer = document.createElement("canvas");
  if (bareLayer.width !== el.canvas.width || bareLayer.height !== el.canvas.height) {
    bareLayer.width = el.canvas.width;
    bareLayer.height = el.canvas.height;
  }
  const bctx = bareLayer.getContext("2d");
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.clearRect(0, 0, bareLayer.width, bareLayer.height);
  bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  bctx.globalCompositeOperation = "source-over";
  const trace = (poly) => {
    bctx.beginPath();
    poly.forEach(([x, y], i) => {
      const [sx, sy] = worldToScreen(x, y);
      if (i === 0) bctx.moveTo(sx, sy);
      else bctx.lineTo(sx, sy);
    });
    bctx.closePath();
  };
  trace(host);
  bctx.fillStyle = "rgba(176, 122, 46, 0.45)";
  bctx.fill();
  bctx.globalCompositeOperation = "destination-out";
  for (const region of regionsOfSelection()) {
    const poly = finishRegionPolygon(store.doc, region);
    if (poly.length >= 3) { trace(poly); bctx.fill(); }
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(bareLayer, 0, 0);
  ctx.restore();
}

/** The finish under the pointer, on the plan or in the inspector. */
function drawHoveredFinishRegion() {
  if (!hoverFinishRegionId) return;
  const region = (store.doc.finishRegions || []).find((r) => r.id === hoverFinishRegionId);
  if (!region) return;
  const poly = finishRegionPolygon(store.doc, region);
  if (poly.length < 3) return;
  clipToFinishHost(region, () => drawPolyOutline(poly, finishRegionPaint(region).stroke, false, 2.6));
}

/** The region's corners, drawn over the plan while it is being edited. */
function drawEditingFinishRegion() {
  const region = editingFinishRegion();
  if (!region) return;
  // During a floor drag the snapshot is refitted on each move, so a corner
  // can come back. Trimming the live shape here would forget it.
  if (drag?.kind !== "shape-vertex" && drag?.kind !== "shape-edge" && trimFinishToHost(region)) store.persist();
  const ring = finishRegionRing(region);
  if (ring.length < 3) return;
  const paint = finishRegionPaint(region);
  ctx.save();
  clipToFinishHost(region, () => {
    pathForPoly(ring);
    ctx.strokeStyle = paint.stroke;
    ctx.lineWidth = 2.4;
    ctx.setLineDash([]);
    ctx.stroke();
  });
  ctx.lineWidth = 1.6;
  ring.forEach(([x, y], i) => {
    const [hx, hy] = worldToScreen(x, y);
    const picked = selectedRegionVertex?.id === region.id && selectedRegionVertex.index === i;
    ctx.strokeStyle = paint.stroke;
    ctx.fillStyle = picked ? paint.stroke : "#f4ede1";
    ctx.fillRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
    ctx.strokeRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
  });
  ctx.restore();
  // The same edge lengths the draw shows, so a corner or line drag reads its new size.
  // While some other shape (the floor, room or property line) is being reshaped, the
  // region's outline follows it, so these lengths are stale: hide them until the drop.
  if (drag?.moved && (drag.kind === "shape-vertex" || drag.kind === "shape-edge" || drag.kind === "property-vertex" || drag.kind === "property-move")) return;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    drawLengthLabel(x1, y1, x2, y2);
  }
}

/** Edge lengths of the floor, room or roof while its own corners are the ones showing. */
function drawShapeEdgeLengths() {
  if (tool !== "select" || editingFinishRegion()) return;
  const editable = editableShapeRef();
  if (!editable) return;
  const ring = editable.points;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    drawLengthLabel(x1, y1, x2, y2);
  }
}

/** The closed ring actually drawn for the property line, or null. */
function propertyRing() {
  const shape = store.doc.site?.propertyLine;
  if (!shape) return null;
  const poly = shapePolygon(shape);
  return poly.length >= 3 ? poly : null;
}

function propertyPickTol() {
  return Math.max(0.15, 8 / cam.scale);
}

function propertyHandleTol() {
  return (HANDLE / 2 + 2) / cam.scale;
}

/** Vertex (when selected, and only within the handle) or the boundary stroke. */
function propertyHitAt(wx, wy) {
  const pts = propertyRing();
  if (!pts || tool !== "select") return null;
  if (propertySelected) {
    const vertex = hitPropertyLine(pts, wx, wy, propertyHandleTol());
    if (vertex?.part === "vertex") return vertex;
  }
  return hitPropertyLine(pts, wx, wy, propertyPickTol());
}

function drawPropertyChrome() {
  const pts = propertyRing();
  if (!pts) return;
  if (propertyHover && !propertySelected && !drag && tool === "select") {
    ctx.save();
    ctx.strokeStyle = COLOUR.hover;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    pathForPoly(pts);
    ctx.stroke();
    ctx.restore();
  }
  if (!propertySelected || tool !== "select") return;
  ctx.save();
  ctx.strokeStyle = COLOUR.selection;
  ctx.lineWidth = 2.4;
  ctx.setLineDash([]);
  pathForPoly(pts);
  ctx.stroke();
  ctx.fillStyle = "#f4ede1";
  ctx.lineWidth = 1.6;
  for (const [x, y] of pts) {
    const [hx, hy] = worldToScreen(x, y);
    ctx.fillRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
    ctx.strokeRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
  }
  ctx.restore();
}

function beginPropertyDrag(ev, wx, wy) {
  const pts = propertyRing();
  const hit = propertyHitAt(wx, wy);
  if (!pts || !hit) return false;
  const was = propertySelected;
  propertySelected = true;
  underlaySelected = false;
  store.clearSelection();
  store.pushUndo();
  const origin = pts.map(([x, y]) => [x, y]);
  const vertex = hitPropertyLine(origin, wx, wy, propertyHandleTol());
  const hadDerived = Boolean(store.doc.site?.buildingLine?.derived);
  if (vertex?.part === "vertex") {
    drag = { kind: "property-vertex", index: vertex.index, origin, moved: false, hadDerived };
  } else {
    drag = { kind: "property-move", x0: wx, y0: wy, origin, moved: false, hadDerived };
  }
  if (!was) {
    setStatusMessage("Drag a corner to reshape the property line, or drag the line to move it. Delete removes it.", "ok");
  }
  el.canvas.setPointerCapture(ev.pointerId);
  return true;
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
  if (g.guideLine) {
    ctx.strokeStyle = "#3a5f7a";
    const line = g.guideLine;
    const [sx1, sy1] = worldToScreen(line.x1, line.y1);
    const [sx2, sy2] = worldToScreen(line.x2, line.y2);
    const dx = sx2 - sx1;
    const dy = sy2 - sy1;
    const span = Math.hypot(dx, dy) || 1;
    const reach = Math.hypot(rect.width, rect.height);
    ctx.beginPath();
    ctx.moveTo(sx1 - (dx / span) * reach, sy1 - (dy / span) * reach);
    ctx.lineTo(sx1 + (dx / span) * reach, sy1 + (dy / span) * reach);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // The nearest-object origin behind a gap dimension / round-length anchor.
  // Drawn first (bottom of the stack) since it's purely informational - how
  // far to that object - never something the point is snapped or aligned
  // to, so it should never visually outrank an actual join or alignment
  // drawn on top of it below.
  if (g.origin) {
    const [ox, oy] = worldToScreen(g.origin.x, g.origin.y);
    ctx.fillStyle = "rgba(58, 95, 122, 0.55)";
    ctx.beginPath();
    ctx.arc(ox, oy, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // The point itself, drawn next so the join/alignment glyphs below always
  // paint on top of it instead of being hidden underneath a same-colour,
  // same-position dot (an exact join lands on this exact point, and used to
  // draw its marker *first* - the dot then covered it almost entirely).
  const pdfSnap = g.guideXPoint?.kind === "pdf-end" || g.guideXPoint?.kind === "pdf-cross"
    || g.guideYPoint?.kind === "pdf-end" || g.guideYPoint?.kind === "pdf-cross";
  const ink = pdfSnap ? "#b2451e" : "#3a5f7a";
  const [px, py] = worldToScreen(g.x, g.y);
  ctx.fillStyle = g.snapped ? ink : "rgba(58, 95, 122, 0.7)";
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(px, py, g.snapped ? 4 : 3, 0, Math.PI * 2);
  if (g.snapped) ctx.fill();
  else {
    ctx.fill();
    ctx.stroke();
  }
  // A hard endpoint/corner join draws a dashed halo around the point: a
  // visible "you are connected here" cue, distinct from the plain dot above
  // and big enough (12x12 around a 8px dot) that it can never be swallowed
  // by it. A same-X/Y alignment guide (matched only one axis, to a point
  // that can be a perpendicular foot anywhere along a wall's run rather
  // than one of its ends) draws a lighter hollow diamond instead - it says
  // "lines up with this", not "locked to this".
  for (const guidePoint of new Set([g.snapX ? g.guideXPoint : null, g.snapY ? g.guideYPoint : null, g.guideLine?.point || null])) {
    if (!guidePoint) continue;
    const [qx, qy] = worldToScreen(guidePoint.x, guidePoint.y);
    ctx.strokeStyle = ink;
    if (g.exactJoin) {
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 2]);
      ctx.strokeRect(qx - 6, qy - 6, 12, 12);
      ctx.setLineDash([]);
      // An exact join leaves no gap dimension to hang a note off (the offset
      // is zero), so the reference is named here instead - latching a drawn
      // face looks identical to latching a centreline, and only the
      // centreline is what the corner-join pass will weld.
      const note = targetNote(guidePoint);
      if (note) drawSnapTag(qx + 10, qy - 10, note);
    } else {
      ctx.fillStyle = "#f4ede1";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(qx, qy - 5);
      ctx.lineTo(qx + 5, qy);
      ctx.lineTo(qx, qy + 5);
      ctx.lineTo(qx - 5, qy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();

  const minLabel = Math.max(0.05, g.tol || 0);
  // A pinned axis replaces that axis' automatic measurement: the user has
  // said which side they want, so the nearest-object string for the same
  // axis would only be a second number arguing with it.
  const pinned = { h: null, v: null };
  for (const probe of g.probes || []) pinned[probeAxis(probe.side)] = probe;

  // Measured from the run's own start, a distance is the length label already
  // on the line; along the run from elsewhere, it goes on the far side so the
  // two strings do not sit on top of each other.
  const from = drawingLineFrom();
  const isFrom = (p) => from && Math.hypot(p.x - from.x, p.y - from.y) < 1e-6;
  const alongH = Boolean(from && Math.abs(from.y - g.y) < 1e-6);
  const alongV = Boolean(from && Math.abs(from.x - g.x) < 1e-6);
  // The named guide string already measures this span. A second bare
  // "14400 mm" on the same line is what stacked under it while a room moved.
  const sameX = (point) => point && g.origin && Math.abs(point.x - g.origin.x) < 0.02;
  const sameY = (point) => point && g.origin && Math.abs(point.y - g.origin.y) < 0.02;

  if (!pinned.h && g.origin && g.dx != null && !g.snapX && Math.abs(g.dx) > minLabel && !isFrom({ x: g.origin.x, y: g.y }) && !(g.snapY && sameX(g.guideYPoint))) {
    drawGapDimension(g.origin.x, g.y, g.x, g.y, "h", "", alongH);
  }
  if (!pinned.v && g.origin && g.dy != null && !g.snapY && Math.abs(g.dy) > minLabel && !isFrom({ x: g.x, y: g.origin.y }) && !(g.snapX && sameY(g.guideXPoint))) {
    drawGapDimension(g.x, g.origin.y, g.x, g.y, "v", "", alongV);
  }
  // The alignment guide itself only says "your X/Y matches something else
  // on the sheet" - it says nothing about *how far* along that line the
  // matched point is (it could be off the top of the current view, as far
  // as the line is drawn). Label that distance whenever it's non-trivial.
  if (!pinned.v && g.snapX && g.guideXPoint && Math.abs(g.y - g.guideXPoint.y) > minLabel && !isFrom(g.guideXPoint)) {
    drawGapDimension(g.x, g.guideXPoint.y, g.x, g.y, "v", targetNote(g.guideXPoint), alongV);
  }
  if (!pinned.h && g.snapY && g.guideYPoint && Math.abs(g.x - g.guideYPoint.x) > minLabel && !isFrom(g.guideYPoint)) {
    drawGapDimension(g.guideYPoint.x, g.y, g.x, g.y, "h", targetNote(g.guideYPoint), alongH);
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

/** Cream-chipped caption beside a snap marker, matching the gap strings. */
function drawSnapTag(sx, sy, text) {
  ctx.save();
  ctx.setLineDash([]);
  ctx.font = "600 10px Source Sans 3, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width + 6;
  ctx.fillStyle = "rgba(244, 237, 225, 0.92)";
  ctx.fillRect(sx, sy - 7, w, 14);
  ctx.fillStyle = "#3a5f7a";
  ctx.fillText(text, sx + 3, sy);
  ctx.restore();
}

/** SKU category to the word a drawing would use for it. */
const CATEGORY_NOTE = {
  wall: "wall",
  foundation: "foundation",
  boundarywall: "boundary wall",
  beam: "beam",
  column: "column",
};

/**
 * What a snap target actually is, in the words a drawing would use: "face -
 * foundation", "centreline - wall". Centreline ends and drawn faces sit half
 * a wall apart, and only the centreline is what `joinWallCorners` welds - so
 * which one you caught is worth saying, and naming the object it belongs to
 * matters just as much: targets are collected across every level (there is
 * no level filter in `collectSnapTargets`), so a corner caught while drawing
 * a foundation can quite easily belong to an upper-floor wall that is not
 * even drawn on the current level - without the category that reads as an
 * unexplained extra corner on the foundation itself.
 */
function targetNote(point) {
  if (point?.kind === "pdf-end") return "PDF corner";
  if (point?.kind === "pdf-cross") return "PDF crossing";
  const kind = point?.kind === "endpoint" ? "centreline" : point?.kind === "face" ? "face" : "";
  if (!kind) return "";
  const category = CATEGORY_NOTE[point.category] || null;
  return category ? `${kind} - ${category}` : kind;
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
  if (site.propertyLine) drawPolyOutline(shapePolygon(site.propertyLine), COLOUR.propertyLine, true, 3, true);
  if (site.buildingLine) drawPolyOutline(shapePolygon(site.buildingLine), COLOUR.buildingLine, true, 3, true);
}

/** Live preview while drawing a property line: the vertices placed so far,
 * plus a rubber-band segment out to the cursor, echoing drawBeamStart's dot
 * but for an open polyline rather than a single point. */
function drawPropertyDraft() {
  ctx.save();
  ctx.strokeStyle = COLOUR.propertyLine;
  ctx.fillStyle = COLOUR.propertyLine;
  ctx.lineWidth = 3;
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
  if (siteDraft.length >= 3) {
    // Ready to close: ring the first point so it is obvious where to click.
    const [fx, fy] = worldToScreen(siteDraft[0].x, siteDraft[0].y);
    ctx.strokeStyle = "#2e9e4f";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(fx, fy, 9, 0, Math.PI * 2);
    ctx.stroke();
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
  const end = snapGuide ? { x: snapGuide.x, y: snapGuide.y } : hoverPoint;
  const [sx, sy] = worldToScreen(beamStart.x, beamStart.y);
  ctx.save();
  ctx.fillStyle = "#8d3416";
  ctx.beginPath();
  ctx.arc(sx, sy, 4, 0, Math.PI * 2);
  ctx.fill();
  if (end && lineLength(beamStart, end) >= 0.05) {
    const [ex, ey] = worldToScreen(end.x, end.y);
    ctx.strokeStyle = "#8d3416";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }
  ctx.restore();
  if (end) drawLengthLabel(beamStart.x, beamStart.y, end.x, end.y);
}

/** Same shape as `drawBeamStart()` - a line is a beam-shaped click-click with
 * no SKU - dashed to read as a draft, not yet-placed geometry. */
function drawFinishHost() {
  const host = finishHostPoly();
  if (!host?.length) return;
  ctx.save();
  ctx.beginPath();
  host.forEach((p, i) => {
    const [sx, sy] = worldToScreen(p[0], p[1]);
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  ctx.closePath();
  ctx.fillStyle = "rgba(178, 69, 30, 0.07)";
  ctx.strokeStyle = "#b2451e";
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawPolyDraft(points, colour) {
  if (!points?.length) return;
  const end = snapGuide ? { x: snapGuide.x, y: snapGuide.y } : hoverPoint;
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = 1.4;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  points.forEach((p, i) => {
    const [sx, sy] = worldToScreen(p.x, p.y);
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  if (end) {
    const [ex, ey] = worldToScreen(end.x, end.y);
    ctx.lineTo(ex, ey);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  for (const p of points) {
    const [sx, sy] = worldToScreen(p.x, p.y);
    ctx.fillRect(sx - 2, sy - 2, 4, 4);
  }
  ctx.restore();
  for (let i = 1; i < points.length; i += 1) {
    drawLengthLabel(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
  }
  if (end) {
    const last = points[points.length - 1];
    drawLengthLabel(last.x, last.y, end.x, end.y);
  }
}

function drawLineDraft() {
  const end = snapGuide ? { x: snapGuide.x, y: snapGuide.y } : hoverPoint;
  const [sx, sy] = worldToScreen(lineStart.x, lineStart.y);
  ctx.save();
  ctx.fillStyle = COLOUR.hover;
  ctx.beginPath();
  ctx.arc(sx, sy, 4, 0, Math.PI * 2);
  ctx.fill();
  if (end && lineLength(lineStart, end) >= 0.05) {
    const [ex, ey] = worldToScreen(end.x, end.y);
    ctx.strokeStyle = COLOUR.hover;
    ctx.lineWidth = 1.4;
    ctx.setLineDash(tool === "annot-line" || tool === "separation" ? [6, 4] : []);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }
  ctx.restore();
  if (end) drawLengthLabel(lineStart.x, lineStart.y, end.x, end.y);
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
    if (!planObjectVisible(room) || !keptByCut(room, "room")) continue;
    if (test(bbox(roomPolygon(room)))) hits.push({ kind: "room", id: room.id });
  }
  for (const slab of store.doc.slabs.filter(onActiveLevel)) {
    if (!planObjectVisible(slab) || !keptByCut(slab)) continue;
    if (test(bbox(shapePolygon(slab.shape)))) hits.push({ kind: "slab", id: slab.id });
  }
  for (const roof of store.doc.roofs.filter(onActiveLevel)) {
    if (!planObjectVisible(roof) || !keptByCut(roof, "roof")) continue;
    if (test(bbox(shapePolygon(roof.shape)))) hits.push({ kind: "roof", id: roof.id });
  }
  for (const seg of store.doc.segments.filter(onActiveLevel)) {
    if (!planObjectVisible(seg) || !keptByCut(seg, "wall")) continue;
    const segBox = { x: Math.min(seg.x1, seg.x2), y: Math.min(seg.y1, seg.y2), w: Math.max(0.02, Math.abs(seg.x2 - seg.x1)), h: Math.max(0.02, Math.abs(seg.y2 - seg.y1)) };
    if (test(segBox)) hits.push({ kind: "segment", id: seg.id });
  }
  for (const beam of store.doc.beams.filter(onActiveLevel)) {
    if (!planObjectVisible(beam) || !keptByCut(beam, "beam")) continue;
    const beamBox = { x: Math.min(beam.x1, beam.x2), y: Math.min(beam.y1, beam.y2), w: Math.max(0.02, Math.abs(beam.x2 - beam.x1)), h: Math.max(0.02, Math.abs(beam.y2 - beam.y1)) };
    if (test(beamBox)) hits.push({ kind: "beam", id: beam.id });
  }
  for (const line of (store.doc.separations || []).filter(onActiveLevel)) {
    if (!planObjectVisible(line) || !keptByCut(line, "line")) continue;
    const lineBox = { x: Math.min(line.x1, line.x2), y: Math.min(line.y1, line.y2), w: Math.max(0.02, Math.abs(line.x2 - line.x1)), h: Math.max(0.02, Math.abs(line.y2 - line.y1)) };
    if (test(lineBox)) hits.push({ kind: "separation", id: line.id });
  }
  for (const region of (store.doc.regions || []).filter(onActiveLevel)) {
    if (!planObjectVisible(region) || !keptByCut(region, "line")) continue;
    if (test(bbox(shapePolygon(region.shape)))) hits.push({ kind: "region", id: region.id });
  }
  for (const cloud of (store.doc.revisionClouds || []).filter(onActiveLevel)) {
    const b = { x: cloud.rect.minX, y: cloud.rect.minY, w: cloud.rect.maxX - cloud.rect.minX, h: cloud.rect.maxY - cloud.rect.minY };
    if (test(b)) hits.push({ kind: "revisionCloud", id: cloud.id });
  }
  for (const line of store.doc.lines.filter(onActiveLevel)) {
    if (!planObjectVisible(line) || !keptByCut(line, "line")) continue;
    const lineBox = { x: Math.min(line.x1, line.x2), y: Math.min(line.y1, line.y2), w: Math.max(0.02, Math.abs(line.x2 - line.x1)), h: Math.max(0.02, Math.abs(line.y2 - line.y1)) };
    if (test(lineBox)) hits.push({ kind: "line", id: line.id });
  }
  for (const dim of (store.doc.dimensions || []).filter(onActiveLevel)) {
    if (!planObjectVisible(dim) || !keptByCut(dim, "line")) continue;
    const dimBox = { x: Math.min(dim.x1, dim.x2), y: Math.min(dim.y1, dim.y2), w: Math.max(0.02, Math.abs(dim.x2 - dim.x1)), h: Math.max(0.02, Math.abs(dim.y2 - dim.y1)) };
    if (test(dimBox)) hits.push({ kind: "dimension", id: dim.id });
  }
  for (const item of store.doc.items.filter(onActiveLevel)) {
    if (!planObjectVisible(item) || !keptByCut(item, "item")) continue;
    const sku = skuById(item.sku);
    if (sku && test(itemRect(item, sku))) hits.push({ kind: "item", id: item.id });
  }
  if ((store.doc.serviceNodes || []).length && keptByCut(null, "service")) {
    const nodes = new Map(store.doc.serviceNodes.map((n) => [n.id, n]));
    for (const node of store.doc.serviceNodes) {
      if (!planObjectVisible(node) || !onActiveLevel(node)) continue;
      if (test({ x: node.x, y: node.y, w: 0.02, h: 0.02 })) hits.push({ kind: "serviceNode", id: node.id });
    }
    for (const edge of store.doc.serviceEdges || []) {
      if (!planObjectVisible(edge) || !onActiveLevel(edge)) continue;
      const a = nodes.get(edge.fromNode);
      const b = nodes.get(edge.toNode);
      if (!a || !b || a.level !== activeLevel || b.level !== activeLevel) continue;
      const runBox = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(0.02, Math.abs(b.x - a.x)), h: Math.max(0.02, Math.abs(b.y - a.y)) };
      if (test(runBox)) hits.push({ kind: "serviceEdge", id: edge.id });
    }
  }
  for (const opening of store.doc.openings) {
    const host = openingHosted(opening);
    if (!host) continue;
    const symbol = openingSymbolBox(opening, host.wall, host.placed);
    if (symbol && test(symbol)) hits.push({ kind: "opening", id: opening.id });
  }
  return hits;
}

// --- underlay hit testing ---------------------------------------------

/** A hidden sheet is not drawn and must not steal clicks either. */
function underlayIsVisible() {
  if (isolateCurrentLevel && !isolateShows(activeStationKind(), "underlay")) return false;
  return Boolean(store.doc.underlay && underlayBitmap() && !isUnderlayHidden(store.doc));
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

/** A route point (or riser marker) first, then a run: a point sits on its runs, so it must win. */
function serviceHit(wx, wy) {
  if (!(store.doc.serviceNodes || []).length) return null;
  if (!keptByCut(null, "service")) return null;
  const nodeTol = 12 / cam.scale;
  let best = null;
  let bestD = nodeTol;
  for (const node of store.doc.serviceNodes) {
    if (!planObjectVisible(node) || !onActiveLevel(node)) continue;
    const d = Math.hypot(node.x - wx, node.y - wy);
    if (d <= bestD) { best = node; bestD = d; }
  }
  if (best) return { kind: "serviceNode", id: best.id };
  const nodes = new Map(store.doc.serviceNodes.map((n) => [n.id, n]));
  const runTol = 7 / cam.scale;
  let bestEdge = null;
  let bestEdgeD = runTol;
  for (const edge of store.doc.serviceEdges || []) {
    if (!planObjectVisible(edge) || !onActiveLevel(edge)) continue;
    const a = nodes.get(edge.fromNode);
    const b = nodes.get(edge.toNode);
    // Only the part of a run that is drawn on this storey can be picked here.
    if (!a || !b || a.level !== activeLevel || b.level !== activeLevel) continue;
    const d = distToSeg(a.x, a.y, b.x, b.y, wx, wy);
    if (d <= bestEdgeD) { bestEdge = edge; bestEdgeD = d; }
  }
  return bestEdge ? { kind: "serviceEdge", id: bestEdge.id } : null;
}

function hitTest(wx, wy, { skipServices = false, skipAreas = false } = {}) {
  const pxTol = 6 / cam.scale;

  if (!skipServices) {
    const serviceRef = serviceHit(wx, wy);
    if (serviceRef) return serviceRef;
  }

  const items = store.doc.items.filter(onActiveLevel);
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (!planObjectVisible(item) || !keptByCut(item, "item")) continue;
    const sku = skuById(item.sku);
    if (!sku) continue;
    const box = itemRect(item, sku);
    if (wx >= box.x - pxTol && wx <= box.x + box.w + pxTol && wy >= box.y - pxTol && wy <= box.y + box.h + pxTol) {
      return { kind: "item", id: item.id };
    }
  }
  const openingHit = openingAt(wx, wy);
  if (openingHit) return openingHit;
  const beams = store.doc.beams.filter(onActiveLevel);
  for (let i = beams.length - 1; i >= 0; i -= 1) {
    const beam = beams[i];
    if (!planObjectVisible(beam) || !keptByCut(beam, "beam")) continue;
    const sku = skuById(beam.sku);
    const tol = Math.max(0.15, (sku?.geometry?.width || 0.11) / 2 + 0.05);
    if (distToSeg(beam.x1, beam.y1, beam.x2, beam.y2, wx, wy) < tol) return { kind: "beam", id: beam.id };
  }
  const segments = store.doc.segments.filter(onActiveLevel);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const seg = segments[i];
    if (!planObjectVisible(seg) || !keptByCut(seg, "wall")) continue;
    const sku = skuById(seg.sku);
    if (distToSeg(seg.x1, seg.y1, seg.x2, seg.y2, wx, wy) < wallHitTol(sku)) return { kind: "segment", id: seg.id };
  }
  // No SKU to size a hit tolerance from, unlike a beam/wall - a fixed
  // pick width close to the drawn stroke is all a line needs.
  for (let i = (store.doc.revisionClouds || []).length - 1; i >= 0; i -= 1) {
    const cloud = store.doc.revisionClouds[i];
    if (!onActiveLevel(cloud)) continue;
    const { minX, minY, maxX, maxY } = cloud.rect;
    const near = [ [minX, minY, maxX, minY], [maxX, minY, maxX, maxY], [maxX, maxY, minX, maxY], [minX, maxY, minX, minY] ]
      .some(([x1, y1, x2, y2]) => distToSeg(x1, y1, x2, y2, wx, wy) < 0.2);
    if (near) return { kind: "revisionCloud", id: cloud.id };
  }
  if (!skipAreas) {
    for (let i = (store.doc.regions || []).length - 1; i >= 0; i -= 1) {
      const region = store.doc.regions[i];
      if (!onActiveLevel(region) || !planObjectVisible(region)) continue;
      if (pointInPoly(wx, wy, shapePolygon(region.shape))) return { kind: "region", id: region.id };
    }
  }
  for (let i = (store.doc.separations || []).length - 1; i >= 0; i -= 1) {
    const line = store.doc.separations[i];
    if (!onActiveLevel(line) || !planObjectVisible(line)) continue;
    if (distToSeg(line.x1, line.y1, line.x2, line.y2, wx, wy) < 0.15) return { kind: "separation", id: line.id };
  }
  const lines = store.doc.lines.filter(onActiveLevel);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!planObjectVisible(line) || !keptByCut(line, "line")) continue;
    if (distToSeg(line.x1, line.y1, line.x2, line.y2, wx, wy) < 0.15) return { kind: "line", id: line.id };
  }
  for (let i = (store.doc.dimensions || []).length - 1; i >= 0; i -= 1) {
    const dim = store.doc.dimensions[i];
    if (!onActiveLevel(dim) || !planObjectVisible(dim) || !keptByCut(dim, "line")) continue;
    if (distToSeg(dim.x1, dim.y1, dim.x2, dim.y2, wx, wy) < 0.2) return { kind: "dimension", id: dim.id };
  }
  if (skipAreas) return null;
  const slabs = store.doc.slabs.filter(onActiveLevel);
  for (let i = slabs.length - 1; i >= 0; i -= 1) {
    const slab = slabs[i];
    if (!planObjectVisible(slab) || !keptByCut(slab)) continue;
    if (pointInPoly(wx, wy, shapePolygon(slab.shape))) return { kind: "slab", id: slab.id };
  }
  // Rooms before roofs: a roof typically envelopes the whole footprint, so
  // without this a click anywhere inside the building would always hit the
  // roof instead of the room underneath it.
  const rooms = store.doc.rooms.filter(onActiveLevel);
  for (let i = rooms.length - 1; i >= 0; i -= 1) {
    const room = rooms[i];
    if (!planObjectVisible(room) || !keptByCut(room, "room")) continue;
    if (pointInPoly(wx, wy, roomPolygon(room))) return { kind: "room", id: room.id };
  }
  const roofs = store.doc.roofs.filter(onActiveLevel);
  for (let i = roofs.length - 1; i >= 0; i -= 1) {
    const roof = roofs[i];
    if (!planObjectVisible(roof) || !keptByCut(roof, "roof")) continue;
    if (pointInPoly(wx, wy, shapePolygon(roof.shape))) return { kind: "roof", id: roof.id };
  }
  return null;
}

/** A wall, a floor slab, or the floor of a room. Ceilings are not floors. */
function wallOrFloorAt(wx, wy) {
  const segments = store.doc.segments.filter(onActiveLevel);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const seg = segments[i];
    if (!planObjectVisible(seg) || !keptByCut(seg, "wall")) continue;
    const sku = skuById(seg.sku);
    const tol = Math.max(0.18, drawnWallThickness(sku) / 2 + 0.08);
    if (distToSeg(seg.x1, seg.y1, seg.x2, seg.y2, wx, wy) < tol) return { kind: "segment", id: seg.id };
  }
  const slabs = (store.doc.slabs || []).filter(onActiveLevel);
  for (let i = slabs.length - 1; i >= 0; i -= 1) {
    const slab = slabs[i];
    if (!planObjectVisible(slab) || !keptByCut(slab)) continue;
    if (skuById(slab.sku)?.category === "ceiling") continue;
    if (pointInPoly(wx, wy, shapePolygon(slab.shape))) return { kind: "slab", id: slab.id };
  }
  const rooms = store.doc.rooms.filter(onActiveLevel);
  for (let i = rooms.length - 1; i >= 0; i -= 1) {
    const room = rooms[i];
    if (!planObjectVisible(room) || !keptByCut(room, "room")) continue;
    if (pointInPoly(wx, wy, roomPolygon(room))) return { kind: "room", id: room.id };
  }
  return null;
}

/**
 * The plan object a stationary click should take while a route is already
 * selected. The route is skipped, so the wall, door, line or floor under it
 * can be chosen. A ceiling is not a floor.
 */
function objectUnderRoute(wx, wy) {
  const hit = hitTest(wx, wy, { skipServices: true });
  if (!hit) return null;
  if (hit.kind === "slab") {
    const slab = (store.doc.slabs || []).find((s) => s.id === hit.id);
    if (skuById(slab?.sku)?.category === "ceiling") return wallOrFloorAt(wx, wy);
  }
  return hit;
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
  if (kind === "line") return "Line";
  if (kind === "separation") return "Separation";
  if (kind === "region") return "Region";
  if (kind === "revisionCloud") return "Revision cloud";
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

/**
 * Width/height a drawn wall or beam carries from its type - fixed by the
 * SKU, not something the user sets by dragging. Walls/foundations state
 * plan thickness + height; beams state width + height directly. Shown
 * read-only in the Length/Angle strip so the fixed cross-section is visible
 * without pretending it is editable there (change the type instead).
 */
function linearWidthHeight(sku) {
  if (!sku) return { width: null, height: null };
  if (sku.category === "beam" || sku.category === "column") {
    const g = sku.geometry || {};
    return { width: g.width ?? null, height: g.height ?? null };
  }
  return {
    width: drawnWallThickness(sku),
    height: skuDrawnHeight(sku) ?? pack?.system?.wallHeight ?? null,
  };
}

function setTypeFlyoutOpen(open) {
  if (!el.typeFlyout || !el.typeCurrent) return;
  el.typeFlyout.classList.toggle("is-open", open);
  el.typeFlyout.setAttribute("aria-hidden", open ? "false" : "true");
  el.typeCurrent.setAttribute("aria-expanded", open ? "true" : "false");
}

/** Kinds a SKU can retype at all - the same set `syncPlanContext` uses to
 * decide whether the type picker applies to a selection, single or multi. */
const TYPEABLE_KINDS = new Set(["room", "segment", "beam", "roof", "slab", "opening", "item"]);

function currentSkuOfRef(ref) {
  const obj = objByRef(ref);
  if (!obj) return null;
  if (ref.kind === "room") return skuById(obj.floorSku || obj.wallSku);
  if (obj.sku) return skuById(obj.sku);
  return null;
}

/** The categories the palette should show while retyping an existing
 * selection: whatever categories its typeable members are currently made
 * of, so clicking the Type pill on a selected wall behaves like arming the
 * Walls ribbon button instead of demanding a ribbon tool first. Null when
 * nothing selected is typeable (falls back to the idle "pick a tool" copy). */
function selectionSkuCategories() {
  if (wallDraft) return null;
  const refs = store.selected.length ? store.selected : store.primary ? [store.primary] : [];
  const cats = new Set();
  for (const ref of refs) {
    if (!TYPEABLE_KINDS.has(ref.kind)) continue;
    const sku = currentSkuOfRef(ref);
    if (sku) cats.add(sku.category);
  }
  return cats.size ? Array.from(cats) : null;
}

function contextSku() {
  if (wallDraft) return skuById(placeSkuId);
  const ref = store.selected.length === 1 ? store.primary : null;
  if (ref) {
    const sku = currentSkuOfRef(ref);
    if (sku) return sku;
  }
  return skuById(placeSkuId);
}

/**
 * The "current type" pill above the palette, for one object exactly as
 * before, and now also for a multi-object selection: the shared type if every
 * typeable member agrees, "Multiple types" if they don't - Revit's Type
 * Selector shows the same blank-when-mixed state on a multi-selection.
 */
function syncTypeCurrent() {
  if (!wallDraft && store.selected.length > 1) {
    const skus = store.selected
      .filter((ref) => TYPEABLE_KINDS.has(ref.kind))
      .map(currentSkuOfRef)
      .filter(Boolean);
    const distinct = new Set(skus.map((s) => s.id));
    if (el.typeCurrentName) {
      el.typeCurrentName.textContent = distinct.size === 0 ? "Pick a type"
        : distinct.size === 1 ? skus[0].name
        : "Multiple types";
    }
    if (el.typeCurrentMeta) el.typeCurrentMeta.textContent = distinct.size === 1 ? skuDimLabel(skus[0]) : "";
    return;
  }
  const sku = contextSku();
  if (el.typeCurrentName) el.typeCurrentName.textContent = sku?.name || "Pick a type";
  if (el.typeCurrentMeta) el.typeCurrentMeta.textContent = sku ? skuDimLabel(sku) : "";
}

function placingToolArmed() {
  return Boolean(paletteFilter) && tool !== "select" && tool !== "calibrate";
}

function renderPalette() {
  if (!el.skuList || !el.search) return;
  const q = (el.search.value || "").trim().toLowerCase();
  // Drawing arms `paletteFilter` via the ribbon; retyping an existing
  // selection has no ribbon tool armed, so fall back to the categories
  // already present in the selection - same list, same click-to-apply.
  const effectiveFilter = paletteFilter || selectionSkuCategories();
  if (!q && !effectiveFilter) {
    el.skuList.innerHTML = `<p class="hint palette-idle">Pick Walls, Doors or another tool on the ribbon to see types.</p>`;
    return;
  }
  const groups = new Map();
  for (const sku of pack.skus) {
    // A search term reaches every type; browsing stays inside the last
    // ribbon function, so 64 electrical points never bury 3 wall types.
    if (!q && effectiveFilter && !effectiveFilter.includes(sku.category)) continue;
    const hay = `${sku.id} ${sku.name} ${sku.category}`.toLowerCase();
    if (q && !hay.includes(q)) continue;
    if (!groups.has(sku.category)) groups.set(sku.category, []);
    groups.get(sku.category).push(sku);
  }
  el.skuList.innerHTML = "";
  if (!groups.size) {
    el.skuList.innerHTML = `<p class="hint palette-idle">No types match.</p>`;
    paletteSkuOrder = [];
    return;
  }
  // Flat, category-ordered list mirroring what's on screen right now: the
  // type detail overlay's prev/next and side rail walk this same order, so
  // "other options" means exactly what the palette is currently showing.
  paletteSkuOrder = [];
  for (const [cat, skus] of groups) {
    const wrap = document.createElement("div");
    wrap.className = "planner-sku-group";
    wrap.innerHTML = `<h3>${escapeHtml(CATEGORY_LABEL[cat] || cat)}</h3>`;
    for (const sku of skus) {
      paletteSkuOrder.push(sku);
      const row = document.createElement("div");
      row.className = "sku-row";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sku-item";
      if (placeSkuId === sku.id) btn.classList.add("active");
      btn.innerHTML = `<span class="sku-name">${escapeHtml(sku.name)}</span><span class="sku-meta">${escapeHtml(sku.id)} · ${escapeHtml(skuDimLabel(sku))}</span>`;
      btn.addEventListener("click", () => onSkuClick(sku));
      const expand = document.createElement("button");
      expand.type = "button";
      expand.className = "sku-expand";
      expand.title = "Preview this type";
      expand.setAttribute("aria-label", `Preview ${sku.name}`);
      expand.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg><span class="sku-expand-label">Preview</span>`;
      // Preview is a deliberate escalation, not part of picking a type: stop
      // the click from also bubbling into the sku-item's onSkuClick.
      expand.addEventListener("click", (ev) => {
        ev.stopPropagation();
        openTypeDetail(sku);
      });
      row.appendChild(btn);
      row.appendChild(expand);
      wrap.appendChild(row);
    }
    el.skuList.appendChild(wrap);
  }
  syncTypeCurrent();
}

function onSkuClick(sku) {
  setTypeFlyoutOpen(false);
  holdInspectorGraph(() => {
    if (applySkuToSelection(sku)) {
      render();
      return;
    }
    placeSkuId = sku.id;
    beamStart = null;
    lineStart = null;
    wallDraft = null;
    shapeDraft = null;
    if (sku.category !== "door") doorHandSign = 1;
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
    offerFoundationPlan();
    renderPalette();
    updateRibbonHint();
    render();
  });
}

/**
 * Retype the current selection from the palette - v1's applySkuToSelection,
 * now covering the whole selection in one click instead of just one object
 * (Revit's Type Selector, applied to a multi-object selection). Returns
 * false when nothing selected can take this SKU at all, so the caller (a
 * click on a palette swatch) falls back to arming a draw tool exactly as it
 * did when there was no eligible selection.
 */
function applySkuToSelection(sku) {
  if (!store.selected.length) return false;
  store.pushUndo();
  const result = retypeSelection(store.doc, store.selected, sku, { skuById });
  if (!result.ok) {
    store.undoStack.pop();
    return false;
  }
  store.setSelection(result.refs, store.primary);
  store.persist();
  setStatusMessage(result.message, result.skipped.length ? "warn" : "ok");
  return true;
}

// --- Type detail overlay -------------------------------------------------
// A full-screen escalation the user opts into from a palette row's expand
// icon, not something shown on every draw: picking a type stays a one-click
// action in the compact Inspector. This is where a photo/3D preview lives
// today (skeleton only - a placeholder), and later supplier photos, links
// and pricing for that SKU. See PLAN discussion: "drawing options full
// screen" - kept opt-in to avoid fatiguing users who already know the type.
const TYPE_DETAIL_ICON = {
  wall: "\u25A4", boundarywall: "\u25A4", foundation: "\u2593", floor: "\u25A6",
  ceiling: "\u25A6", roof: "\u25B2", door: "\u25AB", window: "\u25A2", beam: "\u2500",
  column: "\u25A0", stair: "\u2261", sanitary: "\u25CE", waterheater: "\u25CE",
  drainage: "\u2933", electrical: "\u26A1", furniture: "\u25A3", casework: "\u25A3",
  pool: "\u2248", carport: "\u25B2",
};

let typeDetailSku = null;
// The list navigated by prev/next and the side rail. Snapshotted from
// paletteSkuOrder when opened, so scrolling the palette or a stray re-render
// while the overlay is open can't yank the list out from under the user.
let typeDetailList = [];

function openTypeDetail(sku) {
  if (!sku || !el.typeDetailOverlay) return;
  typeDetailList = paletteSkuOrder.length ? paletteSkuOrder : [sku];
  renderTypeDetailNav();
  selectTypeDetail(sku);
  el.typeDetailOverlay.hidden = false;
}

function closeTypeDetail() {
  if (el.typeDetailOverlay) el.typeDetailOverlay.hidden = true;
  typeDetailSku = null;
  typeDetailList = [];
}

function stepTypeDetail(delta) {
  if (!typeDetailSku || typeDetailList.length < 2) return;
  const i = typeDetailList.findIndex((s) => s.id === typeDetailSku.id);
  if (i < 0) return;
  const next = typeDetailList[(i + delta + typeDetailList.length) % typeDetailList.length];
  selectTypeDetail(next);
}

/** Switch the overlay to another SKU in place - no close/reopen round trip. */
function selectTypeDetail(sku) {
  typeDetailSku = sku;
  renderTypeDetail(sku);
  if (el.typeDetailNav) {
    el.typeDetailNav.querySelectorAll("[data-sku-id]").forEach((row) => {
      const active = row.dataset.skuId === sku.id;
      row.classList.toggle("active", active);
      if (active) row.scrollIntoView({ block: "nearest" });
    });
  }
}

/** The side rail: same category grouping as the palette, so "other options"
 *  here matches what was on screen when the user opened this SKU. */
function renderTypeDetailNav() {
  if (!el.typeDetailNav) return;
  el.typeDetailNav.innerHTML = "";
  const showGroups = typeDetailList.length > 1;
  if (el.typeDetailNav.parentElement) el.typeDetailNav.parentElement.classList.toggle("has-nav", showGroups);
  if (!showGroups) return;
  let lastCat = null;
  for (const sku of typeDetailList) {
    if (sku.category !== lastCat) {
      lastCat = sku.category;
      const h = document.createElement("h4");
      h.textContent = CATEGORY_LABEL[sku.category] || sku.category;
      el.typeDetailNav.appendChild(h);
    }
    const row = document.createElement("button");
    row.type = "button";
    row.className = "type-detail-nav-item";
    row.dataset.skuId = sku.id;
    row.innerHTML = `<span class="sku-name">${escapeHtml(sku.name)}</span><span class="sku-meta">${escapeHtml(skuDimLabel(sku))}</span>`;
    row.addEventListener("click", () => selectTypeDetail(sku));
    el.typeDetailNav.appendChild(row);
  }
}

function renderTypeDetail(sku) {
  if (el.typeDetailName) el.typeDetailName.textContent = sku.name;
  if (el.typeDetailMeta) el.typeDetailMeta.textContent = `${sku.id} · ${skuDimLabel(sku)}`;
  if (el.typeDetailCategory) el.typeDetailCategory.textContent = CATEGORY_LABEL[sku.category] || sku.category;
  if (el.typeDetailCount) {
    const i = typeDetailList.findIndex((s) => s.id === sku.id);
    el.typeDetailCount.textContent = typeDetailList.length > 1 ? `${i + 1} of ${typeDetailList.length}` : "";
  }
  const canStep = typeDetailList.length > 1;
  if (el.typeDetailPrev) el.typeDetailPrev.hidden = !canStep;
  if (el.typeDetailNext) el.typeDetailNext.hidden = !canStep;

  // No real imagery yet - a cached per-SKU photo/render (or later a
  // supplier photo) would set el.typeDetailImg.src and hide the
  // placeholder instead of returning early here.
  if (el.typeDetailImg) { el.typeDetailImg.hidden = true; el.typeDetailImg.removeAttribute("src"); }
  if (el.typeDetailPlaceholder) el.typeDetailPlaceholder.hidden = false;
  if (el.typeDetailPlaceholderIcon) el.typeDetailPlaceholderIcon.textContent = TYPE_DETAIL_ICON[sku.category] || "\u25A1";

  if (el.typeDetailDims) {
    const g = sku.geometry || {};
    el.typeDetailDims.innerHTML = "";
    for (const key of GEOMETRY_LENGTH_KEYS) {
      if (!(key in g)) continue;
      const dt = document.createElement("dt");
      dt.textContent = key;
      const dd = document.createElement("dd");
      dd.textContent = `${Math.round(g[key] * 1000)} mm`;
      el.typeDetailDims.appendChild(dt);
      el.typeDetailDims.appendChild(dd);
    }
    if (!el.typeDetailDims.children.length) {
      el.typeDetailDims.innerHTML = `<p class="hint">No dimensions recorded for this type.</p>`;
    }
  }
}

function wireTypeDetail() {
  el.typeDetailClose?.addEventListener("click", closeTypeDetail);
  el.typeDetailPrev?.addEventListener("click", () => stepTypeDetail(-1));
  el.typeDetailNext?.addEventListener("click", () => stepTypeDetail(1));
  el.typeDetailOverlay?.addEventListener("click", (event) => {
    if (event.target === el.typeDetailOverlay) closeTypeDetail();
  });
  document.querySelectorAll("#v2-type-detail-overlay [data-detail-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#v2-type-detail-overlay [data-detail-view]").forEach((b) => b.classList.toggle("active", b === btn));
      // Both tabs show the same placeholder for now; once real photo and 3D
      // sources exist, swap el.typeDetailImg.src / placeholder per tab here.
    });
  });
  el.typeDetailUse?.addEventListener("click", () => {
    if (typeDetailSku) onSkuClick(typeDetailSku);
    closeTypeDetail();
  });
}

el.search?.addEventListener("input", renderPalette);

el.typeCurrent?.addEventListener("click", () => {
  const open = !el.typeFlyout?.classList.contains("is-open");
  setTypeFlyoutOpen(open);
  if (open) renderPalette();
});

document.addEventListener("pointerdown", (ev) => {
  if (!el.typeFlyout?.classList.contains("is-open")) return;
  if (el.ctxTypePicker?.contains(ev.target)) return;
  // Re-clicking a ribbon button must not dismiss the list: it re-arms the same
  // tool, which would otherwise leave the form showing instead of the types.
  if (ev.target.closest?.("#v2-ribbon, .ribbon")) return;
  setTypeFlyoutOpen(false);
});

function bindPanelResize(handle, { get, set, invert }) {
  if (!handle) return;
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.classList.add("is-dragging");
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = get();
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      set(invert ? startW - dx : startW + dx);
    };
    const onUp = () => {
      handle.classList.remove("is-dragging");
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  });
  handle.addEventListener("keydown", (e) => {
    let dir = 0;
    if (e.key === "ArrowRight") dir = invert ? -1 : 1;
    else if (e.key === "ArrowLeft") dir = invert ? 1 : -1;
    else return;
    e.preventDefault();
    set(get() + dir * 16);
  });
}

{
  const root = document.getElementById("v2-app");
  const readVar = (name, fallback) => {
    const n = parseFloat(getComputedStyle(root).getPropertyValue(name));
    return Number.isFinite(n) ? n : fallback;
  };
  const writeVar = (name, px) => {
    const other = name === "--levels" ? readVar("--dock", 320) : readVar("--levels", 300);
    const room = (root?.clientWidth || 0) - other - 280;
    const clamped = Math.min(560, Math.max(220, Math.min(px, Math.max(220, room))));
    root?.style.setProperty(name, `${Math.round(clamped)}px`);
  };
  bindPanelResize(document.getElementById("v2-resize-levels"), {
    get: () => readVar("--levels", 300),
    set: (width) => writeVar("--levels", width),
    invert: false,
  });
  bindPanelResize(document.getElementById("v2-resize-dock"), {
    get: () => readVar("--dock", 320),
    set: (width) => writeVar("--dock", width),
    invert: true,
  });
}

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

/** Second sentence on a snap tool's hint: which side the live measurement
 * is using. Shown before any arrow is pressed, and updated in the same
 * chip when one is. A cut warning stays the whole hint — it is the thing
 * that has to be read, and the arrows still work once it is cleared. */
function measureHintClause() {
  if (!snapPreviewTool()) return "";
  const pinned = [probeSide.h, probeSide.v].filter(Boolean);
  if (!pinned.length) return "Arrows measure to the left, right, up or down.";
  return `Measuring ${pinned.join(" and ")}. The same arrow returns to the nearest object.`;
}

function setRibbonHint(text, warn = false) {
  const clause = text && !warn && !panMode ? measureHintClause() : "";
  const full = clause ? `${text} ${clause}` : (text || "");
  el.ribbonHint.hidden = !full;
  el.ribbonHint.classList.toggle("ribbon-hint-warn", Boolean(warn) && Boolean(text));
  el.ribbonHint.textContent = full;
}

/** Next-step hint overlaid on the canvas, shown once a tool is armed
 * (a category/tool function is active). One-shot commands (rotate,
 * compile, ...) already surface their own feedback, so they do not set this.
 *
 * Overridden by a warning when the armed tool does not belong on the current
 * cut (a roof on "00 FOUNDATION", a foundation on the ground floor — see
 * `placementCutWarning`). Arming Foundations is the one case that moves the
 * cut: the pack already names the storey, so `offerFoundationPlan` switches
 * there. Switching back stays available, and the hint then says so. */
function updateRibbonHint() {
  if (!el.ribbonHint) return;
  if (panMode) {
    setRibbonHint("Drag to move the plan. Esc or Pan again goes back to the tool you were using.");
    return;
  }
  // While the attach target pick is armed the hint is the live preview of what
  // the hovered candidate would do, or why it cannot be picked.
  if (attachPick) {
    const hoverText = attachPick.hover ? attachHoverText(attachPick.hover) : null;
    setRibbonHint(hoverText ? hoverText.text : HINTS.attach, Boolean(hoverText?.warn));
    return;
  }
  if (tool === "align") {
    const marked = (store.doc.sheetSet?.pages || []).filter((p) => p.anchor).length;
    setRibbonHint(marked
      ? `${marked} sheet${marked === 1 ? " is" : "s are"} marked. Switch to the next sheet and click the same point. Esc stops.`
      : "Click a point that is on every sheet, such as a building corner. Then mark it on each other sheet, whether that is another floor or another drawing of this one. Esc stops.");
    return;
  }
  if (tool === "camera") {
    setRibbonHint(cameraDraft?.a ? "Click what you look at." : HINTS["view-camera"]);
    return;
  }
  if (tool === "section") {
    setRibbonHint(sectionDraft?.a
      ? "Click the other end of the cut. Look is to the left of the line."
      : HINTS.section);
    return;
  }
  if (tool === "callout") {
    setRibbonHint(calloutDraft?.a ? "Click the opposite corner." : HINTS.callout);
    return;
  }
  if (tool === "revision") {
    setRibbonHint(revisionCloudDraft?.a ? "Click the opposite corner." : HINTS.revision);
    return;
  }
  if (tool === "model-line" || tool === "annot-line" || tool === "separation") {
    setRibbonHint(lineStart
      ? "Click the other end."
      : HINTS[tool === "annot-line" ? "annot-lines" : tool === "separation" ? "room-sep" : "model-lines"]);
    return;
  }
  if (tool === "room" && roomDraft?.length) {
    setRibbonHint("Click the next corner. Enter closes the room.");
    return;
  }
  if (tool === "region") {
    setRibbonHint(regionFinish
      ? (regionDraft?.length
        ? "Click the next corner on this floor. Enter closes the shape."
        : "Click corners on this floor. They snap to its edges. Enter closes the shape.")
      : (regionDraft?.length ? "Click the next corner. Enter closes the region." : HINTS.region));
    return;
  }
  if (tool === "measure") {
    setRibbonHint(measureDraft?.a ? "Click the other end." : HINTS.dimensions);
    return;
  }
  if (tool === "service-route" && serviceRoute) {
    setRibbonHint("Click the next point. Enter finishes; Esc drops the route in progress.");
    return;
  }
  if (tool === "service-connect" && serviceConnect) {
    setRibbonHint("Click the component to connect this point to.");
    return;
  }
  const cutWarning = placementCutWarning();
  if (cutWarning) {
    setRibbonHint(cutWarning, true);
    return;
  }
  if (wallDraft) {
    setRibbonHint(wallLocation === "center"
      ? "Click to end, or type a length and press Enter. Drawing on the centreline. Esc cancels this wall."
      : `Click to end, or type a length and press Enter. Drawing on the ${wallLocation} face; Space flips it. Esc cancels this wall.`);
    return;
  }
  if (shapeDraft) {
    setRibbonHint(shapeDraft.kind === "roof-new"
      ? "Click the opposite corner. Corners snap to walls; draw past them for an overhang."
      : "Click the opposite corner, or type millimetres. Tab switches width / height.");
    return;
  }
  if (tool === "door") {
    setRibbonHint("Click a wall. The side you are on is the side it opens to. Space flips which end it hinges from.");
    return;
  }
  if (tool === "select" && store.selected.length === 1 && store.primary?.kind === "opening") {
    if (selectedDoor()) {
      setRibbonHint("Drag the door along the wall to move it. Drag it to the other side to flip the swing. Space flips the hinge.");
    } else {
      setRibbonHint("Drag the window along the wall to move it.");
    }
    return;
  }
  const hint = activeFunction && HINTS[activeFunction];
  setRibbonHint(hint || "");
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
  if (item.id === "rotate" && selectedDoor()) {
    return { label: "Flip hinge", title: "Flip which end the door hinges from" };
  }
  if (item.id === "mirror" && selectedDoor()) {
    return { label: "Flip swing", title: "Flip which side of the wall the door opens to" };
  }
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
        ? "Showing this cut only. Click to ghost the neighbouring level again."
        : ghost?.look === "up"
          ? "Ghosting the walls above. Click to show this cut only."
          : ghost
            ? "Ghosting the floor below. Click to show this cut only."
            : "Nothing next to this cut to ghost. Click to keep this cut only.",
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
  if (item.id === "select-similar") {
    if (store.selected.length !== 1) return { disabled: true, title: "Select one wall, foundation, beam, roof, floor, door, window or item first." };
    const obj = objByRef(store.primary);
    const category = obj ? skuById(obj.sku)?.category : null;
    if (!category) return { disabled: true, title: "That has no type category to match against." };
    return { title: `Select every other ${CATEGORY_LABEL[category] || category} in the drawing, ready to retype from the palette.` };
  }
  if (item.id === "service-route" || item.id === "service-connect" || item.id === "service-node") {
    return { active: tool === item.id, title: HINTS[item.id] };
  }
  if (item.id === "service-rise") {
    const one = store.selected.length === 1 && store.primary?.kind === "serviceNode";
    return one ? { title: HINTS[item.id] } : { disabled: true, title: "Select one route point first." };
  }
  if (item.id === "service-type") {
    const any = store.selected.some((r) => r.kind === "serviceEdge");
    return any ? { title: HINTS[item.id] } : { disabled: true, title: "Select one or more routes first." };
  }
  if (item.id === "service-slope") {
    const drains = store.selected.some((r) => {
      if (r.kind !== "serviceEdge") return false;
      const edge = objByRef(r);
      return (store.doc.serviceNetworks || []).find((n) => n.id === edge?.networkId)?.system === "drainage";
    });
    return drains ? { title: HINTS[item.id] } : { disabled: true, title: "Select a drainage run first." };
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
  if (item.id === "sheet-list") {
    const has = Boolean(store.doc.sheetSet);
    return {
      active: has && sheetUi.listVisible(),
      disabled: !has,
      title: has ? "Show or hide the list of pages in the inspector." : "Import a multi-page PDF first.",
    };
  }
  if (item.id === "align-floors") {
    const can = Number.isInteger(store.doc.underlay?.sheetPage);
    return {
      active: tool === "align",
      disabled: !can,
      title: can ? "Click the same point on each sheet. Lines up different floors, or two drawings of one floor. Other sheets move onto the one that stays put." : "Import a multi-page PDF and show one of its sheets first.",
    };
  }
  const ids = new Set(["underlay-adjust", "calibrate", "underlay-toggle", "underlay-off"]);
  if (!ids.has(item.id)) return null;
  const loaded = Boolean(store.doc.underlay);
  if (!loaded) return { disabled: true, title: "Load a PDF, image or satellite view first." };
  const hidden = isUnderlayHidden(store.doc);
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
  setPanMode(false);
  if (serviceRoute?.fromNodeId) finishServiceRoute({ select: false });
  serviceRoute = null;
  serviceConnect = null;
  activeFunction = item.id;
  paletteFilter = item.categories || null;
  lastPaletteLabel = item.categories ? item.label : lastPaletteLabel;
  tool = item.tool || "select";
  if (tool !== "door") doorHandSign = 1;
  placeSkuId = pack.skus.find((s) => (item.categories || []).includes(s.category))?.id ?? null;
  beamStart = null;
  lineStart = null;
  wallDraft = null;
  shapeDraft = null;
  sizeDraft = null;
  roomDraft = null;
  regionDraft = null;
  measureDraft = null;
  showDimensions = false;
  underlaySelected = false;
  syncToolButtons();
  // The selection is what keeps the inspector on the wall, opening or route
  // it was editing, and the wall elevation stays open while that face is
  // still selected. A placement tool takes both.
  leaveInspectorForPlacement();
  clearRouteIfLeavingServices();
  offerFoundationPlan();
  drawRibbon();
  renderPalette();
  render();
}

/** One entry point so the ribbon, the keyboard and the header buttons agree. */
function runCommand(name) {
  setPanMode(false);
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
    case "elevation": openElevationPicker(); return;
    case "callout": startCalloutCrop(); return;
    case "revision": startRevisionCloud(); return;
    case "model-lines": startLineTool("model"); return;
    case "annot-lines": startLineTool("annotation"); return;
    case "room-sep": startSeparation(); return;
    case "region": startRegion(); return;
    case "finishes": openFloorFinishes(); return;
    case "wall-finishes": openWallFinishes(); return;
    case "sheets": case "view-section": openSheets(); return;
    case "project-info": openProjectInfo(); return;
    case "underlay": openUnderlayPicker(); return;
    case "reference": sheetUi.openReference(); return;
    case "sheet-list": sheetUi.setListVisible(); drawRibbon(); return;
    case "align-floors": startAlignFloors(); return;
    case "satellite": openSatellitePanel(); return;
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
    case "service-route": case "service-connect": case "service-node": startServiceTool(name); return;
    case "service-rise": focusServiceField("rise-delta"); return;
    case "service-type": focusServiceField("edge-sku"); return;
    case "service-slope": focusServiceField("fall"); return;
    case "attach": startAttachPick(); return;
    case "detach": runDetach(); return;
    case "select-similar": runSelectSimilar(); return;
    case "rotate":
      if (!flipDoors("hinge")) modifySelection("rotate");
      break;
    case "mirror":
      if (!flipDoors("swing")) modifySelection("mirror");
      break;
    case "copy": case "align":
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
  const refusal = modifyRefusal(store.selected);
  if (refusal) {
    setStatusMessage(refusal, "warn");
    return;
  }
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
  massView.setServices(serviceMassingRoutes(store.doc, pack));
  if (view?.mode === "look") massView.setLook(view);
  else if (view?.mode === "section") massView.setSection(view);
  else if (view?.mode === "elevation") massView.setElevation(view);
  else massView.setOrbit();
  massView.setPayload(compile(store.doc, pack));
  hideMassRender();
  el.massOverlay.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => massView.resize()));
}

function closeMassing() {
  hideMassRender();
  el.massOverlay.hidden = true;
}

function syncGenerateEnabled() {
  if (!el.massGenerate || el.massGenerate.dataset.busy === "1") return;
  el.massGenerate.disabled = Boolean(el.massEmpty && !el.massEmpty.hidden);
}

function hideMassRender() {
  if (el.massRender) {
    el.massRender.hidden = true;
    el.massRender.classList.remove("is-ready", "is-pending");
  }
  if (el.massRenderImg) el.massRenderImg.removeAttribute("src");
  if (el.massRenderStatus) {
    el.massRenderStatus.hidden = true;
    el.massRenderStatus.textContent = "";
  }
  if (el.massShow3d) el.massShow3d.hidden = true;
  if (el.massGenerate) el.massGenerate.textContent = "Generate model";
}

function massingSnapshot() {
  const src = el.massCanvas;
  if (!src?.width || !src.height) return null;
  const maxW = 1536;
  if (src.width <= maxW) return src.toDataURL("image/png");
  const dest = document.createElement("canvas");
  dest.width = maxW;
  dest.height = Math.max(1, Math.round(src.height * (maxW / src.width)));
  dest.getContext("2d").drawImage(src, 0, 0, dest.width, dest.height);
  return dest.toDataURL("image/png");
}

async function generateModel() {
  if (el.massEmpty && !el.massEmpty.hidden) {
    setStatusMessage("Draw a room, wall or roof, then generate a model.", "warn");
    return;
  }
  const image = massingSnapshot();
  if (!image) {
    setStatusMessage("The 3D view is empty.", "warn");
    return;
  }
  if (el.massGenerate) {
    el.massGenerate.dataset.busy = "1";
    el.massGenerate.disabled = true;
    el.massGenerate.textContent = "Generating…";
  }
  if (el.massRender) {
    el.massRender.hidden = false;
    el.massRender.classList.add("is-pending");
    el.massRender.classList.remove("is-ready");
  }
  if (el.massRenderStatus) {
    el.massRenderStatus.hidden = false;
    el.massRenderStatus.textContent = "Generating a photorealistic view…";
  }
  try {
    const rendered = await cloud.visualize({ image });
    if (!rendered) throw new CloudError(502, "The visualization could not be generated");
    if (el.massRenderImg) el.massRenderImg.src = rendered;
    if (el.massRender) {
      el.massRender.classList.remove("is-pending");
      el.massRender.classList.add("is-ready");
    }
    if (el.massRenderStatus) el.massRenderStatus.hidden = true;
    if (el.massShow3d) el.massShow3d.hidden = false;
    if (el.massGenerate) el.massGenerate.textContent = "Generate again";
    setStatusMessage("Photorealistic model ready.", "ok");
  } catch (error) {
    const message = error?.authRequired
      ? "Sign in to generate a model."
      : (error?.message || "The visualization could not be generated");
    if (el.massRender) {
      el.massRender.hidden = false;
      el.massRender.classList.add("is-pending");
      el.massRender.classList.remove("is-ready");
    }
    if (el.massRenderStatus) {
      el.massRenderStatus.hidden = false;
      el.massRenderStatus.textContent = message;
    }
    if (el.massShow3d) el.massShow3d.hidden = false;
    setStatusMessage(message, "warn");
  } finally {
    if (el.massGenerate) {
      delete el.massGenerate.dataset.busy;
      syncGenerateEnabled();
      if (!el.massGenerate.textContent || el.massGenerate.textContent === "Generating…") {
        el.massGenerate.textContent = "Generate model";
      }
    }
  }
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
  // Every cut becomes its own saved view, the same as Revit's Section tool -
  // `view-section` (Output > Views) is what lets a sheet point at one later.
  createSection(store.doc, cut);
  store.persist();
  openMassing(cut);
}

// --- elevation (Output > Views > Elevation) --------------------------------
//
// No two clicks the way Section needs them: a whole-building elevation has
// no line to draw, only a side to pick, so this is a small chooser rather
// than an armed canvas tool - see elevation.js's header for why the same
// projection maths still applies. Picking a direction saves it as a named
// view immediately, the same "every use creates a view" rule `finishSectionCut`
// follows, then opens the massing view already looking that way.

function openElevationPicker() {
  if (!el.elevationOverlay) return;
  el.elevationOverlay.hidden = false;
}

function closeElevationPicker() {
  if (el.elevationOverlay) el.elevationOverlay.hidden = true;
}

function pickElevation(direction) {
  const { ok, elevation, reason } = createElevation(store.doc, direction);
  if (!ok) {
    setStatusMessage(reason || "That is not a compass direction.", "warn");
    return;
  }
  store.persist();
  closeElevationPicker();
  openMassing(elevation.cut);
}

function wireElevationPicker() {
  el.elevationClose?.addEventListener("click", closeElevationPicker);
  el.elevationOverlay?.addEventListener("click", (event) => {
    if (event.target === el.elevationOverlay) closeElevationPicker();
  });
  if (el.elevationDirections) {
    el.elevationDirections.innerHTML = ELEVATION_DIRECTIONS.map((dir) => `
      <button type="button" class="elevation-direction-btn" data-direction="${dir}">${elevationDirectionLabel(dir)}</button>
    `).join("");
    el.elevationDirections.querySelectorAll("[data-direction]").forEach((btn) => {
      btn.addEventListener("click", () => pickElevation(btn.dataset.direction));
    });
  }
}

// --- callout (Output > Views > Call out) ------------------------------------
//
// Click-click, the same shape as Section's cut, because a crop box needs two
// opposite corners exactly as a cut needs two endpoints - see callout.js's
// header for why this is not the u/v-projection shape section/elevation
// share instead. Unlike Section/Elevation there is no massing view to jump
// into afterwards: a callout is a plan crop, not a new viewing direction, so
// committing one just saves it and leaves the user on the plan, ready to
// send it to a sheet via the Sheets panel's view chooser.

function startCalloutCrop() {
  calloutDraft = { a: null };
  tool = "callout";
  activeFunction = "callout";
  underlaySelected = false;
  store.clearSelection();
  syncToolButtons();
  drawRibbon();
  setStatusMessage("Click one corner of the detail, then the opposite corner.", "ok");
  render();
}

function finishCalloutCrop(target) {
  const rect = calloutFromClicks(calloutDraft.a, target);
  if (!rect) {
    setStatusMessage("The two corners need to be further apart than that.", "warn");
    return;
  }
  calloutDraft = null;
  tool = "select";
  activeFunction = null;
  syncToolButtons();
  drawRibbon();
  // Every crop becomes its own saved view immediately, the same permanence
  // rule `finishSectionCut`/`pickElevation` follow - see callout.js's header.
  const { callout } = createCallout(store.doc, rect);
  store.persist();
  setStatusMessage(`${callout.name} saved. Assign it to a sheet from the Sheets panel.`, "ok");
  render();
}

// --- revision cloud (Document > Annotate > Revision cloud) ------------------
//
// Same click-click shape as callout's crop box, for the same reason - see
// revision.js's header. Unlike callout, the cloud saved here is never itself
// a sheet viewport, so there is nothing to jump into afterwards beyond the
// Sheets panel's own "link to a revision" step.

function startRevisionCloud() {
  revisionCloudDraft = { a: null };
  tool = "revision";
  activeFunction = "revision";
  underlaySelected = false;
  store.clearSelection();
  syncToolButtons();
  drawRibbon();
  setStatusMessage("Click one corner of the changed area, then the opposite corner.", "ok");
  render();
}

function finishRevisionCloud(target) {
  const rect = revisionCloudFromClicks(revisionCloudDraft.a, target);
  if (!rect) {
    setStatusMessage("The two corners need to be further apart than that.", "warn");
    return;
  }
  revisionCloudDraft = null;
  tool = "select";
  activeFunction = null;
  syncToolButtons();
  drawRibbon();
  // Every cloud is saved immediately, unlinked - the same permanence rule
  // `finishCalloutCrop` follows - see revision.js's header for why linking
  // to a revision is a separate, later step rather than asked for here.
  createRevisionCloud(store.doc, rect, { level: activeLevel });
  store.persist();
  setStatusMessage("Revision cloud saved. Link it to a revision from the Sheets panel.", "ok");
  render();
}

// --- lines (Document > Lines > Model / Annotate) ----------------------------
//
// Click-click, one segment per pair of clicks and staying armed for the next
// one - the beam tool's shape, not the wall tool's typed-length chain, since
// a line has no thickness/SKU to size against. `tool` itself carries which
// of the two ribbon buttons armed it ("model-line" / "annot-line") rather
// than a second state variable, the same way "section"/"elevation"/"callout"
// are each their own `tool` value instead of one "view" tool plus a flag.

function startLineTool(kind) {
  lineStart = null;
  tool = kind === "annotation" ? "annot-line" : "model-line";
  activeFunction = kind === "annotation" ? "annot-lines" : "model-lines";
  underlaySelected = false;
  store.clearSelection();
  syncToolButtons();
  drawRibbon();
  setStatusMessage(HINTS[activeFunction], "ok");
  render();
}

function commitLine(kind, a, b) {
  if (!canCommitLine(a, b)) return;
  store.pushUndo();
  store.doc.lines.push({
    id: nid("ln"), kind, level: activeLevel, x1: a.x, y1: a.y, x2: b.x, y2: b.y, status: placementStatus(),
  });
  store.persist();
}

function startSeparation() {
  lineStart = null;
  roomDraft = null;
  regionDraft = null;
  tool = "separation";
  activeFunction = "room-sep";
  underlaySelected = false;
  store.clearSelection();
  syncToolButtons();
  drawRibbon();
  setStatusMessage(HINTS["room-sep"], "ok");
  render();
}

function commitSeparation(a, b) {
  if (!canCommitLine(a, b)) return;
  if (!Array.isArray(store.doc.separations)) store.doc.separations = [];
  store.pushUndo();
  store.doc.separations.push({
    id: nid("sp"), separation: true, level: activeLevel, x1: a.x, y1: a.y, x2: b.x, y2: b.y, status: placementStatus(),
  });
  store.persist();
}

function startRegion(opts = null) {
  regionFinish = opts?.finish || null;
  regionDraft = [];
  roomDraft = null;
  lineStart = null;
  tool = "region";
  activeFunction = "region";
  underlaySelected = false;
  if (!regionFinish) store.clearSelection();
  syncToolButtons();
  drawRibbon();
  setStatusMessage(regionFinish
    ? "Click corners on this floor. They snap to its edges. Enter closes the shape."
    : HINTS.region, "ok");
  render();
}

function finishRegionDraft() {
  if (!regionDraft || regionDraft.length < 3) {
    setStatusMessage("A region needs at least three corners.", "warn");
    return;
  }
  if (regionFinish) {
    finishFloorRegionDraft();
    return;
  }
  if (!Array.isArray(store.doc.regions)) store.doc.regions = [];
  store.pushUndo();
  const region = {
    id: nid("rg"),
    level: activeLevel,
    convention: null,
    status: placementStatus(),
    shape: polyShape(regionDraft.map((p) => [p.x, p.y])),
  };
  store.doc.regions.push(region);
  regionDraft = null;
  tool = "select";
  activeFunction = null;
  store.setSelection([{ kind: "region", id: region.id }]);
  syncToolButtons();
  drawRibbon();
  store.persist();
  setStatusMessage("Region saved. Pick Brick red, Concrete or Concrete 2 in the inspector.", "ok");
  render();
}

function placeRoomAt(p) {
  const face = enclosedFace(store.doc, pack, activeLevel, p.x, p.y);
  if (!face) return false;
  commitRoomRecord({
    shape: polyShape(face),
    seed: { x: p.x, y: p.y },
    bound: true,
  });
  setStatusMessage("Room filled to the surrounding walls. Set its use in the inspector.", "ok");
  render();
  return true;
}

function finishRoomDraft() {
  if (!roomDraft || roomDraft.length < 3) {
    setStatusMessage("A room needs at least three corners.", "warn");
    return;
  }
  const points = roomDraft.map((p) => [p.x, p.y]);
  const [cx, cy] = points.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]).map((n) => n / points.length);
  const face = enclosedFace(store.doc, pack, activeLevel, cx, cy);
  if (face) {
    commitRoomRecord({ shape: polyShape(face), seed: { x: cx, y: cy }, bound: true });
    setStatusMessage("Room filled to the surrounding walls. Set its use in the inspector.", "ok");
  } else {
    commitRoomRecord({ shape: polyShape(points) });
    setStatusMessage("Room placed. Set its use in the inspector.", "ok");
  }
  roomDraft = null;
  updateRibbonHint();
  render();
}

function openFloorFinishes() {
  const floors = (pack?.skus || []).filter((s) => s.category === "floor");
  if (!floors.length) {
    setStatusMessage("The template has no floor types.", "warn");
    return;
  }
  activeFunction = "finishes";
  paletteFilter = ["floor"];
  lastPaletteLabel = "Floor finishes";
  const selectedRoom = store.selected.some((r) => r.kind === "room");
  if (!selectedRoom) {
    tool = "room";
    activeFunction = "rooms";
  }
  setTypeFlyoutOpen(true);
  syncToolButtons();
  drawRibbon();
  renderPalette();
  setStatusMessage(selectedRoom
    ? "Pick a floor type. It is assigned to the selected room."
    : "Pick a floor type, then place the room.", "ok");
  render();
}

/** Wall finishes live in the inspector of the selected wall; this opens it with the elevation beside it. */
function openWallFinishes() {
  tool = "select";
  activeFunction = null;
  syncToolButtons();
  drawRibbon();
  if (selectedElevationFace()) {
    elevationOpen = true;
    setStatusMessage("Add finishes in the inspector, or drag the edges of a band in the elevation.", "ok");
  } else {
    setStatusMessage("Select a wall to finish it, or a room to finish all its walls.", "ok");
  }
  render();
}

function startMeasure() {
  measureDraft = { a: null };
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
  if (!Array.isArray(store.doc.dimensions)) store.doc.dimensions = [];
  store.pushUndo();
  store.doc.dimensions.push({
    id: nid("dim"),
    level: activeLevel,
    x1: dim.a.x, y1: dim.a.y, x2: dim.b.x, y2: dim.b.y,
  });
  store.persist();
  measureDraft = { a: null };
  setStatusMessage(dim.label, "ok");
  updateRibbonHint();
  render();
}

function wireMassing() {
  el.massClose.addEventListener("click", closeMassing);
  el.massGenerate?.addEventListener("click", () => { generateModel(); });
  el.massShow3d?.addEventListener("click", hideMassRender);
  el.massOverlay.addEventListener("click", (event) => {
    if (event.target === el.massOverlay) closeMassing();
  });
  document.querySelectorAll("[data-mass-status]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-mass-status]").forEach((b) => b.classList.toggle("active", b === btn));
      massView.setStatusFilter(btn.dataset.massStatus || "both");
    });
  });
  if (el.massServices) {
    massView.setShowServices(el.massServices.checked);
    el.massServices.addEventListener("change", () => {
      massView.setShowServices(el.massServices.checked);
    });
  }
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
// title block. A callout view reuses this exact same schematic drawing,
// just windowed to the crop rectangle and drawn at the callout's own scale
// (see the "callout" branch below) rather than a separately drafted detail
// view with openings and dimensions of its own - that stays a scheduling
// gap, not an integrity one.

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
  if (el.sheetView) {
    const sections = ensureSections(store.doc);
    const elevations = ensureElevations(store.doc);
    const callouts = ensureCallouts(store.doc);
    el.sheetView.innerHTML = `<option value="plan">Plan</option>${
      sections.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join("")
    }${
      elevations.map((e) => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`).join("")
    }${
      callouts.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("")
    }`;
    const view = sheetView(store.doc, sheet);
    if (el.sheetLevel && pack) {
      const planView = view.kind === "plan" || view.kind === "callout";
      el.sheetLevel.disabled = !planView;
      el.sheetLevel.innerHTML = `<option value="">All levels</option>${
        (pack.levels || []).map((l) => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.name || l.id)}</option>`).join("")
      }`;
      el.sheetLevel.value = sheet.planLevel || "";
    }
    el.sheetView.value = view.kind === "section" ? view.sectionId
      : view.kind === "elevation" ? view.elevationId
      : view.kind === "callout" ? view.calloutId
      : "plan";
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

/**
 * Every revision cloud this sheet can offer a link to: one already linked to
 * it, plus every unlinked one - never a cloud linked to a *different* sheet,
 * so this list is never the place a firm accidentally steals another
 * sheet's mark. Selecting "Unlinked" calls `linkRevisionCloud` with a null
 * `rev`, and picking a letter calls it with one this sheet has actually
 * issued - the select's own options are only ever `sheet.revisions`, so
 * there is no path to link a cloud to a revision that does not exist.
 */
function renderSheetClouds() {
  if (!el.sheetCloudList) return;
  const sheet = activeSheet();
  if (!sheet) {
    el.sheetCloudList.innerHTML = '<p class="hint">Select a sheet to link revision clouds.</p>';
    return;
  }
  const clouds = ensureRevisionClouds(store.doc).filter((c) => !c.sheetId || c.sheetId === sheet.id);
  if (!clouds.length) {
    el.sheetCloudList.innerHTML = '<p class="hint">No revision clouds drawn yet - use Document &gt; Annotate &gt; Revision cloud.</p>';
    return;
  }
  const revOptions = (sheet.revisions || [])
    .map((r) => `<option value="${escapeHtml(r.rev)}">${escapeHtml(r.rev)} — ${escapeHtml(r.description || "—")}</option>`)
    .join("");
  el.sheetCloudList.innerHTML = clouds.map((c, i) => `
    <div class="sheet-rev-row">
      <span>Cloud ${i + 1}${c.note ? `: ${escapeHtml(c.note)}` : ""}</span>
      <select data-cloud-link="${escapeHtml(c.id)}"${sheet.revisions.length ? "" : " disabled"}>
        <option value="">Unlinked</option>
        ${revOptions}
      </select>
    </div>
  `).join("") + (sheet.revisions.length ? "" : '<p class="hint">Add a revision above before a cloud can link to one.</p>');
  el.sheetCloudList.querySelectorAll("[data-cloud-link]").forEach((select) => {
    const cloud = clouds.find((c) => c.id === select.dataset.cloudLink);
    select.value = cloud?.rev || "";
    select.addEventListener("change", () => {
      linkRevisionCloud(store.doc, select.dataset.cloudLink, sheet.id, select.value || null);
      store.persist();
      renderSheetClouds();
      drawActiveSheet();
    });
  });
}

function renderSheets() {
  renderSheetList();
  renderSheetFields();
  renderSheetClouds();
}

/** Bounding box of the forms a sheet will actually draw, plus any extra
 * plan points (the property line, so the erf fits on the sheet). Returns
 * null when there is nothing, so the caller can fall back rather than
 * divide by a zero extent. */
function planExtentFromPayload(payload, { forms = null, extraPoints = [] } = {}) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x, y) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  };
  for (const form of forms || payload?.sketchForms || []) {
    for (const loop of form.profileLoops || []) {
      for (const curve of loop.curves || []) {
        for (const pt of [curve.start, curve.end]) if (pt) grow(pt[0], pt[1]);
      }
    }
  }
  for (const p of extraPoints) grow(p[0], p[1]);
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** Room boxes where rooms exist, otherwise one box around the walls, so a
 * wall-traced plan still gets an overall dimension string on the sheet. */
function sheetDimensionBoxes(doc, forms) {
  const boxes = [];
  for (const form of forms) {
    if ((form.kind || "").toLowerCase() !== "room") continue;
    const raw = (doc.rooms || []).find((r) => r.id === form.elementId);
    if (!raw) continue;
    const b = bbox(roomPolygon(raw));
    if (b && b.w > 0 && b.h > 0) boxes.push(b);
  }
  if (boxes.length) return boxes;
  const extent = planExtentFromPayload(null, {
    forms: forms.filter((f) => (f.kind || "").toLowerCase() === "wall"),
  });
  return extent && extent.w > 0 && extent.h > 0
    ? [{ x: extent.minX, y: extent.minY, w: extent.w, h: extent.h }]
    : [];
}

function drawSheetDimension(sctx, project, line) {
  const [x1, y1] = project(line.x1, line.y1);
  const [x2, y2] = project(line.x2, line.y2);
  const colour = line.overall ? "#1a1612" : "#5c5347";
  sctx.save();
  sctx.strokeStyle = colour;
  sctx.lineWidth = line.overall ? 1.1 : 0.8;
  for (const [ex, ey] of line.extFrom || []) {
    const [sx, sy] = project(ex, ey);
    sctx.beginPath();
    sctx.moveTo(sx, sy);
    sctx.lineTo(line.kind === "h" ? sx : x1, line.kind === "h" ? y1 : sy);
    sctx.stroke();
  }
  sctx.beginPath();
  sctx.moveTo(x1, y1);
  sctx.lineTo(x2, y2);
  sctx.stroke();
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  let rot = Math.atan2(y2 - y1, x2 - x1);
  if (rot > Math.PI / 2) rot -= Math.PI;
  if (rot < -Math.PI / 2) rot += Math.PI;
  sctx.font = `${line.overall ? 11 : 10}px "Source Sans 3", sans-serif`;
  sctx.textAlign = "center";
  sctx.textBaseline = "middle";
  sctx.translate(mx, my);
  sctx.rotate(rot);
  const width = sctx.measureText(line.label).width + 4;
  sctx.fillStyle = "#fdfaf3";
  sctx.fillRect(-width / 2, -6, width, 12);
  sctx.fillStyle = colour;
  sctx.fillText(line.label, 0, 0);
  sctx.restore();
}

function drawSheetOpening(sctx, project, pxPerM, form, walls) {
  const curves = form.profileLoops?.[0]?.curves || [];
  const line = curves.find((c) => c.kind === "Line" && c.start && c.end);
  if (!line) return;
  const a = project(line.start[0], line.start[1]);
  const b = project(line.end[0], line.end[1]);
  const host = (walls || []).find((w) => w.id === form.hostWallId);
  sctx.save();
  sctx.strokeStyle = "#fdfaf3";
  sctx.lineWidth = Math.max(2, ((host?.thickness || 0.22) * pxPerM) + 1);
  sctx.lineCap = "butt";
  sctx.beginPath();
  sctx.moveTo(a[0], a[1]);
  sctx.lineTo(b[0], b[1]);
  sctx.stroke();
  sctx.strokeStyle = "#1a1612";
  sctx.lineWidth = 1;
  const arc = curves.find((c) => c.kind === "Arc" && c.end);
  if (arc) {
    const leaf = project(arc.end[0], arc.end[1]);
    const da = Math.hypot(arc.end[0] - line.start[0], arc.end[1] - line.start[1]);
    const db = Math.hypot(arc.end[0] - line.end[0], arc.end[1] - line.end[1]);
    const hinge = da <= db ? a : b;
    const free = da <= db ? b : a;
    const along = [free[0] - hinge[0], free[1] - hinge[1]];
    const span = Math.hypot(along[0], along[1]) || 1;
    const half = ((host?.thickness || 0.22) * pxPerM) / 2;
    const nx = (-along[1] / span) * half;
    const ny = (along[0] / span) * half;
    sctx.lineWidth = 1.25;
    for (const at of [hinge, free]) {
      sctx.beginPath();
      sctx.moveTo(at[0] - nx, at[1] - ny);
      sctx.lineTo(at[0] + nx, at[1] + ny);
      sctx.stroke();
    }
    sctx.lineWidth = 1;
    sctx.beginPath();
    sctx.moveTo(hinge[0], hinge[1]);
    sctx.lineTo(leaf[0], leaf[1]);
    sctx.stroke();
    const radius = Math.hypot(free[0] - hinge[0], free[1] - hinge[1]);
    if (radius > 1) {
      const from = Math.atan2(free[1] - hinge[1], free[0] - hinge[0]);
      const to = Math.atan2(leaf[1] - hinge[1], leaf[0] - hinge[0]);
      let sweep = to - from;
      while (sweep > Math.PI) sweep -= Math.PI * 2;
      while (sweep < -Math.PI) sweep += Math.PI * 2;
      sctx.beginPath();
      sctx.arc(hinge[0], hinge[1], radius, from, from + sweep, sweep < 0);
      sctx.stroke();
    }
  } else {
    sctx.setLineDash([4, 3]);
    sctx.beginPath();
    sctx.moveTo(a[0], a[1]);
    sctx.lineTo(b[0], b[1]);
    sctx.stroke();
  }
  sctx.restore();
}

function drawSheetSite(sctx, project, site) {
  if (!site) return;
  const drawPoly = (shape, colour) => {
    const poly = shapePolygon(shape);
    if (poly.length < 3) return;
    sctx.save();
    sctx.strokeStyle = colour;
    sctx.fillStyle = colour;
    sctx.lineWidth = 1.2;
    sctx.setLineDash([6, 4]);
    sctx.beginPath();
    poly.forEach((p, i) => {
      const [sx, sy] = project(p[0], p[1]);
      if (i) sctx.lineTo(sx, sy);
      else sctx.moveTo(sx, sy);
    });
    sctx.closePath();
    sctx.stroke();
    sctx.setLineDash([]);
    sctx.font = "10px \"Source Sans 3\", sans-serif";
    sctx.textAlign = "center";
    sctx.textBaseline = "bottom";
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.2) continue;
      const [mx, my] = project((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      sctx.fillText(`${formatLengthMm(len)} mm`, mx, my - 2);
    }
    sctx.restore();
  };
  drawPoly(site.propertyLine, "#8d3416");
  drawPoly(site.buildingLine, "#1f6b45");
}

function drawSheetNorthAndScale(sctx, areaX, areaY, areaH, pxPerM, scaleN) {
  const metres = scaleBarMetres(scaleN);
  const x = areaX + 14;
  const base = areaY + areaH - 16;
  sctx.save();
  sctx.strokeStyle = "#1a1612";
  sctx.fillStyle = "#1a1612";
  sctx.lineWidth = 1.2;
  const nx = x + 8;
  const ny = base - 34;
  sctx.beginPath();
  sctx.moveTo(nx, ny + 12);
  sctx.lineTo(nx, ny - 14);
  sctx.stroke();
  sctx.beginPath();
  sctx.moveTo(nx, ny - 16);
  sctx.lineTo(nx - 4, ny - 8);
  sctx.lineTo(nx + 4, ny - 8);
  sctx.closePath();
  sctx.fill();
  sctx.font = "600 11px \"Source Sans 3\", sans-serif";
  sctx.textAlign = "center";
  sctx.textBaseline = "middle";
  sctx.fillText("N", nx, ny - 26);
  if (metres) {
    const w = metres * pxPerM;
    sctx.beginPath();
    sctx.moveTo(x + 24, base);
    sctx.lineTo(x + 24 + w, base);
    sctx.moveTo(x + 24, base - 4);
    sctx.lineTo(x + 24, base + 4);
    sctx.moveTo(x + 24 + w, base - 4);
    sctx.lineTo(x + 24 + w, base + 4);
    sctx.stroke();
    sctx.font = "10px \"Source Sans 3\", sans-serif";
    sctx.textAlign = "left";
    sctx.fillText(`${metres} m`, x + 28 + w, base);
  }
  sctx.restore();
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

  // The chosen view decides what fills the one viewport, and what extent the
  // scale row is computed from - a section's or elevation's own u/v box, a
  // callout's own crop rectangle, or the whole plan's.
  const view = sheetView(store.doc, sheet);
  const section = view.kind === "section" ? sectionById(store.doc, view.sectionId) : null;
  const elevation = view.kind === "elevation" ? elevationById(store.doc, view.elevationId) : null;
  const callout = view.kind === "callout" ? calloutById(store.doc, view.calloutId) : null;
  // A callout draws the same schematic plan a plain "plan" viewport does,
  // windowed to its crop. Both read one compiled payload. `planLevel` keeps
  // a plan or callout to a single storey; unset, every storey still draws.
  const payload = (view.kind === "plan" || view.kind === "callout") ? (compile(store.doc, pack) || { sketchForms: [] }) : null;
  const planLevel = payload ? (sheet.planLevel || null) : null;
  const forms = payload ? planFormsForLevel(payload, planLevel) : null;
  const sitePoints = [];
  if (view.kind === "plan") {
    for (const shape of [store.doc.site?.propertyLine, store.doc.site?.buildingLine]) {
      for (const p of shapePolygon(shape)) sitePoints.push(p);
    }
  }
  const planExtent = forms && view.kind === "plan"
    ? planExtentFromPayload(payload, { forms, extraPoints: sitePoints })
    : null;
  const sectionGeom = section ? sectionCutGeometry(section) : null;
  const elevationGeom = elevation ? elevationGeometry(elevation) : null;
  const calloutGeom = callout ? calloutExtent(callout) : null;
  const extent = view.kind === "plan" ? planExtent
    : view.kind === "section" ? sectionGeom?.extent
    : view.kind === "elevation" ? elevationGeom?.extent
    : calloutGeom;
  // A callout's own `scale` is its blow-up factor - see callout.js's header -
  // and wins over the auto-fit recommendation `sheetScale()` would otherwise
  // compute for its (small) crop extent, though a firm's explicit
  // `scaleOverride` on the sheet itself still wins over that.
  const preferredScale = view.kind === "callout" ? callout?.scale : null;
  const fields = titleBlockFields(store.doc, pack, sheet, extent && extent.w > 0 && extent.h > 0 ? extent : null, preferredScale);

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
  const scaleN = sheetScale(sheet, { w: extent.w, h: extent.h }, preferredScale);
  const pxPerM = pxPerMm * (1000 / scaleN);
  const cx = areaX + areaW / 2;
  const cy = areaY + areaH / 2;

  sctx.save();
  sctx.beginPath();
  sctx.rect(areaX, areaY, areaW, areaH);
  sctx.clip();

  if (view.kind === "plan" || view.kind === "callout") {
    const midX = (extent.minX + extent.maxX) / 2;
    const midY = (extent.minY + extent.maxY) / 2;
    const project = (x, y) => [cx + (x - midX) * pxPerM, cy + (y - midY) * pxPerM];
    const onSheetLevel = (obj) => !planLevel || !obj?.level || obj.level === planLevel;
    if (view.kind === "plan") drawSheetSite(sctx, project, store.doc.site);
    for (const form of forms || []) {
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
    for (const form of forms || []) {
      const kind = (form.kind || "").toLowerCase();
      if (kind === "window" || kind === "opening") drawSheetOpening(sctx, project, pxPerM, form, payload.walls);
    }
    // Lines are not compiled (model.js LINE_KINDS): drawn from the document,
    // and only the storey this sheet is set to.
    for (const line of (store.doc.lines || []).filter(onSheetLevel)) {
      if (line.kind !== "model") continue;
      const a = project(line.x1, line.y1);
      const b = project(line.x2, line.y2);
      sctx.beginPath();
      sctx.moveTo(a[0], a[1]);
      sctx.lineTo(b[0], b[1]);
      sctx.strokeStyle = "#1a1612";
      sctx.lineWidth = 1;
      sctx.setLineDash([]);
      sctx.stroke();
    }
    for (const line of (store.doc.separations || []).filter(onSheetLevel)) {
      const a = project(line.x1, line.y1);
      const b = project(line.x2, line.y2);
      sctx.beginPath();
      sctx.moveTo(a[0], a[1]);
      sctx.lineTo(b[0], b[1]);
      sctx.strokeStyle = "#6a5a48";
      sctx.lineWidth = 1;
      sctx.setLineDash([2, 3]);
      sctx.stroke();
      sctx.setLineDash([]);
    }
    for (const region of (store.doc.regions || []).filter(onSheetLevel)) {
      const poly = shapePolygon(region.shape);
      if (poly.length < 3) continue;
      const look = regionConvention(region.convention);
      sctx.beginPath();
      poly.forEach(([x, y], i) => {
        const p = project(x, y);
        if (i === 0) sctx.moveTo(p[0], p[1]);
        else sctx.lineTo(p[0], p[1]);
      });
      sctx.closePath();
      if (look) {
        sctx.fillStyle = look.fill;
        sctx.fill();
        sctx.strokeStyle = look.stroke;
      } else {
        sctx.strokeStyle = "#8a7d6c";
      }
      sctx.lineWidth = 1;
      sctx.stroke();
    }
    for (const room of payload.rooms || []) {
      if (planLevel && room.level !== planLevel) continue;
      if (!room.centroid) continue;
      const [tx, ty] = project(room.centroid[0], room.centroid[1]);
      sctx.textAlign = "center";
      sctx.textBaseline = "alphabetic";
      sctx.font = `600 ${Math.max(9, Math.min(14, pxPerM * 0.22))}px "Source Sans 3", sans-serif`;
      sctx.fillStyle = "#1a1612";
      sctx.fillText(room.name || "Room", tx, ty - 10);
      sctx.font = `${Math.max(8, Math.min(12, pxPerM * 0.18))}px "Source Sans 3", sans-serif`;
      sctx.fillStyle = "#5c5348";
      const useLabel = room.use && room.use !== "other" ? roomUse(room.use).label : "Use not set";
      sctx.fillText(useLabel, tx, ty + 2);
      const areaText = Number.isFinite(room.area) ? `${room.area.toFixed(1)} m²` : "";
      if (areaText) sctx.fillText(areaText, tx, ty + 14);
    }
    if (view.kind === "plan") {
      for (const line of planDimensionLines(sheetDimensionBoxes(store.doc, forms || []))) {
        drawSheetDimension(sctx, project, line);
      }
    }
    for (const dim of (store.doc.dimensions || []).filter(onSheetLevel)) {
      const len = Math.hypot(dim.x2 - dim.x1, dim.y2 - dim.y1);
      drawSheetDimension(sctx, project, {
        x1: dim.x1, y1: dim.y1, x2: dim.x2, y2: dim.y2,
        kind: "h", extFrom: [], label: `${formatLengthMm(len)} mm`,
      });
    }
    // Revision clouds linked to this sheet, and only this storey.
    for (const cloud of revisionCloudsForSheet(store.doc, sheet.id).filter(onSheetLevel)) {
      sctx.strokeStyle = "#b2451e";
      sctx.lineWidth = 1.2;
      for (const arc of cloudArcs(cloud.rect)) {
        const [ax, ay] = project(arc.cx, arc.cy);
        sctx.beginPath();
        sctx.arc(ax, ay, arc.r * pxPerM, arc.startAngle, arc.endAngle);
        sctx.stroke();
      }
      const [tx, ty] = project(cloud.rect.maxX, cloud.rect.minY);
      sctx.font = `600 ${Math.max(9, pxPerM * 0.12)}px "Source Sans 3", sans-serif`;
      sctx.fillStyle = "#b2451e";
      sctx.fillText(cloud.rev || "?", tx + 3, ty - 3);
    }
    drawSheetNorthAndScale(sctx, areaX, areaY, areaH, pxPerM, scaleN);
  } else if (sectionGeom || elevationGeom) {
    // Same faces (and, for a section, the same poché) the interactive
    // Section/Elevation (massing.js) views draw, projected orthographically
    // at the sheet's own scale instead of the camera's pan/zoom - a drafted
    // view, not a screenshot of the 3D one. An elevation's faces never carry
    // `face.cut` (facesFromPayload() is never clipped for one - see
    // elevationGeometry()), so the hatch call below stays a no-op for it,
    // exactly as it already is for every non-cut face of a section.
    const cut = section ? section.cut : elevation.cut;
    const geom = sectionGeom || elevationGeom;
    const midU = (geom.extent.minU + geom.extent.maxU) / 2;
    const midV = (geom.extent.minV + geom.extent.maxV) / 2;
    const projected = geom.cutFaces.map((face) => {
      const pts = face.pts.map((p) => {
        const [u, v, depth] = sectionUV(p, cut);
        return [cx + (u - midU) * pxPerM, cy - (v - midV) * pxPerM, depth];
      });
      const depth = pts.reduce((sum, p) => sum + p[2], 0) / pts.length;
      return { face, pts, depth };
    });
    projected.sort((a, b) => massingLayer(a.face) - massingLayer(b.face) || b.depth - a.depth);
    for (const item of projected) {
      const style = faceStyle(item.face);
      sctx.beginPath();
      item.pts.forEach((p, i) => (i === 0 ? sctx.moveTo(p[0], p[1]) : sctx.lineTo(p[0], p[1])));
      sctx.closePath();
      sctx.fillStyle = style.fill;
      sctx.strokeStyle = style.stroke;
      sctx.lineWidth = item.face.cut ? 1.1 : 0.6;
      sctx.fill();
      if (item.face.cut) hatchPolygon(sctx, item.pts, style.stroke);
      strokeFaceEdges(sctx, item.pts, item.face);
    }
    const projectUV = (u, v) => [cx + (u - midU) * pxPerM, cy - (v - midV) * pxPerM];
    for (const cloud of revisionCloudsForSheet(store.doc, sheet.id)) {
      const [z0, z1] = storeyBand(cloud.level);
      const box = revisionCloudViewBox(cloud.rect, cut, z0, z1);
      if (!box) continue;
      const flipped = { minX: box.minU, minY: -box.maxV, maxX: box.maxU, maxY: -box.minV };
      sctx.strokeStyle = "#b2451e";
      sctx.lineWidth = 1.2;
      for (const arc of cloudArcs(flipped)) {
        const [sx, sy] = projectUV(arc.cx, -arc.cy);
        sctx.beginPath();
        sctx.arc(sx, sy, Math.max(1.5, arc.r * pxPerM), arc.startAngle, arc.endAngle);
        sctx.stroke();
      }
      const [tx, ty] = projectUV(box.maxU, box.maxV);
      sctx.font = `600 ${Math.max(9, pxPerM * 0.12)}px "Source Sans 3", sans-serif`;
      sctx.fillStyle = "#b2451e";
      sctx.fillText(cloud.rev || "?", tx + 3, ty - 3);
    }
  }
  sctx.restore();
}

/**
 * Everything the section branch of `drawActiveSheet()` needs from one
 * section: its clipped, extruded faces and their u/v bounding box. Kept as
 * its own function so the scale-row calculation above and the drawing loop
 * below read the same numbers rather than deriving the box twice.
 */
/** Vertical band a plan cloud occupies on a section or elevation: this storey
 * up to the next one, or one wall-height when this is the top storey. */
function storeyBand(levelId) {
  const z0 = levelElevation(pack, levelId);
  const above = (pack.levels || [])
    .map((l) => levelElevation(pack, l.id))
    .filter((z) => z > z0 + 0.05)
    .sort((a, b) => a - b)[0];
  return [z0, above ?? z0 + (pack.system?.wallHeight || 2.7)];
}

function sectionCutGeometry(section) {
  const payload = compile(store.doc, pack) || { sketchForms: [] };
  const faces = facesFromPayload(payload, "both");
  const cutFaces = clipFacesForSection(faces, section.cut);
  if (!cutFaces.length) return null;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const face of cutFaces) {
    for (const p of face.pts) {
      const [u, v] = sectionUV(p, section.cut);
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
  }
  return {
    cutFaces,
    extent: { minU, maxU, minV, maxV, w: Math.max(maxU - minU, 0.5), h: Math.max(maxV - minV, 0.5) },
  };
}

/**
 * The elevation equivalent of `sectionCutGeometry()` above, minus the clip:
 * an elevation is viewed from outside the whole model, so every extruded
 * face is in view rather than a subset a cut plane selected.
 */
function elevationGeometry(elevation) {
  const payload = compile(store.doc, pack) || { sketchForms: [] };
  const cutFaces = facesFromPayload(payload, "both");
  if (!cutFaces.length) return null;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const face of cutFaces) {
    for (const p of face.pts) {
      const [u, v] = sectionUV(p, elevation.cut);
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
  }
  return {
    cutFaces,
    extent: { minU, maxU, minV, maxV, w: Math.max(maxU - minU, 0.5), h: Math.max(maxV - minV, 0.5) },
  };
}

function wireSheets() {
  el.sheetClose?.addEventListener("click", closeSheets);
  el.sheetOverlay?.addEventListener("click", (event) => {
    if (event.target === el.sheetOverlay) closeSheets();
  });
  el.sheetAdd?.addEventListener("click", () => {
    const { sheet } = createSheet(store.doc, { size: "A1", level: activeLevel });
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
  el.sheetView?.addEventListener("change", () => {
    const sheet = activeSheet();
    if (!sheet) return;
    const value = el.sheetView.value;
    let view = { kind: "plan" };
    if (value !== "plan") {
      // The option's own value is a bare section/elevation/callout id, not
      // a "kind:id" pair, so which union member it picks is whichever list
      // actually contains it - the same lookup `sheetView()` already does
      // to fall back safely when a referenced view has been deleted.
      if (sectionById(store.doc, value)) view = { kind: "section", sectionId: value };
      else if (elevationById(store.doc, value)) view = { kind: "elevation", elevationId: value };
      else if (calloutById(store.doc, value)) view = { kind: "callout", calloutId: value };
    }
    setSheetView(sheet, view);
    store.persist();
    renderSheetList();
    renderSheetFields();
    drawActiveSheet();
  });
  el.sheetLevel?.addEventListener("change", () => {
    const sheet = activeSheet();
    if (!sheet) return;
    sheet.planLevel = el.sheetLevel.value || null;
    store.persist();
    drawActiveSheet();
  });
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

// --- project information ---------------------------------------------------
//
// Document > Project > Project information. The job number and client name
// are doc-wide facts (one job has one job number), unlike a sheet's
// drawn-by/checked-by/date, which vary sheet to sheet - see sheets.js's
// header comment. This panel is the only place either is edited; every
// sheet's title block just reads `doc.projectInfo` back through
// `titleBlockFields()`.

function openProjectInfo() {
  if (!el.projectInfoOverlay) return;
  const info = store.doc.projectInfo || { jobNumber: null, clientName: null };
  el.projectInfoJobNumber.value = info.jobNumber || "";
  el.projectInfoClientName.value = info.clientName || "";
  el.projectInfoOverlay.hidden = false;
}

function closeProjectInfo() {
  if (el.projectInfoOverlay) el.projectInfoOverlay.hidden = true;
}

function wireProjectInfo() {
  el.projectInfoClose?.addEventListener("click", closeProjectInfo);
  el.projectInfoOverlay?.addEventListener("click", (event) => {
    if (event.target === el.projectInfoOverlay) closeProjectInfo();
  });
  const field = (input, key) => {
    input?.addEventListener("change", () => {
      if (!store.doc.projectInfo) store.doc.projectInfo = { jobNumber: null, clientName: null };
      const value = input.value.trim();
      store.doc.projectInfo[key] = value || null;
      store.persist();
      // The title block is the only other reader of this record; refresh it
      // only if the Sheets panel happens to be open already.
      if (el.sheetOverlay && !el.sheetOverlay.hidden) drawActiveSheet();
    });
  };
  field(el.projectInfoJobNumber, "jobNumber");
  field(el.projectInfoClientName, "clientName");
}

function openCheck() {
  if (el.checkOverlay) el.checkOverlay.hidden = false;
  renderRulesReport();
  renderFoundationReport();
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

// Multi-page plan sets. The active level's sheet is mirrored into
// `store.doc.underlay`, so everything below that reads it keeps working.
const sheetUi = createSheetUi({
  doc: () => store.doc,
  levels: () => visibleLevels().filter((l) => !/foundation/i.test(`${l.id} ${l.name ?? ""}`)),
  activeLevel: () => activeLevel,
  mount: el.canvasWrap,
  underlayPanel: el.modeSheet,
  underlay: {
    openPdf, renderThumbnail, discardPendingPdf, commitPendingPdf, adoptSheetSet, ensureSheetBitmap, isPageBitmapReady,
    attachSourceFile, dropSourceFile, isSourceOpen, sourcesNeedingFile,
    chooseSheet, hasOpenPdf, sheetSetNeedsPdf, renderReferencePage, setSharpListener,
    ensurePageLinework, snapReferencePixel,
  },
  pdfSnap: {
    enabled: () => snapToPdf,
    setEnabled: (on) => setSnapToPdf(on),
    available: () => pdfSnapAvailable(),
    status: () => {
      const index = store.doc.underlay?.sheetPage;
      return Number.isInteger(index) ? pageLineworkStatus(index) : "idle";
    },
    stats: () => {
      const index = store.doc.underlay?.sheetPage;
      return Number.isInteger(index) ? pageLinework(index)?.stats ?? null : null;
    },
  },
  setStatus: (text, tone) => setStatusMessage(text, tone),
  // Returns the new file id, null when the store failed (a warning is already
  // showing), and undefined when there is nothing open to store.
  loadingName: () => (isPdfRestorePending()
    ? (restoringName || store.doc?.sheetSet?.sources?.[0]?.name || store.doc?.underlay?.name || "plan file")
    : null),
  // Stores one source's file on the job. A file the job already holds (same
  // bytes) is pointed at, not sent again.
  rememberPdf: async (sourceId, onProgress) => {
    const bytes = sessionPdfBytes(sourceId);
    if (!bytes || !openProject?.id || !store.doc?.sheetSet?.sources?.some((s) => s.id === sourceId)) return undefined;
    try {
      const sha256 = await sha256Hex(bytes);
      let asset = null;
      if (sha256) {
        try {
          asset = await cloud.findUnderlay(openProject.id, sha256, "application/pdf");
        } catch {
          asset = null; // Not asked, not an error: the upload below says what is wrong.
        }
      }
      if (asset) onProgress?.(100);
      else asset = await cloud.saveUnderlay(openProject.id, bytes, "application/pdf", { onProgress });
      const source = store.doc?.sheetSet?.sources?.find((s) => s.id === sourceId);
      if (!asset?.id || !source) return null;
      source.assetId = asset.id;
      if (sha256) source.sha256 = sha256;
      mirrorLegacySource(store.doc.sheetSet);
      return asset.id;
    } catch (error) {
      const offline = error instanceof CloudError && error.status === 0;
      setStatusMessage(
        offline
          ? "No connection. The PDF is on screen, but a refresh will ask for the file again."
          : (error?.message || "The PDF is on screen, but it was not saved. A refresh will ask for the file again."),
        "warn",
      );
      return null;
    }
  },
  pushUndo: () => store.pushUndo(),
  changed: () => {
    store.persist();
    drawRibbon();
    render();
  },
  levelsChanged: () => {
    syncPackLevels();
    drawLevelSwitcher();
    store.persist();
    render();
  },
  addFloor: () => addFloor(),
  canAddFloor: () => canAddFloor(),
  goToLevel: (id) => {
    if (!id || id === activeLevel) return;
    const idx = houseStations.findIndex((s) => s.id === `${id}::floor`);
    if (idx >= 0) selectStationIndex(idx);
    else {
      activeLevel = id;
      drawLevelSwitcher();
    }
  },
  fitSheet: () => {
    if (tool === "align") return;
    fitUnderlayView();
  },
  onListVisible: () => drawRibbon(),
});

/** Zoom and centre the view on the placed sheet, however large - a 1:500 site plan is 400 m wide. */
function fitUnderlayView() {
  const corners = underlayCorners(store.doc);
  if (!corners || !el.canvas) return;
  const rect = el.canvas.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return;
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  cam.scale = Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, Math.min((rect.width - 48) / w, (rect.height - 48) / h)));
  cam.ox = rect.width / 2 - ((Math.min(...xs) + Math.max(...xs)) / 2) * cam.scale;
  cam.oy = rect.height / 2 - ((Math.min(...ys) + Math.max(...ys)) / 2) * cam.scale;
  render();
}
setSharpReady(() => render());
setShownSheetsReady(() => render());
setLineworkListener((_index, status) => {
  if (status === "loading") sheetUi.sync();
  else {
    // The read finishes with the pointer still, so snap again here. Otherwise
    // the first click lands on the raw cursor and only the next move snaps.
    refreshLiveSnap();
    render();
  }
});

/** Keep `doc.underlay` pointing at the active level's sheet and its bitmap rendered. */
function syncSheets() {
  const doc = store.doc;
    if (doc?.sheetSet) {
    if (activateSheetForLevel(doc, activeLevel)) drawRibbon();
    ensureSheetBitmap(doc)?.then((shown) => {
      if (shown) render();
    });
    if (snapToPdf && Number.isInteger(doc.underlay?.sheetPage)) requestPdfLinework(doc.underlay.sheetPage);
    syncAlignmentGhosts();
  }
  sheetUi.sync();
}

function openUnderlayPicker() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/pdf,image/*";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    // A PDF may be a whole plan set: choose pages, levels and scales first.
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
      sheetUi.importFile(file);
      return;
    }
    if (!(await sheetUi.confirmReplace())) return;
    setStatusMessage(`Reading ${file.name}…`, "ok");
    const result = await loadUnderlayFile(store.doc, file);
    setStatusMessage(result.message, result.ok ? "ok" : "warn");
    if (result.ok) {
      store.persist();
      drawRibbon();
      startCalibration();
      // On screen first; the file goes up behind it.
      sheetUi.trackUpload((onProgress) => rememberImageFile(file, onProgress));
    }
    render();
  });
  input.click();
}

let satelliteOpen = false;
let satelliteBusy = false;
let satelliteSuggestions = [];
let satelliteSuggestIndex = -1;
let satelliteSuggestFor = "";
let satelliteSuggestTimer = 0;
let satelliteSuggestAbort = null;
const SATELLITE_HINT = el.satelliteHint?.textContent ?? "";

function openSatellitePanel() {
  cancelCalibration();
  underlaySelected = false;
  satelliteOpen = true;
  if (el.satelliteHint) el.satelliteHint.textContent = SATELLITE_HINT;
  render();
  el.satelliteQuery?.focus();
  el.satelliteQuery?.select();
}

function closeSatellitePanel() {
  if (satelliteBusy) return;
  satelliteOpen = false;
  clearSatelliteSuggestions();
  render();
}

function syncSatellitePanel() {
  if (!el.satellitePanel) return;
  el.satellitePanel.hidden = !satelliteOpen;
  if (el.satelliteConfirm) {
    el.satelliteConfirm.disabled = satelliteBusy;
    el.satelliteConfirm.textContent = satelliteBusy ? "Loading…" : "Load";
  }
}

function clearSatelliteSuggestions() {
  satelliteSuggestAbort?.abort();
  satelliteSuggestAbort = null;
  clearTimeout(satelliteSuggestTimer);
  satelliteSuggestions = [];
  satelliteSuggestIndex = -1;
  satelliteSuggestFor = "";
  if (!el.satelliteSuggest) return;
  el.satelliteSuggest.hidden = true;
  el.satelliteSuggest.replaceChildren();
  el.satelliteQuery?.setAttribute("aria-expanded", "false");
}

function paintSatelliteSuggestion() {
  const buttons = el.satelliteSuggest?.querySelectorAll("button") ?? [];
  buttons.forEach((button, i) => {
    button.setAttribute("aria-selected", i === satelliteSuggestIndex ? "true" : "false");
  });
}

function showSatelliteSuggestions(items, query) {
  const list = el.satelliteSuggest;
  if (!list) return;
  satelliteSuggestions = items;
  satelliteSuggestFor = query;
  satelliteSuggestIndex = items.length ? 0 : -1;
  list.replaceChildren();
  if (!items.length) {
    list.hidden = true;
    el.satelliteQuery?.setAttribute("aria-expanded", "false");
    return;
  }
  items.forEach((item, i) => {
    const li = document.createElement("li");
    li.setAttribute("role", "presentation");
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "option");
    button.textContent = item.label;
    button.setAttribute("aria-selected", i === satelliteSuggestIndex ? "true" : "false");
    button.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      pickSatelliteSuggestion(i);
    });
    li.appendChild(button);
    list.appendChild(li);
  });
  list.hidden = false;
  el.satelliteQuery?.setAttribute("aria-expanded", "true");
}

function scheduleSatelliteSuggestions() {
  const query = el.satelliteQuery?.value ?? "";
  satelliteSuggestAbort?.abort();
  clearTimeout(satelliteSuggestTimer);
  satelliteSuggestions = [];
  satelliteSuggestIndex = -1;
  satelliteSuggestFor = "";
  if (el.satelliteSuggest) {
    el.satelliteSuggest.hidden = true;
    el.satelliteSuggest.replaceChildren();
  }
  el.satelliteQuery?.setAttribute("aria-expanded", "false");
  if (query.trim().length < 3) return;
  satelliteSuggestTimer = setTimeout(() => {
    refreshSatelliteSuggestions(query);
  }, 300);
}

async function refreshSatelliteSuggestions(query) {
  const abort = new AbortController();
  satelliteSuggestAbort = abort;
  try {
    const items = await suggestAddresses(query, { signal: abort.signal });
    if (abort.signal.aborted || el.satelliteQuery?.value !== query) return;
    showSatelliteSuggestions(items, query);
  } catch (err) {
    if (err?.name === "AbortError") return;
    if (el.satelliteQuery?.value === query) clearSatelliteSuggestions();
  }
}

async function pickSatelliteSuggestion(index) {
  const item = satelliteSuggestions[index];
  if (!item || satelliteBusy) return;
  if (el.satelliteQuery) el.satelliteQuery.value = item.label;
  clearSatelliteSuggestions();
  await commitSatellite(item);
}

async function commitSatellite(place) {
  if (satelliteBusy) return;
  const query = el.satelliteQuery?.value ?? "";
  const rect = el.canvasWrap.getBoundingClientRect();
  const [cx, cy] = screenToWorld(rect.width / 2, rect.height / 2);
  satelliteBusy = true;
  syncSatellitePanel();
  clearSatelliteSuggestions();
  let known = place && Number.isFinite(place.lat) && Number.isFinite(place.lng) ? place : null;
  if (place && !known) {
    setStatusMessage("Looking up that address…", "ok");
    const located = await locateSuggestion(place);
    if (!located.ok) {
      satelliteBusy = false;
      syncSatellitePanel();
      setStatusMessage(located.message, "warn");
      if (el.satelliteHint) el.satelliteHint.textContent = located.message;
      render();
      return;
    }
    known = located;
  }
  setStatusMessage("Fetching the satellite view…", "ok");
  const result = await loadSatelliteUnderlay(store.doc, query, { x: cx, y: cy }, undefined, known);
  satelliteBusy = false;
  setStatusMessage(result.message, result.ok ? "ok" : "warn");
  if (result.ok) {
    satelliteOpen = false;
    store.persist();
    drawRibbon();
  } else if (el.satelliteHint) {
    el.satelliteHint.textContent = result.message;
  }
  render();
}

/** Which stored file a reload is already fetching, so a redraw does not start another. */
let underlayFetchFor = null;
let underlayFetchToken = 0;

/**
 * A reopened drawing names the plan file but does not carry its bytes. Fetch
 * them once and open them the same way choosing the file would.
 */
function restoreStoredUnderlay() {
  const doc = store.doc;
  if (doc?.sheetSet) {
    restoreSheetSources();
    return;
  }
  const assetId = doc?.underlay?.assetId && !isSatelliteUnderlay(doc) ? doc.underlay.assetId : null;
  if (!assetId || !openProject?.id) return;
  if (underlayBitmap()) return;
  if (underlayFetchFor === assetId) return;
  underlayFetchFor = assetId;
  const token = ++underlayFetchToken;
  const projectId = openProject.id;
  setPdfRestorePending(true);
  refreshSheetChips();
  cloud.fetchAsset(assetId).then(async ({ bytes, mime }) => {
    if (token !== underlayFetchToken || openProject?.id !== projectId) return;
    const file = new File([bytes], doc.underlay?.name || "underlay", {
      type: mime || "application/octet-stream",
    });
    if (store.doc?.underlay?.assetId === assetId) {
      const result = await showStoredUnderlay(store.doc, file);
      if (token !== underlayFetchToken) return;
      if (!result.ok) setStatusMessage(result.message, "warn");
      else render();
    }
  }).catch((error) => {
    if (token !== underlayFetchToken) return;
    const offline = error instanceof CloudError && error.status === 0;
    if (offline) underlayFetchFor = null;
    setStatusMessage(
      offline
        ? "No connection. The plan file will load when you are back online, or choose it from disk."
        : "The plan file could not be loaded. Choose it from disk.",
      "warn",
    );
  }).finally(() => {
    if (token === underlayFetchToken) {
      setPdfRestorePending(false);
      refreshSheetChips();
    }
  });
}

/** Sources whose stored file this session has already tried to fetch (and failed, or is fetching): `project:source:asset`. */
const sourceFetchTried = new Set();
let sheetRestoring = false;
let restoringName = null;

/** The next file of the sheet set that is named on the job but not open here. */
function nextRestorableSource() {
  if (!store.doc?.sheetSet || !openProject?.id) return null;
  return sourcesNeedingFile(store.doc).find((s) => s.assetId && !sourceFetchTried.has(`${openProject.id}:${s.id}:${s.assetId}`)) || null;
}

/**
 * Fetch every file of the sheet set that is stored on the job, one after
 * another (each opens through the single import slot). A file that does not
 * match its sheets, or fails to load, is left for the user to choose from
 * disk; the others still open.
 */
function restoreSheetSources() {
  if (sheetRestoring || !nextRestorableSource()) return;
  sheetRestoring = true;
  const token = ++underlayFetchToken;
  const projectId = openProject.id;
  setPdfRestorePending(true);
  (async () => {
    try {
      for (let source = nextRestorableSource(); source; source = nextRestorableSource()) {
        const key = `${projectId}:${source.id}:${source.assetId}`;
        sourceFetchTried.add(key);
        restoringName = source.name;
        refreshSheetChips();
        const sourceId = source.id;
        const assetId = source.assetId;
        let fetched;
        try {
          fetched = await cloud.fetchAsset(assetId);
        } catch (error) {
          if (token !== underlayFetchToken) return;
          const offline = error instanceof CloudError && error.status === 0;
          if (offline) sourceFetchTried.delete(key);
          setStatusMessage(
            offline
              ? "No connection. The plan files will load when you are back online, or choose them from disk."
              : `${source.name} could not be loaded. Choose it from disk.`,
            "warn",
          );
          if (offline) return;
          continue;
        }
        if (token !== underlayFetchToken || openProject?.id !== projectId) return;
        const current = store.doc?.sheetSet?.sources?.find((s) => s.id === sourceId);
        if (!current || current.assetId !== assetId) continue;
        const file = new File([fetched.bytes], current.name, { type: fetched.mime || "application/pdf" });
        const result = await openPdf(file);
        if (token !== underlayFetchToken) {
          discardPendingPdf();
          return;
        }
        if (!result.ok) {
          setStatusMessage(result.message, "warn");
          continue;
        }
        if (!sameSheetGeometry(pagesOfSource(store.doc.sheetSet, sourceId), result.pages)) {
          discardPendingPdf();
          setStatusMessage(`The stored ${current.name} does not match its sheets on this drawing. Choose the original file.`, "warn");
          continue;
        }
        attachSourceFile(store.doc, sourceId, activeLevel);
        ensureSheetBitmap(store.doc)?.then((shown) => { if (shown) render(); });
        setStatusMessage(`${current.name} loaded.`, "ok");
        render();
      }
    } finally {
      sheetRestoring = false;
      restoringName = null;
      if (token === underlayFetchToken) {
        setPdfRestorePending(false);
        refreshSheetChips();
      }
    }
  })();
}

/** The status chips read module state; nudge them when that state changes outside a render. */
function refreshSheetChips() {
  try {
    sheetUi.sync();
  } catch {
    // Called before the sheet UI exists (very early in start-up); the first render syncs it.
  }
}

/** SHA-256 of some bytes as hex, or null where the browser has no crypto (an insecure origin). */
async function sha256Hex(bytes) {
  try {
    if (!globalThis.crypto?.subtle) return null;
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/** Store an image underlay on the job before the placement is saved. */
async function rememberImageFile(file, onProgress) {
  if (!openProject?.id || !store.doc?.underlay || store.doc.sheetSet || isSatelliteUnderlay(store.doc)) return undefined;
  try {
    const asset = await cloud.saveUnderlay(
      openProject.id,
      await file.arrayBuffer(),
      file.type || "application/octet-stream",
      { onProgress },
    );
    if (asset?.id && store.doc?.underlay && !store.doc.sheetSet) {
      store.doc.underlay.assetId = asset.id;
      underlayFetchFor = asset.id;
      return asset.id;
    }
    return undefined;
  } catch (error) {
    const offline = error instanceof CloudError && error.status === 0;
    setStatusMessage(
      offline
        ? "No connection. The image is on screen, but a refresh will ask for the file again."
        : (error?.message || "The image is on screen, but it was not saved. A refresh will ask for the file again."),
      "warn",
    );
    return null;
  }
}

/** A reopened drawing carries the satellite placement but not its pixels; fetch them once. */
function restoreSatelliteBitmap() {
  const pending = restoreSatelliteUnderlay(store.doc);
  if (!pending) return;
  pending.then((outcome) => {
    if (outcome === "shown") {
      drawRibbon();
      render();
    } else if (outcome === "failed") {
      setStatusMessage("Could not download the saved satellite view. Check the connection, then remove it and load it again.", "warn");
    }
  });
}

/** "{sheet} · {floor} · 1:{scale} · scale checked" at the sheet's own top-left corner, kept on screen when zoomed in. */
function drawSheetCaption(rect) {
  const set = store.doc.sheetSet;
  const page = set?.pages.find((p) => p.index === store.doc.underlay?.sheetPage);
  if (!page || !isPlanPage(page) || page.suppressed) return;
  const corners = underlayCorners(store.doc);
  if (!corners?.length) return;
  const floor = visibleLevels().find((l) => l.id === page.levelId)?.name || page.levelId || "no floor";
  const text = `${page.label} · ${floor} · 1:${page.printedScale} · ${page.verified ? "scale checked" : "scale not checked"}`;
  ctx.save();
  ctx.font = "11px Source Sans 3, sans-serif";
  const pad = 5;
  const width = ctx.measureText(text).width + pad * 2;
  const top = corners.reduce((a, c) => (c.y < a.y || (c.y === a.y && c.x < a.x) ? c : a), corners[0]);
  const [sx, sy] = worldToScreen(top.x, top.y);
  const x = Math.min(Math.max(sx, 6), Math.max(6, rect.width - width - 6));
  const y = Math.min(Math.max(sy, 6), Math.max(6, rect.height - 40));
  ctx.fillStyle = "rgba(244, 237, 225, 0.92)";
  ctx.fillRect(x, y, width, 18);
  ctx.strokeStyle = page.verified ? "#3a6b4a" : "#9a6b1f";
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, 17);
  ctx.fillStyle = "#222";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + pad, y + 9);
  ctx.restore();
}

function drawSatelliteAttribution(rect) {
  ctx.save();
  ctx.font = "10px Source Sans 3, sans-serif";
  const pad = 4;
  const width = ctx.measureText(SATELLITE_ATTRIBUTION).width + pad * 2;
  const x = rect.width - width - 6;
  const y = rect.height - 22;
  ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
  ctx.fillRect(x, y, width, 16);
  ctx.fillStyle = "#333";
  ctx.textBaseline = "middle";
  ctx.fillText(SATELLITE_ATTRIBUTION, x + pad, y + 8);
  ctx.restore();
}

function startCalibration() {
  if (!store.doc.underlay) {
    setStatusMessage("Load an underlay first.", "warn");
    return;
  }
  // Pressed again while lit: nothing to keep from a half-made measurement.
  if (tool === "calibrate") {
    cancelUnderlayMode();
    return;
  }
  leaveUnderlayMode("scale");
  if (isUnderlayHidden(store.doc)) {
    setUnderlayHidden(store.doc, false);
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

function startAlignFloors() {
  if (!Number.isInteger(store.doc.underlay?.sheetPage)) {
    setStatusMessage("Show a sheet from an imported plan set first.", "warn");
    return;
  }
  // Pressed again while lit: the marks are the work, so this is Done, not Cancel.
  if (tool === "align") {
    doneUnderlayMode();
    return;
  }
  leaveUnderlayMode("align");
  if (isUnderlayHidden(store.doc)) setUnderlayHidden(store.doc, false);
  calibration = null;
  tool = "align";
  underlaySelected = false;
  store.clearSelection();
  syncToolButtons();
  drawRibbon();
  render();
}

/** The other sheets, drawn faintly, but only while aligning - that is when the overlay is the point. */
function syncAlignmentGhosts() {
  const set = store.doc.sheetSet;
  const current = store.doc.underlay?.sheetPage;
  if (tool !== "align" || !set || !Number.isInteger(current)) {
    setGhostSheets([]);
    return;
  }
  const indexes = alignablePages(set, current).filter((p) => p.index !== current).map((p) => p.index);
  setGhostSheets(indexes, () => render());
}

function placeAlignmentPoint(wx, wy) {
  store.pushUndo();
  const result = markAlignmentPoint(store.doc, wx, wy, visibleLevels().map((l) => l.id));
  store.persist();
  syncToolButtons();
  drawRibbon();
  if (!result.ok) setStatusMessage(result.message, "warn");
  else if (!result.moved.length) {
    const waiting = (store.doc.sheetSet?.pages || []).filter((p) => isPlanPage(p) && !p.anchor);
    setStatusMessage(waiting.length
      ? `Marked on ${result.page.label}. Switch to ${waiting[0].label} and click the same point there.`
      : `Marked on ${result.page.label}.`, "ok");
  } else {
    const movedLabels = result.moved.map((i) => store.doc.sheetSet.pages.find((p) => p.index === i)?.label).filter(Boolean);
    const beneath = movedLabels.length === 1 ? "The other sheet shows faintly beneath." : "The other sheets show faintly beneath.";
    setStatusMessage(`Aligned: ${movedLabels.join(", ")} moved onto ${result.datum.label}. ${beneath}`, "ok");
  }
  render();
}

/** The alignment marks of the showing sheet and of the datum beneath it. */
function drawAlignmentMarks() {
  const set = store.doc.sheetSet;
  if (!set || !underlayIsVisible()) return;
  const showing = set.pages.find((p) => p.index === store.doc.underlay?.sheetPage);
  const ghosts = new Set(ghostSheetIndexes());
  for (const page of set.pages) {
    if (page !== showing && !ghosts.has(page.index)) continue;
    const w = alignmentPointWorld(page);
    if (!w) continue;
    const [sx, sy] = worldToScreen(w.x, w.y);
    ctx.save();
    ctx.strokeStyle = page === showing ? "#b2451e" : "rgba(178, 69, 30, 0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx - 9, sy);
    ctx.lineTo(sx + 9, sy);
    ctx.moveTo(sx, sy - 9);
    ctx.lineTo(sx, sy + 9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx, sy, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  if (tool === "align" && hoverPoint) {
    const [hx, hy] = worldToScreen(hoverPoint.x, hoverPoint.y);
    ctx.save();
    ctx.strokeStyle = "#b2451e";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hx - 14, hy);
    ctx.lineTo(hx + 14, hy);
    ctx.moveTo(hx, hy - 14);
    ctx.lineTo(hx, hy + 14);
    ctx.stroke();
    ctx.restore();
  }
}

function startUnderlayAdjust() {
  if (!store.doc.underlay) {
    setStatusMessage("Load an underlay first.", "warn");
    return;
  }
  if (isUnderlayHidden(store.doc)) {
    setStatusMessage("Show the underlay first.", "warn");
    return;
  }
  // Pressed again while lit: Done.
  if (currentUnderlayMode() === "adjust") {
    doneUnderlayMode();
    return;
  }
  leaveUnderlayMode("adjust");
  calibration = null;
  tool = "select";
  underlaySelected = true;
  store.clearSelection();
  syncToolButtons();
  drawRibbon();
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
  if (el.calibrateDistance) el.calibrateDistance.value = guess ? formatLengthMm(guess) : "";
  render();
}

function confirmCalibration() {
  if (!calibration?.a || !calibration?.b) return;
  const a = liveCalibrationPoint(calibration.a);
  const b = liveCalibrationPoint(calibration.b);
  const result = calibrate(store.doc, a, b, Number(el.calibrateDistance?.value) / 1000);
  setStatusMessage(result.message, result.ok ? "ok" : "warn");
  if (result.ok) {
    calibration = null;
    tool = "select";
    underlaySelected = false;
    sheetUi.afterCalibration();
    store.persist();
    syncToolButtons();
    drawRibbon();
  }
  render();
}

function cancelCalibration() {
  if (tool !== "calibrate") return;
  cancelUnderlayMode();
}

// --- site: property line, SG reference, building line ---------------------

function startPropertyLineDraw() {
  siteDraft = [];
  tool = "property";
  underlaySelected = false;
  store.clearSelection();
  syncToolButtons();
  drawRibbon();
  setStatusMessage("Click each corner of the property boundary, then click the first point again (or press Enter) to close it. Esc removes the last point.", "ok");
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
  setStatusMessage(`Building line set ${formatLengthMm(result.setback)} mm inside the property line.`, "ok");
  render();
}

/** What Remove would throw away, in the user's terms, for the confirmation. */
function describeUnderlayRemoval() {
  const doc = store.doc;
  const set = doc.sheetSet;
  if (!set) return { title: "Remove the underlay?", message: `${doc.underlay?.name || "The underlay"} comes off the plan. Your walls and the rest of the drawing are not affected.` };
  const placed = set.pages.filter((p) => p.placement);
  const parts = [`${placed.length} placed sheet${placed.length === 1 ? "" : "s"} and their level assignments`];
  const verified = placed.filter((p) => p.verified).length;
  if (verified) parts.push(`${verified} scale check${verified === 1 ? "" : "s"}`);
  const marks = placed.filter((p) => p.anchor).length;
  if (marks) parts.push(`${marks} alignment mark${marks === 1 ? "" : "s"}`);
  if (Object.keys(set.ceilingHeights || {}).length) parts.push("the floor-to-ceiling heights you typed");
  return {
    title: "Remove the whole plan set?",
    message: `This takes ${set.sources?.length > 1 ? `all ${set.sources.length} plan files` : (set.sources?.[0]?.name || set.pdfName)} off the plan, including ${parts.join(", ")}. Your walls and the rest of the drawing are not affected. To just get it out of the way, hide it instead.`,
  };
}

async function removeUnderlay() {
  const doc = store.doc;
  if (!doc.underlay && !doc.sheetSet) {
    setStatusMessage("Nothing to remove.", "warn");
    return;
  }
  leaveUnderlayMode(null);
  const { title, message } = describeUnderlayRemoval();
  const choice = await sheetUi.ask({
    title,
    message,
    choices: [
      { id: "cancel", label: "Cancel" },
      { id: "hide", label: "Hide instead", primary: true },
      { id: "remove", label: "Remove" },
    ],
  });
  if (choice === "hide") {
    if (store.doc.underlay && !isUnderlayHidden(store.doc)) toggleUnderlayVisibility();
    return;
  }
  if (choice !== "remove") return;

  const removed = stashUnderlay(store.doc);
  if (!removed) return;
  underlaySelected = false;
  calibration = null;
  if (tool === "calibrate" || tool === "align") tool = "select";
  setGhostSheets([]);
  store.persist();
  syncToolButtons();
  drawRibbon();
  render();
  sheetUi.toast(`${removed.name} removed.`, {
    actionLabel: "Undo",
    onAction: () => {
      if (!restoreStashedUnderlay(store.doc)) {
        setStatusMessage("Could not restore it: something else has been loaded since.", "warn");
        return;
      }
      store.persist();
      drawRibbon();
      render();
      setStatusMessage(`${removed.name} restored.`, "ok");
    },
  });
}

function toggleUnderlayVisibility() {
  if (!store.doc.underlay) {
    setStatusMessage("Load an underlay first.", "warn");
    return;
  }
  // Hiding the sheet ends any mode that needs to see it.
  if (!isUnderlayHidden(store.doc) && (tool === "calibrate" || tool === "align")) cancelUnderlayMode();
  toggleUnderlayHidden(store.doc);
  if (isUnderlayHidden(store.doc)) {
    underlaySelected = false;
  }
  store.persist();
  setStatusMessage(isUnderlayHidden(store.doc) ? "Underlay hidden." : "Underlay shown.", "ok");
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
  lineStart = null;
  wallDraft = null;
  shapeDraft = null;
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
      text: `On "${label}": base rises ${formatLengthMm(only.rise)} mm to ${formatLengthMm(only.elevation)} mm; height reduces to ${formatLengthMm(only.height)} mm.`,
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

/**
 * Grow a single selected object into every other object of its own kind
 * that shares its exact type category - "select all the foundations" means
 * category === "foundation", not the broader wall/foundation/boundarywall
 * group `catsForContext` uses to populate what a wall *could* retype into.
 * This is the "select all instances of this type" step that precedes a bulk
 * retype from the palette. Deliberately whole-drawing, not level-scoped: a
 * run of foundations usually spans the whole foundation level, and there is
 * no cost to over-selecting here - the retype that follows only touches
 * whichever category the clicked SKU actually matches.
 */
function runSelectSimilar() {
  if (store.selected.length !== 1) {
    setStatusMessage("Select one wall, foundation, beam, roof, floor, door, window or item first.", "warn");
    return;
  }
  const ref = store.primary;
  const obj = objByRef(ref);
  const category = obj ? skuById(obj.sku)?.category : null;
  if (!category) {
    setStatusMessage("That has no type category to match against.", "warn");
    return;
  }
  const pool = collectionFor(store.doc, ref.kind) || [];
  const matches = pool
    .filter((o) => skuById(o.sku)?.category === category)
    .map((o) => ({ kind: ref.kind, id: o.id }));
  if (matches.length <= 1) {
    setStatusMessage(`Nothing else of that type (${category}) in the drawing.`, "warn");
    return;
  }
  store.setSelection(matches, ref);
  setStatusMessage(`Selected ${matches.length} ${CATEGORY_LABEL[category] || category}. Pick a type from the palette to retype them all.`, "ok");
  // Open the palette straight to this category rather than leaving it on
  // whatever was last armed - the whole point of this command is "select
  // these, then click a new type," so the list should already show the
  // types that would apply.
  paletteFilter = [category];
  lastPaletteLabel = CATEGORY_LABEL[category] || category;
  setTypeFlyoutOpen(true);
  renderPalette();
  drawRibbon();
  render();
}

/** One line per selected wall/beam, for the Inspector's read-only Base row. */
function attachStateText(obj) {
  const base = resolvedBase(store.doc, pack, obj, drawnObjectHeight(pack, obj));
  const level = (pack.levels || []).find((l) => l.id === effectiveLevel(obj, pack));
  const levelLabel = level?.name || effectiveLevel(obj, pack) || "level";
  if (base.warning) return `Attached, but unresolved — falls back to ${levelLabel}. See Check.`;
  if (base.attachedTo) {
    return `On "${base.attachedTo.label}" at ${formatLengthMm(base.elevation)} mm, ${formatLengthMm(base.height)} mm high`;
  }
  return `Not attached — ${levelLabel} + ${formatLengthMm(obj.baseOffset || 0)} mm`;
}

/** Drawn foundations filed on a storey that is not the foundation storey.
 * The ribbon moves the cut when Foundations is armed; this is what remains
 * when a footing was drawn before that, or after the cut was switched back. */
function renderFoundationReport() {
  if (!el.foundationReport) return;
  const home = foundationStorey(pack.levels || []);
  if (!home) {
    el.foundationCount.textContent = "—";
    el.foundationReport.innerHTML = '<p class="hint">This template has no foundation storey, so a foundation stays on the plan it is drawn on.</p>';
    return;
  }
  const drawn = [];
  for (const seg of store.doc.segments || []) {
    const sku = skuById(seg.sku);
    if (sku?.category !== "foundation") continue;
    drawn.push({ id: seg.id, label: sku.name || seg.id, levelId: effectiveLevel(seg, pack) });
  }
  if (!drawn.length) {
    el.foundationCount.textContent = "None";
    el.foundationReport.innerHTML = '<p class="hint">No foundations drawn yet.</p>';
    return;
  }
  const rows = foundationsOffStorey(drawn, pack.levels || []);
  if (!rows.length) {
    el.foundationCount.textContent = "On the foundation storey";
    el.foundationReport.innerHTML = '<p class="hint">Every drawn foundation is on the foundation storey.</p>';
    return;
  }
  el.foundationCount.textContent = `${rows.length} on another storey`;
  el.foundationReport.innerHTML = rows.map((row) => `
    <div class="attach-row attach-broken">
      <span>${escapeHtml(row.message)}</span>
    </div>
  `).join("");
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
        : `on "${row.attachedTo.label}" — base ${formatLengthMm(row.elevation)} mm, ${formatLengthMm(row.height)} mm high`)}</span>
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
  el.healthDot.title = text;
  el.healthDot.hidden = false;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    el.healthLabel.textContent = "";
    el.healthDot.classList.add("ok");
    el.healthDot.hidden = true;
    drawPackHealth();
  }, 4000);
}

/** How many products the loaded template offers. Phrased for the person
 *  drawing, and kept out of the chrome: About is where it is stated. */
function drawPackHealth() {
  const count = pack?.skus?.length || 0;
  if (el.healthDot) {
    el.healthDot.title = count
      ? `${count} products in the template catalogue`
      : "No catalogue loaded";
  }
  if (el.aboutCatalogue) el.aboutCatalogue.textContent = count ? `${count} products` : "Not loaded";
}

/** The active density, for sighted users and for anything reading the pressed
 *  state. A class alone left assistive tech unable to report which is on. */
function drawDensityButtons() {
  document.querySelectorAll("[data-density]").forEach((b) => {
    const on = b.dataset.density === density;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

// --- toolbar -----------------------------------------------------------

function syncToolButtons() {
  document.querySelectorAll("[data-tool]").forEach((btn) => {
    btn.classList.toggle("active", !panMode && btn.dataset.tool === tool);
  });
  const pan = document.getElementById("v2-pan");
  if (pan) {
    pan.classList.toggle("active", panMode);
    pan.setAttribute("aria-pressed", panMode ? "true" : "false");
  }
}

function setPanMode(on) {
  const next = Boolean(on);
  if (next === panMode) return;
  panMode = next;
  syncToolButtons();
  if (el.canvas) el.canvas.style.cursor = panMode ? "grab" : "crosshair";
  updateRibbonHint();
}

function beginPan(ev) {
  drag = { kind: "pan", startX: ev.clientX, startY: ev.clientY, ox0: cam.ox, oy0: cam.oy };
  el.canvas.style.cursor = "grabbing";
  try { el.canvas.setPointerCapture(ev.pointerId); } catch { /* capture can fail if the pointer already ended */ }
}

// Drags that edit geometry already in the document mutate it live, off the
// speculative undo entry pushed on pointer-down. Cancelling one therefore
// means rolling that entry back, not just forgetting the drag.
const REVERTIBLE_DRAGS = new Set(["move", "segment-end", "shape-vertex", "shape-edge", "region-vertex", "region-edge", "region-move", "property-vertex", "property-move", "underlay-move", "underlay-scale", "underlay-rotate"]);

/**
 * Drop the in-progress click–click segment (or last property-line vertex)
 * without leaving the tool. Returns true when there was something to abort,
 * so Escape can stay in the wall/beam/roof tool the way Revit does.
 */
function abortClickDraft() {
  if (!hasClickDraft({
    wallDraft, shapeDraft, beamStart, lineStart, siteDraft, roomDraft, regionDraft, cameraDraft, sectionDraft, calloutDraft, revisionCloudDraft, measureDraft, calibration,
    serviceRoute, serviceConnect,
  })) return false;
  if (serviceRoute?.fromNodeId) finishServiceRoute();
  else if (serviceConnect?.nodeId) serviceConnect = null;
  else if (wallDraft) wallDraft = null;
  else if (shapeDraft) shapeDraft = null;
  else if (beamStart) beamStart = null;
  else if (lineStart) lineStart = null;
  else if (siteDraft?.length) siteDraft.pop();
  else if (roomDraft?.length) roomDraft.pop();
  else if (regionDraft?.length) regionDraft.pop();
  else if (cameraDraft?.a) cameraDraft = { a: null };
  else if (sectionDraft?.a) sectionDraft = { a: null };
  else if (calloutDraft?.a) calloutDraft = { a: null };
  else if (revisionCloudDraft?.a) revisionCloudDraft = { a: null };
  else if (measureDraft?.a) measureDraft = { a: null };
  else if (calibration?.a && !calibration.b) calibration.a = null;
  sizeDraft = null;
  snapGuide = null;
  return true;
}

/**
 * Escape: first drop the live click–click preview (keep the tool armed);
 * a second press leaves the tool, which is what the ribbon hints
 * ("Esc to stop") promise once there is no segment in flight.
 */
function cancelDrawing() {
  // A click waiting on the PDF index must not place a point after Escape.
  pdfSnapClickGate += 1;
  if (REVERTIBLE_DRAGS.has(drag?.kind)) {
    // undo() clears the selection; the user only cancelled a move, so put the
    // same objects back under the pointer.
    const selection = store.selected.slice();
    const primary = store.primary;
    store.undo();
    store.setSelection(selection, primary);
    drag = null;
    drawRibbon();
    render();
    return;
  }

  // Set scale and Align sheets: Escape leaves the mode and puts the sheets back.
  // (Adjust falls through: Escape there deselects the sheet and keeps the move.)
  const underlayMode = currentUnderlayMode();
  if (underlayMode === "scale" || underlayMode === "align") {
    cancelUnderlayMode();
    return;
  }

  if (abortClickDraft()) {
    drawRibbon();
    render();
    return;
  }

  // Nothing mid-flight? Escape is then about the current selection, not the
  // tool state - deselect whatever is selected instead of being a no-op.
  const wasDrawing = Boolean(
    drag || siteDraft || calibration || sgPick || attachPick
    || cameraDraft || sectionDraft || calloutDraft || revisionCloudDraft || measureDraft
    || (tool !== "select") || activeFunction
  );

  // Leaving a draw tool also drops the selection (typically the element just
  // drawn), so the sequence is draft -> tool+selection: two presses, not three.
  const leavingDrawTool = tool !== "select";

  drag = null;
  serviceRoute = null;
  serviceConnect = null;
  beamStart = null;
  lineStart = null;
  wallDraft = null;
  shapeDraft = null;
  sizeDraft = null;
  snapGuide = null;
  underlaySelected = false;
  propertySelected = false;
  propertyHover = null;
  calibration = null;
  siteDraft = null;
  roomDraft = null;
  regionDraft = null;
  sgPick = null;
  attachPick = null;
  cameraDraft = null;
  sectionDraft = null;
  calloutDraft = null;
  revisionCloudDraft = null;
  measureDraft = null;
  showDimensions = false;
  if (tool !== "select") {
    tool = "select";
    syncToolButtons();
  }
  if (activeFunction) {
    activeFunction = null;
    renderPalette();
  }
  if ((!wasDrawing || leavingDrawTool) && store.selected.length) {
    store.clearSelection();
  }
  drawRibbon();
  render();
}

function wireToolbar() {
  document.getElementById("v2-pan")?.addEventListener("click", () => setPanMode(!panMode));
  document.querySelectorAll("[data-tool]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setPanMode(false);
      tool = btn.dataset.tool;
      if (tool !== "select") placeSkuId = placeSkuId || defaultSkuFor(tool);
      else if (activeFunction) {
        // Stepping back to Select un-arms the draw tool so the next-step
        // hint does not keep pointing at it. The type list stays on the last
        // category so a selected wall can still be retyped.
        activeFunction = null;
        showDimensions = false;
        measureDraft = null;
        drawRibbon();
        renderPalette();
      }
      if (serviceRoute?.fromNodeId) finishServiceRoute({ select: false });
      serviceRoute = null;
      serviceConnect = null;
      beamStart = null;
      lineStart = null;
      wallDraft = null;
      shapeDraft = null;
      sizeDraft = null;
      siteDraft = null;
      roomDraft = null;
      regionDraft = null;
      sgPick = null;
      attachPick = null;
      cameraDraft = null;
      sectionDraft = null;
      calloutDraft = null;
      revisionCloudDraft = null;
      measureDraft = null;
      syncToolButtons();
      clearRouteIfLeavingServices();
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
      drawDensityButtons();
    });
  });
  el.hmRotate?.addEventListener("click", () => runCommand("rotate"));
  el.hmCopy?.addEventListener("click", () => runCommand(selectedDoor() ? "mirror" : "copy"));
  el.hmDelete?.addEventListener("click", () => runCommand("delete"));
  // Navigations, not ways of replacing what is on screen. Clear used to blank
  // the open job and keep its id; New mints a row of its own and leaves the
  // previous one exactly as it was.
  document.getElementById("v2-new").addEventListener("click", runNewJob);
  document.getElementById("v2-open").addEventListener("click", () => openLibrary());
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
    // Stepping onto the option buttons (they sit close to the wall's start)
    // leaves a stub shorter than a wall, which would switch the corner preview
    // off. Fall back to the last proper end so every option can be tried.
    if (wallDraft?.keep && segmentLength(wallDraft.x1, wallDraft.y1, wallDraft.x2, wallDraft.y2) < MIN_TRACE) {
      wallDraft.x2 = wallDraft.keep.x;
      wallDraft.y2 = wallDraft.keep.y;
    }
    const wasProp = propertyHover;
    propertyHover = null;
    if (wasProp || tool === "door" || tool === "window" || wallDraft || shapeDraft || beamStart || lineStart || (tool === "camera" && cameraDraft?.a) || (tool === "section" && sectionDraft?.a) || (tool === "callout" && calloutDraft?.a) || (tool === "revision" && revisionCloudDraft?.a) || (tool === "measure" && measureDraft?.a)) render();
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
  cam.scale = Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, cam.scale * factor));
  const [nx, ny] = worldToScreen(wx, wy);
  cam.ox += px - nx;
  cam.oy += py - ny;
  render();
}

let pdfSnapClickGate = 0;
let replayingPdfSnapClick = false;
const PDF_LINES_READING = "Reading PDF lines...";

/** Snap the still pointer once the page's corners and crossings exist. */
function refreshLiveSnap() {
  if (!hoverPoint || drag) return;
  if (tool === "calibrate") {
    if (!calibration?.b) {
      const p = applyPdfPick(hoverPoint.x, hoverPoint.y);
      hoverPoint = { x: p.x, y: p.y, kind: p.kind };
    }
    return;
  }
  if (tool === "align") {
    const p = applyPdfPick(hoverPoint.x, hoverPoint.y);
    hoverPoint = { x: p.x, y: p.y, kind: p.kind };
    return;
  }
  if (wallDraft) {
    const p = applySnap(hoverPoint.x, hoverPoint.y);
    wallDraft.x2 = p.x;
    wallDraft.y2 = p.y;
    if (sizeDraft?.lockW) setWallDraftLength(parseLengthInput(sizeDraft.typedW, wallDraftLength() || 1));
    if (segmentLength(wallDraft.x1, wallDraft.y1, wallDraft.x2, wallDraft.y2) >= MIN_TRACE) {
      wallDraft.keep = { x: wallDraft.x2, y: wallDraft.y2 };
    }
    return;
  }
  if (shapeDraft) {
    const p = applySnap(hoverPoint.x, hoverPoint.y);
    shapeDraft.rect = rectFromDrag(shapeDraft.x0, shapeDraft.y0, p.x, p.y);
    return;
  }
  if (snapPreviewTool() || beamStart || lineStart) applySnap(hoverPoint.x, hoverPoint.y);
}

function dismissStatus(text) {
  if (el.healthLabel?.textContent !== text) return;
  clearTimeout(statusTimer);
  el.healthLabel.textContent = "";
  el.healthDot.classList.add("ok");
  el.healthDot.hidden = true;
  drawPackHealth();
}

function onPointerDown(ev) {
  // Middle button and Alt-drag pan from any tool and leave the draft alone.
  // Pan mode is the same gesture on the left button, and it swallows the
  // click so a wall point or a selection window cannot start underneath.
  if (ev.button === 1 || ev.altKey || (panMode && ev.button === 0)) {
    beginPan(ev);
    return;
  }
  if (panMode) return;
  // The first point of a stroke used to miss: the click asked for a snap
  // before the page's lines had been read, and only the following move hit.
  // Hold this click until that read finishes, then place the snapped point.
  if (!replayingPdfSnapClick && clickSnapsToPdf() && pdfLineworkPending()) {
    const gate = ++pdfSnapClickGate;
    const toolAtClick = tool;
    setStatusMessage(PDF_LINES_READING, "ok");
    ensurePageLinework(store.doc.underlay.sheetPage).then(() => {
      if (gate !== pdfSnapClickGate || tool !== toolAtClick) {
        dismissStatus(PDF_LINES_READING);
        return;
      }
      dismissStatus(PDF_LINES_READING);
      replayingPdfSnapClick = true;
      try { onPointerDown(ev); }
      finally { replayingPdfSnapClick = false; }
    });
    return;
  }
  const [wx, wy] = pointerWorld(ev);
  hoverPoint = { x: wx, y: wy };

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

  // A selected property-line corner is the selection's own handle, same as a
  // wall end: it wins over a wall that happens to sit on that corner.
  if (tool === "select" && !attachPick && !ev.shiftKey && propertySelected) {
    const vertex = hitPropertyLine(propertyRing(), wx, wy, propertyHandleTol());
    if (vertex?.part === "vertex" && beginPropertyDrag(ev, wx, wy)) {
      render();
      return;
    }
  }

  // A floor finish region being edited (tiles, waterproofing): its own corners
  // and edges come first, since they usually sit right on the floor's.
  if (tool === "select" && !attachPick && beginFinishRegionDrag(ev, wx, wy)) {
    render();
    return;
  }

  // A room, floor or roof: a corner moves that corner. An edge follows Corner
  // or Line, the same as a finish. Shift uses the other for this drag. While
  // the covering finish is chosen, its own drag already consumed the press.
  if (tool === "select" && !attachPick && !editingCoveringFinish()) {
    const editable = editableShapeRef();
    if (!ev.shiftKey) selectedShapeVertex = null;
    if (editable) {
      const ring = editable.points;
      const vi = hitPolyVertexIndex(ring, wx, wy, shapeEditTol());
      if (vi != null) {
        store.pushUndo();
        // A rectangle has no stored corner yet. Remember it for Delete only
        // once the drag turns the shape into a polygon.
        if (editable.obj.shape?.kind === "poly") selectedShapeVertex = { ref: editable.ref, index: vi };
        drag = {
          kind: "shape-vertex",
          ref: editable.ref,
          index: vi,
          moved: false,
          origin: ring.map(([x, y]) => [x, y]),
          finishSnap: finishShapeSnapshot(editable.ref),
        };
        el.canvas.setPointerCapture(ev.pointerId);
        render();
        return;
      }
      const ei = hitPolyEdgeIndex(ring, wx, wy, propertyPickTol());
      // A door or window sits on this edge. The click belongs to the opening,
      // so the room edge is not reshaped out from under it.
      if (ei != null && !openingAt(wx, wy)) {
        store.pushUndo();
        const finishSnap = finishShapeSnapshot(editable.ref);
        let started = false;
        if (floorEdgeMoves(ev)) {
          drag = {
            kind: "shape-edge",
            ref: editable.ref,
            index: ei,
            grabX: wx,
            grabY: wy,
            origin: ring.map(([x, y]) => [x, y]),
            moved: false,
            finishSnap,
          };
          started = true;
        } else {
          const points = materializeShapePoly(editable);
          if (!points) store.undoStack.pop();
          else {
            const insertAt = ei + 1;
            points.splice(insertAt, 0, pointOnRingEdge(points, ei, wx, wy));
            selectedShapeVertex = { ref: editable.ref, index: insertAt };
            drag = {
              kind: "shape-vertex",
              ref: editable.ref,
              index: insertAt,
              moved: false,
              inserted: true,
              finishSnap,
            };
            started = true;
          }
        }
        if (started) {
          el.canvas.setPointerCapture(ev.pointerId);
          render();
          return;
        }
      }
    }
    // A press inside a region of the floor that is selected picks that region
    // for editing; the press itself still goes on to select or move the floor.
    // Shift stays a selection gesture, the same as inside a finish.
    if (!ev.shiftKey) pickFinishRegionAt(wx, wy);
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

  if (tool === "align") {
    const p = applyPdfPick(wx, wy);
    placeAlignmentPoint(p.x, p.y);
    return;
  }
  if (tool === "calibrate") {
    const p = applyPdfPick(wx, wy);
    if (!calibration.a) calibration.a = captureCalibrationPoint(p.x, p.y);
    else if (!calibration.b) {
      calibration.b = captureCalibrationPoint(p.x, p.y);
      promptCalibrationDistance();
      return;
    } else if (hitUnderlay(wx, wy) && !store.doc.underlay.pinned) {
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
    setStatusMessage(siteDraft.length >= 3
      ? "Click the green first point (or press Enter) to close the boundary. Esc removes the last point."
      : `Point ${siteDraft.length} placed. Keep clicking each corner (at least 3). Esc removes the last point.`, "ok");
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
  if (tool === "callout") {
    const p = applySnap(wx, wy);
    if (!calloutDraft?.a) {
      calloutDraft = { a: p };
      updateRibbonHint();
      render();
      return;
    }
    finishCalloutCrop(p);
    return;
  }
  if (tool === "revision") {
    const p = applySnap(wx, wy);
    if (!revisionCloudDraft?.a) {
      revisionCloudDraft = { a: p };
      updateRibbonHint();
      render();
      return;
    }
    finishRevisionCloud(p);
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
  // A route still being drawn keeps the click, so the next point can land
  // on a wall. Once the route is finished, Draw route / Connect / Add node
  // still treat a wall or floor click as Exit. Select does not: a drag has
  // to move the route, and that decision waits until the pointer comes up.
  if (!ev.shiftKey && !serviceRoute?.fromNodeId && tool !== "select" && leaveRouteForPlanClick(ev, wx, wy)) return;
  if (tool === "service-route") {
    underlaySelected = false;
    clickServicePoint(wx, wy);
    return;
  }
  if (tool === "service-connect") {
    underlaySelected = false;
    clickServiceConnect(wx, wy);
    return;
  }
  if (tool === "service-node") {
    underlaySelected = false;
    clickServiceNode(wx, wy);
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
  if (tool === "room") {
    underlaySelected = false;
    const p = applySnap(wx, wy);
    if (!roomDraft?.length) {
      if (placeRoomAt(p)) return;
      roomDraft = [p];
      setStatusMessage("Point 1 placed. Keep clicking each corner. Enter closes the room.", "ok");
      render();
      return;
    }
    const first = roomDraft[0];
    if (roomDraft.length >= 3 && Math.hypot(p.x - first.x, p.y - first.y) < 0.3) {
      finishRoomDraft();
      return;
    }
    roomDraft.push(p);
    setStatusMessage(`Point ${roomDraft.length} placed. Enter closes the room.`, "ok");
    render();
    return;
  }
  if (tool === "region") {
    underlaySelected = false;
    const p = applySnap(wx, wy);
    if (!regionDraft) regionDraft = [];
    const first = regionDraft[0];
    if (first && regionDraft.length >= 3 && Math.hypot(p.x - first.x, p.y - first.y) < 0.3) {
      finishRegionDraft();
      return;
    }
    regionDraft.push(p);
    setStatusMessage(regionDraft.length >= 3
      ? `Point ${regionDraft.length} placed. Enter closes the region, or click the first corner.`
      : `Point ${regionDraft.length} placed. Keep clicking each corner.`, "ok");
    render();
    return;
  }
  if (tool === "slab" || tool === "roof") {
    underlaySelected = false;
    clickShapeCorner(wx, wy);
    return;
  }
  if (tool === "wall") {
    underlaySelected = false;
    clickWallPoint(wx, wy);
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
  if (tool === "model-line" || tool === "annot-line" || tool === "separation") {
    underlaySelected = false;
    if (!lineStart) {
      lineStart = applySnap(wx, wy);
    } else {
      const end = applySnap(wx, wy);
      if (tool === "separation") commitSeparation(lineStart, end);
      else commitLine(tool === "annot-line" ? "annotation" : "model", lineStart, end);
      lineStart = null;
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

  // The route is already selected. A drag moves that route, even where a wall
  // or annotation shares the point. A press that does not move selects the
  // object underneath instead, which closes the profile.
  if (tool === "select" && !ev.shiftKey && selectionIsRoute() && beginRouteDrag(ev, wx, wy)) return;

  // A ghost node on a selected run: one normal click makes it real, and the new
  // node can be dragged straight away.
  const ghost = tool === "select" && !ev.shiftKey ? serviceGhost() : null;
  if (ghost && commitServiceGhost(ghost)) {
    store.pushUndo(); // dropped again below if the pointer never moves
    drag = { kind: "move", snaps: store.snapshotMoveTargets(store.selected), x0: wx, y0: wy, moved: false };
    el.canvas.setPointerCapture(ev.pointerId);
    return;
  }

  const hit = hitTest(wx, wy);
  if (hit) {
    if (underlaySelected) drawRibbon();
    underlaySelected = false;
    propertySelected = false;
    if (ev.shiftKey) {
      store.toggleRefs([hit], hit);
    } else if (!(store.isSelected(hit.kind, hit.id) && store.selected.length > 1)) {
      store.selectOne(hit);
    }
    store.pushUndo();
    const slideId = hit.kind === "opening" && store.selected.every((r) => r.kind === "opening") ? hit.id : null;
    if (slideId) {
      drag = { kind: "opening", id: slideId, x0: wx, y0: wy, moved: false };
      el.canvas.setPointerCapture(ev.pointerId);
    } else {
      drag = { kind: "move", snaps: store.snapshotMoveTargets(store.selected), x0: wx, y0: wy, moved: false };
    }
  } else if (tool === "select" && underlaySelected && hitUnderlay(wx, wy)) {
    if (store.doc.underlay.pinned) {
      setStatusMessage("This sheet is pinned. Unpin it in the bar above the plan to move it.", "warn");
      render();
      return;
    }
    store.pushUndo();
    drag = {
      kind: "underlay-move",
      x0: wx,
      y0: wy,
      ox: store.doc.underlay.x,
      oy: store.doc.underlay.y,
      moved: false,
    };
  } else if (tool === "select" && !ev.shiftKey && beginPropertyDrag(ev, wx, wy)) {
    // Clicking the boundary selects it. A corner drag reshapes; an edge drag moves.
  } else {
    const wasUnderlay = underlaySelected;
    underlaySelected = false;
    propertySelected = false;
    // A click on empty plan used to drop the route and shut the profile.
    // Keep a service selection until Exit, Escape, or a real marquee.
    const holdRoute = tool === "select" && !ev.shiftKey && selectionIsRoute();
    if (!ev.shiftKey && !holdRoute) store.clearSelection();
    drag = { kind: "marquee", x0: wx, y0: wy, x1: wx, y1: wy, shift: ev.shiftKey, holdRoute };
    if (wasUnderlay) drawRibbon();
  }
  render();
}

// --- services: draw route / connect ----------------------------------------

/** Arm (or, pressed again, put down) Draw route / Connect. */
function startServiceTool(name) {
  if (serviceRoute?.fromNodeId) finishServiceRoute();
  const off = tool === name;
  serviceRoute = null;
  serviceConnect = null;
  beamStart = null;
  lineStart = null;
  wallDraft = null;
  shapeDraft = null;
  sizeDraft = null;
  measureDraft = null;
  underlaySelected = false;
  attachPick = null;
  tool = off ? "select" : name;
  activeFunction = off ? null : name;
  if (!off && name === "service-route") showServiceSystem(serviceUi.system);
  if (!off && name === "service-connect" && store.selected.length === 1 && store.primary?.kind === "serviceNode") {
    serviceConnect = { nodeId: store.primary.id };
  }
  syncToolButtons();
  drawRibbon();
  renderPalette();
  updateRibbonHint();
  render();
}

/** "0.30" -> 0.3, "" -> null (not stated), anything else -> undefined (reject). */
function parseOffsetText(text) {
  const s = String(text ?? "").trim().replace(",", ".");
  if (!s) return null;
  if (!/^[-+]?\d*\.?\d+$/.test(s)) return undefined;
  return Number(s);
}

function serviceNodeNear(x, y, tol) {
  let best = null;
  let bestD = tol;
  for (const node of store.doc.serviceNodes || []) {
    if (node.level !== activeLevel || !planObjectVisible(node)) continue;
    const d = Math.hypot(node.x - x, node.y - y);
    if (d <= bestD) { best = node; bestD = d; }
  }
  return best;
}

function clickServicePoint(wx, wy) {
  const p = applySnap(wx, wy);
  if (serviceUi.justMode === "centre" && !snapGuide?.chaseHeld) {
    setStatusMessage("In the wall only places a point inside a wall. Click on the wall, or set Beside walls back to Free.", "warn");
    render();
    return;
  }
  const offset = parseOffsetText(serviceUi.offsetText);
  if (offset === undefined) {
    setStatusMessage("Height must be a number of metres, or blank if it is not known yet.", "warn");
    return;
  }
  if (serviceRoute && !serviceRouteFrom()) serviceRoute = null; // undone or deleted under us
  const tol = 10 / cam.scale;

  store.pushUndo();
  const undoDepth = store.undoStack.length;
  let networkId = serviceRoute?.networkId || null;
  if (!networkId) {
    // Starting on an existing point joins that network, whatever the panel says.
    const near = serviceNodeNear(p.x, p.y, tol);
    const chosen = (store.doc.serviceNetworks || []).find((n) => n.id === serviceUi.networkId && n.system === serviceUi.system);
    if (near) networkId = near.networkId;
    else if (chosen) networkId = chosen.id;
    else networkId = createNetwork(store.doc, { system: serviceUi.system, status: placeStatus }).id;
  }
  const route = {
    networkId,
    fromNodeId: serviceRoute?.fromNodeId || null,
    level: activeLevel,
    offset,
    sku: serviceUi.sku || null,
    mode: serviceUi.mode,
    chase: serviceUi.justMode === "centre",
  };
  const res = addRoutePoint(store.doc, pack, route, p, { tol });
  if (!res.ok) {
    store.undo(); // restores the document (and any network just made)
    setStatusMessage(res.message, "warn");
    render();
    return;
  }
  const first = !serviceRoute;
  serviceRoute = {
    networkId,
    fromNodeId: res.nodeId,
    createdStart: first ? Boolean(res.createdNode) : serviceRoute.createdStart,
    undoDepth: first ? undoDepth : serviceRoute.undoDepth,
    clicks: (serviceRoute?.clicks || 0) + 1,
    lastEdgeId: res.edgeId || serviceRoute?.lastEdgeId || null,
  };
  serviceUi.networkId = networkId;
  if (res.message) setStatusMessage(res.message, "ok");
  store.persist();
  snapGuide = null;
  updateRibbonHint();
  render();
}

/**
 * End the route in progress (Enter, Esc, or switching tool). A start point that
 * never got a run is removed again rather than left as an orphan, but only while
 * nothing else has happened since (otherwise it is somebody else's undo entry).
 */
function finishServiceRoute({ select = true } = {}) {
  const r = serviceRoute;
  serviceRoute = null;
  snapGuide = null;
  if (!r) return;
  if (r.createdStart && r.clicks === 1 && store.undoStack.length === r.undoDepth) {
    store.undo();
    return;
  }
  if (select && r.lastEdgeId && (store.doc.serviceEdges || []).some((e) => e.id === r.lastEdgeId)) {
    store.setSelection([{ kind: "serviceEdge", id: r.lastEdgeId }]);
  }
}

/** The route profile is on screen (a route is selected, or one was just drawn). */
function routeProfileOpen() {
  return Boolean(el.serviceProfileDock && !el.serviceProfileDock.hidden && !elevationShowing());
}

/** The strip under the plan is showing a wall elevation, not a route profile. */
function elevationShowing() {
  return Boolean(el.elevBody && !el.elevBody.hidden);
}

/** The open route profile is showing this selection, and only this selection. */
function selectionIsRoute() {
  return store.selected.length > 0 && store.selected.every((r) => r.kind === "serviceNode" || r.kind === "serviceEdge");
}

/**
 * While Draw route, Connect or Add node is armed and the profile is open, a
 * click on a wall or floor is the Exit button: close the profile and the
 * Services panel, then select that object. Select does not use this. A drag
 * there moves the route, and only a click that does not move leaves it.
 * Returns true when the click was consumed.
 */
function leaveRouteForPlanClick(ev, wx, wy) {
  if (tool !== "select" && tool !== "service-route" && tool !== "service-connect" && tool !== "service-node") return false;
  if (!routeProfileOpen()) return false;
  const under = wallOrFloorAt(wx, wy);
  if (!under) return false;
  exitRouteProfile();
  underlaySelected = false;
  propertySelected = false;
  store.selectOne(under);
  store.pushUndo();
  drag = { kind: "move", snaps: store.snapshotMoveTargets(store.selected), x0: wx, y0: wy, moved: false };
  el.canvas.setPointerCapture(ev.pointerId);
  render();
  return true;
}

/**
 * A ribbon placement tool (Doors, Windows, Walls, and the rest) takes the
 * inspector. Commands that act on the current selection do not come through
 * here. The elevation draft is not part of the selection, so it is dropped
 * too; otherwise the outline comes back when that wall is selected again.
 */
function leaveInspectorForPlacement() {
  store.clearSelection();
  elevationOpen = false;
  elevationDrag = null;
  elevFinishDraft = null;
  selectedBandId = null;
  selectedElevVertex = null;
  previewCallout = null;
  openingCalloutClosed = null;
  regionFinish = null;
}

/**
 * A draw tool other than Select or a service tool takes the inspector.
 * The route selection is what keeps the Services panel and route profile up,
 * so it has to go when that tool is armed, not when the first point is placed.
 */
function clearRouteIfLeavingServices() {
  if (tool === "select" || tool === "service-route" || tool === "service-connect" || tool === "service-node") return;
  if (!store.selected.some((r) => r.kind === "serviceNode" || r.kind === "serviceEdge")) return;
  const rest = store.selected.filter((r) => r.kind !== "serviceNode" && r.kind !== "serviceEdge");
  if (rest.length) store.setSelection(rest);
  else store.clearSelection();
}

/**
 * Close the route profile and the Services inspector. Leaves Draw route /
 * Connect / Add node as well, otherwise the inspector stays on Services and
 * the run just drawn brings the profile straight back.
 */
function exitRouteProfile() {
  if (elevationShowing()) {
    elevationOpen = false;
    render();
    return;
  }
  if (serviceRoute?.fromNodeId) finishServiceRoute({ select: false });
  else serviceRoute = null;
  serviceConnect = null;
  snapGuide = null;
  if (tool === "service-route" || tool === "service-connect" || tool === "service-node") {
    tool = "select";
    activeFunction = null;
    syncToolButtons();
    drawRibbon();
    renderPalette();
    updateRibbonHint();
  }
  if (store.selected.some((r) => r.kind === "serviceNode" || r.kind === "serviceEdge")) {
    const rest = store.selected.filter((r) => r.kind !== "serviceNode" && r.kind !== "serviceEdge");
    if (rest.length) store.setSelection(rest);
    else store.clearSelection();
  }
  render();
}

function itemAt(wx, wy) {
  const tol = 6 / cam.scale;
  const items = store.doc.items.filter(onActiveLevel);
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (!planObjectVisible(item)) continue;
    const sku = skuById(item.sku);
    if (!sku) continue;
    const box = itemRect(item, sku);
    if (wx >= box.x - tol && wx <= box.x + box.w + tol && wy >= box.y - tol && wy <= box.y + box.h + tol) return item;
  }
  return null;
}

/**
 * The ghost node under the pointer: a faint, not-yet-real node on a run, shown
 * while Add node is armed, or on a run that is already selected. Clicking it
 * (once) makes it a real node.
 */
function serviceGhost(at) {
  const point = at || hoverPoint;
  if (!point || drag) return null;
  if (tool !== "service-node" && tool !== "select") return null;
  const hit = serviceHit(point.x, point.y);
  if (hit?.kind !== "serviceEdge") return null;
  if (tool === "select" && !store.isSelected("serviceEdge", hit.id)) return null;
  const p = projectOnEdge(store.doc, hit.id, point);
  return p ? { edgeId: hit.id, x: p.x, y: p.y } : null;
}

/**
 * Pointer-down on an already selected route. Starts a move of that route and
 * remembers the wall, annotation or other object under the pointer, which a
 * click that does not move will select. Returns false when this press is not
 * that gesture (empty plan, or a different route), so the caller can pick or
 * window-select as usual.
 */
function beginRouteDrag(ev, wx, wy) {
  const hit = hitTest(wx, wy);
  if (!hit) return false;
  const serviceKind = hit.kind === "serviceNode" || hit.kind === "serviceEdge";
  const onSelected = serviceKind && store.isSelected(hit.kind, hit.id);
  // A different route is an ordinary pick: select it, and this drag moves it.
  if (serviceKind && !onSelected) return false;

  const under = objectUnderRoute(wx, wy);
  // Nothing else under a selected run: a click adds a node, and the new node
  // can be dragged straight away. A wall or annotation under the run wins the
  // click instead, so the node is not inserted on the way out of the profile.
  if (onSelected && !under) {
    const ghost = serviceGhost({ x: wx, y: wy });
    if (ghost && commitServiceGhost(ghost)) {
      store.pushUndo(); // dropped again below if the pointer never moves
      drag = { kind: "move", snaps: store.snapshotMoveTargets(store.selected), x0: wx, y0: wy, moved: false };
      el.canvas.setPointerCapture(ev.pointerId);
      return true;
    }
  }

  if (underlaySelected) drawRibbon();
  underlaySelected = false;
  propertySelected = false;
  store.pushUndo();
  drag = {
    kind: "move",
    snaps: store.snapshotMoveTargets(store.selected),
    x0: wx,
    y0: wy,
    moved: false,
    switchTo: under,
  };
  el.canvas.setPointerCapture(ev.pointerId);
  render();
  return true;
}

/** Turn a ghost into a real, selected node. */
function commitServiceGhost(ghost) {
  store.pushUndo();
  const res = splitServiceEdge(store.doc, pack, ghost.edgeId, { x: ghost.x, y: ghost.y });
  if (!res.ok) {
    store.undo();
    setStatusMessage(res.message, "warn");
    return false;
  }
  store.persist();
  store.selectOne({ kind: "serviceNode", id: res.nodeId });
  serviceDockKey = "";
  setStatusMessage("Node added. Drag it to move it, or lift it in the profile.", "ok");
  render();
  return true;
}

/**
 * Services > Add node: click a run to put a node on it (GIS vertex style), click
 * an existing node to select it. The tool stays armed so several can be added.
 */
function clickServiceNode(wx, wy) {
  const hit = serviceHit(wx, wy);
  if (hit?.kind === "serviceNode") {
    store.selectOne(hit);
    render();
    return;
  }
  if (hit?.kind !== "serviceEdge") {
    setStatusMessage("Click on a route run to add a node.", "warn");
    return;
  }
  const p = projectOnEdge(store.doc, hit.id, { x: wx, y: wy });
  commitServiceGhost({ edgeId: hit.id, x: p ? p.x : wx, y: p ? p.y : wy });
}

/** Services > Connect: pick a route point, then click the component it serves. */
function clickServiceConnect(wx, wy) {
  const node = serviceHit(wx, wy);
  if (node?.kind === "serviceNode") {
    serviceConnect = { nodeId: node.id };
    store.selectOne(node);
    setStatusMessage("Now click the component to connect this point to.", "ok");
    updateRibbonHint();
    render();
    return;
  }
  if (!serviceConnect?.nodeId) {
    setStatusMessage("Click a route point first.", "warn");
    return;
  }
  const item = itemAt(wx, wy);
  if (!item) {
    setStatusMessage("Click a placed component on this level.", "warn");
    return;
  }
  store.pushUndo();
  const res = connectNode(store.doc, pack, serviceConnect.nodeId, item.id);
  if (!res.ok) {
    store.undo();
    setStatusMessage(res.message, "warn");
    render();
    return;
  }
  store.persist();
  serviceConnect = null;
  setStatusMessage("Connected. The point moved onto the component; its height is unchanged.", "ok");
  updateRibbonHint();
  render();
}

/** After a move: a point dragged off its component lets go of it; a moved component takes its points along. */
function settleServicesAfterMove(snaps) {
  const movedItems = new Set(snaps.filter((s) => s.ref.kind === "item").map((s) => s.ref.id));
  for (const s of snaps) {
    if (s.ref.kind !== "serviceNode") continue;
    const node = store.doc.serviceNodes.find((n) => n.id === s.ref.id);
    if (node?.connectedRef && !movedItems.has(node.connectedRef.id)) node.connectedRef = null;
  }
  rehomeConnectedNodes(store.doc, pack);
}

function clickWallPoint(wx, wy) {
  if (refuseWrongFoundation()) {
    render();
    return;
  }
  const p = applySnap(wx, wy);
  if (!wallDraft) {
    sizeDraft = { lockW: false, lockH: false, typedW: "", typedH: "", axis: "w" };
    wallDraft = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    wallSideFlip = false;
    updateRibbonHint();
    render();
    return;
  }
  if (sizeDraft?.lockW) setWallDraftLength(parseLengthInput(sizeDraft.typedW, wallDraftLength() || 1));
  else {
    wallDraft.x2 = p.x;
    wallDraft.y2 = p.y;
  }
  finishWallSegment();
}

function finishWallSegment() {
  const start = { x: wallDraft.x1, y: wallDraft.y1 };
  const end = { x: wallDraft.x2, y: wallDraft.y2 };
  if (!commitWall(start, end)) {
    render();
    return;
  }
  sizeDraft = { lockW: false, lockH: false, typedW: "", typedH: "", axis: "w" };
  wallDraft = { ...chainStart(end), chained: true };
  snapGuide = null;
  updateRibbonHint();
  render();
}

function clickShapeCorner(wx, wy) {
  if (!placeSkuId) placeSkuId = defaultSkuFor(tool);
  const p = applySnap(wx, wy);
  if (!shapeDraft) {
    sizeDraft = { lockW: false, lockH: false, typedW: "", typedH: "", axis: "w" };
    shapeDraft = { kind: `${tool}-new`, x0: p.x, y0: p.y, rect: null };
    updateRibbonHint();
    render();
    return;
  }
  shapeDraft.rect = rectFromDrag(shapeDraft.x0, shapeDraft.y0, p.x, p.y);
  finishShapeRect();
}

function finishShapeRect() {
  const kind = shapeDraft.kind;
  const rect = shapeDraft.rect;
  const ok = kind === "room-new" ? commitRoom(rect)
    : kind === "slab-new" ? commitSlab(rect)
    : commitRoof(rect);
  if (ok) {
    shapeDraft = null;
    sizeDraft = null;
    snapGuide = null;
  }
  updateRibbonHint();
  render();
}


/** Copy to add a corner, or the resize arrow that pushes that edge. */
function ringEdgeCursor(ring, wx, wy) {
  if (!ring || ring.length < 3) return null;
  if (hitPolyVertexIndex(ring, wx, wy, shapeEditTol()) != null) return null;
  const ei = hitPolyEdgeIndex(ring, wx, wy, propertyPickTol());
  if (ei == null) return null;
  if (floorEdgeMode !== "line") return "copy";
  const [x1, y1] = ring[ei];
  const [x2, y2] = ring[(ei + 1) % ring.length];
  const [sx1, sy1] = worldToScreen(x1, y1);
  const [sx2, sy2] = worldToScreen(x2, y2);
  return `${edgeResizeCursor(sx1, sy1, sx2, sy2)}-resize`;
}

/** Cursor on an edge of the finish being edited. */
function finishRegionCursor(wx, wy) {
  const region = editingFinishRegion();
  if (!region) return null;
  return ringEdgeCursor(finishRegionRing(region), wx, wy);
}

/** The same cursor on an edge of the floor, room or roof. Hidden while the
 *  covering finish is the outline being edited — those edges are the finish's. */
function floorShapeCursor(wx, wy) {
  if (editingCoveringFinish()) return null;
  const editable = editableShapeRef();
  if (!editable) return null;
  return ringEdgeCursor(editable.points, wx, wy);
}

/** Corner / Line sits just above the outline being edited, as on a wall elevation.
 *  It is the finish while that finish's corners are open, otherwise the floor. */
function placeFloorEdgeMode() {
  const node = el.floorEdgeMode;
  if (!node) return;
  const region = tool === "select" ? editingFinishRegion() : null;
  const shape = tool === "select" && !attachPick ? editableShapeRef() : null;
  const show = Boolean(region || shape);
  setHidden(node, !show);
  if (!show) return;
  node.querySelectorAll("[data-floor-edge]").forEach((b) => {
    const on = b.dataset.floorEdge === floorEdgeMode;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
  const subject = region ? "finish" : outlineHostWord(shape?.ref);
  const caption = node.querySelector("[data-edge-subject]");
  if (caption) caption.textContent = `Editing the ${subject}`;
  node.setAttribute("aria-label", `Drag an edge of the ${subject} to`);
  const ring = region ? finishRegionRing(region) : shape.points;
  if (!ring || ring.length < 3 || !el.canvasWrap) return;
  const xs = [];
  const ys = [];
  for (const [x, y] of ring) {
    const [sx, sy] = worldToScreen(x, y);
    xs.push(sx);
    ys.push(sy);
  }
  const width = node.offsetWidth || 148;
  const height = node.offsetHeight || 44;
  const left = (el.canvas?.offsetLeft || 0) + Math.min(...xs);
  const top = (el.canvas?.offsetTop || 0) + Math.min(...ys) - height - 6;
  const minLeft = 8;
  const maxLeft = el.canvasWrap.clientWidth - width - 8;
  const minTop = 8;
  const maxTop = el.canvasWrap.clientHeight - height - 8;
  node.style.left = `${Math.round(Math.max(minLeft, Math.min(left, maxLeft)))}px`;
  node.style.top = `${Math.round(Math.max(minTop, Math.min(top, maxTop)))}px`;
}

/** Select-tool cursor. A crosshair window-selects on empty space. The pointer
 *  appears over an unselected object a click will pick (the same objects that
 *  draw a hover highlight). The move cursor appears only once that object is
 *  already selected, which is when a left-drag will move it. Handles keep
 *  their own cursors. A floor or finish edge uses the elevation's corner and
 *  line cursors: copy to add a corner, or the arrow that pushes that edge. */
function planSelectCursor(wx, wy, uHandle) {
  if (endpointHandleHit(wx, wy)) return "ew-resize";
  if (uHandle?.kind === "underlay-rotate") return "grab";
  if (uHandle?.kind === "underlay-scale") return "nwse-resize";
  const finishCursor = finishRegionCursor(wx, wy);
  if (finishCursor) return finishCursor;
  const shapeCursor = floorShapeCursor(wx, wy);
  if (shapeCursor) return shapeCursor;
  if (hover && store.isSelected(hover.kind, hover.id)) return "move";
  if (propertyHover && propertySelected) return "move";
  if (underlaySelected && hitUnderlay(wx, wy)) return store.doc.underlay.pinned ? "not-allowed" : "move";
  if (hover && refShownOnPlan(hover)) return "pointer";
  if (propertyHover) return "pointer";
  return "crosshair";
}

function onPointerMove(ev) {
  if (drag?.kind === "pan") {
    cam.ox = drag.ox0 + (ev.clientX - drag.startX);
    cam.oy = drag.oy0 + (ev.clientY - drag.startY);
    el.canvas.style.cursor = "grabbing";
    render();
    return;
  }
  // While Pan is on, the pointer only moves the view. Drafts stay where
  // they were until Pan is put down.
  if (panMode) {
    el.canvas.style.cursor = "grab";
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
    if (!calibration?.b) {
      const p = applyPdfPick(wx, wy);
      hoverPoint = { x: p.x, y: p.y };
    }
    if (calibration?.b && !drag) {
      const uHandle = underlayHandleHit(wx, wy);
      el.canvas.style.cursor = uHandle?.kind === "underlay-rotate" ? "grab"
        : uHandle?.kind === "underlay-scale" ? "nwse-resize"
        : hitUnderlay(wx, wy) ? "move"
        : "crosshair";
    }
    if (calibration?.a || snapToPdf) render();
    return;
  }
  if (tool === "align") {
    const p = applyPdfPick(wx, wy);
    hoverPoint = { x: p.x, y: p.y };
    el.canvas.style.cursor = "crosshair";
    render();
    return;
  }
  if (tool === "camera") {
    el.canvas.style.cursor = "crosshair";
    if (cameraDraft?.a) render();
    return;
  }
  if (tool === "section") {
    el.canvas.style.cursor = "crosshair";
    if (sectionDraft?.a) render();
    return;
  }
  if (tool === "callout") {
    el.canvas.style.cursor = "crosshair";
    if (calloutDraft?.a) render();
    return;
  }
  if (tool === "revision") {
    el.canvas.style.cursor = "crosshair";
    if (revisionCloudDraft?.a) render();
    return;
  }
  if (tool === "measure") {
    applySnap(wx, wy);
    el.canvas.style.cursor = "crosshair";
    render();
    return;
  }
  if (tool === "property" || tool === "sg-ref") {
    el.canvas.style.cursor = "crosshair";
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
  if (drag?.kind === "opening") {
    el.canvas.style.cursor = "grabbing";
    if (Math.hypot(wx - drag.x0, wy - drag.y0) * cam.scale > 3) {
      drag.moved = true;
      const opening = (store.doc.openings || []).find((o) => o.id === drag.id);
      if (opening) slideOpening(store.doc, pack, currentWalls().filter(onActiveLevel), opening, wx, wy);
    }
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
          exactJoin: isExactPointSnap(best.guide),
        };
      }
    }
    if (drag.snaps.length >= 1 && drag.snaps.every((s) => s.ref.kind === "serviceNode")) {
      // Route points get the same live snap and gap dimensions to nearby walls,
      // corners and other route points that a wall gets while it is drawn. The
      // lead point is snapped; the rest (a riser column, a picked run) follow
      // by the same delta.
      const lead = drag.snaps[0];
      serviceMoveIds = new Set(drag.snaps.map((s) => s.ref.id));
      try {
        const p = applySnap(lead.x + dx, lead.y + dy);
        dx = p.x - lead.x;
        dy = p.y - lead.y;
        grid = null;
      } finally {
        serviceMoveIds = null;
      }
    }
    if (drag.snaps.length > 1 && grid) {
      // Several objects move as one rigid body: round the shared delta once
      // and apply it exactly. Rounding each coordinate separately shifts
      // off-grid objects (e.g. walls) by different amounts than the floor.
      dx = roundGrid(dx, grid);
      dy = roundGrid(dy, grid);
      grid = null;
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
  if (dragFinishRegion(wx, wy)) return;
  if (drag?.kind === "shape-edge") {
    const obj = objByRef(drag.ref);
    const origin = drag.origin;
    if (obj && origin) {
      const i = drag.index;
      const j = (i + 1) % origin.length;
      const a0 = origin[i];
      const b0 = origin[j];
      const live = obj.shape?.points;
      const a = live?.[i] || a0;
      const b = live?.[j] || b0;
      const push = perpendicularEdgeMove(a0[0], a0[1], b0[0], b0[1], wx - drag.grabX, wy - drag.grabY);
      const p = applyEdgeSnap(a0, b0, push, {
        activeShape: { kind: drag.ref.kind, id: drag.ref.id, x: a[0], y: a[1], also: { x: b[0], y: b[1] } },
      });
      const along = (p.x - a0[0]) * push.nx + (p.y - a0[1]) * push.ny;
      const next = translatePolyEdge(origin, i, push.nx * along, push.ny * along, null);
      const at = next[i];
      if (Math.hypot(at[0] - a0[0], at[1] - a0[1]) * cam.scale > 2) drag.moved = true;
      if (drag.moved) {
        if (snapGuide && (Math.abs(at[0] - p.x) > 1e-6 || Math.abs(at[1] - p.y) > 1e-6)) snapGuide = null;
        obj.shape = polyShape(next);
        applyFinishShapeSnapshot(drag.finishSnap);
      } else snapGuide = null;
    }
    render();
    return;
  }
  if (drag?.kind === "shape-vertex") {
    const obj = objByRef(drag.ref);
    const pt = obj?.shape?.points?.[drag.index] || drag.origin?.[drag.index];
    if (obj && pt) {
      // Keep the other corners of this floor (so a shared X or Y still draws
      // one guide) but not this corner or the outline itself — those are
      // always under the pointer and would light both guides on every move.
      const p = applySnap(wx, wy, {
        activeShape: { kind: drag.ref.kind, id: drag.ref.id, x: pt[0], y: pt[1] },
      });
      if (Math.hypot(p.x - pt[0], p.y - pt[1]) * cam.scale > 2) drag.moved = true;
      if (drag.moved) {
        if (obj.shape?.kind !== "poly" || !Array.isArray(obj.shape.points)) {
          obj.shape = polyShape((drag.origin || []).map(([x, y]) => [x, y]));
        }
        obj.shape.points[drag.index] = [p.x, p.y];
        selectedShapeVertex = { ref: drag.ref, index: drag.index };
        applyFinishShapeSnapshot(drag.finishSnap);
      }
    }
    render();
    return;
  }
  if (drag?.kind === "property-vertex") {
    const p = applySnap(wx, wy);
    const [ox, oy] = drag.origin[drag.index];
    if (Math.hypot(p.x - ox, p.y - oy) * cam.scale > 2) drag.moved = true;
    if (drag.moved) {
      const next = drag.origin.map((pt, i) => (i === drag.index ? [p.x, p.y] : [pt[0], pt[1]]));
      setPropertyLine(store.doc, next);
    }
    render();
    return;
  }
  if (drag?.kind === "property-move") {
    const dx = wx - drag.x0;
    const dy = wy - drag.y0;
    if (Math.hypot(dx, dy) * cam.scale > 2) drag.moved = true;
    if (drag.moved) {
      const grid = activeGrid();
      const next = drag.origin.map(([x, y]) => [roundGrid(x + dx, grid), roundGrid(y + dy, grid)]);
      setPropertyLine(store.doc, next);
    }
    render();
    return;
  }
  if (!drag && tool === "select") {
    syncFinishRegionHover(wx, wy);
    const uHandle = underlayHandleHit(wx, wy);
    propertyHover = hover ? null : propertyHitAt(wx, wy);
    el.canvas.style.cursor = planSelectCursor(wx, wy, uHandle);
  } else if (!drag) {
    propertyHover = null;
    el.canvas.style.cursor = "crosshair";
  } else {
    propertyHover = null;
  }
  if (wallDraft && !drag) {
    const p = applySnap(wx, wy);
    wallDraft.x2 = p.x;
    wallDraft.y2 = p.y;
    if (sizeDraft?.lockW) setWallDraftLength(parseLengthInput(sizeDraft.typedW, wallDraftLength() || 1));
    // Remember the last end long enough to be a real wall, so the corner
    // preview survives the cursor stepping onto the option buttons.
    if (segmentLength(wallDraft.x1, wallDraft.y1, wallDraft.x2, wallDraft.y2) >= MIN_TRACE) {
      wallDraft.keep = { x: wallDraft.x2, y: wallDraft.y2 };
    }
    render();
    return;
  }
  if (shapeDraft && !drag) {
    const p = applySnap(wx, wy);
    shapeDraft.rect = rectFromDrag(shapeDraft.x0, shapeDraft.y0, p.x, p.y);
    render();
    return;
  }
  if (!drag && (snapPreviewTool() || beamStart || lineStart || wallDraft || shapeDraft)) applySnap(wx, wy);
  else if (!drag) snapGuide = null;
  render();
}

function rectFromDrag(x0, y0, wx, wy) {
  // x0/y0 and wx/wy are already snapped or grid-rounded by applySnap.
  // Rounding again here would pull an exact wall-corner join back onto
  // the grid and undo the snap.
  return rectFromCorners(x0, y0, wx, wy, {
    lockW: sizeDraft?.lockW,
    lockH: sizeDraft?.lockH,
    w: sizeDraft?.lockW ? parseLengthInput(sizeDraft.typedW, 1) : 0,
    h: sizeDraft?.lockH ? parseLengthInput(sizeDraft.typedH, 1) : 0,
  });
}

function onPointerUp(ev) {
  if (drag?.kind === "pan") {
    drag = null;
    el.canvas.style.cursor = panMode ? "grab" : "crosshair";
    return;
  }
  if (!drag) return;

  if (drag.kind === "marquee") {
    const box = marqueeBox(drag.x0, drag.y0, drag.x1, drag.y1);
    const hits = refsInMarquee(box);
    const tap = Math.hypot(box.w, box.h) * cam.scale < 4;
    if (drag.shift) store.toggleRefs(hits);
    else if (!(tap && drag.holdRoute)) store.setSelection(hits);
  } else if (drag.kind === "move") {
    if (!drag.moved) {
      // No-op click: drop the speculative undo entry. Put the document back
      // first, so a sub-threshold nudge cannot stay behind when the click is
      // really selecting the wall or annotation under the route.
      const prev = store.undoStack.pop();
      if (drag.switchTo) {
        if (prev) store.doc = prev;
        underlaySelected = false;
        propertySelected = false;
        store.selectOne(drag.switchTo);
      }
    } else settleServicesAfterMove(drag.snaps);
  } else if (drag.kind === "opening") {
    if (!drag.moved) store.undoStack.pop();
  } else if (drag.kind === "underlay-move" || drag.kind === "underlay-scale" || drag.kind === "underlay-rotate") {
    if (!drag.moved) store.undoStack.pop(); // no-op click: drop the speculative undo entry
  } else if (drag.kind === "segment-end") {
    store.persist();
  } else if (drag.kind === "shape-vertex" || drag.kind === "shape-edge") {
    if (!drag.moved && !drag.inserted) {
      store.undoStack.pop();
      const obj = objByRef(drag.ref);
      if (!obj?.shape?.points) selectedShapeVertex = null;
    } else if (drag.inserted) setStatusMessage("Corner added. Drag it, or click another edge. Delete removes the selected corner.", "ok");
    else if (drag.kind === "shape-edge") setStatusMessage("Line moved.", "ok");
  } else if (drag.kind === "region-vertex" || drag.kind === "region-edge" || drag.kind === "region-move") {
    // A press that moved nothing leaves no undo step, unless it added a corner.
    if (!drag.moved && !drag.inserted) store.undoStack.pop();
    else if (drag.inserted) setStatusMessage("Corner added. Drag it, or click another edge. Delete removes the selected corner.", "ok");
    else if (drag.kind === "region-edge") setStatusMessage("Line moved.", "ok");
  } else if (drag.kind === "property-vertex" || drag.kind === "property-move") {
    if (!drag.moved) store.undoStack.pop();
    else if (drag.hadDerived) {
      setStatusMessage("Property line updated. Run Building line again — the old setback was cleared.", "ok");
    }
  }

  drag = null;
  if (hoverPoint && snapPreviewTool()) applySnap(hoverPoint.x, hoverPoint.y);
  store.pruneGroups();
  store.persist();
  render();
}

function deleteElevCorner() {
  if (selectedElevVertex == null || !selectedBandId || !elevationFace) return false;
  const model = elevationModel(store.doc, pack, elevationFace, wallsCache);
  const band = model?.finishBands.find((b) => b.id === selectedBandId);
  const ring = elevRing(band);
  if (!ring) return false;
  if (ring.length <= 3) {
    setStatusMessage("A finish needs at least three corners.", "warn");
    return true;
  }
  const points = ring.map(([s, z]) => ({ s, z }));
  points.splice(selectedElevVertex, 1);
  selectedElevVertex = null;
  store.pushUndo();
  applyOutlinePoints(store.doc, pack, elevationFace, band.id, points, wallsCache);
  store.persist();
  finishKey = "";
  setStatusMessage("Corner removed.", "ok");
  render();
  return true;
}

function deleteSelection() {
  if (deleteElevCorner()) return;
  // While a region's corners are showing, Delete is about them, never the floor under them.
  const editing = editingFinishRegion();
  if (editing) {
    const vref = selectedRegionVertex;
    selectedRegionVertex = null;
    const pts = editing.shape?.points;
    if (vref && vref.id === editing.id && pts && pts[vref.index]) {
      if (pts.length <= 3) {
        setStatusMessage("A region needs at least three corners.", "warn");
        return;
      }
      store.pushUndo();
      pts.splice(vref.index, 1);
      store.persist();
      setStatusMessage("Corner removed.", "ok");
      render();
    } else {
      setStatusMessage("Click a corner of the region, then Delete. Use Remove in the inspector to take the region off.", "warn");
    }
    return;
  }
  if (selectedShapeVertex) {
    const vref = selectedShapeVertex;
    selectedShapeVertex = null;
    const obj = objByRef(vref.ref);
    const pts = obj?.shape?.points;
    if (pts && store.isSelected(vref.ref.kind, vref.ref.id)) {
      if (pts.length <= 3) {
        setStatusMessage("A shape needs at least three corners.", "warn");
        return;
      }
      store.pushUndo();
      pts.splice(vref.index, 1);
      store.persist();
      setStatusMessage("Corner removed.", "ok");
      render();
      return;
    }
  }
  if (propertySelected && !store.selected.length) {
    store.pushUndo();
    setPropertyLine(store.doc, null);
    propertySelected = false;
    store.persist();
    setStatusMessage("Property line removed.", "ok");
    return;
  }
  if (!store.selected.length) return;
  store.pushUndo();
  const isService = (ref) => ref.kind === "serviceNode" || ref.kind === "serviceEdge";
  // Services clean up after themselves (a deleted point takes its runs, an
  // emptied network goes), which a bare splice would leave dangling.
  const serviceSel = store.selected.filter(isService);
  // Deleting part of a route must not close its profile: remember the route and
  // the points beside what is deleted, and reselect a surviving run afterwards.
  const onlyServices = serviceSel.length > 0 && serviceSel.length === store.selected.length;
  let keepRoute = null;
  if (onlyServices) {
    const edgeId = profileEdgeId && (store.doc.serviceEdges || []).some((e) => e.id === profileEdgeId)
      ? profileEdgeId : serviceProfileEdge();
    const beside = new Set();
    const gone = new Set(serviceSel.filter((r) => r.kind === "serviceNode").map((r) => r.id));
    for (const e of store.doc.serviceEdges || []) {
      if (gone.has(e.fromNode)) beside.add(e.toNode);
      if (gone.has(e.toNode)) beside.add(e.fromNode);
    }
    keepRoute = {
      edgeIds: edgeId ? routeProfile(store.doc, pack, edgeId).edgeIds : [],
      beside,
    };
  }
  // A lone route node dissolves like a GIS vertex: the run heals over it.
  if (serviceSel.length === 1 && serviceSel[0].kind === "serviceNode") removeServiceNode(store.doc, serviceSel[0].id);
  else deleteServiceRefs(store.doc, serviceSel);
  // The tiles and waterproofing on a floor go with it, never left floating.
  const goneRegions = new Set(hostedFinishRegionsOf(store.doc, store.selected.filter((r) => !isService(r))).map((r) => r.id));
  if (goneRegions.size) {
    store.doc.finishRegions = store.doc.finishRegions.filter((r) => !goneRegions.has(r.id));
    editingRegionId = null;
  }
  for (const ref of store.selected.filter((r) => !isService(r))) {
    const arr = collectionFor(store.doc, ref.kind);
    const idx = arr?.findIndex((row) => row.id === ref.id) ?? -1;
    if (idx >= 0) arr.splice(idx, 1);
  }
  // Deleting a component leaves any route point connected to it unconnected.
  pruneServices(store.doc);
  store.pruneGroups();
  store.clearSelection();
  if (keepRoute) {
    const edges = store.doc.serviceEdges || [];
    const next = edges.find((e) => keepRoute.beside.has(e.fromNode) || keepRoute.beside.has(e.toNode))
      || edges.find((e) => keepRoute.edgeIds.includes(e.id));
    if (next) store.setSelection([{ kind: "serviceEdge", id: next.id }]);
  }
  store.persist();
}

function wireKeyboard() {
  window.addEventListener("keydown", (ev) => {
    const tag = document.activeElement?.tagName;
    const typing = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";

    if (handleSizeTyping(ev)) return;
    if (handleDraftNumericShortcut(ev)) return;
    // Escape still has to get through from a field: the size HUD is part of
    // drawing, so typing a width there must not trap the draft.
    if (typing && ev.key === "Escape") document.activeElement.blur();
    else if (typing) return;

    if (ev.key === "Escape") {
      if (accountIsOpen()) {
        setAccountOpen(false);
        return;
      }
      if (el.aboutOverlay && !el.aboutOverlay.hidden) {
        closeAbout();
        return;
      }
      if (el.massOverlay && !el.massOverlay.hidden) {
        closeMassing();
        return;
      }
      if (el.typeDetailOverlay && !el.typeDetailOverlay.hidden) {
        closeTypeDetail();
        return;
      }
      if (el.checkOverlay && !el.checkOverlay.hidden) {
        closeCheck();
        return;
      }
      // Peeking hands the backdrop to the plan, so Escape is the way back:
      // once to the full table, again to close it.
      if (el.scheduleOverlay && !el.scheduleOverlay.hidden) {
        if (schedulePeeking) setSchedulePeek(false);
        else closeSchedule();
        return;
      }
      // Pan sits on top of the current tool. The first Escape puts it down
      // and leaves the draft; the next Escape cancels the draft as usual.
      if (panMode) {
        setPanMode(false);
        return;
      }
      if (elevFinishDraft) {
        if (elevFinishDraft.points.length) {
          elevFinishDraft.points.pop();
          setStatusMessage(elevFinishDraft.points.length
            ? "Last corner removed."
            : "Click the first corner on the elevation.", "ok");
        } else {
          elevFinishDraft = null;
          setStatusMessage("Drawing cancelled.", "ok");
        }
        render();
        return;
      }
      // Editing a finish sits on top of its floor. Escape puts the finish
      // down and leaves the floor selected, so the next press is what
      // deselects the floor.
      if (editingFinishRegion()) {
        if (drag?.kind === "region-vertex" || drag?.kind === "region-edge" || drag?.kind === "region-move") {
          const selection = store.selected.slice();
          const primary = store.primary;
          store.undo();
          store.setSelection(selection, primary);
          drag = null;
        }
        editingRegionId = null;
        selectedRegionVertex = null;
        finishKey = "";
        setStatusMessage(`Editing the ${outlineHostWord(store.primary)}.`, "ok");
        render();
        return;
      }
      cancelDrawing();
    } else if (el.typeDetailOverlay && !el.typeDetailOverlay.hidden && (ev.key === "ArrowLeft" || ev.key === "ArrowRight")) {
      // Overlay is open: arrows page through the other options instead of
      // nudging the probe sides they'd otherwise control.
      ev.preventDefault();
      stepTypeDetail(ev.key === "ArrowLeft" ? -1 : 1);
    } else if (PROBE_KEYS[ev.key]) {
      ev.preventDefault();
      const side = PROBE_KEYS[ev.key];
      const axis = probeAxis(side);
      probeSide[axis] = probeSide[axis] === side ? null : side;
      // The ribbon hint already names the arrows. Updating it here is what
      // says which side is pinned; the status line would only repeat it
      // and then clear.
      updateRibbonHint();
      // Re-resolve from the last pointer position so the new side appears
      // straight away, without waiting for the mouse to twitch.
      if (hoverPoint && (snapPreviewTool() || beamStart || lineStart)) applySnap(hoverPoint.x, hoverPoint.y);
      else if (hoverPoint && dragFinishRegion(hoverPoint.x, hoverPoint.y)) {
        // A finish corner, edge or whole region mid-drag: re-run the drag at
        // the pointer so the newly pinned side shows without a mouse move.
        return;
      } else if (drag?.kind === "move" && drag.snaps.length && drag.snaps.every((s) => s.ref.kind === "serviceNode")) {
        // A route point mid-drag: the guide was last built on the pointer move,
        // so re-resolve it at the point where the node now sits.
        const lead = objByRef(drag.snaps[0].ref);
        if (lead) {
          serviceMoveIds = new Set(drag.snaps.map((s) => s.ref.id));
          try { applySnap(lead.x, lead.y); } finally { serviceMoveIds = null; }
        }
      }
      render();
    } else if (ev.key === "Enter" && elevFinishDraft) {
      ev.preventDefault();
      finishElevFinishDraft();
    } else if (ev.key === "Enter" && serviceRoute) {
      ev.preventDefault();
      finishServiceRoute();
      updateRibbonHint();
      render();
    } else if (ev.key === "Tab" && tool === "wall" && !typing && wallCornerRelevant()) {
      // Step through the corner options with the cursor held where it is, so
      // the wall stays exactly where it was drawn while each one is tried.
      ev.preventDefault();
      cycleWallCorner(ev.shiftKey ? -1 : 1);
    } else if (ev.key === " " && selectedDoor()) {
      ev.preventDefault();
      if (flipDoors("hinge")) render();
    } else if (ev.key === " " && tool === "door") {
      ev.preventDefault();
      doorHandSign = doorHandSign === -1 ? 1 : -1;
      setStatusMessage(doorHandSign === -1
        ? "The door hinges at the other end of the opening."
        : "The door hinges at the first end of the opening.");
      render();
    } else if (ev.key === " " && tool === "wall") {
      ev.preventDefault();
      if (wallStartedAgainstWall()) {
        // The side comes from the wall it started on: swap it for this wall.
        wallSideFlip = !wallSideFlip;
        setStatusMessage("Flipped: the wall now sits on the other side of the line.");
      } else {
        wallLocation = cycleWallLocation(wallLocation);
        setStatusMessage(wallLocation === "center"
          ? "Drawing on the centreline."
          : wallLocation === "exterior"
          ? "Drawing on the exterior face. The wall sits to the right of the line as you draw."
          : "Drawing on the interior face. The wall sits to the left of the line as you draw.");
      }
      updateRibbonHint();
      render();
    } else if (ev.key === "Enter" && wallDraft) {
      ev.preventDefault();
      finishWallSegment();
    } else if (ev.key === "Enter" && shapeDraft?.rect) {
      ev.preventDefault();
      finishShapeRect();
    } else if (ev.key === "Enter" && tool === "property" && siteDraft?.length >= 3) {
      finishPropertyLine();
    } else if (ev.key === "Enter" && (currentUnderlayMode() === "align" || currentUnderlayMode() === "adjust") && !el.modeDone.disabled) {
      ev.preventDefault();
      doneUnderlayMode();
    } else if (ev.key === "Enter" && tool === "room" && roomDraft?.length >= 3) {
      ev.preventDefault();
      finishRoomDraft();
    } else if (ev.key === "Enter" && tool === "region" && regionDraft?.length >= 3) {
      ev.preventDefault();
      finishRegionDraft();
    } else if ((ev.key === "Delete" || ev.key === "Backspace") && (store.selected.length || propertySelected)) {
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

function floorSkuForPlacement() {
  const sku = skuById(placeSkuId);
  return sku?.category === "floor" ? sku.id : pack.system.defaultFloorSku;
}

function commitRoomRecord({ shape, seed = null, bound = false }) {
  store.pushUndo();
  store.doc.rooms.push({
    id: nid("r"),
    name: "Room",
    use: "other",
    level: activeLevel,
    wallSku: pack.system.defaultWallSku,
    floorSku: floorSkuForPlacement(),
    status: placementStatus(),
    bound,
    seed,
    shape,
  });
  store.persist();
  return true;
}

function commitRoom(rect) {
  if (!canCommitRect(rect, "room-new")) return false;
  return commitRoomRecord({ shape: rectShape(rect.x, rect.y, rect.w, rect.h) });
}

function commitSlab(rect) {
  if (!canCommitRect(rect, "slab-new")) return false;
  store.pushUndo();
  store.doc.slabs.push({
    id: nid("sl"),
    sku: placeSkuId,
    level: activeLevel,
    status: placementStatus(),
    shape: rectShape(rect.x, rect.y, rect.w, rect.h),
  });
  store.persist();
  return true;
}

function commitRoof(rect) {
  if (!canCommitRect(rect, "roof-new")) return false;
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
  store.persist();
  return true;
}

function commitWall(a, b) {
  if (refuseWrongFoundation()) return false;
  if (!canCommitLine(a, b)) return false;
  const thickness = drawnWallThickness(skuById(placeSkuId));
  const location = effectiveWallLocation(a, b, thickness);
  const plan = wallJoinPlan(a, b, thickness, centerlineFromLocation(a, b, thickness, location));
  const line = plan.center;
  if (lineLength({ x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 }) < MIN_TRACE) return false;
  store.pushUndo();
  for (const move of plan.moves) {
    if (move.end === 2) {
      move.seg.x2 = move.to.x;
      move.seg.y2 = move.to.y;
    } else {
      move.seg.x1 = move.to.x;
      move.seg.y1 = move.to.y;
    }
  }
  const id = nid("s");
  const seg = {
    id, sku: placeSkuId, level: activeLevel,
    x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2,
    status: placementStatus(),
  };
  const newSku = skuById(placeSkuId);
  seg.top = defaultWallTop(pack.levels, activeLevel, skuDrawnHeight(newSku));
  if (isFaceLocation(location)) seg.location = location;
  store.doc.segments.push(seg);
  store.selectOne({ kind: "segment", id });
  store.persist();
  return true;
}

function commitBeam(a, b) {
  if (!canCommitLine(a, b)) return;
  store.pushUndo();
  store.doc.beams.push({ id: nid("b"), sku: placeSkuId, level: activeLevel, x1: a.x, y1: a.y, x2: b.x, y2: b.y, status: placementStatus() });
  store.persist();
}

function placeOpening(wx, wy) {
  const walls = currentWalls().filter(onActiveLevel);
  const draft = openingDraftAt(store.doc, pack, walls, placeSkuId, wx, wy, doorHandSign);
  if (!draft) return;
  store.pushUndo();
  const id = nid("o");
  store.doc.openings.push({ id, status: placementStatus(), ...draft });
  store.selectOne({ kind: "opening", id });
  const door = skuById(draft.sku)?.category === "door";
  tool = "select";
  activeFunction = null;
  doorHandSign = 1;
  syncToolButtons();
  drawRibbon();
  updateRibbonHint();
  store.persist();
  setStatusMessage(door
    ? "Door placed. Drag it along the wall to move it. Drag to the other side to flip the swing. Space flips the hinge."
    : "Window placed. Drag it along the wall to move it. Press Delete to remove it.", "ok");
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

// A user-typed millimetre value from a length/width/height input, snapped to
// the active grid and returned in metres (internal unit). `fallback` is metres.
function parseLengthInput(raw, fallback) {
  const metres = parseLengthMm(raw, null);
  if (metres == null) return fallback;
  return Math.max(0.1, roundGrid(metres, activeGrid()));
}

function wallDraftLength() {
  if (!wallDraft) return 0;
  return segmentLength(wallDraft.x1, wallDraft.y1, wallDraft.x2, wallDraft.y2);
}

function setWallDraftLength(length) {
  if (!wallDraft) return;
  const grid = activeGrid();
  const round = (n) => roundGrid(n, grid);
  const end = setLineLength(
    { x: wallDraft.x1, y: wallDraft.y1 },
    { x: wallDraft.x2, y: wallDraft.y2 },
    length,
    round,
  );
  wallDraft.x2 = end.x;
  wallDraft.y2 = end.y;
}

function setWallDraftHeading(deg) {
  if (!wallDraft) return;
  const grid = activeGrid();
  const end = setLineHeading(
    { x: wallDraft.x1, y: wallDraft.y1 },
    wallDraftLength() || MIN_TRACE,
    deg,
    (n) => roundGrid(n, grid),
  );
  wallDraft.x2 = end.x;
  wallDraft.y2 = end.y;
}

function parseDegrees(raw, fallback) {
  const n = Number(String(raw ?? "").trim().replace(",", "."));
  if (!Number.isFinite(n)) return fallback;
  let d = n % 360;
  if (d < 0) d += 360;
  return d;
}

function syncSizeHud() {
  // Wall length/angle already lives in the top plan-options strip (el.ctxLen /
  // el.ctxAng), so the bottom HUD only needs to appear for rectangle drags
  // (rooms, roofs) where width AND height must be shown together.
  const rectDraft = shapeDraft?.rect;
  el.sizeHud.hidden = !rectDraft;
  if (!rectDraft) return;
  el.sizeHud.classList.remove("length-only");
  if (el.hudWName) el.hudWName.textContent = "Width";
  if (el.hudHint) {
    el.hudHint.textContent = shapeDraft.kind === "roof-new"
      ? "Click the opposite corner. Corners snap to walls; draw past them for an overhang."
      : "Click the opposite corner, or type millimetres. Tab switches width / height.";
  }
  if (document.activeElement !== el.hudW) el.hudW.value = sizeDraft?.lockW ? sizeDraft.typedW : formatLengthMm(shapeDraft.rect.w);
  if (document.activeElement !== el.hudH) el.hudH.value = sizeDraft?.lockH ? sizeDraft.typedH : formatLengthMm(shapeDraft.rect.h);
}

function handleSizeTyping(ev) {
  if (!wallDraft && !shapeDraft) return false;
  if (ev.target !== el.hudW && ev.target !== el.hudH && ev.target !== el.ctxLen) return false;
  if (!sizeDraft) sizeDraft = { lockW: false, lockH: false, typedW: "", typedH: "", axis: "w" };
  if (ev.key === "Enter") {
    ev.preventDefault();
    if (wallDraft) finishWallSegment();
    else if (shapeDraft?.rect) finishShapeRect();
    return true;
  }
  if (ev.key === "Tab" && shapeDraft) {
    ev.preventDefault();
    (ev.target === el.hudW ? el.hudH : el.hudW).focus();
    return true;
  }
  return false;
}

function handleDraftNumericShortcut(ev) {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return false;
  if (!wallDraft && !shapeDraft) return false;
  if (ev.key.length !== 1 || !/[0-9.,]/.test(ev.key)) return false;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return false;
  ev.preventDefault();
  if (!sizeDraft) sizeDraft = { lockW: false, lockH: false, typedW: "", typedH: "", axis: "w" };
  sizeDraft.lockW = true;
  sizeDraft.typedW = ev.key === "," ? "." : ev.key;
  if (wallDraft) setWallDraftLength(parseLengthInput(sizeDraft.typedW, wallDraftLength() || 1));
  render();
  (wallDraft ? el.ctxLen : el.hudW)?.focus();
  return true;
}

el.hudW.addEventListener("input", (ev) => {
  if (!sizeDraft) return;
  sizeDraft.lockW = true;
  sizeDraft.typedW = ev.target.value;
  if (wallDraft) setWallDraftLength(parseLengthInput(sizeDraft.typedW, wallDraftLength() || 1));
  else if (shapeDraft?.rect) shapeDraft.rect.w = parseLengthInput(sizeDraft.typedW, shapeDraft.rect.w);
  render();
});
el.hudH.addEventListener("input", (ev) => {
  if (!sizeDraft) return;
  sizeDraft.lockH = true;
  sizeDraft.typedH = ev.target.value;
  if (shapeDraft?.rect) shapeDraft.rect.h = parseLengthInput(sizeDraft.typedH, shapeDraft.rect.h);
  render();
});

// --- plan header (selection properties) --------------------------------

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let planContextKey = "";

// The dock state at the previous sync, so the type chooser auto-opens only on
// the transition *into* create (arming a draw tool), not on every redraw while
// a tool stays armed - otherwise picking a type could never collapse the list.
let prevDockState = "empty";

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

function showServiceSystem(system) {
  if (!system || !hiddenServiceSystems.delete(system)) return;
  serviceVisKey = "";
}

/** The plan's service chips: one per system that has a route, plus All when there is more than one. */
function syncServiceVisibility() {
  const box = el.serviceVis;
  if (!box || !el.serviceVisList) return;
  const systems = serviceSystemsPresent(store.doc);
  if (!systems.length) {
    box.hidden = true;
    serviceVisKey = "";
    return;
  }
  box.hidden = false;
  const flags = systems.map((id) => (serviceSystemShown(id) ? "1" : "0")).join("");
  const key = `${systems.join(",")}:${flags}`;
  if (key === serviceVisKey) return;
  serviceVisKey = key;
  const allOn = systems.every((id) => serviceSystemShown(id));
  const chips = systems.length > 1
    ? `<button type="button" data-svc-vis="*" aria-pressed="${allOn}" title="${allOn ? "Hide every service on the plan" : "Show every service on the plan"}">All</button>`
    : "";
  el.serviceVisList.innerHTML = chips + systems.map((id) => {
    const on = serviceSystemShown(id);
    const name = SERVICE_CHIP[id] || SERVICE_SYSTEM_INFO[id]?.label || "Service";
    const colour = SERVICE_SYSTEM_INFO[id]?.colour || "#2675b8";
    return `<button type="button" data-svc-vis="${id}" aria-pressed="${on}" title="${on ? "Hide" : "Show"} ${escapeHtml(name)} on the plan"><i style="background:${colour}"></i>${escapeHtml(name)}</button>`;
  }).join("");
}

const FINISH_LAYER_CHIP = {
  floor: { name: "Floors", colour: "#6a8fbf" },
  wall: { name: "Walls", colour: "#4f86a8" },
};

/** Which finish layers this plan is actually drawing, so an empty chip never shows. */
function finishLayersPresent() {
  const floors = (store.doc.finishRegions || []).some((r) => onLevel(r, activeLevel));
  const walls = (wallsCache || []).filter((w) => onActiveLevel(w));
  const wallMarks = walls.length ? planWallFinishMarks(store.doc, pack, walls) : [];
  return { floor: floors, wall: wallMarks.length > 0 };
}

/** The plan's finish chips: Floors and Walls, plus All when both are drawn. */
function syncFinishVisibility() {
  const box = el.finishVis;
  if (!box || !el.finishVisList) return;
  const present = finishLayersPresent();
  const layers = ["floor", "wall"].filter((id) => present[id]);
  if (!layers.length) {
    box.hidden = true;
    finishVisKey = "";
    return;
  }
  box.hidden = false;
  const flags = layers.map((id) => (finishLayerShown(id) ? "1" : "0")).join("");
  const key = `${layers.join(",")}:${flags}`;
  if (key === finishVisKey) return;
  finishVisKey = key;
  const allOn = layers.every((id) => finishLayerShown(id));
  const chips = layers.length > 1
    ? `<button type="button" data-fin-vis="*" aria-pressed="${allOn}" title="${allOn ? "Hide finishes on the plan" : "Show finishes on the plan"}">All</button>`
    : "";
  el.finishVisList.innerHTML = chips + layers.map((id) => {
    const on = finishLayerShown(id);
    const chip = FINISH_LAYER_CHIP[id];
    return `<button type="button" data-fin-vis="${id}" aria-pressed="${on}" title="${on ? "Hide" : "Show"} ${chip.name.toLowerCase()} on the plan"><i style="background:${chip.colour}"></i>${chip.name}</button>`;
  }).join("");
}

function hideFinishLayer(id) {
  hiddenFinishLayers.add(id);
  if (id === "floor") {
    editingRegionId = null;
    hoverFinishRegionId = null;
    selectedRegionVertex = null;
  }
}

if (el.finishVisList) {
  el.finishVisList.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-fin-vis]");
    if (!btn) return;
    const id = btn.dataset.finVis;
    const present = finishLayersPresent();
    const layers = ["floor", "wall"].filter((layer) => present[layer]);
    if (id === "*") {
      const allOn = layers.every((layer) => finishLayerShown(layer));
      for (const layer of layers) {
        if (allOn) hideFinishLayer(layer);
        else hiddenFinishLayers.delete(layer);
      }
    } else if (hiddenFinishLayers.has(id)) {
      hiddenFinishLayers.delete(id);
    } else {
      hideFinishLayer(id);
    }
    finishVisKey = "";
    render();
  });
}

if (el.serviceVisList) {
  el.serviceVisList.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-svc-vis]");
    if (!btn) return;
    const id = btn.dataset.svcVis;
    const systems = serviceSystemsPresent(store.doc);
    if (id === "*") {
      const allOn = systems.every((s) => serviceSystemShown(s));
      for (const s of systems) {
        if (allOn) hiddenServiceSystems.add(s);
        else hiddenServiceSystems.delete(s);
      }
    } else if (hiddenServiceSystems.has(id)) {
      hiddenServiceSystems.delete(id);
    } else {
      hiddenServiceSystems.add(id);
    }
    serviceVisKey = "";
    pruneInvisibleSelection();
    render();
  });
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

/** "Top: up to [level] / fixed height" for a selected drawn wall. Only offered
 * where a level above exists to top out against. */
function syncWallTop(seg) {
  const rise = seg ? levelAboveRise(pack.levels, effectiveLevel(seg, pack)) : null;
  const show = seg && rise !== null && seg.category !== "foundation" && skuById(seg.sku)?.category !== "foundation";
  setHidden(el.ctxTopWrap, !show);
  if (!show || !el.ctxTop) return;
  const above = (pack.levels || [])
    .filter((l) => l.elevation > (pack.levels.find((x) => x.id === effectiveLevel(seg, pack))?.elevation ?? 0) + 1e-6 && l.kind !== "reference" && !l.parentId)
    .sort((a, b) => a.elevation - b.elevation)[0];
  el.ctxTop.options[0].textContent = `Up to ${above?.name || above?.id || "level above"}`;
  if (document.activeElement !== el.ctxTop) el.ctxTop.value = seg.top === "level-above" ? "level-above" : "fixed";
}

/** Wall height for a drawn wall or a room, and sill / width / height for an
 * opening. A blank field means "use the type's value" (or the level above). */
function syncHeightFields(obj, kind) {
  const seg = kind === "segment" ? obj : null;
  const room = kind === "room" ? obj : null;
  const opening = kind === "opening" ? obj : null;
  const segWall = seg ? wallsCache.find((w) => w.id === seg.id) : null;
  const showSegH = Boolean(seg && segWall && segWall.category !== "foundation");
  setHidden(el.ctxWallHWrap, !(showSegH || room));
  if (el.ctxWallH && (showSegH || room) && document.activeElement !== el.ctxWallH) {
    if (showSegH) {
      el.ctxWallH.value = formatLengthMm(segWall.height);
      el.ctxWallH.placeholder = "";
    } else {
      const own = wallsCache.find((w) => !w.drawn && w.roomIds?.includes(room.id));
      el.ctxWallH.value = Number.isFinite(room.wallHeight) ? formatLengthMm(room.wallHeight) : "";
      el.ctxWallH.placeholder = own ? formatLengthMm(own.height) : "type";
    }
  }
  setHidden(el.ctxConvert, !room);

  const size = opening ? openingSize(pack, opening) : null;
  const isWindow = Boolean(opening && skuById(opening.sku)?.category === "window");
  setHidden(el.ctxSillWrap, !isWindow);
  setHidden(el.ctxOWidthWrap, !opening);
  setHidden(el.ctxOHeightWrap, !opening);
  setHidden(el.ctxOSizeNote, !size?.nonStandard);
  if (!opening) return;
  const put = (input, metres) => {
    if (input && document.activeElement !== input) input.value = Number.isFinite(metres) ? formatLengthMm(metres) : "";
  };
  put(el.ctxSill, size.sill);
  put(el.ctxOWidth, size.width);
  put(el.ctxOHeight, size.height);
  const note = el.ctxOSizeNote?.querySelector("strong");
  if (note) note.textContent = "Non-standard size: firm to confirm";
}

/** Metres from a typed mm field, `null` when blank (clear), `undefined` when unusable (ignore). */
function typedMm(raw, { allowZero = false } = {}) {
  const text = String(raw ?? "").trim();
  if (text === "") return null;
  const n = Number(text.replace(",", ".").replace(/mm$/i, "").trim());
  if (!Number.isFinite(n) || n < 0 || (n === 0 && !allowZero) || n > 20000) return undefined;
  return n / 1000;
}

el.ctxWallH?.addEventListener("change", (e) => {
  const value = typedMm(e.target.value);
  if (value === undefined) { render(); return; }
  const seg = soleOf("segment");
  const room = soleOf("room");
  if (seg) {
    store.pushUndo();
    if (value === null) {
      seg.height = null;
      seg.top = defaultWallTop(pack.levels, effectiveLevel(seg, pack), skuDrawnHeight(skuById(seg.sku)));
    } else {
      seg.height = value;
      seg.top = null;
    }
  } else if (room) {
    store.pushUndo();
    room.wallHeight = value;
  } else {
    return;
  }
  store.persist();
  render();
});

function setOpeningSize(field, raw, { allowZero = false } = {}) {
  const opening = soleOf("opening");
  const value = typedMm(raw, { allowZero });
  if (!opening || value === undefined) { render(); return; }
  const g = skuById(opening.sku)?.geometry || {};
  // Typing the type's own value is the same as having no override.
  const typeValue = g[field];
  store.pushUndo();
  opening[field] = value === null || (Number.isFinite(typeValue) && Math.abs(typeValue - value) < 0.0005) ? null : value;
  store.persist();
  render();
}
el.ctxSill?.addEventListener("change", (e) => setOpeningSize("sill", e.target.value, { allowZero: true }));
el.ctxOWidth?.addEventListener("change", (e) => setOpeningSize("width", e.target.value));
el.ctxOHeight?.addEventListener("change", (e) => setOpeningSize("height", e.target.value));

el.ctxConvert?.addEventListener("click", () => {
  const room = soleOf("room");
  if (!room) return;
  const pieces = currentWalls().filter((w) => !w.drawn && w.roomIds?.includes(room.id));
  const segs = pieces.map((w) => drawnSegmentFromWall(w, pack)).filter(Boolean);
  if (!segs.length) return;
  store.pushUndo();
  store.doc.segments.push(...segs);
  store.persist();
  render();
});

el.ctxShapePoly?.addEventListener("click", () => {
  const obj = store.selected.length === 1 ? objByRef(store.primary) : null;
  const kind = store.primary?.kind;
  if (!obj || !["room", "slab", "roof"].includes(kind) || obj.shape?.kind !== "rect") return;
  const next = shapeAsPoly(obj.shape);
  if (!next) return;
  store.pushUndo();
  obj.shape = next;
  store.persist();
  setStatusMessage("Now a polygon. Drag a corner to move it. Corner adds a point on an edge; Line moves the edge.", "ok");
  render();
});

el.ctxTop?.addEventListener("change", (e) => {
  if (store.selected.length !== 1 || store.primary?.kind !== "segment") return;
  const seg = objByRef(store.primary);
  if (!seg) return;
  store.pushUndo();
  seg.top = e.target.value === "level-above" ? "level-above" : null;
  if (seg.top === "level-above") seg.height = null;
  store.persist();
  render();
});

// --- services dock ---------------------------------------------------------

const isServiceRef = (r) => r.kind === "serviceNode" || r.kind === "serviceEdge";

/** True while the dock should be the services panel rather than the type picker. */
function serviceDockActive() {
  if (!el.serviceFields || wallDraft) return false;
  if (tool === "service-route" || tool === "service-connect" || tool === "service-node") return true;
  return store.selected.length > 0 && store.selected.every(isServiceRef);
}

/**
 * The edge whose route the profile should show: the selected run, else a run
 * touching the selected node, else the run just drawn. Null hides the profile.
 */
function serviceProfileEdge() {
  const edges = store.doc.serviceEdges || [];
  const sel = store.selected.filter(isServiceRef);
  const run = sel.find((r) => r.kind === "serviceEdge");
  if (run && edges.some((e) => e.id === run.id)) return run.id;
  const node = sel.find((r) => r.kind === "serviceNode");
  if (node) {
    // Prefer a plan run over a riser leg, so the profile has length to show.
    const touching = edges.filter((e) => e.fromNode === node.id || e.toNode === node.id);
    const nodes = new Map((store.doc.serviceNodes || []).map((n) => [n.id, n]));
    const plan = touching.find((e) => {
      const a = nodes.get(e.fromNode);
      const b = nodes.get(e.toNode);
      return a && b && Math.hypot(a.x - b.x, a.y - b.y) > 1e-4;
    });
    return (plan || touching[0])?.id || null;
  }
  if (!sel.length && serviceRoute?.lastEdgeId && edges.some((e) => e.id === serviceRoute.lastEdgeId)) {
    return serviceRoute.lastEdgeId;
  }
  return null;
}

// --- wall elevation (aansig) ---------------------------------------------

/** The wall face the current selection stands for, or null. */
function selectedElevationFace() {
  if (!pack || wallDraft || store.selected.length !== 1 || !store.primary) return null;
  return faceRefForSelection(store.doc, pack, wallsCache, store.primary, elevationFace);
}

function selectedOpeningId() {
  return store.selected.length === 1 && store.primary?.kind === "opening" ? store.primary.id : null;
}

/** Drawn wall an opening sits in, when that wall can be selected on its own. */
function openingHostSegment() {
  if (!selectedOpeningId()) return null;
  const opening = objByRef(store.primary);
  if (!opening) return null;
  const wall = wallForOpening(store.doc, pack, wallsCache, opening);
  if (!wall?.drawn) return null;
  return { kind: "segment", id: wall.id };
}

/** Put the inspector back on the wall that holds the selected window or door. */
function selectOpeningHostWall() {
  const ref = openingHostSegment();
  if (!ref) return false;
  store.selectOne(ref);
  render();
  return true;
}

/** The edit a drag in progress implies, in viewing coordinates (metres). */
function elevationDragEdit(d) {
  const scaleX = d.scaleX || d.scale;
  const scaleY = d.scaleY || d.scale;
  const dx = (d.x - d.x0) / scaleX;
  const dy = -(d.y - d.y0) / scaleY; // up is positive
  const o = d.orig;
  const MIN = 0.15;
  switch (d.part) {
    // A finish band's edges: a run's ends, and the top and bottom of a run or a room rule.
    case "band-top": return { top: o.top + dy };
    case "band-bottom": return { bottom: o.bottom + dy };
    case "band-left": return { from: o.from + dx };
    case "band-right": return { to: o.to + dx };
    case "move": return { left: o.left + dx, sill: o.category === "door" ? undefined : o.sill + dy };
    case "l": {
      if (o.category === "door") return { left: o.left + dx };
      const width = Math.max(MIN, o.width - dx);
      return { left: o.left + o.width - width, width };
    }
    case "r": return o.category === "door" ? { left: o.left + dx } : { width: Math.max(MIN, o.width + dx) };
    case "t": return { height: Math.max(MIN, o.height + dy) };
    case "b": {
      const height = Math.max(MIN, o.height - dy);
      return { sill: Math.max(0, o.sill + o.height - height), height };
    }
    case "wall-top": return { height: o.height + dy };
    default: return {};
  }
}

/** Apply a drag (an opening, a finish band's edge, or the wall top) to `doc`. */
function applyElevationDrag(doc, face, d) {
  if (d.part === "outline") return applyOutlinePoints(doc, pack, face, d.bandId, d.points, wallsCache);
  const edit = elevationDragEdit(d);
  if (d.part === "wall-top") return applyWallTopEdit(doc, pack, face, edit.height, wallsCache);
  if (d.band) applyBandEdit(doc, pack, face, d.id, edit, wallsCache);
  else applyOpeningEdit(doc, pack, face, d.id, edit, wallsCache);
  return null;
}

/** The model for the open face, with a drag in progress already applied. */
function elevationModelNow(face) {
  if (elevationDrag && elevationDrag.face.wallId === face.wallId && (elevationDrag.moved || elevationDrag.part === "outline")) {
    const preview = {
      ...store.doc,
      openings: structuredClone(store.doc.openings || []),
      finishRuns: structuredClone(store.doc.finishRuns || []),
      rooms: structuredClone(store.doc.rooms || []),
      segments: structuredClone(store.doc.segments || []),
    };
    const applied = applyElevationDrag(preview, face, elevationDrag);
    if (elevationDrag.part === "wall-top") {
      const next = applied?.wallId ? { ...face, wallId: applied.wallId } : face;
      return elevationModel(preview, pack, next);
    }
    return elevationModel(preview, pack, face, wallsCache);
  }
  return elevationModel(store.doc, pack, face, wallsCache);
}

let elevationLayout = null;
// Zoom and pan of the open strip, on top of the fitted wall. Zoom 1 with no
// pan is that fit. The inspector preview does not use this.
let elevationView = { zoom: 1, panX: 0, panY: 0 };
let elevationViewFace = "";
let elevationPan = null;

function setElevationView(next) {
  const fit = elevationLayout?.fit;
  const host = el.elevBody;
  if (!fit || !host || host.clientWidth < 2 || host.clientHeight < 2) {
    elevationView = next;
    return;
  }
  elevationView = clampElevationView(fit, next, host.clientWidth, host.clientHeight);
}

function elevationViewFitted() {
  return elevationView.zoom === 1 && elevationView.panX === 0 && elevationView.panY === 0;
}

function resetElevationView() {
  elevationView = { zoom: 1, panX: 0, panY: 0 };
  elevationViewFace = "";
  elevationPan = null;
  el.elevBody?.classList.remove("is-panning");
}

/**
 * Show the elevation in the strip under the plan while "Open elevation" is on
 * and a wall face is selected. Returns true when it is showing, so the route
 * profile leaves the strip alone.
 */
function syncElevationDock() {
  const dock = el.serviceProfileDock;
  const face = selectedElevationFace();
  const show = Boolean(elevationOpen && face && !serviceDockActive());
  if (elevationOpen && !show && !serviceDockActive()) elevationOpen = false;
  if (!show) {
    if (face) elevationFace = face;
    elevationLayout = null;
    elevationKey = "";
    resetElevationView();
    setHidden(el.elevBody, true);
    setHidden(el.elevFit, true);
    setHidden(el.elevInfo, true);
    closeElevInfo();
    setHidden(el.elevFlip, true);
    setHidden(el.elevEdgeMode, true);
    setHidden(el.serviceProfileCanvas, false);
    setHidden(dock.querySelector(".svc-profile-mode"), false);
    setHidden(document.getElementById("v2-profile-select-all"), false);
    return false;
  }
  elevationFace = face;
  const model = elevationModelNow(face);
  if (!model) {
    elevationOpen = false;
    return false;
  }
  setHidden(dock, false);
  fitServiceProfileHeight();
  setHidden(el.serviceProfileCanvas, true);
  setHidden(dock.querySelector(".svc-profile-mode"), true);
  setHidden(document.getElementById("v2-profile-select-all"), true);
  setHidden(el.elevFlip, false);
  setHidden(el.elevFit, false);
  setHidden(el.elevInfo, false);
  if (el.elevFit) el.elevFit.disabled = elevationViewFitted();
  setHidden(el.elevBody, false);
  const faceKey = `${face.wallId}:${face.side}`;
  if (faceKey !== elevationViewFace) {
    elevationViewFace = faceKey;
    elevationView = { zoom: 1, panX: 0, panY: 0 };
    if (el.elevFit) el.elevFit.disabled = true;
  }
  const shaping = !elevFinishDraft && model.finishBands.some((b) => b.id === selectedBandId && elevRing(b));
  const lineMode = shaping && elevEdgeMode === "line";
  setHidden(el.elevEdgeMode, !shaping);
  el.elevEdgeMode?.querySelectorAll("[data-elev-edge]").forEach((b) => {
    const on = b.dataset.elevEdge === (lineMode ? "line" : "corner");
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
  if (el.serviceProfileTitle) {
    el.serviceProfileTitle.textContent = elevFinishDraft
      ? "Click each corner of the finish. Enter closes the shape. Esc removes the last corner."
      : `Wall elevation · ${model.name} · ${Math.round(model.length * 1000)} mm, ${model.side === 1 ? "face A" : "face B"}`;
  }
  const w = el.elevBody.clientWidth;
  const h = el.elevBody.clientHeight;
  const selectedId = selectedOpeningId();
  const draft = elevFinishDraft && elevFinishDraft.face.wallId === face.wallId ? elevFinishDraft : null;
  const guides = elevationGuides();
  const key = `${w}x${h}|${elevationView.zoom}|${elevationView.panX}|${elevationView.panY}|${selectedId}|${selectedBandId}|${selectedElevVertex}|${lineMode ? "line" : "corner"}|${JSON.stringify(model)}|${JSON.stringify(draft)}|${JSON.stringify(guides)}`;
  if (key === elevationKey) {
    placeElevEdgeMode(model);
    return true;
  }
  elevationKey = key;
  const drawn = elevationSvg(model, { width: w, height: h, interactive: true, selectedId, selectedBandId, selectedVertex: selectedElevVertex, draft, guides, edgeMode: lineMode ? "line" : "corner", view: elevationView });
  elevationLayout = { scale: drawn.scale, scaleX: drawn.scaleX, scaleY: drawn.scaleY, originX: drawn.originX, originY: drawn.originY, fit: drawn.fit };
  el.elevBody.innerHTML = drawn.svg;
  placeElevEdgeMode(model);
  return true;
}

/** Corner / Line sits just above the finish being edited, not in the dock header. */
function placeElevEdgeMode(model) {
  const node = el.elevEdgeMode;
  const host = el.elevBody;
  if (!node || node.hidden || !host || !elevationLayout) return;
  const ring = elevRing(model.finishBands.find((b) => b.id === selectedBandId));
  if (!ring) return;
  const scaleX = elevationLayout.scaleX || elevationLayout.scale;
  const scaleY = elevationLayout.scaleY || elevationLayout.scale;
  const xs = ring.map(([s]) => elevationLayout.originX + s * scaleX);
  const ys = ring.map(([, z]) => elevationLayout.originY - z * scaleY);
  const width = node.offsetWidth || 148;
  const height = node.offsetHeight || 44;
  const left = host.offsetLeft + Math.min(...xs);
  const top = host.offsetTop + Math.min(...ys) - height - 6;
  const minLeft = host.offsetLeft + 8;
  const maxLeft = host.offsetLeft + host.clientWidth - width - 8;
  const minTop = host.offsetTop + 8;
  const maxTop = host.offsetTop + host.clientHeight - height - 8;
  node.style.left = `${Math.round(Math.max(minLeft, Math.min(left, maxLeft)))}px`;
  node.style.top = `${Math.round(Math.max(minTop, Math.min(top, maxTop)))}px`;
}

function elevationPointer(ev, host) {
  const rect = host.getBoundingClientRect();
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
}

function elevationGuides() {
  if (elevFinishDraft && (elevFinishDraft.guideS != null || elevFinishDraft.guideZ != null)) {
    return { s: elevFinishDraft.guideS, z: elevFinishDraft.guideZ };
  }
  if (elevationDrag?.part === "outline" && (elevationDrag.guideS != null || elevationDrag.guideZ != null)) {
    return { s: elevationDrag.guideS, z: elevationDrag.guideZ };
  }
  return null;
}

/** Snap one elevation point to the grid, then to corners and edges on this face. */
function elevAlign(rawS, rawZ, model, points, skipIndex = -1) {
  const sTargets = [0, model.length];
  const zTargets = [0, model.height];
  const skip = new Set(Array.isArray(skipIndex) ? skipIndex : [skipIndex]);
  points.forEach((p, i) => {
    if (skip.has(i)) return;
    sTargets.push(p.s);
    zTargets.push(p.z);
  });
  for (const opening of model.openings || []) {
    sTargets.push(opening.offset, opening.offset + opening.width);
    zTargets.push(opening.sill, opening.sill + opening.height);
  }
  const axis = (raw, hi, targets) => {
    let value = snapElevation(raw);
    let guide = null;
    let bestD = ELEVATION_SNAP * 2;
    for (const t of targets) {
      const d = Math.abs(value - t);
      if (d <= bestD) { value = t; bestD = d; guide = t; }
    }
    value = Math.min(hi, Math.max(0, value));
    if (guide != null && Math.abs(guide - value) > 1e-6) guide = null;
    return { value, guide };
  };
  const s = axis(rawS, model.length, sTargets);
  const z = axis(rawZ, model.height, zTargets);
  return { s: s.value, z: z.value, guideS: s.guide, guideZ: z.guide };
}

function elevRawPoint(ev, host, layout) {
  const p = elevationPointer(ev, host);
  const scaleX = layout.scaleX || layout.scale;
  const scaleY = layout.scaleY || layout.scale;
  return {
    s: (p.x - layout.originX) / scaleX,
    z: (layout.originY - p.y) / scaleY,
  };
}

/** A click on the elevation, in viewing coordinates: along the face, up from the base. */
function elevDraftPoint(ev, host, layout) {
  const model = elevationModelNow(elevFinishDraft.face);
  if (!model) return null;
  const raw = elevRawPoint(ev, host, layout);
  const aligned = elevAlign(raw.s, raw.z, model, elevFinishDraft.points);
  elevFinishDraft.guideS = aligned.guideS;
  elevFinishDraft.guideZ = aligned.guideZ;
  return { s: aligned.s, z: aligned.z };
}

/** Store the shape being clicked on the elevation as a finish on that face. */
function finishElevFinishDraft() {
  const draft = elevFinishDraft;
  if (!draft || draft.points.length < 3) {
    setStatusMessage("A finish needs at least three corners.", "warn");
    return;
  }
  const model = elevationModel(store.doc, pack, draft.face, wallsCache);
  const wall = model ? wallsCache.find((w) => w.id === model.wallId) : null;
  if (!model || !wall) { elevFinishDraft = null; render(); return; }
  const ss = draft.points.map((p) => p.s);
  const zs = draft.points.map((p) => p.z);
  if (Math.max(...ss) - Math.min(...ss) < ELEVATION_SNAP || Math.max(...zs) - Math.min(...zs) < ELEVATION_SNAP) {
    setStatusMessage("The shape is too flat. Click corners that enclose an area.", "warn");
    return;
  }
  // Points are in viewing order. A run keeps them from the wall's first end.
  const outline = draft.points.map((p) => [model.flip ? model.length - p.s : p.s, p.z]);
  const { category, productName } = draft;
  elevFinishDraft = null;
  finishCommit(() => {
    const run = createFinishRun(store.doc, wall, model.side, {
      category,
      productId: productName && category !== "none" ? ensureFinishProduct(store.doc, category, productName) : null,
      outline,
    });
    selectedBandId = `run:${run.id}:${wall.id}:${model.side}`;
    noteBandSaved(selectedBandId);
  });
  setStatusMessage("Finish drawn on this face.", "ok");
}

/** Corners of a finish that can take another node: a drawn outline, or a rectangular run. */
function elevRing(band) {
  if (!band || band.source !== "run") return null;
  if (band.outline?.length >= 3) return band.outline;
  if (!band.editable || !(band.to > band.from) || !(band.top > band.bottom)) return null;
  return [[band.from, band.bottom], [band.to, band.bottom], [band.to, band.top], [band.from, band.top]];
}

function beginOutlineDrag(ev, layout, model, band, mode, index) {
  const ring = elevRing(band);
  if (!ring) return;
  const points = ring.map(([s, z]) => ({ s, z }));
  let vertex = index;
  let inserted = false;
  // Line moves both ends of the edge. Corner inserts a node. Shift swaps them
  // for this one drag, the same way Step and Slope swap on a route.
  const moveEdge = mode === "edge" && (ev.shiftKey ? elevEdgeMode !== "line" : elevEdgeMode === "line");
  if (mode === "edge" && !moveEdge) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const raw = elevRawPoint(ev, ev.currentTarget, layout);
    const dx = b.s - a.s;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((raw.s - a.s) * dx + (raw.z - a.z) * dz) / len2));
    points.splice(index + 1, 0, { s: a.s + dx * t, z: a.z + dz * t });
    vertex = index + 1;
    inserted = true;
  }
  const raw = elevRawPoint(ev, ev.currentTarget, layout);
  selectedBandId = band.id;
  selectedElevVertex = mode === "move" || moveEdge ? null : vertex;
  elevationDrag = {
    part: "outline",
    bandId: band.id,
    id: band.id,
    band: false,
    face: { ...elevationFace },
    scale: layout.scale,
    scaleX: layout.scaleX || layout.scale,
    scaleY: layout.scaleY || layout.scale,
    points,
    origin: points.map((p) => ({ ...p })),
    index: vertex,
    moveAll: mode === "move",
    moveEdge,
    edge: moveEdge ? index : null,
    originOutline: Boolean(band.outline?.length >= 3),
    grab: { s: raw.s, z: raw.z },
    inserted,
    moved: false,
    guideS: null,
    guideZ: null,
    x0: 0,
    y0: 0,
    x: 0,
    y: 0,
    orig: {},
  };
  ev.currentTarget.setPointerCapture(ev.pointerId);
  ev.preventDefault();
  render();
}

function onElevationPointerDown(ev, layout) {
  // Middle button and Alt-drag pan the open strip, as they do on the plan.
  // Pan mode's left-drag does the same. The gesture never starts an edit.
  if (ev.currentTarget === el.elevBody && (ev.button === 1 || ev.altKey || (panMode && ev.button === 0))) {
    elevationPan = {
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      panX: elevationView.panX,
      panY: elevationView.panY,
    };
    ev.currentTarget.classList.add("is-panning");
    try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch { /* capture can fail if the pointer already ended */ }
    ev.preventDefault();
    return;
  }
  if (ev.button !== 0 || !elevationFace || !layout) return;
  // The inspector graph is a picture. A finish click opens a callout under it
  // instead of scrolling the inspector down to that finish's card.
  if (ev.currentTarget === el.ctxElev && !(elevFinishDraft && elevFinishDraft.face.wallId === elevationFace.wallId)) {
    const fillHit = ev.target.closest?.("[data-elev-fill]");
    if (fillHit) {
      showPreviewFinish(ev, fillHit.dataset.elevFill);
      return;
    }
    const openingHit = ev.target.closest?.("[data-elev-id]");
    if (openingHit?.dataset.elevId) {
      showPreviewOpening(ev, openingHit.dataset.elevId);
      return;
    }
    closePreviewCallout();
    // A window or door has taken the inspector. Clicking the wall puts it
    // back. The opening itself is not dragged from this graph.
    if (store.primary?.kind === "opening" && ev.target.closest?.("[data-elev-wall]")) {
      selectOpeningHostWall();
      ev.preventDefault();
    }
    return;
  }
  if (elevFinishDraft && layout.originX != null && elevFinishDraft.face.wallId === elevationFace.wallId) {
    const pt = elevDraftPoint(ev, ev.currentTarget, layout);
    if (!pt) return;
    const first = elevFinishDraft.points[0];
    if (first && elevFinishDraft.points.length >= 3 && Math.hypot(pt.s - first.s, pt.z - first.z) <= ELEVATION_SNAP) {
      finishElevFinishDraft();
      ev.preventDefault();
      return;
    }
    const last = elevFinishDraft.points[elevFinishDraft.points.length - 1];
    if (!last || last.s !== pt.s || last.z !== pt.z) elevFinishDraft.points.push(pt);
    elevFinishDraft.hover = null;
    const n = elevFinishDraft.points.length;
    setStatusMessage(n >= 3
      ? `Corner ${n} placed. Enter closes the shape, or click the first corner.`
      : `Corner ${n} placed. Keep clicking each corner.`, "ok");
    ev.preventDefault();
    render();
    return;
  }
  const outlineHit = ev.target.closest?.("[data-elev-op='outline-vertex'],[data-elev-op='outline-edge']");
  if (outlineHit && layout.originX != null) {
    const model = elevationModel(store.doc, pack, elevationFace, wallsCache);
    const band = model?.finishBands.find((b) => b.id === outlineHit.dataset.elevBand);
    if (elevRing(band)) {
      beginOutlineDrag(
        ev, layout, model, band,
        outlineHit.dataset.elevOp === "outline-edge" ? "edge" : "vertex",
        Number(outlineHit.dataset.elevIndex),
      );
      return;
    }
  }
  const target = ev.target.closest?.("[data-elev-op]");
  if (!target) {
    // A window or door has taken the inspector. Clicking the wall — or a
    // finish painted on it — puts the wall back, without a trip to the plan.
    const fillHit = ev.target.closest?.("[data-elev-fill]");
    if (store.primary?.kind === "opening" && (fillHit || ev.target.closest?.("[data-elev-wall]"))) {
      if (selectOpeningHostWall() && fillHit) selectBand(fillHit.dataset.elevFill);
      ev.preventDefault();
      return;
    }
    const fill = fillHit;
    if (fill && layout.originX != null && fill.dataset.elevFill === selectedBandId) {
      const model = elevationModel(store.doc, pack, elevationFace, wallsCache);
      const band = model?.finishBands.find((b) => b.id === fill.dataset.elevFill);
      if (elevRing(band)) {
        beginOutlineDrag(ev, layout, model, band, "move", 0);
        return;
      }
    }
    if (fill && fill.dataset.elevFill !== selectedBandId) selectBand(fill.dataset.elevFill);
    selectedElevVertex = null;
    return;
  }
  const part = target.dataset.elevOp;
  const model = elevationModel(store.doc, pack, elevationFace, wallsCache);
  const bandId = target.dataset.elevBand;
  const id = bandId || target.dataset.elevId;
  const band = bandId ? model?.finishBands.find((b) => b.id === bandId) : null;
  const row = !bandId && part !== "wall-top" ? model?.openings.find((o) => o.id === id) : null;
  if (part === "wall-top") {
    if (!model?.canDragTop) return;
  } else if (!band && !row) {
    return;
  }
  if (row && selectedOpeningId() !== id) {
    store.selectOne({ kind: "opening", id });
    render();
  }
  const p = elevationPointer(ev, ev.currentTarget);
  elevationDrag = {
    id: part === "wall-top" ? model.wallId : id,
    part,
    band: Boolean(band),
    face: { ...elevationFace },
    scale: layout.scale,
    scaleX: layout.scaleX || layout.scale,
    scaleY: layout.scaleY || layout.scale,
    x0: p.x,
    y0: p.y,
    x: p.x,
    y: p.y,
    moved: false,
    orig: part === "wall-top"
      ? { height: model.height }
      : band
        ? { from: band.from, to: band.to, bottom: band.bottom, top: band.top }
        : { left: row.offset, width: row.width, sill: row.sill, height: row.height, category: row.category },
  };
  ev.currentTarget.setPointerCapture(ev.pointerId);
  ev.preventDefault();
}

function onElevationPointerMove(ev) {
  if (elevationPan && ev.currentTarget === el.elevBody) {
    // At the fitted zoom the wall already fills the strip; sliding it only
    // hides the next floor. Panning starts once the view is zoomed in.
    if (elevationView.zoom > 1) {
      setElevationView({
        zoom: elevationView.zoom,
        panX: elevationPan.panX + (ev.clientX - elevationPan.startX),
        panY: elevationPan.panY + (ev.clientY - elevationPan.startY),
      });
      render();
    }
    return;
  }
  if (elevationDrag?.part === "outline") {
    const layout = ev.currentTarget === el.elevBody ? elevationLayout : elevPreviewLayout;
    const model = elevationModel(store.doc, pack, elevationDrag.face, wallsCache);
    if (!layout || layout.originX == null || !model) return;
    const raw = elevRawPoint(ev, ev.currentTarget, layout);
    const d = elevationDrag;
    if (d.moveAll) {
      let ds = raw.s - d.grab.s;
      let dz = raw.z - d.grab.z;
      let minS = Infinity;
      let maxS = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const p of d.origin) {
        minS = Math.min(minS, p.s);
        maxS = Math.max(maxS, p.s);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      }
      ds = Math.min(model.length - maxS, Math.max(-minS, ds));
      dz = Math.min(model.height - maxZ, Math.max(-minZ, dz));
      d.points = d.origin.map((p) => ({ s: p.s + ds, z: p.z + dz }));
      d.guideS = null;
      d.guideZ = null;
      if (Math.hypot(ds, dz) > 0.01) d.moved = true;
    } else if (d.moveEdge) {
      const i = d.edge;
      const j = (i + 1) % d.origin.length;
      const a0 = d.origin[i];
      const aligned = elevAlign(a0.s + (raw.s - d.grab.s), a0.z + (raw.z - d.grab.z), model, d.origin, [i, j]);
      const next = translateOutlineEdge(d.origin, i, aligned.s - a0.s, aligned.z - a0.z, model.length, model.height);
      const moved = next[i];
      d.points = next;
      d.guideS = Math.abs(moved.s - aligned.s) < 1e-6 ? aligned.guideS : null;
      d.guideZ = Math.abs(moved.z - aligned.z) < 1e-6 ? aligned.guideZ : null;
      if (Math.hypot(moved.s - a0.s, moved.z - a0.z) > 0.01) d.moved = true;
    } else {
      const aligned = elevAlign(raw.s, raw.z, model, d.origin, d.index);
      d.points[d.index] = { s: aligned.s, z: aligned.z };
      d.guideS = aligned.guideS;
      d.guideZ = aligned.guideZ;
      const was = d.origin[d.index];
      if (was && Math.hypot(aligned.s - was.s, aligned.z - was.z) > 0.01) d.moved = true;
    }
    render();
    return;
  }
  if (elevFinishDraft && !elevationDrag) {
    const layout = ev.currentTarget === el.elevBody ? elevationLayout : elevPreviewLayout;
    if (layout?.originX != null && elevFinishDraft.face.wallId === elevationFace?.wallId) {
      elevFinishDraft.hover = elevDraftPoint(ev, ev.currentTarget, layout);
      render();
    }
    return;
  }
  const d = elevationDrag;
  if (!d) return;
  const p = elevationPointer(ev, ev.currentTarget);
  d.x = p.x;
  d.y = p.y;
  if (Math.hypot(p.x - d.x0, p.y - d.y0) > 3) d.moved = true;
  if (d.moved) render();
}

function endElevationDrag(commit) {
  const d = elevationDrag;
  elevationDrag = null;
  if (!d) return;
  if (d.part === "outline") {
    if (commit && (d.moved || d.inserted)) {
      store.pushUndo();
      const stayedRect = !d.inserted && !d.originOutline && axisAlignedOutline(d.points);
      if (stayedRect) applyBandEdit(store.doc, pack, d.face, d.bandId, stayedRect, wallsCache);
      else applyOutlinePoints(store.doc, pack, d.face, d.bandId, d.points, wallsCache);
      store.persist();
      finishKey = "";
      if (d.inserted) setStatusMessage("Corner added. Drag it, or click another edge. Delete removes the selected corner.", "ok");
      else if (d.moveEdge) setStatusMessage("Line moved.", "ok");
    }
    render();
    return;
  }
  if (commit && d.moved) {
    // One drag is one undo step.
    store.pushUndo();
    const applied = applyElevationDrag(store.doc, d.face, d);
    if (d.part === "wall-top" && applied?.wallId && applied.wallId !== d.face.wallId) {
      elevationFace = { ...d.face, wallId: applied.wallId };
      if (store.primary?.kind === "segment") store.selectOne({ kind: "segment", id: applied.wallId });
    }
    store.persist();
    finishKey = "";
  }
  render();
}

function endElevationPan(ev) {
  if (!elevationPan || (ev && elevationPan.pointerId !== ev.pointerId)) return;
  elevationPan = null;
  el.elevBody?.classList.remove("is-panning");
}

function bindElevationHost(node, layoutOf) {
  if (!node) return;
  node.addEventListener("pointerdown", (ev) => onElevationPointerDown(ev, layoutOf()));
  node.addEventListener("pointermove", onElevationPointerMove);
  node.addEventListener("pointerup", (ev) => {
    if (node === el.elevBody) endElevationPan(ev);
    endElevationDrag(true);
  });
  node.addEventListener("pointercancel", (ev) => {
    if (node === el.elevBody) endElevationPan(ev);
    endElevationDrag(false);
  });
}

let elevPreviewLayout = null;
bindElevationHost(el.elevBody, () => elevationLayout);
bindElevationHost(el.ctxElev, () => elevPreviewLayout);

function onElevationWheel(ev) {
  if (!elevationLayout?.fit) return;
  ev.preventDefault();
  // A drag already stored the scale it started with. Zooming under it would
  // make the same pixel delta mean a different distance.
  if (elevationDrag || elevationPan) return;
  const rect = el.elevBody.getBoundingClientRect();
  const px = ev.clientX - rect.left;
  const py = ev.clientY - rect.top;
  const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
  setElevationView(zoomElevationView(elevationLayout.fit, elevationView, px, py, factor));
  render();
}

el.elevBody?.addEventListener("wheel", onElevationWheel, { passive: false });

el.elevFit?.addEventListener("click", () => {
  elevationView = { zoom: 1, panX: 0, panY: 0 };
  render();
});

function closeElevInfo() {
  setHidden(el.elevInfoNote, true);
  el.elevInfo?.setAttribute("aria-expanded", "false");
}

el.elevInfo?.addEventListener("click", () => {
  const open = Boolean(el.elevInfoNote?.hidden);
  setHidden(el.elevInfoNote, !open);
  el.elevInfo.setAttribute("aria-expanded", String(open));
});

document.addEventListener("pointerdown", (ev) => {
  if (!el.elevInfoNote || el.elevInfoNote.hidden) return;
  if (ev.target.closest?.("#v2-elev-info, #v2-elev-info-note")) return;
  closeElevInfo();
});

el.ctxElevOpen?.addEventListener("click", () => {
  elevationOpen = !elevationOpen;
  render();
});

el.elevFlip?.addEventListener("click", () => {
  if (!elevationFace) return;
  elevationFace = { ...elevationFace, side: elevationFace.side === -1 ? 1 : -1 };
  render();
});

el.elevEdgeMode?.addEventListener("click", (ev) => {
  const mode = ev.target.closest?.("[data-elev-edge]")?.dataset.elevEdge;
  if (mode !== "corner" && mode !== "line") return;
  elevEdgeMode = mode;
  render();
});

el.ctxOOffset?.addEventListener("change", (e) => {
  const opening = soleOf("opening");
  const value = typedMm(e.target.value, { allowZero: true });
  const face = selectedElevationFace();
  if (!opening || !face || value === undefined || value === null) { render(); return; }
  store.pushUndo();
  applyOpeningEdit(store.doc, pack, face, opening.id, { left: value }, wallsCache);
  store.persist();
  render();
});

/** Inspector side of the elevation: the small preview, Open elevation, and the opening's offset.
 *  The preview does not drag wall height; that handle is only on the open elevation. */
function syncElevationPreview() {
  const face = selectedElevationFace();
  const model = face ? elevationModelNow(face) : null;
  setHidden(el.ctxElevWrap, !model);
  const opening = model && selectedOpeningId() ? model.openings.find((o) => o.id === selectedOpeningId()) : null;
  setHidden(el.ctxOOffsetWrap, !opening);
  if (opening && el.ctxOOffset && document.activeElement !== el.ctxOOffset) el.ctxOOffset.value = formatLengthMm(opening.offset);
  if (!model) {
    elevPreviewKey = "";
    elevPreviewLayout = null;
    previewCallout = null;
    syncFinishPreviewCallout(null);
    return;
  }
  if (el.ctxElevOpen) el.ctxElevOpen.textContent = elevationOpen ? "Close elevation" : "Open elevation";
  syncFinishPreviewCallout(model);
  const w = Math.max(120, Math.round(el.ctxElev?.clientWidth || 240));
  const draft = elevFinishDraft && elevFinishDraft.face.wallId === face.wallId ? elevFinishDraft : null;
  const key = `${w}|${selectedOpeningId()}|${selectedBandId}|${JSON.stringify(model)}|${JSON.stringify(draft)}`;
  if (key === elevPreviewKey) return;
  elevPreviewKey = key;
  const drawn = elevationSvg(model, { width: w, height: 130, selectedId: selectedOpeningId(), selectedBandId, draft, guides: elevationGuides() });
  elevPreviewLayout = { scale: drawn.scale, scaleX: drawn.scaleX, scaleY: drawn.scaleY, originX: drawn.originX, originY: drawn.originY };
  el.ctxElev.innerHTML = drawn.svg;
}

// --- finishes (finish-model.js) --------------------------------------------
//
// The inspector's finish section: room rules and presets, what is on the
// selected wall face (and a form for drawing a run on it), and the products on
// this job. Markup is finish-panel.js; the events are delegated here.

function finishFaceModel() {
  const face = selectedElevationFace();
  return face ? elevationModel(store.doc, pack, face, wallsCache) : null;
}

function syncFinishPanel(room, slab) {
  const host = el.ctxFinish;
  if (!host) return;
  const model = room || slab ? null : finishFaceModel();
  if (!room && !slab && !model) {
    setHidden(host, true);
    finishKey = "";
    finishAddOpen = null;
    finishPanelHost = "";
    return;
  }
  setHidden(host, false);
  const hostId = room ? `room:${room.id}` : slab ? `slab:${slab.id}` : `face:${model.wallId}:${model.side}`;
  if (hostId !== finishPanelHost) {
    finishPanelHost = hostId;
    finishAddOpen = null;
  }
  const editingId = editingFinishRegion()?.id || null;
  const floorOpts = (kind, id) => ({
    savedRegionId: finishSavedRegionId,
    bareOn: bareFinishHost?.kind === kind && bareFinishHost?.id === id,
    adding: finishAddOpen === "floor",
  });
  const html = (room ? roomFinishHtml(store.doc, room, editingId, floorOpts("room", room.id)) : slab ? slabFinishHtml(store.doc, slab, editingId, floorOpts("slab", slab.id)) : faceFinishHtml(store.doc, model, { selectedId: selectedBandId, savedId: finishSavedBandId, adding: finishAddOpen === "face" }))
    + productsHtml(store.doc, { open: finishProductsOpen });
  if (html !== finishKey) {
    // A cleared key means the finish was just saved, so the panel has to catch up.
    // Otherwise leave an input alone while someone is still typing in it.
    const typing = host.contains(document.activeElement) && document.activeElement?.matches?.("input");
    if (!(typing && finishKey)) {
      finishKey = html;
      host.innerHTML = html;
    }
  }
  if (editingId !== finishScrolledId) {
    finishScrolledId = editingId || null;
    if (editingId) host.querySelector(`[data-fin-region="${editingId}"]`)?.scrollIntoView({ block: "nearest" });
  }
  for (const card of host.querySelectorAll("[data-fin-region]")) {
    card.classList.toggle("fin-hot", card.dataset.finRegion === hoverFinishRegionId);
  }
  for (const card of host.querySelectorAll("[data-fin-band]")) {
    card.classList.toggle("fin-hot", card.dataset.finBand === hoverBandId);
  }
  markHotBand();
}

function finishField(name) {
  return el.ctxFinish?.querySelector(`[data-fin="${name}"]`) || null;
}

/** The finish and product name the new-finish form is aimed at. */
function chosenRegionTarget(btn) {
  const form = btn.closest("[data-fin-new]");
  const category = form?.querySelector("[data-fin='region-category']")?.value;
  if (!category) return null;
  return { category, productName: String(form?.querySelector("[data-fin='new-product-name']")?.value || "").trim() };
}

/** Use a product of this finish with this name, creating it on the job when it is new. */
function ensureFinishProduct(doc, category, name) {
  const text = String(name || "").trim();
  if (!text) return null;
  const found = (doc.finishProducts || []).find((p) => p.category === category && (
    (p.name || "").toLowerCase() === text.toLowerCase()
    || [p.name, p.size, p.supplier].filter(Boolean).join(" · ").toLowerCase() === text.toLowerCase()
  ));
  if (found) return found.id;
  const id = finishId("fp");
  doc.finishProducts = normalizeFinishProducts([...(doc.finishProducts || []), { id, category, name: text }]);
  return id;
}

function finishCommit(mutate) {
  store.pushUndo();
  mutate();
  store.persist();
  finishKey = "";
  render();
}

function finishRule(room, node) {
  const id = node?.closest("[data-fin-rule]")?.dataset.finRule;
  return room && id ? (room.finishes || []).find((r) => r.id === id) || null : null;
}

/** The room a floor region is drawn in: the one on this level holding its centre. */
function roomHoldingPoly(poly) {
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return (store.doc.rooms || []).find((r) => effectiveLevel(r, pack) === activeLevel && pointInPoly(cx, cy, roomPolygon(r))) || null;
}

function finishFloorRegionDraft() {
  const target = regionFinish;
  const poly = regionDraft.map((p) => [p.x, p.y]);
  const room = roomHoldingPoly(poly);
  store.pushUndo();
  const productId = target.productName ? ensureFinishProduct(store.doc, target.category, target.productName) : (target.productId || null);
  createFinishRegion(store.doc, {
    level: activeLevel,
    roomId: room?.id || null,
    slabId: target.slabId || null,
    category: target.category || null,
    productId,
    shape: polyShape(poly),
  });
  const slabId = target.slabId || null;
  regionDraft = null;
  regionFinish = null;
  tool = "select";
  activeFunction = null;
  // Back on whatever it was drawn from, so its corners can be edited straight away.
  if (slabId) store.setSelection([{ kind: "slab", id: slabId }]);
  else if (room) store.setSelection([{ kind: "room", id: room.id }]);
  syncToolButtons();
  drawRibbon();
  store.persist();
  finishKey = "";
  setStatusMessage(room
    ? `Floor region added; it comes out of ${room.name}'s floor.`
    : slabId
      ? "Floor region added on this floor."
      : "Floor region added, but it is not inside a room, so nothing is taken out of a floor.", room || slabId ? "ok" : "warn");
  render();
}

el.ctxFinish?.addEventListener("toggle", (e) => {
  if (e.target?.matches?.("details[data-fin-block='products']")) finishProductsOpen = e.target.open;
}, true);

/** The stored run or room rule behind a wall finish band, or null for the computed default. */
function bandSource(doc, band) {
  if (band.source === "run") return (doc.finishRuns || []).find((r) => r.id === band.sourceId) || null;
  if (band.source === "rule") {
    for (const room of doc.rooms || []) {
      const rule = (room.finishes || []).find((r) => r.id === band.sourceId);
      if (rule) return rule;
    }
  }
  return null;
}

/** Fill the add form's height fields from a preset; "custom" leaves them to be typed. */
function applyHeightPreset(form, id) {
  const preset = HEIGHT_PRESETS.find((p) => p.id === id);
  const bottom = form?.querySelector("[data-fin='run-bottom']");
  const top = form?.querySelector("[data-fin='run-top']");
  const custom = form?.querySelector("[data-fin-custom]");
  if (custom) custom.hidden = id !== "custom";
  if (!preset || preset.bottom === null || !bottom || !top) return;
  bottom.value = String(Math.round(preset.bottom * 1000));
  top.value = preset.top === null ? "" : String(Math.round(preset.top * 1000));
}

function noteBandSaved(id) {
  finishSavedBandId = id;
  window.clearTimeout(finishSavedTimer);
  finishSavedTimer = window.setTimeout(() => {
    finishSavedBandId = null;
    el.ctxFinish?.querySelectorAll(".fin-saved").forEach((node) => node.remove());
  }, 1600);
}

/** Mark the elevation band the pointer is on in the list (or on the elevation) as hot. */
function markHotBand() {
  for (const host of [el.elevBody, el.ctxElev]) {
    if (!host) continue;
    for (const node of host.querySelectorAll("[data-elev-fill]")) {
      node.classList.toggle("is-hot", node.dataset.elevFill === hoverBandId);
    }
  }
}

function setHoverBand(id) {
  if (id === hoverBandId) return;
  hoverBandId = id;
  el.ctxFinish?.querySelectorAll("[data-fin-band]").forEach((card) => {
    card.classList.toggle("fin-hot", card.dataset.finBand === id);
  });
  markHotBand();
}

/** Pick a wall finish, in the list or on the elevation, and bring its card into view. */
function selectBand(id) {
  selectedBandId = id;
  selectedElevVertex = null;
  finishKey = "";
  if (id) setStatusMessage("Drag a corner, or click an edge to add one.", "ok");
  render();
  if (id) el.ctxFinish?.querySelectorAll("[data-fin-band]").forEach((card) => {
    if (card.dataset.finBand === id) card.scrollIntoView({ block: "nearest" });
  });
}

/** A finish on the inspector graph: keep the graph where it is and show its callout. */
function showPreviewFinish(ev, id) {
  holdInspectorGraph(() => {
    previewCallout = { kind: "finish", id };
    selectedBandId = id;
    selectedElevVertex = null;
    finishKey = "";
    ev.preventDefault();
    const switched = store.primary?.kind === "opening" && selectOpeningHostWall();
    if (!switched) render();
  });
}

/** A window or door on the inspector graph. Selecting it does not move it. */
function showPreviewOpening(ev, id) {
  holdInspectorGraph(() => {
    openingCalloutClosed = null;
    previewCallout = { kind: "opening", id };
    ev.preventDefault();
    if (selectedOpeningId() !== id) store.selectOne({ kind: "opening", id });
    render();
  });
}

/** A click on the graph changes the inspector around it. Keep the graph still. */
function holdInspectorGraph(run) {
  const scroller = document.getElementById("v2-ctx-body");
  const graph = el.ctxElevWrap;
  const before = graph && !graph.hidden ? graph.getBoundingClientRect().top : null;
  run();
  if (before == null || !scroller || !graph || graph.hidden) return;
  const delta = graph.getBoundingClientRect().top - before;
  if (Math.abs(delta) > 1) scroller.scrollTop += delta;
}

function closePreviewCallout() {
  if (previewCallout?.kind === "opening") openingCalloutClosed = previewCallout.id;
  if (!previewCallout && !el.ctxElevCallout?.innerHTML) return;
  previewCallout = null;
  if (el.ctxElevCallout) {
    el.ctxElevCallout.hidden = true;
    el.ctxElevCallout.innerHTML = "";
  }
}

/** The temporary note on the inspector graph: the finish that was clicked, or the selected opening. */
function syncFinishPreviewCallout(model) {
  const node = el.ctxElevCallout;
  if (!node) return;
  const openingId = selectedOpeningId();
  if (openingCalloutClosed && openingCalloutClosed !== openingId) openingCalloutClosed = null;
  let html = "";
  if (previewCallout?.kind === "finish") {
    const band = model?.finishBands.find((b) => b.id === previewCallout.id);
    if (band) html = finishCalloutHtml(store.doc, band, model);
    else previewCallout = null;
  }
  if (!html) {
    const opening = openingId && model?.openings.find((o) => o.id === openingId);
    if (opening && openingCalloutClosed !== opening.id) {
      previewCallout = { kind: "opening", id: opening.id };
      html = openingCalloutHtml(opening);
    } else if (previewCallout?.kind === "opening") {
      previewCallout = null;
    }
  }
  if (!html) {
    node.hidden = true;
    node.innerHTML = "";
    return;
  }
  if (node.innerHTML !== html) node.innerHTML = html;
  node.hidden = false;
}

/** Open the elevation under the plan on this finish, so its corners can be edited there. */
function openFinishProfile(id) {
  selectedBandId = id;
  selectedElevVertex = null;
  elevationOpen = true;
  finishKey = "";
  const band = finishFaceModel()?.finishBands.find((b) => b.id === id);
  if (band && elevRing(band)) setStatusMessage("Drag a corner, or click an edge to add one.", "ok");
  render();
}

/** Take one finish off the face. A room rule leaves every wall of that room. */
function removeFinishBand(band) {
  const doc = store.doc;
  const model = finishFaceModel();
  if (selectedBandId === band?.id) selectedBandId = null;
  if (previewCallout?.kind === "finish" && previewCallout.id === band?.id) previewCallout = null;
  if (band?.source === "run") {
    finishCommit(() => { doc.finishRuns = doc.finishRuns.filter((r) => r.id !== band.sourceId); });
  } else if (band?.source === "rule") {
    finishCommit(() => {
      for (const r of doc.rooms || []) r.finishes = (r.finishes || []).filter((x) => x.id !== band.sourceId);
    });
  } else if (band?.source === "default") {
    const wall = model ? wallsCache.find((w) => w.id === model.wallId) : null;
    if (!model || !wall) return;
    finishCommit(() => {
      const wholeW = band.from <= 1e-6 && band.to >= model.length - 1e-6;
      const wholeH = band.bottom <= 1e-6 && band.top >= model.height - 1e-6;
      createFinishRun(doc, wall, model.side, {
        category: "none",
        from: wholeW ? null : (model.flip ? wall.length - band.to : band.from),
        to: wholeW ? null : (model.flip ? wall.length - band.from : band.to),
        bottom: band.bottom,
        top: wholeH ? null : band.top,
      });
    });
  }
}

el.ctxElevCallout?.addEventListener("click", (e) => {
  const btn = e.target.closest?.("button[data-fin]");
  if (!btn) return;
  if (btn.dataset.fin === "callout-close") {
    closePreviewCallout();
    return;
  }
  if (btn.dataset.fin === "opening-edit") {
    closePreviewCallout();
    elevationOpen = true;
    render();
    return;
  }
  if (!pack) return;
  const id = btn.closest("[data-fin-band]")?.dataset.finBand;
  const band = finishFaceModel()?.finishBands.find((b) => b.id === id);
  if (!band) return;
  if (btn.dataset.fin === "band-edit") openFinishProfile(band.id);
});

el.ctxFinish?.addEventListener("pointerover", (e) => {
  setHoverBand(e.target.closest?.("[data-fin-band]")?.dataset.finBand || null);
});
el.ctxFinish?.addEventListener("pointerleave", () => setHoverBand(null));
for (const host of [el.elevBody, el.ctxElev]) {
  host?.addEventListener("pointerover", (e) => {
    setHoverBand(e.target.closest?.("[data-elev-fill]")?.dataset.elevFill || null);
  });
  host?.addEventListener("pointerleave", () => setHoverBand(null));
}

function noteFinishSaved(id) {
  finishSavedRegionId = id;
  window.clearTimeout(finishSavedTimer);
  finishSavedTimer = window.setTimeout(() => {
    finishSavedRegionId = null;
    el.ctxFinish?.querySelectorAll(".fin-saved").forEach((node) => node.remove());
  }, 1600);
}

el.ctxFinish?.addEventListener("pointerover", (e) => {
  const id = e.target.closest?.("[data-fin-region]")?.dataset.finRegion || null;
  if (!id || id === hoverFinishRegionId) return;
  hoverFinishRegionId = id;
  render();
});

el.ctxFinish?.addEventListener("pointerout", (e) => {
  const card = e.target.closest?.("[data-fin-region]");
  if (!card || e.relatedTarget?.closest?.("[data-fin-region]") === card) return;
  if (hoverFinishRegionId !== card.dataset.finRegion) return;
  hoverFinishRegionId = null;
  render();
});

el.ctxFinish?.addEventListener("click", (e) => {
  const btn = e.target.closest?.("button[data-fin]");
  if (!btn) {
    const band = e.target.closest?.("[data-fin-band]");
    if (band && !e.target.closest("input, select, textarea, label") && band.dataset.finBand !== selectedBandId) {
      selectBand(band.dataset.finBand);
      return;
    }
    const card = e.target.closest?.("[data-fin-region]");
    if (card && !e.target.closest("input, select, textarea, label") && pack) {
      const id = card.dataset.finRegion;
      if (id && id !== editingRegionId) {
        editingRegionId = id;
        selectedRegionVertex = null;
        finishKey = "";
        const region = (store.doc.finishRegions || []).find((r) => r.id === id);
        if (region && regionCoversHost(region)) {
          setStatusMessage("Editing the finish. Press Done to edit the floor again. Until then the floor stays put.", "ok");
        }
        render();
      }
    }
    return;
  }
  if (!pack) return;
  const action = btn.dataset.fin;
  const room = soleOf("room");
  const slab = soleOf("slab");
  const row = btn.closest("[data-fin-rule],[data-fin-band],[data-fin-product],[data-fin-region]");
  const doc = store.doc;

  if (action === "rule-add" && room) {
    const category = finishField("new-rule-category")?.value;
    if (!category) return;
    const name = String(finishField("new-rule-product")?.value || "").trim();
    finishCommit(() => {
      if (!Array.isArray(room.finishes)) room.finishes = [];
      room.finishes.push({
        id: finishId("fr"), surface: "wall", category,
        productId: name ? ensureFinishProduct(doc, category, name) : null,
        bottom: 0, top: null, faces: "all",
      });
    });
  } else if (action === "rule-remove" && room) {
    const rule = finishRule(room, btn);
    if (rule) finishCommit(() => { room.finishes = room.finishes.filter((r) => r !== rule); });
  } else if (action === "preset-save" && room) {
    const name = String(finishField("preset-name")?.value || "").trim();
    if (!name) { setStatusMessage("Give the preset a name first.", "warn"); return; }
    const preset = presetFromRoom(room, name);
    if (preset) finishCommit(() => { savePreset(doc, preset); });
  } else if (action === "preset-apply" && room) {
    const preset = (doc.finishPresets || []).find((p) => p.id === finishField("preset-pick")?.value);
    if (preset) finishCommit(() => { room.finishes = rulesFromPreset(preset); });
  } else if (action === "add-open") {
    const surface = btn.closest("[data-fin-surface]")?.dataset.finSurface;
    if (surface !== "floor" && surface !== "face") return;
    finishAddOpen = surface;
    finishKey = "";
    render();
  } else if (action === "add-close") {
    finishAddOpen = null;
    finishKey = "";
    render();
  } else if (action === "region-draw" && (room || slab)) {
    const target = chosenRegionTarget(btn);
    if (!target) return;
    finishAddOpen = null;
    editingRegionId = null;
    startRegion({ finish: { ...target, slabId: slab?.id || null, roomId: room?.id || null } });
  } else if (action === "region-whole" && slab) {
    const target = chosenRegionTarget(btn);
    if (!target) return;
    finishAddOpen = null;
    const room = roomHoldingPoly(shapePolygon(slab.shape));
    finishCommit(() => {
      createFinishRegion(doc, {
        level: slab.level ?? activeLevel,
        roomId: room?.id || null,
        slabId: slab.id,
        category: target.category,
        productId: target.productName ? ensureFinishProduct(doc, target.category, target.productName) : null,
        // Follows the floor's outline until its corners are edited.
        whole: true,
        shape: structuredClone(slab.shape),
      });
    });
  } else if (action === "show-bare" && (room || slab)) {
    const host = slab ? { kind: "slab", id: slab.id } : { kind: "room", id: room.id };
    const same = bareFinishHost?.kind === host.kind && bareFinishHost?.id === host.id;
    bareFinishHost = same ? null : host;
    finishKey = "";
    render();
  } else if (action === "region-edit") {
    const id = row?.dataset.finRegion;
    if (id) {
      const turningOn = editingRegionId !== id;
      editingRegionId = turningOn ? id : null;
      selectedRegionVertex = null;
      finishKey = "";
      if (turningOn) {
        const region = (store.doc.finishRegions || []).find((r) => r.id === id);
        if (region && regionCoversHost(region)) {
          setStatusMessage("Editing the finish. Press Done to edit the floor again. Until then the floor stays put.", "ok");
        }
      }
      render();
    }
  } else if (action === "region-remove") {
    const id = row?.dataset.finRegion;
    if (editingRegionId === id) editingRegionId = null;
    if (id) finishCommit(() => { doc.finishRegions = (doc.finishRegions || []).filter((r) => r.id !== id); });
  } else if (action === "band-part") {
    const form = btn.closest("[data-fin-newband]");
    const span = form?.querySelector("[data-fin-span]");
    const add = form?.querySelector("[data-fin='run-add']");
    if (!span) return;
    const show = span.hidden;
    span.hidden = !show;
    btn.setAttribute("aria-pressed", show ? "true" : "false");
    btn.textContent = show ? "Whole face instead" : "Part of this face";
    if (add) add.textContent = show ? "Add to face" : "Whole face";
    if (!show) {
      const from = form.querySelector("[data-fin='run-from']");
      const to = form.querySelector("[data-fin='run-to']");
      if (from) from.value = "";
      if (to) to.value = "";
    }
  } else if (action === "band-draw") {
    const face = selectedElevationFace();
    const category = finishField("band-category")?.value;
    if (!face || !category) { setStatusMessage("Select a wall, then draw on its elevation.", "warn"); return; }
    finishAddOpen = null;
    elevationOpen = true;
    elevFinishDraft = {
      points: [],
      hover: null,
      category,
      productName: String(finishField("new-band-product")?.value || "").trim(),
      face: { wallId: face.wallId, side: face.side },
    };
    setStatusMessage("Click each corner on the elevation. Enter closes the shape. Esc removes the last corner.", "ok");
    render();
  } else if (action === "run-add") {
    const model = finishFaceModel();
    const wall = model ? wallsCache.find((w) => w.id === model.wallId) : null;
    const category = finishField("band-category")?.value;
    if (!model || !wall || !category) return;
    const productName = String(finishField("new-band-product")?.value || "").trim();
    const form = btn.closest("[data-fin-newband]");
    const spanOn = Boolean(form?.querySelector("[data-fin-span]") && !form.querySelector("[data-fin-span]").hidden);
    const read = (name) => typedMm(finishField(name)?.value, { allowZero: true });
    const bottom = read("run-bottom");
    const top = read("run-top");
    const from = spanOn ? read("run-from") : null;
    const to = spanOn ? read("run-to") : null;
    if ([from, to, bottom, top].includes(undefined)) { setStatusMessage("Type the sizes in millimetres.", "warn"); return; }
    const partial = from !== null && to !== null;
    if ((from !== null) !== (to !== null)) { setStatusMessage("Give both ends of the run, or neither for the whole face.", "warn"); return; }
    finishAddOpen = null;
    finishCommit(() => {
      const run = createFinishRun(doc, wall, model.side, {
        category,
        productId: productName && category !== "none" ? ensureFinishProduct(doc, category, productName) : null,
        // Typed in viewing order; a run keeps wall order.
        from: partial ? (model.flip ? wall.length - to : from) : null,
        to: partial ? (model.flip ? wall.length - from : to) : null,
        bottom: bottom ?? 0,
        top,
      });
      // The new finish is the one picked, in the list and on the elevation.
      selectedBandId = `run:${run.id}:${wall.id}:${model.side}`;
      noteBandSaved(selectedBandId);
    });
  } else if (action === "band-remove" || action === "band-remove-rule") {
    const model = finishFaceModel();
    const band = model?.finishBands.find((b) => b.id === row?.dataset.finBand);
    if (band) removeFinishBand(band);
  } else if (action === "default-remove") {
    // Taking the default off is a "No finish" run over each remaining piece of it.
    const model = finishFaceModel();
    const wall = model ? wallsCache.find((w) => w.id === model.wallId) : null;
    const named = row?.dataset.finBand;
    const pieces = (model?.finishBands || []).filter((b) => b.source === "default" && (!named || b.id === named));
    if (!model || !wall || !pieces.length) return;
    finishCommit(() => {
      for (const band of pieces) {
        const wholeW = band.from <= 1e-6 && band.to >= model.length - 1e-6;
        const wholeH = band.bottom <= 1e-6 && band.top >= model.height - 1e-6;
        createFinishRun(doc, wall, model.side, {
          category: "none",
          from: wholeW ? null : (model.flip ? wall.length - band.to : band.from),
          to: wholeW ? null : (model.flip ? wall.length - band.from : band.to),
          bottom: band.bottom,
          top: wholeH ? null : band.top,
        });
      }
    });
  } else if (action === "product-add") {
    const read = (name) => String(finishField(name)?.value || "").trim();
    if (!read("p-name") && !read("p-code")) { setStatusMessage("Give the product a name or a code.", "warn"); return; }
    const coverage = Number(read("p-coverage").replace(",", "."));
    const waste = Number(read("p-waste").replace(",", "."));
    finishCommit(() => {
      doc.finishProducts = normalizeFinishProducts([...(doc.finishProducts || []), {
        id: finishId("fp"),
        category: read("p-category"),
        name: read("p-name"),
        code: read("p-code"),
        size: read("p-size"),
        supplier: read("p-supplier"),
        boxCoverage: read("p-coverage") && coverage > 0 ? coverage : null,
        wasteFactor: read("p-waste") && waste >= 0 ? waste / 100 : null,
      }]);
    });
    finishProductsOpen = true;
  } else if (action === "product-remove") {
    const id = row?.dataset.finProduct;
    if (id) finishCommit(() => { doc.finishProducts = doc.finishProducts.filter((p) => p.id !== id); });
  } else if (action === "product-library") {
    const product = finishProductById(doc, row?.dataset.finProduct);
    if (!product) return;
    const line = libraryLine(product);
    setStatusMessage("Adding to the firm's rate book...", "ok");
    cloud.addRateBookLine(line).then(({ added, bookName }) => {
      if (added && !product.rateRef) {
        product.rateRef = line.model;
        store.persist();
      }
      finishKey = "";
      setStatusMessage(added
        ? `${line.model} added to "${bookName}", unpriced. The firm sets its rate.`
        : `${line.model} is already in "${bookName}".`, "ok");
      render();
    }).catch((error) => {
      setStatusMessage(error.status === 403
        ? "Only an owner can add to the firm's rate book."
        : `Could not add to the rate book: ${error.message}`, "warn");
    });
  }
});

el.ctxFinish?.addEventListener("change", (e) => {
  const field = e.target?.dataset?.fin;
  if (!field) return;
  const room = soleOf("room");
  const doc = store.doc;
  if (field === "new-rule-category") {
    const list = e.target.closest("[data-fin-newrule]")?.querySelector("datalist");
    if (list) list.innerHTML = floorProductSuggestions(doc, e.target.value);
    return;
  }
  if (field === "band-category") {
    const form = e.target.closest("[data-fin-newband]");
    const list = form?.querySelector("datalist");
    if (list) list.innerHTML = floorProductSuggestions(doc, e.target.value);
    // Skirting is a run along the wall foot, so it starts at the skirting height.
    const height = form?.querySelector("[data-fin='band-height']");
    if (height) {
      if (e.target.value === "skirting") height.value = "skirting";
      else if (height.value === "skirting") height.value = "full";
      applyHeightPreset(form, height.value);
    }
    return;
  }
  if (field === "band-height") {
    applyHeightPreset(e.target.closest("[data-fin-newband]"), e.target.value);
    return;
  }
  const bandId = e.target.closest?.("[data-fin-band]")?.dataset.finBand;
  if (bandId && field.startsWith("band-")) {
    const face = selectedElevationFace();
    const model = finishFaceModel();
    const band = model?.finishBands.find((b) => b.id === bandId);
    const source = band ? bandSource(doc, band) : null;
    if (!face || !band || !source) { finishKey = ""; render(); return; }
    selectedBandId = bandId;
    if (field === "band-type") {
      const next = e.target.value;
      if (!next || next === band.category) return;
      noteBandSaved(bandId);
      finishCommit(() => {
        const product = finishProductById(doc, source.productId);
        source.category = next;
        if (next === "none" || !product || product.category !== next) source.productId = null;
      });
    } else if (field === "band-product-name") {
      const name = String(e.target.value || "").trim();
      noteBandSaved(bandId);
      finishCommit(() => {
        source.category = band.category;
        source.productId = name ? ensureFinishProduct(doc, band.category, name) : null;
      });
    } else {
      const value = typedMm(e.target.value, { allowZero: true });
      if (value === undefined) { finishKey = ""; render(); return; }
      const edit = {};
      if (field === "band-from") edit.from = value ?? 0;
      else if (field === "band-to") edit.to = value ?? model.length;
      else if (field === "band-bottom") edit.bottom = value ?? 0;
      else if (field === "band-top") edit.top = value && value > 0 ? value : model.height;
      noteBandSaved(bandId);
      finishCommit(() => { applyBandEdit(doc, pack, face, bandId, edit, wallsCache); });
    }
    return;
  }
  if (field === "region-category") {
    const list = e.target.closest("[data-fin-new]")?.querySelector("datalist");
    if (list) list.innerHTML = floorProductSuggestions(doc, e.target.value);
    return;
  }
  if (field === "region-product-name") {
    const id = e.target.closest("[data-fin-region]")?.dataset.finRegion;
    const region = (doc.finishRegions || []).find((r) => r.id === id);
    if (!region) return;
    const category = region.category || finishProductById(doc, region.productId)?.category;
    const name = String(e.target.value || "").trim();
    if (!category) return;
    noteFinishSaved(region.id);
    finishCommit(() => {
      region.category = category;
      region.productId = name ? ensureFinishProduct(doc, category, name) : null;
    });
    return;
  }
  if (field === "region-type") {
    const id = e.target.closest("[data-fin-region]")?.dataset.finRegion;
    const region = (doc.finishRegions || []).find((r) => r.id === id);
    const next = e.target.value;
    const current = region?.category || finishProductById(doc, region?.productId)?.category;
    if (!region || !next || next === current) return;
    finishCommit(() => {
      const product = finishProductById(doc, region.productId);
      region.category = next;
      if (!product || product.category !== next) region.productId = null;
    });
    return;
  }
  if (field === "external-finish") {
    finishCommit(() => { doc.finishSettings = normalizeFinishSettings({ ...doc.finishSettings, externalFinish: e.target.value }); });
    return;
  }
  if (field === "volume-basis") {
    finishCommit(() => { doc.finishSettings = normalizeFinishSettings({ ...doc.finishSettings, volumeBasis: e.target.value }); });
    return;
  }
  const rule = finishRule(room, e.target);
  if (!rule) return;
  if (field === "rule-type") {
    const next = e.target.value;
    if (!next) return;
    finishCommit(() => {
      const product = finishProductById(doc, rule.productId);
      rule.category = next;
      if (!product || product.category !== next) rule.productId = null;
    });
  } else if (field === "rule-product-name") {
    const category = rule.category || finishProductById(doc, rule.productId)?.category;
    const name = String(e.target.value || "").trim();
    if (!category) return;
    finishCommit(() => {
      rule.category = category;
      rule.productId = name ? ensureFinishProduct(doc, category, name) : null;
    });
  } else if (field === "rule-faces") {
    finishCommit(() => { rule.faces = e.target.value; });
  } else if (field === "rule-bottom" || field === "rule-top") {
    const value = typedMm(e.target.value, { allowZero: true });
    if (value === undefined) { finishKey = ""; render(); return; }
    finishCommit(() => {
      if (field === "rule-bottom") rule.bottom = value ?? 0;
      else rule.top = value && value > 0 ? value : null;
    });
  }
});

/** Show, hide and redraw the route profile under the plan. Runs every render. */
function syncServiceProfileDock() {
  const dock = el.serviceProfileDock;
  if (!dock) return;
  if (syncElevationDock()) return;
  const edgeId = serviceDockActive() ? serviceProfileEdge() : null;
  const edge = edgeId ? (store.doc.serviceEdges || []).find((e) => e.id === edgeId) : null;
  if (!edge) {
    setHidden(dock, true);
    return;
  }
  const network = (store.doc.serviceNetworks || []).find((n) => n.id === edge.networkId);
  setHidden(dock, false);
  fitServiceProfileHeight();
  if (el.serviceProfileTitle) {
    el.serviceProfileTitle.textContent = `Route profile · ${network?.name || "Route"} · height against distance along the plan`;
  }
  profileEdgeId = edge.id;
  syncProfileModeButtons();
  const profile = routeProfile(store.doc, pack, edge.id);
  profileLayout = drawServiceProfile(el.serviceProfileCanvas, profile, {
    obstructions: profileObstructions(store.doc, pack, profile),
    storeyHeight: pack?.system?.wallHeight || 2.8,
    colour: SERVICE_SYSTEM_INFO[network?.system]?.colour,
    drag: profileDrag?.moved ? { nodeId: profileDrag.nodeId, runEdgeId: profileDrag.runEdgeId, z0: profileDrag.z0, z: profileDrag.z, mode: profileDrag.mode } : null,
    hoverGhost: profileHoverGhost,
    selectedNodeIds: store.selected.filter((r) => r.kind === "serviceNode").map((r) => r.id),
    selectedEdgeIds: store.selected.filter((r) => r.kind === "serviceEdge").map((r) => r.id),
    selectionColour: COLOUR.selection,
  });
  // The canvas wrap's ResizeObserver re-measures the plan when the dock opens.
}

// Route profile editing. Heights are only ever changed as a vertical step (a rise
// or drop at one point), never by tilting a run, so the profile keeps the 90
// degree corners the mock draws. A ghost node (dashed, mid-run) is made real by
// one click; a real node is lifted by dragging it up or down.
const PROFILE_HIT = 10;
const PROFILE_SEGMENT_HIT = 7;
const LIFT_STEP = 0.05;
const SLOPE_STEP = 0.01;

/** Step (a 90 degree rise) or Slope (only this node's height), for the route shown. */
function profileMode() {
  if (profileModePref) return profileModePref;
  const edge = (store.doc.serviceEdges || []).find((e) => e.id === profileEdgeId);
  const system = (store.doc.serviceNetworks || []).find((n) => n.id === edge?.networkId)?.system;
  return system === "drainage" ? "slope" : "step";
}

function syncProfileModeButtons() {
  const mode = profileMode();
  document.querySelectorAll("[data-profile-mode]").forEach((b) => {
    b.classList.toggle("active", b.dataset.profileMode === mode);
    b.setAttribute("aria-pressed", String(b.dataset.profileMode === mode));
  });
}

document.querySelectorAll("[data-profile-mode]").forEach((b) => {
  b.addEventListener("click", () => {
    profileModePref = b.dataset.profileMode;
    render();
  });
});

function profilePointer(ev) {
  const rect = el.serviceProfileCanvas.getBoundingClientRect();
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
}

function profileHit(p) {
  if (!profileLayout) return null;
  let best = null;
  let bestD = PROFILE_HIT;
  for (const n of profileLayout.nodes) {
    const d = Math.hypot(n.px - p.x, n.py - p.y);
    if (d <= bestD) { best = { kind: "node", ...n }; bestD = d; }
  }
  if (best) return best;
  for (const g of profileLayout.ghosts) {
    const d = Math.hypot(g.px - p.x, g.py - p.y);
    if (d <= bestD) { best = { kind: "ghost", ...g }; bestD = d; }
  }
  if (best) return best;
  // Nothing else under the pointer: the stretch of route itself, a rise or
  // drop included. Points and ghosts win above, so editing is unchanged.
  let bestSegD = PROFILE_SEGMENT_HIT;
  for (const s of profileLayout.segments || []) {
    const d = distToSeg(s.x1, s.y1, s.x2, s.y2, p.x, p.y);
    if (d <= bestSegD) { best = { kind: "segment", edgeId: s.edgeId }; bestSegD = d; }
  }
  return best;
}

/**
 * A click on a stretch of the profile selects that run on the plan. A rise or
 * drop has no length there, so it is shown as a ring on its point, and a short
 * pulse says where. The plan moves to the run's storey if it is on another.
 */
function selectProfileSegment(edgeId) {
  const edge = (store.doc.serviceEdges || []).find((e) => e.id === edgeId);
  if (!edge) return;
  const levels = edgeLevels(store.doc, pack, edge);
  if (levels.length && !levels.includes(activeLevel)) {
    activeLevel = levels[0];
    drawLevelSwitcher();
  }
  store.selectOne({ kind: "serviceEdge", id: edgeId });
  const centre = serviceElementCentre(store.doc, { kind: "serviceEdge", id: edgeId });
  startLocateFlash(centre ? [centre] : [], activeLevel);
  render();
}

/**
 * Select every run on the route the profile shows, rises and drops included,
 * so the inspector's Type and "Include in BoQ" apply to the lot in one change.
 * A route ends where it meets a junction; other branches are not swept in.
 */
function selectWholeRoute() {
  if (!profileEdgeId) return;
  const { edgeIds } = routeProfile(store.doc, pack, profileEdgeId);
  const edges = (store.doc.serviceEdges || []).filter((e) => edgeIds.includes(e.id));
  if (!edges.length) return;
  // Stay where you are if any of it is on this storey; otherwise go to the first.
  if (!edges.some((e) => edgeLevels(store.doc, pack, e).includes(activeLevel))) {
    const levels = edgeLevels(store.doc, pack, edges[0]);
    if (levels.length) {
      activeLevel = levels[0];
      drawLevelSwitcher();
    }
  }
  const refs = edges.map((e) => ({ kind: "serviceEdge", id: e.id }));
  store.setSelection(refs, refs[0]);
  setStatusMessage(`Selected the whole route: ${refs.length} run${refs.length === 1 ? "" : "s"}. Change the type or quantities in the panel.`, "ok");
  render();
}

function onProfileDown(ev) {
  if (ev.button !== 0) return;
  const hit = profileHit(profilePointer(ev));
  if (!hit) return;
  if (hit.kind === "segment") {
    // A click selects the run; dragging it up or down lifts the whole run.
    const y = profilePointer(ev).y;
    const z0 = profileLayout.zAt(y);
    profileDrag = { runEdgeId: hit.edgeId, nodeId: null, z0, z: z0, startY: y, moved: false, mode: "run" };
    el.serviceProfileCanvas.setPointerCapture(ev.pointerId);
    return;
  }
  if (hit.kind === "ghost") {
    const centre = serviceElementCentre(store.doc, { kind: "serviceEdge", id: hit.edgeId });
    if (!centre) return;
    const res = mutateServices(() => splitServiceEdge(store.doc, pack, hit.edgeId, centre));
    if (res?.ok) store.setSelection([{ kind: "serviceNode", id: res.nodeId }]);
    profileHoverGhost = null;
    render();
    return;
  }
  store.selectOne({ kind: "serviceNode", id: hit.nodeId });
  const base = profileMode();
  const mode = ev.shiftKey ? (base === "slope" ? "step" : "slope") : base;
  profileDrag = { nodeId: hit.nodeId, z0: hit.z, z: hit.z, startY: profilePointer(ev).y, moved: false, mode };
  el.serviceProfileCanvas.setPointerCapture(ev.pointerId);
  render();
}

function onProfileMove(ev) {
  const p = profilePointer(ev);
  if (profileDrag) {
    if (Math.abs(p.y - profileDrag.startY) > 4) profileDrag.moved = true;
    if (profileDrag.moved && profileLayout) {
      const raw = Math.min(profileLayout.zHi, Math.max(profileLayout.zLo, profileLayout.zAt(p.y)));
      const q = profileDrag.mode === "slope" ? SLOPE_STEP : LIFT_STEP; // "run" lifts in LIFT_STEPs too
      profileDrag.z = profileDrag.z0 + Math.round((raw - profileDrag.z0) / q) * q;
    }
    render();
    return;
  }
  const hit = profileHit(p);
  const ghostId = hit?.kind === "ghost" ? hit.edgeId : null;
  el.serviceProfileCanvas.style.cursor = hit?.kind === "node" ? "ns-resize" : hit?.kind === "segment" ? "ns-resize" : hit ? "copy" : "default";
  if (ghostId !== profileHoverGhost) {
    profileHoverGhost = ghostId;
    render();
  }
}

function onProfileUp() {
  const d = profileDrag;
  profileDrag = null;
  if (!d) return;
  if (d.mode === "run") {
    if (!d.moved) { selectProfileSegment(d.runEdgeId); return; }
    const runDelta = d.z - d.z0;
    if (Math.abs(runDelta) >= LIFT_STEP / 2) {
      const res = mutateServices(() => liftRun(store.doc, pack, d.runEdgeId, runDelta));
      if (res?.ok) store.setSelection([{ kind: "serviceEdge", id: d.runEdgeId }]);
    }
    render();
    return;
  }
  const delta = d.z - d.z0;
  const min = (d.mode === "slope" ? SLOPE_STEP : LIFT_STEP) / 2;
  if (d.moved && Math.abs(delta) >= min) {
    const res = mutateServices(() => {
      if (d.mode !== "slope") return liftNode(store.doc, pack, d.nodeId, delta, profileEdgeId);
      const n = store.doc.serviceNodes.find((x) => x.id === d.nodeId);
      if (!n || n.offset === null) return { ok: false, message: "This node has no stated height. Set its offset first." };
      return setNodeOffset(store.doc, d.nodeId, Math.round((n.offset + delta) * 1000) / 1000);
    });
    if (res?.ok) store.setSelection([{ kind: "serviceNode", id: res.nodeId || d.nodeId }]);
  }
  render();
}

if (el.serviceProfileCanvas) {
  el.serviceProfileCanvas.addEventListener("pointerdown", onProfileDown);
  el.serviceProfileCanvas.addEventListener("pointermove", onProfileMove);
  el.serviceProfileCanvas.addEventListener("pointerup", onProfileUp);
  el.serviceProfileCanvas.addEventListener("dblclick", (ev) => {
    if (profileHit(profilePointer(ev))?.kind === "segment") selectWholeRoute();
  });
  document.getElementById("v2-profile-select-all")?.addEventListener("click", selectWholeRoute);
  document.getElementById("v2-profile-exit")?.addEventListener("click", exitRouteProfile);
  el.serviceProfileCanvas.addEventListener("pointercancel", () => { profileDrag = null; render(); });
  el.serviceProfileCanvas.addEventListener("pointerleave", () => {
    if (profileDrag || profileHoverGhost === null) return;
    profileHoverGhost = null;
    render();
  });
}

// The profile's top edge sets its height. Dragging up grows it (the plan gives
// up the space); the canvas is flex:1, so the next render redraws the plot to
// the new client height. A floor keeps the header and a usable plot; a ceiling
// leaves the plan enough room to keep drawing.
const PROFILE_HEIGHT_KEY = "v2-profile-height";
const PROFILE_MIN = 148;
const PROFILE_PLAN_MIN = 180;

function fitServiceProfileHeight(px) {
  const dock = el.serviceProfileDock;
  if (!dock) return 0;
  let h = px;
  if (!Number.isFinite(h) || h <= 0) h = parseFloat(dock.style.height) || 190;
  const parentH = dock.parentElement?.clientHeight || 0;
  if (parentH >= PROFILE_MIN + 40) {
    const room = parentH - PROFILE_PLAN_MIN;
    h = Math.min(Math.max(h, PROFILE_MIN), Math.max(PROFILE_MIN, room));
  } else {
    h = Math.max(h, PROFILE_MIN);
  }
  h = Math.round(h);
  if (dock.style.height !== `${h}px`) dock.style.height = `${h}px`;
  return h;
}

function bindServiceProfileResize() {
  const handle = document.getElementById("v2-resize-profile");
  const dock = el.serviceProfileDock;
  if (!handle || !dock) return;
  let frame = 0;
  const remembered = Number(window.localStorage.getItem(PROFILE_HEIGHT_KEY));
  if (Number.isFinite(remembered) && remembered > 0) dock.style.height = `${Math.round(remembered)}px`;
  const apply = (px, { store = false } = {}) => {
    const h = fitServiceProfileHeight(px);
    if (store && h > 0) window.localStorage.setItem(PROFILE_HEIGHT_KEY, String(h));
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      render();
    });
  };
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.classList.add("is-dragging");
    handle.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startH = dock.getBoundingClientRect().height || parseFloat(dock.style.height) || 190;
    const onMove = (ev) => apply(startH - (ev.clientY - startY));
    const onUp = () => {
      handle.classList.remove("is-dragging");
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      const h = Math.round(dock.getBoundingClientRect().height);
      if (h > 0) window.localStorage.setItem(PROFILE_HEIGHT_KEY, String(h));
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  });
  handle.addEventListener("keydown", (e) => {
    const h = dock.getBoundingClientRect().height || parseFloat(dock.style.height) || 190;
    if (e.key === "ArrowUp") apply(h + 24, { store: true });
    else if (e.key === "ArrowDown") apply(h - 24, { store: true });
    else return;
    e.preventDefault();
  });
}

bindServiceProfileResize();

function syncServiceDock() {
  const refs = store.selected.filter(isServiceRef);
  const model = serviceInspectorModel(store.doc, pack, refs, { walls: serviceWalls(), levelId: activeLevel });
  const connectHint = tool === "service-connect"
    ? (serviceConnect ? "Click the component to connect this point to." : "Click a route point, then the component it serves.")
    : "";
  const html = servicePanelHtml({
    doc: store.doc, pack, ui: serviceUi, model, showRoute: tool === "service-route", connectHint,
  });
  const focused = el.serviceFields.contains(document.activeElement) && document.activeElement !== el.serviceFields;
  setHidden(el.serviceFields, false);
  if (html === serviceDockKey || focused) return;
  el.serviceFields.innerHTML = html;
  serviceDockKey = html;
}

/** Run one document edit as a single undo step; a refusal leaves no trace. */
function mutateServices(fn) {
  const sel = store.selected.slice();
  const primary = store.primary;
  store.pushUndo();
  const res = fn();
  if (res && res.ok === false) {
    store.undo();
    store.setSelection(sel, primary);
    setStatusMessage(res.message, "warn");
  } else {
    store.persist();
    if (res?.message) setStatusMessage(res.message, "ok");
  }
  serviceDockKey = "";
  if (el.serviceFields.contains(document.activeElement)) document.activeElement.blur();
  render();
  return res;
}

function focusServiceField(name) {
  const input = el.serviceFields?.querySelector(`[data-svc="${name}"]`);
  if (input) input.focus();
  else setStatusMessage("Select the route point or run first, then use the inspector.", "warn");
}

function numberOrNull(text) {
  const v = parseOffsetText(text);
  return v === undefined ? NaN : v;
}

function onServiceControl(ev) {
  const target = ev.target.closest?.("[data-svc]");
  if (!target) return;
  const name = target.dataset.svc;
  const value = target.value;
  const sel = store.selected.filter(isServiceRef);
  const nodeId = sel.find((r) => r.kind === "serviceNode")?.id;
  const edgeIds = sel.filter((r) => r.kind === "serviceEdge").map((r) => r.id);
  const field = (n) => el.serviceFields.querySelector(`[data-svc="${n}"]`);
  const isClick = ev.type === "click";
  const isInput = ev.type === "input";

  // Draw settings: remembered, applied to the next run drawn.
  if (name === "offset") {
    if (isInput) serviceUi.offsetText = value;
    return;
  }
  if (name === "just-offset") {
    if (isInput) serviceUi.justOffsetText = value;
    return;
  }
  if (isInput || (isClick && target.tagName !== "BUTTON")) return;
  switch (name) {
    case "system":
      serviceUi.system = value;
      serviceUi.networkId = null;
      serviceUi.sku = null;
      serviceDockKey = "";
      showServiceSystem(value);
      target.blur();
      render();
      return;
    case "network": serviceUi.networkId = value || null; return;
    case "sku": serviceUi.sku = value || null; return;
    case "mode": serviceUi.mode = value === "schematic" ? "schematic" : "measured"; return;
    case "just-mode":
      serviceUi.justMode = value === "clear" || value === "centre" ? value : "off";
      serviceDockKey = "";
      target.blur();
      render();
      return;
    case "edge-chase": mutateServices(() => setEdgeChase(store.doc, edgeIds, target.checked)); return;
    case "edge-clearance": {
      const mm = numberOrNull(value);
      if (mm === null || Number.isNaN(mm)) { setStatusMessage("Clearance must be a number of millimetres.", "warn"); return; }
      mutateServices(() => setRunClearance(store.doc, pack, serviceWalls(), edgeIds[0], mm, activeLevel));
      return;
    }
    case "node-level": mutateServices(() => setNodeLevel(store.doc, pack, nodeId, value)); return;
    case "node-offset": {
      const v = numberOrNull(value);
      if (Number.isNaN(v)) { setStatusMessage("Offset must be a number of metres.", "warn"); return; }
      mutateServices(() => setNodeOffset(store.doc, nodeId, v));
      return;
    }
    case "end-offset": {
      const v = numberOrNull(value);
      if (Number.isNaN(v)) { setStatusMessage("Offset must be a number of metres.", "warn"); return; }
      mutateServices(() => setNodeOffset(store.doc, target.dataset.node, v));
      return;
    }
    case "disconnect": mutateServices(() => disconnectNode(store.doc, nodeId)); return;
    case "rise": {
      const mag = Number(String(field("rise-delta")?.value || "").trim().replace(",", "."));
      const delta = mag * Number(target.dataset.dir || 1);
      const res = mutateServices(() => createRiser(store.doc, pack, nodeId, { delta }));
      if (res?.ok) store.setSelection([{ kind: "serviceNode", id: res.nodeId }]);
      render();
      return;
    }
    case "rise-level-go": {
      const levelId = field("rise-level")?.value;
      const off = numberOrNull(field("rise-offset")?.value);
      if (Number.isNaN(off) || off === null) { setStatusMessage("Enter the offset on that level, in metres.", "warn"); return; }
      const connectItemId = field("rise-item")?.value || null;
      const res = mutateServices(() => createRiser(store.doc, pack, nodeId, { level: levelId, offset: off, connectItemId }));
      if (res?.ok) store.setSelection([{ kind: "serviceNode", id: res.nodeId }]);
      render();
      return;
    }
    case "rise-level": {
      // The component choice follows the level chosen: a connection is on one storey.
      const items = JSON.parse(field("rise-item")?.dataset.items || "[]").filter((i) => i.level === value);
      const select = field("rise-item");
      if (select) {
        select.innerHTML = `<option value="">None</option>${items.map((i) => `<option value="${escapeHtml(i.id)}">${escapeHtml(i.label)}</option>`).join("")}`;
      }
      return;
    }
    case "edge-sku": mutateServices(() => setEdgeSku(store.doc, edgeIds, value)); return;
    case "edge-mode": mutateServices(() => setEdgeMode(store.doc, edgeIds, value)); return;
    case "reverse": mutateServices(() => reverseEdge(store.doc, edgeIds[0])); return;
    case "fall-apply": {
      const g = parseGradient(field("fall")?.value);
      if (g === null) { setStatusMessage("Enter a fall such as 1:60 or 1.7%.", "warn"); return; }
      mutateServices(() => applyDrainageFall(store.doc, pack, edgeIds[0], g));
      return;
    }
    default:
  }
}

if (el.serviceFields) {
  el.serviceFields.addEventListener("change", onServiceControl);
  el.serviceFields.addEventListener("input", onServiceControl);
  el.serviceFields.addEventListener("click", onServiceControl);
}

function syncPlanContext() {
  syncPlanFilterButtons();
  syncServiceProfileDock();
  if (serviceDockActive()) {
    if (el.dockContext) el.dockContext.dataset.state = "edit";
    setHidden(el.ctxTypePicker, true);
    setHidden(el.inspectFields, true);
    setHidden(el.planOptions, true);
    setHidden(el.ctxProperty, true);
    setHidden(el.inspectEmpty, true);
    setTypeFlyoutOpen(false);
    prevDockState = "edit";
    planContextKey = "";
    if (el.paletteTitle) el.paletteTitle.textContent = "Services";
    setHidden(el.inspectBack, true);
    const first = store.selected.find(isServiceRef);
    const firstObj = first ? objByRef(first) : null;
    const network = firstObj && (store.doc.serviceNetworks || []).find((n) => n.id === firstObj.networkId);
    syncInspectKicker(network ? network.name : (tool === "service-route" ? "Draw route" : "Services"));
    syncServiceDock();
    return;
  }
  setHidden(el.serviceFields, true);
  const draft = Boolean(wallDraft);
  const refs = store.selected;
  const ref = !draft && refs.length === 1 ? store.primary : null;
  const obj = ref ? objByRef(ref) : null;
  const linear = draft || (obj && (ref.kind === "segment" || ref.kind === "beam"));
  const room = Boolean(obj && ref.kind === "room");
  const region = Boolean(obj && ref.kind === "region");
  const slab = Boolean(obj && ref.kind === "slab");
  const roof = Boolean(obj && ref.kind === "roof");
  const opening = Boolean(obj && ref.kind === "opening");
  setHidden(el.inspectBack, !openingHostSegment());
  const item = Boolean(obj && ref.kind === "item");
  const rect = (room || slab || roof) && obj.shape?.kind === "rect";
  const shapePoly = (room || slab || roof) && obj.shape?.kind === "poly";
  const floorSlab = slab && skuById(obj.sku)?.category !== "ceiling";
  const multi = !draft && refs.length > 1;
  // A multi-selection can be retyped (applySkuToSelection now covers the
  // whole selection, not just one object) as long as at least one member is
  // a kind a SKU applies to; the type picker opens for that, while every
  // other Inspector field - name, length, geometry - stays hidden, because
  // those are still genuinely per-object.
  const multiTypeable = multi && refs.some((r) => TYPEABLE_KINDS.has(r.kind));
  const showType = linear || slab || roof || opening || item;
  const showGeom = linear || rect || shapePoly;
  const showInspect = Boolean(el.inspectFields) && (linear || room || region || slab || roof || opening || item);
  const editingProperty = propertySelected && !draft && refs.length === 0;
  const creating = !showInspect && !multi && !editingProperty && placingToolArmed();
  const dockState = editingProperty || showInspect ? "edit" : multiTypeable ? "edit" : creating ? "create" : "empty";

  if (el.dockContext) el.dockContext.dataset.state = dockState;
  setHidden(el.ctxTypePicker, !(showType || creating || room || multiTypeable));
  syncTypeCurrent();
  // Arming a draw tool makes picking a type the whole job, so open the chooser
  // straight away (it fills the inspector). Leaving create - either an empty
  // dock or selecting an object to edit - collapses it back.
  if (dockState === "create" && prevDockState !== "create") {
    setTypeFlyoutOpen(true);
    renderPalette();
  } else if (dockState !== "create" && prevDockState === "create") {
    setTypeFlyoutOpen(false);
  } else if (dockState === "empty") {
    setTypeFlyoutOpen(false);
  }
  prevDockState = dockState;

  if (el.paletteTitle) {
    if (dockState === "create") el.paletteTitle.textContent = lastPaletteLabel || "Types";
    else if (draft) el.paletteTitle.textContent = inspectKindLabel("wall", skuById(placeSkuId)) || "Wall";
    else if (editingProperty) el.paletteTitle.textContent = "Property line";
    else if (obj) el.paletteTitle.textContent = inspectKindLabel(ref.kind, skuById(obj.sku)) || "Inspector";
    else if (multiTypeable) el.paletteTitle.textContent = "Types";
    else el.paletteTitle.textContent = "Inspector";
  }

  if (editingProperty) {
    syncInspectKicker("Site boundary");
  } else if (multi) {
    const group = store.groupForRef(refs[0]);
    syncInspectKicker(group ? group.name : `${refs.length} selected`);
  } else if (creating) {
    syncInspectKicker(pack.name || "—");
  } else if (draft) {
    syncInspectKicker(skuById(placeSkuId)?.name || "—");
  } else if (obj) {
    syncInspectKicker(obj.name || obj.id || "—");
  } else {
    syncInspectKicker("");
  }

  const placingWall = tool === "wall";
  setHidden(el.planOptions, !showGeom && !placingWall);
  setHidden(el.wallLoc, !placingWall);
  if (placingWall && el.wallLoc) {
    for (const btn of el.wallLoc.querySelectorAll("[data-wall-loc]")) {
      const on = btn.dataset.wallLoc === wallLocation;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }
  setHidden(el.wallOpts, !placingWall);
  // Corner only matters where a wall meets another wall's end.
  setHidden(el.wallCorner, !(placingWall && wallCornerRelevant()));
  positionWallOpts();
  if (placingWall && el.wallCorner) {
    for (const btn of el.wallCorner.querySelectorAll("[data-wall-corner]")) {
      const on = btn.dataset.wallCorner === wallCorner;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }
  setHidden(el.inspectFields, !showInspect && !creating && !editingProperty);
  setHidden(el.ctxProperty, !editingProperty);
  setHidden(el.inspectEmpty, dockState !== "empty");
  if (el.inspectEmpty && dockState === "empty") {
    el.inspectEmpty.textContent = multi
      ? "Nothing in this selection has a type to change."
      : "Select a wall, room, roof or opening to edit its type and identity, or pick a tool on the ribbon to start drawing.";
  }

  if (!showInspect && !showGeom && !creating && !editingProperty) {
    planContextKey = "";
    setHidden(el.ctxElevWrap, true);
    setHidden(el.ctxOOffsetWrap, true);
    setHidden(el.ctxFinish, true);
    return;
  }

  setHidden(el.ctxNameWrap, !room);
  setHidden(el.ctxUseWrap, !room);
  setHidden(el.ctxRegionWrap, !region);
  setHidden(el.ctxLenWrap, !linear);
  setHidden(el.ctxAngWrap, !linear);
  setHidden(el.ctxWWrap, !(rect || linear));
  setHidden(el.ctxHWrap, !(rect || linear));
  if (el.ctxW) el.ctxW.readOnly = linear;
  if (el.ctxH) el.ctxH.readOnly = linear;
  if (el.ctxWWrap) el.ctxWWrap.classList.toggle("readonly", linear);
  if (el.ctxHWrap) el.ctxHWrap.classList.toggle("readonly", linear);
  setHidden(el.ctxShapePoly, !rect);
  setHidden(el.ctxShapePolyHint, !shapePoly);
  setHidden(el.ctxFormWrap, !roof);
  const pitched = Boolean(roof && obj && obj.form !== "flat");
  setHidden(el.ctxPitchWrap, !pitched);
  setHidden(el.ctxRidgeWrap, !pitched);
  setHidden(el.ctxTypeWrap, true);
  syncInspectStatus((showInspect || creating) && !multi ? obj : null, draft || creating);
  const doorSelected = Boolean(opening && skuById(obj.sku)?.category === "door");
  setHidden(el.ctxFlip, !doorSelected);
  setHidden(el.ctxHinge, !doorSelected);
  const attachable = Boolean(obj && ATTACHABLE_KINDS.has(ref.kind));
  setHidden(el.ctxAttachWrap, !attachable);
  if (attachable && el.ctxAttach) el.ctxAttach.textContent = attachStateText(obj);
  syncObjectLevel(obj && ref.kind !== "opening" ? obj : null);
  syncWallTop(obj && ref.kind === "segment" && !draft ? obj : null);
  syncHeightFields(obj && !draft ? obj : null, ref?.kind);
  syncElevationPreview();
  syncFinishPanel(room && !draft ? obj : null, floorSlab && !draft ? obj : null);

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
    const x1 = draft ? wallDraft.x1 : obj.x1;
    const y1 = draft ? wallDraft.y1 : obj.y1;
    const x2 = draft ? (wallDraft.x2 ?? wallDraft.x1) : obj.x2;
    const y2 = draft ? (wallDraft.y2 ?? wallDraft.y1) : obj.y2;
    const len = segmentLength(x1, y1, x2, y2);
    const ang = headingDeg(x1, y1, x2, y2);
    if (document.activeElement !== el.ctxLen) {
      el.ctxLen.value = (draft && sizeDraft?.lockW) ? sizeDraft.typedW : (len < 0.05 ? "" : formatLengthMm(len));
    }
    if (document.activeElement !== el.ctxAng) {
      el.ctxAng.value = len < 0.05 ? "" : ang.toFixed(1);
    }
  }
  if (room && document.activeElement !== el.ctxName) el.ctxName.value = obj.name;
  if (room && document.activeElement !== el.ctxUse) el.ctxUse.value = obj.use;
  if (region && document.activeElement !== el.ctxRegion) el.ctxRegion.value = obj.convention || "";
  if (rect) {
    if (document.activeElement !== el.ctxW) el.ctxW.value = formatLengthMm(obj.shape.w);
    if (document.activeElement !== el.ctxH) el.ctxH.value = formatLengthMm(obj.shape.h);
  } else if (linear) {
    const sku = skuById(draft ? placeSkuId : obj?.sku);
    const { width, height } = linearWidthHeight(sku);
    el.ctxW.value = Number.isFinite(width) ? formatLengthMm(width) : "";
    el.ctxH.value = Number.isFinite(height) ? formatLengthMm(height) : "";
  }
  if (roof) {
    if (document.activeElement !== el.ctxForm) el.ctxForm.value = obj.form;
    if (document.activeElement !== el.ctxPitch) el.ctxPitch.value = String(obj.pitch);
    if (el.ctxRidge && document.activeElement !== el.ctxRidge) el.ctxRidge.value = obj.ridge === "short" ? "short" : "long";
  }
}

el.ctxLen?.addEventListener("input", (ev) => {
  if (wallDraft) {
    if (!sizeDraft) sizeDraft = { lockW: false, lockH: false, typedW: "", typedH: "", axis: "w" };
    sizeDraft.lockW = true;
    sizeDraft.typedW = ev.target.value;
    setWallDraftLength(parseLengthInput(sizeDraft.typedW, wallDraftLength() || 1));
    render();
  }
});

el.ctxLen?.addEventListener("change", (ev) => {
  if (wallDraft) return;
  const sel = soleLinearSelection();
  if (!sel) return;
  store.pushUndo();
  setSegmentLength(sel.obj, parseLengthInput(ev.target.value, segmentLength(sel.obj.x1, sel.obj.y1, sel.obj.x2, sel.obj.y2)));
  store.persist();
  render();
});

el.wallLoc?.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-wall-loc]");
  if (!btn || tool !== "wall") return;
  wallLocation = normalizeWallLocation(btn.dataset.wallLoc);
  wallSideFlip = false;
  updateRibbonHint();
  render();
});

el.wallCorner?.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-wall-corner]");
  if (!btn || tool !== "wall") return;
  wallCorner = btn.dataset.wallCorner;
  render();
});

el.floorEdgeMode?.addEventListener("click", (ev) => {
  const mode = ev.target.closest?.("[data-floor-edge]")?.dataset.floorEdge;
  if (mode !== "corner" && mode !== "line") return;
  floorEdgeMode = mode;
  if (hoverPoint && tool === "select" && !drag) {
    el.canvas.style.cursor = planSelectCursor(hoverPoint.x, hoverPoint.y, underlayHandleHit(hoverPoint.x, hoverPoint.y));
  }
  render();
});

el.ctxAng?.addEventListener("change", (ev) => {
  if (wallDraft) {
    const cur = headingDeg(wallDraft.x1, wallDraft.y1, wallDraft.x2 ?? wallDraft.x1, wallDraft.y2 ?? wallDraft.y1);
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
  if (wallDraft) {
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
  if (wallDraft || shapeDraft) {
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

el.ctxRegion?.addEventListener("change", (e) => {
  const region = soleOf("region");
  if (!region) return;
  store.pushUndo();
  region.convention = e.target.value || null;
  store.persist();
  render();
});

el.ctxW?.addEventListener("change", (e) => {
  const obj = soleOf("room") || soleOf("slab") || soleOf("roof");
  if (!obj?.shape || obj.shape.kind !== "rect") return;
  store.pushUndo();
  obj.bound = false;
  obj.seed = null;
  obj.shape.w = parseLengthInput(e.target.value, obj.shape.w);
  store.persist();
  render();
});

el.ctxH?.addEventListener("change", (e) => {
  const obj = soleOf("room") || soleOf("slab") || soleOf("roof");
  if (!obj?.shape || obj.shape.kind !== "rect") return;
  store.pushUndo();
  obj.bound = false;
  obj.seed = null;
  obj.shape.h = parseLengthInput(e.target.value, obj.shape.h);
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

el.inspectBack?.addEventListener("click", () => {
  selectOpeningHostWall();
});

el.ctxFlip?.addEventListener("click", () => {
  if (flipDoors("swing")) render();
});

el.ctxHinge?.addEventListener("click", () => {
  if (flipDoors("hinge")) render();
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
    // Before the host moves: a finish with no slab id is found by sitting on
    // the slab, and that match requires the level they still share.
    carryFinishRegionsToLevel(store.doc, store.primary, newLevel);
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
  if (!store.doc.underlay || store.doc.underlay.pinned) return;
  store.pushUndo();
  setUnderlayRotation(store.doc, parseDegrees(ev.target.value, store.doc.underlay.rotation || 0));
  store.persist();
  render();
});

el.underlayRotateCcw?.addEventListener("click", () => {
  if (!store.doc.underlay || store.doc.underlay.pinned) return;
  store.pushUndo();
  rotateUnderlayBy(store.doc, -90);
  store.persist();
  render();
});
el.underlayRotateCw?.addEventListener("click", () => {
  if (!store.doc.underlay || store.doc.underlay.pinned) return;
  store.pushUndo();
  rotateUnderlayBy(store.doc, 90);
  store.persist();
  render();
});

// --- set-scale panel -----------------------------------------------------

el.modeDone?.addEventListener("click", doneUnderlayMode);
el.modeCancel?.addEventListener("click", () => cancelUnderlayMode());
// The close button is Cancel in Set scale and Align sheets, and Done in Adjust,
// where leaving the mode is not a reason to throw the move away.
el.modeClose?.addEventListener("click", () => {
  if (currentUnderlayMode() === "adjust") doneUnderlayMode();
  else cancelUnderlayMode();
});
el.calibrateRestart?.addEventListener("click", () => {
  if (tool !== "calibrate") return;
  calibration = { a: null, b: null };
  render();
});
el.underlayPin?.addEventListener("click", () => {
  const u = store.doc.underlay;
  if (!u) return;
  store.pushUndo();
  setUnderlayPinned(store.doc, !u.pinned);
  store.persist();
  render();
});
el.alignNext?.addEventListener("click", () => {
  const index = Number(el.alignNext.dataset.index);
  if (Number.isInteger(index)) sheetUi.goToSheet(index, { fit: false });
});
el.alignClear?.addEventListener("click", () => {
  if (tool !== "align" || !barSnapshot) return;
  restoreUnderlayState(barSnapshot);
  store.persist();
  render();
});
el.calibrateSnap?.addEventListener("change", () => setSnapToPdf(el.calibrateSnap.checked));
el.calibrateDistance?.addEventListener("input", () => {
  if (calibration) calibration.distanceEdited = true;
});
el.calibrateDistance?.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") {
    ev.preventDefault();
    confirmCalibration();
  }
});

// --- satellite panel ---------------------------------------------------------

el.satelliteConfirm?.addEventListener("click", () => commitSatellite());
el.satelliteCancel?.addEventListener("click", closeSatellitePanel);
el.satelliteQuery?.addEventListener("input", scheduleSatelliteSuggestions);
el.satelliteQuery?.addEventListener("keydown", (ev) => {
  const open = satelliteSuggestions.length > 0 && satelliteSuggestFor === el.satelliteQuery?.value;
  if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && open) {
    ev.preventDefault();
    const count = satelliteSuggestions.length;
    satelliteSuggestIndex = ev.key === "ArrowDown"
      ? (satelliteSuggestIndex + 1) % count
      : (satelliteSuggestIndex - 1 + count) % count;
    paintSatelliteSuggestion();
    return;
  }
  if (ev.key === "Enter") {
    ev.preventDefault();
    if (open && satelliteSuggestIndex >= 0) pickSatelliteSuggestion(satelliteSuggestIndex);
    else commitSatellite();
    return;
  }
  if (ev.key === "Escape") {
    if (open) clearSatelliteSuggestions();
    else closeSatellitePanel();
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
  el.compilePanel.querySelector("h2").textContent = "Take-off result";
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
// be located: switch to its level, select it, and pan the plan to it. A line
// can also locate everything behind it at once ("Show all"), which is the
// question a rolled-up quantity raises - where is my 42 m of 110 wall, not
// where is the third piece of it.
//
// Locating does not close the panel. It switches the overlay to `peek` (see
// v2.css), which docks it to one side and lets the backdrop pass clicks
// through, so the plan and the line that sent you there stay on one screen.

let scheduleRowsCache = [];
// BOQ carries rates; BOM does not. Remembered so toggling the dock can
// repaint the same lines without compiling again.
let schedulePriced = false;
// Which rolled-up lines are expanded, keyed by groupByModel's own key (model,
// falling back to category) rather than row index: re-running the compile
// re-sorts and re-numbers the rows, and an index would re-open the wrong one.
let scheduleOpenGroups = new Set();
let schedulePeeking = false;

// Model pane (full table only): a second, small massing view inside the
// schedule panel. It reads compile()'s faces like Output > 3D does but is its
// own instance, so picking a line out here never touches the plan camera, the
// active level or the selection. A 2D/3D radio flips the same model between a
// fixed top-down plan and the orbit view; the pick shows in whichever is on.
const scheduleView3d = el.schedule3dCanvas
  ? createMassingView({
    canvas: el.schedule3dCanvas,
    emptyEl: el.schedule3dEmpty,
    captionEl: null,
    titleEl: null,
  })
  : null;
// What is picked right now, so "Exit to drawing" can hand the very same
// elements to the plan locator.
let schedule3dTarget = null;

function scheduleModelIs2d() {
  return document.querySelector('input[name="v2-schedule-view"]:checked')?.value === "2d";
}

function clearSchedulePicks() {
  schedule3dTarget = null;
  el.scheduleBody?.querySelectorAll(".picked").forEach((n) => n.classList.remove("picked"));
}

function syncSchedule3dChrome(hits) {
  if (el.schedule3dDrawing) el.schedule3dDrawing.disabled = !schedule3dTarget;
  if (!el.schedule3dNote) return;
  const hint = scheduleModelIs2d() ? "scroll to zoom" : "drag to orbit · scroll to zoom";
  if (!schedule3dTarget) {
    el.schedule3dNote.textContent = "Click a line to pick it out.";
  } else if (hits) {
    const n = schedule3dTarget.refs.length;
    el.schedule3dNote.textContent = `${schedule3dTarget.label || "Selection"} · ${n} element${n === 1 ? "" : "s"} in orange · ${hint}`;
  } else {
    el.schedule3dNote.textContent = "Not a solid in the model (e.g. derived from a room) - use Exit to drawing.";
  }
}

/** Fresh read of the drawing into the model pane. Called whenever the
 *  schedule opens, so it never shows a stale compile. */
function loadSchedule3d() {
  if (!scheduleView3d) return;
  const out = compile(store.doc, pack);
  if (!out) return;
  scheduleView3d.setFlat(scheduleModelIs2d());
  scheduleView3d.setOrbit();
  scheduleView3d.setServices(serviceMassingRoutes(store.doc, pack));
  scheduleView3d.setServiceNodes(serviceMassingNodes(store.doc, pack));
  scheduleView3d.setPayload(out);
  scheduleView3d.setHighlight([]);
  syncSchedule3dChrome(0);
  // The overlay only just became visible; draw once layout has settled.
  requestAnimationFrame(() => requestAnimationFrame(() => scheduleView3d.resize()));
}

function applySchedule3dPick() {
  if (!scheduleView3d) return;
  const hits = scheduleView3d.setHighlight(schedule3dTarget ? schedule3dTarget.refs.map((ref) => ref.id) : []);
  syncSchedule3dChrome(hits);
}

/** A click on a schedule line or element. Full table: pick it out in the
 *  model pane (the drawing is untouched). Side view: the pane is gone, so the
 *  click goes to the real drawing instead. */
function pickScheduleRefs(refs, label, pickedEl) {
  if (!refs.length) return;
  clearSchedulePicks();
  pickedEl?.classList.add("picked");
  schedule3dTarget = { refs, label };
  if (schedulePeeking) {
    locateScheduleRefs(refs, label);
    return;
  }
  applySchedule3dPick();
}
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

/** Stable identity of a rolled-up line across recompiles - the same key
 *  schedule.js's groupByModel() groups on. */
function scheduleGroupKey(row) {
  return row.model || row.category || "unmodelled";
}

/** The drawn elements behind a line, as selection refs. Elements with no
 *  `kind` (a room-derived wall, a recipe-implied quantity) are not refs to
 *  anything and are dropped. */
function scheduleGroupRefs(row) {
  return (row?.elements || [])
    .filter((element) => element.kind)
    .map((element) => ({ kind: element.kind, id: element.id }));
}

function elementRowHtml(groupIndex, element, elementIndex) {
  const detail = [
    Number.isFinite(element.angle) ? `${element.angle.toFixed(0)}°` : null,
    element.gradient || null,
  ].filter(Boolean).join(" · ");
  const label = `${element.id}${element.status ? ` · ${element.status === "planned" ? "proposed" : element.status}` : ""}${detail ? ` · ${detail}` : ""}`;
  const locatable = Boolean(element.kind);
  return `
    <div class="schedule-element${locatable ? " locatable" : ""}" data-group="${groupIndex}" data-element="${elementIndex}"
      title="${locatable ? "Click to pick this element out" : "Not a drawn element - nothing to pick out"}">
      <span class="schedule-element-id">${escapeHtml(label)}</span>
      <span class="schedule-element-level">${escapeHtml(levelName(element.level))}</span>
    </div>`;
}

function scheduleRowsHtml(rows, { priced }) {
  const symbol = rateBook?.symbol || "R";
  // Full column count, so the expanded element list spans the whole table.
  const colspan = priced ? 8 : 6;
  const head = priced
    ? `<tr><th></th><th>Model</th><th class="wrap">Description</th><th>Category</th><th class="num">Qty</th><th>Unit</th><th class="num">Rate</th><th class="num">Amount</th></tr>`
    : `<tr><th></th><th>Model</th><th class="wrap">Description</th><th>Category</th><th class="num">Qty</th><th>Unit</th></tr>`;
  const body = rows.map((row, i) => {
    const first = `
      <td class="schedule-caret"><button type="button" class="schedule-caret-btn" aria-expanded="${scheduleOpenGroups.has(scheduleGroupKey(row))}" aria-label="Show or hide the elements on this line" title="Show or hide the elements on this line"></button></td>
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
    const refCount = scheduleGroupRefs(row).length;
    const elements = (row.elements || [])
      .map((element, j) => elementRowHtml(i, element, j))
      .join("");
    const open = scheduleOpenGroups.has(scheduleGroupKey(row));
    const rowTitle = refCount
      ? `Click to pick out all ${refCount} drawn element${refCount === 1 ? "" : "s"} on this line`
      : "Nothing drawn on this line";
    return `
      <tr class="schedule-group-row${open ? " open" : ""}" data-group="${i}" title="${rowTitle}">${first}${priceCells}</tr>
      <tr class="schedule-elements-row" data-group="${i}"${open ? "" : " hidden"}>
        <td colspan="${colspan}"><div class="schedule-elements">${elements || '<p class="hint">Nothing drawn against this line yet.</p>'}</div></td>
      </tr>`;
  }).join("");  const foot = priced
    ? `<tr class="total"><td colspan="${colspan - 1}">Total (priced lines only)</td><td class="num">${money(scheduleTotal(rows), symbol)}</td></tr>`
    : "";
  return `<table class="cost-table"><thead>${head}</thead><tbody>${body}${foot}</tbody></table>`;
}

/** Docked beside the plan. The full table's eight columns do not fit here:
 *  the description column collapses to a few words a line and the rest of
 *  the figures sit off a horizontal scrollbar. One block per line instead,
 *  same controls (caret, row click, element click) as the table. */
function scheduleCompactHtml(rows, { priced }) {
  const symbol = rateBook?.symbol || "R";
  const lines = rows.map((row, i) => {
    const open = scheduleOpenGroups.has(scheduleGroupKey(row));
    const refCount = scheduleGroupRefs(row).length;
    const elements = (row.elements || [])
      .map((element, j) => elementRowHtml(i, element, j))
      .join("");
    const rowTitle = refCount
      ? `Click to pick out all ${refCount} drawn element${refCount === 1 ? "" : "s"} on this line`
      : "Nothing drawn on this line";
    const amount = priced ? (row.priced ? money(row.amount, symbol) : "—") : "";
    return `
      <div class="schedule-line">
        <div class="schedule-group-row${open ? " open" : ""}" data-group="${i}" title="${rowTitle}">
          <button type="button" class="schedule-caret-btn" aria-expanded="${open}" aria-label="Show or hide the elements on this line" title="Show or hide the elements on this line"></button>
          <div class="schedule-line-body">
            <div class="schedule-line-model">${escapeHtml(row.model || "—")}</div>
            <div class="schedule-line-desc">${escapeHtml(row.description || "")}</div>
            <div class="schedule-line-meta">
              <span class="schedule-line-cat">${escapeHtml(row.category || "")}</span>
              <span class="schedule-line-qty">${fmtQty(row.qty, row.unit)}</span>
              ${priced ? `<span class="schedule-line-amt">${amount}</span>` : ""}
            </div>
          </div>
        </div>
        <div class="schedule-elements-row" data-group="${i}"${open ? "" : " hidden"}>
          <div class="schedule-elements">${elements || '<p class="hint">Nothing drawn against this line yet.</p>'}</div>
        </div>
      </div>`;
  }).join("");
  const foot = priced
    ? `<div class="schedule-foot"><span>Total (priced lines only)</span><span>${money(scheduleTotal(rows), symbol)}</span></div>`
    : "";
  return `<div class="schedule-lines">${lines}${foot}</div>`;
}

function scheduleMarkup() {
  return schedulePeeking
    ? scheduleCompactHtml(scheduleRowsCache, { priced: schedulePriced })
    : `<div class="table-wrap">${scheduleRowsHtml(scheduleRowsCache, { priced: schedulePriced })}</div>`;
}

/** Repaint the lines, leaving the warning banner where it is. A picked row
 *  is the same data-group after the switch between table and dock. */
function paintSchedule() {
  if (!el.scheduleBody) return;
  const picked = el.scheduleBody.querySelector(".picked");
  const group = picked?.dataset.group ?? null;
  const element = picked?.classList.contains("schedule-element") ? picked.dataset.element : null;
  const slot = el.scheduleBody.querySelector(".table-wrap, .schedule-lines");
  const html = scheduleMarkup();
  if (slot) slot.outerHTML = html;
  else el.scheduleBody.insertAdjacentHTML("beforeend", html);
  if (group == null) return;
  const next = element != null
    ? el.scheduleBody.querySelector(`.schedule-element[data-group="${group}"][data-element="${element}"]`)
    : el.scheduleBody.querySelector(`.schedule-group-row[data-group="${group}"]`);
  next?.classList.add("picked");
}

/** "from 1 March 2026", or nothing for a book with no date (the sample file has none). */
function rateBookEffective() {
  const from = rateBook?.effectiveFrom;
  if (!from) return "";
  const date = new Date(from);
  return Number.isNaN(date.getTime())
    ? `from ${from}`
    : `from ${date.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })}`;
}

function openSchedule(title, rows, { priced }) {
  scheduleRowsCache = rows;
  schedulePriced = Boolean(priced);
  if (el.scheduleOverlay) el.scheduleOverlay.hidden = false;
  if (el.scheduleTitle) el.scheduleTitle.textContent = title;
  // Which price list produced these figures, beside the line count: a priced
  // schedule that does not say what it was priced against is not evidence of
  // anything.
  if (el.scheduleKicker) {
    el.scheduleKicker.textContent = [
      `${rows.length} lines`,
      ...(priced ? [rateBook?.name, rateBookEffective()] : []),
    ].filter(Boolean).join(" · ");
  }
  // Warnings are inserted after this returns. Clear first so a second open
  // does not keep the previous banner.
  if (el.scheduleBody) el.scheduleBody.replaceChildren();
  // Re-opening the schedule from the ribbon is a fresh read of the drawing,
  // so it comes back full-screen; peek is a state locating puts it into.
  setSchedulePeek(false);
  clearSchedulePicks();
  loadSchedule3d();
}

function closeSchedule() {
  clearSchedulePicks();
  if (el.scheduleOverlay) el.scheduleOverlay.hidden = true;
  setSchedulePeek(false);
  clearLocateFlash();
}

/** Full-screen table <-> docked beside the plan. The only reason the panel
 *  has two sizes: a schedule is read full-width, but a located element is
 *  looked at on the plan. */
function setSchedulePeek(on) {
  schedulePeeking = Boolean(on);
  el.scheduleOverlay?.classList.toggle("peek", schedulePeeking);
  if (el.schedulePeek) el.schedulePeek.textContent = schedulePeeking ? "Full table" : "Peek plan";
  paintSchedule();
}

function runBoq() {
  const out = compile(store.doc, pack);
  if (!out) return;
  const rows = boqRows(out, rateBook);
  const unpriced = rows.filter((r) => !r.priced).length;
  const derived = rows.filter((r) => r.derived).length;
  openSchedule("BOQ — bill of quantities", rows, { priced: true });
  const warnings = [
    derived ? `${derived} fitting ${derived === 1 ? "line is" : "lines are"} counted from the route's bends. The template names no fitting type for ${derived === 1 ? "it" : "them"}, so price by the line's code.` : null,
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
function elementCenter(ref, obj, walls = null) {
  switch (ref.kind) {
    case "room": return roomCentroid(obj);
    case "slab": case "roof": {
      const poly = shapePolygon(obj.shape);
      if (poly.length < 3) return null;
      const sum = poly.reduce((s, p) => ({ x: s.x + p[0], y: s.y + p[1] }), { x: 0, y: 0 });
      return { x: sum.x / poly.length, y: sum.y / poly.length };
    }
    case "segment": case "beam": case "line":
      return { x: (obj.x1 + obj.x2) / 2, y: (obj.y1 + obj.y2) / 2 };
    case "item": case "stair":
      return Number.isFinite(obj.x) && Number.isFinite(obj.y) ? { x: obj.x, y: obj.y } : null;
    case "opening": {
      const wall = wallForOpening(store.doc, pack, walls || deriveWalls(store.doc, pack), obj);
      if (!wall) return null;
      const placed = openingOnWall(store.doc, pack, obj, wall);
      return { x: (placed.a.x + placed.b.x) / 2, y: (placed.a.y + placed.b.y) / 2 };
    }
    case "serviceNode": case "serviceEdge":
      return serviceElementCentre(store.doc, ref);
    default: return null;
  }
}

/** Plan extent of a doc entity as a point list, so a pan can tell whether any
 *  part of a long wall is already on screen and, if not, which edge is nearest.
 *  Falls back to the centre for kinds with no cheap outline of their own. */
function elementExtent(ref, obj, walls = null) {
  switch (ref.kind) {
    case "room": case "slab": case "roof": {
      const poly = shapePolygon(obj.shape);
      if (poly.length >= 3) return poly.map(([x, y]) => ({ x, y }));
      break;
    }
    case "segment": case "beam": case "line":
      return [{ x: obj.x1, y: obj.y1 }, { x: obj.x2, y: obj.y2 }];
    default: break;
  }
  const center = elementCenter(ref, obj, walls);
  return center ? [center] : [];
}

/** The storey a located element lives on, by the same rules the plan draws
 *  it with: an opening belongs to its host wall, a service run to the level
 *  it leaves from. */
function elementLevel(ref, obj, walls = null) {
  if (ref.kind === "opening") {
    return wallForOpening(store.doc, pack, walls || deriveWalls(store.doc, pack), obj)?.level || null;
  }
  if (ref.kind === "serviceEdge") return edgeHomeLevel(store.doc, pack, obj);
  return effectiveLevel(obj, pack) || null;
}

/** Bring these points into the visible plan without changing zoom. If any
 *  part is already on screen, the camera stays put. Otherwise it shifts only
 *  along the axes where they sit off-screen, and only until the near edge
 *  clears the border — not until they are centred. */
function framePlanPoints(points) {
  if (!points.length || !el.canvas) return;
  const rect = el.canvas.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return;
  // While peeking, the docked panel sits over the right of the canvas.
  // That strip is not "on screen": an element under the panel still needs a nudge.
  const panel = schedulePeeking ? el.scheduleOverlay?.querySelector(".schedule-panel") : null;
  let viewW = rect.width;
  if (panel) {
    const p = panel.getBoundingClientRect();
    if (p.left < rect.right && p.right > rect.left) {
      viewW = Math.max(160, p.left - rect.left - 12);
    }
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const pad = Math.min(24, viewW / 4, rect.height / 4);
  // How far to slide one axis so the near edge lands `pad` inside the view.
  // Zero when the extent already overlaps that axis.
  const shift = (near, far, vis0, vis1) => {
    if (far < vis0) return vis0 + pad - far;
    if (near > vis1) return vis1 - pad - near;
    return 0;
  };
  cam.ox += shift(cam.ox + Math.min(...xs) * cam.scale, cam.ox + Math.max(...xs) * cam.scale, 0, viewW);
  cam.oy += shift(cam.oy + Math.min(...ys) * cam.scale, cam.oy + Math.max(...ys) * cam.scale, 0, rect.height);
}

// A located element is selected, but on a busy plan a selection outline is
// not enough to answer "which one did I just click". The flash is a short
// pulsing ring over each located element, drawn on top of everything and
// gone within the second - a pointer, not a state.
const LOCATE_FLASH_MS = 1100;
let locateFlash = null;
let locateFlashFrame = 0;

function clearLocateFlash() {
  if (locateFlashFrame) cancelAnimationFrame(locateFlashFrame);
  locateFlashFrame = 0;
  locateFlash = null;
}

function startLocateFlash(points, levelId) {
  clearLocateFlash();
  if (!points.length) return;
  locateFlash = { points, levelId, start: performance.now() };
  const step = () => {
    if (!locateFlash) return;
    if (performance.now() - locateFlash.start >= LOCATE_FLASH_MS) {
      locateFlash = null;
      locateFlashFrame = 0;
      render();
      return;
    }
    locateFlashFrame = requestAnimationFrame(step);
    render();
  };
  locateFlashFrame = requestAnimationFrame(step);
}

function drawLocateFlash() {
  if (!locateFlash || locateFlash.levelId !== activeLevel) return;
  const t = (performance.now() - locateFlash.start) / LOCATE_FLASH_MS;
  if (t >= 1) return;
  // Two pulses over the life of the flash, fading out as it goes.
  const pulse = Math.abs(Math.sin(t * Math.PI * 2));
  ctx.save();
  ctx.strokeStyle = COLOUR.hover;
  ctx.globalAlpha = (1 - t) * (0.35 + 0.65 * pulse);
  ctx.lineWidth = 2.4;
  ctx.setLineDash([]);
  for (const p of locateFlash.points) {
    const [sx, sy] = worldToScreen(p.x, p.y);
    ctx.beginPath();
    ctx.arc(sx, sy, 10 + 16 * pulse, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Output > Schedules > Show on plan / Show all. Selects every ref it can
 * still find, switches to the storey most of them are on, pans to them, and
 * flashes them. The schedule stays open in peek mode: the point of clicking
 * a schedule line is to compare the line with the plan, and closing the
 * table to show the plan loses half of that.
 *
 * Refs on other storeys stay selected (selection is not level-scoped) but
 * are not drawn, so the count that is actually on screen is reported rather
 * than left for the user to notice.
 */
function locateScheduleRefs(refs, label) {
  const found = refs
    .map((ref) => ({ ref, obj: objectByRef(store.doc, ref) }))
    .filter((entry) => entry.obj);
  if (!found.length) {
    setStatusMessage(
      refs.length === 1
        ? "That element is no longer in the drawing."
        : "None of those elements are in the drawing any more.",
      "warn",
    );
    return;
  }
  // Openings have no level or position of their own - both come from the
  // host wall - so derive the wall set once for the whole batch rather than
  // once per opening.
  const walls = found.some((entry) => entry.ref.kind === "opening")
    ? deriveWalls(store.doc, pack)
    : null;

  // Whichever storey holds most of them: for a type spanning a stack, that
  // is the one worth looking at first.
  const byLevel = new Map();
  for (const entry of found) {
    entry.level = elementLevel(entry.ref, entry.obj, walls);
    if (!entry.level) continue;
    byLevel.set(entry.level, (byLevel.get(entry.level) || 0) + 1);
  }
  let target = activeLevel;
  if (!byLevel.has(activeLevel) && byLevel.size) {
    target = [...byLevel.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  if (target && target !== activeLevel) {
    activeLevel = target;
    drawLevelSwitcher();
  }

  // Peek first: the docked panel covers the right of the canvas, so the
  // nudge below has to treat that strip as off-screen.
  setSchedulePeek(true);
  const onLevel = found.filter((entry) => !entry.level || entry.level === activeLevel);
  const extent = onLevel.flatMap((entry) => elementExtent(entry.ref, entry.obj, walls));
  framePlanPoints(extent);
  const centres = onLevel
    .map((entry) => elementCenter(entry.ref, entry.obj, walls))
    .filter(Boolean);

  const selection = found.map((entry) => entry.ref);
  store.setSelection(selection, selection[0]);
  startLocateFlash(centres, activeLevel);

  const elsewhere = found.length - onLevel.length;
  const what = label ? ` of ${label}` : "";
  setStatusMessage(
    found.length === 1
      ? `Showing ${found[0].ref.kind} ${found[0].ref.id} on ${levelName(activeLevel)}.`
      : `Selected ${found.length} element${found.length === 1 ? "" : "s"}${what}. ${onLevel.length} shown on ${levelName(activeLevel)}${elsewhere ? `, ${elsewhere} on other storeys` : ""}.`,
    "ok",
  );
  drawRibbon();
  render();
}

function toggleScheduleGroup(groupRow) {
  const row = scheduleRowsCache[Number(groupRow.dataset.group)];
  const elementsRow = el.scheduleBody.querySelector(
    `.schedule-elements-row[data-group="${groupRow.dataset.group}"]`,
  );
  if (!elementsRow) return;
  elementsRow.hidden = !elementsRow.hidden;
  groupRow.classList.toggle("open", !elementsRow.hidden);
  groupRow.querySelector(".schedule-caret-btn")?.setAttribute("aria-expanded", String(!elementsRow.hidden));
  if (!row) return;
  const key = scheduleGroupKey(row);
  if (elementsRow.hidden) scheduleOpenGroups.delete(key);
  else scheduleOpenGroups.add(key);
}

function wireSchedule() {
  el.scheduleClose?.addEventListener("click", closeSchedule);
  el.schedulePeek?.addEventListener("click", () => setSchedulePeek(!schedulePeeking));
  el.scheduleOverlay?.addEventListener("click", (event) => {
    // In peek mode the backdrop is not there to be dismissed - it is the plan.
    if (event.target === el.scheduleOverlay && !schedulePeeking) closeSchedule();
  });
  // The deliberate jump out of the table: same locator the side view uses,
  // fed whatever is picked. Changes the level, selection and plan camera.
  el.schedule3dDrawing?.addEventListener("click", () => {
    if (!schedule3dTarget) return;
    locateScheduleRefs(schedule3dTarget.refs, schedule3dTarget.label);
  });
  document.querySelectorAll('input[name="v2-schedule-view"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      scheduleView3d?.setFlat(scheduleModelIs2d());
      applySchedule3dPick();
    });
  });
  // The row is the control: no per-line buttons.
  el.scheduleBody?.addEventListener("click", (event) => {
    const elementRow = event.target.closest(".schedule-element");
    if (elementRow) {
      const row = scheduleRowsCache[Number(elementRow.dataset.group)];
      const element = row?.elements?.[Number(elementRow.dataset.element)];
      if (element?.kind) pickScheduleRefs([{ kind: element.kind, id: element.id }], element.id, elementRow);
      return;
    }
    // Only the chevron expands/collapses; the rest of the row just picks.
    const caret = event.target.closest(".schedule-caret-btn");
    if (caret) {
      const toggled = caret.closest(".schedule-group-row");
      if (toggled) toggleScheduleGroup(toggled);
      return;
    }
    const groupRow = event.target.closest(".schedule-group-row");
    if (groupRow) {
      const row = scheduleRowsCache[Number(groupRow.dataset.group)];
      pickScheduleRefs(scheduleGroupRefs(row), row?.model || row?.category || null, groupRow);
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
