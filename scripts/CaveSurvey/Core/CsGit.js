// CsGit.js -- git, as argv builders plus parsers for what git prints.
//
// The builders are PURE and return arrays, and the tests assert those
// arrays exactly. That is the design's defence against the bug a shell
// string would ship with: "drawings/Blowing Hole.dxf" must stay one
// argument. Execution goes through CsProc, which is injectable, so
// none of this needs git installed to test.

var CsGit = {};

CsGit.argvToplevel = function() {
    return ["rev-parse", "--show-toplevel"];
};

CsGit.argvStatus = function() {
    return ["status", "--porcelain"];
};

CsGit.argvCurrentBranch = function() {
    return ["rev-parse", "--abbrev-ref", "HEAD"];
};

CsGit.argvCommit = function(message) {
    return ["commit", "-m", message];
};

CsGit.argvAdd = function(paths) {
    // "--" so a path that looks like a flag is still a path.
    return ["add", "--"].concat(paths);
};

CsGit.argvCheckoutNew = function(branch, from) {
    var a = ["checkout", "-b", branch];
    if (from) {
        a.push(from);
    }
    return a;
};

CsGit.argvPush = function(remote, branch) {
    return ["push", "-u", remote, branch];
};

CsGit.argvPullRebase = function() {
    return ["pull", "--rebase"];
};

CsGit.argvClone = function(url, dir) {
    return ["clone", url, dir];
};

CsGit.argvConfigGet = function(key) {
    return ["config", "--get", key];
};

CsGit.argvConfigSet = function(key, value, global) {
    var a = ["config"];
    if (global) {
        a.push("--global");
    }
    a.push(key);
    a.push(value);
    return a;
};

CsGit.argvAheadBehind = function(upstream, head) {
    return ["rev-list", "--count", "--left-right", upstream + "..." + head];
};

CsGit.argvHooksPath = function(path) {
    return ["config", "core.hooksPath", path];
};

CsGit.argvVersion = function() {
    return ["--version"];
};

CsGit.parseToplevel = function(r) {
    if (!r || r.code !== 0) {
        return null;
    }
    var s = String(r.out).replace(/[\r\n]+$/, "");
    return s.length > 0 ? s : null;
};

// git C-quotes a path in ANY --porcelain output whenever it contains a
// space, a backslash, a double quote, a control character, or (when
// core.quotePath is on, the default) a non-ASCII byte -- confirmed
// live against git 2.54.0: " M \"d/Blowing Hole.dxf\"" for a plain
// space, with or without core.quotePath. A quoted path that reaches
// CsGit.argvAdd with its quote marks still attached is exactly the
// bug this file exists to prevent, so every path is run through this
// before it leaves parsePorcelain.
//
// Non-quoted input is returned unchanged, so this is always safe to
// call.
CsGit.unquotePath = function(s) {
    if (typeof s !== "string" || s.length < 2 ||
            s.charAt(0) !== "\"" || s.charAt(s.length - 1) !== "\"") {
        return s;
    }
    var inner = s.substring(1, s.length - 1);
    // A run of \ooo octal escapes is a run of UTF-8 BYTES, not
    // characters one at a time -- "\303\266" is the two bytes of "ö".
    // Decoding a byte at a time produces mojibake, so gather the
    // whole run, build a %XX-escaped string, and let
    // decodeURIComponent do the UTF-8 decode in one shot. (Confirmed
    // present in this engine: CsStore.js:117 already relies on it, and
    // the drawing round-trip test in tests/js_unit.js decodes a real
    // multiline note through it on the engine leg, not just node.)
    inner = inner.replace(/(?:\\[0-7]{3})+/g, function(run) {
        var percent = "";
        var octalRe = /\\([0-7]{3})/g;
        var m;
        while ((m = octalRe.exec(run)) !== null) {
            var hex = parseInt(m[1], 8).toString(16);
            percent += "%" + (hex.length < 2 ? "0" + hex : hex).toUpperCase();
        }
        try {
            return decodeURIComponent(percent);
        } catch (e) {
            // A malformed byte run -- keep the raw escapes rather
            // than losing the rest of the path to a thrown exception.
            return run;
        }
    });
    return inner.replace(/\\\\|\\"|\\t|\\n|\\r/g, function(m) {
        switch (m) {
        case "\\\\": return "\\";
        case "\\\"": return "\"";
        case "\\t": return "\t";
        case "\\n": return "\n";
        case "\\r": return "\r";
        }
        return m;
    });
};

CsGit.parsePorcelain = function(r) {
    var entries = [];
    if (!r || r.code !== 0) {
        return entries;
    }
    var lines = String(r.out).split("\n");
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.length < 4) {
            continue;
        }
        // Porcelain v1: two status characters, a space, then the rest
        // of the line. The path may contain spaces, so split ONCE at
        // column 3.
        var rawCode = line.substring(0, 2);
        var code = rawCode.replace(/ /g, "");
        var rest = line.substring(3);
        // A rename or copy renders as "old -> new", each side quoted
        // INDEPENDENTLY when it needs it -- so split on the arrow
        // first, then unquote each side on its own. (Not handled: a
        // filename that itself contains the literal " -> " sequence.
        // That is genuinely obscure and guarding it costs more clarity
        // than it buys.) The DESTINATION is the file that now exists
        // and the one a later `git add` must name, so that is what
        // `path` carries; `origPath` keeps the source for a status
        // display. Every other entry sets origPath to null, rather
        // than omitting the key, so callers can check it
        // unconditionally.
        var rawPath = rest;
        var rawOrig = null;
        if (rawCode.indexOf("R") !== -1 || rawCode.indexOf("C") !== -1) {
            var arrow = rest.indexOf(" -> ");
            if (arrow !== -1) {
                rawOrig = rest.substring(0, arrow);
                rawPath = rest.substring(arrow + 4);
            }
        }
        entries.push({
            code: code,
            path: CsGit.unquotePath(rawPath),
            origPath: rawOrig === null ? null : CsGit.unquotePath(rawOrig)
        });
    }
    return entries;
};

CsGit.parseAheadBehind = function(r) {
    if (!r || r.code !== 0) {
        return null;
    }
    var m = String(r.out).match(/(\d+)\s+(\d+)/);
    if (m === null) {
        return null;
    }
    // --left-right with upstream...HEAD: left is upstream-only
    // (commits we do not have = behind), right is ours (ahead).
    return { behind: parseInt(m[1], 10), ahead: parseInt(m[2], 10) };
};

CsGit.isNetworkFailure = function(text) {
    var s = String(text === null || text === undefined ? "" : text);
    return /could not resolve host|unable to access|connection (timed out|refused)|network is unreachable|operation timed out/i.test(s);
};

CsGit.isRejected = function(text) {
    var s = String(text === null || text === undefined ? "" : text);
    return /\[rejected\]|non-fast-forward|fetch first/i.test(s);
};
