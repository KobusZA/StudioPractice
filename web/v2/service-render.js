// Canvas drawing for 2.5D services: the plan layer and the route profile.
//
// Visual language follows web/start/services-25d-mock.html: a coloured run per
// system, hollow nodes, a filled disc with an arrow (and a faint ring) where a
// route rises or drops, and a small route label beside it. The mock is the
// reference; what is drawn here is always read back from the document through
// services.js, never kept on the side.
//
// Everything takes the canvas context and a world->screen function rather than
// reaching for ui.js's globals, so the plan editor stays the single owner of
// the camera and this file stays free of DOM state.

import {
  edgeMeasure,
  nodeMap,
  serviceLevelView,
  serviceStatus,
  serviceStyle,
} from "./services.js";

const PAPER = "#fffdf8";

function dashFor(doc, edge) {
  if (edge.mode === "schematic") return [2, 5];
  return serviceStatus(doc, edge) === "existing" ? [10, 4] : [];
}

/**
 * One storey's services. A ghost draws the neighbouring storey faded and plain
 * (runs only): context for aligning this floor's route to the one below, not
 * something to read labels off - the same rule drawPlanLevel applies to walls.
 */
export function drawServiceLevel(ctx, o) {
  const { doc, pack, levelId, worldToScreen, scale, ghost = false, visible = () => true } = o;
  if (!(doc.serviceNodes || []).length) return;
  const view = serviceLevelView(doc, pack, levelId);
  ctx.save();
  if (ghost) ctx.globalAlpha = 0.28;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const m of view.runs) {
    if (!visible(m.edge)) continue;
    const [ax, ay] = worldToScreen(m.from.x, m.from.y);
    const [bx, by] = worldToScreen(m.to.x, m.to.y);
    ctx.strokeStyle = serviceStyle(doc, m.edge).colour;
    ctx.lineWidth = ghost ? 2.5 : 3.5;
    ctx.setLineDash(dashFor(doc, m.edge));
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  if (!ghost) {
    // An edge that leaves this storey at a plan distance: shown as a faint dashed
    // stub so the route reads as continuing, without pretending it is a run here.
    for (const m of view.transitions) {
      if (!visible(m.edge)) continue;
      const [ax, ay] = worldToScreen(m.from.x, m.from.y);
      const [bx, by] = worldToScreen(m.to.x, m.to.y);
      ctx.strokeStyle = serviceStyle(doc, m.edge).colour;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);

    for (const node of view.nodes) {
      if (!visible(node)) continue;
      const [sx, sy] = worldToScreen(node.x, node.y);
      ctx.fillStyle = PAPER;
      ctx.strokeStyle = serviceStyle(doc, node).colour;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      if (node.connectedRef) {
        // A connected node is square: it is a fitting, not a bend.
        ctx.rect(sx - 5, sy - 5, 10, 10);
      } else {
        ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.stroke();
    }

    for (const marker of view.markers) {
      if (!marker.nodeIds.some((id) => visible({ networkId: marker.networkId, id }))) continue;
      drawMarker(ctx, marker, worldToScreen, scale);
    }
  }
  ctx.restore();
}

const ARROW = { up: "↑", down: "↓", through: "↕", riser: "↕" };

function drawMarker(ctx, marker, worldToScreen) {
  const [sx, sy] = worldToScreen(marker.x, marker.y);
  ctx.save();
  ctx.globalAlpha = 0.34;
  ctx.strokeStyle = marker.colour;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(sx, sy, 17, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = marker.colour;
  ctx.beginPath();
  ctx.arc(sx, sy, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "600 14px Source Sans 3, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(ARROW[marker.kind] || "↕", sx, sy + 0.5);
  if (marker.label) {
    ctx.font = "600 11px Source Sans 3, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,253,248,0.9)";
    ctx.strokeText(marker.label, sx + 20, sy - 10);
    ctx.fillStyle = marker.colour;
    ctx.fillText(marker.label, sx + 20, sy - 10);
  }
  ctx.restore();
}

function fmt(n) {
  return `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}`;
}

/** Same ring the plan draws around a selected route point, so a node picked in
 * either view reads as the same selection in the other. */
function strokeSelectionRing(ctx, x, y, colour) {
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** The selection's outline and the numbers a selected run is judged by. */
export function drawServiceSelection(ctx, o) {
  const { doc, pack, refs, worldToScreen, color, levelId } = o;
  const nodes = nodeMap(doc);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  for (const ref of refs) {
    if (ref.kind === "serviceNode") {
      const n = nodes.get(ref.id);
      if (!n) continue;
      const [sx, sy] = worldToScreen(n.x, n.y);
      ctx.beginPath();
      ctx.arc(sx, sy, 11, 0, Math.PI * 2);
      ctx.stroke();
      const z = n.offset == null ? "height unresolved" : `${fmt(n.offset)} m`;
      label(ctx, `${z}`, sx + 14, sy + 16, color);
    } else if (ref.kind === "serviceEdge") {
      const e = (doc.serviceEdges || []).find((x) => x.id === ref.id);
      const m = e ? edgeMeasure(doc, pack, e, nodes) : null;
      if (!m) continue;
      const [ax, ay] = worldToScreen(m.from.x, m.from.y);
      const [bx, by] = worldToScreen(m.to.x, m.to.y);
      if (m.vertical) {
        ctx.beginPath();
        ctx.arc(ax, ay, 21, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }
      if (m.levelFrom !== levelId && m.levelTo !== levelId) continue;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      const text = m.length === null
        ? `${m.plan.toFixed(2)} m plan · height unresolved`
        : Math.abs(m.length - m.plan) < 0.005
          ? `${m.length.toFixed(2)} m`
          : `${m.plan.toFixed(2)} m plan · ${m.length.toFixed(2)} m true`;
      label(ctx, text, (ax + bx) / 2 + 6, (ay + by) / 2 - 8, color);
    }
  }
  ctx.restore();
}

function label(ctx, text, x, y, colour) {
  ctx.save();
  ctx.font = "600 11px Source Sans 3, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,253,248,0.92)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** A ghost node: a faint, not-yet-real route point that one click makes real. */
export function drawServiceGhost(ctx, o) {
  const { x, y, worldToScreen, colour } = o;
  const [sx, sy] = worldToScreen(x, y);
  ctx.save();
  ctx.setLineDash([3, 2]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = colour;
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.arc(sx, sy, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(sx - 3, sy);
  ctx.lineTo(sx + 3, sy);
  ctx.moveTo(sx, sy - 3);
  ctx.lineTo(sx, sy + 3);
  ctx.stroke();
  ctx.restore();
}

/** Hover feedback for a route point or run. */
export function drawServiceHover(ctx, o) {
  const { doc, ref, worldToScreen, color } = o;
  const nodes = nodeMap(doc);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.setLineDash([3, 3]);
  if (ref.kind === "serviceNode") {
    const n = nodes.get(ref.id);
    if (n) {
      const [sx, sy] = worldToScreen(n.x, n.y);
      ctx.beginPath();
      ctx.arc(sx, sy, 10, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else {
    const e = (doc.serviceEdges || []).find((x) => x.id === ref.id);
    const a = nodes.get(e?.fromNode);
    const b = nodes.get(e?.toNode);
    if (a && b) {
      const [ax, ay] = worldToScreen(a.x, a.y);
      const [bx, by] = worldToScreen(b.x, b.y);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Rubber band from the last route point to the pointer. */
export function drawServiceDraft(ctx, o) {
  const { from, to, colour, worldToScreen } = o;
  if (!from || !to) return;
  const [ax, ay] = worldToScreen(from.x, from.y);
  const [bx, by] = worldToScreen(to.x, to.y);
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 3;
  ctx.setLineDash([6, 5]);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = PAPER;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(ax, ay, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  if (len > 0.01) label(ctx, `${len.toFixed(2)} m`, (ax + bx) / 2 + 6, (ay + by) / 2 - 8, colour);
}

const OBSTRUCTION_NEAR_M = 1;

/** Solid on the route, fading towards the edge of the 1 m reach. */
function reachAlpha(distance) {
  return 1 - 0.65 * Math.min(1, Math.max(0, distance / OBSTRUCTION_NEAR_M));
}

const WALL_GREY = "120,110,98";

// How far apart two labels must sit before either is still readable.
const LABEL_GAP = 6;

/** Shorten `text` so it fits `maxWidth`, or "" when even four letters will not. */
function fitText(ctx, text, maxWidth) {
  if (!(maxWidth > 0)) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ell = "…";
  for (let n = text.length - 1; n >= 4; n -= 1) {
    const fitted = `${text.slice(0, n).trimEnd()}${ell}`;
    if (ctx.measureText(fitted).width <= maxWidth) return fitted;
  }
  return "";
}

function textRect(x, y, width, baseline, align) {
  const left = align === "right" ? x - width : align === "center" ? x - width / 2 : x;
  const top = baseline === "middle" ? y - 6 : y - 9;
  return { x: left, y: top, w: width, h: 12 };
}

function rectsHit(a, b) {
  return a.x < b.x + b.w + LABEL_GAP && b.x < a.x + a.w + LABEL_GAP
    && a.y < b.y + b.h + LABEL_GAP && b.y < a.y + a.h + LABEL_GAP;
}

/**
 * Labels already painted on the profile. Later words measure themselves and
 * either move along their span or stay unwritten, so a long wall name cannot
 * land on top of the previous one.
 */
function makeLabelSpace() {
  const taken = [];
  const hits = (rect) => taken.some((p) => rectsHit(p, rect));
  const write = (ctx, shown, x, y, align, baseline, rect) => {
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(shown, x, y);
    taken.push(rect);
  };
  return {
    hits,
    hold(rect) { taken.push(rect); },
    place(ctx, text, x, y, { maxWidth = Infinity, align = "left", baseline = "alphabetic", ellipsis = true } = {}) {
      const shown = ellipsis ? fitText(ctx, text, maxWidth) : (ctx.measureText(text).width <= maxWidth ? text : "");
      if (!shown) return false;
      const rect = textRect(x, y, ctx.measureText(shown).width, baseline, align);
      if (hits(rect)) return false;
      write(ctx, shown, x, y, align, baseline, rect);
      return true;
    },
    /** Slide right within [x0, x1] until the words clear what is already there. */
    placeInSpan(ctx, text, x0, x1, y) {
      let x = x0;
      for (let n = 0; n < 6 && x < x1 - 8; n += 1) {
        const shown = fitText(ctx, text, x1 - x);
        if (!shown) return false;
        const rect = textRect(x, y, ctx.measureText(shown).width, "alphabetic", "left");
        const blocker = taken.find((p) => rectsHit(p, rect));
        if (!blocker) {
          write(ctx, shown, x, y, "left", "alphabetic", rect);
          return true;
        }
        const next = blocker.x + blocker.w + LABEL_GAP;
        if (next <= x) return false;
        x = next;
      }
      return false;
    },
  };
}

/**
 * One caption per wall name and head height, on the longest stretch that can
 * hold it. Rooms share a head, and the caption is wider than a short run of
 * the dashed line, so a second copy would otherwise paint across the first.
 */
function drawHeadLabels(ctx, labels, heads, g) {
  const { padL, padR, w } = g;
  const groups = new Map();
  for (const head of heads) {
    const key = `${head.name}\0${head.z.toFixed(2)}`;
    const list = groups.get(key) || [];
    list.push(head);
    groups.set(key, list);
  }
  const ordered = [...groups.values()].sort((a, b) => {
    const span = (list) => Math.max(...list.map((s) => s.x1 - s.x0));
    return span(b) - span(a);
  });
  ctx.font = "600 10px Source Sans 3, sans-serif";
  ctx.fillStyle = `rgb(${WALL_GREY})`;
  for (const segs of ordered) {
    const text = `${segs[0].name} head ${segs[0].z.toFixed(2)}`;
    const byLength = [...segs].sort((a, b) => (b.x1 - b.x0) - (a.x1 - a.x0));
    for (const seg of byLength) {
      const x0 = Math.max(padL + 2, seg.x0 + 3);
      const x1 = Math.min(seg.x1 - 2, w - padR);
      if (x1 - x0 < 28) continue;
      if (labels.placeInSpan(ctx, text, x0, x1, seg.y - 4)) break;
    }
  }
}

/** Vertical steps, in route order. Two nodes at one chainage are a rise or a drop. */
function routeSteps(known) {
  const steps = [];
  for (let i = 1; i < known.length; i += 1) {
    const p = known[i];
    const prev = known[i - 1];
    if (Math.abs(p.z - prev.z) > 1e-6 && Math.abs(p.s - prev.s) < 1e-6) {
      steps.push({
        text: `${p.z > prev.z ? "Rise" : "Drop"} ${fmt(p.z - prev.z)} m`,
        s: p.s,
        z: p.z,
        prevZ: prev.z,
      });
    }
  }
  return steps;
}

/**
 * The walls, behind everything else. A wall the route goes through is a solid
 * band with its own windows and doors left as gaps, so a run that threads an
 * opening reads as clear and one that hits masonry reads as blocked. A wall the
 * route only runs beside is a line at the top of the wall, drawn where no roof
 * covers the route and the wall head is therefore the only ceiling.
 */
function drawWalls(ctx, walls, g) {
  const { X, Y, zLo, zHi } = g;
  const heads = [];
  for (const wall of walls) {
    if (!wall.known) continue;
    const yTop = Y(Math.min(wall.z1, zHi));
    const yBot = Y(Math.max(wall.z0, zLo));
    if (yBot - yTop < 1) continue;

    for (const r of wall.through) {
      const x0 = X(r.s0);
      const x1 = Math.max(X(r.s1), x0 + 3);
      ctx.save();
      // Even-odd: the band minus its openings, so the gaps stay unpainted.
      ctx.beginPath();
      ctx.rect(x0, yTop, x1 - x0, yBot - yTop);
      for (const h of wall.holes) {
        if (h.s1 <= r.s0 || h.s0 >= r.s1) continue;
        const hy0 = Y(Math.min(h.z1, zHi));
        const hy1 = Y(Math.max(h.z0, zLo));
        ctx.rect(x0, hy0, x1 - x0, hy1 - hy0);
      }
      ctx.clip("evenodd");
      ctx.fillStyle = `rgba(${WALL_GREY},0.22)`;
      ctx.fillRect(x0, yTop, x1 - x0, yBot - yTop);
      ctx.restore();
      ctx.strokeStyle = `rgba(${WALL_GREY},0.55)`;
      ctx.lineWidth = 1;
      ctx.strokeRect(x0, yTop, x1 - x0, yBot - yTop);
    }

    for (const r of wall.head) {
      const x0 = X(r.s0);
      const x1 = X(r.s1);
      if (x1 - x0 < 2 || wall.z1 > zHi) continue;
      ctx.save();
      ctx.strokeStyle = `rgba(${WALL_GREY},0.75)`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.moveTo(x0, yTop);
      ctx.lineTo(x1, yTop);
      ctx.stroke();
      ctx.restore();
      heads.push({ name: wall.name, z: wall.z1, x0, x1, y: yTop });
    }
  }
  drawHeadLabels(ctx, g.labels, heads, g);
}

/**
 * Walls, windows, doors and the roof underside, drawn beneath the route. An
 * opening with no stated height is hatched over a whole storey and labelled,
 * never given a guessed sill or head.
 */
function drawObstructions(ctx, obstructions, g) {
  const { X, Y, zLo, zHi, padL, padR, padT, w, storeyHeight, labels } = g;
  const plotTop = padT;
  const plotBottom = Y(zLo);

  drawWalls(ctx, obstructions.walls || [], g);

  for (const roof of obstructions.roofs || []) {
    for (const run of roof.runs) {
      const pts = run.filter((p) => p.z <= zHi);
      if (pts.length < 2) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(padL, plotTop, w - padL - padR, plotBottom - plotTop);
      ctx.clip();
      ctx.beginPath();
      ctx.moveTo(X(run[0].s), plotTop);
      for (const p of run) ctx.lineTo(X(p.s), Y(p.z));
      ctx.lineTo(X(run[run.length - 1].s), plotTop);
      ctx.closePath();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = "#8a5a3c";
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#8a5a3c";
      ctx.lineWidth = 2;
      ctx.beginPath();
      run.forEach((p, i) => (i ? ctx.lineTo(X(p.s), Y(p.z)) : ctx.moveTo(X(p.s), Y(p.z))));
      ctx.stroke();
      ctx.restore();
      ctx.font = "600 10px Source Sans 3, sans-serif";
      ctx.fillStyle = "#8a5a3c";
      const lowest = run.reduce((m, p) => (p.z < m.z ? p : m), run[0]);
      const x0 = X(run[0].s) + 4;
      const x1 = Math.min(w - padR, X(run[run.length - 1].s) - 2);
      if (lowest.z <= zHi && x1 - x0 >= 28) {
        labels.placeInSpan(ctx, `${roof.name} underside ${lowest.z.toFixed(2)}`, x0, x1, Math.max(plotTop + 10, Y(lowest.z) - 5));
      }
    }
  }

  for (const o of obstructions.openings || []) {
    const isWindow = o.kind === "window";
    const z0 = o.known ? o.z0 : o.base;
    const z1 = o.known ? o.z1 : (o.base ?? 0) + storeyHeight;
    if (z0 === null || z0 === undefined || z1 < zLo || z0 > zHi) continue;
    const x0 = X(o.s0);
    const x1 = Math.max(X(o.s1), x0 + 4);
    const yTop = Y(Math.min(z1, zHi));
    const yBot = Y(Math.max(z0, zLo));
    const rw = x1 - x0;
    const rh = yBot - yTop;
    const rgb = isWindow ? "74,150,205" : "150,118,76";
    ctx.save();
    ctx.globalAlpha = reachAlpha(o.distance);
    if (o.known) {
      ctx.fillStyle = `rgba(${rgb},0.28)`;
      ctx.fillRect(x0, yTop, rw, rh);
      ctx.strokeStyle = `rgb(${rgb})`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x0, yTop, rw, rh);
    } else {
      ctx.beginPath();
      ctx.rect(x0, yTop, rw, rh);
      ctx.clip();
      ctx.strokeStyle = `rgba(${rgb},0.7)`;
      ctx.lineWidth = 1;
      for (let k = -rh; k < rw; k += 6) {
        ctx.beginPath();
        ctx.moveTo(x0 + k, yBot);
        ctx.lineTo(x0 + k + rh, yTop);
        ctx.stroke();
      }
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = reachAlpha(o.distance);
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = `rgb(${rgb})`;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(x0, yTop, rw, rh);
    }
    ctx.restore();
    if (o.known && rw >= 34 && rh >= 12) {
      ctx.save();
      ctx.globalAlpha = Math.max(0.6, reachAlpha(o.distance));
      ctx.font = "600 10px Source Sans 3, sans-serif";
      ctx.fillStyle = `rgb(${isWindow ? "36,100,150" : "104,78,44"})`;
      // A cut-off range would be a false height, so the full text is kept or left off.
      labels.place(ctx, `${o.z0.toFixed(2)}–${o.z1.toFixed(2)}`, x0 + 3, yTop + 11, {
        ellipsis: false,
        maxWidth: w - padR - (x0 + 3),
      });
      ctx.restore();
    }
  }

  if (obstructions.unknownCount) {
    const n = obstructions.unknownCount;
    ctx.save();
    ctx.font = "italic 11px Source Sans 3, sans-serif";
    ctx.fillStyle = "#8a6a2a";
    labels.place(ctx, `${n} ${n === 1 ? "opening has" : "openings have"} no height set (hatched)`, w - padR, padT + 8, {
      align: "right",
      ellipsis: false,
    });
    ctx.restore();
  }
}

/**
 * The route profile: absolute Z against distance along the route, with the
 * level datums it crosses. Redrawn from routeProfile() each time; nothing here is
 * stored. Sized to its own canvas, so it works in a collapsed panel.
 */
export function drawServiceProfile(canvas, profile, { colour = "#2675b8", drag = null, hoverGhost = null, obstructions = null, storeyHeight = 2.8, selectedNodeIds = null, selectionColour = "#243044" } = {}) {
  if (!canvas) return null;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 360;
  const h = canvas.clientHeight || 150;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);

  const known = (profile?.points || []).filter((p) => p.z !== null);
  if (known.length < 2) {
    ctx.fillStyle = "#665d52";
    ctx.font = "12px Source Sans 3, sans-serif";
    ctx.fillText("Heights are not all stated for this route, so there is no profile to draw.", 10, h / 2);
    return null;
  }
  const padL = 62;
  const padR = 14;
  const padT = 14;
  const padB = 22;
  const zLo = profile.zMin - 0.2;
  // Headroom above the route so a node can be lifted without rescaling mid-drag.
  let zHi = profile.zMax + Math.max(0.8, 0.35 * (profile.zMax - profile.zMin));
  // A roof close above the route is the whole point of drawing it, so make room
  // for it; one far overhead is left off the scale rather than squash the route.
  for (const roof of obstructions?.roofs || []) {
    for (const run of roof.runs) {
      for (const p of run) if (p.z <= profile.zMax + 3) zHi = Math.max(zHi, p.z + 0.15);
    }
  }
  // The same for the top of a wall, so a run low in a storey still shows the
  // wall head above it rather than having it fall off the scale.
  for (const wall of obstructions?.walls || []) {
    if (wall.known && wall.z1 <= profile.zMax + 3) zHi = Math.max(zHi, wall.z1 + 0.25);
  }
  const span = Math.max(zHi - zLo, 0.5);
  const sMax = Math.max(profile.chainage, 0.5);
  const X = (s) => padL + (s / sMax) * (w - padL - padR);
  const Y = (z) => h - padB - ((z - zLo) / span) * (h - padT - padB);

  const labels = makeLabelSpace();
  ctx.font = "11px Source Sans 3, sans-serif";
  ctx.fillStyle = "#8a8074";
  for (const level of profile.levels) {
    if (level.elevation < zLo || level.elevation > zHi) continue;
    const y = Y(level.elevation);
    ctx.strokeStyle = "#d9d2c8";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    labels.place(ctx, level.name, padL - 6, y, { align: "right", baseline: "middle", ellipsis: false });
  }

  // Rise, drop and the chainage caption are drawn later, on top of the route.
  // Their rectangles are held now so a wall or roof name stays clear of them.
  ctx.font = "600 11px Source Sans 3, sans-serif";
  const steps = [];
  for (const step of routeSteps(known)) {
    const tx = X(step.s) + 8;
    const ty = (Y(step.z) + Y(step.prevZ)) / 2;
    const rect = { x: tx - 3, y: ty - 9, w: ctx.measureText(step.text).width + 6, h: 15 };
    if (labels.hits(rect)) continue;
    labels.hold(rect);
    steps.push({ ...step, tx, ty });
  }
  ctx.font = "11px Source Sans 3, sans-serif";
  const chainText = `${profile.chainage.toFixed(2)} m along plan`;
  labels.hold(textRect(w - padR, h - 6, ctx.measureText(chainText).width, "alphabetic", "right"));

  if (obstructions) {
    drawObstructions(ctx, obstructions, { X, Y, zLo, zHi, padL, padR, padT, w, storeyHeight, labels });
  }

  ctx.beginPath();
  ctx.moveTo(X(known[0].s), Y(zLo));
  for (const p of known) ctx.lineTo(X(p.s), Y(p.z));
  ctx.lineTo(X(known[known.length - 1].s), Y(zLo));
  ctx.closePath();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = colour;
  ctx.lineWidth = 3.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  known.forEach((p, i) => (i ? ctx.lineTo(X(p.s), Y(p.z)) : ctx.moveTo(X(p.s), Y(p.z))));
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const selectedIds = new Set(selectedNodeIds || []);
  known.forEach((p) => {
    const hot = selectedIds.has(p.nodeId) && p.nodeId !== drag?.nodeId;
    ctx.fillStyle = hot ? selectionColour : PAPER;
    ctx.strokeStyle = hot ? selectionColour : colour;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (p.connected) ctx.rect(X(p.s) - 4, Y(p.z) - 4, 8, 8);
    else ctx.arc(X(p.s), Y(p.z), hot ? 4.5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
  ctx.font = "600 11px Source Sans 3, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  for (const step of steps) {
    ctx.fillStyle = PAPER;
    ctx.fillRect(step.tx - 3, step.ty - 9, ctx.measureText(step.text).width + 6, 15);
    ctx.fillStyle = colour;
    ctx.fillText(step.text, step.tx, step.ty + 3);
  }

  // Ghost nodes: one at the middle of each run. A normal click makes it real.
  const ghosts = [];
  (profile.edgeIds || []).forEach((edgeId, k) => {
    const a = profile.points[k];
    const b = profile.points[k + 1];
    if (!a || !b || a.z === null || b.z === null || Math.abs(b.s - a.s) < 1e-6) return;
    const s = (a.s + b.s) / 2;
    ghosts.push({ edgeId, s, px: X(s), py: Y((a.z + b.z) / 2) });
  });
  for (const g of ghosts) {
    const hot = hoverGhost === g.edgeId;
    ctx.save();
    ctx.setLineDash([3, 2]);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = colour;
    ctx.fillStyle = hot ? colour : PAPER;
    ctx.globalAlpha = hot ? 1 : 0.8;
    ctx.beginPath();
    ctx.arc(g.px, g.py, hot ? 7 : 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = hot ? PAPER : colour;
    ctx.beginPath();
    ctx.moveTo(g.px - 2.5, g.py);
    ctx.lineTo(g.px + 2.5, g.py);
    ctx.moveTo(g.px, g.py - 2.5);
    ctx.lineTo(g.px, g.py + 2.5);
    ctx.stroke();
    ctx.restore();
  }

  // Drag preview. Step: a straight 90 degree rise or drop, the route ahead
  // following. Slope: only this node moves, so the runs either side tilt.
  if (drag) {
    const p = known.find((q) => q.nodeId === drag.nodeId);
    if (p) {
      const z = Math.min(zHi, Math.max(zLo, drag.z));
      const from = known.indexOf(p);
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = colour;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.font = "600 11px Source Sans 3, sans-serif";
      ctx.textAlign = "left";
      if (drag.mode === "slope") {
        const before = known[from - 1];
        const after = known[from + 1];
        if (before) { ctx.moveTo(X(before.s), Y(before.z)); ctx.lineTo(X(p.s), Y(z)); } else ctx.moveTo(X(p.s), Y(z));
        if (after) ctx.lineTo(X(after.s), Y(after.z));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.arc(X(p.s), Y(z), 5, 0, Math.PI * 2);
        ctx.fill();
        const grade = (a, b) => {
          const run = Math.abs(b.s - a.s);
          if (run < 1e-6) return null;
          const g = (b.z - a.z) / run;
          return Math.abs(g) < 1e-4 ? "level" : `1:${Math.round(1 / Math.abs(g))} ${g > 0 ? "rising" : "falling"}`;
        };
        const notes = [];
        if (before) notes.push([before, grade(before, { s: p.s, z })]);
        if (after) notes.push([after, grade({ s: p.s, z }, after)]);
        for (const [other, text] of notes) {
          if (!text) continue;
          const mx = (X(p.s) + X(other.s)) / 2;
          const my = (Y(z) + Y(other.z)) / 2;
          ctx.fillStyle = PAPER;
          ctx.fillRect(mx - 3, my - 22, ctx.measureText(text).width + 6, 15);
          ctx.fillStyle = colour;
          ctx.fillText(text, mx, my - 11);
        }
      } else {
        ctx.moveTo(X(p.s), Y(p.z));
        ctx.lineTo(X(p.s), Y(z));
        // The route ahead follows at the new height, up to its next step or end.
        const shift = z - p.z;
        for (let j = from + 1; j < known.length; j += 1) {
          const q = known[j];
          if (Math.abs(q.s - known[j - 1].s) < 1e-6 && Math.abs(q.z - known[j - 1].z) > 1e-6) break;
          ctx.lineTo(X(q.s), Y(q.z + shift));
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.arc(X(p.s), Y(z), 5, 0, Math.PI * 2);
        ctx.fill();
        const text = `${z >= p.z ? "Rise" : "Drop"} ${fmt(Math.abs(z - p.z))} m`;
        const tx = X(p.s) + 10;
        const ty = (Y(z) + Y(p.z)) / 2;
        ctx.fillStyle = PAPER;
        ctx.fillRect(tx - 3, ty - 9, ctx.measureText(text).width + 6, 15);
        ctx.fillStyle = colour;
        ctx.textBaseline = "alphabetic";
        ctx.fillText(text, tx, ty + 3);
      }
      ctx.restore();
    }
  }

  // The plan and the profile share one selection: a node picked in either view
  // wears this ring here, and the plan draws the same ring in its own view.
  for (const p of known) {
    if (!selectedIds.has(p.nodeId)) continue;
    const z = drag && drag.nodeId === p.nodeId ? Math.min(zHi, Math.max(zLo, drag.z)) : p.z;
    strokeSelectionRing(ctx, X(p.s), Y(z), selectionColour);
  }

  ctx.fillStyle = "#8a8074";
  ctx.font = "11px Source Sans 3, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(chainText, w - padR, h - 6);

  return {
    zLo,
    zHi,
    zAt: (py) => zLo + ((h - padB - py) / (h - padT - padB)) * span,
    nodes: known.map((p) => ({ nodeId: p.nodeId, z: p.z, px: X(p.s), py: Y(p.z) })),
    ghosts,
  };
}
