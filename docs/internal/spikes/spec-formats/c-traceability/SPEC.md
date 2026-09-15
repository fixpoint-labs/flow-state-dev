# FIX-1366 · Teach the built-in worker kind

Docs only · epic FIX-1359 · [plan](PLAN.md) · [explainer](EXPLAINER.md)

## Context

- **What exists.** The built-in worker kind (`agent`) is on `main`, and `workers-on-disk.md` has taught it since it shipped: zero-code hire, no memory, the factory replacement. The prose is good.
- **What's wrong.** The overview never mentions it and leads with a `kinds` map. The example kind `worker-agent` sits beside the real id and reads like a shipped default. The reference says 3 settings; the API has 5 + 4. A public Atlas page calls a removed API a pending decision.
- **Why now.** The kind is the epic's headline. Every day the front door hides it, the placeholder gets copied.

## Goal

A reader who wants a worker meets the built-in on the first example, learns its limits in the same breath, and can reach a complete reference in one click. No second copy of anything.

## Requirements

| ID | The pages must | Met by |
|---|---|---|
| R1 | Answer "what do I get with no code?" in the overview's first example | D1 · S1 |
| R2 | State **no memory** on the new front door, at least as prominently as today | D1 · S1 |
| R3 | List all 5 app options and 4 worker settings | D2 · S2 |
| R4 | Not push readers toward the LLM classifier. Opt-in, off by default | D2 · S2 |
| R5 | Teach the `tools:` fence as the guarantee and name the hole | S2 · V5 |
| R6 | Carry no `worker-agent` on teaching surface | S1 S2 S3 S4 · V1 |
| R7 | Carry no issue numbers under `apps/docs` | S1 S2 · V2 |
| R8 | Build with no broken links | S1 · V3 |
| R9 | Publish no pending-decision framing about a removed API | D3 · S4 |
| R10 | Name the contract by the locked vocabulary: *worker*, not *agent* | S5 · V4 |

## Decisions · the sign-off surface

### D1 · No new page. Grow the existing section, promote it from the overview by anchor

| | |
|---|---|
| **Instead of** | A new `built-in-worker.md` · or a stub that only redirects |
| **Because** | The teaching exists and is good. A new page relocates it, buys one URL and a sidebar row, and creates a second surface to keep in step |
| **Locks in** | No sidebar entry names the concept. If nobody finds it, a sidebar label is the fix, made after someone fails |
| **Serves** | R1 · R2 |

### D2 · The reference lists all 9 options. Emphasis unchanged

| | |
|---|---|
| **Instead of** | "3 + a switch" as if complete · *or* list 3 and defer 2 in one explicit line (acceptable) |
| **Because** | A reference that undercounts a public surface sends people to read our source |
| **Locks in** | `classifierModel`, `confidenceThreshold`, `enableLlmClassifier` become public surface. Narrowing later reads as a removal |
| **Serves** | R3 · R4 |

### D3 · Atlas: a bounded factual pass on `workforce.html` only

| | |
|---|---|
| **Instead of** | Restructure it · or sweep all 4 atlas pages |
| **Because** | 59 matching lines. Unbounded "factual pass" becomes a rewrite. Siblings would make this a hygiene sweep |
| **Locks in** | `conductor.html`, `framework.html`, `roadmap.html` keep asserting a removed API exists until FIX-1387 |
| **Serves** | R9 |

## News · not decisions, but you'd want to know

- **One open call → recommend yes.** Anchor-link promotion only, no sidebar entry. Changes my mind: a design partner onboarding from the sidebar alone. Cost if wrong: one label.
- **The `tools:` fence is a guarantee with a hole.** Capability tools are unioned onto declared `tools:`, not intersected. Architect ruling: the fence stands, core will enforce it (FIX-1393). Until then the page teaches the guarantee and names the hole, as behaviour, not roadmap.
- **The source docstring fix already shipped** as FIX-1392 / PR #1774. Not this issue's work.

## Out of scope

| What | Owner |
|---|---|
| 3 sibling atlas pages (14 lines / 27 occurrences, real, false) | FIX-1387 |
| Atlas voice and publication question | FIX-1387 |
| Core tool resolution | FIX-1393 |
| Memory composition teaching | FIX-1364 |
| Skills entry-point reconciliation | FIX-1362 |
| `createChannelFlow` rename | FIX-1386 |
| Pages documenting `agentRegistry` / `materializeAgent` as bring-your-own | Correct as is |

## Evolution

- **Draft** — proposed a new page. Premise: nothing teaches the built-in.
- **R1** — it duplicates an existing section. Folded as move-not-copy.
- **R2** — premise false. Reversed to grow + promote. Grep gate rescoped: repo-wide can never pass.
- **Ruling** — `tools:` fence stands, core enforces (FIX-1393). Teach it, name the hole.
