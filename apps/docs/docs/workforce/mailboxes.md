---
title: Mailboxes
sidebar_position: 4
sidebar_label: Mailboxes
description: "A mailbox is one addressable conversation that several agents and people can post into, with one durable transcript. Posting hands nobody the work; a board the mailbox holds is where work someone takes and finishes lives."
---

# Mailboxes

Several agents working one topic. Each of them reads what the others said. Posting hands nobody the work, and the conversation needs somewhere to live that outlasts whoever spoke last. When the talk does produce work somebody has to take and finish, the mailbox can hold a board for it.

That is a mailbox: one address, one conversation, any number of writers. The framework ships the flow that runs mailboxes, and each mailbox you open is a named session on it.

A mailbox can also be [routed](#routing-a-mailbox). A post someone sends then goes to the one member whose job fits it, and that member answers in the mailbox. A support desk works that way: the printer question goes to the devices specialist, and nobody else hears it.

## What a mailbox is

![Where each part of a mailbox lives. The mailbox kind is one registered instance, and every mailbox is a session on it. The support.desk session holds its members and charter in session state, and its transcript as mailbox-post items, with mailbox-route items recording where a routed post went. A woken seat answers from a session of its own. A post is checked against the members in the session's state, never the inventory's copy. The board's rows live in the organization's task ledger, under the mailbox's id plus the board's name, and the board names are read from MAILBOX.md at every start. The inventory row is organization data too: a copy of the members, for finding which mailboxes a seat is in. Only the seat's answer line reaches the mailbox.](./mailbox-parts.svg)

Each mailbox is a session on a mailbox kind, the built-in `mailbox` unless its file names another. Look at what sits inside the session (members, charter and transcript) and what sits outside it (a member's seat, the board's rows, the inventory row). A post's `author` is checked against the members in the session. The inventory's list is only for finding which mailboxes a seat is in.

:::tip When a mailbox, and when something else

1. **One-shot, "go do this" → a dispatch** into that flow's own session. Nothing about it wants a shared transcript.
2. **Back-and-forth, "keep talking" → a mailbox**, when you want one durable home for the history and posts that land on the mailbox rather than on the poster. A direct message is a mailbox whose roster is two members, not a separate mechanism.
3. **Claim it and settle it → a [board the mailbox holds](#holding-a-board).** A row somebody takes and finishes is a [task board](../orchestration/task-substrate.md)'s job, and a mailbox can keep one so the talk and the work share an address. A board with no conversation around it needs no mailbox.
4. **Do not fake a DM by dumping the dialogue into a worker's session.** Session history is machinery: tool calls, refusals, dispatch handles. A mailbox is what owns a clean transcript.
5. **Do not hand somebody work by posting it.** A post runs in the mailbox's session and waking members is a notification; neither one gives anybody a row to claim. File it on a board.

:::

## Declaring a mailbox

A mailbox record is three things: an id, some frontmatter, and a body. The body is the mailbox's charter.

```md
---
description: Where the engineering team posts daily status.
members: [engineering.lead, engineering.analyst]
---

Post what you finished, what you're on, and what's blocking you.
```

No line says which kind it runs. An omitted `flow:` selects the built-in, which is the common case and the reason the first mailbox you write carries no configuration at all.

`members` is the mailbox's roster. It decides who gets woken when somebody posts, and it is checked when a post claims to be from a particular member. It is the declared list and nothing else writes it: there is no join or leave verb yet, so changing who is in a mailbox means editing the record and opening a fresh mailbox. An edit to `members` does not reach a mailbox that is already open.

Eight keys are declarable: `flow`, `description`, `members`, `boards`, `instructions`, `routing`, `boardActions` and `mintFor`. [Routing a mailbox](#routing-a-mailbox) covers `routing`, [Holding a board](#holding-a-board) covers `boards` and `boardActions`, and [A room per project](#a-room-per-project) covers `mintFor`. The list is closed. Anything else is refused by name when you bind the roster, along with an `id:`, a `system:`, and a body given alongside `instructions:`.

## Mailboxes on disk

That record has a home on disk, in the same tree as [workers](./workers-on-disk.md) and [documents](./documents-on-disk.md). One folder per mailbox, grouped by team:

```
workforce/
  teams/
    engineering/
      mailboxes/
        standup/
          MAILBOX.md
        incidents/
          MAILBOX.md
    marketing/
      mailboxes/
        standup/
          MAILBOX.md
```

A mailbox is a folder with a fixed file in it, the way a worker is a folder with a `WORKER.md`. The `MAILBOX.md` is the record above: frontmatter, then the charter. Someone who does not write TypeScript can add a fourth mailbox, or rewrite what one of them is for, by editing a file.

Point `readMailboxesDirectory` at the root:

```ts
import { readMailboxesDirectory } from "@flow-state-dev/workforce/loader";

const { mailboxes, errors } = await readMailboxesDirectory("./workforce");
```

You get one record per mailbox:

```ts
interface MailboxManifest {
  id: string;                        // "engineering.standup"
  declared: Record<string, unknown>; // the frontmatter, exactly as written
  body: string;                      // the charter below it, verbatim
}
```

`mailboxes` is the array `mailboxInstances` and `openMailboxes` take. Reading the tree opens nothing. No instance is registered and no session exists yet.

`@flow-state-dev/workforce/loader` imports `node:fs`, so it only runs on Node. The package root, where the binding calls live, is server code too. It reaches Node built-ins through the packages it builds on, so it is server-only. A browser component takes the names it needs from `@flow-state-dev/workforce/browser`, the one entry that reaches no Node built-in.

### A mailbox's id comes from the folders

The team folder and the mailbox folder, joined with a dot. `teams/engineering/mailboxes/standup/` becomes `engineering.standup`, which is the mailbox's session id: the id you address when you post to it. The team qualifier means marketing can have a `standup` of its own without checking what engineering called theirs.

Both folder names follow [the tree's name rule](./workers-on-disk.md#names-in-the-tree): lowercase letters, digits and single hyphens, at most 64 characters. So `daily-standup` is fine. `Stand Up` and `stand.up` are reported when the tree is read, with the rule in the message.

### What the file is checked for

`description` is the only key the file itself requires, and `system:` the only one it refuses. Everything else lands on `declared` spelled exactly as you spelled it, and the closed list of eight keys is checked later. So a `MAILBOX.md` that says `member:` instead of `members:` reads without complaint and is refused by name when you bind the roster.

### When a folder is wrong

A folder that should have produced a mailbox and did not lands in `errors`, and the rest of the mailboxes load anyway. Say the lounge folder holds other files but no `MAILBOX.md`:

```ts
errors;
// [{ kind: "mailbox-load-failed",
//    path: "teams/engineering/mailboxes/lounge",
//    error: Error('Mailbox folder "lounge" has no MAILBOX.md. A mailbox folder declares
//                  one mailbox, and every mailbox is a MAILBOX.md. …') }]
```

`path` is slash-separated and relative to the root you passed, so it starts at `teams/`. It names the folder that failed so you can go find it. It is not a path you can open.

`kind` names the condition, so a caller can tolerate one class and still refuse another:

| `kind` | When |
|--------|------|
| `mailbox-load-failed` | One mailbox folder did not load: a folder name that breaks the rules, a symlinked folder, or a `MAILBOX.md` that is missing, unreadable, carries no frontmatter, or declares no `description`. |
| `refused-declaration` | The file declares `system:`. |
| `unreadable-slot` | A structural folder is a symlink or exists and cannot be listed: `teams`, a team folder, or a team's `mailboxes`. The mailboxes beneath it cannot be enumerated, so the folder is reported under its own path. |
| `pre-rename-record` | A `CHANNEL.md`, or a team's `channels/` folder, from before mailboxes were renamed. One entry per old file, or one for a folder holding none, and the message names where it belongs now. Nothing in it is read. See [Upgrading from channels](#upgrading-from-channels). |

`readMailboxesDirectory` throws only about the root you passed: when it cannot be read at all, and when it is a symlink. Links are never followed at any level of the walk. A root with no `teams/` comes back as `{ mailboxes: [], errors: [] }`, and a team with no `mailboxes/` folder is not an error either.

A file sitting loose in a `mailboxes/` folder is passed over in silence, so a `README.md` next to the mailbox folders is fine, as are OS and editor droppings such as `.DS_Store`.

#### Treat a non-empty `errors` as fatal

```ts
const { mailboxes, errors } = await readMailboxesDirectory("./workforce");
if (errors.length) {
  throw new Error(
    `mailboxes: ${errors.length} mailbox(es) failed to load\n` +
      errors.map(({ path, error }) => `  ${path}: ${error.message}`).join("\n"),
  );
}
```

A reported folder is a mailbox your app was supposed to have. Log a warning and carry on, and the app boots with a team that has nowhere to talk. Fail at startup unless you have a specific reason to boot without it.

## Opening it, and why an unopened id is not a mailbox

Binding happens in two calls, because the two halves happen at two different times. An instance is registered when the server is built. A session can only be opened once the server is running.

```ts
import { mailboxInstances, openMailboxes } from "@flow-state-dev/workforce";

// Build time. One instance per distinct kind, not one per record.
flowRegistry.registerMany(mailboxInstances(mailboxes));

// Runtime. One named session per record, at the record's own id.
await openMailboxes(mailboxes, { client: sessionClient, userId: "u_42" });
```

`openMailboxes` is idempotent: a mailbox that is already open is left alone, so re-running it over an unchanged roster does nothing. Re-opening is not a migration, though. `members`, the charter and `description` are written when a mailbox is created and keep whatever they were opened with, and `flow` is settled then too, since it picks the session's kind. Add a member or rewrite a charter and a mailbox that is already open does not see it.

`boards` is the exception. The [board](#holding-a-board) list is built from the files on every bind and is never stored on the mailbox, so a board added to an open mailbox's file is usable the next time you run.

Re-running does repair one thing: a mailbox whose id was claimed by a post before it was opened. That leaves an empty session, and re-running binds it. An empty session is the only thing it will clear out of the way. If the id is held by something else, such as a session belonging to another flow or another user, or one carrying state that is not a readable mailbox, `openMailboxes` names it and stops. If that happens, rename the mailbox.

The one registered instance answers for every session id, and naming a session that does not exist creates an empty one rather than refusing. So a mailbox is not "a session id somebody used". It is a session that was opened as a mailbox, carrying members and a charter. Post to an id nobody opened and you get `mailbox-not-bound`, nothing is written, and the empty session stays inert.

### Which organization a mailbox runs in

Every mailbox session runs in an organization, and your app does not name it. The server binds it from the caller's verified identity, which is whatever your [`resolvePrincipal`](../server/authentication.md#every-request-runs-in-an-organization) returned. An app that configures no authentication gets the reserved `DEFAULT_ORG_ID` instead, which is the development case.

Storage at organization scope resolves against that organization inside the mailbox. [Documents read from the tree](./documents-on-disk.md) are org-scoped, and so are the rows on a [board the mailbox holds](#holding-a-board). A worker woken by a post runs in the mailbox's organization too, so the same documents resolve for it.

A session's organization is fixed when the session is created, and re-opening cannot move it. Open your mailboxes as a caller whose verified identity already carries the organization you want them in.

## Posting and reading

A mailbox has two actions, `post` and `read`, reachable both by a client and by another flow. A client `post` and a dispatched `post` are the same kind of line: neither is a seat's. `read` is the same call either way.

```ts
const postToStandup = dispatcher({
  name: "post-to-standup",
  flowKind: "mailbox",                          // the shared instance
  action: "post",
  inputSchema: z.object({ body: z.string() }),
  session: { id: () => "engineering.standup" }, // the mailbox
  payload: (input) => ({ body: input.body, author: "engineering.lead" }),
});
```

The flow you address is the **kind**; the mailbox is the **session id**. Address `{ id }`, never `{ key }`: a key-derived session is a child of whoever dispatched it, so the same key lands somewhere different for every poster and the mailbox never sees the post. Nothing detects that mistake.

That dispatch is a `post`. It does not set `seatAuthored`, so [`wakeMemberSeats`](#waking-agent-seats) wakes hearing members, whether or not the payload sets `author`. `author` is an unverified label. It has to name a declared member, or the post is refused (`author-not-a-member`) and nothing is written. A seat's `post-to-mailbox` tool and a routed answer are the lines with `seatAuthored: true`, and those wake nobody.

Over HTTP the address is the same: the kind where the flow goes in the URL, and the mailbox's id where the session goes.

```bash
curl -X POST https://your-app.example/api/flows/mailbox/engineering.standup/actions/post \
  -H 'content-type: application/json' \
  -d '{"userId":"u_42","input":{"body":"shipped the reader"}}'
```

The call answers `202` with the request it started. The action's return value isn't part of that answer, so read the posted lines from the session's items, as [Showing a mailbox on screen](#showing-a-mailbox-on-screen) does.

That HTTP call is a client `post`. It may include `author`. The line keeps that claim with `authorVerified: false`, and it never has `seatAuthored`, including when `author` is set. `wakeMemberSeats` wakes each hearing hired member on it, whether or not `author` is set. A woken seat of the built-in `agent` kind sees the writer as `author`, or as `principal` when there is no `author`. An `author` who is not a declared member is refused (`author-not-a-member`) and nothing is written.

`read` gives back the mailbox: its description, its members, and the transcript.

```ts
{
  id: "engineering.standup",
  description: "Where the engineering team posts daily status.",
  members: ["engineering.lead", "engineering.analyst"],
  transcript: [
    { id: "4f2c1a90-6d3e-4b17-9f22-0c8a7e5b1d43", at: 1789231233813,
      principal: "u_42", author: "engineering.lead",
      authorVerified: false, body: "shipped the reader" },
  ],
}
```

That line is a client `post` that set `author`. `authorVerified` is `false`. There is no `seatAuthored`. The same body through the dispatcher above is the same kind of line.

`read` takes no input on a mailbox. An `after` cursor is ignored there: it only means something on a [project's talk session](#a-room-per-project).

The transcript is the mailbox's `mailbox-post` items and nothing else from its history, which also carries fan-out requests, dispatch handles and refusals. `read` returns the recent lines: the ones inside the session's history window, which is 50 requests by default. On a mailbox with a notify block, each post uses two of them.

Posts on one mailbox are serialized, so two that land at once both make it into the transcript. Posts on two different mailboxes never wait on each other, because they are different sessions.

### Showing a mailbox on screen

A browser never receives an action's return value, so `read` is no help to a page. Each post leaves one `mailbox-post` item on the mailbox's session, carrying the line, and a page reads those the way it reads any conversation:

```tsx
const mailbox = useSession("engineering.standup", { flowKind: "mailbox", items: { itemTypes: ["component"] } });
const lines = mailbox.items
  .filter((item) => item.type === "component" && item.component === "mailbox-post")
  .map((item) => item.data as MailboxTranscriptLine);
```

The mailbox's members and charter never reach the page.

To post from the page, call the mailbox's own action on the same session:

```tsx
await mailbox.sendAction("post", { body });
```

`post` takes `{ body, author? }`. `author` is an unverified label, kept on the line with `authorVerified: false`. An `author` who is not a declared member is refused (`author-not-a-member`) and nothing is written. It does not decide who `wakeMemberSeats` wakes. A client `post` wakes each hearing hired member whether or not you set `author`. `principal` is the identity your server resolved for the request, and it is the same on every line of the mailbox.

An agent's answer, or a post from another tab, is a request the page didn't send. Add `live: true` and it appears within about a second, with no reload:

```tsx
const mailbox = useSession("engineering.standup", {
  flowKind: "mailbox",
  items: { itemTypes: ["component"] },
  live: true,
});
const busy = mailbox.childSessions.filter((run) => run.status === "active");
```

`busy` lists the runs posts have started that haven't finished. Each row's `flowId` is the seat's address, so the page can say who is working.

## What the transcript proves, and what it doesn't

A session belongs to one user. That means **every line of a given mailbox carries the same `principal`**, the server-derived identity the post ran under. It is a real value and the framework sets it, but it does not name the poster, because it is the same on every line.

`author`, when the caller set one, is an unverified label. The line stores it beside `authorVerified: false`, and `authorVerified` is always `false`. There is no verified per-participant identity on a line. A post claiming an `author` who is not in the mailbox's members is refused (`author-not-a-member`) and nothing is written. That check is against the declared roster, not proof of who is calling.

A line a seat wrote also has `seatAuthored: true`. A client `post` never does, including one that sets `author`. `wakeMemberSeats` does not wake anyone for a line with `seatAuthored: true`. `seatAuthored` is not a verified name.

A mailbox transcript shows that the mailbox's own principal ran the post. It is close to no evidence about which member did. If you are building an audit trail or an approval flow, these fields give you a much weaker guarantee than their names suggest.

## Waking members

By default a post lands and nobody is told. Give the kind a notify block and it runs once per declared member per post:

```ts
mailboxInstances(mailboxes, { kinds: { mailbox: defineMailboxFlow({ notify: wakeMember }) } });
```

Each call carries one delivery: the mailbox, the member it is addressed to, and the post. The roster it walks is the whole declared list, the poster included, so the block is called for the member who just wrote.

```ts
import { handler } from "@flow-state-dev/core";
import { mailboxNotifyInputSchema, type MailboxNotifyInput } from "@flow-state-dev/workforce";
import { z } from "zod";

const wakeMember = handler({
  name: "wake-member",
  inputSchema: mailboxNotifyInputSchema,
  outputSchema: z.object({ notified: z.string() }),
  execute: (input: MailboxNotifyInput) => {
    // { mailboxId, member, postId, body, principal, author?, seatAuthored?, routed?, recent? }
    if (input.seatAuthored === true) return { notified: "" };
    // send to whatever address you hold for `input.member`
    return { notified: input.member };
  },
});
```

`seatAuthored` is `true` on a seat's own post and absent otherwise. Skip on `true` and nobody is told about that post. `author` is an unverified claim. Comparing `input.author` to `input.member` only skips a delivery when the caller claimed that name, which a client `post` can do without being a seat. `principal` is the mailbox session's user and is the same on every line, so it does not name the poster.

The delivery runs in its own request, outside the post's turn, so a slow notification never delays the next post. A delivery that fails is recorded and the rest are still attempted; the post stays written either way, because the transcript is the durable record and waking people is best-effort.

Your app supplies the addresses. The `notify` slot takes any block, so to reach real recipients, make it a router rather than a handler. Declare one dispatcher per recipient, like the one in [Posting and reading](#posting-and-reading), with `flowKind` set to that recipient's address. Pick which one runs from `input.member`. [`utility.keyedRouter`](../fundamentals/blocks.md#keyedrouter) does that lookup, and its `fallback` takes any member you have no dispatcher for. For agent seats you don't have to build this yourself: see [Waking agent seats](#waking-agent-seats).

### Waking agent seats

Most apps want a post to reach the agents in the mailbox and nobody else. Workforce ships that as
one call. Hand `wakeMemberSeats` the seats you hired, and put what it returns in the notify slot:

```ts
import {
  mailboxInstances,
  defineMailboxFlow,
  hireWorkforce,
  wakeMemberSeats,
} from "@flow-state-dev/workforce";

const seats = hireWorkforce(workers, { kinds });   // hire first: the wake reaches these seats
const mailboxFlows = mailboxInstances(mailboxes, {
  kinds: { mailbox: defineMailboxFlow({ notify: wakeMemberSeats(seats) }) },
});
```

For each post, it decides per member whether that member runs:

- **A member runs** when the line is not a seat's (`seatAuthored` is absent) and the member's seat
  can hear a post. A client `post` is that line, whether or not it sets `author`. A seat of the
  built-in `agent` kind can hear a post. It runs its ordinary answer, with the post as its turn,
  `<writer> in <mailbox>: <body>`. The writer is the post's `author`, or its `principal` when there
  is no `author`: `support.lead in support.desk: can someone look at the refund queue?`.
- **Nobody runs** when the line is a seat's (`seatAuthored: true`). A seat's `post-to-mailbox`
  call and a routed answer are that line. A post another flow dispatches with action `post` is not.
  A member that would have run
  gets nothing at all. Members whose seat can't hear a post get `fallback`, or nothing if you
  passed none. The fallback is not sent to a member who would have been woken. To have
  agents hear a seat's post, write your own notify block and run it when `seatAuthored`
  is `true`.
- **Nobody runs** for a member whose kind can't hear a post, or who has no seat in the list you
  passed. A seat hired while the app is running isn't in that list until the app restarts and
  passes it in.

If the same seat id appears more than once (in several organizations, or owned by several users),
the one the mailbox's caller can reach runs, in this order: their own, the organization's, a shared
one. To wake fewer seats, pass fewer.

Each woken seat keeps one conversation per mailbox. The second post it hears lands in the same
conversation, so it remembers the thread. Two posts that arrive together each run once, in no
guaranteed order. The conversation is a child of the mailbox's session, so an ordinary session
listing does not show it. List with dispatch runs included (`include: "dispatch-runs"`, or
`includeDispatchRuns` on `FlowNavigator`) to find it.

A busy mailbox keeps growing each seat's conversation, and a seat remembers only as far back as
its history window reaches. Nothing summarizes older posts for it.

Members whose seat can't hear a post get nothing, the same as a mailbox with no notify slot. To
send them something else, pass a `fallback` block. It runs for those members on every post, and
never for a member the wake would have run. It receives the same input a notify block does:

```ts
defineMailboxFlow({ notify: wakeMemberSeats(seats, { fallback: tellByEmail }) });
```

On a seat's line, members whose seat can't hear a post get the fallback. To skip a seat's line in a block of your own, read
`input.seatAuthored === true`, as the handler earlier on this page does. `author` is an unverified
claim, so comparing it to `member` only skips a delivery when the caller claimed that name.

#### Making a kind of your own hear posts

A kind can hear a post by declaring an internal entry named `onMailboxPost` that takes
`MailboxNotifyInput`. An internal entry is one only a dispatch can reach, never a client. That
declaration is all `wakeMemberSeats` looks for.

```ts
import { defineFlow } from "@flow-state-dev/core";
import { mailboxNotifyInputSchema, workerConfigSchema } from "@flow-state-dev/workforce";

export const triager = defineFlow({
  kind: "triager",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  actions: { run: { block: triage } },
  internal: {
    actions: { onMailboxPost: { inputSchema: mailboxNotifyInputSchema, block: triageFromPost } },
  },
});
```

#### What `author` is

`author` is an optional label on a `post`. The line keeps it with `authorVerified: false`, and
`authorVerified` is always `false`. There is no verified per-participant identity on a line. An
`author` who is not a declared member is refused (`author-not-a-member`) and nothing is written.
Setting `author` does not set `seatAuthored`, and it does not decide who `wakeMemberSeats` wakes.

## Routing a mailbox

Waking every agent in a mailbox suits a standup. It doesn't suit a support mailbox, where a
question about a printer should reach the one specialist who handles devices and nobody else.
Routing does that: each client `post` goes to one member, picked by what the post is about,
and that member's answer shows in the mailbox. A client `post` may include `author`. That label
does not change who is picked.

Turn it on in the mailbox's file by naming a fallback, the member who takes a post the route can't place:

```md
---
description: Ask the support team anything.
members: [support.devices, support.accounts, support.fsd, support.general]
routing:
  fallback: support.general
---
```

Then give the mailbox kind the route. It needs the seats you hired and a model that can evaluate:

```ts
import { defineMailboxFlow, routeByPurpose, wakeMemberSeats } from "@flow-state-dev/workforce";

defineMailboxFlow({
  notify: wakeMemberSeats(seats),
  route: routeByPurpose(seats, { model: "typesafe-ai/jev" }),
});
```

The route picks a member with an evaluator: a block that asks a model a question with a fixed set
of answers and gets one of them back. Not every model can do that; see
[Evaluation models](/docs/fundamentals/models#evaluation-models). A mailbox without the
`routing:` line is not routed, even on a kind built with a route: a client `post` wakes every agent member.

The fallback has to be a member whose hired seat can hear a post, or the app refuses to start and
names the mailbox. So does a `routing:` line on a kind built without a route. The line is read
from the file each time the app starts, so adding it to a mailbox that is already open routes that
mailbox from the next start, with its lines kept.

### How a post finds its member

For each client `post`, in this order:

1. **The member already on it.** If the last client `post` was routed to a member by the
   evaluator or the fallback, and that member hasn't answered yet, this one goes there too, with no
   model call. A post held this way holds nothing, so the one after it is routed by what it says.
   A post whose route isn't recorded yet holds nothing either, so of two posts sent close together,
   the second may be routed by what it says rather than held.
2. **One evaluator call.** Otherwise the route asks one question: which member should answer?
   The choices are the members whose seat can hear a post and has a description, each described
   by the `description:` in its `WORKER.md`. The model also sees the mailbox's recent lines, which
   is how "it fails right after the password" reaches the specialist who asked about the password.
   A seat [hired while the app runs](./durable-hire.md) has no description, because `hire` takes
   none, so it is never a choice. It can still take a post as the fallback, and step 1 then sends
   it the next client `post`. When no member has a description, there is no call and the fallback
   takes the post.
3. **The fallback.** If the call fails, or answers with anything outside the choices, the
   fallback member takes the post. A model that can't evaluate fails every call, so every post
   goes to the fallback. If the person posting can't reach any seat of the fallback's, nobody
   answers, and the route records why. A fallback with a description is also one of the choices
   in step 2, so a description such as "Anything that fits none of the other specialists" lets the
   evaluator send it the posts that fit nobody else.

Only that member receives the post. Nobody else in the mailbox is told about it. A seat's line
(`seatAuthored: true`) is never routed, and `wakeMemberSeats` wakes nobody for it. A client `post`
is routed whether or not it sets `author`.

Write the `description:` lines for the route to read. "Printers, laptops, phones and wifi" routes
better than "Our devices person".

Each decision is recorded on the mailbox's session as a `mailbox-route` item: which member, and
whether it came from the member already on it, the evaluator, or the fallback, with the reason
when the fallback took it or nobody could. It never shows as a line in the mailbox, and the chat
renderers skip it.

### What the route remembers

Every mailbox on a kind built with a route (`defineMailboxFlow({ route })`) keeps a record in its
session state under `mailboxRouteLedger`: its last 20 lines, and the last client `post` with where
it went. Each post updates it, whether or not the mailbox's `MAILBOX.md` declares `routing:`.
Because of that record, neither the lines a routed member sees nor the hold in step 1 is limited by
the session's [history window](#posting-and-reading).

One post is the exception: the first after a mailbox's kind gains a route. That is the mailbox's
first post on a kind built with one, or its first after the mailbox was posted to while the app ran
its kind without a route. That post is never held, and its member sees only the earlier lines still
inside the history window, which can be fewer than 20.

Removing `routing:` from a mailbox's file and restoring it loses no lines. A client `post` made
while it was removed holds nothing, so the next routed post after it is placed by the evaluator or
the fallback. A mailbox on a kind built without a route keeps no record.

### The answer lands in the mailbox

The routed member answers the way any woken seat does, in its own conversation. For a seat of the
built-in `agent` kind, the reply is then posted into the mailbox as that seat's line. The model
doesn't have to call [`post-to-mailbox`](#a-seat-answering-in-the-mailbox). If it does, its first
call into that mailbox is handed over as the answer, and the reply is handed over after it. The
reply lands only if the tool's answer didn't, for instance because the mailbox failed to write it.
An empty reply posts nothing. It ends the seat's run as failed, unless the tool already handed an
answer over in that turn.

Whether it comes from the tool or the reply, the answer lands through an
[internal entry](#making-a-kind-of-your-own-hear-posts) of the mailbox, not through its `post`. An
internal entry is one only a dispatch can reach, never a client, so no client can answer for a
member. The entry checks the line the way `post` does: the
`author` is the seat's `seatId`, which the model can't set, and an author who isn't a member is
refused. The line has `seatAuthored: true`.

Each post gets at most one answer line. Once one lands, any other answer to that post lands
nothing, even one sent at the same moment. An answer the mailbox refuses writes nothing and doesn't
use up the post's one answer line. The refusal shows up as a failed request on the mailbox's
session, and the seat isn't told.

A [kind of your own](#making-a-kind-of-your-own-hear-posts) gets `routed: true` and the recent
lines as `recent` on its delivery. Its reply is not posted for it.

### What the member sees when it answers

The routed member's model sees the mailbox's last 20 lines along with the post, whoever wrote
them and whoever they went to. That's how "where can I buy it?" finds its "it" when the laptop
came up with another member. The lines are there for that one answer and aren't kept in the
member's conversation. What the conversation keeps is every post routed to the member and its
answers, as far back as its history window reaches. Any other line older than the last 20 is out of
its view. A seat woken in an unrouted mailbox, or talked to directly, gets no lines.

### What routing can't do

- Apart from the posts routed to it and its own answers, a member sees only the mailbox's last 20
  lines when it answers. Something said earlier may have to be said again.
- A post sent before the member answers can go to that member, whatever it's about. The post after
  it is routed by what it says.
- A follow-up after an answer relies on the evaluator call. If that call fails, the follow-up goes
  to the fallback.
- A member with no `description:`, such as a seat hired while the app runs, is never picked for
  what a post is about. It gets a post only as the fallback, or as the next post held for it after
  that.
- Cancelling a post's fan-out, the request that picks its member and wakes it, may not stop the
  answer. If the fan-out is cancelled before the route is recorded in `mailboxRouteLedger`, nobody
  is woken, the fallback included. If the route was already recorded there, the chosen member is
  woken and answers, though the fan-out ends `aborted`. After a cancel, a `mailbox-route` item can
  name a member who was never woken.
- One model per mailbox kind. Two mailboxes on the same kind route with the same model.
- A change to `routing:` waits for the next start.
- It needs dispatch in the same process, or queue workers that share a lease backend. Behind a
  dispatcher that hands work to an external queue without one, a post is
  written but no member is picked or woken, and nothing answers. See
  [Where posting from another flow works](#where-posting-from-another-flow-works-and-where-it-doesnt).

### Testing a routed mailbox

Script the route's evaluation by its block name, `mailbox-route`, with `createMockModelResolver`
from `@flow-state-dev/testing`. The route asks one question, `member`, and a choice answers it:

```ts
import { createMockModelResolver, mockEvaluationModel } from "@flow-state-dev/testing";

// Posts about a printer go to devices, everything else to accounts.
const route = mockEvaluationModel({
  answers: ({ state }) => {
    const { post } = state as { post: { from: string; text: string } };
    const member = post.text.includes("printer") ? "support.devices" : "support.accounts";
    return { member: { type: "choice", choice: member } };
  },
});

const modelResolver = createMockModelResolver({ evaluators: { "mailbox-route": route } });
```

Pass it as `modelResolver` to the `createFlowState` your test builds. Each call is handed
`{ recent, post }`, the mailbox's lines before the post and the post itself, each line as
`{ from, text }`, where `from` is the line's `author` or, when it has none, its `principal`. A
choice outside the members offered, or an `answers` function that throws, sends the post to the
fallback. `route.calls` records every call, so a held post shows up as no call at all.

## A seat answering in the mailbox

Waking a seat runs it in its own conversation, so its answer stays there unless it posts it. To
let an agent seat answer where the post was made, give its kind the mailbox-post capability and
name the tool in the seat's worker file:

```ts
import { mailboxPostCapability, defineAgentWorkerFlow } from "@flow-state-dev/workforce";

defineAgentWorkerFlow({ uses: [mailboxPostCapability] });
```

```md
---
description: Answers questions on the support desk.
tools: [post-to-mailbox]
---
```

In a [routed mailbox](#routing-a-mailbox) the member a post was routed to doesn't need the tool:
its reply is posted for it. The tool is for everything else, such as a seat you talk to directly
that wants to say something in a mailbox.

The model calls `post-to-mailbox` with the mailbox's id and what to say. A woken seat reads the id
off the post it heard, from the turn described in [Waking agent seats](#waking-agent-seats). The
tool's input is `{ mailbox, body }` and nothing else, so a call that adds an `author` is refused.
The line's `author` is the seat's `seatId`: its record id, the name the mailbox's `members:` lists.
The model cannot set it. The line has `seatAuthored: true`. A routed member's first call into that
mailbox is the post's answer (below). Any other call is the seat's own post, not the `post` another
flow reaches with `dispatcher({ action: "post" })`. A seat that doesn't name the tool is never
offered it.

On a turn answering a routed post, the first call into that post's mailbox is the post's answer. It lands
the way [a routed answer](#the-answer-lands-in-the-mailbox) does: at most one line per post, under
the same author, and the turn's reply lands only if the tool's answer didn't. A later call there in
that turn posts nothing and tells the model its answer was already handed to the mailbox. A call
into any other mailbox goes through `seatPost`.

`wakeMemberSeats` wakes nobody for that line, because it has `seatAuthored: true` (see
[Waking agent seats](#waking-agent-seats)), so seats won't wake each other. A client `post` that
sets the same `author` wakes hearing members.

What it won't do:

- The seat must be a member. The mailbox refuses any other author and writes nothing, and the
  seat is not told: the tool reports that it handed the post over, not that it landed. The
  refusal shows up as a failed request on the mailbox's session.
- Only the built-in mailbox kind takes these posts. A mailbox id nobody opened, or one on another
  kind, fails the call by name.
- It needs dispatch to run in process, or queue workers that share a lease backend. Behind a host
  that hands dispatch to an external queue without one, the tool call fails with `external-dispatcher`.
- The mailbox can't verify the name. The server sets it, and the line is stored with
  `authorVerified: false` like any other post.

## Holding a board

A mailbox is where a team talks. A board is where its work sits: rows carrying a goal, an optional assignee, and a status somebody moves. A mailbox can hold one or more, declared in the same frontmatter as the members.

```md
---
description: Where the engineering team works incidents.
members: [engineering.lead, engineering.analyst]
boards: [followups]
---

Post the timeline here. Anything that outlives the incident goes on the board.
```

`boards` is a list of plain local names, the way `members` is a list of names. `followups` is what a person types and what a caller names. The ledger's own id is minted from the mailbox that holds it, so `engineering.incidents` holding `followups` is `engineering.incidents.followups`. No file writes that id.

A board name is a plain local name: not empty, no whitespace, none of `.` `/` `*` `[` `]`, and not `__proto__`, `prototype` or `constructor`. Watch the dot: it joins a mailbox to a board, so `feature.triage` would address a board on some other mailbox. A name breaking the rule is refused when you bind the roster, as is a `boards:` that is not a list of names and a name declared twice.

### Filing and reading rows

A mailbox holding a board answers two more actions, `fileTask` and `readBoard`, beside `post` and `read`.

```ts
const fileFollowup = dispatcher({
  name: "file-followup",
  flowKind: "mailbox",
  action: "fileTask",
  inputSchema: z.object({ goal: z.string() }),
  session: { id: () => "engineering.incidents" },
  payload: (input) => ({ board: "followups", goal: input.goal, assignee: "analyst" }),
});
```

Both actions take the board's **local** name. Filing says where the row landed:

```ts
{ board: "followups",
  boardId: "engineering.incidents.followups",
  taskId: "task_ktp2n4x1_1_88a0c3",
  status: "pending" }
```

`assignee` names the worker that should run the row. A board draining this ledger routes by it: a name in the board's own `workers` map runs there, and a board set up to [hand a row to the worker it names](#handing-a-row-to-the-worker-it-names) sends any other name to the worker `discover` lists under it. It is not a mailbox member, and the two are separate namespaces even when they read alike.

`fileTask` also takes `title`, `context`, `priority`, `maxAttempts`, `labels` and `input`. The row's id is minted, not chosen. Its `author` is the same unverified claim a post's is: checked against the declared members, stored beside `authorVerified: false`, and optional. A row filed without one is accepted.

A dispatcher is a block, so it can also be a tool. Hand it to a generator and the model decides when to file and onto which board, while your code keeps the parts the model shouldn't choose:

```ts
const fileOntoDesk = dispatcher({
  name: "desk-clerk-file",
  description: "File this onto a board: followups for work a seat runs, escalations for a person.",
  flowKind: "mailbox",
  action: "fileTask",
  inputSchema: z.object({ board: z.enum(["followups", "escalations"]), goal: z.string() }),
  session: { id: () => "support.desk" },
  payload: (input, ctx) => ({ ...input, author: ctx.flow.config.seatId }),
});
```

The model picks the board and writes the goal. The `author` is the seat's own `seatId`, which hiring gives every seat, not something the model chooses. The tool's result is the dispatch, not the row: the row is written when the mailbox runs `fileTask`, a moment later. If the mailbox refuses it, say because the author is not a member, the model has already been told the filing was sent, and the refusal is a failed request on the mailbox's session.

The dispatch goes into an existing session by its id, which needs the in-process dispatcher or queue workers that share a lease backend. Under an external dispatcher without one, it is refused with a `DispatchRefusedError` whose `refused` is `"external-dispatcher"`. To tell the model the board is unavailable rather than letting the tool fail, put the dispatcher in a sequencer and handle the error in the sequencer's `.rescue()`.

`readBoard` gives back every row on one board. The mailbox's own `read` lists what it holds, by name:

```ts
{ id: "engineering.incidents",
  description: "Where the engineering team works incidents.",
  members: ["engineering.lead", "engineering.analyst"],
  boards: ["followups"],
  transcript: [/* … */] }
```

A mailbox holding no board has no `boards` key and answers neither action.

Naming a board the mailbox does not hold is refused by name, `board-not-declared`, and the message lists the boards it does hold. Naming a board another mailbox declared is refused the same way: a mailbox reaches its own boards and no others.

### Showing a board on screen

`readBoard` answers a model. A screen reads the ledger itself, because an action's return value isn't sent to the browser. The browser sees the items a session emits and the collections it can read.

The ledger is readable from a session whose flow declares it, under its minted id:

```tsx
import { BoardColumns } from "@flow-state-dev/react";

<BoardColumns sessionId={sessionId} boardRef="engineering.incidents.followups" />
```

To show the board as a list that picks up each new task as it is filed, read it through the mailbox's own session and add `live`:

```tsx
import { BoardList } from "@flow-state-dev/react";

<BoardList sessionId="engineering.incidents" boardRef="engineering.incidents.followups" live />
```

Every task filed through `fileTask` shows up on the list. Status changes a worker makes while draining the board show only after something else makes the list read again, such as a remount. See [A board as a list](./ui.md#a-board-as-a-list).

Board ledgers are organization-scoped, so the read resolves against the organization the reading session belongs to. What crosses is `id`, `title`, `goal`, `status`, `assignee`, `run`, `priority`, `attempts`, `maxAttempts`, `deps`, `labels`, `error`, `createdAt`, `updatedAt`, `startedAt` and `completedAt`. `run` names the run a seat is working the row in, or last worked it in, so a board view can open it. See [Which run is working a task](../orchestration/task-board.md#which-run-is-working-a-task).

### Working the rows

The mailbox keeps the ledger. It runs nothing. A worker that claims rows declares the same board and drains it:

```ts
import { mailboxBoard } from "@flow-state-dev/workforce";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";

const followups = mailboxBoard("engineering.incidents", "followups");

const board = taskBoard({
  name: "followups",
  collection: followups,
  workers: { analyst: runFollowup },
});

defineFlow({
  kind: "analyst",
  resources: { [followups.id]: followups },
  actions: { drain: { block: board.drain } },
});
```

`mailboxBoard` hands back the ledger the mailbox writes to, and carries its own `id` so the resource key is not a string you retype.

The mailbox's id and the board's name *are* retyped here, and nothing checks them against the tree. Get either wrong and you do not get an error: you get a second, empty ledger under a different id, and the only sign is a warning at hire saying the mailbox's real board is unattended. Read that warning.

To let a model work the rows itself, compose the board's tools into the worker's kind:

```ts
import { mailboxBoardTaskTools } from "@flow-state-dev/workforce";

// in the kind's definition
uses: [mailboxBoardTaskTools(followups)],
```

That gives the model all eight task tools over this board, each named for the board it reaches: `addTask_engineering_incidents_followups`, and the same for `assignTask`, `updateTask`, `listTasks`, `completeTask`, `failTask`, `blockTask` and `cancelTask`. The set is fixed: a `tools:` list on the worker can neither grant these nor withhold them. So a worker holding the capability can assign rows and settle them, not only add them. A narrower set means a different capability.

Compose it once per board. A worker holding two boards holds sixteen tools, and the names say which board each one writes to.

A mailbox can offer the same eight tools to its callers, as actions. Add `boardActions: true` to its `MAILBOX.md`:

```md
---
description: Ask the support team anything.
members: [support.devices, support.accounts]
boards: [escalations]
boardActions: true
---
```

Each board then gains `cancelTask_support_help_escalations` and its seven siblings, beside `fileTask` and `readBoard`. The DevTool's Tasks tab offers the ones that take a `taskId` on each of the board's rows, so you can cancel, reassign or settle a row from the mailbox's session while you debug.

The part after the tool name is the mailbox's id and the board's name, joined, with every character that can't go in a name turned into `_`, so two boards can end up with the same name: `eng.feature`'s `work` and `eng_feature`'s `work` both give `eng_feature_work`. If either of them has opted in, `mailboxInstances` refuses the roster with an error naming both boards. Rename a mailbox or a board to fix it.

It is off by default, and that's deliberate. Anyone who can reach the mailbox can then settle or reassign its rows, including one a seat is working on, and the roster check `fileTask` makes on `author` doesn't apply to these. Each action works only in its own mailbox's session, so one mailbox can't reach another's board through them. Turn it on for boards people are meant to work from outside a run, and for development.

A board that no hired worker declares warns at hire, naming the mailbox and the board. Nothing is refused: a mailbox may keep a board that only people read.

A board's rows are stored at organization scope, so they sit in [the organization the mailbox runs in](#which-organization-a-mailbox-runs-in).

Rename or move a mailbox's folder and its boards move with it, since a board's id comes from where the mailbox sits. Rows filed under the old id stay there and nothing migrates them. The unattended-board warning is what makes that visible.

The rows themselves are [task substrate](../orchestration/task-substrate.md) rows, with the same fields, statuses and transitions any other board's carry.

### Handing a row to the worker it names

A board's `workers` map fixes its names when you write it. To let a row name any of your workers instead, including one hired a minute ago, the worker has to be able to take a task, and the board has to ask who a name means when it hands the row over.

The built-in `agent` kind takes tasks from the boards you pass it as `taskLists`, and from none without them, which includes the copy you get when you pass no `kinds`. Build it with every board your mailboxes hold, hire, and build the **worker lookup** over the live registry:

```ts
import {
  createWorkerLookup,
  defineAgentWorkerFlow,
  defineMailboxFlow,
  hireWorkforce,
  mailboxBoardIds,
  mailboxInstances,
} from "@flow-state-dev/workforce";
import { readMailboxesDirectory, readWorkforce } from "@flow-state-dev/workforce/loader";
import { instanceAt } from "./registry-access";

// Check `errors` on both reads, as in "Treat a non-empty errors as fatal".
const { workers } = await readWorkforce("./workforce");
const { mailboxes } = await readMailboxesDirectory("./workforce");
const boardIds = mailboxBoardIds(mailboxes);

const hired = hireWorkforce(workers, {
  kinds: { agent: defineAgentWorkerFlow({ taskLists: boardIds }) },
  mailboxBoards: boardIds,
});

const lookup = createWorkerLookup({ instanceAt, declared: hired.map((worker) => worker.id) });

const mailboxKinds = mailboxInstances(mailboxes, {
  kinds: { mailbox: defineMailboxFlow({ checkAssignee: lookup.filingCheck() }) },
});
```

`instanceAt(address)` returns the flow registered at an address right now: `registry.get(address)` on the runtime, the same getter the hire tools take. [Adding a chief of staff](./chief-of-staff.md#adding-one) shows it added to the `registry-access.ts` from [Reaching the `FlowState`](./durable-hire.md#reaching-the-flowstate). The lookup reads it on every call, so a worker hired while the app runs is found the moment it is registered, and a fired one stops being found.

Then give the board that drains the ledger a `defaultWorker` that hands each row to whatever its name means:

```ts
import { defineFlow, dispatcher } from "@flow-state-dev/core";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { WORKER_TASK_ENTRY, mailboxBoard } from "@flow-state-dev/workforce";

const followups = mailboxBoard("engineering.incidents", "followups");

const board = taskBoard({
  name: "followups-desk",
  boardId: followups.id,          // the ledger's own id: the worker looks the ledger up by it
  collection: followups,
  workers: {},
  defaultWorker: dispatcher({
    name: "hand-to-named-worker",
    action: WORKER_TASK_ENTRY,    // "work"
    session: "per-task",
    flowKind: lookup.flowKind,
  }),
});

export const followupsDesk = defineFlow({
  kind: "followups-desk",
  actions: { drain: { block: board.drain } },
})();
```

Register `followupsDesk` alongside the hired workers and mailbox kinds, and run its `drain` the way you would any board's. Each row filed with `fileTask` and an `assignee` then runs on that worker, one run per row. A worker of the built-in kind answers it as one turn, and the answer becomes the row's result. See [Taking a task](./built-in-worker.md#taking-a-task).

`boardId` has to be the ledger's id, `followups.id`. A worker takes a row only from a board whose id is one of its `taskLists`, and refuses any other with `UnknownTaskLedgerError` before reading a row.

#### Who a name reaches

The lookup finds a worker your files declare, a worker hired for the organization, or a worker the member hired for themselves. "The member" is always the person who filed the row. The list records who filed it, so when a teammate's drain hands the row over, it still reaches the filer's own worker and never the teammate's. It never finds another organization's workers, or another member's own.

| The name | At `fileTask` | At hand-over |
| --- | --- | --- |
| Nobody holds it | Refused, nothing written. `MailboxPostRefusedError`, `reason: "unknown-assignee"`, message `unknown-assignee: No worker is named "frontend".` | Refused `flow-not-found`, naming the assignee. The attempt fails. |
| Held by two workers, such as one hired for the organization and one of the member's own | Refused `unknown-assignee`, naming both: `"frontend" names 2 workers: one hired for the organization and one your own. Fire or rename one of them so the name means one worker.` | The attempt fails with an error carrying the same sentence. |
| Held by a worker whose kind takes no tasks | Refused `unknown-assignee`, with a message naming the worker and its kind, which declares no `work` task entry. | The attempt fails with an error carrying the same sentence. |

A worker fired after its row was filed fails at hand-over, naming it. No other worker runs that row. A row filed with no assignee is refused at hand-over too, since the fallback hands a row over by the name on it. Every failed attempt goes through the board's ordinary error path, so `maxAttempts` and `onError` apply.

If a board over a ledger keeps names of its own in `workers`, tell the filing check, or it refuses them as unknown:

```ts
defineMailboxFlow({
  checkAssignee: lookup.filingCheck({ [followups.id]: ["analyst"] }),
});
```

Without `checkAssignee`, `fileTask` files any assignee as written, and a bad name is only caught at hand-over.

#### A kind of your own

A kind you write takes tasks when it declares a `work` task entry whose tasks come from your mailboxes' boards:

```ts
import { mailboxTaskLists } from "@flow-state-dev/workforce";

// in the kind's defineFlow({ ... })
task: {
  actions: {
    work: { block: reviewTask, from: mailboxTaskLists(boardIds) },
  },
},
```

`reviewTask` receives a `TaskWorkerInput` (`taskId`, `goal`, `title`, `context`, `input`, and the rest), and what it returns is the row's result. A task from a board outside `boardIds` is refused. An entry whose blocks keep session state is refused unless you pass `mailboxTaskLists(boardIds, { allowSessionState: true })`; do that only when tasks are handed over `per-task`, or the state has the same shape for every task. [A task entry served by many boards](../orchestration/task-board.md#a-task-entry-served-by-many-boards) covers the checks every arriving task gets.

## A room per project

A [project](./projects.md) has one room, a conversation its members share. A room isn't a mailbox you declare. It's built from a **template**: the seats that answer in it and the charter they work under. Every project's room shares one template.

The room runs on the same mailbox kind, but no session is the room: each member talks through their own session, and the lines are kept as organization data. [A room or a mailbox](./projects.md#a-room-or-a-mailbox) compares the two in one picture.

The default template is declared once for the organization, beside the projects collection in `workforce/org/resources/projects.ts`:

```ts
import { defineProjectsCollection } from "@flow-state-dev/workforce";

export default defineProjectsCollection({
  talk: {
    seats: ["engineering.lead", "chief-of-staff"],
    charter: "Plan the work, and say what is blocked.",
  },
});
```

A seat is named by its full id from any team, like `engineering.lead`, or by an organization-level seat's own name, like `chief-of-staff`. These seats are not the project's members. Members are the people who can read and post; seats are who a post wakes.

Pass the organization's resource map to `mailboxInstances`, so `mailboxInstances` can find the template:

```ts
const { resources } = splitResourceModules(resourceModules);
const instances = mailboxInstances(mailboxes, { kinds, resources });
```

An app that doesn't run `fsdev gen` imports the file's default export and passes it in `resources` under a key of its choosing. `fsdev gen` uses `projects`, the basename of `projects.ts`, and so does this example:

```ts
import projectsCollection from "./workforce/org/resources/projects";

// mailboxes and kinds as above
const instances = mailboxInstances(mailboxes, {
  kinds,
  resources: { projects: projectsCollection },
});
```

The other arguments are as in the snippet above. If you declare the template in a `MAILBOX.md` instead (below), its `mintFor:` must name the key you passed the collection under (`projects` here).

Rooms run on the built-in mailbox kind, and that kind has to be able to wake seats, so build it with a notify block, as in `kinds: { mailbox: defineMailboxFlow({ notify: wakeMemberSeats(seats) }) }`. Left as the plain built-in, a template that names seats is refused, because no post would wake them.

`wakeMemberSeats(seats)` wakes a member whose seat is in the `seats` list and whose kind hears mailbox posts, as the built-in `agent` kind does. A notify block you write yourself wakes only the members its own code wakes; `mailboxInstances` doesn't check that it reaches the template's seats. A seat hired after you built `wakeMemberSeats(seats)` isn't in its list and isn't woken.

If your app calls `mailboxInstances` more than once, say once per flow, only one call needs `resources`. The first call that finds the template keeps it for the whole process, and every other call builds its mailbox kind with the same seats and charter. A call that finds a different template is refused.

A team can declare the template in a `MAILBOX.md` instead, by marking it `mintFor: projects`. Its `members:` are the seats and its body is the charter:

```md
---
description: The room every project gets.
mintFor: projects
members: [engineering.lead, operations.lead]
---

Plan the work, and say what is blocked.
```

That file is a template, not a mailbox. It's never opened, and it never shows up in the [inventory](./inventory.md). If the file used to be a mailbox, its old session is kept in the store, but every mailbox action on it, including inventory registration, is refused with `mailbox-is-a-template`.

What a template does:

- **It applies to every project's room, and edits land at the next restart.** The seats and charter are built onto the mailbox kind each time the app boots and are never copied into a session. An edit reaches every room, including ones that already exist.
- **A post wakes each seat once, as the person who posted.** Each seat keeps one conversation per person per room, and gets the room's last 20 lines along with the post. Its reply goes into the room, where every member reads it. A seat answers a post once, even when the post reaches it twice, and only for itself: each delivery carries an `answerToken` for that seat, which the answer hands back as `token`. The built-in agent kind does this for you, and a kind of your own passes it through. The answer must come back through the poster's session. A member posts and reads through the one talk session the project lists for them, the one `join` returns; any other session is refused with `talk-session-not-listed`. A seat's reply wakes nobody.
- **Other members' lines arrive on the next read, not live.** Your own post shows up when you post it. Everyone else's appears the next time your view calls `read`.
- **It holds no board, routes no post, and picks no kind.** A template that declares `flow:`, `boards:`, `routing:` or `boardActions:` is refused.
- **Rooms aren't in the inventory.** The inventory lists the mailboxes you declared, and no talk session is ever one of its rows.

When a template is in place, any code that creates a project inside a flow turn also gets the creator's talk session ready, in the same turn. `createProject` does that with or without a template. A row your code writes outside a turn gets none, and its members reach the room through `join`.

A room's lines aren't in any session's history. Read them with `read` on a member's talk session.

`mailboxInstances` checks templates along with your mailboxes and reports every problem at once. It refuses a template whose `mintFor:` names no collection in the resources you passed, or names something other than the projects collection, a seat that isn't a seat id or is listed twice, seats on a kind that can't wake them, and a second template for the same collection, whether it's in `org/resources/projects.ts` or another `MAILBOX.md`.

## Registering a kind of your own

You will usually not need this. A standup, a direct message and an announcement mailbox are all mailboxes on the one built-in kind, told apart by their members and their charter, not by being different kinds.

When the workflow genuinely diverges, pass your own factory at boot:

```ts
mailboxInstances(mailboxes, { kinds: { "my-mailbox": defineMyMailboxFlow() } });
```

A record carrying `flow: my-mailbox` then runs on that kind's own instance, and every mailbox naming it is a session there. One instance per custom kind, still never one per record. A `flow:` naming a kind you did not pass is refused by name; it never quietly falls back to the built-in.

That map is the whole registration surface. There is no second API, and a custom factory carries the same contract the built-in does: one kind, one instance.

The factory the framework ships builds only the built-in kind, so a kind of your own is a flow you write: its own state, its own post, its own read. It cannot hold a board: `boards:` on a record naming your kind is refused by name when you bind the roster.

A kind of your own shows on a page the same way when its `post` keeps the line as a `mailbox-post` item: `await emitMailboxPostLine(ctx, line)`. It resolves once the item is stored and throws if the write fails, so a post never hands back a line nothing kept. Its `read` gets the posted lines back with `readMailboxPostLines(ctx, yourLineSchema)`.

Different members, a different charter and a different set of boards are not a diverging workflow; they are all one kind. A different `read` is.

## Where posting from another flow works, and where it doesn't

Posting from another flow works when dispatch runs in the same process, or when the queue workers share a lease backend (`WorkerAdapter.leaseBackend`). On a deployment whose dispatcher hands work to an external queue and whose workers share no lease backend, a post into an opened mailbox is refused with `external-dispatcher`.

On that kind of deployment, a post from a client is written to the mailbox, but no member is [woken](#waking-members), and a [routed mailbox](#routing-a-mailbox) never picks a member or answers.

## Upgrading from channels

Mailboxes used to be called channels, everywhere: the record file, the folder, the kind, the items in a transcript, and the exports. The old names are not read.

- **Files.** Rename `teams/<team>/channels/<name>/CHANNEL.md` to `teams/<team>/mailboxes/<name>/MAILBOX.md`, and `workforce/flows/channels/` to `workforce/flows/mailboxes/`. An old record file or folder comes back from `readMailboxesDirectory` as a `pre-rename-record` error, one per file, and an old kinds folder makes `fsdev gen` refuse to run, naming it. Nothing under an old name is skipped in silence.
- **Code.** Every `channel` export has a `mailbox` name: `channelFlow` is `mailboxFlow`, `openChannels` is `openMailboxes`, `readChannelsDirectory` is `readMailboxesDirectory`, `ChannelManifest` is `MailboxManifest`. A kind of your own can't be called `channel`: `mailboxInstances` refuses that key in `kinds`.
- **Strings you wrote yourself.** These are plain strings, so nothing renames them for you:

  | Where | Old | New |
  |-------|-----|-----|
  | The built-in kind, as a `flowKind` or in `/api/flows/<kind>/…` | `"channel"` | `"mailbox"` |
  | A transcript line's item `component` | `channel-post` | `mailbox-post` |
  | A route decision's item `component` | `channel-route` | `mailbox-route` |
  | A seat's `tools:` in `WORKER.md` | `post-to-channel` | `post-to-mailbox` |
  | A seat's `discover:` in `WORKER.md` | `channels` | `mailboxes` |
  | `createWorkforceCapability`'s `roster` and `inventory` keys | `channels` | `mailboxes` |
  | The inventory collection's key prefix | `inventory/channels/` | `inventory/mailboxes/` |

- **Stored data.** Sessions, transcripts and inventory rows written before the rename are not read. `openMailboxes` refuses a mailbox id held by a session on the old kind, and names that session as a store to reset. To list everything left from before the rename before you open anything, check the store at boot:

```ts
import { describePreRenameMarks, findPreRenameMarks, openMailboxes } from "@flow-state-dev/workforce";

const leftovers = await findPreRenameMarks(stores, {      // your server's store registry
  mailboxIds: mailboxes.map((mailbox) => mailbox.id),       // mailboxes whose transcripts are checked
  orgIds: ["acme"],                                         // organizations whose inventory is checked
});
if (leftovers.sessions.length > 0 || leftovers.organizations.length > 0) {
  throw new Error(`This store was ${describePreRenameMarks(leftovers)}. Start from an empty store.`);
}

await openMailboxes(mailboxes, { client: sessionClient, userId: "u_42" });
```

`findPreRenameMarks` only reads. It returns `{ sessions, organizations }`: every session on the old kind and every listed mailbox whose recent transcript holds old items, each with the reason, and every listed organization holding inventory rows under the old key. Both lists are empty for a store written after the rename. Start from an empty store: old conversations, and the inventory rows that listed old channels, are not carried over.

## What mailboxes do not do yet

- No join or leave. Membership is the declared list; changing it means changing the record and opening a fresh mailbox.
- No watching of a mailboxes tree. It is read once, at startup.
- No delete, and no retirement.
- No summary pass over a long transcript.
- No resolution of member names. A `members:` entry naming a worker that does not exist is accepted, and a delivery to it fails like any other delivery.
