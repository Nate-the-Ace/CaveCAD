// SurfaceContours.js
//
// QCAD add-on tool: fetch USGS 3DEP elevation for the ground over the
// survey and draw surface contour lines, georeferenced from the
// drawing's entrance anchor -- the surface topo over the cave, the way
// a Civil3D surface drops contours over an alignment.
//
// Same pipeline as Aerial Basemap, same anchor, same window math
// (Core/CsGeoProject.js), same curl fetch. What differs: the payload is
// a 32-bit float GeoTIFF (elevations in metres, NAVD88), read through
// the bridge's one faithful binary path (QTextStream + Latin1 -- see
// Core/CsContour.js's header) and turned into polylines by marching
// squares in Core/CsContour.js, where the headless harness tests it.
//
// The elevation grid is a TEMPORARY file: contours are vectors in the
// drawing; once they are drawn the grid has nothing left to say, and
// -- per the project's entrance-location rule -- a georeferenced
// raster is not left lying around the cave folder.
//
// Re-running replaces the previous contours: every entity is tagged
// SurfaceContours=1, and a new run erases the tagged set first. Grow
// the survey, run again, get wider coverage.
//
// USAGE:
//   Cave Survey > Surface Contours   (or "surfacecontours" / "sc")
//
// Labels are the contour's elevation in the DRAWING'S unit (NAVD88
// datum), on every major (every 5th) contour.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

function surfaceContoursRun() {
    var doc = getDocument();
    var di = getDocumentInterface();
    if (doc === undefined || doc === null) {
        warning("Surface Contours: no active drawing document.");
        return;
    }

    // 1. Resolve the anchor: an existing georeference wins, then the
    //    entrance convention (A1), then a single selected station.
    //    Mirrors AerialBasemap.findAnchor deliberately -- the two tools
    //    must agree about where the ground is.
    var anchor = SurfaceContours.findAnchor(doc);
    if (anchor === null) {
        return;                     // findAnchor already explained why
    }
    if (anchor.lat === null) {
        var coord = CsLocationPick.ask("Surface Contours", "");
        if (coord === null) {
            return;                 // cancelled
        }
        CsTags.commit(di, anchor.entity, {
            GeoLat: coord.lat,
            GeoLon: coord.lon,
            GeoStation: anchor.name !== "" ? anchor.name : "anchor"
        });
        CsLocationPick.remember(coord);
        anchor.lat = coord.lat;
        anchor.lon = coord.lon;
    }

    // 2. Ground window: the survey's extent plus margin, like the
    //    basemap's -- so the contours cover what the photograph covers.
    var unit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
    var box = SurfaceContours.surveyBox(doc, anchor.pos);
    var extent = CsGeoProject.groundExtent(
        { width: box.width, height: box.height }, unit,
        CsGeoProject.MARGIN, CsGeoProject.FLOOR_M);
    var offset = {
        x: CsUnits.convert(box.centerX - anchor.pos.x, unit, CsUnits.METERS),
        y: CsUnits.convert(box.centerY - anchor.pos.y, unit, CsUnits.METERS)
    };
    var bbox = CsGeoProject.mercatorBbox(anchor.lat, anchor.lon,
        extent, offset);
    var size = CsGeoProject.pixelSize(bbox, CsGeoProject.DEM_NATIVE_RES_M,
        CsGeoProject.DEM_MAX_PX, CsGeoProject.DEM_MIN_PX);

    // 3. The contour interval, in the drawing's unit.
    var interval = SurfaceContours.askInterval(unit);
    if (interval === null) {
        return;                     // cancelled
    }

    // 4. Fetch the elevation grid to a TEMPORARY file.
    var demPath = QDir.tempPath() + "/cavecad-surface-dem.tif";
    var fetched = SurfaceContours.fetch(CsGeoProject.demUrl(bbox, size),
        demPath);
    if (fetched !== true) {
        warning("Surface Contours: the elevation fetch failed.\n" + fetched);
        return;
    }

    // 5. Read and parse it; the temp grid goes away regardless.
    var grid;
    try {
        var bytes = SurfaceContours.readBinary(demPath);
        grid = CsContour.parseFloatTiff(bytes);
    } catch (eParse) {
        QFile.remove(demPath);
        warning("Surface Contours: the service's reply could not be " +
            "read as an elevation grid (" + eParse + "). Try again, or " +
            "a smaller area.");
        return;
    }
    QFile.remove(demPath);

    var range = CsContour.range(grid.values);
    if (range === null) {
        warning("Surface Contours: the service has no elevation data " +
            "here (3DEP covers the United States).");
        return;
    }

    // 6. Levels in drawing units over the grid's own span.
    var minU = CsUnits.convert(range.min, CsUnits.METERS, unit);
    var maxU = CsUnits.convert(range.max, CsUnits.METERS, unit);
    var levels = CsContour.levels(minU, maxU, interval);
    if (levels.length === 0) {
        warning("Surface Contours: the ground here only spans " +
            SurfaceContours.fmt(maxU - minU) + " " + unit +
            ", so no " + SurfaceContours.fmt(interval) + " " + unit +
            " contour crosses it. Try a smaller interval.");
        return;
    }

    // 7. Extract and draw.
    var drawn = SurfaceContours.draw(doc, di, grid, levels, interval,
        bbox, size, anchor, unit);

    // The surface elevation right at the anchor station -- the
    // entrance's ground elevation, the number the lidar thread has
    // always been after. Reported, never written into the survey.
    var at = CsGeoProject.anchorGridCoord(bbox, grid.width, grid.height,
        anchor.lat, anchor.lon);
    var surf = CsContour.sampleAt(grid.values, grid.width, grid.height,
        at.col, at.row);
    var surfLine = "";
    if (surf !== null) {
        surfLine = "\nSurface at " +
            (anchor.name !== "" ? anchor.name : "the anchor") + ": " +
            SurfaceContours.fmt(CsUnits.convert(surf, CsUnits.METERS, unit)) +
            " " + unit + " (NAVD88).";
    }

    QMessageBox.information(getMainWindow(), "Surface Contours",
        "Drew " + drawn.lines + " contour line" +
        (drawn.lines === 1 ? "" : "s") + " at a " +
        SurfaceContours.fmt(interval) + " " + unit + " interval (" +
        levels.length + " level" + (levels.length === 1 ? "" : "s") +
        ", ground " + SurfaceContours.fmt(minU) + " to " +
        SurfaceContours.fmt(maxU) + " " + unit + ")." + surfLine);
}

/** A number without trailing float noise, for messages and labels. */
SurfaceContours.fmt = function(v) {
    var r = Math.round(v * 100) / 100;
    return String(r);
};

/**
 * Same precedence as AerialBasemap.findAnchor: an existing
 * georeference, then station A1, then a single selected station point.
 * Kept separate so each tool explains itself in its own words.
 */
SurfaceContours.findAnchor = function(doc) {
    var stations = CsTags.collectStations(doc);
    var i;
    for (i = 0; i < stations.length; i++) {
        var lat = CsTags.getNumber(stations[i].entity, "GeoLat");
        var lon = CsTags.getNumber(stations[i].entity, "GeoLon");
        if (lat !== null && lon !== null) {
            return { entity: stations[i].entity, name: stations[i].name,
                pos: stations[i].pos, lat: lat, lon: lon };
        }
    }
    for (i = 0; i < stations.length; i++) {
        if (stations[i].name === "A1") {
            return { entity: stations[i].entity, name: "A1",
                pos: stations[i].pos, lat: null, lon: null };
        }
    }
    if (doc.hasSelection()) {
        var selected = CsPick.singleSelected(doc, "Surface Contours");
        if (selected === null) {
            return null;
        }
        if (typeof selected.getPosition !== "function") {
            warning("Surface Contours: the selection isn't a point " +
                "entity.\nSelect one station point, or work in a " +
                "drawing with a station named A1.");
            return null;
        }
        return { entity: selected, name: CsTags.get(selected, "Station"),
            pos: selected.getPosition(), lat: null, lon: null };
    }
    warning("Surface Contours: nothing to anchor the contours to.\n" +
        "This tool needs an existing Geo Reference anchor, a station " +
        "named A1 (the entrance, by convention), or exactly one " +
        "selected station point.");
    return null;
};

/**
 * The cave plan data's extent -- CsDraw.planDataBox, the same box the
 * basemap fetches against, so photo and contours always cover the same
 * ground and neither ever measures the profile region, the sheet
 * furniture or the tools' own previous output.
 */
SurfaceContours.surveyBox = function(doc, anchorPos) {
    var box = CsDraw.planDataBox(doc);
    if (box === null) {
        return { width: 0, height: 0,
            centerX: anchorPos.x, centerY: anchorPos.y };
    }
    return {
        width: box.maxX - box.minX,
        height: box.maxY - box.minY,
        centerX: (box.minX + box.maxX) / 2.0,
        centerY: (box.minY + box.maxY) / 2.0
    };
};

/**
 * The contour interval in drawing units, from a prompt with a sane
 * default per unit (10 ft / 5 m). null = cancelled or unusable.
 */
SurfaceContours.askInterval = function(unit) {
    var preset = RSettings.getStringValue("CaveSurvey/ContourInterval", "");
    if (preset === "") {
        preset = (unit === CsUnits.FEET) ? "10" : "5";
    }
    var dialog = new QInputDialog(RMainWindowQt.getMainWindow());
    dialog.windowTitle = "Surface Contours";
    dialog.setInputMode(QInputDialog.TextInput);
    dialog.setLabelText("Contour interval (" + unit + "):");
    dialog.setTextValue(preset);
    var answer = dialog.exec();
    var typed = (answer === 0) ? null : String(dialog.textValue());
    destrDialog(dialog);
    if (typed === null) {
        return null;
    }
    var v = parseFloat(typed);
    if (isNaN(v) || v <= 0) {
        warning("Surface Contours: \"" + typed + "\" is not a usable " +
            "interval -- a positive number of " + unit + ".");
        return null;
    }
    RSettings.setValue("CaveSurvey/ContourInterval", String(v));
    return v;
};

/**
 * Downloads url to path with curl, blocking. AerialBasemap.fetch's
 * rule set; the payload validation differs (a TIFF, not a QImage), so
 * only existence and size are checked here -- parseFloatTiff is the
 * real gate and names its reason.
 */
SurfaceContours.fetch = function(url, path) {
    var existing = new QFileInfo(path);
    if (existing.exists()) {
        QFile.remove(path);
    }
    var process = new QProcess();
    process.start("/usr/bin/curl", ["-s", "--fail",
        "--max-time", String(SurfaceContours.TIMEOUT_S), "-o", path, url]);
    if (!process.waitForFinished((SurfaceContours.TIMEOUT_S + 10) * 1000)) {
        var neverStarted = process.state() === QProcess.NotRunning;
        process.kill();
        QFile.remove(path);
        if (neverStarted) {
            return "curl at /usr/bin/curl could not be started. Check " +
                "that curl is installed at that path.";
        }
        return "The download did not finish within " +
            SurfaceContours.TIMEOUT_S + " seconds. Check the network " +
            "connection and try again.";
    }
    if (process.exitCode() !== 0) {
        QFile.remove(path);
        return "curl exited with code " + process.exitCode() +
            ". The National Map service may be down, or the network " +
            "unavailable.";
    }
    var info = new QFileInfo(path);
    if (!info.exists() || info.size() === 0) {
        return "No data was written to " + path + ".";
    }
    return true;
};

/**
 * The file's bytes as a latin1 string -- charCodeAt(i) is byte i.
 * The one faithful, fast binary path in this bridge (probed
 * 2026-08-27; see CsContour.js's header).
 */
SurfaceContours.readBinary = function(path) {
    var file = new QFile(path);
    if (!file.open(QIODevice.ReadOnly)) {
        throw new Error("cannot open " + path);
    }
    var stream = new QTextStream(file);
    stream.setEncoding(QStringConverter.Latin1);
    var content = String(stream.readAll());
    file.close();
    return content;
};

/**
 * Extracts every level's polylines, transforms them into drawing
 * coordinates and commits them in ONE operation (one undo step),
 * replacing any previous run. Majors -- every level a multiple of five
 * intervals -- go on CTRL-CONTOUR-MAJOR with an elevation label at
 * their midpoint; the rest on CTRL-CONTOUR.
 *
 * \return {lines: n}
 */
SurfaceContours.draw = function(doc, di, grid, levels, interval, bbox,
        size, anchor, unit) {
    var toDrawing = CsGeoProject.gridTransform(bbox, grid.width,
        grid.height, anchor, unit);

    // Build everything BEFORE touching the document, so a failure
    // leaves the drawing exactly as it was.
    var entities = [];
    var lineCount = 0;
    for (var li = 0; li < levels.length; li++) {
        var levelU = levels[li];
        var levelM = CsUnits.convert(levelU, unit, CsUnits.METERS);
        var isMajor = Math.round(levelU / interval) % 5 === 0;
        var layer = isMajor ? CsLayers.CONTOUR_MAJOR : CsLayers.CONTOUR;
        var runs = CsContour.lines(grid.values, grid.width, grid.height,
            levelM);
        for (var ri = 0; ri < runs.length; ri++) {
            var run = runs[ri];
            if (run.points.length < 2) {
                continue;
            }
            var data = new RPolylineData();
            for (var k = 0; k < run.points.length; k++) {
                var p = toDrawing(run.points[k].x, run.points[k].y);
                data.appendVertex(new RVector(p.x, p.y));
            }
            if (run.closed) {
                data.setClosed(true);
            }
            var pl = new RPolylineEntity(doc, data);
            pl.setLayerId(doc.getLayerId(layer));
            CsTags.set(pl, "SurfaceContours", "1");
            CsTags.set(pl, "ContourElevation", String(levelU));
            entities.push(pl);
            lineCount++;

            // one label per major run, at its middle vertex
            if (isMajor) {
                var mid = run.points[Math.floor(run.points.length / 2)];
                var mp = toDrawing(mid.x, mid.y);
                var label = new RTextData(
                    new RVector(mp.x, mp.y), new RVector(mp.x, mp.y),
                    CsDraw.TEXT_HEIGHT, 100.0, RS.VAlignMiddle,
                    RS.HAlignCenter, RS.LeftToRight, RS.Exact, 1.0,
                    SurfaceContours.fmt(levelU), "standard",
                    false, false, 0.0, false);
                var te = new RTextEntity(doc, label);
                te.setLayerId(doc.getLayerId(layer));
                CsTags.set(te, "SurfaceContours", "1");
                entities.push(te);
            }
        }
    }

    // Replace the previous run, make sure the layers exist, then land
    // the new set just above the drawing's floor -- over the aerial
    // photograph, under everything drawn since. The basemap, when
    // present, is pushed one step further down so the stack stays
    // photo < contours < survey.
    SurfaceContours.eraseExisting(doc, di);
    CsLayers.ensure(doc, di, CsLayers.CONTOUR);
    CsLayers.ensure(doc, di, CsLayers.CONTOUR_MAJOR);

    var floor = doc.getStorage().getMinDrawOrder() - 1;
    var basemaps = (typeof AerialBasemap !== "undefined" &&
        typeof AerialBasemap.findBasemapCandidates === "function") ?
        AerialBasemap.findBasemapCandidates(doc) :
        SurfaceContours.findBasemaps(doc);
    if (basemaps.length > 0) {
        var lower = new RModifyObjectsOperation();
        for (var bi = 0; bi < basemaps.length; bi++) {
            basemaps[bi].setDrawOrder(floor - 1);
            lower.addObject(basemaps[bi], false);
        }
        di.applyOperation(lower);
    }

    var op = new RAddObjectsOperation();
    op.setText("Draw surface contours");
    for (var ei = 0; ei < entities.length; ei++) {
        entities[ei].setDrawOrder(floor);
        op.addObject(entities[ei], false);
    }
    di.applyOperation(op);

    return { lines: lineCount };
};

/** Basemap images by tag, for when AerialBasemap's own file isn't loaded. */
SurfaceContours.findBasemaps = function(doc) {
    var out = [];
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (!isNull(e) && CsTags.get(e, "AerialBasemap") === "1") {
            out.push(e);
        }
    }
    return out;
};

/** Deletes any previous contour set so a re-run replaces it. */
SurfaceContours.eraseExisting = function(doc, di) {
    var doomed = [];
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (!isNull(e) && CsTags.get(e, "SurfaceContours") === "1") {
            doomed.push(e);
        }
    }
    if (doomed.length === 0) {
        return 0;
    }
    var op = new RDeleteObjectsOperation();
    for (var k = 0; k < doomed.length; k++) {
        op.deleteObject(doomed[k]);
    }
    di.applyOperation(op);
    return doomed.length;
};

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

SurfaceContours.TIMEOUT_S = 60;

function SurfaceContours(guiAction) {
    EAction.call(this, guiAction);
}

SurfaceContours.prototype = new EAction();

SurfaceContours.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    surfaceContoursRun();
    this.terminate();
};

SurfaceContours.init = function(basePath) {
    var action = new RGuiAction(qsTr("Surface Contours"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/SurfaceContours.js");
    action.setIcon(basePath + "/SurfaceContours.svg");
    action.setStatusTip(qsTr("Draw surface topo contours over the " +
        "survey from public USGS elevation data"));
    action.setDefaultCommands(["surfacecontours", "sc"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(54);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
