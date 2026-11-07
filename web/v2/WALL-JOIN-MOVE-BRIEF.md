# Brief: walls hold their joins when moved

A wall that meets another wall keeps meeting it when it is moved. The joined end slides along the other wall, or the wall stretches, so the junction survives. Breaking a junction is something the user asks for, or something the geometry makes impossible. It is not something that happens by drifting a short way.

Applies to both moves: the press-and-drag in Select, and the Move command. They run the same rule off the same captured joins.

## The rule

A joined end is put back on the host wall's centreline after the move, keeping the offset it was drawn with.

Move the wall perpendicular to itself and the end slides along the host; the length does not change. Move it along its own axis and the end stays on the host, so the wall stretches or shortens. A wall joined at both ends does not move along its own axis at all.

## Do not change

- `wall-join.js`. Who owns the corner square when a wall is drawn is untouched.
- `moveWallEnd`. Dragging one end stays a single-end edit.
- `shiftJoinedEnds`. It still moves the stationary neighbour. The new code moves the ends of the wall under the pointer. The neighbour is adjusted after the hold, against the wall's final line.
- Anything that is not a wall. Rooms, slabs, roofs, items, routes and the sheet move as they do now.

## Capturing the joins

Taken once, at the start of the gesture, while the walls are still where they were. `captureWallJoins` in `modify.js`.

For each moving wall, each end, against every wall on the same level that is not itself moving:

- `findJoinTarget` for a contact inside the host, including a tee into the middle of a wall.
- `wallCornerNeighbors` for a corner whose ends sit about a thickness apart.

One host per end, the one the end actually sits on. A wall that continues the same straight line is not captured: a translation never changes the angle, so there is nothing to slide along.

Each record is `{ wallId, end, hostId, slack, atHostEnd }`. `slack` is the signed distance, along the moving wall, from the centreline crossing to the end. `atHostEnd` is true when the host's own end is the join, so that host may stretch.

## Applying the hold

`holdWallJoins` runs after the translation and before `shiftJoinedEnds`, in the drag and in the Move preview.

A join to the middle of a host breaks when the end would pass either end of that host. The host is not stretched to follow. A join at the host's own end does not break for that; the host stretches through `shiftJoinedEnds`, which is how a corner survives a long move.

The hold is also refused, and that end left where the translation put it, when the wall would be under 300 mm, or a door or window would leave it. The other end is unaffected.

An opening or a finish on a wall whose length changed keeps its place on the plan.

`dropBrokenJoins` removes a refused join for the rest of the gesture. Dragging back onto the host does not rejoin it.

## Asking to break

Hold Alt during the drag, or tick Disjoin on the Move command once the base point is placed. The walls then translate the way they did before this change, and no join marks are drawn. A join is not marked broken by that; releasing Alt, or clearing Disjoin, holds again whatever is still possible.

## Feedback

Each held end draws a small mark while the gesture is live. When a join breaks, the mark goes and the status line says why:

| Cause | Message |
|---|---|
| The host is parallel to the wall | The join is gone — these walls now run parallel. |
| A tee slides past the end of its host | The join is gone — the wall no longer reaches. |
| The wall would be under 300 mm | The join is gone — holding it would leave the wall too short. |
| A door or window would leave the wall | The join is gone — holding it would push the door off the wall. |

The last one names a window or an opening when that is what would leave.

## Acceptance

1. A horizontal wall teed into the middle of a long vertical wall, moved up, keeps its end on the vertical wall and keeps its length. The vertical wall does not move.
2. The same wall moved along itself stretches, and the end stays on the vertical wall.
3. A wall joined at both ends, moved along itself, does not move.
4. The same wall moved sideways slides, and both ends stay on their hosts.
5. A wall that stops on a face, a thickness short of the other centreline, keeps that offset.
6. Moving two joined walls together does not hold them to each other.
7. A collinear run is not a held join. A host on another level is not one either.
8. Moving a tee past the end of its host breaks the join, says so, and leaves the host where it was. The break lasts for the rest of the gesture.
9. A corner moved a long way still meets. The other wall stretches to the new point.
10. A door on a wall that stretches stays at its point on the plan. A hold that would push the door off the wall breaks instead, and the door is unchanged.
11. A hold that would leave the wall under 300 mm breaks, and the wall stays where the move put it.
