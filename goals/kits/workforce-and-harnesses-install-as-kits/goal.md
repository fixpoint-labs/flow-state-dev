# kits › workforce and the harnesses install as kits

**Issue:** FIX-2627
**Outcome:** An app installs workforce and the coding harnesses with one config object each, and gets every worker, the roster view, one coding worker flow and the readiness view, with no host wiring; no host or goal calls `hireWorkforce`, `createWorkerInstallation` or `readDeclaredRoster`, and every file in `workforce/` is used or refused.
**Input:** Teammates' and claude-code-style's own `workforce/` trees and hosts (`labs/teammates/host.mts`, `labs/claude-code-style/host.mts`), each served by `fsdev serve` over its own config with harness-manager's scripted harness under each harness id (`GOAL_HARNESS=stub`, `CLAUDE_CODE_STYLE_HARNESS=stub`) and no model key, so the judge reads nothing. Teammates' default harness is set to `cursor`, so a task that runs on Codex was routed by its worker's own `harness: codex` line.
**Signal:**
- `a:flows`: Teammates serves `agent`, `coder`, `harnesses` and `workforce-roster`, and no `teammates-coder` or `harness-readiness`.
- `a:roster`: the roster view, read by a user who has opened no session, lists `teammates.chief-of-staff` (Lead), and the read makes no session.
- `a:task`: a task filed from Lead's conversation through the board's `createTask` for `teammates.codex` runs in a session on `coder`, through the codex entry alone (`coder-codex-reviewed`, read off the run's items), and holds a review. Read after every request has settled.
- `a:readiness`: the `harnesses` flow's readiness view has one entry per harness filled: `claude-code`, `codex`, `cursor`.
- `b:start`: claude-code-style starts and its readiness view answers.
- `b:stray`: with `workforce/flows/notes.mts` planted, it does not start, and the refusal names the planted folder (`kit "workforce": "flows" is not used`: nothing else under `flows/` is claimed, so the claim pass names the topmost entry no reader used). The plant is removed afterwards.
- `b:census`: [the census](../../../specs/issues/FIX-2627/poc/claim-census/README.md) reads 0 unclaimed over a non-empty set of files.
- `c:callers`: [the callers count](../../../specs/issues/FIX-2627/poc/claim-census/README.md) reads 0 files outside workforce.
**Anti-game:** Assert on the flows the running labs serve, the task's run and the views' answers, never on a kit's install result or its unit tests. The harness id comes from the worker file, and the lab's default is another harness, so a routing that ignored `harness:` runs on Cursor and fails `a:task`. Every graded list is floored with `tell.over`.
**Model:** n/a (no model is called; the judge has no key and gives no verdict, which never fails a run)
**Run:** `pnpm tsx goals/kits/workforce-and-harnesses-install-as-kits/run.mts`
**Controls:** each patches `packages/engine/src/flowstate/kits.ts` as the labs load it (`goals/lib/module-patch`), so nothing is written to the checkout's code.
- `GOAL_CONTROL=drop-kit-fills`: the engine drops every kit's slot contribution, so `coder` is never registered and the codex worker is refused at hire. Must fail leg a (`a:start`); claude-code-style's coders are refused the same way (`b:start`).
- `GOAL_CONTROL=skip-unknown`: the claim pass reports nothing. Must fail `b:stray` only.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-13 | claude/fix-2627-impl (pre-push) | n/a | FAIL (c only) | a and b read as required: flows `agent, claude-code, coder, github-service, harnesses, lab-context, workforce-roster`; Lead on a fresh user's roster, 0 sessions; the codex task ran on `coder` through `coder-codex-reviewed` and holds a review; readiness `claude-code, codex, cursor`; claude-code-style starts, refuses the stray naming `flows`; census 228 files, 0 unclaimed. `c:callers` reads 120 (kitchen-sink, Shift Manager and 92 goal files still call the old functions): the stacked PRs that move them are not on this branch |
| 2026-11-13 | same | n/a | FAIL (expected) | `drop-kit-fills`: `a:start` "hireWorkforce: 3 standard worker problem(s)", `b:start` "names flow \"coder\", which is not in the worker flows" |
| 2026-11-13 | same | n/a | FAIL (expected) | `skip-unknown`: `b:stray` "claude-code-style started beside workforce/flows/notes.mts"; a and the other b legs read as on the clean run |
| 2026-11-13 | claude/fix-2627-impl-f | n/a | PASS | Every goal on the kit and the surface private: a (teammates, `coder-codex-reviewed`, readiness of 3), b (claude-code-style starts; the planted `flows/` refused by name; census 228 files, 0 unclaimed, the UI registry's starter sources not a root) and **c:callers 0**. |
| 2026-11-13 | claude/fix-2627-impl-f | n/a | FAIL (expected) | `drop-kit-fills`: `a:start` and `b:start` (`coder` not in the worker flows passed). `skip-unknown`: `b:stray` (started beside `workforce/flows/notes.mts`). |
