// GitHubSetup.js
//
// QCAD add-on tool: gets this machine ready to use GitHub from inside
// CaveCAD, and says exactly what is missing when it is not.
//
// The ladder and every string it reports live in CsSetup, which is
// unit-tested; this file is the window onto it. Sign-in uses gh's
// DEVICE FLOW: gh prints a one-time code, the browser does the
// authenticating, and no password or token passes through CaveCAD.
//
// USAGE:
//   Cave Survey > GitHub Setup   (or type "githubsetup"/"ghsetup")

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function GitHubSetup(guiAction) {
    EAction.call(this, guiAction);
}

GitHubSetup.prototype = new EAction();

GitHubSetup.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    GitHubSetup.showLadder();
    this.terminate();
};

// CsSetup.resolve() is stat-only and reports a gh living outside the
// candidate directories as MISSING even when it is on PATH and works
// (MacPorts, ~/.local/bin, Nix) -- verified live, a real binary
// outside every candidate dir gives resolve() -> null but
// discoverTools() -> the bare name. discoverTools() is the form that
// closes that blind spot; resolve() alone must never drive this
// dialog, or it tells a surveyor with a perfectly working gh that gh
// needs to be installed.
GitHubSetup.resolveTools = function() {
    return CsSetup.discoverTools();
};

GitHubSetup.showLadder = function() {
    var tools = GitHubSetup.resolveTools();
    var probe = CsSetup.probe(tools.gitPath, tools.ghPath);
    var rungs = CsSetup.ladder(probe);

    var lines = [];
    for (var i = 0; i < rungs.length; i++) {
        var r = rungs[i];
        var mark = (r.ok === true) ? "OK  " : (r.ok === false ? "X   " : "--  ");
        lines.push(mark + r.label);
        if (r.ok === false && r.remedy.length > 0) {
            lines.push("      " + r.remedy);
        }
    }

    var failure = CsSetup.firstFailure(rungs);
    if (failure === null) {
        EAction.handleUserMessage(qsTr("GitHub setup: ready.") + "\n" +
            lines.join("\n"));
        return;
    }

    EAction.handleUserWarning(qsTr("GitHub setup is incomplete:") + "\n" +
        lines.join("\n"));

    // Only the rungs this tool can act on get an offer; an install is
    // the user's to run, and the plugin never downloads an installer.
    if (failure.id === "auth") {
        GitHubSetup.offerSignIn(tools.ghPath);
    } else if (failure.id === "scope") {
        GitHubSetup.runAndReport(tools.ghPath, CsHub.argvRefreshScope("repo"),
            qsTr("Requesting the repo scope"));
    } else if (failure.id === "helper") {
        GitHubSetup.runAndReport(tools.ghPath, CsHub.argvSetupGit(),
            qsTr("Configuring git's credential helper"));
    } else if (failure.id === "identity") {
        GitHubSetup.setIdentity(tools.gitPath, tools.ghPath);
    } else if (failure.remedy.length > 0) {
        // git or gh missing: hand over the link, do not act.
        var help = CsSetup.installHelp(CsSetup.systemId(), failure.id);
        if (help !== null && help.links.length > 0 &&
            typeof QDesktopServices !== "undefined") {
            try {
                QDesktopServices.openUrl(new QUrl(help.links[0]));
            } catch (e) {
            }
        }
    }
};

// Task 7 supplies the real device-flow dialog. Until it lands, this
// is a plain message so the "auth" rung's remedy is not a dead end --
// no password or token passes through CaveCAD either way.
GitHubSetup.offerSignIn = function(ghPath) {
    if (!ghPath) {
        return;
    }
    EAction.handleUserMessage(qsTr("Not signed in. Use Sign in to " +
        "GitHub -- it opens your browser and no password passes " +
        "through CaveCAD."));
};

GitHubSetup.runAndReport = function(prog, argv, what) {
    if (!prog) {
        return false;
    }
    var r = CsProc.run(prog, argv, { timeoutMs: 60000 });
    if (r.code === 0) {
        EAction.handleUserMessage(what + ": " + qsTr("done."));
        return true;
    }
    // Shortest decisive line, with the whole output in cave-git.log.
    var line = String(r.err).split("\n")[0];
    EAction.handleUserWarning(what + ": " + line);
    return false;
};

GitHubSetup.setIdentity = function(gitPath, ghPath) {
    if (!gitPath || !ghPath) {
        return;
    }
    var user = CsHub.parseApiUser(CsProc.run(ghPath, CsHub.argvApiUser()));
    if (user === null) {
        EAction.handleUserWarning(qsTr("Could not read your GitHub account."));
        return;
    }
    // Local by default. The noreply address keeps a real email out of
    // history, which is permanent and readable by anyone added later.
    var plan = CsSetup.identityPlan(user, false);
    if (plan.length === 0) {
        EAction.handleUserWarning(
            qsTr("Could not determine a commit identity from your GitHub account."));
        return;
    }
    for (var i = 0; i < plan.length; i++) {
        CsProc.run(gitPath, plan[i]);
    }
    EAction.handleUserMessage(qsTr("Commit identity set to %1 <%2> for this repository.")
        .arg(user.name).arg(CsHub.noreplyEmail(user)));
};

GitHubSetup.init = function(basePath) {
    var action = new RGuiAction(qsTr("GitHub Setup"), RMainWindowQt.getMainWindow());
    // Setup must work with no drawing open -- a new user has none.
    action.setRequiresDocument(false);
    action.setScriptFile(basePath + "/GitHubSetup.js");
    action.setIcon(basePath + "/GitHubSetup.svg");
    action.setStatusTip(qsTr("Check and finish this computer's GitHub setup"));
    action.setDefaultCommands(["githubsetup", "ghsetup"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(22);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
