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
include("scripts/Widgets/AutoZoomView/AutoZoomView.js");

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
        preview.view.fitPending = true;
        preview.di.autoZoom();
        preview.view.fitPending = false;
        return true;
    } catch (e) {
        return false;
    }
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
