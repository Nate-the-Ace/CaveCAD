// package_cave.js -- Package Cave Project against real files.
//
//   /Applications/CaveCAD.app/Contents/MacOS/CaveCAD \
//       -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/package_cave.js "$PWD"
//
// What only a real run can show: that the sanitized copy actually
// LOSES the geographic anchor while keeping the survey (both survive a
// DXF round trip as XDATA, so a strip that silently did nothing would
// look identical from the outside), that the full copy keeps it, and
// that the platform's own zip program really produces an archive.
//
// Prints "### PACKAGE CAVE OK <n>" or "### PACKAGE CAVE FAIL".

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
    // Indirect eval, so the Cs* globals outlive this function -- see
    // tests/callout_write.js, which documents the failure the direct
    // form causes.
    (0, eval)(src);
}

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try {
            if (typeof v.isNull === "function") { return v.isNull(); }
        } catch (e) {
        }
        return false;
    };
}
if (typeof isFunction === "undefined") {
    isFunction = function(v) { return typeof v === "function"; };
}

var FILES = [
    "scripts/CaveSurvey/Core/CsUuid.js",
    "scripts/CaveSurvey/Core/CsUnits.js",
    "scripts/CaveSurvey/Core/CsCave.js",
    "scripts/CaveSurvey/Core/CsShelf.js",
    "scripts/CaveSurvey/Core/CsPackage.js",
    "scripts/CaveSurvey/Core/CsGeoProject.js",
    "scripts/CaveSurvey/Core/CsTags.js",
    "scripts/CaveSurvey/Core/CsStore.js",
    "scripts/CaveSurvey/PackageCave/PackageCave.js"
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

// ---------------------------------------------------------------------
// A cave folder, built for real in the temp directory.
// ---------------------------------------------------------------------

var root = QDir.tempPath() + "/CaveCADPackageTest";
try {
    if ((new QDir(root)).exists()) { (new QDir(root)).removeRecursively(); }
} catch (eWipe) {
}

var caveFolder = root + "/PITFALL CAVE";
var stagingFolder = root + "/staging/PITFALL CAVE";
ok((new QDir()).mkpath(caveFolder), "made a cave folder");
ok((new QDir()).mkpath(caveFolder + "/PDF"), "made its PDF folder");
ok((new QDir()).mkpath(caveFolder + "/scans"), "made its scans folder");
ok((new QDir()).mkpath(stagingFolder), "made a staging folder");

// A drawing carrying both survey data and the entrance location.
var drawingPath = caveFolder + "/Pitfall Cave.dxf";
var di = new RDocumentInterface(new RDocument(new RMemoryStorage(),
                                              new RSpatialIndexNavel()));
var doc = di.getDocument();
getDocument = function() { return doc; };

var station = new RPointEntity(doc, new RPointData(new RVector(0, 0, 0)));
CsTags.set(station, "Station", "A1");
CsTags.set(station, "GeoLat", "38.123456");
CsTags.set(station, "GeoLon", "-86.654321");
CsTags.set(station, "GeoStation", "A1");
var addOp = new RAddObjectsOperation();
addOp.addObject(station, false);
di.applyOperation(addOp);

var filter = PackageCave.dxfFilter();
ok(filter !== "", "found the dxflib exporter, the one that writes XDATA");
ok(di.exportFile(drawingPath, filter), "wrote the cave's drawing");
destr(di);

// A plotted map and a sketch, so the collectors have something to find.
writeTextFile(caveFolder + "/PDF/Pitfall Cave plan.pdf", "%PDF-1.4 not really");
writeTextFile(caveFolder + "/scans/trip1-p1.txt", "sketch stand-in");

// ---------------------------------------------------------------------
// The registry finds the drawing, and the PDF folder.
// ---------------------------------------------------------------------

var record = CsShelf.recordFor(caveFolder);
ok(record !== null, "built a record for the cave folder");
eqs(record.name, "PITFALL CAVE", "the cave is named after its folder");
eqs(record.drawing, drawingPath, "picked the drawing out of the folder");
eqs(CsCave.pdfFiles(caveFolder).length, 1, "found the map in PDF/");

// ---------------------------------------------------------------------
// Sanitized loses the anchor; full keeps it.
// ---------------------------------------------------------------------

function geoTagsIn(path) {
    var readDi = new RDocumentInterface(new RDocument(new RMemoryStorage(),
                                                      new RSpatialIndexNavel()));
    var found = { geo: 0, stations: 0 };
    try {
        if (readDi.importFile(path, "", false) !==
                RDocumentInterface.IoErrorNoError) {
            return found;
        }
        var readDoc = readDi.getDocument();
        var ids = readDoc.queryAllEntities(false, false);
        for (var i = 0; i < ids.length; i++) {
            var e = readDoc.queryEntity(ids[i]);
            if (isNull(e)) { continue; }
            if (CsTags.get(e, "Station") !== null &&
                    CsTags.get(e, "Station") !== undefined) {
                found.stations++;
            }
            for (var t = 0; t < CsPackage.GEO_TAGS.length; t++) {
                var v = CsTags.get(e, CsPackage.GEO_TAGS[t]);
                if (v !== null && v !== undefined && v !== "") { found.geo++; }
            }
        }
    } finally {
        destr(readDi);
    }
    return found;
}

// The fixture itself must carry what we are about to strip, or the
// test proves nothing.
var before = geoTagsIn(drawingPath);
eqs(before.geo, 3, "the original drawing carries all three geo tags");
eqs(before.stations, 1, "the original drawing carries its station");

var sanitized = PackageCave.stageDrawing(record, stagingFolder, false);
ok(sanitized.ok, "staged a sanitized drawing: " + sanitized.error);
eqs(sanitized.stripped, 1, "stripped the anchor from one station");
var after = geoTagsIn(stagingFolder + "/Pitfall Cave.dxf");
eqs(after.geo, 0, "the sanitized copy carries no geographic anchor");
eqs(after.stations, 1, "the sanitized copy still carries the survey");

// The original is untouched -- the whole reason sanitizing happens on a
// copy in memory.
eqs(geoTagsIn(drawingPath).geo, 3, "the original drawing is unchanged");

var fullFolder = root + "/staging-full/PITFALL CAVE";
ok((new QDir()).mkpath(fullFolder), "made a second staging folder");
var full = PackageCave.stageDrawing(record, fullFolder, true);
ok(full.ok, "staged a full copy: " + full.error);
eqs(geoTagsIn(fullFolder + "/Pitfall Cave.dxf").geo, 3,
    "the full archive keeps the anchor");

// ---------------------------------------------------------------------
// Photographs: the metadata has to be gone, and the picture still there.
// ---------------------------------------------------------------------

var imagesFolder = caveFolder + "/images";
ok((new QDir()).mkpath(imagesFolder), "made the cave's images folder");

// A real JPEG carrying real GPS EXIF (testdata/exif-gps-sample.jpg,
// built by hand: an APP1 segment with a GPS IFD). Testing the strip
// against a picture with nothing to strip would prove nothing.
var exifSource = repoRoot + "/testdata/exif-gps-sample.jpg";
ok((new QFileInfo(exifSource)).exists(), "the EXIF fixture is present");
ok((new QFile(exifSource)).copy(imagesFolder + "/entrance.jpg"),
    "put a photograph in the cave");
// The generated map preview lives in the same folder and must never be
// packaged: the drawing it pictures is already in the archive.
writeTextFile(imagesFolder + "/Pitfall Cave preview.png", "not a photograph");

// Searched with grep rather than by reading the bytes here: QFile's
// readAll() hands this engine a QByteArray whose size() is 0 and whose
// indexOf() is undefined, so a byte search written that way silently
// answers "found" for everything -- which is how a broken strip would
// have passed this very test.
function fileHas(path, needle) {
    var process = new QProcess();
    process.start("/usr/bin/grep", ["-c", "-a", needle, path]);
    if (!process.waitForFinished(10000)) {
        process.kill();
        return false;
    }
    // The EXIT CODE, not the output: grep answers 0 when it found the
    // needle and 1 when it did not, while readAllStandardOutput() hands
    // this engine an object whose String() is a description rather than
    // the bytes -- parse that and every answer is "found".
    return process.exitCode() === 0;
}

eqs(CsCave.imageFiles(caveFolder).length, 1,
    "the preview is not counted as a photograph");
ok(fileHas(imagesFolder + "/entrance.jpg", "Exif"),
    "the photograph really does carry EXIF before packaging");

var photoStage = root + "/staging/PITFALL CAVE/images";
var photoResult = PackageCave.copyPhotosStripped(
    CsCave.imageFiles(caveFolder), photoStage);
eqs(photoResult.copied, 1, "the photograph was packaged");
eqs(photoResult.skipped.length, 0, "nothing had to be left out");

var packed = photoStage + "/entrance.jpg";
ok((new QFileInfo(packed)).exists(), "the stripped photograph exists");
ok(!fileHas(packed, "Exif"), "no EXIF marker survives packaging");
ok(!fileHas(packed, "GPS"), "no GPS block survives packaging");

// Stripped, not destroyed: it still has to BE the photograph.
var packedImage = new QImageReader(packed).read();
ok(!isNull(packedImage) && !packedImage.isNull(),
    "the packaged photograph is still a readable image");
eqs(packedImage.width(), 16, "same width as the original");
eqs(packedImage.height(), 16, "same height as the original");

// ---------------------------------------------------------------------
// The platform's own zip program really makes an archive.
// ---------------------------------------------------------------------

writeTextFile(stagingFolder + "/MANIFEST.txt",
    CsPackage.manifest({ caveName: "PITFALL CAVE", date: "2026-08-24",
        full: false, contents: [{ path: "Pitfall Cave.dxf", note: "the drawing" }] }));

var zipPath = root + "/" + CsPackage.archiveName("PITFALL CAVE", "2026-08-24", false);
var command = CsPackage.zipCommand(RS.getSystemId(), root + "/staging",
    "PITFALL CAVE", zipPath);
var zipped = PackageCave.runZip(command);
ok(zipped.ok, "the platform's zip program ran: " + zipped.error);
ok((new QFileInfo(zipPath)).exists(), "an archive exists where it was asked for");
ok((new QFileInfo(zipPath)).size() > 0, "the archive is not empty");

try {
    (new QDir(root)).removeRecursively();
} catch (eClean) {
}

var out;
if (failures.length === 0) {
    out = "### PACKAGE CAVE OK " + passed;
} else {
    out = "### PACKAGE CAVE FAIL " + failures.length + " of " +
        (passed + failures.length) + "\n";
    for (var i = 0; i < failures.length; i++) {
        out += "  FAIL: " + failures[i] + "\n";
    }
}
print(out);
