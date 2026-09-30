# devforce-lab › it keeps its rows on the channel's board

**Issue:** FIX-1667

**Outcome:** Anyone in the DevForce Lab's organization who opens the feature channel's workstream
sees the board that channel holds and every row on it, at the status its coding run left it, with
no second copy of the row anywhere. A line posted on the channel ends as one completed row, and
that row is read back the way App Lab reads a workstream: through the channel, through the HTTP door
a browser uses, and from the organization's storage under the id the framework minted.

**Input:** the DevForce tree as it stands, with the lab's scripted harness in the coder seat's slot
(it commits and finishes). The board's name and the channel's id are read off the tree at run time,
so renaming the channel's folder or the board still passes a correct implementation (checked once
by renaming the board to `queue`).

**Signal:** six legs, each closing named rules (`specs/issues/FIX-1667/BUSINESS-RULES.md`):

0. the channel's `CHANNEL.md` declares the board by a plain name, and no file in the tree or the
   lab's code writes the minted id *(BR-1)*;
1. the channel's `read` lists exactly the boards its file declares *(BR-2)*;
2. its `readBoard` returns exactly one row, with the issue-and-phase id the EM's filing returns,
   `completed`, assignee `coder` *(BR-3, BR-4)*;
3. the browser's door (the collection read route on the channel's session) returns that row under
   the lab's verified bearer, without the row's input, output, metadata or execution coordinates,
   and refuses the same read with no verified organization *(BR-7, BR-8)*;
4. the organization's storage holds the row under the minted id, and no key in the organization's
   or the user's storage holds another copy *(BR-4, BR-9)*;
5. hiring printed no unattended-board warning naming the board *(BR-11)*.

**Anti-game:** a hollow pass is a run that completes while the row sits on a ledger the channel
does not hold. So nothing here reads the drain's report, the run record or the EM's output — all
three are green in exactly that case. The row is only ever read where App Lab reads it.

**Model:** n/a — model-free by design; what is graded is where the row lives, not how the work
went. The sibling `it-commits-from-the-seats-own-file` covers a real coding agent.

**Run:** `pnpm tsx goals/devforce-lab/it-keeps-its-rows-on-the-channels-board/run.mts`

Needs `git` and a writable temp directory. No network, no model credential.

**Controls:** `GOAL_CONTROL=kind-ledger` builds the two worker kinds on a user-scoped ledger of their
own, as they were before the board moved onto the channel. The run still completes; the check must
FAIL on leg 2, *the channel's board returned no rows* (legs 3, 4 and 5 go red with it).

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
