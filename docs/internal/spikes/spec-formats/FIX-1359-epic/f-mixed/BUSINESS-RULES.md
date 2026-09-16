# FIX-1359 · Rules every issue in the set obeys

At epic altitude the rules aren't behaviours of one feature; they're the constraints every child spec and implementation must satisfy, and the place a cross-spec review checks. Each says who owns it and where it's checked.

## What a team gets, and what it doesn't

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | A `WORKER.md` carrying only `instructions` hires into the built-in kind. Zero config lines | FIX-1361 contract · FIX-1363 build | FIX-1365's proof |
| ER-2 | A seat naming a kind that isn't registered fails loudly. Absent means default; wrong means error | FIX-1361 · FIX-1363 | FIX-1363's tests |
| ER-3 | `flow: myCustomAgent` wins whenever that kind is on the hire `kinds` map. Custom kinds register exactly as other flow factories do | FIX-1361 | FIX-1363's tests |
| ER-4 | The built-in and the hire package carry no memory import. Nothing at hire time and no config flag can add one | FIX-1361 (decision 2) | Every child's PR: the workforce package's dependency list |
| ER-5 | Memory attaches by an app assembling the shipped pieces into its own kind, on `session` / `user` / `org` and shipped member patterns. Where durable per-member isolation is missing, the gap is named on the Atlas and ticketed, never faked at the seat | FIX-1364 | FIX-1364's spec review · FIX-1366's pages |
| ER-6 | A seat's skills are org ∪ team ∪ own, bare names kept, colocated skills available with no list. Isolation is a real storage identity, not a view over one org collection | FIX-1361 contract · FIX-1362 build | FIX-1362's acceptance criterion: two seats, distinct catalog contents |

## What no child may do

| # | Rule | Because |
|---|---|---|
| ER-7 | No child revives "thin" or "fat", or introduces a fifth term beside seat, kind, worker, agent kind | One vocabulary across seven specs, or the cross-spec review spends itself on translation |
| ER-8 | No child defines a second default-prompt system. The kind consumes `[default, instructions]`; W2 ships the default | Two prompt systems is the failure the seam exists to avoid. A child that needs one comments up |
| ER-9 | No child extends, imports or mirrors `defineAgent`, `AgentRegistry` or `materializeAgent`, and no child waits for their deletion | The new kind is built beside the old cluster so neither blocks the other |
| ER-10 | No child re-parents FIX-1344 or FIX-1356 under this epic | They're consumed, not owned. Linear allows one parent |
| ER-11 | No child re-reads kitchen-sink for the agent shape; it cites the drift note | One shared artifact beats four specs each characterising the same app |
| ER-12 | No child documents `persona`, as a key or as an empty reservation | Reserved later opinion, no surface |
| ER-13 | No child turns the out-of-the-box defaults into a required import: skills library plus binding, memory nothing by default | The fence in ER-4 |

## How the set is run

| # | Rule | Because |
|---|---|---|
| ER-14 | A child's Linear state is mirrored the moment it changes. The epic wake derives blocked-by from Linear | A child left stale blocks its dependants whatever its PRs say. FIX-1360 held FIX-1361 for a day this way |
| ER-15 | A cross-cutting question a child hits is commented **up** on the epic PR, not decided locally | The decisions doc is the single place; a local answer is a second authority |
| ER-16 | Every child's route reads *spec* by default; only a `Bug` label re-routes it | Fail-closed routing |
| ER-17 | The epic finishes only when FIX-1365's goal check passes | D6. Surface without proof doesn't move the lead measure |

## The proof

| # | The epic is done when | Proved by |
|---|---|---|
| ER-18 | A real roster hires a `WORKER.md` with only instructions, the seat answers, and uses a skill registered to it, on the real path | FIX-1365's goal check, real model |
| ER-19 | The docs teach exactly one way to get an agent, and it's the built-in | FIX-1366's grep: no `worker-agent` on teaching surface; no pending-decision framing about the removed cluster |
