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

/** One text entity, layered and tagged, into the op. */
CsDraw.addText = function(doc, op, layerName, text, pos, halign, tagKey, tagValue) {
    var data = new RTextData(pos, pos, CsDraw.TEXT_HEIGHT, 100.0,
        RS.VAlignMiddle, halign, RS.LeftToRight, RS.Exact,
        1.0, text, "standard", false, false, 0.0, false);
    var entity = new RTextEntity(doc, data);
    entity.setLayerId(doc.getLayerId(layerName));
    if (tagKey !== undefined && tagValue !== undefined && tagValue !== "") {
        CsTags.set(entity, tagKey, tagValue);
    }
    op.addObject(entity, false);
    return entity;
};

/** One line, layered and tagged, into the op. */
CsDraw.addLine = function(doc, op, layerName, from, to, tagKey, tagValue) {
    var entity = new RLineEntity(doc, new RLineData(from, to));
    entity.setLayerId(doc.getLayerId(layerName));
    if (tagKey !== undefined && tagValue !== undefined && tagValue !== "") {
        CsTags.set(entity, tagKey, tagValue);
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

/** One centerline shot line on CTRL-SHOTS, tagged with its endpoints. */
CsDraw.shotLine = function(doc, op, fromPos, toPos, fromName, toName) {
    var tag = (fromName !== undefined && toName !== undefined &&
        fromName !== "" && toName !== "") ? (fromName + "->" + toName) : "";
    return CsDraw.addLine(doc, op, CsLayers.SHOTS, fromPos, toPos,
        "Shot", tag);
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
 * Draws a whole resolved survey as ONE operation (one undo step):
 * stations, labels, shot lines, LRUD, all layered and tagged.
 *
 * \return {stationsDrawn, shotsDrawn, closuresDrawn, skipped}
 */
CsDraw.survey = function(survey, resolved, originStation, originPos, seqBase) {
    if (seqBase === undefined || seqBase === null) {
        seqBase = 0;
    }
    var doc = getDocument();
    var di = getDocumentInterface();
    CsLayers.ensureSurveyLayers(doc, di);

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

    var shotsDrawn = 0, closuresDrawn = 0;
    for (i = 0; i < resolved.legs.length; i++) {
        var leg = resolved.legs[i];
        if (leg.shot.excludeFromPlot) {
            continue;
        }
        CsDraw.shotLine(doc, op, at(leg.from), at(leg.to), leg.from, leg.to);
        if (leg.kind === "closure") {
            closuresDrawn++;
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
    var splayCounts = {};
    for (i = 0; i < survey.shots.length; i++) {
        var sp = survey.shots[i];
        if (!sp.splay || sp.excludeFromAll || sp.excludeFromPlot) {
            continue;
        }
        if (!resolved.stations.hasOwnProperty(sp.from)) {
            continue; // its station never connected -- stays skipped
        }
        splayCounts[sp.from] = (splayCounts[sp.from] || 0) + 1;
        var splayName = sp.from + "." + splayCounts[sp.from];
        var so = CsTraverse.offset(sp, CsTraverse.SLOPE);
        var sPos = at(sp.from);
        var sEnd = new RVector(sPos.x + so.dx, sPos.y + so.dy);
        CsDraw.addLine(doc, op, CsLayers.SPLAYS, sPos, sEnd,
            "Splay", splayName);
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

    if (firstPoint !== undefined) {
        // Restores this tag's pre-trip-split meaning: the drawing-level
        // cave name when known, falling back to the trip name for
        // formats with no separate cave-name concept.
        CsTags.set(firstPoint, "SurveyName", survey.caveName || survey.name);
        CsTags.set(firstPoint, "SurveyDate", survey.date);
        CsTags.set(firstPoint, "SurveyTeam", survey.team);
        CsTags.set(firstPoint, "Declination", survey.declination);
        CsTags.set(firstPoint, "DeclinationSource", survey.declinationSource);
        CsTags.set(firstPoint, "DistanceUnit", survey.distanceUnit);
    }

    di.applyOperation(op);
    CsStore.migrate(doc, di); // convert + drop a legacy store, if any

    return {
        stationsDrawn: stationsDrawn,
        shotsDrawn: shotsDrawn,
        closuresDrawn: closuresDrawn,
        wallsDrawn: wallsDrawn,
        splaysDrawn: splaysDrawn,
        // splays that DID draw no longer count as skipped
        skipped: resolved.skipped.length - splaysDrawn
    };
};

/**
 * Deletes everything previously drawn FOR the given stations: their
 * points, labels, LRUD ticks/tips/notes, and shot lines whose BOTH
 * ends are in the set (a tie-in shot from an older survey keeps its
 * line). Its own operation. Entities drawn by pre-tagging builds
 * cannot be found and survive.
 *
 * \return number of entities removed
 */
CsDraw.eraseStations = function(doc, stationNames) {
    CsStore.ensureLoaded(doc);
    var inSet = {};
    for (var i = 0; i < stationNames.length; i++) {
        inSet[stationNames[i]] = true;
    }
    var baseOf = function(tagged) {
        var m = /^(.*)\.([LR])$/.exec(tagged);
        return m === null ? tagged : m[1];
    };
    // splay names are <station>.<n>; older files tagged the bare station
    var splayBaseOf = function(tagged) {
        var m = /^(.*)\.(\d+)$/.exec(tagged);
        return m === null ? tagged : m[1];
    };

    var op = new RAddObjectsOperation();
    op.setText("Replace survey marks");
    var removed = 0;
    var ids = doc.queryAllEntities(false, false);
    for (i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
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
        if (kill) {
            op.deleteObject(e);
            removed++;
        }
    }
    if (removed > 0) {
        var di2 = getDocumentInterface();
        di2.applyOperation(op);
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
