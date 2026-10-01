# FIX-1701 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

The cases, written as rules. Each row is a stamp a harness makes **today** and must still make
after the extract. *Identity* is the runtime's description of where the run sits; *task* and
*owner* are its two scope fields. The *proved by* column is the plan's check.

## Inside and outside a task

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | Any of the three harnesses emits any item while the identity carries a task | The item carries that task id, on its open and on its close | V0, per package, every item kind |
| BR-2 | The identity carries no task | The item has **no** `taskId` key at all, not a key set to undefined | V0, asserted on the key list |
| BR-3 | The task id is present but an empty string | It is stamped as is. Presence is "defined", not "truthy" | V0, one row per package |

## The owner

| # | When | Then | Proved by |
|---|---|---|---|
| BR-4 | Codex or Cursor emits an item while the identity carries an owner | The item carries that owner, with or without a task | V0 |
| BR-5 | Codex or Cursor, and the identity carries no owner | No `ownedBy` key | V0 |
| BR-6 | Claude Code emits a top-level item while the identity carries an owner | **No** `ownedBy` key. Today's behaviour, pinned by name as the known divergence ([D1](DECISIONS.md#d1)) | V0, labelled as the divergence a separate bug will flip |
| BR-7 | Claude Code emits an item inside one of its sub-agents | `ownedBy` is that sub-agent's container, whatever owner the identity carries | V0 + the existing sub-agent nesting tests |
| BR-8 | Claude Code opens or closes a sub-agent container | The container item carries the task id when there is one, and no identity owner | V0 |

## Closes and late items

| # | When | Then | Proved by |
|---|---|---|---|
| BR-9 | A harness closes an item it opened earlier (tool result, streamed message or reasoning, container close, a turn-boundary flush) | The close carries the same scope fields as the open | V0 on each close path |
| BR-10 | An error item is emitted | Same scope rules as any other item | V0 |

## The reader itself

| # | When | Then | Proved by |
|---|---|---|---|
| BR-11 | The reader is called with no identity, an identity with neither field, one, or both | It returns exactly the present fields, nothing else | V1 |
| BR-12 | After the extract, someone searches the three emitters for a direct read of the task or owner off the identity | There is none; every scope read goes through the reader | V3, the spec's checker |

## Failure taxonomy

Nothing here can fail at runtime that cannot fail today: the reader is a pure read of a field
that is already there. The failure this issue guards against is silent, at build time — a
stamped field that moved. V0 is the only defence against it, which is why it lands first and
does not change.

## Acceptance criteria this issue owns

All three emitters read their scope through `itemScope`; V0 passes unchanged before and after
the extract; V0 fails under both controls in [PLAN → Checks](PLAN.md#checks); V3 reports no
direct scope reader in the three emitters.
