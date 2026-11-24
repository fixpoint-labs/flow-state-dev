---
"@flow-state-dev/shift-manager": minor
"@flow-state-dev/harness-manager": minor
---

Shift Manager's coder is the harness kit's `coder` flow (FIX-2877). It no longer runs a coding flow of its own.

- **Breaking: `openLab`'s harness options.** `openLab` takes `harnesses` (harness values, the one list) and `defaultHarness`. `harness`, `harnessName`, the named-harness record, `harnessValues` and `stopsOnAbort` are gone, with no alias: pass the slot as a harness value (`readyHarness(slot, id)` for a scripted one), and declare stop-on-steer on the harness block (`stopsOnAbort`). `selectHarness(...)` returns the coder as `value`, a harness value, in place of `slot`; `startHarness(...)` returns every harness as `harnesses`.
- **One list of coders.** The DevTeam and `fsd` profiles hand the kit all four harnesses: the scripted coder, Claude Code, Codex and Cursor. The readiness view now lists all four, not only Claude Code, and the scripted coder always reads ready. `DEVFORCE_LAB_HARNESS` still picks the coder a worker naming none runs on; a `coder` worker with `harness: cursor` (or `codex`, `claude-code`) still runs on that one.
- **A task on a harness this machine can't run is refused at once**, saying why, before any run starts. Before, a Codex or Cursor run with no sign-in failed inside the run.
- **A hire naming a harness Shift Manager doesn't run** is refused by the kit's setting check, listing exactly the harnesses the coder runs, in place of Shift Manager's own wording.
- **One run budget.** Every run may take `DEVFORCE_LAB_RUN_MINUTES` minutes, 20 by default, whichever harness runs it; the scripted coder's one-minute budget at start is gone.
- **Same tasks, same keys.** A task carrying the feature marker still implements it (the `implement` mode, needing a commit) and any other is answered (the `answer` mode). Runs keep the keys, branches and checkouts they were stored under, so a run in flight across the upgrade is found where it was. Block names in a run's trace now name the shared flow (`coder-<harness>-implement`, `coder-<harness>-answer`).
- **harness-manager: a mode can work in its task's project on its own.** A mode registered on the harness kit takes `project` (`modes: { answer: { project: true } }`): its runs hold the project collections their workspace reads and run the project's checks, whatever the kit's `project` is. Whether a filing needs a project stays the kit's. Shift Manager's `answer` mode sets it, so a Lab on one fixed repository still answers in a task's project.
- **harness-manager: the kit's `review` is a floor.** A worker's `review:` line can turn review on when the kit's is off, and can no longer turn it off when the kit's is on: a worker hired with `review: false` on an app with `review: true` still waits for a user's review before a run with commits completes.
- **harness-manager:** the coder flow refuses at start a harness that keeps session state beneath its task entry, naming the entry; and `hostForConfig`, the workspace host a fixed repository runs through, is exported from `@flow-state-dev/harness-manager/checkout`.

Docs: packages/shift-manager/README.md, where it describes running from a checkout and `DEVFORCE_LAB_HARNESS` (`DEVFORCE_LAB_HARNESS`: readiness lists every coder; a task on one not set up here is refused at once; one run budget); packages/harness-manager/README.md (the kit's `modes`: a mode's own `project`)
