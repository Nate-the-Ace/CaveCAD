// CsProc.js -- the ONE place a child process is started.
//
// Everything that shells out (git, gh) goes through here, for three
// reasons:
//
//   1. ARGV ARRAYS, NEVER A SHELL STRING. Cave names and macOS paths
//      contain spaces; a shell string turns one argument into two and
//      the failure is a confusing git error, not a syntax error.
//   2. An INJECTABLE BACKEND, so every layer above this file is
//      testable under node with no subprocess and no network.
//   3. REDACTION. The log is meant to be safe to attach to a bug
//      report, so a token must never reach it.
//
// QProcess is constructed INSIDE the backend only. tests/js_unit.js
// evaluates this file under node, where QProcess does not exist -- a
// top-level reference would fail the entire unit suite.

var CsProc = {};

CsProc.DEFAULT_TIMEOUT_MS = 30000;

// Injected by tests. Null means "use the real QProcess backend".
CsProc.backend = null;

CsProc.setBackend = function(fn) {
    CsProc.backend = fn;
};

// Set false to suppress writes to the real log file -- used while the
// unit suite runs under CaveCAD's engine, so testing does not append
// to the user's actual ~/.../CaveCAD/cave-git.log.
CsProc.logEnabled = true;

// Token shapes GitHub issues: the classic gh*_ prefixes, and
// github_pat_ for fine-grained PATs -- exactly the shape the token-
// paste fallback accepts. Kept broad on purpose: a new prefix is
// cheaper to add than a leaked token is to undo. No minimum length on
// the body -- real tokens run 36+ characters, but redaction should
// still catch a short one rather than let it through.
CsProc.TOKEN_RE = /(gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g;

CsProc.redact = function(text) {
    if (text === null || text === undefined) {
        return "";
    }
    return String(text).replace(CsProc.TOKEN_RE, "<redacted>");
};

// A safe existence predicate. CsProc.TOKEN_RE carries the "g" flag,
// so repeated .test() calls on it directly walk lastIndex and
// alternate true/false/true -- confirmed live. Reset lastIndex first
// so callers (e.g. CsHub scope checking) get a stateless answer.
CsProc.hasToken = function(text) {
    CsProc.TOKEN_RE.lastIndex = 0;
    return CsProc.TOKEN_RE.test(
        String(text === null || text === undefined ? "" : text));
};

CsProc.logPath = function() {
    // Beside QCAD's own settings, not in the repo -- a log inside a
    // cave repo would get committed and pushed by the save path.
    if (typeof RSettings === "undefined") {
        return null;
    }
    try {
        // getStandardWritableLocation is not a real method on this
        // engine's RSettings -- confirmed live, it throws and was
        // being silently swallowed here, which is why this file wrote
        // nothing in any build until this fix. getDataLocation() is
        // the one that actually resolves to a writable directory.
        return RSettings.getDataLocation() + "/cave-git.log";
    } catch (e) {
        return null;
    }
};

CsProc.log = function(line) {
    if (!CsProc.logEnabled) {
        return;
    }
    var path = CsProc.logPath();
    if (path === null || typeof QFile === "undefined") {
        return;
    }
    try {
        var f = new QFile(path);
        // Plain bitwise OR, not the OpenMode constructor -- confirmed
        // live, `new QIODevice.OpenMode(...)` throws a Type error on
        // this engine and was the second of two silently swallowed
        // failures that made this file write nothing. This is the
        // same pattern already proven at CsLocationPick.js:125 and
        // SurveyNotebook.js:1646; CsProc was the only file using the
        // constructor form.
        if (f.open(QIODevice.WriteOnly | QIODevice.Append | QIODevice.Text)) {
            var s = new QTextStream(f);
            s.writeString(CsProc.redact(line) + "\n");
            f.close();
        }
    } catch (e) {
        // A log that cannot be written must never break the operation
        // it was describing.
    }
};

// The real backend. Only reached when no fake is installed.
CsProc.qprocessBackend = function(prog, argv, opts) {
    if (typeof QProcess === "undefined") {
        // node, or any engine without a process bridge.
        return { code: -1, out: "", err: "no process backend in this engine",
                 timedOut: false, notStarted: true };
    }
    var timeout = (opts && typeof opts.timeoutMs === "number") ?
        opts.timeoutMs : CsProc.DEFAULT_TIMEOUT_MS;
    var p = new QProcess();
    var out = "";
    var err = "";
    var timedOut = false;
    var notStarted = false;
    var code = -1;
    try {
        p.start(prog, argv);
        if (opts && typeof opts.stdin === "string" && opts.stdin.length > 0) {
            // Secrets arrive this way and NOWHERE else -- never as an
            // argument, where ps would show them.
            p.write(new QByteArray(opts.stdin));
            p.closeWriteChannel();
        }
        if (!p.waitForFinished(timeout)) {
            // waitForFinished() returning false covers two very
            // different cases: "never started" (bad path, not
            // executable) and "still running" (a real timeout). state()
            // and error() must be read BEFORE kill() -- killing a
            // running process rewrites both to NotRunning/Crashed,
            // erasing the distinction. Verified live in this engine,
            // the same trap documented in AerialBasemap.fetch.
            if (p.state() === QProcess.NotRunning) {
                err = p.errorString();
                notStarted = true;
            } else {
                timedOut = true;
                try { p.kill(); } catch (e2) {}
                try { p.waitForFinished(1000); } catch (e3) {}   // reap the child
            }
        }
        out = new QTextStream(p.readAllStandardOutput()).readAll();
        if (!err) {
            err = new QTextStream(p.readAllStandardError()).readAll();
        }
        code = (timedOut || notStarted) ? -1 : p.exitCode();
    } catch (e) {
        err = String(e);
        code = -1;
    }
    return { code: code, out: out, err: err, timedOut: timedOut,
              notStarted: notStarted };
};

/**
 * Runs prog with argv and returns {code, out, err, timedOut, notStarted}.
 *
 * code       -- process exit code, or -1 if it never produced one
 * out        -- captured stdout, always a string
 * err        -- captured stderr, always a string
 * timedOut   -- true if the process was still running past the
 *               timeout and had to be killed
 * notStarted -- true if the process never started at all (bad path,
 *               not executable, etc.) -- distinct from a timeout, and
 *               needed by CsSetup's executable discovery
 *
 * opts.timeoutMs  -- default CsProc.DEFAULT_TIMEOUT_MS
 * opts.stdin      -- written to the child's stdin, then the channel is
 *                    closed. The ONLY route for a token.
 */
CsProc.run = function(prog, argv, opts) {
    if (!argv) {
        argv = [];
    }
    var backend = CsProc.backend;
    if (backend === null || backend === undefined) {
        backend = CsProc.qprocessBackend;
    }
    var raw = backend(prog, argv, opts || {}) || {};
    // Normalize into a fresh object -- never mutate the backend's own
    // record, and never hand a caller an undefined field. CsGit/CsHub
    // parsers downstream call .split("\n") on out/err unconditionally.
    var code = (typeof raw.code === "number") ? raw.code : -1;
    var timedOut = raw.timedOut === true;
    var notStarted = raw.notStarted === true;
    if (timedOut && code === 0) {
        // A backend that reports both is contradicting itself; a
        // timeout is never a success.
        code = -1;
    }
    var r = {
        code: code,
        out: (raw.out === undefined || raw.out === null) ? "" : String(raw.out),
        err: (raw.err === undefined || raw.err === null) ? "" : String(raw.err),
        timedOut: timedOut,
        notStarted: notStarted
    };
    // Never log opts.stdin, and never log argv verbatim without
    // redaction -- a caller could still have put a token in a flag.
    CsProc.log("$ " + prog + " " + argv.join(" ") + "  -> " + r.code);
    return r;
};
