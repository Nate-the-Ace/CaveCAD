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
// THE FIX: a "survey database" -- one text entity on the CTRL-DATA
// layer -- rewritten whenever tags change and consulted by CsTags.get
// as the fallback when an entity's in-memory tag is empty.
//
// Records are keyed by GEOMETRY (entity type + position), not by
// handle: the exporter RENUMBERS handles on save (learned from a real
// file whose store keys matched nothing after reopen), but a point's
// coordinates survive any round trip bit-for-bit close. Position is
// rounded to 1e-4 drawing units for matching; co-located duplicates
// (tie-in redraws) share one record, which is correct -- they carry
// the same data.

var CsStore = {};

CsStore.LAYER = "CTRL-DATA";
CsStore.MARKER = "CAVESURVEYDB v3 ";
// Record format (deliberately NOT JSON: MTEXT treats braces as
// formatting groups, and this build only exposes getPlainText):
//   <type>:<x>:<y>|key=encoded|key=encoded;;...
// with x/y printed to 4 decimals; values URI-encoded, so separators
// can never occur inside them.
// every tag key the suite writes; sync scans these
CsStore.KEYS = ["Station", "Seq", "Azimuth", "Inclination",
    "Left", "Right", "Up", "Down", "Elevation",
    "StationLabel", "LRUDName", "LRUDLine", "LRUDNote", "Shot",
    "WallRun", "BoundaryId", "LegendRow",
    "GeoLat", "GeoLon", "GeoStation",
    "SurveyName", "SurveyDate", "SurveyTeam",
    "Declination", "DeclinationSource", "DistanceUnit"];

CsStore.map = null; // geoKey -> {key: value}, for the loaded document

/**
 * The geometry key of an entity: type + position to 4 decimals.
 * Points and texts use their position; lines their midpoint;
 * anything else its bounding-box middle.
 */
CsStore.geoKey = function(entity) {
    var p = null;
    try {
        if (typeof entity.getPosition === "function") {
            p = entity.getPosition();
        } else if (typeof entity.getStartPoint === "function" &&
                typeof entity.getEndPoint === "function") {
            var a = entity.getStartPoint();
            var b = entity.getEndPoint();
            p = new RVector((a.x + b.x) / 2.0, (a.y + b.y) / 2.0);
        } else if (typeof entity.getBoundingBox === "function") {
            p = entity.getBoundingBox().getCenter();
        }
    } catch (e) {
        p = null;
    }
    if (p === null) {
        return null;
    }
    return entity.getType() + ":" + p.x.toFixed(4) + ":" + p.y.toFixed(4);
};

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
            // any version: sync must find and REPLACE stale stores too
            if (t.indexOf("CAVESURVEYDB ") === 0) {
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
    if (text.indexOf(CsStore.MARKER) !== 0) {
        return map; // older store version: keys are meaningless now
    }
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
    var gk = CsStore.geoKey(entity);
    if (gk === null) {
        return "";
    }
    var rec = CsStore.map[gk];
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
        if (isNull(e)) {
            continue;
        }
        var gk = CsStore.geoKey(e);
        if (gk === null) {
            continue;
        }
        // carry the old record for this geometry forward, overlay
        // whatever native in-memory tags the entity still has
        var rec = old[gk] !== undefined ? old[gk] : {};
        var found = old[gk] !== undefined;
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
            if (entities[gk] !== undefined) {
                // co-located duplicate: merge (tie-in redraws share data)
                for (var mk in rec) {
                    if (rec.hasOwnProperty(mk)) {
                        entities[gk][mk] = rec[mk];
                    }
                }
            } else {
                entities[gk] = rec;
            }
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
