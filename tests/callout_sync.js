// callout_sync.js -- CsCalloutSync against a real document.
//
//   /Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon \
//       -no-gui -allow-multiple-instances -autostart \
//       tests/callout_sync.js "$PWD"
//
// Prints "### CALLOUT-SYNC OK <n>" or "### CALLOUT-SYNC FAIL".
//
// Separate from callout_write.js because it exercises a COMMAND's own
// logic (reflow-all, duplicate repair, refusal reporting) rather than
// the write layer beneath it.

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
    // INDIRECT eval: a direct eval() inside this function scopes every
    // Cs* global into it, and they vanish the moment it returns.
    (0, eval)(src);
}

// The bare -autostart engine does not preload library.js.
if (typeof isNull === "undefined") {
    isNull = function(v) {
        return v === undefined || v === null ||
            (typeof v.isNull === "function" && v.isNull());
    };
}
if (typeof qsTr === "undefined") {
    qsTr = function(s) { return s; };
}

var FILES = [
    "scripts/CaveSurvey/Core/CsUuid.js",
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

// CalloutSync.js is a COMMAND file: it include()s EAction and CsAll,
// which the bare engine has no path for. Load only its static half by
// stripping the includes and the EAction plumbing -- the functions under
// test (run, rekeyDuplicates, targetIds, textsById, leaderDistanceTo)
// touch none of it.
(function() {
    var file = new QFile(repoRoot + "/scripts/CaveSurvey/CalloutSync/CalloutSync.js");
    if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open CalloutSync.js");
    }
    var stream = new QTextStream(file);
    var src = stream.readAll();
    file.close();
    src = src.replace(/^include\(.*$/gm, "");
    src = src.replace(/^CalloutSync\.prototype[\s\S]*?^};$/gm, "");
    src = src.replace(/^function CalloutSync\(guiAction\) \{[\s\S]*?^\}$/m,
        "function CalloutSync() {}");
    (0, eval)(src);
})();

// CalloutListener has no include()s and no EAction plumbing in its
// static half, so it loads directly. install() is NOT exercised here --
// it needs a real main window with a document open -- but reconcile()
// takes doc and di explicitly precisely so it can be driven from here.
loadRepoScript("scripts/CaveSurvey/Callout/CalloutListener.js");

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
getDocument = function() { return doc; };
CsLayers.ensureCalloutLayers(doc, di);

// ---------------------------------------------------------------------
// Reflow after the text has moved -- the whole point of the command.
// ---------------------------------------------------------------------
var id = CalloutWrite.create(doc, di, {
    text: "moved note", position: { x: 100, y: 100 },
    tips: [{ x: 60, y: 90 }, { x: 70, y: 120 }],
    style: "hazard", kind: CsCallout.KIND_TEXT,
    height: CalloutWrite.textHeight(doc)
});

(function() {
    var m = CalloutWrite.members(doc, id);
    var td = m.text.getData();
    var was = td.getAlignmentPoint();
    td.setPosition(new RVector(was.x + 300, was.y + 200));
    td.setAlignmentPoint(new RVector(was.x + 300, was.y + 200));
    m.text.setData(td);
    var mop = new RModifyObjectsOperation();
    mop.addObject(m.text, false);
    di.applyOperation(mop);

    var report = CalloutSync.run(doc, di);
    ok(report.indexOf("Reflowed 1") >= 0,
        "run() reports one callout reflowed (got: " +
        report.split("\n")[0] + ")");

    var after = CalloutWrite.members(doc, id);
    var box = CalloutWrite.boxOf(after.text);
    for (var i = 0; i < after.leaders.length; i++) {
        var d = after.leaders[i].getData();
        var last = d.getVertexAt(d.countVertices() - 1);
        ok(last.x >= box.x1 - 1e-6 && last.x <= box.x2 + 1e-6 &&
           last.y >= box.y1 - 1e-6 && last.y <= box.y2 + 1e-6,
            "leader " + i + " landed back on the MOVED note");
    }
    // Assert the SET of tips, not leaders[0]: members() reads through
    // queryAllEntities, which is not insertion-ordered, so "the first
    // leader" is whichever the query returned first.
    var tipX = [];
    for (var t = 0; t < after.leaders.length; t++) {
        tipX.push(after.leaders[t].getData().getVertexAt(0).x);
    }
    tipX.sort(function(a, b) { return a - b; });
    eqs(tipX.length, 2, "both arrows are still there");
    near(tipX[0], 60, 1e-6, "and neither TIP moved with the note (60)");
    near(tipX[1], 70, 1e-6, "nor the other (70)");
})();

// ---------------------------------------------------------------------
// A curved leader must still be curved after a sync.
// ---------------------------------------------------------------------
(function() {
    var cid = CalloutWrite.create(doc, di, {
        text: "curvy", position: { x: 500, y: 100 },
        tips: [{ x: 460, y: 90 }],
        style: "name", kind: CsCallout.KIND_TEXT,
        leader: CsCallout.LEADER_CURVED,
        height: CalloutWrite.textHeight(doc)
    });
    CalloutSync.run(doc, di);
    var d = CalloutWrite.members(doc, cid).leaders[0].getData();
    ok(Math.abs(d.getBulgeAt(0)) > 1e-9,
        "a curved leader is STILL curved after a sync, not straightened");
})();

// ---------------------------------------------------------------------
// Duplicate ids -- what copy/paste does, and what no id scheme prevents.
// ---------------------------------------------------------------------
(function() {
    var aId = CalloutWrite.create(doc, di, {
        text: "twin", position: { x: 900, y: 900 },
        tips: [{ x: 860, y: 890 }],
        style: "name", kind: CsCallout.KIND_TEXT,
        height: CalloutWrite.textHeight(doc)
    });

    // Forge the collision the way a paste produces it: a second text and
    // leader carrying the SAME id, well away from the first.
    var op = new RAddObjectsOperation();
    var at = new RVector(1200, 1200);
    var td = new RTextData(at, at, CalloutWrite.textHeight(doc), 100.0,
        RS.VAlignMiddle, RS.HAlignLeft, RS.LeftToRight, RS.Exact,
        1.0, "twin", "standard", false, false, 0.0, false);
    var t2 = new RTextEntity(doc, td);
    t2.setLayerId(doc.getLayerId(CsLayers.NOTES_NAME));
    CsTags.set(t2, CsCallout.KEY.ID, aId);
    CsTags.set(t2, CsCallout.KEY.ROLE, CsCallout.ROLE_TEXT);
    CsTags.set(t2, CsCallout.KEY.STYLE, "name");
    CsTags.set(t2, CsCallout.KEY.LEADER, CsCallout.LEADER_STRAIGHT);
    op.addObject(t2, false);

    var pl = new RPolyline();
    pl.appendVertex(new RVector(1160, 1190), 0.0);
    pl.appendVertex(new RVector(1198, 1200), 0.0);
    pl.appendVertex(new RVector(1200, 1200), 0.0);
    var l2 = new RLeaderEntity(doc, new RLeaderData(pl, true));
    l2.setLayerId(doc.getLayerId(CsLayers.NOTES_NAME));
    CsTags.set(l2, CsCallout.KEY.ID, aId);
    CsTags.set(l2, CsCallout.KEY.ROLE, CsCallout.ROLE_LEADER);
    op.addObject(l2, false);
    di.applyOperation(op);

    eqs(CalloutSync.textsById(doc)[aId].length, 2,
        "the forged paste really does leave two texts on one id");

    var rekeyed = CalloutSync.rekeyDuplicates(doc, di);
    eqs(rekeyed, 1, "rekeyDuplicates repairs exactly one of the pair");

    var byId = CalloutSync.textsById(doc);
    eqs(byId[aId].length, 1,
        "the ORIGINAL id is now held by exactly one text");

    // Find the copy through the DOCUMENT, not through the t2 handle.
    // t2 is the pre-add script-side object: its entity id was never set
    // and its tags do not follow a later modify, so reading it back
    // would test the handle rather than the drawing. (This is also why
    // rekeyDuplicates sorts live entities by getId() and not these.)
    var copyId = null;
    var allIds = doc.queryAllEntities(false, true);
    for (var z = 0; z < allIds.length; z++) {
        var ez = doc.queryEntity(allIds[z]);
        if (isNull(ez) ||
                CsTags.get(ez, CsCallout.KEY.ROLE) !== CsCallout.ROLE_TEXT) {
            continue;
        }
        var bz = CalloutWrite.boxOf(ez);
        if (bz.x1 > 1100 && bz.y2 > 1100) {     // the forged copy
            copyId = CsTags.get(ez, CsCallout.KEY.ID);
        }
    }
    ok(copyId !== null, "the copy is findable in the drawing");
    ok(CsUuid.isValid(copyId), "the copy got a valid fresh id");
    ok(copyId !== aId,
        "which is NOT the original's -- the ORIGINAL keeps its id, " +
        "because rekeyDuplicates sorts by entity id and the paste is " +
        "younger");
    eqs(CalloutWrite.members(doc, copyId).leaders.length, 1,
        "and the arrow NEAREST the copy went with it, not with the original");
    eqs(CalloutWrite.members(doc, aId).leaders.length, 1,
        "the original kept its own arrow");
})();

// ---------------------------------------------------------------------
// A locked layer must be REPORTED, never silently skipped.
// ---------------------------------------------------------------------
(function() {
    var lay = doc.queryLayer(CsLayers.NOTES_HAZARD);
    if (isNull(lay)) {
        return;
    }
    lay.setLocked(true);
    var lop = new RModifyObjectsOperation();
    lop.addObject(lay, false);
    di.applyOperation(lop);

    var report = CalloutSync.run(doc, di);
    ok(report.indexOf("Could not update") >= 0,
        "a locked layer is named in the report, not silently skipped");
    ok(report.indexOf("LOCKED") >= 0,
        "and the reason names the LOCK specifically, so the caver knows " +
        "what to unlock");

    lay.setLocked(false);
    var uop = new RModifyObjectsOperation();
    uop.addObject(lay, false);
    di.applyOperation(uop);
})();

// ---------------------------------------------------------------------
// CalloutListener.reconcile -- the live-glue decisions.
//
// install() and the transaction handler need a main window with a
// document open and cannot run here. reconcile() is the part that
// decides what happens, and it takes doc/di explicitly so it can.
// ---------------------------------------------------------------------

// --- a moved note: reflow, in the caller's undo group ----------------
(function() {
    var rid = CalloutWrite.create(doc, di, {
        text: "listener reflow", position: { x: 2000, y: 100 },
        tips: [{ x: 1960, y: 90 }],
        style: "name", kind: CsCallout.KIND_TEXT,
        height: CalloutWrite.textHeight(doc)
    });
    var m = CalloutWrite.members(doc, rid);
    var td = m.text.getData();
    var was = td.getAlignmentPoint();
    td.setPosition(new RVector(was.x + 200, was.y + 150));
    td.setAlignmentPoint(new RVector(was.x + 200, was.y + 150));
    m.text.setData(td);
    var mop = new RModifyObjectsOperation();
    mop.addObject(m.text, false);
    di.applyOperation(mop);

    eqs(CalloutListener.reconcile(doc, di, rid, -1), "reflowed",
        "reconcile reflows a callout whose note moved");
    var after = CalloutWrite.members(doc, rid);
    var box = CalloutWrite.boxOf(after.text);
    var last = after.leaders[0].getData();
    var end = last.getVertexAt(last.countVertices() - 1);
    ok(end.x >= box.x1 - 1e-6 && end.x <= box.x2 + 1e-6,
        "and the arrow landed back on the moved note");
})();

// --- the note deleted: its orphaned arrows go with it ----------------
(function() {
    var oid = CalloutWrite.create(doc, di, {
        text: "doomed", position: { x: 2500, y: 100 },
        tips: [{ x: 2460, y: 90 }, { x: 2470, y: 130 }],
        style: "name", kind: CsCallout.KIND_TEXT,
        height: CalloutWrite.textHeight(doc)
    });
    var m = CalloutWrite.members(doc, oid);
    var del = new RDeleteObjectsOperation();
    del.deleteObject(m.text);
    di.applyOperation(del);

    eqs(CalloutWrite.members(doc, oid).leaders.length, 2,
        "fixture: deleting the note leaves both arrows orphaned");
    eqs(CalloutListener.reconcile(doc, di, oid, -1), "orphans-removed",
        "reconcile removes arrows that point at nothing");
    eqs(CalloutWrite.members(doc, oid).leaders.length, 0,
        "and they are actually gone");
})();

// --- the LAST arrow deleted: the note SURVIVES -----------------------
// Asymmetric with the case above, on purpose. A note without an arrow is
// still a note; deleting a caver's words because they deleted an arrow
// would destroy work they never asked to lose.
(function() {
    var kid = CalloutWrite.create(doc, di, {
        text: "keep my words", position: { x: 3000, y: 100 },
        tips: [{ x: 2960, y: 90 }],
        style: "name", kind: CsCallout.KIND_TEXT,
        height: CalloutWrite.textHeight(doc)
    });
    var m = CalloutWrite.members(doc, kid);
    var textId = m.text.getId();
    var del = new RDeleteObjectsOperation();
    del.deleteObject(m.leaders[0]);
    di.applyOperation(del);

    eqs(CalloutListener.reconcile(doc, di, kid, -1), "unlinked",
        "reconcile unlinks a note whose last arrow was deleted");

    var survivor = doc.queryEntity(textId);
    ok(!isNull(survivor),
        "THE NOTE SURVIVES -- it is not deleted along with its arrow");
    eqs(CsTags.get(survivor, CsCallout.KEY.ID), "",
        "and its callout tags are stripped, so it is ordinary text now");
    eqs(CalloutWrite.members(doc, kid).text, null,
        "so the callout no longer exists as a callout");
})();

// --- the gate: a transaction touching no callout is a no-op ---------
(function() {
    var before = doc.queryAllEntities(false, true).length;
    var lid = CalloutWrite.create(doc, di, {
        text: "bystander", position: { x: 3500, y: 100 },
        tips: [{ x: 3460, y: 90 }],
        style: "name", kind: CsCallout.KIND_TEXT,
        height: CalloutWrite.textHeight(doc)
    });
    // an id nothing carries
    eqs(CalloutListener.reconcile(doc, di, CsUuid.v4(), -1), "nothing",
        "reconcile on an id no entity carries does nothing at all");
    ok(CalloutWrite.members(doc, lid).text !== null,
        "and the real callout beside it is untouched");
})();

var out;
if (failures.length === 0) {
    out = "### CALLOUT-SYNC OK " + passed;
} else {
    out = "### CALLOUT-SYNC FAIL " + failures.length + " of " +
        (passed + failures.length) + "\n";
    for (var k = 0; k < failures.length; k++) {
        out += "  FAIL: " + failures[k] + "\n";
    }
}
print(out);
