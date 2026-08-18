Cave Survey Data Entry App
===========================

SETUP (one time):
  pip install matplotlib ezdxf

RUN:
  python3 cave_survey_app.py

Keep NSS_Cave_Template_PLAN.dxf in the same folder as the script (already
included here) -- the app looks for it automatically. If it's missing,
you'll be prompted to locate it once at startup.

USAGE:
  1. Fill in the header fields (cave name, survey designation, date,
     declination, surveyors, instruments) -- these are recorded for your
     reference; declination is auto-applied to bearing/azimuth only when
     IMPORTING a Compass file (that's what its own spec calls for), not
     otherwise re-applied on Walls/Survex import or on export.
  2. Set the starting station name and X/Y (defaults to A1 at 0,0). This
     gets auto-filled to the first imported shot's From station if you
     import a file.
  3. Enter shot rows manually, OR click "Import..." to load a Walls
     (.srv), Compass (.dat), or Survex (.svx) file into the table for
     review/editing before generating a DXF.
  4. Watch the live preview on the right update as you type/import (small
     delay to avoid redrawing on every keystroke). Rows with an error
     (missing/invalid Distance or Azimuth, or an unrecognized From
     station) show red text in those fields and are listed below the
     table -- they're skipped in the preview and in DXF/format export,
     not silently guessed at.
  5. Click "Export..." to save the current table as a Walls/Compass/
     Survex file -- lets this app act as a format converter between all
     three, round-tripped through its own row model.
  6. Click "Generate DXF" -- you'll get a warning listing any error rows
     before proceeding (skip generation to fix them, or continue anyway),
     then a Save As dialog to choose where the output DXF goes.

IMPORT/EXPORT FORMAT NOTES:
  - This is a single top-to-bottom pass: a shot's From station must
    already be defined by an earlier row (either the starting station or
    an earlier row's To). Unlike the QCAD native importer, there's no
    multi-pass out-of-order resolution here -- if an imported file has an
    out-of-order loop closure (From station defined later in the file),
    reorder that row after importing, or it'll show as an error.
  - Compass import: multi-survey files (form-feed separated), DECLINATION
    applied to bearing, fixed FROM TO LENGTH BEARING INC LEFT UP DOWN
    RIGHT column order, "#|X#"/"#|P#" flags supported. NOT supported:
    backsight columns, .MAK projects, multi-file projects.
  - Walls import: #Units Feet/Meters (converted to feet), Order=, Decl=,
    single-level #Prefix, inline <L,R,U,D> LRUD, splay shots (To = "-")
    skipped. NOT supported: nested #Prefix stacks, #Fix (use this app's
    own starting-station fields instead).
  - Survex import: *begin/*end hierarchical prefixes (joined with "."),
    *data normal in any field order, *data passage LRUD (matched to
    stations separately from the leg table, as Survex normally does it),
    *units length feet/metres (converted to feet).
    NOT supported: *include, *data diving/cartesian/nosurvey, *calibrate,
    *units compass/clino grads (angles are assumed to be degrees).
  - UNITS: distances are converted to FEET on import, matching the QCAD
    scripts' toDrawingUnits() and the NSS template's units. Each format
    supplies its own default per its own spec -- Survex metres, Walls
    feet, Compass always feet -- so a Survex file with no *units
    directive is read as metres and scaled by 3.280839895. If your QCAD
    drawing is in metres instead, change DRAWING_DISTANCE_UNIT in both
    format_io.py and ImportNativeCaveSurvey.js.
  - Export writes a single simplified survey in each format using
    whatever's currently in the table (declination is NOT re-applied to
    azimuth on export -- exported as-is). Round-tripping a file through
    this app's own import then export has been verified to preserve
    data; fidelity with real Walls/Compass/Survex software reading these
    exports has NOT been independently verified since I can't run those
    programs myself -- the Compass export's FORMAT header string in
    particular is a reasonable placeholder, not verified byte-exact.

CONVENTIONS (matching the QCAD AzimuthTraverse.js / native importer tools):
  - Azimuth: degrees, clockwise from North (0 = N, 90 = E).
  - Distance is treated as already horizontal -- inclination only affects
    the tracked elevation (shown in station labels as "(Z+n.n)"), not the
    plotted X/Y position.
  - L/R measured facing the direction of travel; LRUD is associated with
    the TO station of each shot.
  - A row whose To station already exists is drawn as a straight loop-
    closure connector (dashed in the preview) rather than recomputed from
    its own azimuth/distance.

OUTPUT LAYERS (matching your NSS template's CTRL- convention):
  CTRL-SHOTS           centerline shot lines
  CTRL-LRUD            LRUD tick lines + U/D text (created automatically if
                        missing from your template copy, matching
                        CTRL-SHOTS's lineweight, color 2/yellow)
  CTRL-STATIONS        SYM_FIXED_POINT block references
  CTRL-STATION-LABELS  station name + elevation text

KNOWN LIMITATIONS (v1):
  - Single top-to-bottom pass: a shot's From station must already be
    defined by an earlier row. Out-of-order closures (like the native
    QCAD importer's multi-pass resolution) are NOT supported here --
    reorder rows if a closure shot's From station comes later in your list.
  - Declination is recorded but not automatically applied to azimuths.
  - No support yet for editing/re-loading a previously generated DXF back
    into the table.
  - Survex EXPORT is lossy in three known ways (each tracked by a test in
    tests/test_parsers.py -- see tests/README.md): station names come back
    prefixed with the survey designation ("A1" -> "A.A1"); LRUD is shared
    between any two shots that end at the same station, since *data
    passage is keyed by station; and notes are written as ";" comments
    that the importer strips rather than reads back.

TESTING:
  ./tests/run_all.sh    -- everything (see tests/README.md)

  Includes a differential test that runs the QCAD JS parsers headless
  inside QCAD's own script engine and diffs them against this app's
  Python parsers, so the two implementations can't silently drift apart.
