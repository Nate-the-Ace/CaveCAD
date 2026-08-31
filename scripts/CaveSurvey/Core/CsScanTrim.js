// CsScanTrim.js -- which pixels of a scanned page actually get placed.
//
// Part of the Cave Survey Core library. Everything above the QCAD-only
// banner is PURE; the functions below it touch QImage and the disk and
// take the scans folder explicitly, the same split CsScanFrame.js uses.
//
// WHY A DERIVATIVE FILE AND NOT A CROP PROPERTY. RImageData carries a
// file name, an insertion point, u and v vectors, a pixel size and a
// fade -- and no clip boundary. DXF's IMAGE clipping is not implemented
// in this engine. So "place only this part of the page" can only mean
// "point the entity at a smaller file".
//
// WHY THE RECT LIVES IN THE FILENAME. It makes the derivative
// self-describing: the same box drawn twice on the same page resolves
// to a file that already exists, so nothing accumulates, and there is
// no sidecar index that can drift out of step with a folder the caver
// is free to delete.

var CsScanTrim = {};

/** The one subfolder derivatives live in, under the scans folder. */
CsScanTrim.FOLDER = "Trimmed";

/** The marker in every derivative's name, so a caver can find and
 *  delete them all without knowing anything about this suite. */
CsScanTrim.MARK = "TRIMMED";

/** Smaller than this on either side is a stray click, not a box. */
CsScanTrim.MIN_PX = 20;

/** The XDATA tag a trimmed placement carries: the box, in the ORIGINAL
 *  page's pixels. Absent means the whole page was placed. */
CsScanTrim.TAG = "ScanTrim";

/**
 * Two points picked in the preview, as a rect on the page.
 *
 * The preview holds the scan at ONE DRAWING UNIT PER PIXEL with its
 * bottom-left at the origin (CsScanPreview.show), so a model point's x
 * is already a column -- but its y runs UP while an image's rows run
 * DOWN. That flip is the whole reason this function exists rather than
 * the caller doing it twice and getting it right once.
 *
 * \return a clamped integer rect, or null when nothing usable is left.
 */
CsScanTrim.rectFromPicks = function(a, b, pxW, pxH) {
    if (a === null || a === undefined || b === null || b === undefined) {
        return null;
    }
    var x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    var yTop = Math.max(a.y, b.y), yBottom = Math.min(a.y, b.y);
    return CsScanTrim.normalise({
        x: x0,
        y: pxH - yTop,
        w: x1 - x0,
        h: yTop - yBottom
    }, pxW, pxH);
};

/**
 * A rect clamped to the page and rounded to whole pixels.
 *
 * \return the rect, or null when it falls off the page entirely or
 *         comes out under CsScanTrim.MIN_PX on either side.
 */
CsScanTrim.normalise = function(rect, pxW, pxH) {
    if (rect === null || rect === undefined) {
        return null;
    }
    var x0 = Math.round(rect.x), y0 = Math.round(rect.y);
    var x1 = Math.round(rect.x + rect.w), y1 = Math.round(rect.y + rect.h);
    var t;
    if (x0 > x1) { t = x0; x0 = x1; x1 = t; }
    if (y0 > y1) { t = y0; y0 = y1; y1 = t; }
    x0 = Math.max(0, Math.min(x0, pxW));
    x1 = Math.max(0, Math.min(x1, pxW));
    y0 = Math.max(0, Math.min(y0, pxH));
    y1 = Math.max(0, Math.min(y1, pxH));
    var w = x1 - x0, h = y1 - y0;
    if (w < CsScanTrim.MIN_PX || h < CsScanTrim.MIN_PX) {
        return null;
    }
    return { x: x0, y: y0, w: w, h: h };
};

/** True when this rect covers the whole page, in which case there is
 *  nothing to trim and the original file should be placed. */
CsScanTrim.isWholePage = function(rect, pxW, pxH) {
    return rect !== null && rect !== undefined &&
        rect.x === 0 && rect.y === 0 && rect.w === pxW && rect.h === pxH;
};

/** A page's base name, with anything that could build a path replaced
 *  -- a derivative must never be able to escape the Trimmed folder. */
CsScanTrim.baseOf = function(pageRel) {
    var name = String(pageRel);
    name = name.substring(name.lastIndexOf("/") + 1);
    var dot = name.lastIndexOf(".");
    if (dot > 0) {
        name = name.substring(0, dot);
    }
    return name.replace(/[^A-Za-z0-9._-]/g, "_");
};

/** The derivative's file name for this page and box. Always .png:
 *  a trimmed sketch is about to be traced over, and re-encoding a JPG
 *  page as JPG a second time is not worth the bytes saved. */
CsScanTrim.fileName = function(pageRel, rect) {
    return CsScanTrim.baseOf(pageRel) + "__" + CsScanTrim.MARK +
        "_x" + rect.x + "_y" + rect.y +
        "_w" + rect.w + "_h" + rect.h + ".png";
};

/** The rect back out of a derivative's name, or null when the name is
 *  not one of ours. */
CsScanTrim.parseName = function(name) {
    var m = /__TRIMMED_x(\d+)_y(\d+)_w(\d+)_h(\d+)\.png$/.exec(String(name));
    if (m === null) {
        return null;
    }
    return { x: parseInt(m[1], 10), y: parseInt(m[2], 10),
             w: parseInt(m[3], 10), h: parseInt(m[4], 10) };
};

/**
 * True when this scans-relative path is a derivative rather than a
 * page. Whole path SEGMENTS only: a caver's own "Trimmed_notes" folder
 * is a real folder and its scans belong in the shelf.
 */
CsScanTrim.isTrimPath = function(rel) {
    var parts = String(rel).split("/");
    for (var i = 0; i < parts.length - 1; i++) {
        if (parts[i] === CsScanTrim.FOLDER) {
            return true;
        }
    }
    return false;
};

/** The ScanTrim tag's text. */
CsScanTrim.serialize = function(rect) {
    if (rect === null || rect === undefined) {
        return "";
    }
    return rect.x + "," + rect.y + "," + rect.w + "," + rect.h;
};

/** A ScanTrim tag back to a rect, or null. Never throws: this value
 *  comes off a drawing a user can edit. */
CsScanTrim.parse = function(text) {
    if (text === null || text === undefined) {
        return null;
    }
    var m = /^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/.exec(
        String(text));
    if (m === null) {
        return null;
    }
    return { x: parseInt(m[1], 10), y: parseInt(m[2], 10),
             w: parseInt(m[3], 10), h: parseInt(m[4], 10) };
};

// ----------------------------------------------------------- QCAD only
// Everything below touches QImage and the disk. It takes the scans
// folder explicitly and knows nothing about a document or a dock.

/** The folder derivatives live in, created on demand.
 *  \return the path, or null when it could not be made. */
CsScanTrim.folderIn = function(scansFolder) {
    var path = String(scansFolder) + "/" + CsScanTrim.FOLDER;
    try {
        if (new QFileInfo(path).exists()) {
            return path;
        }
        if (new QDir().mkpath(path)) {
            return path;
        }
    } catch (e) {
    }
    return null;
};

/**
 * Crops a page to a box and saves it as a PNG derivative.
 *
 * REUSES an existing derivative with the same name rather than writing
 * it again -- the rect is in the name, so a matching name IS a matching
 * crop.
 *
 * NEVER FALLS BACK to the whole page. A caver who drew a box asked for
 * the clutter to be gone; placing the page anyway would put it in the
 * drawing without saying so.
 *
 * \return { path: <absolute path>, error: null } on success,
 *         { path: null, error: <message> } on failure.
 */
CsScanTrim.write = function(scansFolder, pageRel, rect) {
    var name = CsScanTrim.fileName(pageRel, rect);
    var folder = CsScanTrim.folderIn(scansFolder);
    if (folder === null) {
        return { path: null, error: "the " + CsScanTrim.FOLDER +
            " folder could not be created in " + scansFolder +
            " -- the scans folder may be read-only." };
    }
    var out = folder + "/" + name;
    try {
        if (new QFileInfo(out).exists()) {
            return { path: out, error: null };
        }
    } catch (eExists) {
    }

    var pagePath = String(scansFolder) + "/" + pageRel;
    var page;
    try {
        page = new QImage(pagePath);
    } catch (eLoad) {
        page = null;
    }
    if (page === null || page.isNull()) {
        return { path: null, error: pagePath +
            " could not be read as an image." };
    }
    var cropped;
    try {
        cropped = page.copy(new QRect(rect.x, rect.y, rect.w, rect.h));
    } catch (eCopy) {
        cropped = null;
    }
    if (cropped === null || cropped.isNull()) {
        return { path: null, error: "cropping " + pagePath +
            " to " + CsScanTrim.serialize(rect) + " failed -- the page " +
            "may be too large to hold in memory." };
    }
    var saved = false;
    try {
        saved = cropped.save(out, "PNG");
    } catch (eSave) {
        saved = false;
    }
    if (!saved) {
        return { path: null, error: "the trimmed image could not be " +
            "written to " + out + "." };
    }
    return { path: out, error: null };
};
