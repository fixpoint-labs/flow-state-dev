# devforce-lab › it keeps its rows on the mailbox's board

**Issue:** FIX-1667

**Outcome:** Anyone in the DevForce Lab's organization who opens the feature mailbox's workstream
sees the board that mailbox holds and every row on it, at the status its coding run left it, with
no second copy of the row anywhere. A line posted on the mailbox ends as one completed row, and
that row is read back the way Shift Manager reads a workstream: through the mailbox, through the HTTP door
a browser uses, and from the organization's storage under the id the framework minted.

**Input:** the DevForce tree as it stands, with the lab's scripted harness in the coder seat's slot
(it commits and finishes). The board's name and the mailbox's id are read off the tree at run time,
so renaming the mailbox's folder or the board still passes a correct implementation (checked once
by renaming the board to `queue`).

**Signal:** six legs, each closing named rules (`specs/issues/FIX-1667/BUSINESS-RULES.md`):

0. the mailbox's `MAILBOX.md` declares the board by a plain name, and no file in the tree or the
   lab's code writes the minted id *(BR-1)*;
1. the mailbox's `read` lists exactly the boards its file declares *(BR-2)*;
2. its `readBoard` returns exactly one row, with the issue-and-phase id the EM's filing returns,
   `completed`, assignee `coder` *(BR-3, BR-4)*;
3. the browser's door (the collection read route on the mailbox's session) returns that row under
   the lab's verified bearer, without the row's input, output, metadata or execution coordinates,
   and refuses the same read with no verified organization *(BR-7, BR-8)*;
4. the organization's storage holds the row under the minted id, and no key in the organization's
   or the user's storage holds another copy *(BR-4, BR-9)*;
5. hiring printed no unattended-board warning naming the board *(BR-11)*.

**Anti-game:** a hollow pass is a run that completes while the row sits on a ledger the mailbox
does not hold. So nothing here reads the drain's report, the run record or the EM's output — all
three are green in exactly that case. The row is only ever read where Shift Manager reads it.

**Model:** n/a — model-free by design; what is graded is where the row lives, not how the work
went. The sibling `it-commits-from-the-seats-own-file` covers a real coding agent.

**Run:** `pnpm tsx goals/devforce-lab/it-keeps-its-rows-on-the-mailboxes-board/run.mts`

Needs `git` and a writable temp directory. No network, no model credential.

**Controls:** `GOAL_CONTROL=kind-ledger` builds the two worker kinds on a user-scoped ledger of their
own, as they were before the board moved onto the mailbox. The run still completes; the check must
FAIL on leg 2, *the mailbox's board returned no rows* (legs 3, 4 and 5 go red with it).

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-30 | a1b122eb1 | n/a | PASS | Board `eng.feature.work`, one completed row assignee `coder`; the door returns it with no private field and refuses the org-less read (401); one org copy, none in user storage; no unattended-board warning. |
| 2026-09-30 | a1b122eb1 | n/a | FAIL (control `kind-ledger`) | Fails at leg 2, *the mailbox's board returned no rows*; legs 3, 4 and 5 red with it. As designed. |
| 2026-09-30 | a1b122eb1 | n/a | PASS (board renamed `queue`) | The board's name and id are read off the tree; rename reverted. |
| 2026-09-30 | origin/main lab | n/a | FAIL | Before this change: *the mailbox lists no board*. |
