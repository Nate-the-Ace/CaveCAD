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
        // A rename or copy renders as "old -> new". The DESTINATION is
        // the file that now exists and the one a later `git add` must
        // name, so that is what `path` carries; `origPath` keeps the
        // source for a status display. Every other entry sets
        // origPath to null, rather than omitting the key, so callers
        // can check it unconditionally.
        var path = rest;
        var origPath = null;
        if (rawCode.indexOf("R") !== -1 || rawCode.indexOf("C") !== -1) {
            var arrow = rest.indexOf(" -> ");
            if (arrow !== -1) {
                origPath = rest.substring(0, arrow);
                path = rest.substring(arrow + 4);
            }
        }
        entries.push({ code: code, path: path, origPath: origPath });
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
