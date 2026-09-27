# FIX-1610 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Drafted by the spec author, not by `docs-writer`: this session could not dispatch it. The
implementer runs `docs-writer` and then `docs-editor` over these drafts against what shipped,
before publishing. Voice rules most at risk: no internal ids, introduce "evaluator" and "notify
slot" in plain words, few em-dashes, and the example model follows the docs' usual choice.

## NEW · `apps/docs/docs/workforce/channels.md` · "Routing a channel", after "Waking agent seats"

Headings below are one level down from how they publish: `###` here is `##` there.

### Routing a channel

Waking every agent in a channel suits a standup. It doesn't suit a support channel, where a
question about a printer should reach the one specialist who handles devices and nobody else.
Routing does that: each post from a person goes to one member, picked by what the post is about,
and that member's answer shows in the channel.

Turn it on in the channel's file by naming the member who takes whatever fits nobody else:

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
  route: routeByPurpose(seats, { model: routeModel }), // any model an evaluator accepts
});
```

An evaluator is a block that answers typed questions with one model call. Not every model can do
that; see [Evaluation models](/docs/fundamentals/models#evaluation-models). A channel without the
`routing:` line keeps waking every agent member, even on a kind built with a route.

The fallback has to be a member whose hired seat can hear a post, or the app refuses to start and
names the channel. The `routing:` line is read from the file each time the app starts, so adding
it to a channel that is already open routes that channel from the next start, with its lines
kept.

#### How a post finds its member

For each post from a person, in this order:

1. **The member already on it.** If the person's last post went to a member who hasn't answered
   yet, this one goes there too. No model call.
2. **One evaluator call.** Otherwise the route asks one question: which member should answer?
   The choices are the members whose seat can hear a post, each described by the `description:`
   in its `WORKER.md`. The model also sees the channel's recent lines, which is how "it fails
   right after the password" reaches the specialist who asked about the password.
3. **The fallback.** If the call fails, or answers with something that isn't a member, the
   fallback member takes the post. If the person posting can't reach any seat of the fallback's,
   nobody answers, and the route records why.

Only that member receives the post. Nobody else in the channel is told about it. A post a seat
wrote is never routed and wakes nobody, as in any channel.

Write the `description:` lines for the route to read. "Printers, laptops, phones and wifi" routes
better than "Our devices person".

Each decision is recorded on the channel's session as a `channel-route` item: which member, and
whether it came from the member already on it, the evaluator, or the fallback, with the reason
when the fallback took it or nobody could. It never shows as a line in the channel, and the chat
renderers skip it.

#### The answer lands in the channel

The routed member answers the way any woken seat does, in its own conversation. The difference is
what happens to the reply: it is posted into the channel as that seat's line, every time. The
model doesn't have to call `post-to-channel`. If it does, its first post is the answer and
nothing more is posted for that question. An empty reply posts nothing and ends that seat's run
as failed.

#### What the member sees when it answers

The routed member's model sees the channel's last 20 lines along with the post, whoever wrote
them and whoever they went to. That's how "where can I buy it?" finds its "it" when the laptop
came up with another member. The lines are there for that one answer. They aren't kept in the
member's conversation, so anything older than the last 20 lines is out of its view. A seat woken
in an unrouted channel, or talked to directly, gets no lines.

#### What routing can't do

- A member sees only the last 20 lines when it answers. Something said earlier may have to be
  said again.
- A second question sent before the first is answered goes to the same member, whatever it's
  about.
- A follow-up after an answer relies on the evaluator call. If that call fails, the follow-up goes
  to the fallback.
- One model per channel kind. Two channels on the same kind route with the same model.
- A change to `routing:` waits for the next start.

In a test, script the route's evaluation by its block name, `channel-route`, with
`createMockModelResolver` from `@flow-state-dev/testing`.

## UPDATE · `apps/docs/docs/workforce/channels.md` · "Declaring a channel", the key list

Replace "Five keys are declarable: `flow`, `description`, `members`, `boards`, `instructions`."
with:

> Six keys are declarable: `flow`, `description`, `members`, `boards`, `instructions` and
> `routing`. [Routing a channel](#routing-a-channel) covers the last.

## UPDATE · `apps/docs/docs/workforce/channels.md` · "A seat answering in the channel", after the first paragraph

> In a [routed channel](#routing-a-channel) you don't need the tool for the member a post was
> routed to: its reply is posted for it. The tool is for everything else, such as a seat talked
> to directly that wants to say something in a channel.

## UPDATE · `apps/docs/docs/workforce/workers-on-disk.md` · after "`description` is the only key the file itself requires."

> In a [routed channel](./channels.md#routing-a-channel), it is also what the route reads to decide
> whether a post is this worker's.

## UPDATE · `packages/workforce/README.md`

"Channels", the key sentence: "A record declares five keys" becomes six, adding `routing` (see the
channels guide, "Routing a channel").

Exports table, beside `wakeMemberSeats`:

| `routeByPurpose(seats, { model })` | The route a channel kind takes as `defineChannelFlow({ route })`. For a channel that declares `routing:`, each post from a person goes to one member: the one still on the person's last post, else one evaluator call's pick (block name `channel-route`), else the declared fallback. That member answers with the channel's last 20 lines in view, and its reply is posted into the channel as its line. |

`defineChannelFlow(options?)` row: add "`options.route` is the route from `routeByPurpose`."

"Posting to a channel from a seat": add one sentence: a routed member's reply is posted for it;
the notify input carries `routed: true` and `recent`, the channel's last lines, for that delivery.

## UPDATE · `packages/testing/README.md` · the paragraph "`createMockModelResolver` has no `resolveEvaluationModel`…"

> `createMockModelResolver` takes `evaluators`, keyed by block name like `generators`, so an
> evaluator with a model **string** resolves to the scripted one. A scripted evaluation can
> compute its answer from the state it is handed.

## Changesets

`@flow-state-dev/workforce` patch: routed channels, `routeByPurpose`, the `routing:` key, the
`routed` and `recent` notify fields. Additive, so a patch before 1.0. `@flow-state-dev/testing`
patch: `evaluators` on `createMockModelResolver`. `@flow-state-dev/ui` is private: its registry
line gets none.

## Publication ownership

This issue publishes all of the above in its implementation PR, after VG. FIX-1611 owns the
kitchen-sink README and its desk. FIX-1609 owns anything about the live view.

## Not changed

No architecture doc names the notify slot's recipients or the channel's fan-out, so none changes.
