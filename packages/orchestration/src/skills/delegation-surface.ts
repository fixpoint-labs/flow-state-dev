/**
 * Runtime delegation surface for worker-declaring skills (FIX-918).
 *
 * `createSkillsLibrary`'s config resolver is pure and synchronous, but the
 * tool surface it returns may be an **async function** the generator resolves
 * at execution start with its full `BlockContext`. This module is that
 * function's body: it materializes the delegation tools for every bound
 * worker-declaring skill — statically `active` ones and runtime activations
 * read from the binding's activation location.
 *
 * What the executive generator gets:
 *   - one **direct-call tool per worker** (single-shot: call it, get the result),
 *   - the eight **`taskTools`** (the board ledger),
 *   - **`runBoard`** — a real `taskBoard(...).drain` over the generator's
 *     own-state board, so the skill itself plans tasks (`addTask` with
 *     `assignee`/`deps`/`input`) and then executes the whole graph under
 *     concurrency and dependency gating in one call. The skill runs the board;
 *     nothing drains it behind the model's back.
 *
 * Because workers materialize at runtime through the async
 * `materializeWorker`, every `WorkerSpec` shape is supported here — including
 * `agent-ref` (via the library's `agentRegistry`/`materializeAgent` options)
 * and `prompt-ref` files read from the live skill collection.
 */

import { handler, sequencer } from "@flow-state-dev/core";
import type {
  AgentRegistry,
  BlockDefinition,
  DefinedCapability,
  GeneratorTool,
  MaterializeAgentFn,
  SkillFile,
  ToolCatalog,
  WorkerSpec,
} from "@flow-state-dev/core";
import type {
  BlockContext,
  ResourceCollectionRef,
  StateRef,
} from "@flow-state-dev/core/types";
import { z } from "zod";
import { getOrCreateTaskCollection, taskStatusSchema } from "../tasks";
import type { TaskCollectionRef } from "../tasks";
import { taskBoard } from "../task-board";
import { readActivations, type ActivationLocation } from "./activation-store";
import { skillManifestKey } from "./collection";
import { getCollection } from "./internal/get-collection";
import { stripFrontmatter } from "./internal/strip-frontmatter";
import { materializeWorker } from "./worker-materializer";
import {
  buildTaskToolsList,
  createTaskToolsCapability,
  DELEGATION_BOARD_FIELD,
} from "./task-tools-capability";

/** Model-facing name of the board-drain tool. Reserved against worker keys. */
export const RUN_BOARD_TOOL_NAME = "runBoard";

/**
 * Change-stream visibility for the delegation board: the `task-change` items
 * drive the client's live plan UI but never re-enter the executive's LLM
 * history — the task tools' return values and `runBoard`'s settled summary
 * already carry that signal.
 */
export const DELEGATION_BOARD_VISIBILITY = { client: true, history: false } as const;

/** Board drain defaults — deliberate, not configurable until a consumer needs it. */
const BOARD_CONCURRENCY = 4;

/** One bound worker-declaring skill, from either the static or runtime path. */
export interface DelegationWorkerSource {
  skillName: string;
  workers: Record<string, WorkerSpec>;
  /** Bundled files (build-time skills) — lets `prompt-ref` resolve without a collection read. */
  files?: SkillFile[];
  /** Activation input for `$ARGUMENTS` substitution (runtime activations only). */
  input?: string;
}

/** Everything the surface needs, closed over by the library's config resolver. */
export interface DelegationSurfaceDeps {
  catalog: ToolCatalog;
  blocks?: Record<string, BlockDefinition>;
  agentRegistry?: AgentRegistry;
  materializeAgent?: MaterializeAgentFn;
  capabilityCatalog?: Record<string, DefinedCapability>;
  defaultModelId?: string;
  /** Resource registry key of the skills collection (for prompt-ref reads). */
  collectionKey: string;
  /** Where this binding's runtime activations live. */
  location: ActivationLocation;
  /** Statically-`active` worker skills, resolved from the bundled index at build time. */
  staticSources: DelegationWorkerSource[];
  /**
   * Bundled worker specs by skill name — lets a runtime activation of a
   * bundled skill materialize without a manifest read.
   */
  bundledWorkerIndex: Map<string, Pick<DelegationWorkerSource, "workers" | "files">>;
  /** Restrict runtime lookups to these names (the binding's `allowed` list). */
  allowedNames?: string[];
  /** Whether this binding has a runtime activation path at all. */
  dynamicEligible: boolean;
  /** Tool names workers must not collide with (taskTools, catalog keys, runBoard). */
  reservedToolNames: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// Worker-skill collection (static ∪ runtime)
// ---------------------------------------------------------------------------

/**
 * Collect every worker-declaring skill bound to this generator right now:
 * the static `active` set plus runtime activations at the binding's location.
 * Runtime names resolve worker specs from the bundled index first, then the
 * live manifest (a skill imported after seeding). Deduped by skill name —
 * static wins.
 */
export async function collectWorkerSources(
  ctx: BlockContext,
  deps: DelegationSurfaceDeps,
): Promise<DelegationWorkerSource[]> {
  const sources: DelegationWorkerSource[] = [...deps.staticSources];
  if (!deps.dynamicEligible) return sources;

  const seen = new Set(sources.map((s) => s.skillName));
  for (const entry of readActivations(ctx, deps.location)) {
    if (seen.has(entry.name)) continue;
    if (deps.allowedNames && !deps.allowedNames.includes(entry.name)) continue;
    seen.add(entry.name);

    const bundled = deps.bundledWorkerIndex.get(entry.name);
    if (bundled) {
      sources.push({
        skillName: entry.name,
        workers: bundled.workers,
        ...(bundled.files ? { files: bundled.files } : {}),
        ...(entry.input !== undefined ? { input: entry.input } : {}),
      });
      continue;
    }

    // Not bundled — read the live manifest (imported/edited after seeding).
    const collection = getCollection(ctx, deps.collectionKey);
    if (!collection) continue;
    const manifest = await collection.getOptional(skillManifestKey(entry.name));
    const workers = (manifest?.state as { workers?: Record<string, WorkerSpec> } | undefined)
      ?.workers;
    if (workers && Object.keys(workers).length > 0) {
      sources.push({
        skillName: entry.name,
        workers,
        ...(entry.input !== undefined ? { input: entry.input } : {}),
      });
    }
  }
  return sources;
}

// ---------------------------------------------------------------------------
// Prompt-ref pre-resolution from bundled files
// ---------------------------------------------------------------------------

/**
 * Inline a `prompt-ref` body from the skill's bundled files when present, so a
 * build-time skill never depends on collection seeding order. Falls through
 * unchanged (materializeWorker reads the live collection) when not bundled.
 */
function withBundledPrompt(spec: WorkerSpec, files: SkillFile[] | undefined): WorkerSpec {
  if (spec.promptRef === undefined || !files) return spec;
  const wanted = spec.promptRef.replace(/^\.\//, "").replace(/^\//, "");
  const file = files.find(
    (f) => f.path === wanted || f.path.replace(/^\.\//, "") === wanted,
  );
  if (!file) return spec;
  const { promptRef: _promptRef, ...rest } = spec;
  return { ...rest, prompt: stripFrontmatter(file.content) };
}

// ---------------------------------------------------------------------------
// runBoard — the drain tool over the executive's own-state board
// ---------------------------------------------------------------------------

const runBoardTaskSchema = z.object({
  id: z.string(),
  goal: z.string(),
  status: taskStatusSchema,
  assignee: z.string().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
});

const runBoardOutputSchema = z.object({
  /** `drained` — every task settled. `blocked` — unrunnable tasks remain (failed deps). */
  status: z.enum(["drained", "blocked"]),
  tasks: z.array(runBoardTaskSchema),
});

function buildRunBoardTool(
  boardCollection: () => Promise<TaskCollectionRef>,
  workers: Record<string, BlockDefinition>,
): GeneratorTool {
  const board = taskBoard({
    name: "delegation-board",
    collection: () => boardCollection(),
    workers: workers as never,
    concurrency: BOARD_CONCURRENCY,
    dispatcher: "topological",
    onIdle: "complete-or-blocked",
  });

  const settle = handler({
    name: "delegation-board-result",
    inputSchema: z.unknown(),
    outputSchema: runBoardOutputSchema,
    execute: async () => {
      const collection = await boardCollection();
      const tasks = collection.list();
      const unresolved = tasks.some(
        (t) => t.status === "pending" || t.status === "in_progress" || t.status === "awaiting_review",
      );
      return {
        status: unresolved ? ("blocked" as const) : ("drained" as const),
        tasks: tasks.map((t) => ({
          id: t.id,
          goal: t.goal,
          status: t.status,
          ...(t.assignee !== undefined ? { assignee: t.assignee } : {}),
          ...(t.output !== undefined ? { output: t.output } : {}),
          ...(t.error !== undefined ? { error: t.error } : {}),
        })),
      };
    },
  });

  // Note: no `itemVisibility` here — sequencers don't take one. The board's
  // `task-change` stream is already history-hidden via `changeVisibility` on
  // the collection, and each worker generator carries its own visibility.
  return sequencer({
    name: RUN_BOARD_TOOL_NAME,
    description:
      "Run your task board: executes every runnable task with its assigned worker — " +
      "independent tasks in parallel, dependency-gated tasks once their deps complete — " +
      "and returns the settled board with each task's output. Plan first with addTask " +
      "(assignee, deps, input), then call this once.",
    inputSchema: z.object({}),
    outputSchema: runBoardOutputSchema,
  })
    .step(board.drain)
    .step(settle) as unknown as GeneratorTool;
}

// ---------------------------------------------------------------------------
// The surface builder — invoked per generator execution
// ---------------------------------------------------------------------------

/**
 * Build the delegation tool surface for one generator execution. Returns `[]`
 * when no bound skill declares workers. Throws on a worker that cannot
 * materialize (bad ref, missing wiring) — a bound-but-broken delegation skill
 * must fail loud, not silently lose its workers. A *runtime* activation whose
 * worker key collides with an existing tool is skipped with a warning instead
 * (a model-driven activation must not crash the turn).
 */
export async function buildDelegationTools(
  ctx: BlockContext,
  deps: DelegationSurfaceDeps,
): Promise<GeneratorTool[]> {
  const sources = await collectWorkerSources(ctx, deps);
  if (sources.length === 0) return [];

  // The board lives on the generator's own block state. The tools resolver
  // runs in the generator's own scope, so `ctx.self` IS that state ref — the
  // drain and the workers' board-bound taskTools close over it, which is what
  // lets nested blocks reach the executive's ledger without ctx walking.
  const self = (ctx as { self?: StateRef<Record<string, unknown>> }).self;
  if (!self || typeof self.atomicState !== "function") {
    console.warn(
      "[skills] delegation: host generator has no own state (board field not declared) — " +
        "worker tools skipped",
    );
    return [];
  }

  const boardCollection = (): Promise<TaskCollectionRef> =>
    getOrCreateTaskCollection({
      backing: "sequencer",
      sequencer: self,
      stateKey: DELEGATION_BOARD_FIELD,
      collectionId: DELEGATION_BOARD_FIELD,
      ctx,
      changeVisibility: DELEGATION_BOARD_VISIBILITY,
    });

  // Workers that declare `tools: [taskTools]` resolve them against this same
  // board, so mid-drain fan-out (a worker enqueuing follow-up tasks) lands on
  // the ledger the drain is watching.
  const boardTaskTools = createTaskToolsCapability(() => boardCollection());

  const staticNames = new Set(deps.staticSources.map((s) => s.skillName));
  const seen = new Set<string>(deps.reservedToolNames);
  const directTools: GeneratorTool[] = [];
  const boardWorkers: Record<string, BlockDefinition> = {};

  for (const source of sources) {
    const collection =
      getCollection(ctx, deps.collectionKey) ??
      // prompt-refs are pre-resolved for bundled skills; a missing collection
      // only matters for a non-bundled prompt-ref, which materializeWorker
      // reports precisely when it tries to read it.
      (undefined as unknown as ResourceCollectionRef);
    for (const [workerKey, spec] of Object.entries(source.workers)) {
      if (seen.has(workerKey)) {
        if (!staticNames.has(source.skillName)) {
          console.warn(
            `[skills] delegation worker "${workerKey}" (runtime skill "${source.skillName}") ` +
              `collides with an existing tool name — skipped`,
          );
          continue;
        }
        throw new Error(
          `skills: delegation worker "${workerKey}" (skill "${source.skillName}") collides ` +
            `with an existing tool name (a taskTools handler, ${RUN_BOARD_TOOL_NAME}, a catalog ` +
            `tool, or another worker). Rename the worker key.`,
        );
      }
      seen.add(workerKey);

      const resolvedSpec = withBundledPrompt(spec, source.files);
      const materializeDeps = {
        catalog: deps.catalog,
        ...(deps.blocks ? { blocks: deps.blocks } : {}),
        ...(deps.agentRegistry ? { agentRegistry: deps.agentRegistry } : {}),
        ...(deps.materializeAgent ? { materializeAgent: deps.materializeAgent } : {}),
        ...(deps.capabilityCatalog ? { capabilityCatalog: deps.capabilityCatalog } : {}),
        skillName: source.skillName,
        skillCollection: collection,
        ...(deps.defaultModelId !== undefined ? { defaultModelId: deps.defaultModelId } : {}),
        ...(source.input !== undefined ? { input: source.input } : {}),
        boardTaskTools,
      };

      directTools.push(
        (await materializeWorker(workerKey, resolvedSpec, materializeDeps, {
          mode: "direct",
        })) as GeneratorTool,
      );
      boardWorkers[workerKey] = await materializeWorker(
        workerKey,
        resolvedSpec,
        materializeDeps,
        { mode: "board" },
      );
    }
  }

  if (directTools.length === 0) return [];

  return [
    ...(buildTaskToolsList() as GeneratorTool[]),
    ...directTools,
    buildRunBoardTool(boardCollection, boardWorkers),
  ];
}

// ---------------------------------------------------------------------------
// Guidance — the delegation playbook + live roster
// ---------------------------------------------------------------------------

/** One-line worker purpose for the roster, derived from its declaration. */
export function workerPurpose(spec: WorkerSpec, files?: SkillFile[]): string {
  if (spec.agentRef) return `agent \`${spec.agentRef}\``;
  if (spec.blockRef) return `block \`${spec.blockRef}\``;
  const body = withBundledPrompt(spec, files).prompt;
  if (body) {
    const firstLine = body
      .split("\n")
      .map((l: string) => l.trim())
      .find(Boolean);
    if (firstLine) return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
  }
  return "a delegated worker";
}

/** The static delegation playbook, prefixed to the live worker roster. */
const DELEGATION_PLAYBOOK = [
  "You can delegate work. You have a private task board, one tool per worker, and the task tools.",
  "For a single unit of work, call that worker's tool directly and use its result.",
  "For multi-step or parallel work, plan it on the board: addTask each unit (assignee names a",
  "worker; deps order them; input carries a structured payload), then call runBoard once —",
  "it executes every runnable task with its assigned worker, independent tasks in parallel,",
  "and returns each task's result. Synthesize the workers' results into your own answer.",
].join(" ");

/**
 * Build the delegation guidance context entry — a function resolved at render
 * time so the roster reflects runtime activations, not just the static set.
 * Returns `null` (contributes nothing) when no bound skill declares workers.
 */
export function buildDelegationGuidance(deps: DelegationSurfaceDeps) {
  return async (_input: unknown, ctx: BlockContext): Promise<string | null> => {
    const sources = await collectWorkerSources(ctx, deps);
    if (sources.length === 0) return null;
    const rosterLines = sources.flatMap((source) =>
      Object.entries(source.workers).map(
        ([key, spec]) => `- ${key}: ${workerPurpose(spec, source.files)}`,
      ),
    );
    return `${DELEGATION_PLAYBOOK}\n\nYour workers:\n${rosterLines.join("\n")}`;
  };
}
