const catalog = { currency: "ZAR", symbol: "R", note: "", rates: [] };
let baseline = null;
let diffState = { added: new Set(), removed: new Set() };
const massCam = { yaw: 0.85, pitch: 0.55, scale: 18 };
let massDrag = null;
let massStatusFilter = "both";

const extraEls = {
  mass: document.getElementById("mass"),
  massEmpty: document.getElementById("mass-empty"),
  massCaption: document.getElementById("mass-caption"),
  storeys: document.getElementById("storey-list"),
  costBody: document.getElementById("cost-body"),
  costTotal: document.getElementById("cost-total"),
  costNote: document.getElementById("cost-note"),
  rateBody: document.getElementById("rate-body"),
  compareBody: document.getElementById("compare-body"),
  compareCaption: document.getElementById("compare-caption"),
  compareSummary: document.getElementById("compare-summary"),
};

const massCtx = extraEls.mass.getContext("2d");

async function loadCatalog() {
  try {
    const res = await fetch("./samples/tsp-rates.json", { cache: "no-store" });
    if (!res.ok) {
      return;
    }
    Object.assign(catalog, await res.json());
    renderRateBook();
  } catch {
    // keep empty catalog
  }
}

function money(value) {
  const n = Number(value) || 0;
  const abs = Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const signed = n < 0 ? `-${catalog.symbol}${abs}` : `${catalog.symbol}${abs}`;
  return signed;
}

function findRate(row) {
  const model = (row.model || "").trim();
  if (model) {
    const hit = catalog.rates.find((rate) => rate.model === model);
    if (hit) {
      return hit;
    }
  }
  const category = (row.category || "").trim();
  return catalog.rates.find((rate) => !rate.model && rate.category === category) || null;
}

function qtyFor(row, unit) {
  if (unit === "m3") {
    return row.volume ?? 0;
  }
  if (unit === "m2") {
    return row.area ?? 0;
  }
  if (unit === "m") {
    return row.length ?? 0;
  }
  return row.count ?? row.quantity ?? 0;
}

function fmtQtyUnit(qty, unit) {
  if (unit === "ea") {
    return String(qty);
  }
  const n = Number(qty) || 0;
  return `${n.toFixed(n >= 20 ? 0 : 2)} ${unit}`;
}

function pricedGroups(data) {
  const rows = [...(data?.instances || [])];
  if (!rows.length) {
    for (const line of data?.lines || []) {
      rows.push({
        category: line.category,
        model: line.model,
        family: line.family,
        type: line.type,
        count: line.quantity,
        length: line.length,
        area: line.area,
        volume: line.volume,
        elementId: (line.elementIds || [])[0],
      });
    }
  }
  const groups = new Map();
  for (const row of rows) {
    const rate = findRate(row);
    const key = rate?.model || rate?.category || row.model || row.category || "unpriced";
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        model: row.model || rate?.model || "",
        category: row.category || "",
        description: rate?.description || `${row.family || ""} ${row.type || ""}`.trim(),
        unit: rate?.unit || row.unit || "ea",
        rate: rate?.rate ?? null,
        qty: 0,
        amount: 0,
        priced: Boolean(rate),
        ids: [],
      });
    }
    const group = groups.get(key);
    const qty = qtyFor(row, group.unit);
    group.qty += qty;
    if (rate) {
      group.amount += qty * rate.rate;
    }
    if (row.elementId) {
      group.ids.push(row.elementId);
    }
    if (row.elementIds) {
      group.ids.push(...row.elementIds);
    }
  }
  return [...groups.values()];
}

function estimateTotal(data) {
  return pricedGroups(data).reduce((sum, group) => sum + group.amount, 0);
}

function renderRateBook() {
  extraEls.costNote.textContent = catalog.note || "Catalog";
  extraEls.rateBody.innerHTML = (catalog.rates || [])
    .map((rate) => `<tr>
      <td>${escapeHtml(rate.model || rate.category || "")}</td>
      <td>${escapeHtml(rate.unit || "")}</td>
      <td class="num">${money(rate.rate)}</td>
    </tr>`)
    .join("");
}

function renderCost() {
  if (!payload) {
    extraEls.costBody.innerHTML = `<tr class="muted"><td colspan="6">Load a model to price TSP codes against the catalog.</td></tr>`;
    extraEls.costTotal.textContent = "No catalog";
    return;
  }
  const groups = pricedGroups(payload);
  const total = groups.reduce((sum, group) => sum + group.amount, 0);
  extraEls.costTotal.textContent = `Estimate ${money(total)}`;
  extraEls.costBody.innerHTML = groups
    .map((group) => `<tr data-ids="${escapeHtml(group.ids.join(","))}">
      <td>${escapeHtml(group.model || group.category)}</td>
      <td class="wrap">${escapeHtml(group.description)}</td>
      <td class="num">${fmtQtyUnit(group.qty, group.unit)}</td>
      <td>${escapeHtml(group.unit)}</td>
      <td class="num">${group.priced ? money(group.rate) : "—"}</td>
      <td class="num">${group.priced ? money(group.amount) : "—"}</td>
    </tr>`)
    .join("") + `<tr class="total"><td colspan="5">Total</td><td class="num">${money(total)}</td></tr>`;
}

function instanceMap(data) {
  const map = new Map();
  for (const row of data?.instances || []) {
    map.set(String(row.elementId), row);
  }
  return map;
}

function rowKey(row) {
  return String(row.elementId || `${row.model}|${row.family}|${row.type}|${row.length}|${row.area}`);
}

function qtySignature(row) {
  const rate = findRate(row);
  const unit = rate?.unit || "ea";
  return { unit, qty: qtyFor(row, unit), rate };
}

function diffExtracts(before, after) {
  const a = instanceMap(before);
  const b = instanceMap(after);
  const added = [];
  const removed = [];
  const changed = [];
  for (const [id, row] of b) {
    if (!a.has(id)) {
      added.push(row);
    } else {
      const prev = a.get(id);
      const qa = qtySignature(prev);
      const qb = qtySignature(row);
      if (Math.abs(qa.qty - qb.qty) > 0.001) {
        changed.push({ before: prev, after: row, delta: qb.qty - qa.qty, unit: qb.unit });
      }
    }
  }
  for (const [id, row] of a) {
    if (!b.has(id)) {
      removed.push(row);
    }
  }
  return { added, removed, changed };
}

function costOfRows(rows, sign) {
  let total = 0;
  for (const row of rows) {
    const rate = findRate(row);
    if (!rate) {
      continue;
    }
    total += sign * qtyFor(row, rate.unit) * rate.rate;
  }
  return total;
}

function renderCompare() {
  if (!baseline || !payload) {
    extraEls.compareCaption.textContent = "Set a baseline, then import again";
    extraEls.compareBody.innerHTML = `<tr class="muted"><td colspan="5">No baseline yet.</td></tr>`;
    extraEls.compareSummary.innerHTML = `
      <div><dt>Added</dt><dd>—</dd></div>
      <div><dt>Removed</dt><dd>—</dd></div>
      <div><dt>Qty change</dt><dd>—</dd></div>
      <div><dt>Cost delta</dt><dd>—</dd></div>`;
    diffState = { added: new Set(), removed: new Set() };
    return;
  }

  const diff = diffExtracts(baseline, payload);
  diffState = {
    added: new Set(diff.added.map((row) => String(row.elementId))),
    removed: new Set(diff.removed.map((row) => String(row.elementId))),
  };
    const addCost = costOfRows(diff.added, 1);
    const removeCost = costOfRows(diff.removed, -1);
    const changeCost = diff.changed.reduce((sum, item) => {
      const rate = findRate(item.after);
      return rate ? sum + item.delta * rate.rate : sum;
    }, 0);
    const delta = addCost + removeCost + changeCost;

  extraEls.compareCaption.textContent =
    `${baseline.title || "Baseline"} → ${payload.title || "Current"}`;
  extraEls.compareSummary.innerHTML = `
    <div><dt>Added</dt><dd>${diff.added.length}</dd></div>
    <div><dt>Removed</dt><dd>${diff.removed.length}</dd></div>
    <div><dt>Changed</dt><dd>${diff.changed.length}</dd></div>
    <div><dt>Cost delta</dt><dd>${money(delta)}</dd></div>`;

  const html = [];
  for (const row of diff.added) {
    const rate = findRate(row);
    const amount = rate ? qtyFor(row, rate.unit) * rate.rate : 0;
    html.push(`<tr class="added" data-ids="${escapeHtml(row.elementId || "")}">
      <td>Added</td><td>${escapeHtml(row.model || "")}</td>
      <td>${escapeHtml(row.category || "")}</td>
      <td class="num">${rate ? fmtQtyUnit(qtyFor(row, rate.unit), rate.unit) : (row.count ?? 1)}</td>
      <td class="num">${money(amount)}</td></tr>`);
  }
  for (const row of diff.removed) {
    const rate = findRate(row);
    const amount = rate ? -qtyFor(row, rate.unit) * rate.rate : 0;
    html.push(`<tr class="removed" data-ids="${escapeHtml(row.elementId || "")}">
      <td>Removed</td><td>${escapeHtml(row.model || "")}</td>
      <td>${escapeHtml(row.category || "")}</td>
      <td class="num">${rate ? fmtQtyUnit(-qtyFor(row, rate.unit), rate.unit) : -1}</td>
      <td class="num">${money(amount)}</td></tr>`);
  }
  for (const item of diff.changed) {
    const rate = findRate(item.after);
    const amount = rate ? item.delta * rate.rate : 0;
    html.push(`<tr class="changed" data-ids="${escapeHtml(item.after.elementId || "")}">
      <td>Changed</td><td>${escapeHtml(item.after.model || "")}</td>
      <td>${escapeHtml(item.after.category || "")}</td>
      <td class="num">${rate ? fmtQtyUnit(item.delta, rate.unit) : item.delta}</td>
      <td class="num">${money(amount)}</td></tr>`);
  }
  if (!html.length) {
    html.push(`<tr class="muted"><td colspan="5">No instance differences.</td></tr>`);
  }
  extraEls.compareBody.innerHTML = html.join("");
}

function massingPlans(data) {
  const plans = plansOf(data).filter((plan) => (plan.discipline || "") !== "Ceiling Plans");
  const floor = plans.filter((plan) => (plan.viewType || "") === "FloorPlan" || (plan.discipline || "") === "Floor Plans");
  const source = floor.length ? floor : plans;
  const unique = [];
  const seen = new Set();
  for (const plan of source) {
    const key = `${plan.elevation ?? plan.level ?? plan.name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(plan);
  }
  return unique;
}

function loopPoints(loop) {
  const pts = [];
  for (const curve of loop.curves || []) {
    if (curve.start) {
      pts.push([curve.start[0], curve.start[1]]);
    }
  }
  return pts;
}

function facesFromMeshes(meshes) {
  const faces = [];
  for (const mesh of meshes) {
    const pos = mesh.positions || [];
    const idx = mesh.indices || [];
    const isGlass = /window/i.test(mesh.category || "");
    const fill = hexToRgba(mesh.fill || "#c4a574", isGlass ? 0.4 : 0.94);
    const stroke = mesh.stroke || "#8d7349";
    for (let i = 0; i + 2 < idx.length; i += 3) {
      const a = idx[i] * 3;
      const b = idx[i + 1] * 3;
      const c = idx[i + 2] * 3;
      if (c + 2 >= pos.length) {
        continue;
      }
      faces.push({
        pts: [
          [pos[a], pos[a + 1], pos[a + 2]],
          [pos[b], pos[b + 1], pos[b + 2]],
          [pos[c], pos[c + 1], pos[c + 2]],
        ],
        id: mesh.elementId,
        fill,
        stroke,
        kind: (mesh.category || "").toLowerCase(),
        status: mesh.status || "existing",
      });
    }
  }
  return faces;
}

function hexToRgba(hex, alpha) {
  const raw = hex.replace("#", "");
  if (raw.length !== 6) {
    return hex;
  }
  const n = parseInt(raw, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function resolvedStatus(status) {
  if (status === "existing" || status === "planned" || status === "mixed") {
    return status;
  }
  return "existing";
}

function statusVisible(status) {
  const s = resolvedStatus(status);
  if (massStatusFilter === "both") {
    return true;
  }
  if (s === "mixed") {
    return true;
  }
  return s === massStatusFilter;
}

function isOpeningForm(form) {
  const kind = (form.kind || "").toLowerCase();
  return kind.includes("window") || kind.includes("opening") || kind.includes("door");
}

function openingLine(form) {
  for (const loop of form.profileLoops || []) {
    for (const curve of loop.curves || []) {
      if (!curve.start || !curve.end) {
        continue;
      }
      if ((curve.kind || "Line").toLowerCase() === "arc") {
        continue;
      }
      return { start: curve.start, end: curve.end };
    }
  }
  return null;
}

function parseOpeningSize(name) {
  const match = String(name || "").match(/(\d+(?:\.\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)/i);
  if (!match) {
    return {};
  }
  const a = Number(match[1]);
  const b = Number(match[2]);
  const heightMm = a >= 100 && b >= 100 ? b : NaN;
  if (Number.isFinite(heightMm) && heightMm > 0) {
    return { height: heightMm / 1000 };
  }
  return {};
}

function openingMetrics(form) {
  const kind = (form.kind || "").toLowerCase();
  const isWindow = kind.includes("window");
  const parsed = parseOpeningSize(form.name);
  const height = Number(form.depth) > 0
    ? Number(form.depth)
    : (parsed.height || (isWindow ? 1.2 : 2.1));
  const sill = Number.isFinite(Number(form.sill))
    ? Number(form.sill)
    : (isWindow ? 0.9 : 0);
  return { isWindow, height, sill, head: sill + height };
}

function collectFaces(data) {
  if (data?.meshes?.length) {
    const faces = facesFromMeshes(data.meshes).filter((face) => statusVisible(face.status));
    const skip = new Set(data.meshes.map((mesh) => String(mesh.elementId || "")));
    overlaySketchOpenings(faces, data, skip);
    return faces;
  }

  const faces = [];
  const plans = massingPlans(data);
  const family = (data.sketchForms || []).filter((form) =>
    (form.kind || "").toLowerCase().includes("extrusion") && (form.profileLoops || []).length);

  if (family.length && !plans.some((plan) => (plan.sketchForms || []).some((f) => (f.kind || "").includes("Wall") || (f.kind || "").includes("Room")))) {
    for (const form of family) {
      pushExtrusionFaces(faces, form, 0, form.elementId, form.status);
    }
    return faces;
  }

  if (!plans.length) {
    pushPlanForms(faces, data.sketchForms || [], 0);
    return faces;
  }

  let index = 0;
  for (const plan of plans) {
    const z0 = Number.isFinite(plan.elevation) ? plan.elevation : index * 3.15;
    pushPlanForms(faces, plan.sketchForms || [], z0);
    index += 1;
  }
  return faces;
}

function overlaySketchOpenings(faces, data, skipIds) {
  const plans = massingPlans(data);
  if (plans.length) {
    let index = 0;
    for (const plan of plans) {
      const z0 = Number.isFinite(plan.elevation) ? plan.elevation : index * 3.15;
      for (const form of plan.sketchForms || []) {
        if (!isOpeningForm(form) || skipIds.has(String(form.elementId || "")) || !statusVisible(form.status)) {
          continue;
        }
        pushOpeningFaces(faces, form, z0, form.elementId, form.status);
      }
      index += 1;
    }
    return;
  }
  for (const form of data.sketchForms || []) {
    if (!isOpeningForm(form) || skipIds.has(String(form.elementId || "")) || !statusVisible(form.status)) {
      continue;
    }
    pushOpeningFaces(faces, form, 0, form.elementId, form.status);
  }
}

function pushPlanForms(faces, forms, z0) {
  const visible = (forms || []).filter((form) => statusVisible(form.status));
  const openings = visible.filter(isOpeningForm);
  for (const form of visible) {
    pushPlanFormFaces(faces, form, z0, form.elementId, openings);
  }
}

function pushPlanFormFaces(faces, form, z0, id, openings = []) {
  const kind = (form.kind || "").toLowerCase();
  const status = form.status || "existing";
  if (kind.includes("room")) {
    const height = form.depth && form.depth < 1 ? 0.2 : 0.18;
    for (const loop of form.profileLoops || []) {
      const pts = loopPoints(loop);
      if (pts.length >= 3) {
        faces.push({ pts: pts.map(([x, y]) => [x, y, z0 + height]), id, fill: "rgba(178,69,30,0.28)", stroke: "rgba(178,69,30,0.7)", kind: "room", status });
      }
    }
    return;
  }
  if (kind.includes("wall")) {
    const height = form.depth || 2.8;
    const thick = Number(form.thickness) > 0
      ? Number(form.thickness)
      : (/110/.test(form.name || "") ? 0.11 : 0.22);
    for (const loop of form.profileLoops || []) {
      for (const curve of loop.curves || []) {
        if (!curve.start || !curve.end) {
          continue;
        }
        pushWallBox(faces, curve.start, curve.end, z0, height, thick, id, openings, status);
      }
    }
    return;
  }
  if (isOpeningForm(form)) {
    pushOpeningFaces(faces, form, z0, id, status);
    return;
  }
  if (kind.includes("roof")) {
    const elev = Number(form.elevation);
    const base = z0 + (Number.isFinite(elev) ? elev : 0);
    pushRoofFaces(faces, form, base, id, status);
    return;
  }
  if (kind.includes("floor") || kind.includes("slab") || kind.includes("extrusion")) {
    const elev = Number(form.elevation);
    const base = z0 + (Number.isFinite(elev) ? elev : 0);
    pushExtrusionFaces(faces, form, base, id, status);
  }
}

function openingsOnWall(start, end, openings) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const hits = [];
  for (const form of openings) {
    const line = openingLine(form);
    if (!line) {
      continue;
    }
    const t0 = (line.start[0] - start[0]) * ux + (line.start[1] - start[1]) * uy;
    const t1 = (line.end[0] - start[0]) * ux + (line.end[1] - start[1]) * uy;
    const d0 = Math.abs((line.start[0] - start[0]) * -uy + (line.start[1] - start[1]) * ux);
    const d1 = Math.abs((line.end[0] - start[0]) * -uy + (line.end[1] - start[1]) * ux);
    if (d0 > 0.4 || d1 > 0.4) {
      continue;
    }
    const a = Math.min(t0, t1);
    const b = Math.max(t0, t1);
    if (b < 0.02 || a > len - 0.02 || b - a < 0.2) {
      continue;
    }
    hits.push({ t0: Math.max(0, a), t1: Math.min(len, b), form, ...openingMetrics(form) });
  }
  hits.sort((left, right) => left.t0 - right.t0);
  return hits;
}

function pushWallBox(faces, start, end, z0, height, thick, id, openings = [], status = "existing") {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const along = (t) => [start[0] + ux * t, start[1] + uy * t];
  const hits = openingsOnWall(start, end, openings);
  if (!hits.length) {
    pushWallPrism(faces, start, end, z0, z0 + height, thick, id, "wall", "rgba(26,22,18,0.45)", "#1a1612", status);
    return;
  }
  let cursor = 0;
  for (const hit of hits) {
    if (hit.t0 - cursor > 0.02) {
      pushWallPrism(faces, along(cursor), along(hit.t0), z0, z0 + height, thick, id, "wall", "rgba(26,22,18,0.45)", "#1a1612", status);
    }
    if (hit.sill > 0.02) {
      pushWallPrism(faces, along(hit.t0), along(hit.t1), z0, z0 + hit.sill, thick, id, "wall", "rgba(26,22,18,0.45)", "#1a1612", status);
    }
    if (hit.head < height - 0.02) {
      pushWallPrism(faces, along(hit.t0), along(hit.t1), z0 + hit.head, z0 + height, thick, id, "wall", "rgba(26,22,18,0.45)", "#1a1612", status);
    }
    cursor = Math.max(cursor, hit.t1);
  }
  if (len - cursor > 0.02) {
    pushWallPrism(faces, along(cursor), along(len), z0, z0 + height, thick, id, "wall", "rgba(26,22,18,0.45)", "#1a1612", status);
  }
}

function pushOpeningFaces(faces, form, z0, id, status = "existing") {
  const line = openingLine(form);
  if (!line) {
    return;
  }
  const metrics = openingMetrics(form);
  let thick = 0.08;
  const loops = (form.profileLoops || []).filter((loop) => (loop.curves || []).some((c) => c.start && c.end && (c.kind || "Line").toLowerCase() !== "arc"));
  if (loops.length >= 2) {
    const a = loops[0].curves[0];
    const b = loops[1].curves[0];
    if (a?.start && b?.start) {
      thick = Math.max(0.06, Math.hypot(b.start[0] - a.start[0], b.start[1] - a.start[1]));
    }
  }
  const fill = metrics.isWindow ? "rgba(90,150,180,0.45)" : "rgba(139,90,43,0.92)";
  const stroke = metrics.isWindow ? "#3a5f7a" : "#5c3b1a";
  const kind = metrics.isWindow ? "window" : "door";
  pushWallPrism(faces, line.start, line.end, z0 + metrics.sill, z0 + metrics.head, thick, id, kind, fill, stroke, status);
}

function pushWallPrism(faces, start, end, z0, z1, thick, id, kind, fill, stroke, status = "existing") {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (thick / 2);
  const ny = (dx / len) * (thick / 2);
  const p = [
    [start[0] + nx, start[1] + ny, z0],
    [end[0] + nx, end[1] + ny, z0],
    [end[0] - nx, end[1] - ny, z0],
    [start[0] - nx, start[1] - ny, z0],
  ];
  const q = p.map(([x, y]) => [x, y, z1]);
  const quads = [
    [q[0], q[1], q[2], q[3]],
    [p[0], p[1], q[1], q[0]],
    [p[1], p[2], q[2], q[1]],
    [p[2], p[3], q[3], q[2]],
    [p[3], p[0], q[0], q[3]],
  ];
  for (const quad of quads) {
    faces.push({ pts: quad, id, fill, stroke, kind, status });
  }
}

function pushExtrusionFaces(faces, form, z0, id, status = "existing") {
  const depth = form.depth || 0.4;
  for (const loop of form.profileLoops || []) {
    const pts = loopPoints(loop);
    if (pts.length < 3) {
      continue;
    }
    faces.push({
      pts: pts.map(([x, y]) => [x, y, z0 + depth]),
      id,
      fill: form.isSolid === false ? "rgba(58,95,122,0.2)" : "rgba(36,48,68,0.35)",
      stroke: "#243044",
      kind: "extrusion",
      status,
    });
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      faces.push({
        pts: [
          [a[0], a[1], z0],
          [b[0], b[1], z0],
          [b[0], b[1], z0 + depth],
          [a[0], a[1], z0 + depth],
        ],
        id,
        fill: "rgba(36,48,68,0.2)",
        stroke: "#243044",
        kind: "extrusion",
        status,
      });
    }
  }
}

function roofRectFromForm(form) {
  const loop = (form.profileLoops || [])[0];
  const pts = loop ? loopPoints(loop) : [];
  if (pts.length < 3) {
    return null;
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function pushRoofFaces(faces, form, z0, id, status = "existing") {
  const shape = String(form.roofForm || "flat").toLowerCase();
  if (shape === "flat" || !shape) {
    pushExtrusionFaces(faces, form, z0, id, status);
    return;
  }
  const rect = roofRectFromForm(form);
  if (!rect || rect.w < 0.2 || rect.h < 0.2) {
    pushExtrusionFaces(faces, form, z0, id, status);
    return;
  }
  const pitch = Number(form.roofPitch);
  const deg = Number.isFinite(pitch) ? Math.min(60, Math.max(5, pitch)) : 30;
  const tan = Math.tan((deg * Math.PI) / 180);
  const alongX = form.roofRidge === "short" ? rect.w < rect.h : rect.w >= rect.h;
  const fill = "rgba(36,48,68,0.42)";
  const side = "rgba(36,48,68,0.22)";
  const stroke = "#243044";
  const thick = Math.max(0.08, Number(form.depth) || 0.125);
  const pt = (x, y, z) => [x, y, z];
  const quad = (a, b, c, d, color) => {
    faces.push({ pts: [a, b, c, d], id, fill: color, stroke, kind: "roof", status });
  };
  const tri = (a, b, c, color) => {
    faces.push({ pts: [a, b, c], id, fill: color, stroke, kind: "roof", status });
  };

  const x0 = rect.x;
  const y0 = rect.y;
  const x1 = rect.x + rect.w;
  const y1 = rect.y + rect.h;
  const eave = z0;

  if (shape === "shed") {
    const span = alongX ? rect.h : rect.w;
    const rise = span * tan;
    const hi = eave + rise;
    if (alongX) {
      const a = pt(x0, y0, hi);
      const b = pt(x1, y0, hi);
      const c = pt(x1, y1, eave);
      const d = pt(x0, y1, eave);
      quad(a, b, c, d, fill);
      quad(pt(x0, y0, hi - thick), pt(x1, y0, hi - thick), pt(x1, y1, eave - thick), pt(x0, y1, eave - thick), side);
      quad(a, b, pt(x1, y0, hi - thick), pt(x0, y0, hi - thick), side);
      quad(d, c, pt(x1, y1, eave - thick), pt(x0, y1, eave - thick), side);
      quad(a, d, pt(x0, y1, eave - thick), pt(x0, y0, hi - thick), side);
      quad(b, c, pt(x1, y1, eave - thick), pt(x1, y0, hi - thick), side);
    } else {
      const a = pt(x0, y0, hi);
      const b = pt(x0, y1, hi);
      const c = pt(x1, y1, eave);
      const d = pt(x1, y0, eave);
      quad(a, b, c, d, fill);
      quad(pt(x0, y0, hi - thick), pt(x0, y1, hi - thick), pt(x1, y1, eave - thick), pt(x1, y0, eave - thick), side);
      quad(a, b, pt(x0, y1, hi - thick), pt(x0, y0, hi - thick), side);
      quad(d, c, pt(x1, y1, eave - thick), pt(x1, y0, eave - thick), side);
      quad(a, d, pt(x1, y0, eave - thick), pt(x0, y0, hi - thick), side);
      quad(b, c, pt(x1, y1, eave - thick), pt(x0, y1, hi - thick), side);
    }
    return;
  }

  if (shape === "gable") {
    const span = alongX ? rect.h : rect.w;
    const rise = (span / 2) * tan;
    const ridgeZ = eave + rise;
    if (alongX) {
      const mid = y0 + rect.h / 2;
      const r0 = pt(x0, mid, ridgeZ);
      const r1 = pt(x1, mid, ridgeZ);
      quad(pt(x0, y0, eave), pt(x1, y0, eave), r1, r0, fill);
      quad(r0, r1, pt(x1, y1, eave), pt(x0, y1, eave), fill);
      tri(pt(x0, y0, eave), pt(x0, y1, eave), r0, side);
      tri(pt(x1, y0, eave), r1, pt(x1, y1, eave), side);
    } else {
      const mid = x0 + rect.w / 2;
      const r0 = pt(mid, y0, ridgeZ);
      const r1 = pt(mid, y1, ridgeZ);
      quad(pt(x0, y0, eave), r0, r1, pt(x0, y1, eave), fill);
      quad(r0, pt(x1, y0, eave), pt(x1, y1, eave), r1, fill);
      tri(pt(x0, y0, eave), pt(x1, y0, eave), r0, side);
      tri(pt(x0, y1, eave), r1, pt(x1, y1, eave), side);
    }
    return;
  }

  if (shape === "hip") {
    const span = alongX ? rect.h : rect.w;
    const run = alongX ? rect.w : rect.h;
    const inset = Math.min(span / 2, run / 2);
    const rise = inset * tan;
    const ridgeZ = eave + rise;
    const a = pt(x0, y0, eave);
    const b = pt(x1, y0, eave);
    const c = pt(x1, y1, eave);
    const d = pt(x0, y1, eave);
    if (run - inset * 2 < 0.08) {
      const apex = pt(x0 + rect.w / 2, y0 + rect.h / 2, ridgeZ);
      tri(a, b, apex, fill);
      tri(b, c, apex, fill);
      tri(c, d, apex, fill);
      tri(d, a, apex, fill);
      return;
    }
    if (alongX) {
      const mid = y0 + rect.h / 2;
      const e = pt(x0 + inset, mid, ridgeZ);
      const f = pt(x1 - inset, mid, ridgeZ);
      quad(a, b, f, e, fill);
      quad(d, e, f, c, fill);
      tri(a, e, d, fill);
      tri(b, c, f, fill);
    } else {
      const mid = x0 + rect.w / 2;
      const e = pt(mid, y0 + inset, ridgeZ);
      const f = pt(mid, y1 - inset, ridgeZ);
      quad(a, e, f, d, fill);
      quad(b, c, f, e, fill);
      tri(a, b, e, fill);
      tri(d, f, c, fill);
    }
  }
}

function projectPoint(x, y, z, origin, cx, cy, scale) {
  const px = x - origin[0];
  const py = y - origin[1];
  const pz = z - origin[2];
  const cyaw = Math.cos(massCam.yaw);
  const syaw = Math.sin(massCam.yaw);
  let x1 = px * cyaw - py * syaw;
  let y1 = px * syaw + py * cyaw;
  const cp = Math.cos(massCam.pitch);
  const sp = Math.sin(massCam.pitch);
  const y2 = y1 * cp - pz * sp;
  const z2 = y1 * sp + pz * cp;
  return [cx + x1 * scale, cy - z2 * scale, y2];
}

function faceStyle(face) {
  const id = String(face.id || "");
  if (diffState.added.has(id)) {
    return { fill: "rgba(47,107,79,0.45)", stroke: "#2f6b4f" };
  }
  if (diffState.removed.has(id)) {
    return { fill: "rgba(155,44,44,0.4)", stroke: "#9b2c2c" };
  }
  if (selectedIds.includes(id)) {
    return { fill: "rgba(178,69,30,0.5)", stroke: "#8d3416" };
  }
  const status = resolvedStatus(face.status);
  if (status === "planned" && (face.kind === "wall" || face.kind === "room")) {
    return { fill: face.kind === "wall" ? "rgba(178,69,30,0.38)" : "rgba(178,69,30,0.32)", stroke: "#b2451e" };
  }
  if (status === "planned" && face.kind === "roof") {
    return { fill: "rgba(58,95,122,0.5)", stroke: "#3a5f7a" };
  }
  if (status === "existing" && (face.kind === "wall" || face.kind === "room")) {
    return { fill: face.kind === "wall" ? "rgba(90,84,76,0.42)" : "rgba(92,83,72,0.28)", stroke: "#5c5348" };
  }
  return { fill: face.fill, stroke: face.stroke };
}

function drawMass() {
  const canvas = extraEls.mass;
  if (!canvas || canvas.closest("[hidden]")) {
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  massCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  massCtx.clearRect(0, 0, width, height);

  if (!payload) {
    extraEls.massEmpty.hidden = false;
    return;
  }

  const faces = collectFaces(payload);
  if (diffState.removed.size && baseline) {
    for (const face of collectFaces(baseline)) {
      if (diffState.removed.has(String(face.id))) {
        faces.push(face);
      }
    }
  }

  if (!faces.length) {
    extraEls.massEmpty.hidden = false;
    return;
  }
  extraEls.massEmpty.hidden = true;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const face of faces) {
    for (const [x, y, z] of face.pts) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
  }
  const origin = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1);
  const scale = massCam.scale * Math.min(width, height) / (span * 28);

  const projected = faces.map((face) => {
    const pts = face.pts.map((p) => projectPoint(p[0], p[1], p[2], origin, width / 2, height / 2 + 20, scale));
    const depth = pts.reduce((s, p) => s + p[2], 0) / pts.length;
    return { face, pts, depth };
  });
  projected.sort((a, b) => a.depth - b.depth);

  for (const item of projected) {
    const style = faceStyle(item.face);
    massCtx.beginPath();
    item.pts.forEach((p, i) => (i === 0 ? massCtx.moveTo(p[0], p[1]) : massCtx.lineTo(p[0], p[1])));
    massCtx.closePath();
    massCtx.fillStyle = style.fill;
    massCtx.strokeStyle = style.stroke;
    massCtx.lineWidth = projected.length > 8000 ? 0.2 : 0.45;
    massCtx.fill();
    if (projected.length < 25000) {
      massCtx.stroke();
    }
  }
}

function renderStoreys() {
  if (payload?.meshes?.length) {
    const counts = {};
    for (const mesh of payload.meshes) {
      const key = mesh.category || "Elements";
      counts[key] = (counts[key] || 0) + 1;
    }
    extraEls.storeys.innerHTML = Object.entries(counts)
      .map(([name, count]) => `<li><span>${escapeHtml(name)}</span><span>${count}</span></li>`)
      .join("");
    extraEls.massCaption.textContent = `Revit solids · ${payload.meshes.length} elements · drag to orbit`;
    return;
  }
  const plans = payload ? massingPlans(payload) : [];
  extraEls.storeys.innerHTML = plans.length
    ? plans.map((plan) => `<li><span>${escapeHtml(plan.name)}</span><span>${Number(plan.elevation || 0).toFixed(2)} m</span></li>`).join("")
    : "<li>No storeys in this extract</li>";
  extraEls.massCaption.textContent = payload?.meshes?.length
    ? `Revit solids · ${payload.meshes.length} elements · drag to orbit`
    : payload?.documentKind === "Family"
      ? "Family solids — drag to orbit"
      : "Drag to orbit · scroll to zoom";
}

function stashBaselineOnImport(source) {
  if (!payload) {
    return;
  }
  if (/Live from Revit|Last extract|Uploaded/.test(source)) {
    baseline = JSON.parse(JSON.stringify(payload));
  }
}

function refreshExtras() {
  renderCost();
  renderCompare();
  renderStoreys();
  drawMass();
}

function setView(name) {
  document.querySelectorAll(".view-tab").forEach((tab) => {
    const on = tab.dataset.view === name;
    tab.classList.toggle("active", on);
    tab.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll(".view-page").forEach((page) => {
    page.hidden = page.id !== `view-${name}`;
  });
  if (name === "mass") {
    requestAnimationFrame(() => drawMass());
  }
  if (name === "cost") {
    renderCost();
  }
  if (name === "compare") {
    renderCompare();
  }
  if (typeof renderOfficeView === "function") {
    renderOfficeView(name);
  }
}

const originalApply = applyPayload;
applyPayload = function applyPayloadWithExtras(data, source) {
  if (payload && source && /Live from Revit|Uploaded ·/.test(source)) {
    baseline = JSON.parse(JSON.stringify(payload));
  }
  originalApply(data, source);
  refreshExtras();
};

const originalResize = resizeAndDraw;
resizeAndDraw = function resizeAll() {
  originalResize();
  drawMass();
};

const originalSelect = selectFromRow;
selectFromRow = function selectEverywhere(row) {
  originalSelect(row);
  drawMass();
};

extraEls.costBody.addEventListener("click", (event) => {
  selectFromRow(event.target.closest("tr"));
});
extraEls.compareBody.addEventListener("click", (event) => {
  selectFromRow(event.target.closest("tr"));
});

document.getElementById("btn-show-mass").addEventListener("click", () => setView("mass"));

document.querySelectorAll("[data-mass-status]").forEach((btn) => {
  btn.addEventListener("click", () => {
    massStatusFilter = btn.dataset.massStatus || "both";
    document.querySelectorAll("[data-mass-status]").forEach((b) => {
      b.classList.toggle("active", b.dataset.massStatus === massStatusFilter);
    });
    drawMass();
  });
});

document.querySelectorAll(".view-tab").forEach((tab) => {
  tab.addEventListener("click", () => setView(tab.dataset.view));
});

document.getElementById("btn-baseline").addEventListener("click", () => {
  if (!payload) {
    return;
  }
  baseline = JSON.parse(JSON.stringify(payload));
  renderCompare();
  showBanner("Current extract stored as compare baseline.", "ok");
});

document.getElementById("btn-compare-sample").addEventListener("click", async () => {
  const before = await (await fetch("./samples/floor-plan-before.json", { cache: "no-store" })).json();
  const after = await (await fetch("./samples/floor-plan.json", { cache: "no-store" })).json();
  baseline = before;
  originalApply(after, "Sample after (placed work)");
  refreshExtras();
  setView("compare");
  showBanner("Sample before/after: bath wall and door added. Cost delta uses the mock catalog.", "ok");
});

document.getElementById("file-baseline").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  baseline = JSON.parse(await file.text());
  renderCompare();
  showBanner(`Baseline set from ${file.name}.`, "ok");
});

extraEls.mass.addEventListener("pointerdown", (event) => {
  massDrag = { x: event.clientX, y: event.clientY, yaw: massCam.yaw, pitch: massCam.pitch };
  extraEls.mass.setPointerCapture(event.pointerId);
});
extraEls.mass.addEventListener("pointermove", (event) => {
  if (!massDrag) {
    return;
  }
  massCam.yaw = massDrag.yaw + (event.clientX - massDrag.x) * 0.01;
  massCam.pitch = Math.min(1.2, Math.max(0.15, massDrag.pitch + (event.clientY - massDrag.y) * 0.01));
  drawMass();
});
extraEls.mass.addEventListener("pointerup", () => {
  massDrag = null;
});
extraEls.mass.addEventListener("wheel", (event) => {
  event.preventDefault();
  massCam.scale = Math.min(48, Math.max(8, massCam.scale * (event.deltaY > 0 ? 0.92 : 1.08)));
  drawMass();
}, { passive: false });

loadCatalog().then(() => {
  renderCost();
  renderRateBook();
});
