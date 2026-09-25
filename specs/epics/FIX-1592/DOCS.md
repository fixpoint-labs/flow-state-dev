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
> `support.ada` is a desk clerk: ask it something and a model answers, or, when the note needs
> someone else, files it onto `followups` or `escalations`.
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

## UPDATE · `apps/kitchen-sink/README.md` · "Nothing is wired to `escalations`", after the boot line

> The clerk files there when a note needs a person, so this is where you see those rows wait.

## Ownership

| Material | Publisher | Specific draft |
|---|---|---|
| The opening's first two paragraphs | FIX-1585 publishes the seat half without the clerk sentence; FIX-1589 adds the clerk sentence; FIX-1594 adds the channel half, once every sentence is true | This document |
| The `escalations` sentence, and `desk-clerk.ts`'s header | FIX-1589 | This document · its `DOCS.md` |
| The fan-out paragraph, and `channel-notify.ts`'s header | FIX-1590 | This document · its `DOCS.md` |
| The agent kind's receiver and posting, in the channels guide | FIX-1590, FIX-1594 | Their `DOCS.md` |
| The composers | FIX-1585 | [Its `DOCS.md`](https://github.com/fixpoint-labs/flow-state-dev/blob/spec/FIX-1585/specs/issues/FIX-1585/DOCS.md) |

The rest of the "Nothing is wired to `escalations`" section stays as it is: nobody drains the
board while FIX-1591 is held. Do not publish the opening because this spec merged.
