---
title: Memory hygiene
type: catalog
description: "Keep a long-lived store useful: old and stale memories lose out."
---

# Memory hygiene

Long-lived agents accumulate state. Stable facts pile up. Episodes from a year ago sit next to episodes from this morning. Without hygiene, a fact extracted at high confidence yesterday and an equally confident fact from eighteen months ago rank identically when you call `recall()`, and the store only grows. The longer the agent runs, the less useful it gets.

Hygiene is the maintenance pass that keeps that from happening. It is on by default whenever memory has a semantic or episodic tier. The pass runs as a block called the janitor (`mem.janitor`), it is deterministic, and it makes no model calls. By default it runs after consolidation, not every turn; see [When it runs](#when-it-runs).

Each episode is classified when it is recorded, as either *persistent* or *permanent*, and a record with no classification counts as persistent. Persistent episodes can age out. Permanent ones are never deleted. The [memory overview](./index.md) covers the tiers. Each pass does the following:

- **Decays confidence.** Each semantic fact has an *effective confidence*: its stored score, decayed by the time since the fact was last reinforced. Facts that fall below a floor are removed.
- **Ages out episodes.** Persistent episodes past a turn-count or age threshold are deleted. Permanent episodes are never deleted. After a long time they get a `stale: true` marker instead.
- **Drops dangling relation edges.** When [relations](./relations.md) are on, edges whose endpoint fact was removed go with it.

## When it runs

By default (`schedule: "onConsolidation"`) the janitor runs as part of consolidation, after new facts are written. Consolidation starts after 5 new episodes, at most once every 4 turns, or when persistent items are evicted from working memory. A short conversation with two or three new episodes never triggers it, so no cleanup happens. In an app with an episodic tier and no semantic tier there is no consolidation, so the janitor runs on each capture instead.

`schedule: "onCapture"` runs it on every capture, every turn, which is rarely worth it. `schedule: "manual"` runs it only when you call it; [Run it yourself](#run-it-yourself) shows how.

## What happens to a fact from eighteen months ago

Recall ranks facts by effective confidence:

```text
effective = confidence × 0.5 ^ (elapsedDays / halfLife)
```

`elapsedDays` counts from the fact's last reinforcement, or from `extractedAt` when a fact has never been reinforced. With the default `halfLife` of 180 days, effective confidence is half the stored value after 180 days and a quarter after 360. Reinforcing a fact restarts its clock. The stored `confidence` never changes; the decayed value is computed when it is needed.

Take a fact that nothing has reinforced for 548 days, about eighteen months. At the default settings its factor is 0.12. Stored at `0.8`, it is at about `0.097`, below the default cull floor of `0.1`, so the next pass removes it. Stored at `0.9`, it is at about `0.109`, so it is kept and ranks at roughly an eighth of a freshly reinforced fact. A removed fact is gone; the janitor keeps no copy.

To decay without ever removing a fact, set `cullFloor: 0`. Facts then rank lower over time and remain in the store. For sharper decay, lower `halfLife`.

## What happens to an episode

A persistent episode is deleted once it passes either threshold: 500 turns or 90 days, whichever comes first. The days are counted from when the episode was recorded. Turn counts reset each session, so an episode from an earlier session ages out on the day threshold alone.

The janitor never deletes a permanent episode. 180 days after it was recorded, it gets `stale: true`. Nothing else changes about it.

Hygiene does not touch working memory or digests, and it does not check whether a fact is true. Contradictions and redundancy are the job of prune, a separate optional step that uses a model; see the [memory reference](../../reference/memory.md).

## Change it

Pass `hygiene` on `system()`. Every field has a default, and a partial object is merged onto them.

```ts title="src/lib/memory.ts"
import { system } from "@flow-state-dev/memory";

export const mem = system({
  model: "openai/gpt-6-luna",
  working: true,
  episodic: true,
  semantic: true,
  hygiene: {
    confidenceDecay: { halfLife: 60, cullFloor: 0.05 },
    episodicTTL: { persistentDays: 30 },
  },
});
```

That config halves a fact's weight every 60 days, culls below `0.05`, and deletes persistent episodes after 30 days. The turn threshold, `permanentStaleDays` and the schedule keep their defaults. The [memory reference](../../reference/memory.md) lists every field, its default, and the `schedule` values.

To turn one half off, set `confidenceDecay: false` or `episodicTTL: false`. To turn hygiene off, pass `hygiene: false`. Recall then ranks on raw `fact.confidence`, no janitor is built, and the stores grow without bound.

## Run it yourself

To clean up on your own schedule, such as a nightly cron, a cron route or a teardown step, whatever happens in a conversation, set `hygiene: { schedule: "manual" }` in `src/lib/memory.ts`. The janitor then runs only when you run it. `mem.janitor` is a block that takes any input and returns nothing, so it can be a step in a sequencer:

```ts title="src/flows/support/blocks/cleanup.ts"
import { sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { mem } from "../../../lib/memory";

export const cleanup = sequencer({
  name: "cleanup",
  inputSchema: z.any(),
}).step(mem.janitor!);
```

`mem.janitor` is typed as optional, because it does not exist when hygiene is off.

## See what it did

Each run writes a snapshot to the session's `janitor` resource (`mem.janitorResource`). Read it in DevTool or the resource registry.

| Field | Meaning |
|-------|---------|
| `lastRunTurn` | Turn number of the most recent run |
| `lastRunAt` | ISO timestamp of the most recent run |
| `totalRuns` | Runs in this session |
| `lastCulledFactIds` | Fact IDs removed on the most recent run |
| `lastCulledEpisodeIds` | Episode IDs deleted on the most recent run |
| `lastMarkedStaleEpisodeIds` | Episode IDs newly marked stale |

It records IDs only, never the removed text. Each run overwrites the arrays, so it is a snapshot, not a history. Facts and episodes are shared across a user's sessions, but this record lives in the session that ran the pass. A different session shows an empty snapshot.

## Relationship to prune

Facts the janitor removes never reach prune, so prune's model calls cover only the facts that remain. With the default schedule the order is consolidate, janitor, prune.
