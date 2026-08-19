// ScatterBreakdown.js
//
// QCAD add-on tool: fill closed BREAKDOWN-BOUNDARY polylines with
// randomly placed, rotated and scaled breakdown symbols.
//
// WHAT CHANGED FROM THE OLD GENERATION: scattering is PER BOUNDARY.
// Every placed block is tagged with the id of the boundary that owns
// it, and re-running clears and refills only the boundaries it
// processes -- several independent breakdown zones no longer destroy
// each other. One undo step.
//
// WORKFLOW:
//   1. Draw a closed polyline on BREAKDOWN-BOUNDARY around the area.
//   2. Run this tool (select specific boundaries first to do only
//      those; no selection = all closed boundaries on the layer).
//   3. Adjust the boundary and re-run any time.
//
// Uses the SYM_BREAKDOWN / _B / _C blocks from the NSS template.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/All.js");

// ---- tunables --------------------------------------------------------

var SB_VARIANTS = ["SYM_BREAKDOWN", "SYM_BREAKDOWN_B", "SYM_BREAKDOWN_C"];
var SB_DENSITY = 16;       // boulder clusters per 100 sq drawing units
var SB_SCALE_MIN = 0.7;
var SB_SCALE_MAX = 1.5;

// ---- geometry helpers (pure) ------------------------------------------

function sbPointInPolygon(px, py, verts) {
    var n = verts.length;
    var inside = false;
    var x1 = verts[0].x, y1 = verts[0].y;
    for (var i = 1; i <= n; i++) {
        var x2 = verts[i % n].x, y2 = verts[i % n].y;
        if ((y1 > py) !== (y2 > py)) {
            var xInt = (x2 - x1) * (py - y1) / (y2 - y1) + x1;
            if (px < xInt) {
                inside = !inside;
            }
        }
        x1 = x2;
        y1 = y2;
    }
    return inside;
}

function sbPolygonArea(verts) {
    var a = 0;
    for (var i = 0; i < verts.length; i++) {
        var p1 = verts[i], p2 = verts[(i + 1) % verts.length];
        a += p1.x * p2.y - p2.x * p1.y;
    }
    return Math.abs(a) / 2.0;
}

// closed polylines often store the closing vertex explicitly
function sbCleanRing(verts) {
    if (verts.length > 1) {
        var first = verts[0], last = verts[verts.length - 1];
        var dx = first.x - last.x, dy = first.y - last.y;
        if (Math.sqrt(dx * dx + dy * dy) < 1e-6) {
            return verts.slice(0, verts.length - 1);
        }
    }
    return verts;
}

// ---- main --------------------------------------------------------------

function scatterBreakdownRun() {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        warning("Scatter Breakdown: no active drawing document.");
        return;
    }
    var di = getDocumentInterface();

    if (!doc.hasLayer(CsLayers.BREAKDOWN_BOUNDARY)) {
        warning("Scatter Breakdown: draw a closed polyline on the " +
            CsLayers.BREAKDOWN_BOUNDARY + " layer around the breakdown " +
            "area first.");
        return;
    }
    CsLayers.ensure(CsLayers.BREAKDOWN);

    var boundaryLayerId = doc.getLayerId(CsLayers.BREAKDOWN_BOUNDARY);
    var targetLayerId = doc.getLayerId(CsLayers.BREAKDOWN);

    // Selected boundaries only, if any are selected; else every closed
    // boundary on the layer.
    var selectedIds = doc.hasSelection() ? doc.querySelectedEntities() : [];
    var candidateIds = selectedIds.length > 0 ?
        selectedIds : doc.queryAllEntities(false, false, RS.EntityPolyline);

    var boundaries = [];
    for (var i = 0; i < candidateIds.length; i++) {
        var e = doc.queryEntity(candidateIds[i]);
        if (isNull(e) || e.getLayerId() !== boundaryLayerId) {
            continue;
        }
        if (typeof e.isGeometricallyClosed !== "function" ||
            !e.isGeometricallyClosed()) {
            continue;
        }
        boundaries.push(e);
    }

    if (boundaries.length === 0) {
        warning("Scatter Breakdown: no closed polylines found on " +
            CsLayers.BREAKDOWN_BOUNDARY +
            (selectedIds.length > 0 ? " in the selection." : "."));
        return;
    }

    var op = new RAddObjectsOperation();
    op.setText("Scatter breakdown");

    // Collect the boundary ids being redone, then clear only THEIR
    // previous blocks (tagged CaveSurvey/BoundaryId).
    var redoIds = {};
    for (i = 0; i < boundaries.length; i++) {
        redoIds[String(boundaries[i].getId())] = true;
    }
    var refIds = doc.queryAllEntities(false, false, RS.EntityBlockRef);
    var removed = 0;
    for (i = 0; i < refIds.length; i++) {
        var ref = doc.queryEntity(refIds[i]);
        if (isNull(ref) || ref.getLayerId() !== targetLayerId) {
            continue;
        }
        var owner = CsTags.get(ref, "BoundaryId");
        // untagged blocks (old generation) are treated as owned by
        // whichever boundary contains them, so re-running cleans up
        // legacy scatters too
        if (owner === "") {
            var pos = ref.getPosition();
            for (var b = 0; b < boundaries.length; b++) {
                var ring = sbCleanRing(boundaries[b].getData().getVertices());
                if (sbPointInPolygon(pos.x, pos.y, ring)) {
                    owner = String(boundaries[b].getId());
                    break;
                }
            }
        }
        if (redoIds[owner] === true) {
            op.deleteObject(ref);
            removed++;
        }
    }

    var totalPlaced = 0;
    var missingBlocks = false;

    for (b = 0; b < boundaries.length; b++) {
        var poly = boundaries[b];
        var verts = sbCleanRing(poly.getData().getVertices());
        if (verts.length < 3) {
            continue;
        }

        var area = sbPolygonArea(verts);
        var targetCount = Math.max(1, Math.round(area / 100.0 * SB_DENSITY));
        var spacing = Math.max(0.6, Math.sqrt(area / targetCount) * 0.55);

        var minx = verts[0].x, maxx = verts[0].x;
        var miny = verts[0].y, maxy = verts[0].y;
        for (var v = 1; v < verts.length; v++) {
            minx = Math.min(minx, verts[v].x);
            maxx = Math.max(maxx, verts[v].x);
            miny = Math.min(miny, verts[v].y);
            maxy = Math.max(maxy, verts[v].y);
        }

        var accepted = [];
        var attempts = 0;
        var maxAttempts = Math.max(200, targetCount * 60);
        while (accepted.length < targetCount && attempts < maxAttempts) {
            attempts++;
            var px = minx + Math.random() * (maxx - minx);
            var py = miny + Math.random() * (maxy - miny);
            if (!sbPointInPolygon(px, py, verts)) {
                continue;
            }
            var okSpacing = true;
            for (var k = 0; k < accepted.length; k++) {
                var ddx = px - accepted[k].x, ddy = py - accepted[k].y;
                if (ddx * ddx + ddy * ddy < spacing * spacing) {
                    okSpacing = false;
                    break;
                }
            }
            if (okSpacing) {
                accepted.push(new RVector(px, py));
            }
        }

        for (k = 0; k < accepted.length; k++) {
            var variant = SB_VARIANTS[Math.floor(Math.random() * SB_VARIANTS.length)];
            var entry = CsSymbols.byBlock(variant);
            var scale = SB_SCALE_MIN + Math.random() * (SB_SCALE_MAX - SB_SCALE_MIN);
            var angle = Math.random() * 2 * Math.PI;
            var blockRef = CsSymbols.insert(doc, entry, accepted[k], scale, angle);
            if (blockRef === null) {
                missingBlocks = true;
                continue;
            }
            CsTags.set(blockRef, "BoundaryId", String(poly.getId()));
            op.addObject(blockRef, false);
            totalPlaced++;
        }
    }

    di.applyOperation(op);

    var msg = "Scatter Breakdown: " + boundaries.length + " boundar" +
        (boundaries.length === 1 ? "y" : "ies") + ", " + totalPlaced +
        " boulders placed" +
        (removed > 0 ? " (" + removed + " previous cleared from those boundaries only)" : "") +
        ". Other breakdown zones were not touched.";
    if (missingBlocks) {
        msg += " NOTE: the SYM_BREAKDOWN blocks are missing from this " +
            "drawing -- start from the NSS template to get them.";
    }
    EAction.handleUserMessage(msg);
}

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

function ScatterBreakdown(guiAction) {
    EAction.call(this, guiAction);
}

ScatterBreakdown.prototype = new EAction();

ScatterBreakdown.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    scatterBreakdownRun();
    this.terminate();
};

ScatterBreakdown.init = function(basePath) {
    var action = new RGuiAction(qsTr("Scatter Breakdown"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/ScatterBreakdown.js");
    action.setIcon(basePath + "/ScatterBreakdown.svg");
    action.setStatusTip(qsTr("Fill closed BREAKDOWN-BOUNDARY polylines with breakdown symbols, one zone at a time"));
    action.setDefaultCommands(["scatterbreakdown", "scb"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(40);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
