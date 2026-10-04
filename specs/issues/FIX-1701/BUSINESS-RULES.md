# FIX-1701 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

The cases, written as rules. Each row is a stamp a harness must make after this change. Every
row is today's behaviour except BR-6 and BR-8, which the dedicated nesting step flips ([D1](DECISIONS.md#d1)).
*Identity* is the runtime's description of where the run sits; *task* and *owner* are its two
scope fields. The *proved by* column is the plan's check.

## Inside and outside a task

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | Any of the three harnesses emits any item while the identity carries a task | The item carries that task id, on its open and on its close | V0, per package, every item kind |
| BR-2 | The identity carries no task | The item has **no** `taskId` key at all, not a key set to undefined | V0, asserted on the key list |
| BR-3 | The task id is present but an empty string | It is stamped as is. Presence is "defined", not "truthy" | V0, one row per package |

## The owner

**The rule:** every harness item emitted inside an owned container carries that container's
`ownedBy`, Claude Code's top-level items included. That is the documented Container Ownership
contract (`docs/architecture/streaming.md`); a sub-agent box is a nested container, so its items
carry the sub-agent's owner and the box itself carries the outer one.

| # | When | Then | Proved by |
|---|---|---|---|
| BR-4 | Codex or Cursor emits an item while the identity carries an owner | The item carries that owner, with or without a task | V0 |
| BR-5 | Any of the three harnesses emits an item outside a sub-agent, and the identity carries no owner | No `ownedBy` key | V0 |
| BR-6 | Claude Code emits a top-level item (message, reasoning, tool open and close, error, and every close path) while the identity carries an owner | The item carries that owner. **Changed:** on `main` it carries none. V0 pins today's missing owner first; the nesting step flips exactly these assertions, and from then on the flipped assertions and V5 are the truth | V0 (flipped in S1), V5 |
| BR-7 | Claude Code emits an item inside one of its sub-agents | `ownedBy` is that sub-agent's container, whatever owner the identity carries. Unchanged from `main` | V0 + the existing sub-agent nesting tests |
| BR-8 | Claude Code opens or closes a sub-agent container | The container item carries the task id when there is one, and the identity's owner when there is one. **Changed:** on `main` it carries no owner; it is a top-level item, so it flips with BR-6 | V0 (flipped in S1), V5 |

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
that is already there. The failures this issue guards against are silent: a stamped field that
moved during the extract (V0, which lands first and changes only in the nesting step), and a
Claude Code item that still escapes its container (V5).

## Acceptance criteria this issue owns

All three emitters read their scope through `itemScope`; V0 changes only in its BR-6 and BR-8
Claude Code owner rows, and only in the nesting step; V5 fails on `main` and passes after; the
two controls in [PLAN → Checks](PLAN.md#checks) turn V0 and V5 red; V3 reports no direct scope
reader in the three emitters.
