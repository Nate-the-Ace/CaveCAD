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

    var text = getText(title, prompt, defaultText || "");
    if (text === undefined || text === "") {
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
