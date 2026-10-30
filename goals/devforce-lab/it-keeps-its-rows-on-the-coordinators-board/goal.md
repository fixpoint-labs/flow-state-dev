# devforce-lab › it keeps its rows on the workstream's board

**Issue:** FIX-1667 (rewritten under FIX-1792, which took the DevTeam off mailboxes; the folder
keeps its name so the goal's history stays in one place)

**Outcome:** In the DevTeam lab, a workstream's work sits on its lead's workstream session's board,
and the organization reads the workstream without reading that work. Alice opens Storefront's
`feature` workstream with the EM as its lead; a row the EM files there ends as one completed row on
that session's board, which Alice reads. Bob (a project member) and an outsider (in the
organization, on no project) read the workstream's entry, its lead and its session, and are refused
its rows (epic ER-7: a workstream is read by whoever reads the project and written only by its
owner).

Before this rewrite the claim was that the feature *mailbox* held the board and anyone in the org
read its rows; the DevTeam has no mailbox now.

**Input:** the DevTeam tree as it stands, with the lab's scripted harness in the coder's slot (it
commits and finishes), and a fresh issue slug per run. The workstream's session, the row's id and
its storage key are read at run time, never typed in.

**Signal:** five legs, read over the lab's HTTP routes with each person's own verified bearer.

- **0** the tree holds no `MAILBOX.md` (`0:no-mailbox`). Nothing loads one any more, so the
  files under the tree are read, not the loader's roster.
- **a** Alice's read of her workstream session's board (`listTasks_tasks`) returns exactly one row
  (`a:the-row`), `completed` (`a:completed`), assigned `eng.coder` (`a:assignee`), and the coder's
  harness ran once (`a:ran-once`).
- **b** Bob and the outsider each read Storefront's entries as Shift Manager does and find Alice's
  `feature`, led by `eng.em` in her workstream session (`b:reads-the-entry`); a read with no
  verified organization is refused (`b:org-less-refused`).
- **c** Bob's and the outsider's reads of Alice's workstream session's board are refused and return
  no row (`c:rows-refused`).
- **d** the row is stored once, in Alice's storage under the workstream session's partition, naming
  its issue and phase (`d:stored-once`, `d:names-its-work`), and nowhere in the organization's
  storage (`d:no-org-copy`).

**Anti-game:** a hollow pass is a run that completes while the row sits on a board the workstream
does not hold, or a read that passes because nobody is refused anything. So the row is read where
Shift Manager reads a workstream's board, through the workstream's session, never off the drain's
report or the EM's output; the refusals are read as Bob and the outsider, each with their own
bearer, against the same session Alice read; and storage is enumerated, never looked up by the key
this check expects.

**Model:** n/a — model-free by design; the lab runs with no judge (the stub answers nothing a judge
could pass). What is graded is where the row lives and who reads it.

**Run:** `pnpm tsx goals/devforce-lab/it-keeps-its-rows-on-the-coordinators-board/run.mts`

Needs `git` and a writable temp directory. No network, no model credential.

**Controls:** `GOAL_CONTROL=em-session` has the EM file and drain on its own session's board, not
the workstream session's. The check must FAIL on `a:the-row`, *the workstream session's board holds
no row*.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-08 | `865abc573` + FIX-1788 P4 | n/a | PASS | On one copy per worker flow: a post on eng.feature ended as one completed row on the mailbox's own board, assignee coder. |
| 2026-09-30 | a1b122eb1 | n/a | PASS | Board `eng.feature.work`, one completed row assignee `coder`; the door returns it with no private field and refuses the org-less read (401); one org copy, none in user storage; no unattended-board warning. |
| 2026-09-30 | a1b122eb1 | n/a | FAIL (control `kind-ledger`) | Fails at leg 2, *the mailbox's board returned no rows*; legs 3, 4 and 5 red with it. As designed. |
| 2026-09-30 | a1b122eb1 | n/a | PASS (board renamed `queue`) | The board's name and id are read off the tree; rename reverted. |
| 2026-09-30 | origin/main lab | n/a | FAIL | Before this change: *the mailbox lists no board*. |
| 2026-10-11 | `cfafdf52`+wip (DevTeam off mailboxes) | n/a | FAIL | REWRITE, the old check on the converted tree: it fails to load (`ERR_MODULE_NOT_FOUND` for `teams/devteam/notify.mts`, removed with the mailbox wake), and its leg 0 has no subject: the tree declares no mailbox, so none holds a board. |
| 2026-10-11 | `cfafdf52`+wip (DevTeam off mailboxes) | n/a | FAIL (control `em-session`) | Fails at `a:the-row`, *the workstream session's board holds no row*. As designed. |
| 2026-10-11 | `cfafdf52`+wip (DevTeam off mailboxes) | n/a | PASS | Rewritten: Alice's `feature` session's board holds one completed row by `eng.coder`; Bob and the outsider read her entry (led by `eng.em`, in her session) and are refused the rows; the org-less read answers 401; the row is stored once under `tasks/<workstream session>~…/<id>` in her storage with `{issue, phase}`, none in the org's. The kind-ledger control went with the option it set. |
| 2026-10-11 | `7af86476` (DevTeam off mailboxes, merged with FIX-1866 P3 `f4978593`) | n/a | PASS; `em-session` FAIL (expected) | Re-run on the merged tree: Alice's workstream board holds one row completed by eng.coder; Bob and the outsider read her feature entry and are refused her board; a read with no verified organization answered 401; the row is stored once, under the workstream session. `em-session` fails at exactly `a:the-row` ("the workstream session's board holds no row"). |
| 2026-10-11 | FIX-1792 P4 on 617aeabb + uncommitted | n/a | FAIL | REWRITE, the check as it stood on P4: leg 0 read the roster's mailbox list, which P4 removed from the loader, and the run threw `Cannot read properties of undefined (reading 'length')` before the lab opened. |
| 2026-10-11 | FIX-1792 P4 on 617aeabb + uncommitted | n/a | PASS | Leg 0 now reads the tree's files for a `MAILBOX.md` (none); a planted one in a scratch tree is found. Alice's workstream session's board holds one row completed by eng.coder; Bob and the outsider read her feature entry, led by eng.em in her session, and are refused her board; the org-less read answered 401; the row is stored once under the workstream session's partition, naming its issue at implement, and nowhere in the org's storage. `em-session` targets leg a, which did not change, so it was not re-run. |
