// All.js -- includes the whole Core library in dependency order.
//
// Tools include this one file instead of maintaining their own list:
//
//   include(includeBasePath + "/../Core/All.js");
//
// (Deliberately NOT named Core.js: a file named after its folder is
// how QCAD recognises a TOOL, and Core is a library.)

include(includeBasePath + "/Units.js");
include(includeBasePath + "/Angles.js");
include(includeBasePath + "/IgrfCoeffs.js");
include(includeBasePath + "/Geomag.js");
include(includeBasePath + "/Model.js");
include(includeBasePath + "/Traverse.js");
include(includeBasePath + "/Network.js");
include(includeBasePath + "/Lrud.js");
include(includeBasePath + "/Validate.js");
include(includeBasePath + "/Stats.js");
include(includeBasePath + "/Grade.js");
include(includeBasePath + "/Format/Compass.js");
include(includeBasePath + "/Format/Walls.js");
include(includeBasePath + "/Format/Survex.js");
include(includeBasePath + "/Format/Csv.js");
include(includeBasePath + "/Format/Registry.js");
include(includeBasePath + "/Layers.js");
include(includeBasePath + "/Tags.js");
include(includeBasePath + "/Draw.js");
include(includeBasePath + "/Pick.js");
include(includeBasePath + "/LocationPick.js");
include(includeBasePath + "/Symbols.js");
include(includeBasePath + "/Sheet.js");
include(includeBasePath + "/Report.js");
