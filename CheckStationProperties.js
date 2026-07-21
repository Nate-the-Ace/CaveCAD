// CheckStationProperties.js
//
// Diagnostic: select a single STATIONS-layer point entity first, then
// run this script (Misc > Development > Run Script...). It prints
// whatever "CaveSurvey" custom properties are actually readable back
// off that entity to the command-line history at the bottom of the
// QCAD window -- this is a direct check of whether AzimuthTraverse.js's
// setCustomProperty() calls are actually taking effect, independent of
// whether QCAD's Property Editor panel happens to display them.

include("scripts/simple.js");

function checkStationProperties() {
    var doc = getDocument();
    if (doc === undefined) {
        warning("CheckStationProperties: no active drawing document.");
        return;
    }
    if (!doc.hasSelection()) {
        warning("CheckStationProperties: select one station point first, then run this script.");
        return;
    }
    var ids = doc.querySelectedEntities();
    if (ids.length !== 1) {
        warning("CheckStationProperties: select exactly one entity (you have " + ids.length + ").");
        return;
    }
    var entity = doc.queryEntity(ids[0]);
    if (isNull(entity)) {
        warning("CheckStationProperties: could not resolve the selected entity.");
        return;
    }

    if (typeof entity.getCustomProperty !== "function") {
        warning("CheckStationProperties: this entity has no getCustomProperty() method at all -- " +
            "custom properties are not supported on this entity/QCAD build.");
        return;
    }

    var keys = ["Station", "Inclination", "Left", "Right", "Up", "Down", "Elevation"];
    warning("---- CaveSurvey custom properties on selected entity ----");
    var foundAny = false;
    for (var i = 0; i < keys.length; i++) {
        try {
            var v = entity.getCustomProperty("CaveSurvey", keys[i], "<not set>");
            warning(keys[i] + " = " + v);
            if (v !== "<not set>") {
                foundAny = true;
            }
        } catch (e) {
            warning(keys[i] + " = <error reading: " + e + ">");
        }
    }
    if (!foundAny) {
        warning("---- No CaveSurvey properties found -- either setCustomProperty() " +
            "silently failed when this point was created, or this is not a point " +
            "created by AzimuthTraverse.js. ----");
    } else {
        warning("---- Properties ARE stored on the entity, even if not shown in the " +
            "Property Editor panel. ----");
    }
}

checkStationProperties();
