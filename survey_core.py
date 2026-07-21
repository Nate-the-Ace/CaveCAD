"""
survey_core.py

Shared math and DXF-generation logic for the cave survey data entry app.
Kept separate from the GUI code so it can be tested/verified independently.

Conventions (matching the QCAD AzimuthTraverse.js / ImportNativeCaveSurvey.js
tools built earlier this project):
  - Azimuth: degrees, clockwise from North (0 = N, 90 = E).
      dx = distance * sin(azimuth), dy = distance * cos(azimuth)
  - Inclination: degrees, + up / - down. Distance is treated as already
    horizontal (per your field procedure) -- inclination is only used to
    track a running elevation, not to correct the plan-view distance.
  - L/R: measured facing the direction of travel.
      Right = azimuth + 90 deg, Left = azimuth - 90 deg.
  - LRUD is associated with the TO station (far end) of each shot.
"""

import math
import os

import ezdxf
from ezdxf.enums import TextEntityAlignment

TARGET_LAYERS = {
    "shots": "CTRL-SHOTS",
    "lrud": "CTRL-LRUD",
    "stations": "CTRL-STATIONS",
    "station_labels": "CTRL-STATION-LABELS",
}

STATION_BLOCK_NAME = "SYM_FIXED_POINT"
TEXT_HEIGHT = 0.5
LRUD_TEXT_HEIGHT = 0.35


class ShotError(Exception):
    """Raised for a specific row's data problem; carries the row index."""
    def __init__(self, row_index, message):
        super().__init__(message)
        self.row_index = row_index
        self.message = message


def parse_float(value, default=None, field_name="value", row_index=None):
    """Parses a string to float. Raises ShotError if required (default=None)
    and blank/invalid; returns default if given and value is blank."""
    text = (value or "").strip()
    if text == "":
        if default is not None:
            return default
        raise ShotError(row_index, f"{field_name} is required")
    try:
        return float(text)
    except ValueError:
        raise ShotError(row_index, f"{field_name} is not a valid number: {text!r}")


def compute_stations(start_name, start_x, start_y, rows):
    """
    Processes shot rows top-to-bottom, computing station positions.

    rows: list of dicts with keys: from_name, to_name, distance, azimuth,
          inclination, left, right, up, down, notes (all strings as typed).

    Returns (stations, resolved_shots, errors):
      stations: {name: {"pos": (x, y), "z": elevation}}
      resolved_shots: list of dicts, one per successfully-computed row, with
        keys: from_name, to_name, from_pos, to_pos, azimuth, left, right,
        up, down, is_closure (bool -- both stations already existed)
      errors: list of (row_index, message) for rows that couldn't be used
    """
    stations = {start_name: {"pos": (start_x, start_y), "z": 0.0}}
    resolved_shots = []
    errors = []

    for i, row in enumerate(rows):
        from_name = (row.get("from_name") or "").strip()
        to_name = (row.get("to_name") or "").strip()

        if from_name == "" or to_name == "":
            # Blank trailing row (e.g. the always-present empty row at the
            # bottom of the table) -- not an error, just nothing to do yet.
            continue

        if from_name not in stations:
            errors.append((i, f"unknown FROM station \"{from_name}\" "
                               f"(not yet defined -- check spelling/order)"))
            continue

        try:
            distance = parse_float(row.get("distance"), field_name="Distance", row_index=i)
            azimuth = parse_float(row.get("azimuth"), field_name="Azimuth", row_index=i)
            inclination = parse_float(row.get("inclination"), default=0.0, row_index=i)
            left = parse_float(row.get("left"), default=0.0, row_index=i)
            right = parse_float(row.get("right"), default=0.0, row_index=i)
            up = parse_float(row.get("up"), default=0.0, row_index=i)
            down = parse_float(row.get("down"), default=0.0, row_index=i)
        except ShotError as e:
            errors.append((i, e.message))
            continue

        from_station = stations[from_name]
        from_pos = from_station["pos"]

        if to_name in stations:
            # Both ends already known -- loop closure / re-visit. Draw a
            # straight connector between the existing coordinates; azimuth/
            # distance on this row are not used for positioning.
            to_pos = stations[to_name]["pos"]
            resolved_shots.append({
                "from_name": from_name, "to_name": to_name,
                "from_pos": from_pos, "to_pos": to_pos,
                "azimuth": azimuth, "left": 0, "right": 0, "up": 0, "down": 0,
                "is_closure": True,
            })
            continue

        rad = math.radians(azimuth)
        dx = distance * math.sin(rad)
        dy = distance * math.cos(rad)
        to_pos = (from_pos[0] + dx, from_pos[1] + dy)

        inc_rad = math.radians(inclination)
        to_z = from_station["z"] + distance * math.tan(inc_rad)

        stations[to_name] = {"pos": to_pos, "z": to_z}
        resolved_shots.append({
            "from_name": from_name, "to_name": to_name,
            "from_pos": from_pos, "to_pos": to_pos,
            "azimuth": azimuth, "left": left, "right": right, "up": up, "down": down,
            "is_closure": False,
        })

    return stations, resolved_shots, errors


def lrud_tick(station_pos, azimuth_deg, side, length):
    """Returns ((x1,y1),(x2,y2)) for a perpendicular LRUD tick, or None if length is 0."""
    if not length:
        return None
    perp_azimuth = azimuth_deg + 90.0 if side == "R" else azimuth_deg - 90.0
    rad = math.radians(perp_azimuth)
    dx = length * math.sin(rad)
    dy = length * math.cos(rad)
    return station_pos, (station_pos[0] + dx, station_pos[1] + dy)


def ensure_layer(doc, name, color, linetype="Continuous", lineweight=None):
    layers = doc.layers
    if name in layers:
        return layers.get(name)
    kwargs = {"color": color, "linetype": linetype}
    if lineweight is not None:
        kwargs["lineweight"] = lineweight
    return layers.add(name, **kwargs)


def build_dxf(template_path, output_path, header_info, start_name, start_x, start_y, rows):
    """
    Loads the template DXF, draws the resolved survey alignment into it, and
    saves to output_path. Returns (resolved_shots, stations, errors) so the
    caller can report a summary -- errors here do NOT stop the DXF from
    being written; rows with errors are simply omitted.
    """
    doc = ezdxf.readfile(template_path)
    msp = doc.modelspace()

    # CTRL-LRUD may not exist yet in older copies of the template -- match
    # CTRL-SHOTS's color/lineweight if we have to create it.
    shots_layer = doc.layers.get(TARGET_LAYERS["shots"])
    ensure_layer(
        doc, TARGET_LAYERS["lrud"],
        color=2,  # yellow, matching the original (non-CTRL-) LRUD layer
        lineweight=shots_layer.dxf.lineweight if shots_layer.dxf.hasattr("lineweight") else None,
    )

    stations, resolved_shots, errors = compute_stations(start_name, start_x, start_y, rows)

    has_symbol_block = STATION_BLOCK_NAME in doc.blocks

    def add_station_marker(pos, name, z):
        if has_symbol_block:
            msp.add_blockref(STATION_BLOCK_NAME, insert=pos,
                              dxfattribs={"layer": TARGET_LAYERS["stations"]})
        else:
            msp.add_point(pos, dxfattribs={"layer": TARGET_LAYERS["stations"]})

        label = name
        if abs(z) > 1e-6:
            label += f" (Z{'+' if z >= 0 else ''}{z:.1f})"
        label_pos = (pos[0] + TEXT_HEIGHT * 1.5, pos[1] + TEXT_HEIGHT * 1.5)
        text = msp.add_text(label, dxfattribs={
            "layer": TARGET_LAYERS["station_labels"],
            "height": TEXT_HEIGHT,
        })
        text.set_placement(label_pos, align=TextEntityAlignment.MIDDLE_LEFT)

    # Starting station always gets a marker.
    add_station_marker((start_x, start_y), start_name, 0.0)

    drawn_stations = {start_name}

    for shot in resolved_shots:
        msp.add_line(shot["from_pos"], shot["to_pos"],
                     dxfattribs={"layer": TARGET_LAYERS["shots"]})

        if shot["is_closure"]:
            continue

        to_name = shot["to_name"]
        to_pos = shot["to_pos"]
        azimuth = shot["azimuth"]

        left_tick = lrud_tick(to_pos, azimuth, "L", shot["left"])
        if left_tick:
            msp.add_line(*left_tick, dxfattribs={"layer": TARGET_LAYERS["lrud"]})
        right_tick = lrud_tick(to_pos, azimuth, "R", shot["right"])
        if right_tick:
            msp.add_line(*right_tick, dxfattribs={"layer": TARGET_LAYERS["lrud"]})

        if shot["up"] or shot["down"]:
            ud_text = f"U{shot['up']:.2f} D{shot['down']:.2f}"
            note_rad = math.radians(azimuth + 90.0)
            offset = LRUD_TEXT_HEIGHT * 1.5
            note_pos = (to_pos[0] + offset * math.sin(note_rad),
                        to_pos[1] + offset * math.cos(note_rad))
            note = msp.add_text(ud_text, dxfattribs={
                "layer": TARGET_LAYERS["lrud"],
                "height": LRUD_TEXT_HEIGHT,
            })
            note.set_placement(note_pos, align=TextEntityAlignment.MIDDLE_LEFT)

        if to_name not in drawn_stations:
            add_station_marker(to_pos, to_name, stations[to_name]["z"])
            drawn_stations.add(to_name)

    # Header info onto the title block text fields, if present as attdefs
    # in an inserted title block -- left as plain drawing-level info for now
    # since no title block instance is inserted by this tool.

    doc.saveas(output_path)
    return resolved_shots, stations, errors
