// Trim by circle.
//
// The circle follows the pointer. Every line that crosses another inside the
// circle is divided at those crossings, and the one arm of that line which
// occupies the least length inside the circle is the part that will go. A
// line that stops short is stretched instead, when the end that has to move
// and the point where the lines would meet are both inside the circle. A
// click does every marked line at once. An equal pair is left alone, so a
// circle sitting on the middle of a crossing does nothing until it is moved
// toward the part to remove.
//
// Walls, foundations, boundary walls, beams, model lines, annotation lines
// and room separations. A curved wall is trimmed along its arc. No DOM.

import { MIN_TRACE, arcFromRadius, fitWallArc } from "./click-draw.js";
import { finishId } from "./finish-data.js";
import { collectionFor, nid, objectByRef } from "./model.js";
import { moveWallEnd, splitWallAt } from "./modify.js";

// An intersection this close to an end is already the end, so there is no
// overshoot on that side to remove.
const END_GAP = 0.001;
// Two arms this close in length are the same choice. The circle has to move.
const TIE_M = 0.001;
// splitWallAt will not cut closer than this to an end.
const SPLIT_GAP = 0.05;
const MIN_OTHER = 0.02;

function fail(message) {
  return { ok: false, message };
}

function openingName(opening, skuById) {
  const cat = skuById(opening?.sku)?.category;
  if (cat === "window") return "window";
  if (cat === "door") return "door";
  return "opening";
}

function asCurve(ent) {
  if (!ent || ent.id == null || !ent.kind) return null;
  const chord = Math.hypot(ent.x2 - ent.x1, ent.y2 - ent.y1);
  const key = `${ent.kind}:${ent.id}`;
  if (ent.arc && Number(ent.arc.radius) > 0) {
    const arc = arcFromRadius(
      ent.x1, ent.y1, ent.x2, ent.y2,
      Number(ent.arc.radius), ent.arc.side, ent.arc.major === true,
    );
    if (arc && arc.length > END_GAP) {
      return {
        kind: ent.kind, id: ent.id, key, type: "arc", arc,
        x1: ent.x1, y1: ent.y1, x2: ent.x2, y2: ent.y2,
        len: arc.length,
      };
    }
  }
  if (chord <= END_GAP) return null;
  return {
    kind: ent.kind, id: ent.id, key, type: "line",
    x1: ent.x1, y1: ent.y1, x2: ent.x2, y2: ent.y2,
    len: chord,
  };
}

function pointAt(curve, s) {
  if (curve.type === "line") {
    const t = curve.len > 0 ? s / curve.len : 0;
    return {
      x: curve.x1 + (curve.x2 - curve.x1) * t,
      y: curve.y1 + (curve.y2 - curve.y1) * t,
    };
  }
  const dir = curve.arc.sweep >= 0 ? 1 : -1;
  const ang = curve.arc.a0 + dir * (s / curve.arc.radius);
  return {
    x: curve.arc.cx + Math.cos(ang) * curve.arc.radius,
    y: curve.arc.cy + Math.sin(ang) * curve.arc.radius,
  };
}

// Signed distance along the arc's own direction. Negative is before the
// start, and past `arc.length` is beyond the end, so a meeting off the
// drawn curve can still be an extension.
function arcParameter(arc, x, y) {
  let travel = Math.atan2(y - arc.cy, x - arc.cx) - arc.a0;
  const sign = arc.sweep >= 0 ? 1 : -1;
  travel *= sign;
  const turn = Math.PI * 2;
  travel = ((travel % turn) + turn) % turn;
  const span = Math.abs(arc.sweep);
  if (travel <= span + 1e-4) return Math.min(travel, span) * arc.radius;
  const pastEnd = travel - span;
  const beforeStart = turn - travel;
  if (pastEnd <= beforeStart) return (span + pastEnd) * arc.radius;
  return -beforeStart * arc.radius;
}

function interior(len, s) {
  return s > END_GAP && s < len - END_GAP;
}

function inCircle(circle, x, y) {
  return Math.hypot(x - circle.x, y - circle.y) <= circle.r + 1e-4;
}

function lineLineHit(a, b) {
  const dax = a.x2 - a.x1;
  const day = a.y2 - a.y1;
  const dbx = b.x2 - b.x1;
  const dby = b.y2 - b.y1;
  const den = dax * dby - day * dbx;
  if (Math.abs(den) < 1e-12) return [];
  const t = ((b.x1 - a.x1) * dby - (b.y1 - a.y1) * dbx) / den;
  const u = ((b.x1 - a.x1) * day - (b.y1 - a.y1) * dax) / den;
  const sa = t * a.len;
  const sb = u * b.len;
  return [{ x: a.x1 + t * dax, y: a.y1 + t * day, sa, sb }];
}

function lineArcHits(line, arcCurve) {
  const arc = arcCurve.arc;
  const ux = (line.x2 - line.x1) / line.len;
  const uy = (line.y2 - line.y1) / line.len;
  const fx = line.x1 - arc.cx;
  const fy = line.y1 - arc.cy;
  const b = 2 * (fx * ux + fy * uy);
  const c = fx * fx + fy * fy - arc.radius * arc.radius;
  const disc = b * b - 4 * c;
  if (disc < -1e-8) return [];
  const roots = disc <= 1e-8 ? [-b / 2] : [(-b - Math.sqrt(disc)) / 2, (-b + Math.sqrt(disc)) / 2];
  const out = [];
  for (const s of roots) {
    const x = line.x1 + ux * s;
    const y = line.y1 + uy * s;
    const sa = arcParameter(arc, x, y);
    if (sa == null) continue;
    out.push({ x, y, lineS: s, arcS: sa });
  }
  return out;
}

function circleCircle(c1, r1, c2, r2) {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-9 || d > r1 + r2 + 1e-6 || d < Math.abs(r1 - r2) - 1e-6) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  if (h2 < -1e-8) return [];
  const h = Math.sqrt(Math.max(0, h2));
  const xm = c1.x + (a * dx) / d;
  const ym = c1.y + (a * dy) / d;
  if (h < 1e-8) return [{ x: xm, y: ym }];
  const rx = (-dy * h) / d;
  const ry = (dx * h) / d;
  return [{ x: xm + rx, y: ym + ry }, { x: xm - rx, y: ym - ry }];
}

function arcArcHits(a, b) {
  const pts = circleCircle(
    { x: a.arc.cx, y: a.arc.cy }, a.arc.radius,
    { x: b.arc.cx, y: b.arc.cy }, b.arc.radius,
  );
  const out = [];
  for (const p of pts) {
    const sa = arcParameter(a.arc, p.x, p.y);
    const sb = arcParameter(b.arc, p.x, p.y);
    if (sa == null || sb == null) continue;
    out.push({ x: p.x, y: p.y, sa, sb });
  }
  return out;
}

function pairHits(a, b) {
  if (a.type === "line" && b.type === "line") {
    return lineLineHit(a, b).map((hit) => ({ x: hit.x, y: hit.y, sA: hit.sa, sB: hit.sb }));
  }
  if (a.type === "line" && b.type === "arc") {
    return lineArcHits(a, b).map((hit) => ({ x: hit.x, y: hit.y, sA: hit.lineS, sB: hit.arcS }));
  }
  if (a.type === "arc" && b.type === "line") {
    return lineArcHits(b, a).map((hit) => ({ x: hit.x, y: hit.y, sA: hit.arcS, sB: hit.lineS }));
  }
  return arcArcHits(a, b).map((hit) => ({ x: hit.x, y: hit.y, sA: hit.sa, sB: hit.sb }));
}

function addStation(map, key, s) {
  const list = map.get(key) || [];
  if (!list.some((have) => Math.abs(have - s) < END_GAP)) list.push(s);
  map.set(key, list);
}

function lineInside(curve, a, b, circle) {
  const ux = (curve.x2 - curve.x1) / curve.len;
  const uy = (curve.y2 - curve.y1) / curve.len;
  const fx = curve.x1 - circle.x;
  const fy = curve.y1 - circle.y;
  const bq = fx * ux + fy * uy;
  const cq = fx * fx + fy * fy - circle.r * circle.r;
  const disc = bq * bq - cq;
  if (disc < 0) return 0;
  const root = Math.sqrt(disc);
  const lo = Math.max(a, -bq - root);
  const hi = Math.min(b, -bq + root);
  return Math.max(0, hi - lo);
}

function arcInside(curve, a, b, circle) {
  const span = b - a;
  if (span <= 0) return 0;
  const r2 = circle.r * circle.r;
  const contains = (s) => {
    const p = pointAt(curve, s);
    const dx = p.x - circle.x;
    const dy = p.y - circle.y;
    return dx * dx + dy * dy <= r2 + 1e-8;
  };
  const step = Math.min(0.005, span / 4);
  let total = 0;
  let prev = a;
  let prevIn = contains(a);
  for (let s = a + step; s < b - 1e-9; s += step) {
    const inn = contains(s);
    if (prevIn && inn) total += s - prev;
    else if (prevIn !== inn) total += (s - prev) / 2;
    prev = s;
    prevIn = inn;
  }
  const endIn = contains(b);
  if (prevIn && endIn) total += b - prev;
  else if (prevIn !== endIn) total += (b - prev) / 2;
  return total;
}

function insideLength(curve, a, b, circle) {
  return curve.type === "line" ? lineInside(curve, a, b, circle) : arcInside(curve, a, b, circle);
}

function spanChord(curve, s0, s1) {
  const p = pointAt(curve, s0);
  const q = pointAt(curve, s1);
  return Math.hypot(q.x - p.x, q.y - p.y);
}

function samplesOf(curve, a, b) {
  if (curve.type === "line" || Math.abs(b - a) < 0.02) return [pointAt(curve, a), pointAt(curve, b)];
  const n = Math.max(2, Math.ceil(Math.abs(b - a) / 0.12));
  const pts = [];
  for (let i = 0; i <= n; i += 1) pts.push(pointAt(curve, a + ((b - a) * i) / n));
  return pts;
}

function addReach(map, key, hit) {
  const list = map.get(key) || [];
  if (!list.some((have) => Math.hypot(have.x - hit.x, have.y - hit.y) < END_GAP)) list.push(hit);
  map.set(key, list);
}

// The end that would travel to a meeting past the line. Both that end and
// the meeting have to sit in the circle, or a covered end would stretch to
// a crossing far outside it.
function extensionOf(curve, hit, circle) {
  const s = hit.s;
  let role;
  let endS;
  if (s < -END_GAP) {
    role = "extend-start";
    endS = 0;
  } else if (s > curve.len + END_GAP) {
    role = "extend-end";
    endS = curve.len;
  } else return null;
  const end = pointAt(curve, endS);
  if (!inCircle(circle, end.x, end.y) || !inCircle(circle, hit.x, hit.y)) return null;
  const gap = Math.hypot(hit.x - end.x, hit.y - end.y);
  if (gap <= END_GAP) return null;
  return {
    role,
    point: { x: hit.x, y: hit.y },
    gap,
    samples: samplesOf(curve, endS, s),
  };
}

function chooseExtension(curve, reaches, circle) {
  const scored = [];
  for (const hit of reaches) {
    const ext = extensionOf(curve, hit, circle);
    if (ext) scored.push(ext);
  }
  if (!scored.length) return null;
  scored.sort((a, b) => a.gap - b.gap);
  if (scored.length > 1 && scored[1].gap - scored[0].gap < TIE_M) return null;
  const best = scored[0];
  return {
    kind: curve.kind,
    id: curve.id,
    role: best.role,
    point: best.point,
    point2: null,
    samples: best.samples,
  };
}

function chooseArm(curve, stations, circle) {
  if (!stations.length) return null;
  const marks = [...stations].sort((a, b) => a - b);
  const bounds = [0, ...marks, curve.len];
  const scored = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const a = bounds[i];
    const b = bounds[i + 1];
    if (b - a <= END_GAP) continue;
    const inside = insideLength(curve, a, b, circle);
    if (inside <= END_GAP) continue;
    scored.push({ a, b, inside });
  }
  if (!scored.length) return null;
  scored.sort((p, q) => p.inside - q.inside);
  if (scored.length > 1 && scored[1].inside - scored[0].inside < TIE_M) return null;
  const arm = scored[0];
  const atStart = arm.a <= END_GAP;
  const atEnd = arm.b >= curve.len - END_GAP;
  if (atStart && atEnd) return null;
  const role = atStart ? "start" : atEnd ? "end" : "middle";
  const floor = curve.kind === "segment" ? MIN_TRACE : MIN_OTHER;
  const kept = role === "start"
    ? [spanChord(curve, arm.b, curve.len)]
    : role === "end"
      ? [spanChord(curve, 0, arm.a)]
      : [spanChord(curve, 0, arm.a), spanChord(curve, arm.b, curve.len)];
  if (kept.some((length) => length < floor)) return null;
  const point = role === "end" ? pointAt(curve, arm.a) : pointAt(curve, role === "start" ? arm.b : arm.a);
  const point2 = role === "middle" ? pointAt(curve, arm.b) : null;
  return {
    kind: curve.kind,
    id: curve.id,
    role,
    point,
    point2,
    samples: samplesOf(curve, arm.a, arm.b),
  };
}

/**
 * Which arm of each line the circle would remove, or which end it would
 * stretch. Does not change anything. `entities` are
 * `{ kind, id, x1, y1, x2, y2, arc? }`. `circle` is `{ x, y, r }` in metres.
 * One change per line. A line that already crosses something inside the
 * circle is trimmed; stretching is only for an end that does not yet reach.
 */
export function planCircleTrim(entities, circle) {
  if (!circle || !(circle.r > 0)) return { cuts: [] };
  const curves = (entities || []).map(asCurve).filter(Boolean);
  const stations = new Map();
  const reaches = new Map();
  for (let i = 0; i < curves.length; i += 1) {
    for (let j = i + 1; j < curves.length; j += 1) {
      for (const hit of pairHits(curves[i], curves[j])) {
        if (!inCircle(circle, hit.x, hit.y)) continue;
        noteMeet(stations, reaches, curves[i], hit.sA, hit);
        noteMeet(stations, reaches, curves[j], hit.sB, hit);
      }
    }
  }
  const cuts = [];
  const trimmed = new Set();
  for (const curve of curves) {
    const cut = chooseArm(curve, stations.get(curve.key) || [], circle);
    if (!cut) continue;
    cuts.push(cut);
    trimmed.add(curve.key);
  }
  for (const curve of curves) {
    // A crossing inside the circle is a trim, even when the two arms are
    // equal and nothing is marked. That line is not also stretched.
    if (trimmed.has(curve.key) || (stations.get(curve.key) || []).length) continue;
    const cut = chooseExtension(curve, reaches.get(curve.key) || [], circle);
    if (cut) cuts.push(cut);
  }
  return { cuts };
}

function noteMeet(stations, reaches, curve, s, hit) {
  if (interior(curve.len, s)) addStation(stations, curve.key, s);
  else if (s < -END_GAP || s > curve.len + END_GAP) addReach(reaches, curve.key, { s, x: hit.x, y: hit.y });
}

function alongMetres(seg, p) {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return 0;
  return ((p.x - seg.x1) * dx + (p.y - seg.y1) * dy) / len;
}

function setEnd(obj, end, point) {
  if (end === 1) {
    obj.x1 = point.x;
    obj.y1 = point.y;
  } else {
    obj.x2 = point.x;
    obj.y2 = point.y;
  }
  const len = Math.hypot(obj.x2 - obj.x1, obj.y2 - obj.y1);
  if (Number.isFinite(obj.length)) obj.length = len;
  return len;
}

function removeWallPiece(doc, id) {
  doc.segments = (doc.segments || []).filter((seg) => seg.id !== id);
  doc.openings = (doc.openings || []).filter((opening) => opening.wallId !== id);
  doc.finishRuns = (doc.finishRuns || []).filter((run) => run.wallId !== id);
  if (Array.isArray(doc.items)) {
    doc.items = doc.items.filter((item) => !(item.host === "wall" && item.wallId === id));
  }
}

function openingOnSpan(doc, seg, s0, s1, skuById) {
  const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
  const lo = Math.min(s0, s1);
  const hi = Math.max(s0, s1);
  for (const opening of doc.openings || []) {
    if (opening.wallId !== seg.id || !Number.isFinite(Number(opening.t))) continue;
    const station = Math.min(1, Math.max(0, Number(opening.t))) * len;
    if (station > lo + 0.02 && station < hi - 0.02) {
      return `That would leave the ${openingName(opening, skuById)} off the wall.`;
    }
  }
  return null;
}

function overlap(lo, hi, a, b) {
  const start = Math.max(lo, a);
  const end = Math.min(hi, b);
  return end - start > 0.02 ? [start, end] : null;
}

function exciseStraightWall(doc, seg, p0, p1, skuById) {
  const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
  let s0 = alongMetres(seg, p0);
  let s1 = alongMetres(seg, p1);
  if (s1 < s0) {
    const swap = s0;
    s0 = s1;
    s1 = swap;
    const swapPoint = p0;
    p0 = p1;
    p1 = swapPoint;
  }
  const blocked = openingOnSpan(doc, seg, s0, s1, skuById);
  if (blocked) return fail(blocked);
  const a = Math.round(s0 * 1000) / 1000;
  const b = Math.round(s1 * 1000) / 1000;
  if (a >= SPLIT_GAP && len - b >= SPLIT_GAP && b - a >= SPLIT_GAP) {
    const first = splitWallAt(doc, { kind: "segment", id: seg.id }, p0, { skuById });
    if (!first.ok) return first;
    const middleId = first.refs[1].id;
    const second = splitWallAt(doc, { kind: "segment", id: middleId }, p1, { skuById });
    if (!second.ok) return second;
    removeWallPiece(doc, middleId);
    return { ok: true, refs: [first.refs[0], second.refs[1]] };
  }
  return exciseByEnds(doc, seg, p0, p1, s0, s1, len);
}

function exciseByEnds(doc, seg, p0, p1, s0, s1, len) {
  const tail = structuredClone(seg);
  tail.id = nid("s");
  seg.x2 = p0.x;
  seg.y2 = p0.y;
  tail.x1 = p1.x;
  tail.y1 = p1.y;
  if (Number.isFinite(seg.length)) seg.length = s0;
  if (Number.isFinite(tail.length)) tail.length = len - s1;
  delete seg.arc;
  delete tail.arc;
  fitWallArc(seg);
  fitWallArc(tail);
  collectionFor(doc, "segment").push(tail);
  rehomeHosts(doc, seg, tail, s0, s1, len);
  return { ok: true, refs: [{ kind: "segment", id: seg.id }, { kind: "segment", id: tail.id }] };
}

function rehomeHosts(doc, head, tail, s0, s1, len) {
  const dropOpenings = [];
  for (const opening of doc.openings || []) {
    if (opening.wallId !== head.id || !Number.isFinite(Number(opening.t))) continue;
    const station = Math.min(1, Math.max(0, Number(opening.t))) * len;
    if (station <= s0 + 0.02) opening.t = s0 > 1e-6 ? Math.min(1, station / s0) : 0;
    else if (station >= s1 - 0.02) {
      opening.wallId = tail.id;
      opening.t = (len - s1) > 1e-6 ? Math.min(1, (station - s1) / (len - s1)) : 0;
    } else dropOpenings.push(opening.id);
  }
  if (dropOpenings.length) {
    const gone = new Set(dropOpenings);
    doc.openings = doc.openings.filter((opening) => !gone.has(opening.id));
  }
  const extra = [];
  const dropRuns = [];
  for (const run of doc.finishRuns || []) {
    if (run.wallId !== head.id) continue;
    if (run.a == null || run.b == null) {
      const copy = structuredClone(run);
      copy.id = finishId("fx");
      copy.wallId = tail.id;
      extra.push(copy);
      continue;
    }
    const lo = Math.min(run.a, run.b);
    const hi = Math.max(run.a, run.b);
    const headPart = overlap(lo, hi, 0, s0);
    const tailPart = overlap(lo, hi, s1, len);
    if (!headPart && !tailPart) {
      dropRuns.push(run.id);
      continue;
    }
    if (headPart && tailPart) {
      const copy = structuredClone(run);
      copy.id = finishId("fx");
      copy.wallId = tail.id;
      copy.a = tailPart[0] - s1;
      copy.b = tailPart[1] - s1;
      delete copy.outline;
      extra.push(copy);
      run.a = headPart[0];
      run.b = headPart[1];
      delete run.outline;
    } else if (headPart) {
      run.a = headPart[0];
      run.b = headPart[1];
      if (headPart[0] > lo + 1e-4 || headPart[1] < hi - 1e-4) delete run.outline;
    } else {
      run.wallId = tail.id;
      run.a = tailPart[0] - s1;
      run.b = tailPart[1] - s1;
      if (tailPart[0] > lo + 1e-4 || tailPart[1] < hi - 1e-4) delete run.outline;
    }
  }
  if (dropRuns.length) {
    const gone = new Set(dropRuns);
    doc.finishRuns = doc.finishRuns.filter((run) => !gone.has(run.id));
  }
  if (extra.length) {
    if (!Array.isArray(doc.finishRuns)) doc.finishRuns = [];
    doc.finishRuns.push(...extra);
  }
  const dropItems = [];
  for (const item of doc.items || []) {
    if (item.wallId !== head.id) continue;
    if (item.host === "joinery") {
      const a = Math.min(Number(item.t0) || 0, Number(item.t1) || 0) * len;
      const b = Math.max(Number(item.t0) || 0, Number(item.t1) || 0) * len;
      if (b <= s0) {
        item.t0 = s0 > 1e-6 ? a / s0 : 0;
        item.t1 = s0 > 1e-6 ? b / s0 : 0;
      } else if (a >= s1) {
        item.wallId = tail.id;
        const rest = len - s1;
        item.t0 = rest > 1e-6 ? (a - s1) / rest : 0;
        item.t1 = rest > 1e-6 ? (b - s1) / rest : 0;
      } else dropItems.push(item.id);
      continue;
    }
    if (item.host !== "wall") continue;
    const station = Math.min(1, Math.max(0, Number(item.t) || 0)) * len;
    if (station <= s0) item.t = s0 > 1e-6 ? station / s0 : 0;
    else if (station >= s1) {
      item.wallId = tail.id;
      item.t = (len - s1) > 1e-6 ? (station - s1) / (len - s1) : 0;
    } else dropItems.push(item.id);
  }
  if (dropItems.length) {
    const gone = new Set(dropItems);
    doc.items = doc.items.filter((item) => !gone.has(item.id));
  }
}

function exciseArc(doc, seg, p0, p1, skuById) {
  const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
  let s0 = alongMetres(seg, p0);
  let s1 = alongMetres(seg, p1);
  if (s1 < s0) {
    const swap = s0;
    s0 = s1;
    s1 = swap;
    const swapPoint = p0;
    p0 = p1;
    p1 = swapPoint;
  }
  const blocked = openingOnSpan(doc, seg, s0, s1, skuById);
  if (blocked) return fail(blocked);
  const tail = structuredClone(seg);
  tail.id = nid("s");
  seg.x2 = p0.x;
  seg.y2 = p0.y;
  tail.x1 = p1.x;
  tail.y1 = p1.y;
  fitWallArc(seg);
  fitWallArc(tail);
  if (Number.isFinite(seg.length)) seg.length = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
  if (Number.isFinite(tail.length)) tail.length = Math.hypot(tail.x2 - tail.x1, tail.y2 - tail.y1);
  collectionFor(doc, "segment").push(tail);
  rehomeHosts(doc, seg, tail, s0, s1, len);
  return { ok: true, refs: [{ kind: "segment", id: seg.id }, { kind: "segment", id: tail.id }] };
}

function excisePlain(doc, obj, kind, p0, p1) {
  const copy = structuredClone(obj);
  copy.id = nid(kind[0] || "x");
  obj.x2 = p0.x;
  obj.y2 = p0.y;
  copy.x1 = p1.x;
  copy.y1 = p1.y;
  if (Number.isFinite(obj.length)) obj.length = Math.hypot(obj.x2 - obj.x1, obj.y2 - obj.y1);
  if (Number.isFinite(copy.length)) copy.length = Math.hypot(copy.x2 - copy.x1, copy.y2 - copy.y1);
  collectionFor(doc, kind).push(copy);
  return { ok: true, refs: [{ kind, id: obj.id }, { kind, id: copy.id }] };
}

function applyOne(doc, cut, skuById) {
  const obj = objectByRef(doc, { kind: cut.kind, id: cut.id });
  if (!obj) return fail("That line is no longer on the plan.");
  if (cut.role === "middle") {
    if (!cut.point || !cut.point2) return fail("Nothing in the circle will trim.");
    if (cut.kind === "segment" && obj.arc) return exciseArc(doc, obj, cut.point, cut.point2, skuById);
    if (cut.kind === "segment") return exciseStraightWall(doc, obj, cut.point, cut.point2, skuById);
    return excisePlain(doc, obj, cut.kind, cut.point, cut.point2);
  }
  const end = cut.role === "start" || cut.role === "extend-start" ? 1 : 2;
  if (cut.kind === "segment") {
    return moveWallEnd(doc, { kind: "segment", id: obj.id }, end, cut.point, { skuById, space: "centre" });
  }
  const next = end === 1
    ? { x1: cut.point.x, y1: cut.point.y, x2: obj.x2, y2: obj.y2 }
    : { x1: obj.x1, y1: obj.y1, x2: cut.point.x, y2: cut.point.y };
  if (Math.hypot(next.x2 - next.x1, next.y2 - next.y1) < MIN_OTHER) {
    return fail("That would leave the line too short.");
  }
  setEnd(obj, end, cut.point);
  return { ok: true, refs: [{ kind: cut.kind, id: obj.id }] };
}

/**
 * Remove each planned arm. One call, so the caller can undo it as one step.
 * A wall that would drop a door or window is left as it was; the others still
 * trim. `cuts` is the `cuts` array from `planCircleTrim`.
 */
export function applyCircleTrim(doc, cuts, { skuById = () => null } = {}) {
  const refs = [];
  const skipped = [];
  let trimmed = 0;
  let extended = 0;
  for (const cut of cuts || []) {
    const result = applyOne(doc, cut, skuById);
    if (!result.ok) {
      skipped.push(result.message);
      continue;
    }
    if (String(cut.role).startsWith("extend")) extended += 1;
    else trimmed += 1;
    for (const ref of result.refs || [{ kind: cut.kind, id: cut.id }]) {
      if (!refs.some((have) => have.kind === ref.kind && have.id === ref.id)) refs.push(ref);
    }
  }
  const applied = trimmed + extended;
  if (!applied) return fail(skipped[0] || "Nothing in the circle will trim.");
  const left = skipped.length === 1 ? "1 was left" : `${skipped.length} were left`;
  let message;
  if (extended && !trimmed) message = extended === 1 ? "Extended." : `Extended ${extended}.`;
  else if (extended && trimmed) message = `Trimmed ${trimmed} and extended ${extended}.`;
  else message = trimmed === 1 ? "Trimmed." : `Trimmed ${trimmed}.`;
  if (skipped.length) message = `${message} ${left}: ${skipped[0]}`;
  return { ok: true, message, refs, skipped };
}
