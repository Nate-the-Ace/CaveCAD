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

function CsProc() {
}

CsProc.DEFAULT_TIMEOUT_MS = 30000;

// Injected by tests. Null means "use the real QProcess backend".
CsProc.backend = null;

CsProc.setBackend = function(fn) {
    CsProc.backend = fn;
};

// Token shapes GitHub issues. Kept broad on purpose: a new prefix is
// cheaper to add than a leaked token is to undo. No minimum length on
// the body -- real tokens run 36+ characters, but redaction should
// still catch a short one rather than let it through.
CsProc.TOKEN_RE = /gh[pousr]_[A-Za-z0-9_]+/g;

CsProc.redact = function(text) {
    if (text === null || text === undefined) {
        return "";
    }
    return String(text).replace(CsProc.TOKEN_RE, "<redacted>");
};

CsProc.logPath = function() {
    // Beside QCAD's own settings, not in the repo -- a log inside a
    // cave repo would get committed and pushed by the save path.
    if (typeof RSettings === "undefined") {
        return null;
    }
    try {
        return RSettings.getStandardWritableLocation() + "/cave-git.log";
    } catch (e) {
        return null;
    }
};

CsProc.log = function(line) {
    var path = CsProc.logPath();
    if (path === null || typeof QFile === "undefined") {
        return;
    }
    try {
        var f = new QFile(path);
        if (f.open(new QIODevice.OpenMode(QIODevice.WriteOnly | QIODevice.Append |
                                         QIODevice.Text))) {
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
    var timeout = (opts && opts.timeoutMs) ? opts.timeoutMs : CsProc.DEFAULT_TIMEOUT_MS;
    var p = new QProcess();
    var out = "";
    var err = "";
    var timedOut = false;
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
            timedOut = true;
            try { p.kill(); } catch (e2) {}
        }
        out = new QTextStream(p.readAllStandardOutput()).readAll();
        err = new QTextStream(p.readAllStandardError()).readAll();
        code = timedOut ? -1 : p.exitCode();
    } catch (e) {
        err = String(e);
        code = -1;
    }
    return { code: code, out: out, err: err, timedOut: timedOut };
};

/**
 * Runs prog with argv and returns {code, out, err, timedOut}.
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
    var r = backend(prog, argv, opts || {});
    if (r.timedOut && r.code === 0) {
        // A backend that reports both is contradicting itself; a
        // timeout is never a success.
        r.code = -1;
    }
    // Never log opts.stdin, and never log argv verbatim without
    // redaction -- a caller could still have put a token in a flag.
    CsProc.log("$ " + prog + " " + argv.join(" ") + "  -> " + r.code);
    return r;
};
