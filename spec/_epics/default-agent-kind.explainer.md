# FIX-1359 — Default Workforce agent flow (explainer)

Companion to [`default-agent-kind.md`](./default-agent-kind.md). Diagrams and captions only: it
decides nothing and asks nothing.

**The four words.** A **seat** is a roster slot resolving to one flow instance, declared as
`WORKER.md`. A **kind** is a flow factory on hire's `kinds` map; a seat's `flow:` only names one.
A **worker** is a generator or flow. The **agent kind** is the opinionated default this epic adds.

## 1. Today

```mermaid
flowchart LR
  W["WORKER.md<br/>instructions"] --> H[hire]
  H -->|"flow: names a kind"| K["kinds map"]
  K --> S["seat · flow instance"]
  O["an agent flow you write yourself"] --> K
  L["defineAgent · materializeAgent<br/>AgentRegistry"] -.->|"the other route, being deleted"| S
```

Hire already resolves a seat's `flow:` against the kinds map — but every kind is the app's own. A
working agent means hand-writing the flow, or leaning on a second factory cluster we have already
decided to delete.

## 2. After (proposed)

```mermaid
flowchart LR
  W["WORKER.md<br/>instructions"] --> H[hire]
  H -->|"flow: names a kind"| K["kinds map"]
  K --> S["seat · flow instance<br/>talks · remembers · uses its skills"]
  G["built-in agent kind<br/>default prompt · model · tools · memory"] --> K
  C["flow: myCustomAgent"] -.->|"replaces it in one line"| K
```

The kinds map ships with an agent kind. Instructions alone yield a seat that talks, remembers on
the scopes we already have, and uses the skills registered to it. Naming your own kind still wins.
This is the shape being gated, not built code.

## 3. The set (proposed)

```mermaid
flowchart TD
  N["FIX-1361<br/>contract"] -->|"what the kind must satisfy"| S["the OOTB agent seat"]
  B["FIX-1363<br/>the kind itself"] -->|"the flow that gets hired"| S
  SK["FIX-1362<br/>per-seat skills"] -->|"the skills it may use"| S
  M["FIX-1364<br/>memory on existing scopes"] -->|"what it remembers, and the gaps"| S
  R["FIX-1360<br/>kitchen-sink drift audit"] -->|"the baseline to port from"| S
  T["FIX-1366<br/>Atlas teach"] -->|"the one documented way in"| S
  P["FIX-1365<br/>Thin Proof · optional"] -->|"proof a real hire works"| S
  classDef notstarted stroke-dasharray: 4 3
  class N,B,SK,M,R,T,P notstarted
```

The four on top are the substance — drop any and the seat is missing something a real app needs on
day one. All seven are not started as of the FIX-1359 objective gate; the spec's §4 index is the
live status.

## 4. The path (proposed)

```mermaid
flowchart LR
  R["FIX-1360<br/>drift audit"] --> N["FIX-1361<br/>contract"]
  N --> B["FIX-1363<br/>the kind"]
  B --> SK["FIX-1362<br/>skills"]
  B --> M["FIX-1364<br/>memory"]
  B --> T["FIX-1366<br/>Atlas teach"]
  SK --> P["FIX-1365<br/>Thin Proof · optional"]
  M --> P
  D1["W2 · FIX-1344<br/>default worker system prompt<br/>not shipped"] -.-> B
  D2["W3 · FIX-1356<br/>skills file convention<br/>in review"] -.-> SK
```

A chain, not a fan-out: only FIX-1360 and FIX-1361 can start today, and the only real parallelism
is FIX-1362 beside FIX-1364. The dashed nodes are inputs from adjacent epics, not children.

From that same W2 issue, the `instructions` key in panels 1–2 is already merged; its deletion of
the `defineAgent` cluster is still an open draft, which is why panel 1 shows that route still live.
Dependency states verified 2026-09-11.
