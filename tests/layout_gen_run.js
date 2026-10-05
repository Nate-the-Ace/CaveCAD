/**
 * Sheet Setup as layouts: CsLayoutGen writes a viewport + furniture per
 * sheet into the live drawing, leaves manual layouts alone, rewrites auto
 * ones without piling up copies, and tiles a big cave into numbered sheets
 * whose viewports show exactly the tile's map.
 */
if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try { if (typeof v.isNull === "function") { return v.isNull(); } } catch (e) { }
        return false;
    };
}
if (typeof createSpatialIndex === "undefined") {
    createSpatialIndex = function() { return new RSpatialIndexNavel(); };
}
var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];
include("scripts/EAction.js");
include("scripts/simple.js");
include("scripts/File/Print/Print.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");

var fails = 0;
function check(c, m) { if (!c) { fails++; print("### LAYOUT GEN FAILED: " + m); } else print("ok: " + m); }
function near(a, b, tol) { return Math.abs(a - b) < (isNull(tol) ? 1e-6 : tol); }

function countBy(doc, blockId, tag) {
    var ids = doc.queryBlockEntities(blockId), n = 0, kinds = {};
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || e.isUndone()) continue;
        var t = CsTags.get(e, CsLayoutGen.TAG);
        if (t !== "") { n++; kinds[t] = (kinds[t] || 0) + 1; }
    }
    return { n: n, kinds: kinds };
}

function main() {
    var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
    doc.setUnit(RS.Foot);
    var di = new RDocumentInterface(doc);
    var ox = 500000, oy = 3900000;
    var model0;

    // cave: a 100 x 50 ft passage plus a profile-frame line the plan sheet must not show
    CsLayers.ensure(doc, di, "WALL-SURVEYED");
    CsLayers.ensure(doc, di, "PROFILE-WALL");
    var op = new RAddObjectsOperation();
    var wall = new RLineEntity(doc, new RLineData(new RVector(ox, oy), new RVector(ox + 100, oy + 50)));
    wall.setLayerId(doc.getLayerId("WALL-SURVEYED"));
    op.addObject(wall, false);
    var prof = new RLineEntity(doc, new RLineData(new RVector(ox, oy - 80), new RVector(ox + 100, oy - 60)));
    prof.setLayerId(doc.getLayerId("PROFILE-WALL"));
    op.addObject(prof, false);
    di.applyOperation(op);
    model0 = doc.queryBlockEntities(doc.getModelSpaceBlockId()).length;

    var sheet = CsSheetSetup.sheetByName("ANSI A -- 11 x 8.5");
    var base = {
        caveBox: { minX: ox, minY: oy, maxX: ox + 100, maxY: oy + 50 },
        sheet: sheet, turned: false, scale: 20, perFoot: 1,
        wants: { border: true, bar: true, north: true, title: true },
        titleValues: { caveName: "Test Cave" }, reading: { declination: 4.0, date: "2024-11-03" },
        tiles: null, elevation: false
    };

    // ---- one sheet -----------------------------------------------------
    var res = CsLayoutGen.generate(doc, di, { caveBox: base.caveBox, sheet: base.sheet, turned: false,
        scale: base.scale, perFoot: 1, wants: base.wants, titleValues: base.titleValues,
        reading: base.reading, tiles: null, extra: { titleValues: base.titleValues } });
    check(res.made.join() === "Plan" && res.rewritten.length === 0, "first run creates layout Plan: " + res.made);
    var info = Layouts.get(doc, "Plan");
    check(!isNull(info) && info.mode === "auto", "Plan is an AUTO layout");
    check(near(info.paperMM.w, 279.4) && near(info.paperMM.h, 215.9), "paper is ANSI A landscape");
    check(doc.queryBlockEntities(doc.getModelSpaceBlockId()).length === model0, "nothing was written into model space");
    var c1 = countBy(doc, info.blockId);
    check(c1.kinds.viewport === 1, "one viewport");
    check(c1.kinds.SCALE_BAR > 0 || c1.kinds["SCALE-BAR"] > 0, "a scale bar was drawn");
    check(c1.kinds["NORTH-ARROW"] > 0 && c1.kinds["TITLE-BLOCK"] > 0, "north arrow and title block drawn");
    check(c1.kinds.BORDER > 0, "margin border drawn (a sheet with a footer band)");

    var vpId = 0;
    var ids = doc.queryBlockEntities(info.blockId);
    var vp;
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (e.getType() === RS.EntityViewport) { vp = e; }
    }
    check(!isNull(vp), "viewport entity found");
    check(near(vp.getScale(), (1 / 12) / 20, 1e-9), "viewport scale is 1 in = 20 ft in feet-per-feet: " + vp.getScale());
    check(near(vp.getWidth(), 10 / 12, 1e-9), "viewport width = sheet minus two 0.5in margins (10in)");
    check(near(vp.getViewCenter().x, ox + 50, 1e-6), "view centre is a real model coordinate");
    var frozen = vp.getFrozenLayerIds().map(function(id) { return doc.getLayerName(id); });
    check(frozen.indexOf("PROFILE-WALL") >= 0 && frozen.indexOf("WALL-SURVEYED") < 0 &&
          frozen.indexOf("0") < 0 && frozen.indexOf("BORDER") < 0,
          "profile layers frozen in the plan viewport; plan and shared sheet layers (0, BORDER) are not: " + frozen.join());
    check(String(vp.getCustomProperty("CaveCAD", "NoRaster")) === "1", "the viewport says: no raster images");

    // ---- re-run: auto layout rewritten in place, no copies -------------
    var res2 = CsLayoutGen.generate(doc, di, { caveBox: base.caveBox, sheet: base.sheet, turned: false,
        scale: 25, perFoot: 1, wants: base.wants, titleValues: base.titleValues, reading: base.reading, tiles: null });
    check(res2.rewritten.join() === "Plan" && res2.made.length === 0, "second run rewrites, creates nothing new");
    var c2 = countBy(doc, info.blockId);
    check(c2.kinds.viewport === 1, "still ONE viewport after the rewrite");
    check(Layouts.list(doc).length === 1, "still one layout");

    // ---- manual layouts are left alone ----------------------------------
    Layouts.setMode(di, "Plan", "manual");
    var before = countBy(doc, info.blockId).n;
    var res3 = CsLayoutGen.generate(doc, di, { caveBox: base.caveBox, sheet: base.sheet, turned: false,
        scale: 10, perFoot: 1, wants: base.wants, titleValues: base.titleValues, reading: base.reading, tiles: null });
    check(res3.skipped.join() === "Plan" && countBy(doc, info.blockId).n === before, "a MANUAL layout is skipped and untouched");
    Layouts.setMode(di, "Plan", "auto");

    // ---- a big cave: tiles ------------------------------------------------
    var big = { minX: ox, minY: oy, maxX: ox + 900, maxY: oy + 400 };
    var tiles = CsSheetTile.layout({ caveBox: big, sheet: sheet, scale: 20, footerInches: 0,
        turned: false, occupied: [big], shiftInches: { x: 0, y: 0 } });
    check(tiles.tiled === true && tiles.tiles.length >= 4, "the big cave tiles: " + tiles.tiles.length + " sheets");
    var res4 = CsLayoutGen.generate(doc, di, { caveBox: big, sheet: sheet, turned: false, scale: 20, perFoot: 1,
        wants: base.wants, titleValues: base.titleValues, reading: base.reading, tiles: tiles });
    check(res4.made.length === tiles.tiles.length, "one layout per tile: " + res4.made.join());
    var nTitle = 0, allShow = true;
    for (var t = 0; t < tiles.tiles.length; t++) {
        var tile = tiles.tiles[t];
        var inf = Layouts.get(doc, tile.id);
        var kinds = countBy(doc, inf.blockId).kinds;
        if (kinds["TITLE-BLOCK"] > 0) nTitle++;
        var tvp;
        var tids = doc.queryBlockEntities(inf.blockId);
        for (var q = 0; q < tids.length; q++) {
            var te = doc.queryEntity(tids[q]);
            if (te.getType() === RS.EntityViewport) tvp = te;
        }
        // the model rectangle the viewport shows: view centre +- half the frame / scale
        var halfW = tvp.getWidth() / 2 / tvp.getScale(), halfH = tvp.getHeight() / 2 / tvp.getScale();
        var ok = near(tvp.getViewCenter().x - halfW, tile.map.minX, 1e-4) &&
                 near(tvp.getViewCenter().x + halfW, tile.map.maxX, 1e-4) &&
                 near(tvp.getViewCenter().y - halfH, tile.map.minY, 1e-4) &&
                 near(tvp.getViewCenter().y + halfH, tile.map.maxY, 1e-4);
        if (!ok) { allShow = false; print("  tile " + tile.id + " shows the wrong area"); }
        check(kinds.matchline > 0 || tiles.tiles.length === 1, "tile " + tile.id + " has match lines");
    }
    check(allShow, "every tile's viewport shows exactly the tile's map rectangle");
    check(nTitle === 1, "exactly one sheet carries the title block: " + nTitle);
    check(Layouts.get(doc, "A1") !== undefined, "tiles are named by grid place (A1 exists)");

    if (fails === 0) print("### LAYOUT GEN OK");
    QCoreApplication.exit(fails === 0 ? 0 : 1);
}
main();
