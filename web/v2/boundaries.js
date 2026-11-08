// Boundary walls and fences around an erf. They are not in the Revit template,
// so they are added the same way a plain opening is: stated here, then copied
// into the pack. Geometry is millimetres.
//
// A plastered masonry type uses the same 10 mm of plaster each side as the
// template's own plastered walls (a 220 mm leaf is 240 mm overall). A precast
// panel is the 50 mm slab. Piers named in a type are not a separate quantity.
// A street-edge wall is 1.2 m of brick; its length is also the palisade or
// mesh above it. A fence is its own category and is measured by length.

function boundaryWall(id, name, geometry, { plastered, colourClass }) {
  return {
    id,
    name,
    family: "Boundary wall",
    category: "boundarywall",
    unit: "m3",
    draw: "wall",
    revit: { category: "Walls", family: "Boundary wall", type: name, placedCount: 0 },
    geometry,
    cost: { rateRef: null, wasteFactor: null },
    compliance: { loadBearing: false, plastered },
    drawing: { colourClass, hatch: null, symbol: null },
    schedule: { report: ["length", "area", "volume", "count"], scheduleName: null },
  };
}

function fence(id, name, height) {
  return {
    id,
    name,
    family: "Fence",
    category: "fence",
    unit: "m",
    draw: "wall",
    revit: { category: "Fences", family: "Fence", type: name, placedCount: 0 },
    // The plan line. Not a post size.
    geometry: { thickness: 50, height },
    cost: { rateRef: null, wasteFactor: null },
    compliance: { loadBearing: false },
    drawing: { colourClass: "steel", hatch: null, symbol: null },
    schedule: { report: ["length", "count"], scheduleName: null },
  };
}

const plasteredBrick = { plastered: true, colourClass: "masonry" };
const fairBrick = { plastered: false, colourClass: "masonry" };
const plasteredBlock = { plastered: true, colourClass: "concrete" };
const precast = { plastered: false, colourClass: "concrete" };

export const BOUNDARY_SKUS = [
  boundaryWall("TSP_BND_BRICK_220_PLASTER_1800", "Stock brick 220 mm, plastered, 1.8 m", { thickness: 240, height: 1800, coreThickness: 220 }, plasteredBrick),
  boundaryWall("TSP_BND_FACE_220_1800", "Face brick 220 mm, 1.8 m", { thickness: 220, height: 1800 }, fairBrick),
  boundaryWall("TSP_BND_BRICK_110_PIERS_1800", "Stock brick 110 mm, plastered, with brick piers, 1.8 m", { thickness: 130, height: 1800, coreThickness: 110 }, plasteredBrick),
  boundaryWall("TSP_BND_BLOCK_140_PIERS_1800", "Concrete block 140 mm, plastered, with piers, 1.8 m", { thickness: 160, height: 1800, coreThickness: 140 }, plasteredBlock),
  boundaryWall("TSP_BND_BLOCK_190_PIERS_1800", "Concrete block 190 mm, plastered, with piers, 1.8 m", { thickness: 210, height: 1800, coreThickness: 190 }, plasteredBlock),
  boundaryWall("TSP_BND_PRECAST_1500", "Precast concrete panels 50 mm, 1.5 m", { thickness: 50, height: 1500 }, precast),
  boundaryWall("TSP_BND_PRECAST_1800", "Precast concrete panels 50 mm, 1.8 m", { thickness: 50, height: 1800 }, precast),
  boundaryWall("TSP_BND_PRECAST_2100", "Precast concrete panels 50 mm, 2.1 m", { thickness: 50, height: 2100 }, precast),
  boundaryWall("TSP_BND_PRECAST_2400", "Precast concrete panels 50 mm, 2.4 m", { thickness: 50, height: 2400 }, precast),
  boundaryWall("TSP_BND_PRECAST_BRICK_PIERS_1800", "Precast concrete panels 50 mm between brick piers, 1.8 m", { thickness: 50, height: 1800 }, precast),
  boundaryWall("TSP_BND_PRECAST_BLOCK_PIERS_1800", "Precast concrete panels 50 mm between block piers, 1.8 m", { thickness: 50, height: 1800 }, precast),
  boundaryWall("TSP_BND_BRICK_220_PALISADE_1200", "Stock brick 220 mm, plastered, 1.2 m, with steel palisade above", { thickness: 240, height: 1200, coreThickness: 220 }, plasteredBrick),
  boundaryWall("TSP_BND_BRICK_220_CLEARVU_1200", "Stock brick 220 mm, plastered, 1.2 m, with ClearVu above", { thickness: 240, height: 1200, coreThickness: 220 }, plasteredBrick),
  fence("TSP_FEN_PALISADE_1800", "Steel palisade, 1.8 m", 1800),
  fence("TSP_FEN_CLEARVU_1800", "ClearVu welded mesh, 1.8 m", 1800),
];
