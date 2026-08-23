// add_profile_layers.js -- one-shot, idempotent: adds the layers the
// extended elevation generator draws to into the PROFILE template.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tools/add_profile_layers.js "$PWD"
//
// Same shape as tools/upcase_template_text.js: an off-screen document,
// a modification, an export back over the same file. Safe to re-run --
// a layer already present is left alone and the file is not rewritten.

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try { if (typeof v.isNull === "function") { return v.isNull(); } } catch (e) {}
        return false;
    };
}

// name -> [colorName, linetype, lineweight]
var WANTED = [
    ["CTRL-PROFILE-FLOOR", "gray", "DASHED", RLineweight.Weight000],
    ["CTRL-PROFILE-CEILING", "gray", "DASHED", RLineweight.Weight000],
    ["CTRL-LRUD", "pink", "CONTINUOUS", RLineweight.Weight025],
    ["CTRL-SPLAYS", "gray", "CONTINUOUS", RLineweight.Weight000]
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

    var op = new RAddObjectsOperation();
    var added = 0;
    for (var i = 0; i < WANTED.length; i++) {
        var name = WANTED[i][0];
        if (doc.hasLayer(name)) {
            continue;
        }
        var layer = new RLayer(doc, name, false, false,
            new RColor(WANTED[i][1]), doc.getLinetypeId(WANTED[i][2]),
            WANTED[i][3]);
        op.addObject(layer);
        added++;
    }

    if (added === 0) {
        print("skip  " + path + " -- every layer already present");
        return true;
    }
    di.applyOperation(op);

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
