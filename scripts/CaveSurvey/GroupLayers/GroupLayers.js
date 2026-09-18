/**
 * GroupLayers.js
 *
 * File this drawing's layers into starter groups for the Layer Manager.
 *
 *   Cave Survey > Group Layers   (or type "gl")
 *
 * A cave drawing opens with over 150 layers in one Ungrouped heap.
 * Groups in the Layer Manager are arbitrary and hand-made by design, but
 * nobody should have to file 150 layers before the palette is worth
 * opening. This makes the first six -- Plan, Profile, Sections, Survey
 * control, Scans & basemap, Sheet -- and files every layer into one.
 *
 * IT ONLY ADDS. Re-running it picks up layers created since the last run
 * (per-run profile variants, a new section) and leaves every group you
 * made by hand, and every layer you filed by hand, exactly as they were.
 * There is no "reset to defaults", because the groups are yours the
 * moment the tool has run once.
 *
 * The rules -- which group a layer belongs in, and why notes do not get
 * one of their own -- are in Core/CsLayerGroups.js and are tested under
 * node. This file is the walk, the write and the report.
 *
 * THE STORE BELONGS TO CAVECAD, NOT TO THIS SUITE. Group membership
 * lives in the Layer Manager's own document registry (LayerGroups in
 * scripts/Widgets/LayerManager), so a caver can edit it in the palette
 * afterwards and nothing here owns it. That also means this tool cannot
 * run without that palette, and says so rather than failing quietly.
 */
include("scripts/EAction.js");
// simple.js defines getDocument() and getDocumentInterface() and nothing
// else does. Without it the menu entry appears, is enabled, and does
// nothing at all when clicked.
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

function GroupLayers(guiAction) {
    EAction.call(this, guiAction);
}

GroupLayers.prototype = new EAction();

GroupLayers.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    groupLayersRun();
    this.terminate();
};

/**
 * \return The Layer Manager's group model, or undefined if this build of
 * CaveCAD does not carry the palette.
 *
 * Checked by name rather than assumed: the suite installs into stock
 * QCAD as well, where there is no Layer Manager, and a ReferenceError
 * from a menu entry tells a caver nothing.
 */
GroupLayers.model = function() {
    if (typeof LayerGroups === "undefined") {
        return undefined;
    }
    return LayerGroups;
};

/**
 * Files every layer in \c doc into its starter group.
 *
 * Split out from the dialog so the engine test can call it against a
 * fixture document and read the counts back.
 *
 * NOT named apply(). GroupLayers is a function object and Function
 * carries its own apply, so the assignment does not take and the call
 * lands in Function.prototype.apply -- which returns undefined and
 * reports nothing. The same trap waits on call, bind and name; there is
 * a test in test_addon.py that now refuses all four.
 *
 * \return { groups: n, filed: n, already: n } or undefined if the
 * palette is missing.
 */
GroupLayers.fileAll = function(doc) {
    var model = GroupLayers.model();
    if (model === undefined) {
        return undefined;
    }

    var names = model.layerNamesOf(doc);
    var reg = model.readRegistry(doc);

    // Every group first, in CsLayerGroups' order, so the palette shows
    // them in that order even when one of them is still empty.
    var i;
    var created = 0;
    for (i = 0; i < CsLayerGroups.GROUPS.length; i++) {
        if (model.createGroup(reg, CsLayerGroups.GROUPS[i])) {
            created++;
        }
    }

    var filed = 0;
    var already = 0;
    for (i = 0; i < names.length; i++) {
        var group = CsLayerGroups.classify(names[i]);
        if (model.addTo(reg, names[i], group)) {
            filed++;
        } else {
            already++;
        }
    }

    model.writeRegistry(doc, reg);
    return { groups: created, filed: filed, already: already };
};

function groupLayersRun() {
    var win = RMainWindowQt.getMainWindow();
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        return;
    }

    // A sheet is rebuilt from the cave's record every time Sheet Setup
    // runs, so anything written into one is lost without warning. The
    // groups are small, but the rule is "every tool that writes checks",
    // and an exception argued case by case is how the rule stops being
    // one.
    if (CsSheetFile.blocks(doc, "Group Layers")) {
        return;
    }

    if (GroupLayers.model() === undefined) {
        QMessageBox.warning(win, qsTr("Group Layers"),
            qsTr("This build has no Layer Manager palette, so there is " +
                 "nowhere to put the groups."));
        return;
    }

    var result = GroupLayers.fileAll(doc);

    // Repaint the palette: the registry changed under it and nothing
    // else will tell it. notifyLayerListeners is the same door the layer
    // list itself refreshes through.
    win.notifyLayerListeners(getDocumentInterface(), []);

    var message;
    if (result.filed === 0) {
        message = qsTr("Every layer was already filed. Nothing changed.");
    } else {
        message = qsTr("Filed") + " " + result.filed + " " +
            qsTr("layers into") + " " + CsLayerGroups.GROUPS.length + " " +
            qsTr("groups.");
        if (result.already > 0) {
            message += "\n\n" + result.already + " " +
                qsTr("were already filed and were left alone.");
        }
    }
    message += "\n\n" + qsTr("Open the Layer Manager to see them, and " +
        "change them however you like -- this tool never takes a layer " +
        "out of a group you put it in.");

    QMessageBox.information(win, qsTr("Group Layers"), message);
}

GroupLayers.init = function(basePath) {
    var action = new RGuiAction(qsTr("Group Layers"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/GroupLayers.js");
    action.setIcon(basePath + "/GroupLayers.svg");
    action.setStatusTip(qsTr("File this drawing's layers into starter " +
        "groups for the Layer Manager"));
    action.setDefaultCommands(["grouplayers", "gl"]);
    // "Fix and share", beside Check Map and Repair Drawing: it tidies a
    // drawing that already exists rather than adding anything to it.
    action.setGroupSortOrder(455);
    action.setSortOrder(7);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
