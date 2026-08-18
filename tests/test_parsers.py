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

# NOTE ON QCAD EDITIONS: nothing here or in the tools themselves needs QCAD
# Pro -- the scripts use only scripts/simple.js, RVector, RLineweight and
# RBlockReference*, all core API. The headless harness driven by
# differential.py has only been verified against a Pro install, though; see
# tests/README.md.

import os
import sys
import tempfile
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTDATA = os.path.join(REPO, "testdata")
TEMPLATES = os.path.join(REPO, "templates")
sys.path.insert(0, os.path.join(REPO, "app"))

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
    with open(os.path.join(TESTDATA, FIXTURES[fmt])) as fh:
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

    def test_survex_round_trip_preserves_station_names(self):
        # Unprefixed names (as imported from Compass) must NOT gain a survey
        # prefix on export: "A1" has to come back as "A1", not "A.A1".
        self._assert_names_preserved(self._round_trip("Survex", ".svx"))

    def test_survex_round_trip_preserves_notes(self):
        back = self._round_trip("Survex", ".svx")
        self.assertEqual([r["notes"] for r in back],
                         [r["notes"] for r in self.rows])

    def test_survex_round_trip_of_prefixed_names(self):
        # A survey that really did come from Survex keeps its hierarchy: the
        # shared "TestSurvey" prefix goes back out as *begin TestSurvey.
        rows, _ = parse("Survex")
        path = os.path.join(self.tmp, "prefixed.svx")
        fio.write_survex(rows, HEADER, path)
        with open(path) as fh:
            text = fh.read()
        self.assertIn("*begin TestSurvey", text)
        back, _ = fio.parse_survex(text)
        self.assertEqual([r["from_name"] for r in back],
                         [r["from_name"] for r in rows])
        self.assertEqual([r["to_name"] for r in back],
                         [r["to_name"] for r in rows])

    def test_survex_export_does_not_invent_a_begin_block(self):
        path = os.path.join(self.tmp, "bare.svx")
        fio.write_survex(self.rows, HEADER, path)
        with open(path) as fh:
            text = fh.read()
        self.assertNotIn("*begin", text)
        self.assertNotIn("*end", text)


class TestSurvexPassageLrud(unittest.TestCase):
    """
    Survex stores passage size per STATION, not per shot, so per-shot LRUD has
    to be collapsed onto stations on export. Blanks must not clobber real
    measurements, and genuinely contradictory ones must be reported.
    """

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="cavesurvey-lrud-")

    def _write(self, rows):
        path = os.path.join(self.tmp, "lrud.svx")
        warnings = fio.write_survex(rows, HEADER, path)
        with open(path) as fh:
            return warnings, fh.read()

    def test_blank_lrud_does_not_overwrite_a_real_measurement(self):
        # A4->A2 carries no measurements; A1->A2 measured the passage at A2.
        # A2 must keep the real numbers, and no warning is warranted.
        rows, _ = parse("Compass")
        warnings, text = self._write(rows)
        self.assertEqual(warnings, [])
        self.assertIn("A2 2.10 4.00 0.50 6.20", text)

    def test_blank_lrud_round_trips_as_the_stations_real_size(self):
        # A4->A2 comes back carrying A2's passage size. That's correct: the
        # passage at A2 is the same whichever shot you arrived on.
        rows, _ = parse("Compass")
        _, text = self._write(rows)
        back, _ = fio.parse_survex(text)
        arriving_at_a2 = [r for r in back if r["to_name"] == "A2"]
        self.assertTrue(arriving_at_a2)
        for row in arriving_at_a2:
            self.assertAlmostEqual(float(row["left"]), 2.10, places=2)

    def test_contradictory_lrud_is_reported_not_silently_dropped(self):
        rows = [
            fio._row("A1", "A2", 10, 90, 0, 2.0, 3.0, 1.0, 4.0),
            fio._row("A3", "A2", 12, 180, 0, 9.0, 9.0, 9.0, 9.0),
        ]
        warnings, text = self._write(rows)
        self.assertEqual(len(warnings), 1)
        self.assertIn("A2", warnings[0])
        # The message has to name both shots so the surveyor can go fix the
        # data, and say which one was kept.
        self.assertIn("A1", warnings[0])
        self.assertIn("A3", warnings[0])
        # First one wins; the loser must not also be written.
        self.assertIn("A2 2.00 3.00 1.00 4.00", text)
        self.assertNotIn("9.00", text)

    def test_identical_lrud_from_two_shots_is_not_a_conflict(self):
        rows = [
            fio._row("A1", "A2", 10, 90, 0, 2.0, 3.0, 1.0, 4.0),
            fio._row("A3", "A2", 12, 180, 0, 2.0, 3.0, 1.0, 4.0),
        ]
        warnings, _ = self._write(rows)
        self.assertEqual(warnings, [])


class TestWriterContract(unittest.TestCase):
    """Every writer returns a warnings list, so the app can stay format-blind."""

    def setUp(self):
        self.rows, _ = parse("Compass")
        self.tmp = tempfile.mkdtemp(prefix="cavesurvey-contract-")

    def test_all_writers_return_a_list(self):
        for fmt, ext in (("Compass", ".dat"), ("Walls", ".srv"),
                         ("Survex", ".svx")):
            with self.subTest(fmt=fmt):
                result = fio.WRITERS[fmt](
                    self.rows, HEADER, os.path.join(self.tmp, "w" + ext))
                self.assertIsInstance(result, list)

    def test_notes_with_newlines_cannot_break_a_survex_line(self):
        rows = [fio._row("A1", "A2", 10, 90, 0, 0, 0, 0, 0,
                         "line one\nline two")]
        path = os.path.join(self.tmp, "note.svx")
        fio.write_survex(rows, HEADER, path)
        with open(path) as fh:
            body = [ln for ln in fh.read().splitlines()
                    if ln and not ln.startswith((";", "*"))]
        self.assertEqual(len(body), 1)
        self.assertIn("line one line two", body[0])


@unittest.skipUnless(HAVE_EZDXF, "ezdxf not installed (see tests/README.md)")
class TestDxfBuild(unittest.TestCase):
    def setUp(self):
        self.rows, _ = parse("Compass")
        self.tmp = tempfile.mkdtemp(prefix="cavesurvey-dxf-")
        self.out = os.path.join(self.tmp, "out.dxf")
        self.resolved, self.stations, self.errors = sc.build_dxf(
            os.path.join(TEMPLATES, "NSS_Cave_Template_PLAN.dxf"),
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
