# Tests

Three layers, cheapest first. Run everything with:

    ./tests/run_all.sh             what has to pass while developing
    ./tests/run_all.sh --publish   also what has to pass before releasing

What is under test, and where it lives:

    scripts/CaveSurvey/     the QCAD add-on -- the source of truth
    app/                    the Python data-entry app
    templates/              drawing templates the DXF tests build against
    testdata/               survey fixtures shared by both implementations

## Setup

`app/format_io.py` imports only `re`, so the parser tests need nothing at all:

    python3 -m unittest discover -s tests -v

The DXF tests need `ezdxf`, and the GUI app also needs `matplotlib`. They
skip themselves cleanly if it's missing:

    python3 -m venv .venv
    .venv/bin/pip install ezdxf matplotlib
    .venv/bin/python -m unittest discover -s tests -v

On macOS with system Python 3.9, pip resolves matplotlib to the 3.9.x series
(3.10+ requires Python 3.10). That's expected, not a problem.

## Layer 0 -- `test_addon.py` and `js_syntax.js`

`test_addon.py` checks the add-on's structure: every tool in a folder named
after it, nothing loose beside `CaveSurvey.js`, `setScriptFile` pointing at its
own file, both widget names present, referenced icons actually existing, and no
two tools sharing a `(groupSortOrder, sortOrder)` pair. These are the failures
that otherwise show up as a tool mysteriously absent from the menu.

`js_syntax.js` parses all six add-on scripts inside QCAD's own ECMAScript
engine, by wrapping each in a function expression and `eval`ing it -- which
parses without executing, so no dialog opens and `RMainWindowQt` is never
touched. Only `ImportNativeCaveSurvey`'s parsers get genuinely exercised by the
differential test; the other five are interactive or GUI-bound, so a syntax
error in one of them would otherwise surface as a missing menu entry.

## Publish checks

Some things are only required to ship, not to develop. A tool with no icon works
fine from the menu and the command line while it's being written -- it just
can't go out that way. So `TestPublishReadiness` is off by default and enabled
by `--publish` (or `CAVESURVEY_PUBLISH_CHECK=1`):

* every tool has a toolbar icon;
* every referenced icon is parseable SVG, since a file QCAD can't parse renders
  exactly like a missing one;
* every tool has a status tip -- the one-line hover text that, for a layman, is
  often the only documentation they read.

Right now `--publish` fails: `LRUDWalls` and `GeoAnchor` have no `.svg` yet.
That's expected during development and is the list to work through before a
release.

## Layer 1 -- `test_parsers.py`

Stdlib `unittest`. Covers unit conversion, the three native-format parsers,
parse -> write -> parse round-trips, and DXF generation against the real
`templates/NSS_Cave_Template_PLAN.dxf` (layer population, and that out-of-order
loop closures get reported rather than silently plotted).

## Layer 2 -- `differential.py`

The important one. The add-on's `ImportNativeCaveSurvey.js` and the app's `format_io.py` are two
separate hand-written parsers for the same three formats, and a wrong format
detail never raises -- it just draws a plausible but wrong map. This runs both
over the shared fixtures and diffs every field.

    python3 tests/differential.py

It exits non-zero on any mismatch, so it works as a pre-commit or CI gate. If
QCAD can't be driven headless it prints `SKIP` and exits 0 rather than failing
the suite -- see the edition note below.

By default this tests `scripts/CaveSurvey/ImportNativeCaveSurvey/`. An older
standalone generation of these scripts also exists, ending in a bare call to
its own `main()` instead of add-on wiring; the harness still loads either shape,
so a stray copy can be checked with:

    python3 tests/differential.py --js /path/to/some/ImportNativeCaveSurvey.js
This test is what caught the metres/feet split that the unit conversion in
`format_io.to_drawing_units()` now fixes: the JS converted Survex's default
metres to feet, Python didn't, and the same file plotted 3.28x different.

## Layer 3 -- `js_parsers.js`

The JS side of the differential test, driven by `differential.py` but runnable
alone. It executes inside QCAD's *own* script engine -- the same engine the
real tool runs in -- with no GUI and no dialogs:

    /Applications/CaveCAD.app/Contents/MacOS/CaveCAD \
        -no-dock-icon -no-gui -allow-multiple-instances \
        -autostart tests/js_parsers.js "$PWD"

### Target application

The tools target **CaveCAD only**: they rely on its native XDATA
persistence for survey data, which stock QCAD's free writer lacks. API-wise
they use `scripts/simple.js`, `RVector`, `RLineweight` and
`RBlockReference*`, plus `EAction` and `RGuiAction` for the menu wiring --
all present in the CaveCAD build.

The headless harness below is developer tooling, not something a surveyor
runs. It drives the CaveCAD binary directly.

Notes on driving CaveCAD headless, all learned the hard way:

* The binary at `CaveCAD.app/Contents/MacOS/CaveCAD` runs headless directly.
  A `-autostart` script must not assume `library.js` helpers are preloaded
  (js_syntax.js and js_unit.js carry their own fallbacks).
* `-allow-multiple-instances` is required, or the app aborts with
  "Application already running" whenever you have the GUI open.
* The process cwd may not be where you invoked it. Relative paths won't
  resolve; pass the repo root as an argument.
* `QCoreApplication.arguments()` is not wrapped in this build (3.32.9).
  Use `RSettings.getOriginalArguments()`.
* `qApp.quit()` doesn't exist either; the process exits when the script
  returns. The "Unimplemented code" warnings on stderr are `-no-gui` stubs
  and are harmless.
* Each tool script ends in a GUI entry point the harness has to cut away
  before `eval`: the standalone generation ends in a bare call to its own
  `main()`, which would block on a `QFileDialog` that can't exist under
  `-no-gui`; the add-on generation instead ends in `EAction` wiring that
  touches `RGuiAction` and `RMainWindowQt`, which don't exist headless. The
  harness handles both.

## Survex export limits

Three Survex export bugs used to be tracked here as `expectedFailure`. Two
were real and are fixed; the third turned out to be inherent to the format.

* **Fixed** -- `write_survex` wrapped its output in
  `*begin <survey_designation>`, which renamed every station on re-import
  (`A1` -> `A.A1`). It now only emits a `*begin` block when the stations
  already share that prefix, so both prefixed and plain names round-trip.
* **Fixed** -- notes were written as trailing `; ...` comments that
  `parse_survex` then stripped. A trailing comment on a shot line is now read
  back as that shot's note.
* **Inherent to Survex, not fixable** -- `*data passage` is keyed by station,
  so two shots ending at the same station cannot carry different passage
  sizes. All-zero LRUD is now treated as "not measured" so blanks never
  clobber real measurements, and a genuine contradiction produces a
  plain-language warning naming both shots and saying which was kept. See
  `TestSurvexPassageLrud`.

## Not covered

Behaviour that exists only as GUI interaction -- a dialog the user drives, or
a command that acts on the current selection -- is not stubbed; the fidelity
loss isn't worth it. Test those by hand in the GUI, via
**Misc > Development > Run Script...** for a script that isn't installed yet.
