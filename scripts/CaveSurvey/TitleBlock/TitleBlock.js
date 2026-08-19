// TitleBlock.js
//
// QCAD add-on tool: fill in the map sheet's title block, one field at
// a time, with the convention behind each field explained as you go.
//
// The fields are the NSS Cartography Salon core elements (see
// Core/Sheet.js) mapped onto the template's TB_* blocks. Current
// values are shown as the defaults, so re-running edits rather than
// retypes. All edits land as ONE undo step.
//
// USAGE:
//   Cave Survey > Title Block   (or type "tb")
//
// Needs a drawing started from the NSS template (that's where the
// TB_* blocks live). Without them the tool says so and stops --
// it will not scatter loose text pretending to be a title block.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/All.js");

function titleBlockRun() {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        warning("Title Block: no active drawing document.");
        return;
    }

    // Which fields does this drawing actually have?
    var present = [];
    for (var i = 0; i < CsSheet.FIELDS.length; i++) {
        if (CsSheet.textEntitiesInBlock(doc, CsSheet.FIELDS[i].block).length > 0) {
            present.push(CsSheet.FIELDS[i]);
        }
    }
    if (present.length === 0) {
        warning("Title Block: no TB_* title block fields found.\n" +
            "Start the map from templates/NSS_Cave_Template_PLAN.dxf -- " +
            "the title block lives there.");
        return;
    }

    var op = new RModifyObjectsOperation();
    op.setText("Title block");
    var changed = 0;

    for (i = 0; i < present.length; i++) {
        var field = present[i];
        var currentValue = CsSheet.readField(doc, field);
        var promptText = field.label +
            (field.required ? "  [required element]" : "  [recommended]") +
            "\n" + field.hint + "\n(Cancel skips this field)";
        var value = getText("Title Block", promptText, currentValue);
        if (value === undefined) {
            continue; // skipped
        }
        if (value !== currentValue) {
            if (CsSheet.writeField(doc, op, field, value)) {
                changed++;
            }
        }
    }

    if (changed > 0) {
        getDocumentInterface().applyOperation(op);
        EAction.handleUserMessage("Title Block: " + changed + " field" +
            (changed === 1 ? "" : "s") + " updated (one undo step). " +
            "Run Sheet Check to see what a judge would still mark missing.");
    } else {
        EAction.handleUserMessage("Title Block: nothing changed.");
    }
}

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

function TitleBlock(guiAction) {
    EAction.call(this, guiAction);
}

TitleBlock.prototype = new EAction();

TitleBlock.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    titleBlockRun();
    this.terminate();
};

TitleBlock.init = function(basePath) {
    var action = new RGuiAction(qsTr("Title Block"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/TitleBlock.js");
    action.setIcon(basePath + "/TitleBlock.svg");
    action.setStatusTip(qsTr("Fill in the sheet's title block -- every required element, with its convention explained"));
    action.setDefaultCommands(["titleblock", "tb"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(75);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
