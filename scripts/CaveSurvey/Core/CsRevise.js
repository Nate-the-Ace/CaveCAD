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
