// Service routing: vocabulary and document normalisation.
//
// 2.5D services are three normalised collections on the document:
//
//   serviceNetworks  { id, name, system, status }
//   serviceNodes     { id, networkId, x, y, level, offset, connectedRef }
//   serviceEdges     { id, networkId, fromNode, toNode, sku, mode }
//
// A node's height is `offset`, metres relative to ITS LEVEL's datum - never an
// absolute elevation. Absolute Z and every length are derived (services.js), so
// moving a level or editing an offset can never leave a stale stored number
// behind. That is the same reason walls store a level id, not a Z.
//
// This module deliberately imports nothing from model.js: model.js's
// normalizeDoc() calls it, and the codebase already avoids import cycles through
// `nid` (see the comments around sections/callouts there).
//
// Normalisation follows the rest of normalizeDoc's rule: a malformed row is
// dropped rather than kept half-formed, and a reference to something that no
// longer exists is cleared rather than trusted. Unknown is null, never a
// plausible default - in particular a node with no stated offset keeps
// `offset: null` (unresolved) instead of being quietly put on the floor.

export const SERVICE_SYSTEMS = ["coldWater", "hotWater", "drainage", "electrical", "gas"];

/**
 * Presentation facts only. Colours follow the mock (web/start/services-25d-mock.html);
 * `prefix` is the short tag used on route labels (CW-01). Nothing here is a
 * catalogue fact: which SKU a route uses is always a user choice.
 */
export const SERVICE_SYSTEM_INFO = {
  coldWater: { label: "Cold water", colour: "#2675b8", prefix: "CW" },
  hotWater: { label: "Hot water", colour: "#c95735", prefix: "HW" },
  drainage: { label: "Drainage", colour: "#796548", prefix: "DR" },
  electrical: { label: "Electrical conduit", colour: "#d79c20", prefix: "EL" },
  gas: { label: "Gas", colour: "#8d5aa7", prefix: "GS" },
};

export const SERVICE_STATUSES = ["existing", "planned"];
export const EDGE_MODES = ["measured", "schematic"];

function id(prefix) {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}`;
}

function finite(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function text(v) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** An unordered pair key, so A->B and B->A are the same physical run. */
export function edgePairKey(networkId, a, b) {
  return a < b ? `${networkId}|${a}|${b}` : `${networkId}|${b}|${a}`;
}

/**
 * Normalise the three service collections from a raw document.
 *
 * `itemIds` is the set of placed components that exist, so a node's
 * `connectedRef` to a deleted component is cleared instead of dangling.
 * Old documents with none of the arrays return three empty arrays.
 */
export function normalizeServices(raw, { itemIds = new Set() } = {}) {
  const list = (v) => (Array.isArray(v) ? v : []);

  const networks = [];
  const networkIds = new Set();
  for (const n of list(raw?.serviceNetworks)) {
    const nid = text(n?.id);
    if (!nid || networkIds.has(nid) || !SERVICE_SYSTEMS.includes(n.system)) continue;
    networkIds.add(nid);
    networks.push({
      id: nid,
      name: text(n.name) || SERVICE_SYSTEM_INFO[n.system].label,
      system: n.system,
      status: n.status === "existing" ? "existing" : "planned",
    });
  }

  const nodes = [];
  const nodeNetwork = new Map();
  for (const n of list(raw?.serviceNodes)) {
    const nodeId = text(n?.id);
    if (!nodeId || nodeNetwork.has(nodeId) || !networkIds.has(n.networkId)) continue;
    const x = finite(n.x);
    const y = finite(n.y);
    if (x === null || y === null) continue;
    const ref = n.connectedRef;
    const connected = ref && ref.kind === "item" && ref.id != null && itemIds.has(ref.id)
      ? { kind: "item", id: ref.id }
      : null;
    nodeNetwork.set(nodeId, n.networkId);
    nodes.push({
      id: nodeId,
      networkId: n.networkId,
      x,
      y,
      level: text(n.level),
      offset: finite(n.offset),
      connectedRef: connected,
    });
  }

  const edges = [];
  const edgeIds = new Set();
  const pairs = new Set();
  for (const e of list(raw?.serviceEdges)) {
    const edgeId = text(e?.id);
    if (!edgeId || edgeIds.has(edgeId) || !networkIds.has(e.networkId)) continue;
    // Both ends must exist, differ, and belong to the edge's own network: a
    // run that crosses networks has no single system to price it under.
    if (e.fromNode === e.toNode) continue;
    if (nodeNetwork.get(e.fromNode) !== e.networkId || nodeNetwork.get(e.toNode) !== e.networkId) continue;
    // One physical run is one edge. A duplicate would count its length twice.
    const key = edgePairKey(e.networkId, e.fromNode, e.toNode);
    if (pairs.has(key)) continue;
    pairs.add(key);
    edgeIds.add(edgeId);
    edges.push({
      id: edgeId,
      networkId: e.networkId,
      fromNode: e.fromNode,
      toNode: e.toNode,
      sku: text(e.sku),
      mode: e.mode === "schematic" ? "schematic" : "measured",
      // Stored only when true: the run is said to sit in a chase or cavity, so
      // being inside a wall is a decision, not a clash (service-walls.js).
      ...(e.chase === true ? { chase: true } : {}),
    });
  }

  return { serviceNetworks: networks, serviceNodes: nodes, serviceEdges: edges };
}

// --- helpers that need only the stored data, no level stack ------------------

/** Plan distance under which two nodes count as one vertical column: 0.1 mm. */
export const RISER_EPS = 1e-4;

/**
 * A riser is two nodes of one network at the same X/Y with different heights
 * (a different level, or the same level at a different offset). Judged from the
 * stored data alone, so it needs no pack - which is what lets the store keep a
 * riser vertical while it is dragged.
 */
export function isRiserPair(a, b) {
  if (!a || !b) return false;
  if (Math.hypot(a.x - b.x, a.y - b.y) > RISER_EPS) return false;
  return (a.level ?? null) !== (b.level ?? null) || a.offset !== b.offset;
}

/**
 * Every node that shares a vertical column with `nodeId` through riser edges,
 * including itself. A through-riser (three storeys) is one column of three.
 */
export function riserColumn(doc, nodeId) {
  const nodes = new Map((doc.serviceNodes || []).map((n) => [n.id, n]));
  if (!nodes.has(nodeId)) return [];
  const column = new Set([nodeId]);
  const queue = [nodeId];
  while (queue.length) {
    const cur = queue.pop();
    for (const e of doc.serviceEdges || []) {
      const other = e.fromNode === cur ? e.toNode : e.toNode === cur ? e.fromNode : null;
      if (!other || column.has(other)) continue;
      if (!isRiserPair(nodes.get(cur), nodes.get(other))) continue;
      column.add(other);
      queue.push(other);
    }
  }
  return [...column];
}

/**
 * Grow a selection so that moving it moves whole risers: an edge brings its two
 * nodes, a node brings its column. Dragging one end of a riser in plan must not
 * leave the other behind, because a riser is defined by sharing X/Y.
 */
export function expandServiceRefs(doc, refs) {
  const out = [];
  const seen = new Set();
  const add = (ref) => {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(ref);
  };
  const edges = new Map((doc.serviceEdges || []).map((e) => [e.id, e]));
  for (const ref of refs) {
    add(ref);
    let nodeIds = [];
    if (ref.kind === "serviceNode") nodeIds = [ref.id];
    else if (ref.kind === "serviceEdge" && edges.has(ref.id)) {
      nodeIds = [edges.get(ref.id).fromNode, edges.get(ref.id).toNode];
    }
    for (const nodeId of nodeIds) {
      for (const member of riserColumn(doc, nodeId)) add({ kind: "serviceNode", id: member });
    }
  }
  return out;
}

/**
 * Re-normalise the service collections in place. Run after anything that can
 * strand a reference: deleting a placed component clears `connectedRef`,
 * deleting a node drops its edges, and so on.
 */
export function pruneServices(doc) {
  Object.assign(doc, normalizeServices(doc, { itemIds: new Set((doc.items || []).map((i) => i.id)) }));
}

/**
 * Systems that have a network on this document, in SERVICE_SYSTEMS order.
 * The plan's show/hide row lists these and nothing else: a system with no
 * route has nothing to hide.
 */
export function serviceSystemsPresent(doc) {
  const have = new Set();
  for (const n of doc?.serviceNetworks || []) {
    if (SERVICE_SYSTEMS.includes(n.system)) have.add(n.system);
  }
  return SERVICE_SYSTEMS.filter((id) => have.has(id));
}

/**
 * Whether a system's routes are drawn. `hidden` is a view choice (a Set of
 * system ids), not a document fact: hiding gas does not delete the gas run.
 * An object with no system stays visible.
 */
export function serviceLayerVisible(system, hidden) {
  if (!system || !hidden) return true;
  return !hidden.has(system);
}
