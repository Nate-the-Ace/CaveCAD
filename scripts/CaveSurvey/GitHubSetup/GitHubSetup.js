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

/**
 * gh's device flow, driven from inside CaveCAD.
 *
 * Probed on 2026-08-20 with no TTY: `gh auth login --web` prints the
 * one-time code and the device URL, then blocks polling GitHub. It
 * does not demand a terminal and does not wait for Enter. That is
 * what makes an in-app sign-in dialog possible at all -- the code can
 * be shown here while gh itself does the waiting.
 *
 * QProcess is driven directly here rather than through CsProc.run:
 * that call blocks until the child exits, and the whole point is to
 * read the one-time code out of the child's output WHILE it is still
 * running, long before it exits.
 *
 * POLLING DESIGN -- a QTimer, not a blocking loop:
 * the plan's original draft polled with `proc.waitForFinished(250)`
 * in a `while` loop calling QCoreApplication.processEvents() each
 * pass. QProcess::waitForFinished() blocks the calling thread for up
 * to its argument regardless of processEvents() -- for up to 15
 * minutes, in 250ms increments, that is a main thread that stutters
 * rather than one that stays responsive, and a frozen-feeling CaveCAD
 * during sign-in would cost more than this feature is worth. A
 * repeating QTimer avoids that: `timer.timeout.connect(fn)` plus
 * `timer.start(ms)` is an established pattern in this codebase
 * (CaveMode.js's startup timer), and each tick calls
 * readAllStandardOutput()/readAllStandardError() -- which drain
 * whatever is CURRENTLY buffered and never block -- plus proc.state(),
 * never proc.waitForFinished(). The main thread is free between ticks.
 *
 * KILL-BEFORE-READ HAZARD: AerialBasemap.fetch() established live in
 * this engine that killing a QProcess REWRITES its state()/exitCode(),
 * so anything still needed from a process must be read before it is
 * ever killed. This function reads exitCode() and the collected
 * output on exactly ONE path -- natural completion, detected via
 * proc.state() === QProcess.NotRunning -- and that path never calls
 * kill() at all. Every path that DOES call kill() (Cancel, the native
 * dialog close box, and the 15-minute expiry) is a deliberate abort
 * with nothing left to read: there is no exit code to interpret for a
 * process this code chose to end.
 *
 * BOUNDED: waitedMs is advanced by POLL_MS on every tick and compared
 * against EXPIRY_MS (gh's own device-code lifetime) BEFORE anything
 * else happens on the next tick, so the number of ticks is capped at
 * EXPIRY_MS / POLL_MS regardless of what gh does. Natural completion
 * is still checked ahead of the expiry check on every tick, so a
 * process that finishes right at the boundary is read normally
 * instead of being killed for "expiring" a moment after it succeeded.
 *
 * REACHABLE CANCEL: Cancel's own click always kills and closes.
 * dialog.rejected is ALSO wired to the same teardown, because a
 * QDialog can be dismissed by its native title-bar close box or
 * Escape without ever going through the Cancel button's click signal
 * -- unlike `.clicked.connect`, `.rejected.connect` was not
 * independently re-probed live in this session, but the generic
 * "signal has .connect(fn)" mechanism is exercised elsewhere in this
 * codebase across several unrelated signal types (QTimer.timeout,
 * QSplitter.splitterMoved, a custom transactionUpdated signal), so it
 * is trusted here on that precedent rather than on a fresh probe. A
 * `settled` guard makes whichever path fires first (Cancel, the close
 * box, natural completion, or expiry) the only one that acts; Task 8
 * is where the close-box path actually gets to run.
 */
GitHubSetup.offerSignIn = function(ghPath) {
    if (CsSetup.isBlank(ghPath)) {
        return;
    }

    var proc = new QProcess();
    var dialog = new QDialog(RMainWindowQt.getMainWindow());
    dialog.windowTitle = qsTr("Sign in to GitHub");

    var layout = new QVBoxLayout();

    var codeLabel = new QLabel(qsTr("Starting sign-in..."));
    var font = codeLabel.font;
    font.setPointSize(font.pointSize() + 10);
    font.setBold(true);
    codeLabel.font = font;
    layout.addWidget(codeLabel, 0, 0);

    var help = new QLabel(qsTr("Enter this code on the page that opens " +
        "in your browser. It is already on your clipboard."));
    help.wordWrap = true;
    layout.addWidget(help, 0, 0);

    var openButton = new QPushButton(qsTr("Open github.com/login/device"));
    layout.addWidget(openButton, 0, 0);
    var cancelButton = new QPushButton(qsTr("Cancel"));
    layout.addWidget(cancelButton, 0, 0);
    dialog.setLayout(layout);

    // Read fresh on every poll tick, never assumed fixed: gh's own
    // output is the source of truth for the URL (parseDeviceUrl falls
    // back to this same constant when it has not been seen yet, or
    // ever).
    var deviceUrl = CsSetup.DEVICE_URL;
    var collected = { out: "", err: "" };
    var codeShown = false;
    var settled = false;   // exactly one teardown path may ever run
    var waitedMs = 0;
    var POLL_MS = 250;
    var EXPIRY_MS = 15 * 60 * 1000;   // gh's own device-code expiry

    var timer = new QTimer();
    timer.singleShot = false;

    var teardown = function(killChild) {
        if (settled) {
            return false;
        }
        settled = true;
        try { timer.stop(); } catch (e) {}
        if (killChild) {
            // Kill, not terminate, and never conditioned on whether gh
            // has already exited on its own -- an orphaned gh keeps
            // polling GitHub after this window is gone, and kill() on
            // an already-finished process is a harmless no-op.
            try { proc.kill(); } catch (e2) {}
        }
        return true;
    };

    openButton.clicked.connect(function() {
        try {
            QDesktopServices.openUrl(new QUrl(deviceUrl));
        } catch (e) {
        }
    });

    cancelButton.clicked.connect(function() {
        if (teardown(true)) {
            dialog.reject();
        }
    });

    // Safety net for the native close box / Escape -- see this
    // function's docstring for why this signal, specifically, is
    // trusted on precedent rather than a fresh live probe.
    try {
        dialog.rejected.connect(function() {
            teardown(true);
        });
    } catch (eConnect) {
        // Cancel's own click handler above still covers the ordinary
        // path if this connection is refused outright.
    }

    proc.start(ghPath, CsSetup.deviceLoginArgv());
    dialog.show();

    timer.timeout.connect(function() {
        if (settled) {
            return;
        }
        waitedMs += POLL_MS;

        // Never blocks: drains whatever gh has written since the last
        // tick. This is the entire reason a timer replaced the
        // draft's waitForFinished() loop.
        collected.out += new QTextStream(proc.readAllStandardOutput()).readAll();
        collected.err += new QTextStream(proc.readAllStandardError()).readAll();

        if (!codeShown) {
            var code = CsSetup.readDeviceCode(collected);
            if (code !== null) {
                codeLabel.text = code;
                codeShown = true;
            }
        }
        var seenUrl = CsSetup.parseDeviceUrl(collected.out + "\n" + collected.err);
        if (seenUrl !== CsSetup.DEVICE_URL) {
            deviceUrl = seenUrl;
        }

        // proc.state(), never proc.waitForFinished(): the latter
        // blocks the caller for up to its argument; the former just
        // reports what QProcess already knows. Checked BEFORE the
        // expiry test below so a process that finishes right at the
        // 15-minute boundary is read normally, not killed for
        // "expiring" a moment after it actually succeeded.
        if (proc.state() === QProcess.NotRunning) {
            if (!teardown(false)) {
                return;
            }
            dialog.accept();
            // Read exitCode()/output ONLY here, on the one path that
            // never calls kill() -- see the kill-before-read hazard
            // in this function's docstring.
            var loginResult = { code: proc.exitCode(), out: collected.out,
                                 err: collected.err };
            var status = CsProc.run(ghPath, CsHub.argvAuthStatus());
            if (!CsSetup.loginSucceeded(loginResult, status)) {
                var line = String(collected.err).split("\n")[0];
                EAction.handleUserWarning(
                    qsTr("Sign-in did not complete. %1").arg(line));
                return;
            }
            EAction.handleUserMessage(qsTr("Signed in to GitHub as %1.")
                .arg(CsHub.parseLogin(status)));
            // Re-run rather than skip: a fresh login needs the
            // credential helper wired.
            GitHubSetup.runAndReport(ghPath, CsHub.argvSetupGit(),
                qsTr("Configuring git's credential helper"));
            return;
        }

        if (waitedMs >= EXPIRY_MS) {
            if (teardown(true)) {
                dialog.reject();
                EAction.handleUserWarning(qsTr(
                    "The one-time code expired before sign-in completed. " +
                    "Use Sign in to GitHub to try again."));
            }
        }
    });

    timer.start(POLL_MS);
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
