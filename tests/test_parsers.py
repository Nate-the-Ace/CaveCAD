"""
Python-side tests for format_io.py and survey_core.py.

Stdlib unittest only -- no pytest needed. format_io imports nothing but `re`,
so its tests run under bare system Python; the survey_core DXF tests need
ezdxf and skip themselves cleanly if it isn't installed.

    python3 -m unittest discover -s tests -v          # parsers only
    .venv/bin/python -m unittest discover -s tests -v # + DXF tests

Tests decorated @unittest.expectedFailure document real known bugs (see
tests/README.md). If one of them starts reporting "unexpected success", the
underlying bug has been fixed -- delete the decorator rather than the test.
"""

import os
import sys
import tempfile
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)

import format_io as fio  # noqa: E402

try:
    import survey_core as sc
    HAVE_EZDXF = True
except ImportError:
    HAVE_EZDXF = False

HEADER = {
    "cave_name": "TestCave", "survey_designation": "A", "date": "2026-08-17",
    "declination": "0", "surveyors": "NS", "instruments": "feet",
}

FIXTURES = {
    "Compass": "TestCave_Compass.dat",
    "Walls": "TestCave_Walls.srv",
    "Survex": "TestCave_Survex.svx",
}


def read_fixture(fmt):
    with open(os.path.join(REPO, FIXTURES[fmt])) as fh:
        return fh.read()


def parse(fmt):
    return fio.PARSERS[fmt](read_fixture(fmt))


class TestUnitConversion(unittest.TestCase):
    """to_drawing_units must behave exactly like the JS toDrawingUnits()."""

    def test_same_unit_is_identity(self):
        self.assertEqual(fio.to_drawing_units(12.5, "ft"), 12.5)

    def test_metres_to_feet(self):
        self.assertAlmostEqual(fio.to_drawing_units(1.0, "m"),
                               fio.FEET_PER_METER, places=9)

    def test_unknown_unit_passes_through_unchanged(self):
        self.assertEqual(fio.to_drawing_units(7.0, "furlongs"), 7.0)


class TestParsers(unittest.TestCase):
    def test_row_counts(self):
        for fmt, expected in (("Compass", 6), ("Walls", 6), ("Survex", 5)):
            with self.subTest(fmt=fmt):
                rows, _ = parse(fmt)
                self.assertEqual(len(rows), expected)

    def test_no_warnings_on_clean_fixtures(self):
        for fmt in FIXTURES:
            with self.subTest(fmt=fmt):
                _, warnings = parse(fmt)
                self.assertEqual(warnings, [])

    def test_compass_applies_declination_to_bearing(self):
        # TestCave_Compass.dat carries DECLINATION 2.50; the first shot's raw
        # bearing is 142.5, so the parsed azimuth must come back as 145.
        rows, _ = parse("Compass")
        self.assertEqual(rows[0]["azimuth"], "145")

    def test_compass_distances_are_feet_verbatim(self):
        rows, _ = parse("Compass")
        self.assertEqual(rows[0]["distance"], "15.3")

    def test_walls_defaults_to_feet(self):
        rows, _ = parse("Walls")
        self.assertEqual(rows[0]["distance"], "15")

    def test_walls_meters_directive_converts_to_feet(self):
        rows, warnings = fio.parse_walls(
            "#units Meters Order=DAV\n"
            "M1\tM2\t10.0\t90.0\t0.0\n"
        )
        self.assertEqual(warnings, [])
        self.assertAlmostEqual(float(rows[0]["distance"]), 32.81, places=2)

    def test_survex_defaults_to_metres_and_converts(self):
        # The Survex spec's default length unit is metres, and the fixture has
        # no *units directive -- 4.5 m must plot as 14.76 ft.
        rows, _ = parse("Survex")
        self.assertAlmostEqual(float(rows[0]["distance"]), 14.76, places=2)

    def test_survex_explicit_feet_is_not_converted(self):
        rows, _ = fio.parse_survex(
            "*units length feet\n"
            "*data normal from to tape compass clino\n"
            "S1 S2 10.0 90.0 0.0\n"
        )
        self.assertAlmostEqual(float(rows[0]["distance"]), 10.0, places=6)

    def test_survex_passage_lrud_matched_to_to_station(self):
        rows, _ = parse("Survex")
        # S1->S2 picks up S2's passage entry (0.5 m left -> 1.64 ft).
        self.assertAlmostEqual(float(rows[0]["left"]), 1.64, places=2)


class TestRoundTrip(unittest.TestCase):
    """Parse -> write -> parse must preserve the shot table."""

    def setUp(self):
        self.rows, _ = parse("Compass")
        self.tmp = tempfile.mkdtemp(prefix="cavesurvey-test-")

    def _round_trip(self, fmt, ext):
        path = os.path.join(self.tmp, "rt" + ext)
        fio.WRITERS[fmt](self.rows, HEADER, path)
        with open(path) as fh:
            return fio.PARSERS[fmt](fh.read())[0]

    def _assert_geometry_preserved(self, back):
        self.assertEqual(len(back), len(self.rows))
        for i, (before, after) in enumerate(zip(self.rows, back)):
            with self.subTest(row=i):
                for field in ("distance", "azimuth", "inclination"):
                    self.assertAlmostEqual(float(before[field]),
                                           float(after[field]), places=2)

    def _assert_names_preserved(self, back):
        for i, (before, after) in enumerate(zip(self.rows, back)):
            with self.subTest(row=i):
                self.assertEqual(before["from_name"], after["from_name"])
                self.assertEqual(before["to_name"], after["to_name"])

    def test_compass_round_trip(self):
        back = self._round_trip("Compass", ".dat")
        self._assert_geometry_preserved(back)
        self._assert_names_preserved(back)

    def test_walls_round_trip(self):
        back = self._round_trip("Walls", ".srv")
        self._assert_geometry_preserved(back)
        self._assert_names_preserved(back)

    def test_survex_round_trip_geometry(self):
        # Distances/azimuths do survive -- write_survex declares
        # "*units length feet", so no spurious re-conversion happens.
        self._assert_geometry_preserved(self._round_trip("Survex", ".svx"))

    @unittest.expectedFailure
    def test_survex_round_trip_preserves_station_names(self):
        # KNOWN BUG: write_survex wraps output in "*begin <survey_designation>",
        # so re-importing renames every station A1 -> A.A1.
        self._assert_names_preserved(self._round_trip("Survex", ".svx"))

    @unittest.expectedFailure
    def test_survex_round_trip_preserves_lrud(self):
        # KNOWN BUG: Survex "*data passage" is keyed by station, so when two
        # shots share a TO station the LRUD of one is handed back to both.
        # Here A4->A2 (originally 0/0/0/0) comes back with A1->A2's LRUD.
        back = self._round_trip("Survex", ".svx")
        for i, (before, after) in enumerate(zip(self.rows, back)):
            with self.subTest(row=i):
                for field in ("left", "right", "up", "down"):
                    self.assertAlmostEqual(float(before[field]),
                                           float(after[field]), places=2)

    @unittest.expectedFailure
    def test_survex_round_trip_preserves_notes(self):
        # KNOWN BUG: write_survex emits notes as trailing "; ..." comments,
        # but parse_survex strips everything from the first ";" onward, so it
        # writes a field it cannot read back.
        back = self._round_trip("Survex", ".svx")
        self.assertEqual([r["notes"] for r in back],
                         [r["notes"] for r in self.rows])


@unittest.skipUnless(HAVE_EZDXF, "ezdxf not installed (see tests/README.md)")
class TestDxfBuild(unittest.TestCase):
    def setUp(self):
        self.rows, _ = parse("Compass")
        self.tmp = tempfile.mkdtemp(prefix="cavesurvey-dxf-")
        self.out = os.path.join(self.tmp, "out.dxf")
        self.resolved, self.stations, self.errors = sc.build_dxf(
            os.path.join(REPO, "NSS_Cave_Template_PLAN.dxf"),
            self.out, HEADER, "A1", 0.0, 0.0, self.rows,
        )

    def test_dxf_file_is_written(self):
        self.assertTrue(os.path.getsize(self.out) > 0)

    def test_out_of_order_closure_is_reported_not_guessed(self):
        # A4->A2 names a FROM station that no earlier row defines. The single
        # top-to-bottom pass must report it rather than silently plot it.
        self.assertEqual(len(self.errors), 1)
        index, message = self.errors[0]
        self.assertEqual(index, 4)
        self.assertIn("A4", message)

    def test_error_rows_are_omitted_from_geometry(self):
        self.assertEqual(len(self.resolved), len(self.rows) - len(self.errors))

    def test_expected_ctrl_layers_are_populated(self):
        import ezdxf
        from collections import Counter
        by_layer = Counter(e.dxf.layer
                           for e in ezdxf.readfile(self.out).modelspace())
        for layer in ("CTRL-SHOTS", "CTRL-STATIONS",
                      "CTRL-STATION-LABELS", "CTRL-LRUD"):
            with self.subTest(layer=layer):
                self.assertGreater(by_layer[layer], 0)

    def test_shot_count_matches_resolved_rows(self):
        import ezdxf
        from collections import Counter
        by_layer = Counter(e.dxf.layer
                           for e in ezdxf.readfile(self.out).modelspace())
        self.assertEqual(by_layer["CTRL-SHOTS"], len(self.resolved))


if __name__ == "__main__":
    unittest.main(verbosity=2)
