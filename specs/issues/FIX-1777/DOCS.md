# FIX-1777 · Docs

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

Four updates to pages that exist. No new page and no sidebar change: the behaviour belongs to the
mailbox's task list, which already has a section. Write "worker", never "seat", in every sentence
added; leave the rest of each page's wording alone. FIX-1778 and FIX-1779 add their own sections
to the same mailboxes page (assigning by name; lists made at run time); this draft owns only what
happens when a task is added.

## 1 · Update `apps/docs/docs/workforce/mailboxes.md` — the task list section

Replace the paragraph that starts "The mailbox keeps the ledger. It runs nothing. A worker that
claims rows declares the same board and drains it:" and its `actions: { drain: … }` example with:

> The mailbox keeps the list and hands its tasks out. When a task is added, whichever way it got
> there (`fileTask`, a board tool, or a worker adding to its own list), the mailbox runs the list
> in a request of its own and gives the task to the worker it's for: the worker it names, or the
> list's first worker if it names none. Whoever filed the task gets their answer straight away;
> they don't wait for the work.
>
> A worker on a list needs only a task door. It doesn't declare the list or run it:
>
> ```ts
> defineFlow({
>   kind: "builder",
>   task: { work: { block: doTheWork } },
> });
> ```
>
> The run belongs to whoever filed the task. Two people filing on one list each get their own
> runs, and one person's filing never starts the other's task.
>
> Filing starts work right away. If the worker runs a paid coding agent, every task you file is a
> run you pay for. To ask a person first, put an approval step before the filing.
>
> If no worker works the list, the task is filed and waits, and `fileTask` says so.

## 2 · Update `packages/workforce/README.md` — the mailbox boards section

Replace "The mailbox owns the ledger and runs nothing. A seat that claims rows resolves the same
declaration with `mailboxBoard`, declares it as a resource, and drains it" with:

> The mailbox owns the list and hands each added task to its worker, in a request of its own and
> as whoever filed it. A worker on the list needs only a task door.

## 3 · Update `labs/shift-manager/README.md` — the `devteam` bullet under *Team profiles*

After "The EM answers every line posted in a project's room.", add:

> A line posted on a workstream as `slug: what to build` is filed as a task and the coder starts
> on it right away, with no approval first. With `DEVFORCE_LAB_HARNESS=claude-code` set, each new
> slug is a coding run your model key pays for. Posting the same slug again starts nothing.

In *What a coding run is handed*, "When you approve a feature in Inbox, or post `slug: what to
build` on a workstream, …" stays as it is: it becomes true.

## 4 · Update `apps/docs/docs/shift-manager/overview.md` — the `devteam` paragraph

After "On start the EM asks you to approve one feature, so Inbox has something in it.", add:

> You can also skip Inbox: post `slug: what to build` on the feature workstream's Stream and the
> coder starts on it at once. There's no approval step on that path, so with a real coding agent
> configured, every new slug costs a run.

**Voice watch:** no em-dashes added; introduce *task list* on first use as the mailbox's list of
tasks, as the page already does.

## Not changed

- Orchestration's task board docs: a board you run yourself still runs when you drain it.
- `goals/devforce-lab/lab/README.md` is a check's notes, updated in PR 2, not site docs.
