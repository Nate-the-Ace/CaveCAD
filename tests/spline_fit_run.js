// spline_fit_run.js -- our own spline maths: a curve that PASSES
// THROUGH the traced points, and the measurement that says what it is
// worth.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/spline_fit_run.js "$PWD"
//
// WHY THIS SUITE EXISTS. fitSpline builds an APPROXIMATING cubic: the
// sampled points are control points, so the curve sits inside them and
// every traced bend is pulled in. QCAD's own cure -- fit-point splines
// -- is a Pro feature this fork lacks, and reaching for it cost a
// release: appendFitPoint left getControlPoints() empty, the bounding
// box was 0x0, the DXF exporter wrote no SPLINE record at all so a
// trace VANISHED on save, and isValid() still answered true, which is
// why nothing caught it.
//
// So the assertions here are chosen to be the ones that WOULD have
// caught that: the curve is measured against its own input points, and
// the entity is written to DXF and read back before it is believed.
// isValid() is never asked.

if (typeof createSpatialIndex === "undefined") {
    createSpatialIndex = function() {
        return new RSpatialIndexNavel();
    };
}

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

include("scripts/EAction.js");
include("scripts/simple.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");

// THE NATIVE isNull LIES in this engine: it does not understand the
// build's proxy wrapper, so it answers "not null" for a missing object.
// library.js's own algorithm does check, so install it unconditionally
// -- a shim guarded by "if undefined" never fires, because the broken
// native one is already there. (Measured 2026-09-12.)
isNull = function(v) {
    if (v === undefined || v === null) {
        return true;
    }
    try {
        if (typeof v.isNull === "function" && v.isNull()) {
            return true;
        }
    } catch (e) {
    }
    try {
        if (typeof isNullWrapper === "function" && isNullWrapper(v)) {
            return true;
        }
    } catch (e2) {
    }
    return false;
};

var failures = [];
function ok(cond, what) {
    if (!cond) { failures.push(what); }
}
function near(a, b, tol, what) {
    ok(Math.abs(a - b) <= tol, what + " (expected " + b + " +/- " + tol +
        ", got " + a + ")");
}

// ---- fixtures ---------------------------------------------------------

/** A wiggly open path with one sharp corner in it, the shape a traced
 *  wall actually has. */
function tracedPath() {
    var pts = [];
    var i;
    for (i = 0; i <= 40; i++) {
        var t = i / 40;
        pts.push({ x: t * 40, y: 6 * Math.sin(t * 5) });
    }
    // a corner: straight out and straight back
    for (i = 1; i <= 8; i++) {
        pts.push({ x: 40 + i * 0.8, y: pts[pts.length - 1].y + i * 2.2 });
    }
    return pts;
}

/** Distance from p to the polyline through pts. */
function distToPath(p, pts) {
    var best = 1e18;
    for (var i = 1; i < pts.length; i++) {
        var a = pts[i - 1], b = pts[i];
        var vx = b.x - a.x, vy = b.y - a.y;
        var len2 = vx * vx + vy * vy;
        var t = len2 === 0 ? 0 : ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
        if (t < 0) { t = 0; }
        if (t > 1) { t = 1; }
        var dx = p.x - (a.x + t * vx), dy = p.y - (a.y + t * vy);
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < best) { best = d; }
    }
    return best;
}

// ---- 1. the curve passes through its points --------------------------

var path = tracedPath();
var fit = CsTrace.interpolationFit(path);
ok(fit !== null, "interpolationFit: a traced path fits");

if (fit !== null) {
    var worst = 0;
    for (var k = 0; k < path.length; k++) {
        var got = CsTrace.evalCurve(fit, fit.params[k]);
        var d = Math.sqrt((got.x - path[k].x) * (got.x - path[k].x) +
            (got.y - path[k].y) * (got.y - path[k].y));
        if (d > worst) { worst = d; }
    }
    near(worst, 0, 1e-6,
        "interpolation: the curve passes through EVERY sampled point");

    eqsCount = fit.ctrl.length;
    ok(fit.ctrl.length === path.length,
        "interpolation: one control point per sample, no inflation " +
        "(got " + fit.ctrl.length + " for " + path.length + ")");
}

// ---- 2. it does not wander off between them (overshoot) --------------

if (fit !== null) {
    var far = 0;
    for (var s = 0; s <= 2000; s++) {
        var uu = s / 2000;
        var q = CsTrace.evalCurve(fit, uu);
        var dd = distToPath(q, path);
        if (dd > far) { far = dd; }
    }
    ok(far < 1.0, "interpolation: the curve stays within a foot of the " +
        "traced path everywhere, not just at the samples (worst " +
        far.toFixed(3) + ")");
}

// ---- 3. the approximating fit is measurably worse --------------------

var approxWorst = 0;
var ap = { degree: 3 };
(function () {
    // the existing fit, evaluated the same way: its points ARE the
    // control points, with the same knot rule fitSpline's engine uses
    var u = CsTrace.centripetalParams(path);
    var U = CsTrace.averagedKnots(u, 3);
    var f2 = { ctrl: path, knots: U, params: u, degree: 3 };
    for (var k2 = 0; k2 < path.length; k2++) {
        var g = CsTrace.evalCurve(f2, u[k2]);
        var d2 = Math.sqrt((g.x - path[k2].x) * (g.x - path[k2].x) +
            (g.y - path[k2].y) * (g.y - path[k2].y));
        if (d2 > approxWorst) { approxWorst = d2; }
    }
})();
ok(approxWorst > 0.05,
    "the approximating fit really does miss its points -- this is the " +
    "gap being closed (worst " + approxWorst.toFixed(3) + " units)");

// ---- 4. degenerate input degrades, never throws ----------------------

ok(CsTrace.interpolationFit(null) === null, "no points: null, not a throw");
ok(CsTrace.interpolationFit([]) === null, "empty: null");
ok(CsTrace.interpolationFit([{x:0,y:0},{x:1,y:1}]) === null,
    "two points: null (a cubic needs four)");
var same = [{x:5,y:5},{x:5,y:5},{x:5,y:5},{x:5,y:5},{x:5,y:5}];
ok(CsTrace.interpolationFit(same) === null,
    "a zero-length path: null rather than a NaN curve");
var line = [];
for (var L = 0; L < 12; L++) { line.push({ x: L * 2, y: 0 }); }
var lineFit = CsTrace.interpolationFit(line);
ok(lineFit !== null, "collinear points still fit");
if (lineFit !== null) {
    var bad = 0;
    for (var c2 = 0; c2 < lineFit.ctrl.length; c2++) {
        if (isNaN(lineFit.ctrl[c2].x) || isNaN(lineFit.ctrl[c2].y)) { bad++; }
    }
    eqs0(bad, "collinear: no NaN control point");
}
function eqs0(v, what) { ok(v === 0, what + " (got " + v + ")"); }

// ---- 5. determinism ---------------------------------------------------

var again = CsTrace.interpolationFit(path);
var drift = 0;
if (fit !== null && again !== null) {
    for (var q2 = 0; q2 < fit.ctrl.length; q2++) {
        drift += Math.abs(fit.ctrl[q2].x - again.ctrl[q2].x) +
            Math.abs(fit.ctrl[q2].y - again.ctrl[q2].y);
    }
}
near(drift, 0, 1e-12, "the same points give the same control points");

// ---- 6. the ENTITY survives a DXF round trip -------------------------
//
// NOT isValid(): that answered true for the vanished fit-point spline.
// Bounding box and a real round trip, or it is not believed.

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
var ent = CsTrace.interpolatingSpline(doc, path);
ok(!isNull(ent), "interpolatingSpline: an entity comes back");

if (!isNull(ent)) {
    var op = new RAddObjectsOperation();
    op.addObject(ent, false);
    di.applyOperation(op);

    var bb = ent.getBoundingBox();
    ok(bb.getWidth() > 1 && bb.getHeight() > 1,
        "the spline has a real bounding box, not the 0x0 of the " +
        "release this suite exists to remember");

    var tmp = repoRoot + "/tests/.spline_roundtrip.dxf";
    var saved = false;
    try {
        saved = di.exportFile(tmp, "DXF 2013");
    } catch (eExp) {
        saved = false;
    }
    ok(saved === true, "the drawing exports");

    var back = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var bdi = new RDocumentInterface(back);
    var readOk = false;
    try {
        readOk = (bdi.importFile(tmp, "") === RDocumentInterface.IoErrorNoError);
    } catch (eImp) {
        readOk = false;
    }
    ok(readOk === true, "and reads back");

    var ids = back.queryAllEntities(false, true);
    var splines = 0, ctrlBack = 0;
    for (var b = 0; b < ids.length; b++) {
        var e = back.queryEntity(ids[b]);
        if (e.getType() === RS.EntitySpline) {
            splines++;
            try {
                ctrlBack = e.getData().castToShape().getControlPoints().length;
            } catch (eCp) {
            }
        }
    }
    ok(splines === 1, "exactly one SPLINE record survives the round trip " +
        "(got " + splines + ") -- the vanished-on-save failure would " +
        "show here as zero");
    ok(ctrlBack === path.length,
        "and it still carries every control point (got " + ctrlBack + ")");
    try {
        new QFile(tmp).remove();
    } catch (eRm) {
    }
}

// ---- report -----------------------------------------------------------

if (failures.length > 0) {
    print("### SPLINE FIT FAIL " + failures.length);
    for (var f = 0; f < failures.length; f++) {
        print("  FAIL: " + failures[f]);
    }
    QCoreApplication.exit(1);
} else {
    print("### SPLINE FIT OK");
    QCoreApplication.exit(0);
}
