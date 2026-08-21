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
    // typeof-guarded, UNLIKE this file's other cross-Core references:
    // discoverTools calls CsGit.argvVersion()/CsHub.argvVersion(),
    // and ladder/identityPlan call CsHub.isAuthenticated,
    // CsHub.noreplyEmail, CsGit.argvConfigSet and others, all with no
    // guard at all. None of them NEED one: CsAll.js's dependency
    // order and CORE_FILES's load order both guarantee CsProc, CsGit,
    // and CsHub are all defined before any of this runs. This one
    // guard is kept anyway, on the one function here most likely to
    // be called directly by a future standalone test or script that
    // does not go through that load order -- it costs one comparison
    // and turns a load-order mistake into the documented
    // {ok: false, ...} shape instead of a raw ReferenceError two
    // frames from wherever the caller reached in.
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

// upgradeCommand is used only for gh (CsSetup.usageErrorRemedy) -- a
// gh version mismatch is a real, distinct rung failure (see the
// AUTH_CAUSE_USAGE_ERROR comment below), but there is no equivalent
// "git version mismatch" state this ladder detects, so git's entries
// omit the field rather than carry a value nothing reads.
CsSetup.INSTALL_HELP = {
    osx: {
        git: { command: "xcode-select --install",
               links: ["https://git-scm.com/download/mac"] },
        gh: { command: "brew install gh",
              upgradeCommand: "brew upgrade gh",
              links: ["https://cli.github.com/",
                      "https://github.com/cli/cli/releases/latest"] }
    },
    win: {
        git: { command: "winget install -e --id Git.Git",
               links: ["https://git-scm.com/download/win"] },
        gh: { command: "winget install -e --id GitHub.cli",
              upgradeCommand: "winget upgrade --id GitHub.cli",
              links: ["https://cli.github.com/"] }
    },
    linux: {
        git: { command: "sudo apt install git",
               links: ["https://git-scm.com/download/linux"] },
        // No single command: gh's install (or upgrade) path differs
        // per distro (apt repo, dnf, snap, ...). Links carry the
        // remedy instead -- see missingRemedy/usageErrorRemedy.
        gh: { command: "",
              upgradeCommand: "",
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
    // for the rest of the process. upgradeCommand defaults to "" for
    // git's entries, which do not define one (see INSTALL_HELP's
    // comment), so callers never see `undefined`.
    return {
        command: entry.command,
        upgradeCommand: (typeof entry.upgradeCommand === "string")
            ? entry.upgradeCommand : "",
        links: entry.links.slice()
    };
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

// Built from CsHub.HOST rather than a second literal "github.com" --
// this file and CsHub.js used to each hardcode the host, two sources
// of truth for the same fact with nothing keeping them in sync.
CsSetup.DEVICE_URL = "https://" + CsHub.HOST + "/login/device";

/**
 * Pulls the one-time device code out of gh's login output. Returns
 * null -- never a truncated or partial code -- when the shape is not
 * there. Contrast parseDeviceUrl just below: that one degrades to a
 * safe default on a miss, because it always has one to fall back to;
 * this one has no safe substitute for a wrong code, so a miss must be
 * visible as null, not a guess.
 *
 * gh prints "! First copy your one-time code: XXXX-XXXX". Which
 * stream it lands on is an implementation detail (confirmed for auth
 * status text in CsHub.textOf's fixtures), so callers concatenate
 * both streams before handing text here; this only cares about the
 * shape.
 */
CsSetup.parseDeviceCode = function(text) {
    if (typeof text !== "string" || text.length === 0) {
        return null;
    }
    // The trailing (?![A-Za-z0-9-]) is a boundary, not decoration: an
    // XXXX-XXXX{4}-{4} match is a fixed length, so without it
    // "one-time code: 1234-5678-9012" matched the first eight
    // characters and silently returned "1234-5678" -- a real-looking
    // code that is not the one gh printed. With the boundary, that
    // input matches nothing (the trailing "-9012" fails it) and
    // correctly returns null instead of a truncated guess.
    var m = text.match(
        /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})(?![A-Za-z0-9-])/i);
    return m === null ? null : m[1].toUpperCase();
};

/**
 * Pulls the device-login URL out of gh's login output, falling back
 * SILENTLY to the canonical CsSetup.DEVICE_URL when the shape is not
 * there -- the inverse error contract of parseDeviceCode just above,
 * which returns null on a miss because it has no safe fallback value.
 * A URL always has one: the canonical device URL never changes.
 */
CsSetup.parseDeviceUrl = function(text) {
    var s = (typeof text === "string") ? text : "";
    // Anchored on the HOST, not just "github.com appears somewhere in
    // the URL": a prior version's greedy tail before the literal host
    // spanned path/query characters too, so
    // "https://evil.io/r?u=github.com/login/device" matched and
    // returned the evil.io URL, and
    // "https://evil.github.com.attacker.io/login/device" matched too
    // (github.com followed by more host, not a path). This value ends
    // up in QDesktopServices.openUrl (Task 7); gh's own output is not
    // attacker-controlled, so there is no live exploit today, but
    // "opens whatever URL was scraped" is the wrong shape regardless.
    // Requires: https literally, zero or more dot-terminated
    // subdomain labels, then literally CsHub.HOST, then the path
    // starting at "/login/device" -- nothing else may sit between the
    // host and that path.
    //
    // The trailing character class excludes whitespace and the
    // punctuation that commonly WRAPS a url in prose or markup
    // (<>"')].,;:!?) rather than being part of it -- a bare "\S*"
    // here returned "https://github.com/login/device." or
    // "...device)" with the sentence's own punctuation stuck to the
    // end, which is a 404 nobody reading the ladder could diagnose.
    // The canonical device URL has no path/query segment after
    // "/login/device" at all, so excluding sentence punctuation from
    // the tail cannot clip anything a real device URL would ever need.
    var hostPattern = CsHub.HOST.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var re = new RegExp(
        "https://([A-Za-z0-9-]+\\.)*" + hostPattern +
        "/login/device[^\\s<>\"')\\].,;:!?]*", "i");
    var m = s.match(re);
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
// on a machine that was never broken. `cause` exists so a caller can
// branch on which one happened without re-parsing English out of the
// remedy text -- id plus cause is a value a caller can switch on,
// where a sentence is not.
CsSetup.AUTH_CAUSE_USAGE_ERROR = "usage_error";
CsSetup.AUTH_CAUSE_NETWORK_FAILURE = "network_failure";
CsSetup.AUTH_CAUSE_NOT_AUTHENTICATED = "not_authenticated";

// Where a caver actually types a command -- named explicitly because
// "git was not found. Install it with: xcode-select --install" gives
// a stranger no next action: nothing on screen accepts that text.
CsSetup.runPrefix = function(sys) {
    return (sys === "win") ? "In Command Prompt, run: " : "In Terminal, run: ";
};

// A real destination for "report this", not just "report this" with
// nowhere to send it.
CsSetup.GH_ISSUES_URL = "https://github.com/cli/cli/issues";

/**
 * The "it's missing, here's the fix" sentence for rungs 1 and 2.
 *
 * Handles gh on Linux, whose INSTALL_HELP command is deliberately
 * empty (no single command covers every distro): a prior version
 * fixed only the SEPARATOR for that case, not the verb, so it read
 * "Install it with: <url> <url>" -- nothing installs anything WITH a
 * link.
 */
CsSetup.missingRemedy = function(sys, subject, help) {
    if (help.command.length > 0) {
        return subject + " was not found. " + CsSetup.runPrefix(sys) +
            help.command + "  --  see also: " + help.links.join("  ");
    }
    return subject + " was not found. Installing it depends on your " +
        "Linux distribution -- see: " + help.links.join("  ");
};

/**
 * The auth rung's usage_error remedy: gh rejected a flag this add-on
 * sends, which is a version problem, not a login problem, so this
 * names an upgrade command (from INSTALL_HELP's upgradeCommand) and a
 * real place to report it -- never "update gh, or report this" with
 * no command and no destination.
 */
CsSetup.usageErrorRemedy = function(sys) {
    var help = CsSetup.installHelp(sys, "gh");
    var fix = (help.upgradeCommand.length > 0)
        ? CsSetup.runPrefix(sys) + help.upgradeCommand
        : "upgrading it depends on your Linux distribution -- see: " +
          help.links.join("  ");
    return "This gh rejected a flag this add-on uses (--active). That " +
        "is a gh version mismatch, not a login problem. " + fix +
        "  --  or report it at " + CsSetup.GH_ISSUES_URL +
        ". Signing in again will not fix this.";
};

/**
 * "Blank" for a git-config-shaped value: not a string at all, or a
 * string that has nothing left once whitespace is stripped.
 *
 * Shared by the ladder's identity rung and identityPlan (see
 * identityPlan's own docblock) so the two cannot disagree about what
 * counts as a set name/email. They used to: identityPlan accepted a
 * merely non-empty user.name, so `{name: "   "}` produced a real
 * `git config user.name "   "` command, while the ladder's identity
 * rung used a truthiness-plus-String() check that ALSO reported
 * success on garbage -- `String(undefined)` is `"undefined"`, nine
 * non-whitespace characters, so `{userName: {code: 0}}` (no `out` at
 * all) passed the very rung whose entire job is catching that.
 * Sharing one predicate closes both: either it is genuinely blank
 * everywhere, or it genuinely is not.
 */
CsSetup.isBlank = function(s) {
    return typeof s !== "string" || s.replace(/\s/g, "").length === 0;
};

// ok === true  passed
// ok === false failed, remedy (and, for the auth rung, cause) applies
// ok === null  NOT EVALUATED, because an earlier rung failed. Reporting
//              "not authenticated" under "gh is not installed" sends
//              the surveyor after three problems that are one problem.
// cause is null unless a rung distinguishes more than one failure
// mode that would otherwise read as the same thing (only the auth
// rung does, for now). typeof-guarded like `remedy` just above it --
// the same field on the same function had two different standards
// until this changed, remedy validated and cause passed through raw.
CsSetup.rung = function(id, label, ok, remedy, cause) {
    return {
        id: id,
        label: label,
        ok: ok,
        remedy: (typeof remedy === "string") ? remedy : "",
        cause: (typeof cause === "string") ? cause : null
    };
};

/**
 * The six rungs, id/label single-sourced here and nowhere else.
 *
 * Each entry's evaluate(p, sys) runs ONLY when every earlier rung
 * passed (see CsSetup.ladder's driver loop) and returns {ok, remedy,
 * cause} -- remedy/cause are only read when ok === false. This table
 * plus the loop replaced six near-identical hand-written blocks that
 * each repeated blocked-checking, id and label literals (19 label
 * occurrences and 21 id occurrences across the six, before this
 * change) -- enough duplication that a typo in one copy produced a
 * label that depended on which failure path ran. It also made "does
 * this rung set blocked on failure" a per-block decision instead of a
 * property of the table: rung 6 (identity) was the one block that
 * never set it, which was invisible only because it happened to be
 * last. A rung appended after it would have silently run and
 * reported under a failed identity rung -- the exact defect this
 * ladder exists to prevent -- with no test catching it, since nothing
 * downstream of rung 6 existed to be wrong. The driver loop now owns
 * `blocked` exactly once, so that failure mode cannot recur no matter
 * how many rungs are added.
 */
CsSetup.RUNGS = [
    {
        id: "git",
        label: "git installed",
        evaluate: function(p, sys) {
            // typeof + length, never truthiness: a bare `if (p.gitPath)`
            // accepts `1`, `true`, `{}`, or `" "` as "installed", and
            // that value becomes a CsProc.run PROGRAM argument in
            // Task 6 -- the same truthiness-plus-coercion class closed
            // in CsHub and briefly reopened here.
            if (!CsSetup.isBlank(p.gitPath)) {
                return { ok: true };
            }
            return { ok: false, remedy: CsSetup.missingRemedy(
                sys, "git", CsSetup.installHelp(sys, "git")) };
        }
    },
    {
        id: "gh",
        label: "GitHub CLI installed",
        evaluate: function(p, sys) {
            if (!CsSetup.isBlank(p.ghPath)) {
                return { ok: true };
            }
            return { ok: false, remedy: CsSetup.missingRemedy(
                sys, "The GitHub CLI", CsSetup.installHelp(sys, "gh")) };
        }
    },
    {
        id: "auth",
        label: "Signed in to GitHub",
        evaluate: function(p, sys) {
            // Three exit-1-empty-stdout failures share one signal (see
            // the AUTH_CAUSE_* comment above): check the two
            // diagnosable causes BEFORE concluding "not signed in",
            // because that conclusion drives a surveyor into
            // `gh auth login` -- which fixes nothing for an offline
            // machine or a gh version mismatch, and looks like it
            // worked (login succeeds) while the underlying rung stays
            // broken for the SAME reason next time.
            if (CsHub.isAuthenticated(p.authStatus)) {
                return { ok: true };
            }
            if (CsHub.isUsageError(p.authStatus)) {
                return { ok: false, remedy: CsSetup.usageErrorRemedy(sys),
                         cause: CsSetup.AUTH_CAUSE_USAGE_ERROR };
            }
            if (CsHub.isNetworkFailure(p.authStatus)) {
                return { ok: false,
                    remedy: "Could not reach GitHub. This looks like a " +
                        "network problem, not a login problem -- check " +
                        "your internet connection. Authenticating again " +
                        "will not fix a machine that is offline.",
                    cause: CsSetup.AUTH_CAUSE_NETWORK_FAILURE };
            }
            return { ok: false,
                remedy: "Not signed in. Use Sign in to GitHub -- it " +
                    "opens your browser and no password passes through " +
                    "CaveCAD.",
                cause: CsSetup.AUTH_CAUSE_NOT_AUTHENTICATED };
        }
    },
    {
        id: "scope",
        label: "Token can see private repositories",
        evaluate: function(p, sys) {
            if (CsHub.hasRepoScope(p.authStatus)) {
                return { ok: true };
            }
            return { ok: false,
                remedy: "This token lacks the 'repo' scope, so a " +
                    "private cave repository returns 404 -- it looks " +
                    "as though it does not exist. " +
                    CsSetup.runPrefix(sys) + "gh auth refresh -s repo" };
        }
    },
    {
        id: "helper",
        label: "git can authenticate to GitHub",
        evaluate: function(p, sys) {
            // READ-ONLY check: probe.credentialHelper comes from
            // `git config --get-regexp ^credential`, not from RUNNING
            // `gh auth setup-git` -- that command CONFIGURES the
            // helper, so testing via it would make the diagnostic
            // itself the mutation (a prior version did exactly this;
            // see docs commit ddccee7). ANY helper passes, not just
            // gh's own: osxkeychain, manager, store, or gh's helper
            // all mean git can authenticate. `gh auth setup-git`
            // remains available below as a user-INITIATED remedy.
            var ch = p.credentialHelper;
            if (ch && ch.code === 0 && !CsSetup.isBlank(ch.out)) {
                return { ok: true };
            }
            return { ok: false,
                remedy: "git has no credential helper, so an HTTPS " +
                    "push waits for a password prompt on a terminal " +
                    "that does not exist -- it hangs rather than " +
                    "failing. " + CsSetup.runPrefix(sys) +
                    "gh auth setup-git" };
        }
    },
    {
        id: "identity",
        label: "Commit name and email set",
        evaluate: function(p, sys) {
            // isBlank, never truthiness-plus-String(): String(undefined)
            // is "undefined" and String(null) is "null", both nine
            // non-whitespace characters, so a probe with no `out` at
            // all (or a non-string `out`) reported "identity set" on
            // this rung until isBlank replaced the bare String() call.
            var haveName = p.userName && p.userName.code === 0 &&
                !CsSetup.isBlank(p.userName.out);
            var haveEmail = p.userEmail && p.userEmail.code === 0 &&
                !CsSetup.isBlank(p.userEmail.out);
            if (haveName && haveEmail) {
                return { ok: true };
            }
            return { ok: false,
                remedy: "git has no commit identity, so a commit " +
                    "refuses to run. Set it from your GitHub account." };
        }
    }
];

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

    for (var i = 0; i < CsSetup.RUNGS.length; i++) {
        var r = CsSetup.RUNGS[i];
        if (blocked) {
            // Reporting a specific failure ("not authenticated")
            // under an EARLIER one ("gh is not installed") sends the
            // surveyor after three problems that are one problem, so
            // an unevaluated rung gets ok === null, never false or
            // true, and no remedy or cause.
            rungs.push(CsSetup.rung(r.id, r.label, null, ""));
            continue;
        }
        var res = r.evaluate(p, sys);
        rungs.push(CsSetup.rung(r.id, r.label, res.ok, res.remedy, res.cause));
        if (res.ok === false) {
            blocked = true;
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
        // rungs[i] itself, not just its .ok field: a malformed array
        // (e.g. [null]) must read the same as "no failure known"
        // rather than throw on `null.ok`.
        if (rungs[i] && rungs[i].ok === false) {
            return rungs[i];
        }
    }
    return null;
};

/**
 * Runs the commands the ladder needs and returns its input record.
 *
 * Short-circuits twice, each for the same reason: running a command
 * against a binary this machine does not have produces an error that
 * describes the WRONG problem (a confusing execve failure instead of
 * "install this"), so nothing beyond what is already known to be safe
 * is attempted.
 *
 *   no gitPath -> nothing at all is run, not even the two
 *                 `git config --get` reads; every field stays null.
 *   no ghPath  -> the two git config reads still run (git IS
 *                 present), but the credential-helper read and
 *                 `gh auth status` are never attempted.
 *
 * isBlank(), not truthiness: a whitespace-only path is not a real
 * program and must not reach CsProc.run as one -- the same class of
 * bug isBlank was introduced to close in the ladder itself (rungs 1
 * and 2 used to accept a single space as "installed").
 *
 * READ-ONLY throughout: the credential-helper check is
 * `git config --get-regexp ^credential`, never `gh auth setup-git` --
 * that command CONFIGURES the helper, so running it here would make
 * opening this dialog the very mutation the check exists to detect
 * (docs commit ddccee7).
 */
CsSetup.probe = function(gitPath, ghPath) {
    var probe = {
        gitPath: gitPath,
        ghPath: ghPath,
        authStatus: null,
        credentialHelper: null,
        userName: null,
        userEmail: null
    };
    if (CsSetup.isBlank(gitPath)) {
        return probe;
    }
    probe.userName = CsProc.run(gitPath, CsGit.argvConfigGet("user.name"));
    probe.userEmail = CsProc.run(gitPath, CsGit.argvConfigGet("user.email"));
    if (CsSetup.isBlank(ghPath)) {
        return probe;
    }
    // READ-ONLY. Never run `gh auth setup-git` from a probe -- see
    // this function's docstring.
    probe.credentialHelper = CsProc.run(gitPath,
        ["config", "--get-regexp", "^credential"]);
    probe.authStatus = CsProc.run(ghPath, CsHub.argvAuthStatus());
    return probe;
};

// ---------------------------------------------------------------------
// Device login -- argv, code extraction from a live process's
// collected streams, and the strict "did it actually work" check.
//
// These three are pure functions over data GitHubSetup.js collects
// while driving the real `gh auth login --web` child process (Task 7).
// They exist here, not in GitHubSetup.js, for the same reason every
// other parser in this file does: a pure function over a plain object
// is testable under node with no QProcess and no network, where the
// dialog itself cannot be.
// ---------------------------------------------------------------------

/**
 * gh's device-flow argv, by name so GitHubSetup.js never spells out
 * CsHub.argvDeviceLogin() itself -- one call site for "what exactly do
 * we launch" makes it possible to assert the argv exactly in a test
 * that never imports GitHubSetup.js at all.
 */
CsSetup.deviceLoginArgv = function() {
    return CsHub.argvDeviceLogin();
};

/**
 * Extracts the device code from a login process's own {out, err}
 * collected so far. Tolerant of a missing/malformed argument and of
 * either field being absent -- this is called on EVERY poll tick
 * while gh is still running, including the very first one, before gh
 * has printed anything at all, so "nothing yet" (null) has to be the
 * ordinary case, not an error.
 */
CsSetup.readDeviceCode = function(streams) {
    if (!streams || typeof streams !== "object") {
        return null;
    }
    var out = (typeof streams.out === "string") ? streams.out : "";
    var err = (typeof streams.err === "string") ? streams.err : "";
    return CsSetup.parseDeviceCode(out + "\n" + err);
};

/**
 * A login counts only when gh's OWN status agrees -- never a bare
 * `loginResult.code === 0`.
 *
 * Exit 0 alone is not enough: a device flow that unwinds cleanly after
 * being cancelled or left to expire can still exit 0 in some gh
 * builds, and a login that "succeeded" without a usable token would
 * send the surveyor into a confusing 404 later instead of a clear
 * failure now. CsHub.isAuthenticated is the exact predicate the
 * ladder's own auth rung trusts (CsSetup.RUNGS, id "auth"), reused
 * rather than re-derived, so this cannot disagree with what the
 * ladder will report two seconds later when it re-probes the machine.
 */
CsSetup.loginSucceeded = function(loginResult, statusResult) {
    if (!loginResult || loginResult.code !== 0) {
        return false;
    }
    return CsHub.isAuthenticated(statusResult);
};

/**
 * Returns argv arrays for setting the commit identity, or [] --
 * ALL-OR-NOTHING -- when any input is not trustworthy, so a caller
 * checking `plan.length === 2` can actually trust that as success.
 *
 * LOCAL by default: silently rewriting a developer's global git
 * identity is an overreach, and this add-on runs on machines that do
 * other work.
 *
 * `user.name`'s blank check (CsSetup.isBlank) is the SAME predicate
 * the ladder's identity rung uses -- see isBlank's own docblock for
 * why they must agree: a whitespace-only name that passes one check
 * but not the other produces a fix button that runs a real command
 * and then reports failure anyway, forever.
 */
CsSetup.identityPlan = function(user, global) {
    if (!user || !CsHub.isValidLogin(user.login)) {
        return [];
    }
    if (CsSetup.isBlank(user.name)) {
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
