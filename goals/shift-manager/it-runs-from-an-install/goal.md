# shift-manager › it runs from an install

**Issue:** FIX-1770

**Outcome:** Someone outside this repository installs Shift Manager, opens their own Lab in the browser with one command and no build, and with `--dev` sees a saved change to their Lab take effect without restarting anything by hand.

**Input:** every publishable package, built and packed the way a release packs it, npm-installed into an empty project. Beside it, a copy of the run-lab (`packages/shift-manager/test/fixtures/run-lab/`): a config and a Workforce tree importing only installed packages. It is held out: `GOAL_LAB=<dir>` swaps in another Lab, and another tree or another changed file must pass a correct Shift Manager too. Every worker, mailbox and board name is read from the tree at run time. The change leg b saves is picked from the tree: one hand-off worker's `WORKER.md` moved onto the flow another hand-off worker is on.

**Signal:** each failure tagged with its assertion:

- **a:TEAMS equals the Lab's workers**: the sidebar's TEAMS squares are exactly the tree's workers, read off disk.
- **a:Open trace opens the Lab's session**: a task the store holds with a run offers *Open trace*, and following it opens the DevTool on that run's session.
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
