# FIX-1543 · Two copies of the hired-seat owner-pin helper can drift out of sync

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)

Improvement · `workforce` · small · 1 PR · no epic (follows [FIX-1529](https://linear.app/fixpoint-labs/issue/FIX-1529), under [FIX-1528](https://linear.app/fixpoint-labs/issue/FIX-1528))

## Five people, before and after

| Someone who… | Today | After |
|---|---|---|
| **changes the rule that refuses a hired seat with no owner pin** (a new guard, a reworded message) | Has to find and edit two copies. Editing one passes every test | Edits one function. A test fails if a second copy appears |
| **registers hired seats from their app with `registerHiredSeat`** | Gets the copy that lives with the hire blocks. The roster suite tests the other copy | Same import, same behaviour, and it is the one function every suite tests |
| **writes `HiredSeatOwnerPin` in their own types** | A separate declaration that happens to match core's `InstanceOwnerPin` | Still compiles. It is now another name for `InstanceOwnerPin`, so the two cannot drift apart |
| **hires a seat that arrives with no owner pin**, by the `hire` tool, a roster hire or a boot reload | Refused, and nothing is registered | Unchanged: refused with the same message |
| **reads the seat-hire source** | A comment says the engine's pinned register "is FIX-1529", still to come | The comment is gone. FIX-1529 shipped |

Both copies came from FIX-1529, added 37 minutes apart (`8f4387f2e`, `14f746b65`). FIX-1500
PR-A (`02120a2ce`) then moved one into the hire blocks. The issue names the capability module;
the copy now lives with the blocks, and the capability re-exports it.

## What changes

![Two rows. Today the hire tool and an app's registrar reach one copy of the owner-pin gate, typed on the package's own pin type, and the roster suite reaches a second copy typed on core's. After, all three reach one gate typed on core's pin type, and a test fails if a second copy appears.](figures/what-changes.svg)

Read the arrows. Today the copy a user calls and the copy the roster suite tests are different
functions. After, every arrow lands on the one gate, and the dashed copy is deleted.

**What a person types does not change.** Every import keeps resolving. The one public
declaration that changes is the pin type, which becomes a second name for core's:

```diff
- export interface HiredSeatOwnerPin {
-   orgId: string;
-   userId?: string;
- }
+ /** Another name for core's `InstanceOwnerPin`: `{ orgId, userId? }`. */
+ export type HiredSeatOwnerPin = InstanceOwnerPin;
```

## What stays as it is

- **What the gate refuses, and its message.** A pin with no `orgId`, or an empty one, throws
  and the register is never called. An empty `userId` is dropped, so an org-visible hire stays
  org-visible.
- **Every register call site**, including the kitchen-sink registrar, which FIX-1563 (#2169) is
  changing and this issue does not touch.
- **Core's `InstanceOwnerPin`** and the engine's pinned register.
- **The durable-hire guide's example.** It imports `registerHiredSeat` from the package root,
  whose signature does not change in any way a caller can see.

## Sign off

1. **[D1](DECISIONS.md#d1) · Every name the package exports today keeps working.
   `HiredSeatOwnerPin` stays, as another name for core's pin type, rather than being removed.**
   If wrong: the package carries one redundant type name until a deliberate deprecation, which
   costs a README line and nothing at runtime.

**Open: none.** Number 1 is the only call. Reasoning and what lost:
[DECISIONS.md](DECISIONS.md). The cases: [BUSINESS-RULES.md](BUSINESS-RULES.md).
