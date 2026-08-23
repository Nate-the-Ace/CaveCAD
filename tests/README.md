# Tests

Five stages, cheapest first, all driven by one script:

    ./tests/run_all.sh             what has to pass while developing
    ./tests/run_all.sh --publish   also what has to pass before releasing

What is under test, and where it lives:

    scripts/CaveSurvey/     the QCAD add-on -- the source of truth
    templates/              drawing templates several tests build against
    testdata/               survey fixtures used by the parser tests

## Setup

Everything here is stdlib Python plus CaveCAD's own script engine -- no
virtualenv, no `pip install`, nothing to skip cleanly if it's missing:

    python3 -m unittest discover -s tests -v

`tests/test_addon.py` imports only `os`, `re`, `shutil`, `subprocess`,
`tempfile`, `unittest` and `xml.etree.ElementTree`.

## Stage 1/5 -- `test_addon.py` (structural tests)

Checks the add-on's structure without running any of it: every tool lives in
a folder named after it, nothing loose sits beside `CaveSurvey.js`,
`setScriptFile` points at its own file, referenced icons actually exist, no
two tools share a `(groupSortOrder, sortOrder)` pair, every `Core/` file is
`Cs`-prefixed (QCAD's `include()` dedupes by basename -- an unprefixed file
sharing a name with anything QCAD already loads at startup is skipped
silently), every layer `Core/CsLayers.js` defines exists in the matching
template, and both `NSS_Cave_Template_PLAN.dxf` and
`NSS_Cave_Template_PROFILE.dxf` are present. These are the failures that
otherwise show up as a tool mysteriously absent from the menu, or a layer
silently missing from a fresh drawing.

## Stage 2/5 -- `js_syntax.js` (add-on syntax check)

Parses every script under `scripts/CaveSurvey/` inside QCAD's own ECMAScript
engine, by wrapping each in a function expression and `eval`-ing it -- which
parses without executing, so no dialog opens and `RMainWindowQt` is never
touched. Catches a syntax error that would otherwise surface only as a tool
silently missing from the menu at runtime.

## Stage 3/5 -- `js_unit.js` (Core unit tests)

Unit tests for `scripts/CaveSurvey/Core/*.js` -- the pure survey engine
(parsing, network resolution, LRUD, adjustment, the extended-elevation
geometry, and more). Deliberately runs in TWO engines from the same file:

    node tests/js_unit.js
    CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
        -autostart tests/js_unit.js "$PWD"

Node is the fast developer loop; CaveCAD's own engine is authoritative,
because it has caught real divergences node cannot -- `Array.prototype.sort`
is unstable in CaveCAD's engine and stable in node, so a comparator that can
return 0 for two distinct items produces different geometry in each. Every
Core file loaded here must stay loadable under plain node: nothing may touch
`R*`/`Q*` globals at file (as opposed to function-body) scope.

## Stage 4/5 -- `profile_file_roundtrip.js`

QCAD-context only (real `RDocument`/`RDocumentInterface`, real file I/O), so
it cannot run under node. Proves the extended elevation's document-resolution
half (`Core/CsProfileFile.js`): sibling path derivation in the real engine,
resolving to the PROFILE template on a first run, refusing (rather than
silently blessing) a sibling that is empty, unreadable, or is the plan's own
file, and -- the load-bearing fact the whole tagging scheme rests on -- a
custom property written into an entity survives export through the dxflib
DXF writer and reimport intact.

## Stage 5/5 -- `profile_draw_roundtrip.js`

Also QCAD-context only. Proves the drawing half (`Core/CsProfileDraw.js`):
rendering a built profile creates its layers and geometry, a second render
erases exactly what the first one drew (by its `Profile*` tags) and redraws
in its place, and hand-drawn linework on the plain `PROFILE-FLOOR` /
`PROFILE-CEILING` tracing layers is never touched.

## Publish checks

Some things are only required to ship, not to develop. A tool with no icon
works fine from the menu and the command line while it's being written -- it
just can't go out that way. So `TestPublishReadiness` is off by default and
enabled by `--publish` (or `CAVESURVEY_PUBLISH_CHECK=1`):

* every tool has a toolbar icon;
* every referenced icon is parseable SVG, since a file QCAD can't parse
  renders exactly like a missing one;
* every tool has a status tip -- the one-line hover text that, for a layman,
  is often the only documentation they read.

## Survex format limits

`Core/Format/CsSurvex.js` (used by the `ImportCaveSurvey` tool) has three
known limits worth knowing about, not fixing:

* `*data passage` is keyed by station, so two shots ending at the same
  station cannot carry different passage sizes in the same file. All-zero
  LRUD is treated as "not measured" so blanks never clobber a real
  measurement recorded from the other end, and a genuine contradiction
  produces a plain-language warning naming both shots and saying which was
  kept.
* `*begin`/`*end` name-prefix scoping is supported, but only in the shape
  Survex itself writes it (see the file's own header comment for the exact
  supported grammar) -- an unusual hand-edited file may need reshaping first.
* Anonymous stations (`.`, `..`, `...`) and the PocketTopo `-` convention are
  both supported, but neither survives a round trip back out to Survex with
  its original anonymous spelling; they come out as ordinary generated names.

## Not covered

Behaviour that exists only as GUI interaction -- a dialog the user drives, or
a command that acts on the current selection -- is not stubbed; the fidelity
loss isn't worth it. Test those by hand in the GUI, via
**Misc > Development > Run Script...** for a script that isn't installed yet.

## Notes on driving CaveCAD headless

All learned the hard way, and relevant to any new `-autostart` test script:

* The binary at `CaveCAD.app/Contents/MacOS/CaveCAD` runs headless directly.
* A `-autostart` script must not assume `library.js` helpers are preloaded --
  `js_syntax.js`, `js_unit.js`, and both round-trip scripts each carry their
  own fallback shims for the handful of globals (`isNull`,
  `createSpatialIndex`, `destr`) they need.
* `-allow-multiple-instances` is required, or the app aborts with
  "Application already running" whenever the GUI is open.
* The process cwd may not be where you invoked it. Relative paths won't
  resolve; pass the repo root as an argument (`"$PWD"` in every invocation
  above) and read it back with `RSettings.getOriginalArguments()`.
* `QCoreApplication.arguments()` is not wrapped in this build. There is also
  no `quit()`/`qApp.quit()` -- the process exits when the script returns.
* A direct `eval()` inside a helper function (a `loadRepoScript`-style
  loader, for instance) lands its definitions in THAT FUNCTION's scope,
  invisible the moment it returns. Use indirect eval -- `(0, eval)(source)`
  -- so definitions land in the global scope instead. Every loader in this
  test suite depends on this.
* A headless run (`-no-gui`) has no MDI area at all: `RMainWindowQt` exists,
  but its main window and MDI area are null. Any code path that enumerates
  open tabs (`CsProfileFile.openTabFor`) degrades to "nothing is open" here,
  by design -- it cannot be exercised end-to-end by a headless script, only
  by hand in the real GUI, or against injected fakes (see
  `CsProfileFile._listOpenChildren` and its unit tests in `js_unit.js`).
