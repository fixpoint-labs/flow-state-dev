# FIX-1507 · Consolidate the duplicated fenced-read recipe before FIX-1477 S8 adds more panels

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)

Improvement (refactor, no behaviour change) · `react` · small · 1 PR · no epic · builds on [FIX-1477](https://linear.app/fixpoint-labs/issue/FIX-1477), [FIX-1500](https://linear.app/fixpoint-labs/issue/FIX-1500) and [FIX-1577](https://linear.app/fixpoint-labs/issue/FIX-1577) (all Done)

## People, before and after

| Someone who… | Today | After |
|---|---|---|
| **fixes a late-or-racing-response bug in a panel or the navigator** | Finds and fixes it in three places: the panels' shared read, the flow list, and the leaf's session list | Fixes it once. Every panel and both navigator lists pick it up |
| **adds a panel (FIX-1477 S8)** | Copies four lines of client set-up from a sibling panel, and the read recipe if they miss that one exists | Calls one internal helper for the client and one for the read |
| **opens and closes a navigator leaf** | A closed leaf asks for nothing, even when refreshed | Unchanged, now as an explicit rule of the shared read rather than a line in one copy |
| **renders a panel or the navigator in an app** | Today's behaviour | Exactly today's: same requests at the same moments, same late-response discards, same error text, same output |
| **imports from `@flow-state-dev/react`** | Nothing of this is exported | Still nothing. No public API changes |

Half of this already happened. FIX-1500 gave the four panels one fenced read. What is left is
the navigator's two hand-written copies of the same recipe, and the four panels' copies of the
"use the host's client, or build one from the provider's address" set-up. This moves the
panels' read to a package-internal home, points the navigator at it, and gives the panels one
set-up helper.

## The goal, and how we'll know it's met

**A fix to how the panels and the flow navigator guard a read against late or racing responses
is made in one place, and every panel and navigator list behaves exactly as it does today.**

| Is it the right goal? | |
|---|---|
| **The real need** | "The fenced-read recipe (fence + fetch + stale-guard) exists once, internally, and `panels/reads.ts`, `flow-navigator/reads.ts`, and the panel bootstrap all consume it … no behavior change" ([FIX-1507](https://linear.app/fixpoint-labs/issue/FIX-1507)) |
| **Smaller, and rejected** | "The flow list uses the shared read." Hittable while the leaf's session list, which has the most race cases of the three, keeps its own copy |
| **Bigger, and not this issue's** | One shared "read every page" helper for the panels and the developer tool. [FIX-1674](https://linear.app/fixpoint-labs/issue/FIX-1674) owns it |
| **Not done if** | The suite is green but the panels have no late-response test at all (today they don't) · a closed leaf's refresh sends a request · an existing test was edited to pass · the shared read is exported |

**No goal check applies.** This is a pure refactor: nobody can do anything after it that they
can't do now. Equivalence proves it instead. The late-response and racing-read cases in
[BUSINESS-RULES.md](BUSINESS-RULES.md) are pinned as characterization tests **on `main`,
before anything moves**, for all five reads. The same tests, and every existing test, pass
unedited afterwards. **Control that must fail:** with the shared read's after-the-wait
staleness check removed, the racing-read tests for **both** a panel and a navigator list go
red. That proves one fix now reaches both ([PLAN V2](PLAN.md#checks)).

## What changes

![Before: three separate copies of the read recipe (the panels' shared read, the flow list, the leaf session list) and four copies of the client set-up (Roster, BoardColumns, BoardList, SeatDetail). After: one internal fenced read that five reads call, one of them with a read-only-while-open switch, and one panel client helper that four panels call](figures/what-changes.svg)

Read the right half. Two things are drawn once. Each has a fan of consumers, and nothing
crosses the package's public edge.

**The flow list, as a maintainer reads it.** Illustrative: names are the implementer's.

```diff
 export function useFlowInventory(source: FlowNavigatorFlowSource): FlowInventory {
-  const [flows, setFlows] = useState<readonly FlowListEntry[]>(EMPTY_FLOWS);
-  const [isLoading, setIsLoading] = useState(true);
-  const [error, setError] = useState<string | null>(null);
-  const [heldIdentity, setHeldIdentity] = useState<readonly unknown[] | null>(null);
-  const fence = useReadFence([source], () => { /* reset four states */ });
-  // … begin, await, stillCurrent twice, finally, effect, hold-or-empty: ~40 lines
+  const { data, isLoading, error, refresh } = useFencedRead(
+    [source], EMPTY_FLOWS, "Failed to load flows", () => source.listFlows()
+  );
+  return { flows: data, isLoading, error, refresh };
 }
```

**A panel's client set-up:**

```diff
-  const context = useFlowContext();
-  const baseUrl = context.baseUrl;
-  const fallback = useMemo(() => createResourceClient({ baseUrl }), [baseUrl]);
-  const source = resourceClient ?? fallback;
+  const source = usePanelSource(resourceClient);
```

## What stays as it is

- The public surface. `useReadFence` stays public and unchanged. The navigator and panel
  props, and every export of the package, are identical.
- Paging. The every-page loop, its 1,000-page ceiling and its error stay in the panels' row
  read, untouched. [FIX-1674](https://linear.app/fixpoint-labs/issue/FIX-1674) owns that loop.
- The live board's re-read on session changes. It already plugs into the shared read and
  keeps doing so.
- The public resource hooks (`useResource`, `useResourceCollection`, `useResourceManifest`)
  and the developer tool's fences. They build clients and fence differently, and are not
  copies of this recipe.

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met), at that size:** one place to fix a read race
across all five reads, with no behaviour change, proved by tests pinned before the move. If
wrong: we ship a "refactor" that quietly changes when a list refetches, or keep a copy that drifts.

1. **[D1](DECISIONS.md#d1) · All three copies move onto the one read, and a closed leaf's
   "ask for nothing" becomes an explicit switch on it.** If wrong: the shared read carries one
   input only the navigator uses, or the leaf list, the one with the most race cases, keeps its
   own copy.

**Open: none.** D1 is the only call. The fence from the architect already settled the scope
and that nothing is exported. Reasoning and what lost: [DECISIONS.md](DECISIONS.md). The cases:
[BUSINESS-RULES.md](BUSINESS-RULES.md).
