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
// A SECOND PASS (2026-08-24, code review C1/C2/I3/I4/I5) closed the
// remaining gaps that same review found: this file used to call
// applyFocus with two arguments at EVERY site (the fallback path only),
// leaving buildAttribution, isAttVisible, rebuildHiddenEntity,
// ensureLayerLike, entityClassName and copyStatusText at zero coverage.
// Now also proven, each with its own dedicated fixture document so
// nothing here disturbs the shared doc/di's own state above:
//   - A hidden entity's custom properties -- ALL of them, not only the
//     tags this suite happens to know about -- survive the by-hand
//     rebuild, and the fail-safe rule can no longer mask a lost tag by
//     keeping an unattributable entity visible under every focus (C1).
//   - A hidden entity on an OFF layer (CTRL-RAW) rebuilds instead of
//     being silently absent, the destination layer actually ends up
//     OFF rather than FROZEN (a real constructor-argument-order bug in
//     ensureLayerLike, found while fixing this), and a rebuilt block
//     reference whose block was never otherwise copied is counted as
//     unrebuilt rather than added as a dangling reference (C2).
//   - A VISIBLE entity on an off layer -- never individually hidden,
//     the selection step alone drops it -- is now counted the same way
//     (I3). This is the one place in this file that DOES now tag
//     something onto CTRL-RAW, but only in its own dedicated
//     document, never the shared doc/di the repeat-call skip check
//     above depends on staying off-layer-free.
//   - pickKey/applyPickKeys, the data-level fix behind Refresh no
//     longer discarding what was checked, against hand-built entries
//     (I4).
//   - currentDocument()/refresh()'s guards against a window that is
//     not actually open (I5) -- the crash those guards exist for
//     (calling any method on an RDocument whose RDocumentInterface has
//     already been destr()'d) cannot be reproduced here without
//     segfaulting the whole test process, so it is documented in the
//     report instead of asserted on.
//   - isAttVisible is pinned against CsFocus.isVisible itself, over
//     every fixture entity crossed with every station-set shape
//     reapply() can hand applyFocus, so the two hand-copies cannot
//     drift apart silently again.
//
// WHAT THIS FILE STILL DELIBERATELY DOES NOT COVER: TripFocus.picked,
// wireList, syncHeaderChecked, reapply, show or cleanUp -- those need a
// live QDialog/splitter (or are thin wiring over functions already
// covered directly) and are the GUI check's job, not this headless
// test's.

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

// -- isAttVisible pinned against CsFocus.isVisible ---------------------
// TripFocus.isAttVisible is a DELIBERATE hand-copy of CsFocus.isVisible's
// own per-attribution logic (see its own docblock for why buildAttribution
// makes that necessary), which its own docblock admits must be kept in
// step. Nothing pinned that before this pass -- a change to either one
// alone could drift the two apart with no test noticing. Reuses the
// fixtures already tagged above rather than building new ones, across
// every station set shape reapply() can actually hand applyFocus:
// null, undefined (both mean "All"), a set with real hits, and a set
// with none.
var pinIds = [idA1, idLegIn, idLegOut, idTip, idWall, idWallOut, idProf,
    idPlain, idLegPartial, idLineworkIn, idLineworkOut];
var pinSetWithHits = {};
pinSetWithHits["A1"] = true;
pinSetWithHits["A2"] = true;
var pinSetNoHits = {};
pinSetNoHits["Z99"] = true;
var pinSets = [null, undefined, pinSetWithHits, pinSetNoHits, {}];
var pinMismatches = [];
for (var pi = 0; pi < pinIds.length; pi++) {
    var pinEntity = doc.queryEntity(pinIds[pi]);
    if (isNull(pinEntity)) {
        continue;
    }
    var pinAtt = CsFocus.stationsOf(pinEntity);
    for (var pj = 0; pj < pinSets.length; pj++) {
        var viaSuite = TripFocus.isAttVisible(pinAtt, pinSets[pj]);
        var viaCore = CsFocus.isVisible(pinEntity, pinSets[pj]);
        if (viaSuite !== viaCore) {
            pinMismatches.push(pinIds[pi] + "/" + pj);
        }
    }
}
ok(pinMismatches.length === 0,
    "TripFocus.isAttVisible agrees with CsFocus.isVisible for every " +
    "fixture entity crossed with every station-set shape tried " +
    "(mismatches: " + pinMismatches.join(", ") + ")");

// -- cached path: applyFocus with a real attribution cache -------------
// Every applyFocus call above passed only two arguments, the fallback
// path that recomputes layer and attribution per entity -- the THIRD
// argument (the cache buildAttribution/buildPreview actually hand it in
// production) had zero coverage. Force the opposite state first (via
// the uncached path already proven correct above) so the cached call
// below has real hide/show work to do rather than hitting the
// "already in the right state" skip for everything by accident.
var cacheBuilt = TripFocus.buildAttribution(doc);
ok(cacheBuilt.entityCount === doc.queryAllEntities(false, false).length,
    "buildAttribution reports this document's own entity count");

TripFocus.applyFocus(di, null);   // uncached: known-good baseline state
var cacheSet = {};
cacheSet["A1"] = true;
cacheSet["A2"] = true;
var cachedChanged = TripFocus.applyFocus(di, cacheSet,
    cacheBuilt.attribution);
ok(cachedChanged > 0,
    "the cached path still finds real hide/show work and reports a " +
    "non-zero changed count");
ok(!invisible(idA1) && !invisible(idLegIn),
    "cached path: a focused station and a fully-focused leg stay drawn");
ok(invisible(idLegOut) && invisible(idWallOut) && invisible(idLineworkOut),
    "cached path: entities out of focus are hidden exactly as the " +
    "uncached path already proved above -- the cache must drive the " +
    "SAME decision, not a different one");

TripFocus.applyFocus(di, null, cacheBuilt.attribution);
ok(!invisible(idLegOut) && !invisible(idWallOut) && !invisible(idLineworkOut),
    "cached path: All un-hides through the cache too");
ok(invisible(idProf),
    "cached path: All still leaves the profile band out through the " +
    "cache too");

// -- entityClassName and copyStatusText: zero coverage before this -----
ok(TripFocus.entityClassName(doc.queryEntity(idA1)) === "RLineEntity",
    "entityClassName reads the concrete class name off toString(), " +
    "trimming the trailing ' [JS]'");
ok(TripFocus.copyStatusText(0, 0) !== null,
    "copyStatusText reports an entirely empty preview");
ok(TripFocus.copyStatusText(5, 0) === null,
    "copyStatusText says nothing when the preview is complete");
ok(TripFocus.copyStatusText(5, 2) !== null,
    "copyStatusText reports a preview that is short some entities");

// -- pickKey / applyPickKeys: Refresh no longer discards the reader's --
// picks (I4). Hand-built {section, pick, box} entries, deliberately NOT
// routed through buildList/TripFocusRows -- these two functions only
// care about that shape, and hand-building it keeps this fixture free
// of needing a full tagged survey drawing just to get trip/team/run
// rows. Real QCheckBox objects (confirmed constructible headless above
// this file's own buildList already relies on them existing).
function pickEntry(section, pick) {
    return { section: section, pick: pick, box: new QCheckBox() };
}
ok(TripFocus.pickKey({ section: "trips", pick: 3 }) === "trips:3",
    "pickKey stringifies a numeric trip pick");
ok(TripFocus.pickKey({ section: "people", pick: "Nathan" }) ===
    "people:Nathan",
    "pickKey stringifies a string pick unchanged");
ok(TripFocus.pickKey({ section: "runs", pick: null }) === null,
    "pickKey returns null for an unpickable row, matching picked()'s " +
    "own skip");

var beforeEntries = [pickEntry("trips", 0), pickEntry("trips", 1),
    pickEntry("teams", "Bravo"), pickEntry("runs", "A")];
beforeEntries[0].box.setChecked(true);
beforeEntries[2].box.setChecked(true);
beforeEntries[3].box.setChecked(true);
var beforeKeys = [];
for (var bk = 0; bk < beforeEntries.length; bk++) {
    if (beforeEntries[bk].box.checked) {
        beforeKeys.push(TripFocus.pickKey(beforeEntries[bk]));
    }
}
ok(beforeKeys.length === 3, "sanity: three boxes ticked before the " +
    "simulated rebuild");

// The simulated Refresh rebuild: a brand new entries array, all
// unchecked (exactly what buildList hands back), and "runs:A" is gone
// -- simulating a run that no longer exists in this reading of the
// drawing.
var afterEntries = [pickEntry("trips", 0), pickEntry("trips", 1),
    pickEntry("teams", "Bravo"), pickEntry("runs", "B")];
var missing = TripFocus.applyPickKeys(afterEntries, beforeKeys);
ok(afterEntries[0].box.checked === true,
    "applyPickKeys re-ticks a surviving trip pick by key");
ok(afterEntries[1].box.checked === false,
    "applyPickKeys leaves an untouched row alone");
ok(afterEntries[2].box.checked === true,
    "applyPickKeys re-ticks a surviving team pick by key");
ok(afterEntries[3].box.checked === false,
    "applyPickKeys does not tick an unrelated row that merely shares " +
    "a section with a stale key");
ok(missing.length === 1 && missing[0] === "runs:A",
    "a pick whose key no longer exists after the rebuild is reported " +
    "back rather than silently dropped");

// -- TripFocus.refresh()/currentDocument() guards (I5) ------------------
// The real crash this closes cannot be reproduced here without
// segfaulting the whole test process: probed separately (see the
// report) that calling ANY method on an RDocument whose
// RDocumentInterface has already been destr()'d segfaults outright
// rather than throwing a catchable exception, and that neither
// isNull() nor isDeleted() can tell a freed RDocument from a live one
// beforehand. What IS safe and pinned here: currentDocument() resolving
// to null rather than a stale reference when there is no current
// document to find (exactly this headless harness's own situation),
// and refresh() guarding against a window that never finished opening
// or has already been torn down, instead of dereferencing a null
// state/previewDi.
ok(TripFocus.currentDocument() === null,
    "currentDocument() reports null rather than a stale wrapper when " +
    "this headless engine has no 'current document' for the main " +
    "window to return");

var savedState = TripFocus.state;
var savedPreviewDi = TripFocus.previewDi;
TripFocus.state = null;
TripFocus.previewDi = null;
var refreshThrew = false;
try {
    TripFocus.refresh();
} catch (eRefreshGuard) {
    refreshThrew = true;
}
ok(!refreshThrew,
    "refresh() guards against a null state/previewDi instead of " +
    "throwing when the window is not actually open");
TripFocus.state = savedState;
TripFocus.previewDi = savedPreviewDi;

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

// -- C1: a hidden entity keeps its XDATA through the rebuild -----------
// rebuildHiddenEntity used to build the fresh entity from getData()
// alone, which carries geometry, NOT custom properties. Probed on the
// old code: a hidden station point tagged Station='A9' arrived in the
// preview with Station='', which CsFocus.stationsOf reads as
// {names:[],kind:"none"} -- the fail-safe rule then keeps it visible
// under EVERY focus, and applyFocus's first reapply() ACTIVELY UN-HIDES
// it. A fresh, dedicated document: this must not disturb the shared
// doc/di's own state above.
var c1Src = new RDocument(new RMemoryStorage(), createSpatialIndex());
var c1Di = new RDocumentInterface(c1Src);
c1Di.setNotifyListeners(false);
CsLayers.ensureSurveyLayers(c1Src, c1Di);

var c1Entity = new RLineEntity(c1Src, new RLineData(
    new RVector(0, 0), new RVector(5, 0)));
var c1LayerId = c1Src.getLayerId("CTRL-STATIONS");
if (c1LayerId !== RObject.INVALID_ID) {
    c1Entity.setLayerId(c1LayerId);
}
CsTags.set(c1Entity, "Station", "A9");
// a custom property in a group this suite has never heard of --
// "not just the tags this suite happens to know about"
c1Entity.setCustomProperty("SomeOtherTool", "Marker", "keep-me");
var c1AddOp = new RAddObjectsOperation();
c1AddOp.addObject(c1Entity, false);
c1Di.applyOperation(c1AddOp);
var c1Id = c1Entity.getId();
c1Src.selectEntities([c1Id], false);
c1Di.applyOperation(new RChangePropertyOperation(
    RObject.PropertyInvisible, true, RS.EntityAll, false));
c1Src.clearSelection();
ok(c1Src.queryEntity(c1Id).isInvisible(),
    "sanity: the C1 fixture entity is genuinely hidden in its source " +
    "before buildPreview ever sees it");

var c1Preview = TripFocus.buildPreview(c1Src);
ok(c1Preview.unrebuilt === 0,
    "C1: a hidden, tagged entity on a normal layer still rebuilds " +
    "cleanly (unrebuilt stays 0)");
var c1PreviewIds = c1Preview.di.getDocument().queryAllEntities(false, true);
ok(c1PreviewIds.length === 1,
    "sanity: the preview holds exactly the one rebuilt entity");
var c1PreviewEntity = c1Preview.di.getDocument().queryEntity(c1PreviewIds[0]);
ok(CsTags.get(c1PreviewEntity, "Station") === "A9",
    "C1: the rebuilt entity's Station tag survives the rebuild -- " +
    "before this fix getData() carried geometry only and this read " +
    "back '' instead");
ok(c1PreviewEntity.getCustomProperty("SomeOtherTool", "Marker", "") ===
    "keep-me",
    "C1: a custom property OUTSIDE CsTags.GROUP survives too -- " +
    "copyCustomPropertiesFrom copies every property group the entity " +
    "carries, not only the tags this suite happens to know about");

var c1Att = c1Preview.attribution[c1PreviewIds[0]];
ok(c1Att.att.kind !== "none" && c1Att.att.names.indexOf("A9") !== -1,
    "C1: the preview's own attribution cache resolves the rebuilt " +
    "entity to A9, not the fail-safe 'unknown' kind");

// The bug this closes, exercised end to end: applyFocus must be able to
// correctly HIDE this entity under a focus that excludes A9 (before
// the fix, the fail-safe rule kept it visible under every focus,
// including this one) and correctly SHOW it under a focus that
// includes A9.
var c1FocusOut = {};
c1FocusOut["B1"] = true;
TripFocus.applyFocus(c1Preview.di, c1FocusOut, c1Preview.attribution);
ok(c1Preview.di.getDocument().queryEntity(c1PreviewIds[0]).isInvisible(),
    "C1: under a focus excluding A9, the rebuilt entity is hidden -- " +
    "the fail-safe rule no longer masks a lost tag");
var c1FocusIn = {};
c1FocusIn["A9"] = true;
TripFocus.applyFocus(c1Preview.di, c1FocusIn, c1Preview.attribution);
ok(!c1Preview.di.getDocument().queryEntity(c1PreviewIds[0]).isInvisible(),
    "C1: under a focus including A9, the rebuilt entity is shown");

destr(c1Preview.di);
destr(c1Di);

// -- C2: a hidden entity on an OFF layer (CTRL-RAW) rebuilds too -------
// ensureLayerLike recreates the source layer's off/frozen state, and
// RAddObjectsOperation silently refuses an add to an off (or frozen)
// layer -- so before this fix, a hidden entity on CTRL-RAW (the
// as-surveyed ghost, which ships off by convention) was simply absent
// from the preview with unrebuilt staying 0.
var c2Src = new RDocument(new RMemoryStorage(), createSpatialIndex());
var c2Di = new RDocumentInterface(c2Src);
c2Di.setNotifyListeners(false);
CsLayers.ensureSurveyLayers(c2Src, c2Di);
CsLayers.ensure(c2Src, c2Di, CsLayers.RAW);
ok(c2Src.queryLayer(CsLayers.RAW).isOff(),
    "sanity: CTRL-RAW ships off by CsLayers' own registry (CsLayers.OFF)");

var c2Entity = new RLineEntity(c2Src, new RLineData(
    new RVector(0, 0), new RVector(5, 0)));
c2Entity.setLayerName(CsLayers.RAW);
CsTags.set(c2Entity, "RawShot", "A1->A2");
CsLayers.withLayerOn(c2Src, c2Di, CsLayers.RAW, function() {
    var c2AddOp = new RAddObjectsOperation();
    c2AddOp.addObject(c2Entity, false);
    c2Di.applyOperation(c2AddOp);
});
var c2Id = c2Entity.getId();
ok(c2Id !== RObject.INVALID_ID,
    "sanity: the C2 fixture entity was actually added to its off " +
    "layer, via withLayerOn");
// Hiding it needs the SAME withLayerOn wrap the add did: an entity on
// an off layer refuses RChangePropertyOperation exactly as it refuses
// the add (REntity::isEditable's layer check -- see applyFocus's own
// docblock), so hiding it while CTRL-RAW is back off would silently
// no-op and this fixture would not actually be testing the hidden-
// entity rebuild path at all.
CsLayers.withLayerOn(c2Src, c2Di, CsLayers.RAW, function() {
    c2Src.selectEntities([c2Id], false);
    c2Di.applyOperation(new RChangePropertyOperation(
        RObject.PropertyInvisible, true, RS.EntityAll, false));
    c2Src.clearSelection();
});
ok(c2Src.queryEntity(c2Id).isInvisible(),
    "sanity: the C2 fixture entity is genuinely hidden in its source");

var c2Preview = TripFocus.buildPreview(c2Src);
ok(c2Preview.unrebuilt === 0,
    "C2: a hidden entity on an off layer rebuilds instead of being " +
    "silently absent -- the add (and the re-hide right after it) is " +
    "now wrapped in CsLayers.withLayerOn");
var c2PreviewIds = c2Preview.di.getDocument().queryAllEntities(false, true);
ok(c2PreviewIds.length === 1,
    "C2: the preview actually holds the rebuilt entity, not just a " +
    "truthful-looking unrebuilt count of 0");
var c2DstLayer = c2Preview.di.getDocument().queryLayer(CsLayers.RAW);
ok(!isNull(c2DstLayer) && c2DstLayer.isOff() === true &&
    c2DstLayer.isFrozen() === false,
    "C2: ensureLayerLike recreates CTRL-RAW OFF (not frozen) in the " +
    "preview, matching the source -- a parameter-order bug in the " +
    "RLayer(...) constructor call used to swap off into the frozen " +
    "slot and hard-code the real off slot to false");

// ensureLayerLike, called directly rather than only through the whole
// rebuild pipeline above -- this function had zero coverage before
// this pass.
var elDst = new RDocument(new RMemoryStorage(), createSpatialIndex());
var elDi = new RDocumentInterface(elDst);
elDi.setNotifyListeners(false);
TripFocus.ensureLayerLike(elDst, elDi, c2Src, CsLayers.RAW);
var elLayer = elDst.queryLayer(CsLayers.RAW);
ok(!isNull(elLayer) && elLayer.isOff() === true &&
    elLayer.isFrozen() === false,
    "ensureLayerLike, called directly: recreates CTRL-RAW OFF (not " +
    "frozen) in a document that never had the layer at all -- pins " +
    "the RLayer(...) constructor argument order on its own, " +
    "independent of the rebuild pipeline above");
destr(elDi);

destr(c2Preview.di);
destr(c2Di);

// -- C2, continued: a dangling block reference is reported, not added --
// RCopyOperation only carries a block across when it copies an entity
// that uses it; an individually hidden block reference, with nothing
// else in the drawing using the same block, means the block itself
// never reaches the preview. Rebuilding the reference anyway would add
// real geometry whose referencedBlockId resolves to nothing here.
var c2bSrc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var c2bDi = new RDocumentInterface(c2bSrc);
c2bDi.setNotifyListeners(false);
CsLayers.ensureSurveyLayers(c2bSrc, c2bDi);

var c2bBlock = new RBlock(c2bSrc, "SYM1", new RVector(0, 0));
var c2bBlockOp = new RAddObjectsOperation();
c2bBlockOp.addObject(c2bBlock);
c2bDi.applyOperation(c2bBlockOp);
var c2bBlockId = c2bSrc.getBlockId("SYM1");

var c2bRef = new RBlockReferenceEntity(c2bSrc, new RBlockReferenceData(
    c2bBlockId, new RVector(10, 10), new RVector(1, 1), 0.0));
var c2bRefOp = new RAddObjectsOperation();
c2bRefOp.addObject(c2bRef, false);
c2bDi.applyOperation(c2bRefOp);
var c2bRefId = c2bRef.getId();
c2bSrc.selectEntities([c2bRefId], false);
c2bDi.applyOperation(new RChangePropertyOperation(
    RObject.PropertyInvisible, true, RS.EntityAll, false));
c2bSrc.clearSelection();

var c2bPreview = TripFocus.buildPreview(c2bSrc);
ok(c2bPreview.unrebuilt === 1,
    "C2: a hidden block reference whose block was never otherwise " +
    "copied is counted as unrebuilt rather than added as a dangling " +
    "reference");
var c2bPreviewIds =
    c2bPreview.di.getDocument().queryAllEntities(false, true);
ok(c2bPreviewIds.length === 0,
    "C2: the dangling block reference itself is not present in the " +
    "preview at all -- reported missing beats a live-looking symbol " +
    "that resolves to nothing");

destr(c2bPreview.di);
destr(c2bDi);

// -- I3: a VISIBLE entity on an off layer is silently dropped, and now -
// counted. selectEntities itself refuses an entity on an off or frozen
// layer, exactly the way RAddObjectsOperation refuses an add to one --
// so such an entity never enters the selection fillPreview builds, and
// never reaches RCopyOperation at all. Cosmetically nil (it would never
// have rendered anyway), but the preview must SAY it is short one
// entity rather than pass as a complete copy.
var i3Src = new RDocument(new RMemoryStorage(), createSpatialIndex());
var i3Di = new RDocumentInterface(i3Src);
i3Di.setNotifyListeners(false);
CsLayers.ensureSurveyLayers(i3Src, i3Di);
CsLayers.ensure(i3Src, i3Di, CsLayers.RAW);

var i3Normal = new RLineEntity(i3Src, new RLineData(
    new RVector(0, 0), new RVector(5, 0)));
var i3NormalOp = new RAddObjectsOperation();
i3NormalOp.addObject(i3Normal, false);
i3Di.applyOperation(i3NormalOp);

var i3OffLayer = new RLineEntity(i3Src, new RLineData(
    new RVector(10, 0), new RVector(15, 0)));
i3OffLayer.setLayerName(CsLayers.RAW);
CsLayers.withLayerOn(i3Src, i3Di, CsLayers.RAW, function() {
    var i3OffOp = new RAddObjectsOperation();
    i3OffOp.addObject(i3OffLayer, false);
    i3Di.applyOperation(i3OffOp);
});
var i3OffLayerId = i3OffLayer.getId();
ok(!i3Src.queryEntity(i3OffLayerId).isInvisible(),
    "sanity: the I3 fixture entity is genuinely VISIBLE, only its " +
    "LAYER is off -- this is the selection-drop path (I3), not the " +
    "individually-hidden rebuild path (C1/C2)");

var i3Preview = TripFocus.buildPreview(i3Src);
ok(i3Preview.unrebuilt === 1,
    "I3: the visible-but-off-layer entity is counted as missing from " +
    "the preview instead of passing silently");
var i3PreviewIds = i3Preview.di.getDocument().queryAllEntities(false, true);
ok(i3PreviewIds.length === 1,
    "I3: only the normal entity actually reaches the preview -- the " +
    "off-layer one is genuinely absent, not merely mis-reported");

destr(i3Preview.di);
destr(i3Di);

if (failures.length === 0) {
    print("### FILTER OK " + checks + " checks");
} else {
    print("### FILTER FAIL");
    for (var f = 0; f < failures.length; f++) { print("  - " + failures[f]); }
}
