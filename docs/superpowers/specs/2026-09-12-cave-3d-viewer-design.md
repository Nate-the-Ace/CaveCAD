# Cave 3D View -- design

Date: 2026-09-12
Status: approved
Version target: cavecad-tools 0.9.117.0, cavecad-src bump

## What this is

A native OpenGL window inside CaveCAD that draws the surveyed passage in
three dimensions: centerline, and a passage shell built from LRUD and
splay measurements. Pan, zoom, rotate. It rebuilds as the drawing
changes.

This is PROJECT 1 OF 4. The other three, in forced order, are:

  2. capture import + display  -- read Polycam glTF/GLB, decimate, render
  3. registration              -- assign stations in 3D, solve yaw +
                                  translation (+ optional scale), optional
                                  ICP refine against splay tips
  4. slice -> linework         -- cut the capture and bring wall traces
                                  back into the drawing

2, 3 and 4 all require 1, and 1 has standalone value, so the order is not
a preference.

## Why a native window and not a browser

The obvious cheap answer is to write a self-contained three.js page and
open it in a browser. Rejected: the viewer is wanted INSIDE the
application, sharing the drawing's lifetime and eventually its selection.

The feared cost of "inside the application" -- regenerating the
ECMAScript bindings, which needs srcml and touches four sibling repos --
turns out not to apply. `RScriptHandlerJs.cpp:471` already exposes
globals with `engine->newQObject(...)`. A QObject with Q_INVOKABLE
methods is reachable from JS in about three lines, with no generator run
at all. CaveCAD also already links QtOpenGL 6.11, so QOpenGLWidget adds
no dependency.

## Naming

"Scan" in this suite already means a scanned notebook page -- SketchScans,
eleven CsScan* Core files, the shared browser widget, the scans/ folder.
LiDAR data is called a CAPTURE throughout, and lives in lidar/. Using
"scan" for both would make every future sentence ambiguous.

## Folder structure

`CsCave.LIDAR = "lidar"` joins `CsCave.SUBFOLDERS`, created beside scans/,
PDF/, images/ and backup/, under the same shared-drive-only rule that
keeps the suite from littering unrelated directories.

`PackageCave` gains a `folderGroup("lidar", ...)` matching the existing
scan and image groups at PackageCave.js:214-223: left out of a sanitized
package unless somebody asks for it by name. A capture is location data
-- it is a metric record of a specific place, and the file may carry
GPS and capture metadata besides.

Project 1 writes nothing into lidar/. The convention is established now
so project 2 does not have to invent it under pressure.

## Architecture

The dividing line: the C++ widget is a renderer that has never heard of
caves. Every cave fact stays in the JS Core library, where it already
lives and is already tested.

The alternative -- C++ reading the drawing's XDATA directly -- would mean
a second implementation of tag parsing, in a second language, kept in
step by hand. Rejected on those grounds alone.

### C++ (cavecad-src)

    src/gui/RCave3dView     QOpenGLWidget
    src/gui/RCave3dWindow   QMainWindow, one per drawing

Public surface:

    setTriangles(verts, normals, colors, indices)
    setLines(verts, colors, indices)
    setBounds(min, max)
    clear()

No station names, no trips, no LRUD, no tags. Two buffers and a camera.

Camera is an orbit/trackball, Z-up:

    left-drag        rotate
    middle-drag      pan
    shift+left-drag  pan
    wheel            zoom
    Home             reframe to bounds
    presets          plan (looking down) and profile (looking north)

The two presets exist because those are the views a cartographer checks
the map against; reaching them by hand-orbiting is imprecise.

Exposed to JS as one global QObject via newQObject.

### JS (cavecad-tools)

    Cave3D/Cave3D.js        the add-on tool, "Cave Survey > 3D View",
                            following the fixed add-on wiring shape
    Core/CsMesh3d.js        pure geometry, no document, no GUI

Pipeline, entirely from parts that already exist:

    CsRebuild.rebuild(doc, di)   -> Survey, from the drawing's XDATA
    CsNetwork.resolve(survey)    -> stations {x, y, z}
    CsMesh3d.build(survey, st)   -> {triangles, lines, bounds}

`CsMesh3d.build` takes a Survey and a stations map and returns plain
arrays. That is the whole contract. It never sees a document, so all of
the geometry is testable under node.

## Wall geometry -- approach A, radial cross-section lofted

Per station:

  1. Build a local frame perpendicular to the passage direction
     (the mean of the incoming and outgoing shot vectors; at a run end,
     the single shot).
  2. Project into that plane: the four LRUD tick endpoints, and the
     endpoint of every splay shot from this station.
  3. Sort the projected points radially about the station.
  4. That ordered ring is the station's cross-section.

Then loft a triangle strip between consecutive stations' rings.

Stations with no splays fall back to the four-point LRUD ring, so
coverage is uniform and does not go ragged where splay density varies.

Junctions -- three or more non-splay shots meeting -- END a loft run
rather than guessing a surface across the junction. This is the rule
CsLrud already applies in plan, reused rather than re-derived.

A splay is a first-class wall point here, exactly as CsLrud's header
argues it should be: "a splay tip is a measured wall hit -- the same kind
of fact an LRUD number is, just aimed where the caver pointed".

An LRUD of 0 means the wall passes THROUGH the station -- a real
measurement -- and contributes a vertex at the station, not nothing.
`CsLrud.tickEnd` already encodes this; the mesh must not re-break it.

### Approaches rejected

GLOBAL POINT CLOUD RECONSTRUCTION (alpha shapes, ball pivoting) over all
measured wall points. Handles chambers and junctions with no special
cases, which is approach A's weakest area. Rejected: heavy numerical work
in ECMAScript, slow on a real cave, blobby where data is sparse, and --
decisively -- it invents surface between points nobody measured, which is
the misrepresentation CsLrud explicitly refuses.

LRUD TUBE NUDGED BY SPLAYS. Cheapest, topology always valid. Rejected: a
splay into a side lead or up into a dome only dents the tube, so the
render shows LESS than was measured.

## Colour

By trip, by default; depth as an alternative. Centerline and splay rays
are separate toggles into the line buffer.

## Live rebuild

Two tracks, following the doctrine CsBind.js already states -- that the
transaction-listener signal "rests on a signal this bridge may not
deliver":

    the guarantee    a Refresh button, rebuilds from the current
                     drawing, always works
    the same answer  a transaction listener, debounced, rebuilding
    arrived earlier  automatically -- matching ShapedLinesListener,
                     AreaFillListener and CalloutListener

NOTHING DEPENDS ON THE LISTENER. If the signal never fires, the window is
still correct the moment Refresh is pressed. This is the shape the suite
has already paid for twice; a listener-only design would be a third
payment.

## Elevation datum

`CsNetwork.resolve` returns true z. `CsMesh3d` never defaults a missing z
to 0 -- that is an error which refuses to build, not a silent rebase.

The datum trap has five prior doors in this suite. The headless tests
include an absolute-datum cave whose stations sit near 1,200 ft and
assert the returned bounds come back near 1,200, not near zero.

## Large-mesh transfer -- open, decided by measurement

Pushing mesh data across the QJSEngine boundary as plain JS arrays is
fine for Pitfall Cave. A thousand-station cave at roughly sixteen
vertices per station is 100k+ floats, where plain arrays may not be.

The first task in the implementation plan is a spike that MEASURES this.
If plain arrays lose, the fallback is: JS writes a binary blob to the
scratch directory, C++ reads it. The choice is made from the measurement,
not guessed in advance.

## Testing

Headless, under the existing node harness, against the Pitfall Cave
fixture in testdata/:

  - vertex and index counts are consistent; indices in range
  - no NaN in any emitted coordinate
  - bounds match the survey's own extents
  - a junction terminates its loft run
  - an LRUD of 0 emits a vertex AT the station
  - a station with splays produces a ring larger than its LRUD ring
  - absolute-datum cave: bounds near 1,200 ft, not near 0

The harness loads Core by a hand-written list and a missing file passes
silently through deliberate catches. CsMesh3d.js MUST be added to that
list, or the whole suite passes by vanishing.

Live, in a genuinely restarted CaveCAD:

  - open Pitfall Cave, Cave Survey > 3D View
  - passage renders, coloured by trip
  - rotate, pan, zoom, Home, both presets
  - edit a shot; the window follows
  - Refresh works with the listener disabled

"Genuinely restarted" is literal: a quit blocked by unsaved changes
leaves the old add-on running, so a live check can otherwise be made
against stale code.

## Out of scope for version 1

glTF, captures, registration, slicing, station picking, selection sync,
lighting beyond flat shading, textures. lidar/ is created and left empty.
