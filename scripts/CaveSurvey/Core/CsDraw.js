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
        var pt = CsDraw.station(doc, op, at(name), {
            name: name,
            seq: resolved.stations[name].seq + seqBase,
            azimuth: lrud !== null ? lrud.azimuth : undefined,
            left: lrud !== null ? lrud.left : undefined,
            right: lrud !== null ? lrud.right : undefined,
            up: lrud !== null ? lrud.up : undefined,
            down: lrud !== null ? lrud.down : undefined,
            z: resolved.stations[name].z,
            note: noteFor[name] !== undefined ? noteFor[name] :
                (i === 0 ? survey.startNote : undefined)
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

    if (firstPoint !== undefined) {
        CsTags.set(firstPoint, "SurveyName", survey.name);
        CsTags.set(firstPoint, "SurveyDate", survey.date);
        CsTags.set(firstPoint, "SurveyTeam", survey.team);
        CsTags.set(firstPoint, "Declination", survey.declination);
        CsTags.set(firstPoint, "DeclinationSource", survey.declinationSource);
        CsTags.set(firstPoint, "DistanceUnit", survey.distanceUnit);
    }

    di.applyOperation(op);
    CsStore.sync(doc, di); // tags only persist through the store

    return {
        stationsDrawn: stationsDrawn,
        shotsDrawn: shotsDrawn,
        closuresDrawn: closuresDrawn,
        skipped: resolved.skipped.length
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
            v = CsTags.get(e, "Shot");
            if (v !== "") {
                var ends = v.split("->");
                if (ends.length === 2 && inSet[ends[0]] === true &&
                    inSet[ends[1]] === true) {
                    kill = true;
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
        CsStore.sync(doc, di2);
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
