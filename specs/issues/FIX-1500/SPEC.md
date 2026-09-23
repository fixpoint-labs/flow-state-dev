# FIX-1500 · Goal 1 human path — channel + seat UX

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Feature · `workforce` + `react` + kitchen-sink · large · 3 PRs · epic
[FIX-1455](https://linear.app/fixpoint-labs/issue/FIX-1455) ·
[epic spec](../../epics/FIX-1455/SPEC.md)

## Five people, before and after

| Someone who… | Today | After |
|---|---|---|
| **runs Goal 1 acceptance** | Proves the pieces one at a time and in different places — a hire through an HTTP call, a roster in a panel, a board in the developer tool. No single run starts and finishes in the human rail, so the published goal has never actually been tested | One run: open the rail, open a seat, hire another of its kind, watch it appear, open it, and — beside that run — restart and find it still there |
| **opens a seat in the rail** | Reads its name in a roster list, and that is all there is. Its kind and its instructions are nowhere in the human rail | Opens it and reads its kind. A seat hired here also shows its instructions; a seat declared in a file says its instructions are not published. Skills, channels and boards come with [FIX-1539](https://linear.app/fixpoint-labs/issue/FIX-1539) |
| **wants a second seat of a kind they already have** | Needs an operator's bearer token and something that speaks HTTP. In a clone with no token configured there is **no hire path at all** — the door is not registered | Hires it from the seat surface. The new seat appears in the same list, without a page reload and without opening the developer tool |
| **restarts the app after hiring** | Cannot tell whether anything survived, because nothing in the human rail ever showed the seat in the first place | Comes back to the same rail and the seat is there, rebuilt from durable organization state rather than from the process that hired it |
| **runs a deployment that configures operator tokens** | The rail reads the default organization and shows none of what was hired under a token — correct, empty, and unexplained | The rail hires **and** reads one organization, so the two can no longer disagree. With no viewer identity that organization is the default one, and the app says so |

The pieces of a Workforce all exist and none of them meet. A person can be shown a roster, or
shown a board, or told that a hire persisted — each by a different tool, none of them the app
somebody would copy. Goal 1 is a claim about a *person running an org*, and a claim like that is
only tested by a run that a person could have done.

## What changes

![Left, today: the human rail reads a roster and a board from the organization its own session binds to, a seat row opens into nothing, and the durable hire door sits apart behind an operator credential writing into a different organization — two organization boxes that never meet. Right, after: a hired seat's row opens into a seat detail showing its kind and instructions, and the hire door is on the rail's own flow, so the hire arrow and the read arrow land in one organization box](figures/one-org.svg)

Look at the organization boxes. On the left there are two and nothing joins them, which is why a
hire can succeed and the rail still show nothing. On the right there is one, because hire and read
now resolve their organization by the same framework path — so whatever organization the rail is
looking at is the organization it hires into, and the empty-panel failure is not fixed so much as
made unreachable.

**Hiring a second seat, as a person does it:**

```diff
  Seats ▸ support.ada                     kind: agent
+   instructions   not published — declared in a worker file
+
+   [ Hire another agent ]  →  id: support.bruno · instructions: "Takes escalations."
+                              hired. support.bruno appears in the roster.
+
+ Seats ▸ support.bruno                   kind: agent
+   instructions   Takes escalations.
```

**And what the app's own wiring gains — one action, on the flow the rail already runs on, running
the package's own hire sequence:**

```diff
+ const seatHire = createSeatHireBlocks({ kinds, register, unregister, kindAt });
+
  defineFlow({
    kind: "chat-agent",
    requireUser: true,
+   resources: {
+     [HIRED_ROSTER_RESOURCE]: defineHiredRosterCollection(),
+     [SEAT_INVENTORY_RESOURCE]: defineSeatInventoryCollection(),
+   },
+   actions: {
+     // The same block a worker's `hire` tool runs. The organization is the
+     // session's; the body is never asked.
+     hireSeat: { block: seatHire.hire },
+   },
  })
```

## What a seat's detail shows, and where each answer comes from

| What a seat detail shows | Where the answer lives | Reachable from a browser? |
|---|---|---|
| kind, for every seat | the navigator's flow listing, which the host already holds | **Yes** — no read of its own |
| instructions, for a seat hired into the organization | its public roster row, which exposes `instructions` | **Yes** — one item read through the rail's roster ref |
| instructions, for a seat declared in a `WORKER.md` | the seat flow's configuration | **No.** The detail says they are not published |
| skills · channels · boards | — | **Not in this issue.** [FIX-1539](https://linear.app/fixpoint-labs/issue/FIX-1539)'s, by the owner's decision [D5](DECISIONS.md#d5) |

## What stays as it is

- **The rail itself.** One `FlowNavigator`, sections by kind, depth from cardinality — the epic's
  D8 and [FIX-1477](https://linear.app/fixpoint-labs/issue/FIX-1477)'s. This issue adds what a seat
  row opens *into*; it does not add a second navigator or fork a tree browser.
- **The operator's hire door.** `workforce-admin` keeps its bearer credential, its organization
  from that credential, its user-owned rows and its fail-closed registration. This issue does not
  touch it.
- **What a durable hire *is*.** The rail's hire runs the sequence the `workforce` package already
  ships for its catalog `hire` tool, through a model-free export of it: the same roster
  collection, the same `create()`-not-`upsert()` refusal of a duplicate, the same compensating
  delete when registration fails ([FIX-1475](https://linear.app/fixpoint-labs/issue/FIX-1475)).
  No second persistence layer, and no third sequence.
- **Channel and board creation at runtime.** Still out, still parked on
  [FIX-1415](https://linear.app/fixpoint-labs/issue/FIX-1415).
- **Cross-session liveness.** A panel reads on mount and after an action this rail performed. One
  browser watching another browser's hire is
  [FIX-1506](https://linear.app/fixpoint-labs/issue/FIX-1506)'s.

## Sign off

1. **[D1](DECISIONS.md#d1) · The rail's hire door is an action on the flow the rail's own session
   already runs on, not the operator's credentialed flow reached from a browser.** Approved. If
   wrong: in a deployment that authenticates nobody, anybody who can open the app can hire a seat
   into the default organization — and reversing it later means the Goal 1 run stops being
   demonstrable until identity ships.
2. **[D5](DECISIONS.md#d5) · The seat detail ships kind and instructions; skills, channels and
   boards move to FIX-1539.** Decided by the product owner, 2026-09-23. It costs a thinner seat
   view than the issue's outcome 2 promises, and a file-declared seat shows no instructions yet.

**What this amendment asks.** Nothing new of the owner. It records D5, and the engineering calls
that follow from it: the hire door reuses the package's sequence through one new export, and a
rail hire is visible to the whole organization, derived from the owner's
[FIX-1477 D4](../FIX-1477/DECISIONS.md#d4) rule ([E1](DECISIONS.md#e1), [E2](DECISIONS.md#e2)).
**News a reader would not look for:** FIX-1475's BR-35 has already been overtaken in code by the
shipped seat-hire capability — hire writes an inventory row and fire leaves it behind
([FIX-1540](https://linear.app/fixpoint-labs/issue/FIX-1540);
[EVOLUTION.md](EVOLUTION.md#br35-overtaken)).

The reasoning, what each rejected and what each locks in is in [DECISIONS.md](DECISIONS.md); the
cases in [BUSINESS-RULES.md](BUSINESS-RULES.md).
