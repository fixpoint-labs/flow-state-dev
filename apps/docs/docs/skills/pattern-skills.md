---
sidebar_position: 4
---

# Pattern skills

A pattern skill activates a team. Workers are declared in frontmatter, tasks are seeded, and a registered pattern (task board, supervisor, plan-and-execute, etc.) runs them. There's no code per skill — the same registry handles every pattern.

Reach for this when a single agent isn't the right shape: parallel research, fan-out / fan-in synthesis, a planner with one worker, a coordinator with several. The declarative path covers the common cases; tools cover the rest.

## A minimal pattern skill

```yaml
---
description: Multi-angle research on a company. Use when the user asks for a deep dive.
keywords: [research, company]
argument-hint: <company name>

pattern: task-board
workers:
  market-analyst:
    prompt-ref: ./reference/market.md
    tools: [search, fetch]
  financial-analyst:
    prompt-ref: ./reference/financials.md
    tools: [search, fetch]
  synthesizer:
    prompt-ref: ./reference/synthesis.md
    visibility: primary

initial-tasks:
  - id: market
    goal: Analyze market positioning of $ARGUMENTS
    assignee: market-analyst
  - id: financials
    goal: Analyze financial health of $ARGUMENTS
    assignee: financial-analyst
  - id: synth
    goal: Synthesize the prior reports into a single brief for $ARGUMENTS
    assignee: synthesizer
    deps: [market, financials]

pattern-config:
  concurrency: 2
  dispatcher: topological
  on-idle: complete
---

When the user asks for company research, the active workers run on a task board.
```

Activating this skill spawns a `TaskCollection`, materializes three worker generators (two analyst sub-agents and a primary synthesizer), seeds three tasks, and runs the board. `<TaskPlan />` renders progress live.

## Frontmatter fields

| Field | Purpose |
|-------|---------|
| `pattern` | Registry key. Defaults shipped: `task-board`, `plan-and-execute`, `supervisor`, `parallel-tasks`, `coordinator` (deprecated alias for `parallel-tasks`), `routed-specialists`. |
| `collection` | Optional. `{ scope: "request" }` (default) or `{ scope: "session" }`. Session-scoped collections require a wired-in resource collection; the default registry supports request scope only. |
| `workers` | Map of worker key → spec. Keys match `/^[a-z0-9][a-z0-9_-]*$/`. |
| `initial-tasks` | List of tasks seeded into the board at activation. Assignees must match a worker key; deps must reference another initial-task id and form a DAG. Ids auto-generate when omitted. |
| `pattern-config` | Verbatim kebab-case config forwarded to the pattern factory. The factory's schema rejects unknown keys at parse time. |

`context: pattern` is set automatically when `pattern:` is present. It's mutually exclusive with `context: inline` and `context: fork`.

## Worker resolution

Each worker has exactly one of four resolution fields. Parse fails with a precise message naming the worker if zero, two, or more are set.

| Field | Behavior |
|-------|---------|
| `prompt` | Inline body. `$ARGUMENTS` substituted at activation. |
| `prompt-ref` | Path to a Markdown file inside the skill folder. Loaded at activation; missing files surface as a clear activation error. |
| `block-ref` | Registry key into the optional `BlockRegistry` passed to `createSkillsCapability`. Use when a worker needs custom code beyond what a prompt expresses. Unknown refs fail at activation. |
| `agent-ref` | Name of a registered agent (from `@flow-state-dev/workforce`). The worker is staffed by that agent's persona, model, and tools. Requires an `agentRegistry` on `createSkillsCapability`. See [Agents](../orchestration/agents). |

Per-worker tuning:

- `tools` — catalog keys the worker can invoke. Unknown keys warn and drop (additive-not-restrictive).
- `visibility` — `sub` (default), `primary` (output reaches conversation history), or `trace` (observability only). Also accepts a mapping: `visibility: { client: true, history: false }`.
- `model` — model id override. Falls back to the capability's default.

`agent-overrides` is a sibling object on `agent-ref` workers — `tools`, `model`, `visibility`. Each field REPLACES the agent's default; no merging. `agent-overrides` requires `agent-ref` and fails at parse otherwise.

## The `taskTools` capability

Workers can call eight runtime tools to mutate the active board. Opt a worker in by adding `taskTools` to that worker's own `tools:` list — `materializeWorker` installs the capability only when the worker's `tools` array contains it. Listing `taskTools` in the skill's top-level `allowed-tools` does not install it on the pattern workers.

| Tool | Purpose |
|------|---------|
| `addTask` | Enqueue a new task. Returns the new id. |
| `assignTask` | Reassign a task to a different worker. |
| `completeTask` | Mark a task complete with its output. |
| `failTask` | Mark a task failed. |
| `blockTask` / `cancelTask` | Block (pending external condition) or cancel (terminal). |
| `updateTask` | Patch priority, metadata, assignee, or labels. |
| `listTasks` | Filter by status or assignee. |

With no pattern active every tool returns `{ ok: false, error: "no_active_pattern" }` rather than throwing. Agents recover gracefully.

### Dynamic task creation

The most common use of `taskTools` is dynamic fan-out: a discoverer worker identifies N items from a search, enqueues one analyzer task per item, then enqueues a synthesizer task with `deps` covering every analyzer it just queued. The synthesizer doesn't start until every dependency completes — the dispatcher (`topological`) honors that.

```yaml
workers:
  discoverer:
    prompt-ref: ./reference/discover.md
    tools: [search, taskTools]   # taskTools is shorthand for the eight-tool capability
  analyzer:
    prompt-ref: ./reference/analyze.md
    tools: [search, fetch]
  synthesizer:
    prompt-ref: ./reference/synthesize.md
    visibility: primary

initial-tasks:
  - id: discover
    goal: Find competitors of $ARGUMENTS, then queue one analyzer per competitor plus a synthesizer that depends on them all.
    assignee: discoverer
```

The discoverer's prompt instructs it to:

1. Call `addTask({ goal: "...", assignee: "analyzer" })` once per item, collecting each returned `taskId`.
2. Call `addTask({ goal: "...", assignee: "synthesizer", deps: [collectedIds] })` once with the deps array.
3. Return a short summary.

The user sees the synthesizer's output. Kitchen-sink's `competitor-analysis` skill is a working example.

## Wiring

Pattern skills are off by default. Pass the registry when constructing the skills capability:

```ts
import { createSkillsCapability } from "@flow-state-dev/orchestration";
import { defaultPatternRegistry } from "@flow-state-dev/patterns";

export const skillsCap = createSkillsCapability({
  catalog: { /* ... */ },
  initialSkills,
  patternRegistry: defaultPatternRegistry,
});
```

`taskTools` composes by default whenever `patternRegistry` is supplied. Pass `taskTools: false` to opt out — declarative dispatch still works without the runtime mutation surface.

To register a custom pattern, use `createPatternRegistry`:

```ts
import { createPatternRegistry } from "@flow-state-dev/orchestration";
import { z } from "zod";

const myPattern = {
  key: "my-pattern",
  configSchema: z.object({ concurrency: z.number().optional() }).strict(),
  async fromConfig(binding, deps) {
    // Materialize workers, build the runnable block, return { block, collectionId, backing }.
  },
};

const registry = createPatternRegistry([myPattern, ...defaultPatternRegistry.list()]);
```

## Pattern catalog

The default registry ships eight entries. Six are functional, one is a deprecation alias, and two are reserved stubs that throw clear deferral errors.

| Key | Status | Notes |
|-----|--------|-------|
| `task-board` | Functional | Concurrent drain with topological dispatch. Workers run in parallel up to `concurrency`. |
| `plan-and-execute` | Functional | Single worker, replan loop. Use `enable-replanning: true` to activate the evaluator path. |
| `supervisor` | Functional | One or more workers with optional reviewer (worker keyed `reviewer` is auto-extracted into the supervisor's reviewer slot). |
| `parallel-tasks` | Functional | Single worker, fan-out / fan-in. |
| `coordinator` | Functional (alias) | Deprecated alias for `parallel-tasks`. Triggers a runtime warning. |
| `routed-specialists` | Functional | Several workers with a shared workspace resource (auto-constructed). |
| `event-actors` | Stub | Watch-glob actors don't fit the YAML worker shape. Code-side factory only in Wave 1. |
| `approval-gate` | Stub | Reserved for a forthcoming pattern. Throws on activation. |

## Pattern-config crosswalk

Each adapter accepts a kebab-case subset of its TypeScript config. Adapters reject unknown keys at parse time.

| YAML key | task-board | plan-and-execute | supervisor | parallel-tasks | routed-specialists |
|---|---|---|---|---|---|
| `concurrency` | ✓ | — | — | — | — |
| `max-concurrency` | — | ✓ | ✓ | ✓ | — |
| `dispatcher` | ✓ (`fifo` \| `topological` \| `priority`) | — | — | — | — |
| `on-idle` | ✓ (`complete` \| `wait`) | — | — | — | — |
| `on-error` | ✓ (`skip` \| `fail`) | — | — | — | — |
| `on-sub-task-error` | — | — | ✓ | ✓ | — |
| `max-iterations` | ✓ | ✓ | — | — | ✓ |
| `max-attempts-per-task` | — | ✓ | ✓ | — | — |
| `enable-replanning` | — | ✓ | — | — | — |
| `review-criteria` | — | — | ✓ (`string[]`) | — | — |
| `idle-poll-ms` | ✓ | — | — | — | — |
| `model` | — | ✓ | — | — | — |
| `max-history` | — | — | — | — | ✓ |

## Authoring guidance

- **Keep teams small.** Three or four workers is plenty for most skills. Every added task delays the synthesizer (when there is one).
- **Use `prompt-ref` past ~200 characters.** Inline prompts in YAML get hard to read fast.
- **Mark the user-facing worker `primary`.** Other workers default to `sub`. The primary worker's output reaches conversation history; sub-workers stream for observability but stay out.
- **Make deps explicit.** A synthesizer that needs prior reports should declare `deps: [a, b]`. The substrate materializes upstream outputs into the synthesizer's input via `input.deps`.
- **Don't reach for `taskTools` first.** The declarative path is the easier read for skill consumers. Add tools only when the work genuinely needs mid-flow mutation.
