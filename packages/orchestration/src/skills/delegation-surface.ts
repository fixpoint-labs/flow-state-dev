/**
 * Runtime delegation surface for agent-declaring skills (FIX-918).
 *
 * `createSkillsLibrary`'s config resolver is pure and synchronous, but the
 * tool surface it returns may be an **async function** the generator resolves
 * at execution start with its full `BlockContext`. This module is that
 * function's body: it materializes the delegation tools for every bound
 * agent-declaring skill — statically `active` ones and runtime activations
 * read from the binding's activation location.
 *
 * Delegation is **board-commanded** — there are no per-agent host tools. What
 * the executive generator gets is exactly:
 *   - the eight **`taskTools`** (the board ledger — `addTask` with
 *     `assignee`/`deps`/`input`, etc.),
 *   - **`runBoard`** — a real `taskBoard(...).drain` over the generator's
 *     own-state board, so the skill assigns work as tasks and then executes the
 *     whole graph under concurrency and dependency gating in one call.
 *
 * The board's participant registry is built from the skill's `agents:` map:
 * each declared agent materializes into a board worker (inline `prompt`/
 * `prompt-ref` agents via `materializeWorker` threading the drain-board
 * `taskTools`; `agent-ref` agents via the library's `agentRegistry`/
 * `materializeAgent`). Nothing drains the board behind the model's back — the
 * skill assigns tasks, then calls `runBoard`.
 */

import { handler, sequencer } from "@flow-state-dev/core";
import type {
  AgentRegistry,
  AgentSpec,
  BlockDefinition,
  DefinedCapability,
  GeneratorTool,
  MaterializeAgentFn,
  SkillFile,
  ToolCatalog,
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
import { isValidAgentKey } from "./skill-md";
import { materializeWorker } from "./worker-materializer";
import { specsCollide } from "./internal/agent-key-reconcile";
import { resolveDelegationBuild } from "./internal/delegation-memo";
import {
  buildTaskToolsList,
  createTaskToolsCapability,
  defaultOwnStateResolver,
  DELEGATION_BOARD_FIELD,
  type WorkerRoster,
} from "./task-tools-capability";

/** Model-facing name of the board-drain tool. */
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

/**
 * Reserved worker key for the on-demand default worker — the delegation floor
 * (FIX-940). Its leading underscore puts it (and the derived block name
 * `skillWorker_delegation___floor__`) out of reach of any declared agent or
 * skill — see `isValidAgentKey` in `skill-md.ts` for the rules and why they are
 * load-bearing. Used as the `materializeWorker` agent key; the floor is passed
 * as the board's `defaultWorker`, not registered in the participant registry.
 */
export const FLOOR_WORKER_KEY = "__floor__";

/** Skill-name scope for the floor's synthesised block name (see FLOOR_WORKER_KEY). */
const FLOOR_SKILL_NAME = "delegation";

/**
 * Synthetic baseline system prompt for the default worker. Generic and
 * capable, with no identity or tools — the floor is the same kind of
 * worker a declared inline agent is (FIX-641 later swaps this for an
 * identity-bearing spec on the same `materializeWorker` seam).
 *
 * Exported so the out-of-CI goal check drives the floor on the prompt that
 * actually ships rather than a copy that could drift from it.
 */
export const DEFAULT_WORKER_PROMPT = [
  "You are a capable, careful generalist worker on a delegation team.",
  "You are handed one task at a time: read its goal, any input payload, and any upstream",
  "results, then do the work and return a complete, self-contained result for that task.",
  "Stay within the task's scope; don't ask follow-up questions — make a reasonable decision",
  "and state any assumptions in your answer.",
].join(" ");

/** Materialize the default worker (the floor) from the synthetic baseline spec. */
function materializeFloor(deps: DelegationSurfaceDeps): Promise<BlockDefinition> {
  return materializeWorker(
    FLOOR_WORKER_KEY,
    { prompt: DEFAULT_WORKER_PROMPT },
    {
      catalog: deps.catalog,
      skillName: FLOOR_SKILL_NAME,
      // No tools, no identity. Model resolution reuses the existing chain:
      // the library's `workerModelId` (deps.defaultModelId), then the
      // neutral fallback inside materializeWorker — no new model knob.
      ...(deps.defaultModelId !== undefined ? { defaultModelId: deps.defaultModelId } : {}),
    },
  );
}

/** One bound agent-declaring skill, from either the static or runtime path. */
export interface DelegationAgentSource {
  skillName: string;
  agents: Record<string, AgentSpec>;
  /** Bundled files (build-time skills) — lets `prompt-ref` resolve without a collection read. */
  files?: SkillFile[];
  /** Activation input for `$ARGUMENTS` substitution (runtime activations only). */
  input?: string;
}

/** Everything the surface needs, closed over by the library's config resolver. */
export interface DelegationSurfaceDeps {
  catalog: ToolCatalog;
  agentRegistry?: AgentRegistry;
  materializeAgent?: MaterializeAgentFn;
  capabilityCatalog?: Record<string, DefinedCapability>;
  defaultModelId?: string;
  /** Resource registry key of the skills collection (for prompt-ref reads). */
  collectionKey: string;
  /** Where this binding's runtime activations live. */
  location: ActivationLocation;
  /** Statically-`active` agent skills, resolved from the bundled index at build time. */
  staticSources: DelegationAgentSource[];
  /**
   * Bundled agent specs by skill name — lets a runtime activation of a
   * bundled skill materialize without a manifest read.
   */
  bundledAgentIndex: Map<string, Pick<DelegationAgentSource, "agents" | "files">>;
  /** Restrict runtime lookups to these names (the binding's `allowed` list). */
  allowedNames?: string[];
  /** Whether this binding has a runtime activation path at all. */
  dynamicEligible: boolean;
  /**
   * Keep the delegation surface alive with an **empty** roster (FIX-940).
   * Set when the binding opts the floor in explicitly (`delegation: true`)
   * with no declared `agents:`, so a rosterless skill still installs the
   * board + taskTools + runBoard, its only worker being the default floor.
   * When false, an empty roster short-circuits to nothing, exactly as
   * before. The floor itself is wired as the board's fallback whenever the
   * surface builds (roster or rosterless) — this flag governs only whether
   * an empty roster is still buildable.
   */
  allowEmptyRoster: boolean;
}

// ---------------------------------------------------------------------------
// Agent-skill collection (static ∪ runtime)
// ---------------------------------------------------------------------------

/**
 * Collect every agent-declaring skill bound to this generator right now:
 * the static `active` set plus runtime activations at the binding's location.
 * Runtime names resolve agent specs from the bundled index first, then the
 * live manifest (a skill imported after seeding). Deduped by skill name —
 * static wins.
 */
/** True when the skill's live manifest carries `disable-model-invocation`. */
async function isManifestDisabled(
  collection: ResourceCollectionRef,
  skillName: string,
): Promise<boolean> {
  const manifest = await collection.getOptional(skillManifestKey(skillName));
  return (
    (manifest?.state as { disableModelInvocation?: boolean } | undefined)
      ?.disableModelInvocation === true
  );
}

export async function collectAgentSources(
  ctx: BlockContext,
  deps: DelegationSurfaceDeps,
): Promise<DelegationAgentSource[]> {
  const collection = getCollection(ctx, deps.collectionKey);

  // Honor a live `disable-model-invocation` on a statically-bound skill. The
  // body renderer reads the live manifest and suppresses a disabled skill even
  // when it's force-bound via `active`; the delegation surface must match, or a
  // skill disabled at runtime would still expose its agents via addTask/runBoard
  // (the build-time static filter can't see a post-seed edit). Skills with no
  // live manifest fall back to their build-time (bundled) truth.
  const sources: DelegationAgentSource[] = [];
  for (const s of deps.staticSources) {
    if (collection && (await isManifestDisabled(collection, s.skillName))) continue;
    sources.push(s);
  }
  if (!deps.dynamicEligible) return sources;

  const seen = new Set(sources.map((s) => s.skillName));
  for (const entry of readActivations(ctx, deps.location)) {
    if (seen.has(entry.name)) {
      // A skill preloaded via `active` AND loaded at runtime with an input arg:
      // the body reader lets the dynamic activation win so `$ARGUMENTS` renders
      // in the skill body. Mirror that here so the skill's agent prompts get the
      // same substitution instead of an empty one. Replace (don't mutate) the
      // shared static source so the input doesn't leak across resolver calls.
      if (entry.input !== undefined) {
        const i = sources.findIndex((s) => s.skillName === entry.name);
        if (i !== -1 && sources[i]!.input === undefined) {
          sources[i] = { ...sources[i]!, input: entry.input };
        }
      }
      continue;
    }
    if (deps.allowedNames && !deps.allowedNames.includes(entry.name)) continue;
    seen.add(entry.name);

    // Honor a live `disable-model-invocation` before the bundled shortcut too.
    // The static loop and the non-bundled runtime branch already drop disabled
    // skills; without this read the bundled branch would re-expose a bundled
    // skill (or a static skill also present in `activeState`) disabled mid-turn.
    // The memo snapshots this output, so the collector must be disable-correct
    // on all three paths or the cache would harden the leak (FIX-928, §7.1).
    if (collection && (await isManifestDisabled(collection, entry.name))) continue;

    const bundled = deps.bundledAgentIndex.get(entry.name);
    if (bundled) {
      sources.push({
        skillName: entry.name,
        agents: bundled.agents,
        ...(bundled.files ? { files: bundled.files } : {}),
        ...(entry.input !== undefined ? { input: entry.input } : {}),
      });
      continue;
    }

    // Not bundled — read the live manifest (imported/edited after seeding).
    if (!collection) continue;
    const manifest = await collection.getOptional(skillManifestKey(entry.name));
    const state = manifest?.state as
      | { agents?: Record<string, AgentSpec>; disableModelInvocation?: boolean }
      | undefined;
    if (state?.disableModelInvocation === true) continue;
    const agents = state?.agents;
    if (agents && Object.keys(agents).length > 0) {
      sources.push({
        skillName: entry.name,
        agents,
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
function withBundledPrompt(spec: AgentSpec, files: SkillFile[] | undefined): AgentSpec {
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
  boardWorkers: Record<string, BlockDefinition>,
  defaultWorker: BlockDefinition,
): GeneratorTool {
  const board = taskBoard({
    name: "delegation-board",
    collection: () => boardCollection(),
    workers: boardWorkers as never,
    // The floor: any task whose assignee is unknown or absent runs here
    // instead of erroring (FIX-940). Declared workers win their keys.
    defaultWorker: defaultWorker as never,
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
      // `blocked` counts as unresolved: a task parked pending an external
      // condition (or gated behind a failed dep) means the board did NOT fully
      // drain, so report `blocked` — not `drained` — or the coordinator treats
      // the plan as complete when work is still stuck.
      const unresolved = tasks.some(
        (t) =>
          t.status === "pending" ||
          t.status === "in_progress" ||
          t.status === "awaiting_review" ||
          t.status === "blocked",
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
  // the collection, and each agent's worker generator carries its own visibility.
  return sequencer({
    name: RUN_BOARD_TOOL_NAME,
    description:
      "Run your task board: executes every runnable task with its assigned agent — " +
      "independent tasks in parallel, dependency-gated tasks once their deps complete — " +
      "and returns the settled board with each task's output. Assign work first with addTask " +
      "(assignee optionally names one of your agents — leave it unset to use the default " +
      "worker; deps order them; input carries a payload), then call this once.",
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
 * Resolve the delegation build for this execution step. Re-walks eligibility
 * (`collectAgentSources`, including its live-manifest disable read) on every
 * call — that walk is never memoized — then hands the per-execution memo
 * (`internal/delegation-memo.ts`) the resolved sources plus a closure over
 * the actual build (`buildTools`/`buildGuidance`); the memo invokes the
 * closure only when the resolved source list has changed since the last
 * call for this execution. Both `buildDelegationTools` and
 * `buildDelegationGuidance` call this, so the roster is walked and built
 * once per snapshot and shared between them (D1).
 */
/**
 * Drop agent keys that could never have come through the SKILL.md parser, so
 * the roster the coordinator is TOLD about and the roster that becomes board
 * workers are the same list — one roster, not two.
 *
 * `parseAgentsField` rejects an illegal key on the authoring path, but
 * `collectAgentSources` also reads `agents` straight off a live skill manifest
 * whose state schema is `.passthrough()` and does not describe `agents`, so a
 * manifest written out-of-band never passed through the parser. An unfiltered
 * key would let a planted `__no_assignee__` shadow the absent-assignee sentinel
 * (unassigned tasks would run on it instead of the floor), `__floor__` collide
 * with the floor's own worker key, and `__proto__` hit the prototype setter
 * instead of creating an own key — silently emptying the registry.
 *
 * A source whose every key is rejected is dropped entirely, not left behind as
 * an empty husk: `sources.length === 0` is what makes `buildTools` contribute
 * no tools and `buildGuidance` contribute no roster, and those two must agree.
 * Filtering rather than throwing is deliberate — the key is unreachable through
 * every supported authoring path, so this is defense against a corrupt
 * manifest, and dropping the entry is what preserves the invariant.
 */
function validateAgentKeys(sources: DelegationAgentSource[]): {
  sources: DelegationAgentSource[];
  rejected: Array<{ skillName: string; key: string }>;
} {
  const rejected: Array<{ skillName: string; key: string }> = [];
  const validated: DelegationAgentSource[] = [];

  for (const source of sources) {
    const entries = Object.entries(source.agents);
    const legal = entries.filter(([key]) => isValidAgentKey(key));
    if (legal.length === entries.length) {
      validated.push(source);
      continue;
    }
    for (const [key] of entries) {
      if (!isValidAgentKey(key)) rejected.push({ skillName: source.skillName, key });
    }
    if (legal.length === 0) continue; // nothing survives — drop the source
    validated.push({ ...source, agents: Object.fromEntries(legal) });
  }

  return { sources: validated, rejected };
}

/**
 * Per-execution memo for the rejected-key diagnostic, deliberately SEPARATE
 * from the build memo in `internal/delegation-memo.ts`.
 *
 * "What to build" and "what to warn about" have different identities, and
 * modelling them as one is what made the diagnostic fragile twice over. Rejected
 * keys are filtered out *before* the board, tools and guidance are computed, so
 * they cannot change the built output — which cuts both ways:
 *
 *   - Folding them into the build snapshot would invalidate the board cache for
 *     a purely diagnostic change, trading FIX-928's build-once property for a
 *     log line.
 *   - But keying the diagnostic on the BUILD snapshot loses reports, because a
 *     roster that gains only an illegal key filters to an identical snapshot.
 *
 * So the diagnostic gets its own identity: the rejected set itself. Keyed on the
 * execution ctx exactly like the build memo, so it GCs with the execution and a
 * still-corrupt manifest re-reports on the next turn.
 */
const reportedRejections = new WeakMap<object, string>();

/**
 * Warn once per distinct rejected-key set per execution.
 *
 * The delimiters are U+0000 and U+0001, chosen because neither can occur in a
 * skill name or an agent key, so the fingerprint is injective. Write them as
 * unicode ESCAPES, never as literal control bytes: a literal NUL makes this
 * whole module classify as binary, at which point ripgrep reports only
 * "binary file matches" and every symbol in the file becomes ungreppable.
 */
function reportRejectedAgentKeys(
  ctx: object,
  rejected: ReadonlyArray<{ skillName: string; key: string }>,
): void {
  if (rejected.length === 0) return;
  const fingerprint = rejected
    .map(({ skillName, key }) => `${skillName}\u0000${key}`)
    .sort()
    .join("\u0001");
  if (reportedRejections.get(ctx) === fingerprint) return;
  reportedRejections.set(ctx, fingerprint);
  for (const { skillName, key } of rejected) {
    console.warn(
      `[skills] delegation agent key "${key}" (skill "${skillName}") is not a legal agent ` +
        `key (must match /^[a-z0-9][a-z0-9_-]*$/) — skipped. Underscore-led names are ` +
        `reserved by the delegation board.`,
    );
  }
}

async function resolveBuild(
  ctx: BlockContext,
  deps: DelegationSurfaceDeps,
): Promise<{ tools: GeneratorTool[]; guidance: string | null }> {
  const collected = await collectAgentSources(ctx, deps); // per-step eligibility (unchanged)
  // Validate BEFORE the memo so the snapshot keys on the roster that is actually
  // built, and both builders below see the identical list.
  const { sources, rejected } = validateAgentKeys(collected);
  // Reported on its own memo, outside the build closure: the build may legitimately
  // be cached when only the rejected set changed, and the report must still land.
  reportRejectedAgentKeys(ctx, rejected);
  return resolveDelegationBuild(ctx, sources, async () => {
    return {
      tools: await buildTools(ctx, deps, sources),
      guidance: buildGuidance(sources, deps.allowEmptyRoster),
    };
  });
}

/**
 * Build the delegation tool surface for one generator execution. Returns `[]`
 * when no bound skill declares agents. Memoized per execution via
 * `resolveDelegationBuild` — the tools materialize once per turn and are reused
 * across steps until the resolved source list changes.
 */
export async function buildDelegationTools(
  ctx: BlockContext,
  deps: DelegationSurfaceDeps,
): Promise<GeneratorTool[]> {
  return (await resolveBuild(ctx, deps)).tools;
}

/**
 * Materialize the board-only tool surface (the eight `taskTools` plus
 * `runBoard`, NO per-agent tool) from an already-resolved source list. Throws on
 * an agent that cannot materialize (bad ref, missing wiring) — a bound-but-broken
 * delegation skill must fail loud, not silently lose its team. A *runtime*
 * activation whose agent key collides with a divergent spill from another active
 * skill is skipped with a warning instead (a model-driven activation must not
 * crash the turn). Called when `sources.length > 0`, or when
 * `deps.allowEmptyRoster` (a rosterless `delegation: true` binding) — in which
 * case the roster is empty and the default floor is the board's only worker.
 */
async function buildTools(
  ctx: BlockContext,
  deps: DelegationSurfaceDeps,
  sources: DelegationAgentSource[],
): Promise<GeneratorTool[]> {
  // The board lives on the generator's own block state. The tools resolver
  // runs in the generator's own scope, so `ctx.self` IS that state ref — the
  // drain and the agents' board-bound taskTools close over it, which is what
  // lets nested blocks reach the executive's ledger without ctx walking.
  const self = (ctx as { self?: StateRef<Record<string, unknown>> }).self;
  if (!self || typeof self.atomicState !== "function") {
    console.warn(
      "[skills] delegation: host generator has no own state (board field not declared) — " +
        "delegation tools skipped",
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

  // The declared-agent roster assignment is validated against (FIX-924).
  // Filled in lockstep with `boardWorkers` in the loop below — same iteration,
  // same dedupe and collision decisions — so the set the tools accept and the
  // board's participant registry cannot drift apart. Read LAZILY: the roster
  // object is built here because `boardTaskTools` needs it before the loop
  // runs, but nothing calls `has`/`describe` until a tool executes, long after
  // the loop has filled the map.
  const rosterPurposes = new Map<string, string>();
  const roster: WorkerRoster = {
    has: (assignee) => rosterPurposes.has(assignee),
    describe: () =>
      [...rosterPurposes].map(([key, purpose]) => `${key} (${purpose})`).join(", "),
  };

  // Two task-tools shapes are deliberately both in play here: `buildTaskToolsList()`
  // below produces the flat, model-facing eight tools the executive sees, while
  // `createTaskToolsCapability(...)` closes over THIS board so an inline agent that
  // declares `tools: [taskTools]` fans out mid-drain onto the same ledger the drain
  // is watching. They are not redundant — one is the host surface, one is the
  // worker's board-bound capability (FIX-928, D4).
  //
  // The roster is passed unconditionally here: these tools only ever reach a
  // worker from inside the loop below, so by the time any of them executes at
  // least one agent is declared and the roster is non-empty.
  const boardTaskTools = createTaskToolsCapability(() => boardCollection(), roster);

  const staticNames = new Set(deps.staticSources.map((s) => s.skillName));
  const seenSpecs = new Map<string, AgentSpec>();
  const boardWorkers: Record<string, BlockDefinition> = {};

  // prompt-refs are pre-resolved for bundled skills; a missing collection
  // only matters for a non-bundled prompt-ref, which materializeWorker
  // reports precisely when it tries to read it.
  const collection: ResourceCollectionRef | undefined = getCollection(ctx, deps.collectionKey);

  for (const source of sources) {
    for (const [agentKey, spec] of Object.entries(source.agents)) {
      // Agent keys are already validated by `validateAgentKeys` in
      // `resolveBuild`, so this registry and the guidance roster are built from
      // the identical list.
      if (seenSpecs.has(agentKey)) {
        // Two skills sharing an agent key: an IDENTICAL spec dedupes into the
        // already-built board worker. A DIFFERENT spec under the same key is a
        // real collision — fail loud for static skills (build-time validation
        // mirrors this), warn + skip for a runtime activation so a model-driven
        // load can't crash the turn.
        if (!specsCollide(seenSpecs.get(agentKey)!, spec)) continue;
        if (!staticNames.has(source.skillName)) {
          console.warn(
            `[skills] delegation agent "${agentKey}" (runtime skill "${source.skillName}") ` +
              `declares a different spec than an already-registered agent under the same key — skipped`,
          );
          continue;
        }
        throw new Error(
          `skills: delegation agent "${agentKey}" (skill "${source.skillName}") declares a ` +
            `different spec than another active skill's agent under the same key. Rename the agent key.`,
        );
      }
      seenSpecs.set(agentKey, spec);

      const resolvedSpec = withBundledPrompt(spec, source.files);
      // Same key, same moment as the registry entry — see `rosterPurposes`.
      rosterPurposes.set(agentKey, agentPurpose(resolvedSpec, source.files));
      boardWorkers[agentKey] = await materializeWorker(agentKey, resolvedSpec, {
        catalog: deps.catalog,
        ...(deps.agentRegistry ? { agentRegistry: deps.agentRegistry } : {}),
        ...(deps.materializeAgent ? { materializeAgent: deps.materializeAgent } : {}),
        ...(deps.capabilityCatalog ? { capabilityCatalog: deps.capabilityCatalog } : {}),
        skillName: source.skillName,
        skillCollection: collection,
        ...(deps.defaultModelId !== undefined ? { defaultModelId: deps.defaultModelId } : {}),
        ...(source.input !== undefined ? { input: source.input } : {}),
        boardTaskTools,
      });
    }
  }

  // Empty roster: normally nothing to delegate to, so contribute no tools —
  // UNLESS the floor is on (`delegation: true`), where the default worker IS
  // the board and the surface must still install (FIX-940).
  if (Object.keys(boardWorkers).length === 0 && !deps.allowEmptyRoster) return [];

  // The floor is wired as the board's fallback whenever the surface builds —
  // roster+floor and rosterless alike (decision 3: unconditional when
  // delegation installs). Declared workers still win their keys.
  const defaultWorker = await materializeFloor(deps);

  return [
    // With declared agents, assignment is validated against them: an assignee
    // naming none of them is rejected at addTask instead of quietly landing on
    // the floor at drain time (FIX-924). A rosterless `delegation: true` board
    // has nothing to validate against, so it passes no roster and every task
    // runs on the floor exactly as before.
    ...(buildTaskToolsList(
      defaultOwnStateResolver,
      rosterPurposes.size > 0 ? roster : undefined,
    ) as GeneratorTool[]),
    buildRunBoardTool(boardCollection, boardWorkers, defaultWorker),
  ];
}

// ---------------------------------------------------------------------------
// Guidance — the delegation playbook + live roster
// ---------------------------------------------------------------------------

/** One-line agent purpose for the roster, derived from its declaration. */
export function agentPurpose(spec: AgentSpec, files?: SkillFile[]): string {
  if (spec.agentRef) return `agent \`${spec.agentRef}\``;
  const body = withBundledPrompt(spec, files).prompt;
  if (body) {
    const firstLine = body
      .split("\n")
      .map((l: string) => l.trim())
      .find(Boolean);
    if (firstLine) return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
  }
  return "a delegation agent";
}

/** The static delegation playbook, prefixed to the live agent roster. */
const DELEGATION_PLAYBOOK = [
  "You can delegate work to a team of agents. You have a private task board and the task tools.",
  "Assign work as tasks: addTask each unit (assignee optionally names one of your agents — leave it",
  "unset to use a capable default worker; deps name the task ids that must finish",
  "first; input carries a structured payload), then call runBoard once. The board runs your workers —",
  "independent tasks in parallel, dependency-gated tasks once their deps complete —",
  "and returns each task's result. Synthesize the results into your own answer.",
].join(" ");

/**
 * Roster advisory. Says how to reach the default worker (leave the assignee
 * unset) and that a misnamed one is refused — the copy must match the gate in
 * `checkAssignee`, or the coordinator is told it can do something addTask will
 * reject.
 */
const FLOOR_ADVISORY_WITH_ROSTER =
  "A capable default worker handles any task you leave unassigned. An assignee that does not name " +
  "one of your agents is rejected when you add the task, so name an agent exactly or leave it unset.";

/**
 * Rosterless advisory (a `delegation: true` board with no declared agents).
 * There is no roster to validate against, so assignment is unvalidated and
 * every task lands on the floor.
 */
const FLOOR_ADVISORY_ROSTERLESS =
  "A capable default worker handles every task on this board — leave each task's assignee unset.";

/**
 * Build the roster text from an already-resolved source list. Returns `null`
 * (contributes nothing) when no bound skill declares agents AND the floor is
 * off. With the floor on but an empty roster (rosterless `delegation: true`),
 * the guidance leads with the floor rather than an empty "Your agents:" list;
 * a floor advisory is appended in both roster states (FIX-940, decision 5) — but a
 * different one each way, since only a roster-carrying board validates assignment (FIX-924).
 */
function buildGuidance(sources: DelegationAgentSource[], allowEmptyRoster: boolean): string | null {
  if (sources.length === 0 && !allowEmptyRoster) return null;
  // Dedupe by agent key — two skills sharing an agent list it once,
  // mirroring the board's participant registry.
  const roster = new Map<string, string>();
  for (const source of sources) {
    for (const [key, spec] of Object.entries(source.agents)) {
      if (!roster.has(key)) roster.set(key, `- ${key}: ${agentPurpose(spec, source.files)}`);
    }
  }
  if (roster.size === 0) {
    // Rosterless: no "Your agents:" list — the floor is the whole team.
    return `${DELEGATION_PLAYBOOK}\n\n${FLOOR_ADVISORY_ROSTERLESS}`;
  }
  return `${DELEGATION_PLAYBOOK}\n\nYour agents:\n${[...roster.values()].join("\n")}\n\n${FLOOR_ADVISORY_WITH_ROSTER}`;
}

/**
 * Build the delegation guidance context entry — a function resolved at render
 * time so the roster reflects runtime activations, not just the static set.
 * Shares the per-execution memo with the tools resolver (D1), so the roster is
 * walked and built once per snapshot rather than independently every step.
 * Returns `null` (contributes nothing) when no bound skill declares agents.
 */
export function buildDelegationGuidance(deps: DelegationSurfaceDeps) {
  return async (_input: unknown, ctx: BlockContext): Promise<string | null> =>
    (await resolveBuild(ctx, deps)).guidance;
}
