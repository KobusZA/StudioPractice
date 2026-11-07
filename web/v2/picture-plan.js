// A reference picture read as a plan, not as a mesh.
//
// The courtyard photograph has no scale and no north. What it does show is
// a square outer wall, a square court open to the sky, a hip that stops at
// that court, and two doors in the inner wall the camera faces. Sizes below
// are fixed from those facts and from the firm's door, not from the picture.

import { rectShape } from "./model.js";

const LEVEL = "01 GFL";
const WALL = "TSP_MAS009";
const DOOR = "TSP_DR813";
const ROOF = "TSP_RC003";

// 220 mm wall, half either side of the centreline.
const HALF = 0.11;
// Firm door, metres. Mullion is the gap the picture shows between the two leaves.
const DOOR_WIDTH = 0.813;
const MULLION = 0.12;

/**
 * Outer square 10 m on the wall centreline. The court is 4 m on the
 * centreline, which leaves a pier either side of the two doors. The roof
 * outline is the outer face. The hole is the inner face of the court.
 * Pitch is the roof default: the picture does not measure it.
 */
export function courtyardHouseDoc() {
  const outer = 10;
  const inner0 = 3;
  const inner1 = 7;
  const span = inner1 - inner0;
  const gap = DOOR_WIDTH + MULLION;
  const t1 = 0.5 - (gap / 2) / span;
  const t2 = 0.5 + (gap / 2) / span;
  const seg = (id, x1, y1, x2, y2) => ({
    id, sku: WALL, level: LEVEL, x1, y1, x2, y2, status: "planned",
  });
  return {
    name: "Courtyard house",
    segments: [
      seg("w-s", 0, 0, outer, 0),
      seg("w-e", outer, 0, outer, outer),
      seg("w-n", outer, outer, 0, outer),
      seg("w-w", 0, outer, 0, 0),
      seg("c-s", inner0, inner0, inner1, inner0),
      seg("c-e", inner1, inner0, inner1, inner1),
      seg("c-n", inner1, inner1, inner0, inner1),
      seg("c-w", inner0, inner1, inner0, inner0),
    ],
    roofs: [{
      id: "rf-court",
      sku: ROOF,
      level: LEVEL,
      form: "hip",
      pitch: 30,
      ridge: "long",
      status: "planned",
      shape: rectShape(-HALF, -HALF, outer + HALF * 2, outer + HALF * 2),
      cuts: [{
        id: "court",
        kind: "hole",
        shape: rectShape(inner0 + HALF, inner0 + HALF, span - HALF * 2, span - HALF * 2),
      }],
    }],
    openings: [
      { id: "d1", sku: DOOR, wallId: "c-s", t: t1, level: LEVEL },
      { id: "d2", sku: DOOR, wallId: "c-s", t: t2, level: LEVEL },
    ],
  };
}
