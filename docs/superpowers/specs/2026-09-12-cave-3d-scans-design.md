# Sketch scans in the 3D view -- design

Date: 2026-09-12
Status: approved
Version target: cavecad-tools 0.9.123.0 (plan) and 0.9.124.0 (profile),
cavecad-src 0.6.0.0

## What this is

The caver's own scanned sketches, hanging in the 3D view on the passage
they were drawn of. Plan scans first, profile scans straight after.

Sections are already done and took a different road: a captured section
holds traced GEOMETRY, so it needed no textures. Scans are pictures, so
this is where the texture pipeline finally gets built.

## The trimmed images are free

`CsScanTrim` works by pointing the image entity at a smaller derivative
file under `scans/Trimmed/` -- DXF has no image clipping in this engine,
so "place only this part" can only mean a separate file. Whatever the
drawing references IS the trimmed image. Nothing to choose, nothing to
resolve.

## Both drapes are one idea

Each is "sample the survey for the coordinate the sketch does not
carry":

    PLAN     the sketch carries x and y, and needs z
    PROFILE  the sketch carries distance-along-run and elevation,
             and needs x and y

Plan becomes a subdivided grid in XY with z sampled per vertex; profile
becomes vertical strips, one per leg, each standing on its own leg.

## Plan: sampling elevation

Inverse-distance weighting from nearby stations, the same `1/distSq`
weighting `CsWarp` already uses for linework and guarded the same way
against a query point sitting exactly on a station.

THIS INVENTS ELEVATION BETWEEN STATIONS, and that has to be said plainly
because `CsLrud` refuses to invent wall detail between measured points
and this is the same class of act. What makes it defensible is that the
3D panel DRAWS NO ENTITY AND WRITES NO TAG -- it has always been a view.
Inventing a surface to look at is not inventing survey data. Nothing
here may ever be written back into a drawing.

Beyond `CsDrape.REACH` from any station the drape goes FLAT rather than
extrapolating: past the last station there is no trend to follow, and a
plane is an honest answer where a guessed slope is not.

## Profile: the exaggeration trap

THE HEADLINE RISK OF THIS WHOLE FEATURE.

A profile band is drawn with a VERTICAL EXAGGERATION. The caver then
scales their scan onto that drawn band, so the scan's vertical is
exaggerated too. Draping it into 3D without dividing that out stretches
every sketch vertically -- and it still looks plausible, which is why it
would ship.

The exaggeration is recorded in the drawing ONLY AS PROSE: a stamp
tagged `ProfileExaggerationStamp` reading "Vertical exaggeration 2x --
not to sheet scale". Parsing a human sentence to recover a number the
geometry depends on is not acceptable.

So it is DERIVED FROM THE DRAWN GEOMETRY instead. The band's own drawn
stations are in the drawing and `CsProfile.unrollBand` recomputes the
same band at exaggeration 1; the ratio of drawn vertical span to
computed vertical span IS the exaggeration, per band, measured rather
than trusted. Two stations at different elevations are enough; a band
whose stations are all at one elevation has no ratio to measure and is
skipped with that reason given.

A machine-readable tag is ALSO added to `CsProfileDraw.stamp` going
forward, so new drawings carry the number outright. The derivation stays
as the path for every drawing already made -- including all of Nathan's.

## Profile: the mapping

`CsProfile.unrollBand` returns `stations: [{name, x, y, z}]` in
band-local coordinates and `legs: [{from, to, fromX, fromY, toX, toY}]`.
That is the forward map; the drape needs it backwards:

  1. `CsProfileBox.boxes(doc)` gives `{key, minX, minY, maxX, maxY}` per
     band; `CsProfileBox.at(boxes, point)` says which band a scan sits
     in, and the key is the run.
  2. Re-derive that run's band with `unrollBand`.
  3. For a scan pixel at band-local x, find the leg whose `fromX..toX`
     spans it and interpolate to get `t` along that leg.
  4. The real position is `lerp(resolved.stations[from],
     resolved.stations[to], t)` -- x and y recovered.
  5. z is the scan's own band-local y, un-exaggerated and re-datumed.

STRIPS, ONE PER LEG, because step 3 is only linear within a leg. A
single quad across a bend would cut the corner.

## Keying out the paper

A scan is mostly white paper; drawn opaque it is a wall. The fragment
shader discards a fragment whose luminance exceeds `CsDrape.INK_MAX`, so
only the pencil floats over the passage.

Faint pencil on grey paper may drop out with the background. The
threshold is therefore a named constant and not a magic number, and if
real scans need it adjustable it becomes a control rather than a
recompile.

## The texture pipeline

New in C++, and the first textures in this renderer:

  upload      QImage -> QOpenGLTexture, downscaled to MAX_TEXTURE_PX on
              the long edge. Trimmed scans are smaller but still
              megapixel JPEGs, and a cave with thirty of them would
              otherwise eat VRAM for pictures nobody is looking at
              closely.
  shader      a second program: textured, with the luminance discard
  blending    on, depth-WRITE off for the scan pass, drawn after the
              geometry, so overlapping sketches do not z-fight
  lifetime    textures owned per scan and dropped on clear(), and
              rebuilt when the GL context is remade -- which a dock does
              every time it floats

## Architecture

    Core/CsDrape.js        PURE: elevation sampling, grid generation,
                           band-local inverse mapping, exaggeration
                           derivation. Plus a QCAD half that reads image
                           entities off CTRL-SCAN and CTRL-PROFILE-SCAN.

    RCave3dTexture         C++: one scan's image as a GL texture
    RCave3dView            a textured-quad pass and its visibility flags
    RCave3dBridge          carries scan meshes and their image paths
    RCave3dPanel           "Plan scans" and "Profile scans" toggles

The C++ side still knows nothing about caves: it is handed triangles,
texture coordinates and a file path.

## Order of work

PLAN FIRST, because it proves the texture pipeline -- upload, keying,
blending, downscaling, context loss -- against the geometry with no
ambiguity in it. PROFILE SECOND and soon, because it is the one Nathan
actually wants and because its risk is all in the mapping rather than in
the rendering, which by then will be known good.

They ship as two versions so the first is usable before the second is
finished.

## Testing

Pure, headless:

  - elevation sampling returns a station's own z at that station
  - it interpolates between two stations, and goes FLAT beyond REACH
  - a grid over a scan quad has the right vertex and index counts, and
    no NaN
  - exaggeration derived from a band of known ratio comes back as that
    ratio
  - a band with no vertical spread reports "cannot derive" rather than 1
  - band-local x maps onto the right leg, including at a leg boundary
  - a point past the end of a band clamps rather than extrapolating

Live:

  - a plan scan lies over the passage it was drawn of
  - paper keys out; pencil survives
  - a profile scan follows the passage round a bend
  - a profile drape is NOT vertically stretched -- checked against a
    known passage height, since this is the failure that looks fine
  - floating and re-docking the panel does not lose the textures

## Out of scope

Section scans as textures -- sections already draw from traced geometry
and the picture adds only the original pencil. Editing or re-fitting a
scan from the 3D view. Any write back into the drawing.
