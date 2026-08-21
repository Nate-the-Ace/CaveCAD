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
include("scripts/simple.js");
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
    var body = lines.join("\n");

    var failure = CsSetup.firstFailure(rungs);

    // QMessageBox for the multi-line body, NEVER EAction.handleUserMessage/
    // handleUserWarning for it -- traced through the CaveCAD source:
    // EAction.handleUserMessage/handleUserWarning -> RMainWindowQt's
    // handleUserMessage -> emit userMessage -> CommandLine.js does
    // RS.escape(message) (QString::toHtmlEscaped, which does NOT turn
    // "\n" into "<br>") and then appendAndScroll("<span>" + message +
    // "</span>"). The <span> makes Qt treat the whole thing as RICH
    // TEXT, and rich text collapses every "\n" -- and the "      "
    // remedy indent -- to a single space. Six rungs plus remedies
    // would arrive as one unreadable smear, which is this tool's
    // entire deliverable. QMessageBox renders plain text with real
    // line breaks, and is already this suite's precedent for a
    // multi-line report (SheetCheck.js, SurveyStats.js). DO NOT
    // "simplify" either branch below back to a handleUserMessage/
    // handleUserWarning newline string.
    if (failure === null) {
        QMessageBox.information(getMainWindow(), qsTr("GitHub Setup"), body);
        // A one-line summary too -- that is what the command line is
        // good at.
        EAction.handleUserMessage(qsTr("GitHub setup: ready."));
        return;
    }

    QMessageBox.warning(getMainWindow(), qsTr("GitHub Setup"), body);
    EAction.handleUserWarning(qsTr("GitHub setup is incomplete."));

    // Only the rungs this tool can act on get an offer; an install is
    // the user's to run, and the plugin never downloads an installer.
    if (failure.id === "auth") {
        // NOT on cause alone: CsSetup.RUNGS separates three causes
        // behind the SAME "auth" id (CsSetup.AUTH_CAUSE_USAGE_ERROR,
        // _NETWORK_FAILURE, _NOT_AUTHENTICATED) precisely because the
        // remedy differs. A GUI review caught this branching on
        // `failure.id === "auth"` alone: an offline caver got the
        // correct warning text ("Authenticating again will not fix a
        // machine that is offline") from the QMessageBox above, and
        // THEN a sign-in dialog anyway, stuck forever on "Starting..."
        // because nothing was ever going to print a code on a machine
        // with no network. Only the one cause a sign-in dialog can
        // actually fix gets the offer; the other two already got
        // their answer in the box above.
        if (failure.cause === CsSetup.AUTH_CAUSE_NOT_AUTHENTICATED) {
            GitHubSetup.offerSignIn(tools.ghPath);
        }
    } else if (failure.id === "scope") {
        // NOT runAndReport: `gh auth refresh -s repo` is a DEVICE-FLOW
        // command exactly like `gh auth login --web` (`gh auth refresh
        // --help` lists `-c, --clipboard  Copy one-time OAuth device
        // code to clipboard`, the same tell). Routing it through
        // runAndReport's blocking CsProc.run would freeze the window
        // for up to a minute AND never show the one-time code, which
        // would land in the captured stdout instead of on screen.
        GitHubSetup.offerScopeRefresh(tools.ghPath, "repo");
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

// Set while a device-flow dialog is open; cleared in runDeviceFlow's
// own teardown(). See that function's docstring for the re-entrancy
// hazard this exists to close.
GitHubSetup.activeFlow = false;

/**
 * Drives ANY gh device-flow command from inside CaveCAD: the one-time
 * code on screen, the device URL a click away, and a Cancel that
 * reaches the real child process rather than orphaning it.
 *
 * Both callers below are device-flow commands, confirmed the same
 * way: `gh auth login --web` (offerSignIn) was probed live with no
 * TTY on 2026-08-20 and does exactly this; `gh auth refresh -s <scope>`
 * (offerScopeRefresh) was confirmed by reading `gh auth refresh
 * --help`, which lists `-c, --clipboard  Copy one-time OAuth device
 * code to clipboard` -- the same tell, without ever running the
 * command (running it would mutate the token's scopes). Both print a
 * one-time code and a device URL, then block polling GitHub, so both
 * need exactly this presentation -- routing either through a plain
 * blocking CsProc.run (as the ladder's non-device-flow remedies
 * correctly do for `gh auth setup-git`) would freeze the window for
 * up to a minute and never show the code the user actually needs.
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
 *
 * onFinished(loginResult, dialog) runs on exactly the path that never
 * killed the child -- natural completion -- with the process's own
 * {code, out, err, notStarted}. Cancel, the native close box, and the
 * 15-minute expiry never call onFinished at all: there is nothing for
 * a caller to act on when this function is the one that chose to end
 * the process. The dialog is handed to onFinished STILL OPEN, showing
 * "Checking with GitHub..." -- onFinished's own status re-check is a
 * real (if short) network round trip, and a GUI review found the
 * previous version closing the dialog first, so that wait had no
 * visible cause on screen. onFinished must call dialog.accept() (or
 * .reject()) itself once it is actually done.
 *
 * loginResult.notStarted is true when gh never ran at all (a bad
 * path): proc.error() and proc.exitCode() were probed live in this
 * engine against a nonexistent binary specifically for this fix (no
 * gh, no git, no network involved) rather than trusted from Qt's
 * documented behaviour -- QProcess.FailedToStart and QProcess.
 * NotRunning both measured as 0 here, and exitCode() measured as 255,
 * NOT the 0 a naive reading of the Qt docs would predict. Regardless
 * of that number, a FailedToStart process must never be reported as
 * ordinary success or a login-shaped failure -- onFinished gets
 * `{code: -1, notStarted: true, err: proc.errorString()}` instead of
 * whatever the raw (and here, misleading) exitCode() would have said.
 */
GitHubSetup.runDeviceFlow = function(ghPath, argv, dialogTitle, helpText, onFinished) {
    // A device-flow child polls GitHub for up to 15 minutes with a
    // live one-time code on screen; this dialog is non-modal (the
    // only one in this suite -- every other is dlg.exec(), e.g.
    // SurveyNotebook.js:2267/2684) so beginEvent()/terminate() return
    // immediately and the menu item is clickable again long before
    // that. A GUI review flagged the result: a second click starts a
    // SECOND `gh auth login`/`gh auth refresh` writing the same gh
    // config, with two different one-time codes on screen. This guard
    // (cleared in teardown) refuses a second flow instead.
    if (GitHubSetup.activeFlow) {
        EAction.handleUserWarning(qsTr(
            "A GitHub sign-in or scope request is already in progress. " +
            "Finish or cancel it first."));
        return;
    }
    GitHubSetup.activeFlow = true;

    var proc = new QProcess();
    var dialog = new QDialog(getMainWindow());
    dialog.windowTitle = dialogTitle;

    var layout = new QVBoxLayout();

    // A read-only QLineEdit, not a QLabel: the code needs to be
    // SELECTABLE. A GUI review noted that offerScopeRefresh's argv has
    // no --clipboard (only argvDeviceLogin does), so in that flow the
    // code reaching the clipboard at all depends on this being
    // something the caver can actually select and copy by hand.
    // readOnly, not disabled, so it stays focusable/selectable --
    // precedent at SurveyNotebook.js:2846/2869.
    var codeEdit = new QLineEdit(qsTr("Starting..."));
    codeEdit.readOnly = true;
    var font = codeEdit.font;
    // Math.max, not a bare "+ 10": pointSize() reports -1 for a font
    // sized in pixels rather than points, and -1 + 10 is a SMALLER,
    // harder-to-read 9pt label -- the opposite of the enlargement this
    // line exists to do.
    font.setPointSize(Math.max(font.pointSize(), 10) + 10);
    font.setBold(true);
    codeEdit.font = font;
    layout.addWidget(codeEdit);

    var help = new QLabel(helpText);
    help.wordWrap = true;
    layout.addWidget(help);

    var openButton = new QPushButton(qsTr("Open github.com/login/device"));
    layout.addWidget(openButton);
    var cancelButton = new QPushButton(qsTr("Cancel"));
    layout.addWidget(cancelButton);
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

    var teardown = function(killChild) {
        if (settled) {
            return false;
        }
        settled = true;
        GitHubSetup.activeFlow = false;
        try { timer.stop(); } catch (e) {}
        if (killChild) {
            // Kill, not terminate, and never conditioned on whether gh
            // has already exited on its own -- an orphaned gh keeps
            // polling GitHub after this window is gone, and kill() on
            // an already-finished process is a harmless no-op.
            try { proc.kill(); } catch (e2) {}
            // Reap it: CsProc's own real backend does the same
            // waitForFinished() after its kill() (CsProc.js), and
            // this proc is held only by these closures, so nothing
            // else will ever collect it otherwise.
            try { proc.waitForFinished(1000); } catch (e3) {}
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

    proc.start(ghPath, argv);
    dialog.show();

    timer.timeout.connect(function() {
        // Broad but cheap, following CaveMode.js's own timer callback:
        // an unexpected throw here must not propagate out of a signal
        // handler into who-knows-where. waitedMs is the only variable
        // that HAS to survive a bad tick for the 15-minute bound to
        // keep holding, and it is read fresh on every call regardless
        // of what a previous tick did.
        try {
            if (settled) {
                return;
            }
            waitedMs += POLL_MS;

            // Never blocks: drains whatever gh has written since the
            // last tick. This is the entire reason a timer replaced
            // the draft's waitForFinished() loop.
            collected.out += new QTextStream(proc.readAllStandardOutput()).readAll();
            collected.err += new QTextStream(proc.readAllStandardError()).readAll();

            if (!codeShown) {
                var code = CsSetup.readDeviceCode(collected);
                if (code !== null) {
                    codeEdit.text = code;
                    codeShown = true;
                    // Open automatically, once, the moment there is a
                    // code worth entering -- a GUI review noted the
                    // help text told the caver a browser "opens", but
                    // nothing ever actually opened one; only the Open
                    // button did, and only if clicked. Kept as a
                    // fallback below too, in case this silently fails.
                    try {
                        QDesktopServices.openUrl(new QUrl(deviceUrl));
                    } catch (eOpen) {
                    }
                }
            }
            var seenUrl = CsSetup.parseDeviceUrl(collected.out + "\n" + collected.err);
            if (seenUrl !== CsSetup.DEVICE_URL) {
                deviceUrl = seenUrl;
            }

            // proc.state(), never proc.waitForFinished(): the latter
            // blocks the caller for up to its argument; the former
            // just reports what QProcess already knows. Checked
            // BEFORE the expiry test below so a process that finishes
            // right at the 15-minute boundary is read normally, not
            // killed for "expiring" a moment after it actually
            // succeeded.
            if (proc.state() === QProcess.NotRunning) {
                if (!teardown(false)) {
                    return;
                }
                // Read error()/exitCode()/errorString() ONLY here, on
                // the one path that never calls kill() -- see the
                // kill-before-read hazard in this function's
                // docstring, and see the docstring above for why
                // error()/exitCode() were probed live rather than
                // trusted from documentation.
                var failedToStart = (proc.error() === QProcess.FailedToStart);
                // Keep the dialog up: onFinished still has its own
                // network round trip (a fresh `gh auth status`) before
                // there is anything to report, and closing the window
                // first would leave that wait with no visible cause.
                codeEdit.text = qsTr("Checking with GitHub...");
                try { openButton.enabled = false; } catch (e4) {}
                try { cancelButton.enabled = false; } catch (e5) {}
                onFinished({
                    code: failedToStart ? -1 : proc.exitCode(),
                    out: collected.out,
                    err: failedToStart ? proc.errorString() : collected.err,
                    notStarted: failedToStart
                }, dialog);
                return;
            }

            if (waitedMs >= EXPIRY_MS) {
                if (teardown(true)) {
                    dialog.reject();
                    EAction.handleUserWarning(qsTr(
                        "The one-time code expired before this finished. Try again."));
                }
            }
        } catch (eTick) {
            // Leave the dialog and the timer alone on any failure --
            // the next tick, or Cancel, or the 15-minute expiry, still
            // gets a chance to end this cleanly.
        }
    });

    timer.start(POLL_MS);
};

// Appended to a remedy's own success message so a fresh machine does
// not need up to six separate trips through the menu with no hint
// that another is required -- a GUI review found rungs 4-6 left
// reported "--" (not evaluated) after sign-in or a scope grant with
// nothing saying the ladder needed re-checking. This is deliberately
// NOT a re-entry into showLadder() itself: doing that from inside a
// signal handler would nest a modal QMessageBox in a callback and
// re-run the (network-bearing) probes right there, which is the exact
// blocking-on-the-GUI-thread problem this same review round fixed
// elsewhere.
GitHubSetup.RUN_AGAIN_HINT = " Run GitHub Setup again to check the remaining steps.";

/**
 * The auth rung's remedy: `gh auth login --web`. See runDeviceFlow's
 * docstring for the shared presentation and its design notes.
 */
GitHubSetup.offerSignIn = function(ghPath) {
    if (CsSetup.isBlank(ghPath)) {
        return;
    }
    GitHubSetup.runDeviceFlow(ghPath, CsSetup.deviceLoginArgv(),
        qsTr("Sign in to GitHub"),
        qsTr("Your browser should open automatically with this page ready. If it does not, click Open github.com/login/device below, then enter the code shown above."),
        function(loginResult, dialog) {
            if (loginResult.notStarted === true) {
                dialog.accept();
                EAction.handleUserWarning(
                    qsTr("gh could not be started at %1. You can also " +
                         "run \"gh auth login\" yourself in a terminal, " +
                         "which finds gh through your normal PATH rather " +
                         "than this stored location.").arg(ghPath));
                return;
            }
            // Requires a passing `gh auth status`, not just exit 0 --
            // see CsSetup.loginSucceeded's own docstring.
            var status = CsProc.run(ghPath, CsHub.argvAuthStatus());
            dialog.accept();
            if (!CsSetup.loginSucceeded(loginResult, status)) {
                // The LAST meaningful line, not the first: loginResult.err
                // is the device-flow child's WHOLE accumulated stream,
                // which starts with gh's own one-time-code banner --
                // split("\n")[0] on that is an empty string (the
                // fixture's leading "\n") every single time, which is
                // why an earlier version of this line always fell
                // through to the generic fallback below regardless of
                // what gh actually said.
                var line = CsSetup.deviceFlowFailureLine(
                    loginResult.out + "\n" + loginResult.err) ||
                    qsTr("no further detail was reported.");
                // The device flow failing is not a dead end: the
                // token-paste fallback the design spec mentions was
                // deliberately deferred to slice 2 (unverified masked-
                // input behaviour under this bridge), not dropped --
                // this names the one alternative that already exists
                // today, gh itself, so a caver is never left with
                // nothing to try next.
                EAction.handleUserWarning(
                    qsTr("Sign-in did not complete. %1 You can also run " +
                         "\"gh auth login\" yourself in a terminal.").arg(line));
                return;
            }
            // parseLogin can still be null even when isAuthenticated
            // (inside loginSucceeded) is true -- the two use different
            // regexes ("Logged in to " vs. "account (\S+)") -- so this
            // needs its own fallback rather than risking ".arg(null)"
            // or an outright throw inside this signal handler, which
            // would also skip the setup-git call just below.
            var login = CsHub.parseLogin(status);
            EAction.handleUserMessage(qsTr("Signed in to GitHub as %1.")
                .arg(CsSetup.isBlank(login) ? qsTr("your GitHub account") : login));
            // Re-run rather than skip: a fresh login needs the
            // credential helper wired. Its own success message carries
            // the "run again" hint, since it is the last thing this
            // flow prints.
            GitHubSetup.runAndReport(ghPath, CsHub.argvSetupGit(),
                qsTr("Configuring git's credential helper"));
        });
};

/**
 * The scope rung's remedy: `gh auth refresh -s <scope>`. Also a
 * device-flow command -- see runDeviceFlow's docstring -- so it gets
 * the identical dialog, not GitHubSetup.runAndReport's blocking wait.
 * Success here means the token now actually CARRIES the requested
 * scope, not merely that gh exited 0 -- CsSetup.scopeRefreshSucceeded
 * checks `scope` itself rather than a hardcoded "repo", so a future
 * caller asking for a different scope (CsHub.SCOPES is already
 * "repo,read:org") is checked against what it actually asked for.
 */
GitHubSetup.offerScopeRefresh = function(ghPath, scope) {
    if (CsSetup.isBlank(ghPath) || CsSetup.isBlank(scope)) {
        return;
    }
    GitHubSetup.runDeviceFlow(ghPath, CsHub.argvRefreshScope(scope),
        qsTr("Grant GitHub access"),
        qsTr("Your browser should open automatically with this page ready. If it does not, click Open github.com/login/device below, then enter the code shown above."),
        function(loginResult, dialog) {
            if (loginResult.notStarted === true) {
                dialog.accept();
                EAction.handleUserWarning(
                    qsTr("gh could not be started at %1. You can also " +
                         "run \"gh auth refresh -s %2\" yourself in a " +
                         "terminal, which finds gh through your normal " +
                         "PATH rather than this stored location.")
                        .arg(ghPath).arg(scope));
                return;
            }
            var status = CsProc.run(ghPath, CsHub.argvAuthStatus());
            dialog.accept();
            if (!CsSetup.scopeRefreshSucceeded(loginResult, status, scope)) {
                var line = CsSetup.deviceFlowFailureLine(
                    loginResult.out + "\n" + loginResult.err) ||
                    qsTr("no further detail was reported.");
                // See offerSignIn's matching comment: not a dead end --
                // gh itself, run directly, is always the alternative.
                EAction.handleUserWarning(
                    qsTr("Requesting the %1 scope did not complete. %2 " +
                         "You can also run \"gh auth refresh -s %1\" " +
                         "yourself in a terminal.").arg(scope).arg(line));
                return;
            }
            EAction.handleUserMessage(qsTr("The %1 scope has been granted.")
                .arg(scope) + GitHubSetup.RUN_AGAIN_HINT);
        });
};

GitHubSetup.runAndReport = function(prog, argv, what) {
    if (CsSetup.isBlank(prog)) {
        return false;
    }
    // 10s, not CsProc's 30s default: every command this is used for
    // (`gh auth setup-git`) is a local git-config write, never a
    // network call -- a GUI review found the previous 60s ceiling
    // giving a purely local operation the same budget as a call that
    // actually talks to GitHub.
    var r = CsProc.run(prog, argv, { timeoutMs: 10000 });
    if (r.code === 0) {
        EAction.handleUserMessage(what + ": " + qsTr("done.") +
            GitHubSetup.RUN_AGAIN_HINT);
        return true;
    }
    // Shortest decisive line, with the whole output in cave-git.log.
    // r.err is already a string -- CsProc.run guarantees it -- so no
    // String() wrap here; the fallback avoids a dangling colon with
    // nothing after it when stderr came back empty.
    var line = r.err.split("\n")[0] || qsTr("no further detail was reported.");
    EAction.handleUserWarning(what + ": " + line);
    return false;
};

GitHubSetup.setIdentity = function(gitPath, ghPath) {
    if (CsSetup.isBlank(gitPath) || CsSetup.isBlank(ghPath)) {
        return;
    }
    var user = CsHub.parseApiUser(CsProc.run(ghPath, CsHub.argvApiUser()));
    if (user === null) {
        EAction.handleUserWarning(qsTr("Could not read your GitHub account."));
        return;
    }
    // GLOBAL, not local, and confirmed before writing: CsProc has no
    // working-directory option (see its own docstring), so a "local"
    // git config write from here lands in CaveCAD's own process cwd
    // (".../CaveCAD.app/Contents/Resources" on macOS, measured live),
    // not in any survey repository -- there IS no repository in scope
    // in slice 1, since that only exists from slice 2's clone step
    // onward. The only identity write that can actually succeed here
    // is therefore the account-wide one, so it is confirmed first, the
    // same as any other account-wide change (QMessageBox.question,
    // precedent at SurveyStats.js:55 and Core/CsLocationPick.js:90).
    var email = CsHub.noreplyEmail(user);
    var answer = QMessageBox.question(getMainWindow(), qsTr("GitHub Setup"),
        qsTr("Set your GLOBAL git commit identity (used by every " +
             "repository on this computer) to %1 <%2>?")
            .arg(user.name).arg(email),
        QMessageBox.Yes | QMessageBox.No);
    if (answer !== QMessageBox.Yes) {
        return;
    }
    var plan = CsSetup.identityPlan(user, true);
    if (plan.length === 0) {
        EAction.handleUserWarning(
            qsTr("Could not determine a commit identity from your GitHub account."));
        return;
    }
    // Each write's own exit code is checked -- an earlier version
    // ignored both and unconditionally reported success, so the rung
    // would fail again next session while the tool insisted it had
    // already been fixed.
    for (var i = 0; i < plan.length; i++) {
        var r = CsProc.run(gitPath, plan[i]);
        if (r.code !== 0) {
            var line = r.err.split("\n")[0] || qsTr("no further detail was reported.");
            EAction.handleUserWarning(
                qsTr("Setting the commit identity failed. %1").arg(line));
            return;
        }
    }
    // No "for this repository": there is no repository in scope, see
    // this function's own comment above.
    EAction.handleUserMessage(qsTr("Commit identity set to %1 <%2>.")
        .arg(user.name).arg(email) + GitHubSetup.RUN_AGAIN_HINT);
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
