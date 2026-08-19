// Tags.js -- reading and writing survey data on entities.
//
// Part of the Cave Survey Core library. QCAD context only, but with
// no opinions about layers or geometry -- just custom properties.
//
// Everything rides under the property group "CaveSurvey":
//   Station      station name, on CTRL-STATIONS points
//   LRUDName     "A1.L" / "A1.R", on CTRL-LRUD tip points
//   Seq          integer resolution order, on station points -- what
//                LRUDWalls sorts by instead of entity creation order
//   Inclination, Left, Right, Up, Down, Elevation   shot data
//   Azimuth      the azimuth of the shot that reached the station
//                (the LRUD direction reference)
//   SurveyName, SurveyDate, SurveyTeam, Declination, DeclinationSource,
//   DistanceUnit   survey-level metadata, on the anchor station point
//   BoundaryId   ScatterBreakdown's per-boundary ownership tag
//   GeoLat, GeoLon, GeoStation   the georeference anchor, stored as
//                data instead of destructively rescaling the drawing
//
// Custom properties are unavailable in some contexts, so every write
// degrades silently -- a missing tag costs a convenience later, never
// a crash now.

var CsTags = {};

CsTags.GROUP = "CaveSurvey";

/** Writes one tag; silently does nothing where unsupported. */
CsTags.set = function(entity, key, value) {
    if (entity === undefined || entity === null) {
        return;
    }
    if (value === undefined || value === null || value === "") {
        return;
    }
    if (typeof entity.setCustomProperty !== "function") {
        return;
    }
    try {
        entity.setCustomProperty(CsTags.GROUP, key, value);
    } catch (e) {
        // not supported here -- non-critical
    }
};

/**
 * Writes tags onto an entity ALREADY IN the document. Setting a
 * property on a queried entity mutates only the script-side copy;
 * committing it back needs a modify operation with addObject(e,
 * false) -- the false keeps the entity's layer untouched.
 */
CsTags.commit = function(di, entity, keyValues) {
    for (var k in keyValues) {
        if (keyValues.hasOwnProperty(k)) {
            CsTags.set(entity, k, keyValues[k]);
        }
    }
    var op = new RModifyObjectsOperation();
    op.addObject(entity, false);
    di.applyOperation(op);
};

/** Reads one tag, "" if absent or unsupported. */
CsTags.get = function(entity, key) {
    if (entity === undefined || entity === null) {
        return "";
    }
    if (typeof entity.getCustomProperty !== "function") {
        return "";
    }
    try {
        var v = entity.getCustomProperty(CsTags.GROUP, key, "");
        return (v === undefined || v === null) ? "" : String(v);
    } catch (e) {
        return "";
    }
};

/** Reads a numeric tag; null if absent or not a number. */
CsTags.getNumber = function(entity, key) {
    var v = CsTags.get(entity, key);
    if (v === "") {
        return null;
    }
    var n = parseFloat(v);
    return isNaN(n) ? null : n;
};

/** Tags a station point with its full shot data. */
CsTags.tagStation = function(entity, data) {
    CsTags.set(entity, "Station", data.name);
    CsTags.set(entity, "Seq", data.seq);
    CsTags.set(entity, "Azimuth", data.azimuth);
    CsTags.set(entity, "Inclination", data.inclination);
    CsTags.set(entity, "Left", data.left);
    CsTags.set(entity, "Right", data.right);
    CsTags.set(entity, "Up", data.up);
    CsTags.set(entity, "Down", data.down);
    CsTags.set(entity, "Elevation", data.z);
};

/**
 * Collects every tagged station point in the document:
 * [{entity, name, seq, pos}] sorted by Seq where present, falling
 * back to entity order for drawings made by the old tools.
 */
CsTags.collectStations = function(doc) {
    var out = [];
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || typeof e.getPosition !== "function") {
            continue;
        }
        var name = CsTags.get(e, "Station");
        if (name === "") {
            continue;
        }
        var seq = CsTags.getNumber(e, "Seq");
        out.push({ entity: e, name: name, seq: seq, pos: e.getPosition() });
    }
    out.sort(function(a, b) {
        if (a.seq !== null && b.seq !== null) {
            return a.seq - b.seq;
        }
        if (a.seq !== null) {
            return -1;
        }
        if (b.seq !== null) {
            return 1;
        }
        return 0; // stable: keeps entity order for untagged legacy data
    });
    return out;
};

/**
 * Rebuilds a CsModel survey from a drawing's tags -- the property
 * that lets any tool run on any drawing the suite (or the previous
 * generation of it) produced. Stations only; shots are reconstructed
 * as far as the tags allow (azimuth/LRUD per station).
 */
CsTags.surveyFromDocument = function(doc) {
    var survey = CsModel.newSurvey();
    var stations = CsTags.collectStations(doc);
    var prev = null;
    for (var i = 0; i < stations.length; i++) {
        var st = stations[i];
        if (prev !== null) {
            var shot = CsModel.newShot();
            shot.from = prev.name;
            shot.to = st.name;
            var az = CsTags.getNumber(st.entity, "Azimuth");
            var dx = st.pos.x - prev.pos.x;
            var dy = st.pos.y - prev.pos.y;
            shot.distance = Math.sqrt(dx * dx + dy * dy);
            shot.azimuth = az !== null ? az :
                CsAngles.normalizeAzimuth(Math.atan2(dx, dy) * 180.0 / Math.PI);
            var inc = CsTags.getNumber(st.entity, "Inclination");
            shot.inclination = inc !== null ? inc : 0.0;
            shot.left = CsTags.getNumber(st.entity, "Left");
            shot.right = CsTags.getNumber(st.entity, "Right");
            shot.up = CsTags.getNumber(st.entity, "Up");
            shot.down = CsTags.getNumber(st.entity, "Down");
            survey.shots.push(shot);
        }
        survey.fixed[st.name] = { x: st.pos.x, y: st.pos.y,
            z: CsTags.getNumber(st.entity, "Elevation") || 0.0 };
        prev = st;
    }
    return survey;
};
