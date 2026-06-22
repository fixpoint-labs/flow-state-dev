# plan-and-execute › it carries original data to workers

**Issue:** FIX-827
**Outcome:** When you hand Plan & Execute a data-heavy request (e.g. five concrete subdomains to research), each worker actually receives the concrete data, and the final answer covers those specific items — not generic filler like "research the listed subdomains" with nothing attached.
**Input:** `fixtures/subdomains.json` — five named subdomains. Held-out: swapping the five for any other five distinct strings must still pass a correct implementation. The assertion derives the expected facts from the fixture; it never hardcodes these specific names.
**Signal:** every dispatched worker's `context` contains the subdomain string for its task, AND the final synthesized answer names at least 4 of the 5 subdomains. (5 is enough to exercise the dropped-data bug; more is just waste.)
**Anti-game:** the gameable pass is asserting the *pattern ran* — that it emitted a `TaskInit[]`, or that the board reached `complete`, or that the decomposer returned the right schema shape. All of those pass on the original (broken) behavior where workers got a bare instruction with no data. The check MUST grade against the fixture: the concrete subdomain strings have to appear in worker context and in the output. Do not assert on schema shape, item counts, or that `taskContext` was called.
**Model:** real — openai/gpt-5.4-mini
**Run:** _runner not yet authored_ — see "Runner" below.

**Runner.** This is the **contract** for the goal; the `run.mts` was removed because it can't be verified in the current environment (no inference credential) and the framework shapes it must read are easy to get wrong blind. Author it against a real `fsdev run` capture, copying `_template/run.mts`, and noting two things the first attempt got wrong:
- The worker-execution items are `type: "block_trace"` (their completed value is a `BlockValueInternal`), **not** `block_output`. Prefer asserting on the **task-board's public output** that carries each worker's `context`, rather than unwrapping trace internals.
- Build the final answer from the **latest snapshot of each item** (streamed text lands in later snapshots, not the first `item_added`) plus `result.output` — see `_template/run.mts`.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| _not yet run_ | | | | contract only; runner to be authored + verified against a real model (see Runner above and README → Credentials) |
