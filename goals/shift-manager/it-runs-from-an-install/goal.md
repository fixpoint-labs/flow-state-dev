# shift-manager › it runs from an install

**Issue:** FIX-1770. The run-lab it copies was converted onto the lead's own conversation board by FIX-1792 P3: its mailbox and board are gone.

**Outcome:** Someone outside this repository installs Shift Manager, opens their own Lab in the browser with one command and no build, and with `--dev` sees a saved change to their Lab take effect without restarting anything by hand.

**Input:** every publishable package, built and packed the way a release packs it, npm-installed into an empty project. Beside it, a copy of the run-lab (`packages/shift-manager/test/fixtures/run-lab/`): a config and a Workforce tree importing only installed packages. It is held out: `GOAL_LAB=<dir>` swaps in another Lab, and another tree or another changed file must pass a correct Shift Manager too. Every worker and flow name is read from the tree at run time: the lead is the worker whose `WORKER.md` names delegates (no coordinator), and its tasks are on its own conversation's board. The change leg b saves is picked from the tree: one of the lead's delegates' `WORKER.md` moved onto the flow another delegate is on.

**Signal:** each failure tagged with its assertion:

- **a:TEAMS equals the Lab's workers**: the sidebar's TEAMS squares are exactly the tree's workers, read off disk.
- **a:Open trace opens the Lab's session**: a task the lead's conversation board holds with a run (read through that conversation, kept to its own rows) offers *Open trace*, and following it opens the DevTool on that run's session.
- **b:the change shows**: within 20 s of saving the `WORKER.md` edit, with no other input, the open Roster draws the worker on its new flow.

**Anti-game:** a hollow pass would be one that works only in a checkout, where workspace links hide a file the tarball lacks, or one graded against Shift Manager's own reads or log. So no repository import, workspace link or `pnpm` filter reaches the Lab: every installed `@flow-state-dev/*` package must be a real directory inside the project, the `shift-manager` command must resolve inside it, and the Lab's files may import nothing outside the Lab's folder. The port is chosen here, so the check never reads the command's log for an address. The oracles are the tree on disk (`readDeclaredRoster`) and the store, read through the Lab's routes by this script's own requests.

**Model:** n/a (model-free: the Lab's runs are scripted)

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-runs-from-an-install/run.mts`

**Controls:** each patches the installed project, never the checkout. Run them one at a time: each builds and installs every package.

- `GOAL_CONTROL=no-page-config`: the installed `@flow-state-dev/node` writes nothing into the pages it serves, so the page gets no DevTool address and no reload script. Must fail **a:Open trace opens the Lab's session** and **b:the change shows**. TEAMS still draws: the page's reads work without the config, so this control does not reach that assertion. The patch throws if it finds nothing to patch.
- `GOAL_CONTROL=no-watch`: the command runs without `--dev`. Must fail **b:the change shows**.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-10 | bec1b0a2 + uncommitted (FIX-1792 P3) | n/a | FAIL | On the checked-in run-lab: **anti-game** *"lab.mts imports ../hearing-door.mts"*. Not the conversion's: the run-lab has imported the shared fixture door from outside its folder since FIX-1789 (a6579796), and `multi-seat-collab` imports it too, so it is left for whoever owns that file's place. |
| 2026-10-10 | same, `GOAL_LAB=` a scratch copy of the converted run-lab with `hearing-door.mts` copied in beside `lab.mts` | n/a | PASS | 28 tarballs npm-installed. TEAMS draws the tree's 5 workers [lab.auditor, lab.coder, lab.desk, lab.lead, lab.reviewer]. Open trace on a task of the lead's conversation board opened the DevTool on its run's session. Saving `lab.auditor`'s `WORKER.md` (flow: audit → seat) showed on the open Roster after 4.8 s. (A first run FAILed **b**: the converted Lab refused a tree with no delegate on a flow of its own, so the reload never took; it now opens such a tree.) |
| 2026-10-10 | same held-out copy (controls) | n/a | FAIL (expected) | `no-watch`: only **b:the change shows**. `no-page-config`: **a:Open trace opens the Lab's session** (no trace link) and **b:the change shows**; TEAMS still draws. |
| 2026-10-11 | FIX-1792 P4 on 617aeabb + uncommitted | n/a | PASS | No change needed. Same held-out scratch copy of the run-lab with `hearing-door.mts` beside `lab.mts` (the checked-in run-lab still imports it from outside its folder). 28 tarballs npm-installed; TEAMS draws the tree's 5 workers; Open trace on a task of the lead's conversation board opened the DevTool on its run's session; saving `lab.auditor`'s `WORKER.md` (flow: audit → seat) showed on the open Roster after 5.0 s. |
| 2026-10-12 | f1ae3521 + uncommitted (FIX-1894) | n/a | **PASS** | On the checked-in run-lab, with no scratch copy: the shared `hearing-door.mts` now lives in the run-lab's folder (multi-worker-collab imports it from there), so the Lab imports nothing outside its folder and the anti-game holds. 28 tarballs npm-installed; TEAMS draws the tree's 5 workers; Open trace opened the DevTool on the task's session; the saved `WORKER.md` edit showed on the Roster. |
| 2026-10-12 | f1ae3521 + uncommitted (FIX-1894, controls) | n/a | FAIL (expected) | `no-page-config`: **a:Open trace opens the Lab's session** (no trace link) and **b:the change shows**. `no-watch`: only **b:the change shows**. |
