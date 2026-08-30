// scan_reanchor_run.js -- aligned scans follow the survey when it moves.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/scan_reanchor_run.js "$PWD"
//
// Prints "### SCAN REANCHOR OK" / "### SCAN REANCHOR FAIL".
//
// WHY A REAL DOCUMENT. The whole mechanism turns on QCAD's own image
// mapping -- mapToImage to read a station's pixel out of a placed scan,
// mapFromImage to check where it lands afterwards. A stub of that
// mapping would only prove my arithmetic agrees with itself, which was
// never the thing in doubt.

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try { if (typeof v.isNull === "function") { return v.isNull(); } } catch (e) {}
        return false;
    };
}
if (typeof isImageEntity === "undefined") {
    isImageEntity = function(e) {
        return !isNull(e) && typeof e.getType === "function" &&
            e.getType() === RS.EntityImage;
    };
}

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];
function loadRepoScript(rel) {
    var f = new QFile(repoRoot + "/" + rel);
    if (!f.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open " + rel);
    }
    var st = new QTextStream(f);
    var src = String(st.readAll());
    f.close();
    src = src.replace(/^\s*include\(.*\);\s*$/mg, "");
    (0, eval)(src);
}
["CsUuid", "CsUnits", "CsAngles", "CsModel", "CsTraverse", "CsNetwork",
 "CsLrud", "CsScanFit", "CsStore", "CsTags", "CsLayers", "CsStationOrder",
 "CsScanReanchor"].forEach(function(m) {
    loadRepoScript("scripts/CaveSurvey/Core/" + m + ".js");
});

var failures = [], checks = 0;
function check(name, cond) {
    checks++;
    if (cond !== true) { failures.push(name); }
}
function checkClose(name, a, b, tol) {
    checks++;
    if (!(Math.abs(a - b) <= (tol === undefined ? 0.01 : tol))) {
        failures.push(name + " -- expected " + b + ", got " + a);
    }
}

var scanPath = repoRoot + "/scripts/CaveSurvey/SketchScans/SketchScans.svg";
var img = new QImage(scanPath);
var W = img.width(), H = img.height();

var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
var di = new RDocumentInterface(doc);
CsLayers.ensure(doc, di, CsLayers.CTRL_STATIONS);
CsLayers.ensure(doc, di, CsLayers.CTRL_SCAN);

function putStation(name, x, y) {
    var p = new RPointEntity(doc, new RPointData(new RVector(x, y)));
    p.setLayerId(doc.getLayerId(CsLayers.CTRL_STATIONS));
    CsTags.set(p, "Station", name);
    di.applyOperation(new RAddObjectOperation(p, false));
    return p;
}
var a = putStation("A1", 100, 100);
var b = putStation("A2", 200, 140);

// two picks on the scan, in its own pixels
var pickA = { x: 10, y: 10 }, pickB = { x: W - 10, y: H - 10 };
var fit = CsScanFit.fit([
    { source: pickA, dest: { x: 100, y: 100 } },
    { source: pickB, dest: { x: 200, y: 140 } }
]);
var v = CsScanFit.imageVectors(fit.matrix);
var data = new RImageData(scanPath, new RVector(v.position.x, v.position.y),
    new RVector(v.u.x, v.u.y), new RVector(v.v.x, v.v.y), W, H, 0);
var scan = new RImageEntity(doc, data);
scan.setLayerId(doc.getLayerId(CsLayers.CTRL_SCAN));
CsTags.set(scan, "SketchScan", "test.jpg");
CsTags.set(scan, CsStationOrder.TAG,
    CsStationOrder.serializeAssigned(["A1", "A2"]));
CsTags.set(scan, "ScanAnchors", CsScanFit.serializeAnchors([
    { name: "A1", u: pickA.x, v: pickA.y },
    { name: "A2", u: pickB.x, v: pickB.y }
]));
di.applyOperation(new RAddObjectOperation(scan, false));

// ---- nothing has moved: the scan must be left alone ------------------
var first = CsScanReanchor.run(doc, di);
check("an unchanged survey leaves the scan alone", first.moved === 0);
check("and reports it as already in place", first.matched === 1);

// ---- a correction moves a station: the scan must follow --------------
var moved = doc.queryEntity(b.getId());
moved.move(new RVector(30, -25));          // A2 shifts, as a fixed azimuth would
var mop = new RModifyObjectsOperation();
mop.addObject(moved, false);
di.applyOperation(mop);

var after = CsScanReanchor.run(doc, di);
check("a moved station re-fits the scan", after.moved === 1);

var placed = doc.queryEntity(scan.getId()).getData();
var atA = placed.mapFromImage(new RVector(pickA.x, pickA.y));
var atB = placed.mapFromImage(new RVector(pickB.x, pickB.y));
checkClose("the scan's A1 pick still lands on A1 (x)", atA.x, 100);
checkClose("the scan's A1 pick still lands on A1 (y)", atA.y, 100);
checkClose("the scan's A2 pick follows A2 (x)", atB.x, 230);
checkClose("the scan's A2 pick follows A2 (y)", atB.y, 115);

// ---- and it settles: a second pass moves nothing ---------------------
var again = CsScanReanchor.run(doc, di);
check("a second pass moves nothing", again.moved === 0);
check("and says it is already in place", again.matched === 1);

// ---- a scan with names but no anchors gets them, from where it sits --
var legacy = doc.queryEntity(scan.getId());
CsTags.remove(legacy, "ScanAnchors");
var rop = new RModifyObjectsOperation();
rop.addObject(legacy, false);
di.applyOperation(rop);
check("the anchors really are gone",
    CsTags.get(doc.queryEntity(scan.getId()), "ScanAnchors") === "");

var filled = CsScanReanchor.backfill(doc, di);
check("a legacy scan is given anchors", filled === 1);
var recovered = CsScanFit.parseAnchors(
    CsTags.get(doc.queryEntity(scan.getId()), "ScanAnchors"));
check("both stations were recovered", recovered.length === 2);
// read back out of the placement, so they must be the pixels we picked
checkClose("the recovered A1 pixel is the one picked (x)",
    recovered[0].u, pickA.x, 0.5);
checkClose("the recovered A1 pixel is the one picked (y)",
    recovered[0].v, pickA.y, 0.5);

// ---- a scan whose stations are gone is left alone, not mangled -------
var gone = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
var gdi = new RDocumentInterface(gone);
CsLayers.ensure(gone, gdi, CsLayers.CTRL_SCAN);
var orphan = new RImageEntity(gone, new RImageData(scanPath,
    new RVector(0, 0), new RVector(1, 0), new RVector(0, 1), W, H, 0));
orphan.setLayerId(gone.getLayerId(CsLayers.CTRL_SCAN));
CsTags.set(orphan, "SketchScan", "orphan.jpg");
CsTags.set(orphan, "ScanAnchors", "Z1@10,10;Z2@20,20");
gdi.applyOperation(new RAddObjectOperation(orphan, false));
var orphanRun = CsScanReanchor.run(gone, gdi);
check("a scan whose stations are gone is counted stale",
    orphanRun.stale === 1);
check("and is not moved", orphanRun.moved === 0);
check("and is still in the drawing",
    CsScanReanchor.scans(gone).length === 1);

if (failures.length === 0) {
    print("### SCAN REANCHOR OK " + checks);
} else {
    for (var f = 0; f < failures.length; f++) { print("FAIL: " + failures[f]); }
    print("### SCAN REANCHOR FAIL " + failures.length + " of " + checks);
}
