"""
Structural tests for the scripts/CaveSurvey/ QCAD add-on.

Almost none of this needs QCAD -- it's the layout and menu wiring that QCAD
relies on to find and order the tools. These failures are the miserable kind
to diagnose by hand: a tool that just isn't in the menu, an icon that renders
blank, or two tools whose order silently depends on load sequence. The one
exception is TestAddProfileLayersToolIdempotence, which shells out to CaveCAD
itself (~1s per invocation) because "run the one-shot tool twice and diff the
bytes" cannot be checked any other way; it skips itself when CaveCAD is not
installed at the expected path.

    python3 -m unittest discover -s tests -v

The syntax of each script is checked separately, inside QCAD's own engine, by
tests/js_syntax.js -- see tests/README.md.
"""

import os
import re
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ElementTree

# Some things are only required to ship, not to develop. A tool with no icon is
# perfectly usable from the menu and the command line while it's being written;
# it just can't go out that way. Those checks live in TestPublishReadiness and
# stay off by default -- see tests/README.md.
PUBLISH_CHECK = os.environ.get("CAVESURVEY_PUBLISH_CHECK") == "1"

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# By default these check the add-on as it sits in the repo. tools/make_package.sh
# points them at a staged package instead, so the same rules are enforced on what
# actually ships -- which is the only place AlignImage (a separate project, copied
# in at build time) is ever seen alongside the other tools. A sort order that only
# collides once AlignImage is present is exactly the kind of thing that has to fail
# there rather than in the repo.
ADDON = os.environ.get("CAVESURVEY_ADDON") or os.path.join(REPO, "scripts", "CaveSurvey")
TEMPLATES = os.environ.get("CAVESURVEY_TEMPLATES") or os.path.join(REPO, "templates")

# The menu/toolbar object names created by CaveSurvey.js. A tool that doesn't
# reference both never appears in either place.
WIDGET_NAMES = ["CaveSurveyMenu", "CaveSurveyToolBar"]


# A folder is a TOOL if and only if it contains <Folder>.js. Folders
# without one are libraries (Core/) and are never init'd by QCAD.
LIBRARY_DIRS = {"Core", "Templates"}


def all_dirs():
    return sorted(
        name for name in os.listdir(ADDON)
        if os.path.isdir(os.path.join(ADDON, name))
        and not name.startswith(".")
    )


def tool_dirs():
    return [name for name in all_dirs()
            if os.path.exists(os.path.join(ADDON, name, name + ".js"))]


def tool_source(name):
    with open(os.path.join(ADDON, name, name + ".js")) as fh:
        return fh.read()


def live_init_definition(source):
    """The object name X for a live (non-commented) "X.init = function"
    assignment in source, or None. Parsed line-by-line rather than
    grepped for the substring, same reason as
    test_every_core_file_is_included_by_csall below: a commented-out
    definition must not count as a tool registering itself."""
    for line in source.splitlines():
        stripped = line.strip()
        if stripped.startswith("//"):
            continue
        match = re.match(r'([A-Za-z_][A-Za-z0-9_]*)\.init\s*=\s*function',
                         stripped)
        if match:
            return match.group(1)
    return None


def live_includes(source):
    """Basenames of every live include(includeBasePath + "/...") target
    in source. Same live-line filtering as live_init_definition."""
    found = set()
    for line in source.splitlines():
        stripped = line.strip()
        if stripped.startswith("//"):
            continue
        match = re.search(r'include\(includeBasePath \+ "([^"]+)"\)',
                          stripped)
        if match:
            found.add(os.path.basename(match.group(1)))
    return found


def live_init_calls(source):
    """Object names X for every live "X.init(basePath)" call in source."""
    found = set()
    for line in source.splitlines():
        stripped = line.strip()
        if stripped.startswith("//"):
            continue
        for match in re.finditer(
                r'([A-Za-z_][A-Za-z0-9_]*)\.init\(basePath\)', stripped):
            found.add(match.group(1))
    return found


def sibling_tool_files(name):
    """(filename, initObjectName) for every .js file in a tool's own
    folder, other than <name>.js itself, that defines its own
    "<X>.init = function" -- i.e. registers its own RGuiAction and is
    therefore a second tool riding along in the same folder (ShapedLines'
    draw buttons, SketchSection's Capture/Edit companions), not a plain
    library (CalloutWrite.js, ScanView.js, ...) that <name>.js merely
    calls into. Only these have a menu entry, toolbar button or command
    to lose if the folder's main file forgets to wire them up."""
    folder = os.path.join(ADDON, name)
    out = []
    for filename in sorted(os.listdir(folder)):
        if not filename.endswith(".js") or filename == name + ".js":
            continue
        with open(os.path.join(folder, filename)) as fh:
            source = fh.read()
        obj = live_init_definition(source)
        if obj is not None:
            out.append((filename, obj))
    return out


def find_int(source, call):
    match = re.search(re.escape(call) + r"\((\d+)\)", source)
    return int(match.group(1)) if match else None


# The icon file names a tool really registers. Matching the whole call
# rather than a bare "setIcon(" substring is deliberate: prose mentioning
# setIcon() in a comment must not count as having one.
def icons_referenced(source):
    return re.findall(r'setIcon\(basePath \+ "/([^"]+)"\)', source)


def parse_layer_registry():
    """CONSTANT_NAME -> layer-name string, for every CsLayers.X = "..."
    assignment in Core/CsLayers.js. Shared by TestLayerVocabulary (which
    only needs the values) and anything that needs to resolve a
    CsLayers.SOME_CONSTANT reference found elsewhere in the source back
    to its string."""
    with open(os.path.join(ADDON, "Core", "CsLayers.js")) as fh:
        source = fh.read()
    consts = dict(re.findall(r'CsLayers\.([A-Z_]+) = "([^"]+)"', source))
    # The derived twin constants. CsLayers defines these at load time
    # (see the derivation loop at the bottom of that file) rather than
    # spelling out 100 more assignments, so they exist for every caller
    # -- tools/sync_template_layers.js enumerates the registry by walking
    # CsLayers' string properties -- but appear nowhere in the source
    # text for the regex above to find.
    for name in list(consts.values()):
        for twin in frame_twins(name):
            consts[twin.replace("-", "_")] = twin
    return consts


SHEET_LAYERS = {"0", "Defpoints", "BORDER", "TITLE-BLOCK", "LEGEND",
                "SCALE-BAR"}

# The plan-frame layers CsLayers.NO_TWIN excludes from frame twinning.
# A SECOND copy of that set, written from the JS rather than scraped, on
# the same principle as frame_of below: if the two drift, the twin tests
# disagree with the registry and say so.
NO_TWIN = {"CTRL-AERIAL", "CTRL-CONTOUR", "CTRL-CONTOUR-MAJOR",
           "CTRL-GRID", "CTRL-DATA", "CTRL-HIDDEN", "CTRL-RAW",
           "CROSS-SECTION-MARKERS", "NORTH-ARROW"}


def frame_of(name):
    """Which view a layer belongs to: "plan", "profile", "section" or
    "sheet".

    DELIBERATELY A SECOND IMPLEMENTATION of CsLayers.frameOf, written
    from its rules rather than scraped from its source: if either one
    drifts, the tests that compare frames disagree with the JS and say
    so. Same safe default -- an unclassified layer is plan, never
    profile, so a profile-scoped sweep cannot pick up a stray layer.
    """
    if name in SHEET_LAYERS:
        return "sheet"
    if name.startswith("CTRL-PROFILE-") or name.startswith("PROFILE-"):
        return "profile"
    if name.startswith("CTRL-SECTION-") or name.startswith("SECTION-"):
        return "section"
    return "plan"


def frame_twins(name):
    """The PROFILE and SECTION twin names a plan-frame layer derives, or
    () when it derives none.

    The Python side of the derivation loop at the bottom of
    Core/CsLayers.js -- again a second implementation, so a change to the
    twinning rule has to be made in both places deliberately."""
    if name in SHEET_LAYERS or name in NO_TWIN or frame_of(name) != "plan":
        return ()
    if name.startswith("CTRL-"):
        stem = name[len("CTRL-"):]
        return ("CTRL-PROFILE-" + stem, "CTRL-SECTION-" + stem)
    return ("PROFILE-" + name, "SECTION-" + name)


def parse_defaults_table():
    """name -> (colorName, linetype, lineweightKey) for every layer the
    registry styles: the literal rows of CsLayers.DEFAULTS in
    Core/CsLayers.js, PLUS the frame twins that file derives from them at
    load time.

    Source-scraped rather than imported (this is a QCAD-context .js file,
    not something Python can execute) so a test comparing against it
    tracks edits automatically. The derived half has to be recomputed
    here for the same reason -- the twins exist only after the JS has
    run, and no PROFILE- or SECTION- row appears in the source text at
    all.

    The optional 4th element of a row (the linetype fallback for drawings
    with no NSS_* pattern) is deliberately dropped: it names what to use
    when the real linetype is ABSENT, so it is never the appearance a
    template -- which defines every NSS_* pattern -- actually carries."""
    with open(os.path.join(ADDON, "Core", "CsLayers.js")) as fh:
        source = fh.read()
    match = re.search(r"CsLayers\.DEFAULTS = \{(.*?)\n\};", source, re.S)
    assert match is not None, ("CsLayers.DEFAULTS table not found -- did "
                               "its opening/closing syntax change?")
    entries = re.findall(
        r'"([^"]+)":\s*\[\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)"'
        r'(?:,\s*"[^"]+")?\s*\]',
        match.group(1))
    table = dict((name, (color, linetype, weight))
                 for name, color, linetype, weight in entries)
    for name in list(table):
        for twin in frame_twins(name):
            table[twin] = table[name]
    return table


# Standard SVG/CSS extended colour keywords, as Qt's QColor(name)
# resolves them and RDxfExporter serialises the result into DXF group
# 420 (AutoCAD true colour, 0xRRGGBB). Fixed by the colour-name spec
# itself, not by anything in this repo -- unlike CsLayers.DEFAULTS,
# which an earlier tools/add_profile_layers.js was duplicating, these
# never drift, so hardcoding them here is not that same problem. Only
# populated for the colour names CsLayers.DEFAULTS uses for the layers
# TestSyncTemplateLayersTool checks the appearance of; extend if a
# DEFAULTS row starts using a new one.
SVG_TRUE_COLOR = {
    "cyan": 0x00FFFF,
    "deepskyblue": 0x00BFFF,
    "gold": 0xFFD700,
    "gray": 0x808080,
    "limegreen": 0x32CD32,
    "magenta": 0xFF00FF,
    "peru": 0xCD853F,
    "pink": 0xFFC0CB,
    "red": 0xFF0000,
    "slateblue": 0x6A5ACD,
    "white": 0xFFFFFF,
}


def strip_layer_records(content, names):
    """Removes the named records from a DXF's LAYER table, byte-for-byte
    identical otherwise. Used to fabricate a pre-migration copy of the
    (already-migrated) shipped template, so the tool's ADD path can be
    exercised without a second binary fixture to keep in sync."""
    start = content.index("  0\nTABLE\n  2\nLAYER\n")
    end = content.index("\n  0\nENDTAB\n", start)
    table = content[start:end]
    header, sep, rest = table.partition("\n  0\nLAYER\n")
    assert sep, "LAYER table has no LAYER records to strip from"
    entries = rest.split("\n  0\nLAYER\n")
    kept = [e for e in entries
            if re.search(r"\n  2\n(.+)\n", e).group(1) not in names]
    new_table = header + "\n  0\nLAYER\n" + "\n  0\nLAYER\n".join(kept)
    return content[:start] + new_table + content[end:]


def parse_layer_records(content):
    """name -> {"truecolor": int, "linetype": str, "lineweight": int}
    for every record in a DXF's LAYER table. Companion to
    strip_layer_records() above -- same delimiter logic, read direction
    instead of write."""
    start = content.index("  0\nTABLE\n  2\nLAYER\n")
    end = content.index("\n  0\nENDTAB\n", start)
    table = content[start:end]
    _, sep, rest = table.partition("\n  0\nLAYER\n")
    assert sep, "LAYER table has no LAYER records to parse"
    out = {}
    for entry in rest.split("\n  0\nLAYER\n"):
        name = re.search(r"\n  2\n(.+)\n", entry).group(1)
        truecolor = re.search(r"\n420\n(\d+)\n", entry)
        linetype = re.search(r"\n  6\n(.+)\n", entry)
        lineweight = re.search(r"\n370\n(-?\d+)\n", entry)
        out[name] = {
            "truecolor": int(truecolor.group(1)) if truecolor else None,
            "linetype": linetype.group(1) if linetype else None,
            "lineweight": (int(lineweight.group(1))
                          if lineweight else None),
        }
    return out


class TestAddonLayout(unittest.TestCase):
    def test_addon_has_its_menu_builder(self):
        # CaveSurvey.js must sit beside the tool folders: it creates the menu
        # and toolbar the tools attach themselves to.
        self.assertTrue(os.path.exists(os.path.join(ADDON, "CaveSurvey.js")))

    def test_every_folder_is_a_tool_or_a_known_library(self):
        # QCAD finds an add-on tool as <Tool>/<Tool>.js. A folder without
        # one is invisible to QCAD -- fine for the known libraries, a
        # silent failure for a mistyped tool folder. So libraries are an
        # explicit allowlist, and anything else must be a proper tool.
        for name in all_dirs():
            if name in LIBRARY_DIRS:
                self.assertFalse(
                    os.path.exists(os.path.join(ADDON, name, name + ".js")),
                    "%s is a library but contains %s.js -- QCAD would "
                    "try to init it as a tool" % (name, name))
            else:
                with self.subTest(tool=name):
                    self.assertTrue(
                        os.path.exists(os.path.join(ADDON, name, name + ".js")),
                        "expected %s/%s.js (or add %s to LIBRARY_DIRS if "
                        "it is a new library)" % (name, name, name))

    def test_no_stray_scripts_beside_the_menu_builder(self):
        loose = [f for f in os.listdir(ADDON)
                 if f.endswith(".js") and f != "CaveSurvey.js"]
        self.assertEqual(loose, [], "these belong in their own folders: %s" % loose)

    def test_tools_are_registered_on_the_menu_and_toolbar(self):
        for name in tool_dirs():
            with self.subTest(tool=name):
                source = tool_source(name)
                for widget in WIDGET_NAMES:
                    self.assertIn(widget, source)

    def test_each_tool_points_setscriptfile_at_its_own_file(self):
        for name in tool_dirs():
            with self.subTest(tool=name):
                self.assertIn('setScriptFile(basePath + "/%s.js")' % name,
                              tool_source(name))

    def test_each_tool_has_a_command_line_name(self):
        for name in tool_dirs():
            with self.subTest(tool=name):
                self.assertIn("setDefaultCommands(", tool_source(name))

    def test_referenced_icons_exist(self):
        # A setIcon() pointing at a missing file renders as a blank button.
        # Note this deliberately validates only what a tool references: a
        # tool mid-development with no icon at all is fine day to day, and
        # TestPublishReadiness is what insists on one before shipping.
        for name in tool_dirs():
            source = tool_source(name)
            for icon in icons_referenced(source):
                with self.subTest(tool=name, icon=icon):
                    self.assertTrue(
                        os.path.exists(os.path.join(ADDON, name, icon)),
                        "%s references missing icon %s" % (name, icon))

    def test_sort_orders_are_unique(self):
        # Two tools sharing a sort order within the same group leaves their menu
        # order down to load sequence.
        orders = {}
        for name in tool_dirs():
            source = tool_source(name)
            key = (find_int(source, "action.setGroupSortOrder"),
                   find_int(source, "action.setSortOrder"))
            orders.setdefault(key, []).append(name)
        clashes = {key: names for key, names in orders.items() if len(names) > 1}
        self.assertEqual(clashes, {}, "colliding (group, sort) orders: %s" % clashes)

    def test_every_tool_declares_a_sort_order(self):
        for name in tool_dirs():
            with self.subTest(tool=name):
                self.assertIsNotNone(
                    find_int(tool_source(name), "action.setSortOrder"))


@unittest.skipUnless(PUBLISH_CHECK,
                     "publish check -- run with CAVESURVEY_PUBLISH_CHECK=1, "
                     "or ./tests/run_all.sh --publish")
class TestPublishReadiness(unittest.TestCase):
    """
    Requirements for shipping the add-on to other people, not for working on it.

    A missing icon doesn't stop a tool working, so it shouldn't fail the day-to-
    day suite -- but a released toolbar with blank buttons on it is not
    something to hand a surveyor.
    """

    def test_every_tool_has_an_icon(self):
        # Matched against the real call, not a bare "setIcon(" substring:
        # AerialBasemap once carried the comment "No setIcon() yet -- the
        # icon is Task 4's job", whose text satisfied a substring check and
        # left this gate green for a tool that had no icon at all.
        missing = [name for name in tool_dirs()
                   if not icons_referenced(tool_source(name))]
        self.assertEqual(missing, [], "no toolbar icon: %s" % missing)

    def test_every_icon_is_parseable_svg(self):
        # A file QCAD can't parse renders exactly like a missing one.
        for name in tool_dirs():
            icons = icons_referenced(tool_source(name))
            # Assert before the loop: a tool referencing no icon would
            # otherwise iterate zero times and pass vacuously.
            self.assertTrue(icons, "%s references no icon" % name)
            for icon in icons:
                path = os.path.join(ADDON, name, icon)
                with self.subTest(tool=name, icon=icon):
                    self.assertTrue(os.path.exists(path))
                    root = ElementTree.parse(path).getroot()
                    self.assertTrue(root.tag.endswith("svg"),
                                    "%s is not an <svg> document" % icon)

    def test_every_tool_has_a_status_tip(self):
        # This is the one-line explanation shown when hovering the menu entry --
        # for a layman it's often the only documentation they'll read.
        for name in tool_dirs():
            with self.subTest(tool=name):
                self.assertIn("setStatusTip(", tool_source(name))


class TestTemplates(unittest.TestCase):
    def test_the_plan_template_is_present(self):
        self.assertTrue(os.path.exists(
            os.path.join(TEMPLATES, "NSS_Cave_Template_PLAN.dxf")))

    def test_no_standalone_profile_template_ships(self):
        """One template, not two. NSS_Cave_Template_PROFILE.dxf is
        deleted: no code path ever opened it (CaveTemplateApply loads the
        PLAN template only) and the elevation is drawn INTO the plan
        drawing now, so a standalone elevation sheet would be a second
        answer to "which file do I start from". Its absence is pinned
        rather than merely done, because putting it back also puts back a
        layer set whose view layers carry plan-frame names -- the
        cross-frame collision the frame split exists to remove.
        """
        self.assertFalse(os.path.exists(
            os.path.join(TEMPLATES, "NSS_Cave_Template_PROFILE.dxf")))


class TestIncludes(unittest.TestCase):
    def test_every_include_target_exists(self):
        # include() failing at QCAD startup surfaces as the whole add-on
        # silently missing from the menu -- which is exactly how 2.0.0
        # shipped: include("scripts/CaveSurvey/...") only resolves
        # against QCAD's OWN scripts folder, never the per-user add-on
        # folder, and it fails silently. So suite-internal includes must
        # be includeBasePath-relative, and this test both bans the
        # broken form and checks the relative targets exist.
        for dirpath, _dirnames, filenames in os.walk(ADDON):
            for filename in filenames:
                if not filename.endswith(".js"):
                    continue
                path = os.path.join(dirpath, filename)
                with open(path) as fh:
                    source = fh.read()

                self.assertNotRegex(
                    source, r'include\("scripts/CaveSurvey/',
                    "%s uses include(\"scripts/CaveSurvey/...\"), which "
                    "silently fails from the per-user install -- use "
                    "include(includeBasePath + \"/...\") instead" % filename)

                for target in re.findall(
                        r'include\(includeBasePath \+ "/([^"]+)"\)', source):
                    resolved = os.path.normpath(os.path.join(dirpath, target))
                    with self.subTest(script=filename, include=target):
                        self.assertTrue(
                            os.path.exists(resolved),
                            "%s includes missing %s" % (filename, target))


class TestBasenameCollisions(unittest.TestCase):
    """QCAD's include() dedupes by BASENAME: a library file sharing a
    name with anything QCAD already included (Draw.js, File.js, ...)
    is skipped silently. Cs-prefixed basenames make that impossible,
    so every Core file must carry the prefix."""

    def test_every_core_file_is_included_by_csall(self):
        # A Core file missing from CsAll.js is undefined at runtime in
        # EVERY tool, and nothing else in this suite notices: js_unit.js
        # loads Core files individually with loadRepoScript, so it passes
        # either way. This is the only place that gap is visible.
        core = os.path.join(ADDON, "Core")
        with open(os.path.join(core, "CsAll.js")) as handle:
            source = handle.read()
        # Parse the LIVE include lines, not the file text. A first cut of
        # this test grepped the whole file for the filename, which a
        # commented-out include still satisfies -- so it passed with the
        # include disabled, exactly the vacuous-substring failure the
        # icon test's comment warns about.
        listed = set()
        for line in source.splitlines():
            stripped = line.strip()
            if stripped.startswith("//"):
                continue
            found = re.search(r'include\(includeBasePath \+ "([^"]+)"\)',
                              stripped)
            if found:
                listed.add(os.path.basename(found.group(1)))
        missing = []
        for dirpath, _dirnames, filenames in os.walk(core):
            for filename in sorted(filenames):
                if not filename.startswith("Cs") or \
                        not filename.endswith(".js"):
                    continue
                if filename == "CsAll.js":
                    continue
                if filename not in listed:
                    missing.append(os.path.relpath(
                        os.path.join(dirpath, filename), core))
        self.assertEqual(sorted(missing), [],
                         "these Core files are not included by CsAll.js: "
                         "%s" % sorted(missing))

    def test_core_files_are_cs_prefixed(self):
        core = os.path.join(ADDON, "Core")
        for dirpath, _dirnames, filenames in os.walk(core):
            for filename in filenames:
                if filename.endswith(".js"):
                    with self.subTest(script=filename):
                        self.assertTrue(
                            filename.startswith("Cs"),
                            "%s: Core basenames must start with Cs -- "
                            "include() dedupes by basename and stock "
                            "QCAD's own scripts win" % filename)


class TestSiblingToolsAreWired(unittest.TestCase):
    """QCAD's AddOn.getAddOns (see AddOn.js, around line 545) only ever
    loads <Dir>/<Dir>.js on its own -- it never looks at any other file
    in a tool's folder. A folder can still hold more than one RGuiAction
    (ShapedLines' per-style draw buttons, SketchSection's Capture/Edit
    companions): the ONLY reason those work is that <Dir>.js explicitly
    includes each sibling and calls its init(basePath) itself, the
    pattern documented in ShapedLines.js's own header comment ("sibling
    files QCAD cannot discover on its own").

    SketchSection shipped without doing this for SectionCapture.js and
    SectionEdit.js: both files existed, both passed every file-existence
    and file-shape check in this suite, and neither was reachable from
    the running application -- no menu entry, no toolbar button, no
    "skc"/"ske" command. tests/section_sketch_run.js still passed
    because it loads all three files by hand with loadRepoScript,
    bypassing exactly the discovery path this test checks.

    Note this is deliberately narrower than "every sibling file must be
    included": a sibling with no init() of its own is a plain library
    (CalloutWrite.js, ScanView.js, CaveTemplateApply.js, ...) that its
    folder's tool merely calls into on its own terms, sometimes not even
    via include()+init() at all (CaveTemplateApply.js is registered
    through NewFile.addPostNewAction instead). Only a sibling that
    registers its OWN RGuiAction via its own init() has a menu entry to
    lose.
    """

    def test_every_sibling_tool_is_included_and_initialised(self):
        for name in tool_dirs():
            siblings = sibling_tool_files(name)
            if not siblings:
                continue
            main_source = tool_source(name)
            included = live_includes(main_source)
            called = live_init_calls(main_source)
            for filename, obj in siblings:
                with self.subTest(tool=name, sibling=filename):
                    self.assertIn(
                        filename, included,
                        "%s/%s.js does not include sibling %s -- %s.%s "
                        "would be undefined at runtime" %
                        (name, name, filename, obj, "init"))
                    self.assertIn(
                        obj, called,
                        "%s/%s.js never calls %s.init(basePath) -- %s "
                        "has no menu entry, toolbar button or command "
                        "in the running application" %
                        (name, name, obj, filename))


class TestLayerVocabulary(unittest.TestCase):
    """The layer names in Core/CsLayers.js and the plan template must agree.

    The old importer invented layer names no template carried; this pins
    the registry to the template so the two cannot drift apart again.
    """

    def layer_registry(self):
        return set(parse_layer_registry().values())

    def template_layers(self, name):
        with open(os.path.join(TEMPLATES, name), encoding="utf-8",
                  errors="replace") as fh:
            content = fh.read()
        match = re.search(r"2\nLAYER\n(.*?)\n  0\nENDTAB", content, re.S)
        return set(re.findall(r"^  2\n(.+)$", match.group(1), re.M))

    def test_registry_defines_section_layers(self):
        """Same mutation gap as the profile control layers: the registry
        comparison never asserts a constant EXISTS, so deleting one
        shrinks both sides of it and passes. These are the layers the
        section tool draws on and the caver traces in; a missing one
        means a section lands somewhere nobody looks.
        """
        with open(os.path.join(ADDON, "Core", "CsLayers.js")) as fh:
            source = fh.read()
        # The APPEARANCE half is no longer a literal row in the source:
        # every SECTION- layer below derives its style from its plan twin
        # (see the derivation loop at the bottom of CsLayers.js), so what
        # has to be asserted is that the resolved table has an entry --
        # grepping the source for '"SECTION-CEILING": [' would now fail
        # on a registry that is perfectly correct.
        defaults = parse_defaults_table()
        for constant, layer in [
                ("CTRL_SECTION_BOX", "CTRL-SECTION-BOX"),
                ("CTRL_SECTION_OUTLINE", "CTRL-SECTION-OUTLINE"),
                ("CTRL_SECTION_SPLAYS", "CTRL-SECTION-SPLAYS"),
                ("CTRL_SECTION_STATIONS", "CTRL-SECTION-STATIONS"),
                ("CTRL_SECTION_TEXT_LABELS", "CTRL-SECTION-TEXT-LABELS"),
                ("CTRL_SECTION_SCAN", "CTRL-SECTION-SCAN"),
                ("SECTION_WALLS_SURVEYED", "SECTION-WALLS-SURVEYED"),
                ("SECTION_WALLS_INFERRED", "SECTION-WALLS-INFERRED"),
                ("SECTION_CEILING", "SECTION-CEILING"),
                ("SECTION_FLOOR", "SECTION-FLOOR"),
                ("SECTION_BREAKDOWN", "SECTION-BREAKDOWN")]:
            self.assertIn('CsLayers.%s = "%s";' % (constant, layer), source)
            self.assertIn(layer, defaults,
                          "%s has no resolved appearance -- neither a "
                          "literal DEFAULTS row nor a derivable plan twin"
                          % layer)

    def test_layer_constant_matches_its_layer_name(self):
        """THE ONE NAMING RULE: a layer constant IS its layer name with
        dashes turned into underscores. CsLayers.CTRL_PROFILE_FLOOR is
        "CTRL-PROFILE-FLOOR"; CsLayers.PROFILE_FLOOR is "PROFILE-FLOOR".

        This exists because three conventions had grown side by side --
        30 generated layers whose constant did not say they were
        generated, 18 that did, and 2 traced ones marked _TRACED_ that
        70 others were not. Worse, the SAME constant shape meant
        different KINDS in different frames: PROFILE_FLOOR was the
        generated CTRL-PROFILE-FLOOR while SECTION_FLOOR was the traced
        SECTION-FLOOR, so a reader assuming symmetry got the wrong
        layer. FeatureTrace's own ROWS test still carries a comment
        about that slip costing an hour of tracing.

        A rule a machine can check is the only kind that survives.
        """
        with open(os.path.join(ADDON, "Core", "CsLayers.js")) as fh:
            source = fh.read()
        pairs = re.findall(r'^CsLayers\.([A-Z_0-9]+) = "([^"]+)";',
                           source, re.M)
        self.assertGreater(len(pairs), 100, "the registry should be here")
        wrong = [(c, n) for c, n in pairs if c != n.replace("-", "_")]
        self.assertEqual(wrong, [],
                         "layer constants that do not match their own "
                         "layer name: %s" % wrong)

    def test_registry_layers_exist_in_plan_template(self):
        """EVERY registry layer, with no exemptions. The wall run layers
        used to be exempted here as "created on demand", and they were
        indeed created on demand -- which meant a fresh drawing's Layer
        list did not offer them until the first draw put walls on them,
        and nothing checked what they looked like when it did.
        tools/sync_template_layers.js puts every registry layer in the
        template instead, so the exemption set is gone on purpose: adding
        one back is how a layer goes missing from the template again.
        """
        registry = self.layer_registry()
        plan = self.template_layers("NSS_Cave_Template_PLAN.dxf")
        missing = registry - plan
        self.assertEqual(missing, set(),
                         "layers in Core/CsLayers.js but not the plan "
                         "template: %s" % sorted(missing))

    def test_plan_template_has_every_profile_frame_layer(self):
        """The elevation draws into the plan drawing, so every layer it
        needs must be in the plan template -- not invented at runtime
        with whatever defaults happen to apply. Subsumed by the test
        above now that nothing is exempt from it, and kept anyway: this
        one fails with the word "profile" in the message, which is the
        difference between a one-line diagnosis and a hunt.
        """
        registry = self.layer_registry()
        plan = self.template_layers("NSS_Cave_Template_PLAN.dxf")
        profile_frame = set(n for n in registry
                            if frame_of(n) == "profile")
        self.assertTrue(profile_frame, "no profile-frame layers in the registry")
        missing = profile_frame - plan
        self.assertEqual(missing, set(),
                         "profile-frame layers absent from the PLAN "
                         "template: %s" % sorted(missing))

    def test_registry_defines_profile_control_layers(self):
        """Mutation-tested gap: deleting CsLayers.CTRL_PROFILE_FLOOR and
        CsLayers.CTRL_PROFILE_CEILING left the whole suite green, because
        test_registry_layers_exist_in_plan_template only ever compares
        the registry against the template -- it never asserts a
        particular constant exists at all, so deleting one shrinks both
        sides of the comparison. This pins both the constant and its
        CsLayers.DEFAULTS entry, which also protects
        tools/sync_template_layers.js: that tool reads DEFAULTS through
        CsLayers.ensure() instead of carrying its own copy of a layer's
        appearance, so a deleted or wrong DEFAULTS entry breaks both this
        test and the tool the same way.
        """
        with open(os.path.join(ADDON, "Core", "CsLayers.js")) as fh:
            source = fh.read()
        self.assertIn('CsLayers.CTRL_PROFILE_FLOOR = "CTRL-PROFILE-FLOOR";',
                     source)
        self.assertIn('CsLayers.CTRL_PROFILE_CEILING = "CTRL-PROFILE-CEILING";',
                     source)
        defaults = parse_defaults_table()
        self.assertEqual(defaults.get("CTRL-PROFILE-FLOOR"),
                         ("gray", "DASHED", "Weight000"))
        self.assertEqual(defaults.get("CTRL-PROFILE-CEILING"),
                         ("gray", "DASHED", "Weight000"))

    WALL_RUN_LAYERS = ("CTRL-LRUD-WALL-LEFT", "CTRL-LRUD-WALL-RIGHT")

    def test_registry_defines_the_lrud_wall_layers_as_dashed(self):
        """A wall run is an APPROXIMATION -- straight segments between
        the LRUD ticks and splay tips either side of the centerline, cut
        at junctions and at stations with no wall evidence. It has to
        plot dashed, so a reader can never mistake it for the solid line
        a wall traced onto WALLS-SURVEYED gets. Same shape as the test
        above: the constant AND its appearance, because the comparison
        against the template cannot see a constant that is gone.
        """
        with open(os.path.join(ADDON, "Core", "CsLayers.js")) as fh:
            source = fh.read()
        self.assertIn('CsLayers.CTRL_LRUD_WALL_LEFT = "CTRL-LRUD-WALL-LEFT";',
                      source)
        self.assertIn('CsLayers.CTRL_LRUD_WALL_RIGHT = "CTRL-LRUD-WALL-RIGHT";',
                      source)
        defaults = parse_defaults_table()
        for name in self.WALL_RUN_LAYERS:
            with self.subTest(layer=name):
                self.assertEqual(defaults.get(name),
                                 ("gray", "DASHED", "Weight000"),
                                 "%s must be dashed in CsLayers.DEFAULTS "
                                 "-- an approximated wall may not plot "
                                 "like a traced one" % name)

    def test_plan_template_draws_the_lrud_walls_dashed(self):
        """And dashed in the SHIPPED template, which is what a new
        drawing actually gets: CsLayers.ensure() only reaches DEFAULTS
        for a layer the drawing lacks, so the template's own record is
        the one that decides how these plot in practice.
        """
        with open(os.path.join(TEMPLATES, "NSS_Cave_Template_PLAN.dxf"),
                  encoding="utf-8", errors="replace") as fh:
            records = parse_layer_records(fh.read())
        for name in self.WALL_RUN_LAYERS:
            with self.subTest(layer=name):
                self.assertIn(name, records)
                self.assertNotEqual(
                    (records[name]["linetype"] or "").upper(), "CONTINUOUS",
                    "%s plots solid in the plan template" % name)
                self.assertEqual(
                    (records[name]["linetype"] or "").upper(), "DASHED",
                    "%s: linetype %r in the plan template, expected DASHED"
                    % (name, records[name]["linetype"]))


class TestSyncTemplateLayersTool(unittest.TestCase):
    """tools/sync_template_layers.js must add every registry layer the
    PLAN template lacks, give each the appearance CsLayers.DEFAULTS
    names, and do nothing at all on every run after.

    It replaces tools/add_profile_frame_layers.js, which is deleted,
    which replaced tools/add_profile_layers.js, also deleted. Each of
    those carried a HAND-WRITTEN list of the layers it was responsible
    for, so every layer added to the registry afterwards needed a new
    one-shot tool with a new list -- and the two LRUD wall run layers
    were never in any of them. This tool reads the registry itself.

    The fixture is fabricated FROM the shipped template (records
    stripped) rather than kept as a separate binary file, so it cannot
    drift from the real template the way a second checked-in fixture
    could.

    Shells out to the real CaveCAD engine (~1s per invocation) because
    "run the one-shot tool and inspect what it wrote" cannot be checked
    any other way; every test here skips itself when CaveCAD is not
    installed at the expected path.
    """

    CAVECAD = os.environ.get(
        "CAVESURVEY_CAVECAD",
        "/Applications/CaveCAD.app/Contents/MacOS/CaveCAD")

    # The exact layers the fixture strips and the tool must put back:
    # the whole profile frame, plus the two wall run layers the plan
    # template went without for as long as they were "created on
    # demand". Fixed here independent of the registry, so an edit that
    # drops one from the registry fails this test instead of shrinking
    # its own expectation to match.
    STRIPPED = ("CTRL-PROFILE-SHOTS", "CTRL-PROFILE-STATIONS",
                "CTRL-PROFILE-STATION-LABELS", "CTRL-PROFILE-SPLAYS",
                "CTRL-PROFILE-LRUD", "CTRL-PROFILE-FLOOR",
                "CTRL-PROFILE-CEILING", "PROFILE-CEILING",
                "PROFILE-FLOOR", "PROFILE-WALLS-INFERRED",
                "PROFILE-TEXT-NOTES", "PROFILE-TEXT-LABELS",
                "PROFILE-BREAKDOWN", "PROFILE-ENTRANCE",
                "CTRL-LRUD-WALL-LEFT", "CTRL-LRUD-WALL-RIGHT",
                # The callout style layers, so the sync tool is shown
                # to apply their DEFAULTS colour/linetype/weight when it
                # CREATES them.
                #
                # Be precise about what this does NOT prove. This test
                # strips the layers, re-syncs, and compares the result
                # against DEFAULTS -- so DEFAULTS is both the input and
                # the expectation, and changing a DEFAULTS row moves
                # both sides together. Verified by mutation: inverting
                # NOTES-ELEVATION/NOTES-ELEVATION-LINE leaves this suite
                # green. Nothing here checks that the ALREADY-SHIPPED
                # template agrees with DEFAULTS, and CsLayers.ensure
                # resolves appearance at CREATION only, so a re-sync
                # over existing layers does not recolour them. That is a
                # real, pre-existing gap -- it let
                # ELEVATION/ELEVATION-LINE ship inverted -- and closing
                # it is not a one-liner: 42 of the template's 44
                # registry layers carry an ACI index (group 62) and no
                # truecolour (group 420) at all, so such a test first
                # needs a decision about which representation is
                # canonical.
                "NOTES-HAZARD", "NOTES-DIG", "NOTES-EQUIPMENT",
                "NOTES-NAME", "NOTES-ELEVATION",
                "NOTES-ELEVATION-LINE")

    def setUp(self):
        if not os.path.exists(self.CAVECAD):
            self.skipTest("CaveCAD not found at %s -- see run_all.sh" %
                          self.CAVECAD)

    def run_tool(self, fake_repo_root):
        # -no-dock-icon/-no-gui/-allow-multiple-instances match the
        # invocation documented in the tool's own header and run_all.sh.
        result = subprocess.run(
            [self.CAVECAD, "-no-dock-icon", "-no-gui",
             "-allow-multiple-instances", "-autostart",
             os.path.join(REPO, "tools", "sync_template_layers.js"),
             fake_repo_root],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
        return result.stdout.decode("utf-8", "replace")

    def make_fake_repo(self, tmp, plan_bytes=None):
        """A throwaway repoRoot: the tool derives the Core library
        location AND the template path from this single argument, so it
        needs a real scripts/CaveSurvey/Core (symlinked -- CsLayers.js
        must be the genuine, current one) and a templates/ directory.
        Passing None for plan_bytes leaves the template absent, to
        exercise the importFile-failure branch. Returns the template
        path, which may or may not exist on disk."""
        os.symlink(os.path.join(REPO, "scripts"), os.path.join(tmp, "scripts"))
        os.mkdir(os.path.join(tmp, "templates"))
        path = os.path.join(tmp, "templates", "NSS_Cave_Template_PLAN.dxf")
        if plan_bytes is not None:
            with open(path, "wb") as fh:
                fh.write(plan_bytes)
        return path

    def shipped(self, name):
        with open(os.path.join(TEMPLATES, name), "rb") as fh:
            return fh.read().decode("utf-8", "replace")

    def pre_migration_plan(self):
        """The shipped PLAN template with STRIPPED taken back out of its
        LAYER table, and nothing else touched."""
        return strip_layer_records(
            self.shipped("NSS_Cave_Template_PLAN.dxf"),
            self.STRIPPED).encode("utf-8")

    def expected_ok_lines(self, plan):
        """The two lines the ADD path prints: the summary, then the list.

        The tool restyles as well as adds now, so the summary carries a
        restyle count too -- and over a fixture whose only fault is
        MISSING layers that count is zero, which is itself worth
        asserting: a restyle sweep that "fixed" layers already correct
        would rewrite the shipped template on every run."""
        return ["ok    %s -- %d layer(s) added, 0 of %d restyled"
                % (plan, len(self.STRIPPED), len(parse_defaults_table()) - 1),
                "      added:    " + ", ".join(sorted(self.STRIPPED))]

    def test_add_path_then_idempotence(self):
        defaults = parse_defaults_table()

        with tempfile.TemporaryDirectory() as tmp:
            plan = self.make_fake_repo(tmp, self.pre_migration_plan())

            first = self.run_tool(tmp)
            lines = first.splitlines()
            for expected in self.expected_ok_lines(plan):
                self.assertIn(
                    expected, lines,
                    "the add path did not report the exact expected line "
                    "-- got: %r" % first)
            self.assertIn("### SYNC TEMPLATE LAYERS OK", lines)

            with open(plan, "rb") as fh:
                plan_after = fh.read()

            # every added layer carries its CsLayers.DEFAULTS appearance
            records = parse_layer_records(
                plan_after.decode("utf-8", "replace"))
            for name in self.STRIPPED:
                self.assertIn(
                    name, records,
                    "%s missing from the PLAN template's LAYER table "
                    "after the tool reported adding it" % name)
                color_name, linetype, weight_key = defaults[name]
                expected_truecolor = SVG_TRUE_COLOR[color_name]
                expected_weight = int(weight_key.replace("Weight", ""))
                actual = records[name]
                self.assertEqual(
                    actual["truecolor"], expected_truecolor,
                    "%s: colour 0x%06X does not match CsLayers.DEFAULTS "
                    "%r (0x%06X)" % (name, actual["truecolor"] or 0,
                                     color_name, expected_truecolor))
                self.assertEqual(
                    (actual["linetype"] or "").upper(), linetype.upper(),
                    "%s: linetype %r does not match CsLayers.DEFAULTS %r"
                    % (name, actual["linetype"], linetype))
                self.assertEqual(
                    actual["lineweight"], expected_weight,
                    "%s: lineweight %r does not match CsLayers.DEFAULTS "
                    "%r (%d)" % (name, actual["lineweight"], weight_key,
                                 expected_weight))

            second = self.run_tool(tmp)
            self.assertIn(
                "skip  %s -- every registry layer already present and "
                "correct" % plan,
                second.splitlines(),
                "second run did not report the exact expected skip line "
                "-- got: %r" % second)

            with open(plan, "rb") as fh:
                self.assertEqual(
                    plan_after, fh.read(),
                    "the tool rewrote an already-current PLAN template "
                    "on a second run -- it is supposed to be a no-op "
                    "once every layer is present")

    def test_the_shipped_template_needs_nothing_added(self):
        """The tool has been run against the real template, so a run
        over the shipped bytes must be the pure skip path. This is what
        catches a layer added to the registry and never poured into the
        template -- the exact drift the hand-written-list tools kept
        producing."""
        with tempfile.TemporaryDirectory() as tmp:
            plan = self.make_fake_repo(
                tmp, self.shipped("NSS_Cave_Template_PLAN.dxf")
                .encode("utf-8"))
            output = self.run_tool(tmp)
            self.assertIn(
                "skip  %s -- every registry layer already present and "
                "correct" % plan,
                output.splitlines(),
                "the shipped template is missing a registry layer -- "
                "re-run tools/sync_template_layers.js. Got: %r" % output)

    def test_reports_failure_and_creates_nothing_when_template_is_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            plan = self.make_fake_repo(tmp, plan_bytes=None)

            output = self.run_tool(tmp)

            self.assertIn(
                "FAIL  cannot read " + plan, output.splitlines(),
                "importFile failure on a missing template did not "
                "produce the exact expected FAIL line -- got: %r" %
                output)
            self.assertIn("### SYNC TEMPLATE LAYERS FAIL",
                          output.splitlines())
            self.assertFalse(
                os.path.exists(plan),
                "the tool created a template file after failing to read "
                "one that did not exist -- an ignored importFile "
                "failure would do exactly this")

    def test_reports_failure_and_leaves_file_untouched_when_export_fails(self):
        pre_bytes = self.pre_migration_plan()

        with tempfile.TemporaryDirectory() as tmp:
            plan = self.make_fake_repo(tmp, pre_bytes)
            # A read-only target FILE: importFile can still read it (Qt
            # opens for read), but exportFile's rewrite-in-place cannot
            # open it for writing -- a real, reproducible way to trigger
            # the exportFile FAIL branch rather than assuming it can
            # never fire. (A read-only DIRECTORY with a writable file
            # inside does NOT reproduce this: the exporter truncates the
            # existing file in place rather than replacing it, which
            # only needs write permission on the file itself.)
            os.chmod(plan, 0o444)
            try:
                output = self.run_tool(tmp)
            finally:
                os.chmod(plan, 0o644)

            self.assertIn(
                "FAIL  cannot write " + plan, output.splitlines(),
                "exportFile failure on a read-only FILE did not "
                "produce the exact expected FAIL line -- got: %r" %
                output)
            self.assertIn("### SYNC TEMPLATE LAYERS FAIL",
                          output.splitlines())
            with open(plan, "rb") as fh:
                after_bytes = fh.read()
            self.assertEqual(
                pre_bytes, after_bytes,
                "the file changed even though exportFile is supposed to "
                "have failed -- an ignored exportFile failure would "
                "silently succeed here instead of leaving the "
                "pre-migration bytes alone")

    def test_reports_failure_and_writes_nothing_when_the_registry_is_empty(self):
        """The tool's own floor check. Without it, a broken include or a
        renamed namespace yields an empty wanted-list, every layer counts
        as "already present", and the run reports success over a template
        it never looked at -- silence that reads exactly like the skip
        path above.
        """
        with tempfile.TemporaryDirectory() as tmp:
            core = os.path.join(tmp, "scripts", "CaveSurvey", "Core")
            os.makedirs(core)
            with open(os.path.join(core, "CsLayers.js"), "w") as fh:
                fh.write('var CsLayers = {};\n'
                         'CsLayers.CTRL_SHOTS = "CTRL-SHOTS";\n')
            os.mkdir(os.path.join(tmp, "templates"))
            plan = os.path.join(tmp, "templates",
                                "NSS_Cave_Template_PLAN.dxf")
            pre_bytes = self.pre_migration_plan()
            with open(plan, "wb") as fh:
                fh.write(pre_bytes)

            output = self.run_tool(tmp)

            self.assertIn(
                "FAIL  the layer registry yielded only 1 name(s) -- "
                "CsLayers did not load", output.splitlines(),
                "a one-constant registry did not trip the floor check "
                "-- got: %r" % output)
            self.assertIn("### SYNC TEMPLATE LAYERS FAIL",
                          output.splitlines())
            with open(plan, "rb") as fh:
                self.assertEqual(
                    pre_bytes, fh.read(),
                    "the tool wrote the template despite failing its own "
                    "floor check")


class TestReadmeToolTable(unittest.TestCase):
    """The README's tool table and the shipped tools must agree.

    Nothing reads the README, so it drifts silently. It advertised
    `LRUD Walls` (`lw`) for some time after that standalone tool was
    deleted and its work folded into CsDraw.survey -- a reader would have
    gone hunting the menu for a tool that no longer existed. Four shipped
    tools were meanwhile listed nowhere at all.

    Keyed on the COMMAND ALIAS, not the folder name: CaveTemplate/ ships
    as `newcavemap`/`ncm`, so folder names and commands genuinely differ.
    """

    def readme_table_aliases(self):
        with open(os.path.join(REPO, "README.md"), encoding="utf-8") as fh:
            readme = fh.read()
        # Scope to the tool table's own section -- the README has other
        # tables whose second column is also backticked (install paths),
        # and matching those made this test fail on its first run.
        section = re.search(r"^## The tools\n(.*?)^## ", readme,
                            re.M | re.S)
        self.assertIsNotNone(section, "README has no '## The tools' section")
        # Rows look like: | Display Name | `alias` | description |
        rows = re.findall(r"^\|[^|]+\|\s*`([^`]+)`\s*\|",
                          section.group(1), re.M)
        return set(rows)

    def aliases_by_tool(self):
        """tool folder -> every alias it declares in setDefaultCommands."""
        out = {}
        for name in tool_dirs():
            match = re.search(r"setDefaultCommands\(\[([^\]]*)\]\)",
                              tool_source(name))
            if match is None:
                continue
            out[name] = set(re.findall(r'"([^"]+)"', match.group(1)))
        return out

    # Tools that live in the repo but are deliberately not shipped -- see
    # PARKED_TOOLS in tools/make_package.sh. A parked tool must NOT appear in
    # the README's table, because that table documents what a user gets.
    # Kept after Trip Focus's tool folder was removed (docs/FROZEN.md):
    # it costs nothing, and it means a reintroduced parked tool is
    # exempted and README-checked correctly from its first commit rather
    # than after someone rediscovers this set.
    PARKED = {"TripFocus"}

    def test_a_parked_tool_is_absent_from_the_readme_table(self):
        listed = self.readme_table_aliases()
        by_tool = self.aliases_by_tool()
        leaked = sorted(name for name in self.PARKED
                        if name in by_tool and (by_tool[name] & listed))
        self.assertEqual(leaked, [],
                         "these tools are parked (not shipped) but the README "
                         "advertises them: %s" % leaked)

    def test_every_tool_appears_in_the_readme_table(self):
        # ANY of a tool's aliases counts: the table documents the short
        # form (`snb`) while setDefaultCommands lists the long one first
        # ("surveynotebook"). Requiring the first alias specifically was
        # this test's own bug on its first run, not the README's.
        listed = self.readme_table_aliases()
        by_tool = self.aliases_by_tool()
        missing = sorted(name for name, aliases in by_tool.items()
                         if name not in self.PARKED and not (aliases & listed))
        self.assertEqual(missing, [],
                         "these tools ship but no alias of theirs appears "
                         "in the README's tool table: %s" % missing)

    def test_readme_table_advertises_no_tool_that_does_not_exist(self):
        every_alias = set()
        for aliases in self.aliases_by_tool().values():
            every_alias.update(aliases)
        phantom = sorted(a for a in self.readme_table_aliases()
                         if a not in every_alias)
        self.assertEqual(phantom, [],
                         "the README table advertises commands no tool "
                         "declares: %s" % phantom)


# ---------------------------------------------------------------------
# Shipped template vs the layer registry.
# ---------------------------------------------------------------------
#
# CsLayers.ensure() resolves a layer's appearance at CREATION ONLY.
# Once a layer exists in the shipped template, editing its
# CsLayers.DEFAULTS row does not recolour it, and re-running
# tools/sync_template_layers.js does not either -- that tool only ADDS
# layers it cannot find. So the registry and the template can silently
# disagree, and since every new drawing is born from the template, a
# disagreement means the SAME cave map looks different depending on
# whether the caver started from the template or not.
#
# This already shipped once: NOTES-ELEVATION and NOTES-ELEVATION-LINE
# went out with their colours inverted -- the unmeasured fallback
# brighter than the real reading -- and nothing objected, because the
# only checks were name presence
# (test_registry_layers_exist_in_plan_template) and a sync-tool test
# that compares DEFAULTS against itself.
#
# THE DRIFT IS GONE, 2026-08-31. It used to be recorded here rather than
# fixed -- sixteen of the registry's layers disagreed with the template,
# and the note said resolving them was deferred until "a layer rewrite
# [that] is coming and will need to touch all of it anyway". That rewrite
# happened: the palette in CsLayers.DEFAULTS was rebuilt on one colour/
# weight/linetype scheme, every PROFILE- and SECTION- twin became a
# DERIVED copy of its plan row instead of a hand-written one, and
# tools/sync_template_layers.js learned to RESTYLE the layers it finds
# and not only the ones it creates -- which is the mechanism that had
# made the drift unfixable in the first place.
#
# Each recorded divergence was decided rather than split: ENTRANCE kept
# the template's red at 0.50 (NSS convention, and the registry's white
# was the accident); CROSS-SECTION-MARKERS moved to red with the rest of
# the reference family; WALLS-INFERRED kept the template's NSS_INFERRED
# linetype -- the template WAS right about that -- and took the
# registry's gray, because a white inferred wall renders identically to a
# surveyed one; BREAKDOWN-BOUNDARY likewise kept NSS_DOTTED and went
# gray; the 0x7f7f7f/0x808080 grey spellings collapsed onto SVG gray.
#
# The table stays, empty, and so do both tests. Emptying it is not the
# same as deleting it: an entry here is how a FUTURE deliberate
# divergence gets recorded, and the stale-entry test is what stops one
# rotting. An empty table plus a green suite is the strongest statement
# available -- the shipped template and the registry agree on colour,
# linetype and lineweight for all 196 layers, and any new disagreement
# fails immediately.
#
# name -> {"color": truecolor, "linetype": str, "lineweight": int}
# Only the keys that actually diverge are listed per layer.
TEMPLATE_APPEARANCE_DRIFT = {}


class TestTemplateMatchesRegistry(unittest.TestCase):
    """The shipped template's layer appearance against CsLayers.DEFAULTS.

    Companion to TestLayerVocabulary (which checks PRESENCE) and to
    TestSyncTemplateLayersTool (which checks that the sync tool APPLIES
    DEFAULTS when it creates a layer, and therefore cannot catch a
    template that already disagrees).
    """

    def template_records(self):
        path = os.path.join(TEMPLATES, "NSS_Cave_Template_PLAN.dxf")
        with open(path, encoding="utf-8", errors="replace") as fh:
            return parse_layer_records(fh.read())

    @staticmethod
    def nominal_lineweight(key):
        """"Weight025" -> 25. The DXF stores hundredths of a mm in
        group 370 and the registry names the same number."""
        match = re.match(r"Weight(\d+)$", key)
        assert match is not None, ("unrecognised lineweight key %r -- "
                                  "extend nominal_lineweight()" % key)
        return int(match.group(1))

    def test_shipped_template_appearance_matches_registry(self):
        defaults = parse_defaults_table()
        records = self.template_records()

        for name in sorted(defaults):
            color_name, linetype, weight_key = defaults[name]
            record = records.get(name)
            if record is None:
                # Presence is TestLayerVocabulary's job, not this test's.
                continue
            drift = TEMPLATE_APPEARANCE_DRIFT.get(name, {})

            expected_color = drift.get("color", SVG_TRUE_COLOR[color_name])
            self.assertEqual(
                record["truecolor"], expected_color,
                "%s: template truecolor 0x%06X, expected 0x%06X (%s). "
                "If this layer's appearance was deliberately changed, "
                "update CsLayers.DEFAULTS and re-sync the template, or "
                "record the divergence in TEMPLATE_APPEARANCE_DRIFT with "
                "a reason." % (name, record["truecolor"] or 0,
                               expected_color, color_name))

            # Linetype compares case-insensitively: the template writes
            # "Continuous" and the registry "CONTINUOUS" for 35 layers,
            # which is spelling, not drift.
            expected_lt = drift.get("linetype", linetype)
            self.assertEqual(
                (record["linetype"] or "").upper(), expected_lt.upper(),
                "%s: template linetype %r, expected %r"
                % (name, record["linetype"], expected_lt))

            expected_lw = drift.get(
                "lineweight", self.nominal_lineweight(weight_key))
            self.assertEqual(
                record["lineweight"], expected_lw,
                "%s: template lineweight %r, expected %r (%s)"
                % (name, record["lineweight"], expected_lw, weight_key))

    def test_drift_table_has_no_stale_entries(self):
        """A recorded divergence that no longer diverges must be removed.

        Without this, resolving a drift leaves a false record behind
        saying the template and registry disagree when they now agree --
        and the next reader trusts it.
        """
        defaults = parse_defaults_table()
        records = self.template_records()
        stale = []

        for name, drift in sorted(TEMPLATE_APPEARANCE_DRIFT.items()):
            record = records.get(name)
            if record is None or name not in defaults:
                stale.append("%s (no longer in template or registry)" % name)
                continue
            color_name, linetype, weight_key = defaults[name]
            for field, recorded in sorted(drift.items()):
                if field == "color":
                    actual_default = SVG_TRUE_COLOR[color_name]
                    now = record["truecolor"]
                elif field == "linetype":
                    actual_default = linetype.upper()
                    now = (record["linetype"] or "").upper()
                    recorded = recorded.upper()
                else:
                    actual_default = self.nominal_lineweight(weight_key)
                    now = record["lineweight"]
                if now == actual_default:
                    stale.append("%s[%s] now AGREES with the registry"
                                 % (name, field))
                elif now != recorded:
                    stale.append("%s[%s] drifted again: recorded %r, now %r"
                                 % (name, field, recorded, now))

        self.assertEqual(
            stale, [],
            "TEMPLATE_APPEARANCE_DRIFT is out of date -- remove or "
            "correct these entries: %s" % stale)


class TestEngineTestsLoadEveryCoreFile(unittest.TestCase):
    """tests/js_unit.js loads Core files by a hand-written list, not by
    scanning the folder. Adding a Core file and registering it only in
    CsAll.js leaves this suite exercising a library that does not
    contain it -- and because callers wrap format writers and other
    optional work in deliberate try/catch blocks, the missing global
    surfaces as a quiet no-op rather than an error. That is how
    Format/CsTherion.js reached a green suite while doing nothing.

    So every Core file must be either loaded by js_unit.js or named in
    its CORE_FILES_NOT_LOADED list with a reason. Both directions are
    checked: an unaccounted-for file fails, and so does a stale
    exclusion."""

    CORE = None

    def setUp(self):
        self.core = os.path.join(ADDON, "Core")
        with open(os.path.join(REPO, "tests", "js_unit.js")) as handle:
            self.source = handle.read()

    def _excluded(self):
        """The CORE_FILES_NOT_LOADED entries, and the span they occupy."""
        start = self.source.find("var CORE_FILES_NOT_LOADED = [")
        self.assertNotEqual(
            start, -1,
            "tests/js_unit.js no longer declares CORE_FILES_NOT_LOADED; "
            "this test cannot tell a deliberate omission from an "
            "accident without it")
        end = self.source.find("];", start)
        self.assertNotEqual(end, -1, "CORE_FILES_NOT_LOADED is unterminated")
        span = self.source[start:end]
        return set(self._live_paths(span)), (start, end)

    @staticmethod
    def _live_paths(text):
        """Core paths on lines that are not commented out.

        Parsing live lines rather than grepping the whole file is the
        same precaution TestBasenameCollisions takes: a path inside a
        comment (and every list here carries long explanatory comments)
        would otherwise satisfy the check with the load disabled."""
        found = []
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith("//"):
                continue
            found.extend(re.findall(
                r'"(scripts/CaveSurvey/Core/[A-Za-z0-9_/]+\.js)"', stripped))
        return found

    def _on_disk(self):
        paths = set()
        for dirpath, _dirnames, filenames in os.walk(self.core):
            for filename in filenames:
                if not filename.endswith(".js"):
                    continue
                full = os.path.join(dirpath, filename)
                paths.add(os.path.relpath(full, REPO).replace(os.sep, "/"))
        return paths

    def test_every_core_file_is_loaded_or_explicitly_excluded(self):
        excluded, (start, end) = self._excluded()
        # Everything OUTSIDE the exclusion list: CORE_FILES plus every
        # loadRepoScript call further down the file.
        rest = self.source[:start] + self.source[end:]
        loaded = set(self._live_paths(rest))
        unaccounted = sorted(self._on_disk() - loaded - excluded)
        self.assertEqual(
            unaccounted, [],
            "these Core files are neither loaded by tests/js_unit.js nor "
            "listed in its CORE_FILES_NOT_LOADED: %s -- add them to "
            "CORE_FILES, or to CORE_FILES_NOT_LOADED with the reason "
            "they cannot be loaded there" % unaccounted)

    def test_no_stale_exclusions(self):
        excluded, (start, end) = self._excluded()
        on_disk = self._on_disk()
        gone = sorted(entry for entry in excluded if entry not in on_disk)
        self.assertEqual(
            gone, [],
            "CORE_FILES_NOT_LOADED names files that no longer exist: "
            "%s" % gone)
        rest = self.source[:start] + self.source[end:]
        loaded = set(self._live_paths(rest))
        both = sorted(excluded & loaded)
        self.assertEqual(
            both, [],
            "these files are listed as NOT loaded but tests/js_unit.js "
            "loads them anyway: %s -- drop the stale exclusion" % both)



class TestAddonDoesNotPatchStockPrototypes(unittest.TestCase):
    """An add-on cannot hook a save by wrapping a stock action.

    QCAD builds actions in their own script context
    (RScriptHandlerJs::createActionDocumentLevel), so a prototype
    patched from add-on init is never the prototype the action uses.
    The wrapper installs, reports success, and does nothing -- measured
    2026-08-29 with probe/CsSaveProbe against a real GUI save: armed
    08:15:43, drawing written 08:15:56, probe log never grew.

    CsCave.installSaveHook lived on that mistake for months while
    looking alive, so the failure mode is not "it breaks", it is "it
    silently never runs". The working path is the fork's own Save.js
    calling CsCave.afterSave (patch 0006). This test exists so the
    inert shape cannot come back."""

    PATCH = re.compile(
        r'\b(Save|SaveAs|File|Open|Export)\s*\.\s*prototype\s*\.\s*'
        r'[A-Za-z_]\w*\s*=')

    def test_no_stock_action_prototype_is_reassigned(self):
        offenders = []
        for dirpath, _dirnames, filenames in os.walk(ADDON):
            for filename in sorted(filenames):
                if not filename.endswith(".js"):
                    continue
                full = os.path.join(dirpath, filename)
                with open(full) as handle:
                    for number, line in enumerate(handle, 1):
                        stripped = line.strip()
                        # Comments describe the trap on purpose -- the
                        # note in CsCave.js names the very assignment
                        # this test forbids.
                        if stripped.startswith("//") or \
                                stripped.startswith("*"):
                            continue
                        if self.PATCH.search(stripped):
                            offenders.append("%s:%d" % (
                                os.path.relpath(full, REPO), number))
        self.assertEqual(
            offenders, [],
            "these lines wrap a stock action prototype, which an add-on "
            "cannot make fire: %s -- put the work in a fork patch and "
            "call into the add-on from there, the way Save.js calls "
            "CsCave.afterSave" % offenders)



if __name__ == "__main__":
    unittest.main(verbosity=2)
