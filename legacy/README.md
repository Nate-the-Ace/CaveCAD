# Older scripts, not part of the add-on

These are from the earlier generation of these tools, before they were packaged
as the `scripts/CaveSurvey/` QCAD add-on. They still work, but they are run the
old way -- **Misc > Development > Run Script...** -- rather than from the Cave
Survey menu, and they are not maintained alongside the add-on.

* **`ImportCaveSurveyCSV.js`** -- imports a CSV of shot data (FROM, TO,
  DISTANCE, AZIMUTH, plus optional inclination and LRUD) and draws it. There is
  no add-on equivalent yet: `ImportNativeCaveSurvey` reads the three native
  formats but not plain CSV. Worth porting if you want a beginner-friendly way
  in that doesn't involve installing Walls, Compass or Survex.

* **`CheckStationProperties.js`** -- a diagnostic. Select one station point and
  run it, and it prints the `CaveSurvey` custom properties QCAD can actually
  read back off that entity. Useful when station tagging misbehaves; not a tool
  a surveyor would ever need, which is why it isn't in the menu.

The rest of that generation -- the flat `AzimuthTraverse.js` and
`ImportNativeCaveSurvey.js` -- is gone, superseded by the add-on copies. Their
parsers were byte-identical; only the entry point changed. Git history has them
if you need to look.
