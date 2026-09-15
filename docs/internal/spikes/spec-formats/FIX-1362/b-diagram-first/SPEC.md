# FIX-1362 · Per-seat skills in the built-in worker kind

Feature · 3 packages + docs · medium-large · 1 or 2 PRs · epic FIX-1359 · [plan](PLAN.md)

## 1. Today

```mermaid
flowchart LR
  F["skills folder beside qa.tester"] -.->|"fills nothing"| K
  K["agent kind<br/>one baked array"] --> S1["seat: qa.tester"]
  K --> S2["seat: eng.lead"]
  S1 --> D["one shared drawer"]
  S2 --> D
  D --> C["one catalog<br/>both seats see everything"]
```

Every seat reads the same bucket. A skills folder beside one worker reaches all of them, or, since nothing fills a seat today, none. The contract already promises *a seat's skills are that seat's*.

## 2. After

```mermaid
flowchart LR
  F["skills folder beside qa.tester"] -->|"loader union rides the record"| K
  K["agent kind<br/>resolver reads the seat's setting"] --> S1["seat: qa.tester"]
  K --> S2["seat: eng.lead"]
  S1 --> D1["qa.tester drawer<br/>write-regression + org skills"]
  S2 --> D2["eng.lead drawer<br/>break-down-work + org skills"]
```

Each seat gets its own drawer, filled from its own folders. Storage keys on the seat. No new primitive: isolation and the union both exist, they were never connected.

## 3. How a per-seat set reaches code built once for the kind

```mermaid
flowchart TD
  T["workforce tree<br/>org / team / worker skills"] --> L["readWorkforce<br/>one walk, per-seat union"]
  L -->|"WorkerManifest.skills"| H["hireWorkforce"]
  H -->|"imposes seatSkills, like instructions"| C["seat config bag<br/>the only per-seat channel"]
  C -->|"resolver: O(1) read"| S["skills library"]
  S -->|"ensureSeeded"| B["that seat's drawer<br/>flowIsolation on"]
  C --> A["activation"]
  A --> G["generator"]
  B --> G
```

A block sees `{ config }` and nothing else. It cannot see its instance id, by design. So the set rides the record, is imposed at hire, and is read from config. Every other route ends in a cast.

## 4. How a turn picks a skill

```mermaid
flowchart LR
  I["turn input"] --> M["matcher<br/>slash, typed by a person"]
  M --> AP["apply<br/>replaces activeSkills"]
  AP --> DA["always-on list<br/>appended after, deduped"]
  DA --> G["generator"]
  AT["activate tool<br/>off unless the worker turns it on"] -.-> G
  X["classifier · keyword tier"] -.->|"not in this kind"| G
```

Three stock paths. A turn that uses no skill makes no extra model call and spends no extra tokens. The always-on set is appended *after* the matcher because apply replaces the active set by design.

## 5. Where the decisions fell

```mermaid
flowchart TD
  I["FIX-1362"] --> D1["D1 · skills travel on the worker record<br/>handed over at hire"]
  D1 -.->|"rejected"| X1["an option on hireWorkforce<br/>FIX-1363 closed that door"]
  D1 -.->|"rejected"| X2["runtime lookup by id<br/>a block can't see its id"]
  I --> D2["D2 · colocated = reachable<br/>not always in context"]
  D2 -.->|"rejected"| X3["colocated = always-on<br/>charges every turn"]
  I --> D3["D3 · a seat holds a copy<br/>refresh replaces the folder whole"]
  D3 -.->|"rejected"| X4["live propagation<br/>makes the drawer a view"]
  D3 -.->|"rejected"| X5["file-by-file overwrite<br/>withdrawn files stay live"]
```

| | Locks in |
|---|---|
| D1 | Skills are fixed when the roster is read. Re-hire to change. No hot swap |
| D2 | Drop a folder, nothing visible changes until `/name` or an edit. Skills never slow a worker |
| D3 | A company typo fix means someone refreshes the seats. A seat's own additions inside a refreshed folder are lost |

**Decided, not asked:** slash from a person's message only (model-emitted text is an injection surface) · activate tool in v1, off by default.

## 6. What using it looks like

```md
---
description: Runs regression passes
tools: [runTests]
skills:
  active: [house-style]     # every prompt
  activateTool: true        # off by default
---
```

`write-regression` sits beside the tester and is listed nowhere. The tester holds it plus `house-style`. The QA lead never sees it. A body with no `skills:` key hires and pays nothing.

## 7. Must hold

- [ ] Two seats: distinct keys **and** distinct catalog contents
- [ ] A colocated skill needs no list
- [ ] Always-on is in every prompt; merely held is not
- [ ] `/name` adds without clobbering always-on
- [ ] Both switches off → no listing, no load tool, no classifier call
- [ ] `tools: []` calls nothing, including through a delegated board worker
- [ ] Org edit reaches no seeded seat until refresh; deleted copies stay deleted
- [ ] Refresh removes a withdrawn supporting file; ordinary seeding deletes nothing
- [ ] **Goal:** two seats, two skills, `fsdev run` each, the answer shows its own and none of the other's

## 8. Boundary

```mermaid
flowchart LR
  subgraph this["this issue"]
    A["own drawer"]
    B["filled from own folders"]
    C["three activation paths"]
    D["refresh"]
    E["delegation fence"]
  end
  subgraph elsewhere["owned elsewhere"]
    F["deprecate an entry point<br/>FIX-1390"]
    G["memory<br/>FIX-1364"]
    H["teaching<br/>FIX-1366"]
    J["classifier tier<br/>FIX-1363, opt-in"]
    K["trigger phrases · keyword tier<br/>out, not renamed"]
  end
```

## 9. How it got here

```mermaid
flowchart LR
  A["draft<br/>record + settings bag<br/>three paths, tool off"] --> B["review<br/>seeding never deletes →<br/>D3: replace the folder whole"]
  B --> C["contract still said 'reconcile here' →<br/>FIX-1390 filed, step 9 narrows it"]
```
