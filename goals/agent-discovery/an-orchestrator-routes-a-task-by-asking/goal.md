# agent-discovery › it routes a task by asking who is around

**Issue:** FIX-817 (the scoped discovery door; PR-2 adds the skills, seats and channels domains and the seat's `discover:` key)

**Outcome:** An orchestrator seat is handed a task and a workforce it did not author. Its system prompt names nobody — no roster, no seat ids, no descriptions. It calls one tool, reads back a short list of what is in scope for it right now, and assigns the task to the seat whose stated purpose answers it. This is the thing the whole issue exists for: before it, a planner either had the roster pasted into its prompt at boot or could not plan at all.

**Input:** `fixtures/input.json` — five seats with opaque ids and one-line purposes, the task, the seat whose purpose answers it, and the coordinator's own instructions. Held-out: every id, purpose and the task are read from the fixture and graded against what the model actually assigned; swapping them for another valid set must still pass a correct implementation. Three properties of the fixture are **checked in code** before a model is spent, because each one, if it drifted, would turn the control into a coin flip wearing a verdict:

1. No seat id appears in the task or in the coordinator's instructions.
2. The expected seat does **not** sort first. The door returns entries sorted by id, and a model with no signal reaches for the first one.
3. There are at least five seats, so a no-signal hit is 1 in 5 rather than 1 in 3.

**Signal:** the real path — `hireWorkforce` mints the coordinator from a record, `runAction` runs its own turn against a real model through the real engine, and `discover` is the tool the capability contributed to that seat's generator.

(a) The coordinator calls `assign` exactly once, with the id of the seat whose purpose answers the task. `assign` is a real handler recording a real side effect, not a parse of the model's prose.
(b) The coordinator's own prompt is asserted to contain none of the seat ids, so a run where the roster had leaked in would fail rather than pass for the wrong reason.
(c) **Control** — the identical run with every seat's `description` blanked. It must not reach the expected seat. One run, no retry: retrying the control would be fishing for the miss that makes it pass.

**Anti-game:** a hollow pass would assert that the turn completed and that `discover` returned five entries — true even when the model picked a seat at random, and true even when the door returned nothing useful. So the check MUST grade the id the model actually assigned rather than the entries the door returned; MUST use **opaque** seat ids (`sigma.two`, not `engineering.reviewer`), since a semantic id routes the task with the purposes gone and the control would then pass for the wrong reason; MUST place the answer somewhere other than first in the door's own sort order, since "picked the first entry" is indistinguishable from "routed on purpose" when the answer is first; and MUST run the blanked-purpose control, since a live run alone is consistent with the model guessing. The live run is retried up to `GOAL_ATTEMPTS` (default 3) because model judgment is probabilistic — the retry is of the model's call, never of the mechanism.

**Where the inventory rows come from.** The seat rows are written through the real `defineSeatInventoryCollection()` by a real action on a second flow in the same org, rather than by `openInventory`'s boot binder. The binder's own journey is FIX-1405's goal and is proved there; what this goal grades is that a row plus a declaration reaches a model as something it can route on. The collection, its storage keys and its org scoping are the real ones — that is what makes the rows readable by the coordinator at all.

**Model:** `openai/gpt-5.4-mini` (the corpus default, via `DEFAULT_MODEL`). Override with `GOAL_MODEL`.

**Run:** `pnpm tsx goals/agent-discovery/an-orchestrator-routes-a-task-by-asking/run.mts`

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-21 | fix/FIX-817-PR-2 (pre-PR) | openai/gpt-5.4-mini | PASS | Live: the coordinator assigned `sigma.two` from a prompt naming no seat — it called `discover`, read five opaque ids, and routed on the purpose line. Control with every purpose blanked landed on `sigma.one`. Re-run twice more: live `sigma.two` both times; control `sigma.one`, then `delta.one`. The control moving around between runs is itself the evidence that nothing but the purpose line was carrying the decision. |
| 2026-09-21 | fix/FIX-817-PR-2 (control run, three seats with the answer sorted first) | openai/gpt-5.4-mini | FAIL (expected) | The first version of this fixture had three seats and put the answer (`delta.one`) first in id order. The live run passed and **the control also routed to `delta.one`** — `CONTROL FAILED: with every purpose blanked the coordinator still reached "delta.one"`. With no signal the model reaches for the first entry, so the goal was certifying position, not purpose. The fixture now has five seats with the answer last, and both properties are asserted in code before a model is spent rather than left as a note. |
