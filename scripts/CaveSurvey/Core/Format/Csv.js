// Csv.js -- plain CSV reader and writer, for spreadsheet people.
//
// Part of the Cave Survey Core library: pure functions producing and
// consuming the CsModel survey shape.
//
// Column layout, header row optional (recognised and skipped):
//
//   from,to,distance,azimuth,inclination,left,right,up,down,notes
//
// Everything after inclination is optional. Blank LRUD cells mean
// "not measured" (null), matching how the other formats treat their
// missing markers. Azimuths are taken as TRUE bearings -- CSV has no
// declination header, and quietly guessing one would be worse than
// documenting this.

var CsFormatCsv = {};

CsFormatCsv.parse = function(content) {
    var survey = CsModel.newSurvey();
    var lines = content.split(/\r\n|\r|\n/);

    for (var li = 0; li < lines.length; li++) {
        var line = lines[li].replace(/^\s+|\s+$/g, "");
        if (line.length === 0 || line.charAt(0) === "#") {
            continue;
        }
        var cells = line.split(",");
        if (cells.length < 4) {
            continue;
        }
        var trim = function(s) {
            return s === undefined ? "" : s.replace(/^\s+|\s+$/g, "");
        };
        var dist = parseFloat(cells[2]);
        if (isNaN(dist)) {
            continue; // header row or junk
        }

        var opt = function(idx) {
            var v = trim(cells[idx]);
            if (v === "") {
                return null;
            }
            var n = parseFloat(v);
            return isNaN(n) ? null : n;
        };

        var shot = CsModel.newShot();
        shot.from = trim(cells[0]);
        shot.to = trim(cells[1]);
        shot.splay = (shot.to === "" || shot.to === "-");
        if (shot.splay) {
            shot.to = "";
        }
        shot.distance = dist;
        shot.azimuth = CsAngles.normalizeAzimuth(parseFloat(cells[3]) || 0.0);
        var inc = opt(4);
        shot.inclination = inc === null ? 0.0 : inc;
        shot.left = opt(5);
        shot.right = opt(6);
        shot.up = opt(7);
        shot.down = opt(8);
        shot.notes = cells.length > 9 ? trim(cells.slice(9).join(",")) : "";
        survey.shots.push(shot);
    }
    return survey;
};

CsFormatCsv.write = function(survey) {
    var out = ["from,to,distance,azimuth,inclination,left,right,up,down,notes"];
    var fmt = function(v) {
        return v === null || v === undefined ? "" : String(v);
    };
    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        out.push([s.from, s.splay ? "" : s.to, s.distance, s.azimuth,
            s.inclination, fmt(s.left), fmt(s.right), fmt(s.up), fmt(s.down),
            (s.notes || "").replace(/,/g, ";")].join(","));
    }
    return out.join("\n") + "\n";
};
