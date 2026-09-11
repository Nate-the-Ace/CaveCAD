# CaveCAD

A dedicated cave mapping application built on [QCAD](https://qcad.org)
Community sources (GPLv3), with the Cave Survey tool suite built in:
import or type survey data, watch loop closures and blunders surface as
you work, derive passage walls, place NSS-standard symbols, and finish a
sheet that would survive NSS Cartography Salon judging -- with the
conventions explained to you along the way.

The suite targets **CaveCAD only**: it relies on CaveCAD's native XDATA
persistence for survey data, which stock QCAD's free writer does not
provide. It is not distributed as an add-on for other QCAD editions.

## The tools

Each appears in the **Cave Survey** menu and as a command, grouped into six
stages that read top to bottom as the order you actually work in -- the menu
itself is sectioned the same way, with a separator between each stage.

### 1. Start here

The two doors into a cave project: the launcher, and a blank sheet.

| Tool | Command | What it does |
| --- | --- | --- |
| Caves | `caves` | The window CaveCAD opens on: the caves registered on this machine, each one's trips with date, team, shot count and the stations it stopped at, plus survey health (depth, stations, loops, UIS grade) and warnings worth acting on -- a bad loop closure, a trip whose declination IGRF disagrees with, legacy tags, unbound linework. Import Cave... reads a survey file (Compass, Survex, Walls, CSV) and builds the whole project from it -- folder, scans/PDF/images/backup, a drawing on the NSS template with the survey drawn in -- or adopts an existing DXF; Import Folder... takes a cave folder or a folder of them. From here: open the drawing, start a trip tied into an open end, package the project, or open its project folder. Switch it off in its own footer, or with the setting `Startup/ShowCaveLauncher`. |
| Teaching Cave | `teach` | Hand a student a real cave they can safely ruin, and put it back afterwards. **Set up** takes a real cave once, removes its location (the same sanitizer Package Cave uses -- geo anchor out, aerial imagery out, and it refuses to write anything at all if it cannot strip both), and keeps the result as a pristine MASTER under `~/Documents/Cave/teaching/master/`. **Reset** throws away the student's copy and lays a fresh one down from that master, asking first, because a reset takes somebody's evening away. Three folders, and the distinction is the whole design: the ORIGINAL wherever the surveyor keeps it, read once and never written to and unreachable from here; the MASTER, which resets copy FROM and never to; and the WORKING copy a student opens and edits. A teaching cave that resets to something a student has been editing is not a teaching cave. Field sketches travel, because tracing a real sketch is most of what a student is here to learn and it is the one thing an invented cave can never have; plotted PDFs and photographs do not, because a title block carries a location somebody typed and a photograph carries wherever the camera thought it was, and neither is something this tool can strip. The working copy is registered on the shelf, so it opens like any other cave. |
| New Cave Map | `ncm` | Start a sheet from the NSS template, already carrying the control layers and symbol blocks. |

### 2. Survey data

Get shots into the drawing, and keep trips honest as they change.

| Tool | Command | What it does |
| --- | --- | --- |
| Survey Notebook | `snb` | A docked survey notes page: type or import shots, watch closures/stats/warnings live, draw in one undo step, export to any format. A page loaded with **Load from drawing** revises THAT trip by identity, so correcting its date or team no longer forks it into a duplicate. Draw redraws only the trip you typed when nothing else moved -- adding a trip no longer redraws the whole cave, which is most of what made it slow; a corrected declination, a re-closed loop or anything else that shifts existing stations still takes the full redraw, and **Redraw All** in the ... menu forces it on demand. Also owns declination: estimate it from the survey date and the cave's location (IGRF), pin that location to a station as the drawing's geo anchor, and correct a trip's declination after the fact -- the drawing rotates around the fix. The walls you trace are tied to the trip they belong to automatically, so they follow it through a revision instead of being left behind -- nothing to switch on, and a revision claims work drawn before this existed. **Edit this trip...** in the ... menu is a second, narrower kind of correction: a trip's name, date, team or instruments, fixed after it has already been drawn. The Notebook's own revision path types these once and matches a reloaded page to a trip by date and team, so editing either field there forked the trip into a duplicate instead of correcting it; this edits the trip by identity instead and moves nothing -- one undo step, no redraw, no resolve. With a trip already loaded it corrects that one with no picking step; with nothing loaded it lists every trip in the drawing to choose from. Declination is not among the fields it touches -- changing it rotates the plan, so it stays in Declination above. Its **Delete...** button is destructive on purpose: it removes that trip's shots, its marks and its legs, and renumbers every later trip (ids are stamped into the drawing's XDATA, including on your traced linework), then redraws the cave without it. It asks first, by name; it asks separately what to do with linework bound to that trip, keeping it unbound by default; and it refuses outright when a later trip ties into a station only this one reaches, since that trip would be left with nowhere to start. |
| Loop Errors | `le` | Draw the loop closure error where it actually happened: one arrow at every station the adjustment moved, from where the raw survey put it to where it is drawn. Survey Stats prints "closes at 2.4%" and a beginner reads that as a grade they passed or failed; it is neither. It says that walking the loop and coming back landed you 2.4% of the way you walked from where you started, and that the adjustment has since moved every station in that loop to share the difference out -- which stations, how far, and which way being the whole story, and invisible on the map. Arrows are coloured by how far the station moved in FEET, in four bands from "within a good tape read" to "resurvey this loop", and each loop is labelled with its own miss and percentage. Because a tenth of a foot on a cave 1400 ft across is a hundredth of a pixel, the arrows are EXAGGERATED -- by one factor, chosen from the data, printed on the drawing beside them in the same breath as the real numbers. An exaggeration nobody is told about is a falsified map. On a drawing with adjustment switched off the same arrows point the other way and mean "where this station would move to", and the caption says which of the two you are looking at. Everything lands on `CTRL-CLOSURE`, which is off by default, is switched on for you when you run the tool, and which the caption tells you to switch off before plotting: this is a diagnostic drawn over a map, never map ink. A survey with no loops is told so plainly -- not a fault, most caves start that way, but it does mean nothing in the survey is checking anything else. |
| Import Cave Survey | `ics` | Import Compass `.dat`, Walls `.srv`, Survex `.svx`, Therion `.th` or CSV -- the format is detected for you. Therion is also what TopoDroid and PocketTopo export, so a phone survey comes in through the same door. |
| Export Cave Survey | `ecs` | Write the drawing's survey back out as Compass `.dat`, Walls `.srv`, Survex `.svx`, Therion `.th` or CSV -- the format follows the name you save under. Exports what the map actually shows, including everything typed into the Notebook since the import, and leaves the cave's fixed station control out unless you ask for it. |

### 3. Draw the map

Trace walls and features onto the survey the notebook just drew.

| Tool | Command | What it does |
| --- | --- | --- |
| Feature Trace | `ft` | Trace walls and other features freehand: hold the button and drag along the sketch, and a smooth line follows at one control point per foot of cave. Pick the FEATURE from the docked panel -- one tile per feature, not one per view -- and where you drag decides the rest: a stroke in the plan lands on the plan layer, one inside a profile band's bounding box on that band's run layer, one inside an open section bay on the section layer, with the station its bay was opened at recorded on the line. The readout above the tiles names the layer under the cursor before you press. A stroke that carries on from where your last one stopped GROWS that line instead of making a second one -- trace a long wall in six passes and it is one line, with one end to warp and one row in a revision; hold **Shift** as you press to continue any line end within a foot on that layer, including one traced weeks ago. A plain drag continues only your own last stroke on that exact layer, deliberately: joining any end within a foot would fuse two different walls meeting at a corner into one fitted curve and round the corner off. The line keeps its identity through the join -- same entity, same tags, and one undo takes the extension back. A search box above the tiles filters them by name, and by the other words for the same thing -- "gour" finds the rimstone dam, "shaft" finds the pit, "boulders" finds breakdown; a search opens the sections it needs and clearing it leaves your folds as you had them. Each tile carries a COUNT: how many of that feature the view you are working in already holds, a dash when none -- the panel doubles as a completeness check, so a passage whose walls are traced and whose floor is not says so where you are already looking. The number follows the cursor between plan, elevation and section, and a shaped line is counted by its lines rather than by its ornament. A **Recent** strip above the sections holds the last five features you armed, most recent first, as their pictures alone -- cave work is a handful of features repeated a thousand times, and five full tiles would be wider than the dock anyone keeps open; hover for the name. It survives a restart, and it is deliberately outside the foldable sections: a shortcut you have to unfold first is not one. Press **Return** with one tile left showing and that feature is armed and drawing -- type three letters and go, with no key map to learn; with several still matching it says how many rather than guessing. **Escape** puts the tool down and the tile stops claiming to be armed. The panel is two foldable sections -- **Draw a feature** and **Draw a shaped line** -- click a section's header to fold it away, right-click one for **Move Up** / **Move Down** / **Reset Order**, and both what you fold and how you order them is remembered. Right-click a feature tile for **Draw**, **Hide This Feature**, **Show Only This Feature** and **Show All Features** -- each acts on that feature in all three views at once, and never on anything outside this panel's own features, so hiding linework cannot take your stations or scans with it. Tracing is fixed at one control point per foot with no smoothing. Which survey run an elevation stroke belongs to is read off the band box it lies in -- always, with nothing to set: draw inside a band and the line is that run's, so a revision moves it with the band; draw in the elevation but inside no band and it lands on the shared layer and the command line says so. Every tile carries a picture of the line it draws, rendered from the real geometry in that layer's own colour and dashedness -- the panel reads as a legend you can draw from. A second group, **Shaped Lines**, holds the six NSS line symbols (floor and ceiling ledge, pit, flowstone, rimstone dam, slope): same drag, with the ornament generated along the stroke, and the tile shows the ornament itself. When you release a shaped stroke the feature stays live and follows your cursor -- move to the side the ornament belongs on, the LOW side, and click to place it there. No more drawing it, looking at it and reaching for Flip. Two ways to take work back sit under the tiles: **Delete Last** removes the last thing you drew from either panel, and **Erase** is a mode -- click your own linework and it goes, one piece at a time, with a shaped line going whole rather than leaving its hachures behind. Neither can reach the survey: only the layers these panels draw on are erasable, so a click beside the centerline, a station or a scan does nothing, and a line on a hidden layer cannot be erased at all. A stroke that CONTINUED an existing line is not deleted by Delete Last -- that entity is the whole wall -- and it says so, pointing at Ctrl+Z, which takes back that stroke alone. Every feature you trace is stamped with the TRIP whose survey it describes -- the trip that reached the station nearest the stroke, or in a section bay the trip that surveyed the station the bay is a section of -- so a revision can move one trip's linework and leave the rest alone. Continuing an existing line never re-stamps it: adding six feet to a wall does not make a later trip its author. A stroke traced before the notes are entered carries no trip rather than a trip 0 nobody surveyed. Shaped lines extend like plain ones: a stroke carrying on from your last ledge grows that ledge and rebuilds its ornament along the whole line, and it does NOT ask for the side again -- the line already has one. Style is matched as well as layer, so a rimstone dam starting at a flowstone's end is a rimstone dam though the two share a spine layer; a pit never extends, having no ends. Hover any tile and the tooltip says what that feature MEANS in plain words, then the convention that is easy to get backwards -- solid walls are the ones you measured, a floor ledge's hachures go on the low side, a slope's fans splay downhill. The layer is still there, as the small print under it. |
| Shaped Lines | `shl` | Cave-map line symbology as real, self-maintaining geometry. The six NSS symbols -- Floor Ledge (`lgf`), Ceiling Ledge (`lgc`), Pit (`pte`), Flowstone (`fst`), Rimstone Dam (`rst`), Slope (`slp`) -- are drawn from the **Shaped Lines** group in the Feature Trace panel (they had a toolbar of their own until 0.9.62.0; one gesture deserved one front door, and the typed commands still work). Each draws on its own layer with the ornament (hachures on the down side, scallops bowing downslope, slope fans splaying downhill) generated along the stroke; edit the line afterwards with QCAD's own tools and the ornament follows. Release the drag and the feature follows your cursor until you click the side the ornament goes on. The same buttons work in BOTH views: a stroke in the elevation (inside the band bounding boxes) lands on the PROFILE- twin layers automatically. `shl` itself is Decorate Selection: dress any existing line, polyline, arc, circle or spline the same way. A stroke that carries on from your last shaped line of the same style grows it -- spine and ornament together, on one undo, with the side inherited (hold Shift at the press to continue one you did not just draw). Flip Shaped Side (`shf`) still mirrors the ornament on a line already drawn -- for a stroke made before the side step existed, or one whose drop turned out to be the other way; Sync Shaped Lines (`shs`) rebuilds by hand. Flowstone, rimstone and slope spines live on `CTRL-SHAPE-SPINE` (`CTRL-PROFILE-SHAPE-SPINE` in the elevation), off by default -- switch it on to reshape those edges. |
| Scatter Breakdown | `scb` | Fill closed `BREAKDOWN-BOUNDARY` polylines with breakdown symbols, per boundary. |
| Cross Section | `cxs` | Opens on a choice of three routes. **Cut it from the survey** (the default) is two clicks -- a point on the passage, then where the section goes -- and a rough cross section is cut there and hung on a leader. The outline is lofted from the two neighbouring stations' own LRUD and splays in 3D, so a cut can be taken ANYWHERE along a leg rather than only at a station. Each section is its own block: it drags as a unit, it can be edited without touching any other, and Draw redefines it in place as the survey changes without ever moving where you put it. The caption states the scale and how far the cut is from the nearer station that fed it -- a cut beside a station is nearly a measurement, one midway between distant stations is an interpolation, and the section says which it is. **Trace a scanned section** opens a staging bay for a scanned field-book cross section instead: a locked frame parked clear of the plan, holding the scan and a dashed ghost of the station's own computed LRUD outline to scale the scan onto and trace by hand with the suite's ordinary drawing tools. A station with no cuttable LRUD still opens the bay -- with no ghost, and says so, rather than failing. While the bay is open, a dock panel offers **Capture** (sweeps whatever is traced inside the frame into its own block -- never the scan, the ghost or the frame -- leaders it back to the station it was cut at, and proposes a placement marched clear of the plan's walls; nothing traced yet is refused with an explanation, not an empty block) and **Cancel** (removes the frame, the scan and the ghost, and leaves whatever you traced exactly where it is). **Reopen a section I already traced** puts a placed sketched section's linework back loose in a fresh bay, its scan returned at the scale it was traced at, with the placed block and its leader removed so the section exists in only one place at a time -- Capture puts it back. |
| Symbol Palette | `sym` | Every cave symbol the template carries, grouped by category, each tile showing the symbol itself rather than its name. Pick one and click in the drawing to place it; drag away from the click point instead and the symbol both turns to face the cursor and takes its SIZE from how far you dragged -- the distance from the press point is the symbol's radius, so a flow arrow or a pit is aimed and sized in one gesture. The **Size** box is in FEET of cave, not a scale factor -- the blocks are drawn about a foot across and a cave map is a thousand feet across, so one number in feet means the same size on every symbol and you can see what you placed. The drag writes what it chose into the Size and Angle boxes, so the next plain click repeats it; untick **Drag sets size too** to aim without resizing. Where you click decides the view, exactly as it does for Feature Trace: a symbol dropped in an elevation band lands on that band's run layers, one dropped in an open section bay lands on the section layers carrying the station its bay was cut at, and the readout above the tiles names the layer under the cursor before you press. A drawing that does not have the symbol -- an old cave, or one never started from the template -- gets the block fetched from the template as the symbol is placed. **New Symbol...** opens a drawing to draw your own in, centred on its origin with a 10 ft working square around the crosshair -- the biggest a symbol is meant to be drawn, at the scale of the grid -- and closes it again when you save; give it a name, a category and a home layer from the registry and it is written into YOUR OWN symbol library at `~/Documents/Cave/symbols/CaveCustomSymbols.dxf` -- beside your caves, where it syncs and gets backed up with them, and where no CaveCAD update can reach it. Each tile carries a count of that symbol in the view you are working in, a dash when none. A **Recent** strip above the categories holds the last five symbols you armed, the same way Feature Trace's does. Press **Return** with one symbol left showing and it is armed and placing, the way Feature Trace's search box arms a feature. **Delete Last** and **Erase** work here as they do in Feature Trace, and reach only what the palette places: erasing in the palette cannot take a traced wall. A placed symbol carries the same TRIP stamp a traced feature does, by the same rule -- so a revision sees a formation and a wall drawn on the same trip as the same trip's work. Symbols drawn before that library existed are moved into it the next time the palette opens. Your own symbols can be edited and deleted from the palette; the ones the suite ships cannot, because the next update would take the change back. Every shipped symbol's tile carries the same plain-words tooltip Feature Trace's does: what the symbol means, and the rule worth stating -- a flow arrow points downstream, a climb arrow points up, a stalactite holds tight to the ceiling. Your own symbols get no such line, deliberately: yours mean whatever you drew them to mean. |

### 4. Put a reference under the map

Field scans and outside imagery to trace against or check the map over.

| Tool | Command | What it does |
| --- | --- | --- |
| Sketch Scans | `ss` | Browse the cave's scanned sketches with hover previews. **Align on Scan** picks the stations on the scan ITSELF in the zoomable viewer -- wheel to zoom, middle-drag to pan, left-click a station and name it from the drawing's own list -- and then places the scan already fitted, so there is no insert-then-hunt-then-align. **Insert && Align** instead drops the selected scan over the survey at a guessed size and starts the same interactive fit on it there in the drawing: click a station on the image, click where it belongs, and it moves, rotates and resizes to match -- two stations for a plain fit, three or more to also take out the scanner's own stretch and skew, with a report of how far the worst station missed by. **Add a scan from elsewhere...** is the one thing the panel's own list cannot reach -- a photo still on a phone, a page scanned straight to the Desktop -- and file-picks it into the exact same insert-then-fit path. You can also **drag image files straight onto the preview**: they are COPIED into the cave's scans folder (into whichever trip folder you have selected, or the root if none), never moved, and never over the top of a file already there -- a second IMG_4021.jpg becomes IMG_4021 (2).jpg. (This used to be Align Image, its own tool; the two were always the same fit, so they are one entry now.) The work is split into three TABS -- Plan, Profile, Cross Section -- each holding only the buttons that view uses, in the order they are used. That replaced a combo saying which view the buttons applied to, which made the view a setting rather than a place you are and left every button on screen whether or not it did anything: Sketch Section sat greyed out through all the plan work, and Insert && Align sat through the section work meaning something subtly different. Plan and Profile offer Assign Stations to Scans, then Insert && Align, then Add a scan from elsewhere; Cross Section starts at Sketch Section, because a section is a different job. Refresh sits above the tabs, being about the list rather than any one workflow. Right-click a scan to mark it Complete: a tick appears beside it, a trip folder gets one when every page in it is done, and the panel opens on the first scan still to do. Opening a bay brings **Feature Trace** and the **Symbol Palette** with it, and Capture (or Cancel) puts them back the way they were -- a bay is a place you TRACE, and fetching those two by hand from a third panel every time, then putting them away by hand afterwards, was the hopping about. Restores rather than hides: a caver who already had Feature Trace open was not asking for it to be closed by a section they happened to capture. Choosing the Cross Section frame and pressing **Sketch Section** opens a staging bay instead (see below). |
| Surface Data | `sd` | Puts what is above the cave into the drawing: a georeferenced aerial photograph (USGS NAIP), surface elevation contours (USGS 3DEP, labeled in the drawing's unit), or both -- two checkboxes in one dialog, both on by default. (This used to be two entries, Aerial Basemap and Surface Contours, which asked the same question -- where is the ground? -- and failed in two different ways when nobody had answered it; now that question is asked once.) Both need the drawing's geo anchor: an existing Geo Reference, a station named A1 (the entrance, by convention), or a single selected station point -- or set one first from Survey Notebook > Declination, which offers to store it. With none of those, Surface Data refuses outright rather than fetching anything. |

### 5. Finish the sheet

Stats, the profile, the legend and callouts that dress the finished map.

| Tool | Command | What it does |
| --- | --- | --- |
| Sheet Setup | `sheet` | A docked palette for building a sheet, and a rough picture of it before you commit. Pick the paper -- ANSI and ARCH first, ISO A4 to A0 after, because a list is a statement about what you will probably want -- and it proposes the most detailed standard plot scale the plan fits at. Scales run `1" = 10 ft` up to `1" = 500 ft`, then the metric ratios `1:100` to `1:2000` at the bottom; a ratio is how a metric map states its scale and is unit-free, and a metric sheet gets a bar counted in METRES and captioned with its ratio, because a bar marked in feet under "1:500" asks a reader to convert in their head. Then tick what goes on the sheet -- border, scale bar, north arrow, title block, and the extended elevation on a second sheet -- and the preview redraws as you tick, showing the paper, the cave's own footprint on it, the furniture, and where the elevation bands will land. It says plainly when something is off the paper and WHICH thing, which is the one question a caver would otherwise answer by building the file and looking at it. **Sketch scans never reach a sheet** -- not a checkbox, a rule. A scanned field book page is a tracing reference: it sits under the drawing so a cartographer can follow it, and everything worth keeping off it has already been traced. On a plotted sheet it is a photograph of somebody's handwriting printed under the map. The rule is the ENTITY and not the layer, because two of Truitt Cave's forty-two scans sit on layer 0 and a layer rule let exactly those two through: a sheet carries no raster at all. That takes the aerial photograph too, which is right twice over -- nobody asked a plotted cave map to carry surface imagery, and an aerial is the cave's location baked into a picture. Unticking the elevation REMOVES it from the sheet rather than merely leaving it unplaced -- the copy comes from the record, so it would otherwise sit a thousand feet below the plan, outside the border, on a drawing whose whole promise is that it is what gets plotted. **Build Sheet** then writes it -- **one sheet per file**: `<Cave> Plan Sheet.dxf`, and `<Cave> Profile Sheet.dxf` when the elevation is ticked. Two sheets in one drawing is one enormous page as far as a plotter is concerned, so printing either would mean a window selection by hand every time; a file per sheet is a file per press of Print. The plan file has no elevation in it at all and the profile file has no plan, each with its border round what it actually shows, and the profile sheet gets no north arrow because an elevation has no north. Your drawing is never written to: the record is read from disk, the sheet is built in a copy, and the copy is written to `sheets/<Cave> Sheet.dxf` under the cave folder and opened for you. That is the point -- laying out a sheet moves the elevation and draws a border round everything, and that is a decision about ONE presentation of the map at one scale on one size of paper, not something the cave's own record should carry. (Its own subfolder, because a second `.dxf` beside the drawing is a second candidate for which file IS this cave.) Save before running it; the sheet is built from the file on disk, so unsaved work would be missing from it. **A sheet is marked, and the editing tools refuse it.** Feature Trace, the Symbol Palette, Survey Notebook, Cross Section and the rest all say so and send you to the cave's own drawing: a sheet is rebuilt from the record every time it is built, so anything drawn into one is lost the next time anybody presses Build Sheet -- silently, weeks later, with no way back, and the loss is not even obvious because a sheet still looks like the cave. The read-only tools are welcome: checking a sheet before plotting it is exactly what Check Map and Survey Stats are for. Two ways of knowing, because a mark is an entity and an entity can be deleted: the mark inside the file, and the `sheets/` folder it sits in. Press Build Sheet while looking AT a sheet and it rebuilds THAT sheet -- reading the cave's drawing one folder up, writing back to the file you are looking at -- rather than making a sheet of a sheet. What it draws: a border around the PLAN, a scale bar, a north arrow, and a title block filled in from the survey. The plan only, deliberately -- the extended elevation is drawn below it in the same drawing and a section bay is parked clear of both, so laying the sheet out around "everything in the document" sizes it for a column of three views: Truitt Cave asked for 1" = 80 ft that way and fits at 1" = 50 ft measured properly. **The elevation gets its own SHEET**, beside the plan's, on the same paper at the same scale -- a map carrying two scales is a lie, and a cave whose plan fills the paper has no room left beside it, so the alternatives were a scale step nobody asked for or paper nobody can print. The second sheet carries the cave's name, the words EXTENDED ELEVATION, its own scale bar (a sheet whose scale a reader has to look up on another sheet gets read wrong) and NO north arrow, because an elevation has no north. The elevation moves onto it as the sheet is drawn, tracing and all, and STAYS there: Generate Profile places the region inside that sheet's border from then on instead of in the gutter below the plan. Nothing is stored to go stale -- the position is read off the border, which Sheet Setup recomputes from the plan every time it runs. Pick the paper and it proposes the largest standard plot scale the cave fits at -- 1" = 10, 20, 25, 30, 40, 50 ft and up -- saying so, and saying when the paper has to be turned (the PAPER turns, never the cave: rotating a surveyed cave rotates north with it, and a map whose north arrow is a lie is worse than one that did not fit). Everything it draws is an inch of paper multiplied by that scale, which is the arithmetic the NSS template leaves to you: the template's sheet pieces are measured in INCHES and the cave is drawn in FEET, so a 0.14 inch title block line has to come out 7 ft tall at 1" = 50 ft to print at 0.14 inch. That is why beginners' maps go out with no scale bar -- not carelessness, an unasked question. The scale bar divides into round steps a reader can count (15 ft, 25 ft, 50 ft), and the north arrow says WHICH north it is and prints the declination that was applied as its evidence. The title block takes the cave name, who surveyed it, the dates, the length, the depth and the honest UIS grade straight from the drawing -- and never overwrites a line a human has already typed, so re-running after another trip refreshes the numbers and leaves your wording alone. It never fills in the LOCATION line, though the drawing usually knows exactly where the cave is: doing that automatically would put an entrance's coordinates on every sheet anybody plotted, without one decision being made by a person. Type that one yourself. The furniture's band at the foot of the sheet is RESERVED, not shared: the title block is as tall as its credit list makes it -- Truitt Cave's twenty-one surveyors take five wrapped lines -- and the cave is placed above that band rather than printed over by it, which can cost a scale step and says so when it does. Re-running replaces the previous sheet in one undo step, and a field wrapped across several lines round-trips whole rather than being trimmed to its first line each time. |
| Survey Stats | `sst` | Length, depth, loop closures, and the honest BCRA/UIS grade, computed from the drawing. |
| Generate Profile | `gp` | Rebuild the extended elevation beside the plan: one band per survey run, floor and ceiling lines from LRUD and splays. Normally happens on its own with every draw, from the notebook's own survey model; this forces it from the drawing's own tags instead and prints what it could not show. |
| Build Legend | `bl` | Generate the legend from what the map actually uses -- its LINES as well as its symbols -- and say what each one means. Three kinds of row: traced feature layers (surveyed and inferred walls, ceiling, floor, breakdown), shaped lines (ledges, pit, flowstone, rimstone, slope) drawn with their ornament, and catalogue symbols with NSS names and UIS aliases. Lines come first, because a reader meets the passage outline before the stalactites. The samples are DRAWN, not described: a dashed inferred wall is shown dashed and a floor ledge is shown with its hachures, because "Inferred Walls" as words teaches nobody which of the lines on the map is the inferred one -- and the solid/dashed distinction is exactly where a beginner reader goes wrong, since it looks like a drawing choice and is in fact a statement about how much of the map was measured. Under each name sits one plain sentence saying what the thing is, the same words the Feature Trace and Symbol Palette tooltips carry, so a convention taught once is then stated on the sheet a reader holds; switch the sentences off with `CaveSurvey/LegendExplain` for a tight sheet or a judge who wants the terse form. Your own symbols are listed but never explained -- they mean whatever you drew them to mean. Nothing is invented: a feature the map does not use does not appear, because a legend explaining a rimstone dam that is nowhere on the sheet sends a reader looking for it. Everything lands on the `LEGEND` layer, wearing the source layer's appearance, so the legend hides, moves and clears as one thing; re-running replaces it in one undo step. |
| Callout | `cal` | Place a text note bound to one or more leader arrows -- QCAD has no multileader, so this is a real text entity and a real leader per arrow, linked so the note stays text-editable and the arrows can be reflowed after a move. Opens on a choice of where the text comes from: type it, or pick a point and let it read a spot FLOOR elevation off the LRUD and splays there (not the survey line), stamping LINE on its face when it had to fall back to the line for want of a measurement. |

### 6. Fix and share

Repair an older drawing and hand the finished project to someone else.

| Tool | Command | What it does |
| --- | --- | --- |
| Check Map | `chk` | Read the finished map back and say what is missing or wrong -- and WHY it matters, which is the half a beginner does not have. Fourteen checks over the drawing itself: no scale bar, no north arrow, a title block that does not say who surveyed it or when, symbols used with no legend, a symbol on the wrong layer, work stranded on layer 0 or on a layer switched off (still in the file, silently absent from the plot), two wall lines that nearly meet but leave a hole, linework drawn nowhere near any station, a breakdown boundary left open so Scatter Breakdown skips it, a cross section tied to no station, a shaped line whose ornament has drifted, a floor ledge whose hachures the nearest floor levels say are on the high side, and a loop closure over the threshold worth questioning. A docked PANEL rather than a dialog, on purpose: click a finding and the drawing PANS to it at the magnification you are already working at -- clicking down the list walks the cave under a steady zoom rather than throwing the view in and out on every row -- read why it matters, press **Show Me** if you want it reframed close up, fix it, press **Check Again** and watch it leave the list. A finding with nowhere to pan to (a missing scale bar is nowhere in particular) moves the view not at all. It changes NOTHING -- a finding may be a decision rather than a mistake, and this is the tool that explains rather than the one that repairs. Every fault is its OWN row: eight wall gaps are eight entries, each with its own place. Right-click one for **Ignore This** -- not every finding is a fault, and a checker that cannot be told "yes, I know" is one that gets switched off wholesale, taking the findings that did matter with it. Ignoring hides THAT ONE finding and nothing else, so deciding the gap at the entrance is deliberate says nothing about the other seven; what is remembered is the finding's code and where it is, rounded to the foot, so the decision survives the next Check Again and a fault that has genuinely moved comes back and asks again. (The one deliberate exception is stray work, which is one row per LAYER rather than per entity -- 232 identical rows saying "a line on layer 0" is not a list, and "everything I left on 0" is the decision a caver actually makes. Any check with more than 40 entries is capped with a row saying how many are left.) The same menu holds **Show Ignored** (they come back marked as ignored, never looking like ordinary rows) and **Stop Ignoring Everything**, and the summary line always says how many are being held back. The list lives in your settings rather than in the drawing -- this tool changes nothing, and it is your judgement that a finding does not matter, not the map's, so a colleague opening the same cave still sees it. Where Survey Notebook's warnings read the SURVEY (bad numbers, flipped backsights), this reads the MAP. |
| Repair Drawing | `rep` | Three passes in one dialog, each a checkbox on by default, run in the order that matters: SURVEY DATA first -- re-derive the survey model from what the drawing already holds, and upgrade a legacy drawing's tags to the current schema -- because a legacy drawing's tags have to be current before anything else reads them; LAYERS second -- add the registry layers this drawing is missing and rewrite colour, linetype and lineweight on the ones it has, since a drawing keeps the layer appearance it was born with and a cave started before a palette change stays on the old one until this runs -- because rebuilding survey data can add layers; CALLOUTS last -- put every callout arrow back on its note after the note has been moved or reworded, and re-key a copied callout that ended up sharing an id with the original -- because restyling can move a note onto a different layer and strand its arrows. One combined report; uncheck a pass and its line says it was skipped. |
| Package Cave Project | `pc` | Assembles a cave project into one zip in `~/Documents/Cave/depot`: the drawing, the maps already in `PDF/`, the survey in every interchange format (Compass, Walls, Survex, Therion, CSV), and a MANIFEST anyone can read without CaveCAD. Sanitized by default -- the copied drawing loses its geographic anchor and no aerial photograph travels with it; a full archive keeps both, says so in its file name, and is meant for your own storage or for handing a project to the next cartographer. Never plots a PDF, and never touches the original drawing. |

Start a new map from `templates/NSS_Cave_Template_PLAN.dxf` -- the tools
draw onto its layers and the title block and symbol blocks live there. One
template covers both views: the extended elevation is drawn into the plan
drawing, below the plan, on its own `PROFILE-` layers. Every `File > New` starts from the plan template
unless the `CaveSurvey/TemplateOnNew` setting is explicitly false.

The title block is **ordinary text** on the `TITLE-BLOCK` layer: double-click
a line to edit it, drag it where you want it, delete the lines this map does
not use. Survey Stats can still stamp length, depth and grade into their
lines, which it finds by a hidden field tag rather than by position.

## A cave project folder

A cave folder gets the same four subfolders wherever the suite makes or
adopts one:

```
Pitfall Cave/
  Pitfall Cave.dxf        the drawing -- the record
  scans/                  photographed or scanned sketch pages
  PDF/                    plotted maps, exactly as they were plotted
  images/                 photographs, and the drawing's preview
  backup/                 previous versions of the drawing, datestamped
```

`backup/` holds one file per save that overwrote something:
`Pitfall Cave.dxf.2026-08-29_041200.bak`. The stamp sorts, so rolling
back is a matter of reading the folder and copying the one you want over
the drawing -- and each backup keeps the modification time of the
version it holds. The five most recent generations are kept
(`CaveSurvey/BackupKeep`); older ones are pruned oldest-first. A cave
drawing is most of a megabyte and usually lives on a synced drive, so
each generation costs upload traffic as well as disk.

A save that changes nothing costs no generation: the drawing is compared
against the newest backup first, and an identical one is not copied
again.

A backup is taken immediately before any of this suite's destructive
operations -- not on save. See `Core/CsBackup.js` for why that is the
better moment, and for the two "on save" hooks that were tried and
measured inert.

## Which format to hand someone

Every supported format carries the shape of the cave faithfully -- all
141 shots of the PITFALL CAVE fixture come back within rounding, and no
station moves more than 0.005 ft. What differs is everything around the
shape: trips, teams, the cave name, flags, LRUD grouping, and the
elevation datum.

**[docs/format-fidelity.md](docs/format-fidelity.md)** measures it rather
than asserting it, and `node tools/format_fidelity.js` reproduces the
measurement. The short version: Therion `.th` is the highest-fidelity
export, Compass `.dat` is the only one that keeps every flag and the only
one that **loses the elevation datum** (it has no fix directive, so the
cave rebases to zero), and CSV keeps the geometry exactly and almost no
context.

## A note on privacy

This repository is public and that is deliberate: it is GPLv3 code, and its test
fixtures use synthetic local grids rather than real coordinates. **Cave drawings
are a different matter** — working DXFs carry exact entrance coordinates, so
wherever you keep them must be private. Cave folders live in a shared drive the
survey group controls, never in a public repository; none of that applies to this
source tree.

## Conventions

These hold across every tool, and are worth knowing before you trust a map:

* **Azimuth** is degrees clockwise from north: 0 = N, 90 = E. Stored bearings
  are TRUE; declination is applied on import (from the file's own
  declaration, including Survex `*calibrate declination`) and recorded.
* **Distance is slope distance** -- along the tape, the way Compass, Walls
  and Survex all mean it. Plan position uses `d*cos(inc)`, elevation
  `d*sin(inc)`.
* **Units follow the drawing** (Edit > Drawing Preferences > Units), not a
  constant in source. Sources declare their own units and are converted.
* **L and R** face the direction of travel; LRUD belongs to the **To**
  station. A blank/missing measurement is *not measured* (never silently 0);
  an explicit 0 means "the wall is here".
* **Declination is positive east**: true = magnetic + declination. Anywhere
  a declination appears it is shown as `x.x° E/W` too.
* **Loops are adjusted by least squares, and it is ON by default.** A drawn
  survey has its misclosure distributed across the loop rather than dumped on
  the closing shot, weighted by `CaveSurvey/SigmaTape` (0.1) and
  `CaveSurvey/SigmaAngle` (1.5). This *moves stations* -- it is a change to
  drawn geometry, not an overlay. It is fully reversible: the raw readings are
  untouched in XDATA, and redrawing with `CaveSurvey/AdjustEnabled` set false
  reproduces the as-surveyed geometry exactly. The as-surveyed shape is also
  drawn as a ghost on layer `CTRL-RAW` so you can see what the solver did.
* **Everything the tools draw letters in UPPERCASE.** Station labels, splay
  names, notes, the legend, title block values, and the templates' own lines --
  the drafting convention a hand-lettered cave map has always followed.
  Capitalisation happens where the entity is made (`CsDraw.caps`), never to the
  data behind it: the note you typed keeps its case in the notebook and in
  XDATA.
* **Passage walls come with the survey, not from a separate step.** Wall runs
  are derived from LRUD **and from every splay** -- a splay tip is a measured
  wall hit, so it joins the wall on the side it was shot, ordered along the
  passage -- and drawn inside the same undo step as the centreline, dashed, as
  something to trace real walls over rather than as the walls themselves. A
  station with splays but no LRUD still carries walls. Splays are used
  unfiltered, so a ceiling shot pulls its wall in toward the station: that is
  the data talking, and tracing is where you overrule it. Redrawing replaces
  them.
* **Grades quote the as-surveyed closure, never the adjusted one.** Adjustment
  makes a loop close by construction, so quoting the post-adjustment figure
  would make every survey report as BCRA grade 5. Survey Stats reports the
  worst loop as it was measured.

## Repository layout

| Folder | What it is |
| --- | --- |
| `scripts/CaveSurvey/` | The add-on. `Core/` inside it is the pure library (survey model, parsers, math) every tool shares. |
| `templates/` | NSS-style plan and profile templates. |
| `testdata/` | Example surveys in the native formats. |
| `tests/` | See below. |
| `tools/` | Builds and publishes the release package. |
| `docs/` | Design docs and specs. |

## Installing

Hand users the built package (see below): it installs itself with
`./install.sh`. From a checkout:

```bash
cp -R scripts/CaveSurvey "$HOME/Library/Application Support/QCAD/QCAD/scripts/"
```

| Platform | QCAD's per-user scripts folder |
| --- | --- |
| macOS | `~/Library/Application Support/QCAD/QCAD/scripts` |
| Windows | `%APPDATA%\QCAD\QCAD\scripts` |
| Linux | `~/.local/share/QCAD/QCAD/scripts` |

Restart QCAD; add-ons load only at startup.

## Tests

```bash
./tests/run_all.sh             # structural + syntax + Core unit tests
./tests/run_all.sh --publish   # plus the ship gate (icons, status tips)
```

Three layers, no Python dependencies at all:

1. **Structural** (`tests/test_addon.py`, stdlib only): add-on layout, menu
   wiring, unique sort orders, icons parse as SVG, every `include()` target
   exists, and the layer registry agrees with the templates.
2. **Syntax** (`tests/js_syntax.js`): every script parsed inside QCAD's own
   engine.
3. **Unit** (`tests/js_unit.js`): 2300+ assertions over the Core library --
   parsers, round-trips, traverse math, network resolution, loop closure,
   blunder detection, grades, and the IGRF declination model (validated
   against ppigrf-generated fixtures) -- run inside QCAD's engine, or under
   `node` while developing.

## Building CaveCAD itself

The custom application -- QCAD Community rebranded, with native XDATA
persistence for survey data (upstream's free writer drops custom
properties; see `cavecad/patches/`) -- builds from pinned upstream
sources plus the patches in `cavecad/`:

```bash
./cavecad/build.sh
```

Produces `~/Applications/CaveCAD.app`. Requires Homebrew `qt`, `cmake`,
`ninja`. The suite installs into it with `./tools/publish.sh`. CaveCAD
is GPLv3, as QCAD is; `cavecad/patches/` is the corresponding source
for every modification.

## Building and publishing

```bash
./tools/make_package.sh     # dist/CaveSurveyTools-<version>.zip, fully gated
./tools/publish.sh          # build + install into QCAD + archive to ~/Documents/Cave

# a shelf full of invented caves, for screenshots and for trying the
# tools without typing survey data in by hand:
CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
    -autostart tools/make_demo_caves.js "$PWD"   # -> ~/Documents/Cave/demo
```

The version comes from `VERSION`. Nothing is released yet, so it is pre-1.0: `0.MAJOR.MINOR.PATCH`, where the trailing three keep continuity with the builds already published locally (`0.2.7.1` is the 2.7.1 build, honestly numbered). Tags match. A build that fails any check produces no
zip.
