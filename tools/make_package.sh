#!/bin/bash
#
# Builds the drop-in package: one zip holding every published Cave Survey tool,
# the templates, sample surveys and install notes.
#
#   ./tools/make_package.sh              build dist/CaveSurveyTools-<version>.zip
#   ./tools/make_package.sh --version 1.1.0
#   ./tools/make_package.sh --stage-only  leave the folder, skip the zip
#
# The staged package is checked before it is zipped, using the same structural
# tests the repo uses, with the publish gate on.

set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
REPO="$PWD"

VERSION=$(cat VERSION)
STAGE_ONLY=""

while [ $# -gt 0 ]; do
    case "$1" in
        --version) VERSION="${2:-}"; shift 2 || exit 2 ;;
        --stage-only) STAGE_ONLY=1; shift ;;
        *) echo "usage: $0 [--version X.Y.Z] [--stage-only]" >&2; exit 2 ;;
    esac
done

if [ -z "$VERSION" ]; then
    echo "No version: VERSION is empty and --version wasn't given." >&2
    exit 1
fi

NAME="CaveSurveyTools-$VERSION"
DIST="$REPO/dist"
STAGE="$DIST/$NAME"

echo "Building $NAME"
echo

# ---------------------------------------------------------------- assemble
rm -rf "$STAGE"
rm -f "$DIST/$NAME.zip"   # so a failed build can't leave last build's zip looking current
mkdir -p "$STAGE"

# the add-on itself: the menu builder plus one folder per tool
cp -R "$REPO/scripts/CaveSurvey" "$STAGE/CaveSurvey"

# templates, sample surveys, licence
mkdir -p "$STAGE/templates" "$STAGE/examples" "$STAGE/docs"
cp "$REPO/templates/"*.dxf "$STAGE/templates/"

# the NSS templates also ship INSIDE the add-on: the default-new hook
# (CaveTemplate) finds them beside itself, nothing to configure
mkdir -p "$STAGE/CaveSurvey/Templates"
cp "$REPO/templates/"*.dxf "$STAGE/CaveSurvey/Templates/"
cp "$REPO/testdata/"* "$STAGE/examples/"
cp "$REPO/LICENSE" "$STAGE/LICENSE"

# install notes and installers, with the build stamped in
COMMIT=$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo "an untracked working copy")
if ! git -C "$REPO" diff --quiet HEAD 2>/dev/null; then
    COMMIT="$COMMIT (with uncommitted changes)"
fi
BUILD=$(date -u "+%Y-%m-%d")

for f in INSTALL.txt README.txt; do
    sed -e "s|@VERSION@|$VERSION|g" \
        -e "s|@BUILD@|$BUILD|g" \
        -e "s|@COMMIT@|$COMMIT|g" \
        "$REPO/tools/package-files/$f" > "$STAGE/$f"
done
cp "$REPO/tools/package-files/install.sh" "$STAGE/install.sh"
cp "$REPO/tools/package-files/install.cmd" "$STAGE/install.cmd"
chmod +x "$STAGE/install.sh"

# things that help nobody downstream
find "$STAGE" -name ".DS_Store" -delete
find "$STAGE" -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null
find "$STAGE" -name "*.pyc" -delete

# ----------------------------------------------------------------- verify
echo "Checking the staged package (structure, icons, status tips, menu order)"
echo
PY="python3"

CAVESURVEY_PUBLISH_CHECK=1 \
CAVESURVEY_ADDON="$STAGE/CaveSurvey" \
CAVESURVEY_TEMPLATES="$STAGE/templates" \
    "$PY" -m unittest tests.test_addon -v
if [ $? -ne 0 ]; then
    echo
    echo "Package checks failed -- $NAME was NOT built." >&2
    echo "The staged copy is left at $STAGE for a look." >&2
    exit 1
fi

# Parse every script in the package with QCAD's own engine. This is the only
# check AlignImage's source gets from this repo, and a tool that won't parse is
# a tool that just isn't in the menu -- with no error anywhere to say why.
QCAD="/Applications/QCAD.app/Contents/Resources/qcad"
if [ -e "$QCAD" ]; then
    echo
    echo "Parsing the package in QCAD's script engine"
    echo
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/js_syntax.js "$STAGE/CaveSurvey" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SYNTAX OK"*) ;;
        *)
            echo
            echo "Package scripts did not parse -- $NAME was NOT built." >&2
            echo "The staged copy is left at $STAGE for a look." >&2
            exit 1
            ;;
    esac
else
    echo
    echo "note: QCAD not found at $QCAD -- package scripts were NOT parsed."
    echo "      Structure was still checked. Install QCAD to close this gap."
fi

# every tool the menu builder will find, for the record
echo
echo "Tools in the package:"
for tool in "$STAGE/CaveSurvey"/*/; do
    echo "  $(basename "$tool")"
done

# -------------------------------------------------------------------- zip
if [ -n "$STAGE_ONLY" ]; then
    echo
    echo "Staged (not zipped): $STAGE"
    exit 0
fi

( cd "$DIST" && zip -r -q -X "$NAME.zip" "$NAME" -x "*.DS_Store" )
if [ $? -ne 0 ]; then
    echo "zip failed" >&2
    exit 1
fi

echo
echo "Built: dist/$NAME.zip  ($(du -h "$DIST/$NAME.zip" | cut -f1 | tr -d ' '))"
echo "Unzip it and run install.sh, or copy its CaveSurvey folder into QCAD's"
echo "scripts folder by hand -- see INSTALL.txt inside."
