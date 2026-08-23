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
    "CsProfile", "CsProfileDraw"];
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

function shotOf(from, to, d, az, inc, u, dn) {
    var s = CsModel.newShot();
    s.from = from; s.to = to; s.distance = d; s.azimuth = az;
    s.inclination = inc || 0;
    s.up = (u === undefined) ? null : u;
    s.down = (dn === undefined) ? null : dn;
    return s;
}

/** Every Profile*-tagged entity in the doc, as {id, tags: {key: value}}. */
function scanProfileEntities(doc) {
    var out = [];
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) { continue; }
        var tags = {};
        var any = false;
        for (var t = 0; t < CsProfileDraw.TAGS.length; t++) {
            var v = CsTags.get(e, CsProfileDraw.TAGS[t]);
            if (v !== null && v !== "") {
                tags[CsProfileDraw.TAGS[t]] = v;
                any = true;
            }
        }
        if (any) {
            out.push({ id: ids[i], entity: e, tags: tags });
        }
    }
    return out;
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
