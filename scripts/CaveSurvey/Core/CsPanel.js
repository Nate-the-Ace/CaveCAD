// CsPanel.js -- the parts every Cave Survey dock panel shares: sections
// that fold away, and the memory of which ones a caver left shut.
//
// Part of the Cave Survey Core library. GUI context only (QWidget,
// QPushButton), but never an interactive ACTION's context -- panels
// call this, actions do not.
//
// WHY IT EXISTS. Nathan, 2026-09-07: "can we keep Symbol and Trace
// palettes in sync when it comes to controls? When I ask for an
// interface feature for one, I'd like you to consider it for both."
// Collapsible categories were built for the Symbol Palette first, and
// the honest way to keep that promise is not to remember to copy the
// code -- it is for there to be one copy. A panel feature that lives
// here is a panel feature both panels have.
//
// Everything degrades: a bridge that refuses the header button gets a
// section that never folds, which is a panel that does not fold rather
// than a panel that does not build.

var CsPanel = {};

/** How a collapsed set is stored: one settings key per panel, holding
 *  the shut sections' titles, comma separated. Titles come from the
 *  catalogue and from what a caver types, and none has ever had a comma
 *  in it; one that did would fold the wrong section and nothing worse. */
CsPanel.loadCollapsed = function(settingKey) {
    var set = {};
    try {
        var raw = RSettings.getStringValue(settingKey, "");
        if (raw !== "") {
            var parts = String(raw).split(",");
            for (var i = 0; i < parts.length; i++) {
                var name = parts[i].trim();
                if (name !== "") {
                    set[name] = true;
                }
            }
        }
    } catch (e) {
        // a bridge without settings forgets between sessions, which is
        // a panel that opens fully expanded -- no work lost
    }
    return set;
};

/** Records that one section is open or shut. */
CsPanel.saveCollapsed = function(settingKey, title, collapsed) {
    try {
        var set = CsPanel.loadCollapsed(settingKey);
        if (collapsed) {
            set[title] = true;
        } else if (set.hasOwnProperty(title)) {
            delete set[title];
        }
        var names = [];
        for (var name in set) {
            if (set.hasOwnProperty(name)) {
                names.push(name);
            }
        }
        RSettings.setValue(settingKey, names.join(","));
    } catch (e) {
    }
};

/** The chevron on a section header: pointing UP when the section is
 *  open (click to fold it away), DOWN when it is shut.
 *
 *  NOT A CHECKBOX. A checkable group box was the first attempt, and it
 *  reads as "switch this off", so a caver aims at the little box --
 *  Nathan, 2026-09-07: "I keep clicking on the check box itself and it
 *  doesn't work like that." A chevron says fold, and the whole header
 *  is the target. */
CsPanel.OPEN_MARK = "\u2303";     // up
CsPanel.SHUT_MARK = "\u2304";     // down

/** A section header's text: the chevron, then the title. */
CsPanel.headerText = function(title, open) {
    return (open ? CsPanel.OPEN_MARK : CsPanel.SHUT_MARK) + "  " + title;
};

/**
 * A section that folds away: a header you click, and a host widget
 * holding whatever the caller puts in it.
 *
 * THE WHOLE HEADER IS THE TARGET, which is the point of the redesign.
 * The header is a flat button spanning the panel, so there is no small
 * thing to aim at and no state to misread.
 *
 * THE HOST IS THE OTHER HALF. Hiding a widget is what gives the space
 * back; a layout cannot hide itself, and disabling controls leaves them
 * taking exactly the same room.
 *
 * The caller fills `host` and adds `box` to its layout:
 *
 *   var sec = CsPanel.section(parent, "Tracing", KEY, collapsed);
 *   sec.host.setLayout(myGrid);
 *   layout.addWidget(sec.box, 0, 0);
 *
 * \return { box, host, header, open }
 */
CsPanel.section = function(parent, title, settingKey, collapsedSet) {
    var open = !(collapsedSet && collapsedSet[title] === true);
    var box = new QWidget(parent);
    var outer = new QVBoxLayout();
    try {
        outer.setContentsMargins(0, 0, 0, 0);
        outer.setSpacing(0);
    } catch (eMargins) {
    }

    var header = null;
    try {
        header = new QPushButton(CsPanel.headerText(title, open));
        header.flat = true;
        header.toolTip = qsTr("Click to fold this section away");
        try {
            // Left-aligned like a heading rather than centred like a
            // button: it names what is below it, it does not act.
            header.styleSheet = "text-align: left; padding: 3px;";
        } catch (eStyle) {
        }
        outer.addWidget(header, 0, 0);
    } catch (eHeader) {
        // No header: the section simply never folds, and everything in
        // it still works.
        header = null;
    }

    var host = new QWidget(box);
    outer.addWidget(host, 0, 0);
    box.setLayout(outer);

    try {
        host.visible = open;
        if (header !== null) {
            CsPanel.connectSection(header, host, title, settingKey);
        }
    } catch (eWire) {
    }
    return { box: box, host: host, header: header, open: open };
};

/** Wires one section's header to its contents. Its own function so the
 *  closure captures ONE title and host rather than a loop's. */
CsPanel.connectSection = function(header, host, title, settingKey) {
    header.clicked.connect(function() {
        var open = true;
        try {
            open = !host.visible;
            host.visible = open;
        } catch (eVis) {
            return;
        }
        try {
            header.text = CsPanel.headerText(title, open);
        } catch (eText) {
        }
        CsPanel.saveCollapsed(settingKey, title, !open);
    });
};

/**
 * Folds a section open or shut WITHOUT remembering it.
 *
 * WHAT A SEARCH NEEDS. Typing "gour" must show the rimstone dam even
 * when its section was folded away last week, and clearing the search
 * must put the panel back exactly as the caver left it. That only
 * works if the search never writes to the collapsed set -- which is
 * the whole difference between this and clicking the header.
 */
CsPanel.setOpen = function(section, title, open) {
    if (isNull(section)) {
        return;
    }
    try {
        section.host.visible = open;
    } catch (eVis) {
        return;
    }
    try {
        if (!isNull(section.header)) {
            section.header.text = CsPanel.headerText(title, open);
        }
    } catch (eText) {
    }
};

/**
 * The saved order of a panel's sections: titles, in the order the caver
 * put them. Unknown to the panel is fine -- see orderedTitles.
 */
CsPanel.loadOrder = function(settingKey) {
    var out = [];
    try {
        var raw = RSettings.getStringValue(settingKey + "Order", "");
        if (raw !== "") {
            var parts = String(raw).split(",");
            for (var i = 0; i < parts.length; i++) {
                var name = parts[i].trim();
                if (name !== "") {
                    out.push(name);
                }
            }
        }
    } catch (e) {
    }
    return out;
};

/** Records the order a panel's sections are in. */
CsPanel.saveOrder = function(settingKey, titles) {
    try {
        RSettings.setValue(settingKey + "Order", titles.join(","));
    } catch (e) {
    }
};

/**
 * `titles` arranged by `saved`.
 *
 * A title the saved order does not mention keeps its place relative to
 * the ones it came after -- so a new category, or a new section in a
 * new release, appears where the panel meant to put it rather than
 * being swept to the end of a caver's arrangement.
 *
 * A saved title the panel no longer has is dropped, which is what
 * happens to a category whose last symbol was deleted.
 *
 * Pure.
 */
CsPanel.orderedTitles = function(titles, saved) {
    if (isNull(saved) || saved.length === 0) {
        return titles.slice(0);
    }
    var known = {};
    var i;
    for (i = 0; i < titles.length; i++) {
        known[titles[i]] = true;
    }
    var out = [];
    var placed = {};
    for (i = 0; i < saved.length; i++) {
        if (known[saved[i]] === true && placed[saved[i]] !== true) {
            out.push(saved[i]);
            placed[saved[i]] = true;
        }
    }
    // The unmentioned ones, in the panel's own order, each inserted
    // after whichever of its original predecessors is already placed.
    for (i = 0; i < titles.length; i++) {
        if (placed[titles[i]] === true) {
            continue;
        }
        var at = out.length;
        for (var j = i - 1; j >= 0; j--) {
            var idx = out.indexOf(titles[j]);
            if (idx !== -1) {
                at = idx + 1;
                break;
            }
        }
        out.splice(at, 0, titles[i]);
        placed[titles[i]] = true;
    }
    return out;
};

/**
 * A stack of sections in one layout, which the caver can reorder.
 *
 * NOT BY DRAGGING, and not for want of trying: this bridge hands script
 * mouse events for exactly four widget classes (RListView, RListWidget,
 * RTreeWidget, RGraphicsViewQt -- the generated shells are the list),
 * and a section header is none of them. A header cannot know it is
 * being dragged. So the reordering is on the header's own right-click
 * menu, which any widget can have.
 *
 * `baseIndex` is where the first section sits in the layout, so a panel
 * can keep a readout or a search box above the stack and still let the
 * sections below it be shuffled.
 */
CsPanel.stack = function(layout, settingKey, baseIndex, onChanged) {
    return {
        layout: layout,
        settingKey: settingKey,
        baseIndex: isNull(baseIndex) ? 0 : baseIndex,
        onChanged: isNull(onChanged) ? null : onChanged,
        sections: []
    };
};

/** The titles currently in a stack, in their current order. */
CsPanel.stackTitles = function(stack) {
    var out = [];
    for (var i = 0; i < stack.sections.length; i++) {
        out.push(stack.sections[i].title);
    }
    return out;
};

/**
 * Adds a section to a stack and gives its header the move menu.
 *
 * The caller still adds the box to the layout itself, in the order it
 * wants; applyOrder below rearranges to the caver's saved order once
 * everything is in.
 */
CsPanel.stackAdd = function(stack, section, title) {
    section.title = title;
    stack.sections.push(section);
    if (isNull(section.header)) {
        return;
    }
    try {
        section.header.contextMenuPolicy = Qt.CustomContextMenu;
        section.header.customContextMenuRequested.connect(function(pos) {
            try {
                var menu = new QMenu();
                var up = menu.addAction(qsTr("Move Up"));
                up.enabled = (CsPanel.indexOfSection(stack, section) > 0);
                up.triggered.connect(function() {
                    CsPanel.moveSection(stack, section, -1);
                });
                var down = menu.addAction(qsTr("Move Down"));
                down.enabled = (CsPanel.indexOfSection(stack, section) <
                    stack.sections.length - 1);
                down.triggered.connect(function() {
                    CsPanel.moveSection(stack, section, 1);
                });
                menu.addSeparator();
                var reset = menu.addAction(qsTr("Reset Order"));
                reset.triggered.connect(function() {
                    CsPanel.resetOrder(stack);
                });
                // Kept alive: popup() returns at once and a collected
                // menu simply vanishes mid-display.
                stack.menu = menu;
                menu.popup(section.header.mapToGlobal(pos));
            } catch (eMenu) {
                // no menu on this bridge: the sections keep the order
                // the panel built them in, which is a working panel
            }
        });
    } catch (ePolicy) {
    }
};

/** Where a section sits in its stack, or -1. */
CsPanel.indexOfSection = function(stack, section) {
    for (var i = 0; i < stack.sections.length; i++) {
        if (stack.sections[i] === section) {
            return i;
        }
    }
    return -1;
};

/** Moves one section up or down and remembers the new order. */
CsPanel.moveSection = function(stack, section, delta) {
    var at = CsPanel.indexOfSection(stack, section);
    var to = at + delta;
    if (at < 0 || to < 0 || to >= stack.sections.length) {
        return;
    }
    stack.sections.splice(at, 1);
    stack.sections.splice(to, 0, section);
    CsPanel.relayout(stack);
    CsPanel.saveOrder(stack.settingKey, CsPanel.stackTitles(stack));
};

/** Forgets the caver's order; the panel's own returns on next build. */
CsPanel.resetOrder = function(stack) {
    CsPanel.saveOrder(stack.settingKey, []);
    if (typeof stack.onChanged === "function") {
        stack.onChanged();
    }
};

/** Rearranges a stack's boxes in the layout to match its own order. */
CsPanel.relayout = function(stack) {
    var i;
    try {
        for (i = 0; i < stack.sections.length; i++) {
            stack.layout.removeWidget(stack.sections[i].box);
        }
        for (i = 0; i < stack.sections.length; i++) {
            stack.layout.insertWidget(stack.baseIndex + i,
                stack.sections[i].box, 0, 0);
        }
    } catch (e) {
        // a bridge without insertWidget leaves the order alone, which
        // is the panel's own order -- untidy, never broken
    }
};

/** Puts a freshly built stack into the caver's saved order. */
CsPanel.applyOrder = function(stack) {
    var saved = CsPanel.loadOrder(stack.settingKey);
    if (saved.length === 0) {
        return;
    }
    var wanted = CsPanel.orderedTitles(CsPanel.stackTitles(stack), saved);
    var byTitle = {};
    var i;
    for (i = 0; i < stack.sections.length; i++) {
        byTitle[stack.sections[i].title] = stack.sections[i];
    }
    var reordered = [];
    for (i = 0; i < wanted.length; i++) {
        if (!isNull(byTitle[wanted[i]])) {
            reordered.push(byTitle[wanted[i]]);
        }
    }
    if (reordered.length !== stack.sections.length) {
        return;   // something is missing; leave the panel as built
    }
    stack.sections = reordered;
    CsPanel.relayout(stack);
};

/**
 * A grid laid out for a PANEL rather than for a page: labels at the
 * left at their natural width, fields beside them, and the slack given
 * to a column past the last one.
 *
 * A grid whose last real column stretches spreads a spin box across the
 * whole dock and leaves its label stranded at the far side -- which is
 * exactly what the first pass at this looked like.
 */
CsPanel.formGrid = function(fieldColumns) {
    var grid = new QGridLayout();
    try {
        grid.setContentsMargins(4, 4, 4, 4);
        grid.setHorizontalSpacing(6);
        grid.setVerticalSpacing(4);
        grid.setColumnStretch(isNull(fieldColumns) ? 2 : fieldColumns, 1);
    } catch (e) {
    }
    return grid;
};

/** How many tiles a Recent row keeps. Five, because cave work is a
 *  handful of features repeated a thousand times -- and because a row
 *  that scrolls is a second list to search rather than a shortcut. */
CsPanel.RECENT_MAX = 5;

/**
 * The recently-used keys for a panel, most recent first.
 *
 * Stored as one settings string per panel -- the same shape as the
 * collapsed-sections memory above, and for the same reason: a caver's
 * six features are the same six tomorrow, so this is worth surviving a
 * restart. Keys are opaque to this file; each panel decides what a key
 * means (a layer name, a style, a block name) and how to draw it.
 */
CsPanel.loadRecent = function(settingKey) {
    var out = [];
    try {
        var raw = RSettings.getStringValue(settingKey, "");
        if (raw !== "") {
            var parts = String(raw).split(",");
            for (var i = 0; i < parts.length; i++) {
                var key = parts[i].trim();
                if (key !== "" && out.length < CsPanel.RECENT_MAX) {
                    out.push(key);
                }
            }
        }
    } catch (e) {
        // a bridge without settings forgets between sessions, which is
        // a panel with no Recent row rather than a panel that fails
    }
    return out;
};

/**
 * Notes that `key` was just used, and answers the new list.
 *
 * MOVE TO FRONT, not append: a caver who comes back to walls after four
 * other features wants walls first, and a list that only grew would
 * push it off the end while they were using it.
 *
 * A key with a comma in it would split into two on the way back and is
 * refused rather than stored -- no layer name, style key or block name
 * in this suite has one, and a key that did would quietly corrupt the
 * whole row.
 */
CsPanel.noteRecent = function(settingKey, key) {
    var current = CsPanel.loadRecent(settingKey);
    if (key === null || key === undefined || String(key) === "" ||
            String(key).indexOf(",") !== -1) {
        return current;
    }
    var next = [String(key)];
    for (var i = 0; i < current.length; i++) {
        if (current[i] !== String(key) && next.length < CsPanel.RECENT_MAX) {
            next.push(current[i]);
        }
    }
    try {
        RSettings.setValue(settingKey, next.join(","));
    } catch (e) {
        // not remembered across sessions; still right for this one
    }
    return next;
};

/** Empties a layout of its widgets, so a row can be rebuilt in place.
 *  The widgets are hidden as well as removed: a bridge that keeps a
 *  removed widget parented would otherwise leave it floating over the
 *  panel. */
CsPanel.clearLayout = function(layout) {
    if (isNull(layout)) {
        return;
    }
    try {
        while (layout.count() > 0) {
            var item = layout.takeAt(0);
            if (isNull(item)) {
                break;
            }
            var widget = item.widget();
            if (!isNull(widget)) {
                widget.visible = false;
                widget.setParent(null);
            }
        }
    } catch (e) {
        // a bridge without takeAt keeps the old row; it is stale rather
        // than wrong, and the tiles below it still work
    }
};

// ---------------------------------------------------------------------
// TILE TOOLTIPS -- the one place a beginner is told what a symbol or a
// feature actually MEANS.
//
// Both palettes had mechanical tooltips: a name, a block, a layer.
// True, and no use to anyone who does not already know the NSS set.
// The prose lives in CsHelp; this is how a tile wears it, and it lives
// here so the two panels cannot drift into two different tooltips.
//
// RICH TEXT, WITH OUR OWN WRAPPING. Qt renders a tooltip as HTML the
// moment it contains a tag, which is what lets the rule stand out from
// the description -- but an HTML tooltip is laid out on ONE line until
// something breaks it, and Qt has no honoured width for a tooltip
// (a CSS width on a <p> is ignored; the documented workaround is a
// table, which then styles the whole thing). So the text is wrapped
// here, by word, and the breaks are <br>. Cheap, and it looks the same
// on every platform.
// ---------------------------------------------------------------------

/** How wide a wrapped tooltip line gets, in characters. Chosen so the
 *  longest rule in CsHelp comes out three lines rather than five. */
CsPanel.TIP_CHARS = 46;

/** Wraps text to a character budget, returning the LINES. Same greedy
 *  fill FeatureTrace.wrapLabel uses on a tile's own label; a word
 *  longer than the budget gets a line of its own rather than being
 *  cut. */
CsPanel.wrapLines = function(text, budget) {
    var words = String(text).split(" ");
    var lines = [];
    var line = "";
    for (var i = 0; i < words.length; i++) {
        if (words[i] === "") {
            continue;
        }
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
    return lines;
};

/** The five characters that would otherwise be read as markup. Applied
 *  to every piece of text that reaches the tooltip, including catalogue
 *  names -- a caver may name their own symbol "<3". */
CsPanel.escapeHtml = function(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
};

/**
 * One tile's tooltip.
 *
 *   title   the feature or symbol name -- bold, always present.
 *   help    a CsHelp entry ({means, rule}) or null. Null is the custom
 *           symbol case and simply leaves those lines out.
 *   detail  the mechanical lines that were the whole tooltip before
 *           this existed (block, layer, "your own symbol"), printed
 *           small and last. An array; empty is fine.
 *
 * \return an HTML string for QWidget.toolTip.
 */
CsPanel.tipHtml = function(title, help, detail) {
    var parts = ["<b>" + CsPanel.escapeHtml(title) + "</b>"];
    var wrap = function(text) {
        var lines = CsPanel.wrapLines(text, CsPanel.TIP_CHARS);
        for (var i = 0; i < lines.length; i++) {
            lines[i] = CsPanel.escapeHtml(lines[i]);
        }
        return lines.join("<br>");
    };
    if (!isNull(help)) {
        if (!isNull(help.means) && help.means !== "") {
            parts.push(wrap(help.means));
        }
        // The rule is the half that gets a map marked down, so it is
        // the half that has to survive being skim-read.
        if (!isNull(help.rule) && help.rule !== "") {
            parts.push("<i>" + wrap(help.rule) + "</i>");
        }
    }
    if (!isNull(detail)) {
        var kept = [];
        for (var d = 0; d < detail.length; d++) {
            if (isNull(detail[d]) || String(detail[d]) === "") {
                continue;
            }
            kept.push(wrap(detail[d]));
        }
        if (kept.length > 0) {
            parts.push("<span style='color:gray'>" +
                kept.join("<br>") + "</span>");
        }
    }
    return parts.join("<br><br>");
};
