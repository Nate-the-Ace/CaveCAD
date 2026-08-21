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
    // typeof, not truthiness, and returned AS-IS, not through
    // String(): String(["PRIVATE"]) coerces a single-element array to
    // the string "PRIVATE", which would pass the strict PRIVATE check
    // below, and String({toString:1}) THROWS a TypeError outright (no
    // callable toString or valueOf for ToPrimitive to fall back on).
    // Both were reachable before this gate existed -- gh only ever
    // emits a plain string here, so anything else is rejected rather
    // than coerced. Also STRICT on case, deliberately not
    // case-normalized: real gh only ever emits "PRIVATE"/"PUBLIC"/
    // "INTERNAL" in uppercase, and accepting a shape gh never
    // actually produces (lowercase "private") is exactly the kind of
    // unwarranted leniency that let the Task 2 hang through.
    if (j === null || typeof j.visibility !== "string" ||
            j.visibility.length === 0) {
        return null;
    }
    return j.visibility;
};

/**
 * True ONLY for a repo gh positively reports as PRIVATE.
 *
 * INTERNAL is rejected: org-wide visibility is not private, and an
 * entrance coordinate does not care about the distinction. A failed
 * or unparseable call is rejected too -- see the fail-closed note at
 * the top of this file. `r` may be null/undefined/garbage; this never
 * throws and never returns true for anything but a confirmed PRIVATE
 * -- and that guarantee lives entirely in parseVisibility's typeof
 * gate above, not here. A version of parseVisibility that goes back
 * to truthiness + String() coercion (the previous bug: a one-element
 * array coerced to the string "PRIVATE" and passed; an object with a
 * non-callable toString threw) would silently break both halves of
 * this guarantee again.
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

/**
 * True for exactly the id shapes noreplyEmail is willing to build an
 * address from: a positive integer (number or numeric string, no
 * leading zero, no exponential notation), capped at
 * Number.MAX_SAFE_INTEGER.
 *
 * Shared by parseApiUser (below) and noreplyEmail so the two CANNOT
 * disagree about what counts as a valid GitHub id. They used to: this
 * check lived only in noreplyEmail, one layer downstream of
 * parseApiUser, which let a `{"id":<bad>}` gh response travel through
 * parseApiUser as an apparently-valid user object, into
 * CsSetup.identityPlan, which builds a 2-element argv array either
 * way -- so a caller checking `plan.length === 2` read a null email as
 * success. Validating at the source (here) means a bad id is null
 * from the very first parse, not a null discovered three calls later.
 *
 * The number and string branches AGREE on what counts as valid:
 * GitHub ids are positive integers, so a float, a negative, a
 * leading-zero string, or an exponential-notation number (e.g. 1e21)
 * is rejected on EITHER branch, not accepted on one and rejected on
 * the other -- real gh returns id as a JSON number, so a weaker
 * number branch is the one that actually runs in production, not a
 * dead code path.
 *
 * Both branches also cap at Number.MAX_SAFE_INTEGER (2^53 - 1).
 * Two different things happen above that line, both rejected here
 * rather than distinguished: a real GitHub id that large would
 * already have been silently rounded by JSON.parse before this
 * function ever sees it, and a bogus value like 1e21 is, in IEEE 754,
 * ALREADY an integer as far as `Math.floor(id) === id` can tell --
 * every double beyond 2^52 has no fractional part left to floor away,
 * so that check alone does not reject it. GitHub ids are 9 digits
 * today, decades from either problem; the cap exists so this function
 * cannot be tricked into treating "who knows" as "valid" for either
 * reason.
 */
CsHub.isValidId = function(id) {
    var MAX_ID = Number.MAX_SAFE_INTEGER;
    return (typeof id === "number" && isFinite(id) &&
            Math.floor(id) === id && id > 0 && id <= MAX_ID) ||
           (typeof id === "string" && /^[1-9]\d*$/.test(id) &&
            Number(id) <= MAX_ID);
};

CsHub.parseApiUser = function(r) {
    var j = CsHub.parseJson(r);
    // typeof, not truthiness, and no String() coercion of an
    // unvalidated shape: the old `!j.login` + `String(j.login)` let
    // {"login":["x"]} silently through as "x", and threw outright on
    // {"login":{"toString":1}} -- the same class of bug parseVisibility
    // had. gh's login is always a plain non-empty string.
    if (j === null || typeof j.login !== "string" || j.login.length === 0) {
        return null;
    }
    // id is validated HERE, at the source, with the exact rule
    // noreplyEmail uses (CsHub.isValidId) -- not left to travel
    // downstream as a "valid" user object whose id turns out to be
    // unusable only when noreplyEmail is finally called. See the
    // isValidId docblock for why this surfaced as a defect.
    if (!CsHub.isValidId(j.id)) {
        return null;
    }
    return {
        login: j.login,
        id: j.id,
        // GitHub's name field is null for accounts that never set
        // one. typeof-gated, not just null/undefined-checked, so a
        // malformed name shape falls back to login instead of
        // reaching a throwing String() call.
        name: (typeof j.name === "string" && j.name.length > 0)
              ? j.name : j.login
    };
};

/**
 * The noreply address, so a surveyor's real email never lands in a
 * commit -- which is permanent in history and readable by every
 * collaborator added later.
 *
 * `login` and `id` are both typeof-gated, not truthiness-checked: a
 * missing/undefined/null/NaN/malformed value (e.g. from a partial gh
 * api user response, or a login that is an array or object) must not
 * silently stringify into a bogus but well-formed-looking address
 * like "undefined+x@users.noreply.github.com" or
 * "1+[object Object]@users.noreply.github.com" -- a wrong committer
 * address is unfixable once it is in history, same as the real-email
 * leak this function exists to prevent. id validity is delegated to
 * CsHub.isValidId, shared with parseApiUser, so the two cannot
 * disagree.
 */
CsHub.noreplyEmail = function(user) {
    if (!user || typeof user.login !== "string" || user.login.length === 0) {
        return null;
    }
    if (!CsHub.isValidId(user.id)) {
        return null;
    }
    return String(user.id) + "+" + user.login + "@users.noreply." + CsHub.HOST;
};

// gh rejects an unrecognized flag with exit 1, empty stdout, and
// "unknown flag: ..." (or "unknown shorthand flag"/"unknown command")
// on stderr -- verified live against gh 2.97.0 on 2026-08-21 with a
// made-up flag. That output is indistinguishable from "logged out" to
// isAuthenticated (both are exit != 0 with no "Logged in to" text),
// so a future gh that renames or drops --active would make
// isAuthenticated, hasRepoScope and parseLogin all report "not
// authenticated" on a fully authenticated machine -- sending the
// surveyor into a pointless re-auth loop while the real diagnosis
// (a usage error, not a login problem) sits in `err`, discarded. Task
// 4's ladder should check this BEFORE concluding "not authenticated".
CsHub.isUsageError = function(r) {
    return /unknown flag|unknown shorthand flag|unknown command/i.test(
        CsHub.textOf(r));
};

// gh's own friendly wording for "could not reach the network at all"
// -- verified live on 2026-08-21 by pointing gh at a proxy host that
// cannot resolve (HTTPS_PROXY/HTTP_PROXY=http://nonexistent-proxy.invalid,
// no real GitHub traffic involved). isPrivate already fails closed
// when offline -- rejecting on any non-zero code regardless of why --
// so this classifier is for DIAGNOSABILITY, not safety: Task 4 needs
// to tell a surveyor "you appear to be offline" apart from "that repo
// really is not private".
CsHub.isNetworkFailure = function(r) {
    var re = /error connecting to|check your internet connection|githubstatus\.com/i;
    return re.test(CsHub.textOf(r));
};
