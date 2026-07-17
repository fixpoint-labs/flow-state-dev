# Best Practices — Testing & Eval Harnesses

Situational BPs for `@flow-state-dev/testing` eval scorers, block/flow test
helpers, and harness-side assertions. Load this file when changing eval
comparison behavior or reusing framework helpers inside test tooling.
See [`../best-practices.md`](../best-practices.md) for the index and universal rules.

---

### BP-041: Match comparison-helper failure semantics to the harness

- Status: Active
- Date: 2026-07-17
- Scope: Testing & eval harnesses — scorers and assertions that compare fixture or model output.
- Rule:
  - Before reusing a helper from another subsystem (e.g. state-write `deepEqual` from `@flow-state-dev/core/helpers`), read its contract: does it return `false` on mismatch, or throw on depth/recursion/non-JSON values?
  - Eval scorers and harness assertions must treat comparison failure as a scored `passed: false` (or assertion failure), not as an uncaught throw that aborts the whole case unless that is intentional.
  - When the owning helper throws where the harness needs a boolean, wrap at the harness boundary (map throws to "not equal") or use a comparator written for fixtures — do not let valid eval data surface as "execution error."
- Why: A state comparator's safety limits are correct for writes but wrong semantics for eval; mixing them discards scores instead of reporting a mismatch.
