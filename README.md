# Cave Survey tools for QCAD

Tools for drawing cave surveys in [QCAD](https://qcad.org). Plot a traverse by
azimuth and distance, import survey files from Walls, Compass or Survex, derive
passage walls from LRUD, scatter breakdown symbols, and georeference a finished
map.

Everything here works in **QCAD Community** (the free version). Nothing
requires QCAD Professional.

## What's in here

| Folder | What it is |
| --- | --- |
| `scripts/CaveSurvey/` | The QCAD add-on. This is the main thing. |
| `app/` | A standalone data-entry app, for typing up survey notes away from QCAD. |
| `templates/` | NSS-style plan and profile drawing templates. |
| `testdata/` | Small example survey files in all three native formats. |
| `tests/` | Automated tests -- see `tests/README.md`. |
| `tools/` | Builds the release package -- see [Building the package](#building-the-package). |
| `legacy/` | Two older scripts not yet part of the add-on. |

## Installing the QCAD add-on

For anyone who just wants to use the tools, hand them a built package rather
than this repo -- see [Building the package](#building-the-package). It holds
every tool, the templates and sample surveys, and installs itself:

```bash
./install.sh
```

To install from a checkout instead, copy the `CaveSurvey` folder into QCAD's
per-user `scripts` folder and restart QCAD. A **Cave Survey** menu and toolbar
appear.

```bash
cp -R scripts/CaveSurvey "$HOME/Library/Application Support/QCAD/QCAD/scripts/"
```

| Platform | QCAD's per-user scripts folder |
| --- | --- |
| macOS | `~/Library/Application Support/QCAD/QCAD/scripts` |
| Windows | `%APPDATA%\QCAD\QCAD\scripts` |
| Linux | `~/.local/share/QCAD/QCAD/scripts` |

Create `scripts` if it isn't there. Installing into the QCAD application folder
also works, but a QCAD update replaces the application and takes the tools with
it, so prefer the paths above.

While working on a tool, `../qcad-align-image-tool/install_for_testing.sh`
symlinks these working copies into that folder instead of copying them, so an
edit is live after a restart.

### The tools

Each appears in the **Cave Survey** menu, and can also be run by typing its
command in QCAD's command line.

| Tool | Command | What it does |
| --- | --- | --- |
| Azimuth Traverse | `azimuthtraverse`, `azt` | Plots shots one at a time from typed azimuth, distance, inclination and LRUD. Start from a selected station to continue an existing survey. |
| Import Native Cave Survey | `importcavesurvey`, `ics` | Reads a Walls `.srv`, Compass `.dat` or Survex `.svx` file directly and draws the centerline, stations and LRUD ticks. |
| Align Image* | `alignimage`, `ali` | Fits a scanned map onto the drawing by matching two points, so passage walls can be traced off it. |
| LRUD Walls | `lrudwalls` | Draws approximate passage walls through the LRUD points left by Azimuth Traverse. |
| Scatter Breakdown | `scatterbreakdown`, `scb` | Fills closed `BREAKDOWN-BOUNDARY` polylines with randomized breakdown symbols. |
| Geo Anchor | `geoanchor` | Moves and scales the whole drawing so one station sits at a real latitude/longitude. |

\* Align Image is maintained in its own project, `../qcad-align-image-tool`,
and is copied into the add-on when the package is built. It is not in
`scripts/CaveSurvey/` here.

Start a new map from `templates/NSS_Cave_Template_PLAN.dxf` (or
`..._PROFILE.dxf`). The tools draw onto its `CTRL-` layers:

| Layer | Contents |
| --- | --- |
| `CTRL-SHOTS` | Centerline shot lines |
| `CTRL-STATIONS` | Station point symbols |
| `CTRL-STATION-LABELS` | Station names and elevations |
| `CTRL-LRUD` | LRUD tick lines and up/down text |

## Conventions

These hold across every tool here, and are worth knowing before you trust a
plotted map:

* **Azimuth** is degrees clockwise from North: 0 = N, 90 = E.
* **Distance is treated as already horizontal.** Inclination only affects the
  elevation recorded in a station's label, never its plotted position.
* **Distances are converted to feet** on import, to match the templates.
  Each format's own default applies: Survex metres, Walls feet, Compass always
  feet. If your drawing is in metres, change `DRAWING_DISTANCE_UNIT` in both
  `scripts/CaveSurvey/ImportNativeCaveSurvey/ImportNativeCaveSurvey.js` and
  `app/format_io.py`.
* **L and R** are measured facing the direction of travel, and LRUD belongs to
  the **To** station of a shot.
* **Declination** declared in a file is applied on import for Compass
  (`DECLINATION:`) and Walls (`#Units Decl=`). Survex's `*calibrate
  declination` is not read, so an `.svx` relying on it comes in rotated.

## The data-entry app

`app/` is a separate desktop app for typing up survey notes, previewing the
result, converting between the three file formats, and generating a DXF. It
does not need QCAD at all. It needs Python 3.9 or newer:

```bash
python3 -m venv .venv && .venv/bin/pip install ezdxf matplotlib
```

```bash
.venv/bin/python app/cave_survey_app.py
```

It finds `templates/NSS_Cave_Template_PLAN.dxf` automatically, and prompts you
once if it can't.

Two things to know about it: it makes a single top-to-bottom pass, so a shot's
**From** station must already be defined by an earlier row -- unlike the QCAD
importer, it can't resolve a loop closure that appears out of order (reorder
the row instead). And declination is applied only when importing a Compass
file, which is what that format's spec calls for; it is not re-applied on
Walls or Survex import, or on export.

Survex stores passage size per *station*, not per shot, so two shots ending at
the same station share one set of LRUD measurements. Blank measurements never
overwrite real ones, and if two shots genuinely disagree the export says so.

## Tests

```bash
./tests/run_all.sh
```

See `tests/README.md`. `./tests/run_all.sh --publish` additionally checks what
only matters for a release -- every tool having a toolbar icon and a status
tip. The interesting one is a differential test that runs the add-on's parsers
inside QCAD's own script engine and diffs them against the app's Python
parsers, so the two implementations can't quietly drift apart.

## Building the package

```bash
./tools/make_package.sh
```

Produces `dist/CaveSurveyTools-<version>.zip` -- the whole add-on, the
templates, the sample surveys, install notes and a per-platform installer. That
zip is what a release is; the version comes from `VERSION`, or from
`--version`.

Align Image is copied in from `../qcad-align-image-tool/AlignImage`; point
`ALIGN_IMAGE` elsewhere if your checkout isn't a sibling. A build with it
missing fails rather than quietly shipping five tools.

The staged package is checked before it is zipped -- the structural tests with
the publish gate on, then every script parsed by QCAD's own engine. Both run
against the *package*, not the repo, because that is the only place all six
tools are ever seen together: a menu position that collides between Align Image
and a tool in this repo cannot show up in either project on its own.
