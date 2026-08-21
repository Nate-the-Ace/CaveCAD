# GitHub Versioning for Cave Drawings — design

**Date:** 2026-08-20
**Branch:** github-versioning (off v2)
**Status:** Approved (seven decisions taken by Nathan during brainstorming)

## Goal

Cave drawings live on one laptop. The goal, in Nathan's framing, is **GitHub as cloud
storage, with versioning as the very helpful bonus**: a drawing saved in CaveCAD should
be off the machine within seconds, and a survey trip should be reviewable as a discrete
change rather than a 12,000-line DXF diff.

Three capabilities, in priority order:

1. **Push** — saved work reaches GitHub without the surveyor thinking about it.
2. **Clone** — a project or cave repo comes down with its folder conventions intact.
3. **Pull requests** — a trip becomes a reviewable unit carrying its own survey summary.

## Why this is feasible at all

Probed in CaveCAD 3.33.0's engine on 2026-08-20 (`-no-gui -autostart`):

| Capability | Result |
|---|---|
| `QProcess` construct, `start`, `waitForFinished`, `readAllStandardOutput` | **available**, ran `git --version` successfully |
| `gh` on PATH from inside CaveCAD | **yes** — `/opt/homebrew/bin/gh` 2.97.0, `gh auth status` reports logged in as `ndschonegg` |
| `QDialog`, `QTreeWidget`, `QListWidget`, `QProgressDialog`, `QTextEdit`, `QFileDialog` | available |
| `QNetworkAccessManager` | **absent** |
| `QTemporaryDir` | absent |
| `git-lfs` on the host | **not installed** |

Two consequences are load-bearing. No `QNetworkAccessManager` means **the GitHub API is
reachable only through the `gh` CLI** — there is no in-process HTTP fallback, so `gh`
being absent or unauthenticated is a first-class state the design must handle, not an
edge case. And `QTableWidget` is still missing from this bridge (see
[[qcad-plugin-conventions]]), but `QTreeWidget` is present, so list-shaped UI is fine.

## Decisions taken

| # | Decision |
|---|---|
| 1 | **Private repos only, hard enforced.** Any repo GitHub reports as non-private is refused for clone, push and PR. No override, no confirmation dialog. |
| 2 | **Repo scope: cave-per-repo plus a project index.** A project repo carries `CAVES.json` listing member cave repos and clones them on demand. |
| 3 | **PR review artifacts: a deterministic survey sidecar plus a generated PR body.** No plot/PDF export committed. |
| 4 | **Session branch, auto-commit on save.** Opening a drawing from a clone puts the next save on a session branch; every save commits. |
| 5 | **Auto-push after every save.** Backup value comes from it being automatic. |
| 6 | **Small team, one cave each.** No merge machinery; warn when another open PR touches the same cave. |
| 7 | **Clones live in `~/Documents/Cave/` directly**, and **`scans/` is gitignored by default.** |

Two further calls made in the design and open to reversal at spec review:

- **The sidecar carries no coordinates.** Entrance lat/lon stays only in the DXF.
- **The pre-push hook fails closed** when it cannot verify visibility.

## Privacy: the constraint that shapes everything

The project's first rule is never to expose cave entrance locations
([[cave-location-privacy]]). Working DXFs carry exact entrance lat/lon in LocationPick
XDATA and in `GeoLat`/`GeoLon` on the georeferenced anchor station. Pushing them to
GitHub sends that to a third-party host where it is replicated, backed up, and
**permanent in history even if a later commit strips it**. Private repos make this
acceptable; nothing else does.

Enforcement is therefore in three places, deliberately redundant:

1. **`CsHub.assertPrivate(owner, repo)` before every clone, push and PR.** Runs
   `gh repo view <owner>/<repo> --json visibility`. Anything but `PRIVATE` aborts with a
   message naming what would leak.
2. **A `.githooks/pre-push` script in every scaffolded repo**, which re-asks the same
   question at the git level so a plain `git push` from a terminal is covered too.
3. **The sidecar omits coordinates.** A georeferenced station is recorded as a bare
   marker line (`# geo A1`) with no values. The DXF stays the single copy of the one
   fact worth protecting, rather than the design adding a second, greppable copy.

**The hook fails closed.** If `gh` is missing, unauthenticated, or the API call fails,
the hook refuses the push. "Could not verify" is not "it is fine" — under decision 1
there is no path where an unverified remote gets data.

**Hooks do not activate on clone.** `core.hooksPath .githooks` is repo-local config that
a fresh `git clone` does not set. `CloneProject` and `InitCaveRepo` set it explicitly.
A teammate who clones with plain `git` has no hook until they run `CloneProject` — which
is exactly why enforcement point 1 exists inside the plugin and is not delegated to the
hook.

## Repo layout

### Cave repo

```
drawings/                  .dxf — the source of truth
survey/                    generated *.shots.tsv review sidecars
notes/                     trip notes, markdown
exports/                   PDFs handed out; exports/tmp/ ignored
scans/                     ignored — stays local
CAVE.json                  slug, display name, units, station prefix. No coordinates.
README.md                  cave name, station convention, "clone with CloneProject"
.gitignore
.gitattributes
.githooks/pre-push
.github/pull_request_template.md
.github/CODEOWNERS
```

### Project repo

```
CAVES.json                 slug -> repo URL -> owner, for each member cave
shared/templates/          drawing templates shared across caves
shared/blocks/             symbol blocks
README.md
.gitignore
.gitattributes
.githooks/pre-push
.github/pull_request_template.md
.github/CODEOWNERS
```

### `.gitignore` (scaffolded verbatim, comments included)

```
# CaveCAD working files
*~
~*.dxf
*.dxf.bak

# macOS
.DS_Store

# Notebook and sketch scans are NOT tracked. GitHub hard-blocks any file over
# 100 MB and git-lfs is not in use in this project. Scans stay on local disk
# and in whatever backup covers the rest of the laptop. Do not un-ignore this
# without setting up git-lfs first.
scans/

# Transient export output
exports/tmp/
```

### `.gitattributes`

Explicit per-extension only — **no blanket `* text=auto`**, which would guess wrong the
first time a binary DXF lands in the repo and silently corrupt it on checkout.

```
*.dxf   text eol=lf
*.tsv   text eol=lf
*.dat   text eol=lf
*.svx   text eol=lf
*.svg   text eol=lf
*.md    text eol=lf
*.json  text eol=lf
*.png   binary
*.jpg   binary
*.jpeg  binary
*.pdf   binary
```

### `CAVES.json`

```json
{
  "schema": 1,
  "project": "ozark-karst-project",
  "caves": [
    { "slug": "blowing-hole", "name": "Blowing Hole", "owner": "ndschonegg", "repo": "cave-blowing-hole" }
  ]
}
```

No coordinates, no county, no directions. The slug is the only identifier.

## New Core libraries

All pure JS, `Cs`-prefixed with the global matching the filename per
[[qcad-plugin-conventions]], each taking an **injectable process runner** so the unit
tests never spawn `git` or touch the network.

| File | Global | Owns |
|---|---|---|
| `Core/CsProc.js` | `CsProc` | The only place `QProcess` is constructed. `CsProc.run(prog, argv, opts)` -> `{code, out, err, timedOut}`. argv arrays exclusively — **never a shell string**, because cave names and macOS paths contain spaces and a shell string turns one argument into two. Per-call timeout. Appends every invocation and its exit code to `~/Library/Application Support/QCAD/CaveCAD/cave-git.log`. |
| `Core/CsGit.js` | `CsGit` | git verbs: `toplevel`, `status`, `currentBranch`, `defaultBranch`, `checkoutNew`, `add`, `commit`, `push`, `pullRebase`, `clone`, `aheadBehind`, `configLocal`. Pure argv builders separated from execution so they can be asserted in tests. |
| `Core/CsHub.js` | `CsHub` | `gh` verbs and their JSON: `authStatus`, `repoView`, `repoCreate`, `prCreate`, `prList`, `assertPrivate`, `currentLogin`. |
| `Core/CsRepo.js` | `CsRepo` | Scaffold content generation and writing, `CAVE.json` / `CAVES.json` read+write, path -> cave slug resolution, session branch naming. |
| `Core/CsSidecar.js` | `CsSidecar` | Survey model -> deterministic TSV, and parse back for diffing. |
| `Core/CsCommitMsg.js` | `CsCommitMsg` | Old sidecar + new sidecar + survey -> commit subject/body and PR title/body. |
| `Core/CsSync.js` | `CsSync` | The save-path orchestrator: resolve repo, ensure branch, write sidecar, stage, commit, push. Owns the offline queue state and the "git is unavailable this session" latch. |

`Core/CsAll.js` gains the new files in dependency order.

## New tools

Menu group stays `450`. Sort orders 25, 27, 30, 32, 34 are free in the current suite
(used: 5, 10, 15, 20, 40, 52, 60, 70, 75, 78, 80, 85, 90, 95). Because a duplicate
`(groupSortOrder, sortOrder)` silently displaces a tool from the menu,
`make_package.sh` gains an assertion that every pair in the suite is unique.

| Tool | Sort | Does |
|---|---|---|
| `CloneProject/` | 25 | Pick a project or cave repo (`gh repo list` or typed `owner/name`), `assertPrivate`, clone into `~/Documents/Cave/<name>/`, set `core.hooksPath`, read `CAVES.json` and offer member caves, then offer to open a drawing. |
| `InitCaveRepo/` | 27 | Scaffold a cave or project repo on disk, `git init`, `gh repo create --private`, first commit, push, and register the cave in a project's `CAVES.json`. |
| `SyncProject/` | 30 | Explicit `git pull --rebase` then push. The only place a rebase is ever attempted. |
| `ProjectStatus/` | 32 | `QTreeWidget`: repo, branch, dirty files, ahead/behind, queued-push count, open PRs, and the same-cave overlap warning. |
| `OpenPullRequest/` | 34 | `QDialog`: editable title, generated body, base branch picker, then `gh pr create`. Reports the PR URL. |

No menu item for the save wrapper. `CaveSurvey.js`'s `init(basePath)` installs it.

## The save path

The wrapper wraps `Save.prototype.save` **at install time, by replacing the function on
the prototype** — the pattern `CsBind.withSuppressed` already uses, chosen for the same
reason: a call site that has to remember to opt in fails silently the day someone adds a
new caller. `Save` is a global loaded by QCAD's own include; the installer guards with a
`typeof Save === "undefined"` check before including it, because QCAD's `include()`
dedupes by basename and `Save.js` is certain to be already loaded.

Order, with each step's failure isolated:

1. **Stock save runs first, unmodified.** Its return value is what the wrapper returns.
   Git never delays, blocks, or fails a save. If step 1 returns false, the wrapper stops
   — there is nothing to commit.
2. **Resolve the repo.** `CsGit.toplevel(dirname(fileName))`. Not in a work tree, or the
   work tree has no `CAVE.json`/`CAVES.json`: return silently. A drawing outside a cave
   repo behaves exactly as it does today.
3. **Ensure the session branch.** If `HEAD` is the default branch, create
   `survey/2026-08-20-ndschonegg` from it. Handle unavailable already means already on a
   `survey/*` branch — stay there.
4. **Regenerate the sidecar.** `CsRevise.surveyFromDocument(doc)` -> `CsSidecar.write()`
   -> `survey/<slug>.shots.tsv`.
5. **Commit.** Stage the saved `.dxf` and the sidecar only — never `git add -A`, which
   would sweep up whatever else is in the tree. Nothing staged after the diff check
   means nothing changed: skip the commit entirely rather than making an empty one.
6. **Push.** `git push -u origin <branch>`, after `CsHub.assertPrivate`.

### Session branch, not Trip

`survey/YYYY-MM-DD-<gh-login>` is a **work session**, not the revision framework's Trip.
Trip identity is the fingerprint `date|declination|team` and one drawing may hold many
trips ([[cave-survey-revision-framework]]); one session branch can therefore carry
several trips, and several sessions can touch one trip. Naming the branch `trip/...`
would invite exactly the conflation that breaks `CsModel.ensureTrips`. The login comes
from `CsHub.currentLogin` and is sanitized to `[A-Za-z0-9._-]`.

## Sidecar format

`survey/<slug>.shots.tsv`. A **review artifact, not a backup** — the DXF remains the
source of truth and the only thing `CsRevise` reconstructs from. Its single job is to
make a changed azimuth show up as one changed line in a pull request.

```
# schema	1
# cave	blowing-hole
# geo	A1
# trip	1	2026-08-20	NS,JD	-2.50	igrf	ft
from	to	dist	az	inc	L	R	U	D	trip	flags	note
A1	A2	42.10	118.50	-3.00	2.00	3.00	1.00	0.00	1
A2	A3	17.55	094.00	12.50		5.00	2.00	0.00	1	X	tight crawl
```

Rules that make the diff readable, all of which are testable:

- **Order is `(tripId, shotSeq)` ascending.** Never document query order, which is not
  deterministic in this build.
- **Fixed decimal places** — distances and LRUD to 2, angles to 2. Unstable float
  formatting is what turns a one-shot edit into a 400-line diff, so determinism is the
  point of the file, not a nicety.
- **Empty field means not measured; `0.00` means a wall at the station.** The same
  null-versus-zero distinction the LRUD model already makes.
- **Tabs and newlines inside a note are escaped** as `\t` and `\n`. Note that this file
  is written by a different mechanism than `CsTags`, whose nested-escaping hazard
  (backslash-n inside a tag payload) does not apply here — but the sidecar writer must
  never be "unified" with `CsTags.set` for that reason.
- **`# geo <station>` records that a station is georeferenced and nothing more.** No
  latitude, no longitude, no `*fix` line.
- Azimuths are written as stored: TRUE, declination already applied, with the trip's
  declination and its source on the `# trip` line so a reviewer can see which correction
  produced them.

## Commit message and PR body

Commit subject stays under 72 characters, truncating the station range before the shot
count:

```
survey 2026-08-20: +14 shots, A7..A12

Cave: blowing-hole
Trips: 2026-08-20 (NS, JD)
Shots: 14 added, 2 revised
Closure: L1 4.21 ft -> 0.74 ft
Drawing: drawings/blowing-hole.dxf
```

PR body is the same summary under the template's checklist. `CsCommitMsg` computes it by
diffing the previous sidecar in `HEAD` against the regenerated one, plus `CsStats` for
closure and grade — which is why this logic cannot live in a shell script: it needs the
survey model in process.

`.github/pull_request_template.md`:

```
## Trip summary

<!-- filled in by CaveCAD -->

## Checks

- [ ] Declination source recorded for every trip
- [ ] Loop closure acceptable, or the misclosure is explained
- [ ] Blunder check clean
- [ ] No coordinates on the map face or in the title block
```

`.github/CODEOWNERS` routes each cave folder to its owner so the one-cave-each convention
is enforced by review assignment rather than by memory.

## Conflicts, offline, and errors

**Nothing is ever text-merged.** Both the `.dxf` and the sidecar are regenerated wholes,
so handing them to git's merge driver could only produce a corrupt drawing.
`.gitattributes` does not define a merge driver for them, and `SyncProject` offers
keep-mine / keep-theirs / stop on divergence. Regenerating the sidecar from the DXF is
always correct; merging two sidecars never is.

**A rejected push is reported, never resolved on the save path.** Non-fast-forward means
someone else has commits. Rebasing underneath a surveyor who is mid-drawing is how work
gets lost, so the save path reports and stops; `SyncProject` is where the surveyor
chooses to rebase, deliberately.

**Offline is a normal state, not an error.** Push failure that looks like a network
problem (unresolved host, timeout) leaves the commits local, increments a queued count,
writes one quiet line to the command line — no dialog — and retries on the next save.
`ProjectStatus` shows the ahead count so the queue is never invisible.

**Broken `gh` auth latches.** `gh auth status` failing produces one clear message
pointing at `gh auth login`, then sets a session latch that keeps git features quiet
until CaveCAD restarts. Warning on every save would train the surveyor to ignore
warnings.

**Every failure surfaces the shortest decisive line** from stderr, with the full output
in `cave-git.log`. Timeouts: 30 s default, 300 s for clone, with `QProgressDialog` for
clone only — the save path must never show a modal.

**Overlap warning** comes from `gh pr list --state open --json number,author,headRefName,files`,
filtered to PRs touching this cave's paths, falling back to `gh api repos/{o}/{r}/pulls`
plus per-PR files if `files` is not populated on list. Shown by `ProjectStatus` and on
the first push of a session.

## Testing

Unit tests in the existing headless harness (`tests/run_all.sh`, runs under node and
`CaveCAD -no-gui`), with `CsProc` replaced by a fake runner throughout:

- **Scaffold content** — exact expected bytes for `.gitignore`, `.gitattributes`,
  `pre-push`, the PR template, `CAVE.json`, `CAVES.json`.
- **Sidecar determinism** — the same survey serialized twice is byte-identical; a survey
  whose shots arrive in a different order serializes identically; null LRUD stays empty
  and zero stays `0.00`; a note containing a tab and a newline round-trips.
- **Sidecar omits coordinates** — an assertion that a survey with a georeferenced,
  `*fix`-carrying station produces output containing no latitude or longitude value.
  This one guards the project's first rule and should fail loudly if anyone "improves"
  the writer.
- **Commit message and PR body** from fixture sidecar pairs, including the 72-character
  subject truncation.
- **argv assertions on every builder** in `CsGit` and `CsHub` — exact arrays. This is
  what catches a cave name with a space becoming two arguments, the failure mode a
  shell-string implementation would ship with.
- **`gh` JSON parsing** against captured fixture responses for `repo view`, `pr list`,
  `auth status`, including a public-visibility response that must abort.
- **Branch naming** — sanitization of logins and dates.

One integration test, real `git`, no network and no `gh`: create a temp dir, `git init
--bare` a remote, clone it through `CsGit`, scaffold, commit, push, and verify the bare
repo received the objects. `CsHub` stays faked because it is the network.

`make_package.sh` gains the sort-order uniqueness assertion.

### Needs live GUI verification (cannot be proven headless)

1. The `Save.prototype.save` wrapper actually fires on File > Save, on Ctrl+S, and on
   Save All — and does **not** fire on AutoSave.
2. `OpenPullRequest`'s `QDialog` renders and its widgets connect under the brew bridge.
3. `ProjectStatus`'s `QTreeWidget` populates.
4. The offline queue behaves with the network actually off.
5. Push latency on a real save is tolerable in normal use.

## Not in scope

- **Any public repo path, and any coordinate fuzzing.** Decision 1 removes the need;
  [[cave-location-privacy]] already rejected fuzzing on its own merits.
- **A CI workflow validating the sidecar.** Considered and dropped — the Core libs would
  have to run in CI without CaveCAD, and the checks already run in-app before the commit.
- **Committed PDF or PNG plot exports.** Binary churn without git-lfs.
- **Merge tooling for two people editing one drawing.** Decision 6: one cave each, warn
  on overlap.
- **git-lfs setup and tracked `scans/`.** Decision 7.
- **Submodules.** `CAVES.json` is a plain manifest; on-demand cloning is simpler than
  submodule state and does not need the surveyor to understand detached HEAD.
- **Sanitized-copy export.** Still the right feature if a DXF ever has to leave the
  project, still not needed here, still low priority.

See [[qcad-plugin-conventions]], [[cave-location-privacy]],
[[cave-survey-revision-framework]], [[qcad-publish-to-cave]].
