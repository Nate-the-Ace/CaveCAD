// CsFocus.js -- which entities belong to which trips, teams, people and
// survey runs, and therefore what a focus selection shows.
//
// Part of the Cave Survey Core library: pure functions over an entity's
// TAGS. Nothing here touches a document, an operation or a widget, so
// the whole file is testable headless -- which matters, because the
// thing it decides (is this entity part of that trip?) is invisible
// when it is wrong. Applying the answer is TripFocus' job.
//
// FOCUS IS A SET OF STATION NAMES. Every row type in the window reduces
// to one: a trip's stations come from CsRevise.tripStationNames, a
// team's or a person's is the union over their trips, a run's is its own
// station list. One primitive, so a Teams row and a Runs row cannot
// disagree about what "in focus" means.
//
// THE FAIL-SAFE RULE: an entity this file cannot attribute to any
// station STAYS VISIBLE. Title block, border, sheet, basemap, symbols,
// the reader's own untagged sketches. This is the same doctrine the
// deleted Cave Mode used for menus -- an unknown thing showing is
// clutter, which is recoverable; an unknown thing vanishing is a
// support call.
//
// THE INVARIANT, pinned by a test: TAG_RULES below reads the same tags
// CsDraw.eraseStations reads. Those two lists are the drawing's only
// answers to "which station does this entity belong to". A tag added to
// erase and not here means geometry a redraw replaces but a focus
// cannot see; added here and not to erase means a redraw orphans it.
// The test parses eraseStations' body and fails either way.

var CsFocus = {};

/** How each tag's value maps to station names.
 *
 *  `base` is applied to the tag value; `split` means the value is a
 *  station LIST rather than one name; `both` means an "A1->A2" pair
 *  where the entity belongs to both ends. */
CsFocus.TAG_RULES = [
    { tag: "Station",          mode: "one" },
    { tag: "StationLabel",     mode: "one" },
    { tag: "LRUDName",         mode: "one", base: "lrud" },
    { tag: "LRUDLine",         mode: "one", base: "lrud" },
    { tag: "LRUDNote",         mode: "one" },
    { tag: "Splay",            mode: "one", base: "splay" },
    { tag: "SplayName",        mode: "one", base: "splay" },
    { tag: "SplayLabel",       mode: "one", base: "splay" },
    { tag: "NoteLabel",        mode: "one" },
    { tag: "NoteLeader",       mode: "one" },
    { tag: "Shot",             mode: "pair" },
    { tag: "RawStation",       mode: "one" },
    { tag: "RawShot",          mode: "pair" },
    { tag: "WallRunStations",  mode: "list" },
    { tag: "LineworkStations", mode: "list", kind: "linework" },
    { tag: "ProfileStation",   mode: "one",  kind: "profile" }
];

/** Tags whose presence means "every station has to be in focus", as
 *  against "any one of them". A LEG is the drawing's only record of a
 *  shot between two stations, so it belongs to both; a WALL RUN is
 *  generated geometry following a chain, and showing it beside a focused
 *  station it touches is more useful than hiding it because the chain
 *  wandered out of focus. */
CsFocus.ALL_ENDS_MODES = { pair: true };

CsFocus.applyBase = function(value, base) {
    if (base === "lrud") {
        return CsBind.lrudBase(value);
    }
    if (base === "splay") {
        return CsBind.splayBase(value);
    }
    return value;
};

/**
 * The stations an entity belongs to.
 *
 * \return {names: [stationName], kind: "suite"|"linework"|"profile"|
 *          "none", mode: the rule that matched, or ""}
 */
CsFocus.stationsOf = function(entity) {
    for (var i = 0; i < CsFocus.TAG_RULES.length; i++) {
        var rule = CsFocus.TAG_RULES[i];
        var value = CsTags.get(entity, rule.tag);
        if (value === "") {
            continue;
        }
        var names = [];
        if (rule.mode === "pair") {
            var ends = String(value).split("->");
            for (var e = 0; e < ends.length; e++) {
                if (ends[e] !== "") {
                    names.push(ends[e]);
                }
            }
        } else if (rule.mode === "list") {
            var members = CsBind.decodeStations(value);
            for (var m = 0; m < members.length; m++) {
                if (members[m] !== "") {
                    names.push(members[m]);
                }
            }
        } else {
            var one = CsFocus.applyBase(value, rule.base);
            if (one !== "") {
                names.push(one);
            }
        }
        if (names.length === 0) {
            continue;   // a tag present but empty attributes nothing
        }
        return {
            names: names,
            kind: (rule.kind === undefined) ? "suite" : rule.kind,
            mode: rule.mode
        };
    }
    return { names: [], kind: "none", mode: "" };
};

/**
 * Is this entity in focus?
 *
 * \param stationSet {name: true}, or null/undefined for "All"
 */
CsFocus.isVisible = function(entity, stationSet) {
    if (stationSet === undefined || stationSet === null) {
        return true;   // All: nothing is filtered
    }
    var att = CsFocus.stationsOf(entity);
    if (att.kind === "none") {
        return true;   // the fail-safe rule -- see the file header
    }
    var needsAll = CsFocus.ALL_ENDS_MODES[att.mode] === true;
    var anyIn = false;
    for (var i = 0; i < att.names.length; i++) {
        var hit = stationSet[att.names[i]] === true;
        if (needsAll && !hit) {
            return false;
        }
        if (hit) {
            anyIn = true;
        }
    }
    return anyIn;
};

/** Plan frame or not. Nathan's decision: the viewer is plan only, so
 *  the profile band is hidden whatever is checked. Delegates to
 *  CsLayers.frameOf so the two spellings of the profile frame
 *  (CTRL-PROFILE-* generated, PROFILE-* traced) stay in one place. */
CsFocus.isPlanFrame = function(layerName) {
    return CsLayers.frameOf(layerName) !== "profile";
};

/**
 * The station set a window selection makes.
 *
 * \param picked {trips: [tripId], teams: [teamText], people: [name],
 *                runs: [runKey]} -- any key may be absent
 * \param tripStations {tripId: [stationName]} from
 *                     CsRevise.tripStationNames
 * \param runStations {runKey: [stationName]} from CsProfile.groupRuns
 * \param tripsForGroup {teamText or person: [tripId]} -- what byTeam
 *                      and byPerson put in their rows' tripIds
 * \return {stationName: true}
 */
CsFocus.stationSet = function(picked, tripStations, runStations,
        tripsForGroup) {
    var set = {};
    var addTrip = function(id) {
        var names = tripStations[id];
        if (names === undefined || names === null) {
            return;
        }
        for (var i = 0; i < names.length; i++) {
            // tripStationNames pushes the blank TO of every splay; a
            // blank is not a station and must not enter the set, or
            // every entity tagged with an empty name reads as focused
            if (names[i] !== "" && names[i] !== null &&
                    names[i] !== undefined) {
                set[names[i]] = true;
            }
        }
    };

    var i, j, ids;
    if (picked.trips !== undefined && picked.trips !== null) {
        for (i = 0; i < picked.trips.length; i++) {
            addTrip(picked.trips[i]);
        }
    }
    var groups = [picked.teams, picked.people];
    for (var g = 0; g < groups.length; g++) {
        if (groups[g] === undefined || groups[g] === null) {
            continue;
        }
        for (i = 0; i < groups[g].length; i++) {
            ids = (tripsForGroup === undefined || tripsForGroup === null) ?
                null : tripsForGroup[groups[g][i]];
            if (ids === undefined || ids === null) {
                continue;
            }
            for (j = 0; j < ids.length; j++) {
                addTrip(ids[j]);
            }
        }
    }
    if (picked.runs !== undefined && picked.runs !== null) {
        for (i = 0; i < picked.runs.length; i++) {
            var members = runStations[picked.runs[i]];
            if (members === undefined || members === null) {
                continue;
            }
            for (j = 0; j < members.length; j++) {
                if (members[j] !== "") {
                    set[members[j]] = true;
                }
            }
        }
    }
    return set;
};

/** True when the selection picked nothing at all -- the window shows
 *  everything rather than an empty view, because a blank drawing looks
 *  like a broken tool. */
CsFocus.isEmptySelection = function(picked) {
    var keys = ["trips", "teams", "people", "runs"];
    for (var i = 0; i < keys.length; i++) {
        var list = picked[keys[i]];
        if (list !== undefined && list !== null && list.length > 0) {
            return false;
        }
    }
    return true;
};
