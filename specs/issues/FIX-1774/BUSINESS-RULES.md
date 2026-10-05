# FIX-1774 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

*Proved by* names the check: a goal leg, a package test, or "stated" when only the instructions
carry it.

## Use cases

| # | Case | The coordinator | Proved by |
|---|---|---|---|
| U1 | Work a worker already does ("build a hello-world app") | Files one task for that worker on the list it works. No hire | Leg a |
| U2 | The same ask again | Nothing new; says where the task is | Leg b |
| U3 | Work nobody does ("audit our dependencies' licenses") | Hires one worker with a description, subscribes it to a list, files the task for it | Leg c |
| U4 | A new project needing several kinds of work | Creates the project, sets up a mailbox with a task list per kind of work, staffs each, files the first tasks | Leg d |
| U5 | A list nobody works (kitchen-sink escalations) | Subscribes or hires a worker for it | Follow-up adopter |
| U6 | Tasks queue behind one busy worker | Hires a second of that kind onto the list | Stated |
| U7 | A filed task fails or blocks | Reassigns, re-staffs, or tells the person | Leg e |
| U8 | Another worker asks the coordinator for help | Treats it as a person's ask | Stated |
| U9 | No kind it may hire does the work, or the run can't open | Says what is missing. No hire | Stated |

## Rules

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A worker who fits exists | No hire. The task is filed for that worker | Leg a |
| BR-2 | No worker fits | One hire, of a kind the app allows, with a description, before the task is filed for it | Leg c |
| BR-3 | No mailbox fits the work in the person's project | One new mailbox there, with a task list and its workers subscribed, before the task is filed | Leg d |
| BR-4 | The person waived choices | No question about them; defaults in the task, named in the reply | Legs a, d (no suspension, no question mark) |
| BR-5 | The same ask again | No new task, hire or mailbox | Leg b |
| BR-6 | A worker it hired or filed for doesn't start | No twin. The reply says the task is waiting | Stated |
| BR-7 | A task it filed fails for good or parks | The notice wakes it in the conversation it filed from; that turn reassigns or cancels the task, or tells the person, naming the task. A task that has moved three times goes to the person | Leg e |
| BR-8 | A person names a project | Work for it lands on that project's mailboxes, never another project's | Leg d |
| BR-9 | The view, any turn | Lists the organization's projects and mailboxes, each mailbox's description, task lists and the workers who work each list, and the status of tasks this coordinator filed. Not who is on a mailbox (that is `discover`'s `facts.members`). Nothing from another organization | Package test |
| BR-10 | An app composes the capability with `presets({ job: false })` | The tools and the view stay; the job's instructions don't | Package test |
| BR-11 | A hire passes a description | It becomes the worker entry's `purpose`, which the view and purpose routing read | Package test |
| BR-12 | A person explicitly asks to hire | It hires as today and files nothing | `goals/org-seats/cos-changes-the-roster` |
| BR-13 | Any ask | The reply never says the coordinator can't route or hand off work, never offers a spec instead, and promises no harness | Leg a |

## What this issue owns

- The coordinator capability: its view, its job, its bundle (BR-9 to BR-11).
- The coordinator's behaviour across the use cases (BR-1 to BR-8, BR-13), proved on DevTeam.
- Not owned: a task starting its worker ([FIX-1777](https://linear.app/fixpoint-labs/issue/FIX-1777));
  what an assignee names ([FIX-1778](https://linear.app/fixpoint-labs/issue/FIX-1778)); setting up,
  subscribing and filing ([FIX-1779](https://linear.app/fixpoint-labs/issue/FIX-1779)); hearing how a
  task ended and reassigning ([FIX-1780](https://linear.app/fixpoint-labs/issue/FIX-1780)).

## Failures a person can see

| What happened | What the person reads |
|---|---|
| No kind it may hire does the work | "Nobody here does <work>, and I can't hire someone who does. <What would fix it>." |
| A tool refused | The refusal in a sentence. No retry with a different worker |
| A task failed and reassigning didn't help | Which task, what failed, and that it stopped trying |
