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
echo " 1/9  Structural tests (add-on layout, includes, layers)"
echo "=============================================================="
"$PY" -m unittest discover -s tests -v || status=1

QCAD="/Applications/CaveCAD.app/Contents/MacOS/CaveCAD"

echo
echo "=============================================================="
echo " 2/9  Add-on syntax check (inside CaveCAD's own script engine)"
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
echo " 3/9  Core unit tests (inside CaveCAD's own script engine)"
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
echo " 4/9  Profile draw round trip & linework regression (inside CaveCAD's own script engine)"
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
echo " 5/9  Generate Profile tool, driven headlessly (inside CaveCAD's own script engine)"
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
echo " 6/9  AlignImage stays in the plan frame (inside CaveCAD's own script engine)"
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
echo " 7/9  CalloutWrite (inside CaveCAD's own script engine)"
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
echo " 8/9  CalloutSync (inside CaveCAD's own script engine)"
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
echo " 9/9  Package Cave Project (inside CaveCAD's own script engine)"
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
if [ "$status" -eq 0 ]; then
    if [ -n "${CAVESURVEY_PUBLISH_CHECK:-}" ]; then
        echo "ALL TESTS PASSED -- including publish checks"
    else
        echo "ALL TESTS PASSED (publish checks not run; use --publish)"
    fi
else
    echo "FAILURES ABOVE"
fi
exit "$status"
