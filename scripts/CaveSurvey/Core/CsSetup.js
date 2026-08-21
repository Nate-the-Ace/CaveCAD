// CsSetup.js -- getting a machine ready to use GitHub from CaveCAD.
//
// Four parts, in the order a surveyor hits them:
//
//   1. Executable discovery (candidates/resolve/verify/discover) --
//      finds git and gh WITHOUT trusting PATH, and without trusting
//      stat alone for a PATH-only install. See each function's own
//      docstring for why both are needed.
//   2. Install help (installHelp) -- per-platform remedy text for
//      when discovery comes up empty.
//   3. Device-flow parsing (parseDeviceCode/parseDeviceUrl) -- reads
//      gh's device-login output so sign-in can happen inside CaveCAD
//      with no password ever passing through the add-on.
//   4. The six-rung preflight ladder (ladder) -- git installed, gh
//      installed, signed in, repo scope, credential helper, commit
//      identity -- because these fail in ways that look like
//      something else:
//
//        no credential helper -> an HTTPS push waits for a password
//                                on a terminal that does not exist,
//                                so it hangs
//        no user.email        -> commit refuses to run
//        token without repo   -> a private repo returns 404, reading
//                                as "no such repository"
//
// This file is pure ECMAScript: no Q*/R* global is referenced at load
// time, only inside function bodies and guarded by typeof, because
// tests/js_unit.js evaluates this file under node, where those do not
// exist.

var CsSetup = {};

/**
 * RSettings keys the caller (GitHubSetup) uses to persist a
 * discover()'d git/gh path across launches, once a launch has paid
 * discover()'s one execution probe. On the NEXT launch the cached
 * value is read through validateCached(), and a miss there must fall
 * back to discover() again, NEVER to resolve() alone -- resolve()
 * cannot see a PATH-only install (see discover()'s docstring). Only
 * an isCacheable() path should ever be written here in the first
 * place -- see that function. Reading/writing RSettings itself is not
 * this file's job; this Core file stays pure JS and never references
 * RSettings at load time.
 */
CsSetup.SETTING_GIT = "CaveSurvey/GitPath";
CsSetup.SETTING_GH = "CaveSurvey/GhPath";

// "osx"/"win"/"linux" (RS::getSystemId() also returns "freebsd",
// "netbsd", "openbsd", "solaris", or "unknown" on platforms this
// add-on does not special-case) are the exact literal return values
// of RS::getSystemId(), confirmed by reading
// cavecad-src/src/core/RSPlatform.cpp directly rather than trusting
// the plan's description of the API. This session only runs on
// macOS, so only "osx" is exercised live; "win" and "linux" drive the
// whole per-platform dispatch in candidates() and installHelp() but
// are trusted from that source reading, not a live probe on either
// platform.
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
 * The bare (PATH-relying) executable name for `name` on `system` --
 * "gh.exe" on win, "gh" everywhere else. candidates() below appends
 * exactly this as its LAST entry, and discover() falls back to
 * exactly this when nothing stats. Both call this ONE function
 * instead of discover() rebuilding candidates() and reading its last
 * element -- that would couple discover()'s correctness to
 * candidates()'s array ORDERING, so appending a new candidate after
 * the bare one some day would make discover() probe the wrong thing
 * with no test failing.
 */
CsSetup.bareName = function(system, name) {
    return (system === "win") ? name + ".exe" : name;
};

/**
 * Absolute candidates first, the bare name (i.e. PATH) LAST.
 *
 * A macOS GUI app launched from Finder has a minimal PATH with no
 * /opt/homebrew/bin, so PATH-first discovery reports gh as missing on
 * machines that have it.
 */
CsSetup.candidates = function(system, name) {
    // A bad name is not this function's job to interpret -- e.g. a
    // caller accidentally passing "gh.exe" on win would otherwise
    // yield "gh.exe.exe", and passing an already-absolute path would
    // plant it as the bare candidate that verify() would go on to
    // EXECUTE. Neither is a real caller in this codebase today, but
    // both are latent, and an empty candidate list is a safe, cheap
    // refusal for either.
    if (typeof name !== "string" || name.length === 0) {
        return [];
    }
    var exe = CsSetup.bareName(system, name);
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
        // isExecutable() too, not just exists()+isFile(): proven live
        // on macOS that a chmod 644 regular file passes exists()+
        // isFile() ([exists, isFile, isExecutable] = [true, true,
        // false] on a 644 file, all true on a 755 one). Without this,
        // resolve()/discover() would report that file as "gh
        // installed" and the NEXT rung would fail with a confusing
        // "execve: Permission denied" instead of the right remedy
        // living here. A real program file is executable by
        // definition, so this cannot reject a genuine hit. Only the
        // macOS leg was probed live -- Qt's Windows isExecutable() is
        // extension/ACL based rather than a POSIX permission bit, so
        // this is trusted on win, not independently verified there.
        return fi.exists() && fi.isFile() && fi.isExecutable();
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
 * Only an ABSOLUTE path is safe to cache. discover() can legitimately
 * return the bare name ("gh") for a PATH-only install (MacPorts,
 * ~/.local/bin, Nix) -- see discover()'s docstring -- but caching that
 * bare string breaks the whole point of caching it: validateCached()
 * later stats it as a path relative to the process's CURRENT WORKING
 * DIRECTORY, not PATH. Proven live inside CaveCAD:
 *
 *   cwd                                =>  .../CaveCAD.app/Contents/Resources
 *   discover(...)                      =>  "gh"
 *   validateCached("gh")               =>  null
 *   QFileInfo("gh").absoluteFilePath() =>  .../Resources/gh
 *
 * So caching discover()'s bare-name answer means the cache NEVER
 * hits for exactly the installs the execution probe was added to
 * support -- a real subprocess launch on every single startup. And
 * the mirror hazard: a stray file happening to be named "gh" in that
 * Resources directory would validate a path nothing intended. Never
 * cache a bare name; falling back to discover() again on every launch
 * for that case is the correct, safe behaviour, not a performance bug
 * to work around.
 */
CsSetup.isCacheable = function(path) {
    if (typeof path !== "string" || path.length === 0) {
        return false;
    }
    if (path.charAt(0) === "/") {
        return true;
    }
    // A Windows drive-letter path: "C:/..." or "C:\...".
    return /^[A-Za-z]:[\\\/]/.test(path);
};

/**
 * Validates a previously-cached path (e.g. from RSettings, under
 * SETTING_GIT/SETTING_GH) against a live existence check. Returns the
 * path if it is isCacheable() (a non-empty, absolute-looking string)
 * AND still exists, otherwise null so the caller re-runs discovery via
 * discover() -- NEVER via resolve() alone, which cannot see a
 * PATH-only install (see discover()'s docstring). Rejecting a
 * non-cacheable value here, rather than just documenting that callers
 * should not have cached one, is what actually closes the "stray file
 * named gh in the cwd" hazard described on isCacheable() above.
 */
CsSetup.validateCached = function(cached, existsFn) {
    if (!CsSetup.isCacheable(cached)) {
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
    // from here. Array.isArray is confirmed present in both node and
    // this engine's own QtScript bridge (CaveCAD 3.33.0).
    var argv = Array.isArray(versionArgv) ? versionArgv : ["--version"];
    // typeof-guarded like every other cross-Core reference in this
    // tree (CsBind.js, CsTags.js, CsRevise.js all guard the same way):
    // this file loads before CsProc in CsAll.js's dependency order, so
    // in practice this is always defined, but a load-order mistake
    // should report through the documented shape, not a raw
    // ReferenceError two frames from wherever the ladder called in.
    if (typeof CsProc === "undefined" || typeof CsProc.run !== "function") {
        return { ok: false, path: prog,
                 err: "CsProc is not available in this environment",
                 notStarted: true };
    }
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
 * to verify()-ing the bare name (via bareName(), not by rebuilding
 * candidates() and reading its last element).
 *
 * The bare name is treated as found whenever it STARTS, regardless of
 * its exit code -- see verify()'s docstring for why a non-zero exit
 * from a binary that did start is a different, later problem, not
 * "not installed". Only a `notStarted` probe resolves to null here.
 */
CsSetup.discover = function(name, versionArgv, system, existsFn) {
    if (typeof name !== "string" || name.length === 0) {
        return null;
    }
    var statted = CsSetup.resolve(name, system, existsFn);
    if (statted !== null) {
        return statted;
    }
    var sys = system ? system : CsSetup.systemId();
    var bare = CsSetup.bareName(sys, name);
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

// A plain truthiness/typeof check on a bracket lookup is not enough
// to keep the prototype chain out, and this bit BOTH lookups below --
// proven live in both this engine and node:
//   INSTALL_HELP[system] for system === "toString" resolves to the
//     inherited Object.prototype.toString function -- truthy, so the
//     old `INSTALL_HELP[system] ? system : "osx"` fallback silently
//     broke and used "toString" as the platform instead of "osx".
//   table[name] for name === "__proto__" resolves to table's own
//     prototype object (Object.prototype) via the __proto__ accessor
//     -- typeof "object" and non-null, so it passed a shape check on
//     the ENTRY and was returned as if it were a real
//     {command, links} record.
// hasOwnProperty.call is the one check that answers "is this actually
// one of MY keys" rather than "does something answer at this key by
// any means".
CsSetup.hasOwn = function(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
};

CsSetup.installHelp = function(system, name) {
    var sys = CsSetup.hasOwn(CsSetup.INSTALL_HELP, system) ? system : "osx";
    var table = CsSetup.INSTALL_HELP[sys];
    if (!CsSetup.hasOwn(table, name)) {
        return null;
    }
    var entry = table[name];
    // A shallow copy, not the live entry: CsProc.run one file away
    // establishes the convention "never mutate the backend's own
    // record" for exactly this reason -- a caller pushing onto the
    // returned .links array would otherwise corrupt CsSetup.INSTALL_HELP
    // for the rest of the process.
    return { command: entry.command, links: entry.links.slice() };
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
    // Anchored on the HOST, not just "github.com appears somewhere in
    // the URL": the previous "\S*" before the literal host spanned
    // path/query characters too, so
    // "https://evil.io/r?u=github.com/login/device" matched and
    // returned the evil.io URL, and
    // "https://evil.github.com.attacker.io/login/device" matched too
    // (github.com followed by more host, not a path). This value ends
    // up in QDesktopServices.openUrl (Task 7); gh's own output is not
    // attacker-controlled, so there is no live exploit today, but
    // "opens whatever URL was scraped" is the wrong shape regardless.
    // Requires: https literally, zero or more dot-terminated
    // subdomain labels, then literally "github.com", then the path
    // starting at "/login/device" -- nothing else may sit between the
    // host and that path.
    var m = s.match(
        /https:\/\/([A-Za-z0-9-]+\.)*github\.com\/login\/device\S*/i);
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
    // A missing/non-object probe must read as "nothing discovered
    // yet", not throw. Every FIELD inside probe (gitPath, authStatus,
    // ...) was already tolerant of a bad shape below; only the probe
    // OBJECT itself was not, and Task 6's GUI is a real caller of
    // this function. "Nothing discovered" fails rung 1 with its
    // install remedy, same as an explicit {gitPath: null}.
    var p = (probe && typeof probe === "object") ? probe : {};
    var sys = system ? system : CsSetup.systemId();
    var rungs = [];
    var blocked = false;

    function skip(id, label) {
        rungs.push(CsSetup.rung(id, label, null, ""));
    }

    // 1. git
    var gitHelp = CsSetup.installHelp(sys, "git");
    if (p.gitPath) {
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
    } else if (p.ghPath) {
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
    } else if (CsHub.isAuthenticated(p.authStatus)) {
        rungs.push(CsSetup.rung("auth", "Signed in to GitHub", true));
    } else if (CsHub.isUsageError(p.authStatus)) {
        rungs.push(CsSetup.rung("auth", "Signed in to GitHub", false,
            "This gh rejected a flag this add-on uses (--active). That " +
            "is a gh version mismatch, not a login problem -- update " +
            "gh, or report this, rather than trying to authenticate again.",
            CsSetup.AUTH_CAUSE_USAGE_ERROR));
        blocked = true;
    } else if (CsHub.isNetworkFailure(p.authStatus)) {
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
    } else if (CsHub.hasRepoScope(p.authStatus)) {
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
    } else if (p.setupGit && p.setupGit.code === 0) {
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
        var haveName = p.userName && p.userName.code === 0 &&
            String(p.userName.out).replace(/\s/g, "").length > 0;
        var haveEmail = p.userEmail && p.userEmail.code === 0 &&
            String(p.userEmail.out).replace(/\s/g, "").length > 0;
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
    // A non-array (missing, null, or any other shape) reads as "no
    // failure known", not a throw -- the house convention in this
    // slice, and ladder() above has the matching tolerance for its
    // own argument.
    if (!Array.isArray(rungs)) {
        return null;
    }
    for (var i = 0; i < rungs.length; i++) {
        if (rungs[i].ok === false) {
            return rungs[i];
        }
    }
    return null;
};

/**
 * Returns argv arrays for setting the commit identity, or [] when any
 * field needed to build them is not trustworthy.
 *
 * LOCAL by default: silently rewriting a developer's global git
 * identity is an overreach, and this add-on runs on machines that do
 * other work.
 *
 * ALL-OR-NOTHING, deliberately: this used to return a length-2 plan
 * even when CsHub.noreplyEmail(user) came back null (an invalid id --
 * e.g. parseApiUser passing a partial gh response straight through),
 * because the two argv arrays were built unconditionally. A caller
 * checking `plan.length === 2` read that as success and ran it --
 * confirmed live in the real engine that a null argv element coerces
 * to an empty string, so the command that actually executed was
 * `git config user.email ""`, silently wiping the repository's
 * committer address. A partial plan is worse than none, because a
 * caller cannot tell it apart from a good one; parseApiUser has since
 * been fixed to reject a bad id at the source (CsHub.isValidId), but
 * this function no longer trusts that alone -- it checks its own
 * inputs before building anything.
 */
CsSetup.identityPlan = function(user, global) {
    if (!user || typeof user.login !== "string" || user.login.length === 0) {
        return [];
    }
    if (typeof user.name !== "string" || user.name.length === 0) {
        return [];
    }
    var email = CsHub.noreplyEmail(user);
    if (email === null) {
        return [];
    }
    return [
        CsGit.argvConfigSet("user.name", user.name, global === true),
        CsGit.argvConfigSet("user.email", email, global === true)
    ];
};
