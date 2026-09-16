# workforce-seats › it answers from a worker file alone

**Issue:** FIX-1365 (the thin proof; acceptance criteria 1–3 of `docs/architecture/workforce-default-worker-kind.md`)

**Outcome:** Someone describes two workers in Markdown — a description and some instructions, nothing else, no `flow:` and no `model:` — points the app at the folder, and has two working workers. Each answers a question in the voice its own file gave it, and neither answers in its neighbour's. A worker file naming a kind nobody registered takes the whole roster down with it rather than hiring around the problem.

No flow is written, no kind is registered, and `hireWorkforce` is called with **no `kinds` argument at all** — so the only thing that could have answered is the built-in `agent` kind.

**Input:** `fixtures/workforce/` — two teams, one worker each, whose bodies carry the held-out tokens `HALYARD-6182` and `KESTREL-3390`. `fixtures/mixed-roster/` — one valid worker beside one naming `flow: reviewer`. `fixtures/input.json` holds the expected ids, descriptions, bodies and tokens, plus the one question both seats are asked. Held out: every id, body and token is read from the fixture and graded against what the seats actually replied; swapping them for another valid set must still pass a correct implementation. Each token appears in exactly one file on disk and nowhere in the question, so a reply can only carry the right one if that worker's file reached the model.

**Signal:** four legs, run against the real HTTP route over a real `createFlowState` host with a real model.

(0) **Fixture integrity, before a model call is spent.** Every `WORKER.md` is compared against `input.json` body-for-body and description-for-description, whole values rather than `includes`; each file is checked for its sibling's token and the question for either; and `mixed-roster/`'s two workers are checked to still declare the flow kinds `input.json` says, since a roster that is no longer mixed makes leg (c) green for some other reason. Separately, `harness.mts`'s source is read and every `hireWorkforce(` call site asserted to take exactly one argument — read statically, because a runtime report could only say what the harness chose to say, and anything beyond the roster can carry a kind under any name. A refactor of `harness.mts` must keep that call site readable by the scan — moving the hire behind a wrapper would leave leg 0 asserting nothing.

(a) **C1 — it hires from files alone.** `readWorkforce` over the tree, `hireWorkforce(workers)` with one argument, two seats back in id order, each addressable by its own worker id, both registered through the real registry.

(b) **C2 — the answer is steered by the file's body.** Both seats are asked the same question. Each reply must carry **its own** file's token and must **not** carry its sibling's. Graded on the assistant's reply text, never on `ctx.flow.config` — a sibling goal already proves the setting arrives, and that stays true even if the model never sees it.

(c) **C3 — an unregistered kind refuses, and nothing on the roster hires.** A **mixed** roster: one valid worker plus one naming `flow: reviewer`. Graded in order — the call threw *rather than returned* (the load-bearing assertion), the message names the worker, `reviewer` and `agent`, and the valid worker's address 404s on a host built from what came back.

**Anti-game:** A hollow pass would assert that two seats hired and two non-empty replies came back — true even when the body never reaches the model at all, which is exactly what the first control produces. So the check MUST grade the **reply text**, not the settings bag; MUST grade the two seats as a **pair**, each carrying its own token and not its sibling's, because one shared prompt is always right for somebody; MUST use tokens that live in exactly one file each and nowhere in the question, so the only route to a token is that file; MUST assert the hire passes **no `kinds`**, since hiring a flow the test supplied proves nothing about the built-in; and MUST grade the refusal on a **mixed** roster, asserting the call threw rather than returned — on a single-bad-record roster "nothing hired" is true for reasons unrelated to atomicity, and the 404 merely restates the throw.

The controls below are the other half of this. A control has to fail **at the leg it controls**: editing the fixture bodies would die at leg 0's integrity check and prove only that the checksum works, so every control perturbs the **harness** instead and leaves the fixture tree untouched.

**Model:** `openai/gpt-5.4-mini` (gateway-qualified; `GOAL_MODEL` overrides). Two model calls on the passing path — one question per seat — retried inside a single harness execution only while the model is flaky, since a clean pair ends the loop. Around sixteen to run the full verification, because a control that can never produce a clean pair spends every attempt.

**Run:** `pnpm tsx goals/workforce-seats/the-built-in-kind-answers-from-a-file-alone/run.mts`

**Controls:** `GOAL_CONTROL=withhold-instructions|cross-wire|partial-hire` on the same command. Each must FAIL, and the failure must name the grading assertion rather than leg 0.

> **On where the answer attempts live.** They run inside one harness execution, not as a retry loop in `run.mts`. `runHarness` shells out with `execFileSync`, so every call is a fresh child process — a caller-side retry would re-run loading, hiring and registration on each attempt, re-running the mechanism under test and letting a transient fault in it be retried away as model flakiness. The harness hires once and repeats only the question; load, hire and registration failures are returned as themselves and never retried.

> **On the org id.** The built-in kind's skills collection is org-scoped, so a request carrying only a `userId` fails with `Resource "skills" is not registered` before the model is reached. The harness sends an `orgId`. This is a property of the kind, not of this check.

## Verdict log

| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-16 | fix/FIX-1365-thin-proof-hire (pre-PR) | openai/gpt-5.4-mini | PASS | Two worker files carrying only a description and a body hired with no `kinds` argument and both registered. Asked the same question, `engineering.desk` replied *"I'm the AI engineering desk for this small software company. HALYARD-6182"* and `marketing.desk` replied *"I'm the marketing desk at a small software company. KESTREL-3390"* — each carrying its own token and neither its sibling's, on attempt 1 of 3. The mixed roster refused by name, listed `agent` among the kinds available, returned nothing, and left the valid worker's address a 404. |
| 2026-09-16 | fix/FIX-1365-thin-proof-hire (control: `withhold-instructions`) | openai/gpt-5.4-mini | FAIL (expected) | Named **leg (b)**, not leg 0: *"engineering.desk did not carry its own token HALYARD-6182"*. With the body withheld at the mint both seats answered as a generic assistant — *"I'm ChatGPT, an AI assistant from OpenAI… I don't actually have a physical desk"* — and neither token appeared. This is the control that proves the tokens come from the worker file rather than from the question, the default prompt or the harness. |
| 2026-09-16 | fix/FIX-1365-thin-proof-hire (control: `cross-wire`) | openai/gpt-5.4-mini | FAIL (expected) | Named **leg (b)**: *"engineering.desk carried marketing.desk's token KESTREL-3390"*, and the mirror for the other seat. With each seat handed its sibling's body, `engineering.desk` answered *"I'm your marketing desk assistant… KESTREL-3390"*. Proves the pair grading is sensitive to which body reached which seat — the failure one shared prompt would otherwise satisfy. |
| 2026-09-16 | fix/FIX-1365-thin-proof-hire (control: `partial-hire`) | n/a (model-free leg) | FAIL (expected) | Named **leg (c)** on both assertions: *"the hire returned ["engineering.desk"] instead of refusing"* and *"the valid worker engineering.desk answered 202 on a host built from what came back — a seat was registered anyway"*. Admitting the valid record from the mixed roster turns the leg red, which is what makes it a test of all-or-nothing admission rather than of the throw. It also shows the 404 assertion is load-bearing **because** the roster is mixed: with a valid record in play it moved to 202. |
