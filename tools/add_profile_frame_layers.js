// add_profile_frame_layers.js -- one-shot, idempotent: gives BOTH
// shipped templates the profile frame's own layer set.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tools/add_profile_frame_layers.js "$PWD"
//
// Two jobs, one pass per template:
//
//   PLAN template    the elevation is now drawn INTO the plan drawing,
//                    so every profile-frame layer has to be there
//                    already rather than invented at runtime.
//
//   PROFILE template kept as a standalone elevation sheet, but its view
//                    layers carried PLAN-frame names (CTRL-SHOTS,
//                    TEXT-LABELS, BREAKDOWN...). A drawing started from
//                    it would answer "plan" to CsLayers.frameOf for its
//                    own elevation linework -- exactly the collision
//                    this frame split exists to remove -- so those are
//                    RENAMED into the frame first, then the rest added.
//
// Same shape as tools/add_profile_layers.js: an off-screen document, a
// modification, an export back over the same file. Safe to re-run -- a
// template already carrying the frame is left alone and its file is not
// rewritten.
//
// Carries only the LIST of layers it is responsible for, never their
// appearance. CsLayers.ensure(doc, di, name) -- the same function every
// drawing tool calls -- is the one place that resolves a layer's
// colour/linetype/lineweight, from CsLayers.DEFAULTS in Core/CsLayers.js.
// An earlier tool in this family carried its own copy of that table and
// nothing would have caught it drifting; reading DEFAULTS through
// ensure() closes that by construction.

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];
var core = repoRoot + "/scripts/CaveSurvey/Core";

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try { if (typeof v.isNull === "function") { return v.isNull(); } } catch (e) {}
        return false;
    };
}

includeBasePath = core;
include(core + "/CsLayers.js");

// The profile frame, named through the registry rather than as string
// literals, so a renamed constant is caught here instead of drifting.
var WANTED = [
    CsLayers.PROFILE_SHOTS,
    CsLayers.PROFILE_STATIONS,
    CsLayers.PROFILE_STATION_LABELS,
    CsLayers.PROFILE_SPLAYS,
    CsLayers.PROFILE_LRUD,
    CsLayers.PROFILE_FLOOR,
    CsLayers.PROFILE_CEILING,
    CsLayers.PROFILE_TRACED_CEILING,
    CsLayers.PROFILE_TRACED_FLOOR,
    CsLayers.PROFILE_WALLS_INFERRED,
    CsLayers.PROFILE_TEXT_NOTES,
    CsLayers.PROFILE_TEXT_LABELS,
    CsLayers.PROFILE_BREAKDOWN,
    CsLayers.PROFILE_ENTRANCE
];

/**
 * Every profile-frame layer in the registry must be in WANTED above.
 * The list is written out by hand so a mutation can delete one entry
 * and be caught; this check is what stops a layer ADDED to the registry
 * later from being quietly left out of both templates instead.
 *
 * \return the names that are missing, empty when the list is complete
 */
function missingFromWanted() {
    var out = [], k, i, found;
    for (k in CsLayers) {
        if (!CsLayers.hasOwnProperty(k) || typeof CsLayers[k] !== "string") {
            continue;
        }
        if (CsLayers.frameOf(CsLayers[k]) !== "profile") {
            continue;
        }
        found = false;
        for (i = 0; i < WANTED.length; i++) {
            if (WANTED[i] === CsLayers[k]) { found = true; }
        }
        if (!found) { out.push(CsLayers[k]); }
    }
    return out;
}

/**
 * The PLAN-frame name a profile-frame layer replaces, by the mirror of
 * CsLayers.frameOf's own prefix rule: CTRL-PROFILE-X was CTRL-X, and
 * PROFILE-X was X. Derived rather than tabulated, so the rename map
 * cannot disagree with the frame test about which pairs are twins.
 *
 * \return the twin's name
 */
function planTwinOf(name) {
    if (name.indexOf("CTRL-PROFILE-") === 0) {
        return "CTRL-" + name.substring("CTRL-PROFILE-".length);
    }
    return name.substring("PROFILE-".length);
}

/** The DXF writer that persists custom properties. Lowest canExport
 *  score wins, and the dxflib factory scores 1 for a filter naming it
 *  against 100 for a bare .dxf. */
function dxfLibFilter() {
    var filters = RFileExporterRegistry.getFilterStrings();
    for (var i = 0; i < filters.length; i++) {
        if (String(filters[i]).indexOf("dxflib") >= 0) {
            return filters[i];
        }
    }
    return "";   // no dxflib writer in this build; let the registry choose
}

/**
 * Renames a plan-frame view layer into the profile frame, keeping the
 * layer object -- and therefore every entity already on it -- intact.
 * Refuses when the profile-frame name is already taken: two layers
 * cannot merge, and silently dropping one would lose whatever is on it.
 *
 * \return true when a rename happened
 */
function renameIntoFrame(doc, di, from, to) {
    if (!doc.hasLayer(from) || doc.hasLayer(to)) {
        return false;
    }
    var lay = doc.queryLayer(from);
    if (isNull(lay)) {
        return false;
    }
    lay.setName(to);
    var op = new RModifyObjectsOperation();
    op.addObject(lay, false);
    di.applyOperation(op);
    return true;
}

/**
 * \param path      the template to migrate
 * \param withRenames true for the PROFILE template, whose existing view
 *                  layers are the plan-frame twins of what it should
 *                  carry; false for the PLAN template, whose plan-frame
 *                  layers are its OWN and must not be touched.
 */
function addFrame(path, withRenames) {
    var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
    var di = new RDocumentInterface(doc);
    if (di.importFile(path, "", false) !== RDocumentInterface.IoErrorNoError) {
        print("FAIL  cannot read " + path);
        return false;
    }

    var changed = 0, renamed = 0, added = 0, i, name;

    if (withRenames) {
        for (i = 0; i < WANTED.length; i++) {
            if (renameIntoFrame(doc, di, planTwinOf(WANTED[i]), WANTED[i])) {
                renamed++;
                changed++;
            }
        }
    }

    for (i = 0; i < WANTED.length; i++) {
        name = WANTED[i];
        if (doc.hasLayer(name)) {
            continue;
        }
        CsLayers.ensure(doc, di, name);
        added++;
        changed++;
    }

    if (changed === 0) {
        print("skip  " + path + " -- every layer already present");
        return true;
    }

    if (di.exportFile(path, dxfLibFilter()) !== true) {
        print("FAIL  cannot write " + path);
        return false;
    }
    print("ok    " + path + " -- " + added + " layer(s) added, " +
        renamed + " renamed");
    return true;
}

var gaps = missingFromWanted();
var ok = true;
if (gaps.length > 0) {
    print("FAIL  profile-frame layers missing from this tool's list: " +
        gaps.join(", "));
    ok = false;
} else {
    ok = addFrame(repoRoot + "/templates/NSS_Cave_Template_PLAN.dxf", false);
    if (!addFrame(repoRoot + "/templates/NSS_Cave_Template_PROFILE.dxf",
            true)) {
        ok = false;
    }
}

if (!ok) {
    print("### ADD PROFILE FRAME LAYERS FAIL");
} else {
    print("### ADD PROFILE FRAME LAYERS OK");
}
