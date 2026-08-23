// CsDraw.js -- the only Core module that draws.
//
// Part of the Cave Survey Core library. QCAD context only.
//
// BUILT ON THE DIRECT ENTITY API, NOT simple.js: in the QJS bridge,
// simple.js's setCurrentLayer and post-add property writes fail
// SILENTLY -- a real survey saved to DXF came back with every mark on
// one layer and not a single tag. The working pattern (proven by
// headless round-trip): construct the entity, setLayerId and
// setCustomProperty BEFORE adding, then op.addObject(entity, false)
// -- the false is what stops the operation stamping the current
// layer over the one just set.
//
// Every drawing function here takes the document and an
// RAddObjectsOperation; the caller applies the operation, so a tool
// action stays one undo step. CsDraw.survey manages its own op.

var CsDraw = {};

CsDraw.TEXT_HEIGHT = 0.5;

/**
 * LETTERING IS UPPERCASE. Every piece of text this suite draws --
 * station labels, splay names, notes, the legend, title block values
 * -- is capitalised, the drafting convention that predates all of
 * this and that a hand-lettered cave map has always followed.
 *
 * It happens where the entity is MADE, never to the data behind it:
 * the note you typed stays as you typed it in the notebook and in
 * XDATA, and only the drawn text is capitalised. Nothing is lost, so
 * nothing has to be undone if the convention ever changes.
 *
 * The character after a backslash keeps its case: MText formatting
 * codes are case-sensitive (\P breaks a paragraph, \p sets paragraph
 * properties), so blind uppercasing would rewrite one into the other.
 */
CsDraw.caps = function(text) {
    if (text === undefined || text === null) {
        return "";
    }
    var s = String(text);
    var out = "";
    for (var i = 0; i < s.length; i++) {
        if (s.charAt(i) === "\\" && i + 1 < s.length) {
            out += s.charAt(i) + s.charAt(i + 1);   // escape code, verbatim
            i++;
            continue;
        }
        out += s.charAt(i).toUpperCase();
    }
    return out;
};

/** One text entity, layered, capitalised and tagged, into the op. */
CsDraw.addText = function(doc, op, layerName, text, pos, halign, tagKey, tagValue) {
    var data = new RTextData(pos, pos, CsDraw.TEXT_HEIGHT, 100.0,
        RS.VAlignMiddle, halign, RS.LeftToRight, RS.Exact,
        1.0, CsDraw.caps(text), "standard", false, false, 0.0, false);
    var entity = new RTextEntity(doc, data);
    entity.setLayerId(doc.getLayerId(layerName));
    if (tagKey !== undefined && tagValue !== undefined && tagValue !== "") {
        CsTags.set(entity, tagKey, tagValue);
    }
    op.addObject(entity, false);
    return entity;
};

/** One line, layered and tagged, into the op. extraTags (optional)
 *  is a {key: value} map written after the primary tag; empty/null
 *  values are dropped by CsTags.set itself. */
CsDraw.addLine = function(doc, op, layerName, from, to, tagKey, tagValue,
        extraTags) {
    var entity = new RLineEntity(doc, new RLineData(from, to));
    entity.setLayerId(doc.getLayerId(layerName));
    if (tagKey !== undefined && tagValue !== undefined && tagValue !== "") {
        CsTags.set(entity, tagKey, tagValue);
    }
    if (extraTags !== undefined && extraTags !== null) {
        for (var k in extraTags) {
            if (extraTags.hasOwnProperty(k)) {
                CsTags.set(entity, k, extraTags[k]);
            }
        }
    }
    op.addObject(entity, false);
    return entity;
};

/** One point, layered, into the op (tags via CsTags on the entity
 *  BEFORE this returns get committed with it). */
CsDraw.addPoint = function(doc, op, layerName, pos) {
    var entity = new RPointEntity(doc, new RPointData(pos));
    entity.setLayerId(doc.getLayerId(layerName));
    return entity; // caller tags, then op.addObject(entity, false)
};

/**
 * Draws one station: tagged point on CTRL-STATIONS, label on
 * CTRL-STATION-LABELS. Returns the point entity (already added).
 */
CsDraw.station = function(doc, op, pos, data) {
    var pt = CsDraw.addPoint(doc, op, CsLayers.STATIONS, pos);
    CsTags.tagStation(pt, data);
    op.addObject(pt, false);

    if (data.name !== undefined && data.name !== "") {
        var label = data.name;
        if (data.z !== undefined && data.z !== null && Math.abs(data.z) > 1e-6) {
            label += " (Z" + (data.z >= 0 ? "+" : "") + data.z.toFixed(1) + ")";
        }
        var rad = (data.azimuth === undefined || data.azimuth === null) ?
            (Math.PI / 4.0) : ((data.azimuth - 90.0) * Math.PI / 180.0);
        var off = CsDraw.TEXT_HEIGHT * 1.5;
        CsDraw.addText(doc, op, CsLayers.STATION_LABELS, label,
            new RVector(pos.x + off * Math.sin(rad), pos.y + off * Math.cos(rad)),
            RS.HAlignRight, "StationLabel", data.name);
    }
    return pt;
};

/** One centerline shot line, tagged with its endpoints ("A->B" under
 *  "Shot" -- eraseStations keys on it). layerName (optional) defaults
 *  to CTRL-SHOTS; extraTags (optional) adds the schema-v3 shot data
 *  tags. Older 6-argument callers keep working unchanged. */
CsDraw.shotLine = function(doc, op, fromPos, toPos, fromName, toName,
        layerName, extraTags) {
    var tag = (fromName !== undefined && toName !== undefined &&
        fromName !== "" && toName !== "") ? (fromName + "->" + toName) : "";
    return CsDraw.addLine(doc, op,
        (layerName === undefined || layerName === null) ?
            CsLayers.SHOTS : layerName,
        fromPos, toPos, "Shot", tag, extraTags);
};

/**
 * A station's LRUD: L/R tick lines with tagged tip points on
 * CTRL-LRUD, U/D note on CTRL-STATION-LABELS. null = not measured
 * (nothing drawn); 0 = wall at the station (tagged tip point only).
 */
CsDraw.lrud = function(doc, op, pos, name, azimuthDeg, left, right, up, down, allSides) {
    // allSides (optional): {leftAll, rightAll, upAll, downAll} -- a
    // side written "5/10" draws EVERY reading. The largest is the
    // primary (the outer wall, tagged "<name>.L"); the inner ones tag
    // "<name>.L2", "<name>.L3", ... so wall runs keep following the
    // outer wall while ledges stay findable.
    var sides = [
        ["L", left, allSides ? allSides.leftAll : null],
        ["R", right, allSides ? allSides.rightAll : null]
    ];
    for (var i = 0; i < sides.length; i++) {
        var side = sides[i][0];
        var primary = sides[i][1];
        if (primary === null || primary === undefined) {
            continue;
        }
        var values = sides[i][2];
        if (values === null || values === undefined) {
            values = [primary];
        }
        var extraIndex = 2;
        for (var v = 0; v < values.length; v++) {
            var len = values[v];
            var isPrimary = (len === primary);
            var suffix = isPrimary ? side : (side + extraIndex++);
            var tipPos;
            if (len === 0) {
                tipPos = new RVector(pos.x, pos.y);
            } else {
                var end = CsLrud.tickEnd(pos, azimuthDeg, side, len);
                tipPos = new RVector(end.x, end.y);
                CsDraw.addLine(doc, op, CsLayers.LRUD, pos, tipPos,
                    "LRUDLine", name !== "" ? (name + "." + suffix) : "");
            }
            if (name !== undefined && name !== "") {
                var tip = CsDraw.addPoint(doc, op, CsLayers.LRUD, tipPos);
                CsTags.set(tip, "LRUDName", name + "." + suffix);
                op.addObject(tip, false);
            }
            if (isPrimary) {
                // only the first occurrence of the max is primary
                primary = NaN;
            }
        }
    }

    var hasUp = up !== null && up !== undefined;
    var hasDown = down !== null && down !== undefined;
    if ((hasUp && up !== 0) || (hasDown && down !== 0)) {
        var upText = !hasUp ? "-" :
            (allSides && allSides.upAll ? allSides.upAll.join("/") : up.toFixed(2));
        var downText = !hasDown ? "-" :
            (allSides && allSides.downAll ? allSides.downAll.join("/") : down.toFixed(2));
        var text = "U" + upText + " D" + downText;
        var rad = (azimuthDeg + 90.0) * Math.PI / 180.0;
        var off = CsDraw.TEXT_HEIGHT * 1.5;
        CsDraw.addText(doc, op, CsLayers.STATION_LABELS, text,
            new RVector(pos.x + off * Math.sin(rad), pos.y + off * Math.cos(rad)),
            RS.HAlignLeft, "LRUDNote", name);
    }
};

/**
 * A station's note, written OUTSIDE the passage with a leader back to
 * the station point: the text sits beyond the nearer measured wall
 * (right of travel first, left as fallback, a fixed offset when no
 * LRUD), on TEXT-NOTES, with a leader pointing at the station.
 */
CsDraw.noteLeader = function(doc, op, pos, name, note, azimuthDeg, lrud) {
    var az = (azimuthDeg === undefined || azimuthDeg === null) ?
        0.0 : azimuthDeg;
    var side = 90.0; // right of the direction of travel
    var wall = 0.0;
    var r = (lrud !== null && lrud !== undefined &&
        lrud.right !== null && lrud.right !== undefined) ? lrud.right : null;
    var l = (lrud !== null && lrud !== undefined &&
        lrud.left !== null && lrud.left !== undefined) ? lrud.left : null;
    if (r !== null) {
        wall = r;
    } else if (l !== null) {
        side = -90.0;
        wall = l;
    }
    var rad = (az + side) * Math.PI / 180.0;
    var dirX = Math.sin(rad), dirY = Math.cos(rad);
    var dist = wall + CsDraw.TEXT_HEIGHT * 4.0;
    var labelPos = new RVector(pos.x + dirX * dist, pos.y + dirY * dist);

    // leader from the station (arrow end) to just short of the text
    var head = new RVector(pos.x + dirX * CsDraw.TEXT_HEIGHT * 0.6,
        pos.y + dirY * CsDraw.TEXT_HEIGHT * 0.6);
    var tail = new RVector(labelPos.x - dirX * CsDraw.TEXT_HEIGHT,
        labelPos.y - dirY * CsDraw.TEXT_HEIGHT);
    var leaderDrawn = false;
    try {
        var ld = new RLeaderData();
        ld.setArrowHead(true);
        ld.appendVertex(head);
        ld.appendVertex(tail);
        var leader = new RLeaderEntity(doc, ld);
        leader.setLayerId(doc.getLayerId(CsLayers.TEXT_NOTES));
        CsTags.set(leader, "NoteLeader", name);
        op.addObject(leader, false);
        leaderDrawn = true;
    } catch (e) {
        // bridge without RLeader*: a plain line still points the way
    }
    if (!leaderDrawn) {
        CsDraw.addLine(doc, op, CsLayers.TEXT_NOTES, head, tail,
            "NoteLeader", name);
    }
    CsDraw.addText(doc, op, CsLayers.TEXT_NOTES, note, labelPos,
        dirX >= 0 ? RS.HAlignLeft : RS.HAlignRight, "NoteLabel", name);
};

/**
 * Draws a whole resolved survey as ONE operation (one undo step) for
 * the visible survey: stations, labels, shot lines, LRUD, all layered
 * and tagged. A survey with excludeFromPlot shots issues up to three
 * more operations on top of that (undo then needs multiple steps),
 * because CsLayers.withLayerOn must toggle the OFF hidden-legs layer
 * on, add those legs, and toggle it back off -- this build refuses
 * adds to a layer that's off.
 *
 * Tag schema v3: the drawing's tags alone reconstruct the survey.
 * Every leg line carries its shot's full data (From/To/Trip/ShotSeq/
 * Distance/Azimuth/Inclination/LRUD, plus backsights/Flags/Note/
 * Declination when present) -- shots live on LEGS, not stations, because a loop
 * closure's arrival would overwrite the TO station's tags (the old
 * scheme's collision; station-level Azimuth etc. remain but legs are
 * canonical). Each trip's first resolved station anchors that trip's
 * metadata (Trip* tags); the trip-0 anchor additionally carries
 * StartNote/StartLrud, the legacy Survey* block, the adjustment record
 * (Adjustment/SigmaTape/SigmaAngle -- what this drawing's geometry was
 * solved with, so a redraw reproduces it instead of re-solving under
 * today's settings), and the shots the drawing can't show as geometry
 * (ExcludedShots/UnplacedShots rows).
 * excludeFromPlot legs draw on CTRL-HIDDEN (via CsLayers.withLayerOn,
 * since that layer is off) instead of being skipped.
 *
 * When `resolved` carries a `raw` result (CsAdjust set one, meaning
 * something really was adjusted), the AS-SURVEYED centerline is drawn
 * as a grey dashed ghost on CTRL-RAW -- another off layer, so another
 * withLayerOn operation. See the block itself for why the ghost is
 * tagged RawShot/RawStation and nothing else.
 *
 * \return {stationsDrawn, shotsDrawn, closuresDrawn, tiesDrawn,
 *          hiddenDrawn, wallsDrawn, splaysDrawn, ghostDrawn, skipped,
 *          splaysSkipped, wallPointsSkipped} -- the last two count
 *          splays CsTraverse.offset refused (no usable distance/
 *          azimuth/inclination), named apart from `skipped` (excluded,
 *          or never connected) so a report never conflates the two
 */
CsDraw.survey = function(survey, resolved, originStation, originPos, seqBase) {
    if (seqBase === undefined || seqBase === null) {
        seqBase = 0;
    }
    var doc = getDocument();
    var di = getDocumentInterface();
    CsLayers.ensureSurveyLayers(doc, di);
    CsModel.ensureTrips(survey);

    // per-trip shot sequence: shotSeqOf[i] = index of survey.shots[i]
    // within its own trip, in survey.shots order -- what reconstruction
    // sorts by to restore notebook order inside each trip.
    // Also stamped onto the shot itself as the transient _csSeq
    // property, since several call sites below only have the shot
    // object (from resolved.legs/resolved.unresolved, not a
    // survey.shots index) and would otherwise need an O(n)
    // survey.shots.indexOf(shot) per shot to look shotSeqOf up --
    // this precompute loop already visits every shot once, so reading
    // shot._csSeq back is O(1) instead.
    var shotSeqOf = [];
    var tripCounters = {};
    for (var si = 0; si < survey.shots.length; si++) {
        var sTrip = survey.shots[si].trip || 0;
        shotSeqOf[si] = tripCounters[sTrip] || 0;
        tripCounters[sTrip] = shotSeqOf[si] + 1;
        survey.shots[si]._csSeq = shotSeqOf[si];
    }

    // a station's trip = trip of the first shot that touches it; the
    // first drawn station of each trip anchors that trip's metadata
    var stationTrip = {};
    for (si = 0; si < survey.shots.length; si++) {
        var tSh = survey.shots[si];
        if (tSh.excludeFromAll) {
            continue;
        }
        if (tSh.from !== "" && stationTrip[tSh.from] === undefined) {
            stationTrip[tSh.from] = tSh.trip || 0;
        }
        if (!tSh.splay && tSh.to !== "" &&
                stationTrip[tSh.to] === undefined) {
            stationTrip[tSh.to] = tSh.trip || 0;
        }
    }

    // the v3 data tags one drawn leg (or splay) carries. shot._csSeq
    // is the per-trip sequence stamped by the precompute loop above --
    // reading it here avoids an O(n) survey.shots.indexOf(shot) at
    // every call site.
    var legTags = function(shot) {
        var tags = {
            From: shot.from,
            To: shot.to,
            Trip: shot.trip || 0,
            ShotSeq: shot._csSeq,
            Distance: shot.distance,
            Azimuth: shot.azimuth,
            Inclination: shot.inclination,
            Left: CsModel.lrudEntryText(shot.left, shot.leftAll),
            Right: CsModel.lrudEntryText(shot.right, shot.rightAll),
            Up: CsModel.lrudEntryText(shot.up, shot.upAll),
            Down: CsModel.lrudEntryText(shot.down, shot.downAll),
            BackAzimuth: shot.backAzimuth,
            BackInclination: shot.backInclination,
            Flags: CsModel.flagsText(shot),
            Note: shot.notes,
            // The declination this shot's azimuth was computed with:
            // provenance has to survive the save, or a revision of a
            // reopened drawing is back to guessing from the trip.
            // Null -- no record, fall back to the trip -- writes no
            // tag, which reads back as the same null.
            Declination: shot.declination
        };
        // CsTags.set drops null/"" values itself, so absent backsights,
        // empty flag sets and unmeasured LRUD simply write no tag
        return tags;
    };

    var op = new RAddObjectsOperation();
    op.setText("Draw cave survey");

    var offX = 0, offY = 0;
    if (originStation !== undefined && originStation !== null &&
        resolved.stations.hasOwnProperty(originStation) &&
        originPos !== undefined && originPos !== null) {
        offX = originPos.x - resolved.stations[originStation].x;
        offY = originPos.y - resolved.stations[originStation].y;
    }

    var at = function(name) {
        var st = resolved.stations[name];
        return new RVector(st.x + offX, st.y + offY);
    };

    var names = [];
    for (var n in resolved.stations) {
        if (resolved.stations.hasOwnProperty(n)) {
            names.push(n);
        }
    }
    names.sort(function(a, b) {
        return resolved.stations[a].seq - resolved.stations[b].seq;
    });

    // the first drawn leg's azimuth orients the start station's LRUD
    var firstLegAzimuth;
    for (var li = 0; li < resolved.legs.length; li++) {
        if (!resolved.legs[li].shot.excludeFromPlot) {
            firstLegAzimuth = CsTraverse.effectiveAzimuth(resolved.legs[li].shot);
            break;
        }
    }

    // a station's note rides on the shot arriving at it; the first
    // station's on survey.startNote
    var noteFor = {};
    for (var ni = 0; ni < survey.shots.length; ni++) {
        var nsh = survey.shots[ni];
        if (!nsh.splay && !nsh.excludeFromAll && nsh.notes &&
            nsh.notes !== "") {
            noteFor[nsh.to] = nsh.notes;
        }
    }

    var stationsDrawn = 0;
    var firstPoint;
    var tripAnchor = {}; // trip index -> that trip's anchor point entity
    for (var i = 0; i < names.length; i++) {
        var name = names[i];
        var lrud = CsModel.lrudForStation(survey, name);
        if (lrud === null && i === 0 && survey.startLrud !== null &&
            survey.startLrud !== undefined && firstLegAzimuth !== undefined) {
            lrud = {
                left: survey.startLrud.left,
                right: survey.startLrud.right,
                up: survey.startLrud.up,
                down: survey.startLrud.down,
                leftAll: survey.startLrud.leftAll || null,
                rightAll: survey.startLrud.rightAll || null,
                upAll: survey.startLrud.upAll || null,
                downAll: survey.startLrud.downAll || null,
                azimuth: firstLegAzimuth
            };
        }
        var noteText = noteFor[name] !== undefined ? noteFor[name] :
            (i === 0 ? survey.startNote : undefined);
        var pt = CsDraw.station(doc, op, at(name), {
            name: name,
            seq: resolved.stations[name].seq + seqBase,
            azimuth: lrud !== null ? lrud.azimuth : undefined,
            left: lrud !== null ? lrud.left : undefined,
            right: lrud !== null ? lrud.right : undefined,
            up: lrud !== null ? lrud.up : undefined,
            down: lrud !== null ? lrud.down : undefined,
            z: resolved.stations[name].z,
            note: noteText
        });
        if (firstPoint === undefined) {
            firstPoint = pt;
        }
        if (stationTrip[name] !== undefined &&
                tripAnchor[stationTrip[name]] === undefined) {
            tripAnchor[stationTrip[name]] = pt;
        }
        if (survey.fixed.hasOwnProperty(name)) {
            // The Fixed tag is read back into survey.fixed verbatim on
            // reopen (CsTags.surveyFromDocument, CsRevise's scale
            // rewrite): it has to describe the SAME coordinate the
            // station is actually drawn at, or a later revision
            // "corrects" a disagreement between the tag and the
            // geometry that was never real. Writing the resolved
            // station position rather than the raw survey.fixed[name]
            // guarantees that -- the two already coincide whenever
            // the control was honored as given, or honored via the
            // anchor's frame offset (CsNetwork.resolve's
            // controlFrame.applied), so this changes nothing in
            // either of those common cases. When the control was NOT
            // honored at all (named in controlFrame.notHonored --
            // there was no anchor's-frame offset to place it with),
            // there is nothing truthful to write: the tag is skipped
            // rather than asserting a control value nobody actually
            // pinned.
            var cf = resolved.controlFrame;
            var fixedNotHonored = cf !== undefined && cf !== null &&
                cf.notHonored.indexOf(name) >= 0;
            if (!fixedNotHonored) {
                var fst = resolved.stations[name];
                CsTags.set(pt, "Fixed", fst.x + "," + fst.y + "," + fst.z);
            }
        }
        if (lrud !== null) {
            CsDraw.lrud(doc, op, at(name), name, lrud.azimuth,
                lrud.left, lrud.right, lrud.up, lrud.down, {
                    leftAll: lrud.leftAll, rightAll: lrud.rightAll,
                    upAll: lrud.upAll, downAll: lrud.downAll
                });
        }
        if (noteText !== undefined && noteText !== null && noteText !== "") {
            CsLayers.ensure(doc, di, CsLayers.TEXT_NOTES);
            CsDraw.noteLeader(doc, op, at(name), name, noteText,
                lrud !== null ? lrud.azimuth : firstLegAzimuth, lrud);
        }
        stationsDrawn++;
    }

    var shotsDrawn = 0, closuresDrawn = 0, tiesDrawn = 0;
    var hiddenLegs = []; // excludeFromPlot legs -- drawn on CTRL-HIDDEN below
    for (i = 0; i < resolved.legs.length; i++) {
        var leg = resolved.legs[i];
        if (leg.shot.excludeFromPlot) {
            hiddenLegs.push(leg);
            continue;
        }
        CsDraw.shotLine(doc, op, at(leg.from), at(leg.to), leg.from, leg.to,
            CsLayers.SHOTS, legTags(leg.shot));
        // The three leg kinds CsNetwork produces, counted apart because
        // they mean different things to a surveyor. "new" extends the
        // traverse. "closure" arrives back at a station already placed
        // through the SAME component -- a loop, with a misclosure to
        // distribute. "tie" is the one shot joining two separately
        // anchored components (a cave with two *fix'ed entrances): it
        // has no ring, so no percent-of-traverse error, and calling it
        // a loop closure would be wrong. Before this it fell into the
        // ordinary-shot branch by accident rather than by decision.
        if (leg.kind === "closure") {
            closuresDrawn++;
        } else if (leg.kind === "tie") {
            tiesDrawn++;
        } else {
            shotsDrawn++;
        }
    }

    // Splays: rays from their station to the wall they hit, thin and
    // grey on CTRL-SPLAYS, each ending in a tagged tip point -- the
    // same shape LRUD ticks leave, so wall tracing can snap to them.
    // Named <station>.<n> in shot order, matching what the notebook
    // shows. The network never resolves them (no TO station), so they
    // are drawn straight off their shot readings. eraseStations strips
    // the trailing .<n> to replace them on a redraw.
    var splaysDrawn = 0;
    var splaysSkipped = 0;
    var splayCounts = {};
    for (i = 0; i < survey.shots.length; i++) {
        var sp = survey.shots[i];
        if (!sp.splay || sp.excludeFromAll || sp.excludeFromPlot) {
            continue;
        }
        if (!resolved.stations.hasOwnProperty(sp.from)) {
            continue; // its station never connected -- stays skipped
        }
        // count against the station's OWN row order even when this
        // splay turns out unmeasurable, so a splay that DOES draw
        // keeps the number matching its row in the notebook -- a gap
        // in the numbering (D2.1, D2.3) is itself a signal, not a bug
        splayCounts[sp.from] = (splayCounts[sp.from] || 0) + 1;
        var splayName = sp.from + "." + splayCounts[sp.from];
        var so = CsTraverse.offset(sp, CsTraverse.SLOPE);
        if (so === null) {
            // no distance or no azimuth/inclination on record: a ray
            // drawn from null*cos (at the station) or NaN (poisoning
            // RVector and the DXF writer) would both assert a
            // measurement nobody took. Skip it and count it instead.
            splaysSkipped++;
            continue;
        }
        var sPos = at(sp.from);
        var sEnd = new RVector(sPos.x + so.dx, sPos.y + so.dy);
        // the ray carries its readings too (v3): Trip/ShotSeq/Distance/
        // Azimuth/Inclination/Note, so the splay reconstructs from tags
        CsDraw.addLine(doc, op, CsLayers.SPLAYS, sPos, sEnd,
            "Splay", splayName, legTags(sp));
        var sTip = CsDraw.addPoint(doc, op, CsLayers.SPLAYS, sEnd);
        CsTags.set(sTip, "SplayName", splayName);
        op.addObject(sTip, false);
        // the tip's name, just past the tip so the ray stays clear
        var sLen = Math.sqrt(so.dx * so.dx + so.dy * so.dy);
        var ux = sLen > 1e-9 ? so.dx / sLen : 1.0;
        var uy = sLen > 1e-9 ? so.dy / sLen : 0.0;
        CsDraw.addText(doc, op, CsLayers.SPLAYS, splayName,
            new RVector(sEnd.x + ux * CsDraw.TEXT_HEIGHT * 0.8,
                sEnd.y + uy * CsDraw.TEXT_HEIGHT * 0.8),
            ux >= 0 ? RS.HAlignLeft : RS.HAlignRight,
            "SplayLabel", splayName);
        splaysDrawn++;
    }

    // Approximate passage walls from the LRUD, drawn WITH the survey
    // in the same undo step (this absorbed the old standalone LRUD
    // Walls tool). Straight dashed runs on the CTRL layers; runs break
    // at junctions and unmeasured stations on purpose. Tagged with the
    // survey's station list so eraseStations() can replace them on a
    // redraw.
    var wallsDrawn = 0;
    var runs = CsLrud.wallRuns(survey, resolved);
    var wallPointsSkipped = runs.skipped;
    if (runs.left.length > 0 || runs.right.length > 0) {
        CsLayers.ensure(doc, di, CsLayers.LRUD_WALL_LEFT);
        CsLayers.ensure(doc, di, CsLayers.LRUD_WALL_RIGHT);
        var allNames = names.join("|");
        var drawRuns = function(runList, layerName) {
            for (var ri = 0; ri < runList.length; ri++) {
                var data = new RPolylineData();
                for (var k = 0; k < runList[ri].length; k++) {
                    // wall points come from the unanchored resolved
                    // coordinates: apply the same origin offset the
                    // stations get
                    data.appendVertex(new RVector(
                        runList[ri][k].x + offX, runList[ri][k].y + offY));
                }
                var pl = new RPolylineEntity(doc, data);
                pl.setLayerId(doc.getLayerId(layerName));
                CsTags.set(pl, "WallRun", layerName + ":" + ri);
                CsTags.set(pl, "WallRunStations", allNames);
                op.addObject(pl, false);
                wallsDrawn++;
            }
        };
        drawRuns(runs.left, CsLayers.LRUD_WALL_LEFT);
        drawRuns(runs.right, CsLayers.LRUD_WALL_RIGHT);
    }

    // Per-trip anchor tags: each trip's metadata rides on its first
    // resolved station in drawing order, so the drawing carries every
    // trip's date/team/declination, not just trip 0's.
    for (var ti = 0; ti < survey.trips.length; ti++) {
        var anchorPt = tripAnchor[ti];
        if (anchorPt === undefined) {
            continue; // no resolved station belongs to this trip
        }
        var trip = survey.trips[ti];
        CsTags.set(anchorPt, "Trip", ti);
        CsTags.set(anchorPt, "TripName", trip.name);
        CsTags.set(anchorPt, "TripDate", trip.date);
        CsTags.set(anchorPt, "TripTeam", trip.team);
        CsTags.set(anchorPt, "TripDeclination", trip.declination);
        CsTags.set(anchorPt, "TripDeclinationSource", trip.declinationSource);
        CsTags.set(anchorPt, "TripDistanceUnit", trip.distanceUnit);
    }

    var anchor0 = tripAnchor[0] !== undefined ? tripAnchor[0] : firstPoint;
    if (anchor0 !== undefined) {
        // Legacy survey-level block, kept for pre-trip readers. The
        // name restores its pre-trip-split meaning: the drawing-level
        // cave name when known, falling back to the trip name for
        // formats with no separate cave-name concept.
        CsTags.set(anchor0, "SurveyName", survey.caveName || survey.name);
        CsTags.set(anchor0, "SurveyDate", survey.date);
        CsTags.set(anchor0, "SurveyTeam", survey.team);
        CsTags.set(anchor0, "Declination", survey.declination);
        CsTags.set(anchor0, "DeclinationSource", survey.declinationSource);
        CsTags.set(anchor0, "DistanceUnit", survey.distanceUnit);
        // v3: the first station's own data (no arriving shot carries it)
        CsTags.set(anchor0, "StartNote", survey.startNote);
        CsTags.set(anchor0, "StartLrud",
            CsModel.startLrudText(survey.startLrud));
        // WHAT THIS DRAWING WAS ADJUSTED WITH, so reopening it and
        // pressing Draw reproduces the geometry it already has instead
        // of silently re-solving under whatever the global setting
        // happens to be that day. Recorded unconditionally, including
        // "none": adjustment OFF is just as much a fact about this
        // drawing as adjustment on, and a drawing that records nothing
        // falls back to the settings (see CsAdjust.optionsFromTags),
        // which is exactly the silent move this record exists to stop.
        //
        // The sigmas come from summary, not from CsAdjust's defaults,
        // because summary is what the solve actually used -- and on the
        // pass-through path CsAdjust.unadjusted reports the caller's
        // own sigmas there for this reason. A `resolved` that never
        // went through CsAdjust at all (a plain CsNetwork.resolve --
        // several tests, and any caller not yet wired) has no summary:
        // record the defaults rather than NaN, and Adjustment=none,
        // which is the truth about such a drawing.
        var adjTags = CsAdjust.tagsFor({
            enabled: resolved.adjusted === true,
            sigmaTape: (resolved.summary !== undefined &&
                resolved.summary !== null) ? resolved.summary.sigmaTape :
                CsAdjust.DEFAULT_SIGMA_TAPE,
            sigmaAngle: (resolved.summary !== undefined &&
                resolved.summary !== null) ? resolved.summary.sigmaAngle :
                CsAdjust.DEFAULT_SIGMA_ANGLE
        });
        CsTags.set(anchor0, "Adjustment", adjTags.Adjustment);
        CsTags.set(anchor0, "SigmaTape", adjTags.SigmaTape);
        CsTags.set(anchor0, "SigmaAngle", adjTags.SigmaAngle);
        // Shots the drawing can't show as geometry still reconstruct:
        // one "tripId TAB shotSeq TAB shotRow" line per shot (CsTags.set
        // escapes the newlines between lines itself). shotSeq is the
        // same per-trip counter (shotSeqOf, computed above for the
        // drawn legs/splays) so a reader can interleave these rows with
        // the drawn shots and restore the original notebook order
        // within each trip.
        var exRows = [];
        var unRows = [];
        for (i = 0; i < survey.shots.length; i++) {
            if (survey.shots[i].excludeFromAll) {
                exRows.push((survey.shots[i].trip || 0) + "\t" +
                    shotSeqOf[i] + "\t" +
                    CsModel.shotRowText(survey.shots[i]));
            }
        }
        for (i = 0; i < resolved.unresolved.length; i++) {
            unRows.push((resolved.unresolved[i].trip || 0) + "\t" +
                resolved.unresolved[i]._csSeq + "\t" +
                CsModel.shotRowText(resolved.unresolved[i]));
        }
        if (exRows.length > 0) {
            CsTags.set(anchor0, "ExcludedShots", exRows.join("\n"));
        }
        if (unRows.length > 0) {
            CsTags.set(anchor0, "UnplacedShots", unRows.join("\n"));
        }
    }

    di.applyOperation(op);

    // excludeFromPlot legs persist on CTRL-HIDDEN with the same tags
    // as visible legs. That layer is OFF, and adds to an off layer
    // silently fail in this build -- withLayerOn flips it on around
    // this one operation and back off after (see CsLayers.OFF).
    var hiddenDrawn = 0;
    if (hiddenLegs.length > 0) {
        CsLayers.withLayerOn(doc, di, CsLayers.HIDDEN, function() {
            var hop = new RAddObjectsOperation();
            hop.setText("Draw hidden survey legs");
            for (var hi = 0; hi < hiddenLegs.length; hi++) {
                var hLeg = hiddenLegs[hi];
                CsDraw.shotLine(doc, hop, at(hLeg.from), at(hLeg.to),
                    hLeg.from, hLeg.to, CsLayers.HIDDEN,
                    legTags(hLeg.shot));
                hiddenDrawn++;
            }
            di.applyOperation(hop);
        });
    }

    // The AS-SURVEYED ghost. When `resolved` came from CsAdjust and
    // something was actually adjusted, `raw` holds the pre-adjustment
    // network -- draw it grey and dashed on CTRL-RAW so that switching
    // that layer on shows exactly what the adjustment moved and by how
    // much. This is the "shown" half of "adjustment shown and
    // reversible". The reversible half needs no code at all: the raw
    // readings live in XDATA and were never touched, so redrawing with
    // adjustment off reproduces the as-surveyed drawing exactly.
    //
    // No raw means no ghost, and that is not a degenerate case -- it is
    // adjustment off, or a solve that did not converge. The drawn
    // geometry then already IS the as-surveyed geometry, and a ghost
    // lying exactly on top of it would be noise.
    //
    // The ghost rides the SAME offX/offY the drawn stations got, never
    // an offset recomputed from the raw coordinates. Raw and adjusted
    // are two positions in one frame, so one rigid offset keeps them
    // registered; a raw-derived offset would pin the ghost's origin
    // station on top of its drawn point and hide whatever the
    // adjustment did to that station.
    //
    // The ghost carries RawShot / RawStation and NOTHING else -- no
    // Shot, no Station, none of the v3 data tags. Everything that
    // reads a drawing back keys on those: CsRevise.surveyFromDocument
    // would ingest a tagged ghost as a duplicate shot,
    // CsBind.stationIndex would offer a phantom for linework to snap
    // to, and eraseStations' leg rule would half-own it. A ghost
    // answering to those names would put two positions -- adjusted and
    // as-surveyed -- under one name.
    var ghostDrawn = 0;
    var rawResolved = (resolved.raw === undefined || resolved.raw === null) ?
        null : resolved.raw;
    if (rawResolved !== null && rawResolved.stations !== undefined &&
            rawResolved.stations !== null) {
        // CTRL-RAW is deliberately NOT in ensureSurveyLayers: like
        // TEXT-NOTES and the wall layers above, it is created by the
        // drawing that needs it rather than added to every survey. And
        // it is created OFF (CsLayers.OFF), which is why every add
        // below sits inside withLayerOn -- this build's
        // RAddObjectsOperation drops adds to an off layer without a
        // word, so getting this wrong yields no geometry and no error.
        CsLayers.ensure(doc, di, CsLayers.RAW);
        var rawLegs = rawResolved.legs || [];
        var rawAt = function(stationName) {
            var rst = rawResolved.stations[stationName];
            return new RVector(rst.x + offX, rst.y + offY);
        };
        CsLayers.withLayerOn(doc, di, CsLayers.RAW, function() {
            var gop = new RAddObjectsOperation();
            gop.setText("Draw as-surveyed ghost");
            for (var gi = 0; gi < rawLegs.length; gi++) {
                var gLeg = rawLegs[gi];
                if (gLeg.shot.excludeFromPlot) {
                    // these draw on CTRL-HIDDEN, itself off: ghosting
                    // them would only add a second invisible copy
                    continue;
                }
                if (!rawResolved.stations.hasOwnProperty(gLeg.from) ||
                        !rawResolved.stations.hasOwnProperty(gLeg.to)) {
                    continue;
                }
                CsDraw.addLine(doc, gop, CsLayers.RAW,
                    rawAt(gLeg.from), rawAt(gLeg.to),
                    "RawShot", gLeg.from + "->" + gLeg.to);
                ghostDrawn++;
            }
            for (var gName in rawResolved.stations) {
                if (!rawResolved.stations.hasOwnProperty(gName)) {
                    continue;
                }
                // same shape a splay tip takes: tag the point, THEN add
                var gPt = CsDraw.addPoint(doc, gop, CsLayers.RAW,
                    rawAt(gName));
                CsTags.set(gPt, "RawStation", gName);
                gop.addObject(gPt, false);
            }
            di.applyOperation(gop);
        });
    }

    CsStore.migrate(doc, di); // convert + drop a legacy store, if any

    // The extended elevation is a PRODUCT of drawing, not a command to
    // remember: every notebook Draw, import and revision redraw
    // refreshes the sibling profile file. Gated by CaveSurvey/
    // ProfileAuto (default true). Wrapped whole: a profile that cannot
    // be written must never take the plan draw down with it -- the plan
    // is the drawing the user is looking at, and everything above this
    // point has already committed real geometry to it.
    var profileOutcome = { skipped: true, reason: "profile pass not run" };
    try {
        profileOutcome = CsDraw.profile(survey, resolved);
    } catch (eProfile) {
        // Building the reason string is ITSELF not safe to trust: string
        // concatenation calls eProfile.toString(), and an exception whose
        // own toString() throws (a hostile or merely buggy object thrown
        // from somewhere deep in the profile pass) would propagate straight
        // out of this catch and out of CsDraw.survey with it -- exactly
        // the "the profile pass can never take the plan draw down" promise
        // this whole try/catch exists to keep, broken by the one line
        // meant to report the failure. Set a safe default FIRST, then try
        // to improve it; a second failure trying to describe the first
        // one is swallowed rather than allowed to escape in its place.
        profileOutcome = { skipped: true, reason: "profile pass failed" };
        try {
            profileOutcome.reason = "profile pass failed: " + eProfile;
        } catch (eStr) {
            // eProfile.toString() itself threw -- the reason set above
            // stands; a description of the failure is a nicety, not a
            // requirement the plan draw can be allowed to fail over
        }
    }

    return {
        stationsDrawn: stationsDrawn,
        shotsDrawn: shotsDrawn,
        closuresDrawn: closuresDrawn,
        tiesDrawn: tiesDrawn,
        hiddenDrawn: hiddenDrawn,
        wallsDrawn: wallsDrawn,
        splaysDrawn: splaysDrawn,
        ghostDrawn: ghostDrawn,
        // splays with no usable distance/azimuth/inclination -- named
        // apart from `skipped` below, which means "excluded, or never
        // connected": an unmeasurable splay's station DID connect, so
        // folding it into that bucket would misreport why it is
        // missing from the drawing
        splaysSkipped: splaysSkipped,
        // same distinction for the LRUD-derived wall runs: a splay
        // that contributed no ceiling/floor point because it had
        // nothing usable to offer, as counted by CsLrud.wallRuns
        wallPointsSkipped: wallPointsSkipped,
        // splays that DID draw no longer count as skipped, and neither
        // do the ones skipped for being unmeasurable -- they have
        // their own, more honest count just above
        skipped: resolved.skipped.length - splaysDrawn - splaysSkipped,
        // {skipped, reason} or {path, created, counts, profile} -- see
        // CsDraw.profile. A NEW key on an object every existing caller
        // already reads by name (RebuildSurveyData.js,
        // ImportCaveSurvey.js, SurveyNotebook.js, CsRevise.js): none of
        // them destructure this return value positionally or iterate
        // its keys, so an additional one is additive, not breaking.
        profile: profileOutcome
    };
};

/**
 * Refreshes the sibling extended elevation for the CURRENT drawing.
 *
 * Everything document-shaped happens here; the geometry is CsProfile's
 * and the drawing is CsProfileDraw's. The one thing this function owns
 * is the decision about WHERE: an already-open profile tab is drawn
 * into directly (so the user's own view updates and their undo still
 * works), and otherwise the file is built off screen and revealed.
 *
 * GATED ON THE SURVEY'S TOTAL STATION COUNT, WITH THE LARGEST SINGLE RUN
 * COMPUTED AND NAMED ALONGSIDE IT. CsProfile.settings().maxStations
 * (CaveSurvey/ProfileAutoMaxStations, default 3000) is compared against
 * the total, via a plain CsProfile.groupRuns() pass -- see CsProfile.
 * settings' own docblock for the full measurement, but in short: an
 * earlier draft of this gate checked the largest run ALONE, on the
 * theory that CsProfile.longestChain's chain search (quadratic in one
 * run's length) was the cost worth avoiding. Measured on CaveCAD: a
 * survey chopped into thirty 150-station named runs -- the "one letter
 * per trip" shape a real cave actually takes -- sailed through that gate
 * (no run anywhere near the limit) while costing WITHIN A FEW PERCENT of
 * what one single 4500-station run costs to build, because the cost is
 * governed by the TOTAL station count, not by O(run length^2). A
 * largest-run-only gate measured the wrong denominator: it let the
 * expensive many-run shape through and did nothing extra to catch it.
 * See the comment on the comparison itself, below, for why the fix
 * checks the total ALONE rather than "largest run OR total" -- the two
 * are not independent conditions once they share a threshold.
 * groupRuns() itself is a sort, not a chain search or a per-pair leg
 * lookup, so computing both numbers here costs nothing close to what a
 * skip avoids. The manual GenerateProfile command (Task 10) is never
 * gated by this.
 *
 * WHAT THE DOMINANT TERM IS, AS OF THE LEG INDEX. That "within a few
 * percent" measurement was originally explained by CsProfile.legBetween
 * scanning all of resolved.legs on every chain step -- O(total stations
 * x total legs). CsProfile.legIndex now makes each of those a
 * one-bucket lookup: 20.2 million leg comparisons down to ~4,500 on a
 * 4500-station survey, and a build 40-46% faster across every shape
 * measured. The gate's own conclusion is UNCHANGED, and so is its
 * threshold: the total still governs, because the remaining dominant
 * term -- CsProfile.bandWallRuns, through CsModel.lrudForStation's own
 * full scan of survey.shots once per station per band -- has exactly
 * the same O(total stations x total shots) shape one function over. At
 * the 3000 default the automatic pass measures about half a second on
 * CaveCAD (was about nine tenths); 4500 would be ~1.25s and 8000 ~4.3s
 * on every single draw, which is why the default was reconsidered on
 * these numbers and deliberately LEFT at 3000. CsProfile.settings' own
 * docblock carries the whole table, the per-function split, and the
 * scratch measurement of the change that would earn a higher ceiling.
 *
 * \return {skipped, reason} or {path, created, counts, profile}
 */
CsDraw.profile = function(survey, resolved) {
    var settings = CsProfile.settings();
    if (!settings.auto) {
        return { skipped: true,
            reason: "CaveSurvey/ProfileAuto is off" };
    }

    // MINOR: checked BEFORE the size gate below, deliberately. An
    // unsaved drawing has nowhere to put a sibling regardless of survey
    // size, so there is no reason to make it pay for the O(total
    // stations) CsProfile.groupRuns() pass first -- siblingPath() is
    // pure and does no file I/O, so this costs nothing when the drawing
    // IS saved. The reason text is CsProfileFile's own single-sourced
    // constant (not duplicated here as a string literal) so this early
    // exit and CsProfileFile.resolve()'s OWN identical check, reached
    // moments later once the drawing IS saved, can never drift apart in
    // wording.
    var planPath = getDocument().getFileName();
    if (CsProfileFile.siblingPath(planPath) === null) {
        return { skipped: true, reason: CsProfileFile.NO_FILENAME_REASON };
    }

    var grouped = CsProfile.groupRuns(resolved);
    var largestRun = 0;
    var totalStations = 0;
    for (var gi = 0; gi < grouped.order.length; gi++) {
        var runLen = grouped.runs[grouped.order[gi]].stations.length;
        totalStations += runLen;
        if (runLen > largestRun) {
            largestRun = runLen;
        }
    }
    // THE CONDITION CHECKS totalStations ALONE, DELIBERATELY, even
    // though both numbers are computed and both are named in the
    // message below. totalStations is the sum of every run's own
    // length, so totalStations >= largestRun ALWAYS (one or more
    // non-negative addends can never sum to less than their own
    // maximum) -- an "or largestRun > settings.maxStations" clause here
    // could therefore never independently trip this gate: whenever it
    // would, the total clause already has, at the identical threshold.
    // That is not an oversight; it is why there is only one comparison
    // to write. largestRun is still computed and still named in the
    // reason string below, because it is genuinely useful DIAGNOSTIC
    // information (a surveyor reading "4500 stations across 1 run" vs.
    // "4500 stations across 30 runs (largest 150)" learns something
    // real about their own data either way), just not a SEPARATE gating
    // condition -- see CsProfile.settings' own docblock for the
    // measurement this replaces (a largest-run-only gate that let a
    // many-small-runs survey costing the same as one big run straight
    // through).
    if (totalStations > settings.maxStations) {
        return { skipped: true,
            reason: "the survey has " + totalStations + " station" +
                (totalStations === 1 ? "" : "s") + " across " +
                grouped.order.length + " run" +
                (grouped.order.length === 1 ? "" : "s") +
                " (largest run " + largestRun + "), over " +
                "CaveSurvey/ProfileAutoMaxStations (" +
                settings.maxStations + ") -- run GenerateProfile by " +
                "hand to build the profile anyway" };
    }

    // revealPolicy omitted: this is the AUTOMATIC pass, run on every
    // plan draw -- see CsDraw.profileNow's own docblock for why it must
    // stay quiet-unless-created rather than reveal every time the way
    // GenerateProfile (the manual command) does.
    return CsDraw.profileNow(getDocument(), survey, resolved, settings);
};

/**
 * The post-gate half of CsDraw.profile, factored out so the manual
 * GenerateProfile command (Task 10) can share it byte-for-byte instead
 * of maintaining its own copy. BOTH of CsDraw.profile's gates (auto
 * switch, size) run BEFORE this function is ever called -- Generate
 * Profile bypasses both on purpose (that is the whole point of a manual
 * command), so this is exactly the part there was ever anything to
 * share: resolve where to draw, build, draw, commit, reveal.
 *
 * Takes `doc` EXPLICITLY, unlike CsDraw.profile, which reads it from
 * getDocument() -- the manual tool already has its own `doc` in hand
 * (it is not necessarily "the current document" by the time this would
 * run inside some future caller), so this never assumes there is a
 * global "current" one.
 *
 * REVEAL POLICY -- DELIBERATELY DIFFERENT FOR THE TWO CALLERS, an
 * earlier pass through this function got this wrong: it unified both
 * callers onto "reveal only a NEWLY CREATED sibling file
 * (target.created)" on the stated grounds that there was no reason for
 * them to differ. There is one. CsDraw.profile's automatic pass runs on
 * EVERY plan draw -- opening a tab every time would steal focus from
 * whatever the user is actually doing, so quiet-unless-created is
 * correct there; that is `revealPolicy` left at its default,
 * "auto-quiet". GenerateProfile's whole reason to exist is "show me my
 * profile now" -- a manual command the user reached for on purpose --
 * so it must reveal the drawing on every successful outcome, not only
 * when target.created happens to be true. `target.created` is
 * `!exists` (see CsProfileFile.resolve): the common case for a SECOND
 * run of this tool is a sibling that already exists on disk but is not
 * currently open as a tab (offscreen: true, created: false) -- exactly
 * the case the unified policy silently rewrote the file for and then
 * showed the user nothing. Pass revealPolicy === "always" (Generate
 * Profile does) to reveal after every non-skipped outcome regardless of
 * `created`; an already-open tab (offscreen: false) reveals harmlessly
 * too -- CsProfileFile.reveal's own openFiles() call focuses the
 * existing tab rather than opening a duplicate, so calling it on a
 * drawing already on screen costs nothing.
 *
 * \param settings     CsProfile.settings() already read by the caller
 *                     (both gates in CsDraw.profile need it before this
 *                     point, and the manual tool reads it once for the
 *                     same fields, so neither caller should read it
 *                     twice)
 * \param revealPolicy "auto-quiet" (default, or omitted) reveals only a
 *                     newly created sibling -- the automatic pass's
 *                     policy, so it never steals focus on an ordinary
 *                     plan draw. "always" reveals on every successful
 *                     (non-skipped) outcome -- the manual command's
 *                     policy, matching the tool's pre-unification
 *                     behaviour: "show me my profile now" means show it,
 *                     whether the file was just created or already
 *                     existed.
 * \return {skipped, reason} or {path, created, counts, profile}
 */
CsDraw.profileNow = function(doc, survey, resolved, settings, revealPolicy) {
    var target = CsProfileFile.resolve(doc.getFileName());
    if (target.doc === null) {
        return { skipped: true, reason: target.reason };
    }

    // MINOR: an off-screen target.di (CsProfileFile.resolve built a
    // fresh memory document for us) is normally disposed of by
    // CsProfileFile.commit(), win or lose -- but commit() is never
    // reached if build()/render() throws, and an open-tab target
    // (target.offscreen === false) is the user's own live document and
    // must NEVER be destroyed, thrown exception or not. `drewOk` is
    // what tells the finally block below which case it is in: without
    // this, a failed draw on the offscreen path leaked one
    // RDocument/RDocumentInterface per failure. The exception itself is
    // NOT caught here -- it still propagates to this function's own
    // caller exactly as it did before this leak fix existed (CsDraw.
    // profile's caller, CsDraw.survey, already wraps ITS call to
    // CsDraw.profile in the try/catch that turns this into a reported
    // "profile pass failed" outcome; catching it a second time here,
    // under a different message, would just make the two paths
    // disagree about what a thrown build/render failure is called).
    var built, counts;
    var drewOk = false;
    try {
        built = CsProfile.build(survey, resolved, {
            exaggeration: settings.exaggeration,
            flatSplayDeg: settings.flatSplayDeg
        });
        counts = CsProfileDraw.render(target.doc, target.di, built, {});
        drewOk = true;
    } finally {
        if (!drewOk && target.offscreen) {
            try { destr(target.di); } catch (eDestr) { /* nicety */ }
        }
    }

    var written = CsProfileFile.commit(target);
    if (!written) {
        return { skipped: true,
            reason: "could not write " + target.path };
    }

    // The outcome is built BEFORE reveal() runs, and returned
    // unconditionally afterward: reveal() already swallows its own
    // openFiles() exception (headless runs have no GUI to open a tab
    // in), but this is a second, independent safety net so a future
    // change to reveal()'s own implementation cannot regress "the file
    // committed successfully" into "the profile pass failed" just
    // because OPENING it in a tab hit a problem -- the file is already
    // safely on disk by this point regardless of what reveal() does.
    var outcome = { path: target.path, created: target.created,
        counts: counts, profile: built };
    // See this function's own \param revealPolicy docblock above: the
    // automatic pass (revealPolicy left at its default) reveals only a
    // brand-new sibling, so it never steals focus on an ordinary plan
    // draw; the manual GenerateProfile command passes "always" so a run
    // against an already-existing-but-unopened sibling still shows the
    // user what it just rebuilt, instead of silently rewriting a file
    // nobody sees.
    var shouldReveal = (revealPolicy === "always") ? true : target.created;
    if (shouldReveal) {
        try {
            CsProfileFile.reveal(target.path);
        } catch (eReveal) {
            // see the comment above: a failed reveal never turns a
            // successful write into a reported failure
        }
    }
    return outcome;
};

/**
 * Deletes everything previously drawn FOR the given stations: their
 * points, labels, LRUD ticks/tips/notes, and shot lines whose BOTH
 * ends are in the set (a tie-in shot from an older survey keeps its
 * line). Its own operation. Entities drawn by pre-tagging builds
 * cannot be found and survive.
 *
 * Ghost geometry on CTRL-RAW goes with its stations too, on either end
 * rather than both -- see the RawShot rule for why the ghost's rule
 * differs from the real leg's.
 *
 * NEVER deletes traced linework (CsBind's LineworkTrip /
 * LineworkStations), whatever else that entity carries -- see the
 * guard at the top of the scan.
 *
 * Off layers (CTRL-HIDDEN, CTRL-RAW) are switched on around the delete:
 * this build refuses deletes there just as it refuses adds, so without
 * that the entities survive and a redraw doubles them.
 *
 * \return number of entities removed
 */
CsDraw.eraseStations = function(doc, stationNames) {
    CsStore.ensureLoaded(doc);
    var inSet = {};
    for (var i = 0; i < stationNames.length; i++) {
        inSet[stationNames[i]] = true;
    }
    // LRUD tip names are <station>.L / .R / .L2 ...; splay names are
    // <station>.<n> (older files tagged the bare station). Both
    // strippers live in CsBind now, so the erase rules and the linework
    // binding index cannot disagree about which station "A3.L2"
    // belongs to -- a disagreement is exactly how a tip point gets
    // orphaned by a redraw.
    var baseOf = CsBind.lrudBase;
    var splayBaseOf = CsBind.splayBase;

    var op = new RAddObjectsOperation();
    op.setText("Replace survey marks");
    var removed = 0;
    var offLayers = [];      // off layers the kill list touches
    var offLayerSeen = {};   // layer name -> is it off (asked once)
    var ids = doc.queryAllEntities(false, false);
    for (i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        // TRACED LINEWORK IS NEVER ERASED. The rules below delete
        // generated geometry so a redraw can replace it -- wall runs
        // included, keyed on WallRunStations. Those are OURS: we can
        // regenerate them from the survey at any time. Linework
        // carrying LineworkTrip / LineworkStations is the USER's hours
        // of tracing, and deleting it is unrecoverable -- there is
        // nothing to regenerate it from. So linework is skipped
        // outright, BEFORE any rule can match it, rather than merely
        // not being named by them: a future edit that "tidies"
        // LineworkStations in alongside WallRunStations has to delete
        // this block to do it, and the test that pins this behavior
        // will catch that.
        if (CsBind.hasLineworkTags(e)) {
            continue;
        }
        var kill = false;
        var v;
        v = CsTags.get(e, "Station");
        if (v !== "" && inSet[v] === true) { kill = true; }
        if (!kill) {
            v = CsTags.get(e, "StationLabel");
            if (v !== "" && inSet[v] === true) { kill = true; }
        }
        if (!kill) {
            v = CsTags.get(e, "LRUDName");
            if (v !== "" && inSet[baseOf(v)] === true) { kill = true; }
        }
        if (!kill) {
            v = CsTags.get(e, "LRUDLine");
            if (v !== "" && inSet[baseOf(v)] === true) { kill = true; }
        }
        if (!kill) {
            v = CsTags.get(e, "LRUDNote");
            if (v !== "" && inSet[v] === true) { kill = true; }
        }
        if (!kill) {
            v = CsTags.get(e, "Splay");
            if (v !== "" && inSet[splayBaseOf(v)] === true) { kill = true; }
        }
        if (!kill) {
            v = CsTags.get(e, "SplayName");
            if (v !== "" && inSet[splayBaseOf(v)] === true) { kill = true; }
        }
        if (!kill) {
            v = CsTags.get(e, "SplayLabel");
            if (v !== "" && inSet[splayBaseOf(v)] === true) { kill = true; }
        }
        if (!kill) {
            v = CsTags.get(e, "NoteLabel");
            if (v !== "" && inSet[v] === true) { kill = true; }
        }
        if (!kill) {
            v = CsTags.get(e, "NoteLeader");
            if (v !== "" && inSet[v] === true) { kill = true; }
        }
        if (!kill) {
            v = CsTags.get(e, "Shot");
            if (v !== "") {
                var ends = v.split("->");
                if (ends.length === 2 && inSet[ends[0]] === true &&
                    inSet[ends[1]] === true) {
                    kill = true;
                }
            }
        }
        if (!kill) {
            // wall runs die when ANY of their stations is redrawn --
            // the redraw regenerates them from the fresh survey
            v = CsTags.get(e, "WallRunStations");
            if (v !== "") {
                var wallNames = v.split("|");
                for (var wi = 0; wi < wallNames.length; wi++) {
                    if (inSet[wallNames[wi]] === true) {
                        kill = true;
                        break;
                    }
                }
            }
        }
        // The as-surveyed ghost on CTRL-RAW. These rules are LAST on
        // purpose: the traced-linework guard at the top of the scan
        // still runs before any of them, so an entity carrying the
        // user's LineworkTrip / LineworkStations is never reached here
        // however it came to be tagged RawShot or RawStation.
        if (!kill) {
            v = CsTags.get(e, "RawStation");
            if (v !== "" && inSet[v] === true) { kill = true; }
        }
        if (!kill) {
            v = CsTags.get(e, "RawShot");
            if (v !== "") {
                // "A1->A2", and EITHER end being replaced replaces the
                // ghost leg -- deliberately not the both-ends rule the
                // real leg lines follow above. A real leg spanning an
                // erased and a kept station is the drawing's only
                // record of that shot, so it has to survive. A ghost
                // leg carries no data at all: it is a picture of where
                // two stations were surveyed, and the redraw
                // regenerates it from the whole reconstructed survey.
                // Keeping it would leave a line pointing at a
                // coordinate that just moved, and then a duplicate
                // beside the fresh one.
                var rawEnds = v.split("->");
                if (inSet[rawEnds[0]] === true ||
                        inSet[rawEnds[rawEnds.length - 1]] === true) {
                    kill = true;
                }
            }
        }
        if (kill) {
            op.deleteObject(e);
            removed++;
            // Which OFF layers this delete has to reach. A DELETE is
            // refused on an off layer exactly as an add is -- the
            // engine says "RTransaction::deleteObject: entity not
            // editable (locked or hidden layer)", drops that object,
            // and lets the rest of the operation land. The entity then
            // survives a redraw that draws a second copy beside it.
            // Collected generically rather than by naming CTRL-RAW and
            // CTRL-HIDDEN, so a future off layer needs no edit here.
            //
            // Locked layers are NOT unlocked: a lock is something the
            // surveyor did on purpose, and quietly working around it to
            // delete their entities is not ours to do. Such an entity
            // survives the erase, which is the honest outcome.
            try {
                var kLayer = doc.getLayerName(e.getLayerId());
                if (offLayerSeen[kLayer] === undefined) {
                    var kl = doc.queryLayer(kLayer);
                    offLayerSeen[kLayer] = (!isNull(kl) && kl.isOff());
                    if (offLayerSeen[kLayer]) {
                        offLayers.push(kLayer);
                    }
                }
            } catch (eLayer) {
                // unreadable layer: the delete simply takes its chances
            }
        }
    }
    if (removed > 0) {
        var di2 = getDocumentInterface();
        // Switch every off layer the kill list touches on around the
        // ONE delete operation, then let withLayerOn put each back.
        // Built inside out so the operation runs with all of them on at
        // once: one operation is still one undo step.
        var applyDeletes = function() {
            di2.applyOperation(op);
        };
        for (var oi = 0; oi < offLayers.length; oi++) {
            applyDeletes = (function(layerName, inner) {
                return function() {
                    CsLayers.withLayerOn(doc, di2, layerName, inner);
                };
            })(offLayers[oi], applyDeletes);
        }
        applyDeletes();
        CsStore.migrate(doc, di2);
    }
    return removed;
};

/**
 * Zooms the focused view to a just-drawn survey's extents -- not
 * autoZoom, which fits ALL entities and leaves a fresh survey a speck
 * beside a template's border. Falls back to autoZoom, then to nothing.
 */
CsDraw.zoomToSurvey = function(survey, resolved) {
    try {
        var minX = null, minY = null, maxX = null, maxY = null;
        for (var name in resolved.stations) {
            if (!resolved.stations.hasOwnProperty(name)) {
                continue;
            }
            var st = resolved.stations[name];
            if (minX === null || st.x < minX) { minX = st.x; }
            if (maxX === null || st.x > maxX) { maxX = st.x; }
            if (minY === null || st.y < minY) { minY = st.y; }
            if (maxY === null || st.y > maxY) { maxY = st.y; }
        }
        if (minX === null) {
            autoZoom();
            return;
        }
        var reach = 0;
        for (var i = 0; i < survey.shots.length; i++) {
            var sh = survey.shots[i];
            var vals = [sh.left, sh.right];
            for (var k = 0; k < vals.length; k++) {
                if (vals[k] !== null && vals[k] !== undefined &&
                    vals[k] > reach) {
                    reach = vals[k];
                }
            }
        }
        var pad = reach + Math.max((maxX - minX), (maxY - minY)) * 0.05 + 1;
        var box = new RBox(new RVector(minX - pad, minY - pad),
            new RVector(maxX + pad, maxY + pad));
        var view = getDocumentInterface().getLastKnownViewWithFocus();
        view.zoomTo(box, 10);
    } catch (e) {
        try {
            autoZoom();
        } catch (e2) {
            // zoom is a nicety
        }
    }
};
