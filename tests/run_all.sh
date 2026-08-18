#!/bin/bash
#
# Runs every automated test in this repo. See tests/README.md.
#
# Uses .venv/bin/python if a venv exists (so the ezdxf-dependent DXF tests
# run), otherwise falls back to system python3 and skips those.

set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

if [ -x ".venv/bin/python" ]; then
    PY=".venv/bin/python"
else
    PY="python3"
    echo "NOTE: no .venv found -- using system python3, DXF tests will skip."
    echo "      python3 -m venv .venv && .venv/bin/pip install ezdxf matplotlib"
    echo
fi

status=0

echo "=============================================================="
echo " 1/3  Python unit tests (parsers, DXF output, add-on layout)"
echo "=============================================================="
"$PY" -m unittest discover -s tests -v || status=1

QCAD="/Applications/QCAD.app/Contents/Resources/qcad"

echo
echo "=============================================================="
echo " 2/3  Add-on syntax check (inside QCAD's own script engine)"
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
    echo "SKIP: QCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " 3/3  Differential test (QCAD JS parsers vs Python parsers)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    "$PY" tests/differential.py || status=1
else
    echo "SKIP: QCAD not found at $QCAD -- pass --qcad to"
    echo "      tests/differential.py manually if it lives elsewhere."
fi

echo
if [ "$status" -eq 0 ]; then
    echo "ALL TESTS PASSED"
else
    echo "FAILURES ABOVE"
fi
exit "$status"
