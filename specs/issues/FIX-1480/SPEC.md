# FIX-1480 · Explore: a seat can hire another seat of a kind the app already has

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

**Explore / not-ship.** Design · `workforce` · thin · 0 ship PRs until Architect + Cycle Manager ratify · related [FIX-1407](https://linear.app/fixpoint-labs/issue/FIX-1407) · [FIX-1455](https://linear.app/fixpoint-labs/issue/FIX-1455) · sibling [FIX-1415](https://linear.app/fixpoint-labs/issue/FIX-1415)

This set is a direction brief. Approving it retains the exploration. It does **not** authorize production seat-hire, a Hire type, or a second hire store.

## Five people, before and after

| Someone who… | Today | After a ratified ship |
|---|---|---|
| **manages a team mid-run and needs another worker of a kind the app already has** | Asks a human to edit files or hit the host admin path. The seat itself has no hire tool | Names the kind and a seat id. A new teammate exists, is written down, and answers like any other seat |
| **looks up who is on the team the same way Labs already look people up** | Sees file-declared seats. A seat hired while the app ran is on the durable roster and missing from that lookup | Sees the new seat on the same lookup — or we have said, on purpose, that they will not ([D1](DECISIONS.md#d1)) |
| **runs a seat whose tools list is empty** | Reaches no catalog tool | Still reaches no catalog tool. Hire is not always on |
| **tries to invent a new kind of worker from the hire tool** | n/a | Refused. Hire copies a kind the app already registered |
| **hires the same seat id twice** | Host admin already refuses | The seat-facing tool refuses the same way. Nothing is overwritten |

An app can already hire from the host. A **seat** cannot. Dynamic team expansion is a manager expanding the roster while work is running, not a new worker type invented on the spot.

## What changes

![Two panels. Today a manager seat can talk but has no hire tool, host-side hire writes the durable roster, and discover only shows seats in both the file tree and the inventory. After, the manager kind installs a hire capability, the seat names hire in its tools list, and the same roster door is used. A third box leaves open whether teammates can find the new seat.](figures/what-changes.svg)

Read the fence row, not the arrows. Hire is a catalog tool a seat must name. The door it writes is the roster that already survives a redeploy. The yellow box is the live call: after a hire, can teammates find the new person the way they find everyone else?

**What a manager's file would look like, if this ships:**

```diff
  # WORKER.md — eng.manager
  flow: agent
  description: Expands the roster when the team is short.
+ tools: [hire]
+ capabilities:
+   seat-hire: []
```

**What that seat would call, not a new kind of thing:**

```diff
+ hire({ seatId: "eng.ada", flow: "agent",
+        settings: {}, instructions: "You take support tickets." })
+ → { seatId: "eng.ada", address: "acme.eng.ada" }
```

The kind is one the app already passed to `hireWorkforce`. The settings are that kind's `WorkerConfig` bag. There is no field for source code, a graph, or a new flow name.

## What stays as it is

- **Host-side hire.** Kitchen-sink's admin path and the durable roster stay the door a human or script uses. This ticket composes that door; it does not replace it.
- **File-declared teams.** `WORKER.md` remains the authoring default.
- **Channel-admin.** [FIX-1415](https://linear.app/fixpoint-labs/issue/FIX-1415) stays a sibling. Creating a channel is not hiring a seat.
- **Kind invention.** Defining a new worker type from thin air stays [FIX-1465](https://linear.app/fixpoint-labs/issue/FIX-1465).
- **W4 first-cut.** This is not a hard-gate child of work routing.
- **Pool / idle-picker / auto-scale.** Mint is address-by-id. A busy seat does not mint a copy.

## Sign off

This is **ratify, then file ship tickets** — not implement.

1. **[D1](DECISIONS.md#d1) · After a hire, teammates find the new seat the same way they find file-declared ones.** Write the inventory row the lookup already reads, and treat the durable roster as the "declared" half for a seat that has no file. If wrong: Labs keep a second, quieter roster, and "who is on the team?" has two answers.
2. **[D2](DECISIONS.md#d2) · First cut is hire and fire only.** Changing a hired seat's settings without minting a new id waits. If wrong: the first ship is a configuration editor wearing a hire name, and we will argue about mutation for a month before anyone can add a teammate.
3. **The surface is a capability plus named tools, composing the hire and roster that already exist.** Not a Hire type, not a second store, not always-on. If wrong: we have taught "capability" as the thing you add when the noun is important, which is how Role and Agent become types.

**Open walls, with a recommendation each, still open:** who may hire; kind allowlist; team versus org; board wiring after hire; whether the tool returns only a seat id. Compact picks: [DECISIONS.md → Recommended, still open](DECISIONS.md#recommended-still-open).

The POC ran the current join and the current mint. A seat that exists only on the durable roster is **invisible** to the lookup Labs already use. That is why D1 is the one to weigh. [POC](poc/seat-hire-compose/README.md).
