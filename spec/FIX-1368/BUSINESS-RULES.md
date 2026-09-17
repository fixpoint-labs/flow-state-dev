# FIX-1368 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

The cases, as rules. Each says what a person or the tree does and what happens. *Proved by* is
the check the plan runs. Every rule below is about the **third root only**: the org and team
roots keep every rule they shipped with, and BR-14 is the check that says so.

## Reading the third root

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A `<name>.md` sits in `teams/<t>/workers/<w>/resources/` | One document, ref `teams/<t>/workers/<w>/<name>`, frontmatter and body read exactly as at the other two levels | CI |
| BR-2 | A worker folder has no `resources/` folder | Silent. Not an error — most seats have no documents | CI |
| BR-3 | A team has no `workers/` folder at all | Silent, and the team's own `resources/` still reads | CI |
| BR-4 | The same bare name exists at org, team, and worker level | Three documents, three refs, none shadowing another. There is no precedence rule because there is no collision | CI |
| BR-5 | A worker folder holds a `resources/` folder and no `WORKER.md` | The documents load ([D3](DECISIONS.md#d3)). The roster read reports the missing seat, unchanged and separately | CI |
| BR-6 | A `resources/` folder sits at `teams/<t>/workers/` — beside the worker folders, not inside one | Not a slot this convention claims. Passed over in silence, like any other file or folder in the `workers/` level | CI |

## When the tree is wrong

| # | When | Then | Proved by |
|---|---|---|---|
| BR-7 | A directory sits where a document file belongs in a worker's `resources/` | Reported, `kind: "folder-where-file-belongs"`, keyed by its path, in the team level's exact wording | CI |
| BR-8 | A worker's `resources/` folder is a symlink | Refused, `kind: "unreadable-slot"`, in the shared symlink wording. Never followed | CI |
| BR-9 | A worker *folder* is a symlink | Refused once, under the worker folder's path. Nothing beneath it is read | CI |
| BR-10 | A team's `workers/` folder is there and cannot be listed | Reported once, under `teams/<t>/workers`. That team's worker documents are all missing, and its team-level documents still load | CI |
| BR-11 | A worker folder name breaks the segment rules | The document is reported, `kind: "document-load-failed"`, naming the rule. The file is not read — an address that cannot be minted has nothing to key a record under | CI |
| BR-12 | A worker's document declares a derived setting, or `prefetchMode: "lazy"` | Refused, `kind: "refused-declaration"`, the same set and the same wording as the other two levels ([ER-4](https://github.com/fixpoint-labs/flow-state-dev/pull/1718)) | CI · the shared derived-key table |
| BR-13 | `.DS_Store` or a non-`.md` file sits in a worker's `resources/` | Passed over in silence | CI |

![Two aligned columns, today and after, showing the three resource roots with the third dashed and empty today and solid after, and a fence strip marking what is not built](figures/third-root.svg)

The bottom strip is the fence these rules stop at: every rule above is about which documents
**load** and under which address. None of them is about which seat may **read** one. The mermaid
below names the two paths the fence separates.

```mermaid
flowchart LR
  A["a worker's document"] -->|"loads · addressed to that worker"| M["the one flow-level map"]
  B["another seat on the same kind"] -->|"reads it · not refused here"| M
```

## What must not move

| # | When | Then | Proved by |
|---|---|---|---|
| BR-14 | Any tree with no worker-level `resources/` folder anywhere | Byte-for-byte today: the same documents, the same order, the same errors | CI · the shipped reader suite, unmodified |
| BR-15 | A roster is hired from a tree that has worker documents | `hireWorkforce` behaves identically — no new key, no new option, no document in a seat's settings bag | CI |
| BR-16 | Documents are turned into a resource map | `resourcesFromDocs` is unchanged, and a worker document becomes an ordinary org-scoped entry keyed by its ref | CI |

## Failure taxonomy

Nothing here is fatal to a read. Every condition above lands in the existing `errors` array under
an existing `kind` — this issue adds no new error kind, because it adds no new *condition*, only
a third place the existing five can occur. `readResourcesDirectory` still throws for one reason
only: the root itself is a symlink or cannot be read. An app decides what a non-empty `errors`
means, and for worker documents the right default is the same as for the other two levels — fatal
at boot, because every entry is a document the app was supposed to have.

## Acceptance criteria this issue owns

A tree with a `handbook` at the org level, a `handbook` in a team, and a `runbook` in one worker
of that team loads three documents under three refs, with an empty `errors` — and the same tree
with the worker document deleted loads exactly what it loads on `main` today. No goal check on a
real model applies: nothing here reaches a model, and the one behaviour a model would exercise
(which seat may read which document) is the half this issue does not ship
([D2](DECISIONS.md#d2)).
