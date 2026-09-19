// CsLayerGroups.js -- which starter group a layer belongs in.
//
// Part of the Cave Survey Core library. The classification is pure data
// -- a layer name in, a group name out -- and fileInto() at the bottom
// touches the document and is the only function here that does, the same
// split CsLayers draws between its registry and ensure().
//
// The palette that SHOWS the groups is CaveCAD's own Layer Manager,
// which knows nothing about caves. The template ships already filed
// (tools/sync_template_groups.js), so a new drawing needs nothing run on
// it; fileInto exists for the two cases the template cannot cover -- a
// drawing made before the groups existed, and the per-run variant layers
// a later trip adds. It is a pass in Repair Drawing rather than a menu
// entry of its own, because that is what it is: a drawing-wide tidy of
// something already there.
//
// WHY STARTER GROUPS AT ALL. The registry holds over 150 layers before
// per-run variants multiply them -- Truitt Cave carries 285 -- so a cave
// drawing otherwise opens with the lot in a single Ungrouped heap. Groups
// are arbitrary and hand-made by design; this is the first filing, not
// the only one.
//
// THIS SCHEME IS NATHAN'S, taken from the arrangement he built by hand in
// Truitt Cave on 2026-09-18 and adopted whole rather than argued with.
// The template carries the same six groups, and a test holds the two in
// agreement. Two things about it are worth stating because they are
// decisions and not accidents:
//
//   - THE PLAN'S OWN INK IS DELIBERATELY NOT FILED. Walls, floor,
//     ceiling, breakdown, formations, sediment, ledges, the entrance, the
//     dripline and the section cut marks all stay in Ungrouped, which
//     makes Ungrouped the working set -- the layers you are actually
//     drawing on -- rather than a leftovers bin. classify() returns
//     undefined for those, and that is a real answer, not a gap.
//   - CONTROL IS ONE GROUP FOR ALL THREE FRAMES, scans and basemap
//     included. CTRL-AERIAL, CTRL-CONTOUR and CTRL-SCAN sit with
//     CTRL-SHOTS because they are all "not my ink", and the one switch
//     that hides all of it is worth more than the finer split.
//
// Notes DO get a group here, and it is the plan's notes only: PROFILE-
// NOTES-DIG goes to Profile Layers with the rest of the profile, because
// a note belongs with the view it annotates.

var CsLayerGroups = {};

/**
 * The groups this tool creates, in the order they appear in the palette.
 * The other views first, then the machinery, then the page furniture --
 * which puts the plan's own unfiled ink last, next to where Ungrouped
 * always sits.
 */
CsLayerGroups.GROUPS = [
    "Profile Layers",
    "Cross Section Layers",
    "Notes Layers",
    "Water Layers",
    "Control Layers",
    "Sheet Layers"
];

CsLayerGroups.PROFILE = "Profile Layers";
CsLayerGroups.SECTIONS = "Cross Section Layers";
CsLayerGroups.NOTES = "Notes Layers";
CsLayerGroups.WATER = "Water Layers";
CsLayerGroups.CONTROL = "Control Layers";
CsLayerGroups.SHEET = "Sheet Layers";

/**
 * The page furniture, by name.
 *
 * NOT CsLayers.SHEET_LAYERS, which also holds "0" and "Defpoints".
 * Layer 0 is where stray work lands and belongs in front of a caver, not
 * filed away with the border; Defpoints is QCAD's own bookkeeping and
 * goes to Control with the rest of the machinery. NORTH-ARROW is here and
 * is not in CsLayers.SHEET_LAYERS at all.
 */
CsLayerGroups.SHEET_FURNITURE = function() {
    return [
        CsLayers.BORDER,
        CsLayers.TITLE_BLOCK,
        CsLayers.LEGEND,
        CsLayers.SCALE_BAR,
        CsLayers.NORTH_ARROW
    ];
};

/**
 * \return The starter group \c layerName belongs in, or UNDEFINED for the
 * plan's own ink, which is left unfiled on purpose (see the header).
 */
CsLayerGroups.classify = function(layerName) {
    if (layerName === undefined || layerName === null) {
        return undefined;
    }
    var name = String(layerName);

    var furniture = CsLayerGroups.SHEET_FURNITURE();
    for (var i = 0; i < furniture.length; i++) {
        if (furniture[i] !== undefined && name === furniture[i]) {
            return CsLayerGroups.SHEET;
        }
    }

    // Everything generated, in every frame, plus QCAD's own scratch
    // layer. Checked before the frame so CTRL-PROFILE-SHOTS is control
    // rather than profile.
    if (name.indexOf("CTRL-") === 0 || name === "Defpoints") {
        return CsLayerGroups.CONTROL;
    }

    // The other two views, hand-traced. These carry their own notes and
    // text with them -- PROFILE-NOTES-DIG is profile, not notes.
    if (name.indexOf("PROFILE-") === 0) {
        return CsLayerGroups.PROFILE;
    }
    if (name.indexOf("SECTION-") === 0) {
        return CsLayerGroups.SECTIONS;
    }

    // The plan's notes and text.
    if (name.indexOf("NOTES-") === 0 || name.indexOf("TEXT-") === 0) {
        return CsLayerGroups.NOTES;
    }

    if (name.indexOf("WATER-") === 0) {
        return CsLayerGroups.WATER;
    }

    // The plan's own ink, layer 0, and CROSS-SECTION-MARKERS: unfiled.
    return undefined;
};

/**
 * \return A map of group name -> layer names, for the layer names given.
 *
 * Every group in GROUPS appears as a key even when it has no members: a
 * cave with no cross sections yet should still show the group, so that
 * tracing one has somewhere obvious to go. Layers classify() leaves
 * unfiled appear under no key at all.
 */
CsLayerGroups.plan = function(layerNames) {
    var res = {};
    var i;
    for (i = 0; i < CsLayerGroups.GROUPS.length; i++) {
        res[CsLayerGroups.GROUPS[i]] = [];
    }
    for (i = 0; i < layerNames.length; i++) {
        var group = CsLayerGroups.classify(layerNames[i]);
        if (group !== undefined) {
            res[group].push(layerNames[i]);
        }
    }
    return res;
};


// ---------------------------------------------------------------------
// The one function here that touches a document.
// ---------------------------------------------------------------------

/**
 * \return The Layer Manager's group model, or undefined if this build
 * has no such palette.
 *
 * Checked by name rather than assumed: the suite installs into stock
 * QCAD too, where the palette does not exist, and a ReferenceError from
 * a repair pass tells a caver nothing.
 */
CsLayerGroups.model = function() {
    if (typeof LayerGroups === "undefined") {
        return undefined;
    }
    return LayerGroups;
};

/**
 * Files every layer in \c doc into its starter group.
 *
 * ONLY EVER ADDS. A group a caver made by hand, and a layer they filed
 * by hand, are both left exactly as they are -- so this can be run on a
 * drawing somebody has already arranged without undoing their work. That
 * is also why there is no "reset to defaults": the arrangement is theirs
 * the moment they touch it.
 *
 * \return { groups: n, filed: n, already: n, unfiled: n }, or undefined
 * if the palette is missing.
 */
CsLayerGroups.fileInto = function(doc) {
    var model = CsLayerGroups.model();
    if (model === undefined) {
        return undefined;
    }

    var names = model.layerNamesOf(doc).sort();
    var reg = model.readRegistry(doc);

    // Every group first, in GROUPS order, so the palette shows them in
    // that order even when one of them is still empty.
    var i;
    var created = 0;
    for (i = 0; i < CsLayerGroups.GROUPS.length; i++) {
        if (model.createGroup(reg, CsLayerGroups.GROUPS[i])) {
            created++;
        }
    }

    var filed = 0, already = 0, unfiled = 0;
    for (i = 0; i < names.length; i++) {
        var group = CsLayerGroups.classify(names[i]);
        if (group === undefined) {
            // The plan's own ink, left in Ungrouped on purpose -- that is
            // the working set, not a leftovers bin.
            unfiled++;
        } else if (model.addTo(reg, names[i], group)) {
            filed++;
        } else {
            already++;
        }
    }

    model.writeRegistry(doc, reg);
    return { groups: created, filed: filed, already: already,
             unfiled: unfiled };
};
