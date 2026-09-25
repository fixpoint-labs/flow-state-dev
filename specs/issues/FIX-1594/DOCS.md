# FIX-1594 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

Four destinations, no new page, no sidebar change. The channels page gets one section on a seat
posting back. The worker-contract table gains its new row in the published page and the package
README. Kitchen-sink's README gets the epic's channel half, which this issue publishes last
([epic DOCS](../../epics/FIX-1592/DOCS.md), ER-19).

Voice rules most at risk here: no sentence opening with "This", no em-dash chains, and say
plainly that the name on a seat's line is still unverified.

## UPDATE · `apps/docs/docs/workforce/channels.md` · new `## A seat answering in the channel`, after "Waking members"

## A seat answering in the channel

Waking a seat runs it in its own conversation, so its answer stays there unless it posts it. To
let an agent seat answer where the post was made, give its kind the channel-post capability and
name the tool in the seat's worker file:

```ts
defineAgentWorkerFlow({ uses: [channelPost] }); // the capability from @flow-state-dev/workforce
```

```md
---
description: Answers questions on the support desk.
tools: [post-to-channel]
---
```

The model calls `post-to-channel` with the channel's id and what to say. The tool posts through
that channel's own `post`, and the line's `author` is the seat's own id. The model cannot set it:
the tool takes no `author`, and the hire writes the seat's id into its settings. A seat that
doesn't name the tool is never offered it.

A post a seat writes carries a seat as its author, so the fan-out can tell it from a person's
post. That is how two agents in one channel avoid answering each other forever: a seat's post
wakes no seat.

Three limits:

- The seat must be a member. The channel refuses any other author and writes nothing, and the
  seat is not told: the tool reports that it handed the post over, not that it landed. The
  refusal is on the channel's own request log.
- Only the built-in channel kind takes these posts. A kind of your own would need a `post` that
  another flow can call.
- The name is still a claim the channel can't check. The server set it, but the line is stored
  with `authorVerified: false`, like any other.

## UPDATE · `apps/docs/docs/workforce/workers-on-disk.md` · the paragraph starting "`workerConfigSchema()` is the set of settings"

Add, after "…when its team wrote one.":

It also carries `seatId`, the seat's own address, so a block running inside the seat can tell
which seat it is.

And add `seatId:` to the refused keys in line 59's list and in the hire's refusal list at line 204.

## UPDATE · `packages/workforce/README.md` · the contract table under "A worker kind is an ordinary flow"

Add a row:

| `seatId` | The seat's own address, e.g. `support.otto`. Imposed on every seat by the hire, from the record; a worker file that writes `seatId:` is refused. Blocks read it to act as the seat, as `post-to-channel` does for a line's author. |

And in the sentence under the table, add `seatId` to "`seatSkills` and `seatTools` always".
Add `seatId:` to the refused keys at line 88.

## UPDATE · `packages/workforce/README.md` · new `### Posting to a channel from a seat`, after "Hire and fire as catalog tools"

### Posting to a channel from a seat

The channel-post capability puts one tool, `post-to-channel`, on a worker kind's catalog. A seat
names it in `tools:` to use it. Its input is `{ channel, body }` and nothing else. The line is
posted through the built-in channel kind's `post`, with the seat's `seatId` as `author`, so the
channel's member check applies and the fan-out sees a seat's post. The tool returns once the post
is handed to the channel; a refusal lands on the channel's request, not in the seat's turn.

## UPDATE · `apps/kitchen-sink/README.md` · the support team's channels, the opening's channel paragraph

Publish the [epic's draft](../../epics/FIX-1592/DOCS.md) paragraph as written, once FIX-1590's
fan-out sentence is true, with this sentence changed to name the seat that answers:

> Open `support.desk` and post. Every agent seat on the channel gets the post and runs once on
> it, and `support.otto` answers in the channel itself, under its own name. A post an agent
> writes wakes nobody, so two agents in a channel don't answer each other forever.

## Publication ownership

FIX-1594 publishes all of the above after its goal check passes. The kitchen-sink opening's other
sentences belong to FIX-1585, FIX-1589 and FIX-1590; reconcile with whatever they published and
don't repeat it. The fan-out and its filter are documented by FIX-1590 under "Waking members";
the new section links to it rather than restating it.
