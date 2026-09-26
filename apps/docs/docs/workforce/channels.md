---
title: Channels
sidebar_position: 4
sidebar_label: Channels
description: "A channel is a named session on a flow kind the framework ships: several agents talking about one topic, with one durable transcript. Posting hands nobody the work; a board the channel holds is where work someone takes and finishes lives."
---

# Channels

Several agents working one topic. Each of them reads what the others said. Posting hands nobody the work, and the conversation needs somewhere to live that outlasts whoever spoke last. When the talk does produce work somebody has to take and finish, the channel can hold a board for it.

That is a channel. The framework ships one kind that runs them, and a channel is a named session on it.

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

Five keys are declarable: `flow`, `description`, `members`, `boards`, `instructions`. The list is closed. Anything else is refused by name when you bind the roster, along with an `id:`, a `system:`, and a body given alongside `instructions:`.

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

`@flow-state-dev/workforce/loader` imports `node:fs`, so it only runs on Node. The package root, where the binding calls live, stays isomorphic.

### A channel's id comes from the folders

The team folder and the channel folder, joined with a dot. `teams/engineering/channels/standup/` becomes `engineering.standup`, which is the channel's session id: the id you address when you post to it. The team qualifier means marketing can have a `standup` of its own without checking what engineering called theirs.

Both folder names follow [the tree's name rule](./workers-on-disk.md#names-in-the-tree): lowercase letters, digits and single hyphens, at most 64 characters. So `daily-standup` is fine. `Stand Up` and `stand.up` are reported when the tree is read, with the rule in the message.

### What the file is checked for

`description` is the only key the file itself requires, and `system:` the only one it refuses. Everything else lands on `declared` spelled exactly as you spelled it, and the closed list of five keys is checked later. So a `CHANNEL.md` that says `member:` instead of `members:` reads without complaint and is refused by name when you bind the roster.

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

A line another member posts appears when the page reads the channel again: after its own post, or when it opens the channel.

## What the transcript proves, and what it doesn't

A session belongs to one user. That means **every line of a given channel carries the same `principal`**, the server-derived identity the post ran under. It is a real value and the framework sets it, but it does not tell you which participant wrote a line, because it is the same for all of them.

The `author` field is what distinguishes participants, and the framework cannot verify it. The poster supplies it, and it is stored beside `authorVerified: false` to say so out loud. A post claiming an `author` who is not in the channel's members is refused, but that is a check against the declared roster, not proof of who is calling.

So: a channel transcript is evidence that the channel's own principal wrote a line. It is close to no evidence about which member did. If you are building an audit trail or an approval flow, this gives you a much weaker guarantee than the field names suggest. Naming the posting member needs something the framework does not expose yet.

## Where posting from another flow works, and where it doesn't

A post from one flow into a channel's session is a delivery into a session that already exists. That needs dispatch to run in the same process.

On a deployment whose dispatcher hands work to an external queue, such a delivery is refused by name, `external-dispatcher`, whether or not the session exists.

Client posts through the ordinary action route still work on the same host. Only the flow-to-flow door closes.

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

Your app supplies the addresses. The `notify` slot takes any block, so to reach real recipients, make it a router rather than a handler. Declare one dispatcher per recipient, like the one in [Posting and reading](#posting-and-reading), with `flowKind` set to that recipient's address. Pick which one runs from `input.member`. [`utility.keyedRouter`](../fundamentals/blocks.md#keyedrouter) does that lookup, and its `fallback` takes any member you have no dispatcher for.

### Waking an agent seat

A seat of the built-in `agent` kind has an entry for exactly this. `onChannelPost` takes the
delivery your notify block was handed and runs the seat's ordinary answer on it, with the post as
the seat's turn: `support.lead in support.desk: can someone look at the refund queue?`. Only a
dispatcher reaches it. Calling it from a client is refused, the same as any internal entry.

```ts
import { dispatcher, utility } from "@flow-state-dev/core";
import { channelNotifyInputSchema, type ChannelNotifyInput } from "@flow-state-dev/workforce";

// Your app's one kind map already says which entry each kind answers on.
// Its wake column says which internal entry, if any, wakes a seat of that kind.
//   seatKinds = { agent: { wake: "onChannelPost" }, "desk-clerk": { wake: null }, ... }

const wakeAgents = utility.keyedRouter({
  name: "wake-agents",
  inputSchema: channelNotifyInputSchema,
  blocks: Object.fromEntries(
    seats.flatMap((seat) => {
      const wake = seatKinds[seat.kind]?.wake;
      if (wake == null) return [];               // this kind wakes on nothing
      return [[
        seat.id,
        dispatcher({
          name: `wake-${seat.id}`,
          flowKind: seat.id,                     // the seat's own address
          action: wake,
          inputSchema: channelNotifyInputSchema,
          session: { key: (post: ChannelNotifyInput) => `channel:${post.channelId}` },
        }),
      ]];
    }),
  ),
  // Any author means a seat wrote the post: never wake anyone for it.
  // No author: wake the member if it has a dispatcher. Everything else falls back.
  select: (post) => (post.author !== undefined ? "" : post.member),
  fallback: notifyMember,                        // today's name-only line
});

channelInstances(channels, { kinds: { channel: defineChannelFlow({ notify: wakeAgents }) } });
```

Key the session on the channel, as above, and each seat keeps one conversation per channel: the
second post it hears lands in the same conversation, so it remembers the thread. Two posts that
arrive together each run once, in no guaranteed order. Key it on `postId` instead and every post
starts a fresh conversation. The conversation is a child of the channel's session, so an ordinary
session listing does not show it; list with dispatch runs included (`include: "dispatch-runs"`, or
`includeDispatchRuns` on `FlowNavigator`) to find it.

Skip the wake when the post carries an `author`. Every author a post can carry is a member, so
that is a seat talking, and two agents that wake each other answer each other forever. Other
members can still get whatever your fallback sends.

A busy channel keeps growing that conversation, and a seat remembers only as far back as its
history window reaches. Nothing summarizes the older posts for it yet.

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

The model calls `post-to-channel` with the channel's id and what to say. A woken seat reads the id
off the post it heard, `<writer> in <channel>: <body>`. The tool posts through that channel's own
`post`, and the line's `author` is the seat's `seatId`: its record id, the name the channel's
`members:` lists. The model cannot set it. The tool's input is `{ channel, body }` and nothing
else, so a call that adds an `author` is refused. A seat that doesn't name the tool is never
offered it.

A post a seat writes carries a seat as its author, so the fan-out can tell it from a person's
post. That is how two agents in one channel avoid answering each other forever: skip the wake
when the post has an `author`, as in [Waking an agent seat](#waking-an-agent-seat), and a seat's
post wakes no seat.

Four limits:

- The seat must be a member. The channel refuses any other author and writes nothing, and the
  seat is not told: the tool reports that it handed the post over, not that it landed. The
  refusal is on the channel's own request log.
- Only the built-in channel kind takes these posts. A kind of your own would need a `post` that
  another flow can call. A channel id nobody opened, or one on another kind, fails the call by
  name.
- It needs dispatch to run in process. If your host hands dispatch to an external queue, a
  delivery into the channel's existing session is refused before it is queued, and the tool call
  fails saying so.
- The name is still a claim the channel can't check. The server set it, but the line is stored
  with `authorVerified: false`, like any other.

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

The dispatch goes into an existing session by its id, which needs the in-process dispatcher. Under an external dispatcher such as BullMQ it is refused with a `DispatchRefusedError` whose `refused` is `"external-dispatcher"`. To tell the model the board is unavailable rather than letting the tool fail, put the dispatcher in a sequencer and handle the error in the sequencer's `.rescue()`.

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

Board ledgers are organization-scoped, so the read resolves against the organization the reading session belongs to. What crosses is `id`, `title`, `goal`, `status`, `assignee`, `priority`, `attempts`, `maxAttempts`, `deps`, `labels`, `error`, `createdAt`, `updatedAt`, `startedAt` and `completedAt`.

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

A board that no hired worker declares warns at hire, naming the channel and the board. Nothing is refused: a channel may keep a board that only people read.

A board's rows are stored at organization scope, so they sit in [the organization the channel runs in](#which-organization-a-channel-runs-in).

Rename or move a channel's folder and its boards move with it, since a board's id comes from where the channel sits. Rows filed under the old id stay there and nothing migrates them. The unattended-board warning is what makes that visible.

The rows themselves are [task substrate](../orchestration/task-substrate.md) rows, with the same fields, statuses and transitions any other board's carry.

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

## What channels do not do yet

- No join or leave. Membership is the declared list; changing it means changing the record and opening a fresh channel.
- No watching of a channels tree. It is read once, at startup.
- No delete, and no retirement.
- No summary pass over a long transcript.
- No resolution of member names. A `members:` entry naming a worker that does not exist is accepted, and a delivery to it fails like any other delivery.
