---
title: Channels
sidebar_position: 9
sidebar_label: Channels
description: "A channel is a named session on a flow kind the framework ships: several agents talking about one topic, with one durable transcript and nobody owning a row."
---

# Channels

Several agents working one topic. Each of them reads what the others said. Nobody owns a row, nobody settles anything, and the conversation needs somewhere to live that outlasts whoever spoke last.

That is a channel. The framework ships one kind that runs them, and a channel is a named session on it.

## What a channel is

Two framework words first, because the rest of the page leans on them.

A **flow kind** is a definition you register. A **session** is one conversation running on a registered flow, with its own durable state. A **seat** is one named participant — a worker, a person, anything that posts.

A channel is a session. Not a flow, not a collection, not a new type sitting beside them. The framework ships the kind — it is called `channel` — and every channel you open is another named session on that one registered instance. Two channels, one instance. A hundred channels, still one instance.

That is worth pausing on if you arrived from [workers on disk](./workers-on-disk.md), where one `WORKER.md` becomes one running flow copy. Channels do not work that way. The per-channel facts — who the members are, what the charter says, what has been said — live in each session's own state, which is where the framework already keeps durable per-conversation facts. Registering a copy per conversation would buy nothing.

Session state is also why the conversation stays in one place. A post is a request into the channel's session, so the work and the record land on the channel rather than on whoever posted.

:::tip When a channel, and when something else

1. **One-shot, "go do this" → a dispatch** into that flow's own session. Nothing about it wants a shared transcript.
2. **Back-and-forth, "keep talking" → a channel**, when you want one durable home for the history and posts that land on the channel rather than on the poster. A DM is the one-member case of the same thing, not a separate mechanism.
3. **Claim it and settle it → the [task board](./task-substrate.md)**, not a channel. Channels are many participants and no claim; a row that somebody takes and finishes is a board's job.
4. **Do not fake a DM by dumping the dialogue into a worker's session.** Session history is machinery — tool calls, refusals, dispatch handles. A channel is what owns a clean transcript.
5. **Do not put seat-owned work on a channel.** A post runs in the channel's session and waking members is a notification; neither one hands anybody a claim.

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

`members` is the channel's roster. It decides who gets woken when somebody posts, and it is checked when a post claims to be from a particular seat. It is the declared list and nothing else writes it: there is no join or leave verb yet, so changing who is in a channel means changing the record.

Four keys are declarable — `flow`, `description`, `members`, `instructions` — and the list is closed. Anything else is refused by name when you bind the roster, along with an `id:` (a channel's id is its identity, not a setting) and a body given alongside `instructions:` (two sources, no precedence rule).

## Opening it, and why an unopened id is not a channel

Binding happens in two calls, because the two halves happen at two different times. An instance is registered when the server is built. A session can only be opened once the server is running.

```ts
import { channelInstances, openChannels } from "@flow-state-dev/workforce";

// Build time. One instance per distinct kind — not one per record.
flowRegistry.registerMany(channelInstances(channels));

// Runtime. One named session per record, at the record's own id.
await openChannels(channels, { client: sessionClient, userId: "u_42" });
```

`openChannels` is idempotent: a channel that is already open is left alone, so re-running it over an unchanged roster does nothing. The flip side is that re-opening is not a migration. An edited record — a member added, a charter rewritten — does not reach a channel that is already open.

Opening matters more than it looks. The one registered instance answers for every session id, and naming a session that does not exist creates an empty one rather than refusing. So a channel is not "a session id somebody used" — it is a session that was opened as a channel, carrying members and a charter. Post to an id nobody opened and you get `channel-not-bound`, nothing is written, and the empty session stays inert. That refusal is what stops any caller from conjuring a channel by naming one.

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

The flow you address is the **kind**; the channel is the **session id**. Address `{ id }`, never `{ key }` — a key-derived session is a child of whoever dispatched it, so the same key lands somewhere different for every poster and the channel never sees the post. Nothing detects that mistake, so it is worth getting right the first time.

`read` gives back the channel: its description, its members, and the transcript.

```ts
{
  id: "engineering.standup",
  description: "Where the engineering team posts daily status.",
  members: ["engineering.lead", "engineering.analyst"],
  transcript: [
    { at: 1789231233813, principal: "u_42", author: "engineering.lead",
      authorVerified: false, body: "shipped the reader" },
  ],
}
```

That is deliberately not the session's item history, which carries tool calls, dispatch handles and refusals. The transcript is the part a human or another agent should read.

Posts on one channel are serialized, so two that land at once both make it into the transcript. Posts on two different channels never wait on each other, because they are different sessions.

## What the transcript proves, and what it doesn't

Read this part before you build anything on a channel's history.

A session belongs to one user. That means **every line of a given channel carries the same `principal`** — the server-derived identity the post ran under. It is a real value and the framework sets it, but it does not tell you which participant wrote a line, because it is the same for all of them.

The `author` field is what distinguishes participants, and the framework cannot verify it. The poster supplies it, and it is stored beside `authorVerified: false` to say so out loud. A post claiming an `author` who is not in the channel's members is refused, but that is a check against the declared roster, not proof of who is calling.

So: a channel transcript is evidence that the channel's own principal wrote a line. It is close to no evidence about which seat did. If you are building an audit trail or an approval flow, this gives you a much weaker guarantee than the field names suggest. Naming the posting seat needs something the framework does not expose yet.

## Where posting from another flow works, and where it doesn't

A post from one flow into a channel's session is a delivery into a session that already exists. That needs dispatch to run in the same process.

On a deployment whose dispatcher hands work to an external queue, such a delivery is refused by name — `external-dispatcher` — whether or not the session exists. A delivery into a live session has to be arbitrated against that session's own concurrency policy and be reachable from the process making it, and past a queue boundary neither holds, so it refuses rather than under-delivering.

Client posts through the ordinary action route still work on the same host. Only the flow-to-flow door closes. Worth knowing before you design a channel into a queued deployment.

## Waking members

By default a post lands and nobody is told. Give the kind a notify block and it runs once per declared member per post:

```ts
channelInstances(channels, { kinds: { channel: createChannelFlow({ notify: wakeMember }) } });
```

The delivery runs in its own request, outside the post's turn, so a slow notification never delays the next post. A delivery that fails is recorded and the rest are still attempted; the post stays written either way, because the transcript is the durable record and waking people is best-effort.

Your block supplies the addresses. The framework will not pick a dispatch target out of stored data, so a notify block declares the recipients it can reach rather than reading one off the members list. Today that means one declaration per recipient kind.

## Registering a kind of your own

You will usually not need this. A standup, a direct message and an announcement channel are all channels on the one built-in kind, told apart by their members and their charter — not by being different kinds.

When the workflow genuinely diverges, pass your own factory at boot:

```ts
channelInstances(channels, { kinds: { "my-channel": createMyChannelFlow() } });
```

A record carrying `flow: my-channel` then runs on that kind's own instance, and every channel naming it is a session there. One instance per custom kind — still never one per record. A `flow:` naming a kind you did not pass is refused by name; it never quietly falls back to the built-in.

That map is the whole registration surface. There is no second API, and a custom factory carries the same contract the built-in does: one kind, one instance.

## What channels do not do yet

- No join or leave. Membership is the declared list; changing it means changing the record and opening a fresh channel.
- No delete, and no retirement.
- No summary or housekeeping pass over a long transcript.
- No resolution of member names. A `members:` entry naming a seat that does not exist is accepted, and a delivery to it fails like any other delivery.
