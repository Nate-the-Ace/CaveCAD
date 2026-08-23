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
import shutil
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
    def test_both_templates_are_present(self):
        for name in ("NSS_Cave_Template_PLAN.dxf",
                     "NSS_Cave_Template_PROFILE.dxf"):
            with self.subTest(template=name):
                self.assertTrue(
                    os.path.exists(os.path.join(TEMPLATES, name)))


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
    """The layer names in Core/Layers.js and the plan template must agree.

    The old importer invented layer names no template carried; this pins
    the registry to the template so the two cannot drift apart again.
    """

    def layer_registry(self):
        with open(os.path.join(ADDON, "Core", "CsLayers.js")) as fh:
            source = fh.read()
        return set(re.findall(r'CsLayers\.[A-Z_]+ = "([^"]+)"', source))

    def template_layers(self, name):
        with open(os.path.join(TEMPLATES, name), encoding="utf-8",
                  errors="replace") as fh:
            content = fh.read()
        match = re.search(r"2\nLAYER\n(.*?)\n  0\nENDTAB", content, re.S)
        return set(re.findall(r"^  2\n(.+)$", match.group(1), re.M))

    # Profile-only layers belong to the PROFILE template, and the wall
    # run layers are created on demand -- neither is a plan-template
    # omission. Everything else the registry names must be there.
    PROFILE_ONLY = {"CTRL-PROFILE-FLOOR", "CTRL-PROFILE-CEILING"}
    CREATED_ON_DEMAND = {"CTRL-LRUD-WALL-LEFT", "CTRL-LRUD-WALL-RIGHT"}

    def test_registry_layers_exist_in_plan_template(self):
        registry = self.layer_registry()
        plan = self.template_layers("NSS_Cave_Template_PLAN.dxf")
        missing = registry - plan - self.CREATED_ON_DEMAND - self.PROFILE_ONLY
        self.assertEqual(missing, set(),
                         "layers in Core/CsLayers.js but not the plan "
                         "template: %s" % sorted(missing))

    def test_profile_layers_exist_in_profile_template(self):
        """The elevation generator draws to these; a template without
        them means the layers get invented at runtime with whatever
        defaults, which is exactly the drift this class exists to stop.
        """
        profile = self.template_layers("NSS_Cave_Template_PROFILE.dxf")
        needed = self.PROFILE_ONLY | {"CTRL-LRUD", "CTRL-SPLAYS"}
        missing = needed - profile
        self.assertEqual(missing, set(),
                         "layers the profile generator draws to but the "
                         "PROFILE template lacks: %s" % sorted(missing))

    def defaults_table(self):
        with open(os.path.join(ADDON, "Core", "CsLayers.js")) as fh:
            source = fh.read()
        match = re.search(r"CsLayers\.DEFAULTS = \{(.*?)\n\};", source,
                          re.S)
        self.assertIsNotNone(match, "CsLayers.DEFAULTS table not found -- "
                             "did its opening/closing syntax change?")
        entries = re.findall(
            r'"([^"]+)":\s*\[\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\s*\]',
            match.group(1))
        return dict((name, (color, linetype, weight))
                    for name, color, linetype, weight in entries)

    def test_registry_defines_profile_control_layers(self):
        """Mutation-tested gap: deleting CsLayers.PROFILE_FLOOR and
        CsLayers.PROFILE_CEILING left the whole suite green, because
        test_registry_layers_exist_in_plan_template only builds an
        exemption set from whatever names happen to be in the registry
        -- it never asserts the constants exist at all. This pins both
        the constant and its CsLayers.DEFAULTS entry, which also
        protects tools/add_profile_layers.js: that tool now reads
        DEFAULTS through CsLayers.ensure() instead of carrying its own
        copy of the layer's appearance, so a deleted or wrong DEFAULTS
        entry breaks both this test and the tool the same way.
        """
        with open(os.path.join(ADDON, "Core", "CsLayers.js")) as fh:
            source = fh.read()
        self.assertIn('CsLayers.PROFILE_FLOOR = "CTRL-PROFILE-FLOOR";',
                     source)
        self.assertIn('CsLayers.PROFILE_CEILING = "CTRL-PROFILE-CEILING";',
                     source)
        defaults = self.defaults_table()
        self.assertEqual(defaults.get("CTRL-PROFILE-FLOOR"),
                         ("gray", "DASHED", "Weight000"))
        self.assertEqual(defaults.get("CTRL-PROFILE-CEILING"),
                         ("gray", "DASHED", "Weight000"))


class TestAddProfileLayersToolIdempotence(unittest.TestCase):
    """tools/add_profile_layers.js must be a no-op once every layer it
    wants is already present -- the shipped template is exactly that
    state, so from here on EVERY run against it must leave the bytes
    untouched. A prior review confirmed this property had no automated
    coverage at all (only a manual double-run), so a broken idempotence
    guard -- e.g. dropping the doc.hasLayer() check inside the tool --
    could re-export the template on every invocation without any test
    noticing. Runs the real tool under the real engine on a throwaway
    copy; nothing here touches the repo's own template file.
    """

    CAVECAD = os.environ.get(
        "CAVESURVEY_CAVECAD",
        "/Applications/CaveCAD.app/Contents/MacOS/CaveCAD")

    def run_tool(self, fake_repo_root):
        # -no-dock-icon/-no-gui/-allow-multiple-instances match the
        # invocation documented in the tool's own header and run_all.sh.
        result = subprocess.run(
            [self.CAVECAD, "-no-dock-icon", "-no-gui",
             "-allow-multiple-instances", "-autostart",
             os.path.join(REPO, "tools", "add_profile_layers.js"),
             fake_repo_root],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
        return result.stdout.decode("utf-8", "replace")

    def test_second_run_does_not_rewrite_the_template(self):
        if not os.path.exists(self.CAVECAD):
            self.skipTest("CaveCAD not found at %s -- see run_all.sh" %
                          self.CAVECAD)

        real_template = os.path.join(TEMPLATES,
                                     "NSS_Cave_Template_PROFILE.dxf")
        with open(real_template, "rb") as fh:
            original_bytes = fh.read()

        with tempfile.TemporaryDirectory() as tmp:
            # The tool derives BOTH the Core library location and the
            # template path from the single repoRoot argument, so the
            # fake root needs a real scripts/CaveSurvey/Core (symlinked
            # -- CsLayers.js must be the genuine, current one) and a
            # throwaway copy of just the template it writes to.
            os.symlink(os.path.join(REPO, "scripts"),
                       os.path.join(tmp, "scripts"))
            os.mkdir(os.path.join(tmp, "templates"))
            target = os.path.join(tmp, "templates",
                                  "NSS_Cave_Template_PROFILE.dxf")
            shutil.copyfile(real_template, target)

            first_output = self.run_tool(tmp)
            with open(target, "rb") as fh:
                after_first = fh.read()

            second_output = self.run_tool(tmp)
            with open(target, "rb") as fh:
                after_second = fh.read()

        self.assertIn("skip", first_output,
                      "the shipped template is supposed to already carry "
                      "every layer the tool wants, so even the FIRST run "
                      "here should be a no-op -- got: %r" % first_output)
        self.assertEqual(
            original_bytes, after_first,
            "add_profile_layers.js rewrote the template even though it "
            "reported skip on the first run")
        self.assertIn("skip", second_output,
                      "second run did not report skip -- got: %r" %
                      second_output)
        self.assertEqual(
            after_first, after_second,
            "add_profile_layers.js rewrote an already-migrated template "
            "on a second run -- it is supposed to be a no-op once every "
            "layer is present")


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
