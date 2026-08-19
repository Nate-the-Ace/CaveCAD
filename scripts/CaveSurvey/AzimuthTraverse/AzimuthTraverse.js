// AzimuthTraverse.js
//
// QCAD add-on tool: plot a survey traverse one shot at a time from
// typed azimuth, distance, inclination and LRUD -- the classic
// notebook-to-drawing workflow, for people who prefer entering shots
// interactively. (The Survey Notebook panel does the same job as an
// editable table; both share the same Core math and draw the same
// tagged entities.)
//
// USAGE:
//   OPTIONAL: select a station point (or a line/arc endpoint) first
//   to continue an existing traverse from it. A tagged station's name
//   is picked up automatically and no duplicate marker is drawn.
//
//   Cave Survey > Azimuth Traverse   (or type "azt")
//
//   For each shot: name for the new station (pre-filled by
//   incrementing the previous name), then Azimuth, Distance,
//   Inclination, Left, Right, Up, Down. Cancel on Azimuth or
//   Distance ends the traverse; Cancel on any LRUD prompt records
//   "not measured" for that field and carries on.
//
// CONVENTIONS (suite-wide, see README):
//   Azimuth clockwise from north; distance is SLOPE distance (plan
//   projection and rise are computed -- this is what a tape stretched
//   along a shot measures); L/R face the direction of travel; LRUD
//   belongs to the TO station. The very first station of a NEW
//   traverse is asked its LRUD right after the first shot's azimuth,
//   since nothing else would ever capture it.
//
// Each shot is one undo step. Layers and tagging are the suite's
// standard (see Core/Layers.js and Core/Tags.js).

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

function azimuthTraverseRun() {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        warning("Azimuth Traverse: no active drawing document.");
        return;
    }

    var TITLE = "Azimuth Traverse";

    // ---- starting point ------------------------------------------
    var sel = CsPick.startPointFromSelection(doc, TITLE);
    var current, startName;
    var startExists = false;

    if (sel !== undefined && sel.isExistingStation) {
        current = sel.pos;
        startExists = true;
        if (sel.existingName !== "") {
            startName = sel.existingName;
            EAction.handleUserMessage(TITLE + ": continuing from station \"" +
                startName + "\".");
        } else {
            startName = getText(TITLE, "Name for the starting station:", "A1");
            if (startName === undefined) {
                startName = "";
            }
        }
    } else if (sel !== undefined) {
        current = sel.pos;
        startName = getText(TITLE, "Name for the starting station:", "A1");
        if (startName === undefined) {
            startName = "";
        }
    } else {
        startName = getText(TITLE, "Name for the starting station:", "A1");
        if (startName === undefined) {
            startName = "";
        }
        var startX = getDouble(TITLE, "Start point X:", 0.0, 6);
        if (startX === undefined) {
            return;
        }
        var startY = getDouble(TITLE, "Start point Y:", 0.0, 6);
        if (startY === undefined) {
            return;
        }
        current = new RVector(startX, startY);
    }

    var di = getDocumentInterface();
    CsLayers.ensureSurveyLayers(doc, di);

    var seq = CsTags.collectStations(doc).length; // continue Seq numbering
    var startPoint;
    if (!startExists) {
        var opStart = new RAddObjectsOperation();
        opStart.setText("Start station");
        startPoint = CsDraw.station(doc, opStart, current,
            { name: startName, seq: seq, z: 0.0 });
        di.applyOperation(opStart);
        seq++;
    }

    var currentName = startName;
    var currentZ = 0.0;
    var count = 0;

    // "not measured" helper: Cancel means null, never 0
    var askLrud = function(label, what) {
        var v = getDouble(TITLE, label + "\n" + what +
            " (Cancel = not measured):", 0.0, 4, 0, 1000000000);
        return (v === undefined) ? null : v;
    };

    while (true) {
        var fromLabel = currentName !== "" ? currentName :
            ("(" + current.x.toFixed(2) + ", " + current.y.toFixed(2) + ")");

        var toName = getText(TITLE,
            "From " + fromLabel + " -- name for the new station:",
            CsModel.nextStationName(currentName));
        if (toName === undefined) {
            toName = "";
        }
        var shotLabel = fromLabel + " -> " + (toName !== "" ? toName : "?");

        var azimuth = getDouble(TITLE,
            shotLabel + "\nAzimuth (deg, 0 = North, clockwise):",
            0.0, 4, -360000, 360000);
        if (azimuth === undefined) {
            break;
        }
        azimuth = CsAngles.normalizeAzimuth(azimuth);

        // First station of a NEW traverse: capture its LRUD now, using
        // this first azimuth as the direction reference.
        if (count === 0 && !startExists) {
            var sl = askLrud("Start station " + fromLabel, "Left");
            var sr = askLrud("Start station " + fromLabel, "Right");
            var su = askLrud("Start station " + fromLabel, "Up");
            var sd = askLrud("Start station " + fromLabel, "Down");
            var opLrud = new RAddObjectsOperation();
            opLrud.setText("Start station LRUD");
            CsDraw.lrud(doc, opLrud, current, startName, azimuth, sl, sr, su, sd);
            di.applyOperation(opLrud);
            if (startPoint !== undefined) {
                // startPoint is already in the document: commit the
                // LRUD tags through a modify operation
                CsTags.commit(di, startPoint, { Azimuth: azimuth,
                    Left: sl, Right: sr, Up: su, Down: sd });
            }
        }

        var distance = getDouble(TITLE, shotLabel +
            "\nDistance (slope -- along the tape):", 0.0, 4, 0, 1000000000);
        if (distance === undefined || distance === 0) {
            break;
        }

        var inclination = getDouble(TITLE,
            shotLabel + "\nInclination (deg, + up / - down):",
            0.0, 4, -90, 90);
        if (inclination === undefined) {
            inclination = 0.0;
        }

        var left = askLrud(shotLabel, "Left");
        var right = askLrud(shotLabel, "Right");
        var up = askLrud(shotLabel, "Up");
        var down = askLrud(shotLabel, "Down");

        var o = CsTraverse.offset({ distance: distance, azimuth: azimuth,
            inclination: inclination }, CsTraverse.SLOPE);
        var next = new RVector(current.x + o.dx, current.y + o.dy);
        var nextZ = currentZ + o.dz;

        // one undo step per shot
        var opShot = new RAddObjectsOperation();
        opShot.setText("Survey shot");
        CsDraw.shotLine(doc, opShot, current, next, currentName, toName);
        CsDraw.lrud(doc, opShot, next, toName, azimuth, left, right, up, down);
        CsDraw.station(doc, opShot, next, { name: toName, seq: seq,
            azimuth: azimuth, inclination: inclination, left: left,
            right: right, up: up, down: down, z: nextZ });
        di.applyOperation(opShot);

        seq++;
        current = next;
        currentName = toName;
        currentZ = nextZ;
        count++;
    }

    if (count > 0) {
        autoZoom();
        EAction.handleUserMessage(TITLE + ": " + count + " shot" +
            (count === 1 ? "" : "s") + " plotted, ending at " +
            (currentName !== "" ? currentName : "an unnamed station") +
            (Math.abs(currentZ) > 1e-6 ?
                " (elevation " + currentZ.toFixed(1) + ")" : "") + ".");
    }
}

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

function AzimuthTraverse(guiAction) {
    EAction.call(this, guiAction);
}

AzimuthTraverse.prototype = new EAction();

AzimuthTraverse.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    azimuthTraverseRun();
    this.terminate();
};

AzimuthTraverse.init = function(basePath) {
    var action = new RGuiAction(qsTr("Azimuth Traverse"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/AzimuthTraverse.js");
    action.setIcon(basePath + "/AzimuthTraverse.svg");
    action.setStatusTip(qsTr("Plot a traverse shot by shot from azimuth, distance, inclination and LRUD"));
    action.setDefaultCommands(["azimuthtraverse", "azt"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(10);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
