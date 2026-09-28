/**
 * CsLinetypeStore against the real engine: the personal library file,
 * and adding / replacing a linetype in a drawing.
 */
function fail(msg) {
    print("### LINETYPE MAKER FAILED: " + msg);
    QCoreApplication.exit(1);
    throw msg;
}
function check(cond, msg) {
    if (!cond) {
        fail(msg);
    }
}
// library.js is not loaded under -autostart.
function isNull(v) {
    return v === null || v === undefined;
}

var repo = String(args[args.length - 1]);
function loadRepo(path) {
    var f = new QFile(repo + "/" + path);
    check(f.open(QIODevice.ReadOnly | QIODevice.Text), "cannot read " + path);
    var src = String(new QTextStream(f).readAll());
    f.close();
    (0, eval)(src.replace(/^\s*include\(.*\);\s*$/mg, ""));
}
loadRepo("scripts/CaveSurvey/Core/CsLinetype.js");
loadRepo("scripts/CaveSurvey/Core/CsLinetypeStore.js");

var libPath = QDir.tempPath() + "/cs_lt_test/CaveCustomLinetypes.lin";
new QFile(libPath).remove();
CsLinetypeStore.pathOverride = libPath;

function model(name, pattern) {
    var r = CsLinetype.fromPattern(pattern);
    check(r.errors.length === 0, name + ": bad test pattern");
    return { name: name, description: name + " test", segments: r.segments };
}

// ---- the library file ---------------------------------------------------
check(CsLinetypeStore.loadCustom().linetypes.length === 0, "fresh library not empty");
check(CsLinetypeStore.saveCustom(model("CSA", "A,1,-0.5")) === null, "save CSA");
check(CsLinetypeStore.saveCustom(model("CSB",
    'A,0.5,-0.2,["CAVE",standard,S=0.1],-0.3')) === null, "save CSB");
check(CsLinetypeStore.loadCustom().linetypes.length === 2, "library should hold 2");
check(CsLinetypeStore.saveCustom(model("csa", "A,2,-1")) === null, "replace CSA");
var lib = CsLinetypeStore.loadCustom().linetypes;
check(lib.length === 2, "replace by name (any case) duplicated: " + lib.length);
check(CsLinetype.toPattern(lib[0]) === "A,2,-1", "CSA not replaced: " +
    CsLinetype.toPattern(lib[0]));
check(CsLinetypeStore.saveCustom(model("BAD NAME", "A,1,-1")) !== null,
    "a name with a space was saved");
check(CsLinetypeStore.removeCustom("CSB") === null, "remove CSB");
check(CsLinetypeStore.loadCustom().linetypes.length === 1, "remove failed");

// ---- the drawing --------------------------------------------------------
var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
var di = new RDocumentInterface(doc);
var m = model("CSTEXT", 'A,0.5,-0.2,["CAVE",standard,S=0.1],-0.3');
check(CsLinetypeStore.applyToDocument(doc, di, m) === null, "apply new");
var listed = CsLinetypeStore.fromDocument(doc);
var found = null;
for (var i = 0; i < listed.length; i++) {
    check(["BYLAYER", "BYBLOCK", "CONTINUOUS"].indexOf(listed[i].name.toUpperCase()) < 0,
        "fromDocument listed " + listed[i].name);
    if (listed[i].name.toUpperCase() === "CSTEXT") {
        found = listed[i];
    }
}
check(found !== null, "applied linetype not listed");
check(found.segments.length === 3 && found.segments[1].text === "CAVE",
    "listed linetype lost its text: " + JSON.stringify(found));
check(found.description === "CSTEXT test", "description lost: " + found.description);

m.segments[0].length = 0.75;
check(CsLinetypeStore.applyToDocument(doc, di, m) === null, "apply replace");
var p = doc.queryLinetype("CSTEXT").getPattern();
check(Math.abs(p.getDashLengthAt(0) - 0.75) < 1e-9, "replace did not take: " +
    p.getDashLengthAt(0));
var count = 0;
var names = doc.getLinetypeNames();
for (var n = 0; n < names.length; n++) {
    if (String(names[n]).toUpperCase() === "CSTEXT") {
        count++;
    }
}
check(count === 1, "replace made a second CSTEXT (" + count + ")");

// ---- applyAll: what the template pour does -------------------------------
var doc2 = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
var di2 = new RDocumentInterface(doc2);
var failed = CsLinetypeStore.applyAll(doc2, di2);
check(failed.length === 0, "applyAll failed: " + failed.join(", "));
check(CsLinetypeStore.hasLinetype(doc2, "CSA"), "applyAll did not add CSA");

CsLinetypeStore.pathOverride = null;
print("### LINETYPE MAKER OK");
QCoreApplication.exit(0);
