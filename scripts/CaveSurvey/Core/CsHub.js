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

CsHub.argvAuthStatus = function() {
    return ["auth", "status"];
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
    return String(j.visibility).toUpperCase();
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
 */
CsHub.noreplyEmail = function(user) {
    if (!user || !user.login) {
        return null;
    }
    return String(user.id) + "+" + String(user.login) +
           "@users.noreply." + CsHub.HOST;
};
