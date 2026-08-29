# The companion file — design (2026-08-29)

A single JSON file written beside every cave drawing, carrying the whole
survey and the whole of what the drawing knows *about* the survey, at
full precision and with no length limits.

Proposed extension **`.cave`**, so `PITFALL CAVE.dxf` is accompanied by
`PITFALL CAVE.cave`. Nothing here is built. Written for review.

## Why a new file at all

Two facts, both established by measurement rather than assumption.

**Every interchange format is lossy, and each in a different place.**
`docs/format-fidelity.md` measures it: Compass loses the elevation datum
outright, Walls collapses four trips into one and drops every team,
Survex and Therion cannot express a struck-out shot, CSV keeps the
geometry perfectly and almost nothing else, and only Compass keeps the
held-fixed flag. Of the several readings behind a `5/10` LRUD entry
(`leftAll`/`rightAll`/`upAll`/`downAll`), only the suite's own CSV
dialect keeps them — its notebook shorthand is the one column format
with anywhere to put a second number, and Compass, Walls, Survex and
Therion all drop back to a single reading.

**The DXF is the only complete copy, and it is complete only in
CaveCAD.** The tag schema (v3, 60 keys) holds more than any interchange
format, but it persists because of fork patch 0005: upstream QCAD's free
dxflib writer never serialized custom properties, and its importer's
`importXData` was a `TODO`. A CaveCAD DXF opened and re-saved by stock
QCAD, AutoCAD, or anything else keeps the geometry and can drop the 1001
groups. The map survives; the survey model does not, silently.

And the tag store has a hard ceiling that is already shaping the design
of the suite. `CsStationOrder.js` caps its `AlignedStations` tag at 800
characters and says why: "dxflib dies at 1024 chars/line, so no
unbounded tag, ever (the RevisionLog lesson)". `RevisionLog` was retired
entirely for the same reason (Nathan, 2026-08-27). `CsBind`'s
`LineworkStations` and `CsDraw`'s `ExcludedShots`/`UnplacedShots` are
unbounded by construction and live under the same ceiling.

A sidecar file has no such ceiling, no APPID negotiation, no foreign
writer to survive, and no rounding. That is the whole argument.

## What it is, and is not

**Is:** the authoritative, lossless record of the survey and of every
decision the suite made about it. If the DXF's XDATA were stripped
tomorrow, this file plus the geometry would rebuild the drawing's survey
exactly, including the frame it was drawn in.

**Is not:**

- *Not a replacement for the DXF.* Geometry and cartography — traced
  walls, shaped lines, callout leaders, the sheet — stay in the drawing.
  DXF prints anywhere and opens anywhere; that is worth keeping and this
  file does not compete with it.
- *Not an interchange format.* Compass, Walls, Survex, Therion and CSV
  exist to talk to other people's software. This talks to CaveCAD.
- *Not a package.* Package Cave Project still assembles the zip; this
  file becomes one of the things it puts in it.

## Container

**One pretty-printed JSON file, UTF-8, LF.**

JSON was verified working in CaveCAD's own script engine before this was
written — `JSON.parse`, `JSON.stringify`, two-space indentation, and
full double precision (`512345.6712345678` survives a round trip
exactly). The engine trap that pushed the *legacy* store away from JSON
was MTEXT treating braces as formatting groups (`CsStore.js`); that
applies to text stored inside a drawing, not to a file on disk.

One file rather than a zip: it must be greppable, diffable, and
readable by a caver with a text editor, and it syncs through Drive as a
single object.

**Determinism is a requirement, not a nicety.** Keys are written in the
order this spec lists them, arrays in survey order, numbers with
JavaScript's own shortest round-trip representation. Writing the same
survey twice produces byte-identical files, so a diff between two
versions of a cave shows what actually changed. This is testable, and
the tests below test it.

## Shape

```
{
  "format":     { ... }    what this file is
  "cave":       { ... }    which cave, which drawing
  "privacy":    { ... }    sanitized or full, stated in the file
  "survey":     { ... }    the complete CsModel survey
  "adjustment": { ... }    how the drawn coordinates were produced
  "drawing":    { ... }    what the drawing knows about the survey
  "extra":      { ... }    anything a future version added (preserved)
}
```

### `format`

```json
{ "format": { "name": "cavecad-companion", "version": 1,
              "generator": "Cave Survey Tools 0.9.17.1",
              "written": "2026-08-29T04:12:00Z" } }
```

`version` is a single integer. A reader that meets a higher one refuses
the file and says so rather than guessing; a reader that meets a lower
one migrates. No minor version: a change either breaks readers or does
not, and "does not" needs no number.

### `cave`

```json
{ "cave": { "name": "PITFALL CAVE",
            "drawing": "PITFALL CAVE.dxf",
            "distanceUnit": "ft",
            "pairing": { "stations": 71, "entities": 1284 } } }
```

`pairing` is a weak fingerprint of the drawing this file was written
from — not a checksum, deliberately. A drawing gains and loses entities
constantly as the map is drawn, so a strict hash would report "mismatch"
every day and be ignored within a week. Counts let a reader say *"this
companion was written when the drawing had 71 stations and it now has
84 — it is older than the drawing"*, which is the only claim worth
making automatically. Anything stronger is a job for the user.

### `privacy`

```json
{ "privacy": { "sanitized": true, "omitted": ["survey.fixed", "drawing.geo"] } }
```

Stated in the file, not inferred from what is missing. The rules are
`CsPackage.sanitizeSurvey`'s, unchanged: a sanitized file carries no
`survey.fixed` and no `drawing.geo`, and the cave's shape is not the
secret. `omitted` names what was left out so a reader can tell "no
control was recorded" from "control was removed" — a distinction the
interchange formats cannot express at all, and the reason a caver
opening a sanitized file does not conclude the survey was never tied in.

### `survey`

The whole `CsModel` survey, field for field, at full precision.

```json
{ "survey": {
    "name": "", "caveName": "PITFALL CAVE", "date": "2026-03-14",
    "team": "N. SCHONEGG, R. WEBB", "instruments": "",
    "declination": -4.66, "declinationSource": "IGRF-14",
    "distanceUnit": "ft",
    "startNote": "", "startLrud": null,
    "fixed": { "A1": { "x": 0.0, "y": 0.0, "z": 812.4 } },
    "trips": [
      { "name": "ENTRANCE SERIES", "date": "2026-03-14",
        "team": "N. SCHONEGG, R. WEBB", "instruments": "",
        "declination": -4.66, "declinationSource": "IGRF-14",
        "distanceUnit": "ft", "startNote": "", "startLrud": null }
    ],
    "shots": [
      { "from": "A1", "to": "A2",
        "distance": 28.5, "azimuth": 209.66, "inclination": -11.0,
        "backAzimuth": null, "backInclination": null,
        "left": null, "right": null, "up": null, "down": null,
        "leftAll": null, "rightAll": null, "upAll": null, "downAll": null,
        "splay": false, "excludeFromPlot": false, "excludeFromAll": false,
        "excludeFromLength": false, "noAdjust": false,
        "notes": "STEEP MUD SLOPE",
        "trip": 0, "seq": 0, "declination": -4.66 }
    ] } }
```

Points where this beats every interchange format:

- **`leftAll`/`rightAll`/`upAll`/`downAll`** — the several readings
  behind one LRUD entry. Only the suite's own CSV dialect keeps these,
  and CSV keeps almost nothing else.
- **`seq`** — the shot's position within its own trip, which is the
  notebook's row order. `CsRevise` reconstructs by sorting on
  `(trip, ShotSeq)`; Compass and Survex both regroup shots into per-trip
  blocks and lose it.
- **Per-shot `declination`** alongside the true `azimuth`, so the
  original magnetic reading is recoverable exactly rather than by
  subtracting a trip average.
- **Every flag**, including `noAdjust` and `excludeFromAll`, which only
  Compass keeps and no other format can even say.
- **No rounding.** The writers all use `toFixed(2)`. This does not.

`trip` stays an integer index into `trips`, not a fingerprint — the same
reasoning `CsBind` gives for binding linework by trip id: a `date|team`
fingerprint "goes stale the moment a date typo or a team spelling is
corrected", and correcting those is exactly what the revision framework
is for.

### `adjustment`

```json
{ "adjustment": { "mode": "leastSquares", "sigmaTape": 0.05,
                  "sigmaAngle": 1.0,
                  "anchor": { "station": "A1", "x": 0.0, "y": 0.0, "z": 812.4 } } }
```

The record `CsDraw.survey` stamps on the trip-0 anchor
(`Adjustment`/`SigmaTape`/`SigmaAngle`) plus the anchor itself. With
this, `survey`, and `CsAdjust.resolveAndAdjust`, the drawn station
coordinates are reproducible exactly — which is what makes the file a
real backup of the drawing's survey rather than a description of it.

### `drawing`

What the drawing knows about the survey, keyed by things that mean
something rather than by entity handles. **Handles are not usable across
files** — the DXF exporter renumbers them on save, which is precisely
why `CsStore` keyed its legacy records by geometry instead.

```json
{ "drawing": {
    "stations": { "A1": { "x": 0.0, "y": 0.0, "z": 812.4, "seq": 0 } },
    "geo": { "station": "A1", "lat": 38.4795, "lon": -86.4381 },
    "profile": { "origin": {...}, "runs": [ { "run": "A", "zOffset": 0.0,
                 "box": { "minX": 0, "minY": 0, "maxX": 0, "maxY": 0 } } ] },
    "wallRuns": [ { "layer": "WALLS-INFERRED", "index": 0,
                    "stations": ["A3", "A4", "A5"] } ],
    "linework": [ { "key": "polyline:1234.5678:987.6543",
                    "trip": 1, "stations": ["A3", "A4", "A5"] } ],
    "callouts": [ { "id": "9f2c...", "kind": "elevation", "role": "text",
                    "style": "...", "side": "L" } ],
    "scans":    [ { "file": "trip1-p1.jpg", "alignedStations": [ ... ] } ],
    "excludedShots": [ ... ], "unplacedShots": [ ... ] } }
```

Three notes on the keys:

- **`stations`** duplicates what `survey` + `adjustment` can recompute.
  Deliberate: it is the cheap insurance. If a future change to
  `CsAdjust` shifts a solve by a hair, the file still says where the
  cave was actually drawn, and the discrepancy is visible instead of
  silent.
- **`linework`** is the one place a geometry key is unavoidable, because
  a hand-traced wall has no name. It uses `CsStore.geoKey`'s existing
  form — entity type plus position to four decimals, midpoint for lines,
  bounding-box centre otherwise — because that scheme is already proven
  in this codebase against a real DXF round trip. It is a *hint*: on
  read, a key that matches nothing is reported, never guessed at. The
  drawing's own `LineworkTrip`/`LineworkStations` tags remain the
  primary record; this is the copy that survives a foreign save.
- **`callouts`** need no such trick — `CalloutId` is already a `CsUuid`,
  stable by construction.

`scans.alignedStations` and `excludedShots`/`unplacedShots` are written
**in full**. In the drawing they live under the 1024-character dxflib
line limit — `AlignedStations` is capped at 800 characters and drops the
rest. Here there is no cap, which makes this file the complete record of
those three specifically.

### `extra`

Anything a future version writes that this version does not know. **A
reader must preserve unknown keys through a read-modify-write** rather
than dropping them, so an older CaveCAD opening a newer cave's file and
saving it does not quietly strip what it did not understand. This is the
one rule that keeps a versioned format from eating its own data during a
staged rollout.

## When it is written

Three ways, in order of how much they need deciding:

1. **`Write Companion File`** — an explicit tool, `cavecompanion`. Never
   surprising. This is the minimum.
2. **Package Cave Project** stages one into the zip, sanitized or full
   with everything else. Free once (1) exists.
3. **On save**, beside the drawing, via the same mechanism
   `CsCave.installSaveHook` already uses. This is the one that makes the
   file trustworthy — a companion written by hand is a companion that is
   three weeks stale when it matters — and also the one with a real cost:
   every save writes a second file, and a save that fails halfway leaves
   a mismatched pair. `pairing` exists to make that detectable.
   **Nathan's call**; the format does not depend on it.

## Tests

- **`tests/js_unit.js`** — pure: model → JSON → model is field-for-field
  identical, including `leftAll` and every flag; writing twice is
  byte-identical; unknown keys survive a read-modify-write; a sanitized
  file omits `fixed` and `geo` and says which in `privacy.omitted`; a
  file declaring a higher `format.version` is refused rather than
  half-read.
- **`tests/companion_roundtrip.js`** — engine: draw PITFALL CAVE, write
  the DXF *and* the companion, reopen both, and assert the reconstructed
  survey matches the original — the comparison
  `tools/format_fidelity.js` already performs, pointed at this pair.
  Then strip the DXF's XDATA and assert the companion alone still
  rebuilds the survey and the drawn frame.
- **`tools/format_fidelity.js`** gains a sixth column. It should report
  zero differences in every row. That is the acceptance criterion for
  the whole format, and the reason to build it on top of a harness that
  already knows how to find losses.

## Open questions

1. **Extension.** `.cave` reads well beside `.dxf` and is unclaimed as
   far as I know. Alternatives: `.cavecad`, or `.cave.json` (uglier, but
   every editor and every Drive preview knows what to do with it).
2. **Write on save, or only on demand?** See above — my recommendation
   is on save, because the value of this file is proportional to how
   current it is, but it is a real behaviour change to every save.
3. **Revision history.** A sidecar has no tag-length ceiling, so the
   history retired with `RevisionLog` on 2026-08-27 could live here at
   full length: what each revision moved, when, and under which trip.
   That was retired for a storage reason that no longer applies, but it
   was still your decision to retire it, so it is not in the shape above
   — say the word and it becomes a `revisions` array.
4. **Does `drawing.linework` earn its geometry key?** It is the only
   fuzzy thing in an otherwise exact file. Dropping it costs the
   linework-to-trip binding *only* in the case where the DXF's own tags
   were destroyed by a foreign save — which is the case this file exists
   for, so I have kept it. Worth a second opinion.
