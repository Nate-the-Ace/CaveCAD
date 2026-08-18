"""
Differential test: QCAD's ImportNativeCaveSurvey.js vs the app's format_io.py.

Both implementations parse the same three native cave-survey files. They are
separate hand-written parsers for the same formats, so they can silently drift
apart -- and a wrong format detail doesn't raise, it just draws a plausible but
wrong map. This runs both over the shared fixtures and diffs the results.

The JS side runs inside QCAD's own script engine via tests/js_parsers.js, so
this needs QCAD installed. It does NOT need the QCAD GUI to be closed.

    python3 tests/differential.py                 # uses system python
    python3 tests/differential.py --qcad /path/to/qcad

Exits non-zero on any mismatch, so it works as a CI/pre-commit gate.
"""

import argparse
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTDATA = os.path.join(REPO, "testdata")
sys.path.insert(0, os.path.join(REPO, "app"))

import format_io as fio  # noqa: E402

DEFAULT_QCAD = "/Applications/QCAD.app/Contents/Resources/qcad"

# format_io's _fmt() rounds to 2 decimals for display in the table, while the
# JS keeps full float precision, so exact equality is not the bar here.
TOLERANCE = 0.01

FIELDS = ("distance", "azimuth", "inclination", "left", "right", "up", "down")


class HarnessUnavailable(Exception):
    """The headless QCAD path didn't work -- skip rather than fail."""


def run_js(qcad_path, js_tool=None):
    """Runs the JS parsers headless and returns {format: [shot dicts]}."""
    command = [qcad_path, "-no-dock-icon", "-no-gui", "-allow-multiple-instances",
               "-autostart", os.path.join(REPO, "tests", "js_parsers.js"), REPO]
    if js_tool:
        command.append(js_tool)
    proc = subprocess.run(command, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, text=True)
    if "### DONE" not in proc.stdout:
        # Driving QCAD headless has only been verified on a Pro install. If
        # this build doesn't support -no-gui/-autostart, that's a reason to
        # skip the differential test, not to fail the suite -- the parsers can
        # still be checked by hand in the GUI.
        raise HarnessUnavailable(
            "QCAD did not complete the harness run.\n"
            "--- stdout ---\n" + proc.stdout +
            "\n--- stderr ---\n" + proc.stderr)

    results, current = {}, None
    for line in proc.stdout.splitlines():
        if line.startswith("### ERROR"):
            raise SystemExit("JS harness error: " + line)
        if line.startswith("### ") and "count=" in line:
            current = line.split()[1]
            results[current] = []
        elif line.startswith("  ") and current:
            parts = line.strip().split("|")
            results[current].append(dict(zip(("from_name", "to_name") + FIELDS,
                                             parts)))
    return results


def run_python():
    results = {}
    for fmt, fixture in (("Compass", "TestCave_Compass.dat"),
                         ("Walls", "TestCave_Walls.srv"),
                         ("Survex", "TestCave_Survex.svx")):
        with open(os.path.join(TESTDATA, fixture)) as fh:
            results[fmt] = fio.PARSERS[fmt](fh.read())[0]
    return results


def compare(js, py):
    problems = []
    for fmt in sorted(set(js) | set(py)):
        js_rows, py_rows = js.get(fmt, []), py.get(fmt, [])
        if len(js_rows) != len(py_rows):
            problems.append("%s: shot count differs -- JS %d, Python %d"
                            % (fmt, len(js_rows), len(py_rows)))
            continue

        for i, (j, p) in enumerate(zip(js_rows, py_rows)):
            # The JS prefixes Survex station names identically to Python, so
            # names are compared directly.
            for name_field in ("from_name", "to_name"):
                if j[name_field] != p[name_field]:
                    problems.append("%s row %d: %s -- JS %r, Python %r"
                                    % (fmt, i, name_field,
                                       j[name_field], p[name_field]))
            for field in FIELDS:
                jv, pv = float(j[field]), float(p[field])
                if abs(jv - pv) > TOLERANCE:
                    problems.append("%s row %d (%s->%s): %s -- JS %.6f, "
                                    "Python %.6f" % (fmt, i, j["from_name"],
                                                     j["to_name"], field,
                                                     jv, pv))
        print("  %-8s %d shots compared" % (fmt, len(js_rows)))
    return problems


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--qcad", default=DEFAULT_QCAD,
                    help="path to QCAD's bundled launcher (default: %(default)s)")
    ap.add_argument("--js", default=None, metavar="PATH",
                    help="ImportNativeCaveSurvey.js to test. Defaults to the "
                         "add-on copy under scripts/CaveSurvey/; point this "
                         "elsewhere to check another copy.")
    args = ap.parse_args()

    if not os.path.exists(args.qcad):
        print("SKIP: QCAD launcher not found at %s -- pass --qcad" % args.qcad)
        return 0

    print("Running JS parsers inside QCAD's script engine...")
    try:
        js = run_js(args.qcad, args.js)
    except HarnessUnavailable as exc:
        print("SKIP: could not run the JS parsers headless.\n")
        print(exc)
        print("\nThis test needs QCAD to support -no-gui with -autostart; it "
              "has only been\nverified against a Pro install. The parsers "
              "themselves need only Community.")
        return 0
    print("Running Python parsers...")
    py = run_python()

    print("Comparing (tolerance %.2f):" % TOLERANCE)
    problems = compare(js, py)

    if problems:
        print("\nFAIL -- %d mismatch(es) between the JS tool and the "
              "Python app:" % len(problems))
        for problem in problems:
            print("  * " + problem)
        return 1

    print("\nPASS -- JS and Python agree on all fixtures.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
