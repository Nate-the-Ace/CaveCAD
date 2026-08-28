# CaveCAD

A dedicated cave mapping application built on [QCAD](https://qcad.org)
Community sources (GPLv3), with the Cave Survey tool suite built in:
import or type survey data, watch loop closures and blunders surface as
you work, derive passage walls, place NSS-standard symbols, and finish a
sheet that would survive NSS Cartography Salon judging -- with the
conventions explained to you along the way.

The suite targets **CaveCAD only**: it relies on CaveCAD's native XDATA
persistence for survey data, which stock QCAD's free writer does not
provide. It is not distributed as an add-on for other QCAD editions.

## The tools

Each appears in the **Cave Survey** menu and as a command:

| Tool | Command | What it does |
| --- | --- | --- |
| Caves | `caves` | The window CaveCAD opens on: the caves registered on this machine, each one's trips with date, team, shot count and the stations it stopped at, plus survey health (depth, stations, loops, UIS grade) and warnings worth acting on -- a bad loop closure, a trip whose declination IGRF disagrees with, legacy tags, unbound linework. Import Cave... reads a survey file (Compass, Survex, Walls, CSV) and builds the whole project from it -- folder, scans/PDF/images, a drawing on the NSS template with the survey drawn in -- or adopts an existing DXF; Import Folder... takes a cave folder or a folder of them. From here: open the drawing, start a trip tied into an open end, package the project, or open its project folder. Switch it off in its own footer, or with the setting `Startup/ShowCaveLauncher`. |
| Package Cave Project | `pkgcave` | Assembles a cave project into one zip in `~/Documents/Cave/depot`: the drawing, the maps already in `PDF/`, the survey as Compass/Survex/CSV, and a MANIFEST anyone can read without CaveCAD. Sanitized by default -- the copied drawing loses its geographic anchor and no aerial photograph travels with it; a full archive keeps both, says so in its file name, and is meant for your own storage or for handing a project to the next cartographer. Never plots a PDF, and never touches the original drawing. |
| Survey Notebook | `snb` | A docked survey notes page: type or import shots, watch closures/stats/warnings live, draw in one undo step, export to any format. Also owns declination: estimate it from the survey date and the cave's location (IGRF), pin that location to a station as the drawing's geo anchor, and correct a trip's declination after the fact -- the drawing rotates around the fix. The walls you trace are tied to the trip they belong to automatically, so they follow it through a revision instead of being left behind -- nothing to switch on, and a revision claims work drawn before this existed. |
| New Cave Map | `ncm` | Start a sheet from the NSS template, already carrying the control layers and symbol blocks. |
| Rebuild Survey Data | `rsd` | Re-derive the survey model from what the drawing already holds, and upgrade a legacy drawing's tags to the current schema. |
| Aerial Basemap | `ab` | Place georeferenced aerial imagery under the map, anchored to the drawing's geo station. |
| Surface Contours | `sc` | Draw surface topo contours over the survey from public USGS 3DEP elevation data, labeled in the drawing's unit. |
| Import Cave Survey | `ics` | Import Compass `.dat`, Walls `.srv`, Survex `.svx` or CSV -- the format is detected for you. |
| Scatter Breakdown | `scb` | Fill closed `BREAKDOWN-BOUNDARY` polylines with breakdown symbols, per boundary. |
| Align Image | `ali` | Fit a scanned map onto known stations (move/rotate/scale, warp with 3+ points) for wall tracing. |
| Feature Trace | `ft` | Trace walls and other features freehand: hold the button and drag along the sketch, and a smooth line follows at one control point per foot of cave. Pick the feature from the docked panel and it lands on that feature's own layer -- plan features and elevation features are separate rows, and tracing one while the cursor is over the other view is refused rather than drawn in the wrong place. |
| Survey Stats | `sst` | Length, depth, loop closures, and the honest BCRA/UIS grade, computed from the drawing. |
| Generate Profile | `gp` | Rebuild the extended elevation beside the plan: one band per survey run, floor and ceiling lines from LRUD and splays. Normally happens on its own with every draw, from the notebook's own survey model; this forces it from the drawing's own tags instead and prints what it could not show. |
| Build Legend | `bl` | Generate the legend from the symbols the map actually uses (NSS names, UIS aliases). |
| Callout | `cscal` | Place a text note bound to one or more leader arrows -- QCAD has no multileader, so this is a real text entity and a real leader per arrow, linked so the note stays text-editable and the arrows can be reflowed after a move. |
| Elevation Callout | `cselev` | Two clicks to place a spot FLOOR elevation: the point to take it at, then where the label goes. Reads the floor from the LRUD and splays, not the survey line, and says LINE on its face when it had to fall back. |
| Callout Sync | `cscsync` | Put every callout arrow back on its note after the note has been moved or reworded, and re-key a copied callout that ended up sharing an id with the original. |

Start a new map from `templates/NSS_Cave_Template_PLAN.dxf` -- the tools
draw onto its layers and the title block and symbol blocks live there. One
template covers both views: the extended elevation is drawn into the plan
drawing, below the plan, on its own `PROFILE-` layers. Every `File > New` starts from the plan template
unless the `CaveSurvey/TemplateOnNew` setting is explicitly false.

The title block is **ordinary text** on the `TITLE-BLOCK` layer: double-click
a line to edit it, drag it where you want it, delete the lines this map does
not use. Survey Stats can still stamp length, depth and grade into their
lines, which it finds by a hidden field tag rather than by position.

## A note on privacy

This repository is public and that is deliberate: it is GPLv3 code, and its test
fixtures use synthetic local grids rather than real coordinates. **Cave drawings
are a different matter** — working DXFs carry exact entrance coordinates, so
wherever you keep them must be private. Cave folders live in a shared drive the
survey group controls, never in a public repository; none of that applies to this
source tree.

## Conventions

These hold across every tool, and are worth knowing before you trust a map:

* **Azimuth** is degrees clockwise from north: 0 = N, 90 = E. Stored bearings
  are TRUE; declination is applied on import (from the file's own
  declaration, including Survex `*calibrate declination`) and recorded.
* **Distance is slope distance** -- along the tape, the way Compass, Walls
  and Survex all mean it. Plan position uses `d*cos(inc)`, elevation
  `d*sin(inc)`.
* **Units follow the drawing** (Edit > Drawing Preferences > Units), not a
  constant in source. Sources declare their own units and are converted.
* **L and R** face the direction of travel; LRUD belongs to the **To**
  station. A blank/missing measurement is *not measured* (never silently 0);
  an explicit 0 means "the wall is here".
* **Declination is positive east**: true = magnetic + declination. Anywhere
  a declination appears it is shown as `x.x° E/W` too.
* **Loops are adjusted by least squares, and it is ON by default.** A drawn
  survey has its misclosure distributed across the loop rather than dumped on
  the closing shot, weighted by `CaveSurvey/SigmaTape` (0.1) and
  `CaveSurvey/SigmaAngle` (1.5). This *moves stations* -- it is a change to
  drawn geometry, not an overlay. It is fully reversible: the raw readings are
  untouched in XDATA, and redrawing with `CaveSurvey/AdjustEnabled` set false
  reproduces the as-surveyed geometry exactly. The as-surveyed shape is also
  drawn as a ghost on layer `CTRL-RAW` so you can see what the solver did.
* **Everything the tools draw letters in UPPERCASE.** Station labels, splay
  names, notes, the legend, title block values, and the templates' own lines --
  the drafting convention a hand-lettered cave map has always followed.
  Capitalisation happens where the entity is made (`CsDraw.caps`), never to the
  data behind it: the note you typed keeps its case in the notebook and in
  XDATA.
* **Passage walls come with the survey, not from a separate step.** Wall runs
  are derived from LRUD **and from every splay** -- a splay tip is a measured
  wall hit, so it joins the wall on the side it was shot, ordered along the
  passage -- and drawn inside the same undo step as the centreline, dashed, as
  something to trace real walls over rather than as the walls themselves. A
  station with splays but no LRUD still carries walls. Splays are used
  unfiltered, so a ceiling shot pulls its wall in toward the station: that is
  the data talking, and tracing is where you overrule it. Redrawing replaces
  them.
* **Grades quote the as-surveyed closure, never the adjusted one.** Adjustment
  makes a loop close by construction, so quoting the post-adjustment figure
  would make every survey report as BCRA grade 5. Survey Stats reports the
  worst loop as it was measured.

## Repository layout

| Folder | What it is |
| --- | --- |
| `scripts/CaveSurvey/` | The add-on. `Core/` inside it is the pure library (survey model, parsers, math) every tool shares. |
| `templates/` | NSS-style plan and profile templates. |
| `testdata/` | Example surveys in the native formats. |
| `tests/` | See below. |
| `tools/` | Builds and publishes the release package. |
| `docs/` | Design docs and specs. |

## Installing

Hand users the built package (see below): it installs itself with
`./install.sh`. From a checkout:

```bash
cp -R scripts/CaveSurvey "$HOME/Library/Application Support/QCAD/QCAD/scripts/"
```

| Platform | QCAD's per-user scripts folder |
| --- | --- |
| macOS | `~/Library/Application Support/QCAD/QCAD/scripts` |
| Windows | `%APPDATA%\QCAD\QCAD\scripts` |
| Linux | `~/.local/share/QCAD/QCAD/scripts` |

Restart QCAD; add-ons load only at startup.

## Tests

```bash
./tests/run_all.sh             # structural + syntax + Core unit tests
./tests/run_all.sh --publish   # plus the ship gate (icons, status tips)
```

Three layers, no Python dependencies at all:

1. **Structural** (`tests/test_addon.py`, stdlib only): add-on layout, menu
   wiring, unique sort orders, icons parse as SVG, every `include()` target
   exists, and the layer registry agrees with the templates.
2. **Syntax** (`tests/js_syntax.js`): every script parsed inside QCAD's own
   engine.
3. **Unit** (`tests/js_unit.js`): 2300+ assertions over the Core library --
   parsers, round-trips, traverse math, network resolution, loop closure,
   blunder detection, grades, and the IGRF declination model (validated
   against ppigrf-generated fixtures) -- run inside QCAD's engine, or under
   `node` while developing.

## Building CaveCAD itself

The custom application -- QCAD Community rebranded, with native XDATA
persistence for survey data (upstream's free writer drops custom
properties; see `cavecad/patches/`) -- builds from pinned upstream
sources plus the patches in `cavecad/`:

```bash
./cavecad/build.sh
```

Produces `~/Applications/CaveCAD.app`. Requires Homebrew `qt`, `cmake`,
`ninja`. The suite installs into it with `./tools/publish.sh`. CaveCAD
is GPLv3, as QCAD is; `cavecad/patches/` is the corresponding source
for every modification.

## Building and publishing

```bash
./tools/make_package.sh     # dist/CaveSurveyTools-<version>.zip, fully gated
./tools/publish.sh          # build + install into QCAD + archive to ~/Documents/Cave

# a shelf full of invented caves, for screenshots and for trying the
# tools without typing survey data in by hand:
CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
    -autostart tools/make_demo_caves.js "$PWD"   # -> ~/Documents/Cave/demo
```

The version comes from `VERSION`. Nothing is released yet, so it is pre-1.0: `0.MAJOR.MINOR.PATCH`, where the trailing three keep continuity with the builds already published locally (`0.2.7.1` is the 2.7.1 build, honestly numbered). Tags match. A build that fails any check produces no
zip.
