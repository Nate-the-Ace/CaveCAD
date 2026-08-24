// All.js -- includes the whole Core library in dependency order.
//
// Tools include this one file instead of maintaining their own list:
//
//   include(includeBasePath + "/../Core/CsAll.js");
//
// (Deliberately NOT named Core.js: a file named after its folder is
// how QCAD recognises a TOOL, and Core is a library.)
//
// EVERY library file is Cs-prefixed because CaveCAD's include() DEDUPES
// BY BASENAME: a file sharing a name with anything the application has
// already included -- and it includes hundreds of scripts at startup,
// among them Draw.js -- is skipped SILENTLY. That shipped as CsDraw
// being undefined in the GUI while every test passed headless (where
// no stock add-ons load). The prefix makes collision impossible.

include(includeBasePath + "/CsUnits.js");
include(includeBasePath + "/CsCave.js");
include(includeBasePath + "/CsGeoProject.js");
include(includeBasePath + "/CsAngles.js");
include(includeBasePath + "/CsIgrfCoeffs.js");
include(includeBasePath + "/CsGeomag.js");
include(includeBasePath + "/CsModel.js");
include(includeBasePath + "/CsTraverse.js");
include(includeBasePath + "/CsNetwork.js");
include(includeBasePath + "/CsAdjust.js");
include(includeBasePath + "/CsLrud.js");
// The extended elevation: CsProfile (pure geometry) needs CsLrud above
// for splaysByStation/legCounts; CsProfileDraw needs CsLayers/CsTags/
// CsDraw, but only inside function BODIES (RVector, RLineEntity, ...),
// never at load time -- defining a function that REFERENCES a Cs*
// global does not touch that global until the function actually runs,
// so this placement matches tests/js_unit.js's own CORE_FILES order
// (which loads these three right after CsLrud, well before CsLayers/
// CsTags/CsDraw) rather than needing to sit after them here too.
include(includeBasePath + "/CsProfile.js");
include(includeBasePath + "/CsProfileDraw.js");
include(includeBasePath + "/CsValidate.js");
include(includeBasePath + "/CsStats.js");
include(includeBasePath + "/CsGrade.js");
include(includeBasePath + "/Format/CsCompass.js");
include(includeBasePath + "/Format/CsWalls.js");
include(includeBasePath + "/Format/CsSurvex.js");
include(includeBasePath + "/Format/CsCsv.js");
include(includeBasePath + "/Format/CsRegistry.js");
include(includeBasePath + "/CsLayers.js");
include(includeBasePath + "/CsLayerVariants.js");
include(includeBasePath + "/CsTrace.js");
include(includeBasePath + "/CsStore.js");
include(includeBasePath + "/CsTags.js");
// CsBind before CsDraw: eraseStations calls CsBind's suffix strippers,
// so the erase rules and the binding index cannot disagree about which
// station a tip name belongs to.
include(includeBasePath + "/CsBind.js");
include(includeBasePath + "/CsDraw.js");
include(includeBasePath + "/CsRevise.js");
// After both CsBind and CsRevise: CsProfileBind calls into each.
include(includeBasePath + "/CsProfileBind.js");
include(includeBasePath + "/CsPick.js");
include(includeBasePath + "/CsLocationPick.js");
include(includeBasePath + "/CsSymbols.js");
include(includeBasePath + "/CsSheet.js");
include(includeBasePath + "/CsReport.js");
// After CsModel, CsTraverse, CsProfile and (optionally) CsRevise --
// CsContrib calls ensureTrips, offset, groupRuns and tripLabel.
include(includeBasePath + "/CsContrib.js");
