# Brief: edit a roof's edges one at a time

Round 1 of roof editing. The roof already lets you drag corners and edges, add a corner by clicking an edge, and delete a corner (`ui.js`, the shape-vertex and shape-edge drags). So the work left here is what those cannot do: give one edge its own overhang, and line an edge up with a wall.

## Goal

Each edge of the anchor outline (`base`) can have its own overhang. The roof edge is built from the anchors with each edge pushed out by its own value. Dragging an edge can snap it to a wall face.

## Do not change

- A roof with one overhang for all edges. It is built exactly as now.
- Form, pitch, ridge, ridge offset, plate height, status, and cuts.
- Plan area and the schedule. They still read the roof edge.
- The 3D is still built on the bounding rectangle of the edge. Per-edge overhang changes the edge in plan and the bounding rectangle in 3D, and nothing else.
- Roofs saved before this change.

## Data

- `edgeOverhang`: an optional list of millimetres, one per anchor edge, edge i running from anchor i to anchor i+1. Missing means every edge uses `overhang`. An entry that is missing or not a number uses `overhang`.
- It lives only on a roof with a `base`. Without a base there are no anchors to attach it to.

Keeping the list in step with the anchors:

- Adding an anchor on edge i splits it: both halves take that edge's value.
- Deleting an anchor merges its two edges: the merged edge takes the larger of the two values.
- Mirror reverses the anchor order, so the list is reversed to match. Rotate, copy, and move keep it as is.
- A follow-the-walls rebuild of `base` drops the list and returns to the single overhang.

## Geometry

Add `offsetPolygonEdges(poly, distances)` to `geom.js`, beside `offsetPolygonOutward`, with the same rules: normalise the winding first, return null when the result folds, never return a silently wrong outline. `offsetPolygonOutward(poly, d)` becomes the case where every distance is `d`, and must give the same answers as now.

`roofEdgeFromBase(base, overhangMm, edgeOverhang)` uses it. A zero distance on an edge puts that edge on the anchor line.

## 3D

The shell works from the bounding rectangle of the roof edge, and `gableProfile` takes one overhang. With different overhangs on different edges:

- `compile.js` passes the overhang of the two edges at the ends of the span, as the larger of the overhangs on each side of the rectangle.
- The eave and wall meeting line follow the plate as before, so walls do not move.

This is a known simplification. An L-shape or a notch still draws as its bounding rectangle in 3D, as the footprint brief says.

## Editing

- Selecting an edge (the existing edge selection) shows Edge overhang in the roof inspector, in millimetres. Typing sets that one edge. Clearing it returns the edge to the roof's overhang.
- Changing the roof's Overhang box changes every edge that has no value of its own, and leaves the others.
- A value that folds the outline is refused: "That overhang is too big for this corner." The old value is kept.
- A selected roof draws its anchors thin, as now. An edge with its own overhang is drawn with a small mark so it can be found.
- Dragging an edge snaps it to the face of a nearby wall (the outside face), after the usual snaps. It is the same drag as now.

## Acceptance

1. A 10 x 8 m box of walls, 600 mm overhang. Set the south edge to 1200 mm. The edge in plan is 600 mm out on three sides and 1200 mm on one. Plan area is the area of that edge.
2. Set the same edge to 0. It sits on the anchor line.
3. Change the roof overhang to 900. The three edges that follow it move to 900. The one set to 1200 stays.
4. Add an anchor in the middle of the south edge. Both halves are 1200 mm. Delete it, and the edge is 1200 mm again.
5. An overhang that folds a notched outline on one edge is refused, and the old value is kept.
6. Mirror a roof with a per-edge value: the same wall keeps the larger overhang. Copy keeps the list.
7. A roof with one overhang for all edges, and a roof saved before this change, are built exactly as before.
8. Dragging an edge near a wall face snaps to it.
9. Tests cover `offsetPolygonEdges` (box, L-shape, zero distance, fold refused, winding), the list kept in step on add, delete, and mirror, and the old-roof case. Existing roof and massing tests still pass.

## Verify in the browser

On a closed box of walls, draw a roof Along walls with overhang 600. Select the south edge, set Edge overhang to 1200, and watch the edge move out on that side only. Open 3D and check the eave and the walls are unchanged. Change the roof overhang and check the one edge stays.
