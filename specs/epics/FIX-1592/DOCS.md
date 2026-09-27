# FIX-1592 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

One story changes: kitchen-sink's support team goes from six named seats to one conversation
and four specialists. This draft is that shared text. Each child's `DOCS.md` owns the specifics:
the route line in the channels guide, the answer rule, the live stream. Ids are working names
until the rebuild's spec confirms them.

## UPDATE · `apps/kitchen-sink/README.md` · "The support team (`workforce/`)", replaced whole

> The support team is one conversation and four specialists.
>
> Open `support.help` in the rail and ask a question. The channel sends each post to the one
> specialist whose job fits it: `support.devices` for hardware, `support.accounts` for sign-in
> and billing, `support.fsd` for questions about this framework, and `support.general` for
> anything else. You see which specialist is working on it, then its answer, in the same view,
> without reloading.
>
> Each specialist keeps only its own cases. Ask about a printer and then about your password,
> and the two questions land in two different specialists' histories. The cost: if a question
> leans on something you told a different specialist, say it again.
>
> You can also open a specialist in the rail and talk to it directly. That conversation is
> separate from the channel, and it keeps both sides across a reload.
>
> When a case needs a person, the specialist files it onto the channel's `escalations` board
> and says so. Nobody works that board in this app, and the server says so at every boot.
>
> The routing is one line in the channel's `CHANNEL.md`. A specialist's job is the
> `description:` in its `WORKER.md`:
>
> ```md
> ---
> description: Printers, laptops, phones, anything with a power button.
> ---
>
> You help with devices. Answer in a sentence or two, and say plainly when you don't know.
> ```
>
> The channel picks among those descriptions with one model call per post, and sends a post
> that fits none of them to `support.general`. Take the routing line out and every specialist
> hears every post, which is what a channel does by default.

## UPDATE · `apps/kitchen-sink/README.md` · Web application, the Channels and Seats bullets

> - **Channels**: Open one in the rail to read it and post. Your post calls the channel's own
>   `post` action, the same one `fsdev run` calls. Lines other requests post appear while the
>   view is open, and the view shows which specialist is working.
> - **Seats**: Open a specialist to talk to it directly. Your message and its reply stay in that
>   conversation.

## REMOVE · `apps/kitchen-sink/README.md` · "A seat that hires", the rail's "Hire another", `ada-wren`, `noticeboard`, `desk-clerk` and `followup-runner` passages

Only if [O1](DECISIONS.md#o1) goes as recommended. "Hiring while the app runs" shrinks to the
operator's HTTP hire, with a line that page hiring returns once a hired specialist can join the
channel.

## UPDATE · `CLAUDE.md` · package map, `apps/kitchen-sink` row

> Canonical reference app (Next.js): a support desk on Workforce, and the other subsystems it
> hosts. Features with no job in it are proven by fixture hosts under `goals/`.

Only if O1 goes as recommended.

## Ownership

| Material | Publisher | Specific draft |
|---|---|---|
| The support-team section and the two bullets above | The rebuild, once every sentence is true on `main` (ER-19) | This document |
| The removals, the `CLAUDE.md` row, `docs/atlas` lines naming `desk-clerk` | The rebuild, per O1 | This document |
| Routing a channel, in `apps/docs/docs/workforce/channels.md` | Routed channel | Its `DOCS.md` |
| A routed seat's answer always lands, in the same guide | FIX-1610 | Its `DOCS.md` |
| An open session view hears every request in its session, in the react and client docs | FIX-1609 | Its `DOCS.md` |
| The gateway key in Setup | FIX-1606 | [#2305](https://github.com/fixpoint-labs/flow-state-dev/pull/2305) |

No change to `durable-hire.md` or `ui.md`: their `support.*` names are generic examples, not
pointers into kitchen-sink. Do not publish because this spec merged.
