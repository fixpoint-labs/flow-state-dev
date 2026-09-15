/**
 * The `agent` worker flow — the built-in worker kind, and the worker a team
 * gets without writing one. `agent` is one KIND of worker; this file is the
 * flow that kind resolves to, which is why the name carries both.
 *
 * A worker file that names no `flow:` is hired into this kind, and its body
 * arrives as `instructions`. That is the whole out-of-the-box promise: it
 * talks, and it can reach whatever skills the app handed over.
 *
 * **It is a factory, not a flow constant** — unlike `channelFlow` next door.
 * `defineAgentWorkerFlow()` called with no arguments *is* the built-in; the
 * same call with arguments is how an app replaces it. A finished flow value
 * could not carry the app's tool catalog or its skills, which would force a
 * second configuration door onto the hire step — see the contract's C1 in
 * `docs/architecture/workforce-agent-kind.md`.
 *
 * {@link AgentWorkerFlowOptions} is the single enumeration of what only the
 * app can supply — its tool catalog, its skills, and its model choices. The
 * fields are documented there and are deliberately not restated here.
 *
 * The rule that puts a knob on the app rather than on a worker: one that
 * cannot be honoured per worker must not be declared per worker. A knob that
 * is neither app-level nor a worker setting belongs to a replacement kind,
 * registered under `agent` by the caller, which wins for every seat.
 *
 * **A worker's `tools:` is a hard runtime fence**, not a hint: a seat may call
 * exactly the catalog keys it names, and an empty list means none, regardless
 * of what else the app's catalog carries. The skills library is handed the
 * app's catalog with registration turned off (`registerCatalogTools: false`),
 * so a bound skill's `allowed-tools` are still validated against it — a typo
 * or a tool the app never registered still fails loud at build time — but the
 * library never puts a catalog tool on the generator itself. The generator's
 * own `tools: names → catalog[name]` mapping below stays the only stock
 * tool-registration path, so a seat's `tools:` list is the one thing that
 * decides what it can call, no matter what `allowed-tools` a bound skill
 * declares.
 *
 * The one place that fence is upheld by convention rather than by the
 * framework is {@link AgentWorkerFlowOptions.uses}: the resolver unions a
 * capability's tools onto the generator's list instead of intersecting it
 * with the seat's, so an app passing a capability with default-on tools must
 * turn them off at the preset. FIX-1393 moves the intersection into
 * `@flow-state-dev/core`, at which point the convention stops mattering. The
 * rule itself does not change either way.
 */

import { defineFlow, generator, sequencer } from "@flow-state-dev/core";
import type { BlockDefinition, GeneratorTool, InitialSkill, ToolCatalog, UsesSlot } from "@flow-state-dev/core";
import { createSkillActivator, createSkillsLibrary } from "@flow-state-dev/orchestration";
import { z } from "zod";

/**
 * The kind name the hire step resolves a record to when it names none, and the
 * key an app registers its own flow under to replace this one.
 */
export const AGENT_KIND = "agent";

/**
 * The stock model, used when neither the app nor the worker names one.
 *
 * A **provider-neutral intent**, deliberately: a hard-coded `"<vendor>/<model>"`
 * would make the zero-configuration worker fail at run time — not at hire — for
 * any app whose resolver does not carry that provider, and the file that would
 * have to change is ours, not theirs. The app's own resolver picks the concrete
 * model. `createSkillActivator` establishes the same form with
 * `"intent/utility"`.
 */
const DEFAULT_MODEL = "intent/chat";

/**
 * Where up-front skill matching publishes its result, when a seat turns it on.
 *
 * Explicit rather than the generator's own block state because the matcher runs
 * *before* the generator and so cannot reach a downstream block's state — see
 * `SkillsBindingConfig.activeState`.
 */
const ACTIVE_SKILLS_STATE = { scope: "session", field: "activeSkills" } as const;

/**
 * The prompt seam, named so it is greppable when FIX-1344 part 2 lands.
 *
 * Today it is the worker's own instructions and nothing else. It is one
 * binding, not a helper — see the note at the generator's `prompt` slot.
 */
function composeWorkerPrompt(config: { instructions?: string }): string {
  return config.instructions ?? "";
}

/** What the app supplies. Everything else is a worker's own setting. */
export interface AgentWorkerFlowOptions {
  /**
   * The tools workers may name in their `tools:` setting, by key. A worker
   * naming a key this catalog does not carry is refused at the mint.
   *
   * Omitted, the built-in carries no tools at all — a tool is running code and
   * a file on disk can only carry its name, so only the app holds the map.
   */
  catalog?: ToolCatalog;
  /** Skills seeded into the library every seat of this kind reads. */
  skills?: InitialSkill[];
  /** Default model for workers that name none. Defaults to {@link DEFAULT_MODEL}. */
  model?: string;
  /**
   * Model the up-front matcher's third tier uses, when a seat opts in. Mirrors
   * `createSkillActivator`'s option of the same name.
   *
   * An app-level option rather than a worker setting because the matcher is
   * built once for the kind: a per-worker value could not be honoured, and a
   * setting that is silently ignored is the failure this kind's tool handling
   * exists to prevent.
   */
  classifierModel?: string;
  /** Confidence the matcher's third tier must reach. Mirrors `createSkillActivator`. */
  confidenceThreshold?: number;
  /**
   * Capabilities every worker of this kind carries, composed onto the answer
   * generator beside the skills library — which stays first and is never
   * displaced.
   *
   * Deliberately generic. This is the door an app composes memory through
   * (`uses: [mem.capability.presets({ ... })]`); it is not a memory option,
   * and this package knows nothing about memory. A capability's declared
   * resources reach the flow through the generator, so nothing else needs
   * declaring alongside it.
   *
   * **Tool-carrying presets are not fenced here.** The framework's resolver
   * unions a capability's tools onto the generator's own list rather than
   * intersecting it, so a preset that ships a tool reaches a worker whose
   * `tools:` is empty. Until that intersection lands in
   * `@flow-state-dev/core`, an app passing a capability with default-on tools
   * turns them off at the preset — see the README's memory recipe, which
   * turns off `recall` and `connect` for exactly this reason.
   */
  uses?: UsesSlot;
  /**
   * Give each worker of this kind its own user-scoped storage, instead of one
   * cell shared by every worker serving the same person. Default: false,
   * matching the framework (BP-027).
   *
   * Forwarded to the flow untouched. The key is the worker's id, so renaming
   * a worker leaves its isolated data behind under the old name.
   *
   * All-or-nothing for the kind: a roster is either all-isolated or
   * all-shared, never a mix.
   */
  isolateUserState?: boolean;
  /**
   * A block run after the worker answers, as a side-chain — it cannot change
   * the answer, and a failure in it does not fail the turn.
   *
   * The write-side door. Memory's capture pipeline goes here
   * (`afterAnswer: mem.captureFromItems`); without it a worker carrying
   * memory reads what something else stored and records nothing of its own.
   *
   * Omitted, the kind's sequence is exactly what it is today.
   */
  afterAnswer?: BlockDefinition<any, any>;
}

/** What one worker of this kind configures, in its file. */
function settingsSchema(options: AgentWorkerFlowOptions) {
  const catalog = options.catalog ?? {};

  return z.object({
    /**
     * The worker's instructions — its file body, or the frontmatter key.
     * Optional: a bodyless worker is a weak seat, not a failed hire.
     */
    instructions: z.string().optional(),

    model: z.string().default(options.model ?? DEFAULT_MODEL),

    /**
     * Tools this worker may use, by catalog key.
     *
     * Refused **at the mint**, by name, when the catalog does not carry the
     * key — including when there is no catalog at all, which is not a special
     * case. The refusal throws so it lands inside the hire step's collected
     * error with the worker's id in front of it.
     */
    tools: z
      .array(z.string())
      .default([])
      .superRefine((names, ctx) => {
        const known = Object.keys(catalog);
        for (const name of names) {
          if (Object.hasOwn(catalog, name)) continue;
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              `names tool "${name}", which the app's tool catalog does not carry. ` +
              `Known tools: ${known.length > 0 ? known.map((k) => `"${k}"`).join(", ") : "(none — no catalog was passed to defineAgentWorkerFlow)"}. ` +
              `Pass it as \`defineAgentWorkerFlow({ catalog: { "${name}": <tool> } })\`, or drop it from this worker.`
          });
        }
      }),

    /** The skills switches — contract C1's fourth bag item. */
    skills: z
      .object({
        /**
         * Turn on the up-front matcher's third tier — a model call that
         * classifies the message against the skill catalog. Slash matching
         * (tier 1) always runs, every turn, regardless of this switch. Keyword
         * matching (`createSkillActivator`'s tier 2) is not part of this
         * kind's contract at all — zero-LLM matching earns a second always-on
         * path only once we know we need one — so this kind's activator
         * pipeline never carries it, on either branch of this switch.
         *
         * **Default off**, which inverts `createSkillActivator`'s own default:
         * a zero-configuration worker must not spend an extra model call per
         * turn deciding whether a skill applies. Left off, skills are still
         * reachable — a slash hit still activates them, and the generator
         * carries the load tool for the rest.
         */
        enableLlmClassifier: z.boolean().default(false)
      })
      .default({})
  });
}

/**
 * Build a worker kind.
 *
 * Called with no arguments this returns the built-in — the kind a worker file
 * that names no `flow:` is hired into. Called with arguments it returns a
 * configured one; register it as `kinds: { agent: defineAgentWorkerFlow({ ... }) }`
 * and it wins for every seat on the roster.
 *
 * Define once, hire many: call this at module scope or app bootstrap, never
 * per hire or per request.
 *
 * @param options What only the app can supply — see {@link AgentWorkerFlowOptions}.
 * @returns A `defineFlow` result of kind `agent`, cardinality `collection`.
 */
export function defineAgentWorkerFlow(options: AgentWorkerFlowOptions = {}) {
  const catalog = options.catalog ?? {};
  const settings = settingsSchema(options);
  const inputSchema = z.object({ message: z.string() });

  // `catalog` is passed so a bound skill's declared `allowed-tools` are
  // validated against it (author feedback: a typo or an uncataloged tool
  // fails loud at build time) — but `registerCatalogTools: false` keeps the
  // library's own whole-catalog registration (see `skillsBinding` below) from
  // putting every app tool on the generator regardless of a seat's own
  // `tools:` setting. That registration path stays off; the generator's own
  // `tools:` slot below, fenced at the mint by the `tools` schema, is the
  // only stock tool-registration path.
  const skills = createSkillsLibrary({
    catalog,
    registerCatalogTools: false,
    ...(options.skills ? { initialSkills: options.skills } : {})
  });

  // Pinned by the contract (C5): the load-tool path, with `allowed` omitted so
  // the whole bundled catalog is reachable. Without it a seat would hold skills
  // it could never pull. `activeState` is explicit because the matcher below
  // runs BEFORE the generator and so cannot reach its block state.
  //
  // The cast is contained here on purpose: `createSkillsLibrary` declares its
  // return as a bare `DefinedCapability`, which erases the binding-config type,
  // so `.with()`'s typed surface admits only preset flags. Both keys below are
  // its own `bindingConfigSchema`'s and are validated at build time — the
  // erased return type is an upstream gap, not a looser contract here.
  const skillsBinding = skills.with({
    dynamicActivation: true,
    activeState: ACTIVE_SKILLS_STATE
  } as never);

  const answer = generator({
    name: "agent-answer",
    inputSchema,
    flowConfigSchema: settings,
    itemVisibility: { client: true, history: true },
    // The skills binding stays FIRST and is never displaced: an app's own
    // capabilities compose beside it. That is what the `uses` option is for.
    uses: [skillsBinding, ...(options.uses ?? [])],
    // The prompt seam — a MARKED INSERTION POINT, NOT AN ABSTRACTION.
    //
    // The shared default worker system prompt (FIX-1344 part 2) is not shipped.
    // Per contract C1 this kind consumes it and defines no second one, so today
    // the slot resolves to the worker's own instructions alone. When part 2
    // lands this becomes `[defaultWorkerPrompt, composeWorkerPrompt(...)]` and
    // nothing else moves. Do not grow it into a compose helper, a registry or a
    // type — if it ever needs more than this one binding, the seam should be
    // re-decided rather than widened.
    prompt: (_input, ctx) => composeWorkerPrompt(ctx.flow.config),
    model: (_input, ctx) => ctx.flow.config.model,
    tools: (_input, ctx): GeneratorTool[] =>
      ctx.flow.config.tools.map((name) => catalog[name] as GeneratorTool),
    user: (input) => input.message
  });

  // `createSkillActivator` takes `enableLlmClassifier` at construction, so
  // one instance can't honour a per-seat switch on tier 3 alone. Two full
  // activators are built instead — both carry tier 1 (slash) only, both with
  // tier 2 (keyword) turned off via `enableKeywordMatch: false`, since
  // keyword matching is not part of this kind's contract; only the second
  // also carries tier 3 (the model classifier). The seat's switch picks
  // between them below with two mutually exclusive `.tapIf` steps, so tier 1
  // runs on every turn regardless of the switch, tier 2 never runs on either
  // branch, and only tier 3 is conditional.
  //
  // Built once per kind, not per seat — same as before.
  const matcherWithoutClassifier = createSkillActivator({
    enableLlmClassifier: false,
    enableKeywordMatch: false,
    activeState: ACTIVE_SKILLS_STATE,
    ...(options.skills ? { initialSkills: options.skills } : {})
  });
  const matcherWithClassifier = createSkillActivator({
    enableLlmClassifier: true,
    enableKeywordMatch: false,
    activeState: ACTIVE_SKILLS_STATE,
    ...(options.classifierModel ? { classifierModel: options.classifierModel } : {}),
    ...(options.confidenceThreshold !== undefined ? { confidenceThreshold: options.confidenceThreshold } : {}),
    ...(options.skills ? { initialSkills: options.skills } : {})
  });

  const answered = sequencer({ name: "agent-run", inputSchema, flowConfigSchema: settings })
    .tapIf((_input, ctx) => ctx.flow.config.skills.enableLlmClassifier !== true, matcherWithoutClassifier)
    .tapIf((_input, ctx) => ctx.flow.config.skills.enableLlmClassifier === true, matcherWithClassifier)
    .step(answer);

  // Appended only when the app passed one, so a no-argument call still builds
  // the sequence it built before this option existed rather than one carrying
  // an inert extra step. `.sideChain` rather than `.step`: a post-answer block
  // must not be able to change the answer, and a failure inside it — a capture
  // call that times out, say — is not a conversation failure.
  const run = options.afterAnswer ? answered.sideChain(options.afterAnswer) : answered;

  return defineFlow({
    kind: AGENT_KIND,
    // Required by contract C2. A plain singleton's seats mint and are then
    // refused at REGISTRATION, one by one — which is why the goal check for
    // this kind reaches the registry rather than stopping at the mint.
    cardinality: "collection",
    // Each worker gets its own user-scoped cell when the app asks for one;
    // shared across the roster otherwise, which is the framework's default.
    isolateUserState: options.isolateUserState ?? false,
    configSchema: settings,
    actions: { run: { inputSchema, block: run } }
  });
}
