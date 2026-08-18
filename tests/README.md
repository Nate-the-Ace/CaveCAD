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

It exits non-zero on any mismatch, so it works as a pre-commit or CI gate.
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
* Each tool script ends in a bare call to its own `main()`, which would block
  on a `QFileDialog` that can't exist under `-no-gui`. The harness reads the
  file, strips that trailing call, and `eval`s the rest.

## Known bugs, tracked as expected failures

Three `@unittest.expectedFailure` tests in `test_parsers.py` document real
Survex export bugs. If one reports **unexpected success**, it's been fixed --
delete the decorator, not the test.

1. `test_survex_round_trip_preserves_station_names` -- `write_survex` wraps
   its output in `*begin <survey_designation>`, so re-importing renames every
   station (`A1` -> `A.A1`).
2. `test_survex_round_trip_preserves_lrud` -- Survex `*data passage` is keyed
   by station, so when two shots share a TO station, one shot's LRUD is handed
   back to both. `A4->A2` (originally all zeros) returns `A1->A2`'s LRUD.
3. `test_survex_round_trip_preserves_notes` -- `write_survex` emits notes as
   trailing `; ...` comments, but `parse_survex` strips from the first `;`
   onward, so it writes a field it can't read back.

## Not covered

`AzimuthTraverse.js` is interactive: it prompts per shot for azimuth,
distance, inclination and LRUD. Stubbing that isn't worth the fidelity loss,
so test it by hand in the GUI via **Misc > Development > Run Script...**.
Same for `CheckStationProperties.js`, which needs a selected entity.
