# FIX-1366 · Plan

Executes [SPEC.md](SPEC.md). Docs only. One PR. No tests, no changeset.

## Each surface, before → after → check

### `apps/docs/docs/workforce/overview.md`

| | |
|---|---|
| **Before** | Leads with a `kinds` map · example kind `worker-agent` / `workerAgentFlow` |
| **After** | Leads with the zero-code hire · names the built-in · states no memory · anchors into the section · `kinds` introduced after, as opt-in · `custom-agent` / `customAgentFlow` |
| **Check** | By eye: no-memory line is *on this page* · docs build (the anchor) |
| **Who** | `docs-writer` from a surface brief, then `docs-editor`. Never hand it this spec or a diff |

### `apps/docs/docs/workforce/workers-on-disk.md`

| | |
|---|---|
| **Before** | "The worker you get without writing one" (258) says 3 settings + a switch · custom-kind material says `worker-agent` |
| **After** | Same heading (it's the anchor) · full 5 + 4 inventory · why the last 2 are app-level · `tools:` fence + its hole · everything else word-for-word · `custom-agent` |
| **Check** | By eye: fence + hole present, classifier not promoted · grep A |
| **Who** | `docs-writer` + `docs-editor`, same brief |

### `packages/workforce/README.md`

| | |
|---|---|
| **Before** | `worker-agent` at 17, 31, 35, 193, 199 |
| **After** | `custom-agent`. Option counts at 212 / 355 already fixed by FIX-1392; confirm, don't redo |
| **Check** | Grep A · `pnpm --filter @flow-state-dev/workforce typecheck` |

### `docs/atlas/workforce.html`

| | |
|---|---|
| **Before** | 59 lines / 94 occurrences of the removed cluster. Line 577 calls `worker-agent` a built-in. Standfirst and §04 lede call `defineAgent` an "invent-kill candidate". §03 says a `kinds` map is required |
| **After** | Only three classes changed: (1) `worker-agent` as built-in (2) pending-decision framing on the removed cluster (3) `kinds` map required at hire. Plus the `origin/main` line (242) re-pinned |
| **Leave** | Anti-teaching framing ("do not teach `defineAgent` as a block factory" is still right) · voice · Linear links · anything merely old. Ambiguous → leave, list in PR |
| **Check** | Grep A empty · grep B on this page shows anti-teaching only · SVG `<text>` and `aria-label` changed together · entity-escaped HTML matched |

### `docs/architecture/workforce-agent-kind.md`

| | |
|---|---|
| **Before** | Filename and title say *agent kind* · cited from `architecture-reference.md:42` and the header of `agent-worker-flow.ts:15` |
| **After** | `git mv` → `workforce-default-worker-kind.md` · title "The Default Workforce Worker Kind — Locked Contract" · both refs updated (link target *and* text) · C6 body untouched |
| **Check** | `grep -rn workforce-agent-kind . \| grep -v node_modules` → empty |

## Order

1. Re-run both greps. Confirm: superseded factory names → 0 hits; the orchestration/skills pages are correct and untouched.
2. Rename the contract.
3. Sweep the placeholder in README, overview, workers-on-disk.
4. Dispatch the writer. Then the editor.
5. Atlas.
6. Confirm FIX-1392 on `main`.
7. `pnpm --filter docs build` → exit 0.
8. PR. Say "no changeset".

## The greps

```bash
# A — teaching surface only. Empty after step 5.
# Repo-wide can never pass: the contract keeps worker-agent in C6 on purpose.
grep -rn "worker-agent\|workerAgentFlow" \
  --include=*.md --include=*.mdx --include=*.html \
  apps/docs packages/*/README.md docs/atlas

# B — the removed cluster. Never empty. Most hits are correct.
grep -rn "defineAgent\|materializeAgent\|AgentRegistry\|createAgentRegistry" \
  --include=*.md --include=*.mdx --include=*.html . | grep -v node_modules
```

Residue grep A doesn't reach, and must stay: the contract's C6 text · `docs/internal/design/kitchen-sink-agent-drift.md`.

## The fence, as it should read on the page

> A worker's `tools:` is a hard fence: a seat calls exactly the catalog keys it names, and an empty list means none. One known limit today: a capability mounted on the worker that contributes its own tools adds them alongside the declared list rather than being narrowed by it. The stock worker and any capability that opts out hold the line.

No dates, no "soon", no issue number. `generator.ts` resolves `[...base, ...staticTools, ...dynTools]` if you want to see it. **If FIX-1393 has landed, drop the second and third sentences.**

## At implement time

- FIX-1364 landed first → link its memory teaching rather than repeat.
- Option counts moved → `agent-worker-flow.ts` wins over the tables above.
- An Atlas row you can't call false or old → leave it and say so.
