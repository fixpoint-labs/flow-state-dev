# delegation › it synthesizes fanned-out worker results

**Issue:** FIX-930 (epic) — verifies the shipped substrate: FIX-918 (delegation via skills-library `agents:` + blocks-as-tools), FIX-927 (board-scoped `taskTools` for mid-drain fan-out), FIX-920/928.
**Outcome:** A coordinator generator, given a team of declared agents, delegates a unit of work to one worker via `addTask` + `runBoard`; that worker fans out follow-up work mid-drain to a second worker; and both workers' results come back and are synthesized into the coordinator's final answer. What a user notices: they get an answer that contains information only the workers held — the coordinator could not have produced it alone.
**Input:** `fixtures/team.json` — a `researcherSecret` token and an `auditSuffix`. Held-out: swap them for any other two distinct strings and a correct implementation still passes. The assertions derive the expected markers from the fixture (`SECRET`, `SECRET+SUFFIX`); nothing is hardcoded.
**Signal:**
1. **Delegation** — the coordinator's final answer contains `researcherSecret` (the `researcher` worker ran and its result was synthesized).
2. **Fan-out** — the final answer contains `researcherSecret + auditSuffix` (the `auditor` worker ran). This marker is unforgeable by anyone but the fanned-out auditor: the coordinator is told to assign exactly ONE task (to `researcher`) and call `runBoard` ONCE, and it never learns the suffix; the auditor only produces `code+suffix` from a code it is HANDED, and only the researcher holds the secret. So `secret+suffix` in the answer proves the researcher enqueued the auditor mid-drain and passed it the secret.
3. **A/B baseline** — a second, identical coordinator (same prompt, same user turn) bound to NO team must NOT produce `researcherSecret`.
**Anti-game:** the gameable pass is asserting the mechanism ran — that `addTask`/`runBoard` were called, that the board reached `drained`, that a `task-change` fired. All of those can pass while the workers' outputs never reach the answer. This check grades on the held-out secrets appearing in the coordinator's user-visible answer, AND contrasts delegation-ON against a delegation-OFF baseline over the identical prompt/request. The baseline's inability to produce the secret is what attributes the ON pass to delegation actually running (not leakage, hallucination, or harness feeding). Do NOT assert on tool-call counts, board status, or item counts.
**Model:** real — `openai/gpt-5.4-mini`
**Run:** `pnpm tsx goals/delegation/synthesizes-fanned-out-worker-results/run.mts`

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-07-24 | 11f94dd9f | openai/gpt-5.4-mini | PASS | ON answer carried `QORVIX-7788` (delegation) and `QORVIX-7788-CHECKED-4413` (fan-out); auditor worker executed; OFF baseline did not produce the secret. Worktree at origin/main HEAD. |
| 2026-07-24 | 11f94dd9f | openai/gpt-5.4-mini | PASS | Second consecutive run — identical result (ON: both markers present; OFF: neither). Deterministic across runs. |
