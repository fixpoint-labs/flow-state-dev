# shift-manager › it opens on FSD and Shift Manager

**Issue:** FIX-1904 (epic FIX-1903)
**Note:** Slice 2 makes the `fsd` profile the no-flag default of `pnpm shift-manager:dev`; until then the legs pass `--config`.
**Outcome:** On a fresh open of `pnpm shift-manager:dev --config packages/shift-manager/teams/devteam/fsd.fsdev.config.mts`, a person sees exactly FSD and Shift Manager, and an item they ask for on either one is worked by Claude Code in a worktree of their checkout. With no Claude credential the Lab refuses to start and says what to set.
**Input:** A fresh store (a temp file) per leg, and the checkout's own script with `--config` naming the `fsd` profile. Leg b (not built yet) takes a stamp picked at run time in each item's text, with the checkout on a branch other than `main`.
**Signal:**
- **a** — through the Lab's routes, as the page's user: the organization's projects are exactly `fsd` and `shift-manager`, each naming `https://github.com/fixpoint-labs/flow-state-dev.git`; the user holds no private project; FSD's brief names `packages/` and not Shift Manager's folder, Shift Manager's names `packages/shift-manager`; the start line names Claude Code.
- **b** — both rows settle `completed`; `git worktree list` in the checkout names both places; each branch descends from `main` and commits the file the item asked for, and no `SCRIPTED-RUN.md`. **Not built in this build:** it needs the checkout mapping, so the leg reports `b:not-built` and the goal cannot pass whole until it lands.
- **c** — with no `ANTHROPIC_API_KEY`, no `CLAUDE_CODE_OAUTH_TOKEN` and an empty home, as `start` runs it and as `dev` (`--dev`) runs it, the process exits non-zero before it listens, and its output names `ANTHROPIC_API_KEY` and `DEVFORCE_LAB_HARNESS=stub`.
**Anti-game:** No assertion on the profile file or a mocked harness or probe: the projects are read through the routes a page reads, and leg c's refusal is Claude Code's own answer through the installed Agent SDK. The check sets only the store location, and in c takes credentials away. "Exits before listening" is graded on the process (no banner, a non-zero exit), not on a message alone.
**Model:** n/a for legs a and c (no model turn; a needs a Claude credential to start, since the default coder checks for one). Leg b: real, the chief of staff's model and Claude Code.
**Run:** `pnpm tsx goals/shift-manager/it-opens-on-fsd-and-shift-manager/run.mts` (`GOAL_LEG=a,c` for the legs this build has)
**Controls:**
- `GOAL_CONTROL=silent-stub` — `harness.mts` is patched in the process under test (never in the checkout) to fall back to the scripted coder when there is no account, saying nothing. Leg c must FAIL on `c:exit-before-listening`, in both forms.
- `GOAL_CONTROL=no-checkout` — with the checkout mapping. Leg b must FAIL on `git worktree list` naming both places, with the run refused by name and nothing cloned. Comes with leg b.
- DevTeam's profile in place of `fsd`'s: leg a must FAIL on `a:exactly-fsd-and-shift-manager`. Run by hand, with `run.mts`'s `--config` pointed at `teams/devteam/fsdev.config.mts`.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-12 | working tree on 588b2c8e9 | n/a | FAIL (control) | `GOAL_LEG=c GOAL_CONTROL=silent-stub`: `c:exit-before-listening` and `c:names-the-variable`, as `start` and as `dev` (each listened). The patch reached `harness.mts` both times |
| 2026-10-12 | working tree on 588b2c8e9 | n/a | FAIL (control) | `GOAL_LEG=a` with `checkout.mts` defaulting to DevTeam, as on `main`: `a:exactly-fsd-and-shift-manager` (platform, sandbox, storefront), `a:names-this-repository`, `a:briefs-name-their-focus`, `a:start-line-names-the-coder` |
| 2026-10-12 | working tree on 588b2c8e9 | n/a | PASS | `GOAL_LEG=c`: `start` and `dev` each exited 3 before listening; "Claude Code found no API key and no sign-in … set ANTHROPIC_API_KEY … DEVFORCE_LAB_HARNESS=stub" |
| 2026-10-12 | working tree on 588b2c8e9 | n/a | PASS | `GOAL_LEG=a` with an `ANTHROPIC_API_KEY`: shared `fsd`, `shift-manager` on this repository, none private; "Coder: Claude Code, on the credential from ANTHROPIC_API_KEY." |
| 2026-10-12 | working tree on 9f9b0bba8 | n/a | FAIL (control) | `GOAL_LEG=c GOAL_CONTROL=silent-stub` with `--config` naming `fsd`: `c:exit-before-listening` and `c:names-the-variable`, as `start` and as `dev` (each listened) |
| 2026-10-12 | working tree on 9f9b0bba8 | n/a | PASS | `GOAL_LEG=c` with `--config` naming `fsd`: `start` and `dev` each exited 3 before listening, naming `ANTHROPIC_API_KEY` and `DEVFORCE_LAB_HARNESS=stub`. Leg a not re-run: no Claude credential here |
