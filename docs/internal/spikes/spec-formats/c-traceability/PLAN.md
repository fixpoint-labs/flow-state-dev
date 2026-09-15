# FIX-1366 · Plan

Executes [SPEC.md](SPEC.md). Docs only. One PR. No tests, no changeset.

## Surfaces

| ID | File | Change | Serves |
|---|---|---|---|
| S1 | `apps/docs/docs/workforce/overview.md` | First example: worker file + hire call with no `kinds`. Name it the built-in, state no memory, anchor into S2. Introduce `kinds` after, as opt-in. `worker-agent` → `custom-agent` | R1 R2 R6 R7 R8 |
| S2 | `apps/docs/docs/workforce/workers-on-disk.md` | Grow "The worker you get without writing one" (line 258): replace the 3-settings sentence with the 5 + 4 inventory. Add the `tools:` fence with its hole. Keep the heading text (it's the anchor). Sweep custom-kind material to `custom-agent` | R3 R4 R5 R6 R7 |
| S3 | `packages/workforce/README.md` | `worker-agent` → `custom-agent` sweep | R6 |
| S4 | `docs/atlas/workforce.html` | Classes 1–3 only (below). Re-pin the `origin/main` line (242) | R6 R9 |
| S5 | `docs/architecture/workforce-agent-kind.md` | `git mv` → `workforce-default-worker-kind.md`. Retitle. Update `architecture-reference.md:42` and the provenance header at `agent-worker-flow.ts:15`. Leave the C6 body | R10 |

## Checks

| ID | Check | Passes when |
|---|---|---|
| V1 | Grep A, teaching surface only | Empty after S4 |
| V2 | `grep -rn "FIX-[0-9]" apps/docs/docs/workforce` | Empty |
| V3 | `pnpm --filter docs build` | Exit 0 · `onBrokenLinks: "throw"` |
| V4 | `grep -rn workforce-agent-kind . \| grep -v node_modules` | Empty |
| V5 | By eye: no-memory line on the overview, fence + hole on S2, classifier not promoted | Reviewer agrees |
| V6 | Grep B on `workforce.html` | Anti-teaching framing only |
| V7 | `pnpm --filter @flow-state-dev/workforce typecheck` | Passes after S5 |

```bash
# Grep A. Repo-wide can never pass: the contract keeps worker-agent in C6 on purpose.
grep -rn "worker-agent\|workerAgentFlow" \
  --include=*.md --include=*.mdx --include=*.html \
  apps/docs packages/*/README.md docs/atlas

# Grep B. Never empty. Most hits are correct.
grep -rn "defineAgent\|materializeAgent\|AgentRegistry\|createAgentRegistry" \
  --include=*.md --include=*.mdx --include=*.html . | grep -v node_modules
```

## Sequence

| # | Do | Touches | Verify | After |
|---|---|---|---|---|
| 1 | Re-run greps A + B. Confirm superseded factory names → 0 hits repo-wide, and the orchestration/skills pages are correct | — | V1 baseline | — |
| 2 | Rename the contract | S5 | V4 | — |
| 3 | Sweep the placeholder | S1 S2 S3 | V1 → Atlas hit only | — |
| 4 | Dispatch `docs-writer` with a surface brief (never this spec, the diff, or the rename history). Then `docs-editor`. No new file, no `sidebars.ts` change | S1 S2 | V5 | 3 |
| 5 | Atlas pass | S4 | V1 empty · V6 | — |
| 6 | Confirm FIX-1392's docstring + README counts are on `main`. Don't redo | — | V7 | — |
| 7 | Build the docs | — | V3 | 4 |
| 8 | PR. Say "no changeset" | — | — | 7 |

## S2 · the inventory · re-derive from `agent-worker-flow.ts`

| App · `AgentWorkerFlowOptions` | Worker · its own file |
|---|---|
| `catalog` — tools workers may name | `instructions` |
| `skills` — seeded per seat | `model` |
| `model` — default when none named | `tools` |
| `classifierModel` — opt-in third tier | `skills.enableLlmClassifier` · default `false` |
| `confidenceThreshold` — that tier's bar | |

The last two are app-level because the matcher is built once per kind. One sentence of that goes on the page.

## S2 · the fence

1. Guarantee first: a seat calls exactly the catalog keys it names; empty means none.
2. Then the hole, one or two sentences: capability-contributed tools are unioned onto declared `tools:` today (`generator.ts` → `[...base, ...staticTools, ...dynTools]`). Holds for the stock worker and for capabilities that opt out.
3. Behaviour and a known limit. No dates, no issue number on the page. **If FIX-1393 has landed, skip step 2.**

## S4 · Atlas classes

| Class | Change | Where |
|---|---|---|
| 1 | `worker-agent` presented as a built-in | 577 |
| 2 | Pending-decision framing on the removed cluster: "invent-kill candidate", "may not need to exist", "kill it", "stop growing" | standfirst 236 · §04 lede 568 · SVG labels · W2/W3 table |
| 3 | Rows asserting a `kinds` map is required at hire | §03 table |

Leave: anti-teaching framing (still right) · fence, sequence, vocabulary, voice · Linear links · merely old rows. Match entity-escaped HTML. Fix SVG `<text>` and `aria-label` together. Ambiguous → leave it, list it in the PR.

## Guardrails

| Don't | Because |
|---|---|
| "Fix" `orchestration/configuration.md`, `orchestration/agents.md`, `skills/delegation.md`, `guides/building-a-research-team.md` | Live bring-your-own options on `createSkillsLibrary`. Correct |
| Touch `workers-on-disk.md:248` | FIX-1363's |
| Move, copy, or re-voice the built-in section | Grow only |
| Edit the contract's C6 body | Deliberate residue |
| Chase counts into merged PR descriptions | History |

## At implement time

- FIX-1393 landed → teach the fence flat.
- FIX-1364 landed first → link its memory teaching.
- Counts moved → source wins.
