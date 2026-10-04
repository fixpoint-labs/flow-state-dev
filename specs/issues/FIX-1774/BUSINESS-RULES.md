# FIX-1774 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

The cases, as rules. *Proved by* names the check the plan runs.

## Getting the request done

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A person asks for work and a worker who does that kind of work exists | No hire. One task, assigned to that worker, in the same turn, and the worker starts | Goal leg a |
| BR-2 | The person left choices open ("I don't care how") | No question about them. Defaults go in the task and are named in the reply | Goal leg a (no suspension, no question mark) |
| BR-3 | The person says "just do it" again | No hire, no clone, no second task. The reply says where the task is | Goal leg b |
| BR-4 | No worker who does that kind of work exists | One hire, of a kind the chief of staff may hire that does it, then one task assigned to the hire, in the same turn | Goal leg c |
| BR-5 | No mailbox in the person's project can hold the task | One new mailbox there, with a task list, the worker subscribed; the task is created on it | Goal leg d |
| BR-6 | The person names no project | The task goes to a mailbox the worker already takes tasks from; the reply names the project that holds it | Goal leg a |
| BR-7 | The named project has no mailbox for the work | Never a task on another project's mailbox | Goal leg d (none on `eng.feature`) |
| BR-8 | Nothing the chief of staff can do would start the work (no kind it may hire does it, or the run can't open) | No hire. The reply says what is missing | Not graded in DevTeam. Stated in the file |
| BR-9 | A hired or assigned worker doesn't start | No second hire for the same task. The reply says the task is waiting and why, if it knows | Goal leg b (no second hire) |
| BR-10 | The person mentions a harness ("with Claude Code") | No worker hired or named for it; the reply promises no harness | Goal leg a |
| BR-11 | Any request for work | The reply never says the chief of staff can't direct or hand off work, and never offers a spec instead | Goal leg a |
| BR-12 | The person explicitly asks to hire a worker | It hires, as today, and creates no task | `goals/org-seats/cos-changes-the-roster` hire leg, unchanged |

## What this issue owns

- The chief of staff's behaviour on a request for work in the DevTeam Lab (BR-1 to BR-11).
- The chief of staff's read of the projects.
- Not owned: the verbs it calls. A post starting its worker is
  [FIX-1777](https://linear.app/fixpoint-labs/issue/FIX-1777); assigning a task to a named worker is
  [FIX-1778](https://linear.app/fixpoint-labs/issue/FIX-1778); setting up a mailbox is
  [FIX-1779](https://linear.app/fixpoint-labs/issue/FIX-1779). Also not owned: where a run's files
  come from ([FIX-1762](https://linear.app/fixpoint-labs/issue/FIX-1762)), the project list
  refreshing ([FIX-1761](https://linear.app/fixpoint-labs/issue/FIX-1761)), stored workers' doors
  ([FIX-1732](https://linear.app/fixpoint-labs/issue/FIX-1732)).

## Failures a person can see

| What happened | What the person reads |
|---|---|
| No kind it may hire does the work | "Nobody here does <kind of work>, and I can't hire a worker who does. <What would fix it>." |
| A tool refused (a hire, a mailbox, a task) | The refusal, in a sentence. No retry with a different worker |
| The run fails | Shown on the task, as today. The chief of staff is not told |
