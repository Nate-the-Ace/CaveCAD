// tests/js_syntax.js
//
// Syntax-checks every script in the CaveSurvey add-on using QCAD's own
// ECMAScript engine -- the same engine that will run them, so this catches
// anything that engine won't accept, not just anything a different parser
// wouldn't.
//
// Only the differential test actually exercises ImportNativeCaveSurvey's
// parsers; the other five files (CaveSurvey, AzimuthTraverse, LRUDWalls,
// ScatterBreakdown, GeoAnchor) are interactive or GUI-bound and can't be run
// headless at all. A syntax error in one of those otherwise shows up as a tool
// silently missing from the menu, which is a miserable thing to debug.
//
// Each file is wrapped in a function expression and eval'd. That parses the
// whole source without executing any of it, so no dialog opens and nothing
// touches RMainWindowQt.
//
//   /Applications/QCAD.app/Contents/Resources/qcad \
//       -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/js_syntax.js <repo-root>

function readWhole(path) {
    var f = new QFile(path);
    if (!f.open(QIODevice.ReadOnly | QIODevice.Text)) {
        return null;
    }
    var text = new QTextStream(f).readAll();
    f.close();
    return text;
}

function findRepoRoot() {
    var args = RSettings.getOriginalArguments();
    for (var i = args.length - 1; i >= 0; i--) {
        var dir = ("" + args[i]).replace(/\/+$/, "") + "/";
        if (new QFileInfo(dir + "scripts/CaveSurvey/CaveSurvey.js").exists()) {
            return new QFileInfo(dir).absoluteFilePath() + "/";
        }
    }
    return null;
}

var TOOLS = [
    "CaveSurvey.js",
    "AzimuthTraverse/AzimuthTraverse.js",
    "ImportNativeCaveSurvey/ImportNativeCaveSurvey.js",
    "LRUDWalls/LRUDWalls.js",
    "ScatterBreakdown/ScatterBreakdown.js",
    "GeoAnchor/GeoAnchor.js"
];

var repo = findRepoRoot();
if (repo === null) {
    print("### ERROR repo root not found -- pass it as the last argument");
} else {
    var failures = 0;
    for (var i = 0; i < TOOLS.length; i++) {
        var rel = "scripts/CaveSurvey/" + TOOLS[i];
        var src = readWhole(repo + rel);
        if (src === null) {
            print("FAIL  " + rel + " -- cannot read");
            failures++;
            continue;
        }
        try {
            // Parses without running. The wrapper is never called.
            eval("(function(){" + src + "\n})");
            print("ok    " + rel);
        } catch (e) {
            print("FAIL  " + rel + " -- " + e);
            failures++;
        }
    }
    print("### " + (TOOLS.length - failures) + "/" + TOOLS.length + " parsed");
    print(failures === 0 ? "### SYNTAX OK" : "### SYNTAX FAILURES");
}
