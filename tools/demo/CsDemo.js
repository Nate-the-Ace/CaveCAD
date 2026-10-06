// CsDemo.js -- records a scripted run of a panel as a numbered PNG sequence
// plus the exact cursor path and click moments.
//
// The rig saves CLEAN frames and a track.json of where the cursor was in
// each; tools/demo/compose.py draws the real macOS cursor in afterwards.
// (QPainter is wrapper-only in this engine -- no method on it exists.)
//
// DEV-ONLY. It is evaluated into a running CaveCAD through the MCP bridge
// and is never part of the shipped add-on.
//
//   CsDemo.record({ root: dock, outDir: "/tmp/clip", fps: 20,
//     steps: [ { click: { widget: button }, run: function() {...} }, ... ] });
//
// WHY THE CURSOR IS DRAWN, NOT CAPTURED. A widget grab never contains the
// OS cursor, and QCoreApplication.sendEvent crashes this engine, so the
// demo cannot move a real mouse. Instead a step names a TARGET and the
// rig derives the cursor's position from that target's real geometry --
// the same number the action is aimed at -- so the picture cannot drift
// from what ran. A step whose `run` calls a handler directly (button.click)
// is a handler call and not a real mouse event; the clip is honest about
// the cursor, not about the input path.
//
// WHY A SIMULATED CLOCK. Frame n is exactly n / fps seconds into the clip
// however long the grab and save took, so a slow frame never stretches the
// motion in the finished GIF.
//
// STEPS
//   { move:  target, ms }              glide the cursor to a target
//   { click: target, run: fn, ms }     glide, dwell, ripple, call fn
//   { wait:  ms }                      hold still
//   { style: "arrow"|"hand"|"ibeam" }  change the cursor shape
//   { type: "text", set: fn(prefix), per: ms }  type it a character at a time
//   { run: fn }                        do something at this instant
// TARGET  { widget: w, at: [fx, fy] }  fractions of the widget (default centre)
//         { table: t, row: n }         the middle of a table row
//         { table: t, row: n, col: c } the middle of one cell
//         { x: px, y: px }             a point in the root's own coordinates
//         { lazy: fn }                 fn() -> a target, asked when the cursor sets off

CsDemo = {};

CsDemo.RIPPLE_MS = 380;
CsDemo.DWELL_MS = 140;
CsDemo.state = { running: false, done: false, frames: 0, error: "" };

/** A Qt member that this bridge exposes as a property or as a method. */
CsDemo.val = function(o, name) {
    var v = o[name];
    if (typeof v === "function") {
        return v.call(o);
    }
    return v;
};

/** The point a target resolves to, in the root's own coordinates. */
CsDemo.resolve = function(root, target) {
    // a table that is refilled by an earlier step has new cell widgets
    // by the time the cursor gets there: ask for the target then
    if (target.lazy !== undefined) {
        target = target.lazy();
    }
    if (target.x !== undefined) {
        return { x: target.x, y: target.y };
    }
    if (target.table !== undefined) {
        var t = target.table;
        var o = t.mapTo(root, new QPoint(0, 0));
        var fw = 1;
        // a table with its headers showing has them ABOVE and LEFT of the
        // viewport the row and column positions are measured in
        var hh = 0;
        var vw = 0;
        try {
            var hdr = t.horizontalHeader();
            if (hdr.visible === true) {
                hh = CsDemo.val(hdr, "height");
            }
            var vdr = t.verticalHeader();
            if (vdr.visible === true) {
                vw = CsDemo.val(vdr, "width");
            }
        } catch (eHdr) {
        }
        var ry = t.rowViewportPosition(target.row) +
            t.rowHeight(target.row) / 2;
        var fx = target.at ? target.at[0] : 0.3;
        var x;
        if (target.col !== undefined) {
            x = t.columnViewportPosition(target.col) +
                t.columnWidth(target.col) * (target.at ? target.at[0] : 0.5);
        } else {
            x = CsDemo.val(t, "width") * fx;
        }
        return { x: o.x() + fw + vw + x, y: o.y() + fw + hh + ry };
    }
    var w = target.widget;
    var p = w.mapTo(root, new QPoint(0, 0));
    var f = target.at ? target.at : [0.5, 0.5];
    return { x: p.x() + CsDemo.val(w, "width") * f[0],
        y: p.y() + CsDemo.val(w, "height") * f[1] };
};

CsDemo.ease = function(u) {
    return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
};

/** Turn the step list into a timeline of segments and one-shot actions. */
CsDemo.compile = function(root, steps, start) {
    var t = 0;
    var pos = start;
    var segs = [];
    var acts = [];
    var ripples = [];
    var styleAt = [{ t: 0, name: "arrow" }];
    for (var i = 0; i < steps.length; i++) {
        var s = steps[i];
        if (s.wait !== undefined) {
            t += s.wait;
        } else if (s.style !== undefined) {
            styleAt.push({ t: t, name: s.style });
        } else if (s.type !== undefined) {
            // one character at a time; set(prefix) puts the text where
            // it belongs
            var per = s.per !== undefined ? s.per : 110;
            for (var c = 1; c <= s.type.length; c++) {
                acts.push({ t: t + (c - 1) * per, done: false,
                    fn: (function(text, set) {
                        return function() { set(text); };
                    })(s.type.substring(0, c), s.set) });
            }
            t += s.type.length * per + (s.hold !== undefined ? s.hold : 400);
        } else if (s.run !== undefined && s.click === undefined &&
                s.move === undefined) {
            acts.push({ t: t, fn: s.run, done: false });
        } else {
            var target = s.move !== undefined ? s.move : s.click;
            var ms = s.ms !== undefined ? s.ms : 650;
            // resolved lazily at run time: a list row exists only after
            // an earlier step has filled the list
            segs.push({ t0: t, t1: t + ms, from: null, target: target });
            t += ms;
            if (s.click !== undefined) {
                t += CsDemo.DWELL_MS;
                acts.push({ t: t, fn: s.run || null, done: false });
                ripples.push({ t: t, target: target });
                t += s.hold !== undefined ? s.hold : 260;
            }
        }
    }
    return { segs: segs, acts: acts, ripples: ripples, styles: styleAt,
        total: t + 500, pos: pos };
};

CsDemo.cursorAt = function(root, tl, t) {
    var cur = tl.pos;
    for (var i = 0; i < tl.segs.length; i++) {
        var g = tl.segs[i];
        if (t < g.t0) {
            break;
        }
        if (g.to === undefined) {
            g.from = { x: cur.x, y: cur.y };
            g.to = CsDemo.resolve(root, g.target);
        }
        var u = t >= g.t1 ? 1 : (t - g.t0) / (g.t1 - g.t0);
        var e = CsDemo.ease(u);
        cur = { x: g.from.x + (g.to.x - g.from.x) * e,
            y: g.from.y + (g.to.y - g.from.y) * e };
    }
    return cur;
};

CsDemo.styleAt = function(tl, t) {
    var name = "arrow";
    for (var i = 0; i < tl.styles.length; i++) {
        if (tl.styles[i].t <= t) {
            name = tl.styles[i].name;
        }
    }
    return name;
};

CsDemo.frame = function(run, t) {
    var tl = run.tl;
    // one-shot actions come due BEFORE the frame is taken, so the frame
    // that follows a click shows what the click did
    for (var a = 0; a < tl.acts.length; a++) {
        if (!tl.acts[a].done && tl.acts[a].t <= t) {
            tl.acts[a].done = true;
            if (tl.acts[a].fn) {
                tl.acts[a].fn();
            }
        }
    }
    var cur = CsDemo.cursorAt(run.root, tl, t);
    var n = run.n;
    var name = run.outDir + "/f" + (n < 10 ? "000" : n < 100 ? "00" :
        n < 1000 ? "0" : "") + n + ".png";
    run.root.grab().save(name, "PNG");
    var ripple = null;
    for (var r = 0; r < tl.ripples.length; r++) {
        var age = t - tl.ripples[r].t;
        if (age >= 0 && age < CsDemo.RIPPLE_MS) {
            var rp = tl.ripples[r].at;
            if (rp === undefined) {
                rp = tl.ripples[r].at = CsDemo.resolve(run.root,
                    tl.ripples[r].target);
            }
            ripple = { x: rp.x, y: rp.y, k: age / CsDemo.RIPPLE_MS };
        }
    }
    run.track.push({ n: n, t: t, x: cur.x, y: cur.y,
        style: CsDemo.styleAt(tl, t), ripple: ripple });
    run.n = n + 1;
};

/** The cursor track, written beside the frames for compose.py. */
CsDemo.writeTrack = function(run, fps) {
    var f = new QFile(run.outDir + "/track.json");
    f.open(QIODevice.WriteOnly);
    var out = new QTextStream(f);
    out.writeString(JSON.stringify({ fps: fps, dpr: run.dpr,
        frames: run.track }));
    out.flush();
    f.close();
};

CsDemo.record = function(opts) {
    var root = opts.root;
    var fps = opts.fps || 20;
    QDir.root().mkpath(opts.outDir);
    var probe = root.grab();
    var dpr = probe.width() / CsDemo.val(root, "width");
    var start = opts.start || { x: CsDemo.val(root, "width") * 0.85,
        y: CsDemo.val(root, "height") * 0.12 };
    var run = { root: root, outDir: opts.outDir, dpr: dpr, n: 0, warm: 0,
        track: [], tl: CsDemo.compile(root, opts.steps, start) };
    CsDemo.state = { running: true, done: false, frames: 0, error: "",
        fps: fps, dpr: dpr, total: run.tl.total };
    var dt = 1000 / fps;
    var timer = new QTimer(root);
    timer.interval = 1;
    timer.timeout.connect(function() {
        try {
            // let a freshly floated dock lay itself out before frame 0
            if (run.warm < 8) {
                run.warm += 1;
                return;
            }
            var t = run.n * dt;
            if (t > run.tl.total) {
                timer.stop();
                CsDemo.state.running = false;
                CsDemo.state.done = true;
                CsDemo.state.frames = run.n;
                CsDemo.writeTrack(run, fps);
                if (opts.onDone) {
                    opts.onDone();
                }
                return;
            }
            CsDemo.frame(run, t);
            CsDemo.state.frames = run.n;
        } catch (e) {
            timer.stop();
            CsDemo.state.running = false;
            CsDemo.state.error = String(e);
            if (opts.onDone) {
                try {
                    opts.onDone();
                } catch (eDone) {
                }
            }
        }
    });
    CsDemo.timer = timer;
    timer.start();
};

/**
 * Run a scenario (tools/demo/scenarios/<id>.js assigns CsDemoScenario):
 *
 *   { dock:     function() -> the QDockWidget to film (build + show it),
 *     size:     [w, h] in points the floating dock is given,
 *     fps:      frames per second (default 15),
 *     setup:    function() -- put the panel in its starting state,
 *     steps:    function() -> the step list (built late: targets such as a
 *               table row only exist once setup has run),
 *     teardown: function() -- undo anything setup did to the document }
 *
 * The dock is floated for the take and put back after, with the main
 * window's own saved state, so a clip never leaves the layout changed.
 */
CsDemo.start = function(sc, outDir) {
    var mw = RMainWindowQt.getMainWindow();
    var saved = mw.saveState();
    var dock = sc.dock();
    dock.visible = true;
    dock.raise();
    dock.setFloating(true);
    dock.resize(sc.size[0], sc.size[1]);
    if (sc.setup) {
        sc.setup();
    }
    CsDemo.record({ root: dock, outDir: outDir, fps: sc.fps || 15,
        steps: sc.steps(),
        onDone: function() {
            try {
                if (sc.teardown) {
                    sc.teardown();
                }
            } finally {
                dock.setFloating(false);
                mw.restoreState(saved);
                // restoreState re-tabs the dock on top; hand the user back
                // the tab they had
                try {
                    mw.findChild(sc.returnTo || "CaveSurveyNotebookDock").raise();
                } catch (eRaise) {
                }
            }
        } });
};

/**
 * Open a drawing in its own tab for one take, and close it after.
 *
 * A clip must not depend on whatever the user has open or on what an
 * earlier take did to it, so run.py hands every take a fresh copy of
 * the source drawing and this opens it. The tab is closed unmodified,
 * so there is never a save prompt.
 */
CsDemo.openFresh = function(path) {
    include("scripts/File/NewFile/NewFile.js");
    CsDemo.fresh = NewFile.createMdiChild(path);
    return CsDemo.fresh;
};

CsDemo.closeFresh = function() {
    if (!CsDemo.fresh) {
        return;
    }
    try {
        EAction.getDocument().setModified(false);
    } catch (eMod) {
    }
    try {
        CsDemo.fresh.close();
    } catch (eClose) {
    }
    CsDemo.fresh = null;
};

/**
 * Load some functions from the repo's copy of a file into the running app,
 * so a clip can be recorded against a fix that has not been published yet.
 *
 *   CsDemo.hotLoad(repoRoot + "/scripts/CaveSurvey/SymbolPalette/SymbolPalette.js",
 *       ["SymbolPalette.tilePen", "SymbolPalette.tileFor"]);
 *
 * Each name is lifted as the text from "<name> = function" to the closing
 * "};" at column 0 and evaluated as an assignment, which lands on the
 * global object (a function DECLARATION in an eval would stay local).
 * A restart puts the installed code back.
 */
CsDemo.hotLoad = function(path, names) {
    var text = CsHandbook.readText(path);
    for (var i = 0; i < names.length; i++) {
        var at = text.indexOf("\n" + names[i] + " = function");
        if (at < 0) {
            throw new Error("hotLoad: " + names[i] + " not in " + path);
        }
        var end = text.indexOf("\n};\n", at);
        eval(text.substring(at + 1, end + 4));
    }
};
