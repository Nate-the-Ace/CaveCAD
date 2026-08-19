// RebuildSurveyData.js
//
// QCAD add-on tool: recover survey data for LEGACY drawings -- ones
// drawn before the survey data store existed (or whose tags were
// lost by any pre-store save; this QCAD build never wrote custom
// properties to disk, so that is every drawing saved before the
// store shipped).
//
// WHAT IT DOES: walks the geometry the old builds left behind --
// POINT entities on CTRL-STATIONS with a name label on
// CTRL-STATION-LABELS beside them, LRUD tip points on CTRL-LRUD near
// their station -- re-derives each station's name, order and LRUD
// names, re-tags everything, and writes the survey data store. After
// one run, tie-ins, replace-on-draw, LRUD Walls and Survey Stats work
// on the old drawing again.
//
// HONEST LIMITS: what geometry does not carry cannot be recovered --
// azimuth, inclination and numeric LRUD readings of legacy shots are
// gone (positions remain, so plotting and tie-ins are exact). Station
// order (Seq) is estimated by walking the shot lines from the first
// point; branch order may differ from the original notes.
//
// Safe to re-run; already-tagged stations are left as they are.
//
// USAGE:
//   Cave Survey > Rebuild Survey Data   (or type "rsd")

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

function rebuildSurveyDataRun() {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        warning("Rebuild Survey Data: no active drawing document.");
        return;
    }
    var di = getDocumentInterface();
    CsStore.ensureLoaded(doc);

    var LABEL_RADIUS = CsDraw.TEXT_HEIGHT * 6;   // label sits ~0.75 from point
    var LRUD_RADIUS = 1000000;                    // tips matched to NEAREST station

    if (!doc.hasLayer(CsLayers.STATIONS)) {
        warning("Rebuild Survey Data: no " + CsLayers.STATIONS +
            " layer -- nothing to recover.");
        return;
    }

    // ---- gather geometry -------------------------------------------
    var stationPts = [];   // {entity, pos, tagged}
    var labels = [];       // {pos, text}
    var lrudTips = [];     // {entity, pos, tagged}
    var shotLines = [];    // {a, b}

    var stLayer = doc.getLayerId(CsLayers.STATIONS);
    var lbLayer = doc.hasLayer(CsLayers.STATION_LABELS) ?
        doc.getLayerId(CsLayers.STATION_LABELS) : -1;
    var lrLayer = doc.hasLayer(CsLayers.LRUD) ?
        doc.getLayerId(CsLayers.LRUD) : -1;
    var shLayer = doc.hasLayer(CsLayers.SHOTS) ?
        doc.getLayerId(CsLayers.SHOTS) : -1;

    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var lid = e.getLayerId();
        if (lid === stLayer && typeof e.getPosition === "function") {
            stationPts.push({ entity: e, pos: e.getPosition(),
                tagged: CsTags.get(e, "Station") !== "" });
        } else if (lid === lbLayer && typeof e.getPlainText === "function" &&
                typeof e.getPosition === "function") {
            var t = String(e.getPlainText());
            if (t.indexOf("U") === 0 && t.indexOf(" D") > 0) {
                continue; // a U/D note, not a name
            }
            labels.push({ pos: e.getPosition(),
                text: t.replace(/\s*\(Z[^)]*\)\s*$/, "") });
        } else if (lid === lrLayer && typeof e.getPosition === "function" &&
                e.getType() === RS.EntityPoint) {
            lrudTips.push({ entity: e, pos: e.getPosition(),
                tagged: CsTags.get(e, "LRUDName") !== "" });
        } else if (lid === shLayer &&
                typeof e.getStartPoint === "function" &&
                typeof e.getEndPoint === "function") {
            shotLines.push({ a: e.getStartPoint(), b: e.getEndPoint(),
                entity: e });
        }
    }

    if (stationPts.length === 0) {
        warning("Rebuild Survey Data: no station points found on " +
            CsLayers.STATIONS + ".");
        return;
    }

    var dist = function(p, q) {
        var dx = p.x - q.x, dy = p.y - q.y;
        return Math.sqrt(dx * dx + dy * dy);
    };

    // ---- name each untagged station from its nearest label ----------
    var renamed = 0;
    for (i = 0; i < stationPts.length; i++) {
        var sp = stationPts[i];
        if (sp.tagged) {
            sp.name = CsTags.get(sp.entity, "Station");
            continue;
        }
        var best = null, bestD = LABEL_RADIUS;
        for (var k = 0; k < labels.length; k++) {
            var d = dist(sp.pos, labels[k].pos);
            if (d < bestD) {
                bestD = d;
                best = labels[k];
            }
        }
        if (best !== null) {
            sp.name = best.text;
            renamed++;
        } else {
            sp.name = "";
        }
    }

    // ---- order: walk the shot lines from the first station ----------
    // seed order = existing Seq tags first, then walk connectivity
    var seq = 0;
    var placed = {};
    for (i = 0; i < stationPts.length; i++) {
        if (stationPts[i].tagged) {
            seq = Math.max(seq,
                (CsTags.getNumber(stationPts[i].entity, "Seq") || 0) + 1);
        }
    }
    var nearStation = function(p) {
        for (var s = 0; s < stationPts.length; s++) {
            if (dist(stationPts[s].pos, p) < 1e-4) {
                return s;
            }
        }
        return -1;
    };
    // breadth-first over shot lines starting at the first unplaced pt
    var queue = [];
    for (i = 0; i < stationPts.length; i++) {
        if (!stationPts[i].tagged && stationPts[i].name !== "" &&
            placed[i] === undefined) {
            queue.push(i);
            while (queue.length > 0) {
                var cur = queue.shift();
                if (placed[cur] !== undefined) {
                    continue;
                }
                placed[cur] = seq++;
                for (var L = 0; L < shotLines.length; L++) {
                    var na = nearStation(shotLines[L].a);
                    var nb = nearStation(shotLines[L].b);
                    if (na === cur && nb >= 0 && placed[nb] === undefined) {
                        queue.push(nb);
                    }
                    if (nb === cur && na >= 0 && placed[na] === undefined) {
                        queue.push(na);
                    }
                }
            }
        }
    }

    // ---- commit station tags -----------------------------------------
    var op = new RModifyObjectsOperation();
    op.setText("Rebuild survey data");
    var tagsWritten = 0;
    for (i = 0; i < stationPts.length; i++) {
        var st = stationPts[i];
        if (st.tagged || st.name === "") {
            continue;
        }
        CsTags.set(st.entity, "Station", st.name);
        CsTags.set(st.entity, "Seq", placed[i] !== undefined ? placed[i] : seq++);
        op.addObject(st.entity, false);
        tagsWritten++;
    }

    // ---- LRUD tips: nearest named station gets the credit -------------
    var lrudNamed = 0;
    for (i = 0; i < lrudTips.length; i++) {
        var tip = lrudTips[i];
        if (tip.tagged) {
            continue;
        }
        var bestS = null, bestSD = LRUD_RADIUS;
        for (k = 0; k < stationPts.length; k++) {
            if (stationPts[k].name === "") {
                continue;
            }
            var d2 = dist(tip.pos, stationPts[k].pos);
            if (d2 < bestSD) {
                bestSD = d2;
                bestS = stationPts[k];
            }
        }
        if (bestS !== null && bestSD > 1e-6) {
            // side: which side of the incoming direction? Unknowable
            // without the shot azimuth -- record as L/R by x-offset
            // sign relative to the station as a stable convention.
            var side = (tip.pos.x < bestS.pos.x) ? "L" : "R";
            CsTags.set(tip.entity, "LRUDName", bestS.name + "." + side);
            op.addObject(tip.entity, false);
            lrudNamed++;
        }
    }

    if (tagsWritten === 0 && lrudNamed === 0) {
        EAction.handleUserMessage("Rebuild Survey Data: nothing to do -- " +
            "every station already carries its data.");
        return;
    }

    di.applyOperation(op);
    CsStore.sync(doc, di);

    QMessageBox.information(getMainWindow(), "Rebuild Survey Data",
        "Recovered " + tagsWritten + " station" +
        (tagsWritten === 1 ? "" : "s") + " and " + lrudNamed +
        " LRUD point" + (lrudNamed === 1 ? "" : "s") +
        " from the drawing's geometry, and wrote the survey data " +
        "store.\n\nTie-ins, redraw-replace, LRUD Walls and Survey " +
        "Stats now work on this drawing. What geometry doesn't carry " +
        "-- legacy azimuth/inclination readings and numeric LRUD -- " +
        "could not be recovered; positions are exact.");
}

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

function RebuildSurveyData(guiAction) {
    EAction.call(this, guiAction);
}

RebuildSurveyData.prototype = new EAction();

RebuildSurveyData.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    rebuildSurveyDataRun();
    this.terminate();
};

RebuildSurveyData.init = function(basePath) {
    var action = new RGuiAction(qsTr("Rebuild Survey Data"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/RebuildSurveyData.js");
    action.setIcon(basePath + "/RebuildSurveyData.svg");
    action.setStatusTip(qsTr("Recover station names, order and LRUD links on a drawing saved by older builds"));
    action.setDefaultCommands(["rebuildsurveydata", "rsd"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(85);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
