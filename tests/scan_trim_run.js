// scan_trim_run.js -- trimming a scanned page to one sketch.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/scan_trim_run.js "$PWD"
//
// Prints "### SCAN TRIM OK" / "### SCAN TRIM FAIL".
//
// WHY A REAL IMAGE ON DISK. The whole mechanism is QImage.copy and a
// saved PNG. A stub would prove the filename arithmetic and nothing
// about the pixels, and an off-by-one in the crop origin passes every
// size check while ruining every placement.

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
if (typeof createSpatialIndex === "undefined") {
    createSpatialIndex = function() { return new RSpatialIndexNavel(); };
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
["CsUuid", "CsUnits", "CsAngles", "CsCave", "CsScanTree", "CsStore",
 "CsTags", "CsLayers", "CsStationOrder", "CsScanFit", "CsScanFrame",
 "CsScanTrim"].forEach(function(m) {
    loadRepoScript("scripts/CaveSurvey/Core/" + m + ".js");
});

// SketchScans.js is a GUI tool: its top level does
// `SketchScans.prototype = new EAction();`. align_image_frame.js has the
// same problem with Transform and solves it the same way -- a stub
// underneath, loaded first. Only imageFiles, insert and insertFitted are
// exercised here.
if (typeof EAction === "undefined") {
    EAction = function() {};
    EAction.prototype = {};
    EAction.getDocument = function() { return null; };
    EAction.getDocumentInterface = function() { return null; };
    EAction.handleUserMessage = function() {};
}
if (typeof warning === "undefined") {
    warning = function(msg) { print("WARNING: " + msg); };
}
if (typeof qsTr === "undefined") {
    qsTr = function(s) { return s; };
}
if (typeof isNumber === "undefined") {
    isNumber = function(v) { return typeof v === "number" && !isNaN(v); };
}
loadRepoScript("scripts/CaveSurvey/SketchScans/SketchScans.js");

var failures = [], checks = 0;
function check(name, cond) {
    checks++;
    if (cond !== true) { failures.push(name); }
}

// --- a throwaway cave with one scanned page -------------------------
var tmp = String(QDir.tempPath()) + "/cs-scan-trim-" +
    String(new Date().getTime());
var scans = tmp + "/Scans";
new QDir().mkpath(scans + "/Trip3");

var pxW = 600, pxH = 400;
var page = new QImage(pxW, pxH, QImage.Format_RGB32);
page.fill(0xffffffff);
// A single black marker pixel at column 250, row 120 -- inside the box
// the test cuts, 50 columns and 20 rows in from its corner.
page.setPixelColor(250, 120, new QColor(0, 0, 0));
var pagePath = scans + "/Trip3/IMG_4021.png";
check("the test page saved", page.save(pagePath, "PNG"));

// --- the crop -------------------------------------------------------
var rect = { x: 200, y: 100, w: 300, h: 200 };
var out = CsScanTrim.write(scans, "Trip3/IMG_4021.png", rect);
check("write reports no error", out.error === null);
check("the derivative exists", new QFileInfo(out.path).exists());
check("the derivative is named for its box",
    String(new QFileInfo(out.path).fileName()) ===
    "IMG_4021__TRIMMED_x200_y100_w300_h200.png");
check("the derivative sits in Scans/Trimmed",
    String(out.path).indexOf("/Scans/Trimmed/") >= 0);

var cropped = new QImage(out.path);
check("the derivative is the box's width", cropped.width() === 300);
check("the derivative is the box's height", cropped.height() === 200);
// THE PIXELS, not just the size.
check("the marker pixel landed at the box-relative offset",
    String(cropped.pixelColor(50, 20).name()) === "#000000");
check("and its neighbour did not",
    String(cropped.pixelColor(51, 20).name()) === "#ffffff");

// --- reuse ----------------------------------------------------------
var firstStamp = String(new QFileInfo(out.path).lastModified().toString());
var again = CsScanTrim.write(scans, "Trip3/IMG_4021.png", rect);
check("the same box resolves to the same file", again.path === out.path);
check("an existing derivative is reused, not rewritten",
    String(new QFileInfo(again.path).lastModified().toString()) ===
    firstStamp);

// --- failures -------------------------------------------------------
var bad = CsScanTrim.write(scans, "Trip3/does-not-exist.png", rect);
check("an unreadable page yields no path", bad.path === null);
check("and the error names the file",
    String(bad.error).indexOf("does-not-exist") >= 0);

// --- the shelf filter, against real paths ---------------------------
var listed = SketchScans.imageFiles(scans);
var sawPage = false, sawTrim = false;
for (var i = 0; i < listed.length; i++) {
    if (listed[i] === "Trip3/IMG_4021.png") { sawPage = true; }
    if (CsScanTrim.isTrimPath(listed[i])) { sawTrim = true; }
}
check("the page is still listed", sawPage);
check("no derivative is listed", !sawTrim);

// --- placement -------------------------------------------------------
var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);

var trimmedId = SketchScans.insert(doc, di, out.path,
    "Trip3/IMG_4021.png", "plan", rect);
check("the trimmed scan placed", trimmedId !== null);
var placedEntity = isNull(trimmedId) ? null : doc.queryEntity(trimmedId);
check("SketchScan still names the PAGE, so the shelf can still tick it",
    placedEntity !== null &&
    CsTags.get(placedEntity, "SketchScan") === "Trip3/IMG_4021.png");
check("ScanTrim names the box in the page's own pixels",
    placedEntity !== null &&
    CsTags.get(placedEntity, CsScanTrim.TAG) === "200,100,300,200");
// PIXELS, NOT UNITS. RImageEntity.getWidth() answers the image's width
// in DRAWING UNITS, so the pixel count comes back out of it through the
// u vector -- one u per pixel column is how RImageData is built.
var placedU = placedEntity.getUVector();
var placedPx = Math.round(placedEntity.getWidth() /
    Math.sqrt(placedU.x * placedU.x + placedU.y * placedU.y));
check("the placed image is the box's pixel width", placedPx === 300);
check("and it points at the derivative, not the page",
    String(placedEntity.getData().getFileName()) === String(out.path));

// The whole-page path is untouched.
var wholeId = SketchScans.insert(doc, di, pagePath,
    "Trip3/IMG_4021.png", "plan");
check("the whole page placed", wholeId !== null);
check("a whole-page placement carries no ScanTrim tag",
    wholeId !== null &&
    CsTags.get(doc.queryEntity(wholeId), CsScanTrim.TAG) === "");

if (failures.length === 0) {
    print("### SCAN TRIM OK " + checks);
} else {
    for (var f = 0; f < failures.length; f++) { print("FAIL: " + failures[f]); }
    print("### SCAN TRIM FAIL " + failures.length + " of " + checks);
}
