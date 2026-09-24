# FIX-1549 · Workforce's roster policy is enforced from Core's generic defineResourceCollection

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Improvement · `core` + `engine` · small · 1 PR · no epic (follows [FIX-1529](https://linear.app/fixpoint-labs/issue/FIX-1529), under [FIX-1528](https://linear.app/fixpoint-labs/issue/FIX-1528))

## Six people, before and after

| Someone who… | Today | After |
|---|---|---|
| **builds an app without Workforce and declares `workforce/roster/[owner]/notes`** | `defineResourceCollection` throws: "can read user-owned roster rows" | Defines and registers like any other pattern |
| **builds an app without Workforce and declares a generic org collection such as `[tenant]/**` or `[a]/[b]/[c]/[d]`** | Defines fine, then the app refuses to start: registration names "user-owned roster rows" | Registers. No Workforce name appears anywhere on their path |
| **runs Workforce with user-owned seats, and some flow declares `workforce/roster/**`, `[tenant]/**`, or a copy of the private writer** | Refused | Refused, with the same message, whichever of the two flows registered first ([D1](DECISIONS.md#d1)) |
| **runs Workforce and writes the literal deep pattern `workforce/roster/**`** | Refused when the module loads (definition) | Refused when the app starts (registration). Same outcome, one step later |
| **owns a user-owned seat, or is another member of the org** | Only the owner opens the seat or reads its row | Unchanged: the pin, the caller-only read and the debug listing are untouched |
| **splits one Workforce app across processes, and one process never registers the private roster writer** | That process refuses overlapping patterns too | That process is not fenced. Every process that serves flows over a store holding user-owned rows registers the writer ([D1](DECISIONS.md#d1)) |

The first two rows are measured on today's `main`, not argued:
[poc/characterize](poc/characterize/README.md) runs twelve patterns through both paths in an app
with no Workforce at all. Eight are refused, all by the roster fence. Four of those carry no
Workforce name: `**`, `[tenant]/**`, `[a]/[b]/[c]/[d]`, `*/**`.

## What changes

![Two rows. Today every app passes through a roster check at definition and again at registration. After, definition runs no roster check, and registration runs the fence only in a registry holding Workforce's private roster writer.](figures/what-changes.svg)

The top row is today: two checks, both unconditional. The bottom two are after: one check, in
Engine, armed by the one collection that writes user-owned rows.

**Nothing changes in how anyone writes code.** An app without Workforce simply stops being
refused; a Workforce app keeps writing the collections exactly as
[durable hire](../../../apps/docs/docs/workforce/durable-hire.md) documents. The one public
change is a removal: Core no longer exports `assertRosterCollectionIsNotDeep`. Nothing outside
Engine calls it.

## How the fence arms

```mermaid
flowchart LR
  F["a flow registers"] --> R["Engine registry"]
  R -->|"holds the private writer?"| A{"fence armed"}
  A -->|"no"| OK["admitted"]
  A -->|"yes · every held flow checked"| H["hire-plane rules · unchanged"]
  H --> X["overlap refused"]
  H --> OK
```

The writer is Workforce's branded collection, the only thing that writes a user-owned row. When
it arrives the registry checks every flow it already holds, and from then on every flow that
follows. Nothing else in the registry changes.

## What stays as it is

- **What the fence refuses, once armed.** Same patterns, same messages. The characterization
  corpus is the equivalence check ([PLAN V4](PLAN.md#checks)).
- **Acceptance 5 of FIX-1529, roster-owner refuse.** That is the pin, and the pin never touched
  pattern admission.
- **The caller-only read of the private writer** and the debug listing's filter.
- **The brand, the two roster patterns and `encodeUserSegment`** stay in Core. Workforce builds
  the writer with them and Engine recognizes it; Workforce has no runtime dependency on Engine,
  so this is the one seam both can reach.

## Sign off

1. **[D1](DECISIONS.md#d1) · The fence arms per registry, once Workforce's private roster
   writer is registered in it, in either order, and stays armed.** If wrong: a Workforce
   deployment that splits flows across processes and leaves the writer out of one of them can
   read another member's hired-seat row from that process.
2. **[D2](DECISIONS.md#d2) · The fence lives in one place, Engine's hire-plane admission,
   and Core's `defineResourceCollection` runs no roster policy.** If wrong: Engine keeps
   carrying Workforce's roster names until a generic hook exists, and a minor bump drops one
   export nobody else calls.

**Open: none.** Number 1 is the one to weigh. Reasoning and what lost:
[DECISIONS.md](DECISIONS.md). The cases: [BUSINESS-RULES.md](BUSINESS-RULES.md).
