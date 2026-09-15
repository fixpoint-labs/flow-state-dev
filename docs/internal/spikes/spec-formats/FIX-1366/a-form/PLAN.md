# FIX-1366 · Plan

Executes [SPEC.md](SPEC.md). Docs only. One PR. No tests, no changeset.

## Steps

| # | Do | Verify | After |
|---|---|---|---|
| 1 | Re-run grep A and grep B (below). Confirm the two zero-change findings still hold | Superseded factory names: 0 hits repo-wide. Orchestration and skills pages untouched | — |
| 2 | `git mv docs/architecture/workforce-agent-kind.md` → `workforce-default-worker-kind.md`. Retitle "…Worker Kind — Locked Contract". Update `architecture-reference.md:42` (target and text) and the provenance header at `agent-worker-flow.ts:15` | `grep -rn workforce-agent-kind . \| grep -v node_modules` → empty | — |
| 3 | Sweep `worker-agent` → `custom-agent` and `workerAgentFlow` → `customAgentFlow` in the workforce README, `overview.md`, `workers-on-disk.md`. Rename a `kinds` map key and its identifier together | Grep A → only the Atlas hit remains | — |
| 4 | Dispatch `docs-writer` with a **surface brief** (never this spec, the diff, or the rename history): overview leads with the zero-code hire + the no-memory line + the anchor; the section grows with the 5 + 4 inventory and the `tools:` fence with its hole named. Then `docs-editor`. No new file, no `sidebars.ts` change | R1–R5 by eye | 3 |
| 5 | Atlas pass on `workforce.html`: classes 1–3 only. Re-pin the `origin/main` line (242) to the landing commit and date | Grep A → empty. Grep B on that page → anti-teaching framing only | — |
| 6 | Confirm FIX-1392 (PR #1774) already put the docstring fix and README counts on `main`. Don't redo it | `pnpm --filter @flow-state-dev/workforce typecheck` | — |
| 7 | `pnpm --filter docs build` | Exit 0. `onBrokenLinks: "throw"` catches the new anchor | 4 |
| 8 | Open the PR. Say "no changeset" in the body | — | 7 |

## The two greps

**Grep A — teaching surface only.** The repo-wide form can never pass: the contract keeps `worker-agent` in its C6 text on purpose.

```bash
grep -rn "worker-agent\|workerAgentFlow" \
  --include=*.md --include=*.mdx --include=*.html \
  apps/docs packages/*/README.md docs/atlas
```

Expected after step 5: empty. Residue this grep doesn't reach, and must stay: the contract's C6 text (lines ~269–278) · `docs/internal/design/kitchen-sink-agent-drift.md`.

**Grep B — the removed cluster.** Not expected to be empty. Most hits are correct.

```bash
grep -rn "defineAgent\|materializeAgent\|AgentRegistry\|createAgentRegistry" \
  --include=*.md --include=*.mdx --include=*.html . | grep -v node_modules
```

## The inventory · re-derive from `agent-worker-flow.ts` at implement time

| App supplies · `AgentWorkerFlowOptions` | Worker declares in its file |
|---|---|
| `catalog` — tools workers may name in `tools:` | `instructions` |
| `skills` — seeded into every seat's library | `model` |
| `model` — default when a worker names none | `tools` |
| `classifierModel` — the matcher's opt-in third tier | `skills.enableLlmClassifier` · default `false` |
| `confidenceThreshold` — that tier's bar | |

The last two are app-level because the matcher is built once per kind. A per-worker value could never be honoured, and a silently ignored setting is the failure this kind's tool handling exists to prevent. One sentence of that belongs on the page.

## The `tools:` fence · how to write it

1. State the guarantee first: a seat calls exactly the catalog keys it names, and an empty list means none.
2. Then the hole, in one or two sentences: capability-contributed tools are currently unioned onto declared `tools:` rather than intersected (`generator.ts` resolves `[...base, ...staticTools, ...dynTools]`). Holds for the stock worker and for capabilities that opt out.
3. Behaviour and a known limit. No dates, no "soon", no issue number on the page.

## Atlas · what to touch on `workforce.html`

| Class | Change | Where |
|---|---|---|
| 1 | `worker-agent` presented as a built-in | line 577 |
| 2 | Pending-decision framing on the removed cluster: "invent-kill candidate", "may not need to exist", "kill it", "stop growing" | standfirst (236) · §04 lede (568) · SVG `aria-label`s and `<text>` nodes · W2/W3 table |
| 3 | Rows asserting a `kinds` map is required at hire | §03 table |

Leave: the anti-teaching framing ("do not teach `defineAgent` as a block factory" is still right) · the fence, sequence, vocabulary, voice · Linear links · anything merely old. Match the file's entity-escaped HTML. Fix an SVG `<text>` and its `aria-label` together. Ambiguous between false and old → leave it, list it in the PR.

## Don't

| Don't | Because |
|---|---|
| "Fix" `orchestration/configuration.md`, `orchestration/agents.md`, `skills/delegation.md`, `guides/building-a-research-team.md` | `agentRegistry` / `materializeAgent` / `capabilityCatalog` are live bring-your-own options on `createSkillsLibrary`. Those pages are right |
| Touch `workers-on-disk.md:248`, the refusal-list line | FIX-1363 owns it |
| Move, copy, or re-voice the built-in section | It's good. Grow it only |
| Edit the contract's C6 body | Deliberate residue. It records the split |
| Chase the option-count phrasing into merged PR descriptions | Historical records |

## Check at implement time

- **FIX-1393 landed?** Drop the fence-hole sentence, teach the fence flat.
- **FIX-1364 landed first?** Link its memory teaching rather than repeat it.
- **Option counts moved?** The inventory above is a snapshot. Source wins.
- **Atlas row ambiguous?** Leave it and say so in the PR body.
