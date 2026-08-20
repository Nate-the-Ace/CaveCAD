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
// drawing-level tag (see CsTags.js) rather than survey data. That
// means CsRevise.apply has to protect it by hand: its non-rigid path
// redraws every station from scratch, and a redraw would erase the
// anchor right along with the geometry it has no field to carry. So
// apply reads the anchor before the redraw and recommits it after --
// carried across, never reconstructed.
//
// Below the reconstruction entry points lives the REVISION MATH: the
// pure numeric half of the revision framework. reviseDeclination
// rotates one trip's azimuths to a re-measured declination;
// similarityFit / classifyChange compare two CsNetwork.resolve results
// and decide whether the whole plan moved RIGIDLY (rotation + uniform
// scale + translation -- redraw everything in place) or genuinely
// changed shape (stations moved relative to each other -- the caller
// must reconcile). All of it is engine-free and runs under node.

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
 *   station points   position; Elevation -> the recorded elevation;
 *                    Fixed -> survey.fixed; trip-anchor
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
 *   anchorZ     the elevation that anchor station is RECORDED at (its
 *               Elevation tag). The drawing's vertical datum: a cave
 *               surveyed to an absolute one (entrance at 1250 ft, say)
 *               keeps it nowhere else unless the surveyor also declared
 *               a *fix. Always a number -- 0.0 when the tag is absent,
 *               blank or not numeric, never NaN
 *   legacy      true when the drawing predates schema v3 and the
 *               result came from CsTags.surveyFromDocument's
 *               chain-guessing instead
 * }
 */
CsRevise.surveyFromDocument = function(doc) {
    if (typeof CsStore !== "undefined") {
        CsStore.ensureLoaded(doc);
    }

    var stations = [];      // {name, seq, pos, elev}
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
            // Elevation rides along in this one scan: CsDraw.survey
            // writes every station's resolved z there, so it is where
            // the drawing's vertical datum actually lives.
            var st = { name: stName, seq: CsTags.getNumber(e, "Seq"),
                pos: e.getPosition(),
                elev: CsTags.getNumber(e, "Elevation") };
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
    // The datum every consumer inherits. Coerced to a number HERE,
    // once, rather than at each use: a junk tag reaching
    // CsNetwork.resolve as anchor.z = NaN would spread through every
    // station it places without a single complaint.
    var anchorZ = (anchorStation !== null &&
        typeof anchorStation.elev === "number" &&
        !isNaN(anchorStation.elev)) ? anchorStation.elev : 0.0;

    // pre-v3 drawing: stations, but not one Distance-tagged shot
    // anywhere -- hand it to the legacy chain-guesser, flagged
    if (stations.length > 0 && placed.length === 0 &&
            exBlob === "" && unBlob === "") {
        return { survey: CsTags.surveyFromDocument(doc),
            anchorName: anchorName, anchorPos: anchorPos,
            anchorZ: anchorZ, legacy: true };
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
        anchorPos: anchorPos, anchorZ: anchorZ, legacy: false };
};

/**
 * The elevation a reconstructed station is pinned at.
 *
 * Two records can carry a station's z and they are NOT equal in
 * authority. survey.fixed (a Fixed="x,y,z" tag, itself from an
 * explicit *fix/#Fix) is a coordinate the surveyor declared; an
 * Elevation tag is only what the last redraw computed. So the fix
 * wins, and the recorded datum -- recon.anchorZ -- stands in when
 * there is none. Reaching 0 means the drawing says nothing about
 * height anywhere, which is the ordinary case for a cave surveyed off
 * its own entrance.
 *
 * recon.anchorZ describes ONE station, so only that station may claim
 * it: handing the anchor's datum to some other pivot would shift every
 * elevation in the cave by the dz between the two.
 *
 * Always returns a number, never NaN -- see surveyFromDocument.
 *
 * \param recon CsRevise.surveyFromDocument(doc) result
 * \param name  the station to pin
 */
CsRevise.anchorZOf = function(recon, name) {
    var fx = recon.survey.fixed[name];
    if (fx !== undefined && fx !== null && typeof fx.z === "number" &&
            !isNaN(fx.z)) {
        return fx.z;
    }
    if (name === recon.anchorName && typeof recon.anchorZ === "number" &&
            !isNaN(recon.anchorZ)) {
        return recon.anchorZ;
    }
    return 0.0;
};

// ---------------------------------------------------------------------
// Revision math -- pure numeric helpers, no document access.
// ---------------------------------------------------------------------

/**
 * Re-applies one trip's declination: rotates EVERY azimuth belonging
 * to that trip (splays and flag-carrying/excluded shots included --
 * their geometry is just as magnetic as everyone else's) by
 * delta = newDecl - oldDecl, then records newDecl on the trip.
 *
 * Model azimuths are TRUE bearings with declination already applied
 * (see CsModel.js), so changing a trip's declination from D to D'
 * means every stored azimuth moves by (D' - D). backAzimuth lives in
 * the same frame (see the backsight-frame note in CsModel.js), so it
 * co-rotates whenever present.
 *
 * \param survey  the CsModel survey (mutated in place)
 * \param tripId  index into survey.trips
 * \param newDecl the re-measured declination, degrees east-positive
 * \param source  optional new declinationSource ("igrf"/"user"/...);
 *                the trip's existing source is kept when omitted
 * \return { delta } the degrees every azimuth moved
 */
CsRevise.reviseDeclination = function(survey, tripId, newDecl, source) {
    CsModel.ensureTrips(survey);
    var trip = survey.trips[tripId];
    var delta = newDecl - trip.declination;
    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if ((s.trip || 0) !== tripId) {
            continue;
        }
        s.azimuth = CsAngles.normalizeAzimuth(s.azimuth + delta);
        if (s.backAzimuth !== null && s.backAzimuth !== undefined) {
            s.backAzimuth = CsAngles.normalizeAzimuth(s.backAzimuth + delta);
        }
    }
    trip.declination = newDecl;
    if (source !== undefined && source !== null) {
        trip.declinationSource = source;
    }
    if (tripId === 0) {
        // trips[0] is the authority over the top-level mirror fields
        // (see CsModel.ensureTrips) -- re-mirror so survey.declination
        // reflects the revision immediately.
        CsModel.ensureTrips(survey);
    }
    return { delta: delta };
};

/**
 * Least-squares 2D similarity transform (rotation + uniform scale +
 * translation, NO reflection) mapping each pair's old point onto its
 * nu point -- the closed-form Procrustes solution:
 *
 *   centroids p-bar (old), q-bar (nu); over the centered points
 *   dp = old - p-bar, dq = nu - q-bar:
 *     a  = sum(dp.x*dq.x + dp.y*dq.y)
 *     b  = sum(dp.x*dq.y - dp.y*dq.x)
 *     s2 = sum(dp.x^2 + dp.y^2)
 *   theta = atan2(b, a),  scale = sqrt(a^2 + b^2) / s2
 *   (tx, ty) = q-bar - scale * R(theta) * p-bar
 *
 * theta is in RADIANS, counter-clockwise-positive in drawing
 * coordinates (x east, y north): R(theta) = [cos -sin; sin cos].
 * Note the suite-wide consequence: adding +d degrees to every azimuth
 * turns the plan CLOCKWISE, so a declination revision of +d yields
 * theta = -d * PI/180 here (verified numerically in the unit tests).
 *
 * Degenerate inputs, by choice (documented, tested):
 *   0 pairs   -> null (nothing to fit)
 *   1 pair    -> pure translation {theta 0, scale 1, maxResidual 0}
 *   s2 ~ 0    -> all old points coincide: rotation and scale are
 *                underdetermined, so {theta 0, scale 1, centroid
 *                translation, maxResidual Infinity} -- Infinity so a
 *                caller can never certify rigidity from a fit the
 *                data couldn't support
 *
 * \param pairs [{old: {x, y}, nu: {x, y}}]
 * \return { theta, scale, tx, ty, maxResidual } or null; maxResidual
 *         is the largest distance between a transformed old point and
 *         its nu point
 */
CsRevise.similarityFit = function(pairs) {
    if (pairs.length === 0) {
        return null;
    }
    var i;
    var px = 0.0, py = 0.0, qx = 0.0, qy = 0.0;
    for (i = 0; i < pairs.length; i++) {
        px += pairs[i].old.x;
        py += pairs[i].old.y;
        qx += pairs[i].nu.x;
        qy += pairs[i].nu.y;
    }
    px /= pairs.length;
    py /= pairs.length;
    qx /= pairs.length;
    qy /= pairs.length;

    var fit;
    if (pairs.length === 1) {
        fit = { theta: 0.0, scale: 1.0, tx: qx - px, ty: qy - py };
    } else {
        var a = 0.0, b = 0.0, s2 = 0.0;
        for (i = 0; i < pairs.length; i++) {
            var dpx = pairs[i].old.x - px;
            var dpy = pairs[i].old.y - py;
            var dqx = pairs[i].nu.x - qx;
            var dqy = pairs[i].nu.y - qy;
            a += dpx * dqx + dpy * dqy;
            b += dpx * dqy - dpy * dqx;
            s2 += dpx * dpx + dpy * dpy;
        }
        if (s2 <= 1e-20) {
            // coincident old points: rotation/scale underdetermined
            return { theta: 0.0, scale: 1.0, tx: qx - px, ty: qy - py,
                maxResidual: Infinity };
        }
        var theta = Math.atan2(b, a);
        var scale = Math.sqrt(a * a + b * b) / s2;
        fit = {
            theta: theta,
            scale: scale,
            tx: qx - scale * (Math.cos(theta) * px - Math.sin(theta) * py),
            ty: qy - scale * (Math.sin(theta) * px + Math.cos(theta) * py)
        };
    }

    var maxResidual = 0.0;
    for (i = 0; i < pairs.length; i++) {
        var t = CsRevise.applyFit(fit, pairs[i].old);
        var rx = t.x - pairs[i].nu.x;
        var ry = t.y - pairs[i].nu.y;
        var r = Math.sqrt(rx * rx + ry * ry);
        if (r > maxResidual) {
            maxResidual = r;
        }
    }
    fit.maxResidual = maxResidual;
    return fit;
};

/**
 * Applies a similarityFit transform to one {x, y} point:
 * scale * R(theta) * p + (tx, ty). The one place the rotation-matrix
 * convention lives, so tests and callers can't disagree with the fit.
 */
CsRevise.applyFit = function(fit, pt) {
    var c = Math.cos(fit.theta);
    var s = Math.sin(fit.theta);
    return {
        x: fit.scale * (c * pt.x - s * pt.y) + fit.tx,
        y: fit.scale * (s * pt.x + c * pt.y) + fit.ty
    };
};

/**
 * Compares two CsNetwork.resolve results and classifies the change:
 * RIGID (the whole plan moved as one body -- rotation + uniform scale
 * + translation in plan, plus one uniform z shift) or not.
 *
 * Pairs up every station name present in BOTH results, fits the plan
 * similarity over them, and checks the z deltas separately (the fit
 * is 2D; z rigidity just means every station rose/fell by the same
 * amount). eps scales with the drawing: 1e-6 * max(extent, 1).
 *
 * \param oldResolved CsNetwork.resolve output before the edit
 * \param newResolved CsNetwork.resolve output after the edit
 * \param extent      characteristic drawing size (e.g. bounding-box
 *                    diagonal) for the eps scale; anything
 *                    non-numeric counts as 0 (eps floor 1e-6)
 * \return {
 *   rigid        true when the fit exists, its maxResidual < eps,
 *                and the z change is uniform
 *   theta, scale, tx, ty, maxResidual   the fit (see similarityFit);
 *                theta 0 / scale 1 / maxResidual Infinity when no
 *                stations are shared (fit null -> never rigid)
 *   moved        [{name, dist}] 3D displacement of every shared
 *                station, sorted largest first
 * }
 */
CsRevise.classifyChange = function(oldResolved, newResolved, extent) {
    var e = (typeof extent === "number" && isFinite(extent)) ? extent : 0;
    var eps = 1e-6 * Math.max(e, 1);

    var pairs = [];
    var moved = [];
    var dzMin = null, dzMax = null;
    for (var name in oldResolved.stations) {
        if (!oldResolved.stations.hasOwnProperty(name) ||
                !newResolved.stations.hasOwnProperty(name)) {
            continue;
        }
        var o = oldResolved.stations[name];
        var n = newResolved.stations[name];
        pairs.push({ old: { x: o.x, y: o.y }, nu: { x: n.x, y: n.y } });
        var dz = n.z - o.z;
        if (dzMin === null || dz < dzMin) {
            dzMin = dz;
        }
        if (dzMax === null || dz > dzMax) {
            dzMax = dz;
        }
        var dx = n.x - o.x;
        var dy = n.y - o.y;
        moved.push({ name: name,
            dist: Math.sqrt(dx * dx + dy * dy + dz * dz) });
    }
    moved.sort(function(a, b) {
        return b.dist - a.dist;
    });

    var fit = CsRevise.similarityFit(pairs);
    var zUniform = dzMin === null || (dzMax - dzMin) <= eps;
    var rigid = fit !== null && fit.maxResidual < eps && zUniform;

    return {
        rigid: rigid,
        theta: fit !== null ? fit.theta : 0.0,
        scale: fit !== null ? fit.scale : 1.0,
        tx: fit !== null ? fit.tx : 0.0,
        ty: fit !== null ? fit.ty : 0.0,
        maxResidual: fit !== null ? fit.maxResidual : Infinity,
        moved: moved
    };
};

// ---------------------------------------------------------------------
// Per-trip revision UI decisions -- pure, no GUI, no document access.
//
// These live here rather than in whichever tool happens to show the
// dialog: every per-trip declination UI (the Survey Notebook's, and
// the standalone Declination tool's until it is retired) has to make
// the SAME calls about what a field displays and what counts as an
// edit. Two copies of the display-precision rule below would be two
// tools that disagree about whether a trip changed.
//
// tripsNeedingRevision came here for the same reason from the other
// direction: it decides which trips are WORTH offering a revision, and
// the tool that used to own that question (Geo Reference) is being
// retired into the notebook.
// ---------------------------------------------------------------------

/** "YYYY-MM-DD" -> {year, month, day}, or null. */
CsRevise.parseIsoDate = function(text) {
    if (text === undefined || text === null) {
        return null;
    }
    var s = String(text).replace(/^\s+|\s+$/g, "");
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (m === null) {
        return null;
    }
    return { year: parseInt(m[1], 10), month: parseInt(m[2], 10),
        day: parseInt(m[3], 10) };
};

/** A declination as dialog text: "3.5", "0.0", "-4.25". */
CsRevise.declText = function(value) {
    var n = Number(value);
    if (isNaN(n)) {
        return "0.0";
    }
    var s = String(Math.round(n * 10000) / 10000);
    if (s.indexOf(".") < 0 && s.indexOf("e") < 0 && s.indexOf("E") < 0) {
        s += ".0";
    }
    return s;
};

/** 'Trip 1: ENTRANCE SERIES 2024-03-02 AB, CD' -- blanks drop out. */
CsRevise.tripLabel = function(tripId, trip) {
    var parts = ["Trip " + tripId + ":"];
    if (trip.name !== undefined && trip.name !== null && trip.name !== "") {
        parts.push(String(trip.name));
    }
    if (trip.date !== undefined && trip.date !== null && trip.date !== "") {
        parts.push(String(trip.date));
    }
    if (trip.team !== undefined && trip.team !== null && trip.team !== "") {
        parts.push(String(trip.team));
    }
    return parts.length === 1 ? "Trip " + tripId : parts.join(" ");
};

/** The recorded value + where it came from: "0.0 (file)". */
CsRevise.recordedText = function(trip) {
    var src = trip.declinationSource;
    if (src === undefined || src === null || src === "") {
        src = "unrecorded";
    }
    return CsRevise.declText(trip.declination) + " (" + src + ")";
};

/**
 * The revision decisions, from plain data snapshotted off the dialog.
 *
 * \param rows [{tripId, recorded, text, igrfText}] --
 *   recorded  the trip's recorded declination (number)
 *   text      the field's text on Apply
 *   igrfText  the exact string the IGRF button last filled ("" if never)
 * \return { changes: [{tripId, value, source}] } for every field whose
 *         text no longer reads as the prefilled declText(recorded) --
 *         source "igrf" when the text still exactly matches the IGRF
 *         fill, "user" otherwise -- OR { error: "..." } when any field
 *         holds something unparseable (a prefilled field always holds
 *         a valid number, so junk is always an edit gone wrong; the
 *         caller must apply NOTHING).
 */
CsRevise.parseTripEdits = function(rows) {
    var changes = [];
    for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var text = String(r.text === undefined || r.text === null ?
            "" : r.text).replace(/^\s+|\s+$/g, "");
        if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) {
            return { error: "Trip " + r.tripId + ": \"" + text +
                "\" is not a number (degrees, east positive). " +
                "Nothing was changed." };
        }
        var value = parseFloat(text);
        if (!isFinite(value)) {
            return { error: "Trip " + r.tripId + ": \"" + text +
                "\" is not a usable number. Nothing was changed." };
        }
        // Unchanged means "still reads as what we prefilled", NOT
        // "equals the recorded double". The prefill is
        // declText(recorded) -- 4 decimals -- so a recorded
        // declination carrying more precision than that can never
        // round-trip a raw comparison: reopening this dialog and
        // pressing Apply with no edits would manufacture a ~1e-5 deg
        // "revision", append a junk RevisionLog line, and downgrade
        // the trip's declinationSource from igrf to user. Compare at
        // the precision the dialog actually shows -- both revision
        // tools apply IGRF at 2 decimals, well inside it.
        var shown = CsRevise.declText(r.recorded);
        if (text === shown || Math.abs(value - Number(shown)) <= 1e-9) {
            continue;
        }
        var source = (r.igrfText !== undefined && r.igrfText !== null &&
            r.igrfText !== "" && text === r.igrfText) ? "igrf" : "user";
        changes.push({ tripId: r.tripId, value: value, source: source });
    }
    return { changes: changes };
};

/**
 * Which trips deserve an IGRF declination-revision offer once an
 * anchor at (lat, lon) is known.
 *
 * A trip qualifies when ALL of:
 *   - its declinationSource is "" or "user" (a value already stamped
 *     "igrf", or read from a survey data file, is not second-guessed),
 *   - its date parses as YYYY-MM-DD (IGRF needs a real date),
 *   - the IGRF model covers that date (declination() non-null), and
 *   - the recorded declination differs from the IGRF estimate by
 *     more than 0.5 degrees.
 *
 * The returned igrf is already rounded to 2 decimals -- the value a
 * candidate carries is exactly what gets displayed AND, if accepted,
 * exactly what gets applied (see the rounding comment inline below).
 *
 * \param survey CsModel survey (e.g. CsRevise.surveyFromDocument().survey)
 * \param lat    anchor latitude, degrees, north positive
 * \param lon    anchor longitude, degrees, east positive
 * \return [{tripId, recorded, igrf, date, team}] in trip-id order,
 *         igrf rounded to 2 decimals
 */
CsRevise.tripsNeedingRevision = function(survey, lat, lon) {
    var out = [];
    var trips = survey.trips || [];
    for (var t = 0; t < trips.length; t++) {
        var trip = trips[t];
        if (trip.declinationSource !== "" &&
                trip.declinationSource !== "user") {
            continue;
        }
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trip.date);
        if (m === null) {
            continue;
        }
        var igrf = CsGeomag.declination(lat, lon, {
            year: parseInt(m[1], 10),
            month: parseInt(m[2], 10),
            day: parseInt(m[3], 10)
        });
        if (igrf === null) {
            continue;
        }
        // Round to 2 decimals HERE -- the one site that decides what
        // "the IGRF value" for this trip means. Everything downstream
        // (the question box's toFixed(2), and reviseDeclination if
        // accepted) uses this SAME rounded number, so what the user
        // is shown is exactly what gets stored. This also keeps the
        // convention shared with every other IGRF fill in the suite --
        // the per-trip dialog's IGRF buttons and the notebook header's
        // Infer apply at 2 decimals too (see their comments) -- so a
        // trip revised down one path round-trips through the other's
        // unchanged-detection instead of registering a phantom edit.
        var igrfRounded = Math.round(igrf.declination * 100) / 100;
        if (Math.abs(trip.declination - igrfRounded) > 0.5) {
            out.push({ tripId: t, recorded: trip.declination,
                igrf: igrfRounded, date: trip.date,
                team: trip.team });
        }
    }
    return out;
};

// ---------------------------------------------------------------------
// Applying a revision to the open drawing. QCAD context only (the one
// part of this module that touches entities); everything above stays
// engine-free.
// ---------------------------------------------------------------------

/**
 * Layers whose entities are WORLD-FIXED: the rigid path transforms
 * every other entity in the drawing, and never one of these.
 *
 *   "TB_*"         title-block sheet furniture. It belongs to the
 *                  SHEET, not to the cave, so it must not travel when
 *                  the cave is re-oriented underneath it.
 *   "CTRL-AERIAL"  georeferenced aerial basemap imagery. It is pinned
 *                  to the GROUND. A declination revision re-orients
 *                  the survey relative to true north -- that is the
 *                  whole point of it -- so rotating the photo along
 *                  with the survey would destroy the photo's
 *                  georeferencing and silently misalign the imagery
 *                  under the cave.
 *
 * Entries are matched as literal layer names, or as prefixes when they
 * end in "*". Deliberately spelled out here rather than pulled from
 * CsLayers: this module stays free of any dependency on constants that
 * file may not define yet.
 */
CsRevise.WORLD_FIXED_LAYERS = ["TB_*", "CTRL-AERIAL"];

/** True when entities on layerName must NOT move with the cave (see
 *  CsRevise.WORLD_FIXED_LAYERS). */
CsRevise.isWorldFixedLayer = function(layerName) {
    var name = (layerName === undefined || layerName === null) ? "" :
        String(layerName);
    for (var i = 0; i < CsRevise.WORLD_FIXED_LAYERS.length; i++) {
        var pat = CsRevise.WORLD_FIXED_LAYERS[i];
        if (pat.charAt(pat.length - 1) === "*") {
            if (name.indexOf(pat.substring(0, pat.length - 1)) === 0) {
                return true;
            }
        } else if (name === pat) {
            return true;
        }
    }
    return false;
};

/**
 * Applies a revised survey model to the drawing it was reconstructed
 * from.
 *
 * Both the old survey (recon.survey) and newSurvey resolve over the
 * SAME anchor, so old station coordinates equal drawing coordinates
 * and the two results are directly comparable. That anchor is the one
 * point the revision pivots on -- the one point it does NOT move --
 * chosen in this order:
 *
 *   1. georef  the station named by the drawing's GeoStation tag, at
 *              its CURRENT position. It is the drawing's single point
 *              of contact with the real world (a basemap aligns to it,
 *              an export derives coordinates from it), so a revision
 *              must never move it. Taken only when that point is still
 *              in the drawing and takes part in the resolved network.
 *   2. trip0   recon.anchorName -- the trip-0 anchor -- at its CURRENT
 *              position.
 *   3. stale   recon.anchorPos, when the anchor point is gone from the
 *              drawing altogether.
 *
 * "Current" is load-bearing: recon.anchorPos was captured whenever
 * surveyFromDocument ran, and the point may have been dragged (by the
 * user, or by any other tool) in between. Resolving against the stale
 * value would compute the rigid translation for a position the entity
 * no longer occupies and land the whole drawing offset by
 * (I - R(theta)) * (stalePos - realPos). So apply re-reads positions
 * from the document -- the drawing is the truth. A trip-0 anchor drag
 * beyond 1e-9 is surfaced as report.anchorMoved {dx, dy} (the only
 * position the reconstruction snapshotted, hence the only one there is
 * anything to compare against); a vanished anchor point sets
 * report.anchorMissing. report.anchorUsed says which point won.
 *
 * The pivot's HEIGHT matters just as much, because both paths below
 * rewrite every station's Elevation tag from the resolve: pinned at 0,
 * a revision would rebase a cave surveyed to an absolute datum onto
 * the drawing's arbitrary origin and silently destroy that datum. So
 * the pivot resolves at the elevation the drawing records for it (see
 * CsRevise.anchorZOf) -- or, when the georeferenced station wins, at
 * the elevation the reconstruction gives THAT station on the same
 * datum.
 *
 * classifyChange then decides the strategy:
 *
 *   RIGID   the whole plan moved as one body (a declination revision,
 *           say). ONE modify operation transforms EVERY entity in the
 *           document -- survey marks AND hand-drawn linework -- by the
 *           fitted similarity, except entities on a world-fixed layer
 *           (see CsRevise.WORLD_FIXED_LAYERS). The same operation
 *           rewrites every tag the revision touched:
 *             leg/splay   Distance, Azimuth, BackAzimuth (when
 *                         present) and the four LRUD lengths, all from
 *                         the matching newSurvey shot
 *                         (matched by Trip + ShotSeq) and formatted
 *                         exactly as CsDraw's legTags would, so a
 *                         rewritten tag is byte-identical to a freshly
 *                         drawn one. Lengths matter because a rigid
 *                         revision can carry a uniform SCALE (a unit
 *                         re-interpretation): scaling the geometry and
 *                         leaving Distance/LRUD alone would make
 *                         surveyFromDocument faithfully reconstruct the
 *                         WRONG distances.
 *             station     Elevation (the resolved z, which a scale
 *                         changes) and, where newSurvey still fixes the
 *                         station, its Fixed "x,y,z" triple
 *             trip anchor TripDeclination/TripDeclinationSource/
 *                         TripDistanceUnit, plus on the trip-0 anchor
 *                         the legacy Declination/DeclinationSource/
 *                         DistanceUnit mirror, the regenerated
 *                         ExcludedShots/UnplacedShots row blobs (their
 *                         rows carry revised distances and azimuths of
 *                         their own), and an appended RevisionLog line
 *                         per changed trip.
 *           Station-point Azimuth and LRUD tags stay as-is (accepted
 *           stale -- the leg tags are canonical, and no reader takes
 *           shot data off a station point on a v3 drawing).
 *
 *   NOT     the survey genuinely changed shape: erase every station's
 *           marks (CsDraw.eraseStations) and redraw the revised survey
 *           in place (CsDraw.survey), which rewrites all v3 tags; the
 *           RevisionLog (with the old log carried over) is then
 *           committed onto the new trip-0 anchor. The GeoLat/GeoLon/
 *           GeoStation georeference anchor gets the same treatment --
 *           read off its station before the erase (CsDraw.survey has
 *           no field for it; see the module header) and recommitted
 *           after onto whichever point now carries that same Station
 *           name. When that station did not survive the revision (the
 *           leg it sat on got deleted), nothing is invented to carry
 *           it: report.geoAnchorLost names the lost station instead.
 *           Hand-drawn linework near moved stations does NOT follow --
 *           the report warns.
 *
 * OFF-layer caveat, probed empirically in this build: add, MODIFY and
 * DELETE operations are all silently refused for entities on a layer
 * that is off. Any off layer holding survey entities (CTRL-HIDDEN's
 * legs) is therefore toggled on around the work via
 * CsLayers.withLayerOn and restored after.
 *
 * \param doc        the document
 * \param di         its document interface
 * \param recon      CsRevise.surveyFromDocument(doc) result the
 *                   revision started from
 * \param newSurvey  the revised CsModel survey
 * \return {
 *   rigid           which path ran
 *   moved           [{name, dist}] per shared station, largest first
 *   stationsChanged how many stations moved more than the rigidity eps
 *   loopsBefore     [{from, to, error, percent}] loop closures before
 *   loopsAfter      the same loops after the revision
 *   anchorMoved     {dx, dy} when the PIVOT point (whichever won
 *                   below) had been
 *                   dragged since the reconstruction (null when it had
 *                   not); the revision used the CURRENT position
 *   anchorMissing   true when no point carrying the trip-0 anchor's
 *                   Station tag is left in the drawing, so
 *                   recon.anchorPos had to stand in
 *   anchorUsed      {name, source} the point the revision pivoted on;
 *                   source is "georef", "trip0" or "stale"
 *   geoAnchorLost   present (the lost station's name) only when a
 *                   non-rigid revision had a GeoLat/GeoLon/GeoStation
 *                   anchor to carry across the redraw but the station
 *                   it lived on is gone from the revised survey.
 *                   Absent entirely when there was no anchor to carry,
 *                   or it carried across fine -- so existing callers
 *                   that never check for it see no behavior change.
 * }
 */
CsRevise.apply = function(doc, di, recon, newSurvey) {
    CsModel.ensureTrips(recon.survey);
    CsModel.ensureTrips(newSurvey);

    // -- 0. the point this revision pivots on ------------------------
    // Read live, never from the reconstruction's snapshot: a revision
    // must land where its anchor actually IS. Both resolves (and the
    // non-rigid redraw) use the one choice made here.

    /** The current position of the point tagged Station = name, or
     *  null when the drawing has no such point any more. */
    var livePosOf = function(name) {
        if (name === "" || name === null || name === undefined) {
            return null;
        }
        var lids = doc.queryAllEntities(false, false);
        for (var lidx = 0; lidx < lids.length; lidx++) {
            var le = doc.queryEntity(lids[lidx]);
            if (isNull(le) || typeof le.getPosition !== "function") {
                continue;
            }
            if (CsTags.get(le, "Station") === name) {
                return le.getPosition();
            }
        }
        return null;
    };

    // The drawing's georeferenced station, read straight off the tags:
    // surveyFromDocument drops GeoLat/GeoLon/GeoStation (CsModel has no
    // geo field to put them in), so this module looks them up itself.
    var geoName = "";
    // Snapshotted here, before either revision path runs, so the
    // non-rigid path below can recommit it after CsDraw.survey redraws
    // the station it rides on out from under it (see the module
    // header). null when the drawing carries no geo anchor at all --
    // then there is nothing to carry and nothing to report.
    var geoAnchor = null;
    var gids = doc.queryAllEntities(false, false);
    for (var gi = 0; gi < gids.length; gi++) {
        var ge = doc.queryEntity(gids[gi]);
        if (isNull(ge)) {
            continue;
        }
        var gs = CsTags.get(ge, "GeoStation");
        if (gs !== "") {
            geoName = gs;
            geoAnchor = { station: gs, lat: CsTags.get(ge, "GeoLat"),
                lon: CsTags.get(ge, "GeoLon") };
            break;
        }
    }

    var anchorName = recon.anchorName;
    var anchorPos = recon.anchorPos;
    var anchorSource = "stale";
    var anchorMoved = null;
    var anchorMissing = false;

    // trip-0 anchor, re-read (the drag Defect 2 was about)
    var trip0Live = livePosOf(recon.anchorName);
    if (recon.anchorName !== "" && recon.anchorName !== null &&
            recon.anchorName !== undefined) {
        if (trip0Live === null) {
            anchorMissing = true;
        } else {
            if (recon.anchorPos !== null && recon.anchorPos !== undefined) {
                var adx = trip0Live.x - recon.anchorPos.x;
                var ady = trip0Live.y - recon.anchorPos.y;
                if (Math.sqrt(adx * adx + ady * ady) > 1e-9) {
                    anchorMoved = { dx: adx, dy: ady };
                }
            }
            anchorPos = trip0Live;
            anchorSource = "trip0";
        }
    }

    // The pivot's HEIGHT, kept beside its position because both
    // resolves and the rigid path's Elevation rewrite hang off it: get
    // it wrong and the revision rebases the whole cave vertically.
    // Left null until something knows better than CsRevise.anchorZOf.
    var pivotZ = null;
    var anchorAt = function(name, pos, z) {
        return { name: name,
            x: pos !== null && pos !== undefined ? pos.x : 0.0,
            y: pos !== null && pos !== undefined ? pos.y : 0.0,
            z: (typeof z === "number" && !isNaN(z)) ? z :
                CsRevise.anchorZOf(recon, name) };
    };

    // The georeferenced station WINS. It is the drawing's one point of
    // contact with the real world -- pinned to a physical spot on the
    // ground, and what a basemap or a KML export derives real-world
    // coordinates from. Pivoting anywhere else moves it, silently
    // breaking every such derivation. It is only the trip-0 anchor by
    // coincidence, whenever the surveyor happens to georeference the
    // station the survey also starts at. Taken only when the point is
    // still in the drawing AND takes part in the resolved network
    // (probed with the trip-0 anchor, which is also the fallback
    // choice) -- a name that resolves to nothing would anchor the
    // revision to a phantom.
    if (geoName !== "" && geoName === anchorName && anchorSource === "trip0") {
        anchorSource = "georef"; // the same point, world-pinned as well
    } else if (geoName !== "" && geoName !== anchorName) {
        var geoLive = livePosOf(geoName);
        if (geoLive !== null) {
            // Probed in the RECONSTRUCTION frame (trip 0 where the
            // survey was read from, not where it sits now), because
            // this probe answers two questions and the second one only
            // makes sense in that frame: does the name resolve at all,
            // and where did the georeferenced point sit when we read
            // the drawing. Resolvability ignores the anchor position
            // entirely -- only connectivity decides it -- so anchoring
            // the probe this way costs nothing and keeps the drag
            // measurement honest.
            var probe = CsNetwork.resolve(recon.survey,
                { anchor: anchorAt(recon.anchorName, recon.anchorPos) });
            if (probe.stations.hasOwnProperty(geoName)) {
                // The pivot moves to the georeferenced point, so the
                // drag worth reporting moves with it: trip 0's offset
                // describes a station we no longer pivot on. Diff the
                // georeferenced point's live position against where
                // the reconstruction frame put it.
                var geoWas = probe.stations[geoName];
                var gdx = geoLive.x - geoWas.x;
                var gdy = geoLive.y - geoWas.y;
                anchorMoved = (Math.sqrt(gdx * gdx + gdy * gdy) > 1e-9) ?
                    { dx: gdx, dy: gdy } : null;
                anchorName = geoName;
                anchorPos = geoLive;
                anchorSource = "georef";
                // The pivot's z comes from the probe, not from the
                // anchor's datum: the probe already resolved the whole
                // network ON that datum, so geoWas.z IS this station's
                // datum-consistent elevation. Pinning it at the
                // anchor's own z instead would lift or drop every
                // elevation in the cave by the dz between the two.
                pivotZ = geoWas.z;
            }
        }
    }

    // -- 1. old and new resolved over the identical anchor -----------
    var anchor = anchorAt(anchorName, anchorPos, pivotZ);
    var oldResolved = CsNetwork.resolve(recon.survey, { anchor: anchor });
    var newResolved = CsNetwork.resolve(newSurvey, { anchor: anchor });

    // -- 2. drawing extent = old stations' bounding-box diagonal -----
    var minX = null, minY = null, minZ = null;
    var maxX = null, maxY = null, maxZ = null;
    for (var sn in oldResolved.stations) {
        if (!oldResolved.stations.hasOwnProperty(sn)) {
            continue;
        }
        var st = oldResolved.stations[sn];
        if (minX === null || st.x < minX) { minX = st.x; }
        if (maxX === null || st.x > maxX) { maxX = st.x; }
        if (minY === null || st.y < minY) { minY = st.y; }
        if (maxY === null || st.y > maxY) { maxY = st.y; }
        if (minZ === null || st.z < minZ) { minZ = st.z; }
        if (maxZ === null || st.z > maxZ) { maxZ = st.z; }
    }
    var extent = 0.0;
    if (minX !== null) {
        var exx = maxX - minX, exy = maxY - minY, exz = maxZ - minZ;
        extent = Math.sqrt(exx * exx + exy * exy + exz * exz);
    }

    // -- 3. classify ---------------------------------------------------
    var cls = CsRevise.classifyChange(oldResolved, newResolved, extent);
    var eps = 1e-6 * Math.max(extent, 1);
    var stationsChanged = 0;
    for (var mi = 0; mi < cls.moved.length; mi++) {
        if (cls.moved[mi].dist > eps) {
            stationsChanged++;
        }
    }

    // -- RevisionLog: one line per trip whose declination changed ----
    var logLines = [];
    var tripCount = Math.max(recon.survey.trips.length,
        newSurvey.trips.length);
    for (var ti = 0; ti < tripCount; ti++) {
        var oldTrip = recon.survey.trips[ti];
        var newTrip = newSurvey.trips[ti];
        if (oldTrip === undefined || newTrip === undefined) {
            continue;
        }
        if (oldTrip.declination !== newTrip.declination) {
            logLines.push("trip " + ti + " declination " +
                oldTrip.declination + " -> " + newTrip.declination +
                " (" + (newTrip.declinationSource || "unknown") + ")");
        }
    }

    // the OLD trip-0 anchor: previous RevisionLog rides on it, and the
    // rigid path writes the appended log back onto the same point.
    // (Anchor points are the only entities with BOTH a Station tag and
    // a Trip tag -- legs carry Trip too, but never Station.)
    var findAnchor0 = function() {
        var ids = doc.queryAllEntities(false, false);
        for (var i = 0; i < ids.length; i++) {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e)) {
                continue;
            }
            if (CsTags.get(e, "Station") !== "" &&
                    CsTags.get(e, "Trip") !== "" &&
                    CsTags.getNumber(e, "Trip") === 0) {
                return e;
            }
        }
        return null;
    };
    var oldAnchor0 = findAnchor0();
    var prevLog = oldAnchor0 !== null ?
        CsTags.get(oldAnchor0, "RevisionLog") : "";
    var newLog = logLines.length === 0 ? prevLog :
        (prevLog !== "" ? prevLog + "\n" : "") + logLines.join("\n");

    // the redrawn point carrying Station = name, or null -- same
    // lookup livePosOf uses above, but returning the entity itself
    // since the geo anchor tags below get COMMITTED onto it, not just
    // read
    var findStationEntity = function(name) {
        var ids = doc.queryAllEntities(false, false);
        for (var i = 0; i < ids.length; i++) {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e)) {
                continue;
            }
            if (CsTags.get(e, "Station") === name) {
                return e;
            }
        }
        return null;
    };
    // set only on the non-rigid path, only when the geo anchor existed
    // but its station did not survive the revision -- see below
    var geoAnchorLost = null;

    // -- OFF layers holding entities: ops there are silently refused --
    var offLayers = [];
    var seenLayer = {};
    var scanIds = doc.queryAllEntities(false, false);
    for (var oi = 0; oi < scanIds.length; oi++) {
        var oe = doc.queryEntity(scanIds[oi]);
        if (isNull(oe)) {
            continue;
        }
        var oln = doc.getLayerName(oe.getLayerId());
        if (seenLayer[oln] === true || CsRevise.isWorldFixedLayer(oln)) {
            continue; // nothing on a world-fixed layer is ever modified
        }
        seenLayer[oln] = true;
        try {
            var olay = doc.queryLayer(oln);
            if (!isNull(olay) && olay.isOff()) {
                offLayers.push(oln);
            }
        } catch (eOff) {
            // no layer toggling here -- proceed, the op may still land
        }
    }
    var withOffLayersOn = function(idx, fn) {
        if (idx >= offLayers.length) {
            return fn();
        }
        return CsLayers.withLayerOn(doc, di, offLayers[idx], function() {
            return withOffLayersOn(idx + 1, fn);
        });
    };

    if (cls.rigid) {
        // -- 4. RIGID: one modify operation over the whole drawing ---
        // Geometry idiom proven empirically in this bridge's doc tests:
        // queried entities support .rotate(rad, RVector), .scale(factor,
        // RVector) and .move(RVector), and the mutation commits through
        // RModifyObjectsOperation.addObject(e, false). The sequence
        // rotate-about-origin, scale-about-origin, move(tx, ty) is
        // exactly applyFit: scale * R(theta) * p + (tx, ty).
        var fit = { theta: cls.theta, scale: cls.scale,
            tx: cls.tx, ty: cls.ty };
        var origin = new RVector(0, 0);
        var doScale = Math.abs(fit.scale - 1.0) > 1e-9;

        // newSurvey shots by (trip, per-trip seq) -- the same counters
        // CsDraw stamps as ShotSeq, so drawn legs/splays match exactly
        var newShotByKey = {};
        var newSeqOf = [];      // shot index -> its per-trip ShotSeq
        var seqCounters = {};
        for (var ni = 0; ni < newSurvey.shots.length; ni++) {
            var nTrip = newSurvey.shots[ni].trip || 0;
            var nSeq = seqCounters[nTrip] || 0;
            seqCounters[nTrip] = nSeq + 1;
            newShotByKey[nTrip + ":" + nSeq] = newSurvey.shots[ni];
            newSeqOf[ni] = nSeq;
        }

        // The shots the drawing can't show as geometry ride the trip-0
        // anchor as serialized rows -- and those rows carry their own
        // distances, LRUD and azimuths, every one of which the revision
        // may have changed. Regenerate them exactly as CsDraw does
        // (excluded shots in shot order, then the unresolved ones in
        // resolve order) so the reconstruction reads back the REVISED
        // rows. Note the one gap CsTags leaves: a blob that becomes
        // empty cannot be cleared, only overwritten, so a shot that
        // stops being excluded keeps a stale row until the next redraw.
        var exRows = [], unRows = [];
        for (ni = 0; ni < newSurvey.shots.length; ni++) {
            if (newSurvey.shots[ni].excludeFromAll) {
                exRows.push((newSurvey.shots[ni].trip || 0) + "\t" +
                    newSeqOf[ni] + "\t" +
                    CsModel.shotRowText(newSurvey.shots[ni]));
            }
        }
        for (var ui = 0; ui < newResolved.unresolved.length; ui++) {
            var ush = newResolved.unresolved[ui];
            var uSeq = null;
            for (ni = 0; ni < newSurvey.shots.length; ni++) {
                if (newSurvey.shots[ni] === ush) {
                    uSeq = newSeqOf[ni];
                    break;
                }
            }
            unRows.push((ush.trip || 0) + "\t" +
                (uSeq === null ? 0 : uSeq) + "\t" +
                CsModel.shotRowText(ush));
        }

        withOffLayersOn(0, function() {
            var op = new RModifyObjectsOperation();
            op.setText("Apply survey revision");
            var ids = doc.queryAllEntities(false, false);
            for (var i = 0; i < ids.length; i++) {
                var e = doc.queryEntity(ids[i]);
                if (isNull(e)) {
                    continue;
                }
                if (CsRevise.isWorldFixedLayer(
                        doc.getLayerName(e.getLayerId()))) {
                    continue; // sheet furniture and ground-pinned imagery
                }
                e.rotate(fit.theta, origin);
                if (doScale) {
                    e.scale(fit.scale, origin);
                }
                e.move(new RVector(fit.tx, fit.ty));

                // legs and splays: every revised reading from the
                // matching newSurvey shot. The LENGTHS come along --
                // Distance and the four LRUD sides -- because a rigid
                // fit may carry a uniform scale, and geometry scaled
                // under tags that still claim the old lengths is
                // exactly the silent drift this module exists to
                // prevent. Written unconditionally: for a pure
                // declination revision the values are identical, so
                // this is a no-op there. Formatting matches CsDraw's
                // legTags field for field, so a rewritten tag is
                // byte-identical to a freshly drawn one.
                if (CsTags.get(e, "Distance") !== "" &&
                        (CsTags.get(e, "From") !== "" ||
                         CsTags.get(e, "Splay") !== "")) {
                    var eTrip = CsTags.getNumber(e, "Trip");
                    var eSeq = CsTags.getNumber(e, "ShotSeq");
                    var match = eSeq === null ? undefined :
                        newShotByKey[(eTrip === null ? 0 : eTrip) +
                            ":" + eSeq];
                    if (match !== undefined) {
                        CsTags.set(e, "Distance", match.distance);
                        CsTags.set(e, "Azimuth", match.azimuth);
                        if (match.backAzimuth !== null &&
                                match.backAzimuth !== undefined) {
                            CsTags.set(e, "BackAzimuth", match.backAzimuth);
                        }
                        CsTags.set(e, "Left",
                            CsModel.lrudEntryText(match.left, match.leftAll));
                        CsTags.set(e, "Right",
                            CsModel.lrudEntryText(match.right,
                                match.rightAll));
                        CsTags.set(e, "Up",
                            CsModel.lrudEntryText(match.up, match.upAll));
                        CsTags.set(e, "Down",
                            CsModel.lrudEntryText(match.down, match.downAll));
                    }
                }

                // station points: the two tags that carry a LENGTH and
                // therefore go stale under a scale -- the resolved
                // Elevation, and the Fixed "x,y,z" triple (which the
                // v3 reader really does read back into survey.fixed).
                // Azimuth/LRUD on station points stay as-is, accepted
                // stale: the leg tags are canonical.
                var stName = CsTags.get(e, "Station");
                if (stName !== "") {
                    var nSt = newResolved.stations[stName];
                    if (nSt !== undefined && nSt !== null) {
                        CsTags.set(e, "Elevation", nSt.z);
                    }
                    if (CsTags.get(e, "Fixed") !== "" &&
                            newSurvey.fixed.hasOwnProperty(stName)) {
                        var nfx = newSurvey.fixed[stName];
                        CsTags.set(e, "Fixed", nfx.x + "," + nfx.y + "," +
                            (nfx.z === undefined || nfx.z === null ?
                                0 : nfx.z));
                    }
                }

                // trip anchor points: revised trip metadata; the trip-0
                // anchor also the legacy mirror, the serialized rows
                // and the RevisionLog
                if (stName !== "" && CsTags.get(e, "Trip") !== "") {
                    var aTrip = CsTags.getNumber(e, "Trip");
                    aTrip = aTrip === null ? 0 : aTrip;
                    if (newSurvey.trips[aTrip] !== undefined) {
                        CsTags.set(e, "TripDeclination",
                            newSurvey.trips[aTrip].declination);
                        CsTags.set(e, "TripDeclinationSource",
                            newSurvey.trips[aTrip].declinationSource);
                        // a unit re-interpretation is what a scale IS
                        CsTags.set(e, "TripDistanceUnit",
                            newSurvey.trips[aTrip].distanceUnit);
                    }
                    if (aTrip === 0) {
                        CsTags.set(e, "Declination", newSurvey.declination);
                        CsTags.set(e, "DeclinationSource",
                            newSurvey.declinationSource);
                        CsTags.set(e, "DistanceUnit",
                            newSurvey.distanceUnit);
                        CsTags.set(e, "ExcludedShots", exRows.join("\n"));
                        CsTags.set(e, "UnplacedShots", unRows.join("\n"));
                        CsTags.set(e, "RevisionLog", newLog);
                    }
                }

                op.addObject(e, false);
            }
            di.applyOperation(op);
        });
        if (typeof CsStore !== "undefined") {
            // no-op unless a legacy store text exists
            CsStore.migrate(doc, di);
        }
    } else {
        // -- 5. NOT rigid: erase the old marks, redraw the revision --
        var oldNames = [];
        for (var on in oldResolved.stations) {
            if (oldResolved.stations.hasOwnProperty(on)) {
                oldNames.push(on);
            }
        }
        withOffLayersOn(0, function() {
            CsDraw.eraseStations(doc, oldNames);
        });
        CsDraw.survey(newSurvey, newResolved, anchorName, anchorPos);
        // the redraw wrote fresh v3 tags but knows nothing of history:
        // carry the appended RevisionLog onto the new trip-0 anchor
        if (newLog !== "") {
            var newAnchor0 = findAnchor0();
            if (newAnchor0 !== null) {
                CsTags.commit(di, newAnchor0, { RevisionLog: newLog });
            }
        }
        // Same problem, same shape: GeoLat/GeoLon/GeoStation rode on a
        // station point that eraseStations just erased, and
        // CsDraw.survey has no field to have put it back into (see the
        // module header) -- so recommit the tags snapshotted above
        // onto whichever point now carries that same Station name.
        if (geoAnchor !== null) {
            var newGeoEntity = findStationEntity(geoAnchor.station);
            if (newGeoEntity !== null) {
                CsTags.commit(di, newGeoEntity, {
                    GeoLat: geoAnchor.lat,
                    GeoLon: geoAnchor.lon,
                    GeoStation: geoAnchor.station
                });
            } else {
                // the anchored station didn't survive this revision --
                // the user deleted that leg. There is no honest
                // carrier for the anchor left in the drawing, so
                // report it rather than silently dropping it or
                // inventing a new home for it.
                geoAnchorLost = geoAnchor.station;
            }
        }
    }

    // -- 6. report -----------------------------------------------------
    var loopBrief = function(resolved) {
        var out = [];
        for (var li = 0; li < resolved.loops.length; li++) {
            out.push({
                from: resolved.loops[li].from,
                to: resolved.loops[li].to,
                error: resolved.loops[li].error,
                percent: resolved.loops[li].percent
            });
        }
        return out;
    };
    var report = {
        rigid: cls.rigid,
        moved: cls.moved,
        stationsChanged: stationsChanged,
        loopsBefore: loopBrief(oldResolved),
        loopsAfter: loopBrief(newResolved),
        anchorMoved: anchorMoved,
        anchorMissing: anchorMissing,
        anchorUsed: { name: anchorName, source: anchorSource }
    };
    if (geoAnchorLost !== null) {
        // absent entirely rather than null when nothing was lost, so a
        // caller that never checks for it sees no shape change
        report.geoAnchorLost = geoAnchorLost;
    }
    return report;
};
