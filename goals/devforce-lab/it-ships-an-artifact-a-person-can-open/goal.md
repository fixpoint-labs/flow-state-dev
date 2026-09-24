# devforce-lab › it ships an artifact a person can open

**Issue:** FIX-1496

**Outcome:** Somebody posts one line into a channel a Markdown file declared. A coordinator seat
reads the post and files one row. A working seat the row names wakes in a checkout of its own, runs
a real coding agent from a prompt built out of its own files, and leaves its work at an address that
still resolves when the run is over — work that satisfies an acceptance check the brief named before
the run started, written by the requester and applied from outside the checkout.

This is the third sibling in this lab, and it edits neither of the other two.
`it-wakes-the-seat-a-file-declared` grades what the plumbing carried, model-free.
`it-commits-from-the-seats-own-file` grades that a real coding agent leaves a commit. Both stop at
the middle of the path. What neither reaches is the two ends: **a post is what starts the work**, and
**the work survives the run and is judged against a condition its requester stated first.**

**Input:** the lab's own tree, unchanged, plus a git repository this check creates under the OS temp
directory with one commit on `main`, and a bare repository at a declared path inside the lab
(`.artifacts/<run>/feature.git`, gitignored) that the work is published to. The four graded prompt
tokens are **held-out**: each is read off the tree at run time and asserted to live in exactly one
convention file and in none of the lab's own code, before the run starts.

**Signal:**

1. Before anybody posts, the board carries no row. After one post, the line is in the channel's
   transcript, the fan-out addressed the EM seat and recorded the other two declared members as
   skipped, and exactly one row exists.
2. The board's dispatch record names the coder seat and never the reviewer seat, by `flowId`.
3. The prompt the manager handed the agent carries all four held-out tokens.
4. Exactly one branch under `conductor/` resolves at the published address **after** the store is
   closed and the temporary repository and every checkout have been deleted, and it is at least one
   commit ahead of `main`.
5. The requester's acceptance check **passes** against the produced tree and **fails** against the
   base ref.
6. The produced module's source appears in no lab file, no fixture, this runner, or the prompt.
7. A fresh process, over the same database file, reads back the settled row, the run record and the
   transcript.
8. The board row settles `completed`.

**Anti-game:** a model writes a plausible file without reading anything, so **the artifact's content
is never read for tokens and must not be**. Only the prompt is evidence that a file was *read*, and
it is taken off the block input the agent actually received — a `.tap()` in front of the agent —
rather than by re-running this check's own copy of the prompt builder.

What the artifact's content *is* graded on is the acceptance check, which names the module path, the
export and the behaviour for a non-empty and an empty name. It deliberately does not run the
produced tree's own tests: *"the repository's tests pass"* is satisfied by an unrelated passing test
and by a vacuous test sitting beside a broken `greet`, and a condition like that leaves
`ignores-the-brief` unable to fail.

**On BR-2 and the word `greet`.** The export name, the module path and the output strings appear in
the brief and in the acceptance check, and they have to: that *is* the contract. What is held out is
the **implementation** — no file the seat could read defines `greet`, and the produced source is
asserted to appear nowhere in the lab, the tree, this runner or the prompt. The base ref not having
the module is proved independently, by the failing half of signal 5.

**Provenance is provenance.** The one parentage read here says which seat the board handed work to.
Nothing schedules, claims or settles through a session tree (ER-13, and
[ER-26](../../../specs/epics/FIX-1457/BUSINESS-RULES.md#er-26) on `origin/main` is what this check
discharges for the rest of the set).

**There is no stub fallback, deliberately.** A model-backed check that silently degrades to a
scripted run is exactly the failure its model-free sibling exists to detect. The two controls that
need a cheap harness install their own, explicitly, at their own call sites; nothing reaches one by
falling back.

## Controls

Every one is **observed red**, not asserted about. All nine cost no inference, which is deliberate:
a control that can only fire during a paid run is a control that usually does not fire.

**Two of them exist because they once passed.** `ends-the-grader` and `forges-the-verdict` are kept
standing because the first version of the acceptance check took exit status as the verdict, and a
one-line `process.exit(0)` in the artifact defeated it — a wrong implementation reported ACCEPTED,
which is D2's whole premise inverted. A defeat that has been closed and not kept as a control is a
defeat waiting to come back quietly.

| Control | Perturbs | Goes red on |
|---|---|---|
| `ignores-the-brief` | a tree with unrelated work in it | the acceptance check REJECTS it — irrelevant work is not accepted |
| `unrelated-passing-test` | a tree with a passing test that never imports the export | REJECTED — "some test passes" is not the condition |
| `vacuous-test` | a passing test beside a `greet` that returns the wrong string | REJECTED — the sharp case: the module exists, a test passes, the work is still wrong |
| `ends-the-grader` | a module that calls `process.exit(0)` at import, before any assertion runs | REJECTED as **tampered**. This one defeated an earlier version of the check outright, which read exit status alone and reported ACCEPT for a wrong implementation |
| `forges-the-verdict` | a module that prints a plausible `ACCEPT` line and then exits 0 | REJECTED as tampered — the nonce arrives on stdin and is consumed before the module exists, so the shape of a verdict is not enough to produce one |
| `already-passing` | a base ref seeded with **the artifact the run actually produced** | the base-ref half ACCEPTS, which is the vacuous-green shape BR-3's second half exists to catch |
| `no-harness` | the harness slot throws, as an unauthenticated SDK does | the row settles **`errored`** and no branch carries a commit — it fails rather than substituting something |
| `rejected-work` | a scripted run that commits work the brief did not ask for | the row settles `errored` rather than `completed`, which is **BR-4**: the artifact existing is never sufficient, and the row is what survives the run |
| `work-reaches-the-reviewer` | the board's `coder` assignee is addressed to the reviewer seat | a board dispatch record carries `flowId` = the reviewer, which the goal forbids |

`already-passing` is built from the run's own product rather than from an implementation written in
the check, for two reasons: writing one would put the answer in a file BR-2 scans, and a base ref
seeded with the actual product is exactly the shape the rule is about.

**Both lab-driving controls first assert that a row was filed.** Without that, `no-harness` and
`work-reaches-the-reviewer` both pass when the post files nothing at all — "no completed row, no
branch, no dispatch" is equally true of a lab that never started. That happened once, on a run where
the post entry was declared in the wrong action map, and both controls reported green.

`work-reaches-the-reviewer` grades the **board** dispatch, never the notify delivery. A channel
notification to a declared member is expected and is a different dispatch kind; a control that
counted any dispatch to the reviewer would go red on correct behaviour.

**Model:** real — Claude Code's own, through the Agent SDK. Requires a signed-in SDK.

**Run:** `pnpm tsx goals/devforce-lab/it-ships-an-artifact-a-person-can-open/run.mts`

Needs `git`, a writable temp directory, and a signed-in Claude Code Agent SDK. **No `gh`, no token
and no network beyond the model call.** The artifact's address is a local bare repository, which is
the one leg CI runs; the credentialed pull-request release run is the same path pointed at a real
remote and is a human release step, never inferred from whether `gh` happens to be installed.

`reread/run.mts` beside this file is **not a goal** — it is the fresh process signal 7 spawns. It
carries no `goal.md`, so the sweep walks past it; it is spelled `run.mts` so the goals
`tsconfig.json` typechecks it.

## What this establishes, and what it does not

It establishes that a hired Workforce can take a request through a channel and hand back a work
product a person can open and judge. It does **not** establish that the product is *good* — only
that it satisfies the acceptance condition its requester wrote down, which is the strongest claim a
machine can make here and is deliberately weaker than a human review. It does not establish anything
about a second Lab, about CyberForce, or about unbounded product delivery.

It also does not establish that the pull-request leg works: that leg is documented, not run, and the
verdict below names which leg produced it.

**On "outlives the run".** BR-1 is worded *"the goal's process exits"*; a check cannot outlive its own
process and then keep asserting. What it does instead is strictly stronger than an in-process read and
slightly weaker than the literal wording: it closes the store, deletes the source repository and every
checkout, and only then resolves the address — and the two reads that matter most, the acceptance
halves, are executed by **separate processes** that know nothing but the published path. The address is
an ordinary directory on disk, so surviving process exit is a property of where it is rather than
something this check could demonstrate about itself.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-22 | `fix/FIX-1496` | Claude Code Agent SDK | **PASS** | **Leg: the local bare repository — no `gh`, no token, no network.** Artifact address `goals/devforce-lab/.artifacts/1790082844427_29582/feature.git`, branch `conductor/t0/h3d62141…/devforce-tasks--t0--feature/greeting-module--implement`, 1 commit ahead of `main`, resolved after the store was closed and the run's temporary repository and checkouts were deleted. One post on `eng.feature` produced **exactly one row**, enumerated off the ledger rather than looked up. The requester's check ACCEPTED the produced tree and REJECTED `main`. The produced `src/greeting.js` (78 bytes) appears in no lab file, no fixture, this runner or the prompt. A fresh process over the same `lab.db` read the row `completed`, 1 run record reporting `succeeded`, and 1 transcript line. **All nine controls seen red**, including `ends-the-grader` and `forges-the-verdict` (the acceptance check can no longer be defeated by artifact code ending its own grader) and `rejected-work` (committed work that fails the brief settles `errored`, never `completed`). **Known red, not caused by this check:** the model-free sibling `it-wakes-the-seat-a-file-declared` fails its org-less-door leg — see below. |

**This row replaced an earlier one, deliberately.** A first PASS was recorded on 2026-09-22 against
an acceptance check that took **exit status alone** as its verdict. Codex then showed that a
produced `src/greeting.js` containing `process.exit(0)` defeated it — the grader died before any
assertion ran and a wrong implementation was reported ACCEPTED. The check was hardened and the proof
re-run, so the recorded verdict describes the check that exists rather than one that was superseded.
**Four runs reached the model and passed** — three against the original check, one against the
hardened one — each producing a *different* artifact (100, 78, 100, 78 bytes), which is what a
model-driven run should do and what a replay would not. Two further runs failed before reaching the
model, both on controls that had been tightened in the same round and were themselves wrong; those
are recorded in the PR, not here.

**The model-free sibling is red, and this issue did not break it.** `it-wakes-the-seat-a-file-declared`
fails one leg: *"an org-less read of eng.em was answered rather than refused."* Verified identical on
clean `origin/main` (`ae915670f`) with none of this branch's changes applied. The cause is
[FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442) (`b48158a0d`, 2026-09-21), which made an
app that configures no principal resolver run under a built-in development organization instead of
being refused at the door; that gate last passed 2026-09-17, before it. This issue's
[BR-10](../../../specs/issues/FIX-1496/BUSINESS-RULES.md) delegates its whole proof to that leg, so
BR-10 is **not** currently proved by anything. Raised to the owner rather than patched here: fixing it
means changing what an existing check claims, which `PLAN.md` S6 and `BR-17` both put out of scope.

**Resolved by [FIX-1515](https://linear.app/fixpoint-labs/issue/FIX-1515)
([#2073](https://github.com/fixpoint-labs/flow-state-dev/pull/2073), merged 2026-09-23 as
`02196cee6`).** The lab host now wires a fail-closed verified principal, so an org-less read is
refused (401) and the same read with an org lands. The sibling gate is PASS at `c76ac5969` in its
own verdict log, which re-proves BR-10 and BR-17. **Re-run on `origin/main` at `95049473f`,
2026-09-24: PASS**, all legs green, including *"an org-less read is refused at the transport door
while the same read with an org lands"*. The paragraph above is kept as history.
