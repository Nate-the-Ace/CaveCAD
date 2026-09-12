// cave3d_drape_run.js -- reading sketch scans out of a REAL document and
// draping one onto a survey.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/cave3d_drape_run.js "$PWD"
//
// Prints "### CAVE3D DRAPE OK <n>" on success, "### CAVE3D DRAPE FAIL"
// plus the failed checks otherwise.
//
// WHY THIS FILE EXISTS RATHER THAN MORE UNIT TESTS. CsDrape's sampling
// and grid arithmetic are node-tested in js_unit.js. What can only break
// against a real RDocument is the READING: an image entity does not know
// its own file name (getFileName() is EMPTY and getWidth()/getHeight()
// are ZERO -- probed against Truitt Cave's 28 plan scans, through both
// the method and the property route), so the path comes from XDATA
// relative to the cave's scans folder and the pixel size from the file.
//
// Every one of those is a place where a wrong assumption yields NO
// SCANS and no error, which is the failure this file exists to catch.

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try { if (typeof v.isNull === "function") { return v.isNull(); } }
        catch (e) {}
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
    source = source.replace(/^\s*include\(.*\);\s*$/mg, "");
    (0, eval)(source);
}

// Core in CsAll's own order, so a file added there is picked up here
// without a second hand-written list to forget.
(function () {
    var f = new QFile(repoRoot + "/scripts/CaveSurvey/Core/CsAll.js");
    if (!f.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open CsAll.js");
    }
    var text = String((new QTextStream(f)).readAll());
    f.close();
    var lines = text.split("\n");
    for (var i = 0; i < lines.length; i++) {
        var m = /include\(includeBasePath \+ "\/([^"]+)"\);/.exec(lines[i]);
        if (m !== null) {
            loadRepoScript("scripts/CaveSurvey/Core/" + m[1]);
        }
    }
})();

var failures = [];
var checks = 0;
function check(name, condition) {
    checks++;
    if (condition !== true) { failures.push(name); }
}

// ---------------------------------------------------------------------
// A cave folder on disk, with a real scans/ and a real image in it.
// A relative scan path is only testable against a folder that EXISTS --
// CsCave.resolveUnderScans answers about real directories.
// ---------------------------------------------------------------------

var tmp = QDir.tempPath() + "/cave3d-drape-" + (new Date()).getTime();
var caveDir = tmp + "/TEST CAVE";
var scansDir = caveDir + "/scans/2024 Scans";
(new QDir()).mkpath(scansDir);

var REL = "2024 Scans/page one.png";
var imgPath = caveDir + "/scans/" + REL;
var made = new QImage(40, 30, QImage.Format_RGB32);
made.fill(0xFFFFFFFF);
check("fixture: a scan image is written", made.save(imgPath, "PNG"));

var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
var di = new RDocumentInterface(doc);
getDocument = function() { return doc; };
getDocumentInterface = function() { return di; };
doc.setFileName(caveDir + "/TEST CAVE.dxf");

CsLayers.ensure(doc, di, CsLayers.CTRL_SCAN);

// ---------------------------------------------------------------------
// One scan placed the way the suite places them: u and v PER PIXEL, and
// the path in XDATA relative to scans/.
// ---------------------------------------------------------------------

function addScan(relPath, layerName, originX, originY, perPixel) {
    var data = new RImageData(imgPath, new RVector(originX, originY),
        new RVector(perPixel, 0), new RVector(0, perPixel), 1.0);
    var e = new RImageEntity(doc, data);
    e.setLayerId(doc.getLayerId(layerName));
    // U AND V GO ON THROUGH PROPERTIES, not through the data. The
    // constructor's vectors do not stick: RImageEntity has no setData,
    // the entity does not forward setUVector/setVVector, and the object
    // getData() hands back is a copy. CsScanReanchor documents the same
    // thing from the other direction -- this fixture hit it too, and a
    // fixture that quietly built a zero-sized scan would have been
    // testing nothing.
    e.setProperty(RImageEntity.PropertyUX, perPixel);
    e.setProperty(RImageEntity.PropertyUY, 0);
    e.setProperty(RImageEntity.PropertyVX, 0);
    e.setProperty(RImageEntity.PropertyVY, perPixel);
    e.setInsertionPoint(new RVector(originX, originY));
    if (relPath !== null) {
        CsTags.set(e, CsDrape.PATH_TAG, relPath);
    }
    di.applyOperation(new RAddObjectOperation(e, false));
    return e;
}

addScan(REL, CsLayers.CTRL_SCAN, 0, 0, 0.25);
// A scan whose file is gone: skipped, never drawn as a blank quad.
addScan("2024 Scans/not there.png", CsLayers.CTRL_SCAN, 100, 100, 0.25);
// A scan with no path tag at all: also skipped.
addScan(null, CsLayers.CTRL_SCAN, 200, 200, 0.25);

var found = CsDrape.readScans(doc, "plan");
check("exactly one scan is readable -- a missing file and an untagged " +
    "image are both skipped (" + found.length + ")", found.length === 1);

if (found.length === 1) {
    var sc = found[0];
    check("its path resolved under scans/",
        sc.path.indexOf("page one.png") >= 0);
    check("its pixel size came from the FILE, not the entity (" +
        sc.widthPx + "x" + sc.heightPx + ")",
        sc.widthPx === 40 && sc.heightPx === 30);
    // u and v are per pixel, so the quad spans the whole image.
    check("the quad spans the whole image across (" + sc.quad.u.x + ")",
        Math.abs(sc.quad.u.x - 40 * 0.25) < 1e-9);
    check("and the whole image down (" + sc.quad.v.y + ")",
        Math.abs(sc.quad.v.y - 30 * 0.25) < 1e-9);

    // ---- draping it onto a survey ----
    var survey = CsModel.newSurvey();
    survey.distanceUnit = "ft";
    survey.shots = [
        { from: "A1", to: "A2", distance: 10, azimuth: 90, inclination: 30,
          left: 2, right: 2, up: 3, down: 1, splay: false, trip: 0 }
    ];
    CsModel.ensureTrips(survey);
    var resolved = CsNetwork.resolve(survey);
    var g = CsDrape.grid(sc.quad, 8, resolved.stations);

    check("the scan drapes into a grid", g.positions.length > 0);
    check("one uv per vertex",
        g.uvs.length / 2 === g.positions.length / 3);

    var bad = 0;
    for (var i = 0; i < g.positions.length; i++) {
        if (!isFinite(g.positions[i])) { bad++; }
    }
    check("no NaN in the draped grid", bad === 0);

    var maxIdx = g.positions.length / 3;
    var oob = 0;
    for (var j = 0; j < g.indices.length; j++) {
        if (g.indices[j] < 0 || g.indices[j] >= maxIdx) { oob++; }
    }
    check("every index addresses a vertex that exists", oob === 0);

    // The shot climbs, so the drape must not come back flat -- that is
    // the whole point of sampling rather than picking one elevation.
    var zs = [];
    for (var k = 2; k < g.positions.length; k += 3) { zs.push(g.positions[k]); }
    var zMin = Math.min.apply(null, zs), zMax = Math.max.apply(null, zs);
    check("the drape follows a climbing passage rather than lying flat (" +
        zMin.toFixed(2) + ".." + zMax.toFixed(2) + ")", zMax - zMin > 1e-6);
}

// A kind with no scans answers empty rather than throwing.
check("a kind with no scans reads empty",
    CsDrape.readScans(doc, "profile").length === 0);

// ---------------------------------------------------------------------

(new QDir(tmp)).removeRecursively();

if (failures.length > 0) {
    print("### CAVE3D DRAPE FAIL");
    for (var fi = 0; fi < failures.length; fi++) {
        print("  " + failures[fi]);
    }
} else {
    print("### CAVE3D DRAPE OK " + checks + " checks");
}
