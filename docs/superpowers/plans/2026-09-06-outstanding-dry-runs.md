# Outstanding beginner dry runs

The plan's per-task gate is three-part: the headless suite, a live GUI
check, and a beginner dry run. The first two can be taken without the
repository owner; the third cannot, and is not claimed as done here.

Each row is a question to answer while using the tool, not a box to
tick. A "no" is a wording or ordering bug, and the fix goes in before
the next task builds on it.

| Task | Committed as | Dry run still owed |
| --- | --- | --- |
| 2 -- staged menu | `6be9fab` | Open the Cave Survey menu cold and read it top to bottom. Does the order match the order you would teach in? Anything you would move? |
| 3 -- Repair Drawing | `8da895e` | Open a cave that needs repair and run **Repair Drawing** once, reading only the dialog. Could a student tell from the three checkbox labels alone what each does and whether it is safe? (The dialog is modal, so it is the one part of this tool no automated check can reach.) |
| 4 -- Callout | `070d537` | Place one typed callout and one floor-elevation callout. Is the two-option dialog answerable by a student who has not met the word LRUD? The dialog is modal, so it is the one part no automated check can reach. |
| 5 -- Cross Section | `da590d6` | Trace one scanned section end to end using only what is on screen. Two questions: was it obvious how to finish, and how to get out without finishing? That is the whole reason the bay panel exists. Then check the placement still feels like yours -- Capture should preview a proposed spot, take Enter, and let you click somewhere else instead. |
| 6 -- Sketch Scans | `42e479a` | Put a scan under the drawing without touching the menu bar, twice: once from the cave's own scans folder, once with **Add a scan from elsewhere...**. Is everything a student needs now on the panel, or did you reach for something no longer there? |
| 7 -- Surface Data | `7a2aee7` | Run **Surface Data** on a drawing with no location set. Does the refusal tell a beginner exactly what to do next, in words they have already met in the menu? Then run it with both boxes ticked on an anchored cave and check imagery and contours both still land as they used to. |
