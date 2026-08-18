# Tests

Three layers, cheapest first. Run everything with:

    ./tests/run_all.sh

## Setup

`format_io.py` imports only `re`, so the parser tests need nothing at all:

    python3 -m unittest discover -s tests -v

The DXF tests need `ezdxf`, and the GUI app also needs `matplotlib`. They
skip themselves cleanly if it's missing:

    python3 -m venv .venv
    .venv/bin/pip install ezdxf matplotlib
    .venv/bin/python -m unittest discover -s tests -v

On macOS with system Python 3.9, pip resolves matplotlib to the 3.9.x series
(3.10+ requires Python 3.10). That's expected, not a problem.

## Layer 1 -- `test_parsers.py`

Stdlib `unittest`. Covers unit conversion, the three native-format parsers,
parse -> write -> parse round-trips, and DXF generation against the real
`NSS_Cave_Template_PLAN.dxf` (layer population, and that out-of-order loop
closures get reported rather than silently plotted).

## Layer 2 -- `differential.py`

The important one. `ImportNativeCaveSurvey.js` and `format_io.py` are two
separate hand-written parsers for the same three formats, and a wrong format
detail never raises -- it just draws a plausible but wrong map. This runs both
over the shared fixtures and diffs every field.

    python3 tests/differential.py

It exits non-zero on any mismatch, so it works as a pre-commit or CI gate. If
QCAD can't be driven headless it prints `SKIP` and exits 0 rather than failing
the suite -- see the edition note below.

Two generations of the QCAD scripts exist: the standalone ones in this repo
(run via **Misc > Development > Run Script...**) and the `CaveSurvey/` add-on
copies with menu/toolbar wiring. The parsers are identical between them; only
the entry point differs. Check whichever you like:

    python3 tests/differential.py --js /path/to/CaveSurvey/ImportNativeCaveSurvey/ImportNativeCaveSurvey.js
This test is what caught the metres/feet split that the unit conversion in
`format_io.to_drawing_units()` now fixes: the JS converted Survex's default
metres to feet, Python didn't, and the same file plotted 3.28x different.

## Layer 3 -- `js_parsers.js`

The JS side of the differential test, driven by `differential.py` but runnable
alone. It executes inside QCAD's *own* script engine -- the same engine the
real tool runs in -- with no GUI and no dialogs:

    /Applications/QCAD.app/Contents/Resources/qcad \
        -no-dock-icon -no-gui -allow-multiple-instances \
        -autostart tests/js_parsers.js "$PWD"

### QCAD edition

The tools themselves need only QCAD **Community**: they use `scripts/simple.js`,
`RVector`, `RLineweight` and `RBlockReference*`, all core API, plus `EAction`
and `RGuiAction` for the add-on generation's menu wiring. Nothing Pro-only.

The headless harness below is developer tooling, not something a surveyor runs,
and it has only been verified against a **Pro** install (the one on this
machine ships `libqcadproscripts` and `libqcadprojsapi`). Whether Community
supports `-no-gui` with `-autostart` is untested. If it doesn't,
`differential.py` skips cleanly and the parsers can still be checked by hand
in the GUI.

Notes on driving QCAD headless, all learned the hard way:

* Use the launcher at `QCAD.app/Contents/Resources/qcad`, not the binary in
  `MacOS/` -- it sets `DYLD_LIBRARY_PATH` for you.
* `-allow-multiple-instances` is required, or QCAD aborts with "Application
  already running" whenever you have the GUI open.
* The process cwd is QCAD's own `Resources` directory, *not* where you invoked
  it. Relative paths won't resolve; pass the repo root as an argument.
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

`AzimuthTraverse.js` is interactive: it prompts per shot for azimuth,
distance, inclination and LRUD. Stubbing that isn't worth the fidelity loss,
so test it by hand in the GUI via **Misc > Development > Run Script...**.
Same for `CheckStationProperties.js`, which needs a selected entity.
