// CsStationStore.js -- the team's marks and notes on a Station Table row.
//
// Part of the Cave Survey Core library: pure ES5. The file itself
// (stations.json in the cave folder, carried by Google Drive with the
// rest of the cave) is read and written by StationTable.js; this file
// is everything about what is IN it.
//
// THE KEY IS STATION + NOTE TEXT. A note the team edits later is a
// different key, and the marks would silently detach. So a row whose
// note changed but which has exactly ONE unmatched entry at its station
// is offered as a RELINK, marks shown, until a person confirms it;
// nothing is dropped and nothing is re-attached unasked. Entries that
// match no station at all are ORPHANS: kept, listed, never deleted.
//
// Matching ignores case and runs of whitespace, so tidying "lead w" to
// "LEAD W" does not orphan anything.
//
// The 'Cs' prefix is mandatory: include() dedupes by basename.

var CsStationStore = {};

CsStationStore.VERSION = 1;
CsStationStore.FILE = "stations.json";

/** The marks a row can carry. "" is unmarked (a lead then reads "open"). */
CsStationStore.STATUSES = ["open", "assigned", "pushed", "done", "skip"];

/** Why a row is Done; free text is allowed, these are the suggestions. */
CsStationStore.DONE_REASONS = ["continues", "ended", "tied in", "dug out"];

CsStationStore.empty = function() {
    return { version: CsStationStore.VERSION, entries: [],
        settings: { packing: "", pace: {} } };
};

CsStationStore.normalize = function(text) {
    return String(text === undefined || text === null ? "" : text)
        .replace(/\s+/g, " ").replace(/^ | $/g, "").toLowerCase();
};

CsStationStore.keyOf = function(station, text) {
    return String(station) + "\u001f" + CsStationStore.normalize(text);
};

var csStoreStr = function(v) {
    return (v === undefined || v === null) ? "" : String(v);
};

/**
 * Text of stations.json -> {store, error}. Never throws. An empty file
 * is an empty store with no error; damage is an empty store WITH an
 * error, so the panel can say so instead of silently starting over.
 */
CsStationStore.parse = function(text) {
    var store = CsStationStore.empty();
    if (text === undefined || text === null ||
            String(text).replace(/\s+/g, "") === "") {
        return { store: store, error: "" };
    }
    var data;
    try {
        data = JSON.parse(String(text));
    } catch (e) {
        return { store: store, error: "stations.json could not be read: " + e };
    }
    if (data === null || typeof data !== "object") {
        return { store: store, error: "stations.json is not a station file" };
    }
    var list = Object.prototype.toString.call(data.entries) ===
        "[object Array]" ? data.entries : [];
    for (var i = 0; i < list.length; i++) {
        var e2 = list[i];
        if (e2 === null || typeof e2 !== "object" ||
                typeof e2.station !== "string" || e2.station === "") {
            continue;
        }
        var status = csStoreStr(e2.status);
        if (status !== "" && CsStationStore.STATUSES.indexOf(status) < 0) {
            status = "";
        }
        store.entries.push({ station: e2.station, note: csStoreStr(e2.note),
            status: status, team: csStoreStr(e2.team), who: csStoreStr(e2.who) });
    }
    if (data.settings !== null && typeof data.settings === "object") {
        store.settings.packing = csStoreStr(data.settings.packing);
        if (data.settings.pace !== null && typeof data.settings.pace === "object") {
            store.settings.pace = data.settings.pace;
        }
    }
    return { store: store, error: "" };
};

/** The store as file text, in a stable order (so a Drive diff is small). */
CsStationStore.serialize = function(store) {
    var entries = store.entries.slice(0);
    entries.sort(function(a, b) {
        var d = CsStationTable.compareNatural(a.station, b.station);
        if (d !== 0) { return d; }
        return a.note < b.note ? -1 : (a.note > b.note ? 1 : 0);
    });
    return JSON.stringify({ version: CsStationStore.VERSION,
        entries: entries, settings: store.settings }, null, 2) + "\n";
};

/**
 * Attach the stored marks to rows.
 *
 * Adds to each row: status, team, who, and link -- "ok" (matched),
 * "relink" (note changed; relinkFrom is the stored note) or "" (nothing
 * stored). Rows are changed in place.
 *
 * \return {rows, orphans} -- orphans are stored entries that match no
 *         station at all (still in the store; nothing is deleted here)
 */
CsStationStore.reconcile = function(rows, store) {
    var byKey = {};
    var byStation = {};
    var i;
    for (i = 0; i < store.entries.length; i++) {
        var e = store.entries[i];
        byKey[CsStationStore.keyOf(e.station, e.note)] = e;
        if (byStation[e.station] === undefined) { byStation[e.station] = []; }
        byStation[e.station].push(e);
    }
    var used = {};
    var apply = function(row, entry) {
        row.status = entry.status;
        row.team = entry.team;
        row.who = entry.who;
    };
    var pending = [];
    for (i = 0; i < rows.length; i++) {
        var row = rows[i];
        row.key = CsStationStore.keyOf(row.station, row.keyText);
        row.status = ""; row.team = ""; row.who = "";
        row.link = ""; row.relinkFrom = undefined;
        if (byKey[row.key] !== undefined) {
            apply(row, byKey[row.key]);
            row.link = "ok";
            used[row.key] = true;
        } else {
            pending.push(row);
        }
    }
    for (i = 0; i < pending.length; i++) {
        var p = pending[i];
        var cands = [];
        var here = byStation[p.station] || [];
        for (var c = 0; c < here.length; c++) {
            if (used[CsStationStore.keyOf(here[c].station, here[c].note)] !== true) {
                cands.push(here[c]);
            }
        }
        if (cands.length === 1) {
            apply(p, cands[0]);
            p.link = "relink";
            p.relinkFrom = cands[0].note;
            used[CsStationStore.keyOf(cands[0].station, cands[0].note)] = true;
        }
    }
    var orphans = [];
    for (i = 0; i < store.entries.length; i++) {
        var oe = store.entries[i];
        if (used[CsStationStore.keyOf(oe.station, oe.note)] !== true) {
            orphans.push(oe);
        }
    }
    return { rows: rows, orphans: orphans };
};

/**
 * Write a row's marks into the store, in place. On a relink row this
 * is the CONFIRMATION: the stored entry moves to the row's current note.
 * An entry whose status, team and who are all empty is removed.
 *
 * \param fields any of {status, team, who}; absent fields are kept
 */
CsStationStore.setEntry = function(store, row, fields) {
    var newKey = CsStationStore.keyOf(row.station, row.keyText);
    var oldKey = (row.link === "relink" && row.relinkFrom !== undefined) ?
        CsStationStore.keyOf(row.station, row.relinkFrom) : newKey;
    var base = { station: row.station, note: row.keyText, status: "",
        team: "", who: "" };
    var kept = [];
    for (var i = 0; i < store.entries.length; i++) {
        var e = store.entries[i];
        var k = CsStationStore.keyOf(e.station, e.note);
        if (k === newKey || k === oldKey) {
            base = { station: e.station, note: row.keyText, status: e.status,
                team: e.team, who: e.who };
        } else {
            kept.push(e);
        }
    }
    var f = fields || {};
    if (f.status !== undefined) {
        base.status = CsStationStore.STATUSES.indexOf(f.status) >= 0 ?
            f.status : "";
    }
    if (f.team !== undefined) { base.team = String(f.team); }
    if (f.who !== undefined) { base.who = String(f.who); }
    if (base.status !== "" || base.team !== "" || base.who !== "") {
        kept.push(base);
    }
    store.entries = kept;
    return store;
};
