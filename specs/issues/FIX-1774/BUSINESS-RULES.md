# FIX-1774 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

The cases, as rules. *Proved by* names the check the plan runs: a goal leg, CI, or a model-free
lab test.

## A coding ask

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A person asks for code and `eng.coder` exists | No hire. One `post-to-mailbox` on `eng.feature`, shaped `<slug>: <what>`, in the same turn | Goal leg a |
| BR-2 | The person left choices open ("I don't care how") | No question about them. Defaults go in the line and in the reply | Goal leg a (a row exists, no suspension, the reply holds no question) |
| BR-3 | The person says "just do it" again after a hand-off | No hire, no clone, no second row | Goal leg b |
| BR-4 | The person names no project | The ask goes to `eng.feature`; the reply names the project that holds it, read from the stored projects | Goal leg a (reply names Storefront) |
| BR-5 | The person names a project none of whose workstreams the coder works from | No hire, no post. The reply names that project, says it can't run coding work yet, and names the project that can | Goal leg c |
| BR-6 | No worker in the Lab does coding work | No hire. The reply says plainly that nothing here can take coding work ([D1](DECISIONS.md#d1)) | Not graded in DevTeam, which has `eng.coder`. Stated in the file |
| BR-7 | The person mentions a harness ("with Claude Code") | No worker hired or named for it; the reply promises no harness | Goal leg a (no hire) |
| BR-8 | Any coding ask | The reply never says the chief of staff can't direct, route or hand off work, and never offers a spec instead | Goal leg a (no spec offer, no "can't route") |
| BR-9 | The person explicitly asks to hire a worker | It hires, as today | `goals/org-seats/cos-changes-the-roster` hire leg, unchanged |

## The post door

| # | When | Then | Proved by |
|---|---|---|---|
| BR-10 | A line shaped `<slug>: <what>` lands on `eng.feature` and files a new row | The board runs in the same delivery and hands the row to `eng.coder` | Lab test · goal leg a |
| BR-11 | The slug already has a row | Nothing filed, the board is not run again | Lab test, with another row left *pending* to catch an extra run |
| BR-12 | The line doesn't name a feature | Nothing filed, nothing run, as today | Lab test (existing) |
| BR-13 | A person, not the chief of staff, posts the shaped line | The same as BR-10. The run belongs to the poster | Lab test |
| BR-14 | The EM's Inbox ask is approved or denied | Unchanged: Approve files and runs; Deny files nothing | `goals/devforce-lab/it-waits-for-a-person-before-it-files` |

## What this issue owns

- The chief of staff's coding-ask behaviour in the DevTeam Lab (BR-1 to BR-8).
- The feature workstream's post door starting the run it files (BR-10 to BR-13).
- Not owned: where the run's files come from ([FIX-1762](https://linear.app/fixpoint-labs/issue/FIX-1762)),
  coding work for any project ([FIX-1763](https://linear.app/fixpoint-labs/issue/FIX-1763)),
  the project list refreshing ([FIX-1761](https://linear.app/fixpoint-labs/issue/FIX-1761)),
  stored workers' doors ([FIX-1732](https://linear.app/fixpoint-labs/issue/FIX-1732)).

## Failures a person can see

| What happened | What the person reads |
|---|---|
| Project has no coding workstream | "<Project> has no workstream the coder works from, so I can't start coding work there yet. Storefront's `eng.feature` can take it." |
| The post was refused by the mailbox | Nothing comes back today (`post-to-mailbox` does not report a refusal). The reply says where the task should appear, so the person can see it is missing. Not fixed here |
| The run fails | Shown on the task, as today. The chief of staff is not told |
