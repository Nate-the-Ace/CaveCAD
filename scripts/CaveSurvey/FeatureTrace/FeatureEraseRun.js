// FeatureEraseRun.js -- click a line you drew and it goes.
//
// NOT an add-on QCAD can find, for FeatureTraceRun.js's reason:
// AddOn.getAddOns only ever builds an add-on from <dir>/<dir>.js, so
// this file's init() is called by FeatureTrace.init() instead.
//
// WHY A MODE AND NOT UNDO. A bad drag is not always the last thing you
// did. Trace five walls, notice the third one wandered, and Ctrl+Z
// three times costs the two good ones after it. This erases the one
// line you point at and leaves the rest standing.
//
// WHAT IT CAN REACH. Only the layers the Feature Trace panel itself
// draws on -- its own features in all three views, and the shaped lines
// with their ornament. The centerline, the stations, the LRUD, the
// scans and the dimensions live on CTRL- layers this never lists, so a
// click that lands near one of them cannot take it. That is the whole
// reason this exists rather than telling a caver to use QCAD's own
// Erase: the delete key does not know which linework is theirs.
//
// A MISS DELETES NOTHING. Not the nearest thing at any distance -- one
// foot of cave, the same distance the trace itself calls "the same end
// as that one", and past that the answer is "nothing there".

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function FeatureEraseRun(guiAction) {
    EAction.call(this, guiAction);
    this.savedSnap = null;
    // The layers this run may reach, set by whichever panel started it;
    // null means the Feature Trace set. One action serves both panels
    // because the ACT is identical -- click a thing of mine, it goes --
    // and only the list of what counts as "mine" differs.
    this.layers = null;
}

FeatureEraseRun.prototype = new EAction();

/**
 * Every layer this panel can draw on, in every view -- the list a click
 * is allowed to reach.
 *
 * DERIVED from the panel's own rows and the shaped-line registry, never
 * a hand-written list of names: a feature added to the panel is
 * erasable the day it appears, and a feature whose layer is renamed
 * cannot leave a stale name here pointing at nothing. The one thing a
 * hand-written list buys -- being readable in one place -- is what
 * makes it wrong six months later.
 */
FeatureEraseRun.layers = function() {
    var out = [];
    var seen = {};
    var add = function(name) {
        if (name === null || name === undefined || name === "" ||
                seen[name] === true) {
            return;
        }
        seen[name] = true;
        out.push(name);
    };
    var frames = ["plan", "profile", "section"];
    var i, f;
    if (typeof FeatureTrace !== "undefined" && !isNull(FeatureTrace.ROWS)) {
        for (i = 0; i < FeatureTrace.ROWS.length; i++) {
            var base = FeatureTrace.ROWS[i].layer;
            add(base);
            for (f = 0; f < frames.length; f++) {
                add(CsLayers.twinFor(base, frames[f]));
            }
        }
    }
    if (typeof CsShapeLine !== "undefined" && !isNull(CsShapeLine.STYLES)) {
        for (var key in CsShapeLine.STYLES) {
            if (!CsShapeLine.STYLES.hasOwnProperty(key)) {
                continue;
            }
            var spec = CsShapeLine.STYLES[key];
            for (f = 0; f < frames.length; f++) {
                var pair = CsShapeLine.layersFor(spec, frames[f]);
                add(pair.spine);
                add(pair.decor);
            }
        }
    }
    return out;
};

/**
 * Every layer the Symbol Palette can place on -- its own half of the
 * same question, derived from the catalogue rather than listed by hand
 * for the reason above.
 *
 * Symbols placed before a symbol's home layer was changed still sit on
 * the old one, and this cannot reach them. That is the same limitation
 * the tile's own hide/show carries and is better than the alternative:
 * a list wide enough to be sure of catching them would be wide enough
 * to catch things the palette never drew.
 */
FeatureEraseRun.symbolLayers = function(path) {
    var out = [];
    var seen = {};
    var frames = ["plan", "profile", "section"];
    var entries = [];
    try {
        entries = CsSymbols.merged(path).entries;
    } catch (eList) {
        entries = CsSymbols.CATALOG;
    }
    for (var i = 0; i < entries.length; i++) {
        var base = entries[i].layer;
        if (base === null || base === undefined || base === "") {
            continue;
        }
        var names = [base];
        for (var f = 0; f < frames.length; f++) {
            names.push(CsLayers.twinFor(base, frames[f]));
        }
        for (var n = 0; n < names.length; n++) {
            if (names[n] !== null && names[n] !== undefined &&
                    names[n] !== "" && seen[names[n]] !== true) {
                seen[names[n]] = true;
                out.push(names[n]);
            }
        }
    }
    return out;
};

/** The pick distance in DRAWING units: one foot of cave, whatever the
 *  drawing is measured in. */
FeatureEraseRun.tolerance = function(doc) {
    var unit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
    return CsTrace.spacingFor(unit) * CsErase.PICK_FEET;
};

FeatureEraseRun.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    // Snap off while erasing, as it is while tracing (CsTrace.suspendSnap
    // says why the setting is changed rather than the action triggered).
    // A snapped click reports the snapped point, so a click aimed at a
    // wall a foot from a station would be measured from the STATION and
    // erase whichever of the caver's lines is nearest to THAT.
    this.savedSnap = CsTrace.suspendSnap(this.getDocumentInterface());

    this.getDocumentInterface().setClickMode(RAction.PickCoordinate);
    this.setCrosshairCursor();
    EAction.showMainTool();
    this.setCommandPrompt(qsTr("Click a line you traced to erase it " +
        "(Escape to stop)"));
    EAction.handleUserMessage(qsTr("Erase: click your own linework to " +
        "remove it. The survey, its stations and your scans cannot be " +
        "erased this way."));
};

/** Whoever started the mode, told that it has ended -- however it
 *  ended: Escape, another tool taking over, the drawing closing. The
 *  panel button that turned it on un-presses itself here rather than
 *  in the click handler, because most of the ways out of a mode never
 *  reach the click handler at all. */
FeatureEraseRun.onEnd = null;

FeatureEraseRun.prototype.finishEvent = function() {
    EAction.prototype.finishEvent.call(this);
    CsTrace.restoreSnap(this.getDocumentInterface(), this.savedSnap);
    this.savedSnap = null;
    var ended = FeatureEraseRun.onEnd;
    FeatureEraseRun.onEnd = null;
    if (typeof ended === "function") {
        try {
            ended();
        } catch (eEnd) {
            // a panel that cannot un-press its own button must not
            // take the application down with it
        }
    }
};

FeatureEraseRun.prototype.mousePressEvent = function(event) {
    if (event.button() !== Qt.LeftButton) {
        return;
    }
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    if (isNull(doc) || isNull(di)) {
        return;
    }
    var p = event.getModelPosition();
    var result = CsErase.eraseAt(doc, di, { x: p.x, y: p.y },
        isNull(this.layers) ? FeatureEraseRun.layers() : this.layers,
        FeatureEraseRun.tolerance(doc));
    if (result === null) {
        // Named layers, not a shrug: a caver whose click did nothing is
        // owed the difference between "you missed" and "that line is not
        // one of mine".
        EAction.handleUserMessage(qsTr("Nothing of yours within a foot of " +
            "that click. Erase only removes features this panel drew."));
        return;
    }
    EAction.handleUserMessage(result.gone === 1 ?
        qsTr("Erased one thing on %1.").arg(result.layer) :
        qsTr("Erased one thing on %1, and the %2 pieces of ornament " +
            "along it.").arg(result.layer).arg(result.gone - 1));
};

/** The path this action was REGISTERED under, remembered at init.
 *
 *  Remembered rather than rebuilt by each caller: the Symbol Palette
 *  lives in another folder and would have to spell this one as
 *  ".../SymbolPalette/../FeatureTrace/FeatureEraseRun.js", and
 *  RGuiAction.getByScriptFile matches the string it was given. A
 *  lookup that misses returns null and the mode silently never starts. */
FeatureEraseRun.scriptPath = null;

/**
 * Starts Erase mode on `layers`, calling `onEnd` when it stops.
 *
 * Here rather than in each panel so that both get the same three
 * things: the registered path, a null-action check, and the end
 * callback armed BEFORE the action starts.
 *
 * \return true when the mode started
 */
FeatureEraseRun.start = function(di, layers, onEnd) {
    if (isNull(di) || FeatureEraseRun.scriptPath === null) {
        return false;
    }
    var eraseAction = RGuiAction.getByScriptFile(FeatureEraseRun.scriptPath);
    if (isNull(eraseAction)) {
        return false;
    }
    FeatureEraseRun.onEnd = (typeof onEnd === "function") ? onEnd : null;
    var run = new FeatureEraseRun(eraseAction);
    run.layers = isNull(layers) ? null : layers;
    di.setCurrentAction(run);
    return true;
};

FeatureEraseRun.init = function(basePath) {
    // No widget names, sort order or icon, for FeatureTraceRun.init's
    // reason: this action is reached from the panel, never from a menu.
    FeatureEraseRun.scriptPath = basePath + "/FeatureEraseRun.js";
    var eraseAction = new RGuiAction(qsTr("Erase Feature"),
        RMainWindowQt.getMainWindow());
    eraseAction.setRequiresDocument(true);
    eraseAction.setScriptFile(FeatureEraseRun.scriptPath);
};
