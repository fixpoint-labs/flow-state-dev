# FIX-1779 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Each says what a coordinator or the system does and what happens.
The *proved by* column is the check the plan runs.

## Setting a mailbox up

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A coordinator sets up `<team>.<name>` with a description, a charter and members | The mailbox opens with those members and that charter, one task list named `tasks` worked by those members, and an inventory row marked as set up at run time | CI · goal check |
| BR-2 | The id is already a mailbox (from a file, or set up earlier) | Refused, naming the mailbox. Nothing is opened or changed | CI |
| BR-3 | The team does not exist, or the name breaks the file naming rule | Refused, naming the problem | CI |
| BR-4 | A member names no worker in the caller's org (declared or hired) | Refused, naming the worker. Nothing is opened | CI |
| BR-5 | The app restarts | The mailbox, its members, its task list, who works it and its tasks are all as they were. Opening the file mailboxes does not touch it | CI on a durable store · goal check |
| BR-6 | A `MAILBOX.md` with the same id appears later | The app refuses it at start, naming the mailbox the coordinator set up. It never silently takes the other's place | CI |

## Adding and removing workers

| # | When | Then | Proved by |
|---|---|---|---|
| BR-7 | A coordinator subscribes workers to any mailbox, a file mailbox included | Each becomes a member. The next post wakes the ones whose kind hears posts. The inventory row follows | CI · goal check |
| BR-8 | The worker was hired a moment ago | It is woken on the next post, with no restart | CI · goal check |
| BR-9 | Subscribed with `worksTaskList` | The worker is also recorded as working the mailbox's task list. Without it, it is a member only | CI |
| BR-10 | A worker is subscribed twice | Nothing changes the second time. Not an error | CI |
| BR-11 | A coordinator unsubscribes a worker | It stops being a member and stops working the list. The next post does not wake it. Its open tasks stay on the list | CI · goal check |
| BR-12 | Unsubscribing leaves no members | The mailbox stays open and empty. It is not deleted | CI |
| BR-13 | Two coordinators change one mailbox's members at once | Both changes land. Neither is lost | CI · concurrent writes |
| BR-14 | A worker is fired | Its memberships are left as they are and the wake skips it, because the host no longer lists it. Removing it is the coordinator's call (`unsubscribeWorkers`) | CI |

## Task lists

| # | When | Then | Proved by |
|---|---|---|---|
| BR-15 | A coordinator files a task on a mailbox's task list | The task is on that list, readable the same way as a file list's task | CI · goal check |
| BR-16 | The list does not exist on that mailbox, or the task names an assignee no worker holds | Refused, naming the lists it has, or the assignee | CI |
| BR-17 | Two run-time mailboxes each have a `tasks` list | Neither ever sees the other's tasks | CI |
| BR-18 | Something asks which workers work a list | One answer for file lists and run-time lists: the workers whose files declare it, plus those recorded on the list | CI |

## Finding it

| # | When | Then | Proved by |
|---|---|---|---|
| BR-19 | `discover` lists mailboxes | A mailbox set up at run time is listed beside file mailboxes, with its live members | CI · goal check |
| BR-20 | `setWorkstreams` names it | Accepted, as for a file mailbox. A workstream still belongs to at most one project | CI · goal check |

## Who may

| # | When | Then | Proved by |
|---|---|---|---|
| BR-21 | A worker's `tools:` does not name a tool | It can't call it. An empty `tools:` reaches none | CI |
| BR-22 | Tool input names an org | Ignored. The org is the caller's | CI |
| BR-23 | A person's client calls post, read or session state on a mailbox | No member, task-list or worker field is writable that way | CI |

## Failure taxonomy

Every refusal names what was wrong, changes nothing, and is returned to the calling worker as
a tool error it can act on. Open, then write the inventory row: if the open succeeds and the
row write fails, the next open or subscribe on that mailbox writes the row again, so a
failure never leaves a mailbox the coordinator can't find twice. Nothing retries on its own.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): a hired worker subscribed at run time
is woken by posts on a new mailbox and on a file mailbox, a removed member is not, the task
sits on the new list, and all of it holds after a restart. The same run fails under
`GOAL_CONTROL=boot-wake`.
