# FIX-1592 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

One story changes: kitchen-sink's README describes a desk you read about into one you use. The
published site is untouched; [channels.md](../../../apps/docs/docs/workforce/channels.md)
already teaches a notify slot that wakes real recipients. The draft below is the shared text.
Each child's `DOCS.md` carries its own specifics.

## UPDATE · `apps/kitchen-sink/README.md` · the support team's channels, new opening paragraph

> You can use the desk from the page. Open `support.desk` in the rail and post; the line lands
> in the channel's transcript. Open
> `support.ada` and send a note: the front desk answers it from a model, or files it on one of
> the desk's two boards and says so. Rows on `followups` are run by `support.wren`. Rows on
> `escalations` wait for a person, and you pick them up from the board's panel.
>
> Every one of those buttons calls an action the flow already declares, the same one `fsdev run`
> calls. The page has no API of its own.

## REPLACE · `apps/kitchen-sink/README.md` · "Nothing is wired to `escalations`"

> **`escalations` is for a person.** The clerk files what it shouldn't answer there, and the
> board's panel lets you pick a row up and settle it. `support.wren`'s drain never sees those
> rows: a seat reaches only the boards its kind names.
>
> A board no flow declares is reported at boot, because rows filed there would sit pending with
> nothing said. Every board in this app is declared, so this app prints no such line. The
> channels guide's *Holding a board* section describes that warning.

FIX-1591 links that section by its published anchor when it lands.

## Ownership

| Material | Publisher | Specific draft |
|---|---|---|
| The new opening above | FIX-1591, last to land, once every sentence in it is true | This document |
| The `escalations` replacement | FIX-1591 | This document · its `DOCS.md` |
| The clerk's answer-or-file behaviour, the `desk-clerk` header comment | FIX-1589 | Its `DOCS.md` |
| The composers | FIX-1585 | [Its `DOCS.md`](https://github.com/fixpoint-labs/flow-state-dev/blob/spec/FIX-1585/specs/issues/FIX-1585/DOCS.md) |

The fan-out paragraph ("Posting to a channel notifies its members…") and `channel-notify.ts`'s
placeholder header stay as they are: the notify stub is unchanged (ER-12). Do not publish the
opening because this spec merged.
