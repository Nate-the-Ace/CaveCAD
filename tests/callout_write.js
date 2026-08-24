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

// --- dimVar: a fresh document answers 0 for every dim variable, which
// must come back null, never a fabricated length --------------------
eqs(CalloutWrite.dimVar(doc, RS.DIMASZ), null,
    "dimVar maps an unset (0) DIMASZ to null, not 0");
eqs(CalloutWrite.dimVar(doc, RS.DIMSCALE), null,
    "dimVar maps an unset (0) DIMSCALE to null, not 0");
eqs(CalloutWrite.dimVar(doc, RS.DIMTXT), null,
    "dimVar maps an unset (0) DIMTXT to null, not 0");

// --- textHeight: no DIMTXT set, so the 2.5 last resort carries -------
eqs(CalloutWrite.textHeight(doc), 2.5,
    "textHeight falls back to 2.5 when the drawing's own DIMTXT is unset");

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
var before = doc.queryAllEntities(false, true).length;
CalloutWrite.applyReflow(doc, di, id, 4242);
CalloutWrite.applyReflow(doc, di, id, 4242);
di.undo();
eqs(doc.queryAllEntities(false, true).length, before,
    "two group-4242 reflows collapse into ONE undo");

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
