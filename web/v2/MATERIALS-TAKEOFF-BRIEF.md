# Brief: materials the builder orders, starting with a wall on its foundation

The BOQ says what is built: square metres of 220 wall, cubic metres of footing. The builder orders bricks, bags of cement, sand and stone. Today the BOM is the BOQ without the money, so it still says square metres of wall. This brief adds the step between them, one trade at a time, and builds the first slice: a ground floor masonry wall, the foundation wall under it, and the strip footing under that.

Two industry bodies publish the figures, and they disagree. The app carries both and the job picks one. It does not average them, and it does not pick one silently.

## The shape every trade follows

These hold for this slice and every one after it. Do not reopen them while building a trade.

1. **Materials read compiled quantities, never geometry.** A method takes a compiled row's measures (face area, core thickness, volume) and nothing else. That is what lets the same method run later on a hand-entered quantity.
2. **A method is code, not a formula string.** `brickwork` and `concrete` are named functions in `materials.js`. The figures they multiply by are data, with the publication they came from.
3. **Every figure names its source.** A source is a publication: who, which document, which table. Where two sources disagree, both are carried and the job picks one per trade. Where a source states a range, or does not cover a case, its figure is `null` and the line says so.
4. **Measured and order quantities are separate.** The measured quantity is the published figure times the drawing, with no waste. The order quantity adds the job's waste allowance and rounds up to what is sold: whole bricks, whole 50 kg bags. With no waste allowance stated, the order quantity is blank.
5. **Unknown stays blank.** No source picked, no brick picked, a wall that does not divide into whole leaves, no concrete strength: the quantity is not counted, the line says what is missing, and the gap is listed at the top of the BOM.
6. **The BOQ does not change.** Material lines appear in the BOM only. Pricing stays in the rate book, against the measured work.
7. **Finishes stay finishes.** Plaster, paint and tiles come from the finish model as they do now. A "220 (plaster)" wall type gives bricks and mortar here and nothing for its plaster.

## Sources

Both are free to download. Figures below are as published.

**Clay Brick Association (CBA)**
- *Clay Bricklaying Made Easy*, ch. 21, p. 82: 220 mm or two-leaf wall, 110 bricks per m² of walling.
- *Building Contractors Pocket Handbook*, mortar: Class II, 3 bags cement + 0.6 m³ sand lay 1 000 bricks. Single leaf: "approximately 52–56 bricks/m²" (a range, so no figure).
- Same handbook, concrete mixes: low strength (house foundations) 5½ bags + 0.75 m³ sand + 0.75 m³ stone per m³; medium strength 7 bags + 0.7 m³ + 0.7 m³. No high strength.

**Concrete Society of Southern Africa (CSSA)**, *Quantities for ordering building materials* (2024)
- Table 3, per leaf, 10 mm joints, no waste: 222×106×73 brick, 52 per m² and 0.34 m³ mortar per 1 000; 290×140×90 brick, 34 per m² and 0.56 m³ per 1 000. It does not count the vertical joint between two leaves.
- Table 2, Class II mortar with common cement: 7 bags + 1.35 m³ sand per m³ of mortar.
- Tables 1a–1d, per m³ of concrete, no waste. Four variants by cement class (32,5 or 42,5) and stone size (19 or 13,2 mm), each giving low (15 MPa), medium (25 MPa) and high (30 MPa).

Where they disagree on this slice, for 100 m² of 220 brickwork:

| | CBA | CSSA |
|---|---|---|
| Bricks | 11 000 | 10 400 |
| Mortar cement | 33 bags | 24.8 bags |
| Mortar sand | 6.6 m³ | 4.8 m³ |

## Slice 1: wall, foundation wall, footing

### What counts

- **Brickwork**: every compiled row whose SKU is a `wall` or `foundation` with `drawing.colourClass: "masonry"`. That covers drawn walls, room walls and the derived 220 foundation walls. Boundary and pool walls come later.
- **Concrete**: every `foundation` row with `colourClass: "concrete"`. That covers the implied 600×200 footing and a drawn strip footing. Floor slabs come later.

### Measures compile adds (additive, no field renamed)

- `faceArea` on every wall and foundation row: length × resolved height, less the openings hosted in it. The existing `area` stays gross, because the QS workbook reads it.
- `coreThickness` on the same rows: the SKU's core thickness when it states one, else the wall's own thickness. A derived foundation wall is 0.22 (`system.foundationWallThickness`). A drawn 220 Foundation type is 0.24, because the template says 240.

### Brickwork

- **Leaves** = (core + 10) ÷ (brick width + 10), accepted only within 0.1 of a whole number. A 220 core with a 106 brick gives 1.98, so two leaves. A 240 drawn foundation wall gives 2.16, so no count and a gap. That is the template's 240 again (TEMPLATE-ASKS.md), now visible in the BOM.
- **Bricks** = face area × bricks per m². CBA states two leaves only. CSSA states one leaf, so two leaves are twice its figure.
- **Mortar**: CBA gives cement and sand per 1 000 bricks directly. CSSA gives a mortar volume per 1 000 bricks times the Class II mix. Class II is the only class both cover and is "used for most applications", so it is fixed for this slice.

### Concrete

- Strength is chosen per concrete type on the job (low, medium, high), because it is a design decision, not a template fact. It is blank until chosen. Both sources call low strength right for single storey house foundations, but the app does not choose it.
- Cement, sand and stone = volume × the source's figures for that strength. If the source states nothing for that strength (CBA high), the line is blank and the gap says why.
- The implied 600 × 200 footing is only compiled under room walls (`explodeRecipes` is fed room-derived walls). Walls drawn with the wall tool get a derived foundation wall but no footing, so their concrete is missing from both the BOQ and the BOM. That is existing behaviour, left alone here because fixing it changes BOQ quantities; it needs its own decision.

### Lines

One BOM line per material, summed across every element behind it, each listing those elements so "Show all" works as it does for SKU lines:

| Code | Description | Unit |
|---|---|---|
| `MAT-BRICK-222x106x73` | Bricks 222 × 106 × 73 mm | ea |
| `MAT-MORTAR-CEMENT` | Common cement, 50 kg, Class II mortar | bags |
| `MAT-MORTAR-SAND` | Building sand, Class II mortar | m3 |
| `MAT-CONCRETE-CEMENT` | Common cement, 50 kg, concrete | bags |
| `MAT-CONCRETE-SAND` | Concrete sand | m3 |
| `MAT-CONCRETE-STONE` | Stone (size as the source states) | m3 |

The category is `Materials`, so they group together at the end of the BOM. Each description ends with the source it used.

## Data

Doc-level, normalized like `finishSettings`, never in the pack, because the pack is the firm's template and these are choices for the job.

```js
materialSettings: {
  masonrySource: null,      // "cba" | "cssa"
  concreteSource: null,     // "cba" | "cssa-1a" | "cssa-1b" | "cssa-1c" | "cssa-1d"
  brick: null,              // "222x106x73" | "290x140x90"
  concreteStrength: {},     // { [skuId]: "low" | "medium" | "high" }
  waste: { bricks: null, mortar: null, concrete: null }, // fractions, 0.05 = 5%
}
```

## UI

The job-wide choices live in **Job settings** (Document › Project), under Materials:
- source for bricks and mortar
- brick
- source for concrete
- waste % for bricks, mortar and concrete

The BOM panel gets a **Materials** strip above the lines: a one-line summary of those choices (an unmade one says "not chosen") with a button that opens Job settings, the source citations, and one strength select per concrete type the drawing uses. Strength stays on the BOM because the list only exists once the types are drawn.

Each choice is one undo step and saves with the job. The BOM table gains an **Order** column, which also shows the order quantities finishes already compute. The gaps print in the existing warning banner.

## Later (not in this pass)

- Boundary and pool walls, 110 partitions on a CBA source (a range only), floor slabs, screed, plaster, roof, ceilings, paint, tiles. Each is a method plus figures, in the shape above.
- A firm-wide default for the source and waste choices, so a new job does not start blank.
- Brickforce, DPC, wall ties, lintels: counted items that need the wall's courses and openings.
- Excel export of the material lines (BOQ-EXCEL-EXPORT-BRIEF.md already exports `orderQty`).

## Do not change

- `schedule.js` (`bomRows`, `boqRows`) and the BOQ view.
- The compiled `area`, `volume`, `length` and `count` of any row.
- The pack and its schema.

## Acceptance

Template pack, a 5 × 4 m room on the ground floor in 220 plastered walls, height to the level above. Four derived foundation walls and the implied footing.

1. New job: the BOM shows the Materials strip, every material line blank, and gaps asking for a masonry source, a brick, a concrete source and a footing strength.
2. CBA, 222×106×73: bricks = 110 × total face area (walls plus foundation walls). Mortar cement = bricks ÷ 1 000 × 3.
3. CSSA, same brick: bricks = 104 × the same face area. Mortar cement = bricks ÷ 1 000 × 0.34 × 7.
4. A 900 × 2 100 door in one wall takes 1.89 m² off the brick face area.
5. Footing low strength, CSSA 1a: cement = 5.8 × footing volume. On CBA high: blank, with the gap.
6. Waste 5% on bricks: order = ceil(bricks × 1.05). No waste stated: Order is blank.
7. A drawn 220 Foundation type (240 thick) adds no bricks and is listed as a gap.
8. Undo reverts each setting. Save and reopen keeps them.
9. The BOQ shows no material lines and its totals do not move.
