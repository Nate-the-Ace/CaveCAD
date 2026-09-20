// CsChunk.js -- the cave in PIECES, split where a caver would split it,
// so an elevation can be arranged rather than merely generated.
//
// Part of the Cave Survey Core library: pure functions.
//
// WHY NEITHER WHOLE-CAVE ELEVATION IS ENOUGH. Both existing modes take
// the whole cave and one rule, and both pay for it somewhere:
//
//   EXTENDED   unrolls, which needs one X axis per run, so the bands
//              are stacked down the page and DISPLACED off true
//              elevation to stop them overprinting. Every depth on the
//              page then needs arithmetic before it means anything.
//
//   PROJECTED  keeps true position, so nothing is displaced -- and
//              passages that really are on top of each other are drawn
//              on top of each other. On Plumbline Pit the window
//              passage and the Bell Hole cross, because underground
//              they very nearly do.
//
// The answer a cartographer has always used is neither: draw the cave
// in PIECES, each piece at its true depth, and lay the pieces out on
// the sheet so none of them collide. A pit map is a set of panels -- a
// drop, the passage at its foot, the next drop -- joined by tie lines.
// That is what this file produces.
//
// WHERE THE SPLITS GO: at the pitches. A drop is one chunk, rebelays
// included, exactly as CsPitch groups it; the passage between two
// drops is another. Derived from the survey rather than asked for, so
// it needs no input and follows the survey when the survey changes --
// and it matches how a pit cave is described out loud: "the 187, then
// the crawl, then the 92".
//
// DEPTH IS LOCKED. A chunk slides sideways and never up or down, so
// every chunk on the page reads at its real elevation and two of them
// side by side can be compared by eye. That is precisely what the
// extended elevation gives up when it displaces a band, and giving it
// up is what made the displaced bands need a caption explaining
// themselves.

var CsChunk = {};

CsChunk.KIND_PITCH = "pitch";
CsChunk.KIND_PASSAGE = "passage";

/** Horizontal room between two chunks on the sheet, as a fraction of a
 *  typical chunk width. Wide enough that the tie lines between chunks
 *  are readable as connections rather than as passage. */
CsChunk.GAP_FRACTION = 0.35;
/** ...and never less than this, in survey units, so a cave of narrow
 *  chunks does not end up with its pieces touching. */
CsChunk.GAP_MIN = 12.0;

/**
 * Splits a resolved survey into chunks at its pitches.
 *
 * A pitch chunk holds the drop's own stations and legs. A passage
 * chunk holds a connected piece of what is left once the pitch legs
 * are taken out.
 *
 * THE BOUNDARY STATIONS BELONG TO BOTH. A pitch's head is the last
 * station of the passage above it and the first of the drop; that is
 * not a conflict to be resolved, it is the JOIN, and having the
 * station in both chunks is what lets the drawing put a tie line
 * between two pieces that each know where it is. Nothing is drawn
 * twice: a station's marks come from the chunk that owns its legs, and
 * the tie is drawn once, by the layout.
 *
 * \param opts {minDrop} -- passed to CsPitch.find; a plumbed step too
 *             short to be a pitch is not a chunk boundary either, or a
 *             cave would shatter into pieces at every awkward step
 *
 * \return [{key, kind, stations: {name: true}, legs: {legKey: true},
 *           stationList, pitch, top, bottom, topZ, bottomZ}]
 *         deepest-topped first, so a reader laying them out left to
 *         right walks down the cave
 */
CsChunk.split = function(survey, resolved, opts) {
    var o = opts || {};
    if (resolved === null || resolved === undefined || !resolved.legs) {
        return [];
    }
    var pitches = CsPitch.find(survey, resolved, o);

    // Which legs belong to a pitch, and which pitch.
    var pitchOfLeg = {};
    var i, k, seg;
    for (i = 0; i < pitches.length; i++) {
        for (k = 0; k < pitches[i].segments.length; k++) {
            seg = pitches[i].segments[k];
            pitchOfLeg[CsProject.legKey(seg.from, seg.to)] = i;
        }
    }

    var chunks = [];

    // ---- one chunk per pitch ---------------------------------------
    for (i = 0; i < pitches.length; i++) {
        var p = pitches[i];
        var pst = {}, plg = {};
        for (k = 0; k < p.stations.length; k++) {
            pst[p.stations[k]] = true;
        }
        for (k = 0; k < p.segments.length; k++) {
            plg[CsProject.legKey(p.segments[k].from, p.segments[k].to)] = true;
        }
        chunks.push({
            key: (p.aven ? "AVEN-" : "PITCH-") + p.top,
            kind: CsChunk.KIND_PITCH,
            stations: pst,
            stationList: p.stations.slice(0),
            legs: plg,
            pitch: p,
            top: p.top,
            bottom: p.bottom
        });
    }

    // ---- the rest, as connected pieces -----------------------------
    //
    // Union-find over the NON-pitch legs. A passage chunk is whatever
    // stays connected once the ropes are taken out of the graph, which
    // is exactly "the cave you can walk around without rigging".
    var parent = {};
    var find = function(a) {
        while (parent[a] !== a) {
            parent[a] = parent[parent[a]];
            a = parent[a];
        }
        return a;
    };
    var union = function(a, b) {
        if (parent[a] === undefined) { parent[a] = a; }
        if (parent[b] === undefined) { parent[b] = b; }
        var ra = find(a), rb = find(b);
        if (ra !== rb) { parent[ra] = rb; }
    };
    var walkLegs = [];
    for (i = 0; i < resolved.legs.length; i++) {
        var leg = resolved.legs[i];
        if (leg.shot.excludeFromAll || leg.shot.excludeFromPlot) {
            continue;
        }
        var lk = CsProject.legKey(leg.from, leg.to);
        if (pitchOfLeg.hasOwnProperty(lk)) {
            continue;
        }
        if (resolved.stations[leg.from] === undefined ||
                resolved.stations[leg.to] === undefined) {
            continue;
        }
        union(leg.from, leg.to);
        walkLegs.push({ leg: leg, key: lk });
    }

    var groups = {};
    for (i = 0; i < walkLegs.length; i++) {
        var root = find(walkLegs[i].leg.from);
        if (groups[root] === undefined) {
            groups[root] = { stations: {}, stationList: [], legs: {} };
        }
        var g = groups[root];
        g.legs[walkLegs[i].key] = true;
        var ends = [walkLegs[i].leg.from, walkLegs[i].leg.to];
        for (k = 0; k < 2; k++) {
            if (g.stations[ends[k]] !== true) {
                g.stations[ends[k]] = true;
                g.stationList.push(ends[k]);
            }
        }
    }
    for (var rootKey in groups) {
        if (!groups.hasOwnProperty(rootKey)) { continue; }
        chunks.push({
            key: "PASSAGE-" + CsChunk.shallowest(groups[rootKey].stationList,
                resolved),
            kind: CsChunk.KIND_PASSAGE,
            stations: groups[rootKey].stations,
            stationList: groups[rootKey].stationList,
            legs: groups[rootKey].legs,
            pitch: null,
            top: CsChunk.shallowest(groups[rootKey].stationList, resolved),
            bottom: CsChunk.deepest(groups[rootKey].stationList, resolved)
        });
    }

    for (i = 0; i < chunks.length; i++) {
        chunks[i].topZ = CsChunk.zOf(resolved, chunks[i].top);
        chunks[i].bottomZ = CsChunk.zOf(resolved, chunks[i].bottom);
    }

    // Highest-topped first: laid out left to right, a reader then
    // walks down the cave across the page, which is the order they
    // would walk it underground.
    chunks.sort(function(a, b) {
        if (a.topZ !== b.topZ) { return b.topZ - a.topZ; }
        return (a.key < b.key) ? -1 : ((a.key > b.key) ? 1 : 0);
    });
    return chunks;
};

CsChunk.zOf = function(resolved, name) {
    var st = resolved.stations[name];
    return (st === undefined || st === null) ? 0 : st.z;
};

CsChunk.shallowest = function(names, resolved) {
    var best = null, bestZ = null;
    for (var i = 0; i < names.length; i++) {
        var z = CsChunk.zOf(resolved, names[i]);
        if (bestZ === null || z > bestZ ||
                (z === bestZ && names[i] < best)) {
            bestZ = z; best = names[i];
        }
    }
    return best;
};

CsChunk.deepest = function(names, resolved) {
    var best = null, bestZ = null;
    for (var i = 0; i < names.length; i++) {
        var z = CsChunk.zOf(resolved, names[i]);
        if (bestZ === null || z < bestZ ||
                (z === bestZ && names[i] < best)) {
            bestZ = z; best = names[i];
        }
    }
    return best;
};

/**
 * Where two chunks join: the stations they share.
 *
 * \return [{station, a, b}] -- a and b are indices into `chunks`
 */
CsChunk.ties = function(chunks) {
    var out = [];
    for (var i = 0; i < chunks.length; i++) {
        for (var j = i + 1; j < chunks.length; j++) {
            for (var k = 0; k < chunks[i].stationList.length; k++) {
                var name = chunks[i].stationList[k];
                if (chunks[j].stations[name] === true) {
                    out.push({ station: name, a: i, b: j });
                }
            }
        }
    }
    return out;
};

/**
 * Each chunk drawn as its own small projected elevation, at TRUE
 * elevation, and offset sideways so the pieces do not collide.
 *
 * WHY PROJECTED WITHIN A CHUNK rather than unrolled: a passage chunk
 * can still branch and can still hold a loop, and unrolling needs one
 * path through it -- the very problem that makes the whole-cave
 * extended elevation displace its bands. A chunk is small enough that
 * a projection hides almost nothing, and it keeps loops closed. Each
 * chunk gets its OWN plane (its own longest direction), which is a
 * freedom the whole-cave projection does not have and is most of why
 * the pieces read better than the whole.
 *
 * \param offsets {chunkKey: x} -- positions a caver has already
 *        dragged to, which always win. A chunk with no remembered
 *        position is placed by the preset.
 *
 * \return [band] in CsProfile band shape, ready for CsProfileDraw
 */
CsChunk.bands = function(survey, resolved, chunks, opts) {
    var o = opts || {};
    var offsets = o.offsets || {};
    var i;

    var splaysByStation = CsLrud.splaysByStation(survey);
    var legCounts = CsLrud.legCounts(resolved.legs);
    var stationAxes = CsLrud.stationAxes(resolved);
    var wallPointsSkipped = 0;

    // Each chunk built WHOLE in its own local coordinates first --
    // walls included -- because the walls are what a chunk's width
    // actually is.
    //
    // MEASURED FROM THE DRAWN EXTENT, NOT THE CENTRELINE. The first
    // version of this laid the chunks out on their stations' spread
    // and the pieces overlapped: Plumbline's entrance drop is a rope
    // with a bell chamber at the bottom of it, so its centreline is a
    // line of zero width and its splay ring fans twenty-five feet
    // either side. A layout that does not look at the walls puts the
    // next chunk straight through that chamber.
    var raw = [];
    for (i = 0; i < chunks.length; i++) {
        var band = CsProject.band(survey, resolved, {
            stations: chunks[i].stations,
            legs: chunks[i].legs,
            tapeMode: o.tapeMode
        });
        var walls = CsProfile.bandWallRuns(band, survey, resolved, {
            tapeMode: o.tapeMode,
            flatSplayDeg: o.flatSplayDeg,
            splaysByStation: splaysByStation,
            legCounts: legCounts,
            stationAxes: stationAxes,
            fixedAzimuth: band.projection.azimuth
        });
        band.ceiling = walls.ceiling;
        band.floor = walls.floor;
        band.flat = walls.flat;
        band.parent = null;
        wallPointsSkipped += (walls.skipped || 0);
        var ext = CsChunk.extentOf(band);
        raw.push({ band: band, lo: ext.lo, hi: ext.hi });
    }

    // A PITCH IS A LINE AND STILL NEEDS ROOM. A drop with no chamber
    // at either end really is zero wide -- that is what a rope is --
    // so the gap either side of it is what keeps its label and its tie
    // lines off its neighbours.
    var widths = [];
    for (i = 0; i < raw.length; i++) {
        widths.push(raw[i].hi - raw[i].lo);
    }
    var gap = Math.max(CsChunk.GAP_MIN,
        CsChunk.median(widths) * CsChunk.GAP_FRACTION);

    var bands = [];
    var cursor = 0;
    for (i = 0; i < chunks.length; i++) {
        var width = raw[i].hi - raw[i].lo;
        var shift;
        if (offsets.hasOwnProperty(chunks[i].key)) {
            // A POSITION THE CAVER CHOSE, and it wins. The cursor still
            // advances past it so the chunks that follow are laid out
            // around the arrangement rather than through it.
            shift = offsets[chunks[i].key];
        } else {
            shift = cursor - raw[i].lo;
        }
        var placed = CsChunk.shiftBand(raw[i].band, shift);
        placed.key = chunks[i].key;
        placed.chunkKind = chunks[i].kind;
        placed.chunkOffset = shift;
        // DEPTH IS LOCKED, and this is the line that locks it. Every
        // other elevation in this suite may set a zOffset to fit more
        // cave on a page; a chunk may not, because being able to
        // compare two chunks' depths by eye is the whole reason the
        // cave was cut up in the first place.
        placed.zOffset = 0.0;
        bands.push(placed);
        cursor = Math.max(cursor, raw[i].hi + shift) + gap;
    }
    bands.wallPointsSkipped = wallPointsSkipped;
    return bands;
};

/** A band's DRAWN horizontal extent: stations, legs and walls. */
CsChunk.extentOf = function(band) {
    var lo = null, hi = null;
    var see = function(x) {
        if (!isFinite(x)) { return; }
        if (lo === null || x < lo) { lo = x; }
        if (hi === null || x > hi) { hi = x; }
    };
    var i, k;
    for (i = 0; i < band.stations.length; i++) { see(band.stations[i].x); }
    for (i = 0; i < band.legs.length; i++) {
        see(band.legs[i].fromX); see(band.legs[i].toX);
    }
    var runs = (band.ceiling || []).concat(band.floor || []);
    for (i = 0; i < runs.length; i++) {
        for (k = 0; k < runs[i].length; k++) { see(runs[i][k].x); }
    }
    for (i = 0; i < (band.flat || []).length; i++) { see(band.flat[i].x); }
    if (lo === null) { return { lo: 0, hi: 0 }; }
    return { lo: lo, hi: hi };
};

/** Slides a band's geometry sideways, in place. */
CsChunk.shiftBand = function(band, dx) {
    var i, k;
    for (i = 0; i < band.stations.length; i++) {
        band.stations[i].x += dx;
    }
    for (i = 0; i < band.legs.length; i++) {
        band.legs[i].fromX += dx;
        band.legs[i].toX += dx;
    }
    var runs = (band.ceiling || []).concat(band.floor || []);
    for (i = 0; i < runs.length; i++) {
        for (k = 0; k < runs[i].length; k++) {
            runs[i][k].x += dx;
        }
    }
    for (i = 0; i < (band.flat || []).length; i++) {
        band.flat[i].x += dx;
    }
    return band;
};

CsChunk.median = function(values) {
    if (values.length === 0) {
        return 0;
    }
    var s = values.slice(0).sort(function(a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return (s.length % 2 === 1) ? s[mid] : (s[mid - 1] + s[mid]) / 2.0;
};

/**
 * A chunked elevation in CsProfile.build's own shape.
 *
 * One band per chunk, so CsProfileDraw draws, frames, tags, binds and
 * erases them exactly as it does the bands of an extended elevation --
 * the same reuse CsProject gets, for the same reason.
 */
CsChunk.build = function(survey, resolved, opts) {
    var o = opts || {};
    var chunks = CsChunk.split(survey, resolved, o);
    var bands = CsChunk.bands(survey, resolved, chunks, o);

    var pitches = CsPitch.find(survey, resolved, o);
    for (var i = 0; i < bands.length; i++) {
        bands[i].pitches = [];
        var inBand = {};
        for (var s = 0; s < bands[i].stations.length; s++) {
            inBand[bands[i].stations[s].name] = true;
        }
        for (var pj = 0; pj < pitches.length; pj++) {
            if (inBand[pitches[pj].top] === true &&
                    inBand[pitches[pj].bottom] === true) {
                bands[i].pitches.push({
                    top: pitches[pj].top,
                    bottom: pitches[pj].bottom,
                    drop: pitches[pj].drop,
                    aven: pitches[pj].aven,
                    text: CsPitch.label(pitches[pj], survey.distanceUnit)
                });
            }
        }
    }

    return {
        bands: bands,
        chunks: chunks,
        ties: CsChunk.ties(chunks),
        pitches: pitches,
        findings: {
            omitted: [], mismatches: [], secondTies: [], orphans: [],
            strandedRoots: [], stopped: [], ungrouped: [], undrawn: [],
            wallPointsSkipped: bands.wallPointsSkipped || 0
        }
    };
};

/** How a chunk names itself on the page. */
CsChunk.caption = function(band) {
    if (band.chunkKind === CsChunk.KIND_PITCH) {
        if (band.pitches && band.pitches.length > 0) {
            return band.pitches[0].text.toUpperCase();
        }
        return String(band.key).replace(/-/g, " ");
    }
    return String(band.key).replace("PASSAGE-", "FROM ");
};
