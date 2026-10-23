// 2.5D service routing: the derived facts and the document edits.
//
// Stored (service-model.js): networks, nodes (x, y, level, offset) and edges
// (from, to, sku, mode). Derived here, every time, from those plus the level
// stack:
//
//   absoluteZ = level elevation + node offset
//   length    = hypot(dx, dy, dz)
//
// Nothing derived is ever written back to the document. The one place that
// looks like it - applyDrainageFall - writes an *offset* (a stated height), not
// a slope, and the slope is read back out of the heights afterwards.
//
// "Unknown is null" (PHILOSOPHY.md) applies to heights as much as to compliance
// facts. A level the pack does not define, or a node with no stated offset, has
// no absolute Z; an edge that needs it has no 3D length, and the BOM leaves it
// out with a warning instead of quietly measuring it as flat. compile.js's own
// `levelElevation()` answers 0 for an unknown level, which is right for a wall
// that has to draw somewhere and wrong here, so this module has its own.
//
// Pure functions over (doc, pack): ui.js owns undo, persistence and redraw, the
// tests never touch a DOM, and compile.js can call in without a cycle (this file
// imports model.js only, never compile.js).

import { effectiveLevel, nid, objectByRef } from "./model.js";
import {
  RISER_EPS,
  SERVICE_SYSTEMS,
  SERVICE_SYSTEM_INFO,
  edgePairKey,
  isRiserPair,
  pruneServices,
  riserColumn,
} from "./service-model.js";

export { RISER_EPS, isRiserPair, riserColumn, pruneServices };

/** Shortest horizontal run worth an edge. A double-click is not a pipe. */
export const MIN_ROUTE_SEGMENT = 0.05;

// Distance within which a click reuses an existing node instead of making a
// second one on top of it, in metres. The UI widens it with zoom.
const REUSE_TOL = 0.15;

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function fail(message) {
  return { ok: false, message };
}

// --- levels and heights -----------------------------------------------------

/** A level's elevation in metres, or null when the stack has no such level. */
export function levelElevationOf(pack, levelId) {
  if (levelId == null) return null;
  const hit = (pack?.levels || []).find((l) => l.id === levelId || l.name === levelId);
  return isNum(hit?.elevation) ? hit.elevation : null;
}

export function levelNameOf(pack, levelId) {
  return (pack?.levels || []).find((l) => l.id === levelId)?.name || levelId || "—";
}

export function nodeLevel(pack, node) {
  return effectiveLevel(node, pack);
}

/** level elevation + node offset, or null when either half is unknown. */
export function nodeAbsoluteZ(pack, node) {
  if (!node || !isNum(node.offset)) return null;
  const elevation = levelElevationOf(pack, nodeLevel(pack, node));
  return elevation === null ? null : elevation + node.offset;
}

/**
 * Height of `b` above `a`, metres, or null when it cannot be known.
 *
 * Two nodes on the same level share a datum, so their difference is just the
 * difference of their offsets and does not depend on the level existing in the
 * stack at all. Across levels it needs both elevations.
 */
export function verticalDelta(pack, a, b) {
  if (!a || !b || !isNum(a.offset) || !isNum(b.offset)) return null;
  const la = nodeLevel(pack, a);
  const lb = nodeLevel(pack, b);
  if (la === lb) return b.offset - a.offset;
  const ea = levelElevationOf(pack, la);
  const eb = levelElevationOf(pack, lb);
  if (ea === null || eb === null) return null;
  return (eb + b.offset) - (ea + a.offset);
}

export function nodeMap(doc) {
  return new Map((doc.serviceNodes || []).map((n) => [n.id, n]));
}

export function networkOf(doc, networkId) {
  return (doc.serviceNetworks || []).find((n) => n.id === networkId) || null;
}

/** Status of whatever a node or edge belongs to. Nodes and edges carry none of their own. */
export function serviceStatus(doc, obj) {
  return networkOf(doc, obj?.networkId)?.status === "existing" ? "existing" : "planned";
}

/** Colour and label for a node or edge's network. */
export function serviceStyle(doc, obj) {
  const system = networkOf(doc, obj?.networkId)?.system;
  return SERVICE_SYSTEM_INFO[system] || { label: "Service", colour: "#2675b8", prefix: "SV" };
}

// --- measures ---------------------------------------------------------------

/**
 * Everything derivable about one edge.
 *
 * `slope` is dz / plan, signed along from -> to: negative is falling. It is
 * null for a vertical edge (no plan run to divide by) and where heights are
 * unresolved. `length` is the true 3D length, null unless the vertical
 * difference is known - a plan length alone is never passed off as it.
 */
export function edgeMeasure(doc, pack, edge, nodes = nodeMap(doc)) {
  const from = nodes.get(edge?.fromNode);
  const to = nodes.get(edge?.toNode);
  if (!from || !to) return null;
  const plan = Math.hypot(to.x - from.x, to.y - from.y);
  const dz = verticalDelta(pack, from, to);
  const vertical = plan <= RISER_EPS;
  return {
    edge,
    from,
    to,
    plan,
    dz,
    length: dz === null ? null : Math.hypot(plan, dz),
    slope: vertical || dz === null ? null : dz / plan,
    vertical,
    // A riser proper has a height to it; two coincident nodes at one height
    // are a degenerate edge, reported rather than counted.
    degenerate: vertical && (dz === null ? false : Math.abs(dz) < 1e-9),
    zFrom: nodeAbsoluteZ(pack, from),
    zTo: nodeAbsoluteZ(pack, to),
    levelFrom: nodeLevel(pack, from),
    levelTo: nodeLevel(pack, to),
  };
}

/**
 * One 3D segment per run, for the massing view.
 *
 * Absolute height is derived the same way as the route profile. A run with
 * either end unresolved is left out: there is no height to draw it at. Diameter
 * is the chosen pipe or conduit size when that SKU states one, and null when
 * it does not — the view may thicken the stroke, but it must not invent a size.
 */
export function serviceMassingRoutes(doc, pack) {
  const nodes = nodeMap(doc);
  const skus = new Map((pack?.skus || []).map((sku) => [sku.id, sku]));
  const routes = [];
  for (const edge of doc.serviceEdges || []) {
    const measured = edgeMeasure(doc, pack, edge, nodes);
    if (!measured || measured.degenerate) continue;
    if (measured.zFrom === null || measured.zTo === null) continue;
    const network = networkOf(doc, edge.networkId);
    const diameter = skus.get(edge.sku)?.geometry?.diameter;
    const status = serviceStatus(doc, edge);
    routes.push({
      id: edge.id,
      networkId: edge.networkId,
      system: network?.system || null,
      status,
      colour: serviceStyle(doc, edge).colour,
      dash: edge.mode === "schematic" ? "schematic" : status === "existing" ? "existing" : null,
      diameter: Number.isFinite(diameter) && diameter > 0 ? diameter : null,
      a: [measured.from.x, measured.from.y, measured.zFrom],
      b: [measured.to.x, measured.to.y, measured.zTo],
    });
  }
  return routes;
}

/** One 3D point per service node, so a BOQ fitting (bend) can be pointed at. */
export function serviceMassingNodes(doc, pack) {
  const out = [];
  for (const node of doc.serviceNodes || []) {
    const z = nodeAbsoluteZ(pack, node);
    if (z === null || z === undefined || !Number.isFinite(z)) continue;
    out.push({ id: node.id, status: serviceStatus(doc, node), p: [node.x, node.y, z] });
  }
  return out;
}

/** Levels an edge touches, lower end first when heights allow. */
export function edgeLevels(doc, pack, edge) {
  const m = edgeMeasure(doc, pack, edge);
  if (!m) return [];
  const ends = [m.levelFrom, m.levelTo];
  if (m.dz !== null && m.dz < 0) ends.reverse();
  return [...new Set(ends)];
}

/** The level a measured quantity is filed under: the lower end's. */
export function edgeHomeLevel(doc, pack, edge) {
  return edgeLevels(doc, pack, edge)[0] ?? null;
}

/** Sorted (bottom to top) levels a network spans. */
export function networkLevels(doc, pack, networkId) {
  const ids = new Set();
  for (const n of doc.serviceNodes || []) if (n.networkId === networkId) ids.add(nodeLevel(pack, n));
  return [...ids].filter((id) => id != null).sort((a, b) => {
    const ea = levelElevationOf(pack, a);
    const eb = levelElevationOf(pack, b);
    if (ea === null || eb === null) return String(a).localeCompare(String(b));
    return ea - eb;
  });
}

// --- per-level visibility ---------------------------------------------------

/**
 * What the plan for `levelId` shows of the services:
 *  - `runs`        horizontal or sloped edges whose two ends are both on this level
 *  - `transitions` edges that leave this level at a plan distance (not risers)
 *  - `nodes`       nodes on this level
 *  - `markers`     one riser marker per plan point (see riserMarkers)
 * A riser edge is never in `runs`: it has no plan extent, so it appears as a
 * marker and nothing else.
 */
export function serviceLevelView(doc, pack, levelId) {
  const nodes = nodeMap(doc);
  const levelNodes = (doc.serviceNodes || []).filter((n) => nodeLevel(pack, n) === levelId);
  const runs = [];
  const transitions = [];
  for (const edge of doc.serviceEdges || []) {
    const m = edgeMeasure(doc, pack, edge, nodes);
    if (!m || m.vertical) continue;
    const onFrom = m.levelFrom === levelId;
    const onTo = m.levelTo === levelId;
    if (onFrom && onTo) runs.push(m);
    else if (onFrom || onTo) transitions.push(m);
  }
  return { runs, transitions, nodes: levelNodes, markers: riserMarkers(doc, pack, levelId) };
}

function signed(metres) {
  return `${metres >= 0 ? "+" : "−"}${Math.abs(metres).toFixed(2)} m`;
}

/**
 * Riser markers on one level.
 *
 * A riser leaves a level upward or downward. The lower floor shows an up marker
 * and the upper floor a down marker; a node that has both (a through-riser,
 * three or more storeys) shows one combined marker. A riser inside a single
 * level (a rise to a high-level fitting) shows its height instead of a level.
 *
 * Direction comes from heights, so it is right whichever way the edge was
 * drawn. Where heights are unresolved the direction is unknown and the marker
 * says so rather than guessing "up".
 */
export function riserMarkers(doc, pack, levelId) {
  const nodes = nodeMap(doc);
  const byPoint = new Map();
  for (const node of doc.serviceNodes || []) {
    if (nodeLevel(pack, node) !== levelId) continue;
    for (const edge of doc.serviceEdges || []) {
      const otherId = edge.fromNode === node.id ? edge.toNode : edge.toNode === node.id ? edge.fromNode : null;
      const other = otherId ? nodes.get(otherId) : null;
      if (!other || !isRiserPair(node, other)) continue;
      const dz = verticalDelta(pack, node, other);
      const key = `${node.networkId}|${Math.round(node.x / RISER_EPS)}|${Math.round(node.y / RISER_EPS)}`;
      if (!byPoint.has(key)) {
        byPoint.set(key, {
          key, networkId: node.networkId, x: node.x, y: node.y, nodeIds: [], up: [], down: [], unknown: [],
        });
      }
      const marker = byPoint.get(key);
      if (!marker.nodeIds.includes(node.id)) marker.nodeIds.push(node.id);
      const otherLevel = nodeLevel(pack, other);
      const info = {
        edgeId: edge.id,
        levelId: otherLevel,
        levelName: otherLevel === levelId ? null : levelNameOf(pack, otherLevel),
        dz,
        offset: other.offset,
      };
      (dz === null ? marker.unknown : dz > 0 ? marker.up : marker.down).push(info);
    }
  }
  const style = (m) => serviceStyle(doc, { networkId: m.networkId });
  return [...byPoint.values()].map((m) => {
    const kind = m.up.length && m.down.length ? "through"
      : m.up.length ? "up"
        : m.down.length ? "down"
          : "riser";
    const labels = [];
    for (const u of m.up) {
      labels.push(u.levelName ? `↑ to ${u.levelName}` : `↑ ${signed(u.dz)}`);
    }
    for (const d of m.down) {
      labels.push(d.levelName ? `↓ from ${d.levelName}` : `↓ ${signed(d.dz)}`);
    }
    for (const x of m.unknown) {
      labels.push(x.levelName ? `↕ ${x.levelName} (height unresolved)` : "↕ height unresolved");
    }
    return { ...m, kind, labels, colour: style(m).colour, label: labels.join(" · ") };
  });
}

// --- placed-component helpers ----------------------------------------------

/**
 * Centre of a placed component in plan. Mirrors ui.js's itemRect(): x/y is the
 * corner, the SKU states width/depth, a quarter turn swaps them. Null when the
 * SKU is unknown - a connection point is never guessed.
 */
export function itemCentre(pack, item) {
  const sku = (pack?.skus || []).find((s) => s.id === item?.sku);
  if (!sku || !isNum(item?.x) || !isNum(item?.y)) return null;
  const g = sku.geometry || {};
  const w = g.width || 0.4;
  const d = g.depth || g.width || 0.4;
  const turned = Math.abs(((item.rotation || 0) / 90) % 2);
  const [bw, bh] = turned ? [d, w] : [w, d];
  return { x: item.x + bw / 2, y: item.y + bh / 2 };
}

// --- edits ------------------------------------------------------------------

/** The next free tag for a system: CW-01, CW-02 ... */
export function nextNetworkName(doc, system) {
  const prefix = SERVICE_SYSTEM_INFO[system]?.prefix || "SV";
  const used = new Set((doc.serviceNetworks || []).map((n) => n.name));
  for (let i = 1; i < 1000; i += 1) {
    const name = `${prefix}-${String(i).padStart(2, "0")}`;
    if (!used.has(name)) return name;
  }
  return `${prefix}-${nid("")}`;
}

export function createNetwork(doc, { system, status = "planned", name = null } = {}) {
  if (!SERVICE_SYSTEMS.includes(system)) return null;
  if (!Array.isArray(doc.serviceNetworks)) doc.serviceNetworks = [];
  const network = {
    id: nid("sn"),
    name: (typeof name === "string" && name.trim()) || nextNetworkName(doc, system),
    system,
    status: status === "existing" ? "existing" : "planned",
  };
  doc.serviceNetworks.push(network);
  return network;
}

/** Networks of one system, in the order they were made. */
export function networksFor(doc, system) {
  return (doc.serviceNetworks || []).filter((n) => n.system === system);
}

function ensureArrays(doc) {
  for (const key of ["serviceNetworks", "serviceNodes", "serviceEdges"]) {
    if (!Array.isArray(doc[key])) doc[key] = [];
  }
}

function findNodeAt(doc, networkId, levelId, pack, x, y, tol, offset) {
  let best = null;
  let bestScore = Infinity;
  for (const n of doc.serviceNodes) {
    if (n.networkId !== networkId || nodeLevel(pack, n) !== levelId) continue;
    const d = Math.hypot(n.x - x, n.y - y);
    if (d > tol) continue;
    // Prefer the node at the height being drawn, so a column of nodes at one
    // X/Y on one level (a rise within a storey) picks the right one.
    const score = d + (n.offset === offset ? 0 : 1);
    if (score < bestScore) {
      best = n;
      bestScore = score;
    }
  }
  return best;
}

function edgeBetween(doc, networkId, a, b) {
  const key = edgePairKey(networkId, a, b);
  return doc.serviceEdges.find((e) => edgePairKey(e.networkId, e.fromNode, e.toNode) === key) || null;
}

/**
 * One click of the Draw route tool. The first click of a run returns a node; each
 * later click adds a node (or reuses one already there) and the edge from the
 * previous node, exactly as walls chain click by click.
 *
 * `route` = { networkId, fromNodeId, level, offset, sku, mode }. `offset` may be
 * null: the node is then unresolved rather than silently on the floor.
 */
export function addRoutePoint(doc, pack, route, point, { tol = REUSE_TOL } = {}) {
  ensureArrays(doc);
  const network = networkOf(doc, route?.networkId);
  if (!network) return fail("Pick or create a network first.");
  const level = route.level ?? effectiveLevel({}, pack);
  const offset = isNum(route.offset) ? route.offset : null;
  const from = route.fromNodeId ? doc.serviceNodes.find((n) => n.id === route.fromNodeId) : null;

  const existing = findNodeAt(doc, network.id, level, pack, point.x, point.y, tol, offset);
  if (from && existing && existing.id === from.id) return fail("That is the point you started from.");

  const tx = existing ? existing.x : point.x;
  const ty = existing ? existing.y : point.y;
  if (from && Math.hypot(tx - from.x, ty - from.y) < MIN_ROUTE_SEGMENT) {
    return fail("Too short for a run. Click further along, or use Rise / drop for a vertical change.");
  }
  if (from && existing && edgeBetween(doc, network.id, from.id, existing.id)) {
    return { ok: true, message: "Those two points are already joined.", nodeId: existing.id, edgeId: null, createdNode: false };
  }

  let node = existing;
  if (!node) {
    node = {
      id: nid("sv"), networkId: network.id, x: point.x, y: point.y, level, offset, connectedRef: null,
    };
    doc.serviceNodes.push(node);
  }
  let edgeId = null;
  if (from) {
    edgeId = nid("se");
    doc.serviceEdges.push({
      id: edgeId,
      networkId: network.id,
      fromNode: from.id,
      toNode: node.id,
      sku: route.sku ?? null,
      mode: route.mode === "schematic" ? "schematic" : "measured",
      ...(route.chase === true ? { chase: true } : {}),
    });
  }
  return { ok: true, message: "", nodeId: node.id, edgeId, createdNode: !existing };
}

/** Move a node, and with it every node in its riser column, keeping heights. */
export function moveServiceNode(doc, nodeId, x, y) {
  const moved = riserColumn(doc, nodeId);
  const nodes = nodeMap(doc);
  for (const id of moved) {
    const n = nodes.get(id);
    n.x = x;
    n.y = y;
  }
  return moved;
}

/** The point on a run nearest `point` (kept off the ends), for a ghost node. Null if the run is too short. */
export function projectOnEdge(doc, edgeId, point) {
  const edge = (doc.serviceEdges || []).find((e) => e.id === edgeId);
  const nodes = nodeMap(doc);
  const a = nodes.get(edge?.fromNode);
  const b = nodes.get(edge?.toNode);
  if (!a || !b) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 2 * MIN_ROUTE_SEGMENT) return null;
  const margin = MIN_ROUTE_SEGMENT / len;
  const raw = ((point.x - a.x) * dx + (point.y - a.y) * dy) / (len * len);
  const t = Math.min(1 - margin, Math.max(margin, raw));
  return { x: a.x + t * dx, y: a.y + t * dy, t };
}

/**
 * Lift (or lower) a node as a true vertical step, the way the services mock draws
 * a rise: a 90 degree change at one point in the profile, never a slope.
 *
 *  - A node in the middle of a route is split in two at the same X/Y: the run
 *    behind it stays on the original node, the run ahead moves onto the new
 *    node, and a vertical run joins them. Route order is the profile's order.
 *    The route ahead, up to its next step or its end, is lifted with it so the
 *    new height carries on level (the mock's rise to the water heater).
 *  - A node already at a step (its neighbour shares its X/Y) just has its
 *    height changed, so dragging a rise's top makes the rise taller.
 *  - An end of a route gets an ordinary rise / drop.
 */
export function liftNode(doc, pack, nodeId, delta, routeEdgeId) {
  ensureArrays(doc);
  const node = doc.serviceNodes.find((n) => n.id === nodeId);
  if (!node) return fail("Select a route node first.");
  if (!isNum(delta) || Math.abs(delta) < 1e-6) return fail("That is the same height.");
  if (!isNum(node.offset)) return fail("This node has no stated height. Set its offset first.");

  const nodes = nodeMap(doc);
  const path = routePath(doc, routeEdgeId);
  const idx = path.nodeIds.indexOf(nodeId);
  const prev = nodes.get(path.nodeIds[idx - 1]);
  const next = nodes.get(path.nodeIds[idx + 1]);
  if (idx <= 0 || idx >= path.nodeIds.length - 1) {
    return createRiser(doc, pack, nodeId, { delta });
  }
  // The stretch of route that keeps its shape moves with the lifted node: up to
  // the next step (or the route's end), so no run is left sloping back down.
  const shiftAhead = (from) => {
    for (let i = from; i < path.nodeIds.length; i += 1) {
      const n = nodes.get(path.nodeIds[i]);
      if (!n) break;
      if (isNum(n.offset)) n.offset += delta;
      const nx = nodes.get(path.nodeIds[i + 1]);
      if (!nx || isRiserPair(n, nx)) break;
    }
  };
  const shiftBehind = (from) => {
    for (let i = from; i >= 0; i -= 1) {
      const n = nodes.get(path.nodeIds[i]);
      if (!n) break;
      if (isNum(n.offset)) n.offset += delta;
      const pv = nodes.get(path.nodeIds[i - 1]);
      if (!pv || isRiserPair(pv, n)) break;
    }
  };
  if (isRiserPair(prev, node) || isRiserPair(node, next)) {
    // At an existing step: lifting changes that step's size.
    if (isRiserPair(prev, node)) shiftAhead(idx);
    else shiftBehind(idx);
    return { ok: true, message: `Height ${delta > 0 ? "raised" : "lowered"} by ${Math.abs(delta).toFixed(2)} m.`, nodeId, createdNode: false };
  }

  const lifted = {
    id: nid("sv"), networkId: node.networkId, x: node.x, y: node.y, level: node.level,
    offset: node.offset + delta, connectedRef: null,
  };
  const ahead = doc.serviceEdges.find((e) => e.id === path.edgeIds[idx]);
  if (!ahead) return fail("That run has lost an end.");
  doc.serviceNodes.push(lifted);
  shiftAhead(idx + 1);
  const sku = ahead.sku;
  if (ahead.fromNode === nodeId) ahead.fromNode = lifted.id;
  else ahead.toNode = lifted.id;
  doc.serviceEdges.push({
    id: nid("se"), networkId: node.networkId, fromNode: nodeId, toNode: lifted.id, sku, mode: "measured",
  });
  return {
    ok: true,
    message: `${delta > 0 ? "Rise" : "Drop"} of ${Math.abs(delta).toFixed(2)} m.`,
    nodeId: lifted.id,
    createdNode: true,
  };
}

/**
 * Lift (or lower) one whole run, however it is connected. An end with nothing
 * else on it simply moves up with the run. An end that other plan runs meet is
 * left where it is and a vertical step joins it to the lifted end, so the
 * neighbours keep their height. An end already on a riser makes that riser
 * taller or shorter.
 */
export function liftRun(doc, pack, edgeId, delta) {
  ensureArrays(doc);
  const edge = doc.serviceEdges.find((e) => e.id === edgeId);
  if (!edge) return fail("Select a route run first.");
  if (!isNum(delta) || Math.abs(delta) < 1e-6) return fail("That is the same height.");
  const nodes = nodeMap(doc);
  const a = nodes.get(edge.fromNode);
  const b = nodes.get(edge.toNode);
  if (!a || !b) return fail("That run has lost an end.");
  if (isRiserPair(a, b)) return fail("That is a rise. Lift its top point instead.");
  if (!isNum(a.offset) || !isNum(b.offset)) return fail("This run has no stated height. Set its offset first.");
  const touching = (n) => doc.serviceEdges.filter((e) => e.id !== edge.id && (e.fromNode === n.id || e.toNode === n.id));
  for (const [n, key] of [[a, "fromNode"], [b, "toNode"]]) {
    const others = touching(n);
    const planOthers = others.filter((e) => {
      const o = nodes.get(e.fromNode === n.id ? e.toNode : e.fromNode);
      return o && !isRiserPair(n, o);
    });
    if (planOthers.length && !others.some((e) => {
      const o = nodes.get(e.fromNode === n.id ? e.toNode : e.fromNode);
      return o && isRiserPair(n, o);
    })) {
      const lifted = {
        id: nid("sv"), networkId: n.networkId, x: n.x, y: n.y, level: n.level,
        offset: n.offset + delta, connectedRef: null,
      };
      doc.serviceNodes.push(lifted);
      edge[key] = lifted.id;
      doc.serviceEdges.push({
        id: nid("se"), networkId: n.networkId, fromNode: n.id, toNode: lifted.id, sku: edge.sku, mode: "measured",
      });
    } else {
      n.offset += delta;
    }
  }
  return { ok: true, message: `Run ${delta > 0 ? "raised" : "lowered"} by ${Math.abs(delta).toFixed(2)} m.`, nodeId: null, createdNode: false };
}

/**
 * Add a node part-way along a run, as a GIS vertex tool does: the run is split
 * in two at the point on it nearest `point`, both halves keep its type, mode and
 * direction. The new node's height continues the run (straight-line between the
 * ends); an end with no stated height leaves it unresolved rather than guessed.
 * A vertical run (a riser) has no plan length to split, so it is refused.
 */
export function splitServiceEdge(doc, pack, edgeId, point) {
  ensureArrays(doc);
  const edge = doc.serviceEdges.find((e) => e.id === edgeId);
  if (!edge) return fail("Click on a route run to add a node.");
  const nodes = nodeMap(doc);
  const a = nodes.get(edge.fromNode);
  const b = nodes.get(edge.toNode);
  if (!a || !b) return fail("That run has lost an end.");
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (Math.sqrt(len2) < 2 * MIN_ROUTE_SEGMENT) return fail("That run is too short to split.");
  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2;
  const margin = MIN_ROUTE_SEGMENT / Math.sqrt(len2);
  t = Math.min(1 - margin, Math.max(margin, t));

  let offset = null;
  const dz = verticalDelta(pack, a, b);
  if (isNum(a.offset) && dz !== null) offset = a.offset + t * dz;
  const node = {
    id: nid("sv"),
    networkId: edge.networkId,
    x: a.x + t * dx,
    y: a.y + t * dy,
    level: a.level,
    offset,
    connectedRef: null,
  };
  doc.serviceNodes.push(node);
  const second = {
    id: nid("se"), networkId: edge.networkId, fromNode: node.id, toNode: b.id, sku: edge.sku, mode: edge.mode,
    ...(edge.chase === true ? { chase: true } : {}),
  };
  edge.toNode = node.id;
  doc.serviceEdges.push(second);
  return { ok: true, message: "Node added.", nodeId: node.id, edgeId: edge.id, createdNode: true };
}

/**
 * Remove one node the way a GIS vertex delete does. A node joining exactly two
 * ordinary runs is dissolved and the runs are healed into one (keeping the first
 * run's type); an end, junction or riser node is deleted with its runs, as
 * deleteServiceRefs does, because there is no single run to heal into.
 */
export function removeServiceNode(doc, nodeId) {
  ensureArrays(doc);
  const nodes = nodeMap(doc);
  const node = nodes.get(nodeId);
  if (!node) return fail("Select a route node first.");
  const touching = doc.serviceEdges.filter((e) => e.fromNode === nodeId || e.toNode === nodeId);
  if (touching.length === 2) {
    const [e1, e2] = touching;
    const other = (e) => (e.fromNode === nodeId ? e.toNode : e.fromNode);
    const a = nodes.get(other(e1));
    const b = nodes.get(other(e2));
    const vertical = isRiserPair(a, node) || isRiserPair(node, b);
    if (a && b && a.id !== b.id && !vertical && !edgeBetween(doc, node.networkId, a.id, b.id)) {
      // Keep flow direction: the run that arrives first stays first.
      const first = e1.toNode === nodeId ? e1 : e2.toNode === nodeId ? e2 : e1;
      const second = first === e1 ? e2 : e1;
      if (first.toNode === nodeId) first.toNode = other(second);
      else first.fromNode = other(second);
      doc.serviceEdges = doc.serviceEdges.filter((e) => e.id !== second.id);
      doc.serviceNodes = doc.serviceNodes.filter((n) => n.id !== nodeId);
      return { ok: true, message: "Node removed; the run is joined up.", healed: true };
    }
  }
  deleteServiceRefs(doc, [{ kind: "serviceNode", id: nodeId }]);
  return { ok: true, message: "Node removed.", healed: false };
}

function incidentSku(doc, nodeId) {
  const edges = (doc.serviceEdges || []).filter((e) => e.fromNode === nodeId || e.toNode === nodeId);
  return edges.map((e) => e.sku).filter(Boolean).pop() ?? null;
}

/**
 * Rise / drop from a node.
 *
 * `spec` is either { delta } (relative: metres above this node, negative to
 * drop) or { level, offset } (destination level plus offset from that level's
 * datum). Both end the same way: a second node at the same X/Y and a different
 * absolute Z, joined by one measured edge. The edge inherits the type of the run
 * it continues; if that run has none, it has none either.
 *
 * `connectItemId` additionally connects the new node to a placed component.
 */
export function createRiser(doc, pack, nodeId, spec = {}, { centreOf = (item) => itemCentre(pack, item) } = {}) {
  ensureArrays(doc);
  const node = doc.serviceNodes.find((n) => n.id === nodeId);
  if (!node) return fail("Select a service node first.");

  const fromLevel = nodeLevel(pack, node);
  let level = fromLevel;
  let offset;
  if (spec.level != null && spec.level !== "") {
    level = spec.level;
    offset = Number(spec.offset);
    if (!isNum(offset)) return fail("Enter the offset from the destination level, in metres.");
    if (levelElevationOf(pack, level) === null) return fail(`"${level}" is not a level in this drawing.`);
  } else {
    const delta = Number(spec.delta);
    if (!isNum(delta) || delta === 0) return fail("Enter a rise (positive) or a drop (negative) in metres.");
    if (!isNum(node.offset)) return fail("This node has no stated height. Set its offset first.");
    offset = node.offset + delta;
  }
  if (spec.connectItemId) {
    const item = objectByRef(doc, { kind: "item", id: spec.connectItemId });
    if (!item) return fail("That component is not in the drawing.");
    if (effectiveLevel(item, pack) !== level) {
      return fail(`That component is on ${levelNameOf(pack, effectiveLevel(item, pack))}, not ${levelNameOf(pack, level)}.`);
    }
  }

  const probe = { ...node, level, offset };
  const dz = verticalDelta(pack, node, probe);
  if (dz === null) return fail("The height of that level is unknown, so the rise cannot be measured.");
  if (Math.abs(dz) < 1e-9) return fail("That is the same height as this node. A riser needs a vertical change.");

  // Reuse a node already waiting at that height rather than stacking a twin.
  let target = doc.serviceNodes.find((n) => n.networkId === node.networkId && n.id !== node.id
    && nodeLevel(pack, n) === level && n.offset === offset
    && Math.hypot(n.x - node.x, n.y - node.y) <= RISER_EPS);
  let created = false;
  if (!target) {
    target = {
      id: nid("sv"), networkId: node.networkId, x: node.x, y: node.y, level, offset, connectedRef: null,
    };
    doc.serviceNodes.push(target);
    created = true;
  }
  let edge = edgeBetween(doc, node.networkId, node.id, target.id);
  if (!edge) {
    edge = {
      id: nid("se"),
      networkId: node.networkId,
      fromNode: node.id,
      toNode: target.id,
      sku: incidentSku(doc, node.id),
      mode: "measured",
    };
    doc.serviceEdges.push(edge);
  }
  if (spec.connectItemId) {
    const connected = connectNode(doc, pack, target.id, spec.connectItemId, { centreOf });
    if (!connected.ok) return connected;
  }
  return {
    ok: true,
    message: `${dz > 0 ? "Rise" : "Drop"} of ${Math.abs(dz).toFixed(2)} m.`,
    nodeId: target.id,
    edgeId: edge.id,
    createdNode: created,
  };
}

/**
 * Connect a node to a placed component: the node moves (with its riser column,
 * keeping every height) onto the component's centre and remembers it. It must be
 * on the component's level; the component carries no height of its own, so the
 * node's offset is left exactly as it was.
 */
export function connectNode(doc, pack, nodeId, itemId, { centreOf = (item) => itemCentre(pack, item) } = {}) {
  const node = (doc.serviceNodes || []).find((n) => n.id === nodeId);
  if (!node) return fail("Select a service node first.");
  const item = objectByRef(doc, { kind: "item", id: itemId });
  if (!item) return fail("That component is not in the drawing.");
  const itemLevel = effectiveLevel(item, pack);
  if (nodeLevel(pack, node) !== itemLevel) {
    return fail(`The component is on ${levelNameOf(pack, itemLevel)} and the node is on ${levelNameOf(pack, nodeLevel(pack, node))}. Use Rise / drop to reach that level first.`);
  }
  const centre = centreOf(item);
  if (!centre) return fail("That component's type is unknown, so its connection point cannot be placed.");
  moveServiceNode(doc, nodeId, centre.x, centre.y);
  node.connectedRef = { kind: "item", id: item.id };
  return { ok: true, message: "Connected.", nodeId };
}

export function disconnectNode(doc, nodeId) {
  const node = (doc.serviceNodes || []).find((n) => n.id === nodeId);
  if (!node || !node.connectedRef) return fail("That node is not connected to anything.");
  node.connectedRef = null;
  return { ok: true, message: "Disconnected." };
}

/**
 * After components move, pull the nodes connected to them along. Returns how
 * many nodes moved. Heights are untouched.
 */
export function rehomeConnectedNodes(doc, pack, { centreOf = (item) => itemCentre(pack, item) } = {}) {
  let moved = 0;
  for (const node of doc.serviceNodes || []) {
    if (!node.connectedRef) continue;
    const item = objectByRef(doc, node.connectedRef);
    const centre = item ? centreOf(item) : null;
    if (!centre || Math.hypot(centre.x - node.x, centre.y - node.y) < 1e-9) continue;
    moveServiceNode(doc, node.id, centre.x, centre.y);
    moved += 1;
  }
  return moved;
}

export function setNodeOffset(doc, nodeId, offset) {
  const node = (doc.serviceNodes || []).find((n) => n.id === nodeId);
  if (!node) return fail("Select a service node first.");
  const value = offset === null || offset === "" ? null : Number(offset);
  if (value !== null && !isNum(value)) return fail("Offset must be a number of metres.");
  node.offset = value;
  return { ok: true, message: "" };
}

export function setNodeLevel(doc, pack, nodeId, levelId) {
  const node = (doc.serviceNodes || []).find((n) => n.id === nodeId);
  if (!node) return fail("Select a service node first.");
  if (levelElevationOf(pack, levelId) === null) return fail(`"${levelId}" is not a level in this drawing.`);
  node.level = levelId;
  return { ok: true, message: "" };
}

export function setEdgeSku(doc, edgeIds, sku) {
  let n = 0;
  for (const edge of doc.serviceEdges || []) {
    if (!edgeIds.includes(edge.id)) continue;
    edge.sku = sku || null;
    n += 1;
  }
  return n ? { ok: true, message: `${n} run${n === 1 ? "" : "s"} retyped.` } : fail("Select a route first.");
}

export function setEdgeMode(doc, edgeIds, mode) {
  if (mode !== "measured" && mode !== "schematic") return fail("Unknown mode.");
  let n = 0;
  for (const edge of doc.serviceEdges || []) {
    if (!edgeIds.includes(edge.id)) continue;
    edge.mode = mode;
    n += 1;
  }
  return n ? { ok: true, message: "" } : fail("Select a route first.");
}

/** Say whether runs sit in a chase or cavity (true) or are ordinary runs (false). */
export function setEdgeChase(doc, edgeIds, chase) {
  let n = 0;
  for (const edge of doc.serviceEdges || []) {
    if (!edgeIds.includes(edge.id)) continue;
    if (chase) edge.chase = true;
    else delete edge.chase;
    n += 1;
  }
  return n
    ? { ok: true, message: chase ? "Marked as in a chase." : "No longer marked as in a chase." }
    : fail("Select a route first.");
}

/** Flow direction is from -> to; reversing swaps the ends. */
export function reverseEdge(doc, edgeId) {
  const edge = (doc.serviceEdges || []).find((e) => e.id === edgeId);
  if (!edge) return fail("Select a route first.");
  [edge.fromNode, edge.toNode] = [edge.toNode, edge.fromNode];
  return { ok: true, message: "Flow direction reversed." };
}

export function setNetworkProps(doc, networkId, { name, status } = {}) {
  const network = networkOf(doc, networkId);
  if (!network) return fail("No such network.");
  if (typeof name === "string" && name.trim()) network.name = name.trim();
  if (status === "existing" || status === "planned") network.status = status;
  return { ok: true, message: "" };
}

/**
 * Delete service refs, with the clean-up a bare splice would miss: a node takes
 * its edges with it, an edge leaves no stranded node behind, and a network with
 * nothing left in it goes too.
 */
export function deleteServiceRefs(doc, refs) {
  ensureArrays(doc);
  const nodeIds = new Set(refs.filter((r) => r.kind === "serviceNode").map((r) => r.id));
  const edgeIds = new Set(refs.filter((r) => r.kind === "serviceEdge").map((r) => r.id));
  if (!nodeIds.size && !edgeIds.size) return 0;
  const endpoints = new Set();
  for (const e of doc.serviceEdges) {
    if (edgeIds.has(e.id)) {
      endpoints.add(e.fromNode);
      endpoints.add(e.toNode);
    }
  }
  doc.serviceEdges = doc.serviceEdges.filter((e) => !edgeIds.has(e.id) && !nodeIds.has(e.fromNode) && !nodeIds.has(e.toNode));
  const used = new Set(doc.serviceEdges.flatMap((e) => [e.fromNode, e.toNode]));
  doc.serviceNodes = doc.serviceNodes.filter((n) => !nodeIds.has(n.id) && (used.has(n.id) || !endpoints.has(n.id)));
  const live = new Set(doc.serviceNodes.map((n) => n.networkId));
  doc.serviceNetworks = doc.serviceNetworks.filter((n) => live.has(n.id));
  return nodeIds.size + edgeIds.size;
}

/** Why a modify command (rotate, copy, align...) cannot act on a service selection, or null. */
export function modifyRefusal(refs) {
  if (!(refs || []).some((r) => r.kind === "serviceNode" || r.kind === "serviceEdge")) return null;
  return "Service routes keep their risers vertical, so they cannot be rotated, mirrored, copied, aligned or split yet. Move them, or edit the route in the inspector.";
}

// --- drainage ---------------------------------------------------------------

/** Parse "1:60", "1.7%" or a plain ratio like 0.0167. Null when it is none of those. */
export function parseGradient(text) {
  const s = String(text ?? "").trim().replace(",", ".");
  let m = /^1\s*[:/]\s*(\d+(?:\.\d+)?)$/.exec(s);
  if (m && Number(m[1]) > 0) return 1 / Number(m[1]);
  m = /^(\d+(?:\.\d+)?)\s*%$/.exec(s);
  if (m && Number(m[1]) > 0) return Number(m[1]) / 100;
  m = /^0?\.\d+$/.exec(s);
  if (m && Number(s) > 0) return Number(s);
  return null;
}

export function formatGradient(ratio) {
  if (!isNum(ratio) || ratio === 0) return "flat";
  return `1:${Math.round(1 / Math.abs(ratio))}`;
}

/**
 * Set the fall of a drainage run by moving its downstream end to the height the
 * gradient implies. Flow is from -> to, so `to` is downstream. The upstream end
 * stays exactly where it is. Writes a stated height (an offset), never a slope.
 *
 * Refused where it would mean guessing: not drainage, no plan run, an upstream
 * height that is not stated, or an edge that crosses levels (its fall is then a
 * riser, not a gradient).
 */
export function applyDrainageFall(doc, pack, edgeId, gradient) {
  const edge = (doc.serviceEdges || []).find((e) => e.id === edgeId);
  if (!edge) return fail("Select a drainage run first.");
  if (networkOf(doc, edge.networkId)?.system !== "drainage") return fail("Slope applies to drainage runs.");
  if (!isNum(gradient) || gradient <= 0) return fail("Enter a fall such as 1:60 or 1.7%.");
  const nodes = nodeMap(doc);
  const from = nodes.get(edge.fromNode);
  const to = nodes.get(edge.toNode);
  const plan = Math.hypot(to.x - from.x, to.y - from.y);
  if (plan <= RISER_EPS) return fail("A vertical run has no gradient.");
  if (nodeLevel(pack, from) !== nodeLevel(pack, to)) return fail("This run crosses levels, so its height change is a riser, not a gradient.");
  if (!isNum(from.offset)) return fail("The upstream end has no stated height. Set its offset first.");
  to.offset = from.offset - gradient * plan;
  return { ok: true, message: `Fall of ${formatGradient(gradient)} set; downstream end is ${to.offset.toFixed(3)} m from datum.` };
}

/**
 * Drainage findings, from the stored heights and the SKU's own stated facts.
 *
 *  - warn  `elevations-unresolved`  a height the gradient needs is not known
 *  - warn  `uphill`                  the run rises in the direction of flow
 *  - warn  `below-min-gradient`      flatter than the SKU's stated minimum
 *  - warn  `divergent-flow`          a node sends flow two ways
 *  - info  `no-min-gradient`         the SKU states no minimum, so cannot check
 *  - info  `no-type`                 no SKU on the run, so no minimum to check
 *
 * `minGradient` is read as a ratio (1/60 for 1:60), the form the pack's own test
 * fixture states it in. A null is "cannot check", never a pass.
 */
export function drainageReport(doc, pack) {
  const findings = [];
  const nodes = nodeMap(doc);
  const outflow = new Map();
  for (const edge of doc.serviceEdges || []) {
    if (networkOf(doc, edge.networkId)?.system !== "drainage") continue;
    const m = edgeMeasure(doc, pack, edge, nodes);
    if (!m) continue;
    const net = networkOf(doc, edge.networkId);
    const where = `${net.name}`;
    const push = (severity, code, message) => findings.push({
      severity, code, edgeId: edge.id, networkId: edge.networkId, message: `${where}: ${message}`,
    });
    if (m.degenerate) continue;
    if (m.dz === null) {
      push("warn", "elevations-unresolved", "a run's heights are not all stated (offset or level missing), so its fall cannot be checked.");
      continue;
    }
    // Flow runs from -> to. Rising along the flow is wrong whatever the SKU says.
    if (m.dz > 1e-9) {
      push("warn", "uphill", `a ${m.vertical ? "stack" : "run"} rises ${m.dz.toFixed(2)} m in the direction of flow. Reverse it or correct the heights.`);
    }
    if (!m.vertical) {
      const sku = (pack?.skus || []).find((s) => s.id === edge.sku);
      const fall = -m.dz / m.plan;
      if (!sku) {
        push("info", "no-type", "no pipe type chosen, so no minimum gradient to check against.");
      } else if (!isNum(sku.compliance?.minGradient)) {
        push("info", "no-min-gradient", `${sku.name} states no minimum gradient, so the fall cannot be checked.`);
      } else if (m.dz <= 1e-9 && fall < sku.compliance.minGradient - 1e-9) {
        push("warn", "below-min-gradient", `fall ${formatGradient(fall)} is flatter than the ${formatGradient(sku.compliance.minGradient)} minimum stated for ${sku.name}.`);
      }
    }
    outflow.set(edge.fromNode, (outflow.get(edge.fromNode) || 0) + 1);
  }
  for (const [nodeId, count] of outflow) {
    if (count < 2) continue;
    const node = nodes.get(nodeId);
    findings.push({
      severity: "warn",
      code: "divergent-flow",
      edgeId: null,
      nodeId,
      networkId: node.networkId,
      message: `${networkOf(doc, node.networkId).name}: flow leaves one point two ways. A drain falls to one outlet; reverse one run.`,
    });
  }
  return findings;
}

/**
 * A run's grade as a QS writes it: "1:60 fall", "1:10 rise" or "level", taken
 * along the run's own direction (its from node to its to node). Null for a
 * riser or an unresolved run, which have no grade to state.
 */
export function runGradient(slope) {
  if (!isNum(slope)) return null;
  if (Math.abs(slope) < 1e-4) return "level";
  return `${formatGradient(slope)} ${slope < 0 ? "fall" : "rise"}`;
}

// --- bends ------------------------------------------------------------------

/** Standard fitting angles, degrees of deflection from straight. */
export const BEND_CLASSES = [90, 45, 22.5, 11.25];
/** A deflection under this is a straight run, not a bend. */
export const BEND_STRAIGHT_DEG = 1;
/** How far from a standard angle a bend may be and still take that fitting. */
export const BEND_TOLERANCE_DEG = 2;

/**
 * Deflection, in degrees, of a route that arrives at a node along `inDir` and
 * leaves along `outDir` (both 3D, pointing the way the route travels). 0 is
 * dead straight; a riser meeting a horizontal run is 90.
 */
export function bendDeflection(inDir, outDir) {
  const la = Math.hypot(...inDir);
  const lb = Math.hypot(...outDir);
  if (la < 1e-9 || lb < 1e-9) return null;
  const dot = (inDir[0] * outDir[0] + inDir[1] * outDir[1] + inDir[2] * outDir[2]) / (la * lb);
  return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
}

/**
 * The standard class a deflection falls in, or null when it matches none. A
 * non-standard angle is reported as itself rather than rounded to the nearest
 * fitting, because a 70 degree bend is not a 90 and a QS must be told.
 */
export function bendClass(deg) {
  return BEND_CLASSES.find((c) => Math.abs(deg - c) <= BEND_TOLERANCE_DEG) ?? null;
}

/**
 * One bend per node where exactly two counted runs of one network meet and
 * the route changes direction. A junction (three or more runs) is not a bend,
 * and a run whose heights are unresolved has no direction, so neither is guessed.
 *
 * Where the two runs are different pipe types the node is a transition (an
 * adaptor or reducer), not a bend; it is reported with `mixed` and no `skuId`.
 */
export function serviceBends(doc, pack, runs) {
  const nodes = nodeMap(doc);
  const byNode = new Map();
  for (const run of runs) {
    if (!run.include) continue;
    for (const id of [run.edge.fromNode, run.edge.toNode]) {
      if (!byNode.has(id)) byNode.set(id, []);
      byNode.get(id).push(run);
    }
  }
  // Runs that are not counted (schematic, no type) still make a node a junction.
  const degree = new Map();
  for (const e of doc.serviceEdges || []) {
    for (const id of [e.fromNode, e.toNode]) degree.set(id, (degree.get(id) || 0) + 1);
  }

  const bends = [];
  for (const [nodeId, here] of byNode) {
    if (here.length !== 2 || degree.get(nodeId) !== 2) continue;
    const [a, b] = here;
    if (a.edge.networkId !== b.edge.networkId) continue;
    const node = nodes.get(nodeId);
    if (!node) continue;
    // Each run's vector, pointing away from this node.
    const away = (run) => {
      const m = run.measure;
      const other = m.from.id === nodeId ? m.to : m.from;
      const dz = verticalDelta(pack, node, other);
      if (dz === null) return null;
      return [other.x - node.x, other.y - node.y, dz];
    };
    const va = away(a);
    const vb = away(b);
    if (!va || !vb) continue;
    // Travelling in along one run and out along the other: reverse the first.
    const deflection = bendDeflection([-va[0], -va[1], -va[2]], vb);
    if (deflection === null || deflection < BEND_STRAIGHT_DEG) continue;
    const mixed = a.edge.sku !== b.edge.sku;
    bends.push({
      nodeId,
      networkId: a.edge.networkId,
      edgeIds: [a.edge.id, b.edge.id],
      skuId: mixed ? null : a.edge.sku,
      mixed,
      angle: deflection,
      standard: bendClass(deflection),
      level: nodeLevel(pack, node),
    });
  }
  return bends;
}

// --- takeoff ----------------------------------------------------------------

function skuIn(pack, id) {
  return (pack?.skus || []).find((s) => s.id === id) || null;
}

/**
 * What the BOM counts. One result per edge, in document order.
 *
 * Each edge is counted once, by construction: it is one row in doc.serviceEdges,
 * so a riser that joins level 1 to level 2 is neither "level 1's" nor "level 2's"
 * length - the per-level views only draw it. A duplicate run (the same two nodes)
 * is refused by normalisation and checked here again as a backstop.
 *
 * Schematic edges are drawn and measured for display but never reach material
 * length. `wasteFactor`, where the SKU states one, produces `orderLength`
 * *after* the measured length, as material wastage only; it is never folded into
 * `length` and never used as a route allowance.
 */
export function serviceTakeoff(doc, pack) {
  const nodes = nodeMap(doc);
  const runs = [];
  const warnings = [];
  const seen = new Set();
  const networks = new Map((doc.serviceNetworks || []).map((n) => [n.id, {
    id: n.id,
    name: n.name,
    system: n.system,
    status: n.status,
    levels: networkLevels(doc, pack, n.id),
    measuredLength: 0,
    horizontalLength: 0,
    verticalLength: 0,
    schematicLength: 0,
    runs: 0,
    bends: 0,
  }]));

  for (const edge of doc.serviceEdges || []) {
    const network = networks.get(edge.networkId);
    const m = edgeMeasure(doc, pack, edge, nodes);
    if (!network || !m) continue;
    const pairKey = edgePairKey(edge.networkId, edge.fromNode, edge.toNode);
    if (seen.has(pairKey)) {
      warnings.push(`${network.name}: two runs join the same two points; the duplicate is not counted.`);
      continue;
    }
    seen.add(pairKey);
    const result = { edge, measure: m, network, sku: null, include: false, reason: null };
    runs.push(result);

    if (edge.mode === "schematic") {
      result.reason = "schematic";
      if (m.length !== null) network.schematicLength += m.length;
      continue;
    }
    if (m.degenerate) {
      result.reason = "degenerate";
      continue;
    }
    if (m.length === null) {
      result.reason = "unresolved";
      warnings.push(`${network.name}: a run's heights are not all stated, so its 3D length is unknown and it is not counted.`);
      continue;
    }
    if (!edge.sku) {
      result.reason = "no-type";
      warnings.push(`${network.name}: a ${m.length.toFixed(2)} m run has no pipe or conduit type chosen, so it is not counted.`);
      continue;
    }
    const sku = skuIn(pack, edge.sku);
    if (!sku) {
      result.reason = "unknown-sku";
      warnings.push(`${network.name}: a run uses "${edge.sku}", which is not in this template, so it is not counted.`);
      continue;
    }
    if (sku.unit !== "m" || !(sku.schedule?.report || []).includes("length")) {
      result.reason = "not-linear";
      warnings.push(`${network.name}: ${sku.name} is not a length-measured type, so the run is not counted.`);
      continue;
    }
    result.sku = sku;
    result.include = true;
    const wf = sku.cost?.wasteFactor;
    result.orderLength = isNum(wf) && wf >= 0 ? m.length * (1 + wf) : null;
    network.measuredLength += m.length;
    network.horizontalLength += m.plan;
    network.verticalLength += Math.abs(m.dz);
    network.runs += 1;
  }

  const bends = serviceBends(doc, pack, runs);
  for (const bend of bends) {
    const network = networks.get(bend.networkId);
    if (bend.mixed) {
      warnings.push(`${network?.name || "Route"}: the pipe type changes at a ${bend.angle.toFixed(0)}° turn, so it needs an adaptor, not a bend. It is not counted.`);
    } else if (network) {
      network.bends += 1;
    }
  }

  const report = drainageReport(doc, pack);
  // `elevations-unresolved` is already said above for a measured run; the rest
  // are drainage-specific and belong beside it.
  for (const f of report) {
    if (f.severity === "warn" && f.code !== "elevations-unresolved") warnings.push(f.message);
  }
  return { runs, bends, warnings, networks: [...networks.values()], drainage: report };
}

// --- route profile ----------------------------------------------------------

/**
 * The straight run of a route through `edgeId`, as an ordered list of nodes.
 * It extends both ways until it meets a junction or an end (a node with other
 * than two edges), so the profile follows "this pipe", not the whole network.
 */
export function routePath(doc, edgeId) {
  const edges = doc.serviceEdges || [];
  const start = edges.find((e) => e.id === edgeId);
  if (!start) return { nodeIds: [], edgeIds: [] };
  const incident = (nodeId) => edges.filter((e) => e.fromNode === nodeId || e.toNode === nodeId);
  const other = (e, nodeId) => (e.fromNode === nodeId ? e.toNode : e.fromNode);

  const nodeIds = [start.fromNode, start.toNode];
  const edgeIds = [start.id];
  const visited = new Set(edgeIds);
  const extend = (end, push) => {
    let cur = end;
    for (;;) {
      const here = incident(cur);
      if (here.length !== 2) return;
      const next = here.find((e) => !visited.has(e.id));
      if (!next) return;
      visited.add(next.id);
      cur = other(next, cur);
      push(cur, next.id);
    }
  };
  extend(start.toNode, (n, e) => { nodeIds.push(n); edgeIds.push(e); });
  extend(start.fromNode, (n, e) => { nodeIds.unshift(n); edgeIds.unshift(e); });
  return { nodeIds, edgeIds };
}

/**
 * Profile of a route: absolute Z against distance along the plan, with the
 * level datums it crosses. A rise is a vertical step at one chainage, exactly as
 * the mock draws it. Points whose height is unresolved carry z: null and are
 * skipped by the drawing.
 */
export function routeProfile(doc, pack, edgeId) {
  const { nodeIds, edgeIds } = routePath(doc, edgeId);
  const nodes = nodeMap(doc);
  const points = [];
  let chainage = 0;
  let prev = null;
  for (const id of nodeIds) {
    const n = nodes.get(id);
    if (!n) continue;
    if (prev) chainage += Math.hypot(n.x - prev.x, n.y - prev.y);
    points.push({
      nodeId: id,
      s: chainage,
      z: nodeAbsoluteZ(pack, n),
      level: nodeLevel(pack, n),
      connected: Boolean(n.connectedRef),
    });
    prev = n;
  }
  const zs = points.map((p) => p.z).filter(isNum);
  const levels = (pack?.levels || [])
    .filter((l) => isNum(l.elevation))
    .map((l) => ({ id: l.id, name: l.name || l.id, elevation: l.elevation }));
  return {
    edgeIds,
    points,
    levels,
    chainage,
    zMin: zs.length ? Math.min(...zs) : null,
    zMax: zs.length ? Math.max(...zs) : null,
    resolved: points.length > 1 && points.every((p) => isNum(p.z)),
  };
}

/** Where, in plan, an element sits - for "Show on plan" from a schedule. */
export function serviceElementCentre(doc, ref) {
  if (ref.kind === "serviceNode") {
    const n = (doc.serviceNodes || []).find((x) => x.id === ref.id);
    return n ? { x: n.x, y: n.y } : null;
  }
  const e = (doc.serviceEdges || []).find((x) => x.id === ref.id);
  const nodes = nodeMap(doc);
  const a = nodes.get(e?.fromNode);
  const b = nodes.get(e?.toNode);
  return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
}

export { SERVICE_SYSTEMS, SERVICE_SYSTEM_INFO };
