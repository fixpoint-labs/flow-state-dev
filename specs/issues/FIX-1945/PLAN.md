# FIX-1945 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Written for the implementing agent. IDs cross-reference [BUSINESS-RULES.md](BUSINESS-RULES.md)
(BR-n) and [DECISIONS.md](DECISIONS.md) (D-n). `tdd`. Two stacked PRs.

## Surfaces

| ID | Package · area | Change | Rules |
|---|---|---|---|
| S1 | `workforce` · the rules record | Declare a `standing-rules` collection on the agent and coordinator flows with the skills drawer's scoping (`scope: "user"`, `collectionConfig: { flowIsolation: true }`), one record per worker keyed by the verified worker id (`verifiedWorkerOf`), the bucket layout `skills/partition.ts` uses. Client `read` on; `create`, `update`, `delete` off (core `resource.ts` client content flags). Each record holds the numbered rules with date and source conversation. Not in the skills collection: `defineSkillsCollection` turns client writes on (`orchestration/src/skills/collection.ts`), which would skip S2's validator. No `orchestration` change | BR-12 BR-13 |
| S2 | `workforce` · the rules list | Read, render and write S1's record for the request's verified worker and person. One validator for every writer: 20 rules, 300 characters, one line, not empty; change and remove carry the quoted current text (D3) | BR-15 BR-16 BR-17 BR-18 |
| S3 | `workforce` · the rule tools | `rules/read`, `rules/add`, `rules/change`, `rules/remove`. Each write emits a client-visible line naming the rule and the count. Offered by allowlist. **New in S3:** a person-turn marker in workforce request state, set by a new `markPersonTurn` step on each door: the agent flow's public `run` action (in `defineAgentFlowAround`, before `run`), and the coordinator's `postStateOf` when it opens a round-0 post. Only a marked turn gets the tools. Delivered through the turn's `extraTools` share (`coordinator-flow.ts`, the `agentWorkerTurn` call), not `uses`, since the tools fence drops catalog tools from `uses` (D2) | BR-1 BR-2 BR-3 BR-4 BR-5 |
| S4 | `workforce` · the agent turn | Put the rules in context after the instructions, team instructions and packages, as one more dynamic entry in `usesEntries` (`agent-worker-flow.ts`, beside `workerCapabilities`), not a fourth `prompt` entry. Its user is the request's identity: a task turn runs in a task session at the filing person's user scope (`conversation-board/task-entry.ts`, header), so the record resolves to that person with no new lookup; V4 proves it on a task turn. Reaches the coordinator through the shared turn. Nothing when the list is empty. A failed or malformed read is logged in the trace and the turn runs without rules; it never fails the turn (D1) | BR-6 BR-7 BR-8 |
| S5 | `workforce` · worker flows + client | A public rules action on the agent and coordinator flows, run in the person's session with that worker (the request's verified worker; the server's user), through S2's validator. Client methods reach it through `ensureWorkerSession`. Not the roster flow: the record's storage belongs to the worker's flow. Fork copies no rules | BR-11 BR-14 BR-19 |
| S6 | `shift-manager` · Rules view | A Rules view per roster worker on the built-in `agent` flow (from its Roster row; other flows show BR-21a's line) and a Rules section on the Shift Coordinator view: list with when and from which conversation; add, edit, delete through S5 | BR-19 BR-20 BR-21 |
| S7 | `goals` | `goals/standing-rules/a-note-outlives-its-session/` with `GOAL_CONTROL=no-rules-context` | goal |
| S8 | Docs | Publish [DOCS.md](DOCS.md); one `minor` changeset for `workforce`, one for `shift-manager` | — |

## Sequence

```mermaid
flowchart TD
  S1["S1 · rules record"] --> S2["S2 · rules list and validator"]
  S2 --> S3["S3 · rule tools"]
  S2 --> S4["S4 · rules in context"]
  S2 --> S5["S5 · read and write on the worker flow"]
  S3 --> S7["S7 · goal check"]
  S4 --> S7
  S5 --> S7
  S5 --> S6["S6 · Shift Manager view"]
  S6 --> S8["S8 · docs"]
```

| PR | Deliverables | depends_on |
|---|---|---|
| A | S1–S5, S7, the `workforce` part of S8 | — |
| B | S6, the `shift-manager` part of S8, the browser leg | A |

Stack B on A as a GitHub stack; if A has merged, base B on `main`.

## Checks

| ID | Runs after | Passes when |
|---|---|---|
| V1 | S1 | A direct client write to the record is refused (BR-12); a server write is read back for one worker and one person and not another; a seeded-skill refresh leaves it and the skill catalog never lists it (BR-13) |
| V2 | S2 | Each limit refuses with its reason (BR-16, BR-17); a stale quote refuses with the current list (BR-15); two writers racing, two adds included, each carrying the list version it read: one wins, the other refuses (BR-18) |
| V3 | S3 | Tools present on a person-started turn of both the agent and coordinator flows; absent on every other entry point named in BR-4, one test each, including a person's answer inside a task session; each write emits the visible line; a failed write emits no "saved" line (BR-5) |
| V4 | S4 | Rules come after the three prompt entries (order among other capabilities' context is not controlled); a task turn filed by Alice reads Alice's list, never Bob's or none; empty list adds nothing (BR-7); a failing or malformed read leaves the turn running with no rules and a trace entry (failure taxonomy); an edit is read on the next turn with no new session (BR-8). D1's check |
| V5 | S5 | Fire and re-hire, and a flow move (BR-13a, BR-13b); second person sees and edits only their own list; another person's id in the request is ignored or refused (BR-9, BR-14); a fork has none (BR-11) |
| V6 | S5 | D2's check: page and tool edits go through one validator; a tool write from a task turn is impossible, not merely unused |
| VG | S7 | [The goal](SPEC.md#the-goal-and-how-well-know-its-met) PASSES on a real model after the same run FAILED `next-session-follows` under `GOAL_CONTROL=no-rules-context` |
| V7 | S6 | Browser: add, edit, delete on the page; the next session follows the edit (BR-19 to BR-21a). D3's limits shown on the page |

## Pinned names

| Where | Name | Why pinned |
|---|---|---|
| Tools | `rules/read`, `rules/add`, `rules/change`, `rules/remove` | Model-facing and named in docs |
| Rules record | `standing-rules`, client writes off | BR-12 rests on it |
| Limits | 20 rules, 300 characters | D3 |
| Goal check | `goals/standing-rules/a-note-outlives-its-session/`, `GOAL_CONTROL=no-rules-context` | `SPEC.md` names it |

Everything else is yours to name.

## Guardrails

| Rule | Because |
|---|---|
| Every write, tool or page, goes through S2's one validator (tenet 5), and the record takes no client writes | A cap enforced on one path is a cap the other path breaks |
| The worker and person come from the verified session and the server's identity (BP-031) | A rules write keyed on input lets one person write another's rules |
| Write tools are offered by allowlist on the person's door, never by a denylist of other turns | D2's safety rests on a task turn being unable to edit, including entry points added later |
| The visible line comes from the tool, not the model's reply | D2 says each edit is shown; a model can forget to say it |
| Nothing in `core` or `engine` changes | Workforce concepts stay out of Layer 1 |
| Don't widen the three-entry prompt seam | `agent-worker-flow.ts` and arch doc say a fourth entry re-decides the seam; a `uses` context entry does not |
| Say "worker", never "seat", in every new prose line | Jake's vocabulary rule |

## Docs

Reconcile and publish [DOCS.md](DOCS.md): the workforce pages in PR A after VG passes, the
Shift Manager pages in PR B after V7.

## Sketch · pseudocode, illustrative, react to the shape

```
on a person-started turn:
    tools += rules tools bound to (verified worker, signed-in person)
on every turn:
    list ← rulesRecord(person scope).get(verified worker)
    if list not empty: context += numbered list, after the worker's own prompt
rules/add(text):
    validate(text, list)                 ← the one validator, shared with the page
    write; emit visible line "Rule added (n of 20): …"
```

**POC:** none. The per-person, per-worker keying, client content flags and the context seam
are on `main`; no premise is unproven.

## At implement time

- Re-list the agent flow's entry points (`run`, task, delegated post, board notices, workstream)
  and the coordinator's door; BR-4's allowlist must cover any added since.
- Re-check FIX-1793 D3's "coordinator-written skill" follow-up has not started elsewhere.
- Re-check the per-turn context budget against the memory digest on the coordinator.

## Notes from review

- "Pick one exclusion mechanism … instead of 'whichever the collection allows'." Moot: review moved the rules out of the skills collection (S1). — cursor ([thread](https://github.com/fixpoint-labs/flow-state-dev/pull/3289#discussion_r4265210052))
- "Index-only (or list version / etag) with 'list changed, re-read' on conflict" instead of quoting current text on change and remove. — cursor ([thread](https://github.com/fixpoint-labs/flow-state-dev/pull/3289#discussion_r4265210072))
- "v1 text-only numbered lines; … conversation links … follow-up." BR-20 keeps the date and source as a person-facing promise; how they are stored is yours. — cursor ([thread](https://github.com/fixpoint-labs/flow-state-dev/pull/3289#discussion_r4265210099))
- "Drop `rules/read`" and "compare conditional `controlTools` vs static merge … if V3 proves zero rules schemas on task/delegate turns." The issue asks for a read tool, so it stays pinned; the delivery route is yours if V3 holds. — cursor ([thread](https://github.com/fixpoint-labs/flow-state-dev/pull/3289#discussion_r4265210082))
- "Add a non-goal CI check: max formatted rules context size at cap." — cursor ([thread](https://github.com/fixpoint-labs/flow-state-dev/pull/3289#discussion_r4265210107))
- "A matrix helper + one representative negative instead of N separate tests" for BR-4. — cursor ([thread](https://github.com/fixpoint-labs/flow-state-dev/pull/3289#discussion_r4265210094))

These are inputs, not instructions. Adopt, adapt, or discard.

## Follow-ups

- Rules shared across one person's workers, or an org: file if D1's change-my-mind signal shows.
