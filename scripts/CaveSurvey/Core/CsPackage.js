// CsPackage.js -- the pure half of Package Cave Project.
//
// Part of the Cave Survey Core library. No Q*/R* anywhere, so
// tests/js_unit.js runs it under node: the archive's name, the manifest
// that goes inside it, and the zip command line for each platform are
// all decided here, and PackageCave.js does the file work.
//
// TWO PACKAGES, ONE TOOL. A cave folder holds the entrance location
// three ways -- as GeoLat/GeoLon/GeoStation tags on the anchor station,
// as a georeferenced aerial photograph beside the drawing (which needs
// no tags at all to be read), and as access notes written on hand
// sketches. So a package is either SANITIZED, with all three left out,
// or FULL, which is an archive for the surveyor's own machine and says
// so in its file name and its manifest.
//
// PDFs ARE NEVER SANITIZED. A map in the cave's PDF/ folder was plotted
// on purpose, by a cartographer who decided what it shows; it ships as
// it is, in both kinds of package. Sanitizing is scoped strictly to
// what this suite itself wrote.

var CsPackage = {};

// The tags that ARE the entrance location.
CsPackage.GEO_TAGS = ["GeoLat", "GeoLon", "GeoStation"];

// Where packages are written: not the synced drive folder, so a full
// archive cannot sync itself to the whole group by accident.
CsPackage.DEPOT = "Documents/Cave/depot";

/**
 * Today as YYYY-MM-DD, from the script engine's own Date.
 *
 * NOT QDate: this bridge does not define it at all (ReferenceError), and
 * QDateTime.currentDateTime().toString(format) ignores the format and
 * answers Qt's default text -- neither can produce a sortable stamp for
 * a file name.
 */
CsPackage.todayText = function(now) {
    var when = (now === undefined || now === null) ? new Date() : now;
    var pad2 = function(n) { return (n < 10 ? "0" : "") + n; };
    return when.getFullYear() + "-" + pad2(when.getMonth() + 1) + "-" +
        pad2(when.getDate());
};

CsPackage.depotFor = function(homePath) {
    var home = (homePath === undefined || homePath === null) ? "" :
        String(homePath).replace(/\/+$/, "");
    return home === "" ? CsPackage.DEPOT : home + "/" + CsPackage.DEPOT;
};

/** A cave name that can be a file name on every platform. */
CsPackage.safeName = function(name) {
    var text = (name === undefined || name === null) ? "" : String(name);
    return text.replace(/[\/\\:*?"<>|]/g, "").replace(/\s+/g, " ")
        .replace(/^\s+|\s+$/g, "");
};

/**
 * "All Day Cave 2026-08-24.zip", or "... FULL.zip".
 *
 * FULL is in the file name on purpose: the difference between the two
 * packages matters most at the moment somebody is about to attach one
 * to an email, and that is a moment when all they can see is the name.
 */
CsPackage.archiveName = function(caveName, dateText, full) {
    var name = CsPackage.safeName(caveName);
    if (name === "") { name = "Cave"; }
    var date = (dateText === undefined || dateText === null) ? "" :
        String(dateText);
    var stem = date === "" ? name : name + " " + date;
    return stem + (full === true ? " FULL" : "") + ".zip";
};

/**
 * The command that turns the staged folder into a zip.
 *
 * Every platform's answer is a program that ships with it -- there is
 * no zip library in the script engine, and adding a dependency to make
 * one archive would be a poor trade. The staged folder is zipped WITH
 * its parent name, so the archive unpacks into "ALL DAY CAVE/" rather
 * than scattering files into whatever directory it was opened in.
 *
 * \param system  "darwin", "windows", or anything else (treated as zip)
 * \param staging the directory the cave folder sits IN
 * \param folder  the cave folder's own name inside it
 * \param zipPath where the archive goes
 * \return {program, args, workingDirectory}
 */
CsPackage.zipCommand = function(system, staging, folder, zipPath) {
    var os = String(system === undefined || system === null ? "" : system)
        .toLowerCase();

    if (os === "darwin" || os === "osx" || os === "macos") {
        return {
            program: "/usr/bin/ditto",
            args: ["-c", "-k", "--sequesterRsrc", "--keepParent",
                staging + "/" + folder, zipPath],
            workingDirectory: staging
        };
    }

    if (os === "windows" || os === "win32" || os === "win") {
        return {
            program: "powershell",
            args: ["-NoProfile", "-NonInteractive", "-Command",
                "Compress-Archive -Path '" + staging + "/" + folder +
                "' -DestinationPath '" + zipPath + "' -Force"],
            workingDirectory: staging
        };
    }

    // zip(1) writes paths relative to its working directory, which is
    // how the archive keeps the cave folder as its single root.
    return {
        program: "zip",
        args: ["-r", "-X", "-q", zipPath, folder],
        workingDirectory: staging
    };
};

/** Right-pads, for the manifest's columns. */
CsPackage.pad = function(text, width) {
    var out = (text === undefined || text === null) ? "" : String(text);
    while (out.length < width) { out += " "; }
    return out;
};

/** "4,180 ft" */
CsPackage.formatLength = function(length, unit) {
    var whole = String(Math.round(
        (typeof length === "number" && isFinite(length)) ? length : 0));
    var grouped = "";
    while (whole.length > 3) {
        grouped = "," + whole.substring(whole.length - 3) + grouped;
        whole = whole.substring(0, whole.length - 3);
    }
    return whole + grouped + " " + (unit === undefined ? "" : unit);
};

/**
 * The MANIFEST.txt that travels inside every package.
 *
 * It exists so the zip is useful to somebody with no CaveCAD: what the
 * cave is, how long it is, which trips made it, what each trip's
 * declination was and where that number came from, what is in the
 * package, and -- said plainly, not implied -- whether it carries the
 * cave's location.
 *
 * \param info {
 *   caveName, date, full, drawingName, generator,
 *   length, unit, trips: [{id, name, date, team, shots, ends:[{station}],
 *   declination, declinationSource}],
 *   ends: [{station, hasLrud}],
 *   contents: [{path, note}]
 * }
 */
CsPackage.manifest = function(info) {
    var i = (info === undefined || info === null) ? {} : info;
    var lines = [];
    var caveName = CsPackage.safeName(i.caveName) === "" ? "Cave" : i.caveName;

    lines.push(String(caveName).toUpperCase());
    lines.push(i.full === true ?
        "Cave project archive -- FULL, includes the cave's location" :
        "Cave project package -- sanitized, no cave location");
    lines.push("Packaged " + (i.date || "") +
        (i.generator ? " by " + i.generator : ""));
    lines.push("");

    lines.push("SURVEY");
    lines.push("  Length      " + CsPackage.formatLength(i.length, i.unit));
    var trips = Object.prototype.toString.call(i.trips) === "[object Array]" ?
        i.trips : [];
    lines.push("  Trips       " + trips.length);

    var ends = Object.prototype.toString.call(i.ends) === "[object Array]" ?
        i.ends : [];
    var endText = [];
    for (var e = 0; e < ends.length; e++) {
        endText.push(ends[e].station +
            (ends[e].hasLrud === false ? " (no LRUD)" : ""));
    }
    lines.push("  Open ends   " +
        (endText.length === 0 ? "none -- every station is tied in" :
            endText.join(", ")));
    lines.push("");

    if (trips.length > 0) {
        lines.push("TRIPS");
        lines.push("  " + CsPackage.pad("Trip", 6) + CsPackage.pad("Date", 12) +
            CsPackage.pad("Team", 26) + CsPackage.pad("Shots", 7) +
            "Declination");
        for (var t = 0; t < trips.length; t++) {
            var trip = trips[t];
            var decl = (typeof trip.declination === "number") ?
                trip.declination.toFixed(2) + " E" : "";
            if (decl !== "" && trip.declinationSource) {
                decl += " (" + trip.declinationSource + ")";
            }
            lines.push("  " +
                CsPackage.pad(String(trip.id), 6) +
                CsPackage.pad(trip.date || "", 12) +
                CsPackage.pad(trip.team || "", 26) +
                CsPackage.pad(String(trip.shots === undefined ? 0 : trip.shots), 7) +
                decl);
        }
        lines.push("");
    }

    lines.push("CONTENTS");
    var contents = Object.prototype.toString.call(i.contents) === "[object Array]" ?
        i.contents : [];
    if (contents.length === 0) {
        lines.push("  (nothing but this file)");
    }
    for (var c = 0; c < contents.length; c++) {
        lines.push("  " + CsPackage.pad(contents[c].path, 30) +
            (contents[c].note || ""));
    }
    lines.push("");

    if (i.full === true) {
        lines.push("THIS IS A FULL ARCHIVE");
        lines.push("  It carries the cave's location: the drawing's geographic");
        lines.push("  anchor tags, and the aerial basemap if one was fetched.");
        lines.push("  It is meant for the survey group's own storage and for");
        lines.push("  handing a project to the next cartographer -- not for");
        lines.push("  general distribution.");
    }
    else {
        lines.push("SANITIZED");
        lines.push("  The drawing in this package carries no geographic anchor,");
        lines.push("  and no aerial photograph of the surface travels with it.");
        lines.push("  Any PDF included is exactly as it was plotted -- a map");
        lines.push("  shows whatever its cartographer chose to show.");
    }
    lines.push("");
    return lines.join("\n");
};
