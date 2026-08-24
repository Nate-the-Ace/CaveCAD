// callout_write.js -- CalloutWrite against a real document.
//
//   /Applications/CaveCAD.app/Contents/MacOS/CaveCAD \
//       -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/callout_write.js "$PWD"
//
// Prints "### CALLOUT-WRITE OK <n>" or "### CALLOUT-WRITE FAIL".

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

function loadRepoScript(rel) {
    var file = new QFile(repoRoot + "/" + rel);
    if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open " + rel);
    }
    var stream = new QTextStream(file);
    var src = stream.readAll();
    file.close();
    // Indirect eval: a direct eval() here would land every Cs* global in
    // THIS FUNCTION's scope, invisible the moment loadRepoScript()
    // returns -- see tests/profile_draw_roundtrip.js's own loader, which
    // hit exactly this and documents it. Confirmed by hand: the plan's
    // literal `eval(src)` throws "ReferenceError: CsLayers is not
    // defined" the moment the entry script tries to use it.
    (0, eval)(src);
}

// Some builds' -autostart engines don't preload library.js, where
// isNull normally lives -- same reason js_unit.js and
// profile_draw_roundtrip.js both carry this exact shim.
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

var FILES = [
    "scripts/CaveSurvey/Core/CsUnits.js",
    "scripts/CaveSurvey/Core/CsTags.js",
    "scripts/CaveSurvey/Core/CsStore.js",
    "scripts/CaveSurvey/Core/CsLayers.js",
    "scripts/CaveSurvey/Core/CsDraw.js",
    "scripts/CaveSurvey/Core/CsCallout.js",
    "scripts/CaveSurvey/Callout/CalloutWrite.js"
];
for (var fi = 0; fi < FILES.length; fi++) {
    loadRepoScript(FILES[fi]);
}

var passed = 0;
var failures = [];
function ok(c, what) { if (c) { passed++; } else { failures.push(what); } }
function eqs(a, b, what) {
    ok(a === b, what + " (expected " + b + ", got " + a + ")");
}
function near(a, b, tol, what) {
    ok(Math.abs(a - b) <= tol,
        what + " (expected " + b + " +/- " + tol + ", got " + a + ")");
}

var di = new RDocumentInterface(new RDocument(new RMemoryStorage(),
                                              new RSpatialIndexNavel()));
var doc = di.getDocument();
// CsTags.commit falls through to CsStore.migrate(getDocument(), di),
// and getDocument() is simple.js's global (populated by the GUI/tool
// context, not this bare -autostart script) -- same reassignment
// js_unit.js's own document-backed fixtures use.
getDocument = function() { return doc; };
CsLayers.ensureCalloutLayers(doc, di);

// --- an empty drawing has no ids -------------------------------------
eqs(CalloutWrite.existingIds(doc).length, 0,
    "existingIds on an empty drawing");

// --- textHeight: the suite's own label height, NOT the drawing's
// DIMTXT. Measured in a real cave drawing DIMTXT is 0.0833 with
// DIMSCALE 1, which drew a note 0.08 units tall across 200 feet of
// passage -- invisible. A note must come out the size of the station
// labels beside it. ------------------------------------------------
eqs(CalloutWrite.textHeight(doc), CsDraw.TEXT_HEIGHT,
    "textHeight is the same height every other label in the suite uses");
ok(CalloutWrite.textHeight(doc) > 0.2,
    "textHeight is a legible size, not a dimension-annotation size");

// --- suffixFor: follows the drawing's own unit, not a constant -------
doc.setUnit(RS.Meter);
eqs(CalloutWrite.suffixFor(doc), " m",
    "suffixFor: a metric drawing gets \" m\"");
doc.setUnit(RS.Foot);
eqs(CalloutWrite.suffixFor(doc), "'",
    "suffixFor: an imperial drawing gets an apostrophe");

// --- create ----------------------------------------------------------
var id = CalloutWrite.create(doc, di, {
    text: "bad air",
    position: { x: 100, y: 50 },
    tips: [{ x: 60, y: 40 }, { x: 55, y: 70 }],
    style: "hazard",
    kind: CsCallout.KIND_TEXT,
    height: 4.0
});
ok(id !== null && id !== undefined && String(id).length > 0,
    "create returns an id");
eqs(CalloutWrite.existingIds(doc).length, 1,
    "the drawing now reports exactly one callout id");

var m = CalloutWrite.members(doc, id);
ok(m.text !== null, "members finds the text");
eqs(m.leaders.length, 2, "members finds one leader per tip");
eqs(CsTags.get(m.text, CsCallout.KEY.ROLE), CsCallout.ROLE_TEXT,
    "the text carries role=text");
eqs(CsTags.get(m.text, CsCallout.KEY.STYLE), "hazard",
    "the text carries its style");
eqs(CsTags.get(m.leaders[0], CsCallout.KEY.ROLE), CsCallout.ROLE_LEADER,
    "a leader carries role=leader");
eqs(CsTags.get(m.leaders[0], CsCallout.KEY.ID), String(id),
    "a leader carries the SAME id as its text");

// --- WHERE THE TEXT ACTUALLY LANDED ----------------------------------
// Assert the BOUNDING BOX, not getPosition(). setPosition() reads back
// whatever you gave it even when the text renders at the origin,
// because the entity draws at its ALIGNMENT point -- so a getPosition()
// assertion passes while the caver sees the note at 0,0. That is
// exactly how this shipped, and got caught by hand instead of here.
(function() {
    var box = CalloutWrite.boxOf(m.text);
    near(box.x1, 100, 1e-6, "the text's box starts at the requested x");
    // VAlignMiddle: the pick point is the note's vertical MIDDLE, which
    // is also where reflow attaches the landing -- so the arrow leaves
    // at exactly the height the caver clicked.
    near((box.y1 + box.y2) / 2.0, 50, 1e-6,
        "the text's box is centred vertically ON the requested y");
    ok(box.x2 > box.x1, "the text's box has real width");
    ok(box.y2 > box.y1, "the text's box has real height");
    ok(!(Math.abs(box.x1) < 1e-9 && Math.abs(box.y2) < 1e-9),
        "the text did NOT snap to the origin");

    // And the leaders must land ON that box, not near the origin --
    // boxOf feeds reflow, so a mislocated text silently mislocates
    // every arrow too.
    for (var i = 0; i < m.leaders.length; i++) {
        var d = m.leaders[i].getData();
        var last = d.getVertexAt(d.countVertices() - 1);
        ok(last.x >= box.x1 - 1e-6 && last.x <= box.x2 + 1e-6,
            "leader " + i + " lands on the text's box in x, not at the origin");
        ok(last.y >= box.y1 - 1e-6 && last.y <= box.y2 + 1e-6,
            "leader " + i + " lands within the text's box in y");
    }
})();

// --- layer discipline: never the current layer ------------------------
eqs(doc.getLayerName(m.text.getLayerId()), CsLayers.NOTES_HAZARD,
    "the text landed on its STYLE's layer");
eqs(doc.getLayerName(m.leaders[0].getLayerId()), CsLayers.NOTES_HAZARD,
    "the leader landed on its style's layer too");

// --- entity count actually changed (an op can 'succeed' and add nothing)
var onLayer = doc.queryLayerEntities(
    doc.getLayerId(CsLayers.NOTES_HAZARD), true);
eqs(onLayer.length, 3, "three entities on the hazard layer: 1 text + 2 leaders");

// --- applyReflow rewrites leaders and leaves the text alone -----------
var textBefore = CsTags.get(m.text, CsCallout.KEY.ID);
CalloutWrite.applyReflow(doc, di, id, null);
var m2 = CalloutWrite.members(doc, id);
eqs(m2.leaders.length, 2, "reflow kept one leader per branch");
eqs(CsTags.get(m2.text, CsCallout.KEY.ID), textBefore,
    "reflow did not disturb the text's tags");

// --- undo grouping passes through -------------------------------------
// Two grouped applies must collapse to a single undo.
var leadersBeforeGroup = CalloutWrite.members(doc, id).leaders.length;
var before = doc.queryAllEntities(false, true).length;
CalloutWrite.applyReflow(doc, di, id, 4242);
CalloutWrite.applyReflow(doc, di, id, 4242);
di.undo();
eqs(doc.queryAllEntities(false, true).length, before,
    "two group-4242 reflows collapse into ONE undo");
// The count-only check above is not enough: it is exactly what let a
// real defect through -- an untagged, orphaned leader left the entity
// COUNT correct while the callout's actual composition was broken
// (tagging used to ride a separate, ungrouped operation next to the
// grouped add/delete, so undoing the group could strand a leader that
// existed but carried no CalloutId/CalloutRole at all). members()
// only finds an entity BY ITS TAG, so this is the real proof the group
// was atomic, not merely that nothing leaked or vanished by count.
eqs(CalloutWrite.members(doc, id).leaders.length, leadersBeforeGroup,
    "... and after that undo, members() still finds the ORIGINAL " +
    "number of leaders BY TAG (not just the same entity count)");

// --- THE DXF ROUND TRIP -----------------------------------------------
// The single most load-bearing test in this file. A callout is a LINKED
// PAIR and the link is XDATA -- there is no side table and no registry
// object in the drawing. If CalloutId does not survive export/import,
// then every callout in every saved file silently decays into an
// unrelated text and some loose arrows the moment it is reopened, and
// nothing else in this suite would notice: the in-memory tests all pass
// against a document that was never written to disk.
(function() {
    var rtPath = repoRoot + "/tests/.callout-roundtrip.dxf";

    // Find the dxflib filter the same way the rest of the suite does.
    var rtFilter = "";
    var filters = RFileExporterRegistry.getFilterStrings();
    for (var f = 0; f < filters.length; f++) {
        if (String(filters[f]).indexOf("dxflib") >= 0) {
            rtFilter = filters[f];
            break;
        }
    }

    ok(di.exportFile(rtPath, rtFilter, false),
        "round trip: the drawing with a callout in it exports");

    var rtDoc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
    var rtDi = new RDocumentInterface(rtDoc);
    eqs(rtDi.importFile(rtPath, "", false),
        RDocumentInterface.IoErrorNoError,
        "round trip: the file reads back");

    // The id must come back, or the pair is not a pair any more.
    var ids = CalloutWrite.existingIds(rtDoc);
    eqs(ids.length, 1, "round trip: exactly one CalloutId survives the save");
    eqs(String(ids[0]), String(id),
        "round trip: it is the SAME id, not a regenerated one");

    var rt = CalloutWrite.members(rtDoc, ids[0]);
    ok(rt.text !== null, "round trip: the text is still found BY ITS TAG");
    eqs(rt.leaders.length, 2,
        "round trip: both leaders are still found by the same tag");

    // Roles must survive too: without them members() cannot tell which
    // entity is the text, and reflow would have nothing to attach to.
    eqs(CsTags.get(rt.text, CsCallout.KEY.ROLE), CsCallout.ROLE_TEXT,
        "round trip: the text's role tag survives");
    eqs(CsTags.get(rt.leaders[0], CsCallout.KEY.ROLE), CsCallout.ROLE_LEADER,
        "round trip: a leader's role tag survives");
    eqs(CsTags.get(rt.text, CsCallout.KEY.STYLE), "hazard",
        "round trip: the style survives, so a reflow still knows its layer");

    // And the reopened callout must still be reflowable -- the whole
    // point of persisting the link.
    CalloutWrite.applyReflow(rtDoc, rtDi, ids[0], null);
    eqs(CalloutWrite.members(rtDoc, ids[0]).leaders.length, 2,
        "round trip: the REOPENED callout still reflows to two leaders");

    new QFile(rtPath).remove();
})();

var out;
if (failures.length === 0) {
    out = "### CALLOUT-WRITE OK " + passed;
} else {
    out = "### CALLOUT-WRITE FAIL " + failures.length + " of " +
        (passed + failures.length) + "\n";
    for (var k = 0; k < failures.length; k++) {
        out += "  FAIL: " + failures[k] + "\n";
    }
}
print(out);
