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
