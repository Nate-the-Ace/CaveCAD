// CsRevise.js -- exact survey reconstruction from a drawing's tags.
//
// Part of the Cave Survey Core library. Pure ES5 at file scope (no
// R*/document API outside functions), so it loads under node; the
// document-scanning entry points are only callable where a document
// exists.
//
// CsTags.surveyFromDocument, the v1/v2 reader, GUESSES: it chains the
// stations in Seq order and infers each shot from drawn geometry.
// Tag schema v3 (written by CsDraw.survey) makes guessing obsolete --
// every leg line carries its shot's full data, trip anchors carry
// trip metadata, and the shots the drawing can't show as geometry
// ride the trip-0 anchor as serialized rows -- so this module reads
// the survey back EXACTLY, field for field. That exactness is what
// makes revision tooling safe: reconstruct, edit, redraw, and nothing
// silently drifts.
//
// Drawings older than v3 (tagged stations exist, but not one leg has
// a Distance tag) fall back to the legacy chain-guesser, flagged
// legacy:true so callers know the result is approximate.
//
// NOT reconstructed: GeoLat/GeoLon/GeoStation. CsModel's survey shape
// has no geo field to put them in; the georeference stays a
// drawing-level tag (see CsTags.js) rather than survey data.

var CsRevise = {};

/**
 * One drawn leg (or splay) line back into a full CsModel shot, from
 * its v3 tags. Numeric fields that are never null in the model
 * (distance/azimuth/inclination) fall back to 0.0 when the tag is
 * missing; the backsight pair genuinely can be absent and stays null.
 */
CsRevise.shotFromEntity = function(e) {
    var shot = CsModel.newShot();
    var num = function(key, fallback) {
        var n = CsTags.getNumber(e, key);
        return n === null ? fallback : n;
    };
    shot.from = CsTags.get(e, "From");
    shot.to = CsTags.get(e, "To");
    shot.distance = num("Distance", 0.0);
    shot.azimuth = num("Azimuth", 0.0);
    shot.inclination = num("Inclination", 0.0);
    shot.backAzimuth = CsTags.getNumber(e, "BackAzimuth");
    shot.backInclination = CsTags.getNumber(e, "BackInclination");
    var sides = [["left", "Left"], ["right", "Right"],
        ["up", "Up"], ["down", "Down"]];
    for (var i = 0; i < sides.length; i++) {
        var entry = CsModel.parseLrudEntry(CsTags.get(e, sides[i][1]));
        shot[sides[i][0]] = entry.value;
        shot[sides[i][0] + "All"] = entry.all;
    }
    CsModel.parseFlags(CsTags.get(e, "Flags"), shot);
    shot.notes = CsTags.get(e, "Note");
    shot.trip = num("Trip", 0);
    return shot;
};

/**
 * Rebuilds the survey a drawing was drawn FROM, exactly.
 *
 * One pass over every entity:
 *   station points   position; Fixed -> survey.fixed; trip-anchor
 *                    tags -> trip records; the trip-0 anchor also
 *                    StartNote/StartLrud, the legacy SurveyName
 *                    (which stored caveName||name -- the ambiguity is
 *                    accepted, it becomes caveName), and the
 *                    ExcludedShots/UnplacedShots row blobs
 *   leg lines        From + Distance tags -> a full shot each
 *   splay lines      Splay + Distance tags -> a splay shot each
 *
 * Legs, splays and serialized rows all carry (trip, shotSeq); merging
 * them sorted by that pair restores the original notebook order
 * within each trip, trips in id order.
 *
 * \return {
 *   survey      the reconstructed CsModel survey
 *   anchorName  the trip-0 anchor station's name ("" if none)
 *   anchorPos   its drawing position (null if none)
 *   legacy      true when the drawing predates schema v3 and the
 *               result came from CsTags.surveyFromDocument's
 *               chain-guessing instead
 * }
 */
CsRevise.surveyFromDocument = function(doc) {
    if (typeof CsStore !== "undefined") {
        CsStore.ensureLoaded(doc);
    }

    var stations = [];      // {name, seq, pos}
    var tripRecs = {};      // trip id -> trip record from its anchor
    var maxTrip = -1;
    var fixed = {};
    var caveName = null;
    var anchorStation = null; // the trip-0 anchor's station record
    var exBlob = "", unBlob = "";
    var placed = [];        // {shot, trip, seq, ord} from legs + splays
    var ord = 0;            // scan-order tiebreaker (stable sort)

    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }

        var stName = CsTags.get(e, "Station");
        if (stName !== "" && typeof e.getPosition === "function") {
            var st = { name: stName, seq: CsTags.getNumber(e, "Seq"),
                pos: e.getPosition() };
            stations.push(st);
            var fx = CsTags.get(e, "Fixed");
            if (fx !== "") {
                var fp = fx.split(",");
                var fnum = function(v) {
                    var n = parseFloat(v);
                    return isNaN(n) ? 0.0 : n;
                };
                fixed[stName] = { x: fnum(fp[0]), y: fnum(fp[1]),
                    z: fnum(fp[2]) };
            }
            if (CsTags.get(e, "Trip") !== "" ||
                    CsTags.get(e, "TripDeclination") !== "") {
                var tid = CsTags.getNumber(e, "Trip");
                tid = tid === null ? 0 : tid;
                var trip = CsModel.newTrip();
                trip.name = CsTags.get(e, "TripName");
                trip.date = CsTags.get(e, "TripDate");
                trip.team = CsTags.get(e, "TripTeam");
                var td = CsTags.getNumber(e, "TripDeclination");
                trip.declination = td === null ? 0.0 : td;
                trip.declinationSource =
                    CsTags.get(e, "TripDeclinationSource");
                var tu = CsTags.get(e, "TripDistanceUnit");
                if (tu !== "") {
                    trip.distanceUnit = tu;
                }
                tripRecs[tid] = trip;
                if (tid > maxTrip) {
                    maxTrip = tid;
                }
                if (tid === 0) {
                    anchorStation = st;
                    trip.startNote = CsTags.get(e, "StartNote");
                    trip.startLrud =
                        CsModel.parseStartLrud(CsTags.get(e, "StartLrud"));
                }
            }
            // legacy survey block: SurveyName stored caveName||name --
            // accept the ambiguity, it becomes caveName
            var sn = CsTags.get(e, "SurveyName");
            if (sn !== "" && caveName === null) {
                caveName = sn;
            }
            var ex = CsTags.get(e, "ExcludedShots");
            if (ex !== "") {
                exBlob = ex;
            }
            var un = CsTags.get(e, "UnplacedShots");
            if (un !== "") {
                unBlob = un;
            }
            continue;
        }

        // legs and splays: only v3 lines carry a Distance tag
        if (CsTags.get(e, "Distance") === "") {
            continue;
        }
        var splayTag = CsTags.get(e, "Splay");
        var fromTag = CsTags.get(e, "From");
        if (splayTag === "" && fromTag === "") {
            continue;
        }
        var shot = CsRevise.shotFromEntity(e);
        if (splayTag !== "") {
            shot.splay = true;
            shot.to = "";
            if (shot.from === "") {
                // pre-From splay: its base station is the Splay tag
                // ("A2.3") minus the trailing ".<n>"
                shot.from = splayTag.replace(/\.\d+$/, "");
            }
        }
        if (shot.trip > maxTrip) {
            maxTrip = shot.trip;
        }
        placed.push({ shot: shot, trip: shot.trip,
            seq: CsTags.getNumber(e, "ShotSeq"), ord: ord++ });
    }

    // fallback anchor: the lowest-Seq station collected
    var first = null;
    for (i = 0; i < stations.length; i++) {
        if (first === null) {
            first = stations[i];
        } else if (stations[i].seq !== null &&
                (first.seq === null || stations[i].seq < first.seq)) {
            first = stations[i];
        }
    }
    if (anchorStation === null) {
        anchorStation = first;
    }
    var anchorName = anchorStation !== null ? anchorStation.name : "";
    var anchorPos = anchorStation !== null ? anchorStation.pos : null;

    // pre-v3 drawing: stations, but not one Distance-tagged shot
    // anywhere -- hand it to the legacy chain-guesser, flagged
    if (stations.length > 0 && placed.length === 0 &&
            exBlob === "" && unBlob === "") {
        return { survey: CsTags.surveyFromDocument(doc),
            anchorName: anchorName, anchorPos: anchorPos, legacy: true };
    }

    // serialized rows: "tripId TAB shotSeq TAB shotRow" per line
    var addRows = function(blob) {
        if (blob === "") {
            return;
        }
        var lines = blob.split("\n");
        for (var r = 0; r < lines.length; r++) {
            if (lines[r] === "") {
                continue;
            }
            var f = lines[r].split("\t");
            var tid = parseInt(f[0], 10);
            if (isNaN(tid)) {
                tid = 0;
            }
            var seqN = parseInt(f[1], 10);
            var shot = CsModel.parseShotRow(f.slice(2).join("\t"));
            shot.trip = tid;
            if (tid > maxTrip) {
                maxTrip = tid;
            }
            placed.push({ shot: shot, trip: tid,
                seq: isNaN(seqN) ? null : seqN, ord: ord++ });
        }
    };
    addRows(exBlob);
    addRows(unBlob);

    // merge everything back into notebook order: trip asc, per-trip
    // shot sequence asc, scan order as the stable tiebreaker
    placed.sort(function(a, b) {
        if (a.trip !== b.trip) {
            return a.trip - b.trip;
        }
        var as = a.seq === null ? Infinity : a.seq;
        var bs = b.seq === null ? Infinity : b.seq;
        if (as !== bs) {
            return as - bs;
        }
        return a.ord - b.ord;
    });

    var survey = CsModel.newSurvey();
    for (i = 0; i < placed.length; i++) {
        survey.shots.push(placed[i].shot);
    }
    survey.fixed = fixed;
    if (caveName !== null) {
        survey.caveName = caveName;
    }
    if (maxTrip >= 0) {
        // trips indexed by id; ids with no anchor (all their shots
        // excluded/unplaced, say) get a neutral record
        survey.trips = [];
        for (i = 0; i <= maxTrip; i++) {
            survey.trips.push(tripRecs[i] !== undefined ?
                tripRecs[i] : CsModel.newTrip());
        }
    }
    CsModel.ensureTrips(survey);
    return { survey: survey, anchorName: anchorName,
        anchorPos: anchorPos, legacy: false };
};
