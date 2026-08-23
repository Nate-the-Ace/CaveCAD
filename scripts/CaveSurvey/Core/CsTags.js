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
//   DistanceUnit   survey-level metadata, on the anchor station point.
//                Declination ALSO appears on a leg or splay line,
//                where it means that one shot's applied declination
//                instead (see CsDraw's legTags)
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
        // newlines would break single-line carriers (DXF XDATA group
        // values); escape on write, unescape in CsTags.get
        var v = String(value).replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n");
        entity.setCustomProperty(CsTags.GROUP, key, v);
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
    if (typeof CsStore !== "undefined") {
        // custom properties persist natively (DXF XDATA); this only
        // converts a legacy drawing's store text, then deletes it
        CsStore.migrate(getDocument(), di);
    }
};

/** Reads one tag, "" if absent or unsupported. Falls back to the
 *  legacy survey data store (CsStore) for drawings saved by early
 *  builds, whose tags live only in the store text until a modifying
 *  tool migrates them onto the entities. */
CsTags.get = function(entity, key) {
    if (entity === undefined || entity === null) {
        return "";
    }
    var v = "";
    if (typeof entity.getCustomProperty === "function") {
        try {
            v = entity.getCustomProperty(CsTags.GROUP, key, "");
            v = (v === undefined || v === null) ? "" : String(v);
        } catch (e) {
            v = "";
        }
    }
    if (v === "" && typeof CsStore !== "undefined") {
        v = CsStore.lookup(entity, key);
    }
    // undo the newline escaping applied in CsTags.set
    return v.replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
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
    CsTags.set(entity, "Left", CsModel.lrudEntryText(data.left, data.leftAll));
    CsTags.set(entity, "Right", CsModel.lrudEntryText(data.right, data.rightAll));
    CsTags.set(entity, "Up", CsModel.lrudEntryText(data.up, data.upAll));
    CsTags.set(entity, "Down", CsModel.lrudEntryText(data.down, data.downAll));
    CsTags.set(entity, "Elevation", data.z);
    CsTags.set(entity, "Note", data.note);
};

/**
 * Collects every tagged station point in the document:
 * [{entity, name, seq, pos}] sorted by Seq where present, falling
 * back to entity order for drawings made by the old tools.
 */
CsTags.collectStations = function(doc) {
    if (typeof CsStore !== "undefined") {
        CsStore.ensureLoaded(doc);
    }
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
 *
 * SEVENTH DOOR in the elevation-datum-trap family (CsTraverse.offset's
 * own docblock names the first five; CsNetwork.resolve's anchorEffectiveZ
 * comment names the sixth and is the direct model for this one): every
 * station this function reconstructs is written into survey.fixed with
 * a REAL x/y/z, whether or not the drawing's own Elevation tag actually
 * had a number in it -- `CsTags.getNumber(...) || 0.0` used to treat "no
 * tag" and "unparseable tag" exactly like a real, surveyed 0.0, the same
 * disease as every other door in this family. UNREACHABLE TODAY: nothing
 * this suite ships ever writes a station without an Elevation tag, and
 * every current writer of that tag parses to a real number -- but this
 * function's own docblock advertises reading foreign and hand-edited
 * drawings, and a drawing edited by hand (or written by a future format
 * reader) is exactly where a missing or garbled Elevation tag would
 * first appear. WHAT ABSENT SHOULD DO: report it as null, not invent a
 * sea-level datum for a cave that may be surveyed to an unrelated
 * absolute one -- the same answer CsNetwork.resolve's anchor path
 * already gives for the identical question, and CsTraverse.unusable /
 * CsProfile.zOf already treat null as "no resolved elevation" rather
 * than crashing on it. CsNetwork.resolve's own seedFixed had the exact
 * same `f.z || 0.0` fabrication one frame downstream of survey.fixed
 * (see its own comment, which used to say this exact station-tag path
 * was the reason that line could never actually see a null) -- fixed in
 * the same change, or this fix would only have made the OBJECT more
 * honest without changing what actually gets resolved and drawn.
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
            var lrudTag = function(key) {
                return CsModel.parseLrudEntry(CsTags.get(st.entity, key));
            };
            var eL = lrudTag("Left"), eR = lrudTag("Right");
            var eU = lrudTag("Up"), eD = lrudTag("Down");
            shot.left = eL.value; shot.leftAll = eL.all;
            shot.right = eR.value; shot.rightAll = eR.all;
            shot.up = eU.value; shot.upAll = eU.all;
            shot.down = eD.value; shot.downAll = eD.all;
            shot.notes = CsTags.get(st.entity, "Note");
            survey.shots.push(shot);
        }
        if (prev === null) {
            survey.startNote = CsTags.get(st.entity, "Note");
        }
        survey.fixed[st.name] = { x: st.pos.x, y: st.pos.y,
            z: CsTags.getNumber(st.entity, "Elevation") };
        prev = st;
    }
    return survey;
};
