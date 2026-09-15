# FIX-1362 · Per-seat skills in the built-in worker kind

Feature · 3 packages + docs · medium-large · epic FIX-1359 · [plan](PLAN.md) · [explainer](EXPLAINER.md)

## Context

- **What exists.** The built-in `agent` kind (FIX-1363). A loader that computes each seat's org ∪ team ∪ worker skill union (FIX-1356). A storage layer that can key a resource per flow instance. A skills library with slash and a mid-turn activate tool.
- **What's wrong.** The skills collection never asked for isolation, so every seat reads one org-wide bucket. Nothing carries the loader's union into a seat, so a folder beside a worker fills nothing. The contract (C1, C3, C5) promises *a seat's skills are that seat's*.
- **Why now.** Skills are the next thing a roster reaches for. Blocks FIX-1365.

## Goal

Two seats on one roster, each with its own skill folder, each holds and can use its own and not the other's. A turn that uses no skill costs no extra model call and no extra tokens.

## Requirements

| ID | Must hold | Met by |
|---|---|---|
| R1 | Two seats: distinct storage keys **and** distinct catalog contents | D1 · S1 S5 · V5 |
| R2 | A colocated skill is in its seat's catalog with no `skills:` list | D1 · S3 · V3 |
| R3 | Always-on skill in every prompt; merely held skill is not | D2 · S6 · V6 |
| R4 | `/name` activates without clobbering always-on | D2 · S6 · V6 |
| R5 | Both switches off → no listing, no load tool, no classifier call | D2 · S6 · V6 |
| R6 | `tools: []` calls nothing, including via a delegated board worker | S7 · V7 |
| R7 | Org edit reaches no seeded seat until refresh; deleted copies stay deleted | D3 · S8 · V8 |
| R8 | Refresh removes a withdrawn supporting file; ordinary seeding deletes nothing | D3 · S8 · V8 |
| R9 | `hireWorkforce`'s existing refusals unchanged | S4 · V4 |
| R10 | `seatSkills:` in frontmatter refused by name at both doors | S3 S4 · V4 |
| G | Goal check: two seats, two skills, `fsdev run` each, own skill only | S5 · VG |

## Decisions · the sign-off surface

### D1 · A seat's skills travel on the worker's own record, handed to the seat at hire like its instructions

| | |
|---|---|
| **Instead of** | An option on `hireWorkforce` · a runtime lookup by seat id |
| **Because** | FIX-1363 closed the hire-option door: two doors onto one setting drift. A running block cannot see its instance id, by design. Config is the only per-seat channel |
| **Locks in** | Skills are fixed when the roster is read. Changing a seat's set means re-hiring. No hot swap |
| **Serves** | R1 R2 R10 |

### D2 · A skill beside a worker is reachable, not always in context

| | |
|---|---|
| **Instead of** | Colocated = always-on, automatically |
| **Because** | The friendlier version charges every turn for every skill in the folder. The promise is that skills never slow a worker down |
| **Locks in** | Drop a folder, nothing visible changes until someone types `/name` or edits the file. We trade a moment of "why isn't it working" for the promise |
| **Serves** | R3 R4 R5 |

### D3 · A seat holds a copy. Company edits don't reach it. A refresh is deliberate and replaces that skill's folder whole

| | |
|---|---|
| **Instead of** | Live propagation · refresh as a file-by-file overwrite |
| **Because** | Propagation makes the drawer a view again and undoes D1. Overwrite reads safer and leaves a withdrawn supporting file live and reachable through `prompt-ref` |
| **Locks in** | Fixing a typo in a company skill means someone refreshes the seats: an operational step, not a background job. Refresh is all-or-nothing per skill: a seat's own additions inside that folder don't survive it |
| **Serves** | R7 R8 |

## Decided, not asked

- Slash matches a person's message only, never model-emitted text. An activation path the model drives is an injection surface. The activate tool is the sanctioned model-driven route.
- Activate tool ships in v1, off by default. Adding the switch later would mean shipping it always-on first, which D2 refuses.

## News

- **Open: none.** D2 is the hardest to ratify: it optimises for a promise over the thing people try first. Cheap to reverse.
- **A collection seeded before this change is shared.** Isolation moves the read to a new key. Old rows are orphaned, not lost. No migration (BP-030).
- **New exposure.** A seat's *own* skill can now declare `agents:`, which was impossible when the catalog was the kind's. The plan closes it (S7).

## Out of scope

| What | Owner |
|---|---|
| Deprecating one of the two skills entry points | FIX-1390, filed. This issue pins the choice and draws the docs boundary |
| Classifier tier | FIX-1363's, opt-in |
| Trigger phrases · keyword tier | Out, not renamed |
| Memory | FIX-1364 |
| Teaching surface | FIX-1366 |

## Evolution

- **Draft** — two separable failures; handoff via record + settings bag; three activation paths, tool off; reconciliation deferred.
- **Review** — D3 gained *replace the folder whole*: seeding overwrites only files still in the source, so a withdrawn file stayed live. Reconciliation became FIX-1390 plus a contract-narrowing step, because two authorities is worse than either.
