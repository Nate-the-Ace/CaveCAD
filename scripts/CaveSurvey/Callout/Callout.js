/**
 * CsCallout -- place a text note bound to one or more leader arrows.
 *
 * QCAD has no multileader; this is it. A callout is a linked pair: a
 * real RTextEntity plus one real RLeaderEntity per tip, joined by a
 * shared CalloutId in CsTags XDATA (see Core/CsCallout.js). The text
 * stays an ordinary text entity, so QCAD's native text editor, grips
 * and property editor keep working unchanged; CalloutSync (and later
 * CalloutListener) is what keeps the arrows glued to it afterwards.
 *
 * SHAPE: this file follows AlignImage.js, the suite's reference
 * interactive tool -- a State enum, initState() (not setState) for
 * prompts/cursor/click-mode, pickCoordinate(event, preview) for both
 * the real pick and the live preview, escapeEvent stepping back one
 * state, enterEvent finishing a repeatable pick. Deviating from that
 * shape is what makes a tool feel unlike the rest of the suite.
 *
 * NOTHING is added to the document until finish() succeeds. That is
 * why escapeEvent needs no cleanup at any state: unlike AlignImage
 * (which may have pre-selected entities to release) or QCAD's own
 * Leader tool (which adds its RLeaderEntity on the FIRST click and has
 * to delete it again on a same-state escape), a cancelled Callout
 * simply never wrote anything.
 */
include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/CalloutWrite.js");

function Callout(guiAction) {
    EAction.call(this, guiAction);
    this.tips = [];             // [{x,y}] one per branch, in pick order
    this.position = null;       // {x,y} chosen note position, or null
    this.previewPos = undefined; // last mouse position while picking it
    this.style = CsCallout.STYLE_DEFAULT;
}

Callout.prototype = new EAction();

Callout.State = {
    PickingTip: 0,
    PickingPosition: 1
};

/**
 * Half the width of the placeholder box used to preview reflow before
 * a real text entity exists (as a multiple of the text height).
 *
 * The live preview (see getAuxPreview below) needs SOME box to hand
 * CsCallout.reflow -- reflow only ever reads the box to find its
 * centre (for the auto side choice) and its two edges (for where the
 * landing sits), so an approximate box is enough to show which side
 * the leader will leave from and roughly how far the landing sits
 * from the pick point. The box is centred ON the candidate position,
 * so its centre -- and therefore the side choice -- does not depend
 * on this guessed width at all; only how far the landing marker sits
 * from the cursor does. Once the real text exists, CalloutWrite.create
 * reflows against its ACTUAL bounding box, so this number only ever
 * affects the preview, never the placed callout.
 */
Callout.PreviewHalfWidthFactor = 3.0;

Callout.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    var doc = this.getDocument();
    if (isNull(doc)) {
        this.terminate();
        return;
    }

    CsLayers.ensureCalloutLayers(doc, this.getDocumentInterface());
    this.setState(Callout.State.PickingTip);
};

Callout.prototype.initState = function() {
    var di = this.getDocumentInterface();
    if (isNull(di)) {
        return;
    }

    this.setCrosshairCursor();
    di.setClickMode(RAction.PickCoordinate);

    switch (this.state) {
    case Callout.State.PickingTip:
        // Stepping back from PickingPosition (escapeEvent) leaves this
        // state's own pickCoordinate branch with nothing to say about
        // the preview -- it never calls updatePreview(), by design,
        // since there is nothing to preview while picking a tip. Clear
        // explicitly here rather than counting on the next mouse move
        // to implicitly replace it: a leftover leader-preview from the
        // position we just backed out of is exactly the kind of thing
        // that is invisible in every headless test and obvious the
        // moment a human tries it.
        di.clearPreview();
        di.repaintViews();

        var tipMsg = (this.tips.length === 0) ?
            qsTr("Pick what the arrow points at") :
            qsTr("Pick another arrow target, or press Enter for the note position");
        this.setCommandPrompt(tipMsg);
        this.setLeftMouseTip(tipMsg);
        // Only the very first pick can CANCEL the command outright --
        // once a tip exists, the right button (and Escape) step back
        // to let it be re-picked, matching escapeEvent below.
        this.setRightMouseTip(
            this.tips.length === 0 ? EAction.trCancel : EAction.trBack);
        EAction.showSnapTools();
        break;

    case Callout.State.PickingPosition:
        this.setCommandPrompt(qsTr("Pick where the note text goes"));
        this.setLeftMouseTip(qsTr("Position of the note text"));
        this.setRightMouseTip(EAction.trBack);
        EAction.showSnapTools();
        break;
    }
};

Callout.prototype.escapeEvent = function() {
    switch (this.state) {
    case Callout.State.PickingPosition:
        this.previewPos = undefined;
        this.setState(Callout.State.PickingTip);
        break;

    case Callout.State.PickingTip:
        if (this.tips.length > 0) {
            // step back over the tip picked last, so it can be
            // re-picked, rather than cancelling the whole command
            this.tips.pop();
            this.setState(Callout.State.PickingTip);
        } else {
            EAction.prototype.escapeEvent.call(this);
        }
        break;

    default:
        EAction.prototype.escapeEvent.call(this);
        break;
    }
};

Callout.prototype.enterEvent = function() {
    if (this.state === Callout.State.PickingTip) {
        if (this.tips.length === 0) {
            EAction.handleUserWarning(
                qsTr("Pick at least one arrow target first"));
            return;
        }
        this.setState(Callout.State.PickingPosition);
        return;
    }
    EAction.prototype.enterEvent.call(this);
};

/**
 * Handles both the real pick and its live preview, for both states --
 * the same split AlignImage.js uses for its own two coordinate states.
 */
Callout.prototype.pickCoordinate = function(event, preview) {
    var di = this.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    var pos = event.getModelPosition();

    switch (this.state) {
    case Callout.State.PickingTip:
        if (!preview) {
            this.tips.push({ x: pos.x, y: pos.y });
            di.setRelativeZero(pos);
            this.setState(Callout.State.PickingTip);  // refresh prompt, allow another
        }
        break;

    case Callout.State.PickingPosition:
        this.previewPos = pos;
        if (preview) {
            this.updatePreview();
        } else {
            this.position = { x: pos.x, y: pos.y };
            di.setRelativeZero(pos);
            this.finish();
        }
        break;
    }
};

/**
 * The live placement preview: the leader(s) that WOULD be drawn if the
 * note landed at the mouse's current position, using CsCallout.reflow
 * against a placeholder box centred there.
 *
 * This is exactly what reflow's `side` and `landing` are for -- code
 * review on Task 2 flagged them as unread outside CsCallout.js, and
 * this preview is where they earn their place: the caver sees, before
 * committing, which side of the note the arrows will leave from and
 * roughly where they will land, rather than finding out only after
 * placing the text and running CalloutSync. `side` is not drawn as its
 * own shape -- it is implicit in which edge of the placeholder box the
 * landing (and therefore every branch's last segment) sits on -- but
 * without reflow returning it there would be no principled way to
 * decide which edge that is; recomputing the auto-side rule a second
 * time here, differently, is exactly the kind of drift a single
 * pure function is supposed to prevent.
 *
 * Returns undefined (no preview) rather than throwing on any failure:
 * this runs on every mouse move, and a broken preview must degrade to
 * no preview, never abort the pick.
 */
Callout.prototype.getAuxPreview = function() {
    if (this.state !== Callout.State.PickingPosition ||
            isNull(this.previewPos) || this.tips.length === 0) {
        return undefined;
    }

    var doc = this.getDocument();
    if (isNull(doc)) {
        return undefined;
    }

    try {
        var height = CalloutWrite.textHeight(doc);
        var halfW = height * Callout.PreviewHalfWidthFactor;
        var pos = this.previewPos;
        var box = {
            x1: pos.x - halfW, y1: pos.y - height / 2.0,
            x2: pos.x + halfW, y2: pos.y + height / 2.0
        };

        var geom = CsCallout.reflow(box, this.tips, {
            side: "auto",
            dimasz: CalloutWrite.dimVar(doc, RS.DIMASZ),
            dimscale: CalloutWrite.dimVar(doc, RS.DIMSCALE)
        });

        var shapes = [];
        for (var b = 0; b < geom.branches.length; b++) {
            var pts = geom.branches[b];
            // tip -> elbow -> landing, as two segments, exactly the
            // vertices CalloutWrite.writeLeaders will give the real
            // leader once the text exists.
            shapes.push(new RLine(
                new RVector(pts[0].x, pts[0].y),
                new RVector(pts[1].x, pts[1].y)));
            shapes.push(new RLine(
                new RVector(pts[1].x, pts[1].y),
                new RVector(pts[2].x, pts[2].y)));
        }
        return shapes;
    } catch (ePreview) {
        return undefined;
    }
};

/** Ask for the note text and the style, then write the callout. */
Callout.prototype.finish = function() {
    var di = this.getDocumentInterface();
    if (isNull(di)) {
        this.terminate();
        return;
    }

    var asked = Callout.askForNote(this.style);
    if (isNull(asked)) {
        this.terminate();
        return;
    }

    // Re-resolve the document AFTER the modal dialog returns.
    // askForNote's dlg.exec() runs a nested Qt event loop; a document
    // handle captured before that must never be trusted afterwards --
    // a freed RDocument cannot be detected from script and touching one
    // SEGFAULTS. this.getDocument() re-resolves through EAction rather
    // than relying on a variable this closure would otherwise hold
    // across the dialog.
    var doc = this.getDocument();
    if (isNull(doc)) {
        this.terminate();
        return;
    }

    CalloutWrite.create(doc, di, {
        text: asked.text,
        position: this.position,
        tips: this.tips,
        style: asked.style,
        kind: CsCallout.KIND_TEXT,
        height: CalloutWrite.textHeight(doc)
    });

    this.terminate();
};

/**
 * The note text and style. Returns {text, style} or null if cancelled
 * (including "no dialog available and nothing usable was typed").
 *
 * QDialog + exec() works in this bridge (SurveyNotebook's dialogs are
 * the precedent, and this task's own probe confirmed QDialog, QLabel,
 * QLineEdit, QPushButton, QVBoxLayout and QHBoxLayout all construct).
 * QTableWidget does not exist and QTreeWidget/QListWidget are NOT
 * constructible -- `new QTreeWidget()` returns a convincing stub whose
 * every real method is undefined -- so this stays QLineEdit / QLabel /
 * QPushButton only, the same shape SurveyNotebook uses for the same
 * reason. Every construction and connect is wrapped: a bridge without
 * QDialog must degrade to a single-line prompt, not crash.
 *
 * Note the addWidget(w, 0, 0) / addLayout(l, 0) arity -- this bridge
 * wants the extra arguments.
 */
Callout.askForNote = function(currentStyle) {
    var styleNames = [];
    for (var sn in CsCallout.STYLES) {
        if (CsCallout.STYLES.hasOwnProperty(sn)) {
            styleNames.push(sn);
        }
    }

    // one connect failure on a critical control = unusable dialog
    var connectOk = function(signal, fn) {
        try {
            signal.connect(fn);
            return true;
        } catch (eCon) {
            return false;
        }
    };

    var state = { accepted: false };
    var chosen = { name: currentStyle || CsCallout.STYLE_DEFAULT };
    var edit;

    try {
        var dlg = new QDialog(getMainWindow());
        dlg.windowTitle = qsTr("Callout");
        var layout = new QVBoxLayout();

        layout.addWidget(new QLabel(qsTr(
            "Note text. It stays an ordinary text entity, so you can " +
            "edit it later by double-clicking it -- the arrows follow.")),
            0, 0);

        edit = new QLineEdit();
        layout.addWidget(edit, 0, 0);

        layout.addWidget(new QLabel(qsTr("Style:")), 0, 0);
        var styleRow = new QHBoxLayout();
        var buttons = [];
        for (var i = 0; i < styleNames.length; i++) {
            var b = new QPushButton(styleNames[i]);
            try {
                b.checkable = true;
                b.checked = (styleNames[i] === chosen.name);
            } catch (eChk) {
                // not checkable in this bridge: it still clicks, and a
                // click is all we actually need
            }
            styleRow.addWidget(b, 0, 0);
            buttons.push({ button: b, name: styleNames[i] });
        }
        layout.addLayout(styleRow, 0);

        var bar = new QHBoxLayout();
        var okBtn = new QPushButton(qsTr("Place"));
        var cancelBtn = new QPushButton(qsTr("Cancel"));
        bar.addStretch(1);
        bar.addWidget(okBtn, 0, 0);
        bar.addWidget(cancelBtn, 0, 0);
        layout.addLayout(bar, 0);
        dlg.setLayout(layout);

        for (var k = 0; k < buttons.length; k++) {
            (function(entry) {
                connectOk(entry.button.clicked, function() {
                    chosen.name = entry.name;
                    for (var j = 0; j < buttons.length; j++) {
                        try {
                            buttons[j].button.checked =
                                (buttons[j].name === entry.name);
                        } catch (eSet) {
                            // cosmetic only
                        }
                    }
                });
            })(buttons[k]);
        }

        var wired = connectOk(okBtn.clicked, function() {
            state.accepted = true;
            dlg.accept();
        });
        wired = connectOk(cancelBtn.clicked, function() {
            dlg.reject();
        }) && wired;
        if (!wired) {
            QMessageBox.warning(getMainWindow(), qsTr("Callout"),
                qsTr("This build's script bridge couldn't wire the " +
                    "dialog buttons. Nothing was placed."));
            return null;
        }

        // Decisions happen AFTER exec() returns, while the widgets are
        // certainly still alive.
        dlg.exec();
    } catch (eDlg) {
        // No QDialog in this bridge. The text is the half that cannot
        // be done any other way, so ask for that much and take the
        // default style.
        try {
            var typed2 = QInputDialog.getText(getMainWindow(),
                qsTr("Callout"), qsTr("Note text:"));
            if (typed2 !== null && typed2 !== undefined &&
                    String(typed2).length > 0) {
                return { text: String(typed2),
                         style: currentStyle || CsCallout.STYLE_DEFAULT };
            }
        } catch (eIn) {
            // nothing available: place nothing rather than place junk
        }
        return null;
    }

    if (!state.accepted) {
        return null;
    }
    var typed = edit.text;
    if (typed === null || typed === undefined ||
            String(typed).length === 0) {
        return null;
    }
    return { text: String(typed), style: chosen.name };
};

// Called once by QCAD at startup to register the menu item / button.
Callout.init = function(basePath) {
    var action = new RGuiAction(qsTr("Callout"),
                                RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/Callout.js");
    action.setIcon(basePath + "/Callout.svg");
    action.setStatusTip(qsTr("A note bound to one or more arrows, " +
        "which stays bound when you edit or move the text"));
    action.setDefaultCommands(["cscallout", "cscal"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(88);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
