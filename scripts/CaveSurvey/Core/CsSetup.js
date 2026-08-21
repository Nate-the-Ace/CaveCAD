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
    // typeof, not truthiness: a truthy non-function existsFn (a
    // string, an object) would reach exists(cands[i]) below and throw
    // "exists is not a function" two frames from here.
    var exists = (typeof existsFn === "function") ? existsFn : CsSetup.fileExists;
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
    var exists = (typeof existsFn === "function") ? existsFn : CsSetup.fileExists;
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
    // Array.isArray, not truthiness: a truthy non-array versionArgv
    // (a string, an object) would reach CsProc.run's argv.join(" ")
    // logging call and throw "argv.join is not a function" two frames
    // from here. Confirmed present in both node and this engine's own
    // QtScript bridge (CaveCAD 3.33.0) -- see the js_unit.js test.
    var argv = Array.isArray(versionArgv) ? versionArgv : ["--version"];
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
    // A bracket lookup on an unknown name resolves up the prototype
    // chain: entry for name === "toString" or "hasOwnProperty" would
    // otherwise come back as a Function, not undefined, and pass a
    // truthiness check. Every real entry here is a plain
    // {command, links} object, so require that shape explicitly.
    if (typeof entry !== "object" || entry === null) {
        return null;
    }
    return entry;
};

// ---------------------------------------------------------------------
// Tool discovery for the ladder
//
// resolve() is stat-only: it returns null for a gh that lives outside
// every candidate directory even when it is on PATH and works
// (MacPorts, ~/.local/bin, Nix) -- verified live on 2026-08-21, a real
// binary outside every candidate dir gives resolve() -> null but
// discover() -> the bare name. Rungs 1 and 2 of the ladder (git, gh)
// must be fed from discover(), never from resolve() alone, or the
// ladder tells a surveyor with a perfectly working gh that it needs to
// be installed.
//
// discover() runs a real process when nothing stats, so this function
// calls it exactly ONCE per program and returns a plain record for the
// caller to cache into the ladder's probe -- it must not be called
// from inside ladder() itself on every rung evaluation, which would
// relaunch "gh --version" every time the ladder is displayed. The
// ladder stays a pure function over an already-collected probe record.
// ---------------------------------------------------------------------

CsSetup.discoverTools = function(system, existsFn) {
    return {
        gitPath: CsSetup.discover("git", CsGit.argvVersion(), system, existsFn),
        ghPath: CsSetup.discover("gh", CsHub.argvVersion(), system, existsFn)
    };
};

// ---------------------------------------------------------------------
// Device flow
// ---------------------------------------------------------------------

CsSetup.DEVICE_URL = "https://github.com/login/device";

// gh prints "! First copy your one-time code: XXXX-XXXX". Which stream
// it lands on is an implementation detail (confirmed for auth status
// text in CsHub.textOf's fixtures), so callers concatenate both
// streams before handing text here; this only cares about the shape.
CsSetup.parseDeviceCode = function(text) {
    if (typeof text !== "string" || text.length === 0) {
        return null;
    }
    var m = text.match(/one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i);
    return m === null ? null : m[1].toUpperCase();
};

CsSetup.parseDeviceUrl = function(text) {
    var s = (typeof text === "string") ? text : "";
    var m = s.match(/https:\/\/\S*github\.com\/login\/device\S*/i);
    return m === null ? CsSetup.DEVICE_URL : m[0];
};

// ---------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------

// Distinguishes gh auth failures that otherwise look identical: exit
// 1, empty stdout, no "Logged in to" text. Measured live against gh
// 2.97.0 on 2026-08-21 -- logged-out, offline, and "this gh rejects a
// flag we send" all produce that exact same shape. Collapsing them
// into "not signed in" sends an offline surveyor, or one running a
// gh version this add-on has not caught up with, into a sign-in loop
// on a machine that was never broken.
CsSetup.AUTH_CAUSE_USAGE_ERROR = "usage_error";
CsSetup.AUTH_CAUSE_NETWORK_FAILURE = "network_failure";
CsSetup.AUTH_CAUSE_NOT_AUTHENTICATED = "not_authenticated";

// ok === true  passed
// ok === false failed, remedy (and, for the auth rung, cause) applies
// ok === null  NOT EVALUATED, because an earlier rung failed. Reporting
//              "not authenticated" under "gh is not installed" sends
//              the surveyor after three problems that are one problem.
// cause is null unless a rung distinguishes more than one failure
// mode that would otherwise read as the same thing (only the auth
// rung does, for now) -- it lets a caller branch without re-parsing
// the remedy text.
CsSetup.rung = function(id, label, ok, remedy, cause) {
    return {
        id: id,
        label: label,
        ok: ok,
        remedy: (typeof remedy === "string") ? remedy : "",
        cause: (cause === undefined) ? null : cause
    };
};

CsSetup.ladder = function(probe, system) {
    var sys = system ? system : CsSetup.systemId();
    var rungs = [];
    var blocked = false;

    function skip(id, label) {
        rungs.push(CsSetup.rung(id, label, null, ""));
    }

    // 1. git
    var gitHelp = CsSetup.installHelp(sys, "git");
    if (probe.gitPath) {
        rungs.push(CsSetup.rung("git", "git installed", true));
    } else {
        rungs.push(CsSetup.rung("git", "git installed", false,
            "git was not found. Install it with: " + gitHelp.command +
            "  --  " + gitHelp.links.join(" ")));
        blocked = true;
    }

    // 2. gh
    var ghHelp = CsSetup.installHelp(sys, "gh");
    if (blocked) {
        skip("gh", "GitHub CLI installed");
    } else if (probe.ghPath) {
        rungs.push(CsSetup.rung("gh", "GitHub CLI installed", true));
    } else {
        rungs.push(CsSetup.rung("gh", "GitHub CLI installed", false,
            "The GitHub CLI was not found. Install it with: " +
            (ghHelp.command.length > 0 ? ghHelp.command + "  --  " : "") +
            ghHelp.links.join(" ")));
        blocked = true;
    }

    // 3. authenticated
    //
    // Three exit-1-empty-stdout failures share one signal (see the
    // AUTH_CAUSE_* comment above): check the two diagnosable causes
    // BEFORE concluding "not signed in", because that conclusion
    // drives a surveyor into `gh auth login` -- which fixes nothing
    // for an offline machine or a gh version mismatch, and looks like
    // it worked (login succeeds) while the underlying rung stays
    // broken for the SAME reason next time.
    if (blocked) {
        skip("auth", "Signed in to GitHub");
    } else if (CsHub.isAuthenticated(probe.authStatus)) {
        rungs.push(CsSetup.rung("auth", "Signed in to GitHub", true));
    } else if (CsHub.isUsageError(probe.authStatus)) {
        rungs.push(CsSetup.rung("auth", "Signed in to GitHub", false,
            "This gh rejected a flag this add-on uses (--active). That " +
            "is a gh version mismatch, not a login problem -- update " +
            "gh, or report this, rather than trying to authenticate again.",
            CsSetup.AUTH_CAUSE_USAGE_ERROR));
        blocked = true;
    } else if (CsHub.isNetworkFailure(probe.authStatus)) {
        rungs.push(CsSetup.rung("auth", "Signed in to GitHub", false,
            "Could not reach GitHub. This looks like a network problem, " +
            "not a login problem -- check your internet connection. " +
            "Authenticating again will not fix a machine that is offline.",
            CsSetup.AUTH_CAUSE_NETWORK_FAILURE));
        blocked = true;
    } else {
        rungs.push(CsSetup.rung("auth", "Signed in to GitHub", false,
            "Not signed in. Use Sign in to GitHub below -- it opens your " +
            "browser and no password passes through CaveCAD.",
            CsSetup.AUTH_CAUSE_NOT_AUTHENTICATED));
        blocked = true;
    }

    // 4. repo scope
    if (blocked) {
        skip("scope", "Token can see private repositories");
    } else if (CsHub.hasRepoScope(probe.authStatus)) {
        rungs.push(CsSetup.rung("scope", "Token can see private repositories", true));
    } else {
        rungs.push(CsSetup.rung("scope", "Token can see private repositories", false,
            "This token lacks the 'repo' scope, so a private cave repository " +
            "returns 404 -- it looks as though it does not exist. Fix with: " +
            "gh auth refresh -s repo"));
        blocked = true;
    }

    // 5. credential helper
    if (blocked) {
        skip("helper", "git can authenticate to GitHub");
    } else if (probe.setupGit && probe.setupGit.code === 0) {
        rungs.push(CsSetup.rung("helper", "git can authenticate to GitHub", true));
    } else {
        rungs.push(CsSetup.rung("helper", "git can authenticate to GitHub", false,
            "git has no credential helper, so a push waits forever for a " +
            "password prompt that never appears. Fix with: gh auth setup-git"));
        blocked = true;
    }

    // 6. identity
    if (blocked) {
        skip("identity", "Commit name and email set");
    } else {
        var haveName = probe.userName && probe.userName.code === 0 &&
            String(probe.userName.out).replace(/\s/g, "").length > 0;
        var haveEmail = probe.userEmail && probe.userEmail.code === 0 &&
            String(probe.userEmail.out).replace(/\s/g, "").length > 0;
        if (haveName && haveEmail) {
            rungs.push(CsSetup.rung("identity", "Commit name and email set", true));
        } else {
            rungs.push(CsSetup.rung("identity", "Commit name and email set", false,
                "git has no commit identity, so a commit refuses to run. " +
                "Set it from your GitHub account below."));
        }
    }

    return rungs;
};

CsSetup.firstFailure = function(rungs) {
    for (var i = 0; i < rungs.length; i++) {
        if (rungs[i].ok === false) {
            return rungs[i];
        }
    }
    return null;
};

/**
 * Returns argv arrays for setting the commit identity.
 *
 * LOCAL by default: silently rewriting a developer's global git
 * identity is an overreach, and this add-on runs on machines that do
 * other work.
 */
CsSetup.identityPlan = function(user, global) {
    if (!user || typeof user.login !== "string" || user.login.length === 0) {
        return [];
    }
    var email = CsHub.noreplyEmail(user);
    return [
        CsGit.argvConfigSet("user.name", user.name, global === true),
        CsGit.argvConfigSet("user.email", email, global === true)
    ];
};
