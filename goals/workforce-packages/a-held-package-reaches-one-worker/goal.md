# workforce-packages › it a held package reaches one worker

**Issue:** FIX-1459 (PR-B: packages from files, the hire's grant, and the agent kind reading them)

**Outcome:** Someone drops a `packages/ticket-desk/` folder, holding a `PACKAGE.md` and one block, into one worker's folder and runs `fsdev gen`. That worker follows the package's instruction and calls its tool. A sibling of the same kind, whose folder holds nothing, does neither. A worker that holds the same package but writes `tools: []` follows the text and calls nothing.

**Input:** `fixtures/workforce/`: three seats of the built-in agent kind under `teams/support/workers/`, with identical bodies. `iris` holds `packages/ticket-desk/` and writes no `tools:` line. `otto` holds nothing. `tess` holds a copy of the same package and writes `tools: []`. The committed `workforce.gen.ts` was written by the real command. `fixtures/input.json` holds the seat ids, what each holds and may call, and the two tokens. Held out: nothing in the package knows these values. Swap the tree and `input.json` together for another valid set and a correct implementation still passes.

**Signal:** One question ("Please log ticket 58 for me.") goes to every seat over the real HTTP route. On one attempt, all of these hold:
- `iris` says `MARIGOLD-4417` (written only in `PACKAGE.md`), makes at least one `stamp-ticket` call (a process-wide counter the block bumps), and gives `QUILL-7730` (returned only by the block).
- `otto` says neither token and makes zero calls.
- `tess` says `MARIGOLD-4417`, makes zero calls and gives no `QUILL-7730`.

**Anti-game:** A hollow pass would assert on the hire's settings, or on each seat answering at all. Both survive a kind that hands every package to every seat. So the check grades the model's own words and a real side effect, as a **set**: one shared kind and one shared question is always right for somebody.
- Calls are counted by the block itself, reset before each seat's turn. A model can write a receipt-shaped string without calling, so the reply is never the evidence of a call.
- The receipt comes only from a call. `otto` or `tess` carrying it means a route other than a call.
- `tess` proves `tools: []` withholds the tool and not the text, so the grant cannot pass by withholding both.
- Leg 0 refuses to spend a model call unless:
  - each token is written exactly once per package file and nowhere else;
  - the question is free of both tokens;
  - each seat's `tools:` line and its `packages/` folder match `input.json`, and no seat names `packages:`;
  - `fsdev gen --check` says the committed module matches the tree.

**Model:** `openai/gpt-5.4-mini` through the Vercel AI Gateway (override with `GOAL_MODEL`).

**Run:** `pnpm tsx goals/workforce-packages/a-held-package-reaches-one-worker/run.mts`

**Controls:** Both must FAIL.
- `GOAL_CONTROL=move-to-sibling` copies the tree to a scratch folder inside the goal, moves `iris`'s package into `otto`'s folder, re-runs the real `fsdev gen` there, and grades against the unchanged `input.json`. The legs must swap: leg (a) names both seats, and leg (b) shows `otto` saying the token and calling while `iris` does neither.
- `GOAL_CONTROL=drop-tools-line` has the harness delete each seat's `tools` key before hiring. That is the shape of a kind that ignored a written `tools: []`. It must fail on `tess` alone, in leg (b), for calling.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-25 | fix/fix-1459-pr-b @ 581dec56c + goal | vercel/openai/gpt-5.4-mini | PASS | Attempt 1 of 1. `iris`: 1 call, "MARIGOLD-4417 Ticket 58 has been logged; receipt: QUILL-7730." `otto`: 0 calls, "I can help draft it, but I don't have access to actually create the ticket…". `tess`: 0 calls, "MARIGOLD-4417 Ticket 58 could not be stamped." Leg 0 and leg (a) green. |
| 2026-09-25 | same | vercel/openai/gpt-5.4-mini | FAIL (expected) | `move-to-sibling`: leg (a) showed `iris` holding [] and `otto` holding the moved package. In leg (b), on all 3 attempts, `otto` said MARIGOLD-4417, made 1 call and gave QUILL-7730, while `iris` did neither. The legs swapped. The scratch copy was removed. |
| 2026-09-25 | same | vercel/openai/gpt-5.4-mini | FAIL (expected) | `drop-tools-line`: on all 3 attempts, only `tess` failed, for 1 call and giving QUILL-7730. `iris` and `otto` graded green. |
