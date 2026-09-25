# FIX-1590 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Four operations. The kitchen-sink README's opening is the epic's shared text
([its DOCS.md](../../epics/FIX-1592/DOCS.md)); this issue owns its fan-out paragraph, the notify
block's header, and the agent kind's receiver in the channels guide and the package README.

## UPDATE · `apps/docs/docs/workforce/channels.md` · "Waking members", after the paragraph ending "…any member you have no dispatcher for."

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
second post it hears lands after the first, so it remembers the thread. Key it on `postId`
instead and every post starts a fresh conversation. The conversation is a child of the channel's
session, so an ordinary session listing does not show it; list with dispatch runs included
(`include: "dispatch-runs"`, or `includeDispatchRuns` on `FlowNavigator`) to find it.

Skip the wake when the post carries an `author`. Every author a post can carry is a member, so
that is a seat talking, and two agents that wake each other answer each other forever. Other
members can still get whatever your fallback sends.

A busy channel keeps growing that conversation, and a seat remembers only as far back as its
history window reaches. Nothing summarizes the older posts for it yet.

## UPDATE · `packages/workforce/README.md` · "Waking members", appended

A seat of the built-in `agent` kind declares `onChannelPost`, an internal entry that takes a
`ChannelNotifyInput` and runs the seat's answer with the post as its turn. Point one dispatcher
per agent member at it (`flowKind` = the seat id, `session: { key }` on the channel) and choose
between them by `member`. Skip it when the post has an `author`, or two agents answer each other
forever. See the channels guide, "Waking an agent seat".

Add to the Exports table's row for `defineAgentWorkerFlow`: *"Its flow declares `run` (public)
and `onChannelPost` (internal, for a channel's notify block)."*

## UPDATE · `apps/kitchen-sink/README.md` · replace the paragraph "Posting to a channel notifies its members…"

> Posting to a channel reaches its members, and never the member who wrote the post. An agent
> seat runs on a post a person writes: `support.iris` and `support.otto` each answer once, in a
> conversation of their own for that channel, which you find under the seat in the rail. A post a
> seat writes runs nobody. The `desk-clerk` and `followup-runner` seats get a line naming them
> and nothing more. The rule lives in `workforce/channel-notify.ts`, this app's own fan-out block:
> the framework addresses every declared member, and the block decides who hears what.

Published with the epic's opening paragraphs, once FIX-1594's half is also true.

## UPDATE · `apps/kitchen-sink/workforce/channel-notify.ts` · file header

Replace "Deliberately the simplest thing that is still real … A real app puts a dispatcher here,
pointed at each recipient kind it declares." with:

> One dispatcher per agent seat the app hired, pointed at that seat's `onChannelPost` and keyed on
> the channel, so each seat keeps one conversation per channel. Which kinds wake, and through
> which entry, is the wake column of `lib/workforce-shell.ts`'s kind map. Every other member, and
> every post a seat wrote, gets one transient line naming the member, which is what this block
> did for everyone before.

The paragraphs on declining a delivery and on comparing `author`, not `principal`, stay.

## Not changed

`docs/architecture/action-forms.md` already says an internal entry is reached only by a dispatch;
this issue adds an entry, not a rule. The channels guide's opening and "What channels do not do
yet" stay.
