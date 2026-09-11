# FIX-1351 — explainer

*Three pictures of one epic. The full case is in
[`file-convention-surface.md`](file-convention-surface.md); the objective gate is on the PR.
Nothing here asks you for anything.*

---

## 1. Today — three pieces, three different states

```mermaid
flowchart LR
  TREE["workforce/ tree"] --> W["workers/ · WORKER.md"]
  TREE --> SK["skills/ · SKILL.md, one level"]
  CODE["TypeScript code"] --> RES["resources"]
  CH["a channel"]
  CH -.-> KIND["no kind to be an instance of"]
  classDef none stroke-dasharray:5 5
  class CH,KIND none
```

Workers and skills are already file-declared; a document is declared in code, with
`defineResource`. **A channel has no declaration surface at all** — not code, not files — and no
kind to be an instance of.

---

## 2. After (proposed) — the whole team is describable in files

```mermaid
flowchart LR
  TREE["workforce/ tree"] --> W["workers/ · WORKER.md"]
  TREE --> SK["skills/ · levels, duplicates refused"]
  TREE --> CH["channels/ · CHANNEL.md"]
  TREE --> RES["resources/ · handbook.md"]
  CODE["TypeScript code"] --> RES
  CH --> CF["ChannelFlow · default L2 kind"]
```

A team becomes describable in files. A channel goes from nothing to a folder naming a flow kind —
the default ChannelFlow, posted into and read back as one clean transcript. Two sub-specs are
approved; the objective is not.

---

## 3. The set

```mermaid
flowchart TD
  DOOR["FIX-1311 default ChannelFlow · subscribe, post, transcript"]
  REST["brief · housekeeper · retirement · CAS"]
  CH["FIX-1352 channels convention"]
  RES["FIX-1354 resources"]
  SK["FIX-1356 skills"]
  K["FIX-1342 kinds-map fence"]
  BOOT["FIX-1357 boot scan"]
  LAB["FIX-1355 pentest lab Proof"]
  ATL["FIX-1358 atlas"]
  CFG["FIX-1367 WorkerConfig admission"]
  DOOR -->|"kind before instances"| CH
  DOOR -.->|"out of admission, blocks nothing"| REST
  CH -->|walk primitives| RES
  CH -->|walk primitives| SK
  CH --> LAB
  RES --> LAB
  SK --> LAB
  K --> LAB
  BOOT -.->|"in the epic, off the floor"| LAB
  CH -.->|"in the epic, off the floor"| ATL
  SK -->|"seat register, filled by hire"| CFG
  classDef inflight fill:#9a6700,color:#fff
  classDef todo stroke-dasharray:5 5
  class CH,RES,SK,K inflight
  class DOOR,REST,LAB,ATL,BOOT,CFG todo
```

The set as of the objective gate: amber is in flight, dashed is not started, nothing has shipped.
The lab is last, with every convention pointing at it; the epic doc's index is the live copy.

---

_Panel 4 lands once the first implementation merges._
