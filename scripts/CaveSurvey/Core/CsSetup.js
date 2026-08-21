// CsSetup.js -- getting a machine ready to use GitHub from CaveCAD.
//
// Six rungs, each with its own remedy, because these fail in ways that
// look like something else:
//
//   no credential helper -> an HTTPS push waits for a password on a
//                           terminal that does not exist, so it hangs
//   no user.email        -> commit refuses to run
//   token without repo   -> a private repo returns 404, reading as
//                           "no such repository"
//
// Discovery does NOT trust PATH. See the note in the tests.
//
// This file is pure ECMAScript: no Q*/R* global is referenced at load
// time, only inside function bodies and guarded by typeof, because
// tests/js_unit.js evaluates this file under node, where those do not
// exist.

var CsSetup = {};

CsSetup.SETTING_GIT = "CaveSurvey/GitPath";
CsSetup.SETTING_GH = "CaveSurvey/GhPath";

CsSetup.systemId = function() {
    if (typeof RS !== "undefined" && RS.getSystemId) {
        try {
            return RS.getSystemId();
        } catch (e) {
        }
    }
    return "osx";
};

/**
 * Absolute candidates first, the bare name (i.e. PATH) LAST.
 *
 * A macOS GUI app launched from Finder has a minimal PATH with no
 * /opt/homebrew/bin, so PATH-first discovery reports gh as missing on
 * machines that have it.
 */
CsSetup.candidates = function(system, name) {
    var exe = (system === "win") ? name + ".exe" : name;
    var dirs;
    if (system === "win") {
        dirs = [
            "C:/Program Files/GitHub CLI",
            "C:/Program Files/Git/cmd",
            "C:/Program Files (x86)/GitHub CLI"
        ];
    } else if (system === "linux") {
        dirs = ["/usr/bin", "/usr/local/bin", "/snap/bin"];
    } else {
        dirs = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
    }
    var out = [];
    for (var i = 0; i < dirs.length; i++) {
        out.push(dirs[i] + "/" + exe);
    }
    out.push(exe);
    return out;
};

// Injectable so the tests need no filesystem.
CsSetup.fileExists = function(path) {
    if (typeof QFileInfo === "undefined") {
        return false;
    }
    try {
        var fi = new QFileInfo(path);
        return fi.exists() && fi.isFile();
    } catch (e) {
        return false;
    }
};

/**
 * Returns the first candidate for which existsFn(path) is true, or
 * null if none of them are. Every candidate is checked, including the
 * trailing bare name -- it is a fallback in ORDER only (tried last so
 * an absolute Homebrew/etc. path wins first), not a candidate that is
 * assumed to exist. Callers that want "let the OS resolve PATH at
 * execution time regardless" do that at the CsProc.run() call itself,
 * not here.
 */
CsSetup.resolve = function(name, system, existsFn) {
    var exists = existsFn ? existsFn : CsSetup.fileExists;
    var sys = system ? system : CsSetup.systemId();
    var cands = CsSetup.candidates(sys, name);
    for (var i = 0; i < cands.length; i++) {
        if (exists(cands[i])) {
            return cands[i];
        }
    }
    return null;
};

/**
 * Validates a previously-cached path (e.g. from RSettings) against a
 * live existence check. Returns the path if it is still a non-empty
 * string AND still exists, otherwise null so the caller re-runs
 * discovery.
 */
CsSetup.validateCached = function(cached, existsFn) {
    if (typeof cached !== "string" || cached.length === 0) {
        return null;
    }
    var exists = existsFn ? existsFn : CsSetup.fileExists;
    return exists(cached) ? cached : null;
};

/**
 * Does `prog` actually run? The ONLY reliable test for a bare name.
 *
 * resolve() can only stat absolute candidates; a bare "gh" stats false
 * even when it is on PATH and works (MacPorts, ~/.local/bin, Nix). So
 * discovery ends with an execution probe: CsProc's notStarted is true
 * exactly when the binary could not be launched, which is the question
 * being asked. Verified live: a missing binary reports
 * notStarted=true/timedOut=false with the execve message in err.
 *
 * `ok` is true only when the process both started AND exited 0 -- a
 * `--version` call that starts but exits non-zero is a real, separate
 * problem (a broken alias, a corrupt install) and must not be
 * reported as "ran fine". It is also not "not installed": that
 * distinction lives in the extra `notStarted` field below, which
 * discover() reads instead of `ok` for exactly this reason.
 *
 * Returns { ok: bool, path: string, err: string, notStarted: bool }.
 * `notStarted` is one field beyond what was specified, added so
 * discover() can tell "never launched" apart from "launched, exited
 * non-zero" without running the process a second time.
 */
CsSetup.verify = function(prog, versionArgv) {
    var argv = versionArgv ? versionArgv : ["--version"];
    var r = CsProc.run(prog, argv);
    return {
        ok: (r.notStarted !== true) && r.code === 0,
        path: prog,
        err: r.err,
        notStarted: r.notStarted === true
    };
};

/**
 * The full discovery answer: a stat-resolved absolute path if one
 * exists, otherwise the bare name IF it actually executes, otherwise
 * null. This is what the ladder should consult -- never resolve()
 * alone, which cannot see a PATH-only install.
 *
 * Order: stat the absolute candidates via resolve(); a hit returns
 * immediately with NO process ever started -- stat succeeding is
 * conclusive on its own. Only when nothing stats does this fall back
 * to verify()-ing the bare name.
 *
 * The bare name is treated as found whenever it STARTS, regardless of
 * its exit code -- see the note on verify() above. A `--version` that
 * launches and exits non-zero still proves the binary is present and
 * reachable; that is a different, later problem for the caller (or
 * verify()'s `ok` field) to surface, not "not installed". Only a
 * `notStarted` probe -- nothing there to launch at all -- resolves to
 * null here.
 */
CsSetup.discover = function(name, versionArgv, system, existsFn) {
    var statted = CsSetup.resolve(name, system, existsFn);
    if (statted !== null) {
        return statted;
    }
    var sys = system ? system : CsSetup.systemId();
    var cands = CsSetup.candidates(sys, name);
    var bare = cands[cands.length - 1];
    var probe = CsSetup.verify(bare, versionArgv);
    return probe.notStarted ? null : bare;
};

CsSetup.INSTALL_HELP = {
    osx: {
        git: { command: "xcode-select --install",
               links: ["https://git-scm.com/download/mac"] },
        gh: { command: "brew install gh",
              links: ["https://cli.github.com/",
                      "https://github.com/cli/cli/releases/latest"] }
    },
    win: {
        git: { command: "winget install -e --id Git.Git",
               links: ["https://git-scm.com/download/win"] },
        gh: { command: "winget install -e --id GitHub.cli",
              links: ["https://cli.github.com/"] }
    },
    linux: {
        git: { command: "sudo apt install git",
               links: ["https://git-scm.com/download/linux"] },
        // No single command: gh's install path differs per distro
        // (apt repo, dnf, snap, ...). Links carry the remedy instead.
        gh: { command: "",
              links: ["https://cli.github.com/",
                      "https://github.com/cli/cli/blob/trunk/docs/install_linux.md"] }
    }
};

CsSetup.installHelp = function(system, name) {
    var sys = CsSetup.INSTALL_HELP[system] ? system : "osx";
    var entry = CsSetup.INSTALL_HELP[sys][name];
    return entry ? entry : null;
};
