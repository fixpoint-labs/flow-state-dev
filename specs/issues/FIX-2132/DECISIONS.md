# FIX-2132 · Decisions

[Spec](SPEC.md) · **Decisions**

One call is this issue's. The shape is the epic's: a coding run's question holds its task
([ER-8](../../epics/FIX-2058/DECISIONS.md#who-owns-what), owned by FIX-2133), the answer is a
steer that starts the next run in the same coding session, and only approvals, reviews and input
suspend ([ER-1](../../epics/FIX-2058/DECISIONS.md#who-owns-what)). This spec builds on FIX-2133's
hold as the epic states it; FIX-2133's spec (#3747) is still being re-specified against it.

## The tree

```mermaid
flowchart TD
  I["FIX-2132"] --> D1["D1 · FIX-2137 stays a blocker · a host's own harness block may still suspend"]
  D1 -.->|"rejected"| X1["drop the edge and refuse a harness block that suspends · a new limit on a public slot"]
```

Solid edges are what you sign. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · FIX-2137 stays a blocker: the manager's own path never suspends, but a host's harness block may

*Engineering, decided by the coordinator after Codex's finding on `c2aa9f5`; recorded because it
keeps an edge in the epic's graph.*

| | |
|---|---|
| **Instead of** | Dropping the FIX-2137 edge (a durable resume with trace observability off runs its completed steps again; fix in #3749), and refusing a harness block that suspends |
| **Because** | The built-in path holds and never suspends: under [ER-1](../../epics/FIX-2058/DECISIONS.md#who-owns-what) a question holds its task, and every ask the manager makes is a question (the run's marker, the judge's *ask*, a saved-work mismatch). But the public `HarnessSlot` takes any `HarnessBlock` (`manager.ts`, `HarnessSlot`), and the harness step's `onSettled` already handles a child that exits suspended. A host's own harness that calls `ctx.suspend` resumes through the engine's durable resume, which is FIX-2137's path. Refusing it would be a new limit on a public slot, to save an edge that costs nothing: #3749 is ready to merge |
| **Locks in** | FIX-2137 blocks FIX-2132, with FIX-2133 and FIX-2056. The manager itself suspends no request; the sweep checks `waitForUser` has no references in `harness-manager`. The goal check runs with traces off |

![D1: does FIX-2132 still wait on FIX-2137, now that its own question holds the task? Chosen: yes, keep the edge. Instead of: drop it and refuse a harness block that suspends. Decides it: a host's custom harness block may still suspend. Price: FIX-2132 waits on a fix that is ready to merge. Locks in: FIX-2137 blocks FIX-2132. Flips if: no host-supplied block or callback in the manager chain can suspend](figures/d1-keep-fix-2137.svg)

It comes down to the public slot: a host's harness block can still suspend, and that path needs FIX-2137.

**What would change my mind:** no host-supplied block or callback that receives a `BlockContext`
inside the manager chain can suspend, such as the `HarnessSlot` block, `judge.block`, the phase
hooks or `ledgers`. Only then does nothing in the coding flow resume, and the edge drops.

## Decided, not asked

- **Every ask the manager makes goes through one step**: the run's marker, the judge's *ask*,
  and a saved-work mismatch. That step is the manager's only caller of ER-8's ask write, and the
  convergence point for "a question is an Inbox item". No other path parks, writes an inbox row or
  announces.
- **The ask step sits after the verdict and the saves**, so the run's work is held and its kept
  files saved before the turn ends, and the checkout lease is already free.
- **The answer's turn is FIX-2133's owed turn**, claimed for the same attempt. The manager reads
  the session this attempt confirmed from its run record before the turn's open clears it, as it
  does today, so the next run resumes it; with none confirmed, a fresh session is told the brief,
  the question and the answer.
- **No cap of the manager's own on answers.** Each answer starts its own turn, and each turn needs
  a person's answer, so people bound them; steers inside a turn stay under `MAX_STEERS`, and a
  flood of steers can't refuse an answer.
- **The prompt after an answer is the phase's `buildPrompt`**, with `answers` read from the task's
  row: this try's answered questions, oldest first. No copy on the run record, so a question's
  text and answer live in one place. The deadline's "no answer came" steer reaches the run as any
  steer does.
- **The marker's path names the attempt and the run** (`<attempt>-<run>.md`), the run counted on
  the run record so the count survives the answer's turn: a run must never read a question an
  earlier turn already asked. `isAskMarkerPath` matches both shapes, so neither is ever committed.
- **The legacy marker is read at most once, behind a guard.** A `<attempt>.md` from before the
  upgrade usually already put its question on the row when its run parked, and FIX-2131's map
  reads that row as held. But today the manager reads the marker and parks later in the same
  step, so a crash or an upgrade between the two leaves only the file. So: when the row holds no
  question this attempt has ever asked, whatever its end (open, answered, deadline or cancelled),
  and `<attempt>.md` exists, the ask step records it once through ER-8's ask. After that the row
  always holds a question from this attempt, so the guard never reads that path again, and the
  marker can't bring back an answered or expired question. A transition test covers the
  crash-between-read-and-park state. Given the file and no question on the row, recovery is
  injected right after the fallback's ask write, while the question is still open, and the row and
  the Inbox still hold exactly one question. Then, after an answer, and separately after the
  deadline, the next run doesn't ask it again.
- **A line while the task holds** names no question, so it answers nothing (ER-8). It is kept on
  the task, and the run the answer starts takes it. The claim gate refuses a held row, so no run
  starts beside the hold.
- **A cancel** closes the question with the row (ER-8). No turn is owed, so the manager starts
  nothing; its branch and kept files stay, and leg d proves it.
- **At the deadline the manager adds nothing.** ER-8's deadline write releases the hold with a
  "no answer came" steer and owes the turn like an answer, so the next run goes ahead in the same
  session. The epic's [Open](../../epics/FIX-2058/DECISIONS.md#open) recommends that. If the owner
  picks "fail", the try fails, the next try resumes the session through today's retry path, and
  the manager still adds nothing; only leg e changes.
- **Removed outright** (epic, *no shim*; [FIX-2056 (e)](../../epics/FIX-2056/DECISIONS.md#e)):
  the inbox collection and its ten exports, `announce` (refused by name, BP-030),
  `parkOnBoardQuestion` and harness-manager's `awaitReview` calls (the epic moves every question
  onto the hold, [FIX-2058, who owns what](../../epics/FIX-2058/DECISIONS.md#who-owns-what)),
  and `HarnessRunParked`, which only the parks used. A stored inbox row is left unread, an answered
  one not yet taken included: only the conductor lab wrote them, and its row asks again as held.
  That costs a lab user one question answered twice, against a dual-read of a removed store the
  epic rules out (ER-5).
- **The conductor lab** answers through `updateTask` as the Inbox does, and its `status` reads held
  tasks from the board. Its `answer` action goes. LAB-154's goal check moves to the same action and
  keeps its generated-fact proof.
- **No harness entry in the retired-shape map.** FIX-2131 maps every parked question onto the hold,
  harness rows included, because the rows share one shape (ER-5). What a coding row needs beyond
  that, its session, FIX-2132 reads from the run record, so the answer's turn spends no try.
- **Merge order:** this merges before FIX-2131, which removes the board park this issue moves off
  ([FIX-2131, decided, not asked](https://github.com/fixpoint-labs/flow-state-dev/blob/spec/FIX-2131/specs/issues/FIX-2131/DECISIONS.md#decided-not-asked)).

## Considered and dropped

| Alternative | Why not |
|---|---|
| Suspend the coding flow's request with `waitForUser` (this spec's first draft) | A question isn't an approval, a review or input ([ER-1](../../epics/FIX-2058/DECISIONS.md#who-owns-what)); suspending needs durable execution and a resume that runs no step twice (FIX-2137), where the hold needs neither |
| Keep the run's question a board park, and only list it in the Inbox | The answer would still start a new try, which the concept rules out |
| An ask tool the model calls, through `mcpTools`, in place of the marker | Not every harness takes relayed tools (`ask.ts`), and it changes nothing a person sees |
| Keep the inbox collection as a read-only status surface | A second record of a question the task row already carries (ER-8) |
| Suspend inside the harness step, mid-run | The harness is its own process and can't pause midway (concept) |

## Settled

- **A resume re-enters at the ask step and loops back with the answer — CONFIRMED with traces
  on, REFUTED with traces off.** `poc/answer-loops-back/` (`bash
  specs/issues/FIX-2132/poc/answer-loops-back/run.sh`), on `main` at `f740b61c1`. Traces on: three
  passes, three runs, the second question a new stop. Traces off: six runs, pass 1 three times;
  with the run in `ctx.runOnce`, each pass ran once but appended state doubled. It tested the
  suspension shape this spec has since dropped for its own asks. Its finding is FIX-2137, which
  binds FIX-2063 and FIX-2129, and this issue through a host's harness block that suspends ([D1](#d1)).
- **No POC for the answer's turn.** Its one premise, that a second turn on the same attempt resumes
  the session that attempt confirmed, rests on a read the manager already makes before the open
  (`manager.ts`, the session read before `openRunRow`), and leg b fails if it doesn't hold.
- **No counted facts carry the approach**, so no checker. The ten exports are one `index.ts`
  block.

## Notes from review

For the implementer; none of these changes the approach. Recorded verbatim from #3743.

- **Second look, 4 (D1 re-ask):** "The retry resumes the session and 'may ask again', so a person who is away for a week sees the same question as a new item and spends a try each time (3 tries is 3 weeks). D1 itself is sound, since going ahead on a guess is worse. Consider saying that the re-ask is the same question, shown once, so the second try does not surface a duplicate item."
- **Second look, 5 (persisted fields):** "Read it with a `== null` guard (BP-030, BP-035). The marker path change (`<attempt>.md` to `<attempt>-<step>.md`) also needs `isAskMarkerPath` to accept the old shape. A pre-upgrade run that wrote `<attempt>.md` and is then resumed should be read, not treated as a stray file. Note too that `run.askMarkerPath` is exposed to phase authors, so changing its shape is a public-contract change and belongs in the changeset's migration note, which the spec already plans."
- **Second look, 6 (module):** "Put the ask step in its own module, not as another closure in `manager.ts`. [...] a file with a small interface (verdict + saves in, question or none out). It also makes the 'no other path parks' claim checkable by import, not just by grep, and it makes the ask step unit-testable without the whole sequencer. [...] I'd not do a wider split of `manager.ts` in this PR."
- **Second look, checks (goal check):** "Keep the real model for the session-resume proof (the part only Claude Code can show), but run the two-question and cap cases (see 2) on the devteam stub, so a model that doesn't ask doesn't read as a spec failure."
- **Second look, checks (FIX-2129 head):** "Since `FIX-2129` is still at review head (`6188b938`), say what happens to this spec if `waitForUser`'s shape moves before it merges." Build on `waitForUser` as FIX-2129 merges it; a change to its call shape is a rename here, a change to what an unanswered question does is a change to ER-1 and so to D1.
- **Cursor, reuse:** "prefer **extending the existing steer connector** (`again: true` + `loopBack` to the harness step) so answers and steers share one cap and one loop predicate — avoid a parallel 'ask loop' beside `stepForSteer`." *Superseded by the re-spec on #3748: the manager has no cap of its own on answers; the only bound is ER-8's write (FIX-2133), where each open question reserves room for its answer under `MAX_STEERS` (FIX-2131, "The steer cap keeps room for answers"). Don't build a shared manager cap.*
- **Cursor, two stores:** "`run.answers` on the run record vs steer text on the task row means two mid-attempt human-text stores. If implementer can fold Q&A into the same persistence/ordering path steer already uses (without breaking 'same try' semantics), that would reduce replay/prompt bugs."

- **Codex, delete/recreate (required, #3743 at `05a197b4`):** "When a durable task is deleted and recreated under the same ID, its attempt count and question history reset while its checkout remains keyed by principal/epic/issue/phase (`packages/harness-manager/src/manager.ts:1903-1936`). The supported delete/requeue lifecycle mints a new `incarnationId`, but this guard checks only attempt-local question history, so the replacement's first attempt can read the old checkout's surviving `.fsdev/ask/1.md` and recreate a stale question. Consume the legacy marker after its ask is durably recorded, or bind fallback eligibility to the task incarnation, and cover delete/recreate in the transition test." *Required: scope the fallback to the task's `incarnationId`, or consume the marker once its ask is durably recorded, and cover delete/recreate in the transition test.*

## How it got here

- **Draft** — framed as moving every harness-manager ask onto FIX-2129's `waitForUser`, with the
  answer as one more step through FIX-2086's steer loop; the POC found that resume replay runs
  finished steps again in production, filed as FIX-2137 and made D2.
- **Review round 1** — D1 cited ER-1; FIX-2133 named for questions known up front; the sweep took
  `awaitReview` and `HarnessRunParked`.
- **2026-10-23, re-specified on the epic's amendment** (#3748): the owner decided a question holds
  its task. The question became ER-8's hold and the answer FIX-2133's owed turn; the old D1, a
  deadline that fails the try, gave way to the epic's open call; the old D2, waiting on FIX-2137,
  became this D1, which first dropped the edge; Codex on `c2aa9f5` found a host's harness block
  may still suspend, so the edge stays. Folded from Codex on `2db22ea`: the cancel leg asserts the
  work survives, a deadline leg, the legacy marker read once. Codex on `c2aa9f5`: the edge stays (D1); the legacy marker gets a
  guarded fallback for a crash between its read and its park. Cursor's two-stores note is folded:
  `answers` reads the row.

**Open: none of its own.**
