# Annotative text (AutoCAD-style annotation scales)

Status: stage 1 (text) in progress, branch `viewport`. Blocks come after text.

## What Nathan asked for
Emulate AutoCAD's annotative objects. An annotative object keeps a LIST OF SCALES;
each scale is a "representation" with its own position (and angle). Text has a PAPER
height, so it prints the same size whatever the viewport scale. The current annotation
scale is shown normally and the object's other scales are SHADED BACK. Different
label positions at different scales. The list starts with the default 1" = 1' and the
person adds the ones they need. Text first, then blocks.

## AutoCAD behaviour we copy (and where we deliberately do not)
| AutoCAD | Here |
|---|---|
| Object is annotative; has N scale representations | text carries custom properties `CaveCAD/Anno`, `AnnoH`, `AnnoScales` |
| Text height is PAPER height | `AnnoH` inches; model height = `AnnoH x feet-per-inch x units-per-foot` |
| CANNOSCALE: the current annotation scale (model space) | document variable `CaveCAD/AnnoScale` (feet per inch), default 1 |
| A viewport's annotation scale = its viewport scale | derived from the viewport's scale at render time; no second setting to drift |
| Object shows only where its scale list contains the scale | same: hidden in a viewport / model view whose scale is not in its list |
| Annotation visibility ON: other scales ghosted | document variable `CaveCAD/AnnoVisible`; model view only |
| Moving at scale S moves only S's representation | the stored geometry IS the current-scale representation; a move writes back to that scale's entry |
| Add / delete current scale | commands |
| ANNOAUTOSCALE (auto-add on scale change) | NOT copied: adding a scale is always deliberate |

## Data model (per text entity, group "CaveCAD")
- `Anno` = "1"
- `AnnoH` = paper height, inches (all representations share it)
- `AnnoScales` = `fpi:x,y,angle;fpi:x,y,angle;...` (`fpi` = feet of cave per inch of paper)
- Stored entity geometry (position, angle, height) = the representation at the
  CURRENT annotation scale, so picking, snapping and bounding boxes work in model space.

## Rendering (the C++ part)
`RExporter::exportEntity`, for visual exporters only (never the DXF writer): a text
entity with `Anno=1` is replaced by its representation for the exporter's annotation
scale -- the viewport's scale inside a viewport (`RViewportEntity` sets it around the
model loop), else the document's current scale. No representation at that scale: not
exported. Model view with annotation visibility on: every OTHER representation is also
exported, grey and translucent, at its own scale's size. Position, angle and height
come from the properties alone; the stored geometry is not trusted for drawing, so a
file opened at another scale still draws right.

## Keeping stored geometry honest (JS, `Annotative`)
- Changing the current scale rewrites every annotative text's stored geometry to that
  scale's representation (non-undoable: it is a view change, like a zoom).
- A move/rotate/height edit of an annotative text writes back into the current scale's
  entry (transaction listener, busy flag against its own writes).
- Add Scale copies the nearest existing representation's position; Delete Scale refuses
  to remove the last one.

## Not in stage 1
Blocks, MText, dimensions, leaders; text styles that are annotative by default; grips
for other scales' positions (the ghost is not selectable yet); Property Editor row.

## Risks
- Per-entity cost: only `RS::EntityText` pays, and only a property lookup unless annotative.
- Selection of a text hidden at the current scale (stored geometry exists): accepted.
- Both ninja trees must be rebuilt (RExporter is a shared header).
