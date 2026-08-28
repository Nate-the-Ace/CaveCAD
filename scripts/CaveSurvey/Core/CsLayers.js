// Layers.js -- the one place layer names live.
//
// Part of the Cave Survey Core library. The registry itself is pure
// data; ensure() touches the document and is the only function here
// that does.
//
// The vocabulary is the NSS plan template's: CTRL- prefixed control
// layers for survey data, named feature layers for the map itself.
// The old importer invented its own layer names (ALIGNMENT, LRUD,
// STATIONS) that existed in no template; every tool now draws to the
// same names the templates carry, and this registry is tested against
// the template files so the two cannot drift apart again.

var CsLayers = {};

// Control layers -- survey data, not map art.
CsLayers.SHOTS = "CTRL-SHOTS";
CsLayers.STATIONS = "CTRL-STATIONS";
CsLayers.STATION_LABELS = "CTRL-STATION-LABELS";
CsLayers.LRUD = "CTRL-LRUD";
CsLayers.SPLAYS = "CTRL-SPLAYS";
CsLayers.HIDDEN = "CTRL-HIDDEN";
CsLayers.RAW = "CTRL-RAW";
CsLayers.LRUD_WALL_LEFT = "CTRL-LRUD-WALL-LEFT";
CsLayers.LRUD_WALL_RIGHT = "CTRL-LRUD-WALL-RIGHT";
CsLayers.PROFILE_FLOOR = "CTRL-PROFILE-FLOOR";
CsLayers.PROFILE_CEILING = "CTRL-PROFILE-CEILING";
CsLayers.GRID = "CTRL-GRID";
CsLayers.AERIAL = "CTRL-AERIAL";
// Surface contours derived from public elevation data -- background
// context like CTRL-AERIAL, generated and erased by their own tool.
// CTRL- keeps them out of CsBind's reach, like every generated layer.
CsLayers.CONTOUR = "CTRL-CONTOUR";
CsLayers.CONTOUR_MAJOR = "CTRL-CONTOUR-MAJOR";
// Inserted sketch scans -- tracing sources, not map art. CTRL- keeps
// them out of CsBind's reach like every other suite-managed layer.
CsLayers.SCAN = "CTRL-SCAN";

// The profile frame's own control layers. EVERY ONE BEGINS "CTRL-",
// and that is load-bearing rather than cosmetic: CsBind's
// NEVER_LINEWORK_PREFIXES already refuses that prefix, so generated
// profile geometry stays ineligible for binding and moving with no
// change to CsBind at all. Drop the prefix and the generator's own
// output becomes bindable -- a test in js_unit.js asserts this.
//
// NAMING TRAP, READ BEFORE USING EITHER: CsLayers.PROFILE_CEILING is
// the GENERATED layer CTRL-PROFILE-CEILING, which the generator owns
// and ERASES on every redraw. CsLayers.PROFILE_TRACED_CEILING is the
// hand-traced PROFILE-CEILING, which is the user's own work and must
// NEVER be erased. The two constants are one word apart and mean
// opposite things. Same for floor.
CsLayers.PROFILE_SHOTS = "CTRL-PROFILE-SHOTS";
CsLayers.PROFILE_STATIONS = "CTRL-PROFILE-STATIONS";
CsLayers.PROFILE_STATION_LABELS = "CTRL-PROFILE-STATION-LABELS";
CsLayers.PROFILE_SPLAYS = "CTRL-PROFILE-SPLAYS";
CsLayers.PROFILE_LRUD = "CTRL-PROFILE-LRUD";
// The generator's own band captions and its exaggeration stamp.
//
// CTRL-, like every other layer the generator owns. They used to share
// the caver's PROFILE-TEXT-LABELS, which made erase() the owner of a
// layer in the user's namespace AND made generated captions bindable
// linework as far as CsBind was concerned. Per-run variants multiplied
// that: PROFILE-TEXT-LABELS-A was a generator-owned layer sitting in the
// traced vocabulary. A test now asserts every layer in
// CsProfileDraw.LAYERS() is CTRL-, so this cannot drift back.
CsLayers.PROFILE_BAND_LABELS = "CTRL-PROFILE-TEXT-LABELS";

// The profile frame's traceable layers -- what a caver draws on an
// elevation. These must NOT begin "CTRL-", for the mirror of the
// reason above: hand-traced profile linework has to stay bindable so
// it moves when the survey does.
CsLayers.PROFILE_TRACED_CEILING = "PROFILE-CEILING";
CsLayers.PROFILE_TRACED_FLOOR = "PROFILE-FLOOR";
CsLayers.PROFILE_WALLS_INFERRED = "PROFILE-WALLS-INFERRED";
CsLayers.PROFILE_TEXT_NOTES = "PROFILE-TEXT-NOTES";
CsLayers.PROFILE_TEXT_LABELS = "PROFILE-TEXT-LABELS";
CsLayers.PROFILE_BREAKDOWN = "PROFILE-BREAKDOWN";
CsLayers.PROFILE_ENTRANCE = "PROFILE-ENTRANCE";

// Callout (multileader) layers, one per CsCallout style. Callout
// members go here and never on the current layer -- a note drawn onto
// WALLS-SURVEYED becomes wall linework the next time anything works by
// layer.
// The plain note, and the default callout style.
CsLayers.NOTES_GENERAL = "NOTES-GENERAL";
CsLayers.NOTES_HAZARD = "NOTES-HAZARD";
CsLayers.NOTES_DIG = "NOTES-DIG";
CsLayers.NOTES_EQUIPMENT = "NOTES-EQUIPMENT";
CsLayers.NOTES_NAME = "NOTES-NAME";
CsLayers.NOTES_ELEVATION = "NOTES-ELEVATION";
CsLayers.NOTES_ELEVATION_LINE = "NOTES-ELEVATION-LINE";
CsLayers.NOTES_ANNOTATION = "NOTES-ANNOTATION";

// Feature layers the tools write to.
CsLayers.WALLS_SURVEYED = "WALLS-SURVEYED";
CsLayers.WALLS_INFERRED = "WALLS-INFERRED";
CsLayers.BREAKDOWN = "BREAKDOWN";
CsLayers.BREAKDOWN_BOUNDARY = "BREAKDOWN-BOUNDARY";
CsLayers.CROSS_SECTION_MARKERS = "CROSS-SECTION-MARKERS";
CsLayers.NORTH_ARROW = "NORTH-ARROW";
CsLayers.SCALE_BAR = "SCALE-BAR";
CsLayers.TITLE_BLOCK = "TITLE-BLOCK";
CsLayers.LEGEND = "LEGEND";
CsLayers.BORDER = "BORDER";
CsLayers.TEXT_LABELS = "TEXT-LABELS";
CsLayers.TEXT_NOTES = "TEXT-NOTES";
CsLayers.ENTRANCE = "ENTRANCE";

// Shaped Lines feature layers (spine + decoration both land here), and
// the hidden skeleton layer for the decor-only styles: a flowstone
// edge's spine is scaffolding, not map ink, so it lives on a CTRL layer
// that is OFF by default -- switch it on to grab and reshape the edge.
CsLayers.LEDGE_FLOOR = "LEDGE-FLOOR";
CsLayers.LEDGE_CEILING = "LEDGE-CEILING";
CsLayers.FLOWSTONE = "FLOWSTONE";
CsLayers.RIMSTONE = "RIMSTONE";
CsLayers.SHAPE_SPINE = "CTRL-SHAPE-SPINE";

// Defaults for creating a layer that is missing from the drawing
// (someone working without the template still gets sane colors).
// name -> [colorName, linetype, lineweightKey]
// lineweightKey is resolved against RLineweight at ensure() time so
// this table stays loadable outside QCAD.
CsLayers.DEFAULTS = {
    "CTRL-SHOTS": ["gray", "CONTINUOUS", "Weight025"],
    "CTRL-STATIONS": ["red", "CONTINUOUS", "Weight025"],
    "CTRL-STATION-LABELS": ["red", "CONTINUOUS", "Weight025"],
    "CTRL-LRUD": ["pink", "CONTINUOUS", "Weight025"],
    "CTRL-SPLAYS": ["gray", "CONTINUOUS", "Weight000"],
    "CTRL-HIDDEN": ["gray", "CONTINUOUS", "Weight000"],
    "CTRL-RAW": ["gray", "DASHED", "Weight000"],
    "CTRL-LRUD-WALL-LEFT": ["gray", "DASHED", "Weight000"],
    "CTRL-LRUD-WALL-RIGHT": ["gray", "DASHED", "Weight000"],
    "CTRL-PROFILE-FLOOR": ["gray", "DASHED", "Weight000"],
    "CTRL-PROFILE-CEILING": ["gray", "DASHED", "Weight000"],
    // The profile frame's generated layers mirror their plan twins'
    // appearance, so the same kind of geometry reads the same in both
    // views of one sheet.
    "CTRL-PROFILE-SHOTS": ["gray", "CONTINUOUS", "Weight025"],
    "CTRL-PROFILE-STATIONS": ["red", "CONTINUOUS", "Weight025"],
    "CTRL-PROFILE-STATION-LABELS": ["red", "CONTINUOUS", "Weight025"],
    "CTRL-PROFILE-SPLAYS": ["gray", "CONTINUOUS", "Weight000"],
    "CTRL-PROFILE-LRUD": ["pink", "CONTINUOUS", "Weight025"],
    "CTRL-PROFILE-TEXT-LABELS": ["red", "CONTINUOUS", "Weight018"],
    // and the traceable ones mirror the plan feature layer a caver
    // would reach for to draw the same thing. Ceiling and floor are
    // the elevation's wall lines, hence WALLS-SURVEYED's weight.
    "PROFILE-CEILING": ["white", "CONTINUOUS", "Weight050"],
    "PROFILE-FLOOR": ["white", "CONTINUOUS", "Weight050"],
    "PROFILE-WALLS-INFERRED": ["gray", "DASHED", "Weight025"],
    "PROFILE-TEXT-NOTES": ["white", "CONTINUOUS", "Weight009"],
    "PROFILE-TEXT-LABELS": ["white", "CONTINUOUS", "Weight018"],
    "PROFILE-BREAKDOWN": ["white", "CONTINUOUS", "Weight000"],
    "PROFILE-ENTRANCE": ["white", "CONTINUOUS", "Weight035"],
    "CTRL-AERIAL": ["gray", "CONTINUOUS", "Weight000"],
    // Contours are background context: muted like the aerial they
    // usually sit on, majors told apart by weight alone (colors here
    // stay within the set already proven elsewhere in this table).
    "CTRL-CONTOUR": ["gray", "CONTINUOUS", "Weight000"],
    "CTRL-CONTOUR-MAJOR": ["gray", "CONTINUOUS", "Weight025"],
    "CTRL-SCAN": ["gray", "CONTINUOUS", "Weight000"],
    // Matches the plan template's own CTRL-GRID record (light gray,
    // continuous, 0.13mm) so a drawing without the template gets the
    // same grid rather than the fallback appearance.
    "CTRL-GRID": ["gray", "CONTINUOUS", "Weight013"],
    "WALLS-SURVEYED": ["white", "CONTINUOUS", "Weight050"],
    "WALLS-INFERRED": ["gray", "DASHED", "Weight025"],
    "BREAKDOWN": ["white", "CONTINUOUS", "Weight000"],
    "BREAKDOWN-BOUNDARY": ["cyan", "DASHED", "Weight000"],
    "CROSS-SECTION-MARKERS": ["white", "CONTINUOUS", "Weight035"],
    "NORTH-ARROW": ["white", "CONTINUOUS", "Weight025"],
    "SCALE-BAR": ["white", "CONTINUOUS", "Weight025"],
    "TITLE-BLOCK": ["white", "CONTINUOUS", "Weight025"],
    "LEGEND": ["white", "CONTINUOUS", "Weight018"],
    "TEXT-LABELS": ["white", "CONTINUOUS", "Weight018"],
    "TEXT-NOTES": ["white", "CONTINUOUS", "Weight009"],
    "ENTRANCE": ["white", "CONTINUOUS", "Weight035"],
    // Shaped Lines. The ceiling ledge is DASHED at the layer, which is
    // what makes the spine itself print as the NSS dashed ledge line --
    // the ticks are separate entities and inherit the same layer, but a
    // tick is too short for a dash to land visibly. CTRL-SHAPE-SPINE is
    // the invisible skeleton under flowstone/rimstone decor: gray,
    // dashed, hairline, and created OFF (see CsLayers.OFF below).
    "LEDGE-FLOOR": ["white", "CONTINUOUS", "Weight035"],
    "LEDGE-CEILING": ["white", "DASHED", "Weight025"],
    "FLOWSTONE": ["white", "CONTINUOUS", "Weight025"],
    "RIMSTONE": ["white", "CONTINUOUS", "Weight025"],
    "CTRL-SHAPE-SPINE": ["gray", "DASHED", "Weight000"],
    "CTRL-DATA": ["gray", "CONTINUOUS", "Weight000"],
    // Callout layers. Hazard is red because it is the one a caver must
    // not miss. Every color and weight below is one already proven
    // elsewhere in this table -- "yellow" and "green" do not appear
    // anywhere else in CsLayers.DEFAULTS, so they are not used here.
    // ELEVATION vs ELEVATION-LINE is a DIRECTED pair, not merely two
    // different colours. ELEVATION-LINE carries a survey-line elevation
    // standing in for a floor nobody measured, so it must read as
    // PROVISIONAL: the muted colour, dashed, hairline. ELEVATION is the
    // real reading and gets the plain, legible one. Swapping them still
    // passes a "the two differ" test while making the fallback OUTSHINE
    // the measurement -- the exact misreading this pair exists to stop.
    // Do not reverse them.
    // The plain note: the default style, so it reads like ordinary map
    // lettering rather than announcing itself.
    "NOTES-GENERAL": ["white", "CONTINUOUS", "Weight018"],
    "NOTES-HAZARD": ["red", "CONTINUOUS", "Weight025"],
    "NOTES-DIG": ["pink", "CONTINUOUS", "Weight018"],
    "NOTES-EQUIPMENT": ["cyan", "CONTINUOUS", "Weight018"],
    "NOTES-NAME": ["white", "CONTINUOUS", "Weight018"],
    "NOTES-ELEVATION": ["white", "CONTINUOUS", "Weight018"],
    "NOTES-ELEVATION-LINE": ["gray", "DASHED", "Weight009"],
    // Generated note labels. Same appearance as a hand-placed name note
    // -- a reader should not be able to tell which notes the suite drew
    // and which the caver placed -- but its own layer, so a regenerate
    // can clear it without touching hand work.
    "NOTES-ANNOTATION": ["white", "CONTINUOUS", "Weight018"]
};

// Layers that belong to the SHEET rather than to either view: one
// drawing prints as one sheet, and a plan with an elevation below it is
// ordinary cave cartography, so these are shared on purpose.
CsLayers.SHEET_LAYERS = ["0", "Defpoints", "BORDER", "TITLE-BLOCK",
    "LEGEND", "SCALE-BAR"];

/**
 * Which view a layer belongs to: "plan", "profile" or "sheet".
 *
 * THE ONLY PLACE THIS QUESTION IS ANSWERED. CsBind, RebuildSurveyData,
 * eraseStations and the warp tools all ask here rather than each
 * matching a prefix their own way -- those are shipped plan-view files,
 * and a second spelling of "is this profile?" is how they start
 * disagreeing about the same layer.
 *
 * An unrecognised name answers "plan", deliberately. The dangerous
 * mistake is a profile-scoped sweep picking up a layer nobody
 * classified -- a user's own layer, or one a future feature adds -- so
 * the default is the frame that owns the drawing's origin.
 */
CsLayers.frameOf = function(layerName) {
    if (layerName === undefined || layerName === null) {
        return "plan";
    }
    var name = String(layerName);
    var i;
    for (i = 0; i < CsLayers.SHEET_LAYERS.length; i++) {
        if (name === CsLayers.SHEET_LAYERS[i]) {
            return "sheet";
        }
    }
    // Both spellings of the profile frame: CTRL-PROFILE-* for generated
    // geometry, PROFILE-* for what is traced by hand.
    if (name.indexOf("CTRL-PROFILE-") === 0 || name.indexOf("PROFILE-") === 0) {
        return "profile";
    }
    return "plan";
};

// Layers created switched OFF (invisible): the data store, CTRL-HIDDEN
// for legs that must persist but never plot, and CTRL-RAW, the
// as-surveyed ghost -- reference geometry showing where the survey
// was before adjustment moved it, not the map itself, so a reader
// switches it on deliberately rather than seeing it by default. NOT
// frozen -- frozen, off and locked layers ALL silently refuse entity
// adds in this build (RAddObjectsOperation just drops them), so
// nothing can be drawn onto these layers while they are off: a
// writer must wrap its add operation in CsLayers.withLayerOn below,
// which flips the layer visible for the write and restores it after.
CsLayers.OFF = { "CTRL-DATA": true, "CTRL-HIDDEN": true, "CTRL-RAW": true,
    "CTRL-SHAPE-SPINE": true };

/**
 * True when this layer will SILENTLY REFUSE edits -- adds, deletes and
 * modifies alike. Off or frozen.
 *
 * ONE predicate, because there were four copies of it and they did not
 * agree. Three tested isOff() alone, so a FROZEN layer was never
 * unwrapped: CsDraw.eraseStations left the as-surveyed ghost undeleted
 * (it accumulated a copy per redraw, and printed "Transaction failed"
 * with nothing to say which layer), and CsBind.tagEntities lost its tag
 * writes outright. Both were found only after a real drawing was
 * damaged.
 *
 * LOCKED is not included, deliberately. A lock is something the surveyor
 * did on purpose; off and frozen are visibility, which a writer may
 * reveal for the length of its own write. A locked layer refuses, and
 * that is the honest outcome -- see FeatureTraceRun.refusalReason.
 *
 * Anything unreadable answers false: attempt the edit rather than
 * silently skip the layer.
 */
CsLayers.refusesEdits = function(lay) {
    if (isNull(lay)) {
        return false;
    }
    try {
        if (lay.isOff()) {
            return true;
        }
    } catch (eOff) {
        return false;
    }
    try {
        return lay.isFrozen() === true;
    } catch (eFrozen) {
        return false;   // no frozen concept in this build
    }
};

/**
 * Runs fn with the named layer VISIBLE -- neither off nor frozen -- then
 * restores whichever of those it had to change, even when fn throws.
 *
 * LOCKED is deliberately NOT cleared. Off and frozen are visibility, and
 * a writer may reasonably reveal a layer for the length of its own
 * write. Locked is protection: a caver locked it to stop things
 * changing, and overriding that silently would be the tool deciding it
 * knows better. A locked layer still refuses the write, and callers that
 * care report it -- see FeatureTraceRun.refusalReason. Exists because this
 * build's RAddObjectsOperation silently refuses to add entities to a
 * layer that is off (see CsLayers.OFF above): any write targeting a
 * normally-off layer must happen inside this wrapper or it is lost
 * without an error. Defensive throughout: a missing layer or a bridge
 * without layer toggling just runs fn as-is. QCAD context only.
 *
 * \return whatever fn returns
 */
CsLayers.withLayerOn = function(doc, di, layerName, fn) {
    var wasOff = false;
    var wasFrozen = false;
    try {
        var lay = doc.queryLayer(layerName);
        if (!isNull(lay)) {
            if (lay.isOff()) {
                lay.setOff(false);
                wasOff = true;
            }
            // FROZEN refuses operations exactly as OFF does, and this
            // function used to clear only OFF. A drawing with CTRL-RAW
            // frozen -- an ordinary thing for a caver to do to the
            // as-surveyed ghost -- made every redraw report "Transaction
            // failed. Please check for block recursions and locked or
            // invisible layers or blocks." twice, with nothing to say
            // which layer or why.
            try {
                if (lay.isFrozen()) {
                    lay.setFrozen(false);
                    wasFrozen = true;
                }
            } catch (eFrozen) {
                wasFrozen = false;   // no frozen concept in this build
            }
            if (wasOff || wasFrozen) {
                var opOn = new RModifyObjectsOperation();
                opOn.addObject(lay, false);
                di.applyOperation(opOn);
            }
        }
    } catch (e) {
        wasOff = false; // could not toggle; fn still runs
        wasFrozen = false;
    }
    var result, thrown = null, didThrow = false;
    try {
        result = fn();
    } catch (e2) {
        thrown = e2;
        didThrow = true;
    }
    if (wasOff || wasFrozen) {
        try {
            var layOff = doc.queryLayer(layerName);
            if (!isNull(layOff)) {
                if (wasOff) {
                    layOff.setOff(true);
                }
                if (wasFrozen) {
                    layOff.setFrozen(true);
                }
                var opOff = new RModifyObjectsOperation();
                opOff.addObject(layOff, false);
                di.applyOperation(opOff);
            }
        } catch (e3) {
            // restoring visibility is a nicety; the data already landed
        }
    }
    if (didThrow) {
        throw thrown;
    }
    return result;
};

/**
 * Ensures a layer exists, creating it with its registry defaults if
 * not. Direct RLayer construction -- simple.js's addLayer relies on
 * current-layer plumbing that fails silently in the QJS bridge.
 * QCAD context only.
 */
CsLayers.ensure = function(doc, di, name) {
    if (doc.hasLayer(name)) {
        return;
    }
    // A VARIANT layer (PROFILE-CEILING-A) inherits its base layer's
    // appearance. Without this it takes the fallback below and looks
    // nothing like the layer it varies -- silently, which is how the
    // un-registered PROFILE-CEILING got the wrong lineweight before.
    // Guarded by typeof so CsLayers still loads standalone, which the
    // one-shot template tools rely on.
    var d = CsLayers.DEFAULTS[name];
    if (isNull(d) && typeof CsLayerVariants !== "undefined") {
        var base = CsLayerVariants.baseOf(name);
        if (!isNull(base)) {
            d = CsLayers.DEFAULTS[base];
        }
    }
    if (isNull(d)) {
        d = ["white", "CONTINUOUS", "Weight025"];
    }
    var layer = new RLayer(doc, name, false, false,
        new RColor(d[0]), doc.getLinetypeId(d[1]),
        RLineweight[d[2]], CsLayers.OFF[name] === true);
    var op = new RAddObjectsOperation();
    op.addObject(layer);
    di.applyOperation(op);
};

/** Ensures the layers every survey-drawing tool relies on. */
CsLayers.ensureSurveyLayers = function(doc, di) {
    CsLayers.ensure(doc, di, CsLayers.SHOTS);
    CsLayers.ensure(doc, di, CsLayers.STATIONS);
    CsLayers.ensure(doc, di, CsLayers.STATION_LABELS);
    CsLayers.ensure(doc, di, CsLayers.LRUD);
    CsLayers.ensure(doc, di, CsLayers.SPLAYS);
    CsLayers.ensure(doc, di, CsLayers.HIDDEN);
    CsLayers.ensure(doc, di, CsLayers.AERIAL);
};

/** Ensure every callout style layer exists. Called by each callout
 *  command before it writes, so a drawing that never saw the template
 *  still gets the right appearance. */
CsLayers.ensureCalloutLayers = function(doc, di) {
    CsLayers.ensure(doc, di, CsLayers.NOTES_GENERAL);
    CsLayers.ensure(doc, di, CsLayers.NOTES_HAZARD);
    CsLayers.ensure(doc, di, CsLayers.NOTES_DIG);
    CsLayers.ensure(doc, di, CsLayers.NOTES_EQUIPMENT);
    CsLayers.ensure(doc, di, CsLayers.NOTES_NAME);
    CsLayers.ensure(doc, di, CsLayers.NOTES_ELEVATION);
    CsLayers.ensure(doc, di, CsLayers.NOTES_ELEVATION_LINE);
    CsLayers.ensure(doc, di, CsLayers.NOTES_ANNOTATION);
};
