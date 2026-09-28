/**
 * Complex linetypes -- a text or shape drawn into the pattern -- used to be
 * refused by the engine (a DWG-plugin gate) and cut down to bare dashes by
 * the DXF reader and writer. This drives both directions against the real
 * engine. The first half reads a HAND-WRITTEN file, so it tests the reader
 * rather than whatever the exporter happens to emit.
 */
function fail(msg) {
    print("### LINETYPE ROUNDTRIP FAILED: " + msg);
    QCoreApplication.exit(1);
    throw msg;
}
function check(cond, msg) {
    if (!cond) {
        fail(msg);
    }
}
function near(a, b, msg) {
    check(Math.abs(a - b) < 1e-6, msg + " (expected " + b + ", got " + a + ")");
}
// library.js is not loaded under -autostart, so no isNull here.
function isNull(v) {
    return v === null || v === undefined;
}
function pair(code, value) { return code + "\n" + value + "\n"; }

// ---- 1. The gate -------------------------------------------------------
var gated = new RLinetypePattern(true, "GATE", "gate probe");
check(gated.setPatternString('A,0.5,-0.2,["CAVE",standard,S=0.1],-0.3'),
    "setPatternString refused a text element (the DWG-plugin gate is back)");

// ---- 2. Read a hand-written complex LTYPE ------------------------------
var dxf = "";
dxf += pair("  0", "SECTION") + pair("  2", "TABLES");
dxf += pair("  0", "TABLE") + pair("  2", "LTYPE") + pair(" 70", "1");
dxf += pair("  0", "LTYPE") + pair("  5", "20") + pair("  2", "CSTEXT");
dxf += pair(" 70", "0") + pair("  3", "Text test") + pair(" 72", "65");
dxf += pair(" 73", "3") + pair(" 40", "1.5");
dxf += pair(" 49", "0.5") + pair(" 74", "0");
dxf += pair(" 49", "-0.5") + pair(" 74", "2") + pair(" 75", "0");
dxf += pair("340", "31") + pair(" 46", "0.1") + pair(" 50", "0.0");
dxf += pair(" 44", "-0.1") + pair(" 45", "-0.05") + pair("  9", "CAVE");
dxf += pair(" 49", "-0.5") + pair(" 74", "0");
dxf += pair("  0", "ENDTAB");
dxf += pair("  0", "TABLE") + pair("  2", "STYLE") + pair(" 70", "1");
dxf += pair("  0", "STYLE") + pair("  5", "31") + pair("  2", "CS_LT_STANDARD");
dxf += pair(" 70", "0") + pair(" 40", "0.0") + pair(" 41", "1.0");
dxf += pair(" 50", "0.0") + pair(" 71", "0") + pair(" 42", "2.5");
dxf += pair("  3", "standard") + pair("  4", "");
dxf += pair("  0", "ENDTAB");
dxf += pair("  0", "ENDSEC");
dxf += pair("  0", "SECTION") + pair("  2", "ENTITIES");
dxf += pair("  0", "LINE") + pair("  8", "0") + pair("  6", "CSTEXT");
dxf += pair(" 10", "0.0") + pair(" 20", "0.0") + pair(" 30", "0.0");
dxf += pair(" 11", "10.0") + pair(" 21", "0.0") + pair(" 31", "0.0");
dxf += pair("  0", "ENDSEC") + pair("  0", "EOF");

var readPath = QDir.tempPath() + "/cs_linetype_read.dxf";
var f = new QFile(readPath);
check(f.open(QIODevice.WriteOnly | QIODevice.Text), "could not write " + readPath);
var ts = new QTextStream(f);
ts.writeString(dxf);
ts.flush();
f.close();

var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
var di = new RDocumentInterface(doc);
di.importFile(readPath);

var lt = doc.queryLinetype("CSTEXT");
check(!isNull(lt), "linetype CSTEXT was not imported");
var p = lt.getPattern();
check(p.getNumDashes() === 3, "CSTEXT has " + p.getNumDashes() + " dashes, expected 3");
check(p.getShapeTextAt(1) === "CAVE", "text at 1 is '" + p.getShapeTextAt(1) + "'");
check(String(p.getShapeTextStyleAt(1)).toLowerCase() === "standard",
    "font at 1 is '" + p.getShapeTextStyleAt(1) + "' -- 340 was not resolved");
near(p.getShapeScaleAt(1), 0.1, "scale at 1");
near(p.getShapeOffsetAt(1).x, -0.1, "offset x at 1");
near(p.getShapeOffsetAt(1).y, -0.05, "offset y at 1");
check(p.hasShapes(), "CSTEXT has no rendered glyphs (updateShapes not run)");

var lines = doc.queryAllEntities(false, true, RS.EntityLine);
check(lines.length === 1, "the LINE after the tables did not import (" +
    lines.length + ") -- the code-9 record boundary is back");
var line = doc.queryEntity(lines[0]);
check(String(doc.getLinetypeName(line.getLinetypeId())).toUpperCase() === "CSTEXT",
    "line lost its linetype");

// Task 2 appends the write half here.

print("### LINETYPE ROUNDTRIP OK");
QCoreApplication.exit(0);
