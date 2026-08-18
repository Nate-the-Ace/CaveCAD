// tests/js_parsers.js
//
// Headless test harness for ImportNativeCaveSurvey.js's format parsers.
//
// Runs inside QCAD's own script engine -- the same engine the real tool runs
// in -- but with no GUI and no dialogs, so the parsers can be checked from a
// terminal or CI. Output is a flat machine-readable dump consumed by
// tests/differential.py.
//
// Run it via the launcher bundled inside QCAD.app (works even while the
// QCAD GUI is open, thanks to -allow-multiple-instances):
//
//   /Applications/QCAD.app/Contents/Resources/qcad \
//       -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/js_parsers.js <repo-root>
//
// See tests/README.md. Note qApp.quit() does not exist in this build; the
// process exits on its own once the script returns.

include("scripts/simple.js");

function readWhole(path) {
    var f = new QFile(path);
    if (!f.open(QIODevice.ReadOnly | QIODevice.Text)) {
        print("### ERROR cannot open " + path);
        return null;
    }
    var text = new QTextStream(f).readAll();
    f.close();
    return text;
}

// The repo root must be passed explicitly: under -autostart the process cwd is
// QCAD.app's own Resources directory, not wherever you invoked it from, so
// relative paths are useless here. Note QCoreApplication.arguments() is not
// wrapped in this build -- RSettings.getOriginalArguments() is.
function findRepoRoot() {
    var args = RSettings.getOriginalArguments();
    var candidates = [];
    for (var i = args.length - 1; i >= 0; i--) {
        candidates.push("" + args[i]);
        // ...and, as a fallback, the parent of the script's own directory,
        // since this file lives in <repo>/tests/.
        if (("" + args[i]).indexOf("js_parsers.js") >= 0) {
            candidates.push(new QFileInfo("" + args[i]).absolutePath() + "/..");
        }
    }
    for (var c = 0; c < candidates.length; c++) {
        var dir = candidates[c].replace(/\/+$/, "") + "/";
        if (new QFileInfo(dir + "ImportNativeCaveSurvey.js").exists()) {
            return new QFileInfo(dir).absoluteFilePath() + "/";
        }
    }
    return null;
}

// An explicit path to a specific ImportNativeCaveSurvey.js, for checking the
// CaveSurvey add-on copy rather than the one beside the fixtures.
function findJsToolOverride() {
    var args = RSettings.getOriginalArguments();
    for (var i = 0; i < args.length; i++) {
        var a = "" + args[i];
        if (a.indexOf("ImportNativeCaveSurvey.js") >= 0 &&
            new QFileInfo(a).exists()) {
            return a;
        }
    }
    return null;
}

var repo = findRepoRoot();
var jsToolPath = findJsToolOverride();
if (repo === null) {
    print("### ERROR repo root not found in arguments -- pass it as the last argument");
} else {
    // Load the tool's parsers WITHOUT any of its GUI entry points. Two
    // generations of the script exist and both are handled:
    //
    //   * standalone (run via Misc > Development > Run Script...) ends in a
    //     bare importNativeCaveSurvey() call, which would block on a
    //     QFileDialog that cannot exist under -no-gui;
    //   * add-on (CaveSurvey menu/toolbar) instead ends in EAction wiring
    //     that touches RGuiAction and RMainWindowQt, neither of which exists
    //     headless.
    //
    // Either way we only want the parsers, so cut the file at whichever
    // marker comes first and drop the EAction include.
    var jsPath = jsToolPath === null ? repo + "ImportNativeCaveSurvey.js" : jsToolPath;
    print("### using " + jsPath);
    var src = readWhole(jsPath);
    src = src.replace(/^\s*include\("scripts\/EAction\.js"\);\s*$/m, "");
    var cutMarkers = [
        /\n[^\n]*Addon wiring[\s\S]*$/,          // add-on generation
        /\nimportNativeCaveSurvey\(\);\s*$/       // standalone generation
    ];
    for (var m = 0; m < cutMarkers.length; m++) {
        src = src.replace(cutMarkers[m], "\n");
    }
    if (/importNativeCaveSurvey\(\)\s*;/.test(src.replace(/function[^\n]*\n/g, ""))) {
        print("### WARNING a call to importNativeCaveSurvey() may still remain");
    }
    eval(src);

    var CASES = [
        { label: "Compass", file: "TestCave_Compass.dat", parse: parseCompassDat },
        { label: "Walls",   file: "TestCave_Walls.srv",   parse: parseWallsSrv },
        { label: "Survex",  file: "TestCave_Survex.svx",  parse: parseSurvexSvx }
    ];

    for (var c = 0; c < CASES.length; c++) {
        var kase = CASES[c];
        var content = readWhole(repo + kase.file);
        if (content === null) {
            continue;
        }
        var result = kase.parse(content);
        // parseCompassDat returns a bare array; the other two return
        // { shots: [...], fixedStations: [...] }.
        var shots = result.shots ? result.shots : result;

        print("### " + kase.label + " count=" + shots.length);
        for (var i = 0; i < shots.length; i++) {
            var s = shots[i];
            print("  " + [s.from, s.to, s.distance, s.azimuth, s.inclination,
                          s.left, s.right, s.up, s.down].join("|"));
        }
    }
    print("### DONE");
}
