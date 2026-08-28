// LocationPick.js -- pick a cave location by clicking a map.
//
// Part of the Cave Survey Core library. GUI-adjacent (like Pick.js):
// it opens dialogs and the system browser, so it is not part of the
// pure headlessly-tested set.
//
// QCAD's script bridge has no embeddable web view, so the map opens
// in the SYSTEM BROWSER instead: a self-contained Leaflet page,
// written to the temp folder, centered on the continental US, with a
// hybrid layer (Esri world imagery + place labels) and plain OSM
// streets as alternatives. Clicking the map drops a pin, shows the
// coordinate both ways (decimal and DMS) and copies it to the
// clipboard; the user pastes it into the QCAD prompt that is already
// waiting. Needs internet for map tiles -- the page says so when
// offline, and typing coordinates by hand always still works.

var CsLocationPick = {};

// One declared location serves every tool. Priority: the drawing's
// Geo Reference anchor (authoritative -- it is pinned to a station),
// then the last location the user declared ANYWHERE (map pick or
// typed), kept in RSettings so declination checks, new drawings and
// the Notebook all start from it. A manually declared location is
// trusted: tools prefill it instead of asking again from scratch.

CsLocationPick.SETTING_LAT = "CaveSurvey/LastLocationLat";
CsLocationPick.SETTING_LON = "CaveSurvey/LastLocationLon";

/** Remembers a declared location for every other tool. */
CsLocationPick.remember = function(coord) {
    try {
        RSettings.setValue(CsLocationPick.SETTING_LAT, coord.lat);
        RSettings.setValue(CsLocationPick.SETTING_LON, coord.lon);
    } catch (e) {
        // settings unavailable -- non-critical
    }
};

/**
 * The location the suite already knows, or null.
 * 
eturn {lat, lon, source} with source "anchor" (a Geo Reference
 *         in this drawing) or "last" (the last one declared anywhere)
 */
CsLocationPick.getShared = function(doc) {
    if (doc !== undefined && doc !== null) {
        var ids = doc.queryAllEntities(false, false);
        for (var i = 0; i < ids.length; i++) {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e)) {
                continue;
            }
            var lat = CsTags.getNumber(e, "GeoLat");
            var lon = CsTags.getNumber(e, "GeoLon");
            if (lat !== null && lon !== null) {
                return { lat: lat, lon: lon, source: "anchor" };
            }
        }
    }
    try {
        var sl = RSettings.getDoubleValue(CsLocationPick.SETTING_LAT, -999);
        var so = RSettings.getDoubleValue(CsLocationPick.SETTING_LON, -999);
        if (sl > -999 && so > -999) {
            return { lat: sl, lon: so, source: "last" };
        }
    } catch (e) {
        // settings unavailable
    }
    return null;
};

// How far (drawing units) the geo station may sit from where its
// coordinate was pinned before it counts as MOVED. Snap jitter and
// float noise stay under this; a deliberate drag is far over it.
CsLocationPick.MOVE_EPS = 0.05;

/**
 * The drawing's geo anchor as a full record -- {entity, station, lat,
 * lon, pos, pinX, pinY} -- or null when the drawing has none. pinX/Y
 * are the DRAWING position the coordinate was pinned at (GeoDrawX/Y
 * tags), null on drawings georeferenced before those tags existed.
 */
CsLocationPick.anchorRecord = function(doc) {
    if (doc === undefined || doc === null) {
        return null;
    }
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var lat = CsTags.getNumber(e, "GeoLat");
        var lon = CsTags.getNumber(e, "GeoLon");
        if (lat === null || lon === null) {
            continue;
        }
        var pos = (typeof e.getPosition === "function") ?
            e.getPosition() : null;
        return {
            entity: e,
            station: CsTags.get(e, "GeoStation"),
            lat: lat, lon: lon,
            pos: pos,
            pinX: CsTags.getNumber(e, "GeoDrawX"),
            pinY: CsTags.getNumber(e, "GeoDrawY")
        };
    }
    return null;
};

/**
 * The geo station's CURRENT best coordinate: recomputed through the
 * pinned frame when the station has moved since its coordinate was
 * pinned (the workflow this exists for: the entrance dragged to its
 * true spot over freshly fetched imagery), the stored coordinate
 * otherwise. \return {lat, lon, moved} or null (no anchor).
 */
CsLocationPick.entranceCoord = function(doc) {
    var a = CsLocationPick.anchorRecord(doc);
    if (a === null) {
        return null;
    }
    if (a.pos !== null && a.pinX !== null && a.pinY !== null) {
        var dx = a.pos.x - a.pinX, dy = a.pos.y - a.pinY;
        if (Math.sqrt(dx * dx + dy * dy) > CsLocationPick.MOVE_EPS) {
            var unit = CsUnits.fromDrawingUnit(doc.getUnit(),
                typeof RS !== "undefined" ? RS : undefined);
            var ll = CsGeoProject.latLonAtDrawingPoint(a.pos,
                { lat: a.lat, lon: a.lon, x: a.pinX, y: a.pinY }, unit);
            return { lat: ll.lat, lon: ll.lon, moved: true };
        }
    }
    return { lat: a.lat, lon: a.lon, moved: false };
};

/**
 * For the ground-window tools, before they fetch against an EXISTING
 * anchor: when the geo station has moved since its coordinate was
 * pinned, asks which is the truth -- the position over the imagery
 * (recompute the coordinate through the pinned frame) or the stored
 * coordinate (keep it) -- and re-pins either way so the question is
 * asked once per move, not once per run. Mutates `anchor` ({entity,
 * name, pos, lat, lon}) in place when the user recomputes.
 *
 * Deliberate act by explicit question: the standing rule that nothing
 * silently relocates an anchor holds.
 */
CsLocationPick.resolveMovedAnchor = function(doc, di, anchor, title) {
    var rec = CsLocationPick.anchorRecord(doc);
    if (rec === null || rec.pos === null) {
        return;
    }
    if (rec.pinX === null || rec.pinY === null) {
        // pre-pin drawing: pin the frame HERE, at fetch time -- from
        // this run on, a move of the station is detectable
        CsTags.commit(di, rec.entity,
            { GeoDrawX: rec.pos.x, GeoDrawY: rec.pos.y });
        return;
    }
    var dx = rec.pos.x - rec.pinX, dy = rec.pos.y - rec.pinY;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= CsLocationPick.MOVE_EPS) {
        return;
    }
    var unit = CsUnits.fromDrawingUnit(doc.getUnit(),
        typeof RS !== "undefined" ? RS : undefined);
    var ll = CsGeoProject.latLonAtDrawingPoint(rec.pos,
        { lat: rec.lat, lon: rec.lon, x: rec.pinX, y: rec.pinY }, unit);
    var name = rec.station !== "" ? rec.station : "the geo station";
    // getMainWindow is a GUI global -- absent in the headless harness
    var win = (typeof getMainWindow === "function") ? getMainWindow() : null;
    var answer = QMessageBox.question(win, title,
        name + " has moved " + (Math.round(dist * 100) / 100) + " " +
        unit + " since its location was pinned.\n\n" +
        "Recompute its latitude/longitude from where it now sits over " +
        "the georeferenced imagery?\n\n" +
        "Yes: where it sits is the truth -- the coordinate becomes " +
        ll.lat.toFixed(6) + ", " + ll.lon.toFixed(6) + ".\n" +
        "No: the stored coordinate (" + rec.lat.toFixed(6) + ", " +
        rec.lon.toFixed(6) + ") stays the truth for the new position.",
        QMessageBox.Yes | QMessageBox.No);
    if (answer === QMessageBox.Yes) {
        CsTags.commit(di, rec.entity, {
            GeoLat: ll.lat,
            GeoLon: ll.lon,
            GeoDrawX: rec.pos.x,
            GeoDrawY: rec.pos.y
        });
        CsLocationPick.remember(ll);
        if (anchor !== undefined && anchor !== null) {
            anchor.lat = ll.lat;
            anchor.lon = ll.lon;
        }
    } else {
        // the stored coordinate now belongs to the new position
        CsTags.commit(di, rec.entity,
            { GeoDrawX: rec.pos.x, GeoDrawY: rec.pos.y });
    }
};

/**
 * Asks for a location, offering the browser map first.
 *
 * \param title dialog title (names the calling tool)
 * \param defaultText prefilled coordinate text, may be ""
 * \return {lat, lon} or null (cancelled / unparseable)
 */
CsLocationPick.ask = function(title, defaultText) {
    // A location the suite already knows prefills the prompt: the
    // drawing's anchor first, then the last one declared anywhere.
    if (defaultText === undefined || defaultText === null || defaultText === "") {
        var known = CsLocationPick.getShared(
            typeof getDocument === "function" ? getDocument() : undefined);
        if (known !== null) {
            defaultText = known.lat.toFixed(6) + ", " + known.lon.toFixed(6);
        }
    }

    var useMap = QMessageBox.question(getMainWindow(), title,
        "Pick the location on a map?\n\n" +
        "Yes opens a map in your browser: click the spot, the\n" +
        "coordinate is copied, paste it into the next prompt.\n" +
        "No goes straight to typing coordinates.",
        QMessageBox.Yes | QMessageBox.No);

    var prompt;
    if (useMap === QMessageBox.Yes && CsLocationPick.openMap()) {
        prompt = "Paste the coordinate from the map page\n" +
            "(or type one: decimal like 40.5042, -90.2583 or DMS):";
    } else {
        prompt = "Cave location (decimal like 40.5042, -90.2583 or DMS " +
            "like 40 30'15.0\"N 90 15'30.0\"W):";
    }

    var text = CsLocationPick.askText(title, prompt, defaultText || "");
    if (text === undefined || text === null || text === "") {
        return null;
    }
    var coord = CsAngles.parseLatLon(text);
    if (coord === null) {
        warning(title + ": couldn't read that coordinate.");
        return null;
    }
    // a declared location is trusted -- share it with every tool
    CsLocationPick.remember(coord);
    return coord;
};

/**
 * The coordinate entry itself: a line edit with a From Entrance
 * button that reads the geo station's CURRENT best coordinate into
 * the field (recomputed through the pinned frame when the station has
 * been moved over the imagery -- see entranceCoord). Nathan's ask,
 * 2026-08-27. Falls back to the plain getText prompt on a bridge that
 * refuses the dialog.
 *
 * \return the typed text, or null (cancelled).
 */
CsLocationPick.askText = function(title, prompt, preset) {
    try {
        var dlg = new QDialog(getMainWindow());
        dlg.windowTitle = title;
        var layout = new QVBoxLayout();
        layout.addWidget(new QLabel(prompt), 0, 0);
        var edit = new QLineEdit();
        edit.text = preset || "";
        layout.addWidget(edit, 0, 0);

        var bar = new QHBoxLayout();
        var fromBtn = new QPushButton("From Entrance");
        fromBtn.toolTip = "Read the geo station's coordinate into the " +
            "field. If the station has been moved since imagery was " +
            "fetched, this is its NEW location, computed from where it " +
            "now sits over that imagery.";
        var okBtn = new QPushButton("OK");
        var cancelBtn = new QPushButton("Cancel");
        try {
            okBtn["default"] = true;
        } catch (eDef) {
        }
        bar.addWidget(fromBtn, 0, 0);
        bar.addStretch(1);
        bar.addWidget(okBtn, 0, 0);
        bar.addWidget(cancelBtn, 0, 0);
        layout.addLayout(bar, 0);
        dlg.setLayout(layout);

        fromBtn.clicked.connect(function() {
            var doc = (typeof getDocument === "function") ?
                getDocument() : null;
            var best = (doc !== null && doc !== undefined) ?
                CsLocationPick.entranceCoord(doc) : null;
            if (best === null) {
                QMessageBox.information(getMainWindow(), title,
                    "No geo station in this drawing yet -- there is " +
                    "no entrance coordinate to read. Pick or type one.");
                return;
            }
            edit.text = best.lat.toFixed(6) + ", " + best.lon.toFixed(6);
        });
        okBtn.clicked.connect(function() { dlg.accept(); });
        cancelBtn.clicked.connect(function() { dlg.reject(); });

        var answer = dlg.exec();
        var text = (answer === 0) ? null : String(edit.text);
        destrDialog(dlg);
        return text;
    } catch (e) {
        var t = getText(title, prompt, preset || "");
        return (t === undefined || t === "") ? null : t;
    }
};

/** Writes the map page and opens it. Returns false on any failure. */
CsLocationPick.openMap = function() {
    try {
        var path = QDir.tempPath() + "/cavesurvey_location_picker.html";
        var f = new QFile(path);
        if (!f.open(QIODevice.WriteOnly | QIODevice.Text)) {
            return false;
        }
        var ts = new QTextStream(f);
        ts.writeString(CsLocationPick.pageHtml());
        f.close();
        return QDesktopServices.openUrl(new QUrl("file://" + path));
    } catch (e) {
        return false;
    }
};

/** The Leaflet page. Kept dependency-light: Leaflet from unpkg, map
 *  tiles from OSM and Esri's public services, correct attribution. */
CsLocationPick.pageHtml = function() {
    // Assembled from an array: this file is itself ECMAScript, so the
    // page's <script> content stays out of this parser's way.
    var L = [];
    L.push('<!DOCTYPE html><html><head><meta charset="utf-8">');
    L.push('<title>Cave Survey - pick a location</title>');
    L.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
    L.push('<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">');
    L.push('<scr' + 'ipt src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></scr' + 'ipt>');
    L.push('<style>');
    L.push('html,body{margin:0;height:100%;font-family:sans-serif}');
    L.push('#map{position:absolute;top:0;bottom:64px;width:100%}');
    L.push('#bar{position:absolute;bottom:0;height:64px;width:100%;');
    L.push('display:flex;align-items:center;gap:10px;padding:0 12px;');
    L.push('box-sizing:border-box;background:#222;color:#eee}');
    L.push('#coord{flex:1;font-size:15px;padding:6px;font-family:monospace}');
    L.push('#hint{font-size:13px;color:#aaa}');
    L.push('button{font-size:14px;padding:8px 14px}');
    L.push('</style></head><body>');
    L.push('<div id="map"></div>');
    L.push('<div id="bar">');
    L.push('<input id="coord" readonly placeholder="click the map...">');
    L.push('<button id="copy">Copy</button>');
    L.push('<span id="hint">click = pin + copy; paste into QCAD</span>');
    L.push('</div>');
    L.push('<scr' + 'ipt>');
    L.push('var map = L.map("map").setView([39.5, -98.35], 4);'); // continental US
    L.push('var osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",');
    L.push('  {maxZoom: 19, attribution: "&copy; OpenStreetMap contributors"});');
    L.push('var imagery = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",');
    L.push('  {maxZoom: 19, attribution: "Imagery &copy; Esri"});');
    L.push('var labels = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",');
    L.push('  {maxZoom: 19});');
    L.push('var hybrid = L.layerGroup([imagery, labels]);');
    L.push('hybrid.addTo(map);'); // hybrid is the default
    L.push('L.control.layers({"Hybrid (imagery + labels)": hybrid, "OSM streets": osm}).addTo(map);');
    L.push('var marker = null;');
    L.push('function fmt(v){return v.toFixed(6);}');
    L.push('map.on("click", function(e){');
    L.push('  var lat = e.latlng.lat, lon = e.latlng.lng;');
    L.push('  if (marker) { marker.setLatLng(e.latlng); }');
    L.push('  else { marker = L.marker(e.latlng).addTo(map); }');
    L.push('  var text = fmt(lat) + ", " + fmt(lon);');
    L.push('  var box = document.getElementById("coord");');
    L.push('  box.value = text;');
    L.push('  box.select();');
    L.push('  var copied = false;');
    L.push('  try { copied = document.execCommand("copy"); } catch (err) {}');
    L.push('  if (navigator.clipboard) {');
    L.push('    navigator.clipboard.writeText(text).then(function(){copied=true;});');
    L.push('  }');
    L.push('  document.getElementById("hint").textContent =');
    L.push('    copied ? "copied -- paste into QCAD" : "select the box and copy (Cmd+C)";');
    L.push('});');
    L.push('document.getElementById("copy").onclick = function(){');
    L.push('  var box = document.getElementById("coord");');
    L.push('  box.select();');
    L.push('  try { document.execCommand("copy"); } catch (err) {}');
    L.push('  if (navigator.clipboard) { navigator.clipboard.writeText(box.value); }');
    L.push('};');
    L.push('</scr' + 'ipt></body></html>');
    return L.join("\n");
};
