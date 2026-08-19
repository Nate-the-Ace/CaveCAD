// tests/js_syntax.js
//
// Syntax-checks every script in the CaveSurvey add-on using QCAD's own
// ECMAScript engine -- the same engine that will run them, so this catches
// anything that engine won't accept, not just anything a different parser
// wouldn't.
//
// Only the differential test actually exercises ImportNativeCaveSurvey's
// parsers; the rest are interactive or GUI-bound and can't be run headless at
// all. A syntax error in one of those otherwise shows up as a tool silently
// missing from the menu, which is a miserable thing to debug.
//
// Each file is wrapped in a function expression and eval'd. That parses the
// whole source without executing any of it, so no dialog opens and nothing
// touches RMainWindowQt.
//
// The tool list is read off disk rather than hardcoded, so a newly added tool
// is checked without anyone remembering to list it here -- and so this can be
// pointed at a staged package, where AlignImage (a separate project, copied in
// at build time) sits alongside the rest and gets checked too.
//
//   /Applications/QCAD.app/Contents/Resources/qcad \
//       -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/js_syntax.js <repo-root-or-addon-dir>

function readWhole(path) {
    var f = new QFile(path);
    if (!f.open(QIODevice.ReadOnly | QIODevice.Text)) {
        return null;
    }
    var text = new QTextStream(f).readAll();
    f.close();
    return text;
}

// Accepts either a repo root (which holds scripts/CaveSurvey/) or the add-on
// folder itself, so the same test serves the repo and a staged package.
function findAddon() {
    var args = RSettings.getOriginalArguments();
    for (var i = args.length - 1; i >= 0; i--) {
        var dir = ("" + args[i]).replace(/\/+$/, "") + "/";
        var candidates = [dir + "scripts/CaveSurvey/", dir];
        for (var c = 0; c < candidates.length; c++) {
            if (new QFileInfo(candidates[c] + "CaveSurvey.js").exists()) {
                return new QFileInfo(candidates[c]).absoluteFilePath().replace(/\/+$/, "") + "/";
            }
        }
    }
    return null;
}

// Every .js in the add-on: the menu builder, plus everything inside each tool
// folder (a tool's own file, and any helper sitting beside it).
function collectScripts(addon) {
    var scripts = ["CaveSurvey.js"];
    var dirs = new QDir(addon).entryInfoList(
        ["*"], makeQDirFilters(QDir.NoDotAndDotDot, QDir.Dirs), QDir.Name);
    for (var i = 0; i < dirs.length; i++) {
        var name = dirs[i].fileName();
        var files = new QDir(addon + name).entryInfoList(
            ["*.js"], makeQDirFilters(QDir.NoDotAndDotDot, QDir.Files), QDir.Name);
        for (var f = 0; f < files.length; f++) {
            scripts.push(name + "/" + files[f].fileName());
        }
    }
    return scripts;
}

var addon = findAddon();
if (addon === null) {
    print("### ERROR add-on not found -- pass the repo root, or the "
          + "CaveSurvey folder itself, as the last argument");
} else {
    print("add-on: " + addon);
    var TOOLS = collectScripts(addon);
    var failures = 0;
    for (var i = 0; i < TOOLS.length; i++) {
        var src = readWhole(addon + TOOLS[i]);
        if (src === null) {
            print("FAIL  " + TOOLS[i] + " -- cannot read");
            failures++;
            continue;
        }
        try {
            // Parses without running. The wrapper is never called.
            eval("(function(){" + src + "\n})");
            print("ok    " + TOOLS[i]);
        } catch (e) {
            print("FAIL  " + TOOLS[i] + " -- " + e);
            failures++;
        }
    }
    print("### " + (TOOLS.length - failures) + "/" + TOOLS.length + " parsed");
    print(failures === 0 ? "### SYNTAX OK" : "### SYNTAX FAILURES");
}
