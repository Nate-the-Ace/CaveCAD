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
include(includeBasePath + "/CsGeoProject.js");
include(includeBasePath + "/CsAngles.js");
include(includeBasePath + "/CsIgrfCoeffs.js");
include(includeBasePath + "/CsGeomag.js");
include(includeBasePath + "/CsModel.js");
include(includeBasePath + "/CsTraverse.js");
include(includeBasePath + "/CsNetwork.js");
include(includeBasePath + "/CsLrud.js");
include(includeBasePath + "/CsValidate.js");
include(includeBasePath + "/CsStats.js");
include(includeBasePath + "/CsGrade.js");
include(includeBasePath + "/Format/CsCompass.js");
include(includeBasePath + "/Format/CsWalls.js");
include(includeBasePath + "/Format/CsSurvex.js");
include(includeBasePath + "/Format/CsCsv.js");
include(includeBasePath + "/Format/CsRegistry.js");
include(includeBasePath + "/CsLayers.js");
include(includeBasePath + "/CsStore.js");
include(includeBasePath + "/CsTags.js");
// CsBind before CsDraw: eraseStations calls CsBind's suffix strippers,
// so the erase rules and the binding index cannot disagree about which
// station a tip name belongs to.
include(includeBasePath + "/CsBind.js");
include(includeBasePath + "/CsDraw.js");
include(includeBasePath + "/CsRevise.js");
include(includeBasePath + "/CsPick.js");
include(includeBasePath + "/CsLocationPick.js");
include(includeBasePath + "/CsSymbols.js");
include(includeBasePath + "/CsSheet.js");
include(includeBasePath + "/CsReport.js");
