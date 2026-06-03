/**
 * Default `PatternRegistry` for pattern skills.
 *
 * Each entry adapts a kebab-case `pattern-config` block declared in
 * `SKILL.md` frontmatter into the corresponding TypeScript factory
 * config. Adapters materialize worker generators via
 * `materializeWorker` from `@flow-state-dev/skills` and forward
 * everything else to the underlying pattern factory.
 *
 * Out of scope: `responseAuditor` and `rlm` (not task-collection-shaped)
 * stay code-only. `event-actors` and `approval-gate` ship as throwing
 * stubs so YAML authored against the schema stays forward-compatible.
 */

import { z } from "zod";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import type { PatternBinding, WorkerSpec } from "@flow-state-dev/core";
import {
  createPatternRegistry,
  materializeWorker,
  type MaterializedPattern,
  type PatternFactory,
  type PatternRegistry,
  type PatternRegistryDeps,
} from "@flow-state-dev/skills";
import type { TaskInit, TaskWorker, TaskWorkerRegistry } from "@flow-state-dev/tasks";
import { taskBoard } from "./task-board";
import { planAndExecute } from "./plan-and-execute";
import { supervisor } from "./supervisor";
import { parallelTasks } from "./parallelTasks";
import { routedSpecialists, createWorkspace } from "./routedSpecialists";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Map kebab-case patternConfig keys to camelCase. */
function kebabToCamelObj(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k.replace(/-([a-z0-9])/g, (_, c) => (c as string).toUpperCase())] = v;
  }
  return out;
}

/** Build a TaskWorker registry from a binding's workers map. */
async function buildWorkerRegistry(
  binding: PatternBinding,
  deps: PatternRegistryDeps,
): Promise<TaskWorkerRegistry> {
  const out: TaskWorkerRegistry = {};
  for (const [key, spec] of Object.entries(binding.workers)) {
    out[key] = (await materializeWorker(key, spec, deps)) as TaskWorker;
  }
  return out;
}

/** Convert a binding's initialTasks into substrate `TaskInit` records. */
function toTaskInits(binding: PatternBinding): TaskInit[] {
  return (binding.initialTasks ?? []).map((t) => {
    const init: TaskInit = { goal: t.goal };
    if (t.id !== undefined) init.id = t.id;
    if (t.assignee !== undefined) init.assignee = t.assignee;
    if (t.deps !== undefined) init.deps = t.deps;
    if (t.priority !== undefined) init.priority = t.priority;
    if (t.maxAttempts !== undefined) init.maxAttempts = t.maxAttempts;
    if (t.metadata !== undefined) init.metadata = t.metadata;
    return init;
  });
}

/** Box a non-task-board block as a MaterializedPattern. The collectionId
 *  matches the convention task-board uses so the active-skill metadata
 *  stays consistent across patterns. */
function wrapAsResult(block: unknown, deps: PatternRegistryDeps): MaterializedPattern {
  return {
    block: block as BlockDefinition,
    collectionId: deps.collectionId,
    backing: "request",
  };
}

function expectOnlyOneWorker(
  binding: PatternBinding,
  pattern: string,
): [string, WorkerSpec] {
  const entries = Object.entries(binding.workers);
  if (entries.length !== 1) {
    throw new Error(
      `Pattern '${pattern}' expects exactly one worker — got ${entries.length}`,
    );
  }
  return entries[0]!;
}

// ---------------------------------------------------------------------------
// Per-pattern config schemas + adapters
// ---------------------------------------------------------------------------

const taskBoardConfigSchema = z
  .object({
    concurrency: z.number().int().positive().optional(),
    dispatcher: z.enum(["fifo", "topological", "priority"]).optional(),
    "on-idle": z.enum(["complete", "wait"]).optional(),
    "on-error": z.enum(["skip", "fail"]).optional(),
    "max-iterations": z.number().int().positive().optional(),
    "idle-poll-ms": z.number().int().nonnegative().optional(),
  })
  .strict();

const taskBoardFactory: PatternFactory = {
  key: "task-board",
  configSchema: taskBoardConfigSchema,
  async fromConfig(binding, deps) {
    if (!binding.initialTasks || binding.initialTasks.length === 0) {
      throw new Error(
        `task-board pattern requires at least one entry in \`initial-tasks:\``,
      );
    }
    const workers = await buildWorkerRegistry(binding, deps);
    const scope = binding.collection?.scope ?? "request";
    if (scope === "session") {
      throw new Error(
        `task-board pattern: \`collection: { scope: session }\` requires a wired-in resource collection; ` +
          `session-scoped skill task boards are not supported in Wave 1`,
      );
    }
    const cfg = kebabToCamelObj(binding.patternConfig ?? {});
    const handle = taskBoard({
      name: `skill_${deps.skillName}`,
      collection: {
        backing: "request",
        collectionId: deps.collectionId,
        stateKey: deps.collectionId,
      },
      workers,
      initialTasks: toTaskInits(binding),
      ...cfg,
    });
    return {
      block: handle.block as unknown as BlockDefinition,
      collectionId: deps.collectionId,
      backing: "request",
    };
  },
};

const planAndExecuteConfigSchema = z
  .object({
    "max-concurrency": z.number().int().positive().optional(),
    "max-iterations": z.number().int().positive().optional(),
    "max-attempts-per-task": z.number().int().positive().optional(),
    "enable-replanning": z.boolean().optional(),
    model: z.string().optional(),
  })
  .strict();

const planAndExecuteFactory: PatternFactory = {
  key: "plan-and-execute",
  configSchema: planAndExecuteConfigSchema,
  async fromConfig(binding, deps) {
    const [workerKey, spec] = expectOnlyOneWorker(binding, "plan-and-execute");
    const stepExecutor = await materializeWorker(workerKey, spec, deps);
    const cfg = kebabToCamelObj(binding.patternConfig ?? {});
    const block = planAndExecute({
      name: `skill_${deps.skillName}`,
      stepExecutor,
      ...cfg,
    });
    return wrapAsResult(block, deps);
  },
};

const supervisorConfigSchema = z
  .object({
    "max-concurrency": z.number().int().positive().optional(),
    "max-attempts-per-task": z.number().int().positive().optional(),
    "on-sub-task-error": z.enum(["skip", "fail", "retry"]).optional(),
    "review-criteria": z.array(z.string()).optional(),
  })
  .strict();

const supervisorFactory: PatternFactory = {
  key: "supervisor",
  configSchema: supervisorConfigSchema,
  async fromConfig(binding, deps) {
    const workers = await buildWorkerRegistry(binding, deps);
    const cfg = kebabToCamelObj(binding.patternConfig ?? {});
    const entries = Object.entries(workers);
    if (entries.length === 0) {
      throw new Error(`supervisor pattern: at least one worker required`);
    }
    // Auto-extract a 'reviewer' worker when present so the supervisor's
    // dedicated reviewer slot is honored; otherwise leave the default
    // reviewer wiring in place.
    const reviewerEntry = workers["reviewer"];
    const workerRegistry = { ...workers };
    if (reviewerEntry) delete workerRegistry["reviewer"];

    const remaining = Object.entries(workerRegistry);
    if (remaining.length === 0) {
      throw new Error(
        `supervisor pattern: must declare at least one non-'reviewer' worker`,
      );
    }
    const block =
      remaining.length === 1
        ? supervisor({
            name: `skill_${deps.skillName}`,
            worker: remaining[0]![1],
            ...(reviewerEntry ? { reviewer: reviewerEntry } : {}),
            ...cfg,
          })
        : supervisor({
            name: `skill_${deps.skillName}`,
            workers: workerRegistry,
            ...(reviewerEntry ? { reviewer: reviewerEntry } : {}),
            ...cfg,
          });
    return wrapAsResult(block, deps);
  },
};

const parallelTasksConfigSchema = z
  .object({
    "max-concurrency": z.number().int().positive().optional(),
    "on-sub-task-error": z.enum(["skip", "fail", "retry"]).optional(),
  })
  .strict();

const parallelTasksFactory: PatternFactory = {
  key: "parallel-tasks",
  configSchema: parallelTasksConfigSchema,
  async fromConfig(binding, deps) {
    const [workerKey, spec] = expectOnlyOneWorker(binding, "parallel-tasks");
    const worker = await materializeWorker(workerKey, spec, deps);
    const cfg = kebabToCamelObj(binding.patternConfig ?? {});
    const block = parallelTasks({
      name: `skill_${deps.skillName}`,
      worker,
      ...cfg,
    });
    return wrapAsResult(block, deps);
  },
};

const coordinatorFactory: PatternFactory = {
  key: "coordinator",
  configSchema: parallelTasksConfigSchema,
  async fromConfig(binding, deps, ctx) {
    console.warn(
      `[flow-state-dev] pattern skill '${deps.skillName}': 'coordinator' is a deprecated alias for 'parallel-tasks'`,
    );
    return parallelTasksFactory.fromConfig(binding, deps, ctx);
  },
};

const routedSpecialistsConfigSchema = z
  .object({
    "max-iterations": z.number().int().positive().optional(),
    "max-history": z.number().int().positive().optional(),
  })
  .strict();

const routedSpecialistsFactory: PatternFactory = {
  key: "routed-specialists",
  configSchema: routedSpecialistsConfigSchema,
  async fromConfig(binding, deps) {
    const specialists = await buildWorkerRegistry(binding, deps);
    const cfg = kebabToCamelObj(binding.patternConfig ?? {});
    const workspace = createWorkspace(z.record(z.string(), z.unknown()).default({}));
    const block = routedSpecialists({
      name: `skill_${deps.skillName}`,
      workspace,
      specialists,
      ...cfg,
    });
    return wrapAsResult(block, deps);
  },
};

const eventActorsFactory: PatternFactory = {
  key: "event-actors",
  configSchema: z.object({}).strict(),
  async fromConfig() {
    throw new Error(
      "event-actors requires per-actor watch glob patterns; declaring an event-actors " +
        "pattern from SKILL.md frontmatter is a Wave 2 feature — use a code-side factory in Wave 1",
    );
  },
};

const approvalGateFactory: PatternFactory = {
  key: "approval-gate",
  configSchema: z.object({}).strict(),
  async fromConfig() {
    throw new Error("approval-gate is a Wave 2 pattern; not yet available");
  },
};

// ---------------------------------------------------------------------------
// Registry export
// ---------------------------------------------------------------------------

/**
 * Default `PatternRegistry` shipped from `@flow-state-dev/patterns`.
 * Apps wire it via `createSkillsCapability({ patternRegistry: defaultPatternRegistry })`.
 *
 * Wave 1 entries: `task-board`, `plan-and-execute`, `supervisor`,
 * `parallel-tasks`, `coordinator` (alias), `routed-specialists`.
 * Stubs: `event-actors`, `approval-gate`.
 */
export const defaultPatternRegistry: PatternRegistry = createPatternRegistry([
  taskBoardFactory,
  planAndExecuteFactory,
  supervisorFactory,
  parallelTasksFactory,
  coordinatorFactory,
  routedSpecialistsFactory,
  eventActorsFactory,
  approvalGateFactory,
]);
