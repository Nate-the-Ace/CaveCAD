// symbol_palette_run.js -- the Symbol Palette against real documents
// and a real template file.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/symbol_palette_run.js "$PWD"
//
// Four claims, none of which a pure unit test can make:
//
//   1. A custom symbol SURVIVES A FILE. saveBlock writes it into a
//      template on disk, and list() reads its name, category and home
//      layer back out of the marker point inside the block -- through a
//      real DXF export and import, which is where XDATA is lost if the
//      wrong exporter is picked.
//   2. A drawing that has never seen the template can still place a
//      symbol: ensureBlock copies the block definition across, layers
//      and all.
//   3. WHERE the symbol is dropped decides the view. The same routing
//      Feature Trace and Scatter Breakdown use, asserted here on a
//      block reference rather than on linework: plan ground gives the
//      plan layer, a profile band's box gives that band's run layer, a
//      section bay gives the section layer AND the station stamp.
//   4. The shipped 28 are not editable. saveBlock and deleteBlock both
//      refuse a catalogue name, because the next release would take the
//      change back and the legend would describe geometry that is gone.

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) {
            return true;
        }
        try {
            if (typeof v.isNull === "function") {
                return v.isNull();
            }
        } catch (e) {
        }
        return false;
    };
}
if (typeof createSpatialIndex === "undefined") {
    createSpatialIndex = function() {
        return new RSpatialIndexNavel();
    };
}

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

// The real include(), for the reason tests/generate_profile_run.js
// states at length: this file loads TOOL files, whose own first lines
// are include() calls that have to run for real.
include("scripts/EAction.js");
include("scripts/simple.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/SymbolPalette";
include(includeBasePath + "/SymbolPaletteRun.js");

var failures = [];
function ok(condition, what) {
    if (!condition) {
        failures.push(what);
    }
}
function eqs(a, b, what) {
    ok(a === b, what + " (expected " + JSON.stringify(b) +
        ", got " + JSON.stringify(a) + ")");
}

function shotOf(from, to, d, az, inc, u, dn) {
    var s = CsModel.newShot();
    s.from = from; s.to = to; s.distance = d; s.azimuth = az;
    s.inclination = inc || 0;
    s.up = (u === undefined) ? null : u;
    s.down = (dn === undefined) ? null : dn;
    return s;
}

// The tool talks to the user; headlessly nobody is listening, and
// EAction.handleUserMessage needs a main window. Captured instead, so a
// message that ENDS a placement early is visible in the failure list
// rather than looking like a silent pass.
var messages = [];
warning = function(text) { messages.push("WARNING: " + text); };
EAction.handleUserMessage = function(text) { messages.push(String(text)); };

// ---------------------------------------------------------------------
// A template of our own, on disk.
//
// Not the shipped one: this test WRITES symbols, and a test that edits
// the repository's template would leave the repository different than
// it found it. The store finds a template through templatePath(), so
// pointing that at a scratch file is the whole substitution.
// ---------------------------------------------------------------------

var scratchDir = QDir.tempPath() + "/cs_symbol_palette_test";
new QDir().mkpath(scratchDir);
var templatePath = scratchDir + "/NSS_Cave_Template_PLAN.dxf";
if (new QFileInfo(templatePath).exists()) {
    new QFile(templatePath).remove();
}

(function buildTemplate() {
    var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var di = new RDocumentInterface(doc);
    // One shipped symbol, so the import path has something catalogued
    // to fetch, and so the catalogue's own row is what describes it.
    CsLayers.ensure(doc, di, CsLayers.FORMATIONS_DRIP);
    var op = new RAddObjectsOperation();
    op.addObject(new RBlock(doc, "SYM_STALACTITE", new RVector(0, 0)), false);
    di.applyOperation(op);
    var block = doc.queryBlock("SYM_STALACTITE");
    var shapeOp = new RAddObjectsOperation();
    var seg = new RLineEntity(doc, new RLineData(
        new RVector(-0.25, 0.5), new RVector(0, -0.5)));
    seg.setBlockId(block.getId());
    seg.setLayerId(doc.getLayerId(CsLayers.FORMATIONS_DRIP));
    shapeOp.addObject(seg, false);
    var seg2 = new RLineEntity(doc, new RLineData(
        new RVector(0, -0.5), new RVector(0.25, 0.5)));
    seg2.setBlockId(block.getId());
    seg2.setLayerId(doc.getLayerId(CsLayers.FORMATIONS_DRIP));
    shapeOp.addObject(seg2, false);
    di.applyOperation(shapeOp);
    ok(di.exportFile(templatePath, CsSymbolStore.dxfFilter()) === true,
        "the scratch template was written to " + templatePath);
})();

// Every store call resolves the template through this one function, so
// overriding it points the whole test at the scratch file.
CsSymbolStore.templatePath = function() {
    return templatePath;
};

// ---------------------------------------------------------------------
// 1. A custom symbol survives a file.
// ---------------------------------------------------------------------

(function saveAndReadBack() {
    var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var di = new RDocumentInterface(doc);
    var e1 = new RLineEntity(doc, new RLineData(
        new RVector(-0.4, -0.4), new RVector(0.4, 0.4)));
    var e2 = new RArcEntity(doc, new RArcData(
        new RVector(0, 0), 0.4, 0.0, Math.PI, false));

    var meta = { nss: "Gypsum flower", uis: "Gypsum",
        category: "Formations", layer: CsLayers.FORMATIONS_DRIP };
    var blockName = CsSymbolStore.blockNameFor(meta.nss);
    eqs(blockName, "SYM_GYPSUM_FLOWER", "the block name derived from " +
        "the display name");

    var res = CsSymbolStore.saveBlock(templatePath, blockName, doc,
        [e1, e2], meta);
    ok(res.ok, "the custom symbol was saved (" + res.error + ")");
    eqs(res.replaced, false, "a new symbol reports itself as new");

    // Read back through a FRESH import of the file -- the point of the
    // test. A wrong exporter loses the XDATA and the symbol comes back
    // anonymous, which would show up here and nowhere else.
    CsSymbolStore.invalidate();
    var listed = CsSymbolStore.list(templatePath);
    ok(listed.ok, "the template lists (" + listed.error + ")");

    var found = null, shipped = null;
    for (var i = 0; i < listed.entries.length; i++) {
        if (listed.entries[i].block === blockName) {
            found = listed.entries[i];
        }
        if (listed.entries[i].block === "SYM_STALACTITE") {
            shipped = listed.entries[i];
        }
    }
    ok(found !== null, "the custom symbol is in the listing");
    if (found !== null) {
        eqs(found.nss, "Gypsum flower", "its name survived the file");
        eqs(found.uis, "Gypsum", "its UIS alias survived the file");
        eqs(found.category, "Formations", "its category survived the file");
        eqs(found.layer, CsLayers.FORMATIONS_DRIP,
            "its home layer survived the file");
        eqs(found.custom, true, "it comes back marked custom, which is " +
            "what gates Edit and Delete in the panel");
    }
    ok(shipped !== null, "the shipped symbol is in the listing too");
    if (shipped !== null) {
        eqs(shipped.nss, "Stalactite",
            "a shipped block is described by the CATALOGUE, not by the file");
        eqs(shipped.custom, undefined,
            "and carries no custom flag, so it cannot be edited or deleted");
    }

    // Replacing it: the same name, different geometry. This is what
    // Edit does, and the caver's already-placed instances depend on the
    // block name staying put.
    var doc2 = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var e3 = new RLineEntity(doc2, new RLineData(
        new RVector(-0.2, 0), new RVector(0.2, 0)));
    var again = CsSymbolStore.saveBlock(templatePath, blockName, doc2,
        [e3], { nss: "Gypsum flower", uis: "", category: "Formations",
            layer: CsLayers.FORMATIONS_DRIP });
    ok(again.ok, "the symbol was saved again (" + again.error + ")");
    eqs(again.replaced, true, "the second save reports a replacement");

    CsSymbolStore.invalidate();
    var reDi = CsSymbolStore.openOffscreen(templatePath);
    ok(reDi !== null, "the template reopens after the replacement");
    if (reDi !== null) {
        var geom = CsSymbolStore.geometryOf(reDi.getDocument(), blockName);
        eqs(geom.length, 1, "the replacement REPLACED the geometry rather " +
            "than adding to it -- an editing tool that only ever appended " +
            "would double a symbol every time it was saved");
    }
})();

// ---------------------------------------------------------------------
// 2. A drawing that never saw the template can still place a symbol.
// ---------------------------------------------------------------------

(function importOnDemand() {
    var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var di = new RDocumentInterface(doc);
    ok(isNull(doc.queryBlock("SYM_STALACTITE")),
        "the bare drawing starts without the symbol block");

    var res = CsSymbolStore.ensureBlock(doc, di, "SYM_STALACTITE",
        templatePath);
    ok(res.ok, "the block was fetched from the template (" + res.error + ")");
    eqs(res.imported, true, "and reports that it had to fetch it");
    ok(!isNull(doc.queryBlock("SYM_STALACTITE")),
        "the drawing now has the block");

    var geom = CsSymbolStore.geometryOf(doc, "SYM_STALACTITE");
    eqs(geom.length, 2, "with both of its lines");
    ok(doc.hasLayer(CsLayers.FORMATIONS_DRIP),
        "and the layer its geometry sits on was created, rather than the " +
        "geometry landing on whatever layer id happened to be free");

    var second = CsSymbolStore.ensureBlock(doc, di, "SYM_STALACTITE",
        templatePath);
    ok(second.ok, "asking again is fine");
    eqs(second.imported, false, "and does not fetch a second copy");
})();

// ---------------------------------------------------------------------
// 3. Where you click decides the view.
// ---------------------------------------------------------------------

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
getDocument = function() { return doc; };
getDocumentInterface = function() { return di; };

(function buildFixture() {
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0, 4, 2),
        shotOf("A2", "A3", 10, 0, -10, 4, 2)
    ];
    var resolved = CsNetwork.resolve(sv, {});
    var profile = CsProfile.build(sv, resolved, {});
    var drawn = CsProfileDraw.render(doc, di, profile, {});
    ok(drawn.bandsDrawn >= 1, "the fixture profile drew at least one band");
})();

var boxes = CsProfileBox.boxes(doc);
ok(boxes.length >= 1, "the profile left at least one band box behind");

var entry = CsSymbols.byBlock("SYM_STALACTITE");
ok(entry !== null, "the catalogue knows the symbol this test places");

/** An action with just enough of itself to commit a placement: the
 *  document, the cached region and bays, and where the click landed.
 *  Driving the real commit() rather than reimplementing it is the point
 *  -- the routing, the import, the layer and the stamp are all in
 *  there. */
function placeAt(x, y) {
    var action = new SymbolPaletteRun(null);
    action.getDocument = function() { return doc; };
    action.getDocumentInterface = function() { return di; };
    action.anchor = { x: x, y: y };
    action.angle = 0.0;
    action.radius = CsSymbolStore.radiusOf(doc, entry.block);
    action.unitsPerFoot = SymbolPaletteRun.perFoot(doc);
    action.refreshRegion();
    action.commit();
    return action;
}

// The panel is not loaded here (it builds widgets), so the armed entry
// and the size/angle come from these stubs -- the same three functions
// the panel would answer.
SymbolPaletteRun.armedEntry = function() { return entry; };
SymbolPaletteRun.sizeFeet = function() { return 1.0; };
SymbolPaletteRun.defaultAngle = function() { return 0.0; };

/** Every block reference on a given layer. */
function refsOn(layerName) {
    var out = [];
    var ids = doc.queryAllEntities(false, false, RS.EntityBlockRef);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) { continue; }
        if (String(doc.getLayerName(e.getLayerId())) === layerName) {
            out.push(e);
        }
    }
    return out;
}

// -- the plan ---------------------------------------------------------
var region = CsTrace.profileRegion(doc);
var planX = isNull(region) ? 500 : (region.maxX + 500);
var planY = isNull(region) ? 500 : (region.maxY + 500);
placeAt(planX, planY);
eqs(refsOn(CsLayers.FORMATIONS_DRIP).length, 1,
    "a symbol dropped out in the plan landed on the plan layer (messages: " +
    messages.join(" | ") + ")");

// -- an elevation band ------------------------------------------------
var box = boxes[0];
var profileX = (box.minX + box.maxX) / 2;
var profileY = (box.minY + box.maxY) / 2;
placeAt(profileX, profileY);
eqs(refsOn(CsLayers.FORMATIONS_DRIP).length, 1,
    "nothing from the elevation leaked onto the plan layer");
var profileBase = CsLayers.twinFor(CsLayers.FORMATIONS_DRIP, "profile");
var run = CsProfileBox.at(boxes, { x: profileX, y: profileY });
var wantProfileLayer = profileBase;
if (run !== null) {
    var variant = CsLayerVariants.nameFor(profileBase, run);
    if (variant !== null) {
        wantProfileLayer = variant;
    }
}
eqs(refsOn(wantProfileLayer).length, 1,
    "a symbol dropped inside a band's box landed on " + wantProfileLayer +
    " -- the band's own run layer, so a revision moves it with the band " +
    "(messages: " + messages.join(" | ") + ")");

// -- a section bay ----------------------------------------------------
//
// A bay is a frame entity tagged the way CsTrace.sectionBays reads
// them. Built by hand rather than by opening a real bay: this test is
// about where a symbol LANDS, and the bay tool has its own suite.
var bayX = planX + 200, bayY = planY + 200;
(function addBay() {
    CsLayers.ensure(doc, di, CsLayers.CTRL_SECTION_OUTLINE);
    var pl = new RPolylineEntity(doc, new RPolylineData());
    pl.appendVertex(new RVector(bayX - 10, bayY - 10));
    pl.appendVertex(new RVector(bayX + 10, bayY - 10));
    pl.appendVertex(new RVector(bayX + 10, bayY + 10));
    pl.appendVertex(new RVector(bayX - 10, bayY + 10));
    pl.setClosed(true);
    pl.setLayerId(doc.getLayerId(CsLayers.CTRL_SECTION_OUTLINE));
    CsTags.set(pl, "SectionBay", "bay-1");
    CsTags.set(pl, "SectionBayRole", "frame");
    CsTags.set(pl, "SectionBayStation", "A2");
    var op = new RAddObjectsOperation();
    op.addObject(pl, false);
    di.applyOperation(op);
})();

var bays = CsTrace.sectionBays(doc);
eqs(bays.length, 1, "the fixture bay is readable as a bay");

placeAt(bayX, bayY);
var sectionLayer = CsLayers.twinFor(CsLayers.FORMATIONS_DRIP, "section");
var placedInBay = refsOn(sectionLayer);
eqs(placedInBay.length, 1,
    "a symbol dropped inside a section bay landed on " + sectionLayer +
    " (messages: " + messages.join(" | ") + ")");
if (placedInBay.length === 1) {
    eqs(CsTags.get(placedInBay[0], "SectionTraceStation"), "A2",
        "and carries the station its bay is a section OF -- the bay is " +
        "torn down by Capture, so a symbol that did not record this now " +
        "could never learn it later");
    eqs(CsTags.get(placedInBay[0], "SectionTraceBay"), "bay-1",
        "and which bay it was drawn in");
}

// A plain click places at the SIZE the panel asks for, not at scale 1.
(function clickTakesTheSizeField() {
    SymbolPaletteRun.sizeFeet = function() { return 5.0; };
    var x = planX + 120, y = planY + 120;
    placeAt(x, y);
    var placed = null;
    var ids = doc.queryAllEntities(false, false, RS.EntityBlockRef);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) { continue; }
        var p = e.getPosition();
        if (Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6) { placed = e; }
    }
    ok(placed !== null, "the click placed a symbol (messages: " +
        messages.join(" | ") + ")");
    if (placed !== null) {
        // the fixture stalactite is 1.0 units tall, so radius 0.5:
        // 5 ft across in a foot drawing is scale 5.
        var sx = placed.getScaleFactors().x;
        ok(Math.abs(sx - 5.0) < 1e-9,
            "and at the size the panel asked for, not at scale 1 -- a " +
            "1 ft symbol in a 1000 ft cave is the bug this field exists " +
            "for (expected scale 5, got " + sx + ")");
    }
    SymbolPaletteRun.sizeFeet = function() { return 1.0; };
})();

// -- a symbol with no twin in that view -------------------------------
//
// The north arrow orients a plan; an elevation has no north, so
// CsLayers.NO_TWIN gives it no profile layer. The tool must say so
// rather than putting it somewhere.
(function northArrowInTheElevation() {
    var arrow = CsSymbols.byBlock("SYM_NORTH_ARROW");
    ok(arrow !== null, "the catalogue knows the north arrow");
    eqs(SymbolPaletteRun.targetLayer(doc, arrow, "profile",
        { x: profileX, y: profileY }), null,
        "the north arrow has no elevation layer, and the router answers " +
        "null rather than inventing one");
    eqs(SymbolPaletteRun.targetLayer(doc, arrow, "plan",
        { x: planX, y: planY }), CsLayers.NORTH_ARROW,
        "while in the plan it lands on its own layer");
})();

// ---------------------------------------------------------------------
// 3b. The drag sets the size as well as the angle.
// ---------------------------------------------------------------------

// The mapping itself: the distance dragged IS the placed symbol's
// radius, so one gesture means the same thing on a symbol half a unit
// across and one ten units across.
eqs(SymbolPaletteRun.scaleForDrag(2.0, 0.5, 1.0, true), 4.0,
    "scaleForDrag: dragging to twice a 0.5-unit symbol's radius asks " +
    "for scale 4");
eqs(SymbolPaletteRun.scaleForDrag(5.0, 5.0, 1.0, true), 1.0,
    "scaleForDrag: dragging to exactly the symbol's own radius is " +
    "scale 1, whatever that radius is");
eqs(SymbolPaletteRun.scaleForDrag(2.0, 0.5, 3.0, false), 3.0,
    "scaleForDrag: with sizing switched off the panel's scale stands");
eqs(SymbolPaletteRun.scaleForDrag(2.0, 0, 3.0, true), 3.0,
    "scaleForDrag: a symbol whose radius is unknown falls back to the " +
    "panel rather than dividing by zero");
eqs(SymbolPaletteRun.scaleForDrag(0, 0.5, 2.5, true), 2.5,
    "scaleForDrag: a drag of no length is a click, and takes the panel");
eqs(SymbolPaletteRun.scaleForDrag(0.0001, 5.0, 1.0, true),
    SymbolPaletteRun.MIN_SCALE,
    "scaleForDrag: a hair of a drag is floored, not placed invisible");
eqs(SymbolPaletteRun.scaleForDrag(1e9, 0.5, 1.0, true),
    SymbolPaletteRun.MAX_SCALE,
    "scaleForDrag: and a drag across the county is capped");

// The panel asks for FEET, and every symbol has to come out that size
// whatever the block was drawn at -- the whole reason the field is not a
// scale factor. A 1 ft stalactite asked to be 5 ft is scale 5; a 3.3 ft
// north arrow asked for the same 5 ft is scale 1.5.
eqs(SymbolPaletteRun.scaleForSize(5.0, 0.5, 1.0), 5.0,
    "scaleForSize: a 1 ft symbol asked for 5 ft is scale 5");
ok(Math.abs(SymbolPaletteRun.scaleForSize(5.0, 1.65, 1.0) - 1.51515) < 1e-4,
    "scaleForSize: a 3.3 ft symbol asked for the same 5 ft is scale 1.5 " +
    "-- one number in the field, one size on the sheet");
ok(Math.abs(SymbolPaletteRun.scaleForSize(5.0, 0.5, 0.3048) - 1.524) < 1e-6,
    "scaleForSize: a metric drawing gets the same 5 FEET, converted");
eqs(SymbolPaletteRun.scaleForSize(5.0, 0, 1.0), 1.0,
    "scaleForSize: an unknown radius falls back to scale 1 rather than " +
    "dividing by zero");
eqs(SymbolPaletteRun.scaleForSize(0, 0.5, 1.0), 1.0,
    "scaleForSize: so does a size of nothing");
ok(Math.abs(SymbolPaletteRun.sizeForScale(5.0, 0.5, 1.0) - 5.0) < 1e-9,
    "sizeForScale: and back again, which is what the drag writes into " +
    "the panel");
eqs(SymbolPaletteRun.sizeForScale(5.0, 0, 1.0), null,
    "sizeForScale: with no radius there is no answer, and the panel is " +
    "left alone rather than filled with a wrong number");

// The radius the mapping divides by, read off a real block.
(function radiusFromTheBlock() {
    var probe = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var pdi = new RDocumentInterface(probe);
    var got = CsSymbolStore.ensureBlock(probe, pdi, "SYM_STALACTITE",
        templatePath);
    ok(got.ok, "the radius fixture got its block (" + got.error + ")");
    // The scratch template's stalactite spans 0.5 wide by 1.0 tall.
    var r = CsSymbolStore.radiusOf(probe, "SYM_STALACTITE");
    ok(Math.abs(r - 0.5) < 1e-9,
        "radiusOf: half the LARGER side of the symbol's own box " +
        "(expected 0.5, got " + r + ")");
    eqs(CsSymbolStore.radiusOf(probe, "SYM_NOT_THERE_AT_ALL"), 0,
        "radiusOf: a block nobody has answers 0, which callers read as " +
        "'no answer' rather than dividing by it");
})();

// And the placement really uses it. Same commit path as every other
// placement in this file, with a drag on it.
(function placedAtTheDraggedSize() {
    var action = new SymbolPaletteRun(null);
    action.getDocument = function() { return doc; };
    action.getDocumentInterface = function() { return di; };
    var x = planX + 60, y = planY + 60;
    action.anchor = { x: x, y: y };
    action.refreshRegion();
    action.radius = CsSymbolStore.radiusOf(doc, entry.block);
    action.unitsPerFoot = SymbolPaletteRun.perFoot(doc);
    ok(action.radius > 0, "the placement knows the symbol's own radius");
    // a drag of 2.0 units on a 0.5-unit radius: scale 4
    action.angle = 0.0;
    action.dragScale = SymbolPaletteRun.scaleForDrag(2.0, action.radius,
        1.0, true);
    eqs(action.placementScale(), 4.0,
        "the placement takes the drag's scale over the panel's");
    action.commit();

    var placed = null;
    var ids = doc.queryAllEntities(false, false, RS.EntityBlockRef);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) { continue; }
        var p = e.getPosition();
        if (Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6) {
            placed = e;
        }
    }
    ok(placed !== null, "the dragged-out symbol landed where it was " +
        "pressed (messages: " + messages.join(" | ") + ")");
    if (placed !== null) {
        var sx = placed.getScaleFactors().x;
        ok(Math.abs(sx - 4.0) < 1e-9,
            "and carries the dragged scale, not the panel's (expected 4, " +
            "got " + sx + ")");
    }

    // Sizing switched off: the drag still aims, the panel still sizes.
    var aimOnly = new SymbolPaletteRun(null);
    aimOnly.radius = 0.5;
    aimOnly.dragScale = SymbolPaletteRun.scaleForDrag(2.0, 0.5, 1.0, false);
    eqs(aimOnly.placementScale(), 1.0,
        "with sizing off, a long drag places at the panel's scale");
})();

// ---------------------------------------------------------------------
// 4. The shipped symbols are not editable.
// ---------------------------------------------------------------------

(function shippedAreProtected() {
    var scratch = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var line = new RLineEntity(scratch, new RLineData(
        new RVector(0, 0), new RVector(1, 1)));
    var res = CsSymbolStore.saveBlock(templatePath, "SYM_STALACTITE",
        scratch, [line], { nss: "My stalactite", uis: "",
            category: "Formations", layer: CsLayers.FORMATIONS_DRIP });
    eqs(res.ok, false, "saving over a shipped symbol is refused");
    ok(String(res.error).indexOf("ships") !== -1,
        "and the refusal says why, in words a caver can act on");

    var del = CsSymbolStore.deleteBlock(templatePath, "SYM_STALACTITE");
    eqs(del.ok, false, "deleting a shipped symbol is refused too");

    // The template is untouched by either refusal.
    CsSymbolStore.invalidate();
    var reDi = CsSymbolStore.openOffscreen(templatePath);
    ok(reDi !== null, "the template still opens");
    if (reDi !== null) {
        eqs(CsSymbolStore.geometryOf(reDi.getDocument(),
            "SYM_STALACTITE").length, 2,
            "and the shipped symbol still has its own two lines");
    }
})();

// A custom symbol, on the other hand, deletes.
(function customDeletes() {
    var del = CsSymbolStore.deleteBlock(templatePath, "SYM_GYPSUM_FLOWER");
    ok(del.ok, "a custom symbol deletes (" + del.error + ")");
    CsSymbolStore.invalidate();
    var listed = CsSymbolStore.list(templatePath);
    var still = false;
    for (var i = 0; i < listed.entries.length; i++) {
        if (listed.entries[i].block === "SYM_GYPSUM_FLOWER") {
            still = true;
        }
    }
    eqs(still, false, "and is gone from the listing afterwards");
})();

// A symbol with no geometry is refused rather than saved empty: an
// empty block has a NaN bounding box, and every reference to it is
// silently dropped on its way into the spatial index.
(function emptyIsRefused() {
    var scratch = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var res = CsSymbolStore.saveBlock(templatePath, "SYM_NOTHING_AT_ALL",
        scratch, [], { nss: "Nothing", uis: "", category: "Custom",
            layer: CsLayers.BREAKDOWN });
    eqs(res.ok, false, "an empty symbol is refused");
})();

// ---------------------------------------------------------------------
// Tidy up and report.
// ---------------------------------------------------------------------

try {
    new QFile(templatePath).remove();
    new QDir().rmdir(scratchDir);
} catch (eTidy) {
}

if (failures.length === 0) {
    print("### SYMBOL PALETTE OK");
} else {
    print("### SYMBOL PALETTE FAIL " + failures.length);
    for (var fi = 0; fi < failures.length; fi++) {
        print("  FAIL: " + failures[fi]);
    }
}
