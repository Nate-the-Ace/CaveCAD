// CsGeoProject.js -- projection and imagery-request math.
//
// Part of the Cave Survey Core library: pure ECMAScript, no document,
// no GUI, no network, so the headless harness can test all of it.
//
// WHY WEB MERCATOR. The obvious way to ask an ArcGIS ImageServer for a
// picture is to hand it a lat/lon bbox (EPSG:4326). That produces a
// STRETCHED image: a degree of longitude is cos(latitude) shorter than
// a degree of latitude, so ground metres per pixel differ between the
// axes. Measured against USGS NAIP at latitude 39.16: 1.08 m/px across
// versus 1.39 m/px down. A CAD image entity carries one uniform scale,
// so such an image can never be placed correctly. Working in EPSG:3857
// throughout -- and matching the requested pixel aspect to the bbox
// aspect -- keeps ground pixels square, at the cost of one cos(lat)
// factor when converting between ground metres and Mercator metres.
//
// Mercator inflates distance by 1/cos(lat). Over a cave-sized area that
// factor is effectively constant, so a single anchor latitude is enough.
//
// The 'Cs' prefix is mandatory: CaveCAD's include() dedupes by
// basename, and the global must match the file name.

include(includeBasePath + "/CsUnits.js");

function CsGeoProject() {}

// Semi-major axis of the WGS84 ellipsoid, which spherical Web Mercator
// uses as the sphere radius.
CsGeoProject.EARTH_RADIUS = 6378137.0;

// Half the Mercator world, i.e. toMercator(0, 180).x.
CsGeoProject.WORLD_HALF = Math.PI * CsGeoProject.EARTH_RADIUS;

// The USGS NAIP ImageServer's own reported extent, in EPSG:3857
// (from the service's ?f=json, 2026-08-20). Used to refuse a request
// before it costs a round trip.
CsGeoProject.NAIP_EXTENT_3857 = {
    xmin: -13896162.899973024,
    ymin: 2812730.7000011485,
    xmax: -7441890.599985033,
    ymax: 6372359.699994525
};

CsGeoProject.NAIP_URL =
    "https://imagery.nationalmap.gov/arcgis/rest/services/" +
    "USGSNAIPImagery/ImageServer/exportImage";

// Native NAIP resolution in metres per pixel, and the service's
// documented maximum image dimension.
CsGeoProject.NATIVE_RES_M = 0.3;
CsGeoProject.MAX_PX = 4000;
CsGeoProject.MIN_PX = 256;

// Fraction added around the survey's own extent.
CsGeoProject.MARGIN = 0.25;

// Smallest sensible window, in metres, for a drawing with one station
// or no extent at all.
CsGeoProject.FLOOR_M = 150;

/**
 * Latitude/longitude in degrees -> EPSG:3857 metres.
 */
CsGeoProject.toMercator = function(lat, lon) {
    var x = CsGeoProject.EARTH_RADIUS * (lon * Math.PI / 180.0);
    var latRad = lat * Math.PI / 180.0;
    var y = CsGeoProject.EARTH_RADIUS *
        Math.log(Math.tan(Math.PI / 4.0 + latRad / 2.0));
    return { x: x, y: y };
};

/**
 * EPSG:3857 metres -> latitude/longitude in degrees.
 */
CsGeoProject.fromMercator = function(x, y) {
    var lon = (x / CsGeoProject.EARTH_RADIUS) * 180.0 / Math.PI;
    var lat = (2.0 * Math.atan(Math.exp(y / CsGeoProject.EARTH_RADIUS)) -
        Math.PI / 2.0) * 180.0 / Math.PI;
    return { lat: lat, lon: lon };
};

/**
 * The ground window to fetch, in metres.
 *
 * \param drawingBox {width, height} in the drawing's own units.
 * \param unitName   CsUnits.FEET or CsUnits.METERS.
 * \param marginFrac fraction to add around the survey (0.25 = 25%).
 * \param floorM     smallest window per axis, in metres.
 */
CsGeoProject.groundExtent = function(drawingBox, unitName, marginFrac, floorM) {
    if (marginFrac === undefined || marginFrac === null) {
        marginFrac = CsGeoProject.MARGIN;
    }
    if (floorM === undefined || floorM === null) {
        floorM = CsGeoProject.FLOOR_M;
    }
    var w = CsUnits.convert(Math.abs(drawingBox.width), unitName,
        CsUnits.METERS) * (1.0 + marginFrac);
    var h = CsUnits.convert(Math.abs(drawingBox.height), unitName,
        CsUnits.METERS) * (1.0 + marginFrac);
    return {
        width: Math.max(w, floorM),
        height: Math.max(h, floorM)
    };
};

/**
 * The request bbox in EPSG:3857, centred on the anchor and then shifted
 * by anchorOffsetM.
 *
 * \param groundExtent {width, height} in ground metres.
 * \param anchorOffsetM {x, y} ground metres from the anchor to the
 *        centre of the window (the survey rarely centres on its
 *        entrance). East and north positive.
 */
CsGeoProject.mercatorBbox = function(anchorLat, anchorLon, groundExtent,
                                    anchorOffsetM) {
    if (anchorOffsetM === undefined || anchorOffsetM === null) {
        anchorOffsetM = { x: 0, y: 0 };
    }
    // Mercator stretches ground distance by 1/cos(lat).
    var inflate = 1.0 / Math.cos(anchorLat * Math.PI / 180.0);
    var center = CsGeoProject.toMercator(anchorLat, anchorLon);
    var cx = center.x + anchorOffsetM.x * inflate;
    var cy = center.y + anchorOffsetM.y * inflate;
    var halfW = (groundExtent.width * inflate) / 2.0;
    var halfH = (groundExtent.height * inflate) / 2.0;
    return {
        xmin: cx - halfW,
        ymin: cy - halfH,
        xmax: cx + halfW,
        ymax: cy + halfH
    };
};

/**
 * Pixel dimensions for a bbox: native resolution where it fits, capped
 * at the service limit, floored so a tiny window still yields a usable
 * picture. Aspect always matches the bbox, which is what keeps ground
 * pixels square.
 */
CsGeoProject.pixelSize = function(bbox, nativeResM, maxPx, minPx) {
    if (nativeResM === undefined || nativeResM === null) {
        nativeResM = CsGeoProject.NATIVE_RES_M;
    }
    if (maxPx === undefined || maxPx === null) {
        maxPx = CsGeoProject.MAX_PX;
    }
    if (minPx === undefined || minPx === null) {
        minPx = CsGeoProject.MIN_PX;
    }
    var mw = bbox.xmax - bbox.xmin;
    var mh = bbox.ymax - bbox.ymin;
    var aspect = mw / mh;

    var w = Math.round(mw / nativeResM);
    var h = Math.round(mh / nativeResM);

    // Scale down to the cap, preserving aspect.
    var over = Math.max(w / maxPx, h / maxPx);
    if (over > 1.0) {
        w = Math.round(w / over);
        h = Math.round(h / over);
    }
    // Scale up to the floor, preserving aspect.
    var under = Math.max(minPx / Math.max(w, 1), minPx / Math.max(h, 1));
    if (under > 1.0) {
        w = Math.round(w * under);
        h = Math.round(h * under);
    }
    // Re-impose the aspect after rounding, on the longer axis, so the
    // squareness invariant survives integer pixels.
    if (aspect >= 1.0) {
        w = Math.max(minPx, Math.min(maxPx, Math.round(h * aspect)));
    } else {
        h = Math.max(minPx, Math.min(maxPx, Math.round(w / aspect)));
    }
    return { w: w, h: h };
};

/**
 * Drawing units per image pixel, i.e. the image entity's scale.
 *
 * The bbox is in Mercator metres, so multiplying by cos(lat) brings it
 * back to ground metres before the unit conversion.
 */
CsGeoProject.drawingUnitsPerPixel = function(bbox, pixelW, anchorLat, unitName) {
    var mercPerPx = (bbox.xmax - bbox.xmin) / pixelW;
    var groundPerPx = mercPerPx * Math.cos(anchorLat * Math.PI / 180.0);
    return CsUnits.convert(groundPerPx, CsUnits.METERS, unitName);
};

/**
 * True when the whole bbox falls inside NAIP's published coverage.
 */
CsGeoProject.insideCoverage = function(bbox) {
    var e = CsGeoProject.NAIP_EXTENT_3857;
    return bbox.xmin >= e.xmin && bbox.xmax <= e.xmax &&
        bbox.ymin >= e.ymin && bbox.ymax <= e.ymax;
};

/**
 * The exportImage request for a bbox and pixel size.
 */
CsGeoProject.naipUrl = function(bbox, size) {
    return CsGeoProject.NAIP_URL +
        "?bbox=" + bbox.xmin.toFixed(3) + "," + bbox.ymin.toFixed(3) + "," +
        bbox.xmax.toFixed(3) + "," + bbox.ymax.toFixed(3) +
        "&bboxSR=3857" +
        "&imageSR=3857" +
        "&size=" + size.w + "," + size.h +
        "&format=png" +
        "&f=image";
};
