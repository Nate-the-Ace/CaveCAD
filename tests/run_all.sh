#!/bin/bash
#
# Runs every automated test in this repo. See tests/README.md.
#
# Uses .venv/bin/python if a venv exists (so the ezdxf-dependent DXF tests
# run), otherwise falls back to system python3 and skips those.
#
#   ./tests/run_all.sh             what has to pass while developing
#   ./tests/run_all.sh --publish   also what has to pass before releasing
#                                  (toolbar icons, status tips)

set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

# Icons aren't needed to develop a tool, only to ship it -- so those checks are
# opt-in rather than a standing failure. See TestPublishReadiness.
case "${1:-}" in
    --publish)
        export CAVESURVEY_PUBLISH_CHECK=1
        echo "Publish checks ENABLED (toolbar icons, status tips)."
        echo
        ;;
    "") ;;
    *)
        echo "usage: $0 [--publish]" >&2
        exit 2
        ;;
esac

PY="python3"

status=0

echo "=============================================================="
echo " 1/14 Structural tests (add-on layout, includes, layers)"
echo "=============================================================="
"$PY" -m unittest discover -s tests -v || status=1

QCAD="/Applications/CaveCAD.app/Contents/MacOS/CaveCAD"

# 13 of the 14 suites need the real engine and print SKIP without it --
# which used to leave "ALL TESTS PASSED" standing on a machine where
# only the structural tests actually ran. Skipping is fine while
# developing without CaveCAD installed; it is not fine as release
# evidence, so --publish turns a missing engine into a failure, and an
# ordinary run says plainly what the pass does and does not cover.
engine=1
if [ ! -e "$QCAD" ]; then
    engine=0
    echo
    if [ -n "${CAVESURVEY_PUBLISH_CHECK:-}" ]; then
        echo "FAIL: CaveCAD not found at $QCAD -- publish checks are"
        echo "      release evidence and the structural tests alone"
        echo "      cannot give it."
        status=1
    else
        echo "NOTE: CaveCAD not found at $QCAD -- the 13 engine suites"
        echo "      below will SKIP."
    fi
fi

echo
echo "=============================================================="
echo " 2/14 Add-on syntax check (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/js_syntax.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SYNTAX OK"*) ;;
        *) echo "Add-on syntax check did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " 3/14 Core unit tests (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/js_unit.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### UNIT OK"*) ;;
        *) echo "Core unit tests did not pass."; status=1 ;;
    esac
else
    echo "NOTE: CaveCAD not found -- running the same tests under node instead."
    if command -v node >/dev/null 2>&1; then
        node tests/js_unit.js || status=1
    else
        echo "SKIP: neither CaveCAD nor node available."
    fi
fi

echo
echo "=============================================================="
echo " 4/14 Profile draw round trip & linework regression (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/profile_draw_roundtrip.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### PROFILE DRAW OK"*) ;;
        *) echo "Profile draw round trip did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- the round trip needs the real engine" \
         "(RDocument, RDocumentInterface, real file I/O) and cannot run" \
         "under node."
fi

echo
echo "=============================================================="
echo " 5/14 Generate Profile tool, driven headlessly (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/generate_profile_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### GENERATE PROFILE RUN OK"*) ;;
        *) echo "Generate Profile headless run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this drives the tool's own run()" \
         "function against a real RDocument/RDocumentInterface and" \
         "cannot run under node."
fi

echo
echo "=============================================================="
echo " 6/14 AlignImage stays in the plan frame (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/align_image_frame.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### ALIGN IMAGE FRAME OK"*) ;;
        *) echo "AlignImage frame test did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this calls the tool's own" \
         "per-entity transform() against a real RDocument and cannot" \
         "run under node."
fi

echo
echo "=============================================================="
echo " 7/14 CalloutWrite (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/callout_write.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### CALLOUT-WRITE OK"*) ;;
        *) echo "CalloutWrite test did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this drives CalloutWrite against a" \
         "real RDocument/RDocumentInterface and cannot run under node."
fi

echo
echo "=============================================================="
echo " 8/14 CalloutSync (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/callout_sync.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### CALLOUT-SYNC OK"*) ;;
        *) echo "CalloutSync test did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this drives CalloutSync against a" \
         "real RDocument/RDocumentInterface and cannot run under node."
fi

echo
echo "=============================================================="
echo " 9/14 Package Cave Project (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/package_cave.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### PACKAGE CAVE OK"*) ;;
        *) echo "Package Cave Project test did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this writes a real DXF, strips it," \
         "and shells out to the platform's zip program; none of that" \
         "can run under node."
fi

echo
echo "=============================================================="
echo " 10/14 Export Cave Survey, driven headlessly (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/export_cave_survey_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### EXPORT CAVE SURVEY OK"*) ;;
        *) echo "Export Cave Survey headless run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this drives the tool's own entry" \
         "point against a real RDocument, writes real files and greps" \
         "them, and cannot run under node."
fi

echo
echo "=============================================================="
echo " 11/14 Cross sections (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/cross_section_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### CROSS SECTION OK"*) ;;
        *) echo "Cross section test did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this places real block references" \
         "and reads them back, and cannot run under node."
fi

echo
echo "=============================================================="
echo " 12/14 Sketched cross sections (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/section_sketch_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SECTION SKETCH OK"*) ;;
        *) echo "Sketched cross section run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this opens a real bay, moves real" \
         "entities into a real block definition and round-trips it" \
         "through DXF, and cannot run under node."
fi

echo
echo "=============================================================="
echo " 13/14 Aligned scans follow the survey (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/scan_reanchor_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SCAN REANCHOR OK"*) ;;
        *) echo "Scan re-anchor test did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this places real image entities and" \
         "reads QCAD's own image mapping back, and cannot run under node."
fi

echo
echo "=============================================================="
echo " 14/14 Trimming a scanned page (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/scan_trim_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SCAN TRIM OK"*) ;;
        *) echo "Scan trim tests did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
if [ "$status" -eq 0 ]; then
    if [ "$engine" -eq 0 ]; then
        echo "STRUCTURAL TESTS PASSED -- the 13 engine suites were SKIPPED"
        echo "(CaveCAD not installed). This is NOT a full pass."
    elif [ -n "${CAVESURVEY_PUBLISH_CHECK:-}" ]; then
        echo "ALL TESTS PASSED -- including publish checks"
    else
        echo "ALL TESTS PASSED (publish checks not run; use --publish)"
    fi
else
    echo "FAILURES ABOVE"
fi
exit "$status"
