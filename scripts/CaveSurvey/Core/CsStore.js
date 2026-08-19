// CsStore.js -- tag persistence that survives save and reopen.
//
// Part of the Cave Survey Core library. QCAD context only.
//
// THE PROBLEM: this QCAD build never writes custom properties to
// disk -- not in any DXF/DWG format, with either writer (verified by
// headless export probing). Tags work in memory, then a save/reopen
// silently discards every one, killing tie-ins, replace-on-draw,
// LRUD Walls and Stats on any drawing that has been closed once.
//
// THE FIX: entity HANDLES do survive save/reopen (verified the same
// way). So the suite keeps a "survey database" -- one text entity on
// a frozen CTRL-DATA layer holding JSON keyed by entity handle --
// rewritten whenever tags change, and consulted by CsTags.get as the
// fallback when an entity's in-memory tag is empty. Tools call
// CsStore.ensureLoaded(doc) before reading and CsStore.sync(doc, di)
// after writing; CsTags does the rest transparently.

var CsStore = {};

CsStore.LAYER = "CTRL-DATA";
CsStore.MARKER = "CAVESURVEYDB v2 ";
// Record format (deliberately NOT JSON: MTEXT treats braces as
// formatting groups, and this build only exposes getPlainText):
//   <handle>|key=encoded|key=encoded;;<handle>|...
// values URI-encoded, so separators can never occur inside them.
// every tag key the suite writes; sync scans these
CsStore.KEYS = ["Station", "Seq", "Azimuth", "Inclination",
    "Left", "Right", "Up", "Down", "Elevation",
    "StationLabel", "LRUDName", "LRUDLine", "LRUDNote", "Shot",
    "WallRun", "BoundaryId", "LegendRow",
    "GeoLat", "GeoLon", "GeoStation",
    "SurveyName", "SurveyDate", "SurveyTeam",
    "Declination", "DeclinationSource", "DistanceUnit"];

CsStore.map = null; // handle -> {key: value}, for the loaded document

/** Finds the store text entity, or null. */
CsStore.findStoreEntity = function(doc) {
    if (!doc.hasLayer(CsStore.LAYER)) {
        return null;
    }
    var layerId = doc.getLayerId(CsStore.LAYER);
    var ids = doc.queryAllEntities(false, true); // include invisible/frozen
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || e.getLayerId() !== layerId) {
            continue;
        }
        if (typeof e.getPlainText === "function") {
            var t = String(e.getPlainText());
            if (t.indexOf(CsStore.MARKER) === 0) {
                return e;
            }
        }
    }
    return null;
};

/** Loads (always fresh) the store JSON for this document. */
CsStore.ensureLoaded = function(doc) {
    CsStore.map = {};
    var store = CsStore.findStoreEntity(doc);
    if (store === null) {
        return;
    }
    CsStore.map = CsStore.parse(String(store.getPlainText()));
};

/** Parses the record format; corrupt input parses to empty. */
CsStore.parse = function(text) {
    var map = {};
    try {
        var body = text.substring(CsStore.MARKER.length);
        var records = body.split(";;");
        for (var i = 0; i < records.length; i++) {
            var fields = records[i].split("|");
            if (fields.length < 2 || fields[0] === "") {
                continue;
            }
            var rec = {};
            for (var f = 1; f < fields.length; f++) {
                var eq = fields[f].indexOf("=");
                if (eq > 0) {
                    rec[fields[f].substring(0, eq)] =
                        decodeURIComponent(fields[f].substring(eq + 1));
                }
            }
            map[fields[0]] = rec;
        }
    } catch (e) {
        return {};
    }
    return map;
};

/** Serializes the handle map into the record format. */
CsStore.serialize = function(entities) {
    var records = [];
    for (var h in entities) {
        if (!entities.hasOwnProperty(h)) {
            continue;
        }
        var parts = [h];
        for (var k in entities[h]) {
            if (entities[h].hasOwnProperty(k)) {
                parts.push(k + "=" + encodeURIComponent(String(entities[h][k])));
            }
        }
        if (parts.length > 1) {
            records.push(parts.join("|"));
        }
    }
    return CsStore.MARKER + records.join(";;");
};

/** Fallback lookup for CsTags.get. */
CsStore.lookup = function(entity, key) {
    if (CsStore.map === null) {
        return "";
    }
    if (typeof entity.getHandle !== "function") {
        return "";
    }
    var rec = CsStore.map[String(entity.getHandle())];
    if (rec === undefined || rec[key] === undefined) {
        return "";
    }
    return String(rec[key]);
};

/**
 * Rebuilds and rewrites the store: native in-memory tags win, the
 * previously stored record fills in what a reopen erased, and
 * handles no longer in the document drop out. One operation.
 */
CsStore.sync = function(doc, di) {
    var storeEntity = CsStore.findStoreEntity(doc);
    var old = storeEntity !== null ?
        CsStore.parse(String(storeEntity.getPlainText())) : {};

    var entities = {};
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || typeof e.getHandle !== "function") {
            continue;
        }
        var h = String(e.getHandle());
        var rec = old[h] !== undefined ? old[h] : {};
        var found = old[h] !== undefined;
        for (var k = 0; k < CsStore.KEYS.length; k++) {
            var key = CsStore.KEYS[k];
            var v = "";
            if (typeof e.getCustomProperty === "function") {
                try {
                    v = e.getCustomProperty(CsTags.GROUP, key, "");
                    v = (v === undefined || v === null) ? "" : String(v);
                } catch (e2) {
                    v = "";
                }
            }
            if (v !== "") {
                rec[key] = v;
                found = true;
            }
        }
        if (found) {
            entities[h] = rec;
        }
    }

    // Write the store text. The layer lives switched OFF so the
    // store never shows on screen or plot -- but off layers refuse
    // adds, so the op turns the layer on FIRST (object order within
    // one operation is sequential), adds the text, and a second tiny
    // op flips the layer back off.
    CsLayers.ensure(doc, di, CsStore.LAYER);

    var lay = doc.queryLayer(CsStore.LAYER);
    lay.setOff(false);

    var op = new RAddObjectsOperation();
    op.setText("Survey data store");
    op.addObject(lay, false);
    if (storeEntity !== null) {
        op.deleteObject(storeEntity);
    }
    var payload = CsStore.serialize(entities);
    var data = new RTextData(new RVector(0, 0), new RVector(0, 0),
        0.1, 100.0, RS.VAlignMiddle, RS.HAlignLeft, RS.LeftToRight,
        RS.Exact, 1.0, payload, "standard", false, false, 0.0, false);
    var text = new RTextEntity(doc, data);
    text.setLayerId(doc.getLayerId(CsStore.LAYER));
    op.addObject(text, false);
    di.applyOperation(op);

    var layOff = doc.queryLayer(CsStore.LAYER);
    layOff.setOff(true);
    var opOff = new RModifyObjectsOperation();
    opOff.addObject(layOff, false);
    di.applyOperation(opOff);

    CsStore.map = entities;
};
