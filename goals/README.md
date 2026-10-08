# Goals

A goal is the real-world outcome a piece of work was meant to achieve, plus a runnable check that proves we got there. This directory is the library of them.

Goals are **not** CI specs. CI specs (`*.spec.ts`) mock the LLM and run on every push; they prove the units still behave. A goal check exercises the **real path** — on a **real model** when the goal is model-backed, or with no model at all when it isn't (see model-free goals below) — runs **outside CI**, and is run **by hand** (by you or an agent) to confirm the feature actually works the way a user would experience it. A mocked spec can pass while the feature does nothing useful, because the mock fed the assertion the answer it wanted. The goal check removes that crutch.

See `tdd` → "Two kinds of test" for where this sits in the workflow.

## Why a library

Goals accumulate. A goal written for one PR is a **regression check** a year later — re-run it and compare against its verdict log. Keeping them together in one place (rather than scattered per-package) makes them browsable and sweepable, and reflects what they are: outcome-oriented, often spanning several packages.

## Layout — a `describe` / `it` hierarchy

Goals are named like behavioural specs. Two levels, both kebab-case:

- **`describe`** — the feature or subject under test (`plan-and-execute`, `crash-recovery`, `suspension`). The first folder level.
- **`it`** — the behaviour this goal proves, phrased to complete the sentence "it …" (`carries-original-data-to-workers`, `continues-under-same-request-id`, `does-not-retry-loop`). The second folder level, and the goal itself.

The issue number is **not** in the folder name — it ages out as a discovery key, and the point of the name is that someone looking for a goal to reuse can find it by what it proves. The issue lives in `goal.md`.

```
goals/
  plan-and-execute/                      # describe: the subject
    carries-original-data-to-workers/    # it: the behaviour — this is the goal
      goal.md            # the spec + verdict log — the contract
      run.mts            # the runnable check (real model)
      fixtures/          # held-out inputs, seed corpora, expected snapshots
  crash-recovery/
    continues-under-same-request-id/
      ...
  _template/             # copy this to start a new goal
```

- **`goal.md`** is the contract. Tooling can glob `goals/*/*/goal.md`.
- **`run.mts`** is the executable form of it. It lives outside any package's vitest root, so CI never runs it — that's the point. Run it with `pnpm tsx goals/<describe>/<it>/run.mts`.
- **`fixtures/`** holds the inputs and any expected snapshots.
- A `describe` with many behaviours may nest a further level if it genuinely helps grouping; default to two.

## The `goal.md` format

A title (`<describe> › it <behaviour>`), then the fields, then a verdict log. Copy `_template/goal.md`.

- **Issue** — the tracking issue (e.g. `FIX-827`), or omit if there isn't one. This is where the issue number lives, not the folder name.
- **Outcome** — the real-world effect, in the user's terms. Not "added a block" — the thing a user would notice. If you can't phrase it as something observable, you don't have a goal yet.
- **Input** — the fixture. State that it is **held-out**: swapping it for a different valid input must still pass a correct implementation. If the assertion only works for this exact input, it's hardcoded.
- **Signal** — the observable pass/fail, with a threshold. An item emitted, a state value written, a return value, a side effect. Checkable without reading the model's mind.
- **Anti-game** (required) — what a hollow pass would look like, and what the check must therefore **not** assert on. If you can't name a way to fake it, the goal is mechanism-shaped, not outcome-shaped — rework it. This is the most important field.
- **Model** — for a model-backed goal, the real model id (never a mock); use `openai/gpt-5.4-mini` unless the goal needs a stronger one. For a **model-free** goal (real path, no LLM — e.g. suspend/resume, CRUD persistence), state `n/a` (or `none`) here — that is a valid, well-formed goal, not a malformed one, and it needs no model credential.
- **Run** — the exact command.
- **Controls** — any `GOAL_CONTROL=<name>` runs this goal understands, and the assertions each must fail, by name. Omit if the goal has none.
- **Verdict log** — a table, one row per run: date, commit, model, verdict, notes. This is what makes the goal a regression record. Append; don't overwrite.

## Script techniques

What separates a goal check from a dressed-up unit test:

1. **Assert on the user-visible surface, not the implementation.** Check the emitted items / `useSession` view / a real side effect / the returned answer (only when the claim is about what the model does) — not the output of the internal function that produced them. A check that asserts on `collapseToCanonicalLog()`'s return value can pass while the rendered stream double-fires; a check that asserts on what `useSession` shows cannot. When the claim is about data the system holds or a tool returns, grade the tool's output item for a read, or the stored row for a claim that the run wrote or changed something, not the model's retelling of it (a row that existed before the run proves nothing about a read). A retelling that fails is a lead, not a verdict, and prompting the model to recite never turns it green.
2. **Grade against the input.** Pull the concrete facts out of the fixture and assert they survived into the output. This is what catches "the pattern ran but dropped the data." Parameterize so swapping the fixture still works — that's the held-out guarantee in code. The prompt names every input the claim isn't about (the kind, the id, the target), so a correct model's clarifying question can't read as a failure.
3. **Use a real side effect for "exactly once" claims.** To prove a step didn't re-run, increment a real counter (a state value, a row, a file) and assert the count — not item de-duplication, which can hide a double-fire.
4. **Drive the real path.** Default is `runFsdev({ app, flow, action, input, capture })` (it runs from the app dir — config search is cwd-only). The capture file is `{ command, events, result }`; `readCapture(path)` parses it. Read it carefully — `_template/run.mts` shows the pattern:
   - **Take the latest snapshot of each item, not the first.** Streamed assistant text lands in later snapshots (`content.delta` is checkpointed into item snapshots, not the persisted event log), so the first `item_added` is often empty. `readCapture` reduces by `item.id` keeping the last — use it rather than filtering `item_added` yourself, which is the bug it exists to prevent.
   - **Assert on terminal/public output**, not trace internals. The action's final output and success flag are on `result`; worker/block execution items are `type: "block_trace"` with an internal `BlockValueInternal` value — don't unwrap those, prefer `result.output` or the public item that carries the value.
   - For non-flow goals, call the public API directly. Mock only true third-party services (payment, email) you genuinely can't call.
5. **Print an explicit verdict.** `runGoal` does this: return `{ failures, evidence }` and it prints `PASS — <evidence>` (exit 0) or `FAIL —` with a bulleted list (exit 1), so a later reader (or agent) knows the result without re-deriving the criteria.

## Proving a check can fail

[BP-003](../docs/contributing/best-practices.md) says a check you cannot make fail has verified nothing. **Anti-game** names the hollow pass; this is how a goal produces it.

Checks that cannot fail are the common case, not the rare one. A leg asserting `!== null` on a row written at *file* time passes before the worker ever runs. A leg that mounts a component with nothing expanded never exercises the read it exists for. Both look like coverage.

**Prefer a named control over an ad-hoc mutation.** A control is a flag the run already understands, so the red state is reproducible by anyone, on any checkout, without touching the tree:

```bash
GOAL_CONTROL=by-name pnpm tsx goals/mailbox-boards/it-runs-a-row-a-file-declared-board-holds/run.mts
```

`run.mts` reads `process.env.GOAL_CONTROL` and passes it to the harness, which degrades the one behaviour the control names. Declare each one in `goal.md` under **Controls**, with the assertions it must fail, by name (`a:working`, not leg a) — a leg goes red on any of its assertions, so a control that fails the wrong one is itself a check that cannot fail. Record the run in the **Verdict log** as a `FAIL (expected)` row with what it printed.

**When no control fits, mutate the code — and snapshot first.** `git restore -- <path>` on the one file you touched, never `git restore .` or `git checkout -- .`. The trap is a fix and a mutation living in the same uncommitted file: the revert looks successful, keeps the tree green, and throws the fix away. A commit is the easiest snapshot, but some workflows hold the first commit until a human approves the change — `git stash create` gives you a dangling snapshot commit without touching the tree or the shared stash stack, and copying the file aside works too. Snapshot, mutate, revert the one file, restore.

**Say when a leg has no isolating red state** — when the mutation that fails it also fails a neighbour. Put it in the **Verdict log** notes or **Anti-game**, so the next reader reads the co-failure as a known property rather than a leak.

## The shared library (`goals/lib`)

Every goal repeats the same scaffolding around the part that is actually its own. That scaffolding lives in `goals/lib` — import it as `../../lib/index.mts`:

| Module       | What it covers |
| ------------ | -------------- |
| `verdict`    | `runGoal` / `pass` / `fail` — the one PASS/FAIL format and exit protocol |
| `fixture`    | `loadFixture(import.meta.url, "x.json")`, `fixturePath`, `fixtureDir` |
| `env`        | `intentFreeEnv` / `stripIntentOverrides` / `captureIntentOverrides` — the **prefix** strip of `FSDEV_INTENT_*` + `FSDEV_DEFAULT_MODEL` |
| `paths`      | `KITCHEN_SINK` / `HELLO_CHAT` (repo-anchored, not `../../../`), `goalTmpDir`, `goalSessionId` |
| `capture`    | `runFsdev` (input goes by `--input-file`, so quotes, apostrophes and newlines in fixtures are fine; `pnpm --filter @flow-state-dev/goals check:run-fsdev-input` guards it), `readCapture` (latest snapshot per id), `messageText`, `assistantText`, `answerText`, `actualModel` |
| `driver`     | `runHarness` — run a sibling `harness.mts` inside an app |
| `durable`    | `durableStores`, `registryFor`, `approvePending`, `approvalContext`, `silentLogger` |
| `model`      | `DEFAULT_MODEL`, `gatewayModel`, `goalModel`, `goalAttempts` |
| `specs`      | `runSpecs` — delegate to an app's mock-free vitest specs |
| `server`     | `refuseIfAnswering`, `stopProcessGroup` — for a goal that spawns its own server: refuse when anything already answers on the port, and stop the whole detached process group so no survivor is left for the next run to grade |
| `playwright` | `launchChromium`, `preinstalledChromium` — Chromium for a goal that reads the shipped DevTool. **Not re-exported from `index.mts`**, so a goal that opens no browser does not load Playwright; import `../../lib/playwright.mts` directly |
| `shift-manager` | `buildShiftManagerCopy` (a patched scratch copy, built with Vite), `startShiftManager` (its command over a Lab, with `NODE_ENV` as it was before any in-process build; optional `root`, `tsx` and `timeoutMs` to serve another checkout, including an older one that has only `bin/start.mts`), `labApi` (the Lab's routes) — for the Shift Manager goals; and, for a goal that drives Shift Manager as a person in Playwright, `buildShiftManagerPages`, `labRoutes` (`labApi` read as one verified user) and `personPage` (a browser context as a given person). **Not re-exported from `index.mts`**; import `../../lib/shift-manager.mts` directly |

The library covers scaffolding only. **The grading logic is the goal** and belongs in `run.mts`. So does retry *policy* — the corpus has three, and they mean different things (retry-until-first-pass over model flakiness vs. require-k-of-k where the stability number is itself the published result).

**Model ids.** `DEFAULT_MODEL` is the portable id (`openai/gpt-5.4-mini`), for when an app's configured resolver applies its own gateway. `gatewayModel()` qualifies it (`vercel/…`) for a goal that builds its own resolver and must name the gateway. `goalModel()` lets `GOAL_MODEL` override either. A goal pinned to a specific model to reproduce a bug names it literally and says why.

### Harnesses

Some goals need code that resolves both an app's `@/*` aliases and its `@flow-state-dev/*` / `@ai-sdk/*` node_modules — which only holds for a file executed with that app as cwd. Those goals ship a sibling `harness.mts` that *drives* the real path and reports raw observations on one `__GOAL__<json>` line; `run.mts` owns the grading. `runHarness` copies it into the app under a transient name and runs it there.

Two constraints worth knowing:

- A harness is **not typechecked** by `goals/tsconfig.json` — its imports resolve against the app, not against `goals/`. It's excluded rather than typechecked against the wrong project.
- It runs as a **real file**, not `tsx -e`. `tsx -e` compiles to CJS, so top-level await anywhere in the import graph is a hard error — and kitchen-sink's `flowstate` chain has one.
- It **cannot import `goals/lib`**. The copy runs from the app's root, so a relative path back here does not resolve, and making `@flow-state-dev/goals` a dependency of the app to fix that would couple the app to its own test corpus. A harness that needs a `goals/lib` helper copies it in.

## Running

```bash
# one goal
pnpm tsx goals/<describe>/<it>/run.mts

# every goal (sequential — real inference, shared apps, readable output)
pnpm goal:all

# only the goals that cost nothing
pnpm goal:all --model-free

# filter by path, or see what would run
pnpm goal:all suspension
pnpm goal:all --list
```

`goal:all` reads each `goal.md`'s **Model** field to tell model-free from model-backed, prints a per-goal PASS/FAIL summary, lists any goal that has a `goal.md` but no `run.mts`, and exits non-zero if anything failed.

**Typecheck.** `goals/` is a workspace package with a `typecheck` script, so `pnpm typecheck` at the root covers every `run.mts` and the library.

A model-backed goal check costs real model calls, and that cost is the point — a goal proves the feature works for real, the way a mocked spec cannot. Run one when you need that proof: finishing a feature, or re-checking for a regression. Not on every change, and never in the red-green inner loop (the mocked CI specs drive development there). But at feature completion, running the goal is **required verification, not optional** — don't skip, defer, or push back on it to save credits; the spend is expected and authorized. They do not gate CI. (Some goals are intentionally **model-free** — their `goal.md` says `Model: n/a`, and they prove the real path with no model call, so they cost nothing and the credit/credential guidance below simply doesn't apply. Just run the `run.mts`.)

**Credentials.** A **model-backed** goal check needs a model credential with **inference** access — normally **already present in the environment** as `AI_GATEWAY_API_KEY` (Vercel AI Gateway) or a provider key the app's model resolver uses. **Check for it and run — don't assume it's absent.** (A model-free goal needs none — run its real path directly.) The credential being set is not quite proof, though: a gateway key can authenticate for *listing* models yet be rejected for *inference* (a 401 from `/v1/chat/completions`), so the run has to actually generate. If actually running the goal fails for lack of a working inference credential — a 401 on inference, or `fsdev run` erroring with `No provider available for "<provider>"` when no provider key is configured, or any unresolvable-credential error you hit *after* attempting the run, not a preemptive guess that it's absent — record the goal as **blocked** and surface it; don't silently skip it. (Some managed/CI containers carry only a listing-scope credential.)

## Adding a goal

1. Copy `_template/` to `goals/<describe>/<it>/` — `<describe>` is the feature, `<it>` completes "it …".
2. Fill in `goal.md` — set the title to `<describe> › it <behaviour>`, and write **Anti-game** first; if you can't, stop and reshape the goal.
3. Write `run.mts` against the real path, using `goals/lib` for the scaffolding; put inputs in `fixtures/`.
4. Run it, and record the result as the first row of the verdict log.

Keep the **Model** field present and machine-readable (`**Model:** …` or `**Model.** …`) — `goal:all` reads it to decide what a `--model-free` sweep may run. `n/a` and `none` both mean model-free. A model-backed goal whose legs split can add `**Model-free run:** `NAME=value`` naming the env that runs only its model-free legs; a `--model-free` sweep then runs it with that env instead of skipping it.

Reach for a new `goals/lib` helper only when a *third* goal needs the same scaffolding. Two copies is not yet a pattern; the library is for what every goal repeats, not for anything that could be shared.

## Retired

A goal is retired when the rule it proved no longer exists, and the line says which rule replaced it. Its history stays in git.

Retired by FIX-1788, when workers became data on one copy per worker flow. Hiring writes a row in the hiring user's own scope and registers nothing, so there is no hired seat to pin, reload, repair or list:

- `hire-plane/discover-survives-an-unaddressable-row`: nothing stored becomes a seat. The org's listing is the standard workers the files declare, and a user's roster lists their own workers beside them (FIX-1788 BR-9, BR-26).
- `hire-plane/keeps-a-hired-seat-with-its-owner`: a user's workers are rows in their own scope; another user's worker answers as one that doesn't exist, and their sessions stay theirs (BR-5, BR-11, BR-17), proven by `workers-as-resources/keeps-each-users-workers-their-own` leg b.
- `hire-plane/keeps-a-private-team-in-the-org-it-was-built-in`: the same, per organization; what a worker saves at user scope is its user's (BR-5, BR-23, BR-25), proven by `workers-as-resources/keeps-each-users-workers-their-own` legs a and b.
- `hire-plane/keeps-the-debug-listing-on-the-hire-plane`: there is no org roster of hires to list; a user's roster is in their own user scope (BR-1, BR-5).
- `hire-plane/reload-survives-an-unaddressable-row`: nothing is reloaded at boot; each turn reads its worker's row (BR-1, BR-20).
- `hire-plane/repairs-a-seat-whose-kind-was-cut`: a worker whose flow is gone refuses its turn, naming it, and an `edit` fixes it for the next turn (BR-19a, BR-20, BR-22).
- `seat-hire/refuses-an-unpinned-register`: no hire registers anything (BR-1, BR-26). Owner pins are still an engine mechanism until FIX-1798, proven by `hire-plane/refuses-a-board-drain-onto-a-seat-it-is-outside`.
- `org-seats/cos-changes-the-roster`: a chief of staff's hire and fire write the roster of the person it talks to (BR-1, BR-7, BR-8), and a roster lists that person's own workers beside the standard ones (BR-9).
- `mailbox-boards/it-hands-a-task-to-a-fresh-hire`: a task on a board names a standard worker, and its session is opened naming that worker (BR-18). A user's own worker isn't handed board tasks.
- `workforce-seats/two-seats-run-their-own-configuration`: a worker is no copy addressable by its own id; each flow is registered once and a session names its worker (BR-26). That each worker's turn runs on its own record's settings and none of its sibling's is proven by `workforce-seats/a-callers-own-agent-wins-every-seat` (b) and `workforce-seats/a-non-agent-seat-receives-its-skills` (b) and (c), and the admission control pair by the latter's (d) and (e).
- `workforce-conventions/durable-hire-survives-redeploy`: a hire is a row every turn reads, on any process, so there is nothing to restore after a redeploy (BR-1, BR-20), proven by `workers-as-resources/keeps-each-users-workers-their-own` leg a's second host.
