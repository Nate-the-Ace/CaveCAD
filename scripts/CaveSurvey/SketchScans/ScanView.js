/**
 * CsScanView -- the Sketch Scans preview, as a real CAD view.
 *
 * The preview used to be a QLabel holding a scaled QPixmap: fit to the
 * pane, no zoom, no pan. On a 4000-pixel scan squeezed into a 420-pixel
 * label that is a ten-to-one reduction, which is enough to tell one
 * sketch from another and not enough to read a station number.
 *
 * A QLabel is also a dead end for PICKING: this bridge gives a script no
 * way to get a click coordinate out of one. REventFilter -- the only
 * filter class QCAD exposes -- carries no signal and only blocks or
 * forwards by event type, and every mousePressEvent override in QCAD's
 * own scripts is on an ACTION, never a widget.
 *
 * So the preview is an embedded QCAD view over a throwaway in-memory
 * document holding just the scan. That is QCAD's own pattern for this:
 * the Hatch dialog previews patterns exactly this way
 * (scripts/Draw/Hatch/HatchDialog.js, via AutoZoomView). It brings
 * native zoom and pan, and mapFromView turns a click into a point on
 * the scan -- which is what a station picker would need.
 *
 * NOT AutoZoomView itself, deliberately: that one re-fits on every
 * resize, so a dock the caver drags wider would throw away the zoom
 * they had just set. This one fits ONCE, when a new scan is loaded.
 */
// NO include of AutoZoomView: this subclasses RGraphicsViewQt directly,
// for the reason in the docblock above -- AutoZoomView re-fits on every
// resize and would throw away the caver's zoom.

function CsScanView(parent) {
    RGraphicsViewQt.call(this, parent, false);
    this.fitPending = true;
}

CsScanView.prototype = new RGraphicsViewQt();

/** Fit once per loaded scan, then leave the caver's zoom alone. */
CsScanView.prototype.resizeEvent = function(event) {
    RGraphicsViewQt.prototype.resizeEvent.call(this, event);
    if (this.fitPending === true) {
        try {
            this.getImageView().autoZoom();
            this.fitPending = false;
        } catch (e) {
            // an unzoomable view still shows the scan at its own scale
        }
    }
};

/**
 * A click in the view, reported as a point ON THE SCAN.
 *
 * PROVEN BY THE BINDING, not by hope: the generated shell class
 * (src/scripting/ecmaapi/generated/REcmaShellGraphicsViewQt.cpp) looks
 * up a script property named "mousePressEvent" and, when it is a
 * function, calls THAT in place of RGraphicsViewQt's own. An object
 * built from script -- new CsScanView(...) -- is a shell instance, so
 * this override is what Qt dispatches to.
 *
 * The base is still called first: panning, gestures and the view's own
 * navigation must keep working. This only listens.
 *
 * The scan is placed at ONE DRAWING UNIT PER PIXEL (CsScanPreview.show),
 * so the mapped model point IS the pixel under the cursor -- no scale
 * to carry and nothing to convert at the far end.
 */
CsScanView.prototype.mousePressEvent = function(event) {
    RGraphicsViewQt.prototype.mousePressEvent.call(this, event);
    var at = CsScanView.eventPos(event);
    var button = 0;
    try {
        button = (typeof event.button === "function") ?
            event.button() : event.button;
    } catch (eBtn) {
    }

    // Middle starts a pan. Qt.MidButton and Qt.MiddleButton are both 4
    // here, so either spelling is the same test.
    if (button === Qt.MidButton) {
        this.panFrom = at;
        return;
    }
    if (button !== Qt.LeftButton || typeof this.onScanPick !== "function" ||
            at === null) {
        return;
    }
    try {
        var model = this.getImageView().mapFromView(
            new RVector(at.x, at.y));
        this.onScanPick({ x: model.x, y: model.y });
    } catch (e) {
        // a listener must never throw into the view's own event handling
    }
};

/** A widget position off a mouse event, whichever way this bridge
 *  spells it. QPoint's x and y are FUNCTIONS here, not properties, and
 *  reading them as properties fails silently (probed 2026-08-29). */
CsScanView.eventPos = function(event) {
    try {
        if (typeof event.x === "function") {
            return { x: event.x(), y: event.y() };
        }
        if (typeof event.pos === "function") {
            var p = event.pos();
            return { x: (typeof p.x === "function") ? p.x() : p.x,
                     y: (typeof p.y === "function") ? p.y() : p.y };
        }
    } catch (e) {
    }
    return null;
};

/** How much a wheel notch turned, whichever API this Qt offers. */
CsScanView.wheelSteps = function(event) {
    try {
        if (typeof event.angleDelta === "function") {
            var d = event.angleDelta();
            var dy = (typeof d.y === "function") ? d.y() : d.y;
            return dy / 120.0;
        }
        if (typeof event.delta === "function") {
            return event.delta() / 120.0;
        }
    } catch (e) {
    }
    return 0;
};

/** Zoom step per wheel notch. */
CsScanView.WHEEL_FACTOR = 1.25;

/**
 * The wheel zooms ABOUT THE CURSOR, the way every map and every CAD
 * view does: the point under the pointer stays under the pointer.
 * RGraphicsView.zoom takes its centre in MODEL coordinates, which is
 * what mapFromView answers.
 */
CsScanView.prototype.wheelEvent = function(event) {
    var steps = CsScanView.wheelSteps(event);
    if (steps === 0) {
        RGraphicsViewQt.prototype.wheelEvent.call(this, event);
        return;
    }
    try {
        var iv = this.getImageView();
        var at = CsScanView.eventPos(event);
        var centre = (at === null) ?
            iv.mapFromView(new RVector(iv.getWidth() / 2, iv.getHeight() / 2)) :
            iv.mapFromView(new RVector(at.x, at.y));
        iv.zoom(centre, Math.pow(CsScanView.WHEEL_FACTOR, steps));
    } catch (e) {
        RGraphicsViewQt.prototype.wheelEvent.call(this, event);
    }
};

/**
 * MIDDLE-DRAG PANS, the same gesture QCAD's own views use, which
 * leaves the left button free for picking a station off the scan.
 * pan() takes a delta in VIEW pixels and flips y itself.
 */
CsScanView.prototype.mouseMoveEvent = function(event) {
    RGraphicsViewQt.prototype.mouseMoveEvent.call(this, event);
    if (this.panFrom === undefined || this.panFrom === null) {
        return;
    }
    try {
        var at = CsScanView.eventPos(event);
        if (at === null) {
            return;
        }
        this.getImageView().pan(
            new RVector(at.x - this.panFrom.x, at.y - this.panFrom.y), true);
        this.panFrom = at;
    } catch (e) {
        this.panFrom = null;
    }
};

CsScanView.prototype.mouseReleaseEvent = function(event) {
    RGraphicsViewQt.prototype.mouseReleaseEvent.call(this, event);
    this.panFrom = null;
};

var CsScanPreview = {};

/**
 * Build the view and the document behind it.
 *
 * \return {view, di, doc} or null when this build cannot embed a view --
 *         the caller then keeps the old QLabel preview rather than
 *         losing the panel.
 */
CsScanPreview.build = function(parent) {
    try {
        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
        var di = new RDocumentInterface(doc);
        // Nothing outside this dock should hear about the scratch
        // document's transactions -- the panel's own staleness listener
        // watches for a CHANGED drawing and would rebuild on every
        // preview.
        di.setNotifyListeners(false);

        var view = new CsScanView(parent);
        var imageView = view.getImageView();
        imageView.setPaintOrigin(false);
        imageView.setScene(new RGraphicsSceneQt(di));
        imageView.setMargin(10);
        return { view: view, di: di, doc: doc, imageView: imageView };
    } catch (e) {
        return null;
    }
};

/** Put one scan in the view, fitted. \return true when it loaded. */
CsScanPreview.show = function(preview, path) {
    if (preview === null || preview === undefined) {
        return false;
    }
    try {
        preview.di.clear();
        var image = new QImage(path);
        if (image.isNull()) {
            return false;
        }
        var pxW = image.width(), pxH = image.height();
        if (pxW < 1 || pxH < 1) {
            return false;
        }
        // One drawing unit per pixel: the preview document exists only
        // to be looked at, so the simplest mapping is the right one --
        // and it makes a picked point read directly as a pixel on the
        // scan.
        var data = new RImageData(path, new RVector(0, 0),
            new RVector(1, 0), new RVector(0, 1), pxW, pxH, 0);
        var entity = new RImageEntity(preview.doc, data);
        var op = new RAddObjectOperation(entity, false);
        preview.di.applyOperation(op);
        preview.heightPx = pxH;
        preview.widthPx = pxW;
        preview.view.fitPending = true;
        preview.di.autoZoom();
        preview.view.fitPending = false;
        return true;
    } catch (e) {
        return false;
    }
};

/** The pixel a click landed on, formatted for a readout. The scan's
 *  own top-left is (0, height) in model space because a drawing's Y
 *  runs up and an image's rows run down, so the row is reported from
 *  the top the way an image viewer states it. Pure. */
CsScanPreview.pixelText = function(point, heightPx) {
    if (point === null || point === undefined) {
        return "";
    }
    var col = Math.round(point.x);
    var row = Math.round(heightPx - point.y);
    return col + ", " + row + " px";
};

/** Fit the whole scan back into the pane. */
CsScanPreview.fit = function(preview) {
    try {
        preview.di.autoZoom();
    } catch (e) {
    }
};

/** Zoom about the middle of the pane. `factor` above 1 zooms in. */
CsScanPreview.zoom = function(preview, factor) {
    try {
        var iv = preview.imageView;
        iv.zoom(iv.mapFromView(new RVector(iv.getWidth() / 2,
            iv.getHeight() / 2)), factor);
    } catch (e) {
        // no zoom(): fall back to the view's own step zoom
        try {
            if (factor > 1) { preview.imageView.zoomIn(); }
            else { preview.imageView.zoomOut(); }
        } catch (e2) {
        }
    }
};
