# conductor › it drives-one-issue-to-a-merge-ready-branch

**Outcome:** Someone hands conductor one work item against the `conductor-self-drive` example and walks away. Conductor puts it under management, dispatches the coding to whichever harness is installed, and the change lands on a real branch pushed to `origin` — running the example on that branch does the new thing. Nobody typed a follow-up prompt, no coordinator model call decided where the work went next, killing the process while the item sat at a gate and starting it again picked up exactly where it was, and nothing was merged. This is M1's acceptance criterion, self-contained: the work item is the example app's own source, so the check does not depend on whatever happens to be in the backlog.

**Input:** `fixtures/work-item.json` — `{ operation, brief, cases }`. `brief` is the work item text conductor is handed; `cases` are input/expected pairs the coding harness **never sees**, and the only thing the result is graded against. Held-out twice over: swapping `reverse` for any other total string operation (`rot13`, `trim`, …) with its own cases must still pass a correct implementation, and because the harness is given prose rather than examples, a change that satisfies the graded cases has to actually implement the operation rather than pattern-match the check.

**Signal:** against the real path — the example's real `conductor.config.ts` resolved by `resolveConductor`, the real dispatcher discovery, a real git remote, and a real coding harness doing the work:

1. **Level 1 holds.** `resolveConductor` on the example's config reports `origins` of `discovered` for the repo, the base branch, the repo root, and the dispatcher — the example configured none of them.
2. **A merge-ready branch exists.** `fix/<work item id>` is on `origin`, ahead of the base branch, and a fresh worktree cut from it runs the example green: `cli.ts --verify` exits 0, `cli.ts --list` names the fixture's operation, and `cli.ts <operation> <input>` prints `expected` for every held-out case.
3. **Every phase transition is reproducible from the ledger.** Per entity: `seq` starts at 1 and increases by exactly 1 with no holes; each row's `phaseBefore` equals the previous row's `phaseAfter`; every row whose phase moved carries `actionKind: "enterPhase"`; and the last row's `phaseAfter` equals the phase read back from storage. Nothing moved the phase outside a recorded action.
4. **No coordinator model call decided a transition.** Ticking again with an unchanged world appends **zero** ledger rows and performs **zero** further dispatches. A reducer that consulted a model would not be stable across two identical reads.
5. **Killing the process mid-gate and restarting continues.** The drive stops at a human gate; the session handle is dropped and a new one is opened over the same durable state (the restart), then ticked. The derived gate, the stored phase, and the dispatch count are all unchanged, and no `enterPhase` row was appended. The drive loop is also capped: exceeding the tick cap without settling is itself a failure, which is what "does not loop" means here.
6. **Conductor never merges.** `origin/<base branch>` points at the same commit before and after the whole run.

**Anti-game:** a hollow pass would assert that a branch exists, that `operations.ts` changed, or that the file now contains the string `reverse`. All three hold for an agent that wrote a broken function, a duplicate registry entry, or a comment. The check must therefore **execute the operation on the produced branch and grade it against cases the harness was never shown**, and must assert the operation is in the registry `--list` renders rather than merely present in the file. A second hollow pass would assert the phase reached `IMPLEMENTATION` and stop: that holds for a driver that moved the phase itself and wrote a ledger row afterwards as decoration. The check must therefore assert the ledger's `seq`/`phaseBefore`/`phaseAfter` chain is contiguous **and** that the stored phase equals the last row's `phaseAfter` — a phase that moved outside a recorded `enterPhase` breaks the chain. A third would prove restart survival by re-running the whole drive and seeing it end in the same place: that passes for a system that silently redid every dispatch. The check must assert the **dispatch count** is unchanged across the restart, which is a real side effect and not item de-duplication. The check must **not** assert on `decide`'s return value, on `deriveGate` called directly against a hand-built world, or on anything the driver's own unit tests already cover — those pass without a repo, a harness, or a branch.

**Model:** real — the coding harness resolved by discovery (the local `claude` CLI). Conductor's own tick makes **zero** model calls, which is what signal 4 asserts; the model spend is the dispatched phase doing the coding, which is the point. Not model-free: do not run this under `goal:all --model-free`.

**Run:** `pnpm tsx goals/conductor/drives-one-issue-to-a-merge-ready-branch/run.mts`

## What this needs before it can pass

**It fails today, for one honest reason: the tick does not exist.** Conductor ships the entity model, the pure driver (`decide`, `deriveGate`, `reconcile`), the GitHub world reader and poller, the dispatcher seam with a working `claudeCodeDispatcher`, branch policy and worktree provisioning, and — as of this goal — the config layer. Nothing assembles them into a tick, persists the ledger, or fronts it with a CLI. That is the remaining M1 work, and this goal is its definition of done.

The runner therefore does its preflight for real — it resolves the example's config, checks the repo and the harness, and reports what discovery found — and then fails with the list of what is missing rather than a stack trace.

**The contract the runner asserts** is declared at the top of `run.mts` as `ConductorRuntime`: `openConductor({ config, statePath })` returning a session with `manage`, `tick`, and `read`, each answering with the entity, its derived gate, its ledger rows, and its dispatch count. Every *type* in it is the conductor package's own; only the four method names are the goal's proposal. If M1 lands with different names, that declaration is the one thing to update — the assertions below it are about behaviour and do not care.

**Two seams this goal could not close, reported rather than papered over:**

- **The ledger cannot reproduce a transition, only prove none happened outside it.** `ledgerEntryStateSchema` records `signalKind`, `actionKind`, `phaseBefore`, `phaseAfter`, and `gate` — but not the signal's payload and not the world snapshot it was reduced against. So `decide(entity, signal, world)` cannot be re-run from a ledger row, and the invariant is checked structurally (signals 3 and 4) rather than by replay. Storing the signal payload on the row would make literal replay possible.
- **An issue's start phase is not derived from its type.** `ISSUE_PHASES` begins at `SPEC` for everything, and nothing reads `issueType`. This goal manages its item as a `Bug` starting at `IMPLEMENTATION`, which is the routing `docs/contributing/orchestration.md` describes (a bug skips the spec and enters at implementation) — but conductor does not do that routing itself, the caller does. It also has to: `SPEC`'s exit is a human approval gate, so a spec-first run cannot complete unattended, correctly.

## How it behaves on a real repository

**Pull requests are off by default.** The work item text tells the harness to push the branch and stop; the goal grades the branch. Set `CONDUCTOR_GOAL_OPEN_PR=1` and the item asks for a PR instead, and the check additionally asserts the PR is open and the derived gate is `awaiting_review` — the human gate conductor waits at and never releases itself. The default is off because this goal is meant to be re-runnable as a regression check, and a check that opens a pull request against the repository on every run trains everyone to ignore them. What it costs: the default run does not exercise the PR-hosted gates, and that is a real gap in coverage rather than a technicality, which is why the flag exists and why the flagged run is the one to use before believing the PR-feedback path.

Each run leaves one branch, `fix/GOAL-<stamp>`. It is deleted at the end of a passing run unless `CONDUCTOR_GOAL_KEEP_BRANCH=1` or a pull request was opened; a failing run always keeps it, so there is something to look at.

**Credentials.** Needs `GITHUB_TOKEN` or `GH_TOKEN` with push access, and a coding harness on `PATH`. Missing either is a *blocked* run, not a failure — the preflight says which one and stops.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-08-14 | (unbuilt) | n/a — never reached the harness | FAIL | Expected. Preflight resolved the example's level-1 config for real (repo, base branch, repo root, dispatcher all `discovered`), then failed on the missing tick: `@flow-state-dev/conductor` exports no `openConductor`. This is M1's remaining work, not a regression. |
