const PLANNER_STORE = "sp-planner-document-v1";
const GRID = 0.1;
const MIN_ROOM = 1;
const MIN_SLAB = 0.5;
const MIN_TRACE = 0.3;
const HANDLE = 8;

const plannerEls = {
  canvas: document.getElementById("planner-plan"),
  empty: document.getElementById("planner-empty"),
  skuList: document.getElementById("planner-sku-list"),
  search: document.getElementById("planner-search"),
  inspect: document.getElementById("planner-inspect"),
  kicker: document.getElementById("planner-inspect-kicker"),
  packName: document.getElementById("planner-pack-name"),
  roomW: document.getElementById("planner-room-w"),
  roomH: document.getElementById("planner-room-h"),
  sizeHud: document.getElementById("planner-size-hud"),
  hudW: document.getElementById("planner-hud-w"),
  hudH: document.getElementById("planner-hud-h"),
  typePicker: document.getElementById("type-picker"),
  typeTitle: document.getElementById("type-picker-title"),
  typePrompt: document.getElementById("type-picker-prompt"),
  typeSearch: document.getElementById("type-picker-search"),
  typeList: document.getElementById("type-picker-list"),
  typeCancel: document.getElementById("type-picker-cancel"),
  typeOk: document.getElementById("type-picker-ok"),
};

const plannerCtx = plannerEls.canvas?.getContext("2d");

let pack = null;
let doc = emptyDoc();
let undoStack = [];
let tool = "select";
let placeSkuId = null;
let selection = null;
let selected = [];
let hover = null;
let drag = null;
let pickCycle = null;
let sizeDraft = null;
let beamStart = null;
let typePick = null;
let cam = { scale: 48, ox: 64, oy: 64 };
let placeStatus = "planned";

function objectStatus(obj) {
  return obj?.status === "existing" ? "existing" : "planned";
}

function combineStatus(objs) {
  const set = new Set((objs || []).map(objectStatus));
  if (set.size === 1) {
    return [...set][0];
  }
  if (set.has("existing") && set.has("planned")) {
    return "mixed";
  }
  return "planned";
}

function withPlaceStatus(row) {
  row.status = placeStatus;
  return row;
}

function statusControlHtml(obj) {
  const cur = objectStatus(obj);
  return `<div class="seg insp-status" role="group" aria-label="Object status">
    <button type="button" data-status="existing"${cur === "existing" ? " class=\"active\"" : ""}>Existing</button>
    <button type="button" data-status="planned"${cur === "planned" ? " class=\"active\"" : ""}>Planned</button>
  </div>`;
}

function bindStatusControl(obj) {
  plannerEls.inspect?.querySelectorAll("[data-status]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.status;
      if (objectStatus(obj) === next) {
        return;
      }
      pushUndo();
      obj.status = next;
      persist();
      refreshPlanner();
      maybePushCompile();
    });
  });
}

function emptyDoc() {
  return { rooms: [], openings: [], items: [], beams: [], traces: [], slabs: [], roofs: [], groups: [] };
}

function hasPlannerContent() {
  return Boolean(doc.rooms.length || doc.traces.length || doc.slabs.length || doc.roofs.length);
}

function nid(prefix) {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}`;
}

function roundGrid(n) {
  return Math.round(n / GRID) * GRID;
}

function formatMetres(n) {
  return (Math.round(Number(n) * 10) / 10).toFixed(1);
}

function parseMetres(raw, fallback) {
  const n = Number(String(raw ?? "").trim().replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.max(MIN_ROOM, roundGrid(n));
}

const ROOF_FORMS = ["flat", "gable", "shed", "hip"];
const DEFAULT_ROOF_PITCH = 30;

function normalizeRoofForm(form) {
  const value = String(form || "flat").toLowerCase();
  return ROOF_FORMS.includes(value) ? value : "flat";
}

function normalizeRoofRidge(ridge) {
  return ridge === "short" ? "short" : "long";
}

function roofPitchDeg(roof) {
  if (normalizeRoofForm(roof?.form) === "flat") {
    return 0;
  }
  const n = Number(roof?.pitch);
  if (!Number.isFinite(n)) {
    return DEFAULT_ROOF_PITCH;
  }
  return Math.min(60, Math.max(5, n));
}

function roofRidgeAlongX(rect, ridge) {
  const alongLong = normalizeRoofRidge(ridge) !== "short";
  const wide = rect.w >= rect.h;
  return alongLong === wide;
}

function defaultRoofShape() {
  return { form: "gable", pitch: DEFAULT_ROOF_PITCH, ridge: "long" };
}

function ensureRoofShape(roof) {
  if (!roof) {
    return roof;
  }
  if (ROOF_FORMS.includes(String(roof.form || "").toLowerCase())) {
    return roof;
  }
  return { ...roof, ...defaultRoofShape() };
}

function emptySizeDraft() {
  return { lockW: false, lockH: false, typedW: "", typedH: "", axis: "w" };
}

function sizingDrag() {
  return drag?.kind === "resize" || drag?.kind === "room-new" || drag?.kind === "slab-new" || drag?.kind === "roof-new";
}

function patchByKind(kind, id) {
  if (kind === "room") {
    return doc.rooms.find((r) => r.id === id) || null;
  }
  if (kind === "slab") {
    return doc.slabs.find((s) => s.id === id) || null;
  }
  if (kind === "roof") {
    return doc.roofs.find((s) => s.id === id) || null;
  }
  return null;
}

function selKey(ref) {
  return `${ref.kind}:${ref.id}`;
}

function sameRef(a, b) {
  return Boolean(a && b && a.kind === b.kind && a.id === b.id);
}

function uniqueRefs(refs) {
  const seen = new Set();
  const out = [];
  for (const ref of refs || []) {
    if (!ref?.kind || ref.id == null) {
      continue;
    }
    const key = selKey(ref);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({ kind: ref.kind, id: ref.id });
  }
  return out;
}

function isSelected(kind, id) {
  return selected.some((row) => row.kind === kind && row.id === id);
}

function objectByRef(ref) {
  if (!ref) {
    return null;
  }
  if (ref.kind === "room") {
    return doc.rooms.find((r) => r.id === ref.id) || null;
  }
  if (ref.kind === "slab") {
    return doc.slabs.find((s) => s.id === ref.id) || null;
  }
  if (ref.kind === "roof") {
    return doc.roofs.find((s) => s.id === ref.id) || null;
  }
  if (ref.kind === "trace") {
    return doc.traces.find((t) => t.id === ref.id) || null;
  }
  if (ref.kind === "item") {
    return doc.items.find((i) => i.id === ref.id) || null;
  }
  if (ref.kind === "beam") {
    return doc.beams.find((b) => b.id === ref.id) || null;
  }
  if (ref.kind === "opening") {
    return doc.openings.find((o) => o.id === ref.id) || null;
  }
  return null;
}

function objectExists(ref) {
  return Boolean(objectByRef(ref));
}

function ensureGroups() {
  if (!Array.isArray(doc.groups)) {
    doc.groups = [];
  }
  return doc.groups;
}

function groupForRef(ref) {
  return ensureGroups().find((group) => (group.members || []).some((member) => sameRef(member, ref))) || null;
}

function expandRefsWithGroups(refs) {
  const out = [];
  for (const ref of refs || []) {
    const group = groupForRef(ref);
    if (group) {
      out.push(...(group.members || []));
    } else {
      out.push(ref);
    }
  }
  return uniqueRefs(out).filter(objectExists);
}

function setSelection(refs, primary = null) {
  selected = uniqueRefs(refs).filter(objectExists);
  if (primary && selected.some((row) => sameRef(row, primary))) {
    selection = { kind: primary.kind, id: primary.id };
  } else {
    selection = selected[0] || null;
  }
}

function clearSelection() {
  selected = [];
  selection = null;
}

function selectOne(ref, expandGroup = true) {
  if (!ref) {
    clearSelection();
    return;
  }
  setSelection(expandGroup ? expandRefsWithGroups([ref]) : [ref], ref);
}

function toggleRefs(refs, primary) {
  const batch = uniqueRefs(refs).filter(objectExists);
  if (!batch.length) {
    return;
  }
  const allOn = batch.every((row) => isSelected(row.kind, row.id));
  if (allOn) {
    const drop = new Set(batch.map(selKey));
    const next = selected.filter((row) => !drop.has(selKey(row)));
    const keep = primary && next.some((row) => sameRef(row, primary)) ? primary : null;
    setSelection(next, keep);
    return;
  }
  setSelection([...selected, ...batch], primary || batch[0]);
}

function refFromHit(hit) {
  if (!hit) {
    return null;
  }
  if (hit.kind === "handle") {
    return { kind: hit.target || selection?.kind || "room", id: hit.id };
  }
  if (hit.kind === "room-edge") {
    return { kind: "room", id: hit.id };
  }
  return { kind: hit.kind, id: hit.id };
}

function canTranslateRef(ref) {
  return ["room", "slab", "roof", "trace", "item", "beam"].includes(ref?.kind);
}

function soleSelection() {
  return selected.length === 1 ? selected[0] : null;
}

function pruneGroups() {
  doc.groups = ensureGroups()
    .map((group) => ({
      ...group,
      members: uniqueRefs(group.members || []).filter(objectExists),
    }))
    .filter((group) => group.members.length >= 2);
}

function ungroupRefs(refs) {
  const drop = new Set(uniqueRefs(refs).map(selKey));
  doc.groups = ensureGroups()
    .map((group) => ({
      ...group,
      members: (group.members || []).filter((member) => !drop.has(selKey(member))),
    }))
    .filter((group) => group.members.length >= 2);
}

function selectedGroups() {
  const seen = new Set();
  const groups = [];
  for (const ref of selected) {
    const group = groupForRef(ref);
    if (group && !seen.has(group.id)) {
      seen.add(group.id);
      groups.push(group);
    }
  }
  return groups;
}

function nextGroupName() {
  return `Group ${ensureGroups().length + 1}`;
}

function wholeGroupSelected(group) {
  if (!group?.members?.length) {
    return false;
  }
  return group.members.every((member) => isSelected(member.kind, member.id))
    && selected.length === uniqueRefs(group.members).length;
}

function groupSelection() {
  const members = uniqueRefs(selected).filter(objectExists);
  if (members.length < 2) {
    return;
  }
  pushUndo();
  ungroupRefs(members);
  ensureGroups().push({
    id: nid("g"),
    name: nextGroupName(),
    members,
  });
  setSelection(members, selection);
  persist();
  refreshPlanner();
}

function ungroupSelection() {
  const refs = selected.length ? selected : (selection ? [selection] : []);
  if (!refs.some((ref) => groupForRef(ref))) {
    return;
  }
  pushUndo();
  ungroupRefs(refs);
  persist();
  refreshPlanner();
}

function snapshotMoveTargets(refs) {
  const snaps = [];
  for (const ref of uniqueRefs(refs)) {
    if (ref.kind === "room" || ref.kind === "slab" || ref.kind === "roof") {
      const patch = patchByKind(ref.kind, ref.id);
      if (patch?.rect) {
        snaps.push({ ref, x: patch.rect.x, y: patch.rect.y });
      }
    } else if (ref.kind === "trace") {
      const trace = doc.traces.find((row) => row.id === ref.id);
      if (trace) {
        snaps.push({ ref, x1: trace.x1, y1: trace.y1, x2: trace.x2, y2: trace.y2 });
      }
    } else if (ref.kind === "item") {
      const item = doc.items.find((row) => row.id === ref.id);
      if (item) {
        snaps.push({ ref, x: item.x, y: item.y });
      }
    } else if (ref.kind === "beam") {
      const beam = doc.beams.find((row) => row.id === ref.id);
      if (beam) {
        snaps.push({ ref, x1: beam.x1, y1: beam.y1, x2: beam.x2, y2: beam.y2 });
      }
    }
  }
  return snaps;
}

function applyMoveSnapshot(snaps, dx, dy) {
  for (const snap of snaps) {
    const { ref } = snap;
    if (ref.kind === "room" || ref.kind === "slab" || ref.kind === "roof") {
      const patch = patchByKind(ref.kind, ref.id);
      if (patch?.rect) {
        patch.rect.x = roundGrid(snap.x + dx);
        patch.rect.y = roundGrid(snap.y + dy);
      }
    } else if (ref.kind === "trace") {
      const trace = doc.traces.find((row) => row.id === ref.id);
      if (trace) {
        trace.x1 = roundGrid(snap.x1 + dx);
        trace.y1 = roundGrid(snap.y1 + dy);
        trace.x2 = roundGrid(snap.x2 + dx);
        trace.y2 = roundGrid(snap.y2 + dy);
      }
    } else if (ref.kind === "item") {
      const item = doc.items.find((row) => row.id === ref.id);
      if (item) {
        item.x = roundGrid(snap.x + dx);
        item.y = roundGrid(snap.y + dy);
      }
    } else if (ref.kind === "beam") {
      const beam = doc.beams.find((row) => row.id === ref.id);
      if (beam) {
        beam.x1 = roundGrid(snap.x1 + dx);
        beam.y1 = roundGrid(snap.y1 + dy);
        beam.x2 = roundGrid(snap.x2 + dx);
        beam.y2 = roundGrid(snap.y2 + dy);
      }
    }
  }
}

function overlapsRect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function containsRect(outer, inner) {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w + 1e-6
    && inner.y + inner.h <= outer.y + outer.h + 1e-6;
}

function pointInWorldRect(x, y, box) {
  return x >= box.x && y >= box.y && x <= box.x + box.w && y <= box.y + box.h;
}

function marqueeBox(x0, y0, x1, y1) {
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    w: Math.abs(x1 - x0),
    h: Math.abs(y1 - y0),
    crossing: x1 < x0,
  };
}

function segMatchesMarquee(x1, y1, x2, y2, box) {
  if (box.crossing) {
    const bounds = {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.max(0.02, Math.abs(x2 - x1)),
      h: Math.max(0.02, Math.abs(y2 - y1)),
    };
    return overlapsRect(box, bounds) || pointInWorldRect(x1, y1, box) || pointInWorldRect(x2, y2, box);
  }
  return pointInWorldRect(x1, y1, box) && pointInWorldRect(x2, y2, box);
}

function refsInMarquee(box) {
  if (box.w < GRID / 2 && box.h < GRID / 2) {
    return [];
  }
  const hits = [];
  const testRect = (rect) => (box.crossing ? overlapsRect(box, rect) : containsRect(box, rect));
  for (const room of doc.rooms) {
    if (testRect(room.rect)) {
      hits.push({ kind: "room", id: room.id });
    }
  }
  for (const slab of doc.slabs) {
    if (testRect(slab.rect)) {
      hits.push({ kind: "slab", id: slab.id });
    }
  }
  for (const roof of doc.roofs) {
    if (testRect(roof.rect)) {
      hits.push({ kind: "roof", id: roof.id });
    }
  }
  for (const trace of doc.traces) {
    if (segMatchesMarquee(trace.x1, trace.y1, trace.x2, trace.y2, box)) {
      hits.push({ kind: "trace", id: trace.id });
    }
  }
  for (const beam of doc.beams) {
    if (segMatchesMarquee(beam.x1, beam.y1, beam.x2, beam.y2, box)) {
      hits.push({ kind: "beam", id: beam.id });
    }
  }
  for (const item of doc.items) {
    const sku = skuById(item.sku) || { width: 0.2, depth: 0.2 };
    const boxItem = itemRect(item, sku);
    if (testRect(boxItem)) {
      hits.push({ kind: "item", id: item.id });
    }
  }
  for (const opening of doc.openings) {
    const wall = wallForOpening(opening);
    if (!wall) {
      continue;
    }
    const placed = openingOnWall(opening, wall);
    const mx = (placed.a.x + placed.b.x) / 2;
    const my = (placed.a.y + placed.b.y) / 2;
    if (pointInWorldRect(mx, my, box)) {
      hits.push({ kind: "opening", id: opening.id });
    }
  }
  return hits;
}

function allSelectableRefs() {
  return [
    ...doc.rooms.map((row) => ({ kind: "room", id: row.id })),
    ...doc.slabs.map((row) => ({ kind: "slab", id: row.id })),
    ...doc.roofs.map((row) => ({ kind: "roof", id: row.id })),
    ...doc.traces.map((row) => ({ kind: "trace", id: row.id })),
    ...doc.beams.map((row) => ({ kind: "beam", id: row.id })),
    ...doc.items.map((row) => ({ kind: "item", id: row.id })),
    ...doc.openings.map((row) => ({ kind: "opening", id: row.id })),
  ];
}

function selectAll() {
  setSelection(allSelectableRefs());
  refreshPlanner();
}

function activeSizeRect() {
  if (drag?.kind === "resize") {
    return patchByKind(drag.target || "room", drag.id)?.rect || null;
  }
  if (drag?.kind === "room-new" || drag?.kind === "slab-new" || drag?.kind === "roof-new") {
    return drag.rect;
  }
  if (selected.length === 1 && (selection?.kind === "room" || selection?.kind === "slab" || selection?.kind === "roof")) {
    return patchByKind(selection.kind, selection.id)?.rect || null;
  }
  return null;
}

function applySizeDraftTo(rect) {
  if (!rect || !sizeDraft) {
    return;
  }
  if (sizeDraft.lockW) {
    rect.w = parseMetres(sizeDraft.typedW, rect.w);
  }
  if (sizeDraft.lockH) {
    rect.h = parseMetres(sizeDraft.typedH, rect.h);
  }
}

function syncSizeHud() {
  const hud = plannerEls.sizeHud;
  const wIn = plannerEls.hudW;
  const hIn = plannerEls.hudH;
  if (!hud || !wIn || !hIn) {
    return;
  }
  const rect = activeSizeRect();
  const show = Boolean(rect);
  hud.hidden = !show;
  if (!show || !rect) {
    wIn.classList.remove("typed");
    hIn.classList.remove("typed");
    return;
  }
  if (document.activeElement !== wIn) {
    wIn.value = sizeDraft?.lockW ? sizeDraft.typedW : formatMetres(rect.w);
  }
  if (document.activeElement !== hIn) {
    hIn.value = sizeDraft?.lockH ? sizeDraft.typedH : formatMetres(rect.h);
  }
  wIn.classList.toggle("typed", Boolean(sizeDraft?.lockW));
  hIn.classList.toggle("typed", Boolean(sizeDraft?.lockH));
}

function commitHudAxis(axis, raw) {
  if (!sizeDraft) {
    sizeDraft = emptySizeDraft();
  }
  if (axis === "w") {
    sizeDraft.lockW = true;
    sizeDraft.typedW = raw;
    sizeDraft.axis = "w";
  } else {
    sizeDraft.lockH = true;
    sizeDraft.typedH = raw;
    sizeDraft.axis = "h";
  }
  if (drag?.kind === "room-new" && !drag.rect) {
    drag.rect = {
      x: roundGrid(drag.x0),
      y: roundGrid(drag.y0),
      w: parseMetres(sizeDraft.typedW, Number(plannerEls.roomW?.value) || 4),
      h: parseMetres(sizeDraft.typedH, Number(plannerEls.roomH?.value) || 3),
    };
  }
  const rect = activeSizeRect();
  if (!rect) {
    return;
  }
  if (!drag && selected.length === 1 && selection && ["room", "slab", "roof"].includes(selection.kind) && !sizeDraft.undoPushed) {
    pushUndo();
    sizeDraft.undoPushed = true;
  }
  applySizeDraftTo(rect);
  drawPlanner();
  syncInspectSize(rect);
  if (!drag) {
    persist();
    maybePushCompile();
  }
}

function handleSizeTyping(event) {
  if (!sizingDrag()) {
    return false;
  }
  const tag = event.target?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
    if (event.target !== plannerEls.hudW && event.target !== plannerEls.hudH) {
      return false;
    }
  }
  if (!sizeDraft) {
    sizeDraft = emptySizeDraft();
  }
  if (event.key === "Tab") {
    event.preventDefault();
    sizeDraft.axis = sizeDraft.axis === "w" ? "h" : "w";
    const next = sizeDraft.axis === "w" ? plannerEls.hudW : plannerEls.hudH;
    next?.focus();
    next?.select();
    return true;
  }
  if (event.key === "x" || event.key === "X" || event.key === "*") {
    event.preventDefault();
    sizeDraft.axis = "h";
    plannerEls.hudH?.focus();
    plannerEls.hudH?.select();
    return true;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    if (sizeDraft.axis === "w" && !sizeDraft.lockH) {
      sizeDraft.axis = "h";
      plannerEls.hudH?.focus();
      plannerEls.hudH?.select();
    } else {
      plannerEls.hudW?.blur();
      plannerEls.hudH?.blur();
    }
    return true;
  }
  if (event.target === plannerEls.hudW || event.target === plannerEls.hudH) {
    return false;
  }
  if (event.key === "Backspace") {
    event.preventDefault();
    const axis = sizeDraft.axis;
    const cur = axis === "w" ? sizeDraft.typedW : sizeDraft.typedH;
    const next = (sizeDraft[axis === "w" ? "lockW" : "lockH"] ? cur : "").slice(0, -1);
    commitHudAxis(axis, next);
    const input = axis === "w" ? plannerEls.hudW : plannerEls.hudH;
    if (input) {
      input.value = next;
    }
    return true;
  }
  if (/^[0-9.,]$/.test(event.key)) {
    event.preventDefault();
    const axis = sizeDraft.axis;
    const locked = axis === "w" ? sizeDraft.lockW : sizeDraft.lockH;
    const cur = axis === "w" ? sizeDraft.typedW : sizeDraft.typedH;
    const next = (locked ? cur : "") + event.key;
    commitHudAxis(axis, next);
    const input = axis === "w" ? plannerEls.hudW : plannerEls.hudH;
    if (input) {
      input.focus();
      input.value = next;
    }
    return true;
  }
  return false;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function skuById(id) {
  return pack?.skus.find((sku) => sku.id === id) || null;
}

function firstSkuId(category) {
  return pack?.skus.find((sku) => sku.category === category && sku.draw !== "hidden")?.id || null;
}

function openingTool() {
  if (tool === "door" || tool === "window") {
    return tool;
  }
  const sku = skuById(placeSkuId);
  if (tool === "place" && (sku?.category === "door" || sku?.category === "window")) {
    return sku.category;
  }
  return null;
}

function allowedHosts(skuId) {
  return pack?.recipes?.allowedHosts?.[skuId] || null;
}

function categoryNoun(cat) {
  return ({
    wall: "wall",
    floor: "slab",
    roof: "roof",
    foundation: "foundation",
    door: "door",
    window: "window",
    beam: "beam",
    furniture: "furniture",
    electrical: "electrical fixture",
    plumbing: "plumbing fixture",
  })[cat] || cat;
}

function visibleSkus(category) {
  const cats = Array.isArray(category) ? category : [category];
  return (pack?.skus || []).filter((sku) => cats.includes(sku.category) && sku.draw !== "hidden");
}

function skuFamily(sku) {
  if (!sku) {
    return "";
  }
  if (sku.family) {
    return sku.family;
  }
  if (sku.category === "door") {
    return "Single-Flush";
  }
  if (sku.category === "window") {
    return "Fixed";
  }
  return "";
}

function skuDimLabel(sku) {
  if (!sku) {
    return "";
  }
  if (sku.width && sku.height && (sku.category === "door" || sku.category === "window")) {
    return `${Math.round(sku.width * 1000)} × ${Math.round(sku.height * 1000)} mm`;
  }
  if (sku.width && sku.depth && sku.category !== "beam" && sku.category !== "foundation") {
    return `${Math.round(sku.width * 1000)} × ${Math.round(sku.depth * 1000)} mm`;
  }
  if (sku.thickness) {
    return `${Math.round(sku.thickness * 1000)} mm`;
  }
  if (sku.width) {
    return `${Math.round(sku.width * 1000)} mm`;
  }
  return sku.id;
}

function skuTypeLabel(sku) {
  const family = skuFamily(sku);
  if (family && family !== sku.name) {
    return `${family}  ·  ${sku.name}`;
  }
  return sku.name;
}

function categoryLabel(cat) {
  return ({
    wall: "Walls",
    floor: "Floors",
    roof: "Roofs",
    foundation: "Foundations",
    door: "Doors",
    window: "Windows",
    beam: "Beams",
    furniture: "Furniture",
    electrical: "Electrical",
    plumbing: "Plumbing",
  })[cat] || cat;
}

function instanceCategory(cat) {
  return ({
    wall: "Walls",
    floor: "Floors",
    roof: "Roofs",
    foundation: "Walls",
    door: "Doors",
    window: "Windows",
    beam: "Beams",
    furniture: "Furniture",
    electrical: "Electrical",
    plumbing: "Plumbing",
  })[cat] || cat;
}

function persist() {
  try {
    localStorage.setItem(PLANNER_STORE, JSON.stringify(doc));
  } catch {
    // ignore quota
  }
}

function pushUndo() {
  undoStack.push(clone(doc));
  if (undoStack.length > 60) {
    undoStack.shift();
  }
}

function undo() {
  const prev = undoStack.pop();
  if (!prev) {
    return;
  }
  doc = prev;
  clearSelection();
  persist();
  refreshPlanner();
  maybePushCompile();
}

function loadStored() {
  try {
    const raw = localStorage.getItem(PLANNER_STORE);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.rooms)) {
      doc = {
        rooms: parsed.rooms,
        openings: parsed.openings || [],
        items: parsed.items || [],
        beams: parsed.beams || [],
        traces: parsed.traces || [],
        slabs: parsed.slabs || [],
        roofs: (parsed.roofs || []).map(ensureRoofShape),
        groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      };
      pruneGroups();
    }
  } catch {
    doc = emptyDoc();
  }
}

function demoDoc() {
  return {
    rooms: [
      {
        id: "r-bath",
        name: "Bathroom",
        rect: { x: 0, y: 0, w: 4, h: 3 },
        wallSku: pack.system.defaultWallSku,
        floorSku: pack.system.defaultFloorSku,
        status: "existing",
      },
      {
        id: "r-room",
        name: "Room",
        rect: { x: 4, y: 0, w: 4, h: 4 },
        wallSku: pack.system.defaultWallSku,
        floorSku: pack.system.defaultFloorSku,
        status: "planned",
      },
    ],
    openings: [
      { id: "o-door", sku: "TSP_DR900", roomId: "r-bath", edge: "E", t: 0.45, swing: 1, status: "existing" },
      { id: "o-win", sku: "TSP_WN1812", roomId: "r-room", edge: "S", t: 0.5, swing: 1, status: "planned" },
    ],
    items: [
      { id: "i-wc", sku: "TSP_WC001", x: 0.45, y: 2.35, rotation: 0, status: "existing" },
      { id: "i-skt", sku: "TSP_SKT01", x: 3.4, y: 0.4, rotation: 0, status: "planned" },
    ],
    beams: [],
    traces: [
      { id: "t-found", sku: "TSP_CON052", x1: 0, y1: -0.4, x2: 8, y2: -0.4, status: "existing" },
      { id: "t-found-w", sku: "TSP_CON052", x1: 0, y1: -0.4, x2: 0, y2: 3, status: "existing" },
    ],
    slabs: [
      {
        id: "s-balc",
        sku: "TSP_RB017",
        name: "Balcony",
        rect: { x: 8, y: 0, w: 2.2, h: 2.4 },
        level: "02 L1",
        status: "planned",
      },
    ],
    roofs: [
      {
        id: "rf-main",
        sku: "TSP_RC003",
        name: "Roof",
        rect: { x: 0, y: 0, w: 8, h: 4 },
        level: "01 GFL",
        form: "gable",
        pitch: 30,
        ridge: "long",
        status: "planned",
      },
    ],
    groups: [],
  };
}

function deriveWalls() {
  const vertical = new Map();
  const horizontal = new Map();

  const push = (map, key, a, b, room, edge) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (hi - lo < 1e-6) {
      return;
    }
    const k = key.toFixed(3);
    if (!map.has(k)) {
      map.set(k, []);
    }
    map.get(k).push({ lo, hi, room, edge });
  };

  for (const room of doc.rooms) {
    const { x, y, w, h } = room.rect;
    push(vertical, x, y, y + h, room, "W");
    push(vertical, x + w, y, y + h, room, "E");
    push(horizontal, y, x, x + w, room, "S");
    push(horizontal, y + h, x, x + w, room, "N");
  }

  const walls = [];
  splitAxis(vertical, true, walls);
  splitAxis(horizontal, false, walls);
  return walls.concat(traceWalls());
}

function traceWalls() {
  const walls = [];
  for (const trace of doc.traces) {
    const sku = skuById(trace.sku);
    if (!sku) {
      continue;
    }
    const length = Math.hypot(trace.x2 - trace.x1, trace.y2 - trace.y1);
    if (length < MIN_TRACE) {
      continue;
    }
    walls.push({
      id: trace.id,
      x1: trace.x1,
      y1: trace.y1,
      x2: trace.x2,
      y2: trace.y2,
      length,
      sku: sku.id,
      thickness: sku.thickness || sku.width || 0.22,
      height: sku.height || pack.system.wallHeight,
      roomIds: [],
      shared: false,
      edges: [],
      drawn: true,
      category: sku.category,
      status: objectStatus(trace),
    });
  }
  return walls;
}

function packLevels() {
  return pack?.system?.levels || [
    { id: "01 GFL", name: "01 GFL", elevation: 0 },
    { id: "02 L1", name: "02 L1", elevation: 2.8 },
  ];
}

function levelElevation(levelId) {
  const hit = packLevels().find((row) => row.id === levelId || row.name === levelId);
  return hit?.elevation ?? 0;
}

function defaultLevelFor(sku) {
  return sku?.defaultLevel || pack?.system?.defaultLevel || "01 GFL";
}

function axisSeg(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x1: roundGrid(x0), y1: roundGrid(y0), x2: roundGrid(x1), y2: roundGrid(y0) };
  }
  return { x1: roundGrid(x0), y1: roundGrid(y0), x2: roundGrid(x0), y2: roundGrid(y1) };
}

function segLength(seg) {
  return Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
}

function splitAxis(map, isVertical, walls) {
  for (const [key, segs] of map) {
    const coord = Number(key);
    const marks = new Set();
    for (const seg of segs) {
      marks.add(Number(seg.lo.toFixed(3)));
      marks.add(Number(seg.hi.toFixed(3)));
    }
    const pts = [...marks].sort((a, b) => a - b);
    for (let i = 0; i < pts.length - 1; i += 1) {
      const lo = pts[i];
      const hi = pts[i + 1];
      if (hi - lo < GRID / 2) {
        continue;
      }
      const mid = (lo + hi) / 2;
      const hits = segs.filter((seg) => seg.lo <= mid + 1e-6 && seg.hi >= mid - 1e-6);
      if (!hits.length) {
        continue;
      }
      const rooms = uniqueRooms(hits);
      const skuId = pickWallSku(rooms);
      const sku = skuById(skuId);
      const x1 = isVertical ? coord : lo;
      const y1 = isVertical ? lo : coord;
      const x2 = isVertical ? coord : hi;
      const y2 = isVertical ? hi : coord;
      walls.push({
        id: `${isVertical ? "v" : "h"}:${coord.toFixed(3)}:${lo.toFixed(3)}:${hi.toFixed(3)}`,
        x1,
        y1,
        x2,
        y2,
        length: hi - lo,
        sku: skuId,
        thickness: sku?.thickness || 0.22,
        height: sku?.height || pack.system.wallHeight,
        roomIds: rooms.map((r) => r.id),
        shared: rooms.length > 1,
        edges: hits.map((h) => ({ roomId: h.room.id, edge: h.edge })),
        status: combineStatus(rooms),
      });
    }
  }
}

function uniqueRooms(hits) {
  const seen = new Map();
  for (const hit of hits) {
    seen.set(hit.room.id, hit.room);
  }
  return [...seen.values()];
}

function pickWallSku(rooms) {
  let best = rooms[0]?.wallSku || pack.system.defaultWallSku;
  let thick = skuById(best)?.thickness || 0;
  for (const room of rooms) {
    const sku = skuById(room.wallSku);
    if ((sku?.thickness || 0) > thick) {
      best = room.wallSku;
      thick = sku.thickness;
    }
  }
  return skuIdOrDefault(best);
}

function skuIdOrDefault(id) {
  return skuById(id) ? id : pack.system.defaultWallSku;
}

function roomEdge(room, edge) {
  const { x, y, w, h } = room.rect;
  if (edge === "N") {
    return { x1: x, y1: y + h, x2: x + w, y2: y + h };
  }
  if (edge === "S") {
    return { x1: x, y1: y, x2: x + w, y2: y };
  }
  if (edge === "W") {
    return { x1: x, y1: y, x2: x, y2: y + h };
  }
  return { x1: x + w, y1: y, x2: x + w, y2: y + h };
}

function wallForOpening(opening) {
  const walls = deriveWalls();
  if (opening.wallId) {
    return walls.find((w) => w.id === opening.wallId) || null;
  }
  const room = doc.rooms.find((r) => r.id === opening.roomId);
  if (!room) {
    return null;
  }
  const edge = roomEdge(room, opening.edge);
  const t = Math.min(1, Math.max(0, Number(opening.t) || 0.5));
  const p = {
    x: edge.x1 + (edge.x2 - edge.x1) * t,
    y: edge.y1 + (edge.y2 - edge.y1) * t,
  };
  let best = null;
  let bestD = 0.2;
  for (const wall of walls) {
    if (!hostOk(opening.sku, wall)) {
      continue;
    }
    const d = distToWall(wall, p.x, p.y);
    if (d < bestD && wall.length >= (skuById(opening.sku)?.width || 0.9) - 0.05) {
      best = wall;
      bestD = d;
    }
  }
  return best;
}

function pointOnWall(wall, t) {
  return {
    x: wall.x1 + (wall.x2 - wall.x1) * t,
    y: wall.y1 + (wall.y2 - wall.y1) * t,
  };
}

function wallT(wall, x, y) {
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  const len2 = dx * dx + dy * dy || 1;
  const t = ((x - wall.x1) * dx + (y - wall.y1) * dy) / len2;
  return Math.min(1, Math.max(0, t));
}

function distToWall(wall, x, y) {
  const t = wallT(wall, x, y);
  const p = pointOnWall(wall, t);
  return Math.hypot(p.x - x, p.y - y);
}

function wallNormal(wall, sign) {
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  const len = Math.hypot(dx, dy) || 1;
  return { x: (-dy / len) * sign, y: (dx / len) * sign };
}

function openingOnWall(opening, wall) {
  const sku = skuById(opening.sku);
  const width = sku?.width || 0.9;
  const room = !opening.wallId ? doc.rooms.find((r) => r.id === opening.roomId) : null;
  const edge = room ? roomEdge(room, opening.edge) : wall;
  const tEdge = Math.min(1, Math.max(0, Number(opening.t) || 0.5));
  const p = {
    x: edge.x1 + (edge.x2 - edge.x1) * tEdge,
    y: edge.y1 + (edge.y2 - edge.y1) * tEdge,
  };
  const t = openingTOnWall({ t: wallT(wall, p.x, p.y) }, wall, width);
  const a = pointOnWall(wall, t - (width / 2) / wall.length);
  const b = pointOnWall(wall, t + (width / 2) / wall.length);
  return { wall, sku, width, t, a, b };
}

function openingTOnWall(opening, wall, width) {
  const half = (width / 2) / (wall.length || 1);
  const t = Number(opening.t);
  if (Number.isFinite(t) && t >= 0 && t <= 1) {
    return Math.min(1 - half, Math.max(half, t));
  }
  const room = doc.rooms.find((r) => r.id === opening.roomId);
  if (!room) {
    return 0.5;
  }
  return Math.min(1 - half, Math.max(half, 0.5));
}

function roomAt(x, y) {
  for (let i = doc.rooms.length - 1; i >= 0; i -= 1) {
    const r = doc.rooms[i];
    const { x: rx, y: ry, w, h } = r.rect;
    if (x >= rx && x <= rx + w && y >= ry && y <= ry + h) {
      return r;
    }
  }
  return null;
}

function hostOk(skuId, wall) {
  const hosts = allowedHosts(skuId);
  if (!hosts) {
    return true;
  }
  return hosts.includes(wall.sku);
}

function wallSnapDist(wall) {
  return Math.max(0.55, (wall.thickness || 0.22) * 2.5);
}

function nearestPlaceWall(x, y, skuId) {
  const sku = skuById(skuId);
  const need = (sku?.width || 0.9) + 0.05;
  let best = null;
  let bestD = Infinity;
  for (const wall of deriveWalls()) {
    if (!hostOk(skuId, wall)) {
      continue;
    }
    const d = distToWall(wall, x, y);
    if (d < bestD && d < wallSnapDist(wall) && wall.length >= need) {
      best = wall;
      bestD = d;
    }
  }
  return best;
}

function swingToward(wall, x, y) {
  const t = wallT(wall, x, y);
  const p = pointOnWall(wall, t);
  const n = wallNormal(wall, 1);
  return (x - p.x) * n.x + (y - p.y) * n.y >= 0 ? 1 : -1;
}

function openingDraftAt(sku, x, y) {
  if (!sku) {
    return null;
  }
  const wall = nearestPlaceWall(x, y, sku.id);
  if (!wall) {
    return null;
  }
  const roomHit = roomAt(x, y);
  const edge = wall.edges.find((e) => e.roomId === roomHit?.id) || wall.edges[0];
  const room = edge ? doc.rooms.find((r) => r.id === edge.roomId) : null;
  if (room) {
    return {
      sku: sku.id,
      roomId: edge.roomId,
      edge: edge.edge,
      t: wallT(roomEdge(room, edge.edge), x, y),
      swing: swingToward(wall, x, y),
      wall,
    };
  }
  return {
    sku: sku.id,
    wallId: wall.id,
    t: wallT(wall, x, y),
    swing: swingToward(wall, x, y),
    wall,
  };
}

function openingRecord(draft) {
  const row = {
    id: nid("o"),
    sku: draft.sku,
    t: draft.t,
    swing: draft.swing,
  };
  if (draft.wallId) {
    row.wallId = draft.wallId;
  } else {
    row.roomId = draft.roomId;
    row.edge = draft.edge;
  }
  return row;
}

function applyOpeningDraft(opening, draft) {
  opening.t = draft.t;
  opening.swing = draft.swing;
  if (draft.wallId) {
    opening.wallId = draft.wallId;
    delete opening.roomId;
    delete opening.edge;
    return;
  }
  opening.roomId = draft.roomId;
  opening.edge = draft.edge;
  delete opening.wallId;
}

function compilePlanner() {
  if (!pack) {
    return null;
  }
  const walls = deriveWalls();
  const height = pack.system.wallHeight;
  const instances = [];
  const sketchForms = [];
  let id = 1;

  for (const room of doc.rooms) {
    const floor = skuById(room.floorSku) || skuById(pack.system.defaultFloorSku);
    const area = room.rect.w * room.rect.h;
    const { x, y, w, h } = room.rect;
    const loops = rectLoop(x, y, w, h);
    sketchForms.push({
      kind: "Room",
      elementId: room.id,
      name: room.name,
      isSolid: false,
      depth: 0.18,
      profileLoops: [loops],
      status: objectStatus(room),
    });
    instances.push({
      category: "Floors",
      model: floor.id,
      family: "Floor",
      type: floor.name,
      elementId: `F${id}`,
      count: 1,
      area,
      perimeter: 2 * (w + h),
      volume: area * (floor.thickness || 0.085),
      unit: floor.unit,
      level: room.level || pack.system.defaultLevel || "01 GFL",
      phaseCreated: "Day 1",
      status: objectStatus(room),
    });
    id += 1;
  }

  for (const slab of doc.slabs) {
    const sku = skuById(slab.sku) || skuById(pack.system.defaultFloorSku);
    if (!sku) {
      continue;
    }
    const { x, y, w, h } = slab.rect;
    const area = w * h;
    const elev = levelElevation(slab.level);
    sketchForms.push({
      kind: "Floor",
      elementId: slab.id,
      name: sku.name,
      isSolid: true,
      depth: sku.thickness || 0.085,
      elevation: elev,
      profileLoops: [rectLoop(x, y, w, h)],
      status: objectStatus(slab),
    });
    instances.push({
      category: "Floors",
      model: sku.id,
      family: "Floor",
      type: sku.name,
      elementId: slab.id,
      count: 1,
      area,
      perimeter: 2 * (w + h),
      volume: area * (sku.thickness || 0.085),
      unit: sku.unit,
      level: slab.level || defaultLevelFor(sku),
      phaseCreated: "Day 1",
      status: objectStatus(slab),
    });
  }

  for (const roof of doc.roofs) {
    const sku = skuById(roof.sku) || skuById(pack.system.defaultRoofSku);
    if (!sku) {
      continue;
    }
    const { x, y, w, h } = roof.rect;
    const area = w * h;
    const form = normalizeRoofForm(roof.form);
    const pitch = roofPitchDeg(roof);
    const ridge = normalizeRoofRidge(roof.ridge);
    const levelZ = levelElevation(roof.level);
    const wallH = pack.system.wallHeight || 2.8;
    const elev = levelZ < 0.05 ? wallH : levelZ;
    sketchForms.push({
      kind: "Roof",
      elementId: roof.id,
      name: sku.name,
      isSolid: true,
      depth: sku.thickness || 0.125,
      elevation: elev,
      roofForm: form,
      roofPitch: pitch,
      roofRidge: ridge,
      profileLoops: [rectLoop(x, y, w, h)],
      status: objectStatus(roof),
    });
    instances.push({
      category: "Roofs",
      model: sku.id,
      family: form === "flat" ? "Basic Roof" : `${form.charAt(0).toUpperCase()}${form.slice(1)} Roof`,
      type: sku.name,
      elementId: roof.id,
      count: 1,
      area,
      unit: sku.unit,
      phaseCreated: "Day 1",
      phaseDemolished: "None",
      status: objectStatus(roof),
    });
  }

  for (const wall of walls) {
    const sku = skuById(wall.sku);
    if (!sku) {
      continue;
    }
    const len = wall.length;
    const thick = wall.thickness;
    const wallH = wall.height || sku?.height || height;
    const area = len * wallH;
    const volume = area * thick;
    instances.push({
      category: "Walls",
      model: sku.id,
      family: "Basic Wall",
      type: sku.name,
      elementId: wall.id,
      count: 1,
      length: len,
      area,
      volume,
      unit: sku.unit,
      status: wall.status || "planned",
    });
    sketchForms.push({
      kind: "Wall",
      elementId: wall.id,
      name: sku.name,
      thickness: thick,
      depth: wallH,
      status: wall.status || "planned",
      profileLoops: [{
        length: len,
        curves: [{ kind: "Line", length: len, start: [wall.x1, wall.y1, 0], end: [wall.x2, wall.y2, 0] }],
      }],
    });
  }

  for (const opening of doc.openings) {
    const wall = wallForOpening(opening);
    if (!wall || !hostOk(opening.sku, wall)) {
      continue;
    }
    const placed = openingOnWall(opening, wall);
    const sku = placed.sku;
    instances.push({
      category: instanceCategory(sku.category),
      model: sku.id,
      family: skuFamily(sku),
      type: sku.name,
      elementId: opening.id,
      count: 1,
      unit: sku.unit,
      status: objectStatus(opening),
    });
    const tick = {
      kind: sku.category === "window" ? "Window" : "Opening",
      elementId: opening.id,
      name: sku.name,
      depth: sku.height || (sku.category === "window" ? 1.2 : 2.1),
      sill: sku.category === "window" ? (sku.sill ?? 0.9) : 0,
      status: objectStatus(opening),
      profileLoops: [{
        length: placed.width,
        curves: [{
          kind: "Line",
          length: placed.width,
          start: [placed.a.x, placed.a.y, 0],
          end: [placed.b.x, placed.b.y, 0],
        }],
      }],
    };
    if (sku.category === "door") {
      const n = wallNormal(wall, opening.swing || 1);
      const hinge = placed.a;
      tick.profileLoops[0].curves.push({
        kind: "Arc",
        length: placed.width * 1.57,
        start: [placed.b.x, placed.b.y, 0],
        end: [hinge.x + n.x * placed.width, hinge.y + n.y * placed.width, 0],
      });
    }
    sketchForms.push(tick);
  }

  for (const item of doc.items) {
    const sku = skuById(item.sku);
    if (!sku) {
      continue;
    }
    instances.push({
      category: instanceCategory(sku.category),
      model: sku.id,
      family: skuFamily(sku),
      type: sku.name,
      elementId: item.id,
      count: 1,
      unit: sku.unit,
      status: objectStatus(item),
    });
    const box = itemRect(item, sku);
    sketchForms.push({
      kind: "Extrusion",
      elementId: item.id,
      name: sku.name,
      isSolid: true,
      depth: sku.height || 0.4,
      profileLoops: [rectLoop(box.x, box.y, box.w, box.h)],
      status: objectStatus(item),
    });
  }

  for (const beam of doc.beams) {
    const sku = skuById(beam.sku);
    if (!sku) {
      continue;
    }
    const len = Math.hypot(beam.x2 - beam.x1, beam.y2 - beam.y1);
    const maxSpan = pack.recipes.maxSpan?.[sku.id];
    const minLen = pack.recipes.minLength?.[sku.id] || 0;
    if (len > (maxSpan || Infinity) + 1e-6 || len < minLen) {
      continue;
    }
    if (!beamHostsOk(beam, sku.id)) {
      continue;
    }
    instances.push({
      category: "Beams",
      model: sku.id,
      family: "Beam",
      type: sku.name,
      elementId: beam.id,
      count: 1,
      length: len,
      unit: sku.unit,
      status: objectStatus(beam),
    });
    sketchForms.push({
      kind: "Extrusion",
      elementId: beam.id,
      name: sku.name,
      depth: sku.height || 0.22,
      profileLoops: [beamLoop(beam, sku.width || 0.11)],
      status: objectStatus(beam),
    });
  }

  explodeRecipes(instances, walls.filter((w) => !w.drawn));
  return {
    documentKind: "Planner",
    title: pack.system.name,
    path: "planner",
    activeView: "Planner",
    viewType: "FloorPlan",
    extractedAt: new Date().toISOString(),
    units: "meters / square meters / cubic meters",
    instances,
    sketchForms,
    plans: [{
      id: "planner",
      name: "Planner",
      viewType: "FloorPlan",
      discipline: "Floor Plans",
      level: "Level 1",
      elevation: 0,
      isActive: true,
      sketchForms,
    }],
  };
}

function rectLoop(x, y, w, h) {
  const pts = [
    [x, y, 0],
    [x + w, y, 0],
    [x + w, y + h, 0],
    [x, y + h, 0],
  ];
  return {
    length: 2 * (w + h),
    curves: [
      { kind: "Line", length: w, start: pts[0], end: pts[1] },
      { kind: "Line", length: h, start: pts[1], end: pts[2] },
      { kind: "Line", length: w, start: pts[2], end: pts[3] },
      { kind: "Line", length: h, start: pts[3], end: pts[0] },
    ],
  };
}

function beamLoop(beam, width) {
  const dx = beam.x2 - beam.x1;
  const dy = beam.y2 - beam.y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (width / 2);
  const ny = (dx / len) * (width / 2);
  const pts = [
    [beam.x1 + nx, beam.y1 + ny, 0],
    [beam.x2 + nx, beam.y2 + ny, 0],
    [beam.x2 - nx, beam.y2 - ny, 0],
    [beam.x1 - nx, beam.y1 - ny, 0],
  ];
  return {
    length: 2 * (len + width),
    curves: [
      { kind: "Line", length: len, start: pts[0], end: pts[1] },
      { kind: "Line", length: width, start: pts[1], end: pts[2] },
      { kind: "Line", length: len, start: pts[2], end: pts[3] },
      { kind: "Line", length: width, start: pts[3], end: pts[0] },
    ],
  };
}

function itemRect(item, sku) {
  const w = sku.width || 0.4;
  const d = sku.depth || sku.width || 0.4;
  const rot = ((item.rotation || 0) / 90) % 2;
  if (rot) {
    return { x: item.x, y: item.y, w: d, h: w };
  }
  return { x: item.x, y: item.y, w, h: d };
}

function explodeRecipes(instances, walls) {
  const hasFloor = instances.some((row) => row.category === "Floors");
  const hasDrawnFoundation = doc.traces.some((t) => skuById(t.sku)?.category === "foundation");
  const implied = new Map();
  const wallLenBySku = new Map();
  for (const wall of walls) {
    wallLenBySku.set(wall.sku, (wallLenBySku.get(wall.sku) || 0) + wall.length);
  }
  const areaByWallSku = new Map();
  for (const room of doc.rooms) {
    areaByWallSku.set(room.wallSku, (areaByWallSku.get(room.wallSku) || 0) + room.rect.w * room.rect.h);
  }

  for (const rule of pack.recipes.requires || []) {
    const add = skuById(rule.addSku);
    if (!add) {
      continue;
    }
    if (rule.per === "wallLength") {
      if (add.category === "foundation" && hasDrawnFoundation) {
        continue;
      }
      const len = wallLenBySku.get(rule.whenSku) || 0;
      if (len <= 0) {
        continue;
      }
      const prev = implied.get(add.id) || { sku: add, length: 0, area: 0 };
      prev.length += len;
      implied.set(add.id, prev);
    }
    if (rule.per === "roomArea") {
      if (hasFloor && add.category === "floor") {
        continue;
      }
      const area = areaByWallSku.get(rule.whenSku) || 0;
      if (area <= 0) {
        continue;
      }
      const prev = implied.get(add.id) || { sku: add, length: 0, area: 0 };
      prev.area += area;
      implied.set(add.id, prev);
    }
  }

  let n = 1;
  for (const { sku, length, area } of implied.values()) {
    if (instances.some((row) => row.model === sku.id)) {
      continue;
    }
    const row = {
      category: instanceCategory(sku.category),
      model: sku.id,
      family: sku.name,
      type: sku.name,
      elementId: `impl${n}`,
      count: 1,
      unit: sku.unit,
    };
    if (length) {
      row.length = length;
      row.volume = length * (sku.width || 0.4) * (sku.depth || sku.thickness || 0.45);
    }
    if (area) {
      row.area = area;
      row.volume = area * (sku.thickness || 0.085);
    }
    instances.push(row);
    n += 1;
  }
}

function beamHostsOk(beam, skuId) {
  const walls = deriveWalls();
  const a = nearestPlaceWall(beam.x1, beam.y1, skuId);
  const b = nearestPlaceWall(beam.x2, beam.y2, skuId);
  return Boolean(a && b && a.id !== b.id);
}

function plannerSourceLive() {
  const src = els.source?.textContent || "";
  return src === "Planner";
}

function revitPayloadLoaded() {
  const src = els.source?.textContent || "";
  if (!payload) {
    return false;
  }
  if (src === "Planner" || src === "Waiting for import") {
    return false;
  }
  return true;
}

function applyPlannerCompile(force) {
  const compiled = compilePlanner();
  if (!compiled) {
    return false;
  }
  if (!force && revitPayloadLoaded() && !plannerSourceLive()) {
    return false;
  }
  if (force && revitPayloadLoaded() && !plannerSourceLive()) {
    const ok = window.confirm("Replace the current import in Cost and 3D with this planner takeoff?");
    if (!ok) {
      return false;
    }
  }
  applyPayload(compiled, "Planner");
  return true;
}

function maybePushCompile() {
  if (!hasPlannerContent() && !plannerSourceLive()) {
    return;
  }
  applyPlannerCompile(false);
}

function worldFromEvent(event) {
  const rect = plannerEls.canvas.getBoundingClientRect();
  const sx = event.clientX - rect.left;
  const sy = event.clientY - rect.top;
  return {
    x: (sx - cam.ox) / cam.scale,
    y: (sy - cam.oy) / cam.scale,
    sx,
    sy,
  };
}

function toScreen(x, y) {
  return [x * cam.scale + cam.ox, y * cam.scale + cam.oy];
}

function drawPlanner() {
  const canvas = plannerEls.canvas;
  if (!canvas || !plannerCtx) {
    return;
  }
  if (canvas.closest("[hidden]")) {
    if (plannerEls.sizeHud) {
      plannerEls.sizeHud.hidden = true;
    }
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  plannerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  plannerCtx.clearRect(0, 0, width, height);

  drawGrid(width, height);

  const walls = deriveWalls();
  for (const patch of doc.roofs) {
    drawPatch(patch, "roof");
  }
  for (const patch of doc.slabs) {
    drawPatch(patch, "slab");
  }
  for (const room of doc.rooms) {
    const [x, y] = toScreen(room.rect.x, room.rect.y);
    const w = room.rect.w * cam.scale;
    const h = room.rect.h * cam.scale;
    const selectedRoom = isSelected("room", room.id);
    const existing = objectStatus(room) === "existing";
    plannerCtx.fillStyle = selectedRoom
      ? (existing ? "rgba(92, 83, 72, 0.18)" : "rgba(178, 69, 30, 0.16)")
      : (existing ? "rgba(92, 83, 72, 0.08)" : "rgba(178, 69, 30, 0.08)");
    plannerCtx.strokeStyle = selectedRoom ? "#8d3416" : (existing ? "rgba(92, 83, 72, 0.55)" : "rgba(178, 69, 30, 0.35)");
    plannerCtx.lineWidth = selectedRoom ? 2 : 1;
    plannerCtx.setLineDash(existing ? [] : [7, 4]);
    plannerCtx.fillRect(x, y, w, h);
    plannerCtx.strokeRect(x, y, w, h);
    plannerCtx.setLineDash([]);
    plannerCtx.fillStyle = "#5c5348";
    plannerCtx.font = "500 13px Fraunces, Georgia, serif";
    plannerCtx.textAlign = "center";
    plannerCtx.fillText(room.name, x + w / 2, y + h / 2 - 7);
    plannerCtx.font = "600 10px Source Sans 3, sans-serif";
    plannerCtx.fillText(existing ? "Existing" : "Planned", x + w / 2, y + h / 2 + 9);
    if (selectedRoom && soleSelection()?.kind === "room") {
      for (const edge of roomEdges(room)) {
        drawHandle((edge.x1 + edge.x2) / 2, (edge.y1 + edge.y2) / 2);
      }
    }
  }

  for (const wall of walls) {
    const [x1, y1] = toScreen(wall.x1, wall.y1);
    const [x2, y2] = toScreen(wall.x2, wall.y2);
    const selected = isSelected("trace", wall.id);
    plannerCtx.strokeStyle = wallStroke(wall, selected);
    plannerCtx.lineWidth = Math.max(3, wall.thickness * cam.scale);
    plannerCtx.lineCap = "butt";
    const dash = wall.category === "foundation"
      ? [8, 5]
      : wall.status === "planned"
        ? [10, 5]
        : [];
    plannerCtx.setLineDash(dash);
    plannerCtx.beginPath();
    plannerCtx.moveTo(x1, y1);
    plannerCtx.lineTo(x2, y2);
    plannerCtx.stroke();
    plannerCtx.setLineDash([]);
    if (selected && wall.drawn && soleSelection()?.kind === "trace") {
      drawHandle(wall.x1, wall.y1);
      drawHandle(wall.x2, wall.y2);
      drawTraceLength(wall);
    }
  }

  for (const opening of doc.openings) {
    const wall = wallForOpening(opening);
    if (!wall) {
      continue;
    }
    const placed = openingOnWall(opening, wall);
    const selected = isSelected("opening", opening.id);
    drawOpening(placed, opening, { selected, preview: false });
  }

  if (openingTool() && hover && placeSkuId) {
    const sku = skuById(placeSkuId);
    const draft = openingDraftAt(sku, hover.x, hover.y);
    if (draft) {
      const placed = openingOnWall(draft, draft.wall);
      drawOpening(placed, draft, { selected: false, preview: true });
    }
  }

  for (const beam of doc.beams) {
    const [x1, y1] = toScreen(beam.x1, beam.y1);
    const [x2, y2] = toScreen(beam.x2, beam.y2);
    const selected = isSelected("beam", beam.id);
    plannerCtx.strokeStyle = selected ? "#8d3416" : "#243044";
    plannerCtx.lineWidth = 5;
    plannerCtx.beginPath();
    plannerCtx.moveTo(x1, y1);
    plannerCtx.lineTo(x2, y2);
    plannerCtx.stroke();
  }

  for (const item of doc.items) {
    const sku = skuById(item.sku);
    if (!sku) {
      continue;
    }
    const box = itemRect(item, sku);
    const [x, y] = toScreen(box.x, box.y);
    const selected = isSelected("item", item.id);
    plannerCtx.fillStyle = selected ? "rgba(36, 48, 68, 0.28)" : "rgba(36, 48, 68, 0.14)";
    plannerCtx.strokeStyle = selected ? "#8d3416" : "#243044";
    plannerCtx.lineWidth = selected ? 2 : 1;
    plannerCtx.setLineDash(objectStatus(item) === "existing" ? [] : [5, 3]);
    plannerCtx.fillRect(x, y, box.w * cam.scale, box.h * cam.scale);
    plannerCtx.strokeRect(x, y, box.w * cam.scale, box.h * cam.scale);
    plannerCtx.setLineDash([]);
  }

  const sized = soleSelection() && patchByKind(selection?.kind, selection?.id);
  if (sized?.rect && (selection?.kind === "room" || selection?.kind === "slab" || selection?.kind === "roof")) {
    drawDimensions(sized);
    const [hx, hy] = toScreen(sized.rect.x + sized.rect.w, sized.rect.y + sized.rect.h);
    plannerCtx.fillStyle = "#b2451e";
    plannerCtx.fillRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
  }

  if ((drag?.kind === "room-new" || drag?.kind === "slab-new" || drag?.kind === "roof-new") && drag.rect) {
    const r = drag.rect;
    const [x, y] = toScreen(r.x, r.y);
    plannerCtx.strokeStyle = drag.kind === "roof-new" ? "#3a5f7a" : "#b2451e";
    plannerCtx.setLineDash([5, 4]);
    plannerCtx.strokeRect(x, y, r.w * cam.scale, r.h * cam.scale);
    plannerCtx.setLineDash([]);
  }

  if (drag?.kind === "trace") {
    const seg = axisSeg(drag.x0, drag.y0, drag.x1, drag.y1);
    const [x1, y1] = toScreen(seg.x1, seg.y1);
    const [x2, y2] = toScreen(seg.x2, seg.y2);
    plannerCtx.strokeStyle = "#b2451e";
    plannerCtx.lineWidth = 3;
    plannerCtx.setLineDash([6, 4]);
    plannerCtx.beginPath();
    plannerCtx.moveTo(x1, y1);
    plannerCtx.lineTo(x2, y2);
    plannerCtx.stroke();
    plannerCtx.setLineDash([]);
  }

  if (beamStart) {
    const [x, y] = toScreen(beamStart.x, beamStart.y);
    plannerCtx.fillStyle = "#b2451e";
    plannerCtx.beginPath();
    plannerCtx.arc(x, y, 4, 0, Math.PI * 2);
    plannerCtx.fill();
  }

  if (drag?.kind === "marquee") {
    const box = marqueeBox(drag.x0, drag.y0, drag.x1, drag.y1);
    const [x, y] = toScreen(box.x, box.y);
    plannerCtx.strokeStyle = box.crossing ? "#3a5f7a" : "#b2451e";
    plannerCtx.fillStyle = box.crossing ? "rgba(58, 95, 122, 0.08)" : "rgba(178, 69, 30, 0.08)";
    plannerCtx.setLineDash([5, 4]);
    plannerCtx.lineWidth = 1;
    plannerCtx.fillRect(x, y, box.w * cam.scale, box.h * cam.scale);
    plannerCtx.strokeRect(x, y, box.w * cam.scale, box.h * cam.scale);
    plannerCtx.setLineDash([]);
  }

  plannerEls.empty.hidden = hasPlannerContent();
  const legend = document.getElementById("planner-legend");
  if (legend) {
    legend.hidden = !hasPlannerContent();
  }
  syncSizeHud();
  plannerEls.canvas?.parentElement?.classList.toggle("tool-opening", Boolean(openingTool()));
  plannerEls.canvas?.parentElement?.classList.toggle(
    "tool-draw",
    tool === "trace" || tool === "slab" || tool === "roof" || tool === "room"
  );
}

function wallStroke(wall, selected) {
  if (selected) {
    return "#8d3416";
  }
  if (wall.category === "foundation") {
    return "#6b5344";
  }
  if (wall.status === "planned") {
    return "#b2451e";
  }
  if (wall.sku === "TSP_MAS007") {
    return "#2a5a4a";
  }
  return "#1a1612";
}

function drawPatch(patch, kind) {
  const [x, y] = toScreen(patch.rect.x, patch.rect.y);
  const w = patch.rect.w * cam.scale;
  const h = patch.rect.h * cam.scale;
  const selected = isSelected(kind, patch.id);
  const existing = objectStatus(patch) === "existing";
  if (kind === "roof") {
    plannerCtx.fillStyle = selected ? "rgba(58, 95, 122, 0.22)" : "rgba(58, 95, 122, 0.1)";
    plannerCtx.strokeStyle = selected ? "#3a5f7a" : "rgba(58, 95, 122, 0.45)";
  } else {
    plannerCtx.fillStyle = selected ? "rgba(90, 110, 70, 0.22)" : "rgba(90, 110, 70, 0.1)";
    plannerCtx.strokeStyle = selected ? "#4d5e3a" : "rgba(90, 110, 70, 0.4)";
  }
  plannerCtx.lineWidth = selected ? 2 : 1;
  plannerCtx.setLineDash(existing ? [] : [7, 4]);
  plannerCtx.fillRect(x, y, w, h);
  plannerCtx.strokeRect(x, y, w, h);
  plannerCtx.setLineDash([]);
  plannerCtx.fillStyle = "#5c5348";
  plannerCtx.font = "500 12px Fraunces, Georgia, serif";
  plannerCtx.textAlign = "center";
  plannerCtx.fillText(patch.name || skuById(patch.sku)?.name || kind, x + w / 2, y + h / 2 - 6);
  plannerCtx.font = "600 10px Source Sans 3, sans-serif";
  const form = kind === "roof" ? normalizeRoofForm(patch.form) : "";
  plannerCtx.fillText(
    kind === "roof" && form !== "flat"
      ? `${form} · ${existing ? "Existing" : "Planned"}`
      : (existing ? "Existing" : "Planned"),
    x + w / 2,
    y + h / 2 + 9
  );
  if (kind === "roof") {
    drawRoofGuides(patch);
  }
}

function drawRoofGuides(patch) {
  const form = normalizeRoofForm(patch.form);
  if (form === "flat") {
    return;
  }
  const { x, y, w, h } = patch.rect;
  const alongX = roofRidgeAlongX(patch.rect, patch.ridge);
  plannerCtx.save();
  plannerCtx.strokeStyle = "#3a5f7a";
  plannerCtx.lineWidth = 1.4;
  plannerCtx.setLineDash([5, 4]);
  const line = (x1, y1, x2, y2) => {
    const a = toScreen(x1, y1);
    const b = toScreen(x2, y2);
    plannerCtx.beginPath();
    plannerCtx.moveTo(a[0], a[1]);
    plannerCtx.lineTo(b[0], b[1]);
    plannerCtx.stroke();
  };
  if (form === "shed") {
    plannerCtx.setLineDash([]);
    if (alongX) {
      line(x, y, x + w, y);
      plannerCtx.setLineDash([4, 3]);
      line(x + w / 2, y, x + w / 2, y + h);
    } else {
      line(x, y, x, y + h);
      plannerCtx.setLineDash([4, 3]);
      line(x, y + h / 2, x + w, y + h / 2);
    }
  } else if (form === "hip") {
    const inset = alongX ? Math.min(h / 2, w / 2) : Math.min(w / 2, h / 2);
    if (alongX) {
      const mid = y + h / 2;
      line(x + inset, mid, x + w - inset, mid);
      line(x, y, x + inset, mid);
      line(x + w, y, x + w - inset, mid);
      line(x, y + h, x + inset, mid);
      line(x + w, y + h, x + w - inset, mid);
    } else {
      const mid = x + w / 2;
      line(mid, y + inset, mid, y + h - inset);
      line(x, y, mid, y + inset);
      line(x + w, y, mid, y + inset);
      line(x, y + h, mid, y + h - inset);
      line(x + w, y + h, mid, y + h - inset);
    }
  } else if (alongX) {
    const mid = y + h / 2;
    line(x, mid, x + w, mid);
  } else {
    const mid = x + w / 2;
    line(mid, y, mid, y + h);
  }
  plannerCtx.restore();
}

function drawOpening(placed, opening, { selected, preview }) {
  if (!placed?.sku || !placed.wall) {
    return;
  }
  const wall = placed.wall;
  const [ax, ay] = toScreen(placed.a.x, placed.a.y);
  const [bx, by] = toScreen(placed.b.x, placed.b.y);
  plannerCtx.globalAlpha = preview ? 0.55 : 1;
  plannerCtx.strokeStyle = "#f3eee4";
  plannerCtx.lineWidth = Math.max(4, (wall.thickness || 0.22) * cam.scale + 2);
  plannerCtx.lineCap = "butt";
  plannerCtx.beginPath();
  plannerCtx.moveTo(ax, ay);
  plannerCtx.lineTo(bx, by);
  plannerCtx.stroke();
  plannerCtx.strokeStyle = placed.sku.category === "window" ? "#3a5f7a" : "#b2451e";
  plannerCtx.lineWidth = selected ? 4 : 3;
  plannerCtx.beginPath();
  plannerCtx.moveTo(ax, ay);
  plannerCtx.lineTo(bx, by);
  plannerCtx.stroke();
  if (placed.sku.category === "window") {
    const mx = (placed.a.x + placed.b.x) / 2;
    const my = (placed.a.y + placed.b.y) / 2;
    const n = wallNormal(wall, 1);
    const sill = 0.08;
    const [px, py] = toScreen(mx - n.x * sill, my - n.y * sill);
    const [qx, qy] = toScreen(mx + n.x * sill, my + n.y * sill);
    plannerCtx.lineWidth = 1.5;
    plannerCtx.beginPath();
    plannerCtx.moveTo(px, py);
    plannerCtx.lineTo(qx, qy);
    plannerCtx.stroke();
  }
  if (placed.sku.category === "door") {
    const n = wallNormal(wall, opening.swing || 1);
    const [hx, hy] = toScreen(placed.a.x, placed.a.y);
    const [ex, ey] = toScreen(placed.a.x + n.x * placed.width, placed.a.y + n.y * placed.width);
    plannerCtx.strokeStyle = selected ? "#8d3416" : "rgba(178, 69, 30, 0.7)";
    plannerCtx.lineWidth = 1.25;
    plannerCtx.beginPath();
    plannerCtx.moveTo(hx, hy);
    plannerCtx.lineTo(ex, ey);
    plannerCtx.stroke();
  }
  plannerCtx.globalAlpha = 1;
}

function drawGrid(width, height) {
  const x0 = Math.floor(-cam.ox / cam.scale / GRID) * GRID;
  const y0 = Math.floor(-cam.oy / cam.scale / GRID) * GRID;
  const x1 = (width - cam.ox) / cam.scale;
  const y1 = (height - cam.oy) / cam.scale;
  plannerCtx.strokeStyle = "rgba(26, 22, 18, 0.06)";
  plannerCtx.lineWidth = 1;
  for (let x = x0; x <= x1; x += GRID) {
    const major = Math.abs(x - Math.round(x)) < 1e-6;
    plannerCtx.strokeStyle = major ? "rgba(26, 22, 18, 0.14)" : "rgba(26, 22, 18, 0.05)";
    const [sx] = toScreen(x, 0);
    plannerCtx.beginPath();
    plannerCtx.moveTo(sx, 0);
    plannerCtx.lineTo(sx, height);
    plannerCtx.stroke();
  }
  for (let y = y0; y <= y1; y += GRID) {
    const major = Math.abs(y - Math.round(y)) < 1e-6;
    plannerCtx.strokeStyle = major ? "rgba(26, 22, 18, 0.14)" : "rgba(26, 22, 18, 0.05)";
    const [, sy] = toScreen(0, y);
    plannerCtx.beginPath();
    plannerCtx.moveTo(0, sy);
    plannerCtx.lineTo(width, sy);
    plannerCtx.stroke();
  }
}

function drawHandle(wx, wy) {
  const [hx, hy] = toScreen(wx, wy);
  plannerCtx.fillStyle = "#b2451e";
  plannerCtx.fillRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
}

function handleHit(sx, sy, wx, wy) {
  const [hx, hy] = toScreen(wx, wy);
  return Math.abs(sx - hx) <= HANDLE && Math.abs(sy - hy) <= HANDLE;
}

function roomEdges(room) {
  const { x, y, w, h } = room.rect;
  return [
    { edge: "S", x1: x, y1: y, x2: x + w, y2: y },
    { edge: "N", x1: x, y1: y + h, x2: x + w, y2: y + h },
    { edge: "W", x1: x, y1: y, x2: x, y2: y + h },
    { edge: "E", x1: x + w, y1: y, x2: x + w, y2: y + h },
  ];
}

function applyRoomEdge(room, edge, x, y) {
  const r = room.rect;
  const gx = roundGrid(x);
  const gy = roundGrid(y);
  if (edge === "W") {
    const right = r.x + r.w;
    r.w = Math.max(MIN_ROOM, roundGrid(right - gx));
    r.x = roundGrid(right - r.w);
  } else if (edge === "E") {
    r.w = Math.max(MIN_ROOM, roundGrid(gx - r.x));
  } else if (edge === "S") {
    const top = r.y + r.h;
    r.h = Math.max(MIN_ROOM, roundGrid(top - gy));
    r.y = roundGrid(top - r.h);
  } else if (edge === "N") {
    r.h = Math.max(MIN_ROOM, roundGrid(gy - r.y));
  }
}

function setTraceLength(trace, length) {
  const cur = Math.hypot(trace.x2 - trace.x1, trace.y2 - trace.y1);
  if (cur < 1e-6) {
    return;
  }
  const next = Math.max(MIN_TRACE, roundGrid(Number(length) || cur));
  const s = next / cur;
  trace.x2 = roundGrid(trace.x1 + (trace.x2 - trace.x1) * s);
  trace.y2 = roundGrid(trace.y1 + (trace.y2 - trace.y1) * s);
}

function applyTraceEnd(trace, end, x, y) {
  const horiz = Math.abs(trace.x2 - trace.x1) >= Math.abs(trace.y2 - trace.y1);
  const next = { x1: trace.x1, y1: trace.y1, x2: trace.x2, y2: trace.y2 };
  if (end === 1) {
    if (horiz) {
      next.x1 = roundGrid(x);
      next.y1 = next.y2;
    } else {
      next.y1 = roundGrid(y);
      next.x1 = next.x2;
    }
  } else if (horiz) {
    next.x2 = roundGrid(x);
    next.y2 = next.y1;
  } else {
    next.y2 = roundGrid(y);
    next.x2 = next.x1;
  }
  if (segLength(next) < MIN_TRACE) {
    return;
  }
  trace.x1 = next.x1;
  trace.y1 = next.y1;
  trace.x2 = next.x2;
  trace.y2 = next.y2;
}

function drawTraceLength(wall) {
  const mx = (wall.x1 + wall.x2) / 2;
  const my = (wall.y1 + wall.y2) / 2;
  const [sx, sy] = toScreen(mx, my);
  plannerCtx.fillStyle = "#1a1612";
  plannerCtx.font = "600 12px Source Sans 3, sans-serif";
  plannerCtx.textAlign = "center";
  plannerCtx.fillText(`${wall.length.toFixed(1)} m`, sx, sy - 10);
}

function syncInspectSize(rect) {
  if (!rect) {
    return;
  }
  const inspW = document.getElementById("insp-w");
  const inspH = document.getElementById("insp-h");
  const area = document.getElementById("insp-area");
  if (inspW && document.activeElement !== inspW) {
    inspW.value = formatMetres(rect.w);
  }
  if (inspH && document.activeElement !== inspH) {
    inspH.value = formatMetres(rect.h);
  }
  if (area) {
    area.textContent = `${formatMetres(rect.w)} × ${formatMetres(rect.h)} m · ${(rect.w * rect.h).toFixed(1)} m²`;
  }
}

function drawDimensions(room) {
  const { x, y, w, h } = room.rect;
  plannerCtx.fillStyle = "#1a1612";
  plannerCtx.font = "600 12px Source Sans 3, sans-serif";
  plannerCtx.textAlign = "center";
  const [sx, sy] = toScreen(x + w / 2, y);
  plannerCtx.fillText(`${w.toFixed(1)} m`, sx, sy - 8);
  plannerCtx.save();
  const [ex, ey] = toScreen(x + w, y + h / 2);
  plannerCtx.translate(ex + 14, ey);
  plannerCtx.rotate(Math.PI / 2);
  plannerCtx.fillText(`${h.toFixed(1)} m`, 0, 0);
  plannerCtx.restore();
}

function hitStack(x, y) {
  const hits = [];
  const add = (kind, id) => {
    const ref = { kind, id };
    if (!hits.some((row) => sameRef(row, ref))) {
      hits.push(ref);
    }
  };
  for (let i = doc.items.length - 1; i >= 0; i -= 1) {
    const item = doc.items[i];
    const sku = skuById(item.sku);
    if (!sku) {
      continue;
    }
    const box = itemRect(item, sku);
    if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) {
      add("item", item.id);
    }
  }
  for (const beam of doc.beams) {
    if (distToSeg(beam.x1, beam.y1, beam.x2, beam.y2, x, y) < 0.12) {
      add("beam", beam.id);
    }
  }
  for (const opening of doc.openings) {
    const wall = wallForOpening(opening);
    if (!wall) {
      continue;
    }
    const placed = openingOnWall(opening, wall);
    if (distToSeg(placed.a.x, placed.a.y, placed.b.x, placed.b.y, x, y) < 0.18) {
      add("opening", opening.id);
    }
  }
  for (const trace of doc.traces) {
    if (distToSeg(trace.x1, trace.y1, trace.x2, trace.y2, x, y) < 0.16) {
      add("trace", trace.id);
    }
  }
  for (let i = doc.rooms.length - 1; i >= 0; i -= 1) {
    const room = doc.rooms[i];
    if (inRect(x, y, room.rect)) {
      add("room", room.id);
    }
  }
  for (let i = doc.slabs.length - 1; i >= 0; i -= 1) {
    const slab = doc.slabs[i];
    if (inRect(x, y, slab.rect)) {
      add("slab", slab.id);
    }
  }
  for (let i = doc.roofs.length - 1; i >= 0; i -= 1) {
    const roof = doc.roofs[i];
    if (inRect(x, y, roof.rect)) {
      add("roof", roof.id);
    }
  }
  return hits;
}

function cycleSelection(stack) {
  const refs = uniqueRefs(stack).filter(objectExists);
  if (refs.length < 2) {
    return false;
  }
  const cur = soleSelection();
  const index = cur ? refs.findIndex((row) => sameRef(row, cur)) : -1;
  const next = refs[(index + 1) % refs.length];
  if (!next || sameRef(next, cur)) {
    return false;
  }
  selectOne(next, true);
  return true;
}

function hitTest(x, y, sx, sy) {
  const sized = soleSelection() && patchByKind(selection?.kind, selection?.id);
  if (sized?.rect && (selection?.kind === "room" || selection?.kind === "slab" || selection?.kind === "roof")) {
    const [hx, hy] = toScreen(sized.rect.x + sized.rect.w, sized.rect.y + sized.rect.h);
    if (Math.abs(sx - hx) <= HANDLE && Math.abs(sy - hy) <= HANDLE) {
      return { kind: "handle", id: sized.id, target: selection.kind };
    }
  }
  if (soleSelection()?.kind === "room") {
    const room = doc.rooms.find((r) => r.id === selection.id);
    if (room) {
      for (const edge of roomEdges(room)) {
        const mx = (edge.x1 + edge.x2) / 2;
        const my = (edge.y1 + edge.y2) / 2;
        if (handleHit(sx, sy, mx, my)) {
          return { kind: "room-edge", id: room.id, edge: edge.edge };
        }
      }
    }
  }
  if (soleSelection()?.kind === "trace") {
    const trace = doc.traces.find((t) => t.id === selection.id);
    if (trace) {
      if (handleHit(sx, sy, trace.x1, trace.y1)) {
        return { kind: "handle", id: trace.id, target: "trace", end: 1 };
      }
      if (handleHit(sx, sy, trace.x2, trace.y2)) {
        return { kind: "handle", id: trace.id, target: "trace", end: 2 };
      }
    }
  }
  const stack = hitStack(x, y);
  const wallMounted = stack.find((row) => ["opening", "item", "beam", "trace"].includes(row.kind));
  if (wallMounted) {
    return { kind: wallMounted.kind, id: wallMounted.id };
  }
  for (let i = doc.rooms.length - 1; i >= 0; i -= 1) {
    const room = doc.rooms[i];
    for (const edge of roomEdges(room)) {
      if (distToSeg(edge.x1, edge.y1, edge.x2, edge.y2, x, y) < 0.18) {
        return { kind: "room-edge", id: room.id, edge: edge.edge };
      }
    }
  }
  const top = stack[0];
  return top ? { kind: top.kind, id: top.id } : null;
}

function inRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function distToSeg(x1, y1, x2, y2, x, y) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.min(1, Math.max(0, ((x - x1) * dx + (y - y1) * dy) / len2));
  return Math.hypot(x1 + dx * t - x, y1 + dy * t - y);
}

function normRect(x0, y0, x1, y1, minSize = MIN_ROOM) {
  const x = roundGrid(Math.min(x0, x1));
  const y = roundGrid(Math.min(y0, y1));
  const w = Math.max(minSize, roundGrid(Math.abs(x1 - x0)));
  const h = Math.max(minSize, roundGrid(Math.abs(y1 - y0)));
  return { x, y, w, h };
}

function nextRoomName() {
  return `Room ${doc.rooms.length + 1}`;
}

function addRoomAt(rect) {
  pushUndo();
  doc.rooms.push(withPlaceStatus({
    id: nid("r"),
    name: nextRoomName(),
    rect,
    wallSku: pack.system.defaultWallSku,
    floorSku: pack.system.defaultFloorSku,
  }));
  selectOne({ kind: "room", id: doc.rooms[doc.rooms.length - 1].id }, false);
  persist();
  refreshPlanner();
  maybePushCompile();
}

function nextPatchName(kind, prefix) {
  const n = (kind === "slab" ? doc.slabs.length : doc.roofs.length) + 1;
  return `${prefix} ${n}`;
}

function addSlabAt(rect, skuId) {
  const sku = skuById(skuId) || skuById(firstSkuId("floor")) || skuById(pack.system.defaultFloorSku);
  pushUndo();
  const row = withPlaceStatus({
    id: nid("s"),
    name: nextPatchName("slab", sku?.name?.includes("Pool") ? "Pool" : sku?.name?.includes("alcon") ? "Balcony" : "Slab"),
    sku: sku.id,
    rect,
    level: defaultLevelFor(sku),
  });
  doc.slabs.push(row);
  selectOne({ kind: "slab", id: row.id }, false);
  persist();
  refreshPlanner();
  maybePushCompile();
}

function addRoofAt(rect, skuId) {
  const sku = skuById(skuId) || skuById(firstSkuId("roof")) || skuById(pack.system.defaultRoofSku);
  pushUndo();
  const row = withPlaceStatus({
    id: nid("rf"),
    name: nextPatchName("roof", "Roof"),
    sku: sku.id,
    rect,
    level: defaultLevelFor(sku),
    ...defaultRoofShape(),
  });
  doc.roofs.push(row);
  selectOne({ kind: "roof", id: row.id }, false);
  persist();
  refreshPlanner();
  maybePushCompile();
}

function addTraceAt(seg, skuId) {
  const sku = skuById(skuId) || skuById(firstSkuId("wall"));
  if (!sku || segLength(seg) < MIN_TRACE) {
    return;
  }
  pushUndo();
  const row = withPlaceStatus({ id: nid("t"), sku: sku.id, ...seg });
  doc.traces.push(row);
  selectOne({ kind: "trace", id: row.id }, false);
  persist();
  refreshPlanner();
  maybePushCompile();
}

function startRectDrag(kind, x, y, pointerId, minSize) {
  sizeDraft = emptySizeDraft();
  const w = Math.max(minSize, Number(plannerEls.roomW.value) || 4);
  const h = Math.max(minSize, Number(plannerEls.roomH.value) || 3);
  drag = {
    kind,
    x0: x,
    y0: y,
    pointerId,
    rect: { x, y, w: roundGrid(w), h: roundGrid(h) },
  };
}

function placeSkuAt(sku, x, y) {
  if (sku.category === "door" || sku.category === "window") {
    const draft = openingDraftAt(sku, x, y);
    if (!draft) {
      return;
    }
    pushUndo();
    doc.openings.push(withPlaceStatus(openingRecord(draft)));
    selectOne({ kind: "opening", id: doc.openings[doc.openings.length - 1].id }, false);
    persist();
    refreshPlanner();
    maybePushCompile();
    return;
  }
  if (sku.category === "beam") {
    const wall = nearestPlaceWall(x, y, sku.id);
    if (!wall) {
      return;
    }
    const t = wallT(wall, x, y);
    const p = pointOnWall(wall, t);
    if (!beamStart) {
      beamStart = { x: p.x, y: p.y, sku: sku.id };
      drawPlanner();
      return;
    }
    finishBeam(sku, p.x, p.y);
    return;
  }
  if (sku.host === "floor" || sku.host === "room") {
    const room = roomAt(x, y);
    if (!room) {
      return;
    }
    pushUndo();
    doc.items.push(withPlaceStatus({
      id: nid("i"),
      sku: sku.id,
      x: roundGrid(x - (sku.width || 0.2) / 2),
      y: roundGrid(y - (sku.depth || sku.width || 0.2) / 2),
      rotation: 0,
    }));
    selectOne({ kind: "item", id: doc.items[doc.items.length - 1].id }, false);
    persist();
    refreshPlanner();
    maybePushCompile();
  }
}

function finishBeam(sku, x, y) {
  const maxSpan = pack.recipes.maxSpan?.[sku.id] || 4.2;
  const minLen = pack.recipes.minLength?.[sku.id] || 1.2;
  let x2 = x;
  let y2 = y;
  const dx = x2 - beamStart.x;
  const dy = y2 - beamStart.y;
  let len = Math.hypot(dx, dy);
  if (len < minLen) {
    beamStart = null;
    drawPlanner();
    return;
  }
  if (len > maxSpan) {
    const s = maxSpan / len;
    x2 = beamStart.x + dx * s;
    y2 = beamStart.y + dy * s;
    len = maxSpan;
  }
  const candidate = { x1: beamStart.x, y1: beamStart.y, x2, y2 };
  if (!beamHostsOk(candidate, sku.id)) {
    beamStart = null;
    drawPlanner();
    return;
  }
  pushUndo();
  doc.beams.push(withPlaceStatus({ id: nid("b"), sku: sku.id, ...candidate }));
  selectOne({ kind: "beam", id: doc.beams[doc.beams.length - 1].id }, false);
  beamStart = null;
  persist();
  refreshPlanner();
  maybePushCompile();
}

function deleteRef(ref) {
  if (ref.kind === "room") {
    const room = doc.rooms.find((r) => r.id === ref.id);
    doc.rooms = doc.rooms.filter((r) => r.id !== ref.id);
    doc.openings = doc.openings.filter((o) => o.roomId !== ref.id);
    if (room) {
      doc.items = doc.items.filter((item) => {
        const sku = skuById(item.sku);
        const box = itemRect(item, sku || { width: 0.1, depth: 0.1 });
        const cx = box.x + box.w / 2;
        const cy = box.y + box.h / 2;
        return !(cx >= room.rect.x && cx <= room.rect.x + room.rect.w && cy >= room.rect.y && cy <= room.rect.y + room.rect.h);
      });
    }
    return;
  }
  if (ref.kind === "opening") {
    doc.openings = doc.openings.filter((o) => o.id !== ref.id);
    return;
  }
  if (ref.kind === "trace") {
    doc.traces = doc.traces.filter((t) => t.id !== ref.id);
    doc.openings = doc.openings.filter((o) => o.wallId !== ref.id);
    return;
  }
  if (ref.kind === "item") {
    doc.items = doc.items.filter((i) => i.id !== ref.id);
    return;
  }
  if (ref.kind === "beam") {
    doc.beams = doc.beams.filter((b) => b.id !== ref.id);
    return;
  }
  if (ref.kind === "slab") {
    doc.slabs = doc.slabs.filter((s) => s.id !== ref.id);
    return;
  }
  if (ref.kind === "roof") {
    doc.roofs = doc.roofs.filter((s) => s.id !== ref.id);
  }
}

function deleteSelection() {
  const refs = selected.length ? [...selected] : (selection ? [selection] : []);
  if (!refs.length) {
    return;
  }
  pushUndo();
  const rooms = refs.filter((ref) => ref.kind === "room");
  const rest = refs.filter((ref) => ref.kind !== "room");
  for (const ref of rooms) {
    deleteRef(ref);
  }
  for (const ref of rest) {
    deleteRef(ref);
  }
  pruneGroups();
  clearSelection();
  persist();
  refreshPlanner();
  maybePushCompile();
}

function typePickerOpen() {
  return Boolean(plannerEls.typePicker?.open);
}

function closeTypePicker(sku) {
  const resolve = typePick?.resolve;
  typePick = null;
  if (plannerEls.typePicker?.open) {
    plannerEls.typePicker.close();
  }
  resolve?.(sku || null);
}

function renderTypePickerList() {
  if (!typePick || !plannerEls.typeList) {
    return;
  }
  const q = (plannerEls.typeSearch?.value || "").trim().toLowerCase();
  const rows = typePick.skus.filter((sku) => {
    const hay = `${skuTypeLabel(sku)} ${sku.id} ${skuDimLabel(sku)}`.toLowerCase();
    return !q || hay.includes(q);
  });
  if (!rows.some((sku) => sku.id === typePick.selectedId) && rows[0]) {
    typePick.selectedId = rows[0].id;
  }
  plannerEls.typeList.innerHTML = "";
  for (const sku of rows) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "type-pick-item";
    btn.dataset.skuId = sku.id;
    if (sku.id === typePick.selectedId) {
      btn.classList.add("active");
    }
    btn.innerHTML = `<span class="sku-name">${escapeHtml(skuTypeLabel(sku))}</span><span class="sku-meta">${escapeHtml(sku.id)} · ${escapeHtml(skuDimLabel(sku))}</span>`;
    btn.addEventListener("click", () => {
      typePick.selectedId = sku.id;
      renderTypePickerList();
    });
    btn.addEventListener("dblclick", () => closeTypePicker(sku));
    plannerEls.typeList.appendChild(btn);
  }
  plannerEls.typeList.querySelector(".type-pick-item.active")?.scrollIntoView({ block: "nearest" });
}

function openTypePicker({ title, prompt, actionLabel, skus, selectedId }) {
  if (!plannerEls.typePicker) {
    return Promise.resolve(skus.find((s) => s.id === selectedId) || skus[0] || null);
  }
  return new Promise((resolve) => {
    typePick = {
      resolve,
      skus,
      selectedId: selectedId && skus.some((s) => s.id === selectedId) ? selectedId : skus[0]?.id,
    };
    plannerEls.typeTitle.textContent = title;
    plannerEls.typePrompt.textContent = prompt;
    plannerEls.typeOk.textContent = actionLabel;
    if (plannerEls.typeSearch) {
      plannerEls.typeSearch.value = "";
    }
    renderTypePickerList();
    plannerEls.typePicker.showModal();
    plannerEls.typeSearch?.focus();
  });
}

async function pickSkuType({ title, prompt, actionLabel, skus, selectedId, force }) {
  if (!skus.length) {
    return null;
  }
  if (!force && skus.length === 1) {
    return skus[0];
  }
  return openTypePicker({ title, prompt, actionLabel, skus, selectedId });
}

function placePromptFor(category) {
  if (category === "door" || category === "window") {
    return `Choose a ${category} type, then click a wall in the floor plan. Esc finishes. Size follows the type.`;
  }
  if (category === "wall" || category === "foundation") {
    return `Choose a ${categoryNoun(category)} type, then drag an axis-aligned line. Esc finishes.`;
  }
  if (category === "floor") {
    return "Choose a slab type, then drag a rectangle. Esc finishes. Thickness follows the type.";
  }
  if (category === "roof") {
    return "Choose a roof type, then drag a rectangle. Esc finishes.";
  }
  return `Choose a ${categoryNoun(category)} type, then click to place. Esc finishes. Size follows the type.`;
}

async function startTypedPlacement(nextTool, category) {
  const skus = visibleSkus(category);
  const noun = categoryNoun(category);
  if (!skus.length) {
    return;
  }
  const current = skuById(placeSkuId);
  const chosen = await pickSkuType({
    title: `Place ${noun}`,
    prompt: placePromptFor(category),
    actionLabel: "Place",
    skus,
    selectedId: current?.category === category ? current.id : skus[0].id,
    force: category === "door" || category === "window" || skus.length > 1,
  });
  if (!chosen) {
    syncToolButtons();
    refreshPlanner();
    return;
  }
  placeSkuId = chosen.id;
  tool = nextTool;
  clearSelection();
  beamStart = null;
  syncToolButtons();
  refreshPlanner();
}

function selectionTypeContext() {
  if (!selection || !pack) {
    return null;
  }
  if (selection.kind === "opening") {
    const opening = doc.openings.find((o) => o.id === selection.id);
    const sku = skuById(opening?.sku);
    if (!opening || !sku) {
      return null;
    }
    return {
      skus: visibleSkus(sku.category),
      currentId: opening.sku,
      apply: (next) => {
        opening.sku = next.id;
      },
    };
  }
  if (selection.kind === "item") {
    const item = doc.items.find((i) => i.id === selection.id);
    const sku = skuById(item?.sku);
    if (!item || !sku) {
      return null;
    }
    return {
      skus: visibleSkus(sku.category),
      currentId: item.sku,
      apply: (next) => {
        item.sku = next.id;
      },
    };
  }
  if (selection.kind === "beam") {
    const beam = doc.beams.find((b) => b.id === selection.id);
    const sku = skuById(beam?.sku);
    if (!beam || !sku) {
      return null;
    }
    return {
      skus: visibleSkus("beam"),
      currentId: beam.sku,
      apply: (next) => {
        beam.sku = next.id;
      },
    };
  }
  if (selection.kind === "trace") {
    const trace = doc.traces.find((t) => t.id === selection.id);
    if (!trace) {
      return null;
    }
    return {
      skus: visibleSkus(["wall", "foundation"]),
      currentId: trace.sku,
      apply: (next) => {
        trace.sku = next.id;
      },
    };
  }
  if (selection.kind === "slab" || selection.kind === "roof") {
    const list = selection.kind === "slab" ? doc.slabs : doc.roofs;
    const patch = list.find((s) => s.id === selection.id);
    if (!patch) {
      return null;
    }
    return {
      skus: visibleSkus(selection.kind === "slab" ? "floor" : "roof"),
      currentId: patch.sku,
      apply: (next) => {
        patch.sku = next.id;
        if (selection.kind === "slab") {
          patch.level = patch.level || defaultLevelFor(next);
        }
      },
    };
  }
  if (selection.kind === "room") {
    const room = doc.rooms.find((r) => r.id === selection.id);
    if (!room) {
      return null;
    }
    return {
      skus: visibleSkus("wall"),
      currentId: room.wallSku,
      apply: (next) => {
        if (next.category === "wall") {
          room.wallSku = next.id;
        }
        if (next.category === "floor") {
          room.floorSku = next.id;
        }
      },
    };
  }
  return null;
}

async function editSelectionType(categoryOverride) {
  const ctx = selectionTypeContext();
  if (!ctx?.skus.length) {
    return;
  }
  const skus = categoryOverride ? visibleSkus(categoryOverride) : ctx.skus;
  const noun = categoryNoun(skus[0]?.category || "type");
  const chosen = await openTypePicker({
    title: "Change type",
    prompt: `Choose a ${noun} type. The object size updates to match.`,
    actionLabel: "Change type",
    skus,
    selectedId: ctx.currentId,
  });
  if (!chosen) {
    return;
  }
  pushUndo();
  ctx.apply(chosen);
  persist();
  refreshPlanner();
  maybePushCompile();
}

function bindTypePicker() {
  if (!plannerEls.typePicker) {
    return;
  }
  plannerEls.typeSearch?.addEventListener("input", renderTypePickerList);
  plannerEls.typeCancel?.addEventListener("click", () => closeTypePicker(null));
  plannerEls.typeOk?.addEventListener("click", () => {
    const sku = typePick?.skus.find((s) => s.id === typePick.selectedId) || null;
    if (!sku) {
      return;
    }
    closeTypePicker(sku);
  });
  plannerEls.typePicker.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeTypePicker(null);
  });
  plannerEls.typePicker.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && typePick) {
      event.preventDefault();
      const sku = typePick.skus.find((s) => s.id === typePick.selectedId);
      closeTypePicker(sku || null);
    }
  });
}

function renderPalette() {
  if (!pack || !plannerEls.skuList) {
    return;
  }
  const q = (plannerEls.search.value || "").trim().toLowerCase();
  const groups = new Map();
  for (const sku of pack.skus) {
    if (sku.draw === "hidden") {
      continue;
    }
    const hay = `${sku.id} ${sku.name} ${sku.category}`.toLowerCase();
    if (q && !hay.includes(q)) {
      continue;
    }
    if (!groups.has(sku.category)) {
      groups.set(sku.category, []);
    }
    groups.get(sku.category).push(sku);
  }
  plannerEls.skuList.innerHTML = "";
  for (const [cat, skus] of groups) {
    const wrap = document.createElement("div");
    wrap.className = "planner-sku-group";
    wrap.innerHTML = `<h3>${escapeHtml(categoryLabel(cat))}</h3>`;
    for (const sku of skus) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sku-item";
      if (placeSkuId === sku.id) {
        btn.classList.add("active");
      }
      const size = skuDimLabel(sku);
      btn.innerHTML = `<span class="sku-name">${escapeHtml(skuTypeLabel(sku))}</span><span class="sku-meta">${escapeHtml(sku.id)} · ${escapeHtml(size)}</span>`;
      btn.addEventListener("click", () => {
        if (applySkuToSelection(sku)) {
          return;
        }
        if (sku.category === "wall" || sku.category === "foundation") {
          placeSkuId = sku.id;
          tool = "trace";
          beamStart = null;
          syncToolButtons();
          renderPalette();
          renderInspector();
          drawPlanner();
          return;
        }
        if (sku.category === "floor") {
          if (selection?.kind === "room") {
            applySkuToSelection(sku);
          }
          placeSkuId = sku.id;
          tool = "slab";
          beamStart = null;
          syncToolButtons();
          renderPalette();
          renderInspector();
          drawPlanner();
          return;
        }
        if (sku.category === "roof") {
          placeSkuId = sku.id;
          tool = "roof";
          beamStart = null;
          syncToolButtons();
          renderPalette();
          renderInspector();
          drawPlanner();
          return;
        }
        placeSkuId = sku.id;
        tool = sku.category === "door" || sku.category === "window" ? sku.category : "place";
        beamStart = null;
        syncToolButtons();
        renderPalette();
        renderInspector();
        drawPlanner();
      });
      wrap.appendChild(btn);
    }
    plannerEls.skuList.appendChild(wrap);
  }
}

function applySkuToSelection(sku) {
  if (selected.length !== 1) {
    return false;
  }
  if (selection?.kind === "room") {
    pushUndo();
    const room = doc.rooms.find((r) => r.id === selection.id);
    if (!room) {
      return;
    }
    if (sku.category === "wall") {
      room.wallSku = sku.id;
    }
    if (sku.category === "floor") {
      room.floorSku = sku.id;
    }
    persist();
    refreshPlanner();
    maybePushCompile();
    return true;
  }
  if (selection?.kind === "slab" && sku.category === "floor") {
    pushUndo();
    const slab = doc.slabs.find((s) => s.id === selection.id);
    if (slab) {
      slab.sku = sku.id;
      slab.level = slab.level || defaultLevelFor(sku);
    }
    persist();
    refreshPlanner();
    maybePushCompile();
    return true;
  }
  if (selection?.kind === "roof" && sku.category === "roof") {
    pushUndo();
    const roof = doc.roofs.find((s) => s.id === selection.id);
    if (roof) {
      roof.sku = sku.id;
    }
    persist();
    refreshPlanner();
    maybePushCompile();
    return true;
  }
  if (selection?.kind === "trace" && (sku.category === "wall" || sku.category === "foundation")) {
    pushUndo();
    const trace = doc.traces.find((t) => t.id === selection.id);
    if (trace) {
      trace.sku = sku.id;
    }
    persist();
    refreshPlanner();
    maybePushCompile();
    return true;
  }
  if (selection?.kind === "opening" && (sku.category === "door" || sku.category === "window")) {
    const opening = doc.openings.find((o) => o.id === selection.id);
    const current = skuById(opening?.sku);
    if (opening && current?.category === sku.category) {
      pushUndo();
      opening.sku = sku.id;
      persist();
      refreshPlanner();
      maybePushCompile();
      return true;
    }
  }
  if (selection?.kind === "item") {
    const item = doc.items.find((i) => i.id === selection.id);
    const current = skuById(item?.sku);
    if (item && current?.category === sku.category) {
      pushUndo();
      item.sku = sku.id;
      persist();
      refreshPlanner();
      maybePushCompile();
      return true;
    }
  }
  if (selection?.kind === "beam" && sku.category === "beam") {
    pushUndo();
    const beam = doc.beams.find((b) => b.id === selection.id);
    if (beam) {
      beam.sku = sku.id;
    }
    persist();
    refreshPlanner();
    maybePushCompile();
    return true;
  }
  return false;
}

function selectionKindCounts() {
  const counts = new Map();
  for (const ref of selected) {
    counts.set(ref.kind, (counts.get(ref.kind) || 0) + 1);
  }
  const labels = {
    room: "room",
    slab: "slab",
    roof: "roof",
    trace: "wall / foundation",
    item: "item",
    beam: "beam",
    opening: "opening",
  };
  return [...counts.entries()].map(([kind, n]) => `${n} ${labels[kind] || kind}${n === 1 ? "" : "s"}`).join(", ");
}

function groupFooterHtml(ref) {
  const group = groupForRef(ref);
  if (!group) {
    return "";
  }
  return `<p class="hint">In group “${escapeHtml(group.name)}”. Ctrl-click picked this member only.</p><button type="button" id="insp-ungroup">Ungroup</button>`;
}

function bindGroupActions() {
  plannerEls.inspect?.querySelector("#insp-group")?.addEventListener("click", groupSelection);
  plannerEls.inspect?.querySelector("#insp-ungroup")?.addEventListener("click", ungroupSelection);
}

function renderMultiInspector() {
  const groups = selectedGroups();
  const grouped = groups.find((group) => wholeGroupSelected(group)) || null;
  plannerEls.kicker.textContent = grouped ? grouped.name : `${selected.length} selected`;
  const groupBtn = selected.length >= 2 ? `<button type="button" id="insp-group">Group</button>` : "";
  const ungroupBtn = groups.length ? `<button type="button" id="insp-ungroup">Ungroup</button>` : "";
  plannerEls.inspect.innerHTML = `
    ${grouped ? `<label>Name <input id="insp-group-name" value="${escapeHtml(grouped.name)}" /></label>` : ""}
    <p class="hint">${escapeHtml(selectionKindCounts())}. Drag to move together. Doors and windows stay on their walls.</p>
    <p class="hint">Shift-click adds. Ctrl-click picks one member of a group. Click again to cycle stacked objects. Drag empty: left-to-right window (inside), right-to-left crossing.</p>
    ${groupBtn}
    ${ungroupBtn}
  `;
  plannerEls.inspect.querySelector("#insp-group-name")?.addEventListener("change", (e) => {
    pushUndo();
    grouped.name = e.target.value.trim() || grouped.name;
    persist();
    refreshPlanner();
  });
  bindGroupActions();
}

function renderInspector() {
  if (!plannerEls.inspect) {
    return;
  }
  if (!selection && !selected.length) {
    const cat = openingTool();
    if (cat) {
      const sku = skuById(placeSkuId) || skuById(firstSkuId(cat));
      plannerEls.kicker.textContent = cat === "door" ? "Place door" : "Place window";
      plannerEls.inspect.innerHTML = `<p class="hint">${escapeHtml(sku?.name || "")} · ${escapeHtml(skuDimLabel(sku) || "")}. Click a wall. Esc cancels. Select a placed ${cat} to change type.</p>`;
      return;
    }
    const drawSku = skuById(placeSkuId);
    if (tool === "trace" && drawSku) {
      plannerEls.kicker.textContent = drawSku.category === "foundation" ? "Draw foundation" : "Draw wall";
      plannerEls.inspect.innerHTML = `<p class="hint">${escapeHtml(drawSku.name)}. Drag an axis-aligned line. Esc cancels.</p>`;
      return;
    }
    if (tool === "slab" && drawSku) {
      plannerEls.kicker.textContent = "Draw slab";
      plannerEls.inspect.innerHTML = `<p class="hint">${escapeHtml(drawSku.name)}. Drag a rectangle. Esc cancels.</p>`;
      return;
    }
    if (tool === "roof" && drawSku) {
      plannerEls.kicker.textContent = "Draw roof";
      plannerEls.inspect.innerHTML = `<p class="hint">${escapeHtml(drawSku.name)}. Drag a rectangle. Esc cancels.</p>`;
      return;
    }
    plannerEls.kicker.textContent = "Nothing selected";
    plannerEls.inspect.innerHTML = `<p class="hint">Click to select one object. Click again in the same place to cycle through overlapping objects. Shift-click or drag a window to select several, then drag to move them. Group if you want a house to stay together later.</p>`;
    return;
  }
  if (selected.length > 1) {
    renderMultiInspector();
    return;
  }
  if (selection.kind === "room") {
    const room = doc.rooms.find((r) => r.id === selection.id);
    if (!room) {
      return;
    }
    plannerEls.kicker.textContent = room.name;
    const walls = pack.skus.filter((s) => s.category === "wall");
    const floors = pack.skus.filter((s) => s.category === "floor");
    plannerEls.inspect.innerHTML = `
      ${statusControlHtml(room)}
      <label>Name <input id="insp-name" value="${escapeHtml(room.name)}" /></label>
      <div class="planner-size-pair">
        <label>Width <input id="insp-w" type="number" min="1" step="0.1" value="${formatMetres(room.rect.w)}" /></label>
        <label>Length <input id="insp-h" type="number" min="1" step="0.1" value="${formatMetres(room.rect.h)}" /></label>
      </div>
      <div class="hint" id="insp-area">${formatMetres(room.rect.w)} × ${formatMetres(room.rect.h)} m · ${(room.rect.w * room.rect.h).toFixed(1)} m²</div>
      <p class="hint">Drag a wall to move it. Drag a handle or the corner to resize.</p>
      <label>Wall
        <select id="insp-wall">${walls.map((s) => `<option value="${s.id}" ${s.id === room.wallSku ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}</select>
      </label>
      <label>Floor
        <select id="insp-floor">${floors.map((s) => `<option value="${s.id}" ${s.id === room.floorSku ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}</select>
      </label>
      <button type="button" id="insp-change-type">Change wall type</button>
      ${groupFooterHtml({ kind: "room", id: room.id })}
    `;
    plannerEls.inspect.querySelector("#insp-name").addEventListener("change", (e) => {
      pushUndo();
      room.name = e.target.value || room.name;
      persist();
      refreshPlanner();
    });
    const applyInspectSize = (axis, raw) => {
      pushUndo();
      if (axis === "w") {
        room.rect.w = parseMetres(raw, room.rect.w);
      } else {
        room.rect.h = parseMetres(raw, room.rect.h);
      }
      persist();
      refreshPlanner();
      maybePushCompile();
    };
    plannerEls.inspect.querySelector("#insp-w").addEventListener("change", (e) => applyInspectSize("w", e.target.value));
    plannerEls.inspect.querySelector("#insp-h").addEventListener("change", (e) => applyInspectSize("h", e.target.value));
    plannerEls.inspect.querySelector("#insp-wall").addEventListener("change", (e) => {
      pushUndo();
      room.wallSku = e.target.value;
      persist();
      refreshPlanner();
      maybePushCompile();
    });
    plannerEls.inspect.querySelector("#insp-floor").addEventListener("change", (e) => {
      pushUndo();
      room.floorSku = e.target.value;
      persist();
      refreshPlanner();
      maybePushCompile();
    });
    plannerEls.inspect.querySelector("#insp-change-type")?.addEventListener("click", () => editSelectionType("wall"));
    bindStatusControl(room);
    bindGroupActions();
    return;
  }
  if (selection.kind === "trace") {
    const trace = doc.traces.find((t) => t.id === selection.id);
    const sku = skuById(trace?.sku);
    const types = pack.skus.filter((s) => s.category === "wall" || s.category === "foundation");
    const len = trace ? Math.hypot(trace.x2 - trace.x1, trace.y2 - trace.y1) : 0;
    plannerEls.kicker.textContent = sku?.name || "Wall";
    plannerEls.inspect.innerHTML = `
      ${statusControlHtml(trace)}
      <label>Type
        <select id="insp-trace-sku">${types.map((s) => `<option value="${s.id}" ${s.id === trace.sku ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}</select>
      </label>
      <label>Length <input id="insp-len" type="number" min="0.3" step="0.1" value="${formatMetres(len)}" /></label>
      <p class="hint">${len.toFixed(2)} m · Drag the wall to move it. Drag an end to change length. Delete removes it.</p>
      <button type="button" id="insp-change-type">Change type</button>
      ${groupFooterHtml({ kind: "trace", id: trace.id })}
    `;
    plannerEls.inspect.querySelector("#insp-len")?.addEventListener("change", (e) => {
      pushUndo();
      setTraceLength(trace, parseFloat(e.target.value));
      persist();
      refreshPlanner();
      maybePushCompile();
    });
    plannerEls.inspect.querySelector("#insp-trace-sku")?.addEventListener("change", (e) => {
      pushUndo();
      trace.sku = e.target.value;
      persist();
      refreshPlanner();
      maybePushCompile();
    });
    plannerEls.inspect.querySelector("#insp-change-type")?.addEventListener("click", () => editSelectionType(["wall", "foundation"]));
    bindStatusControl(trace);
    bindGroupActions();
    return;
  }
  if (selection.kind === "slab" || selection.kind === "roof") {
    const list = selection.kind === "slab" ? doc.slabs : doc.roofs;
    const patch = list.find((s) => s.id === selection.id);
    const sku = skuById(patch?.sku);
    const types = pack.skus.filter((s) => s.category === (selection.kind === "slab" ? "floor" : "roof"));
    const levels = packLevels();
    const roofForm = selection.kind === "roof" ? normalizeRoofForm(patch.form) : "";
    const roofPitch = selection.kind === "roof" ? roofPitchDeg({ ...patch, form: roofForm || "gable" }) : DEFAULT_ROOF_PITCH;
    const roofRidge = selection.kind === "roof" ? normalizeRoofRidge(patch.ridge) : "long";
    plannerEls.kicker.textContent = patch?.name || sku?.name || selection.kind;
    plannerEls.inspect.innerHTML = `
      ${statusControlHtml(patch)}
      <label>Name <input id="insp-name" value="${escapeHtml(patch.name || "")}" /></label>
      <div class="planner-size-pair">
        <label>Width <input id="insp-w" type="number" min="0.5" step="0.1" value="${formatMetres(patch.rect.w)}" /></label>
        <label>Length <input id="insp-h" type="number" min="0.5" step="0.1" value="${formatMetres(patch.rect.h)}" /></label>
      </div>
      <div class="hint" id="insp-area">${formatMetres(patch.rect.w)} × ${formatMetres(patch.rect.h)} m · ${(patch.rect.w * patch.rect.h).toFixed(1)} m²</div>
      <label>Type
        <select id="insp-patch-sku">${types.map((s) => `<option value="${s.id}" ${s.id === patch.sku ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}</select>
      </label>
      ${selection.kind === "roof" ? `
      <label>Form
        <select id="insp-roof-form">
          <option value="flat"${roofForm === "flat" ? " selected" : ""}>Flat</option>
          <option value="gable"${roofForm === "gable" ? " selected" : ""}>Gable</option>
          <option value="shed"${roofForm === "shed" ? " selected" : ""}>Shed</option>
          <option value="hip"${roofForm === "hip" ? " selected" : ""}>Hip</option>
        </select>
      </label>
      <div class="planner-size-pair" id="insp-roof-shape"${roofForm === "flat" ? " hidden" : ""}>
        <label>Pitch (°) <input id="insp-roof-pitch" type="number" min="5" max="60" step="1" value="${roofForm === "flat" ? DEFAULT_ROOF_PITCH : roofPitch}" /></label>
        <label>Ridge
          <select id="insp-roof-ridge">
            <option value="long"${roofRidge === "long" ? " selected" : ""}>Along long side</option>
            <option value="short"${roofRidge === "short" ? " selected" : ""}>Along short side</option>
          </select>
        </label>
      </div>
      <p class="hint">${roofForm === "flat" ? "Flat sits on the walls as a slab. Choose gable, shed, or hip for a pitched 3D roof." : roofForm === "shed" ? "High edge is the first side of the ridge; fall runs across the span." : "Ridge runs along the chosen side. Pitch is from eave to ridge."}</p>
      ` : ""}
      <label>Level
        <select id="insp-level">${levels.map((lv) => `<option value="${escapeHtml(lv.id)}" ${lv.id === patch.level ? "selected" : ""}>${escapeHtml(lv.name)}</option>`).join("")}</select>
      </label>
      <button type="button" id="insp-change-type">Change type</button>
      ${groupFooterHtml({ kind: selection.kind, id: patch.id })}
    `;
    plannerEls.inspect.querySelector("#insp-name").addEventListener("change", (e) => {
      pushUndo();
      patch.name = e.target.value || patch.name;
      persist();
      refreshPlanner();
    });
    const applyInspectSize = (axis, raw) => {
      pushUndo();
      if (axis === "w") {
        patch.rect.w = parseMetres(raw, patch.rect.w);
      } else {
        patch.rect.h = parseMetres(raw, patch.rect.h);
      }
      persist();
      refreshPlanner();
      maybePushCompile();
    };
    plannerEls.inspect.querySelector("#insp-w").addEventListener("change", (e) => applyInspectSize("w", e.target.value));
    plannerEls.inspect.querySelector("#insp-h").addEventListener("change", (e) => applyInspectSize("h", e.target.value));
    plannerEls.inspect.querySelector("#insp-patch-sku").addEventListener("change", (e) => {
      pushUndo();
      patch.sku = e.target.value;
      persist();
      refreshPlanner();
      maybePushCompile();
    });
    plannerEls.inspect.querySelector("#insp-level").addEventListener("change", (e) => {
      pushUndo();
      patch.level = e.target.value;
      persist();
      refreshPlanner();
      maybePushCompile();
    });
    plannerEls.inspect.querySelector("#insp-roof-form")?.addEventListener("change", (e) => {
      pushUndo();
      patch.form = normalizeRoofForm(e.target.value);
      if (patch.form !== "flat" && !(Number(patch.pitch) > 0)) {
        patch.pitch = DEFAULT_ROOF_PITCH;
      }
      patch.ridge = normalizeRoofRidge(patch.ridge);
      persist();
      refreshPlanner();
      maybePushCompile();
    });
    plannerEls.inspect.querySelector("#insp-roof-pitch")?.addEventListener("change", (e) => {
      pushUndo();
      patch.pitch = roofPitchDeg({ form: patch.form || "gable", pitch: e.target.value });
      persist();
      refreshPlanner();
      maybePushCompile();
    });
    plannerEls.inspect.querySelector("#insp-roof-ridge")?.addEventListener("change", (e) => {
      pushUndo();
      patch.ridge = normalizeRoofRidge(e.target.value);
      persist();
      refreshPlanner();
      maybePushCompile();
    });
    plannerEls.inspect.querySelector("#insp-change-type")?.addEventListener("click", () => {
      editSelectionType(selection.kind === "slab" ? "floor" : "roof");
    });
    bindStatusControl(patch);
    bindGroupActions();
    return;
  }
  if (selection.kind === "opening") {
    const opening = doc.openings.find((o) => o.id === selection.id);
    const sku = skuById(opening?.sku);
    const types = pack.skus.filter((s) => s.category === sku?.category);
    plannerEls.kicker.textContent = sku?.name || "Opening";
    plannerEls.inspect.innerHTML = `
      ${statusControlHtml(opening)}
      <label>Type
        <select id="insp-opening-sku">${types.map((s) => `<option value="${s.id}" ${s.id === opening.sku ? "selected" : ""}>${escapeHtml(skuTypeLabel(s))}</option>`).join("")}</select>
      </label>
      <p class="hint">${escapeHtml(skuDimLabel(sku) || "")}. Changing type resizes the ${sku?.category || "opening"}.</p>
      ${sku?.category === "door" ? `<button type="button" id="insp-swing">Flip swing</button>` : ""}
      <button type="button" id="insp-change-type">Change type</button>
      <p class="hint">Drag along a room wall or a drawn wall. Delete removes it.</p>
      ${groupFooterHtml({ kind: "opening", id: opening.id })}
    `;
    plannerEls.inspect.querySelector("#insp-opening-sku")?.addEventListener("change", (e) => {
      pushUndo();
      opening.sku = e.target.value;
      persist();
      refreshPlanner();
      maybePushCompile();
    });
    plannerEls.inspect.querySelector("#insp-swing")?.addEventListener("click", () => {
      pushUndo();
      opening.swing = (opening.swing || 1) * -1;
      persist();
      refreshPlanner();
      maybePushCompile();
    });
    plannerEls.inspect.querySelector("#insp-change-type")?.addEventListener("click", () => editSelectionType(sku?.category));
    bindStatusControl(opening);
    bindGroupActions();
    return;
  }
  if (selection.kind === "item") {
    const item = doc.items.find((i) => i.id === selection.id);
    const sku = skuById(item?.sku);
    const types = pack.skus.filter((s) => s.category === sku?.category && s.draw !== "hidden");
    plannerEls.kicker.textContent = sku?.name || "Item";
    plannerEls.inspect.innerHTML = `
      ${statusControlHtml(item)}
      <label>Type
        <select id="insp-item-sku">${types.map((s) => `<option value="${s.id}" ${s.id === item.sku ? "selected" : ""}>${escapeHtml(skuTypeLabel(s))}</option>`).join("")}</select>
      </label>
      <p class="hint">${escapeHtml(skuDimLabel(sku) || sku?.id || "")}. Changing type resizes the object. R rotates 90°.</p>
      <button type="button" id="insp-change-type">Change type</button>
      ${groupFooterHtml({ kind: "item", id: item.id })}
    `;
    plannerEls.inspect.querySelector("#insp-item-sku")?.addEventListener("change", (e) => {
      pushUndo();
      item.sku = e.target.value;
      persist();
      refreshPlanner();
      maybePushCompile();
    });
    plannerEls.inspect.querySelector("#insp-change-type")?.addEventListener("click", () => editSelectionType(sku?.category));
    bindStatusControl(item);
    bindGroupActions();
    return;
  }
  if (selection.kind === "beam") {
    const beam = doc.beams.find((b) => b.id === selection.id);
    const sku = skuById(beam?.sku);
    const len = beam ? Math.hypot(beam.x2 - beam.x1, beam.y2 - beam.y1) : 0;
    plannerEls.kicker.textContent = sku?.name || "Beam";
    plannerEls.inspect.innerHTML = `${statusControlHtml(beam)}<p class="hint">${len.toFixed(2)} m</p><button type="button" id="insp-change-type">Change type</button>${groupFooterHtml({ kind: "beam", id: beam.id })}`;
    plannerEls.inspect.querySelector("#insp-change-type")?.addEventListener("click", () => editSelectionType("beam"));
    bindStatusControl(beam);
    bindGroupActions();
  }
}

function refreshPlanner() {
  renderPalette();
  renderInspector();
  drawPlanner();
}

function syncToolButtons() {
  document.querySelectorAll("[data-planner-tool]").forEach((btn) => {
    const next = btn.dataset.plannerTool;
    const cat = btn.dataset.plannerCat;
    let on = tool === next;
    if (next === "trace" && cat) {
      on = tool === "trace" && skuById(placeSkuId)?.category === cat;
    }
    btn.classList.toggle("active", on);
  });
  document.querySelectorAll("[data-place-status]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.placeStatus === placeStatus);
  });
}

function bindPlanner() {
  if (!plannerEls.canvas) {
    return;
  }

  bindTypePicker();

  document.querySelectorAll("[data-place-status]").forEach((btn) => {
    btn.addEventListener("click", () => {
      placeStatus = btn.dataset.placeStatus === "existing" ? "existing" : "planned";
      syncToolButtons();
    });
  });

  document.querySelectorAll("[data-planner-tool]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const next = btn.dataset.plannerTool;
      beamStart = null;
      if (next === "door" || next === "window") {
        await startTypedPlacement(next, next);
        return;
      }
      if (next === "trace") {
        await startTypedPlacement("trace", btn.dataset.plannerCat || "wall");
        return;
      }
      if (next === "slab") {
        await startTypedPlacement("slab", "floor");
        return;
      }
      if (next === "roof") {
        await startTypedPlacement("roof", "roof");
        return;
      }
      tool = next;
      if (next !== "place") {
        placeSkuId = null;
      }
      syncToolButtons();
      refreshPlanner();
    });
  });

  document.getElementById("planner-undo")?.addEventListener("click", undo);
  document.getElementById("planner-demo")?.addEventListener("click", () => {
    pushUndo();
    doc = demoDoc();
    selectOne({ kind: "room", id: "r-bath" }, false);
    persist();
    refreshPlanner();
    maybePushCompile();
  });
  document.getElementById("planner-clear")?.addEventListener("click", () => {
    pushUndo();
    doc = emptyDoc();
    clearSelection();
    persist();
    refreshPlanner();
    maybePushCompile();
  });
  document.getElementById("planner-use")?.addEventListener("click", () => {
    if (applyPlannerCompile(true)) {
      showBanner("Planner takeoff is on Cost and 3D.", "ok");
    }
  });
  document.getElementById("planner-3d")?.addEventListener("click", () => {
    applyPlannerCompile(true);
    setView("mass");
  });

  plannerEls.search?.addEventListener("input", renderPalette);

  const onHudAxis = (axis) => (event) => {
    commitHudAxis(axis, event.target.value);
  };
  plannerEls.hudW?.addEventListener("input", onHudAxis("w"));
  plannerEls.hudH?.addEventListener("input", onHudAxis("h"));
  plannerEls.sizeHud?.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    if (drag?.pointerId != null) {
      try {
        plannerEls.canvas.releasePointerCapture(drag.pointerId);
      } catch {
        /* capture may already be released */
      }
    }
  });

  plannerEls.canvas.addEventListener("pointerdown", (event) => {
    if (event.button === 1 || event.altKey) {
      drag = { kind: "pan", x: event.clientX, y: event.clientY, ox: cam.ox, oy: cam.oy, pointerId: event.pointerId };
      plannerEls.canvas.setPointerCapture(event.pointerId);
      return;
    }
    const wpt = worldFromEvent(event);
    const x = roundGrid(wpt.x);
    const y = roundGrid(wpt.y);
    if (tool === "room") {
      startRectDrag("room-new", x, y, event.pointerId, MIN_ROOM);
      plannerEls.canvas.setPointerCapture(event.pointerId);
      drawPlanner();
      return;
    }
    if (tool === "slab") {
      startRectDrag("slab-new", x, y, event.pointerId, MIN_SLAB);
      plannerEls.canvas.setPointerCapture(event.pointerId);
      drawPlanner();
      return;
    }
    if (tool === "roof") {
      startRectDrag("roof-new", x, y, event.pointerId, MIN_SLAB);
      plannerEls.canvas.setPointerCapture(event.pointerId);
      drawPlanner();
      return;
    }
    if (tool === "trace" && placeSkuId) {
      drag = { kind: "trace", x0: x, y0: y, x1: x, y1: y, pointerId: event.pointerId, sku: placeSkuId };
      plannerEls.canvas.setPointerCapture(event.pointerId);
      drawPlanner();
      return;
    }
    if ((tool === "place" && placeSkuId) || openingTool()) {
      const sku = skuById(placeSkuId) || skuById(firstSkuId(openingTool()));
      if (sku) {
        placeSkuAt(sku, wpt.x, wpt.y);
      }
      return;
    }
    const hit = hitTest(wpt.x, wpt.y, wpt.sx, wpt.sy);
    const stack = hitStack(wpt.x, wpt.y);
    const additive = event.shiftKey;
    const pickMember = event.ctrlKey || event.metaKey;
    const startMove = () => {
      const targets = selected.filter(canTranslateRef);
      if (!targets.length) {
        return false;
      }
      pushUndo();
      drag = {
        kind: "multi-move",
        pointerId: event.pointerId,
        gx: wpt.x,
        gy: wpt.y,
        snaps: snapshotMoveTargets(targets),
      };
      return true;
    };

    if (!hit) {
      pickCycle = null;
      drag = {
        kind: "marquee",
        x0: wpt.x,
        y0: wpt.y,
        x1: wpt.x,
        y1: wpt.y,
        add: additive,
        pointerId: event.pointerId,
      };
      if (!additive) {
        clearSelection();
      }
      plannerEls.canvas.setPointerCapture(event.pointerId);
      refreshPlanner();
      return;
    }

    const ref = refFromHit(hit);
    if (additive) {
      pickCycle = null;
      toggleRefs(pickMember ? [ref] : expandRefsWithGroups([ref]), ref);
      plannerEls.canvas.setPointerCapture(event.pointerId);
      refreshPlanner();
      return;
    }
    if (pickMember) {
      pickCycle = null;
      selectOne(ref, false);
      plannerEls.canvas.setPointerCapture(event.pointerId);
      refreshPlanner();
      return;
    }

    const manipulator = soleSelection()
      && !groupForRef(soleSelection())
      && isSelected(ref.kind, ref.id)
      && selected.length === 1;

    if (hit.kind === "handle" && hit.target === "trace" && manipulator) {
      pickCycle = null;
      pushUndo();
      drag = { kind: "trace-end", id: hit.id, end: hit.end, pointerId: event.pointerId };
    } else if (hit.kind === "handle" && manipulator) {
      pickCycle = null;
      const target = hit.target || selection?.kind || "room";
      const patch = patchByKind(target, hit.id);
      if (patch) {
        pushUndo();
        sizeDraft = emptySizeDraft();
        drag = { kind: "resize", id: patch.id, target, x0: patch.rect.x, y0: patch.rect.y, pointerId: event.pointerId };
      }
    } else if (hit.kind === "room-edge" && !groupForRef(ref) && (manipulator || !isSelected("room", hit.id))) {
      pickCycle = null;
      selectOne(ref, false);
      const room = doc.rooms.find((r) => r.id === hit.id);
      if (room) {
        pushUndo();
        drag = { kind: "room-edge", id: room.id, edge: hit.edge, pointerId: event.pointerId };
      }
    } else {
      const current = soleSelection();
      const sameSpot = Boolean(
        pickCycle
        && stack.length > 1
        && current
        && selected.length === 1
        && pickCycle.stack.some((row) => sameRef(row, current))
        && Math.hypot(event.clientX - pickCycle.sx, event.clientY - pickCycle.sy) < 16
      );
      if (!sameSpot) {
        selectOne(ref, true);
      }
      pickCycle = {
        stack,
        sx: event.clientX,
        sy: event.clientY,
        armed: sameSpot,
      };
      const opening = soleSelection()?.kind === "opening" && selected.length === 1
        ? doc.openings.find((o) => o.id === soleSelection().id)
        : null;
      if (opening) {
        pushUndo();
        drag = { kind: "opening", id: opening.id, pointerId: event.pointerId };
      } else {
        startMove();
      }
    }
    plannerEls.canvas.setPointerCapture(event.pointerId);
    refreshPlanner();
  });

  plannerEls.canvas.addEventListener("dblclick", (event) => {
    if (tool !== "select") {
      return;
    }
    const wpt = worldFromEvent(event);
    const hit = hitTest(wpt.x, wpt.y, wpt.sx, wpt.sy);
    if (!hit || hit.kind === "handle") {
      return;
    }
    const ref = hit.kind === "room-edge"
      ? { kind: "room", id: hit.id }
      : { kind: hit.kind, id: hit.id };
    selectOne(ref, false);
    refreshPlanner();
    if (["opening", "item", "beam", "trace", "slab", "roof"].includes(hit.kind)) {
      event.preventDefault();
      editSelectionType();
    }
  });

  plannerEls.canvas.addEventListener("pointermove", (event) => {
    const wpt = worldFromEvent(event);
    hover = wpt;
    if (!drag) {
      if (openingTool() || (tool === "place" && placeSkuId) || tool === "trace") {
        drawPlanner();
      }
      return;
    }
    if (drag.kind === "pan") {
      cam.ox = drag.ox + (event.clientX - drag.x);
      cam.oy = drag.oy + (event.clientY - drag.y);
      drawPlanner();
      return;
    }
    if (drag.kind === "marquee") {
      drag.x1 = wpt.x;
      drag.y1 = wpt.y;
      drawPlanner();
      return;
    }
    if (drag.kind === "multi-move") {
      applyMoveSnapshot(drag.snaps, roundGrid(wpt.x - drag.gx), roundGrid(wpt.y - drag.gy));
      drawPlanner();
      return;
    }
    if (drag.kind === "room-new" || drag.kind === "slab-new" || drag.kind === "roof-new") {
      const min = drag.kind === "room-new" ? MIN_ROOM : MIN_SLAB;
      const next = normRect(drag.x0, drag.y0, wpt.x, wpt.y, min);
      if (sizeDraft?.lockW) {
        next.w = parseMetres(sizeDraft.typedW, next.w);
      }
      if (sizeDraft?.lockH) {
        next.h = parseMetres(sizeDraft.typedH, next.h);
      }
      drag.rect = next;
      drawPlanner();
      return;
    }
    if (drag.kind === "trace") {
      drag.x1 = wpt.x;
      drag.y1 = wpt.y;
      drawPlanner();
      return;
    }
    if (drag.kind === "resize") {
      const patch = patchByKind(drag.target || "room", drag.id);
      if (!patch) {
        return;
      }
      const min = drag.target === "room" || !drag.target ? MIN_ROOM : MIN_SLAB;
      if (!sizeDraft?.lockW) {
        patch.rect.w = Math.max(min, roundGrid(wpt.x - patch.rect.x));
      }
      if (!sizeDraft?.lockH) {
        patch.rect.h = Math.max(min, roundGrid(wpt.y - patch.rect.y));
      }
      applySizeDraftTo(patch.rect);
      drawPlanner();
      syncInspectSize(patch.rect);
      return;
    }
    if (drag.kind === "room-edge") {
      const room = doc.rooms.find((r) => r.id === drag.id);
      if (!room) {
        return;
      }
      applyRoomEdge(room, drag.edge, wpt.x, wpt.y);
      drawPlanner();
      syncInspectSize(room.rect);
      return;
    }
    if (drag.kind === "trace-end") {
      const trace = doc.traces.find((t) => t.id === drag.id);
      if (!trace) {
        return;
      }
      applyTraceEnd(trace, drag.end, wpt.x, wpt.y);
      drawPlanner();
      const inspLen = document.getElementById("insp-len");
      if (inspLen && document.activeElement !== inspLen) {
        inspLen.value = formatMetres(Math.hypot(trace.x2 - trace.x1, trace.y2 - trace.y1));
      }
      return;
    }
    if (drag.kind === "trace-move") {
      const trace = doc.traces.find((t) => t.id === drag.id);
      if (!trace) {
        return;
      }
      const nx1 = roundGrid(wpt.x - drag.dx);
      const ny1 = roundGrid(wpt.y - drag.dy);
      trace.x1 = nx1;
      trace.y1 = ny1;
      trace.x2 = roundGrid(drag.x2 + (nx1 - drag.x1));
      trace.y2 = roundGrid(drag.y2 + (ny1 - drag.y1));
      drawPlanner();
      return;
    }
    if (drag.kind === "move") {
      const patch = patchByKind(drag.target || "room", drag.id);
      if (!patch) {
        return;
      }
      patch.rect.x = roundGrid(wpt.x - drag.dx);
      patch.rect.y = roundGrid(wpt.y - drag.dy);
      drawPlanner();
      return;
    }
    if (drag.kind === "item") {
      const item = doc.items.find((i) => i.id === drag.id);
      item.x = roundGrid(wpt.x - drag.dx);
      item.y = roundGrid(wpt.y - drag.dy);
      drawPlanner();
      return;
    }
    if (drag.kind === "opening") {
      const opening = doc.openings.find((o) => o.id === drag.id);
      if (!opening) {
        drawPlanner();
        return;
      }
      const draft = openingDraftAt(skuById(opening.sku), wpt.x, wpt.y);
      if (draft) {
        applyOpeningDraft(opening, draft);
      }
      drawPlanner();
    }
  });

  window.addEventListener("pointerup", (event) => {
    const finishPickCycle = () => {
      if (!pickCycle?.armed) {
        return;
      }
      const stayed = Math.hypot(event.clientX - pickCycle.sx, event.clientY - pickCycle.sy) < 16;
      if (stayed && cycleSelection(pickCycle.stack)) {
        pickCycle.armed = false;
        pickCycle.sx = event.clientX;
        pickCycle.sy = event.clientY;
        refreshPlanner();
      } else if (!stayed) {
        pickCycle = null;
      } else {
        pickCycle.armed = false;
      }
    };
    if (!drag) {
      finishPickCycle();
      return;
    }
    if (drag.pointerId != null && event.pointerId !== drag.pointerId) {
      return;
    }
    const wpt = plannerEls.canvas ? worldFromEvent(event) : { x: drag.x0 || 0, y: drag.y0 || 0 };
    const cycleDrag = drag.kind === "multi-move" || drag.kind === "opening" || drag.kind === "move" || drag.kind === "item";
    if (drag.kind === "room-new") {
      const moved = Math.hypot(wpt.x - drag.x0, wpt.y - drag.y0);
      const rect = drag.rect || {
        x: roundGrid(drag.x0),
        y: roundGrid(drag.y0),
        w: Math.max(MIN_ROOM, Number(plannerEls.roomW.value) || 4),
        h: Math.max(MIN_ROOM, Number(plannerEls.roomH.value) || 3),
      };
      applySizeDraftTo(rect);
      if (moved < GRID && !sizeDraft?.lockW && !sizeDraft?.lockH) {
        const w = Math.max(MIN_ROOM, Number(plannerEls.roomW.value) || 4);
        const h = Math.max(MIN_ROOM, Number(plannerEls.roomH.value) || 3);
        addRoomAt({ x: roundGrid(drag.x0), y: roundGrid(drag.y0), w: roundGrid(w), h: roundGrid(h) });
      } else {
        addRoomAt(rect);
      }
    } else if (drag.kind === "slab-new" || drag.kind === "roof-new") {
      const moved = Math.hypot(wpt.x - drag.x0, wpt.y - drag.y0);
      const rect = drag.rect || {
        x: roundGrid(drag.x0),
        y: roundGrid(drag.y0),
        w: Math.max(MIN_SLAB, Number(plannerEls.roomW.value) || 4),
        h: Math.max(MIN_SLAB, Number(plannerEls.roomH.value) || 3),
      };
      applySizeDraftTo(rect);
      if (moved < GRID && !sizeDraft?.lockW && !sizeDraft?.lockH) {
        const w = Math.max(MIN_SLAB, Number(plannerEls.roomW.value) || 4);
        const h = Math.max(MIN_SLAB, Number(plannerEls.roomH.value) || 3);
        rect.x = roundGrid(drag.x0);
        rect.y = roundGrid(drag.y0);
        rect.w = roundGrid(w);
        rect.h = roundGrid(h);
      }
      if (drag.kind === "slab-new") {
        addSlabAt(rect, placeSkuId);
      } else {
        addRoofAt(rect, placeSkuId);
      }
    } else if (drag.kind === "trace") {
      addTraceAt(axisSeg(drag.x0, drag.y0, wpt.x, wpt.y), drag.sku || placeSkuId);
    } else if (drag.kind === "marquee") {
      const box = marqueeBox(drag.x0, drag.y0, drag.x1, drag.y1);
      const hits = refsInMarquee(box);
      const next = drag.add ? [...selected, ...expandRefsWithGroups(hits)] : expandRefsWithGroups(hits);
      setSelection(next);
      persist();
      refreshPlanner();
    } else if (drag.kind === "resize" || drag.kind === "move" || drag.kind === "multi-move" || drag.kind === "item" || drag.kind === "opening" || drag.kind === "trace-end" || drag.kind === "trace-move" || drag.kind === "room-edge") {
      persist();
      maybePushCompile();
      refreshPlanner();
    }
    drag = null;
    if (cycleDrag) {
      finishPickCycle();
    } else if (drag?.kind === "marquee") {
      pickCycle = null;
    }
    if (selected.length !== 1 || !["room", "slab", "roof"].includes(selection?.kind)) {
      sizeDraft = null;
    }
    syncSizeHud();
  });

  plannerEls.canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const wpt = worldFromEvent(event);
    const factor = event.deltaY > 0 ? 0.9 : 1.1;
    const next = Math.min(140, Math.max(18, cam.scale * factor));
    cam.ox = wpt.sx - wpt.x * next;
    cam.oy = wpt.sy - wpt.y * next;
    cam.scale = next;
    drawPlanner();
  }, { passive: false });

  window.addEventListener("keydown", (event) => {
    const page = document.getElementById("view-planner");
    if (!page || page.hidden) {
      return;
    }
    if (handleSizeTyping(event)) {
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
        return;
      }
      event.preventDefault();
      selectAll();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "g") {
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) {
        ungroupSelection();
      } else {
        groupSelection();
      }
      return;
    }
    if (event.key === "Escape") {
      if (typePickerOpen()) {
        return;
      }
      if (tool === "select" && (selected.length || selection)) {
        clearSelection();
        refreshPlanner();
        return;
      }
      tool = "select";
      placeSkuId = null;
      beamStart = null;
      syncToolButtons();
      renderPalette();
      renderInspector();
      drawPlanner();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
        return;
      }
      event.preventDefault();
      deleteSelection();
      return;
    }
    if (event.key.toLowerCase() === "r" && selection?.kind === "item") {
      const item = doc.items.find((i) => i.id === selection.id);
      if (item) {
        pushUndo();
        item.rotation = ((item.rotation || 0) + 90) % 180;
        persist();
        refreshPlanner();
        maybePushCompile();
      }
    }
  });
}

const originalSetView = setView;
setView = function setViewPlanner(name) {
  originalSetView(name);
  if (name === "planner") {
    requestAnimationFrame(() => drawPlanner());
  }
};

const originalResizePlanner = resizeAndDraw;
resizeAndDraw = function resizePlannerToo() {
  originalResizePlanner();
  drawPlanner();
};

async function initPlanner() {
  if (!plannerEls.canvas) {
    return;
  }
  try {
    const res = await fetch("./samples/planner-pack.json", { cache: "no-store" });
    if (!res.ok) {
      throw new Error("pack missing");
    }
    pack = await res.json();
  } catch {
    return;
  }
  plannerEls.packName.textContent = pack.system.name;
  loadStored();
  bindPlanner();
  refreshPlanner();
  maybePushCompile();
}

initPlanner();
