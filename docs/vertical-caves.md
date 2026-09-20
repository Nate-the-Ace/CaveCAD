# Vertical caves — what was wrong, what is fixed, what is left

Started 2026-09-20, after an audit asking a question the suite had never
been asked: *does any of this work in a cave that is mostly air?*

The short answer was no, and the reason was not a missing feature. It
was that **every geometry rule in the Core that asks "which way does the
passage run here" answers from a bearing, and on a pitch there is no
bearing.** The needle is noise, the caver is hanging on a rope, and the
compass column of the notes holds a dash or a formality.

None of it threw. `cos(90 degrees)` is 6.1e-17 rather than 0, `atan2` of
two rounding errors is a confident bearing of due north, and a plan
projection of zero divides fine and prints fine. It flowed downstream,
got drawn, and looked like a map. Seven thousand assertions over a
horizontal fixture never asked.

Pit caves are not a niche. Most long horizontal caves have vertical in
them, and every one of the bugs below fires the first time a drawing
contains a rope.

## The fixture

`testdata/PlumblinePit.*` — 380 ft deep in 148 ft of plan extent, four
pitches, an aven, a shaft that is nearly a duplicate of its neighbour,
and a control tie whose misclosure is almost entirely vertical. 22
numbered pitfalls, inventoried in `PlumblinePit_MANIFEST.md`.

It does not replace Pitfall Cave. Pitfall is 2400 ft of horizontal
passage carrying the parser, validator and network traps; this is the
one that carries the traps only a pitch can spring. The two fail for
different reasons and are audited separately, so a run says which kind
of cave broke.

Three test stages, all pure ECMAScript, all in `tests/run_all.sh`:

| Stage | File | Asks |
|---|---|---|
| 22 | `tests/plumbline_audit.js` | does each of the 22 documented pitfalls still behave? |
| 23 | `tests/plumbline_pipeline.js` | does every pass in the Core return finite geometry over this cave? |
| (in 3) | `tests/js_unit.js`, `plumbline-draw` | does the whole fixture DRAW into a real document? |

Regenerate the fixture with `node tools/make_pit_cave.js`. It verifies
its own output and rewrites the manifest's measured numbers, so the
manifest cannot drift from the files it describes.

## Fixed

**A pitch has no plan bearing, and nothing may invent one.**

- `CsLrud.planBearing` refused only an *exact* coincidence, which a
  plumb leg never is. Every pitch grew a way out at both ends: a pit
  foot with one passage read as a THROUGH station and took its passage
  axis from the bisector of the real passage and a rounding error; a
  shaft with two leads read as a JUNCTION and broke its wall runs
  there. Now anything under `CsLrud.COINCIDENT_PLAN` has no bearing.
- `CsModel.lrudForStation` passed the arriving shot's compass column on
  as the bearing the L and R tapes were pulled across. It hands on
  `null` now, and `CsLrud.tickAzimuth` / `tickAzimuthAt` is the one rule
  for which bearing a tick is drawn along: the sighted one, else the
  passage's own direction, else — for a blind shaft, where the only leg
  touching the station is plumb — the direction of the passage at the
  other end of the rope. Failing all three, no tick, never a north one.
- `CsSectionCut` oriented a section due north when the arriving leg gave
  it nothing, and a reader could not tell that from a section that
  really faces north.
- A bearing OMITTED in the file is now carried as `Shot.azimuthOmitted`
  and written back out as a dash. The same omission on a leg that is not
  plumb is still refused — Survex refuses it too, and at 85 degrees a
  100 ft tape still swings 8.7 ft across the map — but the refusal is
  reported instead of a bare `continue` that took the rest of the cave
  with it. The CSV reader had the same hole and a worse one:
  `parseFloat(cell) || 0` could not tell a blank azimuth from a real
  bearing of north, on any leg.
- `CsTraverse.PLUMB_DEG` is the one definition of "this is a pitch".
  `CsValidate` and `CsProfile` had each arrived at 85 and documented
  that they agreed; the near-plumb warning's comparison moved to `>=` so
  the boundary angle falls on the same side of the line in the warning a
  caver reads and in the geometry that acts on it.
- `CsTraverse.offset` in HORIZONTAL tape mode returned `Infinity` on a
  plumb. A held-level tape cannot measure one; it refuses.

**A drawing reconstructed from its own tags came back flat.**

`CsTags.surveyFromDocument` read each leg's distance as the *plan*
distance between two station points and its inclination from an
`Inclination` tag that nothing in this suite has ever written. Every
reconstructed leg came back level, with the tape reading its own
horizontal projection — a fraction of a percent in a horizontal cave,
the whole cave in a vertical one. The elevations were on the drawing the
entire time: dz is a subtraction, the tape is the hypotenuse.
`CsRebuild.toSlopeDistances` skips what the reader already resolved
rather than dividing by cos twice, and its report says which of the two
inferences it used.

**Two more, found on the way and not vertical-specific:**

- `CsModel.ensureTrips` mirrored trip 0's fields down over the survey's,
  erasing a `startLrud` set after the trips existed — silently, on the
  next `ensureTrips`, which is the first thing every writer calls. No
  shot arrives at the first station, so that is the only place its walls
  live: a sinkhole rim or a pitch head exported with no width at all.
- `CsAdjust` modelled a plumbed pitch as horizontally uncertain by
  `distance * sigmaAngle`, exactly like a level passage, so a 187 ft
  free-fall was by a distance the softest leg in any loop it belonged to
  and the adjustment poured the misclosure into it — a rope leaning
  across the map, which on a pit map is the one line a reader knows the
  true attitude of without being told. A plumbed leg's direction came
  off gravity, not a compass: `CsAdjust.PLUMB_SIGMA_ANGLE_DEG`. Still
  one scalar sigma per leg; the scalar now depends on which instrument
  produced the leg's direction, and the data says which.

## Not fixed — the drawing side

These are the findings from the same audit that are about what a pit map
LOOKS like rather than whether the geometry is honest. None of them is
started.

1. **The extended elevation collapses on a pitch, correctly, and
   nothing downstream knows.** Its X axis advances by plan distance, so
   a plumb advances it by nothing and consecutive stations land on one
   vertical line. That is right for the rope — a rope IS a vertical line
   — and wrong for everything that has to lay the band out: labels stack
   on each other, and a band whose whole run is pitch has no width for a
   frame (`CsProfileBox`) or a drape to use. Pitfall V18 pins the
   behaviour; what to DO about it is a decision, not a bug fix.

2. **There is no projected profile.** `CsProfile`'s own header says so:
   an extended elevation unrolls the passage, a projected profile
   flattens real coordinates onto one chosen vertical plane. For a pit
   cave the projected one is the PRIMARY view, not a secondary. This is
   the largest missing piece.

3. **The plan view has no way to show two levels.** A4 sits directly
   above A5 in the fixture, 125 ft apart. Nothing cues depth: no
   depth-graded rendering, no per-level plan insets, no "this passage is
   under that one" convention.

4. **No rigging symbology.** `CsLayers` reserves a cyan rigging layer
   (`CsLayers.js`, "rigging and gear -- anchors, climbs, equipment
   notes") and nothing draws on it. `CsSymbols.CATALOG` has `Pit`,
   `Dome` and `Climb` and stops: no bolt, no Y-hang, no rebelay, no
   deviation, no natural anchor, no rope, no cable ladder, no traverse
   line.

5. **No pitch-depth annotation.** A pit map's single most important
   label — "P 187" beside the drop — cannot be generated. The callout
   suite already derives floor elevations and already knows how to say
   "(pit)" when a station's D has more than one reading, so this is a
   sibling of work that exists rather than a new mechanism.

6. **`CsAdjust` is still isotropic.** Weighting a declared plumb by
   gravity rather than by a compass is a real improvement and is not the
   whole answer: a leg's vertical and horizontal variances genuinely
   differ, and the header rules anisotropic covariance out by decision.
   Worth revisiting now that there is a fixture that can measure it.
