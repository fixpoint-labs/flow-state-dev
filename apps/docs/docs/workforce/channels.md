---
title: Channels
sidebar_position: 4
sidebar_label: Channels
description: "A channel is a named session on a flow kind the framework ships: several agents talking about one topic, with one durable transcript. Posting hands nobody the work; a board the channel holds is where work someone takes and finishes lives."
---

# Channels

Several agents working one topic. Each of them reads what the others said. Posting hands nobody the work, and the conversation needs somewhere to live that outlasts whoever spoke last. When the talk does produce work somebody has to take and finish, the channel can hold a board for it.

That is a channel. The framework ships the flow that runs them, and each channel you open is a named session on it.

A channel can also be [routed](#routing-a-channel). Each post from a person then goes to the one member whose job fits it, and that member answers in the channel. A support desk works that way: the printer question goes to the devices specialist, and nobody else hears it.

## What a channel is

A **flow kind** is a definition you register. A **session** is one conversation running on a registered flow, with its own durable state. A channel's **members** are the names it lists, usually [hired workers](./workers-on-disk.md).

A channel is a session, not a new type beside flows and collections. The framework ships the kind, which is called `channel`, and every channel you open is another named session on that one registered instance. Two channels, one instance. A hundred channels, still one instance.

If you arrived from [workers on disk](./workers-on-disk.md), where one `WORKER.md` becomes one running flow copy, channels work differently. What differs per channel (who the members are, what the charter says, what has been said) lives in each session's own state.

Session state is also why the conversation stays in one place. A post is a request into the channel's session, so the work and the record land on the channel rather than on whoever posted.

:::tip When a channel, and when something else

1. **One-shot, "go do this" → a dispatch** into that flow's own session. Nothing about it wants a shared transcript.
2. **Back-and-forth, "keep talking" → a channel**, when you want one durable home for the history and posts that land on the channel rather than on the poster. A direct message is a channel whose roster is two members, not a separate mechanism.
3. **Claim it and settle it → a [board the channel holds](#holding-a-board).** A row somebody takes and finishes is a [task board](../orchestration/task-substrate.md)'s job, and a channel can keep one so the talk and the work share an address. A board with no conversation around it needs no channel.
4. **Do not fake a DM by dumping the dialogue into a worker's session.** Session history is machinery: tool calls, refusals, dispatch handles. A channel is what owns a clean transcript.
5. **Do not hand somebody work by posting it.** A post runs in the channel's session and waking members is a notification; neither one gives anybody a row to claim. File it on a board.

:::

## Declaring a channel

A channel record is three things: an id, some frontmatter, and a body. The body is the channel's charter.

```md
---
description: Where the engineering team posts daily status.
members: [engineering.lead, engineering.analyst]
---

Post what you finished, what you're on, and what's blocking you.
```

No line says which kind it runs. An omitted `flow:` selects the built-in, which is the common case and the reason the first channel you write carries no configuration at all.

`members` is the channel's roster. It decides who gets woken when somebody posts, and it is checked when a post claims to be from a particular member. It is the declared list and nothing else writes it: there is no join or leave verb yet, so changing who is in a channel means editing the record and opening a fresh channel. An edit to `members` does not reach a channel that is already open.

Eight keys are declarable: `flow`, `description`, `members`, `boards`, `instructions`, `routing`, `boardActions` and `mintFor`. [Routing a channel](#routing-a-channel) covers `routing`, [Holding a board](#holding-a-board) covers `boards` and `boardActions`, and [A room per project](#a-room-per-project) covers `mintFor`. The list is closed. Anything else is refused by name when you bind the roster, along with an `id:`, a `system:`, and a body given alongside `instructions:`.

## Channels on disk

That record has a home on disk, in the same tree as [workers](./workers-on-disk.md) and [documents](./documents-on-disk.md). One folder per channel, grouped by team:

```
workforce/
  teams/
    engineering/
      channels/
        standup/
          CHANNEL.md
        incidents/
          CHANNEL.md
    marketing/
      channels/
        standup/
          CHANNEL.md
```

A channel is a folder with a fixed file in it, the way a worker is a folder with a `WORKER.md`. The `CHANNEL.md` is the record above: frontmatter, then the charter. Someone who does not write TypeScript can add a fourth channel, or rewrite what one of them is for, by editing a file.

Point `readChannelsDirectory` at the root:

```ts
import { readChannelsDirectory } from "@flow-state-dev/workforce/loader";

const { channels, errors } = await readChannelsDirectory("./workforce");
```

You get one record per channel:

```ts
interface ChannelManifest {
  id: string;                        // "engineering.standup"
  declared: Record<string, unknown>; // the frontmatter, exactly as written
  body: string;                      // the charter below it, verbatim
}
```

`channels` is the array `channelInstances` and `openChannels` take. Reading the tree opens nothing. No instance is registered and no session exists yet.

`@flow-state-dev/workforce/loader` imports `node:fs`, so it only runs on Node. The package root, where the binding calls live, is server code too. It reaches Node built-ins through the packages it builds on, so it is server-only. A browser component takes the names it needs from `@flow-state-dev/workforce/browser`, the one entry that reaches no Node built-in.

### A channel's id comes from the folders

The team folder and the channel folder, joined with a dot. `teams/engineering/channels/standup/` becomes `engineering.standup`, which is the channel's session id: the id you address when you post to it. The team qualifier means marketing can have a `standup` of its own without checking what engineering called theirs.

Both folder names follow [the tree's name rule](./workers-on-disk.md#names-in-the-tree): lowercase letters, digits and single hyphens, at most 64 characters. So `daily-standup` is fine. `Stand Up` and `stand.up` are reported when the tree is read, with the rule in the message.

### What the file is checked for

`description` is the only key the file itself requires, and `system:` the only one it refuses. Everything else lands on `declared` spelled exactly as you spelled it, and the closed list of eight keys is checked later. So a `CHANNEL.md` that says `member:` instead of `members:` reads without complaint and is refused by name when you bind the roster.

### When a folder is wrong

A folder that should have produced a channel and did not lands in `errors`, and the rest of the channels load anyway. Say the lounge folder holds other files but no `CHANNEL.md`:

```ts
errors;
// [{ kind: "channel-load-failed",
//    path: "teams/engineering/channels/lounge",
//    error: Error('Channel folder "lounge" has no CHANNEL.md. A channel folder declares
//                  one channel, and every channel is a CHANNEL.md. …') }]
```

`path` is slash-separated and relative to the root you passed, so it starts at `teams/`. It names the folder that failed so you can go find it. It is not a path you can open.

`kind` names the condition, so a caller can tolerate one class and still refuse another:

| `kind` | When |
|--------|------|
| `channel-load-failed` | One channel folder did not load: a folder name that breaks the rules, a symlinked folder, or a `CHANNEL.md` that is missing, unreadable, carries no frontmatter, or declares no `description`. |
| `refused-declaration` | The file declares `system:`. |
| `unreadable-slot` | A structural folder is a symlink or exists and cannot be listed: `teams`, a team folder, or a team's `channels`. The channels beneath it cannot be enumerated, so the folder is reported under its own path. |

`readChannelsDirectory` throws only about the root you passed: when it cannot be read at all, and when it is a symlink. Links are never followed at any level of the walk. A root with no `teams/` comes back as `{ channels: [], errors: [] }`, and a team with no `channels/` folder is not an error either.

A file sitting loose in a `channels/` folder is passed over in silence, so a `README.md` next to the channel folders is fine, as are OS and editor droppings such as `.DS_Store`.

#### Treat a non-empty `errors` as fatal

```ts
const { channels, errors } = await readChannelsDirectory("./workforce");
if (errors.length) {
  throw new Error(
    `channels: ${errors.length} channel(s) failed to load\n` +
      errors.map(({ path, error }) => `  ${path}: ${error.message}`).join("\n"),
  );
}
```

A reported folder is a channel your app was supposed to have. Log a warning and carry on, and the app boots with a team that has nowhere to talk. Fail at startup unless you have a specific reason to boot without it.

## Opening it, and why an unopened id is not a channel

Binding happens in two calls, because the two halves happen at two different times. An instance is registered when the server is built. A session can only be opened once the server is running.

```ts
import { channelInstances, openChannels } from "@flow-state-dev/workforce";

// Build time. One instance per distinct kind, not one per record.
flowRegistry.registerMany(channelInstances(channels));

// Runtime. One named session per record, at the record's own id.
await openChannels(channels, { client: sessionClient, userId: "u_42" });
```

`openChannels` is idempotent: a channel that is already open is left alone, so re-running it over an unchanged roster does nothing. Re-opening is not a migration, though. `members`, the charter and `description` are written when a channel is created and keep whatever they were opened with, and `flow` is settled then too, since it picks the session's kind. Add a member or rewrite a charter and a channel that is already open does not see it.

`boards` is the exception. The [board](#holding-a-board) list is built from the files on every bind and is never stored on the channel, so a board added to an open channel's file is usable the next time you run.

Re-running does repair one thing: a channel whose id was claimed by a post before it was opened. That leaves an empty session, and re-running binds it. An empty session is the only thing it will clear out of the way. If the id is held by something else, such as a session belonging to another flow or another user, or one carrying state that is not a readable channel, `openChannels` names it and stops. If that happens, rename the channel.

The one registered instance answers for every session id, and naming a session that does not exist creates an empty one rather than refusing. So a channel is not "a session id somebody used". It is a session that was opened as a channel, carrying members and a charter. Post to an id nobody opened and you get `channel-not-bound`, nothing is written, and the empty session stays inert.

### Which organization a channel runs in

Every channel session runs in an organization, and your app does not name it. The server binds it from the caller's verified identity, which is whatever your [`resolvePrincipal`](../server/authentication.md#every-request-runs-in-an-organization) returned. An app that configures no authentication gets the reserved `DEFAULT_ORG_ID` instead, which is the development case.

Storage at organization scope resolves against that organization inside the channel. [Documents read from the tree](./documents-on-disk.md) are org-scoped, and so are the rows on a [board the channel holds](#holding-a-board). A worker woken by a post runs in the channel's organization too, so the same documents resolve for it.

A session's organization is fixed when the session is created, and re-opening cannot move it. Open your channels as a caller whose verified identity already carries the organization you want them in.

## Posting and reading

A channel has two actions, `post` and `read`, reachable both by a client and by another flow.

```ts
const postToStandup = dispatcher({
  name: "post-to-standup",
  flowKind: "channel",                          // the shared instance
  action: "post",
  inputSchema: z.object({ body: z.string() }),
  session: { id: () => "engineering.standup" }, // the channel
  payload: (input) => ({ body: input.body, author: "engineering.lead" }),
});
```

The flow you address is the **kind**; the channel is the **session id**. Address `{ id }`, never `{ key }`: a key-derived session is a child of whoever dispatched it, so the same key lands somewhere different for every poster and the channel never sees the post. Nothing detects that mistake.

Over HTTP the address is the same: the kind where the flow goes in the URL, and the channel's id where the session goes.

```bash
curl -X POST https://your-app.example/api/flows/channel/engineering.standup/actions/post \
  -H 'content-type: application/json' \
  -d '{"userId":"u_42","input":{"body":"shipped the reader"}}'
```

The call answers `202` with the request it started. The action's return value isn't part of that answer, so read the posted lines from the session's items, as [Showing a channel on screen](#showing-a-channel-on-screen) does.

`read` gives back the channel: its description, its members, and the transcript.

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

`read` takes no input on a channel. An `after` cursor is ignored there: it only means something on a [project's talk session](#a-room-per-project).

The transcript is the channel's `channel-post` items and nothing else from its history, which also carries fan-out requests, dispatch handles and refusals. `read` returns the recent lines: the ones inside the session's history window, which is 50 requests by default. On a channel with a notify block, each post uses two of them.

Posts on one channel are serialized, so two that land at once both make it into the transcript. Posts on two different channels never wait on each other, because they are different sessions.

### Showing a channel on screen

A browser never receives an action's return value, so `read` is no help to a page. Each post leaves one `channel-post` item on the channel's session, carrying the line, and a page reads those the way it reads any conversation:

```tsx
const channel = useSession("engineering.standup", { flowKind: "channel", items: { itemTypes: ["component"] } });
const lines = channel.items
  .filter((item) => item.type === "component" && item.component === "channel-post")
  .map((item) => item.data as ChannelTranscriptLine);
```

The channel's members and charter never reach the page.

To post from the page, call the channel's own action on the same session:

```tsx
await channel.sendAction("post", { body });
```

Leave `author` out when a person is posting. `author` has to be one of the channel's members, and a person using your app usually isn't one, so naming them is refused. The line still says who posted: `principal` is the identity your server resolved for the request. A post with no `author` notifies every member, which is right here, because the person who wrote it is not among them.

An agent's answer, or a post from another tab, is a request the page didn't send. Add `live: true` and it appears within about a second, with no reload:

```tsx
const channel = useSession("engineering.standup", {
  flowKind: "channel",
  items: { itemTypes: ["component"] },
  live: true,
});
const busy = channel.childSessions.filter((run) => run.status === "active");
```

`busy` lists the runs posts have started that haven't finished. Each row's `flowId` is the seat's address, so the page can say who is working.

## What the transcript proves, and what it doesn't

A session belongs to one user. That means **every line of a given channel carries the same `principal`**, the server-derived identity the post ran under. It is a real value and the framework sets it, but it does not tell you which participant wrote a line, because it is the same for all of them.

The `author` field is what distinguishes participants, and the framework cannot verify it. The poster supplies it, and it is stored beside `authorVerified: false` to say so. A post claiming an `author` who is not in the channel's members is refused, but that is a check against the declared roster, not proof of who is calling.

So: a channel transcript is evidence that the channel's own principal wrote a line. It is close to no evidence about which member did. If you are building an audit trail or an approval flow, this gives you a much weaker guarantee than the field names suggest. Naming the posting member needs something the framework does not expose yet.

## Waking members

By default a post lands and nobody is told. Give the kind a notify block and it runs once per declared member per post:

```ts
channelInstances(channels, { kinds: { channel: defineChannelFlow({ notify: wakeMember }) } });
```

Each call carries one delivery: the channel, the member it is addressed to, and the post. The roster it walks is the whole declared list, the poster included, so the block is called for the member who just wrote.

```ts
import { handler } from "@flow-state-dev/core";
import { channelNotifyInputSchema, type ChannelNotifyInput } from "@flow-state-dev/workforce";
import { z } from "zod";

const wakeMember = handler({
  name: "wake-member",
  inputSchema: channelNotifyInputSchema,
  outputSchema: z.object({ notified: z.string() }),
  execute: (input: ChannelNotifyInput) => {
    // input: { channelId, member, postId, body, principal, author? }
    if (input.author !== undefined && input.member === input.author) {
      return { notified: "" };
    }
    // send to whatever address you hold for `input.member`
    return { notified: input.member };
  },
});
```

Compare on `author`, not `principal`: `principal` is the id the channel was opened under, the same value for every post, so it never tells one member from another. `author` is the poster's own claim and nothing verifies it, so the skip is only as good as the claim.

The delivery runs in its own request, outside the post's turn, so a slow notification never delays the next post. A delivery that fails is recorded and the rest are still attempted; the post stays written either way, because the transcript is the durable record and waking people is best-effort.

Your app supplies the addresses. The `notify` slot takes any block, so to reach real recipients, make it a router rather than a handler. Declare one dispatcher per recipient, like the one in [Posting and reading](#posting-and-reading), with `flowKind` set to that recipient's address. Pick which one runs from `input.member`. [`utility.keyedRouter`](../fundamentals/blocks.md#keyedrouter) does that lookup, and its `fallback` takes any member you have no dispatcher for. For agent seats you don't have to build this yourself: see [Waking agent seats](#waking-agent-seats).

### Waking agent seats

Most apps want a post to reach the agents in the channel and nobody else. Workforce ships that as
one call. Hand `wakeMemberSeats` the seats you hired, and put what it returns in the notify slot:

```ts
import {
  channelInstances,
  defineChannelFlow,
  hireWorkforce,
  wakeMemberSeats,
} from "@flow-state-dev/workforce";

const seats = hireWorkforce(workers, { kinds });   // hire first: the wake reaches these seats
const channelFlows = channelInstances(channels, {
  kinds: { channel: defineChannelFlow({ notify: wakeMemberSeats(seats) }) },
});
```

For each post, it decides per member whether that member runs:

- **A member runs** when the post names no `author` and the member's seat can hear a post. A seat
  of the built-in `agent` kind can. It runs its ordinary answer, with the post as its turn,
  `<writer> in <channel>: <body>`. The writer is the post's `author`, or its `principal` when it
  has none: `support.lead in support.desk: can someone look at the refund queue?`.
- **Nobody runs** when the post names an `author`. Every author a post can carry is a member, so
  that is a seat talking, and two agents that wake each other answer each other forever. A member
  that would have run gets nothing at all. If you want agents to hear each other, write your own
  notify block.
- **Nobody runs** for a member whose kind can't hear a post, or who has no seat in the list you
  passed. A seat hired while the app is running isn't in that list until the app restarts and
  passes it in.

If the same seat id appears more than once (in several organizations, or owned by several users),
the one the channel's caller can reach runs, in this order: their own, the organization's, a shared
one. To wake fewer seats, pass fewer.

Each woken seat keeps one conversation per channel. The second post it hears lands in the same
conversation, so it remembers the thread. Two posts that arrive together each run once, in no
guaranteed order. The conversation is a child of the channel's session, so an ordinary session
listing does not show it. List with dispatch runs included (`include: "dispatch-runs"`, or
`includeDispatchRuns` on `FlowNavigator`) to find it.

A busy channel keeps growing each seat's conversation, and a seat remembers only as far back as
its history window reaches. Nothing summarizes older posts for it.

Members whose seat can't hear a post get nothing, the same as a channel with no notify slot. To
send them something else, pass a `fallback` block. It runs for those members on every post, and
never for a member the wake would have run. It receives the same input a notify block does:

```ts
defineChannelFlow({ notify: wakeMemberSeats(seats, { fallback: tellByEmail }) });
```

When the writer is one of those members, the fallback receives the writer's own delivery. Skip
it there if you don't want to tell someone about their own post, as the handler earlier on this
page does.

#### Making a kind of your own hear posts

A kind can hear a post by declaring an internal entry named `onChannelPost` that takes
`ChannelNotifyInput`. An internal entry is one only a dispatch can reach, never a client. That
declaration is all `wakeMemberSeats` looks for.

```ts
import { defineFlow } from "@flow-state-dev/core";
import { channelNotifyInputSchema, workerConfigSchema } from "@flow-state-dev/workforce";

export const triager = defineFlow({
  kind: "triager",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  actions: { run: { block: triage } },
  internal: {
    actions: { onChannelPost: { inputSchema: channelNotifyInputSchema, block: triageFromPost } },
  },
});
```

#### What the author check can and can't promise

A post's `author` is the poster's own claim, and the channel does not verify it. Someone who can
post can name a member as the author and so stop that one post from waking anyone. They can't make
a seat run, make your fallback reach anyone it wouldn't reach anyway, or reach anyone outside the
channel.

## Routing a channel

Waking every agent in a channel suits a standup. It doesn't suit a support channel, where a
question about a printer should reach the one specialist who handles devices and nobody else.
Routing does that: each post from a person goes to one member, picked by what the post is about,
and that member's answer shows in the channel.

Turn it on in the channel's file by naming a fallback, the member who takes a post the route can't place:

```md
---
description: Ask the support team anything.
members: [support.devices, support.accounts, support.fsd, support.general]
routing:
  fallback: support.general
---
```

Then give the channel kind the route. It needs the seats you hired and a model that can evaluate:

```ts
import { defineChannelFlow, routeByPurpose, wakeMemberSeats } from "@flow-state-dev/workforce";

defineChannelFlow({
  notify: wakeMemberSeats(seats),
  route: routeByPurpose(seats, { model: "typesafe-ai/jev" }),
});
```

The route picks a member with an evaluator: a block that asks a model a question with a fixed set
of answers and gets one of them back. Not every model can do that; see
[Evaluation models](/docs/fundamentals/models#evaluation-models). A channel without the
`routing:` line is not routed, even on a kind built with a route: it wakes every agent member.

The fallback has to be a member whose hired seat can hear a post, or the app refuses to start and
names the channel. So does a `routing:` line on a kind built without a route. The line is read
from the file each time the app starts, so adding it to a channel that is already open routes that
channel from the next start, with its lines kept.

### How a post finds its member

For each post from a person, in this order:

1. **The member already on it.** If the person's last post was routed to a member by the
   evaluator or the fallback, and that member hasn't answered yet, this one goes there too, with no
   model call. A post held this way holds nothing, so the one after it is routed by what it says.
   A post whose route isn't recorded yet holds nothing either, so of two posts sent close together,
   the second may be routed by what it says rather than held.
2. **One evaluator call.** Otherwise the route asks one question: which member should answer?
   The choices are the members whose seat can hear a post and has a description, each described
   by the `description:` in its `WORKER.md`. The model also sees the channel's recent lines, which
   is how "it fails right after the password" reaches the specialist who asked about the password.
   A seat [hired while the app runs](./durable-hire.md) has no description, because `hire` takes
   none, so it is never a choice. It can still take a post as the fallback, and step 1 then sends
   it the person's next post. When no member has a description, there is no call and the fallback
   takes the post.
3. **The fallback.** If the call fails, or answers with anything outside the choices, the
   fallback member takes the post. A model that can't evaluate fails every call, so every post
   goes to the fallback. If the person posting can't reach any seat of the fallback's, nobody
   answers, and the route records why. A fallback with a description is also one of the choices
   in step 2, so a description such as "Anything that fits none of the other specialists" lets the
   evaluator send it the posts that fit nobody else.

Only that member receives the post. Nobody else in the channel is told about it. A post a seat
wrote is never routed and wakes nobody, as in any channel.

Write the `description:` lines for the route to read. "Printers, laptops, phones and wifi" routes
better than "Our devices person".

Each decision is recorded on the channel's session as a `channel-route` item: which member, and
whether it came from the member already on it, the evaluator, or the fallback, with the reason
when the fallback took it or nobody could. It never shows as a line in the channel, and the chat
renderers skip it.

### What the route remembers

Every channel on a kind built with a route (`defineChannelFlow({ route })`) keeps a record in its
session state under `channelRouteLedger`: its last 20 lines, and the person's last post with where
it went. Each post updates it, whether or not the channel's `CHANNEL.md` declares `routing:`.
Because of that record, neither the lines a routed member sees nor the hold in step 1 is limited by
the session's [history window](#posting-and-reading).

One post is the exception: the first after a channel's kind gains a route. That is the channel's
first post on a kind built with one, or its first after the channel was posted to while the app ran
its kind without a route. That post is never held, and its member sees only the earlier lines still
inside the history window, which can be fewer than 20.

Removing `routing:` from a channel's file and restoring it loses no lines. A person's post made
while it was removed holds nothing, so the next routed post after it is placed by the evaluator or
the fallback. A channel on a kind built without a route keeps no record.

### The answer lands in the channel

The routed member answers the way any woken seat does, in its own conversation. For a seat of the
built-in `agent` kind, the reply is then posted into the channel as that seat's line. The model
doesn't have to call [`post-to-channel`](#a-seat-answering-in-the-channel). If it does, its first
call into that channel is handed over as the answer, and the reply is handed over after it. The
reply lands only if the tool's answer didn't, for instance because the channel failed to write it.
An empty reply posts nothing. It ends the seat's run as failed, unless the tool already handed an
answer over in that turn.

Whether it comes from the tool or the reply, the answer lands through an
[internal entry](#making-a-kind-of-your-own-hear-posts) of the channel, not through its `post`. An
internal entry is one only a dispatch can reach, never a client, so no client can answer for a
member. The entry checks the line the way `post` does: the
`author` is the seat's `seatId`, which the model can't set, and an author who isn't a member is
refused.

Each post gets at most one answer line. Once one lands, any other answer to that post lands
nothing, even one sent at the same moment. An answer the channel refuses writes nothing and doesn't
use up the post's one answer line. The refusal shows up as a failed request on the channel's
session, and the seat isn't told.

A [kind of your own](#making-a-kind-of-your-own-hear-posts) gets `routed: true` and the recent
lines as `recent` on its delivery. Its reply is not posted for it.

### What the member sees when it answers

The routed member's model sees the channel's last 20 lines along with the post, whoever wrote
them and whoever they went to. That's how "where can I buy it?" finds its "it" when the laptop
came up with another member. The lines are there for that one answer and aren't kept in the
member's conversation. What the conversation keeps is every post routed to the member and its
answers, as far back as its history window reaches. Any other line older than the last 20 is out of
its view. A seat woken in an unrouted channel, or talked to directly, gets no lines.

### What routing can't do

- Apart from the posts routed to it and its own answers, a member sees only the channel's last 20
  lines when it answers. Something said earlier may have to be said again.
- A post sent before the member answers can go to that member, whatever it's about. The post after
  it is routed by what it says.
- A follow-up after an answer relies on the evaluator call. If that call fails, the follow-up goes
  to the fallback.
- A member with no `description:`, such as a seat hired while the app runs, is never picked for
  what a post is about. It gets a post only as the fallback, or as the next post held for it after
  that.
- Cancelling a post's fan-out, the request that picks its member and wakes it, may not stop the
  answer. If the fan-out is cancelled before the route is recorded in `channelRouteLedger`, nobody
  is woken, the fallback included. If the route was already recorded there, the chosen member is
  woken and answers, though the fan-out ends `aborted`. After a cancel, a `channel-route` item can
  name a member who was never woken.
- One model per channel kind. Two channels on the same kind route with the same model.
- A change to `routing:` waits for the next start.
- It needs dispatch in the same process, or queue workers that share a lease backend. Behind a
  dispatcher that hands work to an external queue without one, a post is
  written but no member is picked or woken, and nothing answers. See
  [Where posting from another flow works](#where-posting-from-another-flow-works-and-where-it-doesnt).

### Testing a routed channel

Script the route's evaluation by its block name, `channel-route`, with `createMockModelResolver`
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

const modelResolver = createMockModelResolver({ evaluators: { "channel-route": route } });
```

Pass it as `modelResolver` to the `createFlowState` your test builds. Each call is handed
`{ recent, post }`, the channel's lines before the post and the post itself, each line as
`{ from, text }`, where `from` is the line's `author` or, when it has none, its `principal`. A
choice outside the members offered, or an `answers` function that throws, sends the post to the
fallback. `route.calls` records every call, so a held post shows up as no call at all.

## A seat answering in the channel

Waking a seat runs it in its own conversation, so its answer stays there unless it posts it. To
let an agent seat answer where the post was made, give its kind the channel-post capability and
name the tool in the seat's worker file:

```ts
import { channelPostCapability, defineAgentWorkerFlow } from "@flow-state-dev/workforce";

defineAgentWorkerFlow({ uses: [channelPostCapability] });
```

```md
---
description: Answers questions on the support desk.
tools: [post-to-channel]
---
```

In a [routed channel](#routing-a-channel) the member a post was routed to doesn't need the tool:
its reply is posted for it. The tool is for everything else, such as a seat you talk to directly
that wants to say something in a channel.

The model calls `post-to-channel` with the channel's id and what to say. A woken seat reads the id
off the post it heard, from the turn described in [Waking agent seats](#waking-agent-seats). The
tool posts through that channel's own `post`, except for a routed member's answer (below). Either
way the line's `author` is the seat's `seatId`: its record id, the name the channel's `members:`
lists. The model cannot set it. The tool's input is `{ channel, body }` and nothing
else, so a call that adds an `author` is refused. A seat that doesn't name the tool is never
offered it.

On a turn answering a routed post, the first call into that post's channel is the post's answer. It lands
the way [a routed answer](#the-answer-lands-in-the-channel) does: at most one line per post, under
the same author, and the turn's reply lands only if the tool's answer didn't. A later call there in
that turn posts nothing and tells the model its answer was already handed to the channel. A call
into any other channel goes through `post`.

A seat's post always carries an `author`, and `wakeMemberSeats` wakes nobody on a post with an
`author` (see [Waking agent seats](#waking-agent-seats)), so seats won't wake each other.

What it won't do:

- The seat must be a member. The channel refuses any other author and writes nothing, and the
  seat is not told: the tool reports that it handed the post over, not that it landed. The
  refusal shows up as a failed request on the channel's session.
- Only the built-in channel kind takes these posts. A channel id nobody opened, or one on another
  kind, fails the call by name.
- It needs dispatch to run in process, or queue workers that share a lease backend. Behind a host
  that hands dispatch to an external queue without one, the tool call fails with `external-dispatcher`.
- The channel can't verify the name. The server sets it, and the line is stored with
  `authorVerified: false` like any other post.

## Holding a board

A channel is where a team talks. A board is where its work sits: rows carrying a goal, an optional assignee, and a status somebody moves. A channel can hold one or more, declared in the same frontmatter as the members.

```md
---
description: Where the engineering team works incidents.
members: [engineering.lead, engineering.analyst]
boards: [followups]
---

Post the timeline here. Anything that outlives the incident goes on the board.
```

`boards` is a list of plain local names, the way `members` is a list of names. `followups` is what a person types and what a caller names. The ledger's own id is minted from the channel that holds it, so `engineering.incidents` holding `followups` is `engineering.incidents.followups`. No file writes that id.

A board name is a plain local name: not empty, no whitespace, none of `.` `/` `*` `[` `]`, and not `__proto__`, `prototype` or `constructor`. Watch the dot: it joins a channel to a board, so `feature.triage` would address a board on some other channel. A name breaking the rule is refused when you bind the roster, as is a `boards:` that is not a list of names and a name declared twice.

### Filing and reading rows

A channel holding a board answers two more actions, `fileTask` and `readBoard`, beside `post` and `read`.

```ts
const fileFollowup = dispatcher({
  name: "file-followup",
  flowKind: "channel",
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

`assignee` is the key of the worker that should run the row, as named in the board's own `workers` map. It is not a channel member, and the two are separate namespaces even when they read alike.

`fileTask` also takes `title`, `context`, `priority`, `maxAttempts`, `labels` and `input`. The row's id is minted, not chosen. Its `author` is the same unverified claim a post's is: checked against the declared members, stored beside `authorVerified: false`, and optional. A row filed without one is accepted.

A dispatcher is a block, so it can also be a tool. Hand it to a generator and the model decides when to file and onto which board, while your code keeps the parts the model shouldn't choose:

```ts
const fileOntoDesk = dispatcher({
  name: "desk-clerk-file",
  description: "File this onto a board: followups for work a seat runs, escalations for a person.",
  flowKind: "channel",
  action: "fileTask",
  inputSchema: z.object({ board: z.enum(["followups", "escalations"]), goal: z.string() }),
  session: { id: () => "support.desk" },
  payload: (input, ctx) => ({ ...input, author: ctx.flow.config.seatId }),
});
```

The model picks the board and writes the goal. The `author` is the seat's own `seatId`, which hiring gives every seat, not something the model chooses. The tool's result is the dispatch, not the row: the row is written when the channel runs `fileTask`, a moment later. If the channel refuses it, say because the author is not a member, the model has already been told the filing was sent, and the refusal is a failed request on the channel's session.

The dispatch goes into an existing session by its id, which needs the in-process dispatcher or queue workers that share a lease backend. Under an external dispatcher without one, it is refused with a `DispatchRefusedError` whose `refused` is `"external-dispatcher"`. To tell the model the board is unavailable rather than letting the tool fail, put the dispatcher in a sequencer and handle the error in the sequencer's `.rescue()`.

`readBoard` gives back every row on one board. The channel's own `read` lists what it holds, by name:

```ts
{ id: "engineering.incidents",
  description: "Where the engineering team works incidents.",
  members: ["engineering.lead", "engineering.analyst"],
  boards: ["followups"],
  transcript: [/* … */] }
```

A channel holding no board has no `boards` key and answers neither action.

Naming a board the channel does not hold is refused by name, `board-not-declared`, and the message lists the boards it does hold. Naming a board another channel declared is refused the same way: a channel reaches its own boards and no others.

### Showing a board on screen

`readBoard` answers a model. A screen reads the ledger itself, because an action's return value isn't sent to the browser. The browser sees the items a session emits and the collections it can read.

The ledger is readable from a session whose flow declares it, under its minted id:

```tsx
import { BoardColumns } from "@flow-state-dev/react";

<BoardColumns sessionId={sessionId} boardRef="engineering.incidents.followups" />
```

To show the board as a list that picks up each new task as it is filed, read it through the channel's own session and add `live`:

```tsx
import { BoardList } from "@flow-state-dev/react";

<BoardList sessionId="engineering.incidents" boardRef="engineering.incidents.followups" live />
```

Every task filed through `fileTask` shows up on the list. Status changes a worker makes while draining the board show only after something else makes the list read again, such as a remount. See [A board as a list](./ui.md#a-board-as-a-list).

Board ledgers are organization-scoped, so the read resolves against the organization the reading session belongs to. What crosses is `id`, `title`, `goal`, `status`, `assignee`, `run`, `priority`, `attempts`, `maxAttempts`, `deps`, `labels`, `error`, `createdAt`, `updatedAt`, `startedAt` and `completedAt`. `run` names the run a seat is working the row in, or last worked it in, so a board view can open it. See [Which run is working a task](../orchestration/task-board.md#which-run-is-working-a-task).

### Working the rows

The channel keeps the ledger. It runs nothing. A worker that claims rows declares the same board and drains it:

```ts
import { channelBoard } from "@flow-state-dev/workforce";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";

const followups = channelBoard("engineering.incidents", "followups");

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

`channelBoard` hands back the ledger the channel writes to, and carries its own `id` so the resource key is not a string you retype.

The channel's id and the board's name *are* retyped here, and nothing checks them against the tree. Get either wrong and you do not get an error: you get a second, empty ledger under a different id, and the only sign is a warning at hire saying the channel's real board is unattended. Read that warning.

To let a model work the rows itself, compose the board's tools into the worker's kind:

```ts
import { channelBoardTaskTools } from "@flow-state-dev/workforce";

// in the kind's definition
uses: [channelBoardTaskTools(followups)],
```

That gives the model all eight task tools over this board, each named for the board it reaches: `addTask_engineering_incidents_followups`, and the same for `assignTask`, `updateTask`, `listTasks`, `completeTask`, `failTask`, `blockTask` and `cancelTask`. The set is fixed: a `tools:` list on the worker can neither grant these nor withhold them. So a worker holding the capability can assign rows and settle them, not only add them. A narrower set means a different capability.

Compose it once per board. A worker holding two boards holds sixteen tools, and the names say which board each one writes to.

A channel can offer the same eight tools to its callers, as actions. Add `boardActions: true` to its `CHANNEL.md`:

```md
---
description: Ask the support team anything.
members: [support.devices, support.accounts]
boards: [escalations]
boardActions: true
---
```

Each board then gains `cancelTask_support_help_escalations` and its seven siblings, beside `fileTask` and `readBoard`. The DevTool's Tasks tab offers the ones that take a `taskId` on each of the board's rows, so you can cancel, reassign or settle a row from the channel's session while you debug.

The part after the tool name is the channel's id and the board's name, joined, with every character that can't go in a name turned into `_`, so two boards can end up with the same name: `eng.feature`'s `work` and `eng_feature`'s `work` both give `eng_feature_work`. If either of them has opted in, `channelInstances` refuses the roster with an error naming both boards. Rename a channel or a board to fix it.

It is off by default, and that's deliberate. Anyone who can reach the channel can then settle or reassign its rows, including one a seat is working on, and the roster check `fileTask` makes on `author` doesn't apply to these. Each action works only in its own channel's session, so one channel can't reach another's board through them. Turn it on for boards people are meant to work from outside a run, and for development.

A board that no hired worker declares warns at hire, naming the channel and the board. Nothing is refused: a channel may keep a board that only people read.

A board's rows are stored at organization scope, so they sit in [the organization the channel runs in](#which-organization-a-channel-runs-in).

Rename or move a channel's folder and its boards move with it, since a board's id comes from where the channel sits. Rows filed under the old id stay there and nothing migrates them. The unattended-board warning is what makes that visible.

The rows themselves are [task substrate](../orchestration/task-substrate.md) rows, with the same fields, statuses and transitions any other board's carry.

## A room per project

A [project](./projects.md) has one room, a conversation its members share. A room isn't a channel you declare. It's built from a **template**: the seats that answer in it and the charter they work under. Every project's room shares one template.

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

Pass the organization's resource map to `channelInstances`, so `channelInstances` can find the template:

```ts
const { resources } = splitResourceModules(resourceModules);
const instances = channelInstances(channels, { kinds, resources });
```

Rooms run on the built-in channel kind, and that kind has to be able to wake seats, so build it with a notify block, as in `kinds: { channel: defineChannelFlow({ notify: wakeMemberSeats(seats) }) }`. Left as the plain built-in, a template that names seats is refused, because no post would wake them.

If your app calls `channelInstances` more than once, say once per flow, only one call needs `resources`. The first call that finds the template keeps it for the whole process, and every other call builds its channel kind with the same seats and charter. A call that finds a different template is refused.

A team can declare the template in a `CHANNEL.md` instead, by marking it `mintFor: projects`. Its `members:` are the seats and its body is the charter:

```md
---
description: The room every project gets.
mintFor: projects
members: [engineering.lead, operations.lead]
---

Plan the work, and say what is blocked.
```

That file is a template, not a channel. It's never opened, and it never shows up in the [inventory](./inventory.md). If the file used to be a channel, its old session is kept in the store, but every channel action on it, including inventory registration, is refused with `channel-is-a-template`.

What a template does:

- **It applies to every project's room, and edits land at the next restart.** The seats and charter are built onto the channel kind each time the app boots and are never copied into a session. An edit reaches every room, including ones that already exist.
- **A post wakes each seat once, as the person who posted.** Each seat keeps one conversation per person per room, and gets the room's last 20 lines along with the post. Its reply goes into the room, where every member reads it. A seat answers a post once, even when the post reaches it twice, and only for itself: each delivery carries an `answerToken` for that seat, which the answer hands back as `token`. The built-in agent kind does this for you, and a kind of your own passes it through. The answer must come back through the poster's session. A member posts and reads through the one talk session the project lists for them, the one `join` returns; any other session is refused with `talk-session-not-listed`. A seat's reply wakes nobody.
- **Other members' lines arrive on the next read, not live.** Your own post shows up when you post it. Everyone else's appears the next time your view calls `read`.
- **It holds no board, routes no post, and picks no kind.** A template that declares `flow:`, `boards:`, `routing:` or `boardActions:` is refused.
- **Rooms aren't in the inventory.** The inventory lists the channels you declared, and no talk session is ever one of its rows.

When a template is in place, any code that creates a project inside a flow turn also gets the creator's talk session ready, in the same turn. `createProject` does that with or without a template. A row your code writes outside a turn gets none, and its members reach the room through `join`.

A room's lines aren't in any session's history. Read them with `read` on a member's talk session.

`channelInstances` checks templates along with your channels and reports every problem at once. It refuses a template whose `mintFor:` names no collection in the resources you passed, or one that isn't `projects`, a seat that isn't a seat id or is listed twice, seats on a kind that can't wake them, and a second template for the same collection, whether it's in `org/resources/projects.ts` or another `CHANNEL.md`.

## Registering a kind of your own

You will usually not need this. A standup, a direct message and an announcement channel are all channels on the one built-in kind, told apart by their members and their charter, not by being different kinds.

When the workflow genuinely diverges, pass your own factory at boot:

```ts
channelInstances(channels, { kinds: { "my-channel": defineMyChannelFlow() } });
```

A record carrying `flow: my-channel` then runs on that kind's own instance, and every channel naming it is a session there. One instance per custom kind, still never one per record. A `flow:` naming a kind you did not pass is refused by name; it never quietly falls back to the built-in.

That map is the whole registration surface. There is no second API, and a custom factory carries the same contract the built-in does: one kind, one instance.

The factory the framework ships builds only the built-in kind, so a kind of your own is a flow you write: its own state, its own post, its own read. It cannot hold a board: `boards:` on a record naming your kind is refused by name when you bind the roster.

A kind of your own shows on a page the same way when its `post` keeps the line as a `channel-post` item: `await emitChannelPostLine(ctx, line)`. It resolves once the item is stored and throws if the write fails, so a post never hands back a line nothing kept. Its `read` gets the posted lines back with `readChannelPostLines(ctx, yourLineSchema)`.

Different members, a different charter and a different set of boards are not a diverging workflow; they are all one kind. A different `read` is.

## Where posting from another flow works, and where it doesn't

Posting from another flow works when dispatch runs in the same process, or when the queue workers share a lease backend (`WorkerAdapter.leaseBackend`). On a deployment whose dispatcher hands work to an external queue and whose workers share no lease backend, a post into an opened channel is refused with `external-dispatcher`.

On that kind of deployment, a post from a client is written to the channel, but no member is [woken](#waking-members), and a [routed channel](#routing-a-channel) never picks a member or answers.

## What channels do not do yet

- No join or leave. Membership is the declared list; changing it means changing the record and opening a fresh channel.
- No watching of a channels tree. It is read once, at startup.
- No delete, and no retirement.
- No summary pass over a long transcript.
- No resolution of member names. A `members:` entry naming a worker that does not exist is accepted, and a delivery to it fails like any other delivery.
