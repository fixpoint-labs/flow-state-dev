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
- **Verdict log** — a table, one row per run: date, commit, model, verdict, notes. This is what makes the goal a regression record. Append; don't overwrite.

## Script techniques

What separates a goal check from a dressed-up unit test:

1. **Assert on the user-visible surface, not the implementation.** Check the emitted items / `useSession` view / the returned answer / a real side effect — not the output of the internal function that produced them. A check that asserts on `collapseToCanonicalLog()`'s return value can pass while the rendered stream double-fires; a check that asserts on what `useSession` shows cannot.
2. **Grade against the input.** Pull the concrete facts out of the fixture and assert they survived into the output. This is what catches "the pattern ran but dropped the data." Parameterize so swapping the fixture still works — that's the held-out guarantee in code.
3. **Use a real side effect for "exactly once" claims.** To prove a step didn't re-run, increment a real counter (a state value, a row, a file) and assert the count — not item de-duplication, which can hide a double-fire.
4. **Drive the real path.** Default is `runFsdev({ app, flow, action, input, capture })` (it runs from the app dir — config search is cwd-only). The capture file is `{ command, events, result }`; `readCapture(path)` parses it. Read it carefully — `_template/run.mts` shows the pattern:
   - **Take the latest snapshot of each item, not the first.** Streamed assistant text lands in later snapshots (`content.delta` is checkpointed into item snapshots, not the persisted event log), so the first `item_added` is often empty. `readCapture` reduces by `item.id` keeping the last — use it rather than filtering `item_added` yourself, which is the bug it exists to prevent.
   - **Assert on terminal/public output**, not trace internals. The action's final output and success flag are on `result`; worker/block execution items are `type: "block_trace"` with an internal `BlockValueInternal` value — don't unwrap those, prefer `result.output` or the public item that carries the value.
   - For non-flow goals, call the public API directly. Mock only true third-party services (payment, email) you genuinely can't call.
5. **Print an explicit verdict.** `runGoal` does this: return `{ failures, evidence }` and it prints `PASS — <evidence>` (exit 0) or `FAIL —` with a bulleted list (exit 1), so a later reader (or agent) knows the result without re-deriving the criteria.

## The shared library (`goals/lib`)

Every goal repeats the same scaffolding around the part that is actually its own. That scaffolding lives in `goals/lib` — import it as `../../lib/index.mts`:

| Module       | What it covers |
| ------------ | -------------- |
| `verdict`    | `runGoal` / `pass` / `fail` — the one PASS/FAIL format and exit protocol |
| `fixture`    | `loadFixture(import.meta.url, "x.json")`, `fixturePath`, `fixtureDir` |
| `env`        | `intentFreeEnv` / `stripIntentOverrides` / `captureIntentOverrides` — the **prefix** strip of `FSDEV_INTENT_*` + `FSDEV_DEFAULT_MODEL` |
| `paths`      | `KITCHEN_SINK` / `TRADING_DESK` / `HELLO_CHAT` (repo-anchored, not `../../../`), `goalTmpDir`, `goalSessionId` |
| `capture`    | `runFsdev`, `readCapture` (latest snapshot per id), `messageText`, `assistantText`, `answerText`, `actualModel` |
| `driver`     | `runHarness` — run a sibling `harness.mts` inside an app |
| `durable`    | `durableStores`, `registryFor`, `approvePending`, `approvalContext`, `silentLogger` |
| `model`      | `DEFAULT_MODEL`, `gatewayModel`, `goalModel`, `goalAttempts` |
| `specs`      | `runSpecs` — delegate to an app's mock-free vitest specs |

The library covers scaffolding only. **The grading logic is the goal** and belongs in `run.mts`. So does retry *policy* — the corpus has three, and they mean different things (retry-until-first-pass over model flakiness vs. require-k-of-k where the stability number is itself the published result).

**Model ids.** `DEFAULT_MODEL` is the portable id (`openai/gpt-5.4-mini`), for when an app's configured resolver applies its own gateway. `gatewayModel()` qualifies it (`vercel/…`) for a goal that builds its own resolver and must name the gateway. `goalModel()` lets `GOAL_MODEL` override either. A goal pinned to a specific model to reproduce a bug names it literally and says why.

### Harnesses

Some goals need code that resolves both an app's `@/*` aliases and its `@flow-state-dev/*` / `@ai-sdk/*` node_modules — which only holds for a file executed with that app as cwd. Those goals ship a sibling `harness.mts` that *drives* the real path and reports raw observations on one `__GOAL__<json>` line; `run.mts` owns the grading. `runHarness` copies it into the app under a transient name and runs it there.

Two constraints worth knowing:

- A harness is **not typechecked** by `goals/tsconfig.json` — its imports resolve against the app, not against `goals/`. It's excluded rather than typechecked against the wrong project.
- It runs as a **real file**, not `tsx -e`. `tsx -e` compiles to CJS, so top-level await anywhere in the import graph is a hard error — and kitchen-sink's `flowstate` chain has one.

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

Keep the **Model** field present and machine-readable (`**Model:** …` or `**Model.** …`) — `goal:all` reads it to decide what a `--model-free` sweep may run. `n/a` and `none` both mean model-free.

Reach for a new `goals/lib` helper only when a *third* goal needs the same scaffolding. Two copies is not yet a pattern; the library is for what every goal repeats, not for anything that could be shared.
