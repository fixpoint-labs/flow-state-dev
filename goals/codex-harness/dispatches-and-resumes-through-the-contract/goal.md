# codex-harness › it dispatches and resumes through the contract

**Issue:** LAB-153
**Outcome:** Someone points the framework at a checkout and gets real work done by
OpenAI's Codex, reading the result through the same handle a Claude Code run
produces — then continues that same Codex conversation later, holding nothing but
the session id the first run handed back. The epic's claim is that a manager needs
no per-vendor code; this is that claim executed rather than asserted.
**Input:** `fixtures/input.json` — a file name and two held-out lines, plus the
model to run. Held-out: swap in different lines and a correct implementation still
passes, because nothing below hard-codes their content.
**Signal:**
1. The file in the throwaway checkout holds **both** lines — the second one written
   by a turn that was never told the file's name.
2. Both handles parse against the **neutral** `harnessRunHandleSchema`, and the
   second handle's `sessionId` equals the first's.
3. Both report `outcome: "finished"`, non-null `usage`, and `cost.basis === "estimated"`.
4. A third leg puts a two-second deadline on a long-running prompt: the run throws
   within a bounded time, and the thread id is already in the host's own state —
   the run its deadline killed is still resumable.
**Anti-game:** The follow-up prompt never names the file, so a harness that silently
started a fresh thread cannot pass leg 1 — it has nothing to append to. Nothing here
reads Codex's own session store under `~/.codex`, and nothing asserts on the model's
prose: the grading surface is the working tree and the two handles. A run that
returned a beautiful handle and wrote no file fails, and a run that wrote the file
by starting over fails the session-id check.
**Model:** real — `gpt-5.4-codex` (a *priced* model, deliberately: a run left on
Codex's default reports `cost: null` by design, and leg 3 of the signal would be
untestable).
**Run:** `CODEX_API_KEY=… pnpm tsx goals/codex-harness/dispatches-and-resumes-through-the-contract/run.mts`

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| — | — | — | NOT YET RUN | Needs `CODEX_API_KEY` and a Codex quota; not available in the implementing session. The CI specs (`packages/codex/test/`) cover every leg against a scripted client and, in `installed-sdk.spec.ts`, against the real SDK with a fake `codex` binary — what remains unproven here is a real model and a real resume. |
