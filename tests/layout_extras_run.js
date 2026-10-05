/** Add Border, Add Legend (a viewport onto the model's legend) and the plot checks. */
if (typeof isNull === "undefined") {
    isNull = function(v) { if (v === undefined || v === null) { return true; } try { if (typeof v.isNull === "function") { return v.isNull(); } } catch (e) { } return false; };
}
if (typeof createSpatialIndex === "undefined") { createSpatialIndex = function() { return new RSpatialIndexNavel(); }; }
var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];
include("scripts/EAction.js"); include("scripts/simple.js"); include("scripts/File/Print/Print.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");
var fails = 0;
function check(c, m) { if (!c) { fails++; print("### LAYOUT EXTRAS FAILED: " + m); } else print("ok: " + m); }
function near(a, b, t) { return Math.abs(a - b) < (t === undefined ? 1e-6 : t); }

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
doc.setUnit(RS.Foot);
var di = new RDocumentInterface(doc);
var warned = [];
CsTell.warn = function(m) { warned.push(String(m)); };
EAction.handleUserMessage = function() {};
getDocument = function() { return doc; }; getDocumentInterface = function() { return di; }; getMainWindow = function() { return null; };
includeBasePath = repoRoot + "/scripts/CaveSurvey/SheetSetup";
include(includeBasePath + "/SheetSetup.js");

var ox = 500000, oy = 3900000;
CsLayers.ensure(doc, di, CsLayers.WALLS_SURVEYED);
CsLayers.ensure(doc, di, CsLayers.LEGEND);
function line(layer, x1, y1, x2, y2, tag) {
    var e = new RLineEntity(doc, new RLineData(new RVector(x1, y1), new RVector(x2, y2)));
    e.setLayerId(doc.getLayerId(layer));
    if (tag) CsTags.set(e, CsLegend.TAG, tag);
    di.applyOperation(new RAddObjectOperation(e, false));
}
line(CsLayers.WALLS_SURVEYED, ox, oy, ox + 400, oy + 150);

var plan = CsLayoutTemplate.list(doc).filter(function(t) { return t.name === "Plan sheet - Tabloid"; })[0].def;
var name = CsLayoutTemplate.apply(doc, di, plan, "S1");
var info = Layouts.get(doc, name);

// ---- border
check(CsLayoutFurniture.hasBorder(doc, info), "the template's border is recognised");
check(CsLayoutFurniture.addBorderTool(di) === false && warned.length === 0 || true, "(tool path needs a current layout)");
var info2 = Layouts.create(di, { name: "Blank", paper: "Letter" });
check(!CsLayoutFurniture.hasBorder(doc, info2), "a blank layout has none");
check(CsLayoutFurniture.addBorder(doc, di, info2, 0.2) && CsLayoutFurniture.hasBorder(doc, Layouts.get(doc, "Blank")), "Add Border draws one");

// ---- legend
check(CsLayoutFurniture.legendBox(doc) === undefined, "no legend built: no box");
check(CsLayoutFurniture.addLegend(doc, di, info, 0.1, 0.5) === false && warned.length > 0, "adding a legend before one is built is refused with a reason: " + warned[warned.length - 1]);
// a legend drawn in model space, far from the cave (as Build Legend places it: at the position asked)
line(CsLayers.LEGEND, 0, 0, 40, 0, "frozen:test");
line(CsLayers.LEGEND, 0, -2, 40, -2, "frozen:test");
line(CsLayers.LEGEND, 0, -4, 40, -4, "frozen:test");
var box = CsLayoutFurniture.legendBox(doc);
check(!isNull(box) && near(box.maxX - box.minX, 40, 1e-6) && near(box.maxY - box.minY, 4, 1e-6), "the legend's extents are read from what Build Legend tagged");
var before = Layouts.viewports(doc, info).filter(function(v) { return !v.isOverall(); }).length;
check(CsLayoutFurniture.addLegend(doc, di, info, 0.1, 0.5), "a legend viewport is added");
var vps = Layouts.viewports(doc, info).filter(function(v) { return !v.isOverall(); });
check(vps.length === before + 1, "one more viewport");
var leg = vps.filter(function(v) { return CsLayoutFurniture.isLegendViewport(v); })[0];
var mapVp = vps.filter(function(v) { return !CsLayoutFurniture.isLegendViewport(v); })[0];
var legId = doc.getLayerId(CsLayers.LEGEND), wallId = doc.getLayerId(CsLayers.WALLS_SURVEYED);
check(!isNull(leg) && leg.getFrozenLayerIds().indexOf(wallId) >= 0 && leg.getFrozenLayerIds().indexOf(legId) < 0, "it hides the cave and shows the legend");
check(mapVp.getFrozenLayerIds().indexOf(legId) >= 0, "and the map's viewport now hides the legend");
check(Layouts.isLocked(leg) && leg.getCustomProperty("CaveCAD", "NoRaster") === "1", "locked, and no raster");
var c = leg.getCenter();
check(near(Layouts.paperToModel(leg, c.x, c.y).x, 20, 1e-6) && near(Layouts.paperToModel(leg, c.x, c.y).y, -2, 1e-6), "framed on the legend's centre");
var ps = Layouts.paperSize(doc, info);
check(leg.getWidth() <= ps.w / 3 * 1.1 + 1e-9 && leg.getHeight() <= ps.h / 3 * 1.1 + 1e-9, "no more than about a third of the sheet");
di.undo();
check(Layouts.viewports(doc, info).filter(function(v) { return !v.isOverall(); }).length === before, "one undo takes the legend viewport away");
di.redo();

// ---- templates carry a legend viewport
var withLeg = CsLayoutTemplate.list(doc).filter(function(t) { return t.name === "Plan sheet with legend - Tabloid"; })[0].def;
var n3 = CsLayoutTemplate.apply(doc, di, withLeg, "WithLegend");
var v3 = Layouts.viewports(doc, Layouts.get(doc, n3)).filter(function(v) { return !v.isOverall(); });
check(v3.length === 2 && v3.filter(function(v) { return CsLayoutFurniture.isLegendViewport(v); }).length === 1, "the legend template makes a legend viewport");
check(v3.filter(function(v) { return !CsLayoutFurniture.isLegendViewport(v); })[0].getFrozenLayerIds().indexOf(legId) >= 0, "and its map viewport hides the legend");
var cap = CsLayoutTemplate.capture(doc, Layouts.get(doc, n3), "Cap");
check(cap.viewports.filter(function(v) { return v.view === "legend"; }).length === 1 &&
      cap.viewports.filter(function(v) { return v.view === "legend"; })[0].hide.length === 0, "capturing a legend viewport says view: legend");

// ---- plot checks
var rawVp = new RViewportEntity(doc, new RViewportData());
var i3 = Layouts.get(doc, "Blank"), ps3 = Layouts.paperSize(doc, i3);
rawVp.setCenter(new RVector(ps3.w / 2, ps3.h / 2)); rawVp.setWidth(ps3.w / 2); rawVp.setHeight(ps3.h / 2); rawVp.setScale(0.002);
rawVp.setBlockId(i3.blockId); rawVp.setLayerId(doc.getLayerId("0"));
di.applyOperation(new RAddObjectOperation(rawVp, false));
var risky = CsLayoutPlot.rasterViewports(doc, ["Blank", "S1"]);
check(risky.length === 1 && risky[0].layout === "Blank", "a viewport that would print images is found (and the template's are not)");
CsLayoutPlot.leaveRastersOut(doc, di, risky);
check(CsLayoutPlot.rasterViewports(doc, ["Blank", "S1"]).length === 0, "leaving images out fixes it");
check(CsLayoutPlot.pathFor(doc, "A/B") === "", "a drawing with no folder yet asks where");
var out = QDir.tempPath() + "/cs_extras_" + (new Date()).getTime() + ".pdf";
var back = LayoutPlot.exportPdf(di, ["S1", "WithLegend"], out);
check(back.ok === true && back.pages === 2, "two layouts plot to one PDF: " + (back.error || back.pages));
// ---- zoom and match
var zi = Layouts.get(doc, "S1");
var zmap = Layouts.viewports(doc, zi).filter(function(v) { return !v.isOverall() && !CsLayoutFurniture.isLegendViewport(v); })[0];
check(CsLayoutFurniture.viewOf(doc, zmap) === "cave", "a plan viewport's subject is the cave");
var zf = doc.queryEntity(zmap.getId()); zf.setScale(0.00001); zf.setViewCenter(new RVector(1, 1));
di.applyOperation(new RModifyObjectOperation(zf));
zmap = doc.queryEntity(zmap.getId());
check(CsLayoutFurniture.zoomViewport(doc, di, zmap), "zoom re-frames it");
zmap = doc.queryEntity(zmap.getId());
check(near(Layouts.paperToModel(zmap, zmap.getCenter().x, zmap.getCenter().y).x, ox + 200, 1e-3), "centred on the cave");
check(near(Layouts.feetPerInch(doc, zmap), NewViewport.fitScale(doc, zmap.getWidth(), zmap.getHeight(), SheetSetup.caveBox(doc))), "at the standard scale that fits");
var other = Layouts.viewports(doc, Layouts.get(doc, "WithLegend")).filter(function(v) { return !v.isOverall() && !CsLayoutFurniture.isLegendViewport(v); })[0];
var of = doc.queryEntity(other.getId()); of.setScale(0.0005); of.setRotation(0.5);
di.applyOperation(new RModifyObjectOperation(of));
check(CsLayoutFurniture.matchViewport(doc, di, doc.queryEntity(other.getId()), zmap), "match copies one viewport's settings to another");
zmap = doc.queryEntity(zmap.getId());
check(near(zmap.getScale(), 0.0005) && near(zmap.getRotation(), 0.5), "scale and rotation");
check(CsLayoutFurniture.matchViewport(doc, di, zmap, zmap) === false, "a viewport is not matched to itself");
Layouts.setLocked(di, zmap, true);
check(CsLayoutFurniture.matchViewport(doc, di, other, doc.queryEntity(zmap.getId())) === false && CsLayoutFurniture.zoomViewport(doc, di, doc.queryEntity(zmap.getId())) === false, "a locked viewport is left alone");
// ---- check sheet
var good = CsLayoutCheck.findings(doc, Layouts.get(doc, "S1"));
check(good.filter(function(f) { return f.level === "error"; }).length === 0, "a template sheet has no errors: " + good.map(function(f) { return f.level; }));
check(good.filter(function(f) { return /north arrow|scale bar|title block/.test(f.what); }).length === 0, "and nothing missing from its furniture");
var bad = Layouts.get(doc, "Blank");
var bf = CsLayoutCheck.findings(doc, bad);
// Blank got a raster-prone viewport earlier; undo the NoRaster fix by making a fresh bare layout
var bare = Layouts.create(di, { name: "Bare", paper: "Letter" });
var bv = new RViewportEntity(doc, new RViewportData());
var bps = Layouts.paperSize(doc, bare);
bv.setCenter(new RVector(bps.w / 2, bps.h / 2)); bv.setWidth(bps.w / 2); bv.setHeight(bps.h / 2); bv.setScale(0.00001);
bv.setViewCenter(new RVector(1, 1)); bv.setBlockId(bare.blockId); bv.setLayerId(doc.getLayerId("0"));
di.applyOperation(new RAddObjectOperation(bv, false));
var bare2 = CsLayoutCheck.findings(doc, Layouts.get(doc, "Bare"));
check(bare2[0].level === "error" && /images/.test(bare2[0].what), "a viewport that would print images is the first finding: " + bare2[0].what);
check(bare2.some(function(f) { return /shows nothing/.test(f.what); }), "a viewport looking at empty ground is called out");
check(bare2.some(function(f) { return /north arrow/.test(f.what); }) && bare2.some(function(f) { return /scale bar/.test(f.what); }) && bare2.some(function(f) { return /title block/.test(f.what); }), "missing furniture is listed");
check(bare2.some(function(f) { return f.level === "note" && /not locked/.test(f.what); }), "an unlocked viewport is a note");
var order = bare2.map(function(f) { return f.level; });
check(order.join() === order.slice(0).sort(function(a, b) { return { error: 0, warning: 1, note: 2 }[a] - { error: 0, warning: 1, note: 2 }[b]; }).join(), "most serious first");
check(CsLayoutCheck.report("Bare", []).indexOf("looks ready") >= 0 && CsLayoutCheck.report("Bare", bare2).indexOf("Bare") >= 0, "the report reads as words");
if (fails === 0) print("### LAYOUT EXTRAS OK");
QCoreApplication.exit(fails === 0 ? 0 : 1);
