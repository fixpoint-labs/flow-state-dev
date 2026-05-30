---
sidebar_position: 4
sidebar_label: Hygiene
---

# Hygiene

Long-lived agents accumulate state. Stable facts pile up. Episodes from a year ago sit next to episodes from this morning. A semantic fact extracted at high confidence yesterday and an equally-confident fact from eighteen months ago rank identically when you call `recall()`. The longer the agent runs, the less useful the store gets.

Hygiene is the maintenance pass that keeps that from happening. It's on by default. Two things happen periodically:

1. **Confidence decays.** Each semantic fact has an *effective confidence* — the raw confidence score decayed by how long it's been since the fact was last reinforced. The decay is exponential with a tunable half-life. Facts that fall below a floor are removed.
2. **Episodes age out.** Persistent episodes past a turn-count or wall-time threshold are evicted. Permanent episodes are never deleted; instead, after a long silent window they pick up a `stale: true` marker so operators can see what's gone cold.

The whole pass is deterministic and free of LLM calls. It runs on the consolidation cadence by default, not every turn.

## How it works

### Effective confidence

When the recall ranking reads a fact's confidence, it doesn't use the raw stored value. It calls `effectiveConfidence(fact, now, halfLife)`:

```
effective = confidence × 0.5 ^ (elapsedDays / halfLife)
```

`elapsedDays` is measured from `fact.lastReinforced` (or `extractedAt` as a fallback for older facts created before the flag was wired). At one half-life, effective confidence is half raw. At two half-lives, a quarter.

This is the value that ranks facts in `mem.recall()` and in the recall tool's intrinsic semantic score. A year-old fact at confidence `0.8` ranks well below a freshly-reinforced fact at the same `0.8`.

### Cull floor

The janitor's confidence-decay pass also removes facts whose effective confidence has dropped below `cullFloor` (default `0.1`). This keeps the store from growing without bound — once a fact's signal-to-noise has decayed past usefulness, the storage cost stops being worth it.

If you'd rather decay without ever culling, set `cullFloor: 0` — facts will rank lower over time but stay in the store.

### Episodic TTL

Persistent episodes have two thresholds. By default the janitor culls when either fires (`operator: 'OR'`):

- More than `persistentTurns` turns since the episode occurred (default 500)
- More than `persistentDays` days since the episode was encoded (default 90)

Permanent episodes are sacrosanct. The janitor never deletes them. After `permanentStaleDays` of silence (default 180) it sets `stale: true` on them so operators can see what's gone quiet.

## Default behavior

If you call `memory.system()` with no `hygiene:` field, you get the default configuration:

```ts
{
  confidenceDecay: { halfLife: 180, cullFloor: 0.1 },
  episodicTTL: {
    persistentTurns: 500,
    persistentDays: 90,
    operator: 'OR',
    permanentStaleDays: 180,
  },
  schedule: 'onConsolidation',
}
```

The 180-day half-life is conservative on purpose. Many systems pick aggressive half-lives (a week, a month). The default here is slow enough that you can leave the feature on without seeing surprising behavior in the first weeks. If you want sharper decay, drop the half-life.

## Configuration

Pass `hygiene` on the `memory.system()` call. Every field has a default; partial overrides are merged.

```ts
import { system } from '@flow-state-dev/memory'

const mem = system({
  model: 'openai/gpt-5.4-mini',
  working: true,
  episodic: true,
  semantic: true,
  hygiene: {
    confidenceDecay: { halfLife: 60, cullFloor: 0.05 },
    episodicTTL: { persistentDays: 30 },
    schedule: 'onConsolidation',
  },
})
```

### `confidenceDecay`

| Field | Default | Description |
|-------|---------|-------------|
| `halfLife` | `180` | Days for effective confidence to drop to half. Must be `> 0`. |
| `cullFloor` | `0.1` | Effective confidence below this is removed. `0` disables culling. |

Set `confidenceDecay: false` to skip the semantic branch entirely. Recall ranking then uses raw `fact.confidence`.

### `episodicTTL`

| Field | Default | Description |
|-------|---------|-------------|
| `persistentTurns` | `500` | Turn-count threshold for culling persistent episodes |
| `persistentDays` | `90` | Wall-time threshold for culling persistent episodes |
| `operator` | `'OR'` | `'OR'` culls when either fires; `'AND'` requires both |
| `permanentStaleDays` | `180` | Days of silence before a permanent episode is marked `stale` |

Set `episodicTTL: false` to skip the episodic branch entirely.

### `schedule`

When the janitor runs.

| Value | Behavior |
|-------|----------|
| `'onConsolidation'` (default) | Appended to the consolidation chain; runs whenever consolidation runs |
| `'onCapture'` | Runs every turn as a `.work()` step. Rarely worth the cost. |
| `'manual'` | Never auto-wired. Invoke `mem.janitor` directly. |

## Calling the janitor directly

For custom scheduling — a nightly cron, a Vercel cron route, a teardown step — use `mem.janitor` with `schedule: 'manual'`:

```ts
const mem = system({
  model: 'openai/gpt-5.4-mini',
  working: true,
  episodic: true,
  semantic: true,
  hygiene: { schedule: 'manual' },
})

// Inside a flow or scheduled handler:
const cleanup = sequencer({ name: 'cleanup', inputSchema: z.any() })
  .step(mem.janitor!)
```

## Operator visibility

Each janitor run writes a snapshot to the session-scoped `janitor` resource (`mem.janitorResource`):

- `lastRunTurn` — turn number of the most recent run
- `lastRunAt` — ISO timestamp of the most recent run
- `totalRuns` — cumulative count
- `lastCulledFactIds` — fact IDs culled on the most recent run
- `lastCulledEpisodeIds` — episode IDs culled on the most recent run
- `lastMarkedStaleEpisodeIds` — episode IDs newly flagged as stale

Inspect via DevTool or the resource registry. The arrays are a snapshot, not a history — each run overwrites them.

## Disabling hygiene

To revert entirely to pre-hygiene behavior, pass `hygiene: false`:

```ts
const mem = system({
  model: 'openai/gpt-5.4-mini',
  working: true,
  episodic: true,
  semantic: true,
  hygiene: false,
})
```

Recall ranking falls back to raw `fact.confidence`, no janitor is built, and stores grow without bound.

## Relationship to prune

The semantic store has two complementary maintenance steps:

- **Janitor** — deterministic, no LLM. Decays confidence and removes facts past the floor. Cheap, runs on consolidation.
- **Prune** — LLM-driven, optional, gated by `pruneThreshold`. Reviews surviving facts for contradictions and redundancy.

The order is: consolidate → janitor → prune. The janitor evicts the obviously stale before the prune step burns LLM cycles deciding whether to merge or remove them.
