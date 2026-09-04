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
| Caves | `caves` | The window CaveCAD opens on: the caves registered on this machine, each one's trips with date, team, shot count and the stations it stopped at, plus survey health (depth, stations, loops, UIS grade) and warnings worth acting on -- a bad loop closure, a trip whose declination IGRF disagrees with, legacy tags, unbound linework. Import Cave... reads a survey file (Compass, Survex, Walls, CSV) and builds the whole project from it -- folder, scans/PDF/images/backup, a drawing on the NSS template with the survey drawn in -- or adopts an existing DXF; Import Folder... takes a cave folder or a folder of them. From here: open the drawing, start a trip tied into an open end, package the project, or open its project folder. Switch it off in its own footer, or with the setting `Startup/ShowCaveLauncher`. |
| Package Cave Project | `pc` | Assembles a cave project into one zip in `~/Documents/Cave/depot`: the drawing, the maps already in `PDF/`, the survey in every interchange format (Compass, Walls, Survex, Therion, CSV), and a MANIFEST anyone can read without CaveCAD. Sanitized by default -- the copied drawing loses its geographic anchor and no aerial photograph travels with it; a full archive keeps both, says so in its file name, and is meant for your own storage or for handing a project to the next cartographer. Never plots a PDF, and never touches the original drawing. |
| Survey Notebook | `snb` | A docked survey notes page: type or import shots, watch closures/stats/warnings live, draw in one undo step, export to any format. Draw redraws only the trip you typed when nothing else moved -- adding a trip no longer redraws the whole cave, which is most of what made it slow; a corrected declination, a re-closed loop or anything else that shifts existing stations still takes the full redraw, and **Redraw All** in the ... menu forces it on demand. Also owns declination: estimate it from the survey date and the cave's location (IGRF), pin that location to a station as the drawing's geo anchor, and correct a trip's declination after the fact -- the drawing rotates around the fix. The walls you trace are tied to the trip they belong to automatically, so they follow it through a revision instead of being left behind -- nothing to switch on, and a revision claims work drawn before this existed. |
| Edit Trip | `et` | Correct a trip's name, date, team or instruments after it has been drawn. The Notebook types these once and matches a reloaded page to a trip by date and team, so editing either field there forked the trip into a duplicate instead of correcting it; this edits the trip you picked, by identity, and moves nothing -- one undo step, no redraw, no resolve. Declination stays in Survey Notebook > Declination, where changing it rotates the plan. |
| New Cave Map | `ncm` | Start a sheet from the NSS template, already carrying the control layers and symbol blocks. |
| Restyle Layers | `rsl` | Bring an existing drawing onto the current layer palette: adds the registry layers it is missing, then rewrites colour, linetype and lineweight on the ones it has. A drawing keeps the layer appearance it was born with -- layer styling is resolved at creation and never revisited -- so a cave started before a palette change, or from an older template, stays on the old look until this is run. Layer records only: no entity is moved, recoloured or re-layered, and a layer the suite does not own is left alone. |
| Rebuild Survey Data | `rsd` | Re-derive the survey model from what the drawing already holds, and upgrade a legacy drawing's tags to the current schema. |
| Aerial Basemap | `ab` | Place georeferenced aerial imagery under the map, anchored to the drawing's geo station. |
| Surface Contours | `sc` | Draw surface topo contours over the survey from public USGS 3DEP elevation data, labeled in the drawing's unit. |
| Sketch Scans | `ss` | **Align on Scan** picks the stations on the scan ITSELF in the zoomable viewer -- wheel to zoom, middle-drag to pan, left-click a station and name it from the drawing's own list -- and then places the scan already fitted, so there is no insert-then-hunt-then-align. Two stations move, rotate and resize it; three or more also take out the scanner's stretch and skew, and the report says how far the worst station missed by. Right-click a scan to mark it Complete: a tick appears beside it, a trip folder gets one when every page in it is done, and the panel opens on the first scan still to do. Browse the cave's scanned sketches with hover previews, insert one over the survey and align it in one motion. Choosing the Cross Section frame and pressing **Sketch Section** opens a staging bay instead (see below). |
| Sketch Section | `sks` | Opens a staging bay for a scanned field-book cross section: a locked frame parked clear of the plan, holding the scan and a dashed ghost of the station's own computed LRUD outline to scale the scan onto and trace by hand with the suite's ordinary drawing tools. A station with no cuttable LRUD still opens the bay -- with no ghost, and says so, rather than failing. Capture Section (`skc`) closes the bay: sweeps whatever is traced inside the frame into its own block (never the scan, the ghost or the frame), leaders it back to the station it was cut at, and proposes a placement marched clear of the plan's walls -- Enter accepts it, a click puts it somewhere else, and a boxed-in station falls back to click-to-place rather than a wild guess. Nothing traced yet is refused with an explanation, not an empty block. Edit Sketch (`ske`) reopens a placed sketched section: the block's linework comes back loose in a fresh bay, the scan returns at the scale it was traced at, and the placed block and its leader are removed so the section exists in only one place at a time -- Capture Section puts it back. |
| Import Cave Survey | `ics` | Import Compass `.dat`, Walls `.srv`, Survex `.svx`, Therion `.th` or CSV -- the format is detected for you. Therion is also what TopoDroid and PocketTopo export, so a phone survey comes in through the same door. |
| Export Cave Survey | `ecs` | Write the drawing's survey back out as Compass `.dat`, Walls `.srv`, Survex `.svx`, Therion `.th` or CSV -- the format follows the name you save under. Exports what the map actually shows, including everything typed into the Notebook since the import, and leaves the cave's fixed station control out unless you ask for it. |
| Scatter Breakdown | `scb` | Fill closed `BREAKDOWN-BOUNDARY` polylines with breakdown symbols, per boundary. |
| Align Image | `ali` | Fit a scanned map onto known stations (move/rotate/scale, warp with 3+ points) for wall tracing. |
| Feature Trace | `ft` | Trace walls and other features freehand: hold the button and drag along the sketch, and a smooth line follows at one control point per foot of cave. Pick the FEATURE from the docked panel -- one tile per feature, not one per view -- and where you drag decides the rest: a stroke in the plan lands on the plan layer, one inside a profile band's bounding box on that band's run layer, one inside an open section bay on the section layer, with the station its bay was opened at recorded on the line. The readout above the tiles names the layer under the cursor before you press. The run combo's default "(by location)" is what reads the survey run off the band boxes; naming a run instead overrides it. |
| Cross Section | `cxs` | Two clicks -- a point on the passage, then where the section goes -- and a rough cross section is cut there and hung on a leader. The outline is lofted from the two neighbouring stations' own LRUD and splays in 3D, so a cut can be taken ANYWHERE along a leg rather than only at a station. Each section is its own block: it drags as a unit, it can be edited without touching any other, and Draw redefines it in place as the survey changes without ever moving where you put it. The caption states the scale and how far the cut is from the nearer station that fed it -- a cut beside a station is nearly a measurement, one midway between distant stations is an interpolation, and the section says which it is. |
| Survey Stats | `sst` | Length, depth, loop closures, and the honest BCRA/UIS grade, computed from the drawing. |
| Generate Profile | `gp` | Rebuild the extended elevation beside the plan: one band per survey run, floor and ceiling lines from LRUD and splays. Normally happens on its own with every draw, from the notebook's own survey model; this forces it from the drawing's own tags instead and prints what it could not show. |
| Build Legend | `bl` | Generate the legend from the symbols the map actually uses (NSS names, UIS aliases). |
| Callout | `cal` | Place a text note bound to one or more leader arrows -- QCAD has no multileader, so this is a real text entity and a real leader per arrow, linked so the note stays text-editable and the arrows can be reflowed after a move. |
| Elevation Callout | `cel` | Two clicks to place a spot FLOOR elevation: the point to take it at, then where the label goes. Reads the floor from the LRUD and splays, not the survey line, and says LINE on its face when it had to fall back. |
| Callout Sync | `csync` | Put every callout arrow back on its note after the note has been moved or reworded, and re-key a copied callout that ended up sharing an id with the original. |
| Shaped Lines | `shl` | Cave-map line symbology as real, self-maintaining geometry. The **Cave Lines** toolbar has one freehand button per NSS symbol -- Floor Ledge (`lgf`), Ceiling Ledge (`lgc`), Pit (`pte`), Flowstone (`fst`), Rimstone Dam (`rst`), Slope (`slp`) -- each drawing on its own layer with the ornament (hachures on the down side, scallops bowing downslope, slope fans splaying downhill) generated along the stroke; edit the line afterwards with QCAD's own tools and the ornament follows. The same buttons work in BOTH views: a stroke in the elevation (inside the band bounding boxes) lands on the PROFILE- twin layers automatically. `shl` itself is Decorate Selection: dress any existing line, polyline, arc, circle or spline the same way. Flip Shaped Side (`shf`) mirrors the ornament when the drop is on the other side; Sync Shaped Lines (`shs`) rebuilds by hand. Flowstone, rimstone and slope spines live on `CTRL-SHAPE-SPINE` (`CTRL-PROFILE-SHAPE-SPINE` in the elevation), off by default -- switch it on to reshape those edges. |

Start a new map from `templates/NSS_Cave_Template_PLAN.dxf` -- the tools
draw onto its layers and the title block and symbol blocks live there. One
template covers both views: the extended elevation is drawn into the plan
drawing, below the plan, on its own `PROFILE-` layers. Every `File > New` starts from the plan template
unless the `CaveSurvey/TemplateOnNew` setting is explicitly false.

The title block is **ordinary text** on the `TITLE-BLOCK` layer: double-click
a line to edit it, drag it where you want it, delete the lines this map does
not use. Survey Stats can still stamp length, depth and grade into their
lines, which it finds by a hidden field tag rather than by position.

## A cave project folder

A cave folder gets the same four subfolders wherever the suite makes or
adopts one:

```
Pitfall Cave/
  Pitfall Cave.dxf        the drawing -- the record
  scans/                  photographed or scanned sketch pages
  PDF/                    plotted maps, exactly as they were plotted
  images/                 photographs, and the drawing's preview
  backup/                 previous versions of the drawing, datestamped
```

`backup/` holds one file per save that overwrote something:
`Pitfall Cave.dxf.2026-08-29_041200.bak`. The stamp sorts, so rolling
back is a matter of reading the folder and copying the one you want over
the drawing -- and each backup keeps the modification time of the
version it holds. The five most recent generations are kept
(`CaveSurvey/BackupKeep`); older ones are pruned oldest-first. A cave
drawing is most of a megabyte and usually lives on a synced drive, so
each generation costs upload traffic as well as disk.

A save that changes nothing costs no generation: the drawing is compared
against the newest backup first, and an identical one is not copied
again.

A backup is taken immediately before any of this suite's destructive
operations -- not on save. See `Core/CsBackup.js` for why that is the
better moment, and for the two "on save" hooks that were tried and
measured inert.

## Which format to hand someone

Every supported format carries the shape of the cave faithfully -- all
141 shots of the PITFALL CAVE fixture come back within rounding, and no
station moves more than 0.005 ft. What differs is everything around the
shape: trips, teams, the cave name, flags, LRUD grouping, and the
elevation datum.

**[docs/format-fidelity.md](docs/format-fidelity.md)** measures it rather
than asserting it, and `node tools/format_fidelity.js` reproduces the
measurement. The short version: Therion `.th` is the highest-fidelity
export, Compass `.dat` is the only one that keeps every flag and the only
one that **loses the elevation datum** (it has no fix directive, so the
cave rebases to zero), and CSV keeps the geometry exactly and almost no
context.

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
