# FIX-1602 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The destinations below are as they will read once FIX-1590 and FIX-1594 have merged. FIX-1590
publishes the recipe this replaces; this issue replaces it rather than adding a second way beside
it. Voice rules most at risk here: no "stock"/"out of the box" marketing, introduce "notify slot"
and "internal entry" in plain terms, few em-dashes.

## UPDATE · `apps/docs/docs/workforce/channels.md` · replace the section "Waking an agent seat" (under "Waking members")

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

For each post, and each member of the channel, it decides one thing: does this member run?

- **A member runs** when the post names no `author` and the member's seat can hear a post. A seat
  of the built-in `agent` kind can. It runs its ordinary answer, with the post as its turn:
  `support.lead in support.desk: can someone look at the refund queue?`.
- **Nobody runs** when the post names an `author`. Every author a post can carry is a member, so
  that is a seat talking, and two agents that wake each other answer each other forever. There is
  no switch for this. If you want agents to hear each other, write your own notify block.
- **Nobody runs** for a member whose kind can't hear a post, or who has no hired seat. That
  includes a seat hired at runtime: the wake is built from the seats you pass at boot.

Each woken seat keeps one conversation per channel. The second post it hears lands in the same
conversation, so it remembers the thread. Two posts that arrive together each run once, in no
guaranteed order. The conversation is a child of the channel's session, so an ordinary session
listing does not show it. List with dispatch runs included (`include: "dispatch-runs"`, or
`includeDispatchRuns` on `FlowNavigator`) to find it.

Members who don't run get nothing, the same as a channel with no notify slot. To send them
something else, pass a `fallback` block. It receives the same input a notify block does:

```ts
defineChannelFlow({ notify: wakeMemberSeats(seats, { fallback: tellByEmail }) });
```

The fallback also receives the writer's own delivery when a seat posts. Skip it there if you
don't want to tell someone about their own post, as the handler earlier on this page does.

#### Making a kind of your own hear posts

A kind can hear a post by declaring an internal entry named `onChannelPost` that takes
`ChannelNotifyInput`. An internal entry is one only a dispatch can reach, never a client. That
declaration is all `wakeMemberSeats` looks for. There is no list of kinds to update.

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
a seat run, and they can't reach anyone outside the channel. Verified authorship is not built yet.

A busy channel keeps growing each seat's conversation, and a seat remembers only as far back as
its history window reaches. Nothing summarizes older posts for it yet.

## UPDATE · `apps/docs/docs/workforce/channels.md` · "Waking members", the paragraph ending "…any member you have no dispatcher for."

Append one sentence:

> For agent seats you don't have to build this yourself: see [Waking agent seats](#waking-agent-seats).

## UPDATE · `packages/workforce/README.md` · "Waking members", replace the paragraph FIX-1590 appended

`wakeMemberSeats(seats, { fallback? })` returns a notify block that wakes each member whose hired
seat declares the internal `onChannelPost` entry, once per post, in one conversation per seat per
channel. A post with an `author` wakes nobody. Members who aren't woken get `fallback`, or nothing.
Pass the seats `hireWorkforce` returned, and hire before you build channels. See the channels
guide, "Waking agent seats".

Add a row to the Exports table, beside `defineChannelFlow`:

| `wakeMemberSeats(seats, options?)` | The notify block that wakes each member seat declaring `onChannelPost`, never on a post with an `author`. `options.fallback` runs for everyone else. |

## UPDATE · `apps/kitchen-sink/README.md` · the paragraph "Posting to a channel reaches its members…"

Replace its last sentence with:

> The wake is Workforce's `wakeMemberSeats`. `workforce/channel-notify.ts` only adds this app's
> name-only line as the fallback, for every member the wake doesn't run.

## UPDATE · `apps/kitchen-sink/workforce/channel-notify.ts` · file header

Replace the paragraph beginning "One dispatcher per agent seat the app hired…" with:

> The wake itself is Workforce's `wakeMemberSeats`, over the seats hired at boot. This file adds
> the one thing that is this app's: a transient line naming each member the wake doesn't run,
> and nothing for the writer of a post. The goal checks' two wake controls wrap the helper here,
> from `lib/channel-wake-control.ts`, and never reach the package.

The paragraphs on declining a delivery and on comparing `author`, not `principal`, stay.

## Publication ownership

This issue publishes all of the above in its implementation PR, after V3. FIX-1590 owns the
surrounding "Waking members" section and its handler example; only the named passages change.

## Not changed

`docs/architecture/action-forms.md` already says an internal entry is reached only by a
dispatch. No architecture doc names the notify slot's recipients.
