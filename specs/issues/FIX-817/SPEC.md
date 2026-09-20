# FIX-817 · Collection/catalog manifests + agent introspection

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Feature · `contracts` + `core` + `orchestration` + `workforce` · medium · 2 PRs · related to [W4](https://linear.app/fixpoint-labs/issue/FIX-1407)

## Five people, before and after

| Someone who… | Today | After |
|---|---|---|
| **runs an orchestrator seat that has to pick who does the work** | Plans blind. It can assign, but nothing tells it which seats exist, what they are for, or which channels are open. It guesses from what the app hard-coded into its prompt | Asks, gets back a short list of what is in scope for it right now — each entry with enough purpose to choose between them — and then assigns |
| **writes an app with forty skills** | Every one of the forty is pasted into the system prompt on every single generator step, whether the turn needs any of them or not | The catalog is fetched when the model goes looking. A turn that never asks never pays for it |
| **gives a seat a narrow job** | Discovery leaks: the one enumerating tool that exists dumps the full stored state of every collection, including ones nobody marked readable | A seat sees what it is scoped to and nothing else. Disabled and out-of-scope entries are absent, not filtered client-side |
| **already built on the seats and channels inventory** | Rows exist and are readable from code, but no agent can reach them | The same rows, unchanged, now also answer a seat that asks. Nothing already written stops working |
| **wants one more thing discoverable** | Writes a fifth bespoke reader and a fifth way to surface it | Projects it into the one manifest shape. No new tool, no new registry |

The orchestrator is the one that matters. Everything else in W4 assumes a planner that knows
what it can compose, and today that planner is the only part we never built.

## What changes

![Today four domain readers already exist but each reaches an orchestrator differently — skills by an ambient prompt dump, resources by an ungated tool with no callers, seats and channels not at all. After, the same four readers project into one manifest shape behind one scoped on-demand door](figures/what-changes.svg)

The four readers on the left already ship — that is the whole point. Nothing in the top half is
missing a *capability*; what is missing is that the four reach an orchestrator four different
ways, two of them badly and two not at all. The bottom half adds one shape and one door and
changes none of the readers.

**Turning it on, as an app writes it:**

```diff
  const workforce = createWorkforceCapability({
-   agents: myAgentRegistry,
+   roster: declaredRoster,      // what the tree declared
+   inventory: inventoryKeys,    // the live rows FIX-1405 already writes
  })
```

**And what the seat's own file can narrow:**

```diff
  ---
  name: coordinator
+ discover: [seats, channels, skills]   # omit the key to get everything in scope
  ---
```

## How it reaches the seat

```mermaid
flowchart LR
  R["the four domain readers"] -->|"project"| M["manifest source · one per domain"]
  M -->|"registered like a resource"| G["the scope's registry"]
  G -->|"only what this seat is scoped to"| D["the door · on demand"]
  D -->|"entries with purpose"| S["the orchestrator seat"]
```

A manifest source is a projection, computed when asked. Nothing is copied, nothing is stored
twice, and the readers do not learn that discovery exists.

## What stays as it is

- **The four readers**, byte for byte. `listEnabledSkills`, `readDeclaredRoster`, the three
  inventory collections and `collectReadableResources` keep their signatures and their callers.
- **FIX-1405's inventory rows and their storage keys.** They are a public surface with persisted
  data behind them; this reads them and writes none.
- **Door B ([FIX-1388](https://linear.app/fixpoint-labs/issue/FIX-1388))**, which installs and
  selects modules at author and boot time. This is the runtime question — *what is in scope for
  me now* — and the two do not merge into one loader.
- **Boards, dispatch and assign.** Introspection feeds planning; it does not route work.
- **The skills catalog in the prompt** stays on by default, so no app that ships today changes
  behaviour. It becomes a preset an app can turn off once the door is there.
- **The resource manifest the browser already reads.** A flow-static description of what a
  session exposes and what a UI may do with it, for DevTool and React. Same word, different
  reader, and it is untouched — see [*the word "manifest"*](DECISIONS.md#manifest-word).

## Sign off

1. **[D1](DECISIONS.md#d1) · This ships as a unification of the four readers we already have —
   one manifest shape, one scoped door — and not as a new discovery system.** If wrong: we spend
   a cycle on plumbing when the orchestrator needed a richer contract, and we still cannot plan.
2. **[D2](DECISIONS.md#d2) · A manifest is projected on demand from each domain's existing
   reader, never stored as a second copy.** If wrong: every manifest read costs a live
   recomputation, and a domain with an expensive reader makes discovery expensive.

**Open: one.** [Open-1](DECISIONS.md#open-1) — how wide the door is: one tool that takes a
domain, or one tool per domain, and how much contract each entry carries. Number 1 is the one to
weigh; it is the answer to *"do we need a new concept or an improvement of the existing?"*
Reasoning and what lost: [DECISIONS.md](DECISIONS.md). The cases:
[BUSINESS-RULES.md](BUSINESS-RULES.md).
