// SVG drawing of a wall elevation model. One function serves the small
// inspector preview and the strip under the plan; `interactive` adds the drag
// handles. Returns markup plus the scale the pointer code needs to turn pixels
// back into metres.

import { finishSwatch } from "./finish-data.js";

const PAD = 14;
const LABEL_W = 74;
const HANDLE = 5;

function esc(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function mm(metres) {
  return `${Math.round(metres * 1000)}`;
}

/** The same edge length the plan shows while a polygon is drawn or edited. */
function measureLabel(parts, x1, y1, x2, y2, metres) {
  if (!(metres > 0.02)) return;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const label = `${Math.round(metres * 1000)} mm`;
  const width = label.length * 6.6;
  parts.push(`<rect x="${mx - width / 2}" y="${my - 16}" width="${width}" height="14" rx="2" class="elev-measure-bg"/>`);
  parts.push(`<text x="${mx}" y="${my - 5}" text-anchor="middle" class="elev-measure">${label}</text>`);
}

/** Dashed lines through a point that lines up with another corner or an edge. */
function alignLines(parts, model, guides, xOf, yOf, W, H) {
  if (!guides) return;
  if (guides.s != null) {
    const x = xOf(guides.s);
    parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" class="elev-align"/>`);
  }
  if (guides.z != null) {
    const y = yOf(model.base + guides.z);
    parts.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" class="elev-align"/>`);
  }
}

/** Vertical dimension string beside a selected opening. `kind` is `sill`
 * (floor to sill, drawn below the frame) or `ceiling` (head to the top of
 * the wall). Ticks are the oblique marks used on an architectural elevation. */
function dimensionRun(parts, { y1, y2, dx, side, jamb, label, kind, H }) {
  const top = Math.min(y1, y2);
  const bot = Math.max(y1, y2);
  if (bot - top < 1 || !label) return;
  const dir = dx >= jamb ? 1 : -1;
  const witness = (yy) => {
    parts.push(`<line x1="${jamb + dir * 2}" y1="${yy}" x2="${dx + dir * 3}" y2="${yy}" class="elev-dim-ext"/>`);
    parts.push(`<line x1="${dx - 3.2}" y1="${yy + 3.2}" x2="${dx + 3.2}" y2="${yy - 3.2}" class="elev-dim-tick"/>`);
  };
  witness(top);
  witness(bot);
  parts.push(`<line x1="${dx}" y1="${top}" x2="${dx}" y2="${bot}" class="elev-dim-line"/>`);
  const ty = Math.min(H - 3, Math.max(9, (top + bot) / 2 + 3));
  const anchor = side > 0 ? "start" : "end";
  parts.push(`<text x="${dx + side * 5}" y="${ty}" text-anchor="${anchor}" class="elev-dim" data-elev-dim="${kind}">${label}</text>`);
}

function dimensionOpening(parts, { x, y, w, h, opening, model, yOf, W, H }) {
  const floorY = yOf(model.base);
  const ceilY = yOf(model.top);
  const sillY = y + h;
  const toCeiling = model.height - opening.sill - opening.height;
  const showSill = opening.category !== "door" && opening.sill > 0.005;
  const showCeiling = toCeiling > 0.005;
  if (!showSill && !showCeiling) return;

  const gap = 20;
  const right = x + w + gap;
  const side = right + 32 <= W - 4 ? 1 : -1;
  const dx = side > 0 ? right : x - gap;
  const jamb = side > 0 ? x + w : x;
  if (showSill) {
    dimensionRun(parts, { y1: floorY, y2: sillY, dx, side, jamb, label: mm(opening.sill), kind: "sill", H });
  }
  if (showCeiling) {
    dimensionRun(parts, { y1: y, y2: ceilY, dx, side, jamb, label: mm(toCeiling), kind: "ceiling", H });
  }
}

/**
 * @param {object} model elevationModel() result
 * @param {{width:number,height:number,interactive?:boolean,dragTop?:boolean,selectedId?:string|null}} opts
 * @returns {{svg:string, scale:number, originX:number, originY:number}}
 */
export function elevationSvg(model, { width, height, interactive = false, dragTop = false, selectedId = null, selectedBandId = null, selectedVertex = null, draft = null, guides = null } = {}) {
  const W = Math.max(80, Math.round(width));
  const H = Math.max(60, Math.round(height));
  if (!model) return { svg: "", scale: 1, originX: 0, originY: 0 };

  // The next floor or the roof stays in frame even when the wall stops short
  // of it, so a shorter wall is still read against that line.
  const guide = model.guide && Number.isFinite(model.guide.elevation) ? model.guide : null;
  const spanTop = Math.max(model.top, guide?.elevation ?? model.top);
  const near = model.levels.filter((l) => l.elevation >= model.base - 0.6 && l.elevation <= spanTop + 0.6);
  const zLo = Math.min(model.base, ...near.map((l) => l.elevation)) - 0.1;
  const zHi = Math.max(spanTop, ...near.map((l) => l.elevation)) + 0.2;
  const showLabels = interactive || Boolean(guide);
  const rightPad = showLabels ? LABEL_W + PAD : PAD;
  const scale = Math.max(
    1e-3,
    Math.min((W - PAD - rightPad) / Math.max(model.length, 0.1), (H - PAD * 2) / Math.max(zHi - zLo, 0.1)),
  );
  const originX = PAD + (W - PAD - rightPad - model.length * scale) / 2;
  const yOf = (z) => PAD + (zHi - z) * scale;
  const xOf = (offset) => originX + offset * scale;
  const originY = yOf(model.base);

  const parts = [];
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" class="elev-bg"/>`);

  const levelLabel = (name, elevation) => {
    const sign = elevation >= 0 ? "+" : "-";
    return `${esc(name)} ${sign}${Math.abs(elevation).toFixed(3)}`;
  };

  // Levels first, so the wall sits over them. The guide (next floor, or the
  // roof on the top storey) is labelled even in the small preview.
  for (const l of model.levels) {
    if (l.elevation < zLo - 1e-6 || l.elevation > zHi + 1e-6) continue;
    const y = yOf(l.elevation);
    const isGuide = Boolean(guide && guide.kind === "floor" && l.id === guide.id);
    parts.push(`<line x1="${PAD / 2}" x2="${W - PAD / 2}" y1="${y}" y2="${y}" class="elev-level elev-level-${l.kind}${isGuide ? " elev-guide" : ""}"/>`);
    if (interactive || isGuide) {
      parts.push(`<text x="${W - PAD / 2}" y="${y - 3}" text-anchor="end" class="elev-level-label">${levelLabel(l.name, l.elevation)}</text>`);
    }
  }
  const roofDrawn = guide?.kind === "roof" && !model.levels.some((l) => Math.abs(l.elevation - guide.elevation) < 1e-3);
  if (roofDrawn && guide.elevation >= zLo - 1e-6 && guide.elevation <= zHi + 1e-6) {
    const y = yOf(guide.elevation);
    parts.push(`<line x1="${PAD / 2}" x2="${W - PAD / 2}" y1="${y}" y2="${y}" class="elev-level elev-level-roof elev-guide"/>`);
    parts.push(`<text x="${W - PAD / 2}" y="${y - 3}" text-anchor="end" class="elev-level-label">${levelLabel(guide.name, guide.elevation)}</text>`);
  }

  const wx = xOf(0);
  const wy = yOf(model.top);
  const ww = model.length * scale;
  const wh = model.height * scale;
  if (guide && guide.elevation > model.top + 0.02) {
    const gy = yOf(guide.elevation);
    parts.push(`<rect x="${wx}" y="${gy}" width="${ww}" height="${Math.max(0, wy - gy)}" class="elev-wall-ghost"/>`);
  }
  parts.push(`<rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" class="elev-wall"/>`);

  for (const b of model.finishBands) {
    // A finish is the colour it has in the panel. The computed default stays grey,
    // and "no finish" is the wall colour, so it reads as a hole in that default.
    const none = b.category === "none";
    const tint = b.source === "default" || none ? "" : ` style="fill:${finishSwatch(b.category)};fill-opacity:0.55"`;
    const picked = b.id === selectedBandId ? " is-selected" : "";
    const cls = `elev-band elev-band-${esc(b.source || "run")}${none ? " elev-band-none" : ""}${picked}`;
    const title = `<title>${esc(b.label || "Finish")}</title>`;
    if (b.outline?.length >= 3) {
      const pts = b.outline.map(([s, z]) => `${xOf(s)},${yOf(model.base + z)}`).join(" ");
      parts.push(`<polygon points="${pts}" class="${cls}"${tint} data-elev-fill="${esc(b.id)}">${title}</polygon>`);
    } else {
      parts.push(`<rect x="${xOf(b.from ?? 0)}" y="${yOf(model.base + b.top)}" width="${((b.to ?? model.length) - (b.from ?? 0)) * scale}" height="${(b.top - b.bottom) * scale}" class="${cls}"${tint} data-elev-fill="${esc(b.id)}">${title}</rect>`);
    }
  }

  for (const o of model.openings) {
    const x = xOf(o.offset);
    const y = yOf(model.base + o.sill + o.height);
    const w = o.width * scale;
    const h = o.height * scale;
    const sel = o.id === selectedId;
    const cls = `elev-opening elev-${o.category === "door" ? "door" : "window"}${sel ? " is-selected" : ""}${o.nonStandard ? " is-nonstandard" : ""}`;
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" class="${cls}" data-elev-op="move" data-elev-id="${esc(o.id)}"/>`);
    if (o.category !== "door") {
      parts.push(`<line x1="${x}" x2="${x + w}" y1="${y + h / 2}" y2="${y + h / 2}" class="elev-glass"/>`);
    }
    if (sel) {
      // Setting-out, the way an elevation is dimensioned: the opening size
      // stays on the frame, the sill height is the run below it, and the
      // run above it is the height from the head up to the ceiling (the
      // top of this wall).
      const headRoom = y - yOf(model.top);
      const labelY = headRoom >= 32 ? Math.max(10, y - 16) : Math.min(y + h - 4, y + 16);
      parts.push(`<text x="${x + w / 2}" y="${labelY}" text-anchor="middle" class="elev-dim">${mm(o.width)} × ${mm(o.height)}</text>`);
      dimensionOpening(parts, { x, y, w, h, opening: o, model, yOf, W, H });
    }
    if (interactive && sel) {
      const hs = [
        ["l", x, y + h / 2],
        ["r", x + w, y + h / 2],
        ["t", x + w / 2, y],
      ];
      if (o.category !== "door") hs.push(["b", x + w / 2, y + h]);
      for (const [part, hx, hy] of hs) {
        parts.push(`<rect x="${hx - HANDLE}" y="${hy - HANDLE}" width="${HANDLE * 2}" height="${HANDLE * 2}" class="elev-handle elev-handle-${part}" data-elev-op="${part}" data-elev-id="${esc(o.id)}"/>`);
      }
    }
  }

  // Finish band edges: the top and bottom of a room rule or a run, and the
  // ends of a run. The computed default has none. Drawn after the openings so
  // an edge is still reachable where an opening overlaps the band.
  if (interactive) {
    const EDGE = 4;
    for (const b of model.finishBands) {
      if (!b.editable || b.outline) continue;
      const bx = xOf(b.from);
      const bw = (b.to - b.from) * scale;
      const byTop = yOf(model.base + b.top);
      const byBottom = yOf(model.base + b.bottom);
      const edge = (part, x, y, w, h) => parts.push(`<rect x="${x}" y="${y}" width="${Math.max(2, w)}" height="${Math.max(2, h)}" class="elev-band-edge elev-band-edge-${part}" data-elev-op="band-${part}" data-elev-band="${esc(b.id)}"/>`);
      edge("top", bx, byTop - EDGE / 2, bw, EDGE);
      edge("bottom", bx, byBottom - EDGE / 2, bw, EDGE);
      if (b.source === "run") {
        edge("left", bx - EDGE / 2, byTop, EDGE, byBottom - byTop);
        edge("right", bx + bw - EDGE / 2, byTop, EDGE, byBottom - byTop);
      }
    }
    for (const b of model.finishBands) {
      if (!b.outline || b.outline.length < 3 || b.id !== selectedBandId) continue;
      const pts = b.outline.map(([s, z]) => [xOf(s), yOf(model.base + z)]);
      for (let i = 0; i < b.outline.length; i += 1) {
        const [s1, z1] = b.outline[i];
        const [s2, z2] = b.outline[(i + 1) % b.outline.length];
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % pts.length];
        parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="elev-outline-edge" data-elev-op="outline-edge" data-elev-band="${esc(b.id)}" data-elev-index="${i}"/>`);
        measureLabel(parts, x1, y1, x2, y2, Math.hypot(s2 - s1, z2 - z1));
      }
      b.outline.forEach(([s, z], i) => {
        const x = xOf(s);
        const y = yOf(model.base + z);
        const picked = selectedVertex === i ? " is-selected" : "";
        parts.push(`<rect x="${x - HANDLE}" y="${y - HANDLE}" width="${HANDLE * 2}" height="${HANDLE * 2}" class="elev-handle${picked}" data-elev-op="outline-vertex" data-elev-band="${esc(b.id)}" data-elev-index="${i}"/>`);
      });
    }
  }

  if ((interactive || dragTop) && model.canDragTop !== false) {
    const EDGE = 8;
    const grip = Math.min(ww, 36);
    const gx = wx + (ww - grip) / 2;
    parts.push(`<rect x="${gx}" y="${wy - EDGE / 2}" width="${grip}" height="${EDGE}" class="elev-wall-top" data-elev-op="wall-top"/>`);
    parts.push(`<rect x="${wx + ww / 2 - HANDLE}" y="${wy - HANDLE}" width="${HANDLE * 2}" height="${HANDLE * 2}" class="elev-handle elev-handle-t elev-wall-top-handle" data-elev-op="wall-top"/>`);
  }

  alignLines(parts, model, guides, xOf, yOf, W, H);

  if (draft?.points?.length) {
    const xy = (p) => `${xOf(p.s)},${yOf(model.base + p.z)}`;
    const placed = draft.points.map(xy).join(" ");
    const hover = draft.hover ? ` ${xy(draft.hover)}` : "";
    if (draft.points.length >= 3) {
      parts.push(`<polygon points="${placed}" class="elev-draft-fill" style="fill:${finishSwatch(draft.category)};fill-opacity:0.35"/>`);
    }
    parts.push(`<polyline points="${placed}${hover}" class="elev-draft"/>`);
    for (let i = 1; i < draft.points.length; i += 1) {
      const a = draft.points[i - 1];
      const b = draft.points[i];
      measureLabel(parts, xOf(a.s), yOf(model.base + a.z), xOf(b.s), yOf(model.base + b.z), Math.hypot(b.s - a.s, b.z - a.z));
    }
    if (draft.hover) {
      const last = draft.points[draft.points.length - 1];
      measureLabel(
        parts,
        xOf(last.s), yOf(model.base + last.z),
        xOf(draft.hover.s), yOf(model.base + draft.hover.z),
        Math.hypot(draft.hover.s - last.s, draft.hover.z - last.z),
      );
    }
    for (const p of draft.points) parts.push(`<circle cx="${xOf(p.s)}" cy="${yOf(model.base + p.z)}" r="3.5" class="elev-draft-pt"/>`);
  }

  if (interactive) {
    parts.push(`<text x="${wx + ww / 2}" y="${Math.min(H - 3, yOf(model.base) + 12)}" text-anchor="middle" class="elev-dim">${mm(model.length)}</text>`);
  }
  if (interactive || dragTop) {
    parts.push(`<text x="${wx - 4}" y="${wy + wh / 2}" text-anchor="end" class="elev-dim">${mm(model.height)}</text>`);
  }

  const label = `Wall elevation, ${mm(model.length)} long, ${mm(model.height)} high, ${model.openings.length} opening${model.openings.length === 1 ? "" : "s"}`;
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" class="elev-svg">${parts.join("")}</svg>`,
    scale,
    originX,
    originY,
  };
}
