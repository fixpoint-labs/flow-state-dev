# FIX-1779 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Proposed reader-facing prose. New prose says "worker"; existing headings and code identifiers
that say "seat" are left for the rename pass.

## UPDATE · `apps/docs/docs/workforce/mailboxes.md` · "Declaring a mailbox", the `members` paragraph

Replace the paragraph that begins "`members` is the mailbox's roster".

`members` is the mailbox's starting roster. It decides who gets woken when somebody posts, and it
is checked when a post claims to be from a particular member. The file is read when the mailbox
first opens. After that the mailbox itself is the record: an edit to `members:` does not reach a
mailbox that is already open, and a coordinator with the right tools can add and remove workers
while the app runs (see [Changing mailboxes while the app runs](#changing-mailboxes-while-the-app-runs)).
`discover` and the inventory show who is on a mailbox now.

## UPDATE · `apps/docs/docs/workforce/mailboxes.md` · "Waking agent seats"

Replace the code block and the last bullet.

```ts
const seats = hireWorkforce(workers, { kinds });
const mailboxFlows = mailboxInstances(mailboxes, {
  kinds: { mailbox: defineMailboxFlow({ notify: wakeMemberSeats(() => registry.list()) }) },
});
```

Pass a function that returns the workers your app has registered right now, usually your flow
registry's `list`. The wake calls it once per post, not once per member, so a worker hired while the app runs is
woken from its next post on, and a fired worker stops being woken. A fixed list still works, and
it never changes.

- **Nobody runs** for a member whose kind can't hear a post, or who isn't among the workers
  you passed.

## CREATE · `apps/docs/docs/workforce/mailboxes.md` · new section after "Holding a board", before "A room per project"

## Changing mailboxes while the app runs

Files describe the mailboxes a team always has. Some work needs one nobody wrote down: a
launch, an outage, a feature that turned up this morning. A coordinator worker can set one up,
put the right workers on it, and file the first task, without a deploy or a restart.

Install the capability on the kind your coordinator runs, and give it a way to open mailboxes as
your app:

```ts
import { createMailboxSetupCapability, openMailboxAtRunTime } from "@flow-state-dev/workforce";

const mailboxSetup = createMailboxSetupCapability({
  open: openMailboxAtRunTime({ client: sessionClient, userId: "u_42" }),
});
const agent = defineAgentWorkerFlow({ uses: [seatHire, mailboxSetup] });
```

Then name the tools in the coordinator's `WORKER.md`. A worker that doesn't name them can't
call them:

```md
tools: [hire, setUpMailbox, subscribeWorkers, unsubscribeWorkers, fileTask]
```

| Tool | What it does |
|---|---|
| `setUpMailbox` | Opens `<team>.<name>` with a description, a charter and members. It gets one task list, `tasks`. With `worksTaskList: true` those members also work it |
| `subscribeWorkers` | Adds workers to any mailbox on the built-in kind, including one from a file. With `worksTaskList: true` they also work its task list |
| `unsubscribeWorkers` | Takes workers off the mailbox and off its task lists, a list the file's `workedBy` names them on included. Their open tasks stay on the list |
| `fileTask` | Files a task on a mailbox's task list |

A worker hired a moment ago can be added straight away, and the next post wakes it. To make the
new mailbox one of a project's workstreams, call `setWorkstreams` as you would for any other.

Every worker name must be a worker in the organization, declared or hired, or the call is
refused by name. An id that is already a mailbox is refused too.

What these mailboxes are, and aren't:

- **They last.** A restart keeps the mailbox, its members, its task list and its tasks. Nothing
  is written to your source tree, so they are not in your repository either. If a team needs one
  for good, write its `MAILBOX.md`.
- **A file is a starting list.** Adding a worker to `eng.feature` changes that mailbox, not
  `teams/eng/mailboxes/feature/MAILBOX.md`. A later `MAILBOX.md` with the id of a mailbox a
  coordinator set up is treated like an edit to an open mailbox: its members and tasks stay,
  the file's task lists are added, and start-up names the clash.
- **No routing and no `boardActions`.** Both are set when the app starts. A coordinator posts and
  files without them.
- **No delete or rename.** An emptied mailbox stays open.

## UPDATE · `apps/docs/docs/workforce/mailboxes.md` · "What mailboxes do not do yet"

Replace the join/leave and member-name bullets with:

- No join or leave for a person's client. Workers are added and removed by a coordinator's tools.
- No resolution of member names in a `MAILBOX.md`. A file entry naming a worker that does not
  exist is accepted, and a delivery to it fails like any other. The coordinator's tools refuse one.

## UPDATE · `packages/workforce/README.md` · mailbox limits line, and the export list

Replace "No join or leave verb" with "No join or leave for a client; a coordinator adds and
removes workers with `createMailboxSetupCapability`". Add `createMailboxSetupCapability` and
`openMailboxAtRunTime` to the exports, one line each, linking the section above. Note that
`wakeMemberSeats` takes a function as well as a list.

## Publication ownership

FIX-1779 publishes all of the above in PR-B after the goal check passes. Sidebar unchanged: one
new section on an existing page. FIX-1774 documents the chief of staff's use of these tools in
the Shift Manager pages.
