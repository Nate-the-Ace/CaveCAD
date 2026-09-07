// CsPanel.js -- the parts every Cave Survey dock panel shares: sections
// that fold away, and the memory of which ones a caver left shut.
//
// Part of the Cave Survey Core library. GUI context only (QGroupBox,
// QWidget), but never an interactive ACTION's context -- panels call
// this, actions do not.
//
// WHY IT EXISTS. Nathan, 2026-09-07: "can we keep Symbol and Trace
// palettes in sync when it comes to controls? When I ask for an
// interface feature for one, I'd like you to consider it for both."
// Collapsible categories were built for the Symbol Palette first, and
// the honest way to keep that promise is not to remember to copy the
// code -- it is for there to be one copy. A panel feature that lives
// here is a panel feature both panels have.
//
// Everything degrades: a bridge that refuses a checkable group box
// gets a plain one, which is a panel that does not fold rather than a
// panel that does not build.

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

/**
 * A section that folds away: a checkable group box whose contents live
 * in a host widget of their own.
 *
 * THE HOST IS THE POINT. Unchecking a QGroupBox only DISABLES its
 * children -- greyed-out controls take exactly the same room, which is
 * the opposite of what a caver collapsing a section wants. Hiding a
 * host widget is what gives the space back, and a group box cannot hide
 * its own layout.
 *
 * The caller fills `host` and is handed both back:
 *
 *   var sec = CsPanel.section(parent, "Tracing", KEY, collapsed);
 *   sec.host.setLayout(myGrid);
 *   layout.addWidget(sec.box, 0, 0);
 *
 * \return { box, host, open }
 */
CsPanel.section = function(parent, title, settingKey, collapsedSet) {
    var box = new QGroupBox(title, parent);
    var open = true;
    try {
        box.checkable = true;
        open = !(collapsedSet && collapsedSet[title] === true);
        box.checked = open;
    } catch (eCheckable) {
        open = true;   // a plain box: it simply never folds
    }
    var host = new QWidget(box);
    var outer = new QVBoxLayout();
    try {
        // No margins of its own: a COLLAPSED section should be a title
        // and nothing else, and every pixel of padding left behind is a
        // pixel the caver collapsed it to reclaim.
        outer.setContentsMargins(0, 0, 0, 0);
        outer.setSpacing(0);
    } catch (eMargins) {
    }
    outer.addWidget(host, 0, 0);
    box.setLayout(outer);
    try {
        host.visible = open;
        CsPanel.connectSection(box, host, title, settingKey);
    } catch (eWire) {
    }
    return { box: box, host: host, open: open };
};

/** Wires one section's tick to its contents. Its own function so the
 *  closure captures ONE title and host rather than a loop's. */
CsPanel.connectSection = function(box, host, title, settingKey) {
    box.toggled.connect(function(open) {
        try {
            host.visible = open;
        } catch (eVis) {
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
