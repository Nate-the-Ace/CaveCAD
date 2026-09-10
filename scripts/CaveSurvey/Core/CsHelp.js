// CsHelp.js -- what each symbol and each traced feature MEANS, in the
// words a caver who has never drawn a map would need.
//
// Part of the Cave Survey Core library. Pure data and lookups: no
// document, no widget, nothing to run.
//
// WHY IT EXISTS. The palettes name a symbol and say which layer it
// lands on. That is enough for someone who already knows the NSS set
// and useless to everyone else -- "Rimstone dam" tells a beginner
// nothing about which way the scallops face, and facing them the wrong
// way is a map that says the water runs uphill. The names were never
// the hard part; the CONVENTIONS are, and they were only ever written
// down in a paper standard nobody has open while they draw.
//
// TWO FIELDS, deliberately:
//
//   means  what the thing IS. One sentence, no jargon, present tense.
//          The legend prints this and nothing else -- a legend is a
//          statement about the map, not a tutorial.
//   rule   the convention that is easy to get backwards, or "" when
//          the symbol has none worth stating. The panels show it
//          emphasised, because it is the half that gets a map marked
//          down. Never restate `means` here.
//
// A `rule` that says "point it downhill" is a promise about the
// SYMBOL's own drawn orientation, so it has to match what the tools
// actually draw. Where a rule describes generated ornament (the shaped
// lines), the truth lives in CsShapeLine and this file follows it.
//
// COVERAGE IS TESTED. tests/js_unit.js asserts every CsSymbols.CATALOG
// block and every FeatureTrace row has an entry here, and that this
// file holds no key nothing points at -- a symbol added without help
// text fails the suite rather than shipping a blank tooltip.
//
// CUSTOM SYMBOLS have no entry and never will: a caver's own symbol
// means whatever they drew it to mean. Lookups answer null, and the
// callers print what they always printed.

var CsHelp = {};

/**
 * The shipped symbol catalogue, keyed by block name.
 *
 * Ordered as CsSymbols.CATALOG is, so the two read side by side.
 */
CsHelp.SYMBOL = {
    "SYM_ENTRANCE": {
        means: "Where the cave opens to the surface.",
        rule: "By convention the entrance station is A1, and it is where a reader looks first -- name it in the title block."
    },
    "SYM_PIT": {
        means: "A drop in the floor too deep to climb down.",
        rule: "Size it to the OPENING. Depth is a number in a callout, not a bigger symbol."
    },
    "SYM_DOME": {
        means: "A shaft going up out of the ceiling with no matching hole in the floor.",
        rule: "A dome is one you can stand under; a pit is one you would fall into. The same shaft is a dome from below and a pit from above."
    },
    "SYM_BREAKDOWN": {
        means: "Collapsed ceiling rock lying on the floor.",
        rule: "Draw the blocks at the size they really are and scatter them unevenly. Rows of identical blocks read as wallpaper."
    },
    "SYM_BREAKDOWN_B": {
        means: "Collapsed ceiling rock lying on the floor -- a second block shape.",
        rule: "Mix the three breakdown shapes in one rubble field. That is what the variants are for."
    },
    "SYM_BREAKDOWN_C": {
        means: "Collapsed ceiling rock lying on the floor -- a third block shape.",
        rule: "Mix the three breakdown shapes in one rubble field. That is what the variants are for."
    },
    "SYM_STALACTITE": {
        means: "A dripstone cone hanging from the ceiling.",
        rule: "Stalactites hold TIGHT to the ceiling; stalagmites MIGHT reach it one day."
    },
    "SYM_STALAGMITE": {
        means: "A dripstone cone standing up from the floor.",
        rule: "Stalactites hold TIGHT to the ceiling; stalagmites MIGHT reach it one day."
    },
    "SYM_COLUMN": {
        means: "A stalactite and a stalagmite that met and joined floor to ceiling.",
        rule: "Only where the two have actually joined. A near miss is two symbols, not one."
    },
    "SYM_FLOWSTONE": {
        means: "Calcite sheeting over rock, like water frozen mid-flow.",
        rule: "This marks a patch. For the EDGE of a flowstone bank, draw the Flowstone shaped line instead."
    },
    "SYM_DRAPERY": {
        means: "A thin hanging sheet of calcite, formed along a slanted ceiling.",
        rule: "A drapery is a sheet seen edge-on; a stalactite is a cone. If it hangs from a crack rather than a point, it is this."
    },
    "SYM_RIMSTONE_DAM": {
        means: "The rim of a gour -- a calcite dam holding a pool of water.",
        rule: "For a run of dams down a slope, draw the Rimstone Dam shaped line so the scallops bow downslope."
    },
    "SYM_MOONMILK_POPCORN": {
        means: "Soft white paste (moonmilk) or knobbly coral-like growth (popcorn) on rock.",
        rule: ""
    },
    "SYM_CLAY_MUD_TICK": {
        means: "A clay or mud floor.",
        rule: "Cover the area SPARSELY. A solid mat of ticks prints as a black blob and hides the linework under it."
    },
    "SYM_SAND_GRAVEL_DOT": {
        means: "A sand or gravel floor.",
        rule: "Dot it heavier where the deposit is deep and thinner at its edges -- the fade is how a reader sees the edge."
    },
    "SYM_GUANO": {
        means: "Bat or bird droppings on the floor.",
        rule: "Worth mapping: it marks a roost, and a roost changes when the cave may be entered."
    },
    "SYM_NORTH_ARROW": {
        means: "Which way is north on the sheet.",
        rule: "Say WHICH north -- true or magnetic, with the declination used. An arrow that does not say is the commonest fault on a beginner's map."
    },
    "SYM_FIXED_POINT": {
        means: "A station whose position is known from outside the survey -- a GPS fix or a benchmark.",
        rule: "The whole cave hangs off these. Two fixed points that disagree will fight, and the loop closure is where you will see it."
    },
    "SYM_SECTION_MARKER": {
        means: "Marks where a cross section was cut, and which way the viewer faces.",
        rule: "Its letters must match the caption on the section itself. A section nobody can find on the plan is a section nobody reads."
    },
    "SYM_CEILING_HEIGHT": {
        means: "How far it is from the floor to the ceiling at that spot.",
        rule: "Put them where the passage CHANGES -- a low crawl, a high dome. One every few feet is noise."
    },
    "SYM_SIPHON": {
        means: "Water filling the passage to the roof, which can drain.",
        rule: "A siphon may be passable in dry weather; a sump is not. If nobody has seen it open, call it a sump."
    },
    "SYM_SPRING": {
        means: "Where the cave's water comes back out at the surface.",
        rule: ""
    },
    "SYM_DRIP_SEEP": {
        means: "Water entering through the ceiling or wall with no channel.",
        rule: ""
    },
    "SYM_SUMP": {
        means: "Standing water filling the passage to the roof.",
        rule: "The mapped cave ends here unless someone dives it. Mark it -- a passage that just stops reads as unfinished survey."
    },
    "SYM_FLOW_ARROW": {
        means: "Which way the water runs.",
        rule: "Point it DOWNSTREAM. Put one in every stream passage: the drainage is half of what a cave map is for."
    },
    "SYM_SLOPE_TICK": {
        means: "Which way the floor tilts.",
        rule: "The arrow points DOWNHILL, the way water would run."
    },
    "SYM_CLIMB_ARROW": {
        means: "A climb that can be done without rope.",
        rule: "The arrow points UP the climb. Put the height beside it -- a climb with no number tells a reader nothing about the trip."
    },
    "SYM_JOINT_TICK": {
        means: "A fracture in the bedrock that the passage follows.",
        rule: "Draw it along the joint's own direction. It is the answer to why the cave goes where it goes."
    }
};

/**
 * The features the Feature Trace panel draws, keyed the way that panel
 * keys its tiles: "layer:<PLAN-FRAME LAYER>" for a plain feature and
 * "style:<CsShapeLine.STYLES key>" for a shaped line.
 *
 * The SAME key FeatureTrace.rowKey builds, so a tile finds its help
 * without a second table mapping one to the other.
 */
CsHelp.FEATURE = {
    "layer:WALLS-SURVEYED": {
        means: "The edge of the passage where you measured it -- drawn solid.",
        rule: "Solid means MEASURED. Use it only where a tape, an LRUD or a splay actually reached the wall."
    },
    "layer:WALLS-INFERRED": {
        means: "The edge of the passage where you did not measure it -- drawn dashed.",
        rule: "Dashed means SKETCHED. Guessing is allowed and hiding the guess is not: the dashes are the map being honest."
    },
    "layer:BREAKDOWN": {
        means: "One block drawn to its real shape, rather than a scatter of symbols.",
        rule: "For a whole rubble field, outline it as a Breakdown Boundary and let Scatter Breakdown fill it."
    },
    "layer:BREAKDOWN-BOUNDARY": {
        means: "The extent of a rubble field.",
        rule: "CLOSE the loop -- Scatter Breakdown fills closed boundaries and skips open ones."
    },
    "layer:ENTRANCE": {
        means: "The lip of the entrance itself, where the cave begins.",
        rule: ""
    },
    "layer:CEILING": {
        means: "A ceiling edge seen from below: an overhang, a roof channel, the lip of an alcove.",
        rule: "Ceiling detail belongs INSIDE the walls. Drawn out at the wall line it reads as a second wall."
    },
    "layer:FLOOR": {
        means: "Floor detail inside the walls: the edge of a mud bank, a sand ledge, a bedrock rib.",
        rule: "A floor line that steps DOWN is a ledge -- draw it as a Floor Ledge so the drop shows."
    },
    "style:floorledge": {
        means: "A step down in the floor you could climb.",
        rule: "The hachures go on the LOW side. Click that side after the drag -- the tool asks."
    },
    "style:ceilingledge": {
        means: "A step in the ceiling: an overhang, or where the roof jumps up.",
        rule: "The hachures go on the side the ceiling is LOWER, the same way a floor ledge marks its drop."
    },
    "style:pit": {
        means: "A drop too deep to climb, drawn as a closed outline round the hole.",
        rule: "The ring closes on itself, so it has no ends and cannot be extended -- draw the whole rim in one stroke."
    },
    "style:flowstone": {
        means: "The edge of a sheet of calcite flowing over the rock.",
        rule: "The scallops bow DOWNSLOPE, the way the water ran."
    },
    "style:rimstone": {
        means: "A run of gour dams stepping down a slope.",
        rule: "The scallops bow DOWNSLOPE -- each dam bulges away from the water it holds back."
    },
    "style:slope": {
        means: "A floor tilting steeply enough to notice, but not a ledge.",
        rule: "The fans splay DOWNHILL. If the drop is a step rather than a ramp, it is a Floor Ledge."
    }
};

/**
 * Help for one shipped symbol, or null.
 *
 * Null for a custom symbol -- see the file note. Callers print what
 * they had before rather than inventing a meaning for someone's own
 * drawing.
 */
CsHelp.forSymbol = function(blockName) {
    if (isNull(blockName)) {
        return null;
    }
    var entry = CsHelp.SYMBOL[String(blockName)];
    return isNull(entry) ? null : entry;
};

/**
 * Help for one Feature Trace row, or null.
 *
 * Takes the ROW (as FeatureTrace.ROWS / SHAPED_ROWS hold it) rather
 * than a key, so a caller never has to know how the key is spelled.
 */
CsHelp.forFeature = function(row) {
    if (isNull(row)) {
        return null;
    }
    var key = isNull(row.style) ? ("layer:" + row.layer) :
        ("style:" + row.style);
    var entry = CsHelp.FEATURE[key];
    return isNull(entry) ? null : entry;
};
