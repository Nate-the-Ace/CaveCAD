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
echo " 1/45 Structural tests (add-on layout, includes, layers)"
echo "=============================================================="
"$PY" -m unittest discover -s tests -v || status=1

QCAD="/Applications/CaveCAD.app/Contents/MacOS/CaveCAD"

# 26 of the 27 suites need the real engine and print SKIP without it --
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
        echo "NOTE: CaveCAD not found at $QCAD -- the 25 engine suites"
        echo "      below will SKIP."
    fi
fi

echo
echo "=============================================================="
echo " 2/45 Add-on syntax check (inside CaveCAD's own script engine)"
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
echo " 3/45 Core unit tests (inside CaveCAD's own script engine)"
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
echo " 4/45 Profile draw round trip & linework regression (inside CaveCAD's own script engine)"
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
echo " 5/45 Generate Profile tool, driven headlessly (inside CaveCAD's own script engine)"
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
echo " 6/45 AlignImage stays in the plan frame (inside CaveCAD's own script engine)"
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
echo " 7/45 CalloutWrite (inside CaveCAD's own script engine)"
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
echo " 8/45 CalloutSync (inside CaveCAD's own script engine)"
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
echo " 9/45 Callout's elevation mode (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/callout_elev_mode.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### CALLOUT ELEV MODE OK"*) ;;
        *) echo "Callout elevation mode test did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this drives Callout's elevation " \
         "mode against a real RDocument/RDocumentInterface and cannot " \
         "run under node."
fi

echo
echo "=============================================================="
echo " 10/45 Repair Drawing (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/repair_drawing_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### REPAIR DRAWING OK"*) ;;
        *) echo "Repair Drawing test did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this drives CsRepair against a" \
         "real RDocument/RDocumentInterface and cannot run under node."
fi

echo
echo "=============================================================="
echo " 11/45 Reset Drawing empties a cave drawing (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/reset_drawing_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### RESET DRAWING OK"*) ;;
        *) echo "Reset Drawing test did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- the rules are unit-tested in" \
         "js_unit.js; this stage proves a real document comes back" \
         "empty, images and georeference intact, and cannot run under node."
fi

echo
echo "=============================================================="
echo " 12/45 Package Cave Project (inside CaveCAD's own script engine)"
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
echo " 13/45 Export Cave Survey, driven headlessly (inside CaveCAD's own script engine)"
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
echo " 14/45 Cross sections (inside CaveCAD's own script engine)"
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
echo " 15/45 Sketched cross sections (inside CaveCAD's own script engine)"
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
echo " 16/45 Aligned scans follow the survey (inside CaveCAD's own script engine)"
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
echo " 17/45 Trimming a scanned page (inside CaveCAD's own script engine)"
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
echo "=============================================================="
echo " 18/45 Rotating a scanned page on disk (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/scan_rotate_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SCAN ROTATE OK"*) ;;
        *) echo "Scan rotate tests did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " 19/45 A sketch placed through ONE station (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/scan_one_station_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### ONE STATION OK"*) ;;
        *) echo "One-station placement tests did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " 20/45 The template pour (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/cave_template_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### CAVE TEMPLATE OK"*) ;;
        *) echo "Template pour test did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this pours the real template DXF" \
         "into a real document and cannot run under node."
fi

echo
echo "=============================================================="
echo " 21/45 Pitfall Cave audit (the fixture manifest, executed)"
echo "=============================================================="
if command -v node >/dev/null 2>&1; then
    node tests/pitfall_audit.js || status=1
else
    echo "SKIP: node not available -- this audit is pure ECMAScript and" \
         "does not need the engine, only an interpreter."
fi

echo
echo "=============================================================="
echo " 22/45 The 3D passage mesh, built from Pitfall Cave"
echo "=============================================================="
if command -v node >/dev/null 2>&1; then
    node tests/cave3d_mesh_run.js || status=1
else
    echo "SKIP: node not available -- CsMesh3d is pure ECMAScript and" \
         "needs only an interpreter, not the engine."
fi

echo
echo "=============================================================="
echo " 23/45 Cross sections read out of a drawing and placed in 3D"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/cave3d_sections_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### CAVE3D SECTIONS OK"*) ;;
        *) echo "Cross sections in 3D did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this builds a real block reference" \
         "in a real document and cannot run under node."
fi

echo
echo "=============================================================="
echo " 24/45 Sketch scans read out of a drawing and draped"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/cave3d_drape_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### CAVE3D DRAPE OK"*) ;;
        *) echo "Sketch scan drape did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this writes a real image into a real" \
         "cave folder and places it in a real document."
fi

echo
echo "=============================================================="
echo " 25/45 Scatter Breakdown picks its view by location (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/scatter_breakdown_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SCATTER BREAKDOWN OK"*) ;;
        *) echo "Scatter Breakdown run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this drives the real tool against a" \
         "real RDocument with real band boxes, and cannot run under node."
fi

echo
echo "=============================================================="
echo " 26/45 Edit Trip retags a trip without forking it (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/edit_trip_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### EDIT TRIP OK"*) ;;
        *) echo "Edit Trip run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this retags a real drawing and reads" \
         "it back through CsRevise.surveyFromDocument, which needs the" \
         "real engine."
fi

echo
echo "=============================================================="
echo " 27/45 Incremental Notebook Draw matches a full redraw (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/notebook_partial_draw_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### PARTIAL DRAW OK"*) ;;
        *) echo "Incremental Notebook Draw did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this draws the same page into two" \
         "real drawings, one path each, and compares them."
fi

echo
echo "=============================================================="
echo " 28/45 Surface Data (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/surface_data_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SURFACE DATA OK"*) ;;
        *) echo "Surface Data test did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this drives CsSurfaceData against a" \
         "real RDocument/RDocumentInterface and cannot run under node."
fi

echo
echo "=============================================================="
echo " 29/45 The geometry behind ScanAlign (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/test_align_math.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### ALIGN MATH OK"*) ;;
        *) echo "ScanAlign geometry tests did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- these fit real RVector geometry and" \
         "warp a real RImageEntity, and cannot run under node."
fi

echo
echo "=============================================================="
echo " 30/45 Symbol Palette: symbols survive a file, and land in the"
echo "       view they were dropped in (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/symbol_palette_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SYMBOL PALETTE OK"*) ;;
        *) echo "Symbol Palette run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this writes a real DXF template and" \
         "reads its XDATA back, and cannot run under node."
fi

echo
echo "=============================================================="
echo " 31/45 Traced and shaped lines grow instead of piling up (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/feature_trace_extend.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### FEATURE TRACE EXTEND OK"*) ;;
        *) echo "Feature Trace extend run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this grows a real spline in place and" \
         "reads its XDATA back, and cannot run under node."
fi

echo
echo "=============================================================="
echo " 32/45 Traced linework says which trip drew it (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/trip_stamp_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### TRIP STAMP OK"*) ;;
        *) echo "Trip stamp run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this draws a real two-trip survey and" \
         "reads XDATA back off traced linework, and cannot run under node."
fi

echo
echo "=============================================================="
echo " 33/45 Check Map reads a real drawing (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/check_map_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### CHECK MAP OK"*) ;;
        *) echo "Check Map run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- the checks are unit-tested over" \
         "literal scans in js_unit.js; this stage proves the DOCUMENT" \
         "half and needs a real one."
fi

echo
echo "=============================================================="
echo " 34/45 Build Legend explains the lines too (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/build_legend_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### BUILD LEGEND OK"*) ;;
        *) echo "Build Legend run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- the row logic is unit-tested over" \
         "literal usage objects in js_unit.js; this stage proves the" \
         "scan and the drawn samples, and needs a real document."
fi

echo
echo "=============================================================="
echo " 35/45 Sheet Setup builds a printable sheet (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/sheet_setup_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SHEET SETUP OK"*) ;;
        *) echo "Sheet Setup run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- the plot-scale arithmetic is" \
         "unit-tested in js_unit.js; this stage proves the drawn sheet" \
         "and needs a real document."
fi

echo
echo "=============================================================="
echo " 36/45 Loop Errors draws the closure where it happened (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/loop_errors_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### LOOP ERRORS OK"*) ;;
        *) echo "Loop Errors run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- the exaggeration and the bands are" \
         "unit-tested in js_unit.js; this stage needs a real survey in a" \
         "real document."
fi

echo
echo "=============================================================="
echo " 37/45 One Complete mark, two panels (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/scan_marks_sync.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SCAN MARKS OK"*) ;;
        *) echo "Scan marks sync did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this round-trips through the real" \
         "RSettings and cannot run under node."
fi

echo
echo "=============================================================="
echo " 38/45 The teaching cave hands out a sanitized copy (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/teaching_cave_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### TEACHING CAVE OK"*) ;;
        *) echo "Teaching Cave run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- the paths and the plans are" \
         "unit-tested in js_unit.js; this stage moves real files and" \
         "reads the sanitized drawing back off disk."
fi

echo
echo "=============================================================="
echo " 39/45 Area Fill builds and clears a fill in a real drawing (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/area_fill_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### AREA FILL OK"*) ;;
        *) echo "Area Fill run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this drives RHatchData and" \
         "RBlockReferenceEntity against a real RDocument and cannot" \
         "run under node."
fi

echo
echo "=============================================================="
echo " 40/45 Our own spline maths: a curve through the traced points (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/spline_fit_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SPLINE FIT OK"*) ;;
        *) echo "Spline fit run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this builds real RSpline entities" \
         "and round-trips one through DXF, which is the assertion the" \
         "vanished-on-save failure would trip."
fi

echo
echo "=============================================================="
echo " 41/45 Wall Edging: stone glyphs outside the walls, on a switch (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/wall_edging_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### WALL EDGING OK"*) ;;
        *) echo "Wall Edging run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this drives the switch against a"
         "real survey, which is the only place the side rule is"
         "answered by actual stations."
fi

echo
echo "=============================================================="
echo " 42/45 A DXF value line longer than the read buffer (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/dxf_long_line_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### DXF LONG LINE OK"*) ;;
        *) echo "DXF long line run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this reads a drawing through the real" \
         "DXF importer, which is the only place the reader can lose step" \
         "on an over-long line."
fi

echo
echo "=============================================================="
echo " 43/45 Relinking a scan puts back the box, not the page (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/scan_relink_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SCAN RELINK OK"*) ;;
        *) echo "Scan relink run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this cuts a real derivative with" \
         "QImage and relinks real image entities, which is the only" \
         "place the trim box can be dropped."
fi

echo
echo "=============================================================="
echo " 44/45 Trimming a scan to a traced outline (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/scan_outline_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SCAN OUTLINE OK"*) ;;
        *) echo "Scan outline run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this masks a real QImage to a" \
         "concave outline and relinks it, which is the only place the" \
         "mask can come back as the whole box."
fi

echo
echo "=============================================================="
echo " 45/45 A Therion sketch becomes real map ink (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/sketch_import_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SKETCH IMPORT OK"*) ;;
        *) echo "Sketch import run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- the parser, the mapping and the" \
         "placement are unit-tested in js_unit.js; this stage writes" \
         "real entities through CsSymbols.insert, CsShapeLine.dress and" \
         "CsArea.create and cannot run under node."
fi


echo
if [ "$status" -eq 0 ]; then
    if [ "$engine" -eq 0 ]; then
        echo "STRUCTURAL TESTS PASSED -- the 38 engine suites were SKIPPED"
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
