---
title: Worker usage
sidebar_position: 10
sidebar_label: Worker usage
description: "How many tokens each worker used for a user, by model and coding harness, per UTC day. Recorded on every worker flow with nothing to add, and read back with one query."
---

# Worker usage

Every request a worker runs spends something: model calls from its generators, and runs of any [coding agent](../tools/coding-agents.md) it drives. Workforce records that spend per user, per worker, per UTC day, and the `workerUsage` query reads it back over a period.

It is a record of usage, not a quota. Nothing here limits what a worker may spend. To limit the model tokens one request may spend, use an action's [`tokenBudget`](../configuration/flow.md#token-budgets) (harness runs aren't counted).

## What gets recorded

Every worker flow built on `installation.session()` with `installation.resources` in its `resources` records usage, including the flows `hireWorkforce` builds. A flow of your own needs only those two lines. `installation` is what `createWorkerInstallation` returns; see [Hiring the roster](./workers-on-disk.md#hiring-the-roster).

```ts
import { defineFlow } from "@flow-state-dev/core";
import { workerConfigSchema } from "@flow-state-dev/workforce";

const supportFlow = defineFlow({
  kind: "support",
  configSchema: workerConfigSchema(),
  session: installation.session(),
  resources: { ...installation.resources },
  actions: { respond: { /* ... */ } },
})();
```

When a request on that flow ends, however it ends, what it spent is added to the record for the session's worker and the day it ended on, in UTC:

- **Each model** the request called, with its input and output tokens.
- **Each coding harness** it ran, split by how the run was paid for (`api-key`, `subscription`, or not known), with the tokens the harness reported.

Records belong to the user who made the request. One user never reads another's.

A worker whose flow declares `installation.session()` but leaves `installation.resources` out of `resources` has nowhere to write. In development, a request on it that spent tokens fails, naming the missing collection. In production, the request goes on and a warning is logged.

A record that fails to write is logged, and the request is not failed. Two requests that end at the same moment for the same worker both land.

## Reading it back

Put `workerUsageAction(installation)` on one of your flows, under `WORKER_USAGE_ACTION` (`"workerUsage"`):

```ts
import { defineFlow } from "@flow-state-dev/core";
import { WORKER_USAGE_ACTION, workerUsageAction } from "@flow-state-dev/workforce";

const usageFlow = defineFlow({
  kind: "usage",
  resources: { ...installation.resources },
  actions: {
    [WORKER_USAGE_ACTION]: workerUsageAction(installation),
  },
})();
```

It takes `{ days?: number }`, 1 to 90, default 7. The period is today and the days before it, counted in UTC days, so `days: 1` is today since midnight UTC. It takes no user: it answers for whoever calls it. Its output looks like this:

```ts
{
  workers: [
    {
      worker: "engineering.lead",
      gone: false,
      tokens: { input: 1008, output: 208 },
      costUsd: 0.42,
      bySource: [
        { source: "claude-code", kind: "harness", billing: "api-key",
          inputTokens: 1000, outputTokens: 200, costUsd: 0.42, runs: 1, unreported: 0 },
        { source: "openai/gpt-6-luna", kind: "model", billing: null,
          inputTokens: 8, outputTokens: 8, costUsd: null, runs: 2, unreported: 0 },
      ],
    },
  ],
}
```

One row per worker that spent anything in the period, ordered by worker id. `tokens` adds up every source. `bySource` is ordered by source, then billing.

| Field | What it holds |
|---|---|
| `source` | A model id, or a harness name (`claude-code`, `codex`, `cursor`). |
| `kind` | `"model"` or `"harness"`. |
| `billing` | For a harness: `"api-key"`, `"subscription"`, or `null` when the harness couldn't tell. Always `null` for a model. |
| `inputTokens` / `outputTokens` | Tokens summed over the period. |
| `costUsd` | Dollars, or `null` (see below). |
| `runs` | For a harness, how many runs. For a model, how many requests called it; a request that pauses and resumes counts once for each time it ends. |
| `unreported` | Runs that ended without reporting any tokens. |

### Cost appears only where a harness reported one

`costUsd` is a number only for a harness run on an `api-key` whose harness reported a cost. Every other source, models and subscription runs included, carries `null`. Show `null` as "not reported", never as $0. The row's `costUsd` sums the sources that have one, and is `null` when none does.

What each harness reports is on [Coding agents](../tools/coding-agents.md#what-a-run-spent).

### A run that reported nothing

A harness run that ended before its agent sent any usage, such as one killed early, counts once in `runs` and once in `unreported`, and adds no tokens. Say so rather than showing 0 tokens: "1 of 3 runs reported no tokens".

### Workers that left the roster

A worker the user no longer has on their roster keeps its records. Its row comes back with `gone: true`.

Shift Manager's [Usage view](../shift-manager/overview.md) reads this query to show *Usage by worker*.
