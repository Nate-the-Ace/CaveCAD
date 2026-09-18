// CsLayerGroups.js -- which starter group a layer belongs in.
//
// Part of the Cave Survey Core library, and pure: a layer name in, a
// group name out. The tool that writes the groups into a drawing is
// GroupLayers; the palette that shows them is CaveCAD's own Layer
// Manager, which knows nothing about caves.
//
// WHY STARTER GROUPS AT ALL. The registry holds over 150 layers before
// per-run variants multiply them, and a fresh cave drawing therefore
// opens with every one of them in a single Ungrouped heap. Groups are
// arbitrary and hand-made by design -- that is the point of them -- but
// nobody should have to file 150 layers by hand before the palette earns
// its keep. This is the first filing, not the only one.
//
// THE SPLIT IS BY FRAME, PLUS THE TWO BUCKETS PEOPLE ACTUALLY TOGGLE.
// CsLayers.frameOf already answers plan / profile / section / sheet, and
// that answer is reused rather than re-derived. On top of it:
//
//   - everything generated (CTRL-) goes to Survey control, whatever
//     frame it belongs to. A caver switching the survey skeleton off
//     wants it off in all three views at once.
//   - the tracing sources and the background imagery go to Scans &
//     basemap, because they are turned off together for a plot and on
//     together for tracing, and they are the heaviest things to draw.
//
// Notes deliberately do NOT get their own group: PROFILE-NOTES-DIG
// belongs with the profile a caver is working on, not in a pile of notes
// from three different views.

var CsLayerGroups = {};

/**
 * The groups this tool creates, in the order they should appear in the
 * palette. Work first, then the machinery, then the page furniture.
 */
CsLayerGroups.GROUPS = [
    "Plan",
    "Profile",
    "Sections",
    "Survey control",
    "Scans & basemap",
    "Sheet"
];

CsLayerGroups.PLAN = "Plan";
CsLayerGroups.PROFILE = "Profile";
CsLayerGroups.SECTIONS = "Sections";
CsLayerGroups.CONTROL = "Survey control";
CsLayerGroups.SCANS = "Scans & basemap";
CsLayerGroups.SHEET = "Sheet";

/**
 * Layers that are tracing sources or background imagery rather than
 * survey control, listed by their registry constants so a rename in
 * CsLayers reaches this list instead of silently orphaning an entry.
 *
 * Matched as PREFIXES, so a per-run variant (CTRL-SCAN-A) lands in the
 * same group its base does.
 */
CsLayerGroups.SCAN_LAYERS = function() {
    return [
        CsLayers.CTRL_SCAN,
        CsLayers.CTRL_PROFILE_SCAN,
        CsLayers.CTRL_SECTION_SCAN,
        CsLayers.CTRL_AERIAL,
        CsLayers.CTRL_CONTOUR,
        CsLayers.CTRL_CONTOUR_MAJOR
    ];
};

/**
 * \return The starter group \c layerName belongs in. Always one of
 * CsLayerGroups.GROUPS -- every layer lands somewhere, because a layer
 * this function had no opinion about would silently stay in Ungrouped
 * and look like a bug in the palette.
 */
CsLayerGroups.classify = function(layerName) {
    if (layerName === undefined || layerName === null) {
        return CsLayerGroups.PLAN;
    }
    var name = String(layerName);

    // Scans and basemap first: several of them are CTRL- layers and
    // would otherwise be swallowed by Survey control below.
    var scans = CsLayerGroups.SCAN_LAYERS();
    for (var i = 0; i < scans.length; i++) {
        if (scans[i] !== undefined &&
                (name === scans[i] || name.indexOf(scans[i] + "-") === 0)) {
            return CsLayerGroups.SCANS;
        }
    }

    var frame = CsLayers.frameOf(name);
    if (frame === "sheet") {
        return CsLayerGroups.SHEET;
    }

    // Generated geometry, in whatever frame. Checked before the frame so
    // that CTRL-PROFILE-SHOTS is control rather than profile.
    if (name.indexOf("CTRL-") === 0) {
        return CsLayerGroups.CONTROL;
    }

    if (frame === "profile") {
        return CsLayerGroups.PROFILE;
    }
    if (frame === "section") {
        return CsLayerGroups.SECTIONS;
    }
    return CsLayerGroups.PLAN;
};

/**
 * \return A map of group name -> layer names, for the layer names given.
 *
 * Every group in GROUPS appears as a key even when it has no members: a
 * cave with no cross sections yet should still show the Sections group,
 * so that tracing one has somewhere obvious to go.
 */
CsLayerGroups.plan = function(layerNames) {
    var res = {};
    var i;
    for (i = 0; i < CsLayerGroups.GROUPS.length; i++) {
        res[CsLayerGroups.GROUPS[i]] = [];
    }
    for (i = 0; i < layerNames.length; i++) {
        res[CsLayerGroups.classify(layerNames[i])].push(layerNames[i]);
    }
    return res;
};
