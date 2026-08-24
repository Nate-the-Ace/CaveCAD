// trip_focus_filter.js -- does the focus filter hide the right entities,
// and does building its preview ever touch the user's document?
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
// FILTER, not about drawing.
//
// COVERAGE, HONESTLY STATED (a mutation-testing pass found the previous
// version of this file mostly toothless -- four of five hand-tried
// mutants survived it; see the plan doc, Task 5):
//   - All four attribution modes ("one", "pair", "list", and the
//     otherwise-untested "linework" list variant) are each exercised
//     with BOTH a member in focus AND every member out of focus. The
//     "every member out of focus -> hidden" half is the one a plain
//     "stays drawn" assertion cannot catch: CsFocus.isVisible's
//     deliberate fail-safe (an entity it cannot attribute STAYS
//     VISIBLE, see CsFocus.js's own header) makes a dead attribution
//     path -- e.g. CsBind.decodeStations always returning [] -- read
//     as a working OR unless something with every station out of
//     focus is also checked and expected HIDDEN. Before this pass nothing
//     here did that for the "list" mode, so the wall-run assertion whose
//     message read "(ANY, not ALL)" could not actually fail for the
//     reason it named.
//   - The "pair" mode's AND requirement (CsFocus.ALL_ENDS_MODES) gets its
//     own leg with exactly one end in focus, expected HIDDEN -- nothing
//     else here would notice ALL_ENDS_MODES being emptied or deleted.
//   - applyFocus's "already in the right state" skip is pinned by
//     calling it twice with an equivalent (but not object-identical)
//     station set and requiring the second call's return value to be
//     exactly 0.
//   - TripFocus.buildPreview -- the function the feature's entire
//     no-write guarantee rests on, and until this pass never exercised
//     by any test at all -- gets its own section proving the SOURCE
//     document comes back with isModified(), its selection, its
//     storage's last transaction id and every entity's isInvisible()
//     flag all unchanged, and that the PREVIEW it built genuinely
//     received the entities rather than truthfully reporting a count
//     nobody independently checked.
//
// WHAT THIS FILE DELIBERATELY DOES NOT COVER: nothing here is tagged
// onto an OFF layer (CTRL-RAW, CTRL-HIDDEN, CTRL-DATA) -- see the
// repeat-call check below for why that has to hold for the skip
// assertion to mean anything today. It also does not test
// TripFocus.picked, wireList, reapply, refresh, show or cleanUp --
// those are GUI-adjacent and are the Task 5 GUI check's job, not this
// headless test's.

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

// The four entities below close the mutation-testing gaps: every one of
// them has EVERY station (or, for the leg, exactly one end) out of the
// A1/A2 focus used below, so "hidden" is the only correct answer and a
// fail-safe-by-accident (dead attribution reading as "unknown, so stays
// visible") shows up as a wrong one.
var idWallOut = tagged("CTRL-LRUD-WALL-LEFT", "WallRunStations",
    "B1|B2", 70);
var idLegPartial = tagged("CTRL-SHOTS", "Shot", "A2->B3", 80);
// "linework" is TAG_RULES' fourth mode and, per CsFocus.js's own header,
// the one no test exercised at all. The layer here carries no
// attribution meaning of its own (LineworkStations is a tag, not a
// layer rule) -- CTRL-SHOTS is reused simply because it is already
// ensured and is plan-frame.
var idLineworkIn = tagged("CTRL-SHOTS", "LineworkStations", "A2|Z9", 90);
var idLineworkOut = tagged("CTRL-SHOTS", "LineworkStations",
    "Z9|Z10", 100);

function invisible(id) {
    var e = doc.queryEntity(id);
    return isNull(e) ? false : e.isInvisible();
}

// -- focus on A1/A2 ---------------------------------------------------
var set = {};
set["A1"] = true;
set["A2"] = true;
var changed1 = TripFocus.applyFocus(di, set);
ok(changed1 > 0,
    "the first focus call changes something -- a baseline for the " +
    "repeat-call check below, which expects exactly 0");
ok(doc.querySelectedEntities().length === 0,
    "applyFocus leaves no selection behind on the document it just " +
    "filtered -- it drives RChangePropertyOperation through its own " +
    "select/apply/clear dance (see its own docblock), and the final " +
    "clearSelection() is what keeps the toShow/toHide working list from " +
    "leaking out as a selection nobody asked for");

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

ok(invisible(idWallOut),
    "a wall run whose stations are ALL out of focus is hidden -- catches " +
    "list attribution dying silently into the fail-safe (e.g. " +
    "CsBind.decodeStations returning []), which the ANY-not-ALL check " +
    "above cannot: that check only ever needs ONE hit, so a broken " +
    "decoder that reports NO stations at all reads as \"unknown, stays " +
    "visible\" and still passes it");
ok(invisible(idLegPartial),
    "a leg with exactly one end in focus is hidden -- pins the pair " +
    "mode's AND requirement (CsFocus.ALL_ENDS_MODES); with that map " +
    "emptied, pair degrades to the same OR every other mode uses and " +
    "this leg would wrongly stay drawn on its one matching end");
ok(!invisible(idLineworkIn),
    "linework touching a focused station stays drawn (list/OR, the " +
    "same rule a wall run follows) -- LineworkStations was previously " +
    "untested even though it is one of TAG_RULES' four modes");
ok(invisible(idLineworkOut),
    "linework whose stations are ALL out of focus is hidden -- the " +
    "linework counterpart of the wall-run check above");

// -- repeat call: the state-skip optimisation --------------------------
// applyFocus only counts and touches entities whose current
// isInvisible() disagrees with what the new stationSet wants (the
// "already in the right state" `continue` in its loop). Nothing pinned
// that before this pass: every assertion above is about which entities
// end up hidden or shown, and all of them would still pass whether or
// not that skip exists, because the FINAL state is identical either
// way -- only the reported `changed` count differs.
//
// This document is deliberately free of any entity tagged onto an OFF
// layer (CTRL-RAW, CTRL-HIDDEN, CTRL-DATA). A concurrent fix elsewhere
// on this branch is closing a real bug in applyFocus: an entity on an
// OFF layer never actually gets its RChangePropertyOperation applied
// (the same silent-refusal-on-an-off-layer rule CsLayers.withLayerOn
// exists to route around for adds), so its isInvisible() never settles
// into the wanted state and `changed` can never reach 0 while such an
// entity is present. Keeping this test's entities off-layer-free is
// what makes the assertion below meaningful right now rather than
// something that would fail today regardless of whether the skip
// exists.
var setRepeat = {};
setRepeat["A1"] = true;
setRepeat["A2"] = true;
var changed2 = TripFocus.applyFocus(di, setRepeat);
ok(changed2 === 0,
    "a repeat call with an equivalent (but not object-identical) " +
    "station set reports changed === 0 -- pins the \"already in the " +
    "right state\" skip that a mutant could delete without any " +
    "hide/show assertion above noticing");

// -- All restores -- THE check that catches a broken un-hide path. Every
// one of idLegOut, idTip, idWallOut, idLegPartial and idLineworkOut was
// just confirmed hidden above, so this is a real exercise of un-hiding,
// not a no-op that happens to read as passing.
TripFocus.applyFocus(di, null);
ok(!invisible(idLegOut) && !invisible(idTip) && !invisible(idWallOut) &&
    !invisible(idLegPartial) && !invisible(idLineworkOut),
    "All un-hides every plan entity (RChangePropertyOperation over the " +
    "selection -- a plain RModifyObjectsOperation + setInvisible() does " +
    "NOT persist in this build: RObject.PropertyInvisible is registered " +
    "only under RS.ObjectUnknown, so the property-diff modify silently " +
    "no-ops for an ordinary entity)");
ok(invisible(idProf),
    "All still leaves the profile band out: plan only is not a filter " +
    "the reader can switch off");

// -- buildPreview: the no-write guarantee ------------------------------
// This is the single most important property of the whole feature (see
// TripFocus.js's own header) and, before this pass, had no automated
// proof at all.
//
// A FRESH, SEPARATE document -- NOT `doc` above. `doc` by this point
// has idProf sitting permanently invisible (the plan-only rule hides it
// under every focus, including All -- see the assertion just above),
// and that turns out to matter: RCopyOperation's transaction never sets
// allowInvisible/allowAll (confirmed by reading RCopyOperation.cpp,
// which sets neither), so REntity::isEditable() refuses ANY invisible
// entity in the copy selection, and RTransaction::addObject's failure
// is ATOMIC -- one unelidable entity anywhere in the selection fails
// the WHOLE transaction, and buildPreview never checks
// di.applyOperation's return value to notice. Confirmed against the
// real engine while writing this test: pointing buildPreview at `doc`
// produced a stderr "entity not editable (locked or hidden layer)"
// warning and an EMPTY preview (0 of 11 entities), entirely because of
// the one permanently-hidden idProf. That is a real defect in
// buildPreview -- any source document with so much as one hidden
// entity (a user's own "Hide Selected", or a legitimate CTRL-HIDDEN
// leg) would open Trip Focus onto a silently empty or truncated
// preview -- but it is a defect in TripFocus.js, out of scope for this
// file, and reported separately rather than fixed here. A second,
// pristine source document sidesteps it so the no-write assertions
// below test what they say they test, rather than tripping over an
// unrelated bug.
var srcDoc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var srcDi = new RDocumentInterface(srcDoc);
srcDi.setNotifyListeners(false);
CsLayers.ensureSurveyLayers(srcDoc, srcDi);

/** Same shape as tagged() above, but against an explicit doc/di pair
 *  rather than the shared `doc`/`di` -- this section needs its own
 *  document (see the comment above), and none of its entities need
 *  withLayerOn since ensureSurveyLayers' layers all ship visible. */
function taggedOn(targetDoc, targetDi, layer, tagKey, tagValue, x) {
    var op = new RAddObjectsOperation();
    var e = new RLineEntity(targetDoc, new RLineData(
        new RVector(x, 0), new RVector(x + 5, 0)));
    var layerId = targetDoc.getLayerId(layer);
    if (layerId !== RObject.INVALID_ID) {
        e.setLayerId(layerId);
    }
    CsTags.set(e, tagKey, tagValue);
    op.addObject(e, false);
    targetDi.applyOperation(op);
    return e.getId();
}

taggedOn(srcDoc, srcDi, "CTRL-STATIONS", "Station", "S1", 0);
taggedOn(srcDoc, srcDi, "CTRL-SHOTS", "Shot", "S1->S2", 10);
taggedOn(srcDoc, srcDi, "CTRL-LRUD", "LRUDName", "S2.L1", 20);

var sourceIds = srcDoc.queryAllEntities(false, false);
var sourceInvisibleBefore = {};
var si;
for (si = 0; si < sourceIds.length; si++) {
    var se = srcDoc.queryEntity(sourceIds[si]);
    sourceInvisibleBefore[sourceIds[si]] = isNull(se) ? null :
        se.isInvisible();
}
var modifiedBefore = srcDoc.isModified();
var selectedBefore = srcDoc.querySelectedEntities().length;
var txnBefore = srcDoc.getStorage().getLastTransactionId();
ok(selectedBefore === 0,
    "sanity: nothing is selected on the source document going into " +
    "buildPreview, so the restore checked below is a real one");

var preview = TripFocus.buildPreview(srcDoc);

ok(preview.entityCount === sourceIds.length,
    "buildPreview reports exactly the source's own model-space entity " +
    "count");
var previewIds = preview.di.getDocument().queryAllEntities(false, false);
ok(previewIds.length === sourceIds.length,
    "the PREVIEW document itself holds that many entities -- checked " +
    "independently of the count buildPreview reports, so a buildPreview " +
    "that silently copied nothing could not pass this by simply " +
    "reporting a truthful-looking number for an empty copy");

// Exercise the preview -- filtering it must actually be possible, and
// doing so must never reach back to the source (checked below).
var previewSet = {};
previewSet["S1"] = true;
var previewChanged = TripFocus.applyFocus(preview.di, previewSet);
ok(previewChanged > 0,
    "the preview can be filtered independently of the source -- a " +
    "buildPreview that copied inert stubs with none of the source's " +
    "tags or layers would make this filter call a no-op");

ok(srcDoc.isModified() === modifiedBefore,
    "buildPreview + filtering the copy leaves the source's " +
    "isModified() exactly as it was");
var selectedAfter = srcDoc.querySelectedEntities().length;
ok(selectedAfter === selectedBefore && selectedAfter === 0,
    "the source's selection ends where it started (0) -- buildPreview's " +
    "own docblock documents a transient select/restore against the " +
    "source to drive RCopyOperation, and this is that restore's proof");
ok(srcDoc.getStorage().getLastTransactionId() === txnBefore,
    "no transaction landed on the source document's storage while " +
    "building or filtering the preview");

var sourceUntouched = true;
var sj;
for (sj = 0; sj < sourceIds.length; sj++) {
    var se2 = srcDoc.queryEntity(sourceIds[sj]);
    var nowInvisible = isNull(se2) ? null : se2.isInvisible();
    if (nowInvisible !== sourceInvisibleBefore[sourceIds[sj]]) {
        sourceUntouched = false;
    }
}
ok(sourceUntouched,
    "no source entity's isInvisible() flipped when the PREVIEW -- a " +
    "wholly separate document -- was filtered");

destr(preview.di);
destr(srcDi);

if (failures.length === 0) {
    print("### FILTER OK " + checks + " checks");
} else {
    print("### FILTER FAIL");
    for (var f = 0; f < failures.length; f++) { print("  - " + failures[f]); }
}
