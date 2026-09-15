const CONNECTOR = "http://127.0.0.1:17300";

const els = {
  canvas: document.getElementById("plan"),
  empty: document.getElementById("empty"),
  legend: document.getElementById("legend"),
  caption: document.getElementById("plan-caption"),
  picker: document.getElementById("plan-picker"),
  source: document.getElementById("source-label"),
  meta: document.getElementById("meta"),
  banner: document.getElementById("banner"),
  body: document.getElementById("bom-body"),
  all: document.getElementById("all-body"),
  families: document.getElementById("families-body"),
  walls: document.getElementById("walls-body"),
  floors: document.getElementById("floors-body"),
  roofs: document.getElementById("roofs-body"),
  takeoffCount: document.getElementById("takeoff-count"),
  views: document.getElementById("views-body"),
  sheets: document.getElementById("sheets-body"),
  healthDot: document.getElementById("health-dot"),
  healthLabel: document.getElementById("health-label"),
};

let payload = null;
let selectedIds = [];
let selectedPlanId = null;
const ctx = els.canvas.getContext("2d");

function showBanner(text, kind) {
  els.banner.textContent = text;
  els.banner.className = `banner show ${kind || ""}`;
}

function hideBanner() {
  els.banner.className = "banner";
}

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function checkHealth() {
  try {
    const res = await fetchWithTimeout(`${CONNECTOR}/health`, 1200);
    if (!res.ok) {
      throw new Error("not ok");
    }
    els.healthDot.className = "dot ok";
    els.healthLabel.textContent = "Revit connector on :17300";
    return true;
  } catch {
    els.healthDot.className = "dot";
    els.healthLabel.textContent = "Revit connector offline";
    return false;
  }
}

async function importRevit() {
  hideBanner();
  const live = await checkHealth();
  if (!live) {
    showBanner("Connector is offline. Open Revit with the add-in loaded, or upload a JSON file.", "error");
    return;
  }
  try {
    const res = await fetchWithTimeout(`${CONNECTOR}/bom`, 90000);
    if (!res.ok) {
      throw new Error(await res.text());
    }
    applyPayload(await res.json(), "Live from Revit");
    const plans = plansOf(payload).length;
    const views = viewsOf(payload).length;
    const sheets = (payload.sheets || []).length;
    const families = (payload.families || []).length;
    const stale = !payload.extractorVersion || Number(payload.extractorVersion) < 4;
    showBanner(
      stale
        ? `All is placed-model takeoff, not the family library. Close Revit completely, reopen, then Import to load the Families catalog. (${plans} plans in this snapshot.)`
        : `Imported ${families} family types, ${plans} plans, ${views} views, ${sheets} sheets. Families is the full library (including unused). All is placed takeoff.`,
      stale ? "" : "ok"
    );
  } catch (err) {
    try {
      const last = await fetchWithTimeout(`${CONNECTOR}/last`, 3000);
      if (last.ok) {
        applyPayload(await last.json(), "Last extract from Revit");
        showBanner("Live extract failed; loaded the last saved snapshot instead.", "ok");
        return;
      }
    } catch {
      // fall through
    }
    showBanner(err.message || "Import failed. Focus the Revit window and try again.", "error");
  }
}

async function loadJson(url, source) {
  hideBanner();
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Could not load ${url}`);
  }
  applyPayload(await res.json(), source);
}

function viewsOf(data) {
  if (data?.views?.length) {
    return data.views;
  }
  return (data?.plans || []).map((plan) => ({
    id: plan.id,
    name: plan.name,
    viewType: plan.viewType,
    viewFamily: plan.discipline || plan.viewType,
    level: plan.level || "",
    scale: "",
    sheetNumber: "",
    isActive: plan.isActive,
  }));
}

function modelLines(data) {
  return (data?.lines || []).filter((line) => {
    const cat = (line.category || "").toLowerCase();
    return cat && !cat.includes("sketch");
  });
}

function modelInstances(data) {
  return (data?.instances || []).filter((row) => {
    const cat = (row.category || "").toLowerCase();
    return cat && !cat.includes("sketch");
  });
}

function plansOf(data) {
  if (data?.plans?.length) {
    return data.plans;
  }
  if (data?.sketchForms?.length) {
    return [{
      id: "active",
      name: data.activeView || "Plan",
      viewType: data.viewType || "FloorPlan",
      discipline: "Floor Plans",
      level: "",
      isActive: true,
      sketchForms: data.sketchForms,
    }];
  }
  return [];
}

function selectedPlan(data) {
  const plans = plansOf(data);
  return plans.find((plan) => plan.id === selectedPlanId) || plans[0] || null;
}

function currentSketch(data) {
  return selectedPlan(data)?.sketchForms || data?.sketchForms || [];
}

function renderPlanPicker(data) {
  const plans = plansOf(data);
  const picker = els.picker;
  picker.innerHTML = "";
  if (plans.length <= 1) {
    picker.hidden = plans.length === 0;
    if (plans.length === 1) {
      const plan = plans[0];
      picker.hidden = false;
      picker.innerHTML = `<option value="${escapeHtml(plan.id)}">${escapeHtml(planLabel(plan))}</option>`;
      picker.value = plan.id;
      selectedPlanId = plan.id;
    }
    return;
  }

  picker.hidden = false;
  const groups = new Map();
  for (const plan of plans) {
    const key = plan.discipline || plan.viewType || "Plans";
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(plan);
  }

  for (const [discipline, group] of groups) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = discipline;
    for (const plan of group) {
      const option = document.createElement("option");
      option.value = plan.id;
      option.textContent = plan.level && plan.level !== plan.name
        ? `${plan.name} (${plan.level})`
        : plan.name;
      optgroup.appendChild(option);
    }
    picker.appendChild(optgroup);
  }

  if (!plans.some((plan) => plan.id === selectedPlanId)) {
    const active = plans.find((plan) => plan.isActive) || plans[0];
    selectedPlanId = active?.id || null;
  }
  picker.value = selectedPlanId;
}

function planLabel(plan) {
  if (!plan) {
    return "no view";
  }
  const disc = plan.discipline ? `${plan.discipline} · ` : "";
  return `${disc}${plan.name}`;
}

function applyPayload(data, source) {
  payload = data;
  selectedIds = [];
  selectedPlanId = null;
  els.source.textContent = source;
  els.empty.hidden = true;
  els.legend.hidden = false;
  renderPlanPicker(data);
  const plan = selectedPlan(data);
  els.caption.textContent = `${data.title || "Untitled"} · ${planLabel(plan)}`;
  renderMeta(data);
  renderBom(data);
  renderSchedules(data);
  resizeAndDraw();
}

function renderMeta(data) {
  const extracted = data.extractedAt
    ? new Date(data.extractedAt).toLocaleString()
    : "—";
  const plan = selectedPlan(data);
  const planCount = plansOf(data).length;
  const viewCount = viewsOf(data).length;
  const sheetCount = (data.sheets || []).length;
  const familyCount = (data.families || []).length;
  els.meta.innerHTML = `
    <div><dt>Document</dt><dd>${escapeHtml(data.title || "—")}</dd></div>
    <div><dt>View</dt><dd>${escapeHtml(planLabel(plan))} (${escapeHtml(plan?.viewType || data.viewType || "")})</dd></div>
    <div><dt>Drawings</dt><dd>${planCount} plans · ${viewCount} views · ${sheetCount} sheets</dd></div>
    <div><dt>Families</dt><dd>${familyCount ? `${familyCount} types in project` : "Restart Revit, then Import"}</dd></div>
    <div><dt>Extracted</dt><dd>${escapeHtml(extracted)}</dd></div>
  `;
}

function formatQty(line) {
  if (line.area != null && line.unit === "m2") {
    return line.area.toFixed(1);
  }
  // Units migration (see UNITS-MIGRATION-PLAN.md): BomLine.Length is now
  // millimetres and BomLine.Unit reports "mm" for the categories that carry a
  // length, not "m" - see BomExtractor.cs's UnitFor().
  if (line.length != null && line.unit === "mm") {
    return Math.round(line.length).toLocaleString();
  }
  return Number(line.quantity ?? 0).toLocaleString();
}

function instancesOf(data, category) {
  const wanted = category.toLowerCase();
  return (data.instances || []).filter((row) => (row.category || "").toLowerCase().includes(wanted));
}

// Units migration (see UNITS-MIGRATION-PLAN.md): every row this formats
// (TakeoffInstance.Length/.Perimeter from the live BOM extractor, and the
// TSP CSV loader's parsed columns below) is already millimetres, so this is
// now a display formatter, not a unit conversion. It used to guess ("> 80 is
// probably already mm") because the BOM payload was metres and a caller
// might pass either; that ambiguity is gone now that every source of these
// fields agrees on millimetres.
function fmtMm(mm) {
  if (mm == null || Number.isNaN(Number(mm))) {
    return "—";
  }
  return Math.round(Number(mm)).toLocaleString();
}

function fmtArea(value) {
  if (value == null) {
    return "—";
  }
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function fmtVol(value) {
  if (value == null) {
    return "—";
  }
  return Number(value).toFixed(2);
}

function groupByModel(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.model || row.type || "(unmarked)";
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(row);
  }
  return groups;
}

function sum(rows, field) {
  let total = 0;
  let any = false;
  for (const row of rows) {
    if (row[field] != null) {
      total += Number(row[field]);
      any = true;
    }
  }
  return any ? total : null;
}

function idsOf(rows) {
  return rows.map((row) => row.elementId).filter(Boolean).join(",");
}

function isSelected(idList) {
  if (!selectedIds.length) {
    return false;
  }
  const set = new Set((idList || "").split(",").filter(Boolean));
  return selectedIds.some((id) => set.has(id));
}

function renderSchedules(data) {
  const walls = instancesOf(data, "wall");
  const floors = instancesOf(data, "floor");
  const roofs = instancesOf(data, "roof");
  const lines = modelLines(data);
  const instances = modelInstances(data);
  const byCat = new Map();
  for (const line of lines) {
    const cat = line.category || "Other";
    byCat.set(cat, (byCat.get(cat) || 0) + Number(line.quantity || 0));
  }
  const summary = [...byCat.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([cat, qty]) => `${Math.round(qty)} ${cat.toLowerCase()}`);
  const familyRows = data.families || [];
  const unused = familyRows.filter((row) => !row.placedCount).length;
  els.takeoffCount.textContent = familyRows.length
    ? `${familyRows.length} family types (${unused} unused) · ${summary.join(" · ") || "no placed takeoff"}`
    : summary.length
      ? `Whole model · ${summary.join(" · ")}`
      : `${walls.length} walls · ${floors.length} floors · ${roofs.length} roofs`;
  renderFamilySchedule(familyRows);
  renderAllSchedule(instances, lines);
  renderWallSchedule(walls);
  renderFloorSchedule(floors);
  renderRoofSchedule(roofs);
  renderViewSchedule(viewsOf(data));
  renderSheetSchedule(data.sheets || []);
}

function renderFamilySchedule(rows) {
  if (!els.families) {
    return;
  }
  if (!rows.length) {
    els.families.innerHTML = `<tr class="muted"><td colspan="5">No family catalog in this extract. Close Revit, reopen, then Import.</td></tr>`;
    return;
  }
  const html = [];
  let lastCat = "";
  for (const row of rows) {
    if (row.category !== lastCat) {
      lastCat = row.category;
      const n = rows.filter((r) => r.category === lastCat).length;
      html.push(`<tr class="group"><td colspan="5">${escapeHtml(lastCat)} (${n})</td></tr>`);
    }
    html.push(`<tr>
      <td>${escapeHtml(row.category || "")}</td>
      <td>${escapeHtml(row.family || "")}</td>
      <td>${escapeHtml(row.type || "")}</td>
      <td>${escapeHtml(row.kind || "")}</td>
      <td class="num">${row.placedCount ?? 0}</td>
    </tr>`);
  }
  els.families.innerHTML = html.join("");
}

function renderAllSchedule(instances, lines) {
  if (!els.all) {
    return;
  }
  if (instances.length > 3 && new Set(instances.map((row) => row.category)).size > 3) {
    const html = [];
    const groups = new Map();
    for (const row of instances) {
      const key = row.category || "Other";
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(row);
    }
    for (const [category, group] of groups) {
      html.push(`<tr class="group"><td colspan="6">${escapeHtml(category)} (${group.length})</td></tr>`);
      for (const row of group) {
        html.push(`<tr data-ids="${escapeHtml(row.elementId || "")}">
          <td>${escapeHtml(row.category || "")}</td>
          <td>${escapeHtml(row.family || "")}</td>
          <td>${escapeHtml(row.type || "")}</td>
          <td class="num">${row.count ?? 1}</td>
          <td>ea</td>
          <td>${escapeHtml(row.level || "")}</td>
        </tr>`);
      }
    }
    els.all.innerHTML = html.join("");
    markSelectedRows(els.all);
    return;
  }
  if (!lines.length) {
    els.all.innerHTML = `<tr class="muted"><td colspan="6">No model quantities.</td></tr>`;
    return;
  }
  const html = [];
  let lastCat = "";
  for (const line of lines) {
    if (line.category !== lastCat) {
      lastCat = line.category;
      html.push(`<tr class="group"><td colspan="6">${escapeHtml(lastCat)}</td></tr>`);
    }
    const ids = (line.elementIds || []).join(",");
    html.push(`<tr data-ids="${escapeHtml(ids)}">
      <td>${escapeHtml(line.category || "")}</td>
      <td>${escapeHtml(line.family || "")}</td>
      <td>${escapeHtml(line.type || "")}</td>
      <td class="num">${formatQty(line)}</td>
      <td>${escapeHtml(line.unit || "")}</td>
      <td></td>
    </tr>`);
  }
  els.all.innerHTML = html.join("");
  markSelectedRows(els.all);
}

function renderViewSchedule(rows) {
  if (!els.views) {
    return;
  }
  if (!rows.length) {
    els.views.innerHTML = `<tr class="muted"><td colspan="6">No views extracted.</td></tr>`;
    return;
  }
  els.views.innerHTML = rows.map((row) => `<tr>
      <td>${escapeHtml(row.name || "")}</td>
      <td>${escapeHtml(row.viewType || "")}</td>
      <td>${escapeHtml(row.viewFamily || "")}</td>
      <td>${escapeHtml(row.level || "")}</td>
      <td>${escapeHtml(row.scale || "—")}</td>
      <td>${escapeHtml(row.sheetNumber || "—")}</td>
    </tr>`).join("");
}

function renderSheetSchedule(rows) {
  if (!els.sheets) {
    return;
  }
  if (!rows.length) {
    els.sheets.innerHTML = `<tr class="muted"><td colspan="4">No sheets extracted.</td></tr>`;
    return;
  }
  els.sheets.innerHTML = rows.map((row) => {
    const title = [row.titleBlockFamily, row.titleBlockType].filter(Boolean).join(" · ");
    const views = (row.views || []).join(", ");
    return `<tr>
      <td>${escapeHtml(row.number || "")}</td>
      <td>${escapeHtml(row.name || "")}</td>
      <td>${escapeHtml(title || "—")}</td>
      <td>${escapeHtml(views || "—")}</td>
    </tr>`;
  }).join("");
}

function renderWallSchedule(rows) {
  if (!rows.length) {
    els.walls.innerHTML = `<tr class="muted"><td colspan="7">No wall instances.</td></tr>`;
    return;
  }
  const html = [];
  for (const [model, group] of groupByModel(rows)) {
    html.push(`<tr class="group" data-ids="${escapeHtml(idsOf(group))}">
      <td colspan="7">${escapeHtml(model)}</td></tr>`);
    for (const row of group) {
      html.push(`<tr data-ids="${escapeHtml(row.elementId || "")}">
        <td class="indent">${escapeHtml(row.model || "")}</td>
        <td>${escapeHtml(row.family || "")}</td>
        <td>${escapeHtml(row.type || "")}</td>
        <td class="num">${fmtMm(row.length)}</td>
        <td class="num">${fmtArea(row.area)}</td>
        <td class="num">${fmtVol(row.volume)}</td>
        <td class="num">${row.count ?? 1}</td>
      </tr>`);
    }
    html.push(`<tr class="subtotal" data-ids="${escapeHtml(idsOf(group))}">
      <td>${escapeHtml(model)}: ${group.length}</td>
      <td></td><td></td>
      <td class="num">${fmtMm(sum(group, "length"))}</td>
      <td class="num">${fmtArea(sum(group, "area"))}</td>
      <td class="num">${fmtVol(sum(group, "volume"))}</td>
      <td class="num">${group.length}</td>
    </tr>`);
  }
  html.push(`<tr class="total">
    <td>Total: ${rows.length}</td>
    <td></td><td></td>
    <td class="num">${fmtMm(sum(rows, "length"))}</td>
    <td class="num">${fmtArea(sum(rows, "area"))}</td>
    <td class="num">${fmtVol(sum(rows, "volume"))}</td>
    <td class="num">${rows.length}</td>
  </tr>`);
  els.walls.innerHTML = html.join("");
  markSelectedRows(els.walls);
}

function renderFloorSchedule(rows) {
  if (!rows.length) {
    els.floors.innerHTML = `<tr class="muted"><td colspan="7">No floor instances.</td></tr>`;
    return;
  }
  const html = [];
  for (const row of rows) {
    const name = `${row.family || ""}: ${row.type || ""}`.replace(/^:\s*|:\s*$/g, "");
    html.push(`<tr data-ids="${escapeHtml(row.elementId || "")}">
      <td>${escapeHtml(row.model || "")}</td>
      <td>${escapeHtml(name || row.type || "")}</td>
      <td class="num">${fmtMm(row.perimeter)}</td>
      <td class="num">${fmtArea(row.area)} m²</td>
      <td class="num">${fmtVol(row.volume)} m³</td>
      <td>${escapeHtml(row.level || "")}</td>
      <td>${escapeHtml(row.phaseCreated || "")}</td>
    </tr>`);
  }
  html.push(`<tr class="total">
    <td>Grand total: ${rows.length}</td>
    <td></td>
    <td class="num">${fmtMm(sum(rows, "perimeter"))}</td>
    <td class="num">${fmtArea(sum(rows, "area"))} m²</td>
    <td class="num">${fmtVol(sum(rows, "volume"))} m³</td>
    <td></td><td></td>
  </tr>`);
  els.floors.innerHTML = html.join("");
  markSelectedRows(els.floors);
}

function renderRoofSchedule(rows) {
  if (!rows.length) {
    els.roofs.innerHTML = `<tr class="muted"><td colspan="6">No roof instances.</td></tr>`;
    return;
  }
  const html = [];
  for (const [model, group] of groupByModel(rows)) {
    html.push(`<tr class="group" data-ids="${escapeHtml(idsOf(group))}">
      <td colspan="6">${escapeHtml(model)}</td></tr>`);
    for (const row of group) {
      html.push(`<tr data-ids="${escapeHtml(row.elementId || "")}">
        <td class="indent">${escapeHtml(row.model || "")}</td>
        <td>${escapeHtml(row.family || "")}</td>
        <td>${escapeHtml(row.type || "")}</td>
        <td class="num">${fmtArea(row.area)}</td>
        <td>${escapeHtml(row.phaseDemolished || "None")}</td>
        <td>${escapeHtml(row.phaseCreated || "")}</td>
      </tr>`);
    }
    html.push(`<tr class="subtotal" data-ids="${escapeHtml(idsOf(group))}">
      <td>${escapeHtml(model)}: ${group.length}</td>
      <td></td><td></td>
      <td class="num">${fmtArea(sum(group, "area"))}</td>
      <td></td><td></td>
    </tr>`);
  }
  html.push(`<tr class="total">
    <td>Total: ${rows.length}</td>
    <td></td><td></td>
    <td class="num">${fmtArea(sum(rows, "area"))}</td>
    <td></td><td></td>
  </tr>`);
  els.roofs.innerHTML = html.join("");
  markSelectedRows(els.roofs);
}

function renderBom(data) {
  const lines = modelLines(data);
  if (!lines.length) {
    els.body.innerHTML = `<tr><td colspan="5">No BOM lines in this payload.</td></tr>`;
    return;
  }
  els.body.innerHTML = lines
    .map((line) => {
      const ids = (line.elementIds || []).join(",");
      const name = `${line.family || ""} / ${line.type || ""}`;
      return `<tr data-ids="${escapeHtml(ids)}">
        <td>${escapeHtml(line.category || "")}</td>
        <td>${escapeHtml(line.model || "")}</td>
        <td>${escapeHtml(name)}</td>
        <td class="num">${formatQty(line)}</td>
        <td>${escapeHtml(line.unit || "")}</td>
      </tr>`;
    })
    .join("");
  markSelectedRows(els.body);
}

function markSelectedRows(tbody) {
  for (const tr of tbody.querySelectorAll("tr[data-ids]")) {
    tr.classList.toggle("selected", isSelected(tr.dataset.ids));
  }
}

function collectPoints(data) {
  const points = [];
  for (const form of currentSketch(data)) {
    for (const loop of form.profileLoops || []) {
      for (const curve of loop.curves || []) {
        if (curve.start) {
          points.push(curve.start);
        }
        if (curve.end) {
          points.push(curve.end);
        }
      }
    }
  }
  return points;
}

function fitTransform(points, width, height, pad) {
  if (!points.length) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const spanX = Math.max(maxX - minX, 0.01);
  const spanY = Math.max(maxY - minY, 0.01);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const ox = (width - spanX * scale) / 2 - minX * scale;
  const oy = (height - spanY * scale) / 2 + maxY * scale;
  return {
    toScreen(x, y) {
      return [ox + x * scale, oy - y * scale];
    },
    scale,
  };
}

function formStyle(form) {
  const kind = (form.kind || form.name || "").toLowerCase();
  if (kind.includes("room")) {
    return { fill: "rgba(178, 69, 30, 0.10)", stroke: "rgba(178, 69, 30, 0.55)", width: 1.25, label: true };
  }
  if (kind.includes("window")) {
    return { fill: "transparent", stroke: "#3a5f7a", width: 2, label: false };
  }
  if (kind.includes("opening") || kind.includes("door")) {
    return { fill: "transparent", stroke: "#b2451e", width: 2.25, label: false };
  }
  if (kind.includes("wall") || kind.includes("envelope") || kind.includes("extrusion")) {
    return { fill: "transparent", stroke: "#1a1612", width: 2.5, label: false };
  }
  return { fill: "rgba(36, 48, 68, 0.06)", stroke: "#243044", width: 1.5, label: true };
}

function drawArcApprox(context, transform, start, end) {
  const [x1, y1] = transform.toScreen(start[0], start[1]);
  const [x2, y2] = transform.toScreen(end[0], end[1]);
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const cx = mx - dy * 0.5;
  const cy = my + dx * 0.5;
  context.quadraticCurveTo(cx, cy, x2, y2);
}

function centroid(loop, transform) {
  const pts = [];
  for (const curve of loop.curves || []) {
    if (curve.start) {
      pts.push(transform.toScreen(curve.start[0], curve.start[1]));
    }
  }
  if (!pts.length) {
    return null;
  }
  const x = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const y = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return [x, y];
}

function drawPlan() {
  const { canvas } = els;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  if (!payload) {
    return;
  }

  const points = collectPoints(payload);
  const transform = fitTransform(points, width, height, 48);
  if (!transform) {
    els.empty.hidden = false;
    els.empty.querySelector("h3").textContent = "No sketch geometry";
    els.empty.querySelector("p").textContent =
      "This extract has takeoff rows but no profile loops. Wall and room outlines will draw here.";
    return;
  }
  els.empty.hidden = true;

  const selected = new Set(selectedIds);
  for (const form of currentSketch(payload)) {
    const style = formStyle(form);
    const highlighted = selected.has(String(form.elementId));
    for (const loop of form.profileLoops || []) {
      const curves = loop.curves || [];
      ctx.beginPath();
      let started = false;
      for (const curve of curves) {
        if (!curve.start || !curve.end) {
          continue;
        }
        const [sx, sy] = transform.toScreen(curve.start[0], curve.start[1]);
        if (!started) {
          ctx.moveTo(sx, sy);
          started = true;
        }
        if ((curve.kind || "").toLowerCase() === "arc") {
          drawArcApprox(ctx, transform, curve.start, curve.end);
        } else {
          const [ex, ey] = transform.toScreen(curve.end[0], curve.end[1]);
          ctx.lineTo(ex, ey);
        }
      }
      if (shouldClose(form, curves)) {
        ctx.closePath();
      }
      if (style.fill !== "transparent") {
        ctx.fillStyle = highlighted ? "rgba(178, 69, 30, 0.22)" : style.fill;
        ctx.fill();
      }
      ctx.strokeStyle = highlighted ? "#8d3416" : style.stroke;
      ctx.lineWidth = highlighted ? style.width + 1.5 : style.width;
      ctx.stroke();

      if (style.label && form.name) {
        const c = centroid(loop, transform);
        if (c) {
          ctx.fillStyle = "#5c5348";
          ctx.font = "500 13px Fraunces, Georgia, serif";
          ctx.textAlign = "center";
          ctx.fillText(form.name, c[0], c[1]);
        }
      }
    }
  }
}

function shouldClose(form, curves) {
  const kind = (form.kind || form.name || "").toLowerCase();
  if (kind.includes("opening") || kind.includes("door") || kind.includes("window") || kind.includes("wall")) {
    return false;
  }
  return curves.length >= 3;
}

function resizeAndDraw() {
  drawPlan();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c));
}

function parseNumber(value) {
  if (value == null || value === "") {
    return null;
  }
  const n = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function isSummaryRow(model, family) {
  const m = (model || "").toLowerCase();
  return m.includes("total") || (model.includes(":") && !family);
}

function parseTspCsv(text, fileName) {
  const rows = parseCsv(text);
  const blob = `${fileName}\n${rows.slice(0, 3).flat().join(" ")}`.toLowerCase();
  if (blob.includes("floor")) {
    return { category: "Floors", instances: parseFloorCsv(rows) };
  }
  if (blob.includes("roof")) {
    return { category: "Roofs", instances: parseRoofCsv(rows) };
  }
  return { category: "Walls", instances: parseWallCsv(rows) };
}

function parseWallCsv(rows) {
  const instances = [];
  let id = 1;
  for (const cols of rows) {
    const model = cols[0] || "";
    const family = cols[1] || "";
    const type = cols[2] || "";
    if (!model || model.toLowerCase().includes("schedule") || model === "Model") {
      continue;
    }
    if (!family || isSummaryRow(model, family)) {
      continue;
    }
    const lengthMm = parseNumber(cols[3]);
    instances.push({
      category: "Walls",
      model,
      family,
      type,
      elementId: `W${id}`,
      count: parseNumber(cols[6]) ?? 1,
      // Millimetres, same convention as TakeoffInstance.Length from the live
      // BOM extractor (see UNITS-MIGRATION-PLAN.md) - the CSV column already
      // states mm, so no conversion here now.
      length: lengthMm,
      area: parseNumber(cols[4]),
      volume: parseNumber(cols[5]),
    });
    id += 1;
  }
  return instances;
}

function parseFloorCsv(rows) {
  const instances = [];
  let id = 1;
  for (const cols of rows) {
    const model = cols[0] || "";
    const familyType = cols[1] || "";
    if (!model || model.toLowerCase().includes("schedule") || model === "Model" || model.toLowerCase().includes("total")) {
      continue;
    }
    if (!familyType) {
      continue;
    }
    const [family, type] = familyType.includes(":")
      ? familyType.split(":").map((s) => s.trim())
      : ["Floor", familyType];
    const periMm = parseNumber(cols[2]);
    instances.push({
      category: "Floors",
      model,
      family,
      type,
      elementId: `F${id}`,
      count: 1,
      // Millimetres, same convention as TakeoffInstance.Perimeter - see the
      // note on parseWallCsv's `length` above.
      perimeter: periMm,
      area: parseNumber(cols[3]),
      volume: parseNumber(cols[4]),
      level: cols[5] || "",
      phaseCreated: cols[6] || "",
    });
    id += 1;
  }
  return instances;
}

function parseRoofCsv(rows) {
  const instances = [];
  let id = 1;
  for (const cols of rows) {
    const model = cols[0] || "";
    const family = cols[1] || "";
    const type = cols[2] || "";
    if (!model || model.toLowerCase().includes("schedule") || model === "Model") {
      continue;
    }
    if (!family || isSummaryRow(model, family)) {
      continue;
    }
    instances.push({
      category: "Roofs",
      model,
      family,
      type,
      elementId: `R${id}`,
      count: 1,
      area: parseNumber(cols[3]),
      phaseDemolished: cols[4] || "",
      phaseCreated: cols[5] || "",
    });
    id += 1;
  }
  return instances;
}

function mergeInstances(existing, incoming, category) {
  const keep = (existing || []).filter((row) => !(row.category || "").toLowerCase().includes(category.toLowerCase().replace(/s$/, "")));
  return [...keep, ...incoming];
}

function linesFromInstances(instances) {
  const groups = new Map();
  for (const row of instances) {
    const key = `${row.category}|${row.model}|${row.family}|${row.type}`;
    if (!groups.has(key)) {
      groups.set(key, {
        category: row.category,
        model: row.model,
        family: row.family,
        type: row.type,
        quantity: 0,
        // "mm" for Walls to match formatQty()'s check and BomExtractor.cs's
        // UnitFor() - see the units migration note on parseWallCsv above.
        unit: row.category === "Walls" ? "mm" : "m2",
        length: 0,
        area: 0,
        volume: 0,
        elementIds: [],
      });
    }
    const line = groups.get(key);
    line.quantity += row.count ?? 1;
    line.length += row.length ?? 0;
    line.area += row.area ?? 0;
    line.volume += row.volume ?? 0;
    if (row.elementId) {
      line.elementIds.push(row.elementId);
    }
  }
  return [...groups.values()];
}

async function loadTspSchedules() {
  hideBanner();
  const files = [
    ["./samples/tsp-wall-schedule.csv", "Walls"],
    ["./samples/tsp-floor-schedule.csv", "Floors"],
    ["./samples/tsp-roof-schedule.csv", "Roofs"],
  ];
  let instances = [];
  for (const [url] of files) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Could not load ${url}`);
    }
    const parsed = parseTspCsv(await res.text(), url);
    instances = mergeInstances(instances, parsed.instances, parsed.category);
  }
  applyPayload(
    {
      documentKind: "Project",
      title: "TSP schedules",
      activeView: "Exported schedules",
      viewType: "Schedule",
      extractedAt: new Date().toISOString(),
      units: "millimeters (lengths, perimeters) / square meters / cubic meters",
      lines: linesFromInstances(instances),
      instances,
      sketchForms: [],
    },
    "TSP wall / floor / roof CSVs"
  );
  showBanner("Loaded TSP wall, floor, and roof schedules (quantities only — no plan sketch).", "ok");
}

function selectFromRow(row) {
  if (!row || row.classList.contains("muted") || row.classList.contains("total")) {
    return;
  }
  const ids = (row.dataset.ids || "").split(",").filter(Boolean);
  selectedIds = ids;
  for (const tbody of [els.all, els.walls, els.floors, els.roofs, els.body].filter(Boolean)) {
    markSelectedRows(tbody);
  }
  drawPlan();
}

document.getElementById("btn-revit").addEventListener("click", importRevit);
els.picker.addEventListener("change", () => {
  selectedPlanId = els.picker.value;
  if (!payload) {
    return;
  }
  const plan = selectedPlan(payload);
  els.caption.textContent = `${payload.title || "Untitled"} · ${planLabel(plan)}`;
  renderMeta(payload);
  resizeAndDraw();
});
document.getElementById("btn-sample").addEventListener("click", async () => {
  await loadJson("./samples/floor-plan.json", "Sample apartment (mock)");
  showBanner("Sample floor plan with TSP-style wall, floor, and roof takeoff.", "ok");
});
document.getElementById("btn-tsp").addEventListener("click", async () => {
  try {
    await loadTspSchedules();
  } catch (err) {
    showBanner(err.message, "error");
  }
});
document.getElementById("btn-extract").addEventListener("click", async () => {
  try {
    await loadJson("./samples/revit-extract.json", "Saved family extract");
    showBanner("Loaded the last saved Revit family extract (extrusion profiles).", "ok");
  } catch (err) {
    showBanner(err.message, "error");
  }
});
document.getElementById("file-json").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  try {
    const text = await file.text();
    if (file.name.toLowerCase().endsWith(".csv")) {
      const parsed = parseTspCsv(text, file.name);
      const existing = payload?.instances || [];
      const instances = mergeInstances(existing, parsed.instances, parsed.category);
      applyPayload(
        {
          ...(payload || {}),
          title: payload?.title || file.name,
          documentKind: payload?.documentKind || "Project",
          lines: linesFromInstances(instances),
          instances,
          sketchForms: payload?.sketchForms || [],
        },
        `Uploaded · ${file.name}`
      );
      showBanner(`Merged ${parsed.category.toLowerCase()} from ${file.name}.`, "ok");
    } else {
      applyPayload(JSON.parse(text), `Uploaded · ${file.name}`);
      showBanner(`Loaded ${file.name}.`, "ok");
    }
  } catch {
    showBanner("That file is not valid BOM JSON or a TSP schedule CSV.", "error");
  }
});

for (const tbody of [els.all, els.walls, els.floors, els.roofs, els.body].filter(Boolean)) {
  tbody.addEventListener("click", (event) => {
    selectFromRow(event.target.closest("tr"));
  });
}

document.querySelectorAll("[data-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    const name = tab.dataset.tab;
    document.querySelectorAll("[data-tab]").forEach((btn) => {
      const on = btn === tab;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll(".takeoff-table").forEach((panel) => {
      panel.hidden = panel.dataset.panel !== name;
    });
  });
});

const loadMenu = document.getElementById("load-menu");
loadMenu?.querySelector(".menu-list")?.addEventListener("click", (event) => {
  if (event.target.closest("button")) {
    loadMenu.removeAttribute("open");
  }
});
document.addEventListener("click", (event) => {
  if (loadMenu?.open && !loadMenu.contains(event.target)) {
    loadMenu.removeAttribute("open");
  }
});

window.addEventListener("resize", resizeAndDraw);

checkHealth();
setInterval(checkHealth, 5000);
loadJson("./samples/floor-plan.json", "Sample apartment (mock)").catch(() => {
  els.empty.hidden = false;
});
