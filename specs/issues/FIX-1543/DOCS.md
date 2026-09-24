# FIX-1543 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

One README row changes. Nothing under `apps/docs` does: no page names `HiredSeatOwnerPin`, and
the durable-hire guide's example calls `registerHiredSeat` with a signature and behaviour that
stay the same. No changeset, because no user-visible behaviour or type shape changes (D1).

## UPDATE · `packages/workforce/README.md` · Exports, the seat-hire table, the `HiredSeatOwnerPin` row

Replace the row's description with:

> Another name for core's `InstanceOwnerPin`: `{ orgId, userId? }`, with `userId` present only
> for a user-owned hire row. Either name works wherever the other is expected.

## Publication ownership

FIX-1543 publishes this row in its implementation PR. The two `registerHiredSeat` rows stay as
they are: both describe the one function accurately.
