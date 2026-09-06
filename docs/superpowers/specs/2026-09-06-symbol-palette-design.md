# Symbol Palette — design

Date: 2026-09-06
Status: approved design, not yet planned

## What this is

A docked palette of the cave feature blocks, grouped by category, that
places a symbol where you click; plus a symbol editor that lets a caver
draw a new symbol, give it a category and a home layer, and have it
join the palette permanently.

Today the suite already knows its symbols — `Core/CsSymbols.js` carries
28 `SYM_*` entries with an NSS name, a UIS alias, a home layer and a
category, and `CsSymbols.insert()` places one. But only ScatterBreakdown
and BuildLegend ever call it, and neither lets a caver pick a symbol. A
map's whole feature vocabulary is reachable only by scattering breakdown
or by printing a legend. This tool is the missing front door.

## Decisions taken (Nathan, 2026-09-06)

1. **Custom symbols are written into the template DXF.** Not a per-user
   library, not a per-cave folder. `NSS_Cave_Template_PLAN.dxf` in the
   Cave templates folder gains the new block, so every drawing started
   from the template afterwards carries it.
2. **An upgrade may lose them, and that is accepted.** `publish.sh`
   copies `templates/` into the Cave folder on every release, so a
   release overwrites a customised template. Nathan chose to accept the
   loss rather than build merge logic. (A one-line mitigation exists —
   have publish.sh move an existing template aside to
   `NSS_Cave_Template_PLAN.dxf.bak` before copying — and is worth taking
   if it stays that cheap, but it is not part of this design's contract.)
3. **Blocks import on demand.** A drawing that lacks the block gets the
   block definition copied in at placement time, so any drawing however
   old can use any palette symbol.
4. **The palette is a modeless dock panel with an icon grid**, in the
   shape SurveyNotebook / FeatureTrace / SketchScans already use.
5. **Previews are rendered from the block geometry**, not hand-drawn
   SVGs, so a custom symbol gets a preview for free and no preview can
   drift from the block it names.
6. **Placement: click to drop, click-and-drag to aim.** A press-release
   in place drops the symbol at the panel's current angle; press, drag
   and release rubber-bands the rotation and the release angle wins.
   Placement repeats until Escape.
7. **The symbol editor is a real drawing tab, and it can also edit an
   existing custom symbol.**
8. **A custom symbol's home layer is chosen from the existing registry**
   (`CsLayers.DEFAULTS`), never typed free-hand, so restyle, the profile
   and section twins and the layer palette keep working on it.
9. **Placement routes by location**, exactly as Feature Trace does since
   0.9.48.0: a symbol dropped inside a profile band or a section bay
   lands on that view's layer twin, and a section symbol carries the
   station its bay is a section of.

## Architecture (approach A)

One add-on tool folder, one new Core library. The panel never opens a
file; the store never builds a widget.

```
scripts/CaveSurvey/SymbolPalette/
    SymbolPalette.js        menu entry, dock panel, category groups,
                            icon grid, editor-mode fields
    SymbolPaletteRun.js     the placement action (press / drag / release)
    SymbolPaletteEdit.js    the symbol editor tab and its Save Symbol
    SymbolPalette.svg, SymbolPalette-inverse.svg
scripts/CaveSurvey/Core/
    CsSymbolStore.js        NEW — everything that touches the template
                            DXF and block definitions
    CsSymbols.js            EXTENDED — merged built-in + custom catalog
```

`Core/CsAll.js` gains the new file. (Engine trap: the test harness loads
Core by a hand-written list — a file missing from it passes silently
through the deliberate catches. `CsSymbolStore.js` must be added to that
list as well as to `CsAll.js`.)

Add-on wiring follows the fixed shape: QCAD's `AddOn.getAddOns` only
builds an add-on from `<dir>/<dir>.js`, so `SymbolPalette.js` must
`include()` its two siblings itself, and the dock must be BUILT during
`init()` and left hidden — the main window's `restoreState()` runs after
add-on init and can only place a dock that already exists. Every widget
construction and connect is wrapped so a bridge refusal costs one
control rather than the whole panel.

## Component: CsSymbolStore

The only code that opens a DXF or manipulates a block definition.
Everything is a pure function of a document plus a path; no widgets, no
module state beyond a cached template path.

- `templatePath()` — the same two-place lookup CaveTemplateApply uses:
  beside the add-on first, then `~/Documents/Cave/templates/`. Returns
  null with a plain-language reason when neither exists.
- `list(path)` — opens the template in an offscreen
  `RDocumentInterface` (the PackageCave / CaveTemplateApply pattern),
  returns every `SYM_*` block with the metadata read off its marker
  point (below). Cached per session; the editor invalidates it on save.
- `importBlock(doc, di, blockName)` — copies one block definition from
  the template into the open drawing when it is missing. Returns the
  block id, or null with a reason.
- `saveBlock(path, blockName, entities, meta)` — writes or replaces a
  block definition in the template, marker point included, and saves.
  Replacing an existing block is how symbol editing works.
- `geometryOf(path, blockName)` — the entities of a block, for the
  editor to load and for the preview renderer.

### Custom symbol metadata

This build cannot be relied on to persist custom properties on an
`RBlock`, so a custom symbol describes itself from inside: each custom
`SYM_*` block definition contains one invisible marker point on
`CTRL-HIDDEN` carrying XDATA via `CsTags`:

    SymbolNss       display name
    SymbolUis       UIS alias, may be empty
    SymbolCategory  palette group
    SymbolLayer     home layer, a registry name
    SymbolCustom    "1"

The block is therefore self-describing, and import-on-demand into an old
drawing carries the category and home layer along with the geometry.
There is no sidecar file to lose, and nothing to keep in sync.

The 28 built-ins keep their metadata in `CsSymbols.CATALOG` as today —
they are code, they ship with the tools, and they need no marker.
`CsSymbols.merged(doc)` returns the built-in catalog plus every custom
entry the store found, built-ins winning on a name collision.

## Component: the palette panel

A `QDockWidget` on the right, hidden at init, toggled from the Cave
Survey menu.

- One collapsible group per category, in `CsSymbols.categories()` order,
  with custom symbols appearing in whichever category they were given —
  a new category name creates a new group.
- Each entry is a toggle button showing a rendered preview and, on
  hover, its NSS name and UIS alias. Exactly one button is armed at a
  time; the armed button IS the indicator, as in Feature Trace.
- Scale and angle spinboxes. Angle is the default the drag overrides.
- A search box filtering across NSS name, UIS alias and block name.
- Buttons: **New Symbol…**, and **Edit** / **Delete** enabled only when
  the armed symbol is custom.

### Previews

Rendered once per symbol at panel build from `CsSymbolStore.geometryOf`:
walk the block's entities, take their bounding box, scale to fit a
square icon with a small margin, paint each line/arc/polyline/hatch into
a `QPixmap` in the palette's foreground colour. A block whose geometry
cannot be read gets a placeholder icon with its name, not a missing
button.

## Component: the placement action

`SymbolPaletteRun` is an `EAction` in the ShapedLinesRun / FeatureTraceRun
shape, using `mousePressEvent` / `mouseMoveEvent` / `mouseReleaseEvent`.

- **Press** records the anchor point (snapped) and starts a preview.
- **Move while pressed** rubber-bands the symbol at the anchor, rotated
  to face the cursor, once the cursor is more than a few pixels from the
  anchor. Under that threshold the panel's angle stands, so a plain
  click is a plain click.
- **Release** commits one block reference at the anchor, at the panel's
  scale, at the drag angle if there was a drag and the panel angle if
  not. The action stays armed for the next placement; Escape ends it.

Layer routing reuses the existing machinery rather than restating it:

    frame = CsProfileBox.frameAt(doc, region, point, bays)
    layer = CsLayers.twinFor(entry.layer, frame)
    layer = CsLayerVariants.nameFor(layer, run)  // profile bands only

with the profile run read from the band box under the point. A symbol
dropped in a section bay is stamped with `SectionTraceStation` and the
bay tag the same way a section trace is, so a captured section keeps the
provenance of its symbols.

`CsSymbols.insert()` gains an optional layer override so the caller can
hand it the routed layer; without one it behaves exactly as today. When
the block is missing, the action calls `CsSymbolStore.importBlock` and
retries once before reporting.

Refusals are reported in the same voice as Feature Trace's
`refusalReason`: a locked or frozen target layer silently swallows adds
in this build, so the state is read back and named.

## Component: the symbol editor

**New Symbol…** opens a new drawing tab from a small editor template
carrying an origin crosshair, a nominal-size reference circle at the
catalogue's default scale, and nothing else. The palette panel switches
to editor mode: fields for name, UIS alias, category (a combo of
existing categories, editable for a new one) and home layer (a combo
built from `CsLayers.DEFAULTS`, plan-frame names only), plus **Save
Symbol** and **Cancel**.

**Save Symbol** takes every entity in the editor tab except the
crosshair and the reference circle, and hands them to
`CsSymbolStore.saveBlock` with the metadata. Block name is derived from
the display name (upper-cased, non-alphanumerics to underscore, `SYM_`
prefixed) and checked for collision. On success the store cache is
invalidated, the palette rebuilds, the editor tab closes, and the new
symbol is armed.

**Edit** on a custom symbol opens the same editor pre-loaded with
`geometryOf` and the existing metadata; saving replaces the block in the
template. Instances already placed in the OPEN drawing are redefined by
the block replacement; instances in other saved drawings are not, and
the dialog says so before saving rather than after.

**Delete** removes the block from the template after confirming, and
warns that drawings already using it keep their own copies.

Built-in symbols cannot be edited or deleted. Editing one would put a
divergent block in the template under a name the shipped catalogue also
claims, and the next release would silently take it back.

## Errors

Every failure names the thing that failed and what the caver can do:

- template not found — both searched paths listed
- template not writable — path and permission stated, nothing half-saved
- block missing and import failed — symbol named, drawing untouched
- target layer locked or frozen — layer named and which of the two
- editor saved with no geometry — refused, editor stays open
- duplicate symbol name — refused, existing symbol named

## Testing

Headless unit tests (`tests/js_unit.js`) for the pure parts:
`CsSymbols.merged` collision and ordering, block-name derivation,
metadata round trip through marker tags, and the routing decision given
a synthetic frame.

A headless run test in the `scatter_breakdown_run.js` shape: open a
drawing without the symbol blocks, place one through the store's import
path, save, reopen, and assert the block reference is on the right layer
with the right block. Then a second placement inside a synthetic profile
band box asserting the profile twin layer, and one inside a section bay
asserting the station stamp.

Template-side: a test asserting every block named in `CsSymbols.CATALOG`
exists in the shipped template, which would have caught a catalogue
entry with no block behind it.

GUI parts — the dock, the previews, the drag-to-aim, the editor tab —
need a live dry run in CaveCAD; the bridge trap list applies (wrapper-only
widgets, method-vs-property, self-confirming message boxes).

## Out of scope

- Symbol libraries shared between cavers, or exported with a cave
- Symbol scaling that follows sheet scale automatically
- Replacing ScatterBreakdown's own placement path
- Any change to how the built-in 28 are drawn
