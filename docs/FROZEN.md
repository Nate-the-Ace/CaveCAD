# Frozen and out of scope

Work that exists in this repository but is **not delivered**, and must not be
treated as part of a release.

## Trip Focus

**Status: FROZEN. Undeliverable. Out of scope.**

Owner's decision, 2026-08-24: Trip Focus does not ship. It is not to be
developed further, not to be included in a build, and not to be counted as a
feature of the suite.

What that means concretely:

- **It is excluded from every package.** `tools/make_package.sh` carries
  `PARKED_TOOLS="TripFocus"` and deletes the folder from the staged copy, so no
  published build and no installed add-on contains it. Verified in the shipped
  `0.8.x-callout-preview` builds: the installed tool list has no Trip Focus
  entry.
- **Its source remains in the repository**, under
  `scripts/CaveSurvey/TripFocus/`, with its Core half in
  `scripts/CaveSurvey/Core/CsFocus.js` and its test in
  `tests/trip_focus_filter.js`. History is not being rewritten to remove it: the
  commits interleave with unrelated work, and `tests/run_all.sh` section 7 still
  runs that test, so excising it would be a destructive change to a green suite
  for no delivery benefit.
- **Do not add to it.** No new features, no fixes beyond keeping the existing
  test green if something else breaks it.

Why it was frozen is recorded in its own commit,
`chore: 0.6.1.0 -- park Trip Focus, it does not ship`, and in
`docs/superpowers/HANDOFF-github-versioning-slice1.md` era notes. The short
version: the list pane could not be built in this bridge --
`QTreeWidget`/`QListWidget` are not constructible from script here, they return
convincing stubs whose every method is `undefined` -- and the whole pane passed
`run_all.sh` while being incapable of opening, because no test constructed the
widget.

**If Trip Focus is ever revived**, the widget-constructibility probe is the first
gate, not the last: read `docs/` for the verified list of what this bridge can
actually construct (`QCheckBox`, `QScrollArea`, `QGridLayout`, `QLabel`,
`QWidget`, `QSplitter`, `QDialog`, `QLineEdit`, `QPushButton`, `QComboBox`), and
probe anything not on it before designing a layout around it.
