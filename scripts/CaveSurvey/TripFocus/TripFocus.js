// TripFocus.js
//
// QCAD add-on tool: a standalone window showing who surveyed what.
//
// Each trip, team, person and survey run is listed with the distance it
// surveyed and its share of the cave. Check any of them and the view
// beside the list shows just that work.
//
// WHY A SEPARATE WINDOW WITH ITS OWN COPY OF THE DRAWING, rather than
// hiding entities in the drawing itself: everything this window does is
// done to a PRIVATE COPY, so the user's drawing is never WRITTEN to.
// That is not tidiness. Hiding entities in the real document walks into
// four separate silent failures in this build -- toggling Invisible
// through a plain modify operation silently no-ops in EITHER direction
// for an ordinary entity (RObject::PropertyInvisible is never
// re-registered per concrete type, so the property-diff modify never
// sees it change -- see applyFocus's own docblock for the full
// mechanism); eraseStations then cannot delete what it cannot edit
// either, so the next redraw draws a duplicate beside it; every toggle
// marks the drawing modified; and every toggle lands on the undo stack.
// A scratch copy has none of those, and it is also what makes the next
// step (colour by trip) safe, since recolouring a copy cannot overwrite
// the cartographer's own colours.
//
// One nuance on "never touched": building that private copy has to
// SELECT entities on the real document for a moment (see fillPreview's
// own docblock for why). Never a WRITE, and always restored before the
// function returns, but not the same thing as "never touched" if you
// are watching the source document's selection specifically.
//
// USAGE:
//   Cave Survey > Trip Focus   (or type "tripfocus" / "tf")

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/TripFocusRows.js");

function TripFocus(guiAction) {
    EAction.call(this, guiAction);
}

TripFocus.prototype = new EAction();

/** The one live window. Reopening focuses it rather than stacking a
 *  second copy: two windows would each hold a full copy of the drawing
 *  and each claim to be the focus. */
TripFocus.dialog = null;
TripFocus.previewDi = null;
/** Re-entrancy guard shared by every checkbox cascade (a section
 *  header -> its own rows, and the All button -> everything): see
 *  setChecked and wireList. */
TripFocus.inCascade = false;
/** {list: QScrollArea, entries: [{section, pick, box}],
 *   headers: [{section, box, entries: [entry, ...]}],
 *   read: {survey, resolved} or null,
 *   attribution: {entityId: {refuses, isPlanFrame, att}},
 *   tripStations, runStations, tripsForGroup: see computeGroups,
 *   sourceDisplayName: see displayNameOf,
 *   emptyNotice: QLabel, pickNotice: QLabel}
 *  while the window is open, null otherwise. (Before Task 8 this held
 *  {tree, read, view, doc} -- QTreeWidget cannot be built in this
 *  engine at all, so that shape no longer exists anywhere; see
 *  buildList. NOT `view` any more either: it was written here and never
 *  read back -- dead since the manual setScene/autoZoom call this
 *  window used to make right after opening was replaced by
 *  AutoZoomView's own resizeEvent-driven zoom, see show()'s own
 *  docblock.) */
TripFocus.state = null;

TripFocus.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    TripFocus.show(this.getDocument());
    this.terminate();
};

/**
 * Clears `di`'s document and refills it with a copy of `sourceDoc`'s
 * MODEL SPACE. Shared by buildPreview (a brand new, empty di) and
 * refresh (the SAME di the window has held since it opened -- see
 * refresh's own docblock for why the di itself must never be swapped
 * for a new one).
 *
 * ENGINE FACT, found by probing before writing this (required by
 * Task 8 and repeated here because it bit this same function): this
 * build's `RCopyOperation` has no callable `setSelectionOnly` --
 * confirmed by enumerating a real instance's own properties under
 * `-no-gui`, not by reading QCAD's upstream C++ header, which
 * documents an API this installed engine does not expose. Every copy
 * this engine's `RCopyOperation` performs goes through
 * `src.querySelectedEntities()`, with no way to tell it to ignore the
 * selection and take everything. So the "off" behaviour this function's
 * first version relied on -- `setSelectionOnly(false)`, copying
 * without ever touching the source document's selection -- is not
 * available here. This function has to select on `sourceDoc` to get
 * anything copied, and it puts back whatever was selected before it
 * ran, so the reader's own selection survives a "tf" untouched by the
 * time this returns (see the header comment's "one nuance" note).
 *
 * MODEL SPACE, EXPLICITLY -- not whatever `sourceDoc.queryAllEntities()`
 * defaults to. That call is scoped to `sourceDoc.getCurrentBlockId()`
 * (`RMemoryStorage::queryAllEntities`, `allBlocks` false), which is not
 * always model space: double-click into the title block to edit it,
 * then press Escape. Escape ends the interactive edit, but the
 * DOCUMENT's current block stays the title block -- there is no other
 * way back to model space short of the "Edit Main Drawing" action (see
 * `EditMainDrawing.js`). Typing "tf" right after would otherwise copy
 * the title block's handful of entities and show THOSE as if they were
 * the cave, with no error and no clue. Querying every block
 * (`allBlocks` true) and keeping only the ids whose
 * `entity.getBlockId() === sourceDoc.getModelSpaceBlockId()` sidesteps
 * the trap completely without ever reading or changing `sourceDoc`'s
 * current block -- so, unlike the selection above, there is nothing to
 * restore on this front either.
 *
 * AN ALREADY-INVISIBLE SOURCE ENTITY CANNOT TRAVEL THROUGH
 * `RCopyOperation` AT ALL. Confirmed by probe: `REntity::isEditable()`
 * returns false for one, `RTransaction::addObject` refuses it inside
 * `RCopyOperation`'s own internal copy transaction (which never calls
 * `setAllowInvisible` the way `RChangePropertyOperation.apply()` does
 * -- and no combination of `op.setAllowInvisible(true)`/`setAllowAll
 * (true)`, called on the operation before applying it, changes that:
 * both exist as callable methods and neither has any observable
 * effect on this specific transaction), and the failure is silent AND
 * PARTIAL: the other selected entities still copy, `changed`/logging
 * gives no count, and only that one entity is simply missing from the
 * destination -- a private copy quietly short by exactly the
 * entities the source happened to have individually hidden. So each
 * invisible entity is rebuilt BY HAND instead: a fresh, same-type entity
 * from its own DATA (a plain read of `sourceDoc`, and `getData()`'s data
 * carries no Invisible flag of its own, so the fresh entity starts out
 * addable), added to `di`'s document, then re-hidden there via the exact
 * mechanism `applyFocus` already uses for the same reason. See
 * `rebuildHiddenEntity`.
 *
 * A VISIBLE entity on an OFF or FROZEN layer IS ALSO THIS PROBLEM --
 * CORRECTED, this used to be documented (and probed) the other way.
 * `selectEntities` itself silently refuses to select an entity sitting
 * on a layer `CsLayers.refusesEdits` would flag, exactly the same way
 * `RAddObjectsOperation`/`RTransaction::addObject` refuse an edit to one
 * (see `ensureLayerLike`'s and `rebuildHiddenEntity`'s own docblocks for
 * that half of the same rule). So a visible entity on such a layer never
 * even enters `visibleIds`' selection below, never reaches
 * `RCopyOperation`, and is silently absent from the preview -- the exact
 * same failure SHAPE as the individually-hidden case above, one step
 * earlier in the pipeline. Confirmed by probe: `querySelectedEntities()`
 * right after `selectEntities(visibleIds, false)` comes back short by
 * exactly the ids on a refusing layer. Counted below alongside
 * `unrebuilt`, for the same reason: a preview silently missing entities
 * must say so rather than read as a complete copy.
 *
 * \return the number of source entities this preview is missing that the
 *         source itself does not miss -- entities `rebuildHiddenEntity`
 *         could not reconstruct (an entity type it does not know how to
 *         rebuild, or one it refused for a reason of its own -- see that
 *         function's docblock) PLUS visible entities silently dropped
 *         from the selection above for sitting on an off or frozen
 *         layer. `show`/`refresh` report a non-zero result in the
 *         window rather than let it pass as silent, partial data loss.
 */
TripFocus.fillPreview = function(di, sourceDoc) {
    di.clear();
    var previewDoc = di.getDocument();

    var modelSpaceId = sourceDoc.getModelSpaceBlockId();
    var allIds = sourceDoc.queryAllEntities(false, true);
    var visibleIds = [];
    var hiddenIds = [];
    var i, e;
    for (i = 0; i < allIds.length; i++) {
        e = sourceDoc.queryEntity(allIds[i]);
        if (isNull(e) || e.getBlockId() !== modelSpaceId) {
            continue;
        }
        if (e.isInvisible()) {
            hiddenIds.push(allIds[i]);
        } else {
            visibleIds.push(allIds[i]);
        }
    }

    var previousSelection = sourceDoc.querySelectedEntities();
    sourceDoc.clearSelection();
    var droppedOffLayer = 0;
    if (visibleIds.length > 0) {
        sourceDoc.selectEntities(visibleIds, false);
        // see this function's own docblock: an entity on an off or
        // frozen layer never actually lands in the selection, so this
        // is the one point where that silent drop can still be counted
        // -- after the copy, di's own document is a moving target
        // (rebuildHiddenEntity is about to add more entities to it) and
        // is no longer safe to diff against visibleIds for this.
        droppedOffLayer = visibleIds.length -
            sourceDoc.querySelectedEntities().length;
        var op = new RCopyOperation(new RVector(0, 0), sourceDoc);
        di.applyOperation(op);
    }
    sourceDoc.clearSelection();
    if (previousSelection.length > 0) {
        sourceDoc.selectEntities(previousSelection, false);
    }

    var unrebuilt = droppedOffLayer;
    for (i = 0; i < hiddenIds.length; i++) {
        e = sourceDoc.queryEntity(hiddenIds[i]);
        if (isNull(e) ||
                !TripFocus.rebuildHiddenEntity(previewDoc, di, sourceDoc, e)) {
            unrebuilt++;
        }
    }
    return unrebuilt;
};

/** The entity's own concrete class name ("RLineEntity", "RTextEntity",
 *  ...), read off `toString()` ("RLineEntity [JS]") rather than from
 *  any RS.EntityType enum -- QCAD's script engine keys its entity
 *  constructors by exactly this name (`global[name]`), so this is the
 *  one string that is guaranteed to round-trip back into a working
 *  constructor for whatever type the entity actually is, with no
 *  per-type table to keep in sync as new entity types are drawn. */
TripFocus.entityClassName = function(entity) {
    var s = String(entity.toString());
    var sp = s.indexOf(" ");
    return sp === -1 ? s : s.substring(0, sp);
};

/** Recreates `layerName` in `dstDoc` if it is not already there
 *  (RCopyOperation already carries a layer across when it copies an
 *  entity that uses it -- this is only needed for a layer that ONLY
 *  ever held entities the copy above could not carry, i.e. every one
 *  of them was individually hidden), matching the source layer's
 *  off/frozen/color/lineweight -- the same properties RCopyOperation
 *  itself would have carried across. Best-effort: an unreadable source
 *  layer property falls back to a plain visible CONTINUOUS layer
 *  rather than failing the whole rebuild over cosmetics.
 *
 *  CONSTRUCTOR ARGUMENT ORDER, READ FROM THE GENERATED WRAPPER RATHER
 *  THAN GUESSED (`RLayer(document, name, frozen, locked, color,
 *  linetypeId, lineweight, off)` -- confirmed against
 *  `rlayer_wrapper.cpp`'s own parameter list, not the property names on
 *  RLayer.xml alone, which read in a deceptively different order). A
 *  previous version of this call passed `(dstDoc, layerName, off,
 *  frozen, ...)`, which silently swapped `off` into the `frozen` slot
 *  and hard-coded the actual `off` slot to `false` -- so the layer this
 *  produced was never actually OFF, only (if the source happened to be
 *  off) FROZEN instead, which refuses the same edits for a different,
 *  wrong-looking reason. Caught by probe, not by inspection: `isOff()`
 *  on the result read false even when `off` was passed `true`. */
TripFocus.ensureLayerLike = function(dstDoc, dstDi, srcDoc, layerName) {
    if (dstDoc.hasLayer(layerName)) {
        return;
    }
    var srcLayer = srcDoc.queryLayer(layerName);
    var off = false, frozen = false, color = new RColor("white"),
        lineweight = RLineweight.Weight025;
    if (!isNull(srcLayer)) {
        try { off = srcLayer.isOff(); } catch (eOff) { }
        try { frozen = srcLayer.isFrozen(); } catch (eFrozen) { }
        try { color = srcLayer.getColor(); } catch (eColor) { }
        try { lineweight = srcLayer.getLineweight(); } catch (eLw) { }
    }
    var newLayer = new RLayer(dstDoc, layerName, frozen, false, color,
        dstDoc.getLinetypeId("CONTINUOUS"), lineweight, off);
    var op = new RAddObjectsOperation();
    op.addObject(newLayer);
    dstDi.applyOperation(op);
};

/** Rebuilds one entity `RCopyOperation` refused because it is
 *  currently invisible in `srcDoc` -- see fillPreview's own docblock
 *  for why this exists and what was probed before trusting it. Reads
 *  `srcDoc` only (`queryLayer`, `getData()`, plain getters); every
 *  write lands on `dstDoc`/`dstDi`, which is always the preview, never
 *  the source.
 *
 *  THREE THINGS A NAIVE REBUILD GETS WRONG, each found by probe rather
 *  than assumed from reading the operation classes:
 *
 *  1. `getData()` carries geometry, NOT custom properties -- a tagged
 *     station point (`Station='A9'`) arrives with no tag at all, which
 *     `CsFocus.stationsOf` then reads as `{names:[],kind:"none"}`, and
 *     the fail-safe rule (unattributable stays visible -- CsFocus.js's
 *     own header) means `applyFocus` will ACTIVELY UN-HIDE it on the
 *     very first click, regardless of what is checked. Fixed by
 *     `copyCustomPropertiesFrom`, confirmed by probe to exist and work
 *     on the installed engine (unlike `RCopyOperation.setSelectionOnly`
 *     -- this build is genuinely behind `cavecad-src` in some places and
 *     ahead of the parts that were checked against it in others, so
 *     each API used here was probed on its own). Called with no `title`
 *     argument, which copies EVERY property group the entity carries,
 *     not only `CsTags.GROUP` ("CaveSurvey") -- a drawing can carry
 *     custom properties this suite knows nothing about, and losing
 *     those on rebuild would be exactly the same silent narrowing this
 *     fix exists to close.
 *
 *  2. The add can be REFUSED OUTRIGHT and nothing here used to notice.
 *     `ensureLayerLike` recreates the source layer's own off/frozen
 *     state (see its own docblock for a real bug that used to defeat
 *     that), and `RAddObjectsOperation` silently refuses an add to an
 *     off or frozen layer -- the same rule `CsLayers.OFF`/
 *     `CsLayers.withLayerOn` exist to route around for every other
 *     writer in this suite. A hidden entity on such a layer is not a
 *     corner case here: `CTRL-RAW` (the as-surveyed ghost) ships off by
 *     convention, and a caver hiding a redundant raw leg on it is
 *     exactly the shape of entity this function exists to rebuild.
 *     FIXED by wrapping the add (and the re-hide right after it, which
 *     needs the layer just as visible) in `CsLayers.withLayerOn`, the
 *     suite's own established answer to this exact refusal -- and by
 *     checking `fresh.getId()` afterward regardless, since `withLayerOn`
 *     only covers off/frozen and there is no reason to trust every
 *     future refusal reason will be one of those two.
 *
 *  3. A rebuilt `RBlockReferenceEntity` can carry a dangling reference.
 *     `RCopyOperation` only carries a block across when it copies an
 *     entity that uses it; an individually hidden block reference was
 *     never selected for that copy, so if nothing else in the drawing
 *     also uses the same block, `dstDoc` never receives it at all.
 *     Rebuilding the reference anyway would add real geometry whose
 *     `referencedBlockId` resolves to nothing in this document --
 *     confirmed by probe: `getReferencedBlockName()` on the rebuilt
 *     entity is empty (the name lookup needs the SOURCE document, which
 *     `getData()` does not carry), and `dstDoc.queryBlock(id)` for the
 *     numeric id it does carry comes back null. Cave drawings use block
 *     references for symbols, so this is not a hypothetical. Counted as
 *     a rebuild failure rather than silently added: a missing symbol,
 *     reported, beats a live-looking one that resolves to nothing.
 *
 *  \return true on success. */
TripFocus.rebuildHiddenEntity = function(dstDoc, dstDi, srcDoc, srcEntity) {
    try {
        var Ctor = global[TripFocus.entityClassName(srcEntity)];
        if (typeof Ctor !== "function") {
            return false;
        }

        if (typeof srcEntity.getReferencedBlockName === "function") {
            var blockName = srcEntity.getReferencedBlockName();
            if (blockName !== "" && !dstDoc.hasBlock(blockName)) {
                return false;   // see this function's own docblock,
                                // point 3 -- the block was never copied
                                // and rebuilding the reference anyway
                                // would only be a dangling one
            }
        }

        var fresh = new Ctor(dstDoc, srcEntity.getData());
        fresh.copyCustomPropertiesFrom(srcEntity);   // see docblock, 1

        var layerName = srcEntity.getLayerName();
        TripFocus.ensureLayerLike(dstDoc, dstDi, srcDoc, layerName);
        fresh.setLayerName(layerName);
        fresh.setInvisible(false);   // getData() carries no flag of its
                                      // own; this is just making the
                                      // fresh entity's own state match
                                      // what it already is, explicitly

        var landed = CsLayers.withLayerOn(dstDoc, dstDi, layerName,
                function() {
            var addOp = new RAddObjectsOperation();
            addOp.addObject(fresh, false);
            dstDi.applyOperation(addOp);
            if (fresh.getId() === RObject.INVALID_ID) {
                return false;   // see docblock, 2 -- the add was
                                 // refused for some other reason;
                                 // withLayerOn already ruled out off/
                                 // frozen, so this is a genuine failure
            }

            // now hidden in the PREVIEW exactly the way it was in the
            // source -- via RChangePropertyOperation, the one mechanism
            // this whole file trusts to make an Invisible change stick.
            // Done INSIDE withLayerOn, not after: RChangePropertyOperation
            // refuses an off/frozen-layer entity exactly as the add
            // above does (see applyFocus's own docblock), and
            // withLayerOn has already restored the layer's real state
            // by the time this function returns.
            dstDoc.selectEntities([fresh.getId()], false);
            dstDi.applyOperation(new RChangePropertyOperation(
                RObject.PropertyInvisible, true, RS.EntityAll, false));
            dstDoc.clearSelection();
            return true;
        });
        return landed === true;
    } catch (eRebuild) {
        return false;
    }
};

/**
 * Per-entity attribution for every entity in `previewDoc`, computed
 * ONCE per preview build/Refresh instead of once per click.
 *
 * WHY: measured in the real engine, `CsFocus.stationsOf` (tag parsing)
 * and `CsBind.layerNameOf` (`doc.getLayerName(entity.getLayerId())` in a
 * plain try/catch -- CORRECTED: it does NOT fall back to
 * `CsStore.lookup`, that reads differently, see `CsBind.js` itself)
 * together account for the cost `applyFocus`'s walk saves by caching
 * them: 690ms uncached vs 447ms cached at 7,000 entities, a ~35% cut of
 * one click's cost -- CORRECTED, this used to claim 725ms out of a
 * ~900ms click and imply the saving grows to 9-14 SECONDS at cave scale;
 * neither number was ever actually measured. The saving is real and
 * worth having (a 4,000-shot survey is comfortably 28,000+ entities,
 * where every millisecond repeats per click), just smaller than that.
 * Neither an entity's tags nor its layer changes between clicks on the
 * same preview document, so recomputing them per click is pure waste.
 * `applyFocus` uses this cache when given one, and falls back to
 * computing the same two things fresh, per entity, when not -- which
 * keeps it correct for a caller (tests included) that has no cache to
 * offer.
 *
 * `refuses` is folded in for the same reason `CsLayers.refusesEdits`
 * is checked at all: an entity on an off or frozen layer never renders
 * regardless of its own Invisible flag, and `RChangePropertyOperation`
 * cannot make that flag change stick on such a layer either -- so
 * without this, `applyFocus`'s "already in the right state" skip is
 * defeated for that entity FOREVER, and every single click re-fires a
 * full-size operation over it for nothing. Skipping it here means it
 * is never considered at all, which is also strictly correct: nothing
 * this window does needs to touch an entity nobody will ever see.
 *
 * THIS SKIP CANNOT ACTUALLY FIRE TODAY, and that is not a reason to
 * delete it. `fillPreview` now excludes an off/frozen-layer entity from
 * the preview entirely (see its own docblock) -- `RCopyOperation` never
 * receives one, so `previewDoc` never holds one, so `refuses` is true
 * for zero entries this function ever builds. Kept anyway as cheap
 * insurance against the copy mechanism changing again the way it
 * already has once on this branch (`RCopyOperation.setSelectionOnly`):
 * if a future build copies such an entity across after all, this is
 * what keeps `applyFocus` from spinning on it forever.
 *
 * \return {attribution: {entityId: {refuses, isPlanFrame, att}},
 *          entityCount: number} -- the count is how many entities the
 *          preview actually holds, so a caller can tell a genuinely
 *          empty drawing from a working copy instead of guessing from
 *          a blank view (see `show`, which reports it).
 */
TripFocus.buildAttribution = function(previewDoc) {
    var ids = previewDoc.queryAllEntities(false, false);
    var out = {};
    for (var i = 0; i < ids.length; i++) {
        var e = previewDoc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var lay = previewDoc.queryLayer(e.getLayerId());
        out[ids[i]] = {
            refuses: CsLayers.refusesEdits(lay),
            isPlanFrame: CsFocus.isPlanFrame(
                CsBind.layerNameOf(previewDoc, e)),
            att: CsFocus.stationsOf(e)
        };
    }
    return { attribution: out, entityCount: ids.length };
};

/**
 * A private copy of `sourceDoc`'s model space, and an interface onto
 * it, ready to filter. See `fillPreview` for the copy mechanics and
 * `buildAttribution` for the cache built alongside it.
 *
 * \return {di: RDocumentInterface, entityCount: number,
 *          attribution: {entityId: {refuses, isPlanFrame, att}},
 *          unrebuilt: number -- see fillPreview}
 */
TripFocus.buildPreview = function(sourceDoc) {
    var previewDoc = new RDocument(new RMemoryStorage(),
        createSpatialIndex());
    var di = new RDocumentInterface(previewDoc);
    di.setNotifyListeners(false);

    var unrebuilt = TripFocus.fillPreview(di, sourceDoc);
    var built = TripFocus.buildAttribution(previewDoc);

    return { di: di, entityCount: built.entityCount,
        attribution: built.attribution, unrebuilt: unrebuilt };
};

/** The reconstructed survey the window is describing, or null when the
 *  drawing holds none. Read once per open/Refresh -- surveyFromDocument
 *  is a full document scan. */
TripFocus.readSurvey = function(doc) {
    try {
        var recon = CsRevise.surveyFromDocument(doc);
        if (isNull(recon) || isNull(recon.survey)) {
            return null;
        }
        var resolved = CsNetwork.resolve(recon.survey);
        return { survey: recon.survey, resolved: resolved };
    } catch (e) {
        return null;
    }
};

/** The three lookup maps CsFocus.stationSet needs, computed once per
 *  open/Refresh instead of once per click: tripStations (from
 *  CsRevise.tripStationNames), runStations (CsProfile.groupRuns'
 *  result, reshaped the way CsFocus.stationSet's own docblock requires
 *  -- passing groupRuns' return value straight through compiles and
 *  contributes zero stations for every run, silently), and
 *  tripsForGroup (TripFocusRows.tripsForGroup). None of the three
 *  depends on anything a checkbox can change. */
TripFocus.computeGroups = function(read) {
    if (isNull(read)) {
        return { tripStations: {}, runStations: {}, tripsForGroup: {} };
    }
    var grouped = CsProfile.groupRuns(read.resolved);
    var runStations = {};
    for (var i = 0; i < grouped.order.length; i++) {
        runStations[grouped.order[i]] =
            grouped.runs[grouped.order[i]].stations;
    }
    return {
        tripStations: CsRevise.tripStationNames(read.survey),
        runStations: runStations,
        tripsForGroup: TripFocusRows.tripsForGroup(read.survey,
            read.resolved, CsTraverse.SLOPE)
    };
};

TripFocus.COL_WHAT = 0;
TripFocus.COL_DISTANCE = 1;
TripFocus.COL_SHARE = 2;

/**
 * The list pane: QCheckBox and QLabel in a QGridLayout inside a
 * QScrollArea. NOT QTreeWidget or QListWidget -- this build cannot
 * construct either from script at all (`new QTreeWidget()` returns a
 * convincing stub whose `setHeaderLabels` and `topLevelItemCount` are
 * `undefined`; `new QListWidget()` fails outright). Confirmed by a
 * throwaway `-no-gui -autostart` probe before any of this was written;
 * see this tool's report for the transcript. The section and row DATA
 * still comes from `TripFocusRows.build` unchanged -- that part is
 * pure, already tested, and none of this function's business; only the
 * widget layer is new.
 *
 * SELECTION STATE LIVES IN THE RETURNED `entries` ARRAY, never in the
 * grid. `TripFocus.picked()` reads that array; nothing in this file
 * walks the widget tree to recover what is checked -- that is what made
 * the old tree-based `picked` both untestable and silently wrong.
 * `headers` is returned only so the caller can wire each section
 * checkbox's cascade (see `wireList`); it plays no part in `picked()`.
 *
 * \return {widget: QScrollArea,
 *          entries: [{section, pick, box}],
 *          headers: [{section, box, entries: [entry, ...]}]}
 */
TripFocus.buildList = function(read) {
    var entries = [];
    var headers = [];
    var inner = new QWidget();
    var grid = new QGridLayout();
    inner.setLayout(grid);
    try {
        grid.setHorizontalSpacing(6);
        grid.setVerticalSpacing(2);
        grid.setContentsMargins(4, 4, 4, 4);
    } catch (eSp) {
        // spacing stays at whatever the bridge defaults to
    }
    var gridRow = 0;

    var addSpanning = function(widget) {
        grid.addWidget(widget, gridRow, TripFocus.COL_WHAT, 1, 3);
        gridRow++;
    };

    if (read === null) {
        var none = new QLabel(qsTr("No survey data in this drawing"));
        none.setDisabled(true);
        addSpanning(none);
    } else {
        var sections = TripFocusRows.build(read.survey, read.resolved,
            CsTraverse.SLOPE);
        for (var s = 0; s < sections.length; s++) {
            var section = sections[s];
            var headerText = section.title +
                (section.note === "" ? "" : "  -- " + section.note);

            if (section.rows.length === 0) {
                var empty = new QLabel(headerText +
                    qsTr("  (none recorded)"));
                empty.setDisabled(true);
                addSpanning(empty);
                continue;
            }

            // the section header: a checkbox in its own right, which
            // cascades to every row below it -- see wireList
            var headBox = new QCheckBox(headerText);
            addSpanning(headBox);
            var headerEntries = [];

            for (var r = 0; r < section.rows.length; r++) {
                var row = section.rows[r];
                var distLabel = new QLabel(row.distanceText);
                var shareLabel = new QLabel(row.percentText);

                if (isNull(row.pick)) {
                    // "(not in any run)" -- informational only, see
                    // TripFocusRows' own docblock: there is no station
                    // set to focus, so there is nothing to tick
                    var info = new QLabel(row.label);
                    grid.addWidget(info, gridRow, TripFocus.COL_WHAT);
                    grid.addWidget(distLabel, gridRow,
                        TripFocus.COL_DISTANCE);
                    grid.addWidget(shareLabel, gridRow,
                        TripFocus.COL_SHARE);
                    gridRow++;
                    continue;
                }

                var box = new QCheckBox(row.label);
                grid.addWidget(box, gridRow, TripFocus.COL_WHAT);
                grid.addWidget(distLabel, gridRow, TripFocus.COL_DISTANCE);
                grid.addWidget(shareLabel, gridRow, TripFocus.COL_SHARE);
                gridRow++;

                var entry = { section: section.key, pick: row.pick,
                    box: box };
                entries.push(entry);
                headerEntries.push(entry);
            }

            headers.push({ section: section.key, box: headBox,
                entries: headerEntries });
        }
    }

    // one stretchy empty row below the last one, so rows pin to the
    // top of the scroll area instead of spreading down it -- the same
    // device SurveyNotebook's own grid-in-a-QScrollArea uses for its
    // notes page
    try {
        grid.setRowStretch(gridRow, 1);
    } catch (eStretch) {
        // cosmetic only
    }

    var scroll = new QScrollArea();
    scroll.objectName = "TripFocusList";
    scroll.widgetResizable = true;
    scroll.setWidget(inner);

    return { widget: scroll, entries: entries, headers: headers };
};

/** What is checked, in the shape CsFocus.stationSet wants. Reads
 *  `entries` -- the JS array buildList returned, each a
 *  {section, pick, box} -- never a widget's own parent/child
 *  structure. A trip's pick is the plain tripId TripFocusRows.build
 *  wrote: a number, not a string -- there is no Qt.UserRole round trip
 *  through text to undo any more, now that selection state lives off
 *  the widgets entirely. Team and person picks come back exactly as
 *  TripFocusRows.build wrote them ("team:..." / "person:..." -- see
 *  that file's docblock for why the namespace prefix matters). */
TripFocus.picked = function(entries) {
    var out = { trips: [], teams: [], people: [], runs: [] };
    for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (!entry.box.checked) {
            continue;
        }
        if (isNull(entry.pick)) {
            continue;   // defensive: buildList never gives the
                        // unpickable "(not in any run)" row an entry
                        // in the first place, so this should not fire
        }
        if (entry.section === "trips") {
            out.trips.push(entry.pick);
        } else if (entry.section === "teams") {
            out.teams.push(String(entry.pick));
        } else if (entry.section === "people") {
            out.people.push(String(entry.pick));
        } else if (entry.section === "runs") {
            out.runs.push(String(entry.pick));
        }
    }
    return out;
};

/** A stable string identifying `entry` across a Refresh rebuild --
 *  "section:pick", e.g. "trips:3" or "people:Nathan Schonegg". `pick` is
 *  a number for a trip and a string for everything else (see `picked`'s
 *  own docblock), hence the explicit `String()`: without it "trips:3"
 *  and "trips:3" from two different rebuilds could still fail a `===`
 *  if one pick were ever read back as a string and the other a number,
 *  which is exactly the kind of drift a rebuild is free to introduce
 *  since it re-derives every pick from scratch. Returns null for a row
 *  with no pick at all (the "(not in any run)" rows `picked` also
 *  skips), so a caller filtering on this never needs its own isNull
 *  check duplicated. */
TripFocus.pickKey = function(entry) {
    if (isNull(entry.pick)) {
        return null;
    }
    return entry.section + ":" + String(entry.pick);
};

/** Re-ticks every entry in `entries` (a freshly rebuilt list, e.g. from
 *  `refresh`) whose `pickKey` was in `keys` before the rebuild that
 *  produced it -- WITHOUT re-running the filter once per box, the same
 *  concern `setChecked`/`syncHeaderChecked` exist for elsewhere. Reads
 *  `entries` only, deliberately: the header checkboxes are re-derived
 *  from their own rows by the caller afterward (see `wireList`'s own
 *  per-row sync), not restored independently here, so there is exactly
 *  one place that decides whether a header reads as ticked.
 *
 *  WHY THIS EXISTS: the list pane is rebuilt from scratch on every
 *  Refresh (`buildList` returns brand new `QCheckBox`es with `checked`
 *  defaulting to false), so without this every Refresh silently threw
 *  away whatever the reader had ticked and jumped back to showing the
 *  whole cave -- probed: `picked()` went from three trips checked to
 *  none, across one `refresh()` call, with nothing in the window to
 *  explain why the view had just changed.
 *
 *  A key not found in the new `entries` is real information, not an
 *  error to swallow: it means the trip/team/person/run it named is
 *  simply gone from this reading of the drawing (a trip deleted, a run
 *  renamed) -- reported back rather than dropped silently, so a caller
 *  can tell the reader their pick did not survive rather than let them
 *  wonder why fewer things are ticked than they left checked.
 *
 *  \return the subset of `keys` that matched nothing in `entries` */
TripFocus.applyPickKeys = function(entries, keys) {
    if (keys.length === 0) {
        return [];
    }
    var want = {};
    var i;
    for (i = 0; i < keys.length; i++) {
        want[keys[i]] = true;
    }
    var found = {};
    var toCheck = [];
    for (i = 0; i < entries.length; i++) {
        var key = TripFocus.pickKey(entries[i]);
        if (key !== null && want.hasOwnProperty(key)) {
            toCheck.push(entries[i]);
            found[key] = true;
        }
    }
    if (toCheck.length > 0) {
        TripFocus.setChecked(toCheck, true);
    }
    var missing = [];
    for (i = 0; i < keys.length; i++) {
        if (!found.hasOwnProperty(keys[i])) {
            missing.push(keys[i]);
        }
    }
    return missing;
};

/** Mirrors CsFocus.isVisible's own per-attribution test, given an
 *  ALREADY-COMPUTED attribution (CsFocus.stationsOf's return shape)
 *  instead of an entity. The whole point of buildAttribution is to
 *  call stationsOf ONCE per entity per preview build/Refresh rather
 *  than once per entity per click, so this cannot simply call
 *  CsFocus.isVisible itself -- that would call stationsOf again,
 *  right back to the cost being cached away. CsFocus.js is Core and
 *  out of this task's scope to change, so this is a DELIBERATE,
 *  commented duplication of a small, stable predicate, not an
 *  oversight: if CsFocus.isVisible's own logic ever changes, this
 *  must change with it. Uses CsFocus.ALL_ENDS_MODES directly rather
 *  than re-deriving it, so at least that part cannot drift. */
TripFocus.isAttVisible = function(att, stationSet) {
    if (stationSet === undefined || stationSet === null) {
        return true;   // All: nothing is filtered
    }
    if (att.kind === "none") {
        return true;   // the fail-safe rule -- see CsFocus.js's header
    }
    var needsAll = CsFocus.ALL_ENDS_MODES[att.mode] === true;
    var anyIn = false;
    for (var i = 0; i < att.names.length; i++) {
        var hit = stationSet[att.names[i]] === true;
        if (needsAll && !hit) {
            return false;
        }
        if (hit) {
            anyIn = true;
        }
    }
    return anyIn;
};

/**
 * Hides everything out of focus in the PREVIEW document.
 *
 * NOT `RModifyObjectsOperation` + `entity.setInvisible()` -- that was
 * this function's first draft, and it does not work in this build,
 * confirmed by an isolated probe before this version was trusted rather
 * than assumed from reading the operation classes. The reason: the
 * modify path is a PROPERTY DIFF (RTransaction::addObject compares
 * `object->getPropertyTypeIds()` against the stored original and only
 * persists properties that differ), and `RObject::PropertyInvisible` is
 * registered under `RObject::getRtti()` -- `RS::ObjectUnknown` -- never
 * re-registered per concrete entity type the way e.g. RLayer's own
 * off/frozen properties are. So `getPropertyTypeIds()` on an ordinary
 * entity (line, text, ...) never includes PropertyInvisible, the diff
 * never sees the flag changed, and the modify silently no-ops: the
 * clone's own isInvisible() flips locally but storage->saveObject() is
 * never called, so nothing is un-hidden OR hidden. This has nothing to
 * do with `setAllowInvisible`/`setAllowAll` on the property-diff path
 * above -- those gate a DIFFERENT check (REntity::isEditable) earlier
 * in the same function, and the modify was already failing before that
 * check ever mattered.
 *
 * `RChangePropertyOperation` is the mechanism this engine actually uses
 * for a single-property change (it is what QCAD's own property editor
 * calls), and it sidesteps the diff: its `apply()` always sets
 * `transaction.setAllowInvisible(true)` itself (unconditionally, not
 * something this function controls) and hands the transaction an
 * EXPLICIT one-property set, so the flag change is never lost to the
 * enumeration gap above. Its cost is that it works over
 * `document.queryPropertyEditorObjects()` -- the document's current
 * SELECTION -- rather than an arbitrary id list, hence the
 * select/apply/clear dance below. That selection lives only in this
 * PREVIEW document; nothing here is visible to, or shared with, the
 * user's own document or its own selection.
 *
 * `setAllowInvisible` is NOT the whole story, though: it never sets
 * `setAllowAll`, so an entity on an OFF or FROZEN layer still refuses
 * the property change outright (`REntity::isEditable`'s layer check).
 * Such an entity never draws anyway, so `attribution`'s `refuses` flag
 * (see `buildAttribution`) skips it before it is ever considered here
 * -- both so nothing wastes an operation on it, and so its own
 * Invisible flag is never toggled at all, which is what makes the
 * "already in the right state" skip above actually converge. Without
 * that skip, such an entity's flag never settles, and every single
 * click re-fires a full-size operation over it for nothing.
 *
 * \param stationSet from CsFocus.stationSet, or null for All
 * \param attribution optional -- from buildAttribution: when given,
 *        this function neither re-queries each entity's layer nor
 *        recomputes its station attribution, both of which dominate
 *        this walk's cost at cave scale (see buildAttribution's own
 *        docblock). When omitted, it recomputes both, fresh, per
 *        entity -- correct either way, just slower.
 */
TripFocus.applyFocus = function(di, stationSet, attribution) {
    var doc = di.getDocument();
    var ids = doc.queryAllEntities(false, false);
    var toShow = [], toHide = [];
    var i, id, e, cached, isPlan, att, lay;
    for (i = 0; i < ids.length; i++) {
        id = ids[i];
        e = doc.queryEntity(id);
        if (isNull(e)) {
            continue;
        }
        cached = (attribution === undefined || attribution === null) ?
            undefined : attribution[id];
        if (cached !== undefined) {
            if (cached.refuses) {
                continue;
            }
            isPlan = cached.isPlanFrame;
            att = cached.att;
        } else {
            lay = doc.queryLayer(e.getLayerId());
            if (CsLayers.refusesEdits(lay)) {
                continue;
            }
            isPlan = CsFocus.isPlanFrame(CsBind.layerNameOf(doc, e));
            att = CsFocus.stationsOf(e);
        }

        // Plan only (Nathan's decision): the profile band is out of the
        // window whatever is checked, so it is hidden before the focus
        // rules are consulted at all.
        var wanted = isPlan && TripFocus.isAttVisible(att, stationSet);
        if (e.isInvisible() === !wanted) {
            continue;              // already in the right state
        }
        if (wanted) {
            toShow.push(id);
        } else {
            toHide.push(id);
        }
    }

    var changed = toShow.length + toHide.length;
    if (changed > 0) {
        if (toHide.length > 0) {
            doc.clearSelection();
            doc.selectEntities(toHide, false);
            di.applyOperation(new RChangePropertyOperation(
                RObject.PropertyInvisible, true, RS.EntityAll, false));
        }
        if (toShow.length > 0) {
            doc.clearSelection();
            doc.selectEntities(toShow, false);
            di.applyOperation(new RChangePropertyOperation(
                RObject.PropertyInvisible, false, RS.EntityAll, false));
        }
        doc.clearSelection();      // leave no trace of a selection a
                                    // reader never asked for
        di.regenerateScenes();
        // Each RChangePropertyOperation above stores a full
        // property-change record per entity it touched, undoable,
        // forever -- this window's document is never shown and its
        // undo stack is never popped, so twenty clicks at cave scale
        // is a few hundred thousand records held for nothing but the
        // window's lifetime. resetTransactionStack() is exposed to
        // script for exactly this.
        doc.resetTransactionStack();
    }
    return changed;
};

/** Checks or unchecks every {box} in `items` (entries or headers
 *  alike) without each individual change re-running the filter --
 *  shared by wireList's own per-section cascade and the All button,
 *  which is one more reason to have only one copy of this: the pane
 *  that replaced the tree is the whole reason there were two.
 *
 *  try/finally, not a bare assign-true-then-assign-false: `setChecked`
 *  on a box can run arbitrary Qt code (a connected slot, a repaint), and
 *  a throw partway through used to leave `TripFocus.inCascade` latched
 *  true forever -- every checkbox in the window would silently stop
 *  re-applying the filter for the rest of the window's life, with
 *  nothing to say why. */
TripFocus.setChecked = function(items, state) {
    TripFocus.inCascade = true;
    try {
        for (var i = 0; i < items.length; i++) {
            items[i].box.setChecked(state);
        }
    } finally {
        TripFocus.inCascade = false;
    }
};

/** Ticks or unticks `head.box` to match whether every one of its own
 *  rows is now checked -- called after a plain row (not the header
 *  itself) changes, so the header stops lying about its own rows the
 *  moment they stop agreeing with it. Before this, unticking every row
 *  under a checked header by hand left the header still ticked, and
 *  clicking it then UNTICKED every row a second time instead of doing
 *  the one thing a reader would expect (re-ticking them) -- two clicks
 *  to get anywhere. Guarded by `inCascade` the same way `setChecked`
 *  itself is, so this sync's own `setChecked` call cannot re-cascade
 *  into the rows that triggered it. */
TripFocus.syncHeaderChecked = function(head) {
    var allChecked = true;
    for (var i = 0; i < head.entries.length; i++) {
        if (!head.entries[i].box.checked) {
            allChecked = false;
            break;
        }
    }
    if (head.box.checked === allChecked) {
        return;
    }
    TripFocus.inCascade = true;
    try {
        head.box.setChecked(allChecked);
    } finally {
        TripFocus.inCascade = false;
    }
};

/** The text for emptyNotice, or null when the copy needs no comment --
 *  shared by show() and refresh() so the two don't drift. A copy of
 *  nothing looks exactly like a working copy of an empty cave (both
 *  are a blank view at default zoom, since zoomTo early-returns on an
 *  invalid bounding box either way); a copy that is short some
 *  entities looks exactly like a complete one. Both get said out loud
 *  instead of rendering as indistinguishable blankness or silent data
 *  loss. */
TripFocus.copyStatusText = function(entityCount, unrebuilt) {
    if (entityCount === 0) {
        return qsTr("This drawing has no entities to show.");
    }
    if (unrebuilt > 0) {
        return qsTr("Some entities in this drawing could not be " +
            "copied into this preview and are missing from it.");
    }
    return null;
};

/** Shows or hides the "nothing checked matched a station" notice --
 *  see reapply, the only caller. Separate from emptyNotice (which
 *  reports the PREVIEW being empty or incomplete, decided once per
 *  open/Refresh): this one is decided fresh on every checkbox change.
 *
 *  COMBINED with `state.staleRefreshNotice` when one is set (see
 *  `refresh`), rather than one replacing the other: `reapply` calls this
 *  unconditionally on every checkbox change, including the one `refresh`
 *  itself makes right after re-ticking whatever picks still exist, so a
 *  plain overwrite here would erase a "some of what was checked no
 *  longer exists" notice the moment refresh finished -- before the
 *  reader had any chance to see it. */
TripFocus.setPickNotice = function(message) {
    var notice = TripFocus.state.pickNotice;
    var sticky = TripFocus.state.staleRefreshNotice;
    var parts = [];
    if (!isNull(sticky) && sticky !== "") {
        parts.push(sticky);
    }
    if (!(message === null || message === undefined) && message !== "") {
        parts.push(message);
    }
    if (parts.length === 0) {
        notice.visible = false;
        return;
    }
    notice.text = parts.join("  ");
    notice.visible = true;
};

/** The document Refresh should read from, resolved FRESH on every call
 *  rather than trusting a JS reference that might by now be dangling.
 *
 *  WHY THIS EXISTS: `refresh`'s button used to be wired to
 *  `function() { TripFocus.refresh(doc); }`, closing over the very
 *  `RDocument` `show()` was first opened against. `show()`'s own
 *  docblock already explains why the window stays bound to that one
 *  document rather than re-pointing at whatever is current -- but
 *  nothing stopped the reader from CLOSING that drawing, leaving the
 *  Trip Focus window open, and pressing Refresh anyway. `RDocument` is
 *  not a `QObject`, so there is no `destroyed` signal to hook, and
 *  PROBED, exhaustively, before writing this: neither `isNull()` nor
 *  `isDeleted()` can tell a freed `RDocument` from a live one --
 *  both stayed false for a document whose `RDocumentInterface` had
 *  already been `destr()`'d, right up until the next real method call
 *  on it (`queryAllEntities()`, in the probe) SEGFAULTED THE WHOLE
 *  PROCESS rather than throwing a catchable exception. A `try`/`catch`
 *  around that call is worthless -- there is nothing here to catch.
 *  So there is no safe way to keep using a captured document reference
 *  once its own document might have closed.
 *  `EAction.getDocument()` is what every other tool in this suite already
 *  trusts for "the document to work on right now" -- it always reflects
 *  whatever is actually live in the main window, so it can never itself
 *  be a stale pointer, and in a headless engine (or between documents)
 *  it comes back `undefined` rather than a dangling one. The trade
 *  `refresh` makes for that safety: if some OTHER document now has
 *  focus, Refresh reads THAT one rather than crashing -- `displayNameOf`
 *  is what tells the reader when that has happened, in `refresh` below,
 *  rather than let the window quietly start describing a different cave
 *  under the same title.
 *  \return the current document, or null when none is open */
TripFocus.currentDocument = function() {
    try {
        var d = EAction.getDocument();
        return isNull(d) ? null : d;
    } catch (eCur) {
        return null;
    }
};

/** The name `show`/`refresh` put in the window title -- the drawing's
 *  file name, or "Untitled" for one never saved. Shared so the two
 *  cannot read a document's name two different ways. */
TripFocus.displayNameOf = function(doc) {
    var displayName = qsTr("Untitled");
    try {
        var fileName = doc.getFileName();
        if (fileName !== undefined && fileName !== null &&
                String(fileName) !== "") {
            displayName = new QFileInfo(String(fileName)).fileName();
        }
    } catch (eName) {
        // cosmetic only -- falls back to "Untitled"
    }
    return displayName;
};

/** Re-reads the drawing and rebuilds everything derived from it: the
 *  preview's contents, its attribution cache, the lookup maps
 *  reapply() needs and the list pane. The window is a snapshot, not a
 *  mirror -- transactionUpdated is still unverified in this build, so
 *  refreshing is something the reader asks for rather than something
 *  we promise and half-deliver.
 *
 *  GUARDED against a window that is not actually open: `TripFocus.state`
 *  is null before `show()` finishes building it and after `cleanUp()`
 *  tears it down, and `TripFocus.previewDi` the same. Nothing should be
 *  able to call `refresh()` in either window, but "should" is not a
 *  guarantee worth skipping a two-line check for.
 *
 *  TAKES NO ARGUMENT, unlike this function's previous version, which
 *  took `sourceDoc` from a closure the Refresh button held onto for the
 *  window's entire life -- see `currentDocument`'s own docblock for why
 *  that is exactly the reference that could go stale, and why resolving
 *  fresh here instead is the fix.
 *
 *  NEVER SWAPS TripFocus.previewDi FOR A NEW ONE, unlike this
 *  function's first draft. `RGraphicsView::setScene` (RGraphicsView.cpp)
 *  only ASSIGNS the pointer and registers the view with the NEW scene
 *  -- it never unregisters the view from whatever OLD scene it used to
 *  belong to. So after `imageView.setScene(newScene)`, the OLD scene
 *  still lists this view as its own, and destroying that old DI (as
 *  the first draft did right afterward) runs ~RGraphicsScene, which
 *  walks its `views` and calls `view->setScene(NULL)` on every one
 *  still marked shared (RGraphicsScene.cpp) -- wiping out the NEW
 *  scene this function had just installed a moment before. Probed:
 *  after the second setScene the view's scene was still non-null; the
 *  moment the old DI was destroyed, it went null. One Refresh, and the
 *  pane is blank for the rest of the window's life: updateImage()
 *  needs a document to draw and now has none, autoZoom() has nothing
 *  to zoom, and a later print via getScene()->getPixelSizeHint() is a
 *  null dereference. HatchDialog.js's own live preview (patternChanged)
 *  never swaps its DI either, for the same reason -- it calls
 *  `this.previewDi.clear()` and refills the SAME document every time
 *  the pattern changes. This function does exactly that, through
 *  fillPreview. */
TripFocus.refresh = function() {
    if (isNull(TripFocus.state) || isNull(TripFocus.previewDi)) {
        return;   // the window is not actually open -- nothing to do
    }

    var doc = TripFocus.currentDocument();
    if (isNull(doc)) {
        TripFocus.state.emptyNotice.text = qsTr(
            "No drawing is open to refresh from -- showing the last " +
            "copy that was read.");
        TripFocus.state.emptyNotice.visible = true;
        return;
    }

    // Honesty, not identity: this build offers no safe way to confirm
    // `doc` is the SAME document `show()` opened against (see
    // `currentDocument`'s own docblock) -- only that it is a live one.
    // Naming it again, every time it differs, is what keeps the window
    // from silently describing a different cave under its original
    // title.
    var displayName = TripFocus.displayNameOf(doc);
    if (displayName !== TripFocus.state.sourceDisplayName) {
        TripFocus.state.sourceDisplayName = displayName;
        if (!isNull(TripFocus.dialog)) {
            try {
                TripFocus.dialog.windowTitle =
                    qsTr("Trip Focus") + " -- " + displayName;
            } catch (eTitle) {
            }
        }
    }

    // Capture what is checked BEFORE the pane is rebuilt -- buildList
    // below returns brand new checkboxes, all unchecked, and without
    // this a Refresh silently threw away every one of the reader's own
    // picks (probed: picked() went from three trips checked to none
    // across one refresh() call).
    var picked = TripFocus.picked(TripFocus.state.entries);
    var keptKeys = [];
    var pk, ai;
    for (ai = 0; ai < picked.trips.length; ai++) {
        keptKeys.push("trips:" + String(picked.trips[ai]));
    }
    for (ai = 0; ai < picked.teams.length; ai++) {
        keptKeys.push("teams:" + picked.teams[ai]);
    }
    for (ai = 0; ai < picked.people.length; ai++) {
        keptKeys.push("people:" + picked.people[ai]);
    }
    for (ai = 0; ai < picked.runs.length; ai++) {
        keptKeys.push("runs:" + picked.runs[ai]);
    }

    var di = TripFocus.previewDi;
    var unrebuilt = TripFocus.fillPreview(di, doc);
    di.regenerateScenes();

    var built = TripFocus.buildAttribution(di.getDocument());
    TripFocus.state.attribution = built.attribution;
    var statusText = TripFocus.copyStatusText(built.entityCount, unrebuilt);
    if (statusText === null) {
        TripFocus.state.emptyNotice.visible = false;
    } else {
        TripFocus.state.emptyNotice.text = statusText;
        TripFocus.state.emptyNotice.visible = true;
    }

    var read = TripFocus.readSurvey(doc);
    TripFocus.state.read = read;
    var groups = TripFocus.computeGroups(read);
    TripFocus.state.tripStations = groups.tripStations;
    TripFocus.state.runStations = groups.runStations;
    TripFocus.state.tripsForGroup = groups.tripsForGroup;

    var listBuilt = TripFocus.buildList(read);
    // swap the pane in place inside the splitter, so the reader's pane
    // widths survive a Refresh -- guarded, since sizes()/setSizes() are
    // not guaranteed by this Qt bridge (see SurveyNotebook.js's own
    // splitter for the same guard); losing the split is cosmetic, so a
    // failure here must not stop the pane from being replaced.
    var splitter = TripFocus.state.list.parentWidget();
    var index = 0;
    var sizes = null;
    try {
        index = splitter.indexOf(TripFocus.state.list);
        sizes = splitter.sizes();
    } catch (eSizes) {
        index = 0;
        sizes = null;
    }
    // destr(), not setParent(null): the old pane's QScrollArea, its
    // grid, every row's QCheckBox and every closure wireList connected
    // to one of them used to just become a parent-less orphan here,
    // kept alive by nothing but the Qt reference the C++ side still
    // held -- ten Refreshes was ten abandoned panes for the window's
    // whole remaining life. destr() is this suite's standard way to
    // free a widget script code constructed (see cleanUp's own
    // docblock); freeing it BEFORE inserting the replacement, matching
    // this function's own previous order, since Qt widget deletion
    // removes a widget from its parent's layout on its own.
    destr(TripFocus.state.list);
    splitter.insertWidget(index, listBuilt.widget);
    if (sizes !== null) {
        try {
            splitter.setSizes(sizes);
        } catch (eSetSizes) {
        }
    }
    TripFocus.state.list = listBuilt.widget;
    TripFocus.state.entries = listBuilt.entries;
    TripFocus.state.headers = listBuilt.headers;
    TripFocus.wireList();

    var missingKeys = TripFocus.applyPickKeys(TripFocus.state.entries,
        keptKeys);
    for (ai = 0; ai < TripFocus.state.headers.length; ai++) {
        TripFocus.syncHeaderChecked(TripFocus.state.headers[ai]);
    }
    // one or more of the reader's picks no longer exist in this reading
    // of the drawing (a trip deleted, a run renamed) -- said out loud
    // rather than just quietly ticking fewer boxes than they left
    // checked. Set on `state` rather than the notice widget directly:
    // `reapply` below calls `setPickNotice` unconditionally, which would
    // otherwise erase this before it was ever seen -- see
    // `setPickNotice`'s own docblock.
    TripFocus.state.staleRefreshNotice = missingKeys.length > 0 ?
        (qsTr("Some of what was checked no longer exists in this " +
            "drawing and could not be re-checked: ") +
            missingKeys.join(", ")) : null;
    TripFocus.reapply();
};

/** Reads the checkboxes and applies them. Called on every change. */
TripFocus.reapply = function() {
    var read = TripFocus.state.read;
    if (isNull(read)) {
        TripFocus.setPickNotice(null);
        TripFocus.applyFocus(TripFocus.previewDi, null,
            TripFocus.state.attribution);
        return;
    }
    var picked = TripFocus.picked(TripFocus.state.entries);
    if (CsFocus.isEmptySelection(picked)) {
        // nothing checked shows everything: a blank window looks like a
        // broken tool, not like an empty selection
        TripFocus.setPickNotice(null);
        TripFocus.applyFocus(TripFocus.previewDi, null,
            TripFocus.state.attribution);
        return;
    }
    var set = CsFocus.stationSet(picked, TripFocus.state.tripStations,
        TripFocus.state.runStations, TripFocus.state.tripsForGroup);

    var hasAny = false;
    for (var k in set) {
        if (set.hasOwnProperty(k)) {
            hasAny = true;
            break;
        }
    }
    if (!hasAny) {
        // SOMETHING is checked, but it resolved to zero stations (a
        // trip id, team, person or run whose key this drawing does not
        // actually have -- a stale pick surviving a Refresh against a
        // changed survey, most plausibly). Applying an empty-but-not-
        // null station set here would hide every attributable entity
        // and leave only the fail-safe ones (title block, border, ...)
        // -- a plan view that reads as broken for a completely
        // different reason than isEmptySelection's case above, so it
        // gets the same doctrine and its own explanation.
        TripFocus.setPickNotice(qsTr("Nothing checked matched a " +
            "station in this drawing -- showing everything."));
        TripFocus.applyFocus(TripFocus.previewDi, null,
            TripFocus.state.attribution);
        return;
    }
    TripFocus.setPickNotice(null);
    TripFocus.applyFocus(TripFocus.previewDi, set,
        TripFocus.state.attribution);
};

/** Wires every checkbox in the pane: a section header cascades its
 *  check state to its own rows, a plain row syncs its own header back
 *  to match its rows (see `syncHeaderChecked`), and every real change --
 *  a cascaded header or a plain row alike -- re-applies the focus filter
 *  afterwards. Pulled out of show() into its own function so Refresh
 *  can re-wire the replacement pane the same way. Guarded: a failed
 *  connect must leave the window usable with plain independent
 *  checkboxes rather than crash the whole tool over a cascade that is a
 *  convenience, not the point of this window.
 *
 *  Iterates `headers` only, not a separate flat `entries` pass: every
 *  row with a real checkbox belongs to exactly one section, so exactly
 *  one header's own `entries` list already covers all of them, and
 *  wiring the row handler per-header (rather than one handler shared by
 *  every row in the pane, as this used to do) is what lets that handler
 *  know WHICH header to sync without any other bookkeeping.
 *
 *  TripFocus.inCascade is the re-entrancy guard: setting a row's own
 *  `checked` from inside the header's handler fires that row's OWN
 *  `toggled` too, which would otherwise call reapply() once per row
 *  cascaded instead of once for the whole header click (the tree
 *  version guarded the exact same re-entrance the same way) -- and, now,
 *  setting the header's own `checked` from inside a row's handler fires
 *  the header's `toggled` right back, which would otherwise re-cascade
 *  the sync it was just doing back down into every row. */
TripFocus.wireList = function() {
    var headers = TripFocus.state.headers;
    var i, j;

    var makeHeaderHandler = function(head) {
        return function(checked) {
            if (TripFocus.inCascade) {
                return;
            }
            TripFocus.setChecked(head.entries, checked);
            TripFocus.reapply();
        };
    };
    var makeRowHandler = function(head) {
        return function() {
            if (TripFocus.inCascade) {
                return;
            }
            TripFocus.syncHeaderChecked(head);
            TripFocus.reapply();
        };
    };

    for (i = 0; i < headers.length; i++) {
        try {
            headers[i].box.toggled.connect(makeHeaderHandler(headers[i]));
        } catch (eHead) {
        }
        var rowHandler = makeRowHandler(headers[i]);
        for (j = 0; j < headers[i].entries.length; j++) {
            try {
                headers[i].entries[j].box.toggled.connect(rowHandler);
            } catch (eRow) {
            }
        }
    }
};

TripFocus.show = function(doc) {
    // A static entry point, unlike the action path that
    // setRequiresDocument(true) already protects (see init below) --
    // HatchDialog.prototype.show opens with exactly this guard, for the
    // same reason: `new RCopyOperation(new RVector(0, 0), null)` binds
    // a `RDocument&` reference, which is not a JS exception.
    if (isNull(doc)) {
        return;
    }

    // One window at a time: reopening a still-live window just raises
    // it, IGNORING this call's own `doc` -- even if the reader has
    // since switched to a different open document and typed "tf"
    // again, they get the SAME window, still describing whichever
    // document it was first opened against. That is a deliberate
    // simplification, decided here rather than left to be discovered
    // as a bug: the window is a one-shot snapshot (see readSurvey's
    // docblock) with no live link back to any document. Refresh (see
    // its own docblock) reads whatever document is CURRENTLY open
    // instead of holding onto this one specifically -- the one safe
    // choice once a captured `RDocument` reference can go stale -- and
    // renames the window when that turns out to differ, rather than
    // silently describing a different cave under this title.
    if (!isNull(TripFocus.dialog)) {
        TripFocus.dialog.raise();
        return;
    }
    // isNull() above just told us this is either genuinely unset or a
    // stale reference to an already-destroyed C++ dialog -- either way
    // it must not linger for cleanUp() to trip over later
    TripFocus.dialog = null;

    // Everything that can throw (the copy, the survey reconstruction,
    // the widgets) happens BEFORE the QDialog exists. TripFocus.dialog
    // is only assigned at the very end of this function, so a throw in
    // here leaves nothing behind to leak: no QDialog parented to the
    // main window outliving this call, and no half-set TripFocus.dialog
    // for the next "tf" to find and get confused by.
    var preview, read, groups, built;
    try {
        preview = TripFocus.buildPreview(doc);
        read = TripFocus.readSurvey(doc);
        groups = TripFocus.computeGroups(read);
        built = TripFocus.buildList(read);
    } catch (eBuild) {
        if (!isNull(preview) && !isNull(preview.di)) {
            destr(preview.di);
        }
        QMessageBox.warning(getMainWindow(), qsTr("Trip Focus"),
            qsTr("Trip Focus could not open: ") + String(eBuild));
        return;
    }

    TripFocus.previewDi = preview.di;

    var dlg = new QDialog(RMainWindowQt.getMainWindow());
    // The drawing's name, since this window never auto-refreshes (see
    // readSurvey's docblock) and raise() above deliberately keeps
    // showing whatever document it was first opened against -- naming
    // it here is the reader's only way to check they are not comparing
    // trips against yesterday's cave. See displayNameOf, shared with
    // refresh() so the two never read a document's name two ways.
    var displayName = TripFocus.displayNameOf(doc);
    dlg.windowTitle = qsTr("Trip Focus") + " -- " + displayName;
    // a window in its own right, not a sheet stuck to the main one:
    // the reader compares it against the drawing behind it
    dlg.setSizeGripEnabled(true);
    var layout = new QVBoxLayout();

    // A copy of nothing looks exactly like a working copy of an empty
    // cave, and a copy that is short some entities looks exactly like a
    // complete one -- see copyStatusText. This says so, rather than
    // leaving the reader to guess which one they are looking at.
    var emptyStatus = TripFocus.copyStatusText(preview.entityCount,
        preview.unrebuilt);
    var emptyNotice = new QLabel(emptyStatus === null ? "" : emptyStatus);
    emptyNotice.visible = (emptyStatus !== null);
    layout.addWidget(emptyNotice, 0, 0);
    // A different situation, decided fresh on every checkbox change
    // rather than once here -- see reapply and setPickNotice.
    var pickNotice = new QLabel("");
    pickNotice.visible = false;
    layout.addWidget(pickNotice, 0, 0);

    // Keep this include here, not at file scope, to match
    // HatchDialog.js's own reasoning for its identical preview view:
    // nothing outside show() needs a GUI widget class, so nothing
    // outside show() should have to be able to construct one.
    include("scripts/Widgets/AutoZoomView/AutoZoomView.js");
    var view = new AutoZoomView(dlg);
    view.objectName = "TripFocusView";
    // AutoZoomView re-runs autoZoom() on every resizeEvent (unlike a
    // plain RGraphicsViewQt, which PRESERVES the zoom factor across a
    // resize) -- that is what keeps the cave filling the pane while the
    // size grip is dragged, and it is also the safety net a single
    // manual autoZoom() call right after show() never had: that lone
    // call could land while the view was still narrower than 20px, at
    // which point RGraphicsSceneQt.zoomTo computes a NEGATIVE factor
    // that setFactor's finite-only check does not catch, and nothing
    // would ever recompute it again. AutoZoomView's resizeEvent fires
    // again as soon as the dialog gets its real layout size, so a bad
    // first zoom heals itself instead of staying garbage forever.
    // NOT view.disableGestures() -- contrast HatchDialog's own static
    // preview, which calls it: this view is meant to be panned and
    // zoomed by hand, comparing one trip's stretch of cave against
    // another's, so the reader's own pan/zoom gestures have to keep
    // working.
    var imageView = view.getImageView();
    imageView.setScene(new RGraphicsSceneQt(preview.di));
    imageView.setPaintOrigin(false);
    imageView.setMargin(10);

    var splitter = new QSplitter(Qt.Horizontal, dlg);
    splitter.addWidget(built.widget);
    splitter.addWidget(view);
    splitter.setSizes([320, 620]);
    layout.addWidget(splitter, 1, 0);

    // one window at a time (show() raises the existing one), so the
    // window's parts live here rather than as properties bolted onto
    // the QDialog wrapper -- Refresh replaces the list widget, and a
    // stale reference on a wrapper object is the kind of thing that
    // reads as "the buttons stopped working" much later
    TripFocus.state = { list: built.widget, entries: built.entries,
        headers: built.headers, read: read,
        attribution: preview.attribution,
        tripStations: groups.tripStations, runStations: groups.runStations,
        tripsForGroup: groups.tripsForGroup,
        sourceDisplayName: displayName, staleRefreshNotice: null,
        emptyNotice: emptyNotice, pickNotice: pickNotice };

    // Section checkboxes drive their own rows, and every change re-runs
    // the filter -- see TripFocus.wireList, pulled out on its own so
    // Refresh can re-wire the replacement pane the same way.
    TripFocus.wireList();
    // Nothing is checked yet, which reapply() reads as All -- but the
    // profile band is out of this window regardless of what is checked
    // (see applyFocus), so this first call is what keeps it off the very
    // moment the window opens rather than only after the first click.
    TripFocus.reapply();

    var buttons = new QHBoxLayout();
    var allButton = new QPushButton(qsTr("All"));
    var refreshButton = new QPushButton(qsTr("Refresh"));
    var closeButton = new QPushButton(qsTr("Close"));
    buttons.addWidget(allButton, 0, 0);
    buttons.addWidget(refreshButton, 0, 0);
    buttons.addStretch(1);
    buttons.addWidget(closeButton, 0, 0);
    layout.addLayout(buttons, 0);

    // All four connects are guarded alike -- including dlg.finished,
    // which previously was not: a failed connect leaving a button inert
    // is a convenience lost, but a failed dlg.finished connect used to
    // mean cleanUp() would never run at all, leaking the preview
    // document and the dialog's own C++ widgets for the rest of the
    // application's life. Guarding it cannot make that leak NOT happen
    // if the connect genuinely fails -- nothing here can substitute for
    // the signal -- but it keeps that one failure from being an
    // uncaught exception on top of the leak, which is the same standard
    // every other connect in this function already gets.
    try {
        allButton.clicked.connect(function() {
            TripFocus.setChecked(TripFocus.state.headers, true);
            TripFocus.setChecked(TripFocus.state.entries, true);
            TripFocus.reapply();
        });
    } catch (eAll) {
    }
    try {
        // No `doc` argument, deliberately -- see refresh's and
        // currentDocument's own docblocks for why closing over it here
        // is exactly the stale reference this fix removes.
        refreshButton.clicked.connect(function() {
            TripFocus.refresh();
        });
    } catch (eRefresh) {
    }
    try {
        // A plain function literal, not connect(dlg, "close") -- every
        // other signal wired in this suite (and in QCAD's own dialogs)
        // is wired this way; a connect() whose second argument is a
        // slot NAME STRING has no precedent anywhere in either tree and
        // is not worth being the first to find out whether this bridge
        // supports it.
        closeButton.clicked.connect(function() { dlg.reject(); });
    } catch (eClose) {
    }
    try {
        dlg.finished.connect(function() { TripFocus.cleanUp(); });
    } catch (eFinished) {
    }

    dlg.setLayout(layout);
    dlg.resize(900, 600);

    TripFocus.dialog = dlg;
    dlg.show();                  // NON-modal: exec() would freeze the
                                 // main window the reader is comparing
                                 // against
};

/** Frees the scratch document AND the dialog's own C++ widgets. A
 *  preview left behind holds a whole second copy of the drawing; ten
 *  opens without the first line is ten copies. destr() only frees the
 *  document interface -- without destrDialog() too, the QDialog itself
 *  (parented to the main window) outlives the close, so ten opens would
 *  still be ten abandoned dialogs, each holding a view and a scene, kept
 *  alive by the main window until the application exits. destrDialog()
 *  is this suite's (and QCAD's own) standard way to free a dialog --
 *  see scripts/library.js and every scripts/*Dialog.js in the QCAD tree.
 */
TripFocus.cleanUp = function() {
    if (!isNull(TripFocus.previewDi)) {
        destr(TripFocus.previewDi);
    }
    TripFocus.previewDi = null;
    if (!isNull(TripFocus.dialog)) {
        destrDialog(TripFocus.dialog);
    }
    TripFocus.dialog = null;
    TripFocus.state = null;
};

TripFocus.init = function(basePath) {
    var action = new RGuiAction(qsTr("Trip Focus"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/TripFocus.js");
    action.setIcon(basePath + "/TripFocus.svg");
    action.setStatusTip(qsTr("See how much of the cave each trip, team " +
        "and person surveyed, and look at just their work."));
    action.setDefaultCommands(["tripfocus", "tf"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(30);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
