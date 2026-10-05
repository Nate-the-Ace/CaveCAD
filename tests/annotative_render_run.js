/** Annotative text as DRAWN: the same size on paper at any viewport scale, hidden where its scale is missing, ghosts in the model. */
include("scripts/library.js");
include("scripts/EAction.js");
include("scripts/File/BitmapExport/BitmapExportWorker.js");
include("scripts/Layouts/Layouts.js");
include("scripts/Annotate/Annotative.js");
var fails = 0;
function check(c, m) { if (!c) { fails++; print("### ANNOTATIVE RENDER FAILED: " + m); } else print("ok: " + m); }

var tmp = QDir.tempPath();
function render(doc, di, name, box, w, h) {
    var path = tmp + "/cs_anno_" + name + ".png";
    QFile.remove(path);
    var scene = new RGraphicsSceneQt(di);
    var res = exportBitmap(doc, scene, path, { width: w, height: h, window: box, margin: 0, noWeightMargin: true,
        backgroundColor: new RColor("white"), antialiasing: false });
    var img = new QImage(path);
    return img;
}
/** Bounding box of pixels darker than `limit` (value 0..255): {x1,y1,x2,y2,count} or null. */
function darkBox(img, limit) {
    var x1 = 1e9, y1 = 1e9, x2 = -1, y2 = -1, n = 0;
    for (var y = 0; y < img.height(); y += 1) {
        for (var x = 0; x < img.width(); x += 1) {
            if (img.pixelColor(x, y).value() < limit) {
                n++;
                if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
            }
        }
    }
    return n === 0 ? null : { x1: x1, y1: y1, x2: x2, y2: y2, count: n };
}
function nonWhite(img, limit) {
    var n = 0;
    for (var y = 0; y < img.height(); y += 2) for (var x = 0; x < img.width(); x += 2) if (img.pixelColor(x, y).value() < limit) n++;
    return n;
}

function newDoc() {
    var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
    doc.setUnit(RS.Foot);
    var di = new RDocumentInterface(doc);
    Annotative.regenerate = function() {};
    return { doc: doc, di: di };
}
function addText(doc, di, x, y, h, label) {
    var e = new RTextEntity(doc, new RTextData(new RVector(x, y), new RVector(x, y), h, 100,
        RS.VAlignBase, RS.HAlignLeft, RS.LeftToRight, RS.Exact, 1.0, label, "standard", false, false, 0.0, false));
    di.applyOperation(new RAddObjectOperation(e, false));
    var ids = doc.queryAllEntities(false, true, RS.EntityText);
    return ids[ids.length - 1];
}

// ---------------- the model view -------------------------------------------------------
var m = newDoc();
var id = addText(m.doc, m.di, 10, 10, 0.4, "MMMM");
Annotative.make(m.di, [id]);                  // paper height 0.4 in, scale 1" = 1'
Annotative.addScale(m.di, [id], 5);
// put the 1" = 5' representation higher up
var e = m.doc.queryEntity(id), d = Annotative.read(e);
Annotative.repAt(d, 5).y = 25;
Annotative.write(e, d);
m.di.applyOperation(new RModifyObjectOperation(e, false));

var box = new RBox(new RVector(0, 0), new RVector(40, 30));
Annotative.setCurrentScale(m.di, 1);
var a1 = darkBox(render(m.doc, m.di, "m1", box, 800, 600), 110);
check(a1 !== null, "at 1\" = 1' the text is drawn");
Annotative.setCurrentScale(m.di, 5);
var a5 = darkBox(render(m.doc, m.di, "m5", box, 800, 600), 110);
check(a5 !== null, "at 1\" = 5' the text is drawn");
var ratio = (a5.y2 - a5.y1) / (a1.y2 - a1.y1);
check(ratio > 4 && ratio < 6, "five times taller in the model at a five times coarser scale (same paper size): " + ratio.toFixed(2));
check(a1.y1 > 300 && a5.y1 < 300, "and where each scale keeps it: low at scale 1 (y " + a1.y1 + "), high at scale 5 (y " + a5.y1 + ")");
Annotative.setCurrentScale(m.di, 20);
check(darkBox(render(m.doc, m.di, "m20", box, 800, 600), 110) === null, "at a scale the text does not support it is not drawn");

// ghosts: the other scale shaded back
Annotative.setCurrentScale(m.di, 1);
var before = nonWhite(render(m.doc, m.di, "g0", box, 800, 600), 250);
Annotative.setVisible(m.di, true);
var gimg = render(m.doc, m.di, "g1", box, 800, 600);
var after = nonWhite(gimg, 250);
check(after > before * 2, "with all scales shown the other scale appears too: " + before + " -> " + after);
var darkOnly = darkBox(gimg, 110);
print("ghost dark box: " + JSON.stringify(darkOnly) + " a5 h " + (a5.y2 - a5.y1));
check(darkOnly !== null && (darkOnly.y2 - darkOnly.y1) < (a5.y2 - a5.y1) / 2, "while only the current scale is drawn dark (the other is shaded back)");
Annotative.setVisible(m.di, false);

// ---------------- viewports ------------------------------------------------------------
function layoutAt(fpi, name, vcx, vcy) {
    var v = newDoc(), doc = v.doc, di = v.di;
    var tid = addText(doc, di, 10, 10, 0.4, "MMMM");
    Annotative.make(di, [tid]);
    Annotative.addScale(di, [tid], 5);
    var te = doc.queryEntity(tid), td = Annotative.read(te);
    Annotative.repAt(td, 5).y = 25;
    Annotative.write(te, td);
    di.applyOperation(new RModifyObjectOperation(te, false));
    var info = Layouts.create(di, { name: name, paper: "Letter", landscape: true });
    // the viewport's frame is on an OFF layer: contents draw, the frame does not
    var off = new RLayer(doc, "VPFRAME");
    di.applyOperation(new RAddObjectOperation(off, false));
    var lid = doc.getLayerId("VPFRAME");
    var vp = new RViewportEntity(doc, new RViewportData());
    var ps = Layouts.paperSize(doc, info);
    vp.setCenter(new RVector(ps.w / 2, ps.h / 2)); vp.setWidth(ps.w * 0.9); vp.setHeight(ps.h * 0.9);
    vp.setScale(Layouts.scaleFor(doc, fpi));
    vp.setViewCenter(new RVector(vcx, vcy)); vp.setViewTarget(new RVector(0, 0));
    vp.setBlockId(info.blockId); vp.setLayerId(lid);
    di.applyOperation(new RAddObjectOperation(vp, false));
    var layer = doc.queryLayer(lid); layer.setOff(true);
    di.applyOperation(new RModifyObjectOperation(layer, false));
    doc.setCurrentBlock(info.blockId);
    return { doc: doc, di: di, ps: ps };
}
var L5 = layoutAt(5, "L5", 20, 15), L1 = layoutAt(1, "L1", 11, 10.2), L20 = layoutAt(20, "L20", 20, 15);
var pbox = function(L) { return new RBox(new RVector(0, 0), new RVector(L.ps.w, L.ps.h)); };
var img5 = render(L5.doc, L5.di, "v5", pbox(L5), 1100, 850);
print("v5 image " + img5.width() + "x" + img5.height() + " nonwhite " + nonWhite(img5, 250) + " saved /tmp/cs_anno_v5.png");
var r5 = darkBox(img5, 110);
var r1 = darkBox(render(L1.doc, L1.di, "v1", pbox(L1), 1100, 850), 110);
var r20 = darkBox(render(L20.doc, L20.di, "v20", pbox(L20), 1100, 850), 110);
check(r5 !== null && r1 !== null, "the text is drawn in a viewport whose scale it supports (1\" = 5' and 1\" = 1')");
var h5 = r5.y2 - r5.y1, h1 = r1.y2 - r1.y1;
check(Math.abs(h5 - h1) <= Math.max(3, 0.15 * h1), "the SAME size on paper at both viewport scales: " + h1 + " px vs " + h5 + " px");
check(h5 > 12 && h5 < 60, "and about the size 0.4 inch asks for on a 1100 px page (" + h5 + " px)");
check(r20 === null, "in a viewport at a scale the text does not support it is not drawn");
if (fails === 0) print("### ANNOTATIVE RENDER OK");
QCoreApplication.exit(fails === 0 ? 0 : 1);
