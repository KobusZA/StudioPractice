// People and cars for scale. They are outlines, not building elements:
// compile() never reads them, so they add nothing to quantities or checks.
// A person is a flat silhouette turned toward the camera. A car keeps the
// heading it was placed with, so a garage can be checked for fit.

export const FIGURE_KINDS = ["person", "car"];

export const FIGURE_SIZE = {
  person: { height: 1.8, across: 0.44 },
  car: { length: 4.7, width: 1.8, height: 1.5 },
};

/** Standing outline, across and up, feet on the ground. */
const PERSON = [
  [-0.07, 0],
  [-0.1, 0.82],
  [-0.18, 0.98],
  [-0.22, 1.32],
  [-0.12, 1.42],
  [-0.12, 1.5],
  [-0.14, 1.66],
  [-0.08, 1.8],
  [0.08, 1.8],
  [0.14, 1.66],
  [0.12, 1.5],
  [0.12, 1.42],
  [0.22, 1.32],
  [0.18, 0.98],
  [0.1, 0.82],
  [0.07, 0],
];

/** Sedan side, along the length and up. The nose is the positive end. */
const CAR_SIDE = [
  [-2.35, 0.22],
  [2.15, 0.22],
  [2.05, 0.72],
  [1.05, 0.84],
  [0.4, 1.38],
  [-1.05, 1.46],
  [-1.75, 0.92],
  [-2.28, 0.74],
];

const INK = "#4a453f";
const WASH = "rgba(90,84,76,0.1)";

export function figureLabel(kind) {
  return kind === "car" ? "Car" : "Person";
}

/** Rotation 0 points the car toward +Y. `across` is the car's left-right. */
export function planAxes(degrees) {
  const a = ((Number(degrees) || 0) * Math.PI) / 180;
  const s = Math.sin(a);
  const c = Math.cos(a);
  return { along: [s, c], across: [c, -s] };
}

/**
 * Horizontal "to the right of the picture" in plan, so a person stands
 * facing the camera in orbit, look, section and elevation.
 */
export function billboardRight(cam) {
  if (cam?.mode === "section" || cam?.mode === "elevation") {
    const a = cam.along || [1, 0];
    const len = Math.hypot(Number(a[0]) || 0, Number(a[1]) || 0) || 1;
    return [Number(a[0]) / len, Number(a[1]) / len];
  }
  const yaw = Number(cam?.yaw) || 0;
  if (cam?.mode === "look") return [Math.cos(yaw), -Math.sin(yaw)];
  return [Math.cos(yaw), Math.sin(yaw)];
}

function place(fig, along, across, alongM, acrossM, z) {
  return [
    fig.x + along[0] * alongM + across[0] * acrossM,
    fig.y + along[1] * alongM + across[1] * acrossM,
    (Number(fig.z) || 0) + z,
  ];
}

function face(fig, pts) {
  return {
    pts,
    id: fig.id,
    kind: "figure",
    selectKind: "figure",
    fill: WASH,
    stroke: INK,
    status: "mixed",
  };
}

function personFace(fig, right) {
  const across = [right[0], right[1]];
  const along = [-right[1], right[0]];
  return face(fig, PERSON.map(([u, z]) => place(fig, along, across, 0, u, z)));
}

function carFaces(fig) {
  const { along, across } = planAxes(fig.rotation);
  const half = FIGURE_SIZE.car.width / 2;
  const left = CAR_SIDE.map(([y, z]) => place(fig, along, across, y, -half, z));
  const right = CAR_SIDE.map(([y, z]) => place(fig, along, across, y, half, z));
  const faces = [face(fig, left), face(fig, right.slice().reverse())];
  for (let i = 0; i < left.length; i += 1) {
    const j = (i + 1) % left.length;
    faces.push(face(fig, [left[i], left[j], right[j], right[i]]));
  }
  return faces;
}

/** Faces for one placed figure. A person uses the camera; a car does not. */
export function figureFaces(fig, cam) {
  if (!fig || !Number.isFinite(fig.x) || !Number.isFinite(fig.y)) return [];
  if (fig.kind === "car") return carFaces(fig);
  if (fig.kind === "person") return [personFace(fig, billboardRight(cam))];
  return [];
}

/** Plan outline, closed, in metres. */
export function figureFootprint(fig) {
  if (!fig || !Number.isFinite(fig.x) || !Number.isFinite(fig.y)) return [];
  if (fig.kind === "car") {
    const { along, across } = planAxes(fig.rotation);
    const hx = FIGURE_SIZE.car.width / 2;
    const hy = FIGURE_SIZE.car.length / 2;
    return [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([x, y]) => [
      fig.x + across[0] * x + along[0] * y,
      fig.y + across[1] * x + along[1] * y,
    ]);
  }
  const r = 0.18;
  const pts = [];
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2;
    pts.push([fig.x + Math.cos(a) * r, fig.y + Math.sin(a) * r]);
  }
  return pts;
}

/**
 * A person and a car just outside a building's plan box, so turning
 * "People and cars" on has something to show. `bounds` is `{ x, y, w, h }`
 * or null when nothing is drawn yet.
 */
export function scaleFigurePair(bounds, level = null) {
  const x = bounds && bounds.w > 0 ? bounds.x + bounds.w + 1.2 : 1;
  const y = bounds && bounds.h > 0 ? bounds.y + Math.min(bounds.h * 0.35, 3) : 1;
  return [
    { kind: "person", level, x, y, rotation: 0, status: "mixed" },
    { kind: "car", level, x: x + 2.4, y: y + 2.2, rotation: 0, status: "mixed" },
  ];
}

/** A short mark from the middle of a car toward its nose. Null for a person. */
export function figureNose(fig) {
  if (fig?.kind !== "car") return null;
  const { along } = planAxes(fig.rotation);
  return [
    [fig.x, fig.y],
    [fig.x + along[0] * 1.5, fig.y + along[1] * 1.5],
  ];
}
