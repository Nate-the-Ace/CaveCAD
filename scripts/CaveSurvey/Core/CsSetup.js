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
