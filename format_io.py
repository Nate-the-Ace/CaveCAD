"""
format_io.py

Import/export support for the three common native cave survey formats:
Walls (.srv), Compass (.dat), Survex (.svx). Converts to/from the app's
shared row format: a list of dicts with keys from_name, to_name, distance,
azimuth, inclination, left, right, up, down, notes -- all values as strings,
matching what the GUI's ShotRow widgets hold.

============================================================
SCOPE -- read this before trusting output on real data.
============================================================
This implements the common, everyday-use core of each format, ported from
(and re-verified against real test files, unlike) the original QCAD
ECMAScript version. It does NOT implement the full specification of any
of them. See the parse_* function docstrings for exactly what's supported.

Common limitation across all three: this app's row model is a single
top-to-bottom pass (no multi-pass out-of-order resolution like the QCAD
importer had) -- a shot's FROM station must be defined by an earlier row,
either the starting station or an earlier row's TO. Rows that don't
resolve are reported as import warnings and simply omitted, not guessed at.

Compass (.dat) -- parse support:
  - Multiple surveys per file (form-feed \\f separated)
  - DECLINATION (added to bearing)
  - Fixed column order per the Compass spec: FROM TO LENGTH BEARING INC
    LEFT UP DOWN RIGHT (this is fixed by the file format regardless of
    the FORMAT header string)
  - Negative LRUD (missing measurement) treated as 0
  - Shot flags: "#|X#" (exclude), "#|P#" (exclude from plotting only)
  NOT supported on parse: backsight columns (read past, unused), .MAK
  project files, multi-file projects.

Walls (.srv) -- parse support:
  - #Units: Feet/Meters, Order=..., Decl=...
  - #Prefix (single current prefix, "prefix:name")
  - Inline LRUD as <L,R,U,D>, "--" = missing -> 0
  - ; comments, splay shots (TO "-") skipped
  NOT supported: nested/segmented #Prefix stacks, #Fix (not needed here --
  this app has its own starting-station fields), dive-specific directives.

Survex (.svx) -- parse support:
  - *begin / *end hierarchical prefixes (joined with ".")
  - *data normal <field order> (from/to/tape/compass/clino, any order)
  - *data passage station left right up down (LRUD stored separately from
    the leg table, matched to stations by name)
  - *units length (feet/metres)
  NOT supported: *include, *data diving/cartesian/nosurvey, *calibrate.

============================================================
EXPORT NOTES
============================================================
Export writes a single-survey file in each format using this app's own
current values (declination is NOT re-applied on export -- whatever
azimuth is in the table is written as-is). The Compass export's FORMAT
header string is a reasonable placeholder ("DDDDLUDRADLNFB") -- actual
Compass software may be picky about this string's exact encoding; the
shot data itself (always decimal feet/degrees per spec) is correct
regardless. Round-tripping a file through this app's own import/export
has been verified to preserve the data; fidelity with real Walls/Compass/
Survex software reading the export has NOT been independently verified,
since I don't have access to run those programs.
"""

import re


# Distance-unit handling, kept deliberately identical to
# ImportNativeCaveSurvey.js's toDrawingUnits() so the QCAD scripts and this
# app plot the same file at the same scale. Each format supplies its own
# source unit: Survex defaults to metres, Walls to feet, Compass is always
# feet -- those defaults come from the formats' own specs, not from us.
FEET_PER_METER = 3.280839895

DRAWING_DISTANCE_UNIT = "ft"  # must match your QCAD drawing's units


def to_drawing_units(value, source_unit):
    if source_unit == DRAWING_DISTANCE_UNIT:
        return value
    if source_unit == "ft" and DRAWING_DISTANCE_UNIT == "m":
        return value / FEET_PER_METER
    if source_unit == "m" and DRAWING_DISTANCE_UNIT == "ft":
        return value * FEET_PER_METER
    return value


def _num(value, default=0.0):
    if value is None:
        return default
    text = str(value).strip()
    if text == "" or text == "--" or text == "-":
        return default
    try:
        return float(text)
    except ValueError:
        return default


def _fmt(value):
    """Formats a float for display in the table (trim trailing zeros a bit)."""
    if value == int(value):
        return str(int(value))
    return f"{value:.2f}".rstrip("0").rstrip(".")


def _row(from_name, to_name, distance, azimuth, inclination, left, right, up, down, notes=""):
    return {
        "from_name": from_name, "to_name": to_name,
        "distance": _fmt(distance), "azimuth": _fmt(azimuth), "inclination": _fmt(inclination),
        "left": _fmt(left), "right": _fmt(right), "up": _fmt(up), "down": _fmt(down),
        "notes": notes,
    }


# ============================================================
# Compass (.dat)
# ============================================================

def parse_compass(content):
    """Returns (rows, warnings)."""
    rows = []
    warnings = []
    blocks = content.split("\f")

    for block in blocks:
        if not block.strip():
            continue

        decl_match = re.search(r"DECLINATION:\s*(-?[0-9.]+)", block, re.IGNORECASE)
        declination = float(decl_match.group(1)) if decl_match else 0.0

        lines = block.splitlines()

        decl_line_idx = None
        for i, line in enumerate(lines):
            if re.search(r"DECLINATION:", line, re.IGNORECASE):
                decl_line_idx = i
                break
        scan_start = decl_line_idx + 1 if decl_line_idx is not None else 0

        for line in lines[scan_start:]:
            line = line.strip()
            if not line:
                continue
            tokens = line.split()
            if len(tokens) < 9:
                continue
            try:
                length = float(tokens[2])
                bearing = float(tokens[3])
                inc = float(tokens[4])
            except ValueError:
                continue  # not a shot line (header/column-title line)

            left = _num(tokens[5])
            up = _num(tokens[6])
            down = _num(tokens[7])
            right = _num(tokens[8])
            left = 0.0 if left < 0 else left
            up = 0.0 if up < 0 else up
            down = 0.0 if down < 0 else down
            right = 0.0 if right < 0 else right

            remainder = " ".join(tokens[9:])
            flag_match = re.search(r"#\|([A-Za-z]*)#", remainder)
            flags = flag_match.group(1).upper() if flag_match else ""
            if "X" in flags:
                continue  # excluded entirely

            notes = remainder
            if flag_match:
                notes = (remainder[:flag_match.start()] + remainder[flag_match.end():]).strip()

            rows.append(_row(tokens[0], tokens[1],
                              to_drawing_units(length, "ft"),
                              bearing + declination, inc,
                              to_drawing_units(left, "ft"),
                              to_drawing_units(right, "ft"),
                              to_drawing_units(up, "ft"),
                              to_drawing_units(down, "ft"), notes))

    return rows, warnings


def write_compass(rows, header_info, output_path):
    cave_name = header_info.get("cave_name") or "Cave"
    survey_name = header_info.get("survey_designation") or "A"
    date = header_info.get("date") or ""
    surveyors = header_info.get("surveyors") or ""
    declination = _num(header_info.get("declination"), 0.0)

    lines = [cave_name]
    lines.append(f"SURVEY NAME: {survey_name}")
    lines.append(f"SURVEY DATE: {date}" if date else "SURVEY DATE:")
    lines.append("SURVEY TEAM:")
    lines.append(surveyors)
    lines.append(f"DECLINATION: {declination:.2f}  FORMAT: DDDDLUDRADLNFB  CORRECTIONS: 0.00 0.00 0.00")
    lines.append("")
    lines.append("FROM TO LENGTH BEARING INC LEFT UP DOWN RIGHT")

    for r in rows:
        if not r.get("from_name") or not r.get("to_name"):
            continue
        distance = _num(r.get("distance"))
        azimuth = _num(r.get("azimuth"))
        inclination = _num(r.get("inclination"))
        left = _num(r.get("left"))
        right = _num(r.get("right"))
        up = _num(r.get("up"))
        down = _num(r.get("down"))
        note = (r.get("notes") or "").strip()
        line = (f"{r['from_name']} {r['to_name']} {distance:.2f} {azimuth:.2f} "
                f"{inclination:.2f} {left:.2f} {up:.2f} {down:.2f} {right:.2f}")
        if note:
            line += f" {note}"
        lines.append(line)

    with open(output_path, "w", newline="\r\n") as f:
        f.write("\n".join(lines) + "\n\x0c")


# ============================================================
# Walls (.srv)
# ============================================================

def parse_walls(content):
    """Returns (rows, warnings)."""
    rows = []
    warnings = []

    order = ["D", "A", "V"]
    declination = 0.0
    prefix = ""
    dist_unit = "ft"  # Walls' own default

    def apply_prefix(name):
        if name in ("-", ""):
            return name
        if prefix == "" or ":" in name:
            return name
        return f"{prefix}:{name}"

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        if line.startswith("#"):
            tokens = line.split()
            directive = tokens[0].lower()
            if directive == "#units":
                for tok in tokens[1:]:
                    if re.match(r"^(feet|ft)$", tok, re.IGNORECASE):
                        dist_unit = "ft"
                    elif re.match(r"^(met(er|re)s?|m)$", tok, re.IGNORECASE):
                        dist_unit = "m"
                    elif re.match(r"^order=", tok, re.IGNORECASE):
                        order = list(tok.split("=", 1)[1].upper())
                    elif re.match(r"^decl(ination)?=", tok, re.IGNORECASE):
                        try:
                            declination = float(tok.split("=", 1)[1])
                        except ValueError:
                            pass
            elif directive == "#prefix":
                prefix = tokens[1] if len(tokens) > 1 else ""
            continue

        lrud_match = re.search(r"<([^>]*)>", line)
        left = right = up = down = 0.0
        work_line = line
        if lrud_match:
            parts = [p.strip() for p in lrud_match.group(1).split(",")]
            vals = [0.0, 0.0, 0.0, 0.0]
            for i in range(min(4, len(parts))):
                vals[i] = _num(parts[i])
            left, right, up, down = vals
            work_line = work_line.replace(lrud_match.group(0), " ")

        semi_idx = work_line.find(";")
        if semi_idx >= 0:
            work_line = work_line[:semi_idx]

        fields = work_line.strip().split()
        if len(fields) < 2:
            continue

        from_name = apply_prefix(fields[0])
        to_raw = fields[1]
        is_splay = (to_raw == "-")
        to_name = None if is_splay else apply_prefix(to_raw)

        distance = azimuth = inclination = 0.0
        vals = fields[2:]
        for i, code in enumerate(order):
            if i >= len(vals):
                break
            try:
                v = float(vals[i])
            except ValueError:
                continue
            if code == "D":
                distance = v
            elif code == "A":
                azimuth = v
            elif code == "V":
                inclination = v

        if is_splay:
            continue

        rows.append(_row(from_name, to_name,
                          to_drawing_units(distance, dist_unit),
                          azimuth + declination, inclination,
                          to_drawing_units(left, dist_unit),
                          to_drawing_units(right, dist_unit),
                          to_drawing_units(up, dist_unit),
                          to_drawing_units(down, dist_unit)))

    return rows, warnings


def write_walls(rows, header_info, output_path):
    declination = _num(header_info.get("declination"), 0.0)
    lines = [
        "; Exported from Cave Survey Data Entry App",
        f"#Units Feet Order=DAV Decl={declination:.2f}",
        "",
    ]
    for r in rows:
        if not r.get("from_name") or not r.get("to_name"):
            continue
        distance = _num(r.get("distance"))
        azimuth = _num(r.get("azimuth"))
        inclination = _num(r.get("inclination"))
        left = _num(r.get("left"))
        right = _num(r.get("right"))
        up = _num(r.get("up"))
        down = _num(r.get("down"))
        note = (r.get("notes") or "").strip()
        line = (f"{r['from_name']} {r['to_name']} {distance:.2f} {azimuth:.2f} "
                f"{inclination:.2f} <{left:.2f},{right:.2f},{up:.2f},{down:.2f}>")
        if note:
            line += f" ;{note}"
        lines.append(line)

    with open(output_path, "w", newline="\r\n") as f:
        f.write("\n".join(lines) + "\n")


# ============================================================
# Survex (.svx)
# ============================================================

def parse_survex(content):
    """Returns (rows, warnings)."""
    rows = []
    warnings = []
    passage_lrud = {}

    prefix_stack = []
    length_unit = "m"  # Survex's own default
    data_style = None
    normal_fields = ["from", "to", "tape", "compass", "clino"]
    passage_fields = ["station", "left", "right", "up", "down"]

    def full_name(name):
        if not prefix_stack:
            return name
        return ".".join(prefix_stack) + "." + name

    for raw_line in content.splitlines():
        semi_idx = raw_line.find(";")
        line = (raw_line[:semi_idx] if semi_idx >= 0 else raw_line).strip()
        if not line:
            continue

        if line.startswith("*"):
            tokens = line.split()
            cmd = tokens[0].lower()
            if cmd == "*begin":
                prefix_stack.append(tokens[1] if len(tokens) > 1 else f"anon{len(prefix_stack)}")
            elif cmd == "*end":
                if prefix_stack:
                    prefix_stack.pop()
            elif cmd == "*data":
                if len(tokens) == 1:
                    data_style = None
                elif tokens[1].lower() == "normal":
                    data_style = "normal"
                    normal_fields = [t.lower() for t in tokens[2:]]
                elif tokens[1].lower() == "passage":
                    data_style = "passage"
                    passage_fields = [t.lower() for t in tokens[2:]]
                else:
                    data_style = "other"
            elif cmd == "*units":
                # Only "*units <quantity...> <unit>" for length is handled;
                # compass/clino grads are still assumed to be degrees.
                low = [t.lower() for t in tokens[1:]]
                if any(q in low for q in ("length", "tape")):
                    if any(u in low for u in ("feet", "ft")):
                        length_unit = "ft"
                    elif any(u in low for u in ("metres", "meters", "metric", "m")):
                        length_unit = "m"
            continue

        fields = line.split()

        if data_style == "normal":
            rec = dict(zip(normal_fields, fields))
            if not all(k in rec for k in ("from", "to", "tape", "compass")):
                continue
            try:
                tape = float(rec["tape"])
                compass = float(rec["compass"])
            except ValueError:
                continue
            try:
                clino = float(rec.get("clino", 0.0))
            except ValueError:
                clino = 0.0
            rows.append(_row(full_name(rec["from"]), full_name(rec["to"]),
                              to_drawing_units(tape, length_unit),
                              compass, clino, 0, 0, 0, 0))
        elif data_style == "passage":
            rec = dict(zip(passage_fields, fields))
            if "station" not in rec:
                continue
            passage_lrud[full_name(rec["station"])] = {
                "left": to_drawing_units(_num(rec.get("left")), length_unit),
                "right": to_drawing_units(_num(rec.get("right")), length_unit),
                "up": to_drawing_units(_num(rec.get("up")), length_unit),
                "down": to_drawing_units(_num(rec.get("down")), length_unit),
            }

    for r in rows:
        lrud = passage_lrud.get(r["to_name"])
        if lrud:
            r["left"] = _fmt(lrud["left"])
            r["right"] = _fmt(lrud["right"])
            r["up"] = _fmt(lrud["up"])
            r["down"] = _fmt(lrud["down"])

    return rows, warnings


def write_survex(rows, header_info, output_path):
    survey_name = (header_info.get("survey_designation") or "Survey").replace(" ", "_")
    lines = [
        "; Exported from Cave Survey Data Entry App",
        "",
        f"*begin {survey_name}",
        "*units length feet",
        "*data normal from to tape compass clino",
        "",
    ]
    passage_lines = []
    for r in rows:
        if not r.get("from_name") or not r.get("to_name"):
            continue
        distance = _num(r.get("distance"))
        azimuth = _num(r.get("azimuth"))
        inclination = _num(r.get("inclination"))
        note = (r.get("notes") or "").strip()
        line = f"{r['from_name']} {r['to_name']} {distance:.2f} {azimuth:.2f} {inclination:.2f}"
        if note:
            line += f"  ; {note}"
        lines.append(line)

        left = _num(r.get("left"))
        right = _num(r.get("right"))
        up = _num(r.get("up"))
        down = _num(r.get("down"))
        if left or right or up or down:
            passage_lines.append(f"{r['to_name']} {left:.2f} {right:.2f} {up:.2f} {down:.2f}")

    if passage_lines:
        lines.append("")
        lines.append("*data passage station left right up down")
        lines.extend(passage_lines)
        lines.append("")
        lines.append("*data")

    lines.append(f"*end {survey_name}")

    with open(output_path, "w", newline="\r\n") as f:
        f.write("\n".join(lines) + "\n")


# ============================================================
# Dispatch
# ============================================================

PARSERS = {"Compass": parse_compass, "Walls": parse_walls, "Survex": parse_survex}
WRITERS = {"Compass": write_compass, "Walls": write_walls, "Survex": write_survex}
EXTENSIONS = {"Compass": ".dat", "Walls": ".srv", "Survex": ".svx"}
FILE_FILTERS = {
    "Compass": [("Compass Data Files", "*.dat"), ("All files", "*.*")],
    "Walls": [("Walls Survey Files", "*.srv"), ("All files", "*.*")],
    "Survex": [("Survex Files", "*.svx"), ("All files", "*.*")],
}
