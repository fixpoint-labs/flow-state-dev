# FIX-1368 · A worker's own documents

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)

Feature · `workforce` · small · 1 PR · epic [FIX-1351](https://github.com/fixpoint-labs/flow-state-dev/pull/1718)

## Five people, before and after

| Someone who… | Today | After |
|---|---|---|
| **drops a Markdown file in a worker's own `resources/` folder** | Nothing happens. No document, no error, no mention — the file is read by nothing and reported by nothing | It loads, addressed as that worker's: `teams/pentest/workers/recon/runbook` |
| **wants two seats to each have a `runbook`** | One shared team-level `runbook`, or hand-written TypeScript per seat, off the convention everything else uses | One file per worker folder. Each has its own address and neither author coordinates with the other |
| **reads "worker-level" as "private to that worker"** | n/a | **Still not that.** The address says whose the document is; nothing stops another seat on the same kind reading it ([D2](DECISIONS.md#d2)) |
| **has a worker folder with a typo and no `WORKER.md`** | The roster read reports the slot as a seat the app does not have | Same report, unchanged. Its documents still load, under an address no seat is hired at ([D3](DECISIONS.md#d3)) |
| **keeps documents at org and team level only** | Today's behaviour | Today's behaviour, byte for byte |
| **runs a shared-infra worker under `org/workers/`** | Same silence, one level up | Its documents load too, as `workers/<w>/<name>` ([D4](DECISIONS.md#d4)) — though no seat can be hired there yet |

The resources convention shipped two roots and stopped. The third one was cut for scope, not
rejected — and a cut root in a tree that teaches "path level is scope" is worse than a missing
feature, because the folder an author writes looks right and does nothing. Measured on the
shipped reader: a planted `teams/pentest/workers/recon/resources/runbook.md` comes back in
neither `documents` nor `errors`. That is the same silence class as `org/channels/`.

## What changes

![Two aligned columns, today and after, each showing the three resource roots of a workforce tree; the org and team roots are unchanged in both, and the third root — a resources folder inside a worker folder — is dashed and empty today and solid after, minting a worker-qualified ref; a fence strip across the bottom marks what is still not built](figures/third-root.svg)

Read the third row. The two above it are untouched, which is most of the value of this change
being small. The strip along the bottom is the half this issue does not ship.

**The file an author writes:**

```diff
  workforce/
    teams/pentest/
      resources/handbook.md
      workers/recon/
        WORKER.md
+       resources/runbook.md
```

**And what the app already does with it, unchanged:**

```diff
  const { documents, errors } = await readResourcesDirectory("./workforce");
  export const agentFlow = defineAgentWorkerFlow({ /* … */ });
- // documents: handbook, teams/pentest/handbook
+ // documents: handbook, teams/pentest/handbook, teams/pentest/workers/recon/runbook
```

## How a document reaches a seat

```mermaid
flowchart LR
  F["a file in a worker's resources folder"] -->|"walked"| R["the resources reader"]
  R -->|"one record, worker-qualified ref"| M["resourcesFromDocs"]
  M -->|"one flow-level map"| K["the worker kind's flow"]
  K -->|"every seat of that kind"| S["the seat that owns it, and its siblings"]
```

The last edge is the honest one, and it is [D2](DECISIONS.md#d2): the document reaches the seat
it belongs to, and it reaches the others too, because every seat hired into one kind is a copy
of one flow definition and a flow's documents are declared on that definition.

## What stays as it is

- **The org and team roots**, their refs, their error kinds, their wording. Nothing moves.
- **`resourcesFromDocs`** and the map an app spreads into its own. No second registry.
- **`hireWorkforce`.** It gains nothing: not an option, not a key, not a resource path.
- **`WorkerConfig`.** Never a declaration source for a document — the epic's fence, kept.
- **A seat's access to a ref.** Which seats may read or write which documents is a separate,
  later decision that this issue deliberately does not open.

## Sign off

1. **[D2](DECISIONS.md#d2) · The address, the fence, or neither.** My recommendation is the
   address — a worker's document is named as that worker's and is readable by its siblings. If
   wrong: we teach a folder whose name promises privacy and does not deliver it, and an author
   puts something in it that should not have been shared. **Not settled, and the reviewers do not
   agree**: two back the address, one says the architecture's stamped "named gap" forbids it until
   isolation is proved. A third, cheaper arm — report the folder, mint nothing — is on the card.
2. **[D1](DECISIONS.md#d1) · The same reader grows a third root; the ref is
   `teams/<team>/workers/<worker>/<name>`.** If wrong: the ref is a public storage key we would
   be changing after apps have rows under it.
3. **[D3](DECISIONS.md#d3) · A worker folder's documents load whether or not it holds a
   `WORKER.md`.** If wrong: a typo'd folder quietly installs documents under an address no seat
   answers to.

**Open: one** — number 1. What lost and why: [DECISIONS.md](DECISIONS.md). The cases:
[BUSINESS-RULES.md](BUSINESS-RULES.md). The build: [PLAN.md](PLAN.md).
