#!/bin/sh
#
# Builds a release and installs it into QCAD's per-user scripts folder, so a
# build can be tested exactly the way it will be shipped.
#
#   ./tools/publish.sh                  build, install into QCAD, archive the zip
#   ./tools/publish.sh --version 1.1.0
#   ./tools/publish.sh --uninstall      remove the add-on from QCAD again
#
# QCAD has no setting for where add-ons live -- it looks in its own application
# folder and in the per-user folder below, and nowhere else. So the add-on goes
# straight into the per-user one, as real files, which is also what a user's
# install.sh run produces. Nothing is symlinked and nothing is left for QCAD to
# resolve at startup.
#
#   ~/Library/Application Support/QCAD/QCAD/scripts/CaveSurvey   (macOS)
#   ~/.local/share/QCAD/QCAD/scripts/CaveSurvey                  (Linux)
#
# The rest of the release -- the zip, templates, examples, install notes -- goes
# to the Cave folder instead of into QCAD's scripts folder, because QCAD scans
# that folder looking for add-ons and anything else there is just clutter in the
# way.
#
#   CAVE=~/elsewhere ./tools/publish.sh       archive somewhere else
#   SCRIPTS=/path/to/scripts ./tools/publish.sh   install somewhere else
#
# The counterpart is install_for_testing.sh in the AlignImage project, which
# links QCAD straight at the working copies for edit-and-restart iteration.
# This script goes through a real verified build instead, so what you test is
# what a release contains -- including AlignImage, which only ever meets the
# other five tools in a build.

set -e

cd "$(dirname "$0")/.." || exit 1
REPO="$PWD"

CAVE=${CAVE:-"$HOME/Documents/Cave"}

if [ -z "${SCRIPTS:-}" ]; then
    case "$(uname -s)" in
        Darwin) SCRIPTS="$HOME/Library/Application Support/QCAD/QCAD/scripts" ;;
        *)      SCRIPTS="${XDG_DATA_HOME:-$HOME/.local/share}/QCAD/QCAD/scripts" ;;
    esac
fi
DEST="$SCRIPTS/CaveSurvey"

# QCAD reads add-ons once, at startup. A publish while it is running looks like
# it did nothing, which is worth saying out loud rather than leaving to be
# rediscovered.
running() {
    pgrep -f "QCAD.app/Contents/MacOS/QCAD" >/dev/null 2>&1 || pgrep -x qcad >/dev/null 2>&1
}

# ----------------------------------------------------------------- uninstall
if [ "$1" = "--uninstall" ]; then
    if [ -e "$DEST" ] || [ -L "$DEST" ]; then
        rm -rf "$DEST"
        echo "Removed $DEST"
        echo "Restart QCAD; the Cave Survey menu will be gone."
    else
        echo "Nothing to remove -- not installed at $DEST"
    fi
    exit 0
fi

VERSION=$(cat VERSION)
while [ $# -gt 0 ]; do
    case "$1" in
        --version) VERSION="${2:-}"; shift 2 || exit 2 ;;
        *) echo "usage: $0 [--version X.Y.Z] [--uninstall]" >&2; exit 2 ;;
    esac
done

# --------------------------------------------------------------------- build
# Every structural check, plus a parse of each script in QCAD's own engine.
# Nothing is installed if it fails, so a broken build can't replace a working
# install with one that silently drops out of the menu.
"$REPO/tools/make_package.sh" --version "$VERSION"

NAME="CaveSurveyTools-$VERSION"
STAGE="$REPO/dist/$NAME"
ZIP="$REPO/dist/$NAME.zip"

for f in "$STAGE/CaveSurvey/CaveSurvey.js" "$ZIP"; do
    if [ ! -e "$f" ]; then
        echo "Build reported success but $f isn't there -- nothing published." >&2
        exit 1
    fi
done

# ----------------------------------------------------- install into QCAD
# Replaced outright rather than merged: a tool dropped from this release must
# not linger in QCAD's copy and go on appearing in the menu.
if [ -L "$DEST" ]; then
    echo
    echo "Replacing a symlinked install at $DEST"
elif [ -d "$DEST" ] && [ -n "$(find "$DEST" -maxdepth 1 -type l)" ]; then
    echo
    echo "Replacing a linked development install at $DEST"
    echo "(install_for_testing.sh links; re-run it if you want those back)"
elif [ -d "$DEST" ]; then
    echo
    echo "Replacing the existing install at $DEST"
fi
rm -rf "$DEST"
mkdir -p "$SCRIPTS"
cp -R "$STAGE/CaveSurvey" "$DEST"

# ------------------------------------------------------- archive the release
# Kept out of QCAD's scripts folder on purpose -- see the note at the top.
mkdir -p "$CAVE/releases"
cp "$ZIP" "$CAVE/releases/$NAME.zip"

for extra in templates examples docs INSTALL.txt README.txt LICENSE install.sh install.cmd; do
    rm -rf "$CAVE/$extra"
    [ -e "$STAGE/$extra" ] && cp -R "$STAGE/$extra" "$CAVE/$extra"
done

COMMIT=$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo "an untracked working copy")
git -C "$REPO" diff --quiet HEAD 2>/dev/null || COMMIT="$COMMIT (with uncommitted changes)"

cat > "$CAVE/PUBLISHED.txt" <<NOTE
Cave Survey tools $VERSION
published $(date -u "+%Y-%m-%d %H:%M UTC") from $COMMIT
built by qcad-azimuth-tool/tools/publish.sh

Installed into QCAD at:
  $DEST

QCAD has no setting for that location -- it is one of the two folders QCAD
looks in, so the add-on is installed there directly.

Past builds are in releases/. To go back to one, unzip it and run its
install.sh. Restart QCAD after any change; add-ons load only at startup.
NOTE

# ---------------------------------------------------------------- and report
echo
echo "Published $NAME"
echo "  into QCAD:  $DEST"
echo "  archived:   $CAVE/releases/$NAME.zip"
echo
echo "Tools installed:"
for tool in "$DEST"/*/; do
    [ -d "$tool" ] && echo "  $(basename "$tool")"
done
echo
if running; then
    echo "QCAD is running right now, and it only reads add-ons at startup --"
    echo "this publish will not show up until you quit it completely and"
    echo "start it again."
else
    echo "Start QCAD and look for 'Cave Survey' in the menu bar."
fi
