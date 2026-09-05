// scan_rotate_run.js -- turning a scanned page on disk.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/scan_rotate_run.js "$PWD"
//
// Prints "### SCAN ROTATE OK" / "### SCAN ROTATE FAIL".
//
// WHY A REAL IMAGE ON DISK. The whole mechanism is QImage.transformed
// and a save-then-rename over the original. Nothing about a stub can
// tell a clockwise quarter turn from an anticlockwise one, and nothing
// about a size check can tell whether the page survived the swap: the
// test follows ONE MARKED PIXEL through the turn, and checks the file
// is still readable and still named what the drawing references.

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
["CsScanTrim", "CsScanRotate"].forEach(function(m) {
    loadRepoScript("scripts/CaveSurvey/Core/" + m + ".js");
});

var failures = [], checks = 0;
function check(name, cond) {
    checks++;
    if (cond !== true) { failures.push(name); }
}

// --- a throwaway cave with one sideways page ------------------------
var tmp = String(QDir.tempPath()) + "/cs-scan-rotate-" +
    String(new Date().getTime());
var scans = tmp + "/Scans";
new QDir().mkpath(scans + "/Trip3");

var pxW = 600, pxH = 400;
var page = new QImage(pxW, pxH, QImage.Format_RGB32);
page.fill(0xffffffff);
// One black pixel near the top-left, far from any axis of symmetry: a
// quarter turn clockwise takes (x, y) to (H-1-y, x), and NOTHING ELSE
// takes it there -- an anticlockwise turn or a mirror lands elsewhere.
page.setPixelColor(50, 20, new QColor(0, 0, 0));
var rel = "Trip3/IMG_4021.png";
var pagePath = scans + "/" + rel;
check("the test page saved", page.save(pagePath, "PNG"));

// A crop of the page as it was, which the turn must take with it.
var stale = CsScanTrim.write(scans, rel, { x: 10, y: 10, w: 100, h: 100 });
check("the stale crop was written", stale.error === null);

// --- the turn --------------------------------------------------------
var out = CsScanRotate.turn(scans, rel);
check("turn reports ok", out.ok === true);
check("the page kept its own name", new QFileInfo(pagePath).exists());
check("and no staging file was left behind",
    !new QFileInfo(pagePath + CsScanRotate.TEMP_SUFFIX).exists());

var turned = new QImage(pagePath);
check("the turned page is readable", !turned.isNull());
check("the sides swapped: width is the old height",
    turned.width() === pxH);
check("and height is the old width", turned.height() === pxW);
check("turn reports the new size", out.w === pxH && out.h === pxW);
// THE DIRECTION, from the marker.
check("the marked pixel landed where a CLOCKWISE turn puts it",
    String(turned.pixelColor(pxH - 1 - 20, 50).name()) === "#000000");
check("and not where an anticlockwise turn would",
    String(turned.pixelColor(20, pxW - 1 - 50).name()) === "#ffffff");

// --- the crops that no longer mean anything --------------------------
check("the stale crop is gone", !new QFileInfo(stale.path).exists());

// A second page's crop is NOT collateral.
var other = "Trip3/IMG_4022.png";
check("the second page saved", page.save(scans + "/" + other, "PNG"));
var keep = CsScanTrim.write(scans, other, { x: 5, y: 5, w: 50, h: 50 });
CsScanRotate.turn(scans, rel);
check("another page's crop survives the first page's turn",
    new QFileInfo(keep.path).exists());

// --- four turns come home --------------------------------------------
CsScanRotate.turn(scans, rel);
CsScanRotate.turn(scans, rel);
var round = new QImage(pagePath);
check("four quarter turns restore the page's shape",
    round.width() === pxW && round.height() === pxH);
check("and the marker is back where it started",
    String(round.pixelColor(50, 20).name()) === "#000000");

// --- what it refuses --------------------------------------------------
var missing = CsScanRotate.turn(scans, "Trip3/does-not-exist.png");
check("a page that is not there does not turn", missing.ok === false);
check("and the error names it",
    String(missing.error).indexOf("does-not-exist") >= 0);

var odd = scans + "/Trip3/notes.xcf";
var f = new QFile(odd);
f.open(QIODevice.WriteOnly);
f.close();
var refused = CsScanRotate.turn(scans, "Trip3/notes.xcf");
check("a format this suite will not write is refused",
    refused.ok === false);
check("the refusal names the extension",
    String(refused.error).indexOf(".xcf") >= 0);
check("and the file is still there, untouched",
    new QFileInfo(odd).exists());

// --- the writable-format gate, against Qt's real answer ---------------
var formats = CsScanRotate.writableFormats();
check("Qt reports writable formats here", formats.length > 0);
check("PNG is one of them", CsScanRotate.canWrite("PNG", formats));
check("and a made-up one is not",
    CsScanRotate.canWrite("XCF", formats) === false);

if (failures.length === 0) {
    print("### SCAN ROTATE OK " + checks);
} else {
    for (var i = 0; i < failures.length; i++) { print("FAIL: " + failures[i]); }
    print("### SCAN ROTATE FAIL " + failures.length + " of " + checks);
}
