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
echo " 1/2  Python unit tests (format_io, survey_core)"
echo "=============================================================="
"$PY" -m unittest discover -s tests -v || status=1

echo
echo "=============================================================="
echo " 2/2  Differential test (QCAD JS parsers vs Python parsers)"
echo "=============================================================="
if [ -e "/Applications/QCAD.app/Contents/Resources/qcad" ]; then
    "$PY" tests/differential.py || status=1
else
    echo "SKIP: QCAD not found at /Applications/QCAD.app -- pass --qcad to"
    echo "      tests/differential.py manually if it lives elsewhere."
fi

echo
if [ "$status" -eq 0 ]; then
    echo "ALL TESTS PASSED"
else
    echo "FAILURES ABOVE"
fi
exit "$status"
