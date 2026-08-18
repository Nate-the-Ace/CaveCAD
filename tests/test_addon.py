"""
Structural tests for the scripts/CaveSurvey/ QCAD add-on.

None of this needs QCAD -- it's the layout and menu wiring that QCAD relies on
to find and order the tools. These failures are the miserable kind to diagnose
by hand: a tool that just isn't in the menu, an icon that renders blank, or two
tools whose order silently depends on load sequence.

    python3 -m unittest discover -s tests -v

The syntax of each script is checked separately, inside QCAD's own engine, by
tests/js_syntax.js -- see tests/README.md.
"""

import os
import re
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ADDON = os.path.join(REPO, "scripts", "CaveSurvey")

# The menu/toolbar object names created by CaveSurvey.js. A tool that doesn't
# reference both never appears in either place.
WIDGET_NAMES = ["CaveSurveyMenu", "CaveSurveyToolBar"]


def tool_dirs():
    return sorted(
        name for name in os.listdir(ADDON)
        if os.path.isdir(os.path.join(ADDON, name))
        and not name.startswith(".")
    )


def tool_source(name):
    with open(os.path.join(ADDON, name, name + ".js")) as fh:
        return fh.read()


def find_int(source, call):
    match = re.search(re.escape(call) + r"\((\d+)\)", source)
    return int(match.group(1)) if match else None


class TestAddonLayout(unittest.TestCase):
    def test_addon_has_its_menu_builder(self):
        # CaveSurvey.js must sit beside the tool folders: it creates the menu
        # and toolbar the tools attach themselves to.
        self.assertTrue(os.path.exists(os.path.join(ADDON, "CaveSurvey.js")))

    def test_every_tool_lives_in_a_folder_named_after_it(self):
        # QCAD finds an add-on tool as <Tool>/<Tool>.js. A script sitting loose
        # beside CaveSurvey.js, or in a mismatched folder, won't be picked up.
        for name in tool_dirs():
            with self.subTest(tool=name):
                self.assertTrue(
                    os.path.exists(os.path.join(ADDON, name, name + ".js")),
                    "expected %s/%s.js" % (name, name))

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
        for name in tool_dirs():
            source = tool_source(name)
            for icon in re.findall(r'setIcon\(basePath \+ "/([^"]+)"\)', source):
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

    @unittest.expectedFailure
    def test_every_tool_has_an_icon(self):
        # KNOWN GAP: LRUDWalls and GeoAnchor have no .svg yet, so they show up
        # on the toolbar as blank buttons. Drop the decorator once they do.
        missing = [name for name in tool_dirs()
                   if "setIcon(" not in tool_source(name)]
        self.assertEqual(missing, [])


class TestTemplates(unittest.TestCase):
    def test_both_templates_are_present(self):
        for name in ("NSS_Cave_Template_PLAN.dxf",
                     "NSS_Cave_Template_PROFILE.dxf"):
            with self.subTest(template=name):
                self.assertTrue(
                    os.path.exists(os.path.join(REPO, "templates", name)))


if __name__ == "__main__":
    unittest.main(verbosity=2)
