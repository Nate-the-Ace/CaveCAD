// CsScanTree.js
//
// The folder tree Sketch Scans draws over CsCave.filesUnder's relative
// paths. Surveyors keep scans in per-trip subfolders, so the browse
// list shows folder rows that collapse -- but this bridge cannot
// construct a real QTreeWidget (wrapper-only stub; see CaveShelf.js),
// so the tree is SIMULATED on a one-column QTableWidget: this file is
// the pure model behind it -- rows, depths, collapse rules and the
// collapsed-state settings format. No Q* or R* symbols, so
// tests/js_unit.js exercises all of it under node.

var CsScanTree = {};

// The one settings key. Its value is a JSON object mapping a scans
// folder's ABSOLUTE path to the list of collapsed RELATIVE folder
// paths inside it -- per cave by construction, one key overall.
CsScanTree.SETTING = "CaveSurvey/SketchScansCollapsed";

// COMPLETE -- the scans a caver has finished with. Same storage shape,
// its own key: an absolute scans path mapping to the list of completed
// RELATIVE file paths inside it.
//
// The setting KEY still says Bookmarks. It was a bookmark first, and
// renaming the key would throw away every mark already made for the
// sake of a word nobody sees.
//
// THE FOUR FUNCTIONS BELOW ARE GENERIC, whatever their names say.
// parseCollapsed / serializeCollapsed / collapsedSetFor /
// recordCollapsed are a per-cave string-set store and nothing about
// them knows what a collapsed folder is; bookmarks use them as they
// are rather than growing a second copy that could drift. If a third
// use ever appears, that is the moment to rename them.
CsScanTree.SETTING_BOOKMARKS = "CaveSurvey/SketchScansBookmarks";

// Display rows for a list of relative file paths (sorted, the shape
// CsCave.filesUnder answers): {kind: "folder"|"file", rel, depth,
// label}. A folder row is emitted the first time any path passes
// through it, immediately before its content; depth counts ancestor
// folders; label is the last path segment.
CsScanTree.rowsOf = function(files) {
    var rows = [];
    var seen = {};
    if (files === null || files === undefined) { return rows; }
    for (var i = 0; i < files.length; i++) {
        var rel = String(files[i]);
        var ancestors = CsScanTree.ancestorsOf(rel);
        for (var a = 0; a < ancestors.length; a++) {
            if (seen[ancestors[a]] === true) { continue; }
            seen[ancestors[a]] = true;
            rows.push({
                kind: "folder",
                rel: ancestors[a],
                depth: a,
                label: ancestors[a].substring(
                    ancestors[a].lastIndexOf("/") + 1)
            });
        }
        rows.push({
            kind: "file",
            rel: rel,
            depth: ancestors.length,
            label: rel.substring(rel.lastIndexOf("/") + 1)
        });
    }
    return rows;
};

// The folder prefixes of a relative path, outermost first:
// "a/b/c.jpg" -> ["a", "a/b"]. A top-level name has none.
CsScanTree.ancestorsOf = function(rel) {
    var out = [];
    var from = 0;
    while (true) {
        var slash = rel.indexOf("/", from);
        if (slash === -1) { break; }
        out.push(rel.substring(0, slash));
        from = slash + 1;
    }
    return out;
};

// A row is hidden when ANY strict ancestor folder is collapsed. The
// row for a collapsed folder itself stays visible (that is where the
// expand click lands), and a still-collapsed subfolder keeps its own
// content hidden after its parent expands -- standard tree semantics,
// for free.
CsScanTree.isHidden = function(row, collapsedSet) {
    if (collapsedSet === null || collapsedSet === undefined) {
        return false;
    }
    var ancestors = CsScanTree.ancestorsOf(row.rel);
    for (var i = 0; i < ancestors.length; i++) {
        if (collapsedSet[ancestors[i]] === true) { return true; }
    }
    return false;
};

// True when EVERY scan beneath a folder is complete.
//
// Not "holds a completed one", which was the rule when this marked a
// bookmark and is nearly useless now: a trip folder of forty pages with
// one page done would wear the same tick as one that is finished. A
// collapsed folder should say "this trip is done", and that is only
// true when nothing inside it is outstanding. A folder with no scans in
// it at all is not complete -- there is nothing to have finished.
CsScanTree.folderComplete = function(folderRel, rows, complete) {
    if (rows === null || rows === undefined) {
        return false;
    }
    var prefix = folderRel + "/";
    var found = false;
    for (var i = 0; i < rows.length; i++) {
        if (rows[i].kind !== "file" || rows[i].rel.indexOf(prefix) !== 0) {
            continue;
        }
        found = true;
        if (complete === null || complete === undefined ||
                complete[rows[i].rel] !== true) {
            return false;
        }
    }
    return found;
};

// The first visible scan NOT yet complete, or -1: where the panel puts
// the caver when it opens.
//
// The opposite of what this did as a bookmark, and deliberately. A mark
// meaning "finished" is not a place to return to -- returning to the
// last thing you finished is the one scan you have no more work on. The
// useful landing is the next one still to do.
//
// A row hidden inside a collapsed folder is not jumped to: expanding
// folders the caver collapsed would trade one remembered thing for
// another.
CsScanTree.firstIncompleteRow = function(rows, complete, collapsedSet) {
    if (rows === null || rows === undefined) {
        return -1;
    }
    for (var i = 0; i < rows.length; i++) {
        if (rows[i].kind !== "file") {
            continue;
        }
        if (complete !== null && complete !== undefined &&
                complete[rows[i].rel] === true) {
            continue;
        }
        if (CsScanTree.isHidden(rows[i], collapsedSet)) {
            continue;
        }
        return i;
    }
    return -1;
};

// The stored JSON, parsed defensively: anything unreadable is an empty
// map, never a throw -- a corrupt setting must cost the memory of what
// was collapsed, not the tool.
CsScanTree.parseCollapsed = function(json) {
    if (typeof json !== "string" || json === "") { return {}; }
    try {
        var map = JSON.parse(json);
        if (map === null || typeof map !== "object" ||
                Object.prototype.toString.call(map) !== "[object Object]") {
            return {};
        }
        return map;
    } catch (e) {
        return {};
    }
};

CsScanTree.serializeCollapsed = function(map) {
    return JSON.stringify(map);
};

// The collapsed set for one cave's scans folder, as {rel: true}.
CsScanTree.collapsedSetFor = function(map, scansPath) {
    var set = {};
    var list = map === null || map === undefined ? null : map[scansPath];
    if (Object.prototype.toString.call(list) !== "[object Array]") {
        return set;
    }
    for (var i = 0; i < list.length; i++) {
        if (typeof list[i] === "string") { set[list[i]] = true; }
    }
    return set;
};

// Writes one cave's collapsed set back into the map, keeping only
// folders that still exist (validRels) -- deleted or renamed trip
// folders fall out of the setting instead of accreting -- and dropping
// the cave's entry entirely when nothing is collapsed.
CsScanTree.recordCollapsed = function(map, scansPath, set, validRels) {
    var keep = [];
    for (var i = 0; i < validRels.length; i++) {
        if (set[validRels[i]] === true) { keep.push(validRels[i]); }
    }
    if (keep.length === 0) {
        delete map[scansPath];
    } else {
        map[scansPath] = keep;
    }
    return map;
};
