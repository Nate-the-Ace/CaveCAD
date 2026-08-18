// scatter_breakdown.js
// Native QCAD script - runs inside QCAD itself, no Python/ezdxf needed.
//
// HOW TO RUN:
//   Misc > Development > Run Script...  and pick this file.
//   (Or paste the whole thing into Misc > Development > Script Shell.)
//
// WORKFLOW:
//   1. Draw a closed polyline on the BREAKDOWN-BOUNDARY layer around the
//      area where breakdown/collapse should appear.
//   2. Run this script. It finds every closed polyline on that layer in the
//      CURRENTLY OPEN document and fills it with randomly placed, rotated,
//      and scaled SYM_BREAKDOWN / SYM_BREAKDOWN_B / SYM_BREAKDOWN_C block
//      references on the BREAKDOWN layer.
//   3. Adjust the boundary and re-run any time. NOTE: unlike the Python
//      version, this simple form clears ALL existing breakdown blocks
//      (not just ones tied to a specific boundary) before re-scattering -
//      fine if you're working on one pile at a time, but if you have
//      several independent breakdown zones, scatter and finalize one
//      boundary before moving to the next (or say the word and I'll add
//      the same per-boundary XDATA tagging the Python version uses).
//
// This is built from confirmed QCAD forum/API examples but has not been
// run inside an actual QCAD instance - I don't have one to test against
// the way I tested the Python version directly. If something errors,
// paste the exact console message back and I'll fix the call.

include("scripts/EAction.js");
include("scripts/simple.js");

var BOUNDARY_LAYER = "BREAKDOWN-BOUNDARY";
var TARGET_LAYER = "BREAKDOWN";
var VARIANTS = ["SYM_BREAKDOWN", "SYM_BREAKDOWN_B", "SYM_BREAKDOWN_C"];
var DENSITY = 16;        // boulder clusters per 100 sq ft
var SCALE_MIN = 0.7;
var SCALE_MAX = 1.5;
var MIN_SPACING = null;  // null = auto-derive from density

function pointInPolygon(px, py, verts) {
    var n = verts.length;
    var inside = false;
    var x1 = verts[0].x, y1 = verts[0].y;
    for (var i = 1; i <= n; i++) {
        var x2 = verts[i % n].x, y2 = verts[i % n].y;
        if ((y1 > py) !== (y2 > py)) {
            var xInt = (x2 - x1) * (py - y1) / (y2 - y1) + x1;
            if (px < xInt) { inside = !inside; }
        }
        x1 = x2; y1 = y2;
    }
    return inside;
}

function polygonArea(verts) {
    var a = 0;
    var n = verts.length;
    for (var i = 0; i < n; i++) {
        var p1 = verts[i], p2 = verts[(i + 1) % n];
        a += p1.x * p2.y - p2.x * p1.y;
    }
    return Math.abs(a) / 2.0;
}

// Drop a trailing vertex that just duplicates the first (geometrically
// closed polylines often store the closing point explicitly).
function cleanRing(verts) {
    if (verts.length > 1) {
        var first = verts[0], last = verts[verts.length - 1];
        var dx = first.x - last.x, dy = first.y - last.y;
        if (Math.sqrt(dx * dx + dy * dy) < 1e-6) {
            return verts.slice(0, verts.length - 1);
        }
    }
    return verts;
}

function scatterBreakdown() {
    var doc = getDocument();
    if (isNull(doc)) {
        print("ERROR: no open document.");
    } else {
        var di = getDocumentInterface();

        if (!doc.hasLayer(BOUNDARY_LAYER)) {
            print("ERROR: layer '" + BOUNDARY_LAYER + "' not found in this drawing.");
        } else if (!doc.hasLayer(TARGET_LAYER)) {
            print("ERROR: layer '" + TARGET_LAYER + "' not found in this drawing.");
        } else {
            var boundaryLayerId = doc.getLayerId(BOUNDARY_LAYER);
            var targetLayerId = doc.getLayerId(TARGET_LAYER);

            // Collect closed boundary polylines on BREAKDOWN-BOUNDARY
            var polyIds = doc.queryAllEntities(false, false, RS.EntityPolyline);
            var boundaries = [];
            for (var i = 0; i < polyIds.length; i++) {
                var e = doc.queryEntity(polyIds[i]);
                if (isNull(e)) { continue; }
                if (e.getLayerId() !== boundaryLayerId) { continue; }
                if (!e.isGeometricallyClosed()) { continue; }
                boundaries.push(e);
            }
            print("Found " + boundaries.length + " closed boundary polyline(s) on '" +
                  BOUNDARY_LAYER + "'.");

            if (boundaries.length === 0) {
                print("Draw a closed polyline on that layer first, then re-run.");
            } else {
                var op = new RAddObjectsOperation();
                op.setText("Scatter breakdown");

                // Clear all existing breakdown block references before rescattering
                var refIds = doc.queryAllEntities(false, false, RS.EntityBlockRef);
                var removedCount = 0;
                for (var r = 0; r < refIds.length; r++) {
                    var ref = doc.queryEntity(refIds[r]);
                    if (isNull(ref)) { continue; }
                    if (ref.getLayerId() !== targetLayerId) { continue; }
                    op.deleteObject(ref);
                    removedCount++;
                }

                var totalPlaced = 0;
                for (var b = 0; b < boundaries.length; b++) {
                    var poly = boundaries[b];
                    var verts = cleanRing(poly.getData().getVertices());
                    if (verts.length < 3) { continue; }

                    var area = polygonArea(verts);
                    var targetCount = Math.max(1, Math.round(area / 100.0 * DENSITY));
                    var spacing = MIN_SPACING;
                    if (isNull(spacing)) {
                        spacing = Math.max(0.6, Math.sqrt(area / targetCount) * 0.55);
                    }

                    var minx = verts[0].x, maxx = verts[0].x;
                    var miny = verts[0].y, maxy = verts[0].y;
                    for (var v = 1; v < verts.length; v++) {
                        minx = Math.min(minx, verts[v].x);
                        maxx = Math.max(maxx, verts[v].x);
                        miny = Math.min(miny, verts[v].y);
                        maxy = Math.max(maxy, verts[v].y);
                    }

                    var accepted = [];
                    var maxAttempts = Math.max(200, targetCount * 60);
                    var attempts = 0;
                    while (accepted.length < targetCount && attempts < maxAttempts) {
                        attempts++;
                        var px = minx + Math.random() * (maxx - minx);
                        var py = miny + Math.random() * (maxy - miny);
                        if (!pointInPolygon(px, py, verts)) { continue; }
                        var ok = true;
                        for (var k = 0; k < accepted.length; k++) {
                            var dx = px - accepted[k].x, dy = py - accepted[k].y;
                            if (dx * dx + dy * dy < spacing * spacing) { ok = false; break; }
                        }
                        if (ok) { accepted.push(new RVector(px, py)); }
                    }

                    for (var a2 = 0; a2 < accepted.length; a2++) {
                        var variant = VARIANTS[Math.floor(Math.random() * VARIANTS.length)];
                        var block = doc.queryBlock(variant);
                        if (isNull(block)) {
                            print("WARNING: block '" + variant + "' not found - skipping.");
                            continue;
                        }
                        var scale = SCALE_MIN + Math.random() * (SCALE_MAX - SCALE_MIN);
                        var angle = Math.random() * 2 * Math.PI;
                        var bd = new RBlockReferenceData(
                            block.getId(),
                            accepted[a2],
                            new RVector(scale, scale),
                            angle,
                            1, 1, 1, 1
                        );
                        var blockRef = new RBlockReferenceEntity(doc, bd);
                        blockRef.setLayerId(targetLayerId);
                        op.addObject(blockRef);
                    }

                    print("Boundary " + (b + 1) + ": placed " + accepted.length +
                          " boulder clusters (target " + targetCount +
                          ", area " + area.toFixed(1) + " sq ft).");
                    totalPlaced += accepted.length;
                }

                di.applyOperation(op);
                print("Removed " + removedCount + " previous boulder(s), placed " +
                      totalPlaced + " new. Done.");
            }
        }
}
}

// ============================================================
// Addon wiring -- turns the function above into a launchable
// button/menu item/command instead of code that runs immediately
// on load. The scatter logic above is untouched.
// ============================================================

function ScatterBreakdown(guiAction) {
    EAction.call(this, guiAction);
}

ScatterBreakdown.prototype = new EAction();

// Called when the tool is launched from its button, menu item, or
// command. Runs the (unchanged) scatter function once, then terminates.
ScatterBreakdown.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    scatterBreakdown();
    this.terminate();
};

// Called once by QCAD at startup to register the button/menu item.
ScatterBreakdown.init = function(basePath) {
    var action = new RGuiAction(qsTr("Scatter Breakdown"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/ScatterBreakdown.js");
    action.setIcon(basePath + "/ScatterBreakdown.svg");
    action.setStatusTip(qsTr("Fill closed BREAKDOWN-BOUNDARY polylines with randomized breakdown/collapse symbols"));
    action.setDefaultCommands(["scatterbreakdown", "scb"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(40);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
