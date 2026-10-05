/** Annotative text: properties, scales, following the current scale, and edit / undo / redo staying in step. */
include("scripts/library.js");
include("scripts/EAction.js");
include("scripts/Layouts/Layouts.js");
include("scripts/Annotate/Annotative.js");
var fails = 0;
function check(c, m) { if (!c) { fails++; print("### ANNOTATIVE FAILED: " + m); } else print("ok: " + m); }
function near(a, b, t) { return Math.abs(a - b) < (t === undefined ? 1e-9 : t); }

var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
doc.setUnit(RS.Foot);
var di = new RDocumentInterface(doc);
Annotative.regenerate = function() {};      // headless: nothing to redraw

function makeText(x, y, h, label) {
    var e = new RTextEntity(doc, new RTextData(new RVector(x, y), new RVector(x, y), h, 100,
        RS.VAlignBase, RS.HAlignLeft, RS.LeftToRight, RS.Exact, 1.0, label, "standard", false, false, 0.0, false));
    di.applyOperation(new RAddObjectOperation(e, false));
    var ids = doc.queryAllEntities(false, true, RS.EntityText);
    return ids[ids.length - 1];
}
var id = makeText(100, 200, 0.5, "ROOM");
var t = function() { return doc.queryEntity(id); };

check(Annotative.currentScale(doc) === 1, "the default current scale is 1\" = 1'");
check(!Annotative.isAnnotative(t()), "a new text is ordinary");
check(Annotative.make(di, [id]) === 1, "make annotative");
var d = Annotative.read(t());
check(near(d.h, 0.5) && d.reps.length === 1 && near(d.reps[0].fpi, 1) && near(d.reps[0].x, 100) && near(d.at, 1), "its height is read as paper inches at the current scale, and it starts with that one scale");
check(Annotative.make(di, [id]) === 0, "making it annotative again does nothing");

// ---- scales
check(Annotative.addScale(di, [id], 40) === 1, "add the scale 1\" = 40'");
d = Annotative.read(t());
check(d.reps.length === 2 && near(d.reps[1].fpi, 40) && near(d.reps[1].x, 100) && near(d.reps[1].y, 200), "it starts where the nearest scale has the text");
check(Annotative.addScale(di, [id], 40) === 0, "adding a scale it has does nothing");
check(Annotative.scalesOf(t()).join() === "1,40", "the scales are listed ascending");

// ---- following the current scale
check(Annotative.setCurrentScale(di, 40), "set the current scale to 1\" = 40'");
check(near(t().getTextHeight(), 0.5 * 40 * Annotative.unitsPerFoot(doc)), "the text is 40 times taller in the model (same paper size): " + t().getTextHeight());
check(near(Annotative.read(t()).at, 40), "and says which scale its geometry stands for");

// ---- an edit at this scale moves only this scale
var e = t(); e.move(new RVector(10, -5));
di.applyOperation(new RModifyObjectOperation(e));
check(Annotative.settle(doc, di, id), "an edit is captured");
d = Annotative.read(t());
check(near(Annotative.repAt(d, 40).x, 110) && near(Annotative.repAt(d, 40).y, 195), "into the current scale's position");
check(near(Annotative.repAt(d, 1).x, 100) && near(Annotative.repAt(d, 1).y, 200), "the other scale did not move");
// a height change is a paper-height change for every scale
var e2 = t(); e2.setTextHeight(e2.getTextHeight() * 2);
di.applyOperation(new RModifyObjectOperation(e2));
Annotative.settle(doc, di, id);
check(near(Annotative.read(t()).h, 1.0, 1e-9), "making the text taller changes its paper height: " + Annotative.read(t()).h);
Annotative.setCurrentScale(di, 1);
check(near(t().getTextHeight(), 1.0) && near(t().getPosition().x, 100) && near(t().getPosition().y, 200), "back at 1\" = 1' the text is at scale 1's place, at its (new) paper size");

// ---- a scale it does not have
Annotative.setCurrentScale(di, 20);
check(near(t().getPosition().x, 100), "at a scale the text lacks its geometry is left alone (the drawing code hides it)");
Annotative.setCurrentScale(di, 40);
check(near(t().getPosition().x, 110) && near(t().getTextHeight(), 40), "and comes back at scale 40's place");

// ---- undo and redo (the listener passes the transaction's id: a journal remembers what each scale held)
Annotative.setCurrentScale(di, 1);
var e3 = t(); e3.move(new RVector(5, 0));
di.applyOperation(new RModifyObjectOperation(e3));
Annotative.afterTransaction(doc, di, [id], "edit", 101);
check(near(Annotative.repAt(Annotative.read(t()), 1).x, 105), "a move at scale 1 is captured");
Annotative.setCurrentScale(di, 40);
di.undo();                                   // QCAD puts the old POSITION back -- onto the scale-40 geometry
Annotative.afterTransaction(doc, di, [id], "undo", 101);
d = Annotative.read(t());
check(near(Annotative.repAt(d, 1).x, 100), "undoing a move made at another scale puts THAT scale's position back: " + Annotative.repAt(d, 1).x);
check(near(Annotative.repAt(d, 40).x, 110) && near(Annotative.repAt(d, 40).y, 195), "and does not touch the scale being shown: " + Annotative.repAt(d, 40).x);
check(near(t().getPosition().x, 110) && near(t().getPosition().y, 195) && near(t().getTextHeight(), 40) && near(d.at, 40), "the geometry is still the scale being shown's");
di.redo();
Annotative.afterTransaction(doc, di, [id], "redo", 101);
d = Annotative.read(t());
check(near(Annotative.repAt(d, 1).x, 105) && near(Annotative.repAt(d, 40).x, 110), "redo puts it forward again, still not touching the other scale");
// the plain case: undo at the same scale
Annotative.setCurrentScale(di, 40);
var e4 = t(); e4.move(new RVector(-2, 0));
di.applyOperation(new RModifyObjectOperation(e4));
Annotative.afterTransaction(doc, di, [id], "edit", 102);
check(near(Annotative.repAt(Annotative.read(t()), 40).x, 108), "a move at scale 40");
di.undo();
Annotative.afterTransaction(doc, di, [id], "undo", 102);
check(near(Annotative.repAt(Annotative.read(t()), 40).x, 110) && near(t().getPosition().x, 110), "undone at the same scale");
// with no journal entry (after a restart) the geometry-based capture still keeps the scale shown right
var e5 = t(); e5.move(new RVector(3, 0));
di.applyOperation(new RModifyObjectOperation(e5));
Annotative.afterTransaction(doc, di, [id], "undo", 999);
check(near(Annotative.repAt(Annotative.read(t()), 40).x, 113), "an unknown transaction falls back to what the geometry says");
Annotative.setCurrentScale(di, 1);

// ---- removing
check(Annotative.removeScale(di, [id], 40) === 1 && Annotative.scalesOf(t()).join() === "1", "remove a scale");
check(Annotative.removeScale(di, [id], 1) === 0 && Annotative.scalesOf(t()).length === 1, "the last scale cannot be removed");

// ---- make not annotative
Annotative.setCurrentScale(di, 1);
check(Annotative.unmake(di, [id]) === 1 && !Annotative.isAnnotative(t()), "make not annotative");
check(String(t().getCustomProperty("CaveCAD", "AnnoScales", "")) === "", "its properties are gone");

// ---- other texts are untouched
var other = makeText(0, 0, 0.3, "PLAIN");
check(Annotative.all(doc).length === 0 && Annotative.followAll(doc, di) === 0, "ordinary text is never touched by a scale change");

// ---- visibility is a document setting
Annotative.setVisible(di, true);
check(Annotative.visible(doc) === true, "annotation visibility is remembered in the drawing");
Annotative.setVisible(di, false);
check(Annotative.visible(doc) === false, "and switches off");
if (fails === 0) print("### ANNOTATIVE OK");
QCoreApplication.exit(fails === 0 ? 0 : 1);
