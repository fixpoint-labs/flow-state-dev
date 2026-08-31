# conductor › an implement phase ends with a pull request open and the row settled

**Issue:** LAB-138

**Outcome:** You file a real Linear issue's implement phase onto a conductor board and walk away.
Something claims it, gives the run its own checkout of the repository, stays with it until it
stops, reads what came back, and closes the row — or lets it run again. Afterwards the board says
whether the phase is done, and the run's own row says which harness session it was, which checkout
it worked in, and what it cost.

**Input:** `fixtures/input.json` — the issue, the phase, and the repository the checkout is cut
from. Held out: every assertion keys on these values round-tripped through the real dispatch.

**The subject:** [FIX-1219](https://linear.app/fixpoint-labs/issue/FIX-1219) — the scheduled
dispatch header comment states the wrong auth/idempotency order. Confirmed by the product owner,
2026-08-24, against stated criteria: an existing, real, small issue; self-contained, with no
decision to make while it runs, since none of the ask-and-wait dependencies have landed; and
outside every package this epic touches, so nothing about the fix can explain a failure of the
join. Explicitly not FIX-1166, which is LAB-139's Proof and stays unspent.

**Signal:**

1. The board row for the issue-phase reads **`completed`**, via the flow's own `status` action.
2. The run's row, returned beside it, carries the **harness session id**, the **checkout path**,
   and the **cost**.
3. The checkout the run was given is **not the server's own directory**, and it is on the branch
   the derivation names.
4. A **pull request exists** for that branch.

**Three things this check does that a naive one would not.**

- **It reads the outcome back through the system's own routes**, not off a block's return value.
- **It runs in a checkout that is not the server's**, so the working directory is actually
  exercised rather than being incidentally correct.
- **It asserts completion off the BOARD ROW, via the `status` action** — not off the run record,
  and not off the workstream request's status. A settlement declined on a lost claim is *silent*:
  `recordSuccess` writes with `ifAllowed: true`, so a refused `complete()` is dropped rather than
  thrown, the worker returns normally, and the request completes. Both of those therefore read as
  success while the row is still open. A goal check that trusted either would certify nothing
  about the join it exists to prove.

**Anti-game:** Must not assert completion from the run record or from request status (see above).
Must not read the harness transcript. Must not create the pull request itself, or assert on
whether the coding agent did a *good* job — that is LAB-135's question. Must not skip the working
directory by pointing the run at the server's own repository; if the checkout equals the process's
directory the check has not exercised what it claims to.

**Assumed topology:** one host, with workspace storage that outlives the process. A retry inherits
the last attempt's work because that work is on disk. On a queued multi-host deployment the
recorded checkout names nothing on the worker that recovers, and the retry restarts with none of
the work the retry budget is priced on. Named as a limit; deliberately not built around.

**Run:** `pnpm tsx goals/conductor/implement-phase-opens-a-pr/run.mts`

Requires a real Claude Code Agent SDK, a `gh` authenticated against the repository, and
`GOAL_CONDUCTOR_REPO` pointing at a clone the check may cut worktrees from. That
repository must ignore `**/.fsdev/` — a run writes the question it needs answered
under that path inside its own checkout, and provisioning refuses a repository that
would let the agent commit it.
