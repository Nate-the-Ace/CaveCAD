// Pick.js -- turning the current selection into a starting point.
//
// Part of the Cave Survey Core library. QCAD context only.

var CsPick = {};

/**
 * Derives a start point from the drawing's selection.
 *
 * A selected POINT is used directly; if it's a tagged station its
 * name comes along and no duplicate marker should be drawn there.
 * A selected line/arc/polyline offers a choice of its endpoints
 * (via getItem, using "|" as the separator because the labels
 * contain commas). Anything else returns undefined and the caller
 * falls back to typed coordinates.
 *
 * \param title dialog title for the endpoint question
 * \return {pos, isExistingStation, existingName} or undefined
 */
CsPick.startPointFromSelection = function(doc, title) {
    if (!doc.hasSelection()) {
        return undefined;
    }
    var ids = doc.querySelectedEntities();
    if (ids.length !== 1) {
        return undefined; // ambiguous -- let the caller ask
    }
    var entity = doc.queryEntity(ids[0]);
    if (isNull(entity)) {
        return undefined;
    }

    if (typeof entity.getPosition === "function") {
        return {
            pos: entity.getPosition(),
            isExistingStation: true,
            existingName: CsTags.get(entity, "Station")
        };
    }

    if (typeof entity.getStartPoint === "function" &&
        typeof entity.getEndPoint === "function") {
        var p1 = entity.getStartPoint();
        var p2 = entity.getEndPoint();
        var labels = [
            "Point 1: (" + p1.x.toFixed(3) + ", " + p1.y.toFixed(3) + ")",
            "Point 2: (" + p2.x.toFixed(3) + ", " + p2.y.toFixed(3) + ")"
        ];
        var choice = getItem(title,
            "Start from which endpoint of the selected entity?",
            labels.join("|"), 0, "|");
        if (choice === undefined) {
            return undefined;
        }
        return {
            pos: (choice.indexOf("Point 1") === 0) ? p1 : p2,
            isExistingStation: false,
            existingName: ""
        };
    }

    return undefined;
};

/**
 * The single selected entity, or null (with a user-facing warning
 * naming the tool) when the selection isn't exactly one entity.
 */
CsPick.singleSelected = function(doc, toolName) {
    if (!doc.hasSelection()) {
        warning(toolName + ": select exactly one entity first.");
        return null;
    }
    var ids = doc.querySelectedEntities();
    if (ids.length !== 1) {
        warning(toolName + ": select exactly ONE entity (found " +
            ids.length + ").");
        return null;
    }
    var entity = doc.queryEntity(ids[0]);
    if (isNull(entity)) {
        warning(toolName + ": could not read the selected entity.");
        return null;
    }
    return entity;
};
