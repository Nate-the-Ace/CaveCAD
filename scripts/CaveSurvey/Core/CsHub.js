// CsHub.js -- the GitHub API, which for this add-on means the gh CLI.
//
// CaveCAD's script bridge has NO QNetworkAccessManager (probed
// 2026-08-20), so gh is not a convenience here, it is the only route
// to GitHub. That is why "gh is missing" and "gh is not authenticated"
// are first-class states rather than edge cases.
//
// Two checks carry the project's first rule -- never expose a cave
// entrance coordinate:
//   isPrivate      -- decision 1, and it FAILS CLOSED. "Could not
//                     verify" is not "it is fine".
//   hasRepoScope   -- a token without `repo` makes a private repo
//                     return 404, not 403, which reads as "that repo
//                     does not exist" and sends the surveyor hunting
//                     the wrong problem.
//
// Builders are PURE and return arrays, asserted exactly by the tests,
// for the same reason CsGit's are: a shell string would silently
// split "cave-blowing-hole" style names or paths into two arguments.
// Execution goes through CsProc, which is injectable, so none of this
// needs gh installed to test.

var CsHub = {};

CsHub.HOST = "github.com";
CsHub.SCOPES = "repo,read:org";

// "--active" is NOT optional. gh prints one "Logged in to ..." +
// "Token scopes:" block PER ACCOUNT on a multi-account host (see
// `gh auth switch`), each with its own "- Active account: true/false"
// marker that none of the parsers below read. Without --active, every
// parser reads whichever block gh prints FIRST -- not the one that is
// actually active. parseLogin feeds noreplyEmail, which feeds
// `git config user.email`: on a host where the active account is
// listed second, that writes the WRONG account's committer address
// into PERMANENT commit history, unfixable after the fact. --active
// (present in gh 2.97.0, confirmed here with a live read-only call on
// 2026-08-21, byte-identical to the single-account AUTH_OK fixture)
// makes "the block gh prints" and "the active block" the same thing
// by construction, so none of the text parsers below need to change.
CsHub.argvAuthStatus = function() {
    return ["auth", "status", "--active"];
};

CsHub.argvDeviceLogin = function() {
    return ["auth", "login", "--web", "--git-protocol", "https",
            "--hostname", CsHub.HOST, "--scopes", CsHub.SCOPES,
            "--clipboard", "--skip-ssh-key"];
};

CsHub.argvTokenLogin = function() {
    return ["auth", "login", "--with-token", "--git-protocol", "https",
            "--hostname", CsHub.HOST];
};

CsHub.argvSetupGit = function() {
    return ["auth", "setup-git"];
};

CsHub.argvRefreshScope = function(scope) {
    return ["auth", "refresh", "-s", scope];
};

CsHub.argvRepoView = function(nameWithOwner) {
    return ["repo", "view", nameWithOwner, "--json",
            "visibility,nameWithOwner,defaultBranchRef"];
};

CsHub.argvRepoCreate = function(name) {
    return ["repo", "create", name, "--private"];
};

CsHub.argvApiUser = function() {
    return ["api", "user"];
};

CsHub.argvVersion = function() {
    return ["--version"];
};

// gh's human-readable `auth status` output lands on stdout when
// authenticated (exit 0) and on stderr when logged out (exit 1, empty
// stdout) -- confirmed live against gh 2.97.0 on 2026-08-21. Which
// stream carries the text is an outcome of the call, not a contract,
// so every parser below reads both rather than picking one.
CsHub.textOf = function(r) {
    if (!r) {
        return "";
    }
    return String(r.out === undefined || r.out === null ? "" : r.out) + "\n" +
           String(r.err === undefined || r.err === null ? "" : r.err);
};

CsHub.parseJson = function(r) {
    if (!r || r.code !== 0) {
        return null;
    }
    try {
        return JSON.parse(String(r.out));
    } catch (e) {
        return null;
    }
};

CsHub.parseVisibility = function(r) {
    var j = CsHub.parseJson(r);
    if (j === null || !j.visibility) {
        return null;
    }
    // STRICT passthrough, deliberately not case-normalized. Real gh
    // only ever emits "PRIVATE"/"PUBLIC"/"INTERNAL" in uppercase, and
    // this value feeds the privacy gate below -- accepting a shape gh
    // never actually produces (lowercase "private") is exactly the
    // kind of unwarranted leniency that let the Task 2 hang through.
    // If gh's output ever changes shape, isPrivate should fail
    // closed, not silently accept it.
    return String(j.visibility);
};

/**
 * True ONLY for a repo gh positively reports as PRIVATE.
 *
 * INTERNAL is rejected: org-wide visibility is not private, and an
 * entrance coordinate does not care about the distinction. A failed
 * or unparseable call is rejected too -- see the fail-closed note at
 * the top of this file. `r` may be null/undefined/garbage; this never
 * throws and never returns true for anything but a confirmed PRIVATE.
 */
CsHub.isPrivate = function(r) {
    return CsHub.parseVisibility(r) === "PRIVATE";
};

CsHub.isAuthenticated = function(r) {
    if (!r || r.code !== 0) {
        return false;
    }
    return /Logged in to /i.test(CsHub.textOf(r));
};

CsHub.parseLogin = function(r) {
    if (!r || r.code !== 0) {
        return null;
    }
    var m = CsHub.textOf(r).match(/Logged in to \S+ account (\S+)/i);
    return m === null ? null : m[1];
};

CsHub.parseScopes = function(r) {
    if (!r || r.code !== 0) {
        return [];
    }
    var m = CsHub.textOf(r).match(/Token scopes:([^\n]*)/i);
    if (m === null) {
        return [];
    }
    var scopes = [];
    var parts = m[1].split(",");
    for (var i = 0; i < parts.length; i++) {
        var s = parts[i].replace(/['"\s]/g, "");
        if (s.length > 0) {
            scopes.push(s);
        }
    }
    return scopes;
};

CsHub.hasRepoScope = function(r) {
    return CsHub.parseScopes(r).indexOf("repo") !== -1;
};

CsHub.parseApiUser = function(r) {
    var j = CsHub.parseJson(r);
    if (j === null || !j.login) {
        return null;
    }
    return {
        login: String(j.login),
        id: j.id,
        // GitHub's name field is null for accounts that never set one.
        name: (j.name === null || j.name === undefined ||
               String(j.name).length === 0)
              ? String(j.login) : String(j.name)
    };
};

/**
 * The noreply address, so a surveyor's real email never lands in a
 * commit -- which is permanent in history and readable by every
 * collaborator added later.
 *
 * `id` is validated with the same "fail closed, do not guess" spirit
 * as the `login` check right below it: a missing/undefined/null/NaN
 * `id` (e.g. from a partial gh api user response) must not silently
 * stringify into a bogus but well-formed-looking address like
 * "undefined+x@users.noreply.github.com" -- a wrong committer address
 * is unfixable once it is in history, same as the real-email leak
 * this function exists to prevent.
 */
CsHub.noreplyEmail = function(user) {
    if (!user || !user.login) {
        return null;
    }
    var id = user.id;
    var idIsValid = (typeof id === "number" && isFinite(id)) ||
                     (typeof id === "string" && /^\d+$/.test(id));
    if (!idIsValid) {
        return null;
    }
    return String(id) + "+" + String(user.login) +
           "@users.noreply." + CsHub.HOST;
};
