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
    return dict(re.findall(r'CsLayers\.([A-Z_]+) = "([^"]+)"', source))


def parse_defaults_table():
    """name -> (colorName, linetype, lineweightKey) for every row of
    CsLayers.DEFAULTS in Core/CsLayers.js. Source-scraped rather than
    imported (this is a QCAD-context .js file, not something Python can
    execute) so a test comparing against it tracks edits automatically."""
    with open(os.path.join(ADDON, "Core", "CsLayers.js")) as fh:
        source = fh.read()
    match = re.search(r"CsLayers\.DEFAULTS = \{(.*?)\n\};", source, re.S)
    assert match is not None, ("CsLayers.DEFAULTS table not found -- did "
                               "its opening/closing syntax change?")
    entries = re.findall(
        r'"([^"]+)":\s*\[\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\s*\]',
        match.group(1))
    return dict((name, (color, linetype, weight))
                for name, color, linetype, weight in entries)


SHEET_LAYERS = {"0", "Defpoints", "BORDER", "TITLE-BLOCK", "LEGEND",
                "SCALE-BAR"}


def frame_of(name):
    """Which view a layer belongs to: "plan", "profile" or "sheet".

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
    return "plan"


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
    "gray": 0x808080,
    "pink": 0xFFC0CB,
    "red": 0xFF0000,
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
        """Mutation-tested gap: deleting CsLayers.PROFILE_FLOOR and
        CsLayers.PROFILE_CEILING left the whole suite green, because
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
        self.assertIn('CsLayers.PROFILE_FLOOR = "CTRL-PROFILE-FLOOR";',
                     source)
        self.assertIn('CsLayers.PROFILE_CEILING = "CTRL-PROFILE-CEILING";',
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
        self.assertIn('CsLayers.LRUD_WALL_LEFT = "CTRL-LRUD-WALL-LEFT";',
                      source)
        self.assertIn('CsLayers.LRUD_WALL_RIGHT = "CTRL-LRUD-WALL-RIGHT";',
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
                "CTRL-LRUD-WALL-LEFT", "CTRL-LRUD-WALL-RIGHT")

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

    def expected_ok_line(self, plan):
        return ("ok    %s -- %d layer(s) added: %s"
                % (plan, len(self.STRIPPED),
                   ", ".join(sorted(self.STRIPPED))))

    def test_add_path_then_idempotence(self):
        defaults = parse_defaults_table()

        with tempfile.TemporaryDirectory() as tmp:
            plan = self.make_fake_repo(tmp, self.pre_migration_plan())

            first = self.run_tool(tmp)
            lines = first.splitlines()
            self.assertIn(
                self.expected_ok_line(plan), lines,
                "the add path did not report the exact expected line -- "
                "got: %r" % first)
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
                "skip  %s -- every registry layer already present" % plan,
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
                "skip  %s -- every registry layer already present" % plan,
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
                         'CsLayers.SHOTS = "CTRL-SHOTS";\n')
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

    def test_every_tool_appears_in_the_readme_table(self):
        # ANY of a tool's aliases counts: the table documents the short
        # form (`snb`) while setDefaultCommands lists the long one first
        # ("surveynotebook"). Requiring the first alias specifically was
        # this test's own bug on its first run, not the README's.
        listed = self.readme_table_aliases()
        by_tool = self.aliases_by_tool()
        missing = sorted(name for name, aliases in by_tool.items()
                         if not (aliases & listed))
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
