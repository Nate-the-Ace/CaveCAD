/** CustomGrips registry + RotateViewport maths and undo (headless: no widgets, no view). */
include("scripts/library.js");
include("scripts/EAction.js");
include("scripts/Layouts/Layouts.js");
include("scripts/Widgets/CustomGrips/CustomGrips.js");
include("scripts/Layouts/RotateViewport/RotateViewport.js");
var fails = 0;
function check(c, m) { if (!c) { fails++; print("### CUSTOM GRIPS FAILED: " + m); } else print("ok: " + m); }

// ---- the registry ----------------------------------------------------------------
var shown = true;
CustomGrips.register({ id: "t1", shape: "hexagon", size: [20, 20], target: function(e) { return shown ? e.thing : undefined; },
    anchor: function(v, t) { return { x: 1, y: 2 }; }, onClick: function() {} });
CustomGrips.register({ id: "t2", shape: function(p, w, h) { }, size: [10, 10], target: function(e) { return undefined; },
    anchor: function(v, t) { return { x: 0, y: 0 }; } });
check(CustomGrips.list().join() === "t1,t2", "grips are listed in registration order");
check(CustomGrips.applicable({ thing: 7 }).length === 1 && CustomGrips.applicable({ thing: 7 })[0].id === "t1", "only grips whose target exists apply");
shown = false;
check(CustomGrips.applicable({ thing: 7 }).length === 0, "a grip hides when its target goes");
CustomGrips.register({ id: "t1", shape: "circle", size: [8, 8], target: function() { return 1; }, anchor: function() { return { x: 0, y: 0 }; } });
check(CustomGrips.list().length === 2 && CustomGrips.grips.t1.shape === "circle", "registering again replaces, never duplicates");
var threw = false;
try { CustomGrips.register({ id: "bad", shape: "no-such-shape", target: function() {}, anchor: function() {} }); } catch (e) { threw = true; }
check(threw, "an unknown shape is refused");
threw = false;
try { CustomGrips.register({ id: "bad2" }); } catch (e2) { threw = true; }
check(threw, "a grip with no target/anchor is refused");
CustomGrips.unregister("t1");
check(CustomGrips.list().join() === "t2", "unregister removes");
var names = ["diamond", "square", "circle", "triangle-up", "triangle-down", "triangle-left", "triangle-right", "hexagon", "cross"];
var all = true;
for (var i = 0; i < names.length; i++) { all = all && typeof CustomGrips.SHAPES[names[i]] === "function"; }
check(all, "the stock shapes are all there");
var thrower = function() { return CustomGrips.applicable({}); };
CustomGrips.register({ id: "t3", target: function() { throw new Error("x"); }, anchor: function() { return {}; } });
check(thrower().length === 0, "a target that throws just hides its grip");

// ---- RotateViewport -----------------------------------------------------------------
check(RotateViewport.stepFor(10) === 45 && RotateViewport.stepFor(100) === 15 && RotateViewport.stepFor(200) === 5 &&
      RotateViewport.stepFor(300) === 1 && RotateViewport.stepFor(900) === 0.5, "the farther from the centre, the finer the snap");
check(Math.abs(RotateViewport.degrees(Math.PI * 3 / 2) + 90) < 1e-9 && RotateViewport.degrees(Math.PI) === 180, "angles wrap into (-180, 180]");

var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
doc.setUnit(RS.Foot);
var di = new RDocumentInterface(doc);
var info = Layouts.create(di, { name: "S", paper: "Letter" });
var vp = new RViewportEntity(doc, new RViewportData());
vp.setCenter(new RVector(0.4, 0.3)); vp.setWidth(0.5); vp.setHeight(0.4); vp.setScale(0.002);
vp.setBlockId(info.blockId); vp.setLayerId(doc.getLayerId("0"));
di.applyOperation(new RAddObjectOperation(vp, false));
var id = Layouts.viewports(doc, info)[0].getId();
var rot = function() { return Math.round(RotateViewport.degrees(doc.queryEntity(id).getRotation()) * 1e6) / 1e6; };
check(RotateViewport.start(di, id), "the tool starts on an unlocked viewport");
var a = RotateViewport.current;
a.rotation = 33 * Math.PI / 180; a.show();
check(rot() === 33, "the viewport turns live");
a.rotation = 70 * Math.PI / 180; a.show();
check(rot() === 70, "and keeps following");
a.commit();
check(rot() === 70, "commit keeps the angle");
di.undo();
check(rot() === 0, "ONE undo step returns to where it started (not through every live angle)");
di.redo();
check(rot() === 70, "redo brings it back");
RotateViewport.start(di, id); var b = RotateViewport.current;
b.rotation = 15 * Math.PI / 180; b.show(); b.escapeEvent();
check(rot() === 70, "cancel puts the starting angle back");
var k = function(t) { return { key: function() { return 0; }, text: function() { return t; }, accept: function() {}, ignore: function() {} }; };
RotateViewport.start(di, id); var c = RotateViewport.current;
c.keyPressEvent(k("-")); c.keyPressEvent(k("4")); c.keyPressEvent(k("5"));
check(rot() === -45, "typing an angle sets it exactly: " + rot());
c.commit();
Layouts.setLocked(di, Layouts.viewports(doc, info)[0], true);
check(RotateViewport.start(di, id) === false, "a locked viewport refuses to turn");
if (fails === 0) print("### CUSTOM GRIPS OK");
QCoreApplication.exit(fails === 0 ? 0 : 1);
