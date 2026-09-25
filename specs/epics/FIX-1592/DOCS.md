# FIX-1592 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

One story changes: kitchen-sink's README describes a team you read about into one you talk to,
directly or through a channel. The published channels guide is each child's own `DOCS.md` to
decide; this draft is the shared kitchen-sink text.

## UPDATE · `apps/kitchen-sink/README.md` · the support team's channels, new opening paragraph

> You can talk to the team from the page, two ways.
>
> Open `support.otto` in the rail and send it a message. A seat is one agent with its own memory,
> so this is a conversation: your message and its reply stay there when you come back.
>
> Open `support.desk` and post. Every agent seat on the channel gets the post and runs once on
> it, and an agent can answer in the channel itself, under its own name. A post an agent writes
> wakes nobody, so two agents in a channel don't answer each other forever.
>
> Every one of those buttons calls an action the flow already declares, the same one `fsdev run`
> calls. The page has no API of its own.

## UPDATE · `apps/kitchen-sink/README.md` · "Posting to a channel notifies its members…"

> Posting to a channel reaches its members, and never the member who wrote the post. An agent
> seat runs on a post a person writes; a post a seat writes runs nobody. The `desk-clerk` and
> `followup-runner` seats get a line naming them and nothing more.

## Ownership

| Material | Publisher | Specific draft |
|---|---|---|
| The opening's first two paragraphs | FIX-1585 publishes the seat half; FIX-1594 adds the channel half, once every sentence is true | This document |
| The fan-out paragraph, and `channel-notify.ts`'s header | FIX-1590 | This document · its `DOCS.md` |
| The agent kind's receiver and posting, in the channels guide | FIX-1590, FIX-1594 | Their `DOCS.md` |
| The composers | FIX-1585 | [Its `DOCS.md`](https://github.com/fixpoint-labs/flow-state-dev/blob/spec/FIX-1585/specs/issues/FIX-1585/DOCS.md) |

The "Nothing is wired to `escalations`" section stays as it is (FIX-1591 is a follow-on). Do not
publish the opening because this spec merged.
