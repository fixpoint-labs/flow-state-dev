---
title: Channels
sidebar_position: 4
sidebar_label: Channels
description: "A channel is a named session on a flow kind the framework ships: several agents talking about one topic, with one durable transcript, where nobody is assigned the work and nobody closes it out."
---

# Channels

Several agents working one topic. Each of them reads what the others said. Nobody is assigned the work and nobody closes it out, and the conversation needs somewhere to live that outlasts whoever spoke last.

That is a channel. The framework ships one kind that runs them, and a channel is a named session on it.

## What a channel is

A **flow kind** is a definition you register. A **session** is one conversation running on a registered flow, with its own durable state. A channel's **members** are the names it lists, usually [hired workers](./workers-on-disk.md).

A channel is a session. Not a flow, not a collection, not a new type sitting beside them. The framework ships the kind, which is called `channel`, and every channel you open is another named session on that one registered instance. Two channels, one instance. A hundred channels, still one instance.

That is worth pausing on if you arrived from [workers on disk](./workers-on-disk.md), where one `WORKER.md` becomes one running flow copy. Channels do not work that way. What differs per channel (who the members are, what the charter says, what has been said) lives in each session's own state.

Session state is also why the conversation stays in one place. A post is a request into the channel's session, so the work and the record land on the channel rather than on whoever posted.

:::tip When a channel, and when something else

1. **One-shot, "go do this" → a dispatch** into that flow's own session. Nothing about it wants a shared transcript.
2. **Back-and-forth, "keep talking" → a channel**, when you want one durable home for the history and posts that land on the channel rather than on the poster. A DM is the one-member case of the same thing, not a separate mechanism.
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

`members` is the channel's roster. It decides who gets woken when somebody posts, and it is checked when a post claims to be from a particular member. It is the declared list and nothing else writes it: there is no join or leave verb yet, so changing who is in a channel means editing the record and opening a fresh channel. An edit does not reach a channel that is already open.

Five keys are declarable: `flow`, `description`, `members`, `boards`, `instructions`. The list is closed. Anything else is refused by name when you bind the roster, along with an `id:`, a `system:`, and a body given alongside `instructions:`.

## Holding a board

A channel is where a team talks. A board is where its work sits: rows carrying a goal, an optional assignee, and a status somebody moves. A channel can hold one, declared in the same frontmatter as the members.

```md
---
description: Where the engineering team works incidents.
members: [engineering.lead, engineering.analyst]
boards: [followups]
---

Post the timeline here. Anything that outlives the incident goes on the board.
```

`boards` is a list of plain local names, the way `members` is a list of names. `followups` is what a person types and what a caller names. The ledger's own id is minted from the channel that holds it, so `engineering.incidents` holding `followups` is `engineering.incidents.followups`. No file writes that id.

A board name is a plain local name: not empty, no whitespace, and none of `.` `/` `*` `[` `]`. The dot is the one worth knowing about, because it is the join between a channel and a board, so `feature.work` would address a board on some other channel. A name breaking the rule is refused when you bind the roster, as is a `boards:` that is not a list of names, a name declared twice, and two channels whose boards would mint the same id.

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

`fileTask` also takes `id`, `title`, `context`, `priority`, `maxAttempts`, `labels` and `input`. Its `author` is the same unverified claim a post's is: checked against the declared members, stored beside `authorVerified: false`, and optional. A row filed without one is accepted.

`readBoard` gives back every row on one board. The channel's own `read` lists what it holds, by name:

```ts
{ id: "engineering.incidents",
  description: "Where the engineering team works incidents.",
  members: ["engineering.lead", "engineering.analyst"],
  boards: ["followups"],
  transcript: [/* … */] }
```

A channel holding no board has no `boards` key and answers neither action.

Naming a board the channel does not hold is refused by name, `board-not-declared`, and the message lists the boards it does hold. The ledger id is minted from the session the request is running in, so naming a board another channel declared resolves this channel's own id and misses.

### Working the rows

The channel keeps the ledger. It runs nothing. A worker that claims rows declares the same board and drains it:

```ts
import { channelBoard } from "@flow-state-dev/workforce";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";

const followups = channelBoard("engineering.incidents", "followups");

const board = taskBoard({
  name: "followups",
  boardId: "followups",
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

To let a model work the rows itself, compose the board's tools into the worker's kind:

```ts
import { channelBoardTaskTools } from "@flow-state-dev/workforce";

// in the kind's definition
uses: [channelBoardTaskTools(followups)],
```

That gives the model all eight task tools over this board: `addTask`, `assignTask`, `updateTask`, `listTasks`, `completeTask`, `failTask`, `blockTask` and `cancelTask`. The set is fixed: a `tools:` list on the worker can neither grant these nor withhold them. So a worker holding the capability can assign rows and settle them, not only add them. A narrower set means a different capability.

A board that no hired worker declares warns at hire, naming the channel and the board. Nothing is refused: a channel may keep a board that only people read.

The rows themselves are [task substrate](../orchestration/task-substrate.md) rows, with the same fields, statuses and transitions any other board's carry.

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

The subpath matters. `@flow-state-dev/workforce/loader` imports `node:fs`, so it only runs on Node. The package root, where the binding calls live, stays isomorphic.

### A channel's id comes from the folders

The team folder and the channel folder, joined with a dot. `teams/engineering/channels/standup/` becomes `engineering.standup`, which is the channel's session id: the id you address when you post to it. The team qualifier means marketing can have a `standup` of its own without checking what engineering called theirs.

Both folder names must be lowercase letters, digits, and single hyphens, at most 64 characters each. So `daily-standup` is fine. `Stand Up` and `stand.up` are reported when the tree is read, with the rule in the message.

### What the file is checked for

`description` is the only key the file itself requires, and `system:` the only one it refuses. Everything else lands on `declared` spelled exactly as you spelled it, and the closed list of four keys is checked later. So a `CHANNEL.md` that says `member:` instead of `members:` reads without complaint and is refused by name when you bind the roster.

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

Pass the org these channels belong to:

```ts
await openChannels(channels, { client: sessionClient, userId: "u_42", orgId: "org_acme" });
```

Every channel session is then opened under that org, and resources stored at org scope resolve inside it. [Documents read from the tree](./documents-on-disk.md) are all org-scoped, so in a channel opened without an org, reading one fails with `Resource "…" is not registered`. The `orgId` argument decides the org only on an app that has not configured [authentication](../server/authentication.md); where a `resolvePrincipal` is in place, each session takes the org of the verified caller, so open your channels as a caller whose identity already carries the org you want. Re-opening cannot move a session between orgs. If you pass an `orgId` and a channel at that id is already open under a different org, or under none, `openChannels` names that channel and stops; delete that session so the next run opens the channel fresh, or drop the `orgId`.

`openChannels` is idempotent: a channel that is already open is left alone, so re-running it over an unchanged roster does nothing. The flip side is that re-opening is not a migration. Add a member or rewrite a charter, and a channel that is already open does not see it. Re-running does repair one thing: a channel whose id was claimed by a post before it was opened. That leaves an empty session, and re-running binds it.

An empty session is the only thing it will clear out of the way. If the id is held by something else — a session belonging to another flow, or to another user, or one carrying state that is not a readable channel — `openChannels` names it and stops. A channel id that collides with a real session is a configuration problem, and the fix is to rename the channel, not to have startup delete somebody's data.

The one registered instance answers for every session id, and naming a session that does not exist creates an empty one rather than refusing. So a channel is not "a session id somebody used". It is a session that was opened as a channel, carrying members and a charter. Post to an id nobody opened and you get `channel-not-bound`, nothing is written, and the empty session stays inert.

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

The transcript is not the session's item history, which carries tool calls, dispatch handles and refusals. The transcript is the part a human or another agent should read.

Posts on one channel are serialized, so two that land at once both make it into the transcript. Posts on two different channels never wait on each other, because they are different sessions.

## What the transcript proves, and what it doesn't

Read this part before you build anything on a channel's history.

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

The delivery runs in its own request, outside the post's turn, so a slow notification never delays the next post. A delivery that fails is recorded and the rest are still attempted; the post stays written either way, because the transcript is the durable record and waking people is best-effort.

Your block supplies the addresses. The framework will not pick a dispatch target out of stored data, so a notify block declares the recipients it can reach rather than reading one off the members list. Today that means one declaration per recipient kind.

## Registering a kind of your own

You will usually not need this. A standup, a direct message and an announcement channel are all channels on the one built-in kind, told apart by their members and their charter, not by being different kinds.

When the workflow genuinely diverges, pass your own factory at boot:

```ts
channelInstances(channels, { kinds: { "my-channel": defineMyChannelFlow() } });
```

A record carrying `flow: my-channel` then runs on that kind's own instance, and every channel naming it is a session there. One instance per custom kind, still never one per record. A `flow:` naming a kind you did not pass is refused by name; it never quietly falls back to the built-in.

That map is the whole registration surface. There is no second API, and a custom factory carries the same contract the built-in does: one kind, one instance.

## What channels do not do yet

- No join or leave. Membership is the declared list; changing it means changing the record and opening a fresh channel.
- No watching of a channels tree. It is read once, at startup.
- No delete, and no retirement.
- No summary pass over a long transcript.
- No resolution of member names. A `members:` entry naming a worker that does not exist is accepted, and a delivery to it fails like any other delivery.
