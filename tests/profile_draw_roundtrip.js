// profile_draw_roundtrip.js -- draw a profile, sketch on it, draw again.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/profile_draw_roundtrip.js "$PWD"
//
// The two claims that matter for a file the user draws on:
//   1. regeneration replaces the generator's own output, not the
//      user's -- a hand-drawn wall is still there afterwards;
//   2. regeneration does not DOUBLE the generator's output.
//
// Plus three more, each a real bug class named in this feature's own
// brief and worth catching here rather than trusting the brief's own
// draft implementation:
//   3. every entity this module draws carries ProfileRun, not just its
//      own specific tag (an earlier draft left the station LABEL
//      without it);
//   4. a layer the USER switched off by hand -- not one that ships off
//      by default -- must not make erase()/render() silently do
//      nothing, the same failure mode CsDraw.eraseStations once had;
//   5. a band that stopped at its own very first station (no stations,
//      no legs, nothing to draw but a caption) must not crash, and must
//      not silently draw its caption as if the band sat at elevation 0.

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) {
            return true;
        }
        try {
            if (typeof v.isNull === "function") {
                return v.isNull();
            }
        } catch (e) {
        }
        return false;
    };
}
if (typeof createSpatialIndex === "undefined") {
    createSpatialIndex = function() {
        return new RSpatialIndexNavel();
    };
}
if (typeof destr === "undefined") {
    destr = function(obj) {
        if (RSettings.getQtVersion() >= 0x060000) {
            obj.destr();
        } else if (typeof obj.destroy === "function") {
            obj.destroy();
        }
    };
}

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

function loadRepoScript(rel) {
    var file = new QFile(repoRoot + "/" + rel);
    if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open " + rel);
    }
    var stream = new QTextStream(file);
    var src = stream.readAll();
    file.close();
    // Indirect eval: a direct eval() here would land every Cs* global in
    // THIS FUNCTION's scope, invisible the moment loadRepoScript()
    // returns -- same reason tests/js_unit.js's own loader uses this.
    (0, eval)(src);
}

var CORE = ["CsUnits", "CsCave", "CsGeoProject", "CsAngles", "CsIgrfCoeffs",
    "CsGeomag", "CsModel", "CsTraverse", "CsNetwork", "CsAdjust", "CsLrud",
    "CsValidate", "CsStats", "CsGrade", "CsTags", "CsLayers", "CsDraw",
    "CsProfile", "CsProfileDraw",
    // CsRevise before CsBind -- CsBind's layer gate consults
    // CsRevise.isWorldFixedLayer when it is loaded.
    "CsRevise", "CsBind", "CsProfileBind"];
for (var c = 0; c < CORE.length; c++) {
    loadRepoScript("scripts/CaveSurvey/Core/" + CORE[c] + ".js");
}

var failures = [];
function ok(cond, what) {
    if (!cond) { failures.push(what); }
}
function eqs(a, b, what) {
    ok(a === b, what + " (expected " + b + ", got " + a + ")");
}
function near(a, b, tol, what) {
    ok(Math.abs(a - b) <= tol,
        what + " (expected " + b + " +/- " + tol + ", got " + a + ")");
}

function shotOf(from, to, d, az, inc, u, dn) {
    var s = CsModel.newShot();
    s.from = from; s.to = to; s.distance = d; s.azimuth = az;
    s.inclination = inc || 0;
    s.up = (u === undefined) ? null : u;
    s.down = (dn === undefined) ? null : dn;
    return s;
}

// This file's OWN literal namespace list, kept deliberately separate
// from CsProfileDraw.TAGS: a scanner reading the constant it is meant
// to be testing would let a mutation that drops a tag from TAGS mutate
// the test right alongside the code, so every kill through that tag
// would prove nothing about erase()/render() at all. Kept in sync BY
// HAND with the table in CsProfileDraw.js's own file banner.
var KNOWN_PROFILE_TAGS = ["ProfileRun", "ProfileStation", "ProfileShot",
    "ProfileSplay", "ProfileFloorRun", "ProfileCeilingRun",
    "ProfileBandLabel", "ProfileZOffset"];

/** Every Profile*-tagged entity in the doc, as
 *  {id, entity, layer, tags: {key: value}}. */
function scanProfileEntities(doc) {
    var out = [];
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) { continue; }
        var tags = {};
        var any = false;
        for (var t = 0; t < KNOWN_PROFILE_TAGS.length; t++) {
            var v = CsTags.get(e, KNOWN_PROFILE_TAGS[t]);
            if (v !== null && v !== "") {
                tags[KNOWN_PROFILE_TAGS[t]] = v;
                any = true;
            }
        }
        if (any) {
            var layerName = null;
            try {
                layerName = doc.getLayerName(e.getLayerId());
            } catch (eLayer) {
                layerName = null;
            }
            out.push({ id: ids[i], entity: e, layer: layerName, tags: tags });
        }
    }
    return out;
}

/** True if entity is a plain point (RS.EntityPoint), the same getType()
 *  idiom RebuildSurveyData.js uses to tell entity kinds apart -- used
 *  below to separate a station's POINT from its text LABEL, since both
 *  carry the identical ProfileStation tag. */
function isPointEntity(entity) {
    return typeof entity.getType === "function" &&
        entity.getType() === RS.EntityPoint;
}

/** How many scanned entities carry tagKey === tagValue. */
function countByTag(scanned, tagKey, tagValue) {
    var n = 0;
    for (var i = 0; i < scanned.length; i++) {
        if (scanned[i].tags[tagKey] === tagValue) { n++; }
    }
    return n;
}

// =======================================================================
// 1. The base fixture: two bands (A's trunk, and a one-station spur
//    A2a1 tying into A2). Proves the two properties that make this
//    feature usable at all.
// =======================================================================

var sv = CsModel.newSurvey();
sv.shots = [
    shotOf("A1", "A2", 10, 0, 0, 4, 2),
    shotOf("A2", "A3", 10, 0, -10, 4, 2),
    shotOf("A2", "A2a1", 6, 90, 0, 3, 1)
];
var resolved = CsNetwork.resolve(sv, {});
var profile = CsProfile.build(sv, resolved, {});

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);

var first = CsProfileDraw.render(doc, di, profile, {});
eqs(first.bandsDrawn, 2, "two bands drawn");
eqs(first.legsDrawn, 3, "three legs drawn");
var afterFirst = doc.queryAllEntities(false, false).length;
ok(afterFirst > 0, "the profile actually put entities in the document");

// the user sketches a wall on the plain, un-prefixed tracing layer --
// NOT the CTRL-PROFILE-CEILING pair the generator writes to
CsLayers.ensure(doc, di, "PROFILE-CEILING");
var op = new RAddObjectsOperation();
var sketch = new RLineEntity(doc,
    new RLineData(new RVector(0, 5), new RVector(20, 6)));
sketch.setLayerId(doc.getLayerId("PROFILE-CEILING"));
op.addObject(sketch, false);
di.applyOperation(op);
var sketchId = sketch.getId();
ok(sketchId > 0, "the sketch landed");

// regenerate
var second = CsProfileDraw.render(doc, di, profile, {});
eqs(second.bandsDrawn, 2, "redraw drew the same two bands");

ok(!isNull(doc.queryEntity(sketchId)),
    "THE SKETCH SURVIVED REGENERATION");

var afterSecond = doc.queryAllEntities(false, false).length;
eqs(afterSecond, afterFirst + 1,
    "redraw replaced its own output instead of doubling it (was " +
    afterFirst + " + 1 sketch)");

// property 3: EVERY entity this module drew carries ProfileRun, not
// just its own specific tag -- a draft of this file left the per-
// station LABEL (as opposed to the station POINT) without it.
var scanned1 = scanProfileEntities(doc);
ok(scanned1.length > 0, "sanity: something is tagged Profile*");
var missingRun = 0;
for (var mi = 0; mi < scanned1.length; mi++) {
    if (scanned1[mi].tags.ProfileRun === undefined) { missingRun++; }
}
eqs(missingRun, 0,
    "every Profile*-tagged entity also carries ProfileRun (" +
    missingRun + " of " + scanned1.length + " did not)");

// the station label specifically -- ProfileStation="A1" should appear
// on TWO entities (the point and its text label), and BOTH need
// ProfileRun -- this is the exact case an earlier draft missed, so
// name it rather than only checking the aggregate count above.
var a1Entities = [];
for (var ai = 0; ai < scanned1.length; ai++) {
    if (scanned1[ai].tags.ProfileStation === "A1") { a1Entities.push(scanned1[ai]); }
}
eqs(a1Entities.length, 2,
    "station A1 drew exactly a point and a label (got " +
    a1Entities.length + ")");
for (var a1i = 0; a1i < a1Entities.length; a1i++) {
    eqs(a1Entities[a1i].tags.ProfileRun, "A",
        "A1's entity #" + a1i + " (by ProfileStation) also carries ProfileRun");
}

// property: the layer split is the whole payload of Task 6 -- drawing
// every kind of entity onto the wrong (but still valid) layer would
// leave every count/tag assertion above green. Checked here for the
// three kinds this fixture produces; fixture 2 below covers the other
// three (ceiling/floor/flat all need real wall evidence to exist at
// all).
var a1Point = null, a1Label = null;
for (var a1j = 0; a1j < a1Entities.length; a1j++) {
    if (isPointEntity(a1Entities[a1j].entity)) {
        a1Point = a1Entities[a1j];
    } else {
        a1Label = a1Entities[a1j];
    }
}
ok(a1Point !== null && a1Label !== null,
    "sanity: A1's point and label were told apart");
if (a1Point !== null) {
    eqs(a1Point.layer, CsLayers.STATIONS,
        "the station POINT lands on CTRL-STATIONS");
}
if (a1Label !== null) {
    eqs(a1Label.layer, CsLayers.STATION_LABELS,
        "the station LABEL lands on CTRL-STATION-LABELS, a different " +
        "layer from its own point");
}
// minor: the label sits TEXT_HEIGHT*1.5 above its point -- a comment
// in CsProfileDraw.band cites this exact number as the reason a
// getType() filter is needed at all (section 3 below), so the number
// itself is worth pinning down, not just its consequence.
if (a1Point !== null && a1Label !== null) {
    near(a1Label.entity.getPosition().y - a1Point.entity.getPosition().y,
        CsDraw.TEXT_HEIGHT * 1.5, 1e-9,
        "the station label's Y offset above its point is exactly " +
        "TEXT_HEIGHT * 1.5");
}

var a1a2Leg = null, bandALabel = null;
for (var a1k = 0; a1k < scanned1.length; a1k++) {
    if (scanned1[a1k].tags.ProfileShot === "A1->A2") { a1a2Leg = scanned1[a1k]; }
    if (scanned1[a1k].tags.ProfileBandLabel === "A") { bandALabel = scanned1[a1k]; }
}
ok(a1a2Leg !== null, "sanity: found the A1->A2 leg");
if (a1a2Leg !== null) {
    eqs(a1a2Leg.layer, CsLayers.SHOTS, "a centerline leg lands on CTRL-SHOTS");
}
ok(bandALabel !== null, "sanity: found band A's caption");
if (bandALabel !== null) {
    eqs(bandALabel.layer, CsLayers.TEXT_LABELS,
        "a band caption lands on TEXT-LABELS");
    // minor: the caption sits TEXT_HEIGHT*4.0 above CsProfileDraw.
    // labelY0(band) (band A's own zOffset is 0, so no further shift).
    var bandA = null;
    for (var bak = 0; bak < profile.bands.length; bak++) {
        if (profile.bands[bak].key === "A") { bandA = profile.bands[bak]; }
    }
    if (bandA !== null) {
        near(bandALabel.entity.getPosition().y -
                (CsProfileDraw.labelY0(bandA) + (bandA.zOffset || 0.0)),
            CsDraw.TEXT_HEIGHT * 4.0, 1e-9,
            "the band caption's Y offset above the band's reference " +
            "height is exactly TEXT_HEIGHT * 4.0");
    }
}

destr(di);

// =======================================================================
// 2. A layer the USER switched off by hand, between two redraws. None
//    of CsProfileDraw's layers ship off by default -- CsLayers.OFF
//    never names any of them -- so this can only happen by a person's
//    own choice (e.g. hiding the generated ceiling to trace over it on
//    the plain PROFILE-CEILING layer instead). This build refuses BOTH
//    adds and deletes on an off layer with no error, so without
//    CsProfileDraw.withOwnLayersOn this redraw would silently do
//    nothing: the stale ceiling run would survive (off-screen) and the
//    fresh one would never land.
// =======================================================================

// C1-C2-C3, a plain unbranched chain so C2 and C3's LRUD forms one real
// 2-point ceiling run and one real 2-point floor run (a junction would
// flush and drop a lone point -- see CsProfile.bandWallRuns).
var svC = CsModel.newSurvey();
svC.shots = [
    shotOf("C1", "C2", 10, 0, 0, 3, 2),
    shotOf("C2", "C3", 10, 0, 0, 3, 2)
];
// A real near-horizontal SPLAY (not LRUD) at C2, inside the default
// +-10 degree dead zone -- CsProfile.classifySplay reads this as
// "flat", so bandWallRuns routes it to band.flat (a tick) rather than
// into the ceiling or floor run. This is the one piece of this file's
// acceptance criteria the C1-C2-C3 chain above does not otherwise
// exercise at all.
var flatSplay = CsModel.newShot();
flatSplay.from = "C2";
flatSplay.splay = true;
flatSplay.distance = 3;
flatSplay.azimuth = 90;
flatSplay.inclination = 0;
svC.shots.push(flatSplay);

var resolvedC = CsNetwork.resolve(svC, {});
var profileC = CsProfile.build(svC, resolvedC, {});
eqs(profileC.bands.length, 1, "sanity: the C fixture is one band");
eqs(profileC.bands[0].ceiling.length, 1,
    "sanity: the C fixture drew one ceiling run");
eqs(profileC.bands[0].floor.length, 1,
    "sanity: the C fixture drew one floor run");
eqs(profileC.bands[0].flat.length, 1,
    "sanity: the C fixture drew one flat splay tick");

var docC = new RDocument(new RMemoryStorage(), createSpatialIndex());
var diC = new RDocumentInterface(docC);
var renderC1 = CsProfileDraw.render(docC, diC, profileC, {});
eqs(renderC1.flatTicks, 1, "render() drew the one flat splay tick");

var scannedC1 = scanProfileEntities(docC);
eqs(countByTag(scannedC1, "ProfileCeilingRun", "C.1"), 1,
    "exactly one ceiling run tagged C.1 after the first draw");
eqs(countByTag(scannedC1, "ProfileSplay", "C2.1"), 1,
    "the flat splay got its own tick, tagged with the splay's own name " +
    "(not folded into the ceiling/floor run, and not drawn a second " +
    "time as a ray out to the wall -- see the acceptance criteria)");
for (var fsi = 0; fsi < scannedC1.length; fsi++) {
    if (scannedC1[fsi].tags.ProfileSplay === "C2.1") {
        eqs(scannedC1[fsi].tags.ProfileRun, "C",
            "the flat tick also carries ProfileRun");
    }
}

// property 3, over THIS fixture: fixture 1's own sweep never produces
// a wall run at all, so it cannot see a ceiling/floor polyline missing
// ProfileRun -- only this fixture's ceiling/floor/flat entities can.
var missingRunC = 0;
for (var mci = 0; mci < scannedC1.length; mci++) {
    if (scannedC1[mci].tags.ProfileRun === undefined) { missingRunC++; }
}
eqs(missingRunC, 0,
    "every Profile*-tagged entity in the wall-run fixture also carries " +
    "ProfileRun (" + missingRunC + " of " + scannedC1.length +
    " did not)");

// property 2 (Task 6's whole payload): the ceiling/floor/flat layer
// split is otherwise unasserted anywhere in this file -- drawing every
// ceiling run onto CsLayers.PROFILE_FLOOR instead would leave every
// count and tag assertion above green.
var ceilingEnt = null, floorEnt = null, flatEnt = null;
for (var lci = 0; lci < scannedC1.length; lci++) {
    if (scannedC1[lci].tags.ProfileCeilingRun === "C.1") { ceilingEnt = scannedC1[lci]; }
    if (scannedC1[lci].tags.ProfileFloorRun === "C.1") { floorEnt = scannedC1[lci]; }
    if (scannedC1[lci].tags.ProfileSplay === "C2.1") { flatEnt = scannedC1[lci]; }
}
ok(ceilingEnt !== null && floorEnt !== null && flatEnt !== null,
    "sanity: found the ceiling run, floor run, and flat tick");
if (ceilingEnt !== null) {
    eqs(ceilingEnt.layer, CsLayers.PROFILE_CEILING,
        "the ceiling run lands on CTRL-PROFILE-CEILING");
}
if (floorEnt !== null) {
    eqs(floorEnt.layer, CsLayers.PROFILE_FLOOR,
        "the floor run lands on CTRL-PROFILE-FLOOR, not the ceiling's " +
        "layer -- the whole point of Task 6's layer split");
}
if (flatEnt !== null) {
    eqs(flatEnt.layer, CsLayers.SPLAYS,
        "the flat splay tick lands on CTRL-SPLAYS");
    // minor: the tick's own length. half = CsDraw.TEXT_HEIGHT, drawn
    // from (f.x, f.y-half) to (f.x, f.y+half), so its length is
    // exactly 2 * TEXT_HEIGHT regardless of where f itself sits.
    if (typeof flatEnt.entity.getStartPoint === "function" &&
            typeof flatEnt.entity.getEndPoint === "function") {
        var fp1 = flatEnt.entity.getStartPoint();
        var fp2 = flatEnt.entity.getEndPoint();
        var flatLen = Math.sqrt(
            (fp2.x - fp1.x) * (fp2.x - fp1.x) +
            (fp2.y - fp1.y) * (fp2.y - fp1.y));
        near(flatLen, CsDraw.TEXT_HEIGHT * 2.0, 1e-9,
            "the flat tick's own length is exactly 2 * TEXT_HEIGHT");
    }
}

var oldCeilingId = null;
for (var ci = 0; ci < scannedC1.length; ci++) {
    if (scannedC1[ci].tags.ProfileCeilingRun === "C.1") {
        oldCeilingId = scannedC1[ci].id;
    }
}
ok(oldCeilingId !== null, "sanity: found the ceiling run's id");

// the user turns CTRL-PROFILE-CEILING off by hand -- the exact
// low-level toggle CsLayers.withLayerOn itself uses, applied directly
// here so this test does not depend on the function under test to set
// up its own precondition.
var ceilingLayer = docC.queryLayer(CsLayers.PROFILE_CEILING);
ok(!isNull(ceilingLayer), "sanity: CTRL-PROFILE-CEILING exists");
ceilingLayer.setOff(true);
var offOp = new RModifyObjectsOperation();
offOp.addObject(ceilingLayer, false);
diC.applyOperation(offOp);
ok(docC.queryLayer(CsLayers.PROFILE_CEILING).isOff(),
    "sanity: CTRL-PROFILE-CEILING is now off");

CsProfileDraw.render(docC, diC, profileC, {});

// A deleted entity's id still answers queryEntity() in this bridge (it
// comes back as an UNDONE wrapper, not null -- confirmed by hand
// against CsBind.addedEntityIds' own isUndone() check, which exists for
// exactly this reason); isUndone() is the real signal, not isNull().
var oldCeilingAfter = docC.queryEntity(oldCeilingId);
ok(!isNull(oldCeilingAfter) &&
    typeof oldCeilingAfter.isUndone === "function" &&
    oldCeilingAfter.isUndone(),
    "erase() removed the OLD ceiling run even though its layer was off");
var scannedC2 = scanProfileEntities(docC);
eqs(countByTag(scannedC2, "ProfileCeilingRun", "C.1"), 1,
    "render() added exactly ONE new ceiling run even though its layer " +
    "was off -- not zero (silently dropped) and not two (doubled)");
eqs(countByTag(scannedC2, "ProfileFloorRun", "C.1"), 1,
    "the floor run (same off-layer situation would not apply to it, " +
    "but a shared code path bug could still double it) is also singular");
eqs(countByTag(scannedC2, "ProfileSplay", "C2.1"), 1,
    "the flat splay tick is singular too, not doubled by the redraw");

ok(docC.queryLayer(CsLayers.PROFILE_CEILING).isOff(),
    "CsLayers.withLayerOn restored the user's own off choice afterward " +
    "-- the redraw did not leave their layer visible");

// =======================================================================
// 2b. THE PROMOTED-LINE CASE. A cartographer who likes a generated
//    ceiling run does not retrace it by hand -- they change ITS LAYER
//    from CTRL-PROFILE-CEILING to the plain PROFILE-CEILING tracing
//    layer and keep it. XDATA is per-entity and survives a layer
//    change, so the promoted line still carries ProfileCeilingRun/
//    ProfileRun afterward. erase()'s ORIGINAL tag-only scan destroyed
//    it on the very next redraw -- this is the review finding that
//    made erase() require BOTH tag AND layer membership; this is the
//    test that proves the fix actually holds.
// =======================================================================

var promoted = null;
for (var pci = 0; pci < scannedC2.length; pci++) {
    if (scannedC2[pci].tags.ProfileCeilingRun === "C.1") { promoted = scannedC2[pci]; }
}
ok(promoted !== null, "sanity: found the current ceiling run to promote");
if (promoted !== null) {
    var promotedId = promoted.id;
    var promotedEnt = docC.queryEntity(promotedId);
    // The plain PROFILE-CEILING tracing layer has never been created
    // in this fixture's document (nothing traced on it yet) -- ensure
    // it first, or getLayerId() below returns the default "0" layer's
    // id instead of failing loudly.
    CsLayers.ensure(docC, diC, "PROFILE-CEILING");
    // CTRL-PROFILE-CEILING is still off from section 2 above -- turn it
    // back on first, the ordinary way a person would before touching
    // anything on it, so this is a layer CHANGE, not another off-layer
    // scenario layered on top of the one already covered.
    CsLayers.withLayerOn(docC, diC, CsLayers.PROFILE_CEILING, function() {
        var promoteOp = new RModifyObjectsOperation();
        promotedEnt.setLayerId(docC.getLayerId("PROFILE-CEILING"));
        promoteOp.addObject(promotedEnt, false);
        diC.applyOperation(promoteOp);
    });
    ok(docC.getLayerName(docC.queryEntity(promotedId).getLayerId()) ===
        "PROFILE-CEILING",
        "sanity: the ceiling run really did move to the plain tracing " +
        "layer");
    ok(CsTags.get(docC.queryEntity(promotedId), "ProfileCeilingRun") === "C.1",
        "sanity: XDATA survived the layer change -- the promoted line " +
        "still carries its own tag");

    CsProfileDraw.render(docC, diC, profileC, {});

    var promotedAfter = docC.queryEntity(promotedId);
    ok(!isNull(promotedAfter) &&
        !(typeof promotedAfter.isUndone === "function" &&
            promotedAfter.isUndone()),
        "THE PROMOTED LINE SURVIVED REGENERATION");
    if (!isNull(promotedAfter)) {
        eqs(docC.getLayerName(promotedAfter.getLayerId()), "PROFILE-CEILING",
            "the promoted line was not swept back onto CTRL-PROFILE-CEILING");
    }

    var scannedC3 = scanProfileEntities(docC);
    eqs(countByTag(scannedC3, "ProfileCeilingRun", "C.1"), 2,
        "TWO entities now carry ProfileCeilingRun=C.1: the promoted " +
        "line (kept, on the tracing layer) and a fresh one render() " +
        "drew beside it (on CTRL-PROFILE-CEILING) -- not one (the " +
        "promoted line eaten) and not merged into a single copy");
    var freshOnOwnLayer = 0;
    for (var pcj = 0; pcj < scannedC3.length; pcj++) {
        if (scannedC3[pcj].tags.ProfileCeilingRun === "C.1" &&
                scannedC3[pcj].layer === CsLayers.PROFILE_CEILING) {
            freshOnOwnLayer++;
        }
    }
    eqs(freshOnOwnLayer, 1,
        "exactly one of the two C.1-tagged entities is the fresh copy " +
        "on CTRL-PROFILE-CEILING");
}

destr(diC);

// =======================================================================
// 3. zOffset must actually reach the drawn geometry, not just the
//    caption. Two disconnected, unconnected components anchored to the
//    SAME elevation (two *fix'ed roots, z=0 each) collide -- CsProfile.
//    layout pushes whichever band is placed second down by a gutter
//    (see its own docblock) and records that on band.zOffset. If
//    CsProfileDraw.band's `at()` closure ever stopped adding dz (e.g.
//    reverted to plain `new RVector(x, y)`), every OTHER assertion in
//    this file would still pass -- none of them look at an actual
//    drawn Y coordinate -- so this is tested directly rather than only
//    through CsProfileDraw.labelText's caption wording.
// =======================================================================

var svE = CsModel.newSurvey();
svE.fixed.Q1 = { x: 0, y: 0, z: 0 };
svE.fixed.R1 = { x: 100, y: 0, z: 0 };
svE.shots = [
    shotOf("Q1", "Q2", 10, 0, 0),
    shotOf("R1", "R2", 10, 0, 0)
];
var resolvedE = CsNetwork.resolve(svE, {});
var profileE = CsProfile.build(svE, resolvedE, {});
eqs(profileE.bands.length, 2, "sanity: two disconnected bands");
var bandQ = null, bandR = null;
for (var bei = 0; bei < profileE.bands.length; bei++) {
    if (profileE.bands[bei].key === "Q") { bandQ = profileE.bands[bei]; }
    if (profileE.bands[bei].key === "R") { bandR = profileE.bands[bei]; }
}
ok(bandQ !== null && bandR !== null, "sanity: found both Q and R bands");
if (bandQ !== null && bandR !== null) {
    eqs(bandQ.zOffset, 0.0,
        "sanity: the first-placed band (Q) keeps true elevation");
    ok(bandR.zOffset < -1e-9,
        "sanity: the colliding band (R) got pushed down (zOffset = " +
        bandR.zOffset + ")");

    var docE = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var diE = new RDocumentInterface(docE);
    CsProfileDraw.render(docE, diE, profileE, {});
    var scannedE = scanProfileEntities(docE);

    // Both the station POINT and its text LABEL carry ProfileStation --
    // that is what property 3 (every entity carries its own tag) above
    // already checks -- so this keeps only RS.EntityPoint (the same
    // getType() idiom RebuildSurveyData.js already uses to tell entity
    // kinds apart) to compare the point's own, unadorned position; its
    // label sits TEXT_HEIGHT*1.5 above it on purpose and would throw
    // this comparison off by exactly that much.
    var q1Pos = null, r1Pos = null;
    for (var ei = 0; ei < scannedE.length; ei++) {
        var ent = scannedE[ei].entity;
        if (typeof ent.getType !== "function" ||
                ent.getType() !== RS.EntityPoint) {
            continue;
        }
        if (scannedE[ei].tags.ProfileStation === "Q1") {
            q1Pos = ent.getPosition();
        }
        if (scannedE[ei].tags.ProfileStation === "R1") {
            r1Pos = ent.getPosition();
        }
    }
    if (q1Pos !== null) {
        ok(Math.abs(q1Pos.y - 0.0) < 1e-9,
            "Q1 (zOffset 0) draws at its true elevation, y=0 (got " +
            q1Pos.y + ")");
    }
    if (r1Pos !== null) {
        ok(Math.abs(r1Pos.y - bandR.zOffset) < 1e-9,
            "R1 draws at bandR.zOffset (" + bandR.zOffset +
            "), not at its true elevation 0 (got " + r1Pos.y + ") -- " +
            "PROOF zOffset actually reaches drawn geometry, not just " +
            "the caption");
    }

    // ProfileZOffset itself is only ever asserted ABSENT (fixture 4,
    // zOffset === 0) elsewhere in this file -- the positive case, where
    // a real displacement actually gets tagged and captioned, was
    // unasserted even though bandR already has zOffset = -5 right here.
    var bandRLabel = null;
    for (var eri = 0; eri < scannedE.length; eri++) {
        if (scannedE[eri].tags.ProfileBandLabel === "R") { bandRLabel = scannedE[eri]; }
    }
    ok(bandRLabel !== null, "sanity: found band R's caption");
    if (bandRLabel !== null) {
        eqs(bandRLabel.tags.ProfileZOffset, String(bandR.zOffset),
            "the displaced band's caption is tagged with its own " +
            "zOffset, not merely captioned in prose");
        var expectedRText = CsDraw.caps(CsProfileDraw.labelText(bandR));
        if (typeof bandRLabel.entity.getPlainText === "function") {
            eqs(bandRLabel.entity.getPlainText(), expectedRText,
                "the displaced band's caption reads the real offset " +
                "(e.g. \"R SURVEY -- SHOWN 5.0 BELOW TRUE ELEVATION\")");
        }
    }
    destr(diE);
}

// =======================================================================
// 4. A band that stopped at its own first station: CsProfile.unrollBand
//    never resolved a Z for it at all, so `stations` is empty, `legs`
//    is empty, and `datum` is null (CsProfile.unrollBand: null, never a
//    fabricated 0, is what "no real elevation" looks like). render()
//    must not crash, and the label it draws must not read as if the
//    band existed at elevation 0.
// =======================================================================

var svD = CsModel.newSurvey();
svD.shots = [ shotOf("D1", "D2", 10, 0, 0) ];
// opts.anchor with no z, and D1 absent from survey.fixed, is the one
// documented path to a null resolved Z (CsNetwork.resolve's own
// anchorZUnknown handling) -- survey.fixed's own writers always default
// a missing z to 0.0 themselves, so that route can never reach this
// case (see CsNetwork.resolve's seedFixed comment).
var resolvedD = CsNetwork.resolve(svD, { anchor: { name: "D1", x: 0, y: 0 } });
ok(resolvedD.anchorZUnknown !== null,
    "sanity: this really is the null-anchor-Z path");
ok(resolvedD.stations.D1.z === null, "sanity: D1's resolved Z is null");

var profileD = CsProfile.build(svD, resolvedD, {});
eqs(profileD.bands.length, 1, "sanity: one band");
eqs(profileD.bands[0].stations.length, 0,
    "sanity: the band drew zero stations");
eqs(profileD.bands[0].stopped, "D1", "sanity: stopped at D1");
eqs(profileD.bands[0].stoppedReason, "no-z", "sanity: reason is no-z");
eqs(profileD.bands[0].datum, null,
    "sanity: datum is null, not a fabricated 0, for this band");

var docD = new RDocument(new RMemoryStorage(), createSpatialIndex());
var diD = new RDocumentInterface(docD);
var resD = CsProfileDraw.render(docD, diD, profileD, {});
eqs(resD.bandsDrawn, 1, "the zero-station band still counts as drawn");
eqs(resD.stationsDrawn, 0, "no stations drawn for it");
eqs(resD.legsDrawn, 0, "no legs drawn for it");

var scannedD = scanProfileEntities(docD);
var labelD = null;
for (var di2 = 0; di2 < scannedD.length; di2++) {
    if (scannedD[di2].tags.ProfileBandLabel === "D") { labelD = scannedD[di2]; }
}
ok(labelD !== null, "the band still gets a caption");
if (labelD !== null) {
    // getPlainText, not getText -- CsSheet.textOf's own precedent for
    // reading a text entity's content back in this bridge; getText()
    // is not actually implemented here (confirmed by hand: it comes
    // back undefined on both RPointEntity and RTextEntity alike), so a
    // getText()-based check would silently never run at all rather
    // than fail loudly, exactly the "decoration test" this feature's
    // brief warns against.
    var expectedText = CsDraw.caps(CsProfileDraw.labelText(profileD.bands[0]));
    ok(typeof labelD.entity.getPlainText === "function",
        "sanity: this bridge can read a text entity's content back");
    if (typeof labelD.entity.getPlainText === "function") {
        eqs(labelD.entity.getPlainText(), expectedText,
            "the caption names the real station and reason, not a bare " +
            "or fabricated-elevation label");
    }
    var pos = (typeof labelD.entity.getPosition === "function") ?
        labelD.entity.getPosition() : null;
    if (pos !== null) {
        ok(!isNaN(pos.y) && isFinite(pos.y),
            "the caption's Y is a real, finite number, not NaN (got " +
            pos.y + ")");
    }
    ok(labelD.tags.ProfileZOffset === undefined,
        "a band with no span gets no ProfileZOffset tag (zOffset is " +
        "0 -- CsProfile.layout's own default for a bandless span -- " +
        "not a number worth reporting)");
}

destr(diD);

// =======================================================================
// 5. THE SKETCH MUST MOVE, NOT MERELY SURVIVE -- Task 11. A line snapped
//    exactly onto the A2/A3 station points must follow those stations
//    when a revised shot slides them along the profile.
//
//    WHY EXACT COINCIDENCE, NOT A CEILING-HEIGHT OFFSET: CsProfileBind.
//    stationIndex is built strictly from ProfileStation-tagged POINTS
//    (see its acceptance criterion), not from ceiling/floor run
//    vertices -- CsProfile.bandWallRuns' points carry no station name at
//    all once collected (only `flat` splay ticks do), so there is no
//    tag to recover one from. A sketch traced at ceiling/floor HEIGHT
//    therefore never gets the exact-match binding CsBind's plan-side
//    LRUD tips give a wall snapped to them; it can only ever reach the
//    PROXIMITY fallback (see fixture 5d below), which is a real,
//    deliberate divergence from plan-view parity worth stating plainly
//    rather than leaving implicit. This fixture proves the exact-match
//    path and the mover cleanly, snapping directly onto the two
//    station points themselves.
// =======================================================================

(function() {
    var sv2 = CsModel.newSurvey();
    sv2.shots = [
        shotOf("A1", "A2", 10, 0, 0, 4, 2),
        shotOf("A2", "A3", 10, 0, 0, 4, 2)
    ];
    var res2 = CsNetwork.resolve(sv2, {});
    var built = CsProfile.build(sv2, res2, {});

    var d2 = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var i2 = new RDocumentInterface(d2);
    CsProfileDraw.render(d2, i2, built, {});

    var bandA = built.bands[0];
    var p2 = null, p3 = null;
    for (var i = 0; i < bandA.stations.length; i++) {
        if (bandA.stations[i].name === "A2") { p2 = bandA.stations[i]; }
        if (bandA.stations[i].name === "A3") { p3 = bandA.stations[i]; }
    }
    CsLayers.ensure(d2, i2, "PROFILE-CEILING");
    var op2 = new RAddObjectsOperation();
    var traced = new RLineEntity(d2, new RLineData(
        new RVector(p2.x, p2.y), new RVector(p3.x, p3.y)));
    traced.setLayerId(d2.getLayerId("PROFILE-CEILING"));
    op2.addObject(traced, false);
    i2.applyOperation(op2);
    var tracedId = traced.getId();

    // now the survey changes: the first leg was really 20 ft, so
    // everything downstream slides 10 ft along the profile
    sv2.shots[0].distance = 20;
    var res3 = CsNetwork.resolve(sv2, {});
    var rebuilt = CsProfile.build(sv2, res3, {});
    var counts = CsProfileDraw.render(d2, i2, rebuilt, {});

    var after = d2.queryEntity(tracedId);
    ok(!isNull(after), "the traced line still exists after regeneration");
    if (!isNull(after)) {
        var moved = after.getStartPoint();
        near(moved.x, p2.x + 10, 0.001,
            "THE TRACED LINE MOVED WITH ITS STATIONS (x " + moved.x +
            ", expected " + (p2.x + 10) + ")");
    }
    ok(counts.linework !== undefined && counts.linework.moved >= 1,
        "the move is reported (" + JSON.stringify(counts.linework) + ")");
    destr(i2);
}());

// =======================================================================
// 5b. THE TRAP: the tracing layer is HIDDEN when the revision runs --
//    exactly the workflow that motivated off-layer protection in the
//    first place (hiding the generated ceiling to trace over it on the
//    plain PROFILE-CEILING layer). This build refuses MODIFIES on an
//    off layer as silently as it refuses adds and deletes, and BOTH the
//    claim (tags the sketch) and the move (ent.rotate/scale/move plus
//    op.addObject) are MODIFIES. Without CsRevise.withOffLayersOn around
//    each, the sketch would be silently left behind while the survey
//    moves underneath it -- exactly the bug the user asked this task to
//    fix, reintroduced by the one workflow that needs it most.
// =======================================================================

(function() {
    var sv4 = CsModel.newSurvey();
    sv4.shots = [
        shotOf("A1", "A2", 10, 0, 0, 4, 2),
        shotOf("A2", "A3", 10, 0, 0, 4, 2)
    ];
    var res4 = CsNetwork.resolve(sv4, {});
    var built4 = CsProfile.build(sv4, res4, {});

    var d4 = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var i4 = new RDocumentInterface(d4);
    CsProfileDraw.render(d4, i4, built4, {});

    var bandA4 = built4.bands[0];
    var q2 = null, q3 = null;
    for (var qi = 0; qi < bandA4.stations.length; qi++) {
        if (bandA4.stations[qi].name === "A2") { q2 = bandA4.stations[qi]; }
        if (bandA4.stations[qi].name === "A3") { q3 = bandA4.stations[qi]; }
    }
    CsLayers.ensure(d4, i4, "PROFILE-CEILING");
    var op4 = new RAddObjectsOperation();
    var traced4 = new RLineEntity(d4, new RLineData(
        new RVector(q2.x, q2.y), new RVector(q3.x, q3.y)));
    traced4.setLayerId(d4.getLayerId("PROFILE-CEILING"));
    op4.addObject(traced4, false);
    i4.applyOperation(op4);
    var traced4Id = traced4.getId();

    // the user hides their own tracing layer BEFORE the revision runs --
    // the everyday act of getting a busy sketch out of the way
    var tracingLayer = d4.queryLayer("PROFILE-CEILING");
    ok(!isNull(tracingLayer), "sanity: PROFILE-CEILING exists");
    tracingLayer.setOff(true);
    var offOp4 = new RModifyObjectsOperation();
    offOp4.addObject(tracingLayer, false);
    i4.applyOperation(offOp4);
    ok(d4.queryLayer("PROFILE-CEILING").isOff(),
        "sanity: PROFILE-CEILING is now off");

    sv4.shots[0].distance = 20;
    var res5 = CsNetwork.resolve(sv4, {});
    var rebuilt4 = CsProfile.build(sv4, res5, {});
    var counts4 = CsProfileDraw.render(d4, i4, rebuilt4, {});

    var after4 = d4.queryEntity(traced4Id);
    ok(!isNull(after4),
        "the traced line on the HIDDEN layer still exists after regen");
    if (!isNull(after4)) {
        var moved4 = after4.getStartPoint();
        near(moved4.x, q2.x + 10, 0.001,
            "THE TRACED LINE MOVED EVEN THOUGH ITS LAYER WAS HIDDEN (x " +
            moved4.x + ", expected " + (q2.x + 10) + ")");
    }
    ok(counts4.linework !== undefined && counts4.linework.moved >= 1,
        "the move on a hidden layer is reported (" +
        JSON.stringify(counts4.linework) + ")");
    ok(d4.queryLayer("PROFILE-CEILING").isOff(),
        "the user's own off choice for PROFILE-CEILING was restored " +
        "afterward");
    destr(i4);
}());

// =======================================================================
// 5c. AN UNBOUND SKETCH -- drawn nowhere near any station -- is left
//    exactly where it is, and named in counts.linework.unmoved rather
//    than silently dropped or silently moved on a guess.
// =======================================================================

(function() {
    var sv6 = CsModel.newSurvey();
    sv6.shots = [
        shotOf("A1", "A2", 10, 0, 0, 4, 2),
        shotOf("A2", "A3", 10, 0, 0, 4, 2)
    ];
    var res6 = CsNetwork.resolve(sv6, {});
    var built6 = CsProfile.build(sv6, res6, {});

    var d6 = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var i6 = new RDocumentInterface(d6);
    CsProfileDraw.render(d6, i6, built6, {});

    // far from every station (the band spans x in [0, 20]) and far
    // outside marginFor's proximity box, so this cannot bind by either
    // exact coincidence or proximity
    CsLayers.ensure(d6, i6, "PROFILE-CEILING");
    var op6 = new RAddObjectsOperation();
    var stray = new RLineEntity(d6, new RLineData(
        new RVector(500, 500), new RVector(520, 500)));
    stray.setLayerId(d6.getLayerId("PROFILE-CEILING"));
    op6.addObject(stray, false);
    i6.applyOperation(op6);
    var strayId = stray.getId();

    sv6.shots[0].distance = 20;
    var res7 = CsNetwork.resolve(sv6, {});
    var rebuilt6 = CsProfile.build(sv6, res7, {});
    var counts6 = CsProfileDraw.render(d6, i6, rebuilt6, {});

    var strayAfter = d6.queryEntity(strayId);
    ok(!isNull(strayAfter), "the stray sketch still exists after regen");
    if (!isNull(strayAfter)) {
        var strayPos = strayAfter.getStartPoint();
        near(strayPos.x, 500, 1e-9,
            "THE UNBOUND SKETCH DID NOT MOVE (x " + strayPos.x + ")");
        near(strayPos.y, 500, 1e-9,
            "THE UNBOUND SKETCH DID NOT MOVE (y " + strayPos.y + ")");
    }
    ok(counts6.claimed !== undefined && counts6.claimed.skipped >= 1,
        "claim() names the stray sketch as skipped, not silently " +
        "dropped (" + JSON.stringify(counts6.claimed) + ")");
    ok(counts6.linework !== undefined &&
        counts6.linework.unmoved.length >= 1,
        "the unbound sketch is NAMED in counts.linework.unmoved -- " +
        "claim()'s own skippedLabels folded in, since an untagged " +
        "entity is invisible to moveLinework's own scan by design and " +
        "would otherwise be reported nowhere at all (" +
        JSON.stringify(counts6.linework) + ")");
    destr(i6);
}());

// =======================================================================
// 5d. THE PROXIMITY FALLBACK, exercised for real: a sketch traced NEAR
//    (not exactly onto) a run of stations that all shift by the same
//    amount. Six stations, corrected leg at the very start (A1->A2) --
//    A2 through A6 all slide by the same +10, so a sketch bound to
//    several of them by proximity is still one rigid move, and the
//    fallback this module falls back to is proven to actually work,
//    not just to exist unexercised.
// =======================================================================

(function() {
    var sv7 = CsModel.newSurvey();
    sv7.shots = [
        shotOf("A1", "A2", 10, 0, 0, 4, 2),
        shotOf("A2", "A3", 10, 0, 0, 4, 2),
        shotOf("A3", "A4", 10, 0, 0, 4, 2),
        shotOf("A4", "A5", 10, 0, 0, 4, 2),
        shotOf("A5", "A6", 10, 0, 0, 4, 2)
    ];
    var res8 = CsNetwork.resolve(sv7, {});
    var built7 = CsProfile.build(sv7, res8, {});

    var d7 = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var i7 = new RDocumentInterface(d7);
    CsProfileDraw.render(d7, i7, built7, {});

    var bandA7 = built7.bands[0];
    var p4 = null, p5 = null;
    for (var pi = 0; pi < bandA7.stations.length; pi++) {
        if (bandA7.stations[pi].name === "A4") { p4 = bandA7.stations[pi]; }
        if (bandA7.stations[pi].name === "A5") { p5 = bandA7.stations[pi]; }
    }
    // 1 unit above the centerline: near A4/A5, inside marginFor's
    // proximity box, but NOT exact coincidence -- stationsForPoints
    // must fail here for the box fallback to be the path under test
    CsLayers.ensure(d7, i7, "PROFILE-CEILING");
    var op7 = new RAddObjectsOperation();
    var traced7 = new RLineEntity(d7, new RLineData(
        new RVector(p4.x, p4.y + 1), new RVector(p5.x, p5.y + 1)));
    traced7.setLayerId(d7.getLayerId("PROFILE-CEILING"));
    op7.addObject(traced7, false);
    i7.applyOperation(op7);
    var traced7Id = traced7.getId();

    sv7.shots[0].distance = 20;
    var res9 = CsNetwork.resolve(sv7, {});
    var rebuilt7 = CsProfile.build(sv7, res9, {});
    var counts7 = CsProfileDraw.render(d7, i7, rebuilt7, {});

    var after7 = d7.queryEntity(traced7Id);
    ok(!isNull(after7),
        "the proximity-bound sketch still exists after regeneration");
    if (!isNull(after7)) {
        var moved7 = after7.getStartPoint();
        near(moved7.x, p4.x + 10, 0.001,
            "THE PROXIMITY-BOUND SKETCH MOVED WITH ITS NEARBY STATIONS " +
            "(x " + moved7.x + ", expected " + (p4.x + 10) + ")");
    }
    ok(counts7.linework !== undefined && counts7.linework.moved >= 1,
        "the proximity-fallback move is reported (" +
        JSON.stringify(counts7.linework) + ")");
    destr(i7);
}());

// =======================================================================
// 5e. RUN-QUALIFICATION MATTERS FOR REAL, not just in the abstract: a
//    spur run B tying off A2 gives "A2" TWO drawn positions in the SAME
//    document -- its own place in band A, and band B's own X-origin
//    tie-in copy. Two sketches, each snapped exactly onto stations in
//    its OWN band, must each follow ONLY its own band's revision. If
//    CsProfileBind.key ever collapsed to the bare station name, the
//    two "A2" positions would collide in the before/after maps
//    (CsProfileBind.positions' "first writer wins" and
//    CsProfileDraw.positionsOf's later-band-overwrites-earlier would
//    almost certainly pick DIFFERENT survivors), corrupting whichever
//    sketch depends on the entry that lost -- proven here rather than
//    only argued, by reviving the everyday case: a distance correction
//    upstream in run A must not so much as twitch a spur tied off it.
// =======================================================================

(function() {
    var sv8 = CsModel.newSurvey();
    sv8.shots = [
        shotOf("A1", "A2", 10, 0, 0, 4, 2),
        shotOf("A2", "A3", 10, 0, 0, 4, 2),
        // a real elevation change on the tie leg, so band B's gutter
        // offset keeps its drawn "A2" tie-copy from landing exactly on
        // top of band A's own A1 (both would otherwise sit at (0,0))
        shotOf("A2", "B1", 10, 90, -30, 4, 2),
        shotOf("B1", "B2", 10, 0, 0, 4, 2)
    ];
    var res10 = CsNetwork.resolve(sv8, {});
    var built8 = CsProfile.build(sv8, res10, {});
    eqs(built8.bands.length, 2, "sanity: two bands, A and the B spur");

    var d8 = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var i8 = new RDocumentInterface(d8);
    CsProfileDraw.render(d8, i8, built8, {});

    var idx8 = CsProfileBind.stationIndex(d8);
    var drawn = {};
    for (var xi = 0; xi < idx8.length; xi++) { drawn[idx8[xi].name] = idx8[xi]; }
    ok(drawn["A/A2"] !== undefined && drawn["B/A2"] !== undefined,
        "sanity: \"A2\" is drawn TWICE under two DIFFERENT qualified keys");
    ok(Math.abs(drawn["A/A2"].x - drawn["B/A2"].x) > 1 ||
        Math.abs(drawn["A/A2"].y - drawn["B/A2"].y) > 1,
        "sanity: the two A2 copies sit at genuinely different drawn " +
        "positions (A/A2=" + JSON.stringify(drawn["A/A2"]) + ", B/A2=" +
        JSON.stringify(drawn["B/A2"]) + ")");

    // sketch bound entirely within band A: A2 -> A3, exact coincidence
    CsLayers.ensure(d8, i8, "PROFILE-CEILING");
    var opA = new RAddObjectsOperation();
    var sketchA = new RLineEntity(d8, new RLineData(
        new RVector(drawn["A/A2"].x, drawn["A/A2"].y),
        new RVector(drawn["A/A3"].x, drawn["A/A3"].y)));
    sketchA.setLayerId(d8.getLayerId("PROFILE-CEILING"));
    opA.addObject(sketchA, false);
    i8.applyOperation(opA);
    var sketchAId = sketchA.getId();

    // sketch bound entirely within band B: its OWN A2 tie-copy -> B1,
    // exact coincidence -- must never be confused with band A's A2
    var opB = new RAddObjectsOperation();
    var sketchB = new RLineEntity(d8, new RLineData(
        new RVector(drawn["B/A2"].x, drawn["B/A2"].y),
        new RVector(drawn["B/B1"].x, drawn["B/B1"].y)));
    sketchB.setLayerId(d8.getLayerId("PROFILE-CEILING"));
    opB.addObject(sketchB, false);
    i8.applyOperation(opB);
    var sketchBId = sketchB.getId();

    var expectA3x = drawn["A/A3"].x, expectB1x = drawn["B/B1"].x,
        expectB1y = drawn["B/B1"].y;

    // revise ONLY the A1->A2 leg -- band B ties off A2 but restarts its
    // own X at 0 regardless, so nothing about band B should move at all
    sv8.shots[0].distance = 20;
    var res11 = CsNetwork.resolve(sv8, {});
    var rebuilt8 = CsProfile.build(sv8, res11, {});
    var counts8 = CsProfileDraw.render(d8, i8, rebuilt8, {});

    eqs(counts8.claimed.tagged, 2, "both sketches got claimed");
    eqs(counts8.linework.moved, 2,
        "both sketches' moves are reported (" +
        JSON.stringify(counts8.linework) + ")");

    var sketchAAfter = d8.queryEntity(sketchAId);
    var sketchBAfter = d8.queryEntity(sketchBId);
    ok(!isNull(sketchAAfter) && !isNull(sketchBAfter),
        "sanity: both sketches survived regeneration");
    if (!isNull(sketchAAfter)) {
        near(sketchAAfter.getEndPoint().x, expectA3x + 10, 0.001,
            "BAND A'S SKETCH FOLLOWED BAND A'S OWN REVISION (x " +
            sketchAAfter.getEndPoint().x + ", expected " +
            (expectA3x + 10) + ")");
    }
    if (!isNull(sketchBAfter)) {
        // band B is UNTOUCHED by a correction made entirely upstream in
        // band A -- this is the assertion a bare, unqualified "A2" key
        // would corrupt (see this fixture's own banner)
        near(sketchBAfter.getEndPoint().x, expectB1x, 0.001,
            "BAND B'S SKETCH DID NOT MOVE -- UNAFFECTED BY BAND A'S " +
            "REVISION (x " + sketchBAfter.getEndPoint().x +
            ", expected unchanged " + expectB1x + ")");
        near(sketchBAfter.getEndPoint().y, expectB1y, 0.001,
            "BAND B'S SKETCH Y IS ALSO UNCHANGED (y " +
            sketchBAfter.getEndPoint().y + ", expected " + expectB1y + ")");
    }
    destr(i8);
}());

// =======================================================================
// 5f. A SKETCH SPANNING TWO BANDS -- documented behaviour, not a defect.
//    CsRevise.similarityFit over exactly TWO points always finds a
//    zero-residual fit (two points fully determine a similarity
//    transform), so moveLinework accepts it even when the two points
//    come from bands that move independently of one another -- there is
//    no THIRD point here to expose the inconsistency the way fixture 5's
//    residual check would catch it for three or more. The result is a
//    real move, reported as such, that can reshape (rotate/scale) the
//    sketch to force both endpoints onto their respective targets. This
//    is CsRevise.moveLinework's own documented tradeoff for a 2-point
//    fit ("the pair IS the definition of the rigid piece"), inherited
//    unchanged per the user's explicit decision to reuse it as-is --
//    profile drawings just reach it more often, because a station name
//    recurring across bands is normal here, not an edge case.
// =======================================================================

(function() {
    var sv9 = CsModel.newSurvey();
    sv9.shots = [
        shotOf("A1", "A2", 10, 0, 0, 4, 2),
        shotOf("A2", "A3", 10, 0, 0, 4, 2),
        shotOf("A2", "B1", 10, 90, -30, 4, 2),
        shotOf("B1", "B2", 10, 0, 0, 4, 2)
    ];
    var res12 = CsNetwork.resolve(sv9, {});
    var built9 = CsProfile.build(sv9, res12, {});

    var d9 = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var i9 = new RDocumentInterface(d9);
    CsProfileDraw.render(d9, i9, built9, {});

    var idx9 = CsProfileBind.stationIndex(d9);
    var drawn9 = {};
    for (var yi = 0; yi < idx9.length; yi++) { drawn9[idx9[yi].name] = idx9[yi]; }

    CsLayers.ensure(d9, i9, "PROFILE-CEILING");
    var opC = new RAddObjectsOperation();
    var cross = new RLineEntity(d9, new RLineData(
        new RVector(drawn9["A/A2"].x, drawn9["A/A2"].y),
        new RVector(drawn9["B/B1"].x, drawn9["B/B1"].y)));
    cross.setLayerId(d9.getLayerId("PROFILE-CEILING"));
    opC.addObject(cross, false);
    i9.applyOperation(opC);
    var crossId = cross.getId();

    sv9.shots[0].distance = 20;
    var res13 = CsNetwork.resolve(sv9, {});
    var rebuilt9 = CsProfile.build(sv9, res13, {});
    var counts9 = CsProfileDraw.render(d9, i9, rebuilt9, {});

    eqs(CsBind.decodeStations(CsTags.get(d9.queryEntity(crossId),
        CsBind.STATIONS_TAG)).join(","), "A/A2,B/B1",
        "the cross-band sketch is bound to BOTH stations, one per band");
    ok(counts9.linework !== undefined && counts9.linework.moved === 1,
        "a 2-point cross-band fit is accepted (residual is always 0 " +
        "for exactly two points), not refused -- documented behaviour, " +
        "inherited from CsRevise.moveLinework unchanged (" +
        JSON.stringify(counts9.linework) + ")");
    var crossAfter = d9.queryEntity(crossId);
    ok(!isNull(crossAfter), "sanity: the cross-band sketch still exists");
    if (!isNull(crossAfter)) {
        near(crossAfter.getStartPoint().x, drawn9["A/A2"].x + 10, 0.001,
            "one endpoint lands on A2's own new position");
        near(crossAfter.getEndPoint().x, drawn9["B/B1"].x, 0.001,
            "the other endpoint stays on B1's unchanged position -- the " +
            "line was reshaped to hit both, not translated as a whole");
    }
    destr(i9);
}());

// =======================================================================
// Report.
// =======================================================================

if (failures.length === 0) {
    print("### PROFILE DRAW OK");
} else {
    for (var i2 = 0; i2 < failures.length; i2++) {
        print("FAIL  " + failures[i2]);
    }
    print("### PROFILE DRAW FAIL");
}
