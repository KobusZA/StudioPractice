// Plan symbols for sanitary fittings, drawn to the fitting's true size.
// SANS 10143 shows these as thin line conventions, not as the manufacturer's
// outline and not as a filled box: a close-coupled WC is a cistern against
// the wall with the pan in front, a basin is a bowl with taps and a waste,
// a bath is a double line (rim) with taps at one end and the waste at the
// other, a shower is a crossed tray, a front-loading washer is a rectangle
// with its door. The wall side of every symbol is local v = 0. Rotation
// keeps the footprint in the same axis-aligned box the plan already uses.

const TAP = 0.012;

export function fixtureSize(sku) {
  const g = sku?.geometry || {};
  const width = Number(g.width) > 0 ? g.width : 0.4;
  const depth = Number(g.depth) > 0 ? g.depth : width;
  return { width, depth };
}

/** Which SANS 10143 plan symbol this type is, or null to keep the plain box. */
export function fixtureSymbolKind(sku) {
  if (!sku) return null;
  const name = `${sku.family || ""} ${sku.name || ""}`;
  if (sku.category === "waterheater" || /geyser|water heater|hot[- ]water cylinder/i.test(name)) return "geyser";
  if (/dishwasher/i.test(name)) return "dishwasher";
  if (/washing machine/i.test(name)) return "washer";
  if (sku.category !== "sanitary") return null;
  if (/bidet/i.test(name)) return "bidet";
  if (/urinal/i.test(name)) return "urinal";
  if (/shower/i.test(name)) return "shower";
  if (/bath|tub/i.test(name)) return /free\s*standing/i.test(name) ? "bath-free" : "bath";
  if (/vanity/i.test(name) && /round/i.test(name)) return "basin-round";
  if (/sink/i.test(name) && /round/i.test(name)) return "basin-round";
  if (/sink/i.test(name) && /double/i.test(name)) return "sink-double";
  if (/sink/i.test(name) && !/basin/i.test(name)) return "sink";
  if (/vanity/i.test(name)) return "vanity";
  if (/basin|\bwhb\b|hand\s*wash/i.test(name)) return "basin";
  if (/wall[-\s]?hung|concealed cistern/i.test(name)) return "wc-wall";
  if (/\bwc\b|toilet|closed?\s*couple|\bpan\b/i.test(name)) return "wc";
  return null;
}

/**
 * Maps local metres (u across, v out from the wall) into the item's box.
 * 0° leaves the wall on the origin edge. 90°, 180° and 270° turn the symbol
 * but the box still grows in +x and +y, matching itemRect.
 */
export function fixtureFrame(rotation, width, depth) {
  const rot = ((Math.round(rotation || 0) % 360) + 360) % 360;
  if (rot === 90) return { a: 0, b: -1, c: 1, d: 0, e: 0, f: width };
  if (rot === 180) return { a: -1, b: 0, c: 0, d: -1, e: width, f: depth };
  if (rot === 270) return { a: 0, b: 1, c: -1, d: 0, e: depth, f: 0 };
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

export function fixturePrimitives(kind, width, depth) {
  const w = width;
  const d = depth;
  switch (kind) {
    case "wc": return wcPrimitives(w, d, true);
    case "wc-wall": return wcPrimitives(w, d, false);
    case "bidet": return bidetPrimitives(w, d);
    case "urinal": return urinalPrimitives(w, d);
    case "basin": return basinPrimitives(w, d, false);
    case "vanity": return basinPrimitives(w, d, true);
    case "basin-round": return roundBasinPrimitives(w, d);
    case "bath": return bathPrimitives(w, d, false);
    case "bath-free": return bathPrimitives(w, d, true);
    case "shower": return showerPrimitives(w, d);
    case "washer": return washerPrimitives(w, d);
    case "dishwasher": return dishwasherPrimitives(w, d);
    case "sink": return sinkPrimitives(w, d, 1);
    case "sink-double": return sinkPrimitives(w, d, 2);
    case "geyser": return geyserPrimitives(w, d);
    default: return [];
  }
}

/** The front of an ellipse from a straight cut at yCut through to the front. */
function ellipseFront(cx, cy, rx, ry, yCut) {
  const t = Math.max(-0.98, Math.min(0.98, (yCut - cy) / ry));
  const aL = Math.PI - Math.asin(t);
  const aR = Math.asin(t);
  let sweep = aR - aL;
  if (sweep > 0) sweep -= Math.PI * 2;
  const steps = 18;
  const pts = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = aL + sweep * (i / steps);
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

function wcPrimitives(w, d, cistern) {
  const side = Math.min(w * 0.04, 0.015);
  const rx = w / 2 - side;
  if (cistern) {
    const ch = Math.min(d * 0.3, Math.max(d * 0.2, Math.min(0.17, d * 0.38)));
    const yCut = ch * 0.28;
    const front = d - side * 0.5;
    const ry = Math.max((front - yCut) * 0.62, (front - yCut) / 2 + 0.001);
    const cy = front - ry;
    return [
      { op: "rect", x: w / 2 - rx, y: 0, w: rx * 2, h: ch },
      { op: "polyline", pts: ellipseFront(w / 2, cy, rx, ry, yCut) },
    ];
  }
  const yCut = Math.min(d * 0.04, 0.02);
  const front = d - side * 0.25;
  const ry = (front - yCut) * 0.7;
  const cy = front - ry;
  return [
    { op: "polyline", pts: ellipseFront(w / 2, cy, rx, ry, yCut) },
    { op: "line", x1: side, y1: yCut, x2: w - side, y2: yCut },
  ];
}

function bidetPrimitives(w, d) {
  const yCut = d * 0.12;
  const front = d * 0.96;
  const ry = (front - yCut) * 0.62;
  const cy = front - ry;
  const rx = w * 0.4;
  return [
    { op: "polyline", pts: ellipseFront(w / 2, cy, rx, ry, yCut) },
    { op: "line", x1: w / 2 - rx * 0.7, y1: yCut, x2: w / 2 + rx * 0.7, y2: yCut },
    { op: "circle", cx: w / 2 - w * 0.1, cy: yCut + d * 0.06, r: TAP },
    { op: "circle", cx: w / 2 + w * 0.1, cy: yCut + d * 0.06, r: TAP },
    { op: "circle", cx: w / 2, cy: cy + ry * 0.15, r: TAP },
  ];
}

function urinalPrimitives(w, d) {
  const yCut = 0;
  const ry = d * 0.9;
  const cy = yCut + ry * 0.15;
  const rx = w * 0.42;
  return [
    { op: "polyline", pts: ellipseFront(w / 2, cy, rx, ry * 0.85, yCut) },
    { op: "line", x1: w * 0.12, y1: 0, x2: w * 0.88, y2: 0 },
    { op: "circle", cx: w / 2, cy: d * 0.55, r: TAP },
  ];
}

function basinPrimitives(w, d, vanity) {
  const rim = Math.min(0.035, Math.min(w, d) * 0.08);
  const bowlCx = w / 2;
  const bowlCy = vanity ? d * 0.58 : d * 0.56;
  const rx = vanity ? w * 0.28 : w * 0.36;
  const ry = vanity ? d * 0.24 : d * 0.3;
  const tapY = Math.max(rim * 0.9, d * 0.07);
  const tapDx = Math.min(0.04, w * 0.14);
  return [
    { op: "roundRect", x: 0, y: 0, w, h: d, r: Math.min(0.02, Math.min(w, d) * 0.06) },
    { op: "ellipse", cx: bowlCx, cy: bowlCy, rx, ry },
    { op: "circle", cx: bowlCx, cy: bowlCy, r: Math.min(0.016, Math.min(w, d) * 0.04) },
    { op: "circle", cx: bowlCx - tapDx, cy: tapY, r: TAP * 0.85 },
    { op: "circle", cx: bowlCx + tapDx, cy: tapY, r: TAP * 0.85 },
  ];
}

function roundBasinPrimitives(w, d) {
  const r = Math.min(w, d) * 0.48;
  const cx = w / 2;
  const cy = d / 2;
  const tapY = cy - r * 0.62;
  const tapDx = Math.min(0.035, r * 0.28);
  return [
    { op: "circle", cx, cy, r },
    { op: "circle", cx, cy, r: r * 0.72 },
    { op: "circle", cx, cy, r: Math.min(0.016, r * 0.08) },
    { op: "circle", cx: cx - tapDx, cy: tapY, r: TAP * 0.85 },
    { op: "circle", cx: cx + tapDx, cy: tapY, r: TAP * 0.85 },
  ];
}

function alongLength(w, d) {
  if (w >= d) {
    return {
      head: { x: Math.min(w * 0.1, 0.16), y: d / 2 },
      foot: { x: Math.max(w * 0.88, w - 0.18), y: d / 2 },
      across: "v",
    };
  }
  return {
    head: { x: w / 2, y: Math.min(d * 0.1, 0.16) },
    foot: { x: w / 2, y: Math.max(d * 0.88, d - 0.18) },
    across: "u",
  };
}

function tapPair(head, across) {
  const gap = 0.028;
  if (across === "v") {
    return [
      { op: "circle", cx: head.x, cy: head.y - gap, r: TAP },
      { op: "circle", cx: head.x, cy: head.y + gap, r: TAP },
    ];
  }
  return [
    { op: "circle", cx: head.x - gap, cy: head.y, r: TAP },
    { op: "circle", cx: head.x + gap, cy: head.y, r: TAP },
  ];
}

function bathPrimitives(w, d, freestanding) {
  const { head, foot, across } = alongLength(w, d);
  const taps = tapPair(head, across);
  const waste = { op: "circle", cx: foot.x, cy: foot.y, r: Math.min(0.02, Math.min(w, d) * 0.045) };
  if (freestanding) {
    const rx = w * 0.46;
    const ry = d * 0.46;
    return [
      { op: "ellipse", cx: w / 2, cy: d / 2, rx, ry },
      { op: "ellipse", cx: w / 2, cy: d / 2, rx: rx * 0.84, ry: ry * 0.86 },
      ...taps,
      waste,
    ];
  }
  const rim = Math.min(0.05, Math.min(w, d) * 0.07);
  const rr = Math.min(0.09, Math.min(w, d) * 0.16);
  return [
    { op: "rect", x: 0, y: 0, w, h: d },
    { op: "roundRect", x: rim, y: rim, w: w - rim * 2, h: d - rim * 2, r: rr },
    ...taps,
    waste,
  ];
}

function showerPrimitives(w, d) {
  const rose = Math.min(w, d) * 0.16;
  return [
    { op: "rect", x: 0, y: 0, w, h: d },
    { op: "line", x1: 0, y1: 0, x2: w, y2: d },
    { op: "line", x1: w, y1: 0, x2: 0, y2: d },
    { op: "circle", cx: rose, cy: rose, r: Math.min(0.045, Math.min(w, d) * 0.1) },
  ];
}

function washerPrimitives(w, d) {
  const r = Math.min(w, d) * 0.28;
  return [
    { op: "rect", x: 0, y: 0, w, h: d },
    { op: "circle", cx: w / 2, cy: d / 2, r },
    { op: "circle", cx: w / 2, cy: d / 2, r: r * 0.16 },
  ];
}

function dishwasherPrimitives(w, d) {
  const insetX = w * 0.16;
  return [
    { op: "rect", x: 0, y: 0, w, h: d },
    { op: "line", x1: insetX, y1: d * 0.38, x2: w - insetX, y2: d * 0.38 },
    { op: "line", x1: insetX, y1: d * 0.62, x2: w - insetX, y2: d * 0.62 },
  ];
}

function sinkPrimitives(w, d, bowls) {
  const inset = Math.min(w, d) * 0.12;
  const parts = [
    { op: "rect", x: 0, y: 0, w, h: d },
    { op: "circle", cx: w / 2 - Math.min(0.04, w * 0.12), cy: inset * 0.55, r: TAP * 0.85 },
    { op: "circle", cx: w / 2 + Math.min(0.04, w * 0.12), cy: inset * 0.55, r: TAP * 0.85 },
  ];
  const wasteR = Math.min(0.015, d * 0.04);
  if (bowls >= 2) {
    const gap = w * 0.05;
    const bw = (w - inset * 2 - gap) / 2;
    const bh = d - inset * 2.4;
    const y = inset * 1.3;
    parts.push({ op: "rect", x: inset, y, w: bw, h: bh });
    parts.push({ op: "rect", x: inset + bw + gap, y, w: bw, h: bh });
    parts.push({ op: "circle", cx: inset + bw / 2, cy: y + bh / 2, r: wasteR });
    parts.push({ op: "circle", cx: inset + bw + gap + bw / 2, cy: y + bh / 2, r: wasteR });
    return parts;
  }
  const bw = w * 0.46;
  const bh = d - inset * 2.2;
  const y = inset * 1.2;
  parts.push({ op: "rect", x: inset, y, w: bw, h: bh });
  parts.push({ op: "circle", cx: inset + bw / 2, cy: y + bh / 2, r: wasteR });
  const x0 = inset + bw + w * 0.06;
  const x1 = w - inset;
  for (let i = 0; i < 4; i += 1) {
    const t = (i + 1) / 5;
    parts.push({ op: "line", x1: x0, y1: y + bh * t, x2: x1, y2: y + bh * t });
  }
  return parts;
}

function geyserPrimitives(w, d) {
  const r = Math.min(w, d) * 0.46;
  return [
    { op: "circle", cx: w / 2, cy: d / 2, r },
    { op: "line", x1: w / 2 - r, y1: d / 2, x2: w / 2 + r, y2: d / 2 },
  ];
}

function strokeRoundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.stroke();
}

/**
 * Stroke the symbol. `worldToPx(x, y)` returns canvas pixels. `pxPerM` scales
 * radii. Returns false when this type has no conventional symbol.
 */
export function paintFixture(ctx, item, sku, worldToPx, pxPerM) {
  const kind = fixtureSymbolKind(sku);
  if (!kind) return false;
  const { width, depth } = fixtureSize(sku);
  const parts = fixturePrimitives(kind, width, depth);
  if (!parts.length) return false;
  const frame = fixtureFrame(item?.rotation, width, depth);
  const ox = Number(item?.x) || 0;
  const oy = Number(item?.y) || 0;
  const scale = Number(pxPerM) > 0 ? pxPerM : 1;
  const pt = (u, v) => {
    const p = worldToPx(ox + frame.a * u + frame.c * v + frame.e, oy + frame.b * u + frame.d * v + frame.f);
    return Array.isArray(p) ? p : [p.x, p.y];
  };
  for (const part of parts) {
    if (part.op === "line") {
      const a = pt(part.x1, part.y1);
      const b = pt(part.x2, part.y2);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    } else if (part.op === "polyline" && part.pts.length > 1) {
      ctx.beginPath();
      part.pts.forEach((p, i) => {
        const s = pt(p[0], p[1]);
        if (i === 0) ctx.moveTo(s[0], s[1]);
        else ctx.lineTo(s[0], s[1]);
      });
      ctx.stroke();
    } else if (part.op === "rect") {
      const a = pt(part.x, part.y);
      const b = pt(part.x + part.w, part.y + part.h);
      ctx.beginPath();
      ctx.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
      ctx.stroke();
    } else if (part.op === "roundRect") {
      const a = pt(part.x, part.y);
      const b = pt(part.x + part.w, part.y + part.h);
      strokeRoundRect(
        ctx,
        Math.min(a[0], b[0]),
        Math.min(a[1], b[1]),
        Math.abs(b[0] - a[0]),
        Math.abs(b[1] - a[1]),
        part.r * scale,
      );
    } else if (part.op === "ellipse") {
      const c = pt(part.cx, part.cy);
      const rot = ((Math.round(item?.rotation || 0) % 360) + 360) % 360;
      const swap = rot === 90 || rot === 270;
      const rx = Math.max(0.4, (swap ? part.ry : part.rx) * scale);
      const ry = Math.max(0.4, (swap ? part.rx : part.ry) * scale);
      ctx.beginPath();
      ctx.ellipse(c[0], c[1], rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (part.op === "circle") {
      const c = pt(part.cx, part.cy);
      ctx.beginPath();
      ctx.arc(c[0], c[1], Math.max(0.6, part.r * scale), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  return true;
}
