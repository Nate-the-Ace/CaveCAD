// cross_section_run.js -- the cross-section lifecycle against a REAL
// document: cut, place, regenerate, freeze, lose.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/cross_section_run.js "$PWD"
//
// Prints "### CROSS SECTION OK" on success, "### CROSS SECTION FAIL"
// plus the failed assertions otherwise.
//
// WHY THIS FILE EXISTS RATHER THAN MORE UNIT TESTS. Every bug this
// feature actually shipped was invisible to the pure tests and obvious
// the first time the code met an RDocument:
//   * every LRUD-only section captioned itself "re-entrant simplified",
//     because the sampled angles land exactly on a four-point diamond's
//     vertex angles and a ray through a vertex hits both segments;
//   * the caption inverted its own scale, reading 1:0.3 for a section
//     drawn four times survey size;
//   * sections drew on their side, because theta is measured from world
//     up and the block mapped it to +X.
// None of those are logic errors the unit suite could see. What it
// takes is placing a real block and reading it back.
//
// THE CLAIM THAT MATTERS MOST is the last one below: a redefine must
// change the DEFINITION and never the REFERENCE. That is what lets a
// section follow the survey while staying exactly where the caver put
// it, and it is the whole reason a section is a block at all.

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

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

function loadRepoScript(rel) {
    var file = new QFile(repoRoot + "/" + rel);
    if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open " + rel);
    }
    var stream = new QTextStream(file);
    var source = String(stream.readAll());
    file.close();
    // Dependencies are loaded explicitly below; QCAD's own include()
    // would look in the installed script folders, not this checkout.
    source = source.replace(/^\s*include\(.*\);\s*$/mg, "");
    // Indirect eval, so definitions land in the GLOBAL scope.
    (0, eval)(source);
}

var CORE = ["CsUuid", "CsUnits", "CsAngles", "CsModel", "CsFrontier",
    "CsTraverse", "CsNetwork", "CsAdjust", "CsLrud", "CsSectionCut",
    "CsTags", "CsStore", "CsLayers", "CsCallout", "CsSectionDraw"];
for (var ci = 0; ci < CORE.length; ci++) {
    loadRepoScript("scripts/CaveSurvey/Core/" + CORE[ci] + ".js");
}
loadRepoScript("scripts/CaveSurvey/Callout/CalloutWrite.js");

var failures = [];
var checks = 0;

function check(name, condition) {
    checks++;
    if (condition !== true) {
        failures.push(name);
    }
}

function checkClose(name, actual, expected, tol) {
    checks++;
    if (!(Math.abs(actual - expected) <= (tol === undefined ? 1e-9 : tol))) {
        failures.push(name + " -- expected " + expected + ", got " + actual);
    }
}

function lrudShot(from, to, d, az, l, r, u, dn) {
    var s = CsModel.newShot();
    s.from = from; s.to = to; s.distance = d; s.azimuth = az;
    s.inclination = 0;
    s.left = l; s.right = r; s.up = u; s.down = dn;
    return s;
}

var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
var di = new RDocumentInterface(doc);

var sv = CsModel.newSurvey();
sv.shots.push(lrudShot("A1", "A2", 10, 0, 10, 10, 10, 10));
sv.shots.push(lrudShot("A2", "A3", 10, 0, 10, 10, 10, 10));
var res = CsNetwork.resolve(sv, {});

// ---- cut and place ---------------------------------------------------
var cut = CsSectionCut.cut(sv, res, "A2", "A3", 0.5, {});
check("a mid-leg cut is not refused", cut.refused === undefined);
check("a plain LRUD passage is not re-entrant", cut.reentrant === false);

var id = CalloutWrite.createSection(doc, di, {
    cut: cut, from: "A2", to: "A3", t: 0.5,
    position: { x: 200, y: 200 }, tips: [{ x: 0, y: 15 }], scale: 4
});
check("createSection returns an id", id !== null && id !== undefined);

var m = CalloutWrite.members(doc, id);
check("the section's content is a BLOCK, not text",
    m.block !== null && m.text === null);
check("and it has a leader", m.leaders.length === 1);
check("the block is this section's own definition",
    doc.getBlockId(CsSectionDraw.blockName(id)) ===
        m.block.getData().getReferencedBlockId());

// The leader runs from the PICKED POINT to the section's own outline,
// not to a bounding box: it must start at the tip and end on the
// linework, short of the centroid.
var lead = m.leaders[0].getData();
var v0 = lead.getVertexAt(0);
var v1 = lead.getVertexAt(1);
checkClose("the leader starts at the picked point (x)", v0.x, 0);
checkClose("the leader starts at the picked point (y)", v0.y, 15);
check("the leader ends short of the section's centre",
    Math.sqrt((v1.x - 200) * (v1.x - 200) +
              (v1.y - 200) * (v1.y - 200)) > 1);
check("and it ends INSIDE the section's own extent",
    Math.abs(v1.x - 200) <= 40.001 && Math.abs(v1.y - 200) <= 40.001);

var placedAt = m.block.getData().getPosition();
checkClose("the reference sits where it was placed (x)", placedAt.x, 200);
checkClose("the reference sits where it was placed (y)", placedAt.y, 200);

m.block.update();
var boxBefore = m.block.getBoundingBox();
var widthBefore = boxBefore.getMaximum().x - boxBefore.getMinimum().x;

// ---- the survey changes, and the section follows ---------------------
sv.shots[1].right = 30;                 // A3's right wall opens out
var res2 = CsNetwork.resolve(sv, {});
var report = CalloutWrite.refreshSections(doc, di, sv, res2);
check("the refresh re-derived one section", report.updated === 1);
check("nothing was lost", report.lost === 0);
check("nothing was refused", report.refused === 0);

var m2 = CalloutWrite.members(doc, id);
m2.block.update();
var boxAfter = m2.block.getBoundingBox();
var widthAfter = boxAfter.getMaximum().x - boxAfter.getMinimum().x;
check("the DEFINITION followed the survey -- the section got wider",
    widthAfter > widthBefore + 1);

// THE CLAIM THIS WHOLE FEATURE RESTS ON.
var stillAt = m2.block.getData().getPosition();
checkClose("and the REFERENCE did not move (x)", stillAt.x, 200);
checkClose("and the REFERENCE did not move (y)", stillAt.y, 200);

// The leader was RE-AIMED at the new outline, not left on the old edge.
var m2lead = m2.leaders[0].getData();
var w0 = m2lead.getVertexAt(0);
checkClose("the re-aimed leader still starts at the picked point", w0.x, 0);

// ---- frozen sections are left alone, and counted ---------------------
CsTags.set(m2.block, CsCallout.KEY.SECTION_FROZEN, "1");
var fop = new RModifyObjectsOperation();
fop.addObject(m2.block, false);
di.applyOperation(fop);

var frozenReport = CalloutWrite.refreshSections(doc, di, sv, res2);
check("a frozen section is not re-derived", frozenReport.updated === 0);
check("a frozen section is COUNTED, not silently skipped",
    frozenReport.frozen === 1);

var m3 = CalloutWrite.members(doc, id);
CsTags.remove(m3.block, CsCallout.KEY.SECTION_FROZEN);
var uop = new RModifyObjectsOperation();
uop.addObject(m3.block, false);
di.applyOperation(uop);

// ---- a section whose leg is gone -------------------------------------
var shrunk = CsModel.newSurvey();
shrunk.shots.push(lrudShot("A1", "A2", 10, 0, 10, 10, 10, 10));
var res3 = CsNetwork.resolve(shrunk, {});
var lostReport = CalloutWrite.refreshSections(doc, di, shrunk, res3);
check("a section whose leg is gone is not re-derived",
    lostReport.updated === 0);
check("it is counted lost", lostReport.lost === 1);
var m4 = CalloutWrite.members(doc, id);
check("and it is LEFT IN THE DRAWING, never deleted", m4.block !== null);

// ---- the counts are stable across repeated passes --------------------
// A second refresh must report the same thing: a lost section that
// quietly became "updated" on the next pass would mean the refresh was
// re-deriving from something other than the survey it was given.
var again = CalloutWrite.refreshSections(doc, di, shrunk, res3);
check("a second pass reports the same loss", again.lost === 1);
check("and still re-derives nothing", again.updated === 0);

if (failures.length === 0) {
    print("### CROSS SECTION OK " + checks);
} else {
    for (var f = 0; f < failures.length; f++) {
        print("FAIL: " + failures[f]);
    }
    print("### CROSS SECTION FAIL " + failures.length + " of " + checks);
}
