// AerialBasemap.js
//
// QCAD add-on tool: fetch a USGS NAIP aerial photograph covering the
// survey and place it underneath the linework, georeferenced from the
// drawing's entrance anchor.
//
// WHY NAIP AND NOT GOOGLE EARTH. Google publishes no export or tile API
// for Earth imagery, and its terms forbid extracting imagery for
// offline reuse -- which is exactly what an image embedded in a DXF is.
// USGS NAIP is federal public domain: keyless, quota-free, no
// attribution obligation, 0.3 m native. US-only coverage, which is
// where this project's caves are.
//
// The projection and request math is in Core/CsGeoProject.js, where the
// headless harness can test it. This file is only the document work,
// the dialogs and the fetch.
//
// TAG AND LAYER BEFORE ADDING, NEVER AFTER (see Core/CsDraw.js's own
// header): in this QJS bridge, simple.js's setCurrentLayer and
// post-add property writes on a JUST-INSERTED entity fail silently.
// The image entity is therefore built, given its layer and its
// replace-on-rerun tag, and only THEN added with addObject(entity,
// false) -- the false is what stops the operation stamping the
// current layer over the one just set. An entity ALREADY IN the
// document (the anchor station, when it needs a fresh coordinate) is
// the one case where CsTags.commit (tag + modify-operation) is right,
// matching Geo Reference's own pattern.
//
// USAGE:
//   Cave Survey > Aerial Basemap   (or type "aerialbasemap" / "ab")
//
// The drawing must be saved (the image is written beside it). If no
// georeference anchor exists yet, the tool asks for the entrance
// coordinate and stores it on station A1 -- by project convention every
// cave entrance is A1 -- so one run does the whole job.
//
// Re-running replaces the previous basemap: the image entity is tagged
// AerialBasemap=1, and a new run erases any tagged image first. Grow
// the survey, run again, get a wider photograph.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

function aerialBasemapRun() {
    var doc = getDocument();
    var di = getDocumentInterface();
    if (doc === undefined || doc === null) {
        warning("Aerial Basemap: no active drawing document.");
        return;
    }

    // 1. The image is written beside the drawing, so the drawing needs
    //    a home first.
    var docPath = doc.getFileName();
    var imagePath = CsGeoProject.imagePathFor(docPath);
    if (imagePath === null) {
        warning("Aerial Basemap: save the drawing first.\n" +
            "The aerial photograph is written beside the drawing file, " +
            "so the drawing needs a name before it can be fetched.");
        return;
    }

    // 2. Resolve the anchor: an existing georeference wins, then the
    //    entrance convention (A1), then a single selected station.
    var anchor = AerialBasemap.findAnchor(doc);
    if (anchor === null) {
        return;                     // findAnchor already explained why
    }
    if (anchor.lat === null) {
        // A station to anchor to, but no coordinate yet -- ask, then
        // store it exactly as Geo Reference would (the entity is
        // already in the document, so CsTags.commit's modify
        // operation is the right tool here, unlike the image entity
        // below which is tagged BEFORE it is ever added).
        var coord = CsLocationPick.ask("Aerial Basemap", "");
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

    // 3. Ground window: the drawing's extent plus a margin, floored so
    //    a one-station drawing still gets a usable photograph.
    var unit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
    var box = AerialBasemap.surveyBox(doc, anchor.pos);
    var extent = CsGeoProject.groundExtent(
        { width: box.width, height: box.height }, unit,
        CsGeoProject.MARGIN, CsGeoProject.FLOOR_M);

    // The survey rarely centres on its entrance, so the window is
    // offset from the anchor by however far the extent's centre is.
    var offset = {
        x: CsUnits.convert(box.centerX - anchor.pos.x, unit, CsUnits.METERS),
        y: CsUnits.convert(box.centerY - anchor.pos.y, unit, CsUnits.METERS)
    };

    var bbox = CsGeoProject.mercatorBbox(anchor.lat, anchor.lon,
        extent, offset);
    if (!CsGeoProject.insideCoverage(bbox)) {
        warning("Aerial Basemap: that location is outside USGS NAIP " +
            "coverage.\nNAIP covers the United States only.");
        return;
    }
    var size = CsGeoProject.pixelSize(bbox, CsGeoProject.NATIVE_RES_M,
        CsGeoProject.MAX_PX, CsGeoProject.MIN_PX);

    // 4. Fetch.
    var fetched = AerialBasemap.fetch(CsGeoProject.naipUrl(bbox, size),
        imagePath);
    if (fetched !== true) {
        warning("Aerial Basemap: the imagery fetch failed.\n" + fetched);
        return;
    }

    // 5. Place it, replacing any previous basemap.
    var unitsPerPixel = CsGeoProject.drawingUnitsPerPixel(bbox, size.w,
        anchor.lat, unit);
    var placed = AerialBasemap.place(doc, di, imagePath, bbox, size,
        unitsPerPixel, anchor);
    if (placed !== true) {
        warning("Aerial Basemap: the photograph was downloaded to\n" +
            imagePath + "\nbut could not be placed in the drawing.\n" +
            placed);
        return;
    }

    var groundW = extent.width;
    QMessageBox.information(getMainWindow(), "Aerial Basemap",
        "Placed a " + size.w + " x " + size.h +
        " USGS NAIP photograph covering about " +
        Math.round(groundW) + " m across, anchored on station " +
        (anchor.name !== "" ? anchor.name : "the anchor point") + ".\n" +
        "Image file: " + imagePath);
}

/**
 * Resolves the anchor station and, if it already carries one, its
 * coordinate.
 *
 * Precedence: a station already carrying GeoLat/GeoLon; else the
 * station named A1 (every cave entrance in this project is A1); else a
 * single selected station point.
 *
 * \return {entity, name, pos, lat, lon} with lat/lon null when a
 *         coordinate still has to be asked for, or null when there is
 *         nothing to anchor to (a message has already been shown).
 */
AerialBasemap.findAnchor = function(doc) {
    var stations = CsTags.collectStations(doc);
    var i;

    // An existing georeference wins outright.
    for (i = 0; i < stations.length; i++) {
        var lat = CsTags.getNumber(stations[i].entity, "GeoLat");
        var lon = CsTags.getNumber(stations[i].entity, "GeoLon");
        if (lat !== null && lon !== null) {
            return {
                entity: stations[i].entity,
                name: stations[i].name,
                pos: stations[i].pos,
                lat: lat,
                lon: lon
            };
        }
    }

    // The entrance convention.
    for (i = 0; i < stations.length; i++) {
        if (stations[i].name === "A1") {
            return {
                entity: stations[i].entity,
                name: "A1",
                pos: stations[i].pos,
                lat: null,
                lon: null
            };
        }
    }

    // Last resort: exactly one selected station point. Only ask
    // CsPick when there IS a selection -- it warns on its own when the
    // selection is empty or ambiguous, and calling it with nothing
    // selected would stack that warning on top of the generic one
    // below.
    if (doc.hasSelection()) {
        var selected = CsPick.singleSelected(doc, "Aerial Basemap");
        if (selected === null) {
            return null;             // CsPick already explained why
        }
        if (typeof selected.getPosition !== "function") {
            warning("Aerial Basemap: the selection isn't a point entity.\n" +
                "Select one station point, or work in a drawing with a " +
                "station named A1.");
            return null;
        }
        return {
            entity: selected,
            name: CsTags.get(selected, "Station"),
            pos: selected.getPosition(),
            lat: null,
            lon: null
        };
    }

    warning("Aerial Basemap: nothing to anchor the photograph to.\n" +
        "This tool needs an existing Geo Reference anchor, a station " +
        "named A1 (the entrance, by convention), or exactly one " +
        "selected station point.");
    return null;
};

/**
 * The drawing's extent, in drawing units, as {width, height, centerX,
 * centerY}. Falls back to a zero-size box at the anchor when the
 * document has no usable extent -- groundExtent's floor then decides
 * the window.
 */
AerialBasemap.surveyBox = function(doc, anchorPos) {
    var min = null;
    var max = null;
    try {
        min = doc.getBoundingBox(true, true).getMinimum();
        max = doc.getBoundingBox(true, true).getMaximum();
    } catch (e) {
        min = null;
    }
    if (min === null || max === null || !isNumber(min.x) || !isNumber(max.x) ||
        max.x < min.x || max.y < min.y) {
        return {
            width: 0, height: 0,
            centerX: anchorPos.x, centerY: anchorPos.y
        };
    }
    return {
        width: max.x - min.x,
        height: max.y - min.y,
        centerX: (min.x + max.x) / 2.0,
        centerY: (min.y + max.y) / 2.0
    };
};

/**
 * Downloads url to path with curl, blocking.
 *
 * curl rather than QNetworkAccessManager: the async event-loop path
 * through this bridge is untested and the tool has nothing to do while
 * waiting. Note that the bridge stringifies readAllStandardOutput() as
 * "QByteArray [JS]", so the diagnosis has to come from the exit code
 * and from inspecting the file.
 *
 * \return true, or a one-line explanation of what went wrong.
 */
AerialBasemap.fetch = function(url, path) {
    var existing = new QFileInfo(path);
    if (existing.exists()) {
        QFile.remove(path);         // never leave a stale photo behind
    }

    var process = new QProcess();
    process.start("/usr/bin/curl", ["-s", "--fail",
        "--max-time", String(AerialBasemap.TIMEOUT_S), "-o", path, url]);
    if (!process.waitForFinished((AerialBasemap.TIMEOUT_S + 10) * 1000)) {
        process.kill();
        return "The download did not finish within " +
            AerialBasemap.TIMEOUT_S + " seconds. Check the network " +
            "connection and try again.";
    }
    if (process.exitCode() !== 0) {
        return "curl exited with code " + process.exitCode() +
            ". The National Map service may be down, or the network " +
            "unavailable.";
    }

    var info = new QFileInfo(path);
    if (!info.exists() || info.size() === 0) {
        return "No image was written to " + path + ".";
    }
    var image = new QImage(path);
    if (image.isNull()) {
        // A service error arrives as a JSON body with a 200 status.
        QFile.remove(path);
        return "The service returned something that is not an image " +
            "(usually an error message). Try again, or a smaller area.";
    }
    return true;
};

/**
 * Inserts the image on CTRL-AERIAL, tagged so a later run can replace
 * it, positioned so the anchor station's drawing coordinate sits on its
 * own real-world pixel.
 *
 * \return true, or a one-line explanation.
 */
AerialBasemap.place = function(doc, di, path, bbox, size, unitsPerPixel,
                              anchor) {
    if (typeof RImageData === "undefined" || typeof RImageEntity === "undefined") {
        return "This build's script engine has no image support " +
            "(RImageData). The CaveCAD fork is the supported platform.";
    }

    // The image's insertion point is its lower-left corner. Work out
    // where that corner falls in drawing coordinates by stepping back
    // from the anchor by the anchor's own offset within the image.
    var anchorMerc = CsGeoProject.toMercator(anchor.lat, anchor.lon);
    var pxFromLeft = (anchorMerc.x - bbox.xmin) /
        ((bbox.xmax - bbox.xmin) / size.w);
    var pxFromBottom = (anchorMerc.y - bbox.ymin) /
        ((bbox.ymax - bbox.ymin) / size.h);
    var originX = anchor.pos.x - pxFromLeft * unitsPerPixel;
    var originY = anchor.pos.y - pxFromBottom * unitsPerPixel;

    // Build the entity BEFORE touching the document at all -- if this
    // throws, nothing has been erased or added yet, so a placement
    // failure leaves the drawing exactly as it was.
    var entity;
    try {
        entity = new RImageEntity(doc, new RImageData(
            path,
            new RVector(originX, originY),
            new RVector(unitsPerPixel, 0),     // u: one pixel across
            new RVector(0, unitsPerPixel),     // v: one pixel up
            size.w, size.h, 0));
    } catch (e) {
        return "Creating the image entity failed: " + e;
    }

    // Only now erase any previous basemap and ensure the layer exists
    // -- a separate operation from the insert below, so a previous
    // basemap and the new one are never both present, but the new
    // entity (already built and known-good above) is ready to go in
    // immediately after.
    AerialBasemap.eraseExisting(doc, di);
    CsLayers.ensure(doc, di, CsLayers.AERIAL);

    // Layer and tag BEFORE adding -- see the file header. A modify
    // operation on an already-added entity is what Geo Reference uses
    // for the pre-existing anchor station above; a brand new entity
    // like this one instead gets its layer and tag set on the
    // script-side object first, then addObject(entity, false) commits
    // both in one step, with "false" stopping the operation from
    // re-stamping the current layer over CTRL-AERIAL.
    entity.setLayerId(doc.getLayerId(CsLayers.AERIAL));
    CsTags.set(entity, "AerialBasemap", "1");

    var op = new RAddObjectsOperation();
    op.setText("Insert aerial basemap");
    op.addObject(entity, false);
    di.applyOperation(op);

    return true;
};

/**
 * Every image entity tagged as a previous basemap.
 */
AerialBasemap.findBasemapCandidates = function(doc) {
    var out = [];
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        if (typeof RImageEntity !== "undefined" && !isOfType(e, RImageEntity)) {
            continue;
        }
        if (CsTags.get(e, "AerialBasemap") === "1") {
            out.push(e);
        }
    }
    return out;
};

/**
 * Deletes any previous basemap so a re-run replaces rather than stacks.
 * Because the image is tagged BEFORE it is ever added (see place()
 * above), the tag is present from the moment an image exists in the
 * document, so this needs only the tag-based scan -- there is no
 * window where a just-inserted basemap is untagged and would need a
 * file-name fallback to be found.
 */
AerialBasemap.eraseExisting = function(doc, di) {
    var existing = AerialBasemap.findBasemapCandidates(doc);
    if (existing.length === 0) {
        return 0;
    }
    var op = new RDeleteObjectsOperation();
    for (var i = 0; i < existing.length; i++) {
        op.deleteObject(existing[i]);
    }
    di.applyOperation(op);
    return existing.length;
};

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

// Seconds allowed for the whole fetch. NAIP at 4000 px can take a
// while; the tool has nothing to do meanwhile, which is why this is a
// blocking QProcess rather than async network plumbing. Kept as a
// property on the tool object (not a bare global) so it can't collide
// with anything else the engine loads into the global scope.
AerialBasemap.TIMEOUT_S = 60;

function AerialBasemap(guiAction) {
    EAction.call(this, guiAction);
}

AerialBasemap.prototype = new EAction();

AerialBasemap.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    aerialBasemapRun();
    this.terminate();
};

AerialBasemap.init = function(basePath) {
    var action = new RGuiAction(qsTr("Aerial Basemap"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/AerialBasemap.js");
    action.setIcon(basePath + "/AerialBasemap.svg");
    action.setStatusTip(qsTr("Put an aerial photograph of the surface " +
        "underneath the survey"));
    action.setDefaultCommands(["aerialbasemap", "ab"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(52);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
