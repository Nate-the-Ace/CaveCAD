// SymbolPalette.js -- Symbol Palette: the menu entry and the docked
// panel that arms which cave symbol the next click places.
//
// The click and the aim-drag live in SymbolPaletteRun.js beside this
// file; drawing a new symbol lives in SymbolPaletteEdit.js. QCAD cannot
// find either on its own -- AddOn.getAddOns only builds an add-on from
// <dir>/<dir>.js -- so init() below registers both.
//
// Panel shape follows Feature Trace's dock, including the two details
// that are load-bearing rather than stylistic: the dock is BUILT during
// init() and left hidden (the main window's restoreState() runs after
// add-on init and can only place a dock that already exists), and every
// widget construction and connect is wrapped so a bridge refusal costs
// one control rather than the whole panel.
//
// WHAT THE PANEL IS FOR. The suite has known its 28 symbols since the
// beginning -- Core/CsSymbols.js names each one with its NSS name, its
// UIS alias, its home layer and its category -- but the only ways to
// put one on a map were to scatter breakdown or to print a legend. The
// vocabulary was there and there was no way to speak it. This is the
// front door: every symbol, grouped, with a picture of itself, one
// click to arm and one click to place.

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/SymbolPaletteRun.js");
include(includeBasePath + "/SymbolPaletteEdit.js");
// Feature Trace's erase action, borrowed rather than copied: the ACT is
// identical -- click a thing of mine and it goes -- and only the list of
// what counts as "mine" differs, which is a parameter. Two copies of a
// mouse mode is two places for its exit path to be wrong.
include(includeBasePath + "/../FeatureTrace/FeatureEraseRun.js");

function SymbolPalette(guiAction) {
    EAction.call(this, guiAction);
}

SymbolPalette.prototype = new EAction();

/** The armed catalogue entry, read by SymbolPaletteRun.
 *
 *  Module state, which is only safe because the panel SHOWS which tile
 *  is armed -- the same bargain Feature Trace makes. Undefined means
 *  nothing is armed, and a click in the drawing says so rather than
 *  guessing a symbol. */
SymbolPalette.armed = undefined;

/** The dock and the widgets the panel updates. Module-level singletons
 *  because there is one panel per application window. */
var csSymbolPaletteDock;
SymbolPalette.widgets = undefined;

/** The entries the panel last built itself from, in panel order.
 *  Kept so Edit and Delete can act on the armed symbol without asking
 *  the store again mid-click. */
SymbolPalette.entries = [];

// A GRID OF PICTURES, NOT A LIST OF NAMES.
//
// A symbol is a drawing, and a caver looking for the spring symbol is
// looking for the picture of a spring. Names alone would make the panel
// a glossary; the tile is the symbol, at the size it will be placed,
// with the name underneath.
SymbolPalette.GRID_COLUMNS = 3;
SymbolPalette.CELL_W = 84;
SymbolPalette.CELL_H = 76;
SymbolPalette.ICON = 30;

/** Roughly how many characters fit on one line of a tile's label. The
 *  tile does not wrap for itself, whichever widget it is. */
SymbolPalette.CELL_CHARS = 11;

/** A label broken over lines, greedily, on spaces. A single word longer
 *  than the budget is left alone: a mid-word break is harder to read
 *  than an overhang. */
SymbolPalette.wrapLabel = function(text, budget) {
    var words = String(text).split(" ");
    var lines = [];
    var line = "";
    for (var i = 0; i < words.length; i++) {
        if (line.length === 0) {
            line = words[i];
        } else if (line.length + 1 + words[i].length <= budget) {
            line += " " + words[i];
        } else {
            lines.push(line);
            line = words[i];
        }
    }
    if (line.length > 0) {
        lines.push(line);
    }
    return lines.join("\n");
};

/**
 * True when this entry matches the panel's search text.
 *
 * Matches the NSS name, the UIS alias AND the block name, all
 * case-insensitively: a caver types "gour" (UIS) as readily as
 * "rimstone" (NSS), and a symbol found by only one of its two names is
 * a symbol that looks missing.
 *
 * Pure, so the unit tests can hold it to that.
 */
SymbolPalette.matches = function(entry, needle) {
    if (isNull(needle) || String(needle).length === 0) {
        return true;
    }
    var n = String(needle).toLowerCase();
    var fields = [entry.nss, entry.uis, entry.block, entry.category];
    for (var i = 0; i < fields.length; i++) {
        if (isNull(fields[i])) {
            continue;
        }
        if (String(fields[i]).toLowerCase().indexOf(n) !== -1) {
            return true;
        }
    }
    return false;
};

/**
 * Groups entries by category, categories in first-appearance order.
 *
 * The shipped catalogue's order IS the grouping order, so the panel
 * reads the way the catalogue does; a custom symbol's category joins
 * the end if it is a new one, or its existing group if it is not.
 *
 * Pure.
 */
SymbolPalette.grouped = function(entries, needle) {
    var order = [];
    var byCategory = {};
    for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (!SymbolPalette.matches(entry, needle)) {
            continue;
        }
        var c = entry.category;
        if (!byCategory.hasOwnProperty(c)) {
            byCategory[c] = [];
            order.push(c);
        }
        byCategory[c].push(entry);
    }
    var out = [];
    for (var j = 0; j < order.length; j++) {
        out.push({ category: order[j], entries: byCategory[order[j]] });
    }
    return out;
};

/** The size the panel is asking for, in FEET of cave, or the default
 *  when the field holds nonsense.
 *
 *  FEET AND NOT A SCALE FACTOR. The blocks are drawn about a foot
 *  across and a cave map is a thousand feet across, so scale 1 is a
 *  speck; worse, one multiplier means a different size on every symbol,
 *  because the north arrow is three times the stalactite. Feet mean the
 *  same thing on every tile, and the same thing in a metric drawing --
 *  SymbolPaletteRun.perFoot converts. */
SymbolPalette.sizeValue = function() {
    var w = SymbolPalette.widgets;
    if (isNull(w) || isNull(w.sizeEdit)) {
        return SymbolPaletteRun.DEFAULT_SIZE_FEET;
    }
    try {
        var v = parseFloat(w.sizeEdit.text);
        if (isNaN(v) || v <= 0) {
            return SymbolPaletteRun.DEFAULT_SIZE_FEET;
        }
        return v;
    } catch (e) {
        return SymbolPaletteRun.DEFAULT_SIZE_FEET;
    }
};

/** The panel's angle in DEGREES, or 0. */
SymbolPalette.angleValue = function() {
    var w = SymbolPalette.widgets;
    if (isNull(w) || isNull(w.angleEdit)) {
        return 0.0;
    }
    try {
        var v = parseFloat(w.angleEdit.text);
        if (isNaN(v)) {
            return 0.0;
        }
        return v;
    } catch (e) {
        return 0.0;
    }
};

/** True when a drag sets the symbol's size as well as its angle.
 *  A panel that failed to build its checkbox answers TRUE -- the
 *  documented default -- rather than silently changing the gesture. */
SymbolPalette.dragScaleEnabled = function() {
    var w = SymbolPalette.widgets;
    if (isNull(w) || isNull(w.dragScaleCheck)) {
        return true;
    }
    try {
        return w.dragScaleCheck.checked === true;
    } catch (e) {
        return true;
    }
};

/**
 * Shows what the drag in progress is asking for.
 *
 * WRITTEN INTO THE FIELDS THEMSELVES, not into a separate readout. The
 * caver dragged a symbol out to a size and an angle; the two boxes that
 * name size and angle should then say what they placed it at, in the
 * feet the field is labelled in, and the next plain click uses exactly
 * those numbers. A drag is a way of typing in those fields with the
 * mouse.
 *
 * Called from a mouse-move handler, so it never throws.
 */
SymbolPalette.showDrag = function(sizeFeet, angleDeg) {
    var w = SymbolPalette.widgets;
    if (isNull(w)) {
        return;
    }
    try {
        if (!isNull(w.sizeEdit) && !isNull(sizeFeet)) {
            w.sizeEdit.text = String(sizeFeet.toFixed(1));
        }
        if (!isNull(w.angleEdit) && !isNull(angleDeg)) {
            var deg = angleDeg % 360;
            if (deg < 0) {
                deg += 360;
            }
            w.angleEdit.text = String(deg.toFixed(0));
        }
    } catch (e) {
    }
};

/**
 * Arms an entry and makes the panel show which one.
 *
 * The showing is not decoration. With no per-symbol menu command, an
 * entry held in module state is exactly the invisible mode a command
 * would have prevented; the checked tile IS the indicator.
 */
SymbolPalette.arm = function(entry) {
    SymbolPalette.armed = entry;
    var w = SymbolPalette.widgets;
    if (isNull(w) || isNull(w.buttons)) {
        return;
    }
    for (var i = 0; i < w.buttons.length; i++) {
        try {
            w.buttons[i].button.checked =
                (w.buttons[i].entry.block === entry.block);
        } catch (e) {
            // a button the bridge will not let us write back is still
            // armed correctly; only its appearance is wrong
        }
    }
    SymbolPalette.refreshCustomButtons();
};

/** Clears the armed symbol and every checked tile. */
/**
 * Arms the ONE symbol a search has left showing, and starts placing.
 *
 * Reads the TILES rather than re-running the filter: the tiles are what
 * the caver can see, and a second filtering pass here could disagree
 * with the one on screen -- which is how a shortcut arms something the
 * panel is not showing.
 */
SymbolPalette.armFiltered = function() {
    var w = SymbolPalette.widgets;
    if (isNull(w) || isNull(w.buttons)) {
        return;
    }
    if (w.buttons.length !== 1) {
        EAction.handleUserMessage(w.buttons.length === 0 ?
            qsTr("No symbol matches that.") :
            qsTr("%1 symbols still match. Type more of the name, then " +
                "press Return.").arg(w.buttons.length));
        return;
    }
    var entry = w.buttons[0].entry;
    SymbolPalette.arm(entry);
    SymbolPalette.startRun();
    EAction.handleUserMessage(qsTr("Armed %1. Click in the drawing to " +
        "place it.").arg(entry.nss));
};

SymbolPalette.disarm = function() {
    SymbolPalette.armed = undefined;
    var w = SymbolPalette.widgets;
    if (isNull(w) || isNull(w.buttons)) {
        return;
    }
    for (var i = 0; i < w.buttons.length; i++) {
        try {
            w.buttons[i].button.checked = false;
        } catch (e) {
        }
    }
    SymbolPalette.refreshCustomButtons();
};

/** Edit and Delete act on the armed symbol, and only a CUSTOM symbol
 *  can be either. The shipped 28 are code: an edited copy in the
 *  template would be silently taken back by the next release. */
SymbolPalette.refreshCustomButtons = function() {
    var w = SymbolPalette.widgets;
    if (isNull(w)) {
        return;
    }
    var custom = !isNull(SymbolPalette.armed) &&
        SymbolPalette.armed.custom === true;
    try {
        if (!isNull(w.editButton)) {
            w.editButton.enabled = custom;
        }
        if (!isNull(w.deleteButton)) {
            w.deleteButton.enabled = custom;
        }
    } catch (e) {
    }
};

/** The cursor readout: which view the cursor is in, and the layer a
 *  symbol dropped there would land on. Called from the run action's
 *  mouse-move, so it must never throw. */
SymbolPalette.showCursorFrame = function(frame, layer) {
    var w = SymbolPalette.widgets;
    if (isNull(w) || isNull(w.frameLabel)) {
        return;
    }
    try {
        var name = qsTr("plan");
        if (frame === "profile") {
            name = qsTr("elevation");
        } else if (frame === "section") {
            name = qsTr("cross section");
        }
        var text = qsTr("Cursor:  %1").arg(name);
        if (!isNull(layer) && String(layer).length > 0) {
            text += "  --  " + String(layer);
        }
        w.frameLabel.text = text;
    } catch (e) {
    }
};

// ---------------------------------------------------------------------
// Previews
// ---------------------------------------------------------------------

/**
 * An icon of one symbol, drawn from the block's own geometry.
 *
 * RENDERED AND NOT DRAWN BY HAND, so a symbol a caver invents this
 * afternoon has a picture this afternoon, and so a preview can never
 * drift from the block it names -- the two failures a folder of 28
 * hand-authored SVGs would have guaranteed.
 *
 * Every shape is reduced to a point cloud (RShape.getPointCloud, which
 * every shape type implements) and stroked as a polyline. That is
 * coarse for a preview and exactly right for a tile 34 pixels across;
 * it also means one code path covers lines, arcs, splines and
 * polylines rather than four.
 *
 * \return a QIcon, or null when this build's painter refuses -- the
 *         caller falls back to a text tile rather than to no tile.
 */
SymbolPalette.iconFor = function(shapes, size, penColor) {
    if (isNull(shapes) || shapes.length === 0) {
        return null;
    }
    // The drawing extent, so the symbol fills its tile whatever size it
    // is in cave units -- a 20 ft pit and a 6 in stalactite both come
    // out legible.
    var minX = null, minY = null, maxX = null, maxY = null;
    var clouds = [];
    var i, j;
    for (i = 0; i < shapes.length; i++) {
        var pts = null;
        try {
            pts = shapes[i].getPointCloud(0.05);
        } catch (eCloud) {
            pts = null;
        }
        if (isNull(pts) || pts.length < 2) {
            continue;
        }
        var cloud = [];
        for (j = 0; j < pts.length; j++) {
            var x = pts[j].x, y = pts[j].y;
            cloud.push({ x: x, y: y });
            if (minX === null || x < minX) { minX = x; }
            if (maxX === null || x > maxX) { maxX = x; }
            if (minY === null || y < minY) { minY = y; }
            if (maxY === null || y > maxY) { maxY = y; }
        }
        clouds.push(cloud);
    }
    if (clouds.length === 0 || minX === null) {
        return null;
    }

    var w = maxX - minX, h = maxY - minY;
    var margin = 3;
    var span = Math.max(w, h);
    // A symbol that is a single horizontal or vertical stroke has one
    // zero extent; scaling by it would be a division by zero and a
    // blank tile.
    var factor = (span <= 0) ? 1.0 : (size - 2 * margin) / span;
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;

    try {
        var pixmap = new QPixmap(size, size);
        pixmap.fill(new QColor(0, 0, 0, 0));
        var painter = new QPainter();
        painter.begin(pixmap);
        try {
            painter.setRenderHint(QPainter.Antialiasing, true);
        } catch (eHint) {
        }
        var pen = new QPen(isNull(penColor) ? new QColor(30, 30, 30) :
            penColor);
        pen.setWidth(1);
        painter.setPen(pen);
        for (i = 0; i < clouds.length; i++) {
            for (j = 0; j < clouds[i].length - 1; j++) {
                var a = clouds[i][j], b = clouds[i][j + 1];
                // y is flipped: drawing space counts up, a pixmap counts
                // down, and a symbol drawn upside down is a different
                // symbol (a stalactite is a stalagmite).
                painter.drawLine(
                    size / 2 + (a.x - cx) * factor,
                    size / 2 - (a.y - cy) * factor,
                    size / 2 + (b.x - cx) * factor,
                    size / 2 - (b.y - cy) * factor);
            }
        }
        painter.end();
        return new QIcon(pixmap);
    } catch (ePaint) {
        return null;
    }
};

/**
 * Every symbol's shapes, read once out of the template.
 *
 * One open of the template for the whole panel rather than one per
 * tile: the file is a full DXF import, and 28 of them would be felt.
 *
 * \return { byBlock: {name: [shapes]}, error }
 */
SymbolPalette.loadShapes = function() {
    var out = { byBlock: {}, error: "" };
    // BOTH FILES, the caver's library first so their own version of a
    // symbol is the one pictured. One open each, for the whole panel.
    var places = [CsSymbolStore.customPath(), CsSymbolStore.templatePath()];
    var opened = 0;
    for (var p = 0; p < places.length; p++) {
        if (isNull(places[p])) {
            continue;
        }
        try {
            if (!new QFileInfo(places[p]).exists()) {
                continue;
            }
        } catch (eEx) {
            continue;
        }
        var di = CsSymbolStore.openOffscreen(places[p]);
        if (di === null) {
            continue;
        }
        opened++;
        var doc = di.getDocument();
        var names = doc.getBlockNames();
        for (var i = 0; i < names.length; i++) {
            var name = String(names[i]);
            if (name.indexOf(CsSymbolStore.PREFIX) !== 0) {
                continue;
            }
            if (out.byBlock.hasOwnProperty(name)) {
                continue;   // the library's copy already answered
            }
            var entities = CsSymbolStore.geometryOf(doc, name);
            var shapes = [];
            for (var j = 0; j < entities.length; j++) {
                try {
                    var got = entities[j].getShapes();
                    for (var k = 0; k < got.length; k++) {
                        shapes.push(got[k]);
                    }
                } catch (eShape) {
                }
            }
            out.byBlock[name] = shapes;
        }
    }
    if (opened === 0) {
        out.error = "no symbol files could be read";
    }
    return out;
};

// ---------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------

/** Arms an entry and starts the placement action. Its own function so
 *  the closure captures ONE entry rather than the loop variable. */
SymbolPalette.connectTile = function(button, entry) {
    button.clicked.connect(function() {
        SymbolPalette.arm(entry);
        SymbolPalette.startRun();
    });
};

/**
 * The right-click menu on a tile.
 *
 * WHAT IS ON IT, and why each earns its place:
 *
 *   Place            what a left-click does, said out loud -- a menu
 *                    that cannot do the ordinary thing reads as a menu
 *                    for exceptions only.
 *   Edit...          the caver's own symbol, reopened for redrawing.
 *   Rename...        its NAME, alias, category and home layer, without
 *                    redrawing a line. A symbol saved into the wrong
 *                    category used to mean drawing it again.
 *   Duplicate...     copy ANY symbol -- the shipped 28 included -- into
 *                    the library under a new name. This is the answer
 *                    to "I want the stalactite, but mine": the shipped
 *                    ones cannot be edited, and now they do not have to
 *                    be redrawn from nothing either.
 *   Delete...        the caver's own, gone from the library.
 *
 * A shipped symbol offers Place and Duplicate; the other three are
 * disabled with the reason in their tooltip, rather than hidden, so the
 * menu does not change shape under the cursor.
 *
 * popup(), never exec(): exec blocks, and a menu that owns the event
 * loop while a caver is mid-gesture is how a panel hangs. The menu is
 * kept on the widget bag so it is not collected while it is open --
 * SketchScans learned that one first.
 */
SymbolPalette.connectTileMenu = function(button, entry) {
    try {
        button.contextMenuPolicy = Qt.CustomContextMenu;
    } catch (ePolicy) {
        return;
    }
    button.customContextMenuRequested.connect(function(pos) {
        try {
            var w = SymbolPalette.widgets;
            var custom = (entry.custom === true);
            var menu = new QMenu();

            var place = menu.addAction(qsTr("Place"));
            place.triggered.connect(function() {
                SymbolPalette.arm(entry);
                SymbolPalette.startRun();
            });
            menu.addSeparator();

            var edit = menu.addAction(qsTr("Edit..."));
            edit.enabled = custom;
            edit.triggered.connect(function() {
                SymbolPaletteEdit.startEdit(entry);
            });

            var rename = menu.addAction(qsTr("Rename / Recategorise..."));
            rename.enabled = custom;
            rename.triggered.connect(function() {
                SymbolPalette.renameSymbol(entry);
            });

            var dup = menu.addAction(qsTr("Duplicate as New Symbol..."));
            dup.triggered.connect(function() {
                SymbolPalette.duplicateSymbol(entry);
            });

            menu.addSeparator();
            var del = menu.addAction(qsTr("Delete..."));
            del.enabled = custom;
            del.triggered.connect(function() {
                SymbolPalette.arm(entry);
                SymbolPalette.deleteArmed();
            });

            if (!custom) {
                try {
                    var why = qsTr("%1 is one of the symbols CaveCAD " +
                        "ships. Duplicate it to make your own version.")
                        .arg(entry.nss);
                    edit.toolTip = why;
                    rename.toolTip = why;
                    del.toolTip = why;
                } catch (eTip) {
                }
            }

            // Kept alive on the widget bag: popup() returns at once, and
            // a menu the collector takes mid-display simply vanishes.
            if (!isNull(w)) {
                w.tileMenu = menu;
            }
            menu.popup(button.mapToGlobal(pos));
        } catch (eMenu) {
            // no context menu on this bridge: every one of these is
            // still reachable from the buttons below the tiles
        }
    });
};

/**
 * Renames a custom symbol, or moves it to another category or layer.
 *
 * The BLOCK NAME never changes -- every already-placed instance in
 * every drawing points at it, and a rename that broke those would be a
 * rename that eats work. What changes is the marker: the display name,
 * the alias, the category and the home layer.
 */
SymbolPalette.renameSymbol = function(entry) {
    if (isNull(entry) || entry.custom !== true) {
        return;
    }
    var meta = SymbolPaletteEdit.askMeta(entry);
    if (meta === null) {
        return;
    }
    if (meta.nss === "") {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Rename Symbol"), qsTr("A symbol needs a name."));
        return;
    }
    var found = CsSymbolStore.geometryFor(entry.block);
    if (found === null) {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Rename Symbol"),
            qsTr("%1's drawing could not be found, so it cannot be " +
                "renamed.").arg(entry.nss));
        return;
    }
    var res = CsSymbolStore.saveBlock(null, entry.block, found.doc,
        found.entities, meta);
    if (!res.ok) {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Rename Symbol"), res.error);
        return;
    }
    EAction.handleUserMessage(qsTr("%1 is now %2, in %3.")
        .arg(entry.nss).arg(meta.nss).arg(meta.category));
    CsSymbolStore.invalidate();
    SymbolPalette.disarm();
    SymbolPalette.rebuildTiles();
};

/**
 * Copies a symbol into the library under a new name.
 *
 * THE WAY TO CHANGE A SHIPPED SYMBOL. The 28 cannot be edited -- the
 * next release would take the change back -- which used to mean a
 * caver who wanted "that, but with a longer tail" started from a blank
 * editor. Now they start from the symbol.
 */
SymbolPalette.duplicateSymbol = function(entry) {
    if (isNull(entry)) {
        return;
    }
    var found = CsSymbolStore.geometryFor(entry.block);
    if (found === null) {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Duplicate Symbol"),
            qsTr("%1's drawing could not be found, so there is nothing " +
                "to copy.").arg(entry.nss));
        return;
    }
    var seed = { nss: entry.nss + qsTr(" (mine)"), uis: entry.uis,
        category: entry.category, layer: entry.layer };
    var meta = SymbolPaletteEdit.askMeta(seed);
    if (meta === null) {
        return;
    }
    if (meta.nss === "") {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Duplicate Symbol"), qsTr("A symbol needs a name."));
        return;
    }
    var blockName = CsSymbolStore.blockNameFor(meta.nss);
    if (blockName === null) {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Duplicate Symbol"),
            qsTr("That name has no letters or numbers in it, so it " +
                "cannot become a block name. Try another."));
        return;
    }
    var merged = CsSymbols.merged();
    for (var i = 0; i < merged.entries.length; i++) {
        if (merged.entries[i].block === blockName) {
            QMessageBox.warning(RMainWindowQt.getMainWindow(),
                qsTr("Duplicate Symbol"),
                qsTr("There is already a symbol called %1 (%2). Give " +
                    "this one a different name.")
                    .arg(merged.entries[i].nss).arg(blockName));
            return;
        }
    }
    var res = CsSymbolStore.saveBlock(null, blockName, found.doc,
        found.entities, meta);
    if (!res.ok) {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Duplicate Symbol"), res.error);
        return;
    }
    EAction.handleUserMessage(qsTr("%1 copied to your library as %2 -- " +
        "Edit it to make it yours.").arg(entry.nss).arg(meta.nss));
    CsSymbolStore.invalidate();
    SymbolPalette.rebuildTiles();
    var listed = CsSymbols.merged();
    for (i = 0; i < listed.entries.length; i++) {
        if (listed.entries[i].block === blockName) {
            SymbolPalette.arm(listed.entries[i]);
        }
    }
};

/** One category, as a group box full of tiles. */
/** Where the collapsed categories are remembered between sessions.
 *  The FOLDING itself lives in Core/CsPanel.js, shared with Feature
 *  Trace -- Nathan's standing ask (2026-09-07): a panel feature asked
 *  for in one of these panels belongs in both, and the way to keep that
 *  promise is one copy of the code rather than a good memory. */
SymbolPalette.COLLAPSED_SETTING = "CaveSurvey/SymbolPaletteCollapsed";

/** The collapsed set, through the shared helper. */
SymbolPalette.loadCollapsed = function() {
    return CsPanel.loadCollapsed(SymbolPalette.COLLAPSED_SETTING);
};

SymbolPalette.buildGroup = function(w, parent, group, shapes, collapsed) {
    // The folding -- and the right-click Move Up / Move Down on the
    // header -- are CsPanel's, shared with Feature Trace.
    var section = CsPanel.section(parent, group.category,
        SymbolPalette.COLLAPSED_SETTING, collapsed);
    var inner = new QGridLayout();
    var cell = 0;
    for (var i = 0; i < group.entries.length; i++) {
        var entry = group.entries[i];
        try {
            // A TOOL BUTTON, not a push button. A QPushButton lays its
            // icon and its text side by side and there is no way to
            // stack them, so a 30px picture and a name shared one line
            // and the name came out as "Entran" and "Dom" -- seen in
            // the first live GUI check, 2026-09-06. QToolButton stacks
            // them, which is what a palette tile has always looked
            // like.
            var button = new QToolButton();
            button.text = SymbolPalette.wrapLabel(entry.nss,
                SymbolPalette.CELL_CHARS);
            try {
                button.toolButtonStyle = Qt.ToolButtonTextUnderIcon;
            } catch (eStyle) {
                // a bridge without the enum gets a text-beside-icon
                // tile, which is the old look and still usable
            }
            button.checkable = true;
            var tip = entry.nss;
            if (!isNull(entry.uis) && entry.uis !== "" &&
                    entry.uis !== entry.nss) {
                tip += "  (UIS: " + entry.uis + ")";
            }
            tip += "\n" + entry.block + "  ->  " + entry.layer;
            if (entry.custom === true) {
                tip += "\n" + qsTr("Your own symbol -- Edit and Delete " +
                    "work on this one.");
            }
            button.toolTip = tip;
            var icon = SymbolPalette.iconFor(shapes[entry.block],
                SymbolPalette.ICON, null);
            if (icon !== null) {
                try {
                    button.icon = icon;
                    button.iconSize = new QSize(SymbolPalette.ICON,
                        SymbolPalette.ICON);
                } catch (eIcon) {
                    // a tile with no picture still says its name
                }
            }
            try {
                button.setFixedSize(SymbolPalette.CELL_W,
                    SymbolPalette.CELL_H);
            } catch (eSize) {
                // a bridge without setFixedSize gets tiles that stretch;
                // the grid still reads as a grid
            }
            SymbolPalette.connectTile(button, entry);
            SymbolPalette.connectTileMenu(button, entry);
            inner.addWidget(button,
                Math.floor(cell / SymbolPalette.GRID_COLUMNS),
                cell % SymbolPalette.GRID_COLUMNS);
            cell++;
            w.buttons.push({ button: button, entry: entry });
        } catch (e) {
            w.problems.push(entry.block + " (" + e + ")");
        }
    }
    try {
        // Fixed-size tiles in a stretching grid would drift apart as the
        // dock widens; the stretch goes to a column PAST the last one.
        inner.setColumnStretch(SymbolPalette.GRID_COLUMNS, 1);
    } catch (eStretch) {
    }
    try {
        inner.setContentsMargins(2, 2, 2, 2);
    } catch (eMargins) {
    }
    section.host.setLayout(inner);
    return section;
};

/**
 * Rebuilds the tiles from the current catalogue and search text.
 *
 * Tears the tile area down and builds it again rather than hiding
 * rows: the merged catalogue can GAIN a symbol (a save) and LOSE one (a
 * delete) while the panel is open, and a hide-only filter would leave a
 * deleted symbol clickable.
 */
SymbolPalette.rebuildTiles = function() {
    var w = SymbolPalette.widgets;
    if (isNull(w) || isNull(w.tileHost)) {
        return;
    }
    var armedBlock = isNull(SymbolPalette.armed) ? null :
        SymbolPalette.armed.block;

    try {
        // Delete the old boxes. Reparenting to null and calling
        // deleteLater is how a script drops a widget in this bridge;
        // hiding them would leave their buttons connected and armable.
        for (var i = 0; i < w.groupBoxes.length; i++) {
            try {
                w.groupBoxes[i].setParent(null);
                w.groupBoxes[i].deleteLater();
            } catch (eDel) {
            }
        }
    } catch (eClear) {
    }
    w.groupBoxes = [];
    w.buttons = [];

    // A symbol drawn before the library existed still lives in the
    // template, where the next release will overwrite it. Moving it is
    // safe to do here and costs nothing when there is nothing to move,
    // which is every rebuild after the first.
    try {
        var moved = CsSymbolStore.migrateFromTemplate();
        if (moved.moved.length > 0) {
            EAction.handleUserMessage(qsTr("Moved %1 of your own symbols " +
                "out of the cave template and into your symbol library, " +
                "where a CaveCAD update cannot overwrite them: %2")
                .arg(moved.moved.length).arg(moved.moved.join(", ")));
        }
    } catch (eMigrate) {
        // a migration that cannot run leaves the symbols where they
        // are, which is exactly where they were working from before
    }

    var merged = CsSymbols.merged();
    SymbolPalette.entries = merged.entries;
    if (!merged.ok && !isNull(w.problemLabel)) {
        try {
            w.problemLabel.text = merged.error;
            w.problemLabel.visible = true;
        } catch (eProb) {
        }
    } else if (!isNull(w.problemLabel)) {
        try {
            w.problemLabel.visible = false;
        } catch (eProb2) {
        }
    }

    var shapes = SymbolPalette.loadShapes().byBlock;
    var needle = "";
    try {
        needle = isNull(w.searchEdit) ? "" : String(w.searchEdit.text);
    } catch (eSearch) {
    }

    var groups = SymbolPalette.grouped(merged.entries, needle);
    // The caver's own order of the categories, when they have set one.
    // A search does not reorder anything -- it filters -- so the stack
    // is built either way and simply has fewer sections in it.
    w.stack = CsPanel.stack(w.tileLayout,
        SymbolPalette.COLLAPSED_SETTING, 0, function() {
            SymbolPalette.rebuildTiles();
        });
    // A SEARCH OPENS EVERYTHING. A caver typing "gour" wants to be
    // shown it, not to be told it is inside a group they collapsed
    // last week -- and the collapsed set is left alone, so clearing the
    // search puts the panel back the way they had it.
    var collapsed = (needle === "") ? SymbolPalette.loadCollapsed() : {};
    for (var g = 0; g < groups.length; g++) {
        try {
            var section = SymbolPalette.buildGroup(w, w.tileHost, groups[g],
                shapes, collapsed);
            w.tileLayout.addWidget(section.box, 0, 0);
            w.groupBoxes.push(section.box);
            CsPanel.stackAdd(w.stack, section, groups[g].category);
        } catch (eGroup) {
            w.problems.push(groups[g].category + " (" + eGroup + ")");
        }
    }
    try {
        CsPanel.applyOrder(w.stack);
    } catch (eOrder) {
        w.problems.push("category order (" + eOrder + ")");
    }

    // Re-arm what was armed, if it is still in the list: a search that
    // hides the armed tile must not silently disarm the tool mid-job.
    if (armedBlock !== null) {
        for (var b = 0; b < w.buttons.length; b++) {
            if (w.buttons[b].entry.block === armedBlock) {
                try {
                    w.buttons[b].button.checked = true;
                } catch (eRe) {
                }
            }
        }
    }
    SymbolPalette.refreshCustomButtons();
};

SymbolPalette.buildDock = function(appWin) {
    var dock = new QDockWidget(qsTr("Symbol Palette"), appWin);
    // Without an objectName restoreState() cannot identify the dock and
    // silently forgets where it was.
    dock.objectName = "CaveSurveySymbolPaletteDock";

    var w = { problems: [], buttons: [], groupBoxes: [] };
    var body = new QWidget(dock);
    var layout = new QVBoxLayout();

    // -- cursor frame readout ----------------------------------------
    try {
        w.frameLabel = new QLabel(qsTr("Cursor:  --"));
        layout.addWidget(w.frameLabel, 0, 0);
    } catch (eFrame) {
        w.problems.push("cursor frame readout (" + eFrame + ")");
    }

    // -- scale and angle ---------------------------------------------
    try {
        var settings = new QHBoxLayout();
        settings.addWidget(new QLabel(qsTr("Size")), 0, 0);
        w.sizeEdit = new QLineEdit(
            String(SymbolPaletteRun.DEFAULT_SIZE_FEET));
        w.sizeEdit.maximumWidth = 50;
        w.sizeEdit.toolTip = qsTr("How big the symbol is placed, across, " +
            "in FEET of cave -- converted for a metric drawing. Feet " +
            "rather than a scale factor because the blocks are drawn " +
            "about a foot wide and a cave map is a thousand feet wide, so " +
            "\"scale 1\" is a speck, and the same factor is a different " +
            "size on every symbol.");
        settings.addWidget(w.sizeEdit, 0, 0);
        settings.addWidget(new QLabel(qsTr("ft")), 0, 0);

        settings.addWidget(new QLabel(qsTr("Angle")), 0, 0);
        w.angleEdit = new QLineEdit("0");
        w.angleEdit.maximumWidth = 50;
        w.angleEdit.toolTip = qsTr("The angle a plain CLICK places at, in " +
            "degrees. Dragging away from the click point aims the symbol " +
            "instead and overrides this.");
        settings.addWidget(w.angleEdit, 0, 0);
        settings.addWidget(new QLabel(qsTr("deg")), 1, 0);
        layout.addLayout(settings, 0);
    } catch (eSettings) {
        w.problems.push("scale/angle (" + eSettings + ")");
    }

    // -- what a drag sets ---------------------------------------------
    //
    // ON BY DEFAULT: dragging out from the press point sets the size as
    // well as the angle, and the distance dragged IS the symbol's
    // radius, so the cursor sits on the edge of what will be placed.
    // Switching it off leaves the drag aiming only, which is what a row
    // of flow arrows that must all stay one size needs.
    try {
        w.dragScaleCheck = new QCheckBox(qsTr("Drag sets size too"));
        w.dragScaleCheck.checked = true;
        w.dragScaleCheck.toolTip = qsTr("While you drag, the distance " +
            "from where you pressed becomes the symbol's radius, so you " +
            "size and aim it in one gesture. Switch this off to aim only " +
            "and keep the Size above.");
        layout.addWidget(w.dragScaleCheck, 0, 0);
    } catch (eDragScale) {
        w.problems.push("drag-sets-size box (" + eDragScale + ")");
    }

    // -- search ------------------------------------------------------
    try {
        w.searchEdit = new QLineEdit("");
        w.searchEdit.toolTip = qsTr("Filter by name. Both names are " +
            "searched -- \"gour\" finds the rimstone dam as surely as " +
            "\"rimstone\" does.");
        try {
            w.searchEdit.placeholderText = qsTr("Search symbols");
        } catch (ePlace) {
        }
        w.searchEdit.textChanged.connect(function(text) {
            try {
                SymbolPalette.rebuildTiles();
            } catch (eFilter) {
                // never throw out of a signal handler
            }
        });
        // ENTER ARMS what the search narrowed to -- the keyboard route
        // into a palette of thirty-odd symbols, and Feature Trace's
        // twin of the same thing. Only when ONE tile is left: arming
        // the first of four matches is a coin flip dressed as a
        // shortcut, and nothing on screen would say which it picked.
        try {
            w.searchEdit.returnPressed.connect(function() {
                try {
                    SymbolPalette.armFiltered();
                } catch (eArm) {
                }
            });
        } catch (eReturn) {
            w.problems.push("search box Return (" + eReturn + ")");
        }
        layout.addWidget(w.searchEdit, 0, 0);
    } catch (eSearchBox) {
        w.problems.push("search box (" + eSearchBox + ")");
    }

    // -- a place to say the template could not be read ---------------
    try {
        w.problemLabel = new QLabel("");
        w.problemLabel.wordWrap = true;
        w.problemLabel.visible = false;
        layout.addWidget(w.problemLabel, 0, 0);
    } catch (eProblem) {
        w.problems.push("problem label (" + eProblem + ")");
    }

    // -- the tiles, in a scroll area ---------------------------------
    //
    // Scrolling and not a taller dock: 28 symbols in nine categories is
    // longer than any screen, and a panel whose bottom half cannot be
    // reached hides exactly the symbols nobody remembers the names of.
    try {
        w.tileHost = new QWidget();
        w.tileLayout = new QVBoxLayout();
        w.tileHost.setLayout(w.tileLayout);
        var scroll = new QScrollArea();
        scroll.setWidget(w.tileHost);
        scroll.setWidgetResizable(true);
        layout.addWidget(scroll, 1, 0);
    } catch (eScroll) {
        w.problems.push("symbol area (" + eScroll + ")");
    }

    // -- the caver's own symbols -------------------------------------
    try {
        var custom = new QHBoxLayout();
        w.newButton = new QPushButton(qsTr("New Symbol..."));
        w.newButton.toolTip = qsTr("Draw a symbol of your own. Opens a " +
            "drawing to draw it in; saving adds it to this palette and to " +
            "the cave template.");
        w.newButton.clicked.connect(function() {
            try {
                SymbolPaletteEdit.startNew();
            } catch (eNew) {
                EAction.handleUserWarning("Symbol Palette: could not open the symbol " +
                    "editor (" + eNew + ").");
            }
        });
        custom.addWidget(w.newButton, 1, 0);

        w.editButton = new QPushButton(qsTr("Edit"));
        w.editButton.enabled = false;
        w.editButton.toolTip = qsTr("Reopen your own symbol to change it. " +
            "The symbols the suite ships cannot be edited -- an edited " +
            "copy would be replaced by the next CaveCAD update.");
        w.editButton.clicked.connect(function() {
            try {
                SymbolPaletteEdit.startEdit(SymbolPalette.armed);
            } catch (eEdit) {
                EAction.handleUserWarning("Symbol Palette: could not open that symbol (" +
                    eEdit + ").");
            }
        });
        custom.addWidget(w.editButton, 0, 0);

        w.deleteButton = new QPushButton(qsTr("Delete"));
        w.deleteButton.enabled = false;
        w.deleteButton.toolTip = qsTr("Remove your own symbol from the " +
            "template. Drawings that already use it keep their own copy.");
        w.deleteButton.clicked.connect(function() {
            try {
                SymbolPalette.deleteArmed();
            } catch (eDel) {
                EAction.handleUserWarning("Symbol Palette: could not delete that symbol (" +
                    eDel + ").");
            }
        });
        custom.addWidget(w.deleteButton, 0, 0);
        layout.addLayout(custom, 0);
    } catch (eCustom) {
        w.problems.push("custom symbol buttons (" + eCustom + ")");
    }

    // -- the editor row ----------------------------------------------
    //
    // BUILT ONCE AND HIDDEN, never created on demand. Widgets made
    // while the panel is already live are the shape this bridge is
    // least reliable about, and an editor whose Save button failed to
    // construct would strand a caver with a drawing and no way to keep
    // it.
    try {
        w.editorLabel = new QLabel("");
        w.editorLabel.wordWrap = true;
        w.editorLabel.visible = false;
        layout.addWidget(w.editorLabel, 0, 0);

        var editorRow = new QHBoxLayout();
        w.saveSymbolButton = new QPushButton(qsTr("Save Symbol"));
        w.saveSymbolButton.toolTip = qsTr("Write what is in the symbol " +
            "editor into the cave template, and add it to this palette.");
        w.saveSymbolButton.visible = false;
        w.saveSymbolButton.clicked.connect(function() {
            try {
                SymbolPaletteEdit.save();
            } catch (eSave) {
                EAction.handleUserWarning("Symbol Palette: the symbol could not be saved (" +
                    eSave + ").");
            }
        });
        editorRow.addWidget(w.saveSymbolButton, 1, 0);

        w.cancelSymbolButton = new QPushButton(qsTr("Cancel"));
        w.cancelSymbolButton.toolTip = qsTr("Stop editing. The drawing " +
            "stays open -- nothing you drew is thrown away.");
        w.cancelSymbolButton.visible = false;
        w.cancelSymbolButton.clicked.connect(function() {
            try {
                SymbolPaletteEdit.cancel();
            } catch (eCancel) {
            }
        });
        editorRow.addWidget(w.cancelSymbolButton, 0, 0);
        layout.addLayout(editorRow, 0);
    } catch (eEditor) {
        w.problems.push("editor row (" + eEditor + ")");
    }

    // -- taking a placement back -------------------------------------
    try {
        var undoRow = CsPanel.undoRow(body, SymbolPalette.deleteLast,
            SymbolPalette.toggleErase);
        w.eraseButton = undoRow.eraseButton;
        layout.addLayout(undoRow.row, 0);
    } catch (eUndo) {
        w.problems.push("erase controls (" + eUndo + ")");
    }

    body.setLayout(layout);
    dock.setWidget(body);
    SymbolPalette.widgets = w;

    try {
        SymbolPalette.rebuildTiles();
    } catch (eBuild) {
        w.problems.push("symbol tiles (" + eBuild + ")");
    }

    if (w.problems.length > 0) {
        EAction.handleUserWarning("Symbol Palette: this CaveCAD build refused part of the " +
            "panel -- " + w.problems.join("; ") + ". Please report this.");
    }
    return dock;
};

/** Deletes the armed custom symbol, after asking. */
SymbolPalette.deleteArmed = function() {
    var entry = SymbolPalette.armed;
    if (isNull(entry) || entry.custom !== true) {
        return;
    }
    var answer = QMessageBox.question(
        RMainWindowQt.getMainWindow(), qsTr("Delete Symbol"),
        qsTr("Remove %1 from the cave template?\n\nDrawings that already " +
            "use it keep their own copy of the symbol; new drawings will " +
            "not have it.").arg(entry.nss),
        QMessageBox.Yes | QMessageBox.No);
    if (answer !== QMessageBox.Yes) {
        return;
    }
    var res = CsSymbolStore.deleteBlock(null, entry.block);
    if (!res.ok) {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Delete Symbol"), res.error);
        return;
    }
    SymbolPalette.disarm();
    SymbolPalette.rebuildTiles();
};

/**
 * Shows the Save Symbol / Cancel row and says what is being edited.
 *
 * The tiles stay where they are rather than being swapped out: a caver
 * drawing a new drip symbol is helped by seeing the drip symbols that
 * already exist, and a panel that empties itself mid-task looks broken.
 */
SymbolPalette.enterEditorMode = function(message) {
    var w = SymbolPalette.widgets;
    if (isNull(w)) {
        return;
    }
    try {
        if (!isNull(w.editorLabel)) {
            w.editorLabel.text = message;
            w.editorLabel.visible = true;
        }
        if (!isNull(w.saveSymbolButton)) {
            w.saveSymbolButton.visible = true;
        }
        if (!isNull(w.cancelSymbolButton)) {
            w.cancelSymbolButton.visible = true;
        }
        if (!isNull(w.newButton)) {
            w.newButton.enabled = false;
        }
    } catch (e) {
    }
    try {
        // The dock has to be VISIBLE for its Save button to be pressable,
        // and New Symbol can be reached from a panel the caver then hides.
        var dock = SymbolPalette.ensureDock();
        dock.visible = true;
    } catch (eShow) {
    }
};

/** Puts the panel back into placing mode. */
SymbolPalette.leaveEditorMode = function() {
    var w = SymbolPalette.widgets;
    if (isNull(w)) {
        return;
    }
    try {
        if (!isNull(w.editorLabel)) {
            w.editorLabel.visible = false;
        }
        if (!isNull(w.saveSymbolButton)) {
            w.saveSymbolButton.visible = false;
        }
        if (!isNull(w.cancelSymbolButton)) {
            w.cancelSymbolButton.visible = false;
        }
        if (!isNull(w.newButton)) {
            w.newButton.enabled = true;
        }
    } catch (e) {
    }
};

/** Builds the dock and hands it to the main window. Idempotent. */
SymbolPalette.ensureDock = function() {
    if (csSymbolPaletteDock !== undefined && csSymbolPaletteDock !== null) {
        return csSymbolPaletteDock;
    }
    var appWin = RMainWindowQt.getMainWindow();
    csSymbolPaletteDock = SymbolPalette.buildDock(appWin);
    appWin.addDockWidget(Qt.RightDockWidgetArea, csSymbolPaletteDock);
    return csSymbolPaletteDock;
};

/**
 * Hands control to the placement action.
 *
 * Looks the action up by script file and passes it in, rather than
 * constructing with null: stock Print.js does exactly this, and
 * EAction's null-guiAction paths are not exercised anywhere.
 */
/**
 * Deletes the last thing drawn, from EITHER panel.
 *
 * Deliberately not "the last SYMBOL": CsErase keeps one record for both
 * panels, because "the last thing I drew" is one fact from where the
 * caver sits. A caver who places a symbol, traces a wall, then reaches
 * for Delete Last means the wall.
 */
SymbolPalette.deleteLast = function() {
    var di = EAction.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    var doc = di.getDocument();
    if (isNull(doc)) {
        return;
    }
    var res = CsErase.deleteLast(doc, di);
    if (res.status === "deleted") {
        EAction.handleUserMessage(qsTr("Deleted the last %1 you drew.")
            .arg(res.label === "" ? qsTr("symbol") : res.label));
    } else if (res.status === "extended") {
        EAction.handleUserMessage(qsTr("Your last stroke CONTINUED an " +
            "existing line rather than drawing a new one, so there is no " +
            "last line to delete -- deleting it would take every earlier " +
            "stroke of that line too. Press Ctrl+Z, which takes back just " +
            "that stroke."));
    } else if (res.status === "failed") {
        EAction.handleUserMessage(qsTr("That could not be deleted -- its " +
            "layer may be locked or frozen."));
    } else {
        EAction.handleUserMessage(qsTr("Nothing to delete: nothing has " +
            "been drawn from these panels in this drawing since it was " +
            "opened, or what was drawn has already gone."));
    }
};

/**
 * Turns Erase mode on and off, reaching only the layers the PALETTE
 * places on.
 *
 * A palette erase that could take traced walls would make the two
 * panels' Erase buttons the same button wearing two labels -- and the
 * caver reaching for this one is looking at a symbol.
 */
SymbolPalette.toggleErase = function() {
    var w = SymbolPalette.widgets;
    var wanted = true;
    if (!isNull(w) && !isNull(w.eraseButton)) {
        try {
            wanted = (w.eraseButton.checked === true);
        } catch (eRead) {
        }
    }
    var di = EAction.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    if (!wanted) {
        SymbolPalette.startRun();
        return;
    }
    if (!FeatureEraseRun.start(di, FeatureEraseRun.symbolLayers(),
            SymbolPalette.eraseEnded)) {
        SymbolPalette.eraseEnded();
        EAction.handleUserMessage(qsTr("Erase mode could not start in " +
            "this build."));
    }
};

/** Un-presses the Erase button, however the mode ended. */
SymbolPalette.eraseEnded = function() {
    var w = SymbolPalette.widgets;
    if (isNull(w) || isNull(w.eraseButton)) {
        return;
    }
    try {
        w.eraseButton.checked = false;
    } catch (e) {
    }
};

SymbolPalette.startRun = function() {
    var di = EAction.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    // If a placement is ALREADY the current action, leave it running:
    // arm() has changed the symbol and the next click picks it up.
    // Calling setCurrentAction again would make QCAD tear down the
    // action running this very click -- a hard SIGSEGV, and one this
    // suite has already paid for once.
    //
    // BY SCRIPT FILE, NOT instanceof. QCAD builds every action in its
    // OWN script context, and what a panel sees through
    // getCurrentAction is an RActionAdapter -- not the JS object, and
    // never an instance of anything this file can name. `instanceof`
    // is therefore always false here, which makes the guard above
    // permanently inert (measured through the live bridge,
    // 2026-09-06). The action's own gui action still knows which file
    // it came from, and that is a fact both contexts share.
    var runPath = SymbolPalette.basePath + "/SymbolPaletteRun.js";
    try {
        var current = di.getCurrentAction();
        if (!isNull(current)) {
            var file = String(current.getGuiAction().getScriptFile());
            if (file.length > 0 &&
                    file.indexOf("SymbolPaletteRun.js") !== -1) {
                return;
            }
        }
    } catch (e) {
        // no readable current action; starting one is the safe answer
    }
    var runAction = RGuiAction.getByScriptFile(runPath);
    di.setCurrentAction(new SymbolPaletteRun(runAction));
};

SymbolPalette.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    try {
        var existed = (csSymbolPaletteDock !== undefined &&
            csSymbolPaletteDock !== null);
        var dock = SymbolPalette.ensureDock();
        dock.visible = existed ? !dock.visible : true;
        if (dock.visible) {
            // The template may have gained or lost a symbol since last
            // time -- another CaveCAD window, or a release.
            CsSymbolStore.invalidate();
            SymbolPalette.rebuildTiles();
        }
    } catch (e) {
        csSymbolPaletteDock = undefined;
        EAction.handleUserWarning("Symbol Palette: this CaveCAD build refused the docked " +
            "panel (" + e + ") -- please report this.");
    }

    this.terminate();
};

SymbolPalette.init = function(basePath) {
    SymbolPalette.basePath = basePath;

    var action = new RGuiAction(qsTr("Symbol Palette"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/SymbolPalette.js");
    action.setIcon(basePath + "/SymbolPalette.svg");
    action.setStatusTip(qsTr("Place cave symbols from a palette: pick one, " +
        "click to drop it, drag to aim it"));
    action.setDefaultCommands(["symbolpalette", "sym"]);
    // 452 is "draw the map", beside Feature Trace, Shaped Lines,
    // Scatter Breakdown and Cross Section; 50 puts it after Cross
    // Section, which is the last of them.
    action.setGroupSortOrder(452);
    action.setSortOrder(50);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);

    SymbolPaletteRun.init(basePath);
    SymbolPaletteEdit.init(basePath);

    // Build the dock NOW, during add-on init: the main window's
    // readSettings()/restoreState() runs after init and can only place
    // (and re-show) a dock that already exists. Created hidden; the
    // saved window state decides whether it opens.
    try {
        var dock = SymbolPalette.ensureDock();
        dock.visible = false;
    } catch (eInit) {
        csSymbolPaletteDock = undefined;
        EAction.handleUserWarning("Symbol Palette: could not build the panel at startup (" +
            eInit + "); the menu entry will try again.");
    }
};
