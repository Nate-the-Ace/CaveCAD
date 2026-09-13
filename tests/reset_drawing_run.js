// reset_drawing_run.js -- Reset Drawing against a real document.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/reset_drawing_run.js "$PWD"
//
// Prints "### RESET DRAWING OK <n>" or "### RESET DRAWING FAIL".
//
// What CsReset's unit tests cannot prove, because they never hold a
// document: that the entities actually GO, that the images actually
// STAY with their file references intact, that a locked or switched-off
// layer does not silently keep what was on it, and that the
// georeference survives the loss of the station that was carrying it.
//
// THE LOCKED-LAYER CASE IS THE POINT OF THIS FILE. Off, frozen and
// locked layers refuse deletes in this build without a word, so a reset
// that did not reach through them would report "412 deleted" and leave
// the drawing holding whatever had been protected -- the same hole that
// once shipped a sanitized package with the aerial photograph still in
// it.

include("scripts/simple.js");

createSpatialIndex = function() {
    return new RSpatialIndexNavel();
};

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");

// The tool itself, not a copy of its shape: include() dedupes by
// basename, so its own re-include of CsAll.js is a no-op.
include("scripts/EAction.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/ResetDrawing";
include(includeBasePath + "/ResetDrawing.js");

var passed = 0;
var failures = [];
function ok(condition, what) {
    if (condition) {
        passed++;
    } else {
        failures.push(what);
    }
}

// ---------------------------------------------------------------------
// A cave folder on disk, with one scanned page in it, and a drawing
// that sits in it.
// ---------------------------------------------------------------------
var caveDir = QDir.tempPath() + "/cs_reset_test";
var scansDir = caveDir + "/" + CsCave.SCANS;
new QDir(caveDir).removeRecursively();
new QDir().mkpath(scansDir);

var page = new QImage(200, 300, QImage.Format_RGB32);
page.fill(new QColor(255, 255, 255));
var pageRel = "Trip 1/page one.png";
new QDir().mkpath(scansDir + "/Trip 1");
ok(page.save(scansDir + "/" + pageRel, "PNG"), "the test page was written");

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
doc.setFileName(caveDir + "/Reset Test Cave.dxf");
getDocument = function() { return doc; };
getDocumentInterface = function() { return di; };

ok(ResetDrawing.caveFolderOf(caveDir + "/Reset Test Cave.dxf") === caveDir,
    "a drawing beside a scans/ folder is in a cave project");
ok(ResetDrawing.caveFolderOf(QDir.tempPath() + "/loose.dxf") === null,
    "a drawing with no scans/ beside it is not, and the tool refuses it");

// ---------------------------------------------------------------------
// A survey, a scan, an aerial, some drawn linework, and one wall on a
// LOCKED layer.
// ---------------------------------------------------------------------
function shotOf(from, to, d, az, inc) {
    var s = CsModel.newShot();
    s.from = from; s.to = to;
    s.distance = d; s.azimuth = az; s.inclination = inc || 0;
    return s;
}
var survey = CsModel.newSurvey();
survey.caveName = "RESET TEST CAVE";
survey.distanceUnit = "ft";
survey.shots.push(shotOf("ENT", "A1", 30.0, 90.0, -5.0));
survey.shots.push(shotOf("A1", "A2", 22.0, 45.0, 0.0));
CsDraw.survey(survey, CsNetwork.resolve(survey, {}));

CsLayers.ensure(doc, di, CsLayers.CTRL_SCAN);
CsLayers.ensure(doc, di, CsLayers.CTRL_AERIAL);
CsLayers.ensure(doc, di, CsLayers.WALLS_SURVEYED);

var addOp = new RAddObjectsOperation();

var scan = new RImageEntity(doc, new RImageData());
scan.setProperty(RImageEntity.PropertyFileName, scansDir + "/" + pageRel);
scan.setProperty(RImageEntity.PropertyUX, 1.0);
scan.setProperty(RImageEntity.PropertyUY, 0.0);
scan.setProperty(RImageEntity.PropertyVX, 0.0);
scan.setProperty(RImageEntity.PropertyVY, 1.0);
scan.setLayerId(doc.getLayerId(CsLayers.CTRL_SCAN));
CsTags.set(scan, "SketchScan", pageRel);
addOp.addObject(scan, false);

var aerial = new RImageEntity(doc, new RImageData());
aerial.setProperty(RImageEntity.PropertyFileName, scansDir + "/" + pageRel);
aerial.setLayerId(doc.getLayerId(CsLayers.CTRL_AERIAL));
addOp.addObject(aerial, false);

// A line somebody drew ON the scan layer. Not a scan: it goes.
var stray = new RLineEntity(doc,
    new RLineData(new RVector(0, 0), new RVector(5, 5)));
stray.setLayerId(doc.getLayerId(CsLayers.CTRL_SCAN));
addOp.addObject(stray, false);

var wall = new RLineEntity(doc,
    new RLineData(new RVector(10, 0), new RVector(10, 20)));
wall.setLayerId(doc.getLayerId(CsLayers.WALLS_SURVEYED));
addOp.addObject(wall, false);

di.applyOperation(addOp);

// The wall's layer is LOCKED and the aerial's is OFF, which is how a
// real drawing arrives: CTRL-AERIAL ships off.
var lockOp = new RModifyObjectsOperation();
var wallLayer = doc.queryLayer(CsLayers.WALLS_SURVEYED);
wallLayer.setLocked(true);
lockOp.addObject(wallLayer, false);
var aerialLayer = doc.queryLayer(CsLayers.CTRL_AERIAL);
aerialLayer.setOff(true);
lockOp.addObject(aerialLayer, false);
di.applyOperation(lockOp);

// A georeference, on the anchor station -- where one really rides.
var stationIds = doc.queryAllEntities(false, false, RS.EntityPoint);
var anchorEntity = null;
for (var s0 = 0; s0 < stationIds.length; s0++) {
    var cand = doc.queryEntity(stationIds[s0]);
    if (!isNull(cand) && CsTags.get(cand, "Station") !== "") {
        anchorEntity = cand;
        break;
    }
}
ok(anchorEntity !== null, "the fixture has a station to georeference");
var anchorPos = anchorEntity.getPosition();
CsTags.commit(di, anchorEntity, {
    GeoLat: 34.5, GeoLon: -85.25, GeoStation: "ENT",
    GeoDrawX: anchorPos.x, GeoDrawY: anchorPos.y
});
ok(CsLocationPick.anchorRecord(doc) !== null,
    "and the drawing answers with it");

// ---------------------------------------------------------------------
// Reset.
// ---------------------------------------------------------------------
var split = ResetDrawing.classify(doc);
ok(split.counts.images === 2, "both images are counted as kept");
ok(split.counts.total > 4, "and the rest as doomed (" +
    split.counts.total + ")");

var anchor = CsLocationPick.anchorRecord(doc);
var carrier = CsReset.carrierFrom(anchor);
ResetDrawing.withEveryLayerEditable(doc, di, function() {
    ResetDrawing.deleteAll(doc, di, split.ids);
    ResetDrawing.placeCarrier(doc, di, carrier);
});
CsRestyle.ensureAndApply(doc, di);

// -- what stayed -------------------------------------------------------
var images = doc.queryAllEntities(false, false, RS.EntityImage);
ok(images.length === 2, "both images are still in the drawing");
var stillLinked = 0;
for (var i = 0; i < images.length; i++) {
    var img = doc.queryEntity(images[i]);
    if (String(img.getProperty(RImageEntity.PropertyFileName)[0]) !== "") {
        stillLinked++;
    }
}
ok(stillLinked === 2, "with their file references untouched -- the reset " +
    "never rebuilds an IMAGEDEF, which is how scans lose their paths");

var after = CsLocationPick.anchorRecord(doc);
ok(after !== null, "the cave's location survived the station that held it");
ok(after !== null && Math.abs(after.lat - 34.5) < 1e-9 &&
    Math.abs(after.lon + 85.25) < 1e-9, "unchanged");
ok(after !== null && Math.abs(after.pos.x - anchorPos.x) < 1e-9 &&
    Math.abs(after.pos.y - anchorPos.y) < 1e-9,
    "and sitting exactly where it was pinned, so nothing downstream " +
        "reads it as a station that has moved");
ok(after !== null && CsLocationPick.isCarrier(after.entity),
    "it is on a marked carrier, not pretending to be a station");

// -- what went ---------------------------------------------------------
var left = doc.queryAllEntities(false, false);
var nonImage = 0;
for (var j = 0; j < left.length; j++) {
    var e = doc.queryEntity(left[j]);
    if (isNull(e)) {
        continue;
    }
    if (!isImageEntity(e) && !CsLocationPick.isCarrier(e)) {
        nonImage++;
    }
}
ok(nonImage === 0, "nothing else is left -- including the wall on the " +
    "LOCKED layer and the line drawn on the scan layer (" + nonImage +
    " survived)");

ok(doc.queryLayer(CsLayers.WALLS_SURVEYED).isLocked() === true,
    "the locked layer is locked again afterwards");
ok(doc.queryLayer(CsLayers.CTRL_AERIAL).isOff() === true,
    "and the layer that ships off is off again");

// -- a real anchor beats the carrier ----------------------------------
CsDraw.survey(survey, CsNetwork.resolve(survey, {}));
var reStations = doc.queryAllEntities(false, false, RS.EntityPoint);
var reAnchor = null;
for (var k = 0; k < reStations.length; k++) {
    var c2 = doc.queryEntity(reStations[k]);
    if (!isNull(c2) && CsTags.get(c2, "Station") === "ENT") {
        reAnchor = c2;
        break;
    }
}
if (reAnchor !== null) {
    CsTags.commit(di, reAnchor, { GeoLat: 30.0, GeoLon: -80.0,
        GeoStation: "ENT" });
}
var both = CsLocationPick.anchorRecord(doc);
ok(both !== null && !CsLocationPick.isCarrier(both.entity),
    "with a survey imported again, the real anchor station wins and the " +
        "carrier steps aside");
ok(both !== null && Math.abs(both.lat - 30.0) < 1e-9,
    "so the coordinate read back is the station's, not the carrier's");

// -- a second reset leaves ONE carrier, not two -----------------------
var split2 = ResetDrawing.classify(doc);
var anchor2 = CsLocationPick.anchorRecord(doc);
ResetDrawing.withEveryLayerEditable(doc, di, function() {
    ResetDrawing.deleteAll(doc, di, split2.ids);
    ResetDrawing.placeCarrier(doc, di, CsReset.carrierFrom(anchor2));
});
var carriers = 0;
var left2 = doc.queryAllEntities(false, false);
for (var m = 0; m < left2.length; m++) {
    var e2 = doc.queryEntity(left2[m]);
    if (!isNull(e2) && CsLocationPick.isCarrier(e2)) {
        carriers++;
    }
}
ok(carriers === 1, "resetting twice leaves one carrier, not two (" +
    carriers + ")");

new QDir(caveDir).removeRecursively();

var out;
if (failures.length === 0) {
    out = "### RESET DRAWING OK " + passed + " assertions";
} else {
    out = "### RESET DRAWING FAIL " + failures.length + " of " +
        (passed + failures.length) + "\n";
    for (var f = 0; f < failures.length; f++) {
        out += "  FAIL: " + failures[f] + "\n";
    }
}
print(out);
