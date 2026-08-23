// add_profile_layers.js -- one-shot, idempotent: adds the layers the
// extended elevation generator draws to into the PROFILE template.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tools/add_profile_layers.js "$PWD"
//
// Same shape as tools/upcase_template_text.js: an off-screen document,
// a modification, an export back over the same file. Safe to re-run --
// a layer already present is left alone and the file is not rewritten.
//
// Carries only the LIST of layers it is responsible for adding, never
// their appearance. CsLayers.ensure(doc, di, name) -- the same function
// every drawing tool calls -- is the one place that resolves a layer's
// colour/linetype/lineweight, from CsLayers.DEFAULTS in Core/CsLayers.js.
// An earlier version of this file carried its own copy of that table;
// nothing would have caught it drifting from DEFAULTS, which a mutation
// review confirmed by deleting the DEFAULTS entries and watching the
// whole suite stay green. Reading DEFAULTS through ensure() closes that
// gap by construction: there is exactly one definition of what
// CTRL-PROFILE-FLOOR looks like.

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

// Layers the extended elevation generator draws to. Named through the
// registry, not string literals, so a rename of the constant is a
// syntax error here rather than a silent drift.
var WANTED = [
    CsLayers.PROFILE_FLOOR,
    CsLayers.PROFILE_CEILING,
    CsLayers.LRUD,
    CsLayers.SPLAYS
];

/** The DXF writer that persists custom properties: see the plan's
 *  Task 7 note. Lowest canExport score wins, and the dxflib factory
 *  scores 1 for a filter naming it against 100 for a bare .dxf. */
function dxfLibFilter() {
    var filters = RFileExporterRegistry.getFilterStrings();
    for (var i = 0; i < filters.length; i++) {
        if (String(filters[i]).indexOf("dxflib") >= 0) {
            return filters[i];
        }
    }
    return "";   // no dxflib writer in this build; let the registry choose
}

function addLayers(path) {
    var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
    var di = new RDocumentInterface(doc);
    if (di.importFile(path, "", false) !== RDocumentInterface.IoErrorNoError) {
        print("FAIL  cannot read " + path);
        return false;
    }

    var added = 0;
    for (var i = 0; i < WANTED.length; i++) {
        var name = WANTED[i];
        if (doc.hasLayer(name)) {
            continue;
        }
        CsLayers.ensure(doc, di, name);
        added++;
    }

    if (added === 0) {
        print("skip  " + path + " -- every layer already present");
        return true;
    }

    if (di.exportFile(path, dxfLibFilter()) !== true) {
        print("FAIL  cannot write " + path);
        return false;
    }
    print("ok    " + path + " -- " + added + " layer(s) added");
    return true;
}

var target = repoRoot + "/templates/NSS_Cave_Template_PROFILE.dxf";
if (!addLayers(target)) {
    print("### ADD PROFILE LAYERS FAIL");
} else {
    print("### ADD PROFILE LAYERS OK");
}
