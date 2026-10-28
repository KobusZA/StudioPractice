// The services inspector: what the dock shows while a route tool is armed or a
// route point / run is selected.
//
// Split in two so the half that decides *what is true* can be tested without a
// DOM: serviceInspectorModel() reads the document and returns plain data, and
// servicePanelHtml() turns that data into markup. ui.js wires the events (every
// control carries a data-svc attribute) and owns undo, persistence and redraw.
//
// Nothing in the panel is an input to the BOM except through the document: the
// numbers it prints are derived by services.js each time, the same functions
// compile() calls, so what the panel says and what the take-off counts cannot
// drift apart.

import { effectiveLevel } from "./model.js";
import { SERVICE_SYSTEMS, SERVICE_SYSTEM_INFO } from "./service-model.js";
import { clearanceText, pipeRadius, runWallRelation } from "./service-walls.js";
import {
  drainageReport,
  edgeMeasure,
  formatGradient,
  levelNameOf,
  networkLevels,
  networkOf,
  nodeAbsoluteZ,
  nodeLevel,
  nodeMap,
  serviceTakeoff,
} from "./services.js";

/** The on-screen word for a drawing status. Stored value stays "planned". */
function statusWord(status) {
  return status === "planned" ? "proposed" : (status || "");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[c]));
}

/**
 * The types a route of `system` may use: SKUs measured by the metre and drawn as
 * a pipe. The pack does not say which SKU belongs to which system (its only
 * linear services are two "drainage" pipes, one of them a water supply, and the
 * 64 electrical SKUs are count-only points), so this never decides that for the
 * user: drainage is offered the drainage category, every other system the
 * length-measured pipe types, and choosing none is allowed and stays unresolved.
 */
export function serviceSkuChoices(pack, system) {
  return (pack?.skus || []).filter((sku) => {
    if (sku.unit !== "m" || sku.draw !== "pipe") return false;
    if (!(sku.schedule?.report || []).includes("length")) return false;
    return system === "drainage" ? sku.category === "drainage" : true;
  });
}

function skuLabel(sku) {
  if (!sku) return "No type chosen";
  const dia = Number.isFinite(sku.geometry?.diameter) ? ` · ${Math.round(sku.geometry.diameter * 1000)} mm` : "";
  return `${sku.name}${dia}`;
}

const m2 = (n) => (n === null || n === undefined ? "—" : `${n.toFixed(2)} m`);
const signedM = (n) => (n === null || n === undefined ? "—" : `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)} m`);

/** Gradient of a run as the inspector words it. */
function slopeText(m) {
  if (m.vertical) return "vertical";
  if (m.slope === null) return "—";
  if (Math.abs(m.slope) < 1e-9) return "level";
  return `${formatGradient(m.slope)} ${m.slope < 0 ? "falling" : "rising"} along the run`;
}

function endInfo(pack, node) {
  return {
    nodeId: node.id,
    levelName: levelNameOf(pack, nodeLevel(pack, node)),
    offset: node.offset,
    z: nodeAbsoluteZ(pack, node),
  };
}

/**
 * What the dock should say about the current selection.
 * `mode` is "none" (no service selected), "node" (one route point) or "edges"
 * (one or more runs; a mixed selection with a point and a run reads as edges).
 */
export function serviceInspectorModel(doc, pack, refs, ctx = null) {
  const nodes = nodeMap(doc);
  const nodeRefs = refs.filter((r) => r.kind === "serviceNode");
  const edgeRefs = refs.filter((r) => r.kind === "serviceEdge");
  const edges = edgeRefs
    .map((r) => (doc.serviceEdges || []).find((e) => e.id === r.id))
    .filter(Boolean);

  if (!edges.length && nodeRefs.length === 1 && nodes.has(nodeRefs[0].id)) {
    const node = nodes.get(nodeRefs[0].id);
    const network = networkOf(doc, node.networkId);
    const item = node.connectedRef
      ? (doc.items || []).find((i) => i.id === node.connectedRef.id)
      : null;
    return {
      mode: "node",
      node,
      network,
      levelId: nodeLevel(pack, node),
      levelName: levelNameOf(pack, nodeLevel(pack, node)),
      offset: node.offset,
      z: nodeAbsoluteZ(pack, node),
      levels: (pack?.levels || []).map((l) => ({ id: l.id, name: l.name || l.id })),
      connected: item
        ? { id: item.id, label: (pack?.skus || []).find((s) => s.id === item.sku)?.name || item.id }
        : null,
      items: (doc.items || []).map((i) => ({
        id: i.id,
        level: effectiveLevel(i, pack),
        label: `${(pack?.skus || []).find((s) => s.id === i.sku)?.name || i.id}`,
      })),
    };
  }

  if (edges.length) {
    const systems = new Set(edges.map((e) => networkOf(doc, e.networkId)?.system));
    const system = systems.size === 1 ? [...systems][0] : null;
    const skuIds = new Set(edges.map((e) => e.sku || ""));
    const modes = new Set(edges.map((e) => e.mode));
    const model = {
      mode: "edges",
      count: edges.length,
      edgeIds: edges.map((e) => e.id),
      system,
      skuId: skuIds.size === 1 ? [...skuIds][0] : null,
      edgeMode: modes.size === 1 ? [...modes][0] : null,
      // true / false when every selected run agrees, null when they differ.
      chase: new Set(edges.map((e) => e.chase === true)).size === 1 ? edges[0].chase === true : null,
      skuOptions: system ? serviceSkuChoices(pack, system) : [],
      single: null,
      drainage: null,
    };
    if (edges.length === 1) {
      const e = edges[0];
      const m = edgeMeasure(doc, pack, e, nodes);
      const network = networkOf(doc, e.networkId);
      const sku = (pack?.skus || []).find((s) => s.id === e.sku) || null;
      model.single = m && {
        edgeId: e.id,
        network,
        from: endInfo(pack, m.from),
        to: endInfo(pack, m.to),
        plan: m.plan,
        dz: m.dz,
        length: m.length,
        slope: m.slope,
        slopeText: slopeText(m),
        vertical: m.vertical,
        sku,
        skuLabel: skuLabel(sku),
        networkLevels: networkLevels(doc, pack, e.networkId).map((id) => levelNameOf(pack, id)),
        wall: wallInfo(pack, e, m, ctx),
      };
      if (system === "drainage" && m) {
        const minGradient = sku?.compliance?.minGradient;
        model.drainage = {
          diameter: Number.isFinite(sku?.geometry?.diameter) ? sku.geometry.diameter : null,
          minGradient: Number.isFinite(minGradient) ? minGradient : null,
          findings: drainageReport(doc, pack).filter((f) => f.edgeId === e.id),
        };
      }
    }
    return model;
  }
  return { mode: "none" };
}

/**
 * The wall a single run sits alongside, for the inspector: the clearance from
 * the pipe's edge to the face (what Revit's temporary dimension edits), and
 * whether the run is an obstruction or an accepted chase.
 */
function wallInfo(pack, edge, m, ctx) {
  if (!ctx?.walls?.length || m.vertical || m.levelFrom !== ctx.levelId || m.levelTo !== ctx.levelId) return null;
  const rel = runWallRelation(ctx.walls, m.from, m.to, pipeRadius(pack, edge));
  if (!rel) return null;
  const chase = edge.chase === true;
  let tone = "";
  let message = "";
  if (rel.state === "inside") {
    tone = chase ? "ok" : "warn";
    message = chase ? "In a chase: flagged as in the wall." : "Inside the wall with no chase: an obstruction. Tick “In chase / cavity” if that is intended.";
  } else if (rel.state === "partial") {
    tone = chase ? "amber" : "warn";
    message = chase ? "Marked as a chase, but only part of the pipe is in the wall. A chase must hold the whole pipe." : "Cuts across a wall face: an obstruction.";
  } else if (chase) {
    tone = "amber";
    message = "Marked as a chase, but the run is not in a wall.";
  }
  return {
    state: rel.state,
    text: clearanceText(rel),
    clearanceMm: rel.state === "clear" ? Math.round(rel.clearance * 1000) : null,
    measuredToLine: rel.radius === null,
    tone,
    message,
  };
}

/** Per-network totals for the idle panel, from the same take-off the BOM uses. */
export function serviceNetworkSummary(doc, pack) {
  return serviceTakeoff(doc, pack).networks.map((n) => ({
    id: n.id,
    name: n.name,
    system: n.system,
    status: n.status,
    levelNames: n.levels.map((id) => levelNameOf(pack, id)),
    measuredLength: n.measuredLength,
    schematicLength: n.schematicLength,
  }));
}

// --- markup ----------------------------------------------------------------

function options(list, selected, { blank = null } = {}) {
  const rows = list.map((o) => `<option value="${esc(o.id)}"${o.id === selected ? " selected" : ""}>${esc(o.label)}</option>`);
  if (blank !== null) rows.unshift(`<option value=""${!selected ? " selected" : ""}>${esc(blank)}</option>`);
  return rows.join("");
}

function field(label, inner) {
  return `<label class="svc-field"><span>${esc(label)}</span>${inner}</label>`;
}

function readout(label, value, cls = "") {
  return `<div class="planner-read-field svc-read ${cls}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}

/**
 * Settings for the next run to be drawn: system, network, type, height, mode.
 * Shown while Draw route is armed.
 */
export function routeSettingsHtml(doc, pack, ui) {
  const networks = (doc.serviceNetworks || []).filter((n) => n.system === ui.system);
  const skus = serviceSkuChoices(pack, ui.system);
  return `
    <section class="svc-block" aria-label="Route settings">
      <h3>Route</h3>
      ${field("System", `<select data-svc="system">${options(SERVICE_SYSTEMS.map((id) => ({ id, label: SERVICE_SYSTEM_INFO[id].label })), ui.system)}</select>`)}
      ${field("Network", `<select data-svc="network">${options(networks.map((n) => ({ id: n.id, label: `${n.name} (${statusWord(n.status)})` })), ui.networkId, { blank: "New network" })}</select>`)}
      ${field("Type", `<select data-svc="sku">${options(skus.map((s) => ({ id: s.id, label: skuLabel(s) })), ui.sku, { blank: "No type chosen" })}</select>`)}
      ${skus.length ? "" : `<p class="hint">The template has no length-measured ${esc(SERVICE_SYSTEM_INFO[ui.system].label.toLowerCase())} types. Runs can still be drawn; they stay uncounted until a type is chosen.</p>`}
      ${field("Height above level datum", `<span class="plan-context-field"><input data-svc="offset" type="text" inputmode="decimal" autocomplete="off" value="${esc(ui.offsetText)}" /><span>m</span></span>`)}
      ${field("Quantities", `<select data-svc="mode">${options([{ id: "measured", label: "Include in BoQ" }, { id: "schematic", label: "Exclude from BoQ (shown only)" }], ui.mode)}</select>`)}
      ${field("Beside walls", `<select data-svc="just-mode">${options([{ id: "off", label: "Free (no wall offset)" }, { id: "clear", label: "Clear of the wall face" }, { id: "centre", label: "In the wall (chase)" }], ui.justMode || "off")}</select>`)}
      ${ui.justMode === "clear" ? field("Pipe edge to wall face", `<span class="plan-context-field"><input data-svc="just-offset" type="text" inputmode="decimal" autocomplete="off" value="${esc(ui.justOffsetText ?? "150")}" /><span>mm</span></span>`) : ""}
      ${ui.justMode === "centre" ? `<p class="hint">A click only lands on a wall's centreline, and the run is marked as in a chase. A click off a wall does nothing. The wall has to be thick enough to hold the pipe.</p>` : ""}
    </section>`;
}

function nodeHtml(model) {
  const levelOpts = model.levels.map((l) => ({ id: l.id, label: l.name }));
  const destItems = model.items.map((i) => ({ id: i.id, label: `${i.label} (${i.id})`, level: i.level }));
  return `
    <section class="svc-block">
      <h3>Route point</h3>
      ${readout("Network", `${model.network?.name || "—"} · ${SERVICE_SYSTEM_INFO[model.network?.system]?.label || ""}`)}
      ${field("Level", `<select data-svc="node-level">${options(levelOpts, model.levelId)}</select>`)}
      ${field("Offset from level datum", `<span class="plan-context-field"><input data-svc="node-offset" type="text" inputmode="decimal" autocomplete="off" value="${model.offset === null ? "" : esc(model.offset.toFixed(3))}" placeholder="not stated" /><span>m</span></span>`)}
      ${readout("Absolute elevation", signedM(model.z))}
      ${model.connected
    ? `<div class="planner-read-field svc-read"><span>Connected to</span><strong>${esc(model.connected.label)}</strong></div><button type="button" data-svc="disconnect">Disconnect</button>`
    : readout("Connected to", "nothing")}
    </section>
    <section class="svc-block">
      <h3>Rise / drop</h3>
      <p class="hint">A riser is a second point at the same X/Y and a different height. Drag its marker on the plan to move both.</p>
      ${field("Relative change", `<span class="plan-context-field"><input data-svc="rise-delta" type="text" inputmode="decimal" autocomplete="off" placeholder="2.40" /><span>m</span></span>`)}
      <div class="svc-buttons"><button type="button" data-svc="rise" data-dir="1">Rise</button><button type="button" data-svc="rise" data-dir="-1">Drop</button></div>
      ${field("Or to level", `<select data-svc="rise-level">${options(levelOpts, model.levelId)}</select>`)}
      ${field("Offset on that level", `<span class="plan-context-field"><input data-svc="rise-offset" type="text" inputmode="decimal" autocomplete="off" placeholder="0.30" /><span>m</span></span>`)}
      <label class="svc-field"><span>Connect to component</span><select data-svc="rise-item" data-items='${esc(JSON.stringify(destItems))}'><option value="">None</option>${destItems.filter((i) => i.level === model.levelId).map((i) => `<option value="${esc(i.id)}">${esc(i.label)}</option>`).join("")}</select></label>
      <button type="button" data-svc="rise-level-go">Add riser to level</button>
    </section>`;
}

function edgesHtml(model) {
  const s = model.single;
  const typeOpts = model.skuOptions.map((x) => ({ id: x.id, label: skuLabel(x) }));
  const parts = [`<section class="svc-block"><h3>${model.count > 1 ? `${model.count} runs` : "Run"}</h3>`];
  if (s) {
    parts.push(
      readout("Network", `${s.network?.name || "—"} · ${SERVICE_SYSTEM_INFO[s.network?.system]?.label || ""} · ${statusWord(s.network?.status)}`),
      readout("Spans", s.networkLevels.join(", ") || "—"),
    );
  } else if (model.system) {
    parts.push(readout("System", SERVICE_SYSTEM_INFO[model.system].label));
  }
  parts.push(
    field("Type", `<select data-svc="edge-sku">${options(typeOpts, model.skuId || "", { blank: model.skuId === null ? "Mixed types" : "No type chosen" })}</select>`),
    field("Quantities", `<select data-svc="edge-mode">${options([{ id: "measured", label: "Include in BoQ" }, { id: "schematic", label: "Exclude from BoQ (shown only)" }], model.edgeMode || "", { blank: model.edgeMode === null ? "Mixed" : null })}</select>`),
  );
  parts.push(
    `<label class="svc-field svc-check"><input type="checkbox" data-svc="edge-chase"${model.chase ? " checked" : ""} /><span>In chase / cavity${model.chase === null ? " (mixed)" : ""}</span></label>`,
  );
  if (s?.wall) {
    const w = s.wall;
    parts.push(
      readout("Wall alongside", w.text),
      w.clearanceMm === null
        ? ""
        : field("Clearance to wall face", `<span class="plan-context-field"><input data-svc="edge-clearance" type="text" inputmode="decimal" autocomplete="off" value="${w.clearanceMm}" /><span>mm</span></span>`),
      w.clearanceMm !== null && w.measuredToLine ? `<p class="hint">This type states no pipe size, so the gap is measured from the centreline.</p>` : "",
      w.message ? `<p class="${w.tone === "ok" ? "hint" : "warn"}">${w.tone === "ok" ? "" : "⚠ "}${esc(w.message)}</p>` : "",
    );
  }
  if (s) {
    parts.push(
      `<div class="svc-ends">
        <div><span>Start</span>${field("Offset", `<span class="plan-context-field"><input data-svc="end-offset" data-node="${esc(s.from.nodeId)}" type="text" inputmode="decimal" autocomplete="off" value="${s.from.offset === null ? "" : esc(s.from.offset.toFixed(3))}" placeholder="not stated" /><span>m</span></span>`)}${readout("Level", s.from.levelName)}${readout("Elevation", signedM(s.from.z))}</div>
        <div><span>End</span>${field("Offset", `<span class="plan-context-field"><input data-svc="end-offset" data-node="${esc(s.to.nodeId)}" type="text" inputmode="decimal" autocomplete="off" value="${s.to.offset === null ? "" : esc(s.to.offset.toFixed(3))}" placeholder="not stated" /><span>m</span></span>`)}${readout("Level", s.to.levelName)}${readout("Elevation", signedM(s.to.z))}</div>
      </div>`,
      readout("Plan length", m2(s.plan)),
      readout("Vertical difference", signedM(s.dz)),
      readout("True length", m2(s.length), "svc-true"),
      readout("Slope", s.slopeText),
      `<div class="svc-buttons"><button type="button" data-svc="reverse" title="Flow runs from the start to the end">Reverse direction</button></div>`,
    );
  }
  parts.push("</section>");

  if (model.drainage) {
    const d = model.drainage;
    parts.push(`
    <section class="svc-block">
      <h3>Drainage</h3>
      ${readout("Diameter", d.diameter === null ? "not stated" : `${Math.round(d.diameter * 1000)} mm`)}
      ${readout("Minimum gradient", d.minGradient === null ? "not stated by the type" : formatGradient(d.minGradient))}
      ${field("Set fall (1:60 or 1.7%)", `<input data-svc="fall" type="text" autocomplete="off" placeholder="${d.minGradient === null ? "1:60" : esc(formatGradient(d.minGradient))}" />`)}
      <button type="button" data-svc="fall-apply">Apply fall to downstream end</button>
      ${d.findings.map((f) => `<p class="${f.severity === "warn" ? "warn" : "hint"}">${f.severity === "warn" ? "⚠ " : ""}${esc(f.message)}</p>`).join("")}
    </section>`);
  }
  // The route profile is not here: it sits under the plan (index.html).
  return parts.join("");
}

function idleHtml(summary) {
  if (!summary.length) {
    return `<section class="svc-block"><h3>Networks</h3><p class="hint">None yet. Draw a route to start one.</p></section>`;
  }
  return `<section class="svc-block"><h3>Networks</h3>${summary.map((n) => `
    <div class="planner-read-field svc-read"><span>${esc(n.name)} · ${esc(SERVICE_SYSTEM_INFO[n.system].label)}${n.status === "existing" ? " (existing)" : ""}</span>
    <strong>${n.measuredLength.toFixed(2)} m${n.levelNames.length > 1 ? ` · ${esc(n.levelNames.join(", "))}` : ""}</strong></div>`).join("")}
    <p class="hint">True length per network, as included in the BoQ; runs set to "Exclude from BoQ" are not added.</p></section>`;
}

/**
 * Markup for the whole services dock. `showRoute` adds the route settings
 * (Draw route is armed); the selection model adds node or run properties.
 */
export function servicePanelHtml({ doc, pack, ui, model, showRoute, connectHint }) {
  const out = [];
  if (connectHint) out.push(`<p class="hint">${esc(connectHint)}</p>`);
  if (showRoute) out.push(routeSettingsHtml(doc, pack, ui));
  if (model.mode === "node") out.push(nodeHtml(model));
  else if (model.mode === "edges") out.push(edgesHtml(model));
  else if (!showRoute) out.push(idleHtml(serviceNetworkSummary(doc, pack)));
  return out.join("");
}
