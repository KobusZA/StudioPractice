# Brief: Trim to corner and Trim single

Revit's two Trim/Extend tools for walls and foundations, as two buttons in Modify next to Split and Join, in both densities.

- **Trim to corner**: two clicks, each on the part to keep. Both walls end where their centrelines cross. A wall that ran past is cut back. A wall that stopped short is stretched. The tool stays armed, so the next corner is two more clicks.
- **Trim single**: two clicks. The first is the wall that stays (the boundary), anywhere on it. The second is the wall to trim, on the part to keep. Only the second wall moves, to where it meets the boundary's centreline. A wall that ran past is cut back, a wall that stopped short is stretched. The tool stays armed and waits for the next boundary.

Trim multiple (one boundary, many walls) is not built.

The ends land on the centreline crossing, as Revit lands them on the location line. `joinWallCorners` already welds ends that meet, so the corner square is the one a centreline corner already gets. Past and against are not applied here.

## Do not change

- Who owns a corner drawn with the wall tool. `wall-join.js` is untouched.
- `moveWallEnd` for a dragged end. A point passed the usual way is still a point on the location line. Trim passes `space: "centre"`, which reads the point as a centreline point, so a face-drawn wall keeps its offset and its centreline meets the other wall.
- Anything that is not a wall, a boundary wall, or a foundation.

## The click

### Trim to corner

- First click: a wall, on the part to keep. Escape drops that pick and leaves the tool armed.
- Second click: the other wall, on the part to keep. Both ends move, as one undo step, and the tool waits for the next pair.
- Escape with no pick puts the tool down.
- The hover after the first click draws both centrelines out to the crossing, dashed, and the corner they would make. A pairing that would be refused says why in the hint, before the click.

The end that moves is the one on the far side of the crossing from the click. When the crossing lies beyond the wall, both ends are on the click's side and the nearer one moves. That is the extend, and it is the same function as the trim.

### Trim single

- First click: the boundary wall, anywhere on it. It is outlined and does not move. Escape drops it and leaves the tool armed.
- Second click: the wall to trim, on the part to keep. Only this wall's end moves, as one undo step. The boundary is reset and the tool waits for the next boundary.
- Escape with no boundary puts the tool down.
- The hover after the first click shows the one wall as it would end up, with the dashed stretch that is added or cut away. There is no corner angle, because only one wall moves. A refusal says why in the hint, before the click.
- The boundary's line is read as running on past its ends, so a boundary shorter than the meeting point still counts. The 80 m limit below still applies.
- The moving end is chosen the same way as in Trim to corner, from the second click only.
- Only the wall that moved is selected afterwards, and only it is named in the undo label.

## Refusals

Nothing is written, including when the first wall could have moved and the second cannot. The boundary in Trim single is never written.

| Cause | Message |
|---|---|
| Centrelines parallel | These two walls run parallel, so there is no corner to make. |
| Click within 50 mm of the crossing, along the wall (the wall to keep, in Trim single) | Click further along the wall, on the part you want to keep. |
| The kept piece would be under 300 mm | That would leave the wall too short. |
| A door or window would leave the wall | The message `moveWallEnd` already gives. |
| The second click is the first wall | Corner: Click a different wall for the second side. Single: Pick a different wall to trim. |
| Not a wall or foundation | Trim to corner works on walls and foundations. / Trim single works on walls and foundations. |
| Different floors | These walls are on different floors. |
| The crossing is more than 80 m beyond either wall | These walls meet too far away to trim. |

A neighbour that used to meet the discarded stub stays where it was.

## Acceptance

### Trim to corner

1. Two walls crossing in a plus, clicked on the north and east pieces, become an L of those two pieces. The south and west stubs are gone.
2. Clicking the other two pieces keeps those instead.
3. Two walls that stop short of each other both stretch to the crossing.
4. A splayed wall meets the corner on the centreline.
5. A wall drawn on its exterior face still has that face after the trim, and its centreline is what meets the other wall.
6. A door that would fall off the trimmed end refuses the corner. Both walls, the door, and a finish on the other wall are unchanged.
7. Escape after the first click drops the pick. Escape again leaves the tool. The next pair is one undo step.

### Trim single

1. A partition that stops short of an external wall, clicked boundary first, stretches to the external wall's centreline. The external wall is unchanged.
2. A partition that runs through the external wall is cut back to it, on the clicked side. The other click keeps the other half.
3. A boundary shorter than the meeting point still works. It is not stretched.
4. A wall drawn on a face keeps that face, and its centreline meets the boundary.
5. A door that would fall off the trimmed end refuses the trim. Both walls, the door, and a finish on the boundary are unchanged.
6. Escape after the first click drops the boundary. Escape again leaves the tool. The next trim is one undo step, and undo puts only the trimmed wall back.
