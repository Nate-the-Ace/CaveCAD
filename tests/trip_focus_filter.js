// trip_focus_filter.js -- does the focus filter hide the right entities?
//
// Runs in CaveCAD's own engine against a real document:
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/trip_focus_filter.js "$PWD"
//
// Prints "### FILTER OK <n> checks" or "### FILTER FAIL".
//
// The entities are hand-built and hand-tagged rather than drawn by
// CsDraw.survey: CsDraw.survey reads the CURRENT document out of
// getDocument()/getDocumentInterface(), so pointing it at a scratch
// document means stubbing two globals, and this test is about the
// FILTER, not about drawing. Six tagged entities exercise every
// attribution mode there is.

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

include("scripts/EAction.js");
include("scripts/simple.js");

includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");

includeBasePath = repoRoot + "/scripts/CaveSurvey/TripFocus";
include(includeBasePath + "/TripFocusRows.js");
include(includeBasePath + "/TripFocus.js");

var checks = 0, failures = [];
function ok(cond, what) {
    checks++;
    if (!cond) { failures.push(what); }
}

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
di.setNotifyListeners(false);
CsLayers.ensureSurveyLayers(doc, di);
// ensureSurveyLayers only covers the layers every survey-drawing tool
// relies on (shots/stations/labels/LRUD/splays/hidden/aerial) -- it does
// NOT create the wall-run, profile-frame or sheet layers this test also
// tags entities on. Without these, doc.getLayerId() below returns
// INVALID_ID, tagged() never calls setLayerId, and each entity lands on
// whatever the document's current layer is instead -- silently
// defeating the isPlanFrame check the profile-band assertions depend on.
CsLayers.ensure(doc, di, CsLayers.LRUD_WALL_LEFT);
CsLayers.ensure(doc, di, CsLayers.PROFILE_FLOOR);
CsLayers.ensure(doc, di, CsLayers.TITLE_BLOCK);

/** A tagged line on `layer`, returned by id. */
function tagged(layer, tagKey, tagValue, x) {
    var op = new RAddObjectsOperation();
    var e = new RLineEntity(doc, new RLineData(
        new RVector(x, 0), new RVector(x + 5, 0)));
    var layerId = doc.getLayerId(layer);
    if (layerId !== RObject.INVALID_ID) {
        e.setLayerId(layerId);
    }
    if (tagKey !== null) {
        CsTags.set(e, tagKey, tagValue);
    }
    op.addObject(e, false);
    // Defensive, matching CsLayers' own convention: none of this test's
    // layers ship off, but a write that landed on one that did would be
    // silently dropped without this wrapper (see CsLayers.OFF), so every
    // add goes through it rather than assuming today's layer list stays
    // that way.
    CsLayers.withLayerOn(doc, di, layer, function() {
        di.applyOperation(op);
    });
    return e.getId();
}

var idA1     = tagged("CTRL-STATIONS", "Station", "A1", 0);
var idLegIn  = tagged("CTRL-SHOTS", "Shot", "A1->A2", 10);
var idLegOut = tagged("CTRL-SHOTS", "Shot", "A3->A4", 20);
var idTip    = tagged("CTRL-LRUD", "LRUDName", "A4.L2", 30);
var idWall   = tagged("CTRL-LRUD-WALL-LEFT", "WallRunStations",
    "A2|A3|A4", 40);
var idProf   = tagged("CTRL-PROFILE-FLOOR", "ProfileStation", "A1", 50);
var idPlain  = tagged("TITLE-BLOCK", null, "", 60);

function invisible(id) {
    var e = doc.queryEntity(id);
    return isNull(e) ? false : e.isInvisible();
}

// -- focus on A1/A2 ---------------------------------------------------
var set = {};
set["A1"] = true;
set["A2"] = true;
TripFocus.applyFocus(di, set);

ok(!invisible(idA1), "a focused station stays drawn");
ok(!invisible(idLegIn), "a leg with both ends focused stays drawn");
ok(invisible(idLegOut), "a leg outside the focus is hidden");
ok(invisible(idTip), "an LRUD tip of an unfocused station is hidden");
ok(!invisible(idWall),
    "a wall run touching a focused station stays drawn (ANY, not ALL)");
ok(invisible(idProf),
    "profile-frame geometry is never drawn: the viewer is plan only");
ok(!invisible(idPlain),
    "an untagged entity always stays drawn -- title block, border, basemap");

// -- All restores -- THE check that catches a broken un-hide path. Both
// idLegOut and idTip were just confirmed hidden above, so this is a real
// exercise of un-hiding, not a no-op that happens to read as passing.
TripFocus.applyFocus(di, null);
ok(!invisible(idLegOut) && !invisible(idTip),
    "All un-hides every plan entity (RChangePropertyOperation over the " +
    "selection -- a plain RModifyObjectsOperation + setInvisible() does " +
    "NOT persist in this build: RObject.PropertyInvisible is registered " +
    "only under RS.ObjectUnknown, so the property-diff modify silently " +
    "no-ops for an ordinary entity)");
ok(invisible(idProf),
    "All still leaves the profile band out: plan only is not a filter " +
    "the reader can switch off");

if (failures.length === 0) {
    print("### FILTER OK " + checks + " checks");
} else {
    print("### FILTER FAIL");
    for (var f = 0; f < failures.length; f++) { print("  - " + failures[f]); }
}
