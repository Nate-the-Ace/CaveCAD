// CsSketchStore.js -- which sketches are already in this drawing, and
// which ones sit beside the survey file.
//
// Part of the Cave Survey Core library. Reads the document and the
// filesystem, so it is covered by tests/sketch_import_run.js rather
// than by js_unit.js.
//
// THE READING HALF of CsSketchDraw's stamps. Every entity an import
// writes carries the file it came from, the scrap it came from and its
// index in that scrap; this file is what turns those back into "you
// have already imported plan1 from PitfallCave.th2, and there are 63
// entities of it in this drawing".
//
// WHY THAT QUESTION MATTERS ENOUGH TO ANSWER PROPERLY. A sketch gets
// re-exported: another trip is added, a wall is redrawn on the phone,
// the file comes round again. By then a caver has very likely worked on
// the imported ink here -- trimmed a wall, moved a symbol, traced over
// a gap. Importing the scrap again without asking is either a silent
// overwrite of somebody's evening or two of everything. So the rule is
// REFUSE AND ASK, per scrap: this file supplies the facts, the tool
// asks the question, and a replace is a delete of exactly these ids
// followed by an ordinary import.
//
// A BACKUP IS TAKEN BEFORE A REPLACE. CsBackup's own header explains
// why the moment matters; a replace is precisely one of this suite's
// destructive operations.

var CsSketchStore = {};

/**
 * The .th2 files sitting beside a survey file.
 *
 * BESIDE, not searched for. A Therion project exported from
 * TopoDroid is a folder: the .th with the numbers, one .th2 per
 * sketched scrap page, sometimes a .thconfig naming them. Walking
 * further than the file's own directory would start claiming sketches
 * from other caves that happen to share a parent folder.
 *
 * \param surveyPath the path of the .th (or any file) just imported.
 * \return an array of absolute paths, in the order the directory
 *         lists them, and [] when there are none.
 */
CsSketchStore.siblings = function(surveyPath) {
    var out = [];
    if (surveyPath === undefined || surveyPath === null ||
            String(surveyPath) === "") {
        return out;
    }
    var info = new QFileInfo(String(surveyPath));
    var dir = info.absoluteDir();
    var names = dir.entryList(["*.th2", "*.TH2"], QDir.Files, QDir.Name);
    for (var i = 0; i < names.length; i++) {
        out.push(dir.absoluteFilePath(names[i]));
    }
    return out;
};

/**
 * A file's own base name, which is what the stamps record.
 *
 * Not its path: a cave folder moves between machines and a sync
 * drive, and a path recorded in the drawing would stop matching the
 * first time it did.
 */
CsSketchStore.nameOf = function(path) {
    if (path === undefined || path === null) {
        return "";
    }
    return String(new QFileInfo(String(path)).fileName());
};

/**
 * Every entity in the drawing that came from a scrap.
 *
 * \return an array of {id, file, scrap, index, type}.
 */
CsSketchStore.imported = function(doc) {
    var out = [];
    if (isNull(doc)) {
        return out;
    }
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var entity = doc.queryEntity(ids[i]);
        if (isNull(entity)) {
            continue;
        }
        var file = CsTags.get(entity, CsSketchDraw.KEY.FILE);
        if (file === "") {
            continue;
        }
        out.push({ id: ids[i], file: file,
            scrap: CsTags.get(entity, CsSketchDraw.KEY.SCRAP),
            index: CsTags.get(entity, CsSketchDraw.KEY.INDEX),
            type: CsTags.get(entity, CsSketchDraw.KEY.TYPE) });
    }
    return out;
};

/**
 * How much of each scrap is already here.
 *
 * \return {"<file>|<scrap>": count}, which is the key the tool asks
 *         its question by.
 */
CsSketchStore.present = function(doc) {
    var counts = {};
    var rows = CsSketchStore.imported(doc);
    for (var i = 0; i < rows.length; i++) {
        var key = CsSketchStore.keyFor(rows[i].file, rows[i].scrap);
        counts[key] = (counts[key] === undefined) ? 1 : counts[key] + 1;
    }
    return counts;
};

/** The one spelling of a scrap's identity, so nothing invents a second. */
CsSketchStore.keyFor = function(file, scrap) {
    return String(file) + "|" + String(scrap);
};

/**
 * The ids belonging to one scrap of one file.
 */
CsSketchStore.idsOf = function(doc, file, scrap) {
    var out = [];
    var rows = CsSketchStore.imported(doc);
    for (var i = 0; i < rows.length; i++) {
        if (rows[i].file === file && rows[i].scrap === scrap) {
            out.push(rows[i].id);
        }
    }
    return out;
};

/**
 * Deletes one scrap's worth of entities.
 *
 * WHAT IT DOES NOT DELETE: anything a caver drew themselves, because
 * only imported entities carry the stamp; and anything GENERATED from
 * an imported entity -- a shaped line's ornament, an area's fill --
 * because those carry their own owner tags and their own tools rebuild
 * them from the spine or boundary. Deleting a stamped spine and leaving
 * its ornament would leave decoration floating over nothing, so the
 * caller runs the ordinary regeneration afterwards, exactly as it would
 * after any other delete.
 *
 * \return how many entities went.
 */
CsSketchStore.remove = function(doc, di, ids, group) {
    if (isNull(doc) || isNull(di) || ids === null || ids.length === 0) {
        return 0;
    }
    var op = new RDeleteObjectsOperation();
    var gone = 0;
    for (var i = 0; i < ids.length; i++) {
        var entity = doc.queryEntityDirect(ids[i]);
        if (isNull(entity)) {
            continue;
        }
        op.deleteObject(entity);
        gone++;
    }
    if (gone === 0) {
        return 0;
    }
    if (group !== null && group !== undefined && group >= 0) {
        op.setTransactionGroup(group);
    }
    di.applyOperation(op);
    return gone;
};

/**
 * Where every station in the drawing sits, in the PLAN.
 *
 * The targets a plan scrap is fitted onto. Keyed by name, upper case
 * as the drawing letters them; CsSketchPlace.lookupStation is what
 * copes with a sketch spelling them differently.
 */
CsSketchStore.planTargets = function(doc) {
    var targets = {};
    if (isNull(doc)) {
        return targets;
    }
    var stations = CsTags.collectStations(doc);
    for (var i = 0; i < stations.length; i++) {
        var station = stations[i];
        targets[station.name] = { x: station.pos.x, y: station.pos.y };
    }
    return targets;
};

/**
 * The drawing units one scrap unit is worth, from the scrap's own
 * declared scale.
 *
 * Only ever used for a scrap with a single station tie, where the
 * pairs cannot say it -- see CsSketchPlace.solve. The conversion is
 * here rather than there because only a caller with a document knows
 * what unit the drawing is in.
 *
 * \return a positive number, or null when the scrap declares no scale
 *         this reader could read.
 */
CsSketchStore.scaleFactor = function(doc, scrap) {
    if (isNull(doc) || scrap === null || scrap === undefined ||
            scrap.scale === null || scrap.scale === undefined) {
        return null;
    }
    var drawingUnit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
    var perUnit = scrap.scale.unitsPerDrawing;
    if (!(perUnit > 0)) {
        return null;
    }
    return CsUnits.convert(perUnit, scrap.scale.unit, drawingUnit);
};
