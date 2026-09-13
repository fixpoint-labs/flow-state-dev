/**
 * The built-in `agent` flow kind — the worker a team gets without writing one.
 *
 * A worker file that names no `flow:` is hired into this kind, and its body
 * arrives as `instructions`. That is the whole out-of-the-box promise: it
 * talks, and it can reach whatever skills the app handed over.
 *
 * **It is a factory, not a flow constant.** `defineAgentKind()` called with no
 * arguments *is* the built-in; the same call with arguments is how an app
 * replaces it. A finished flow value could not carry the app's tool catalog or
 * its skills, which would force a second configuration door onto the hire step
 * — see the contract's C1 in `docs/architecture/workforce-agent-kind.md`.
 *
 * The three options are the three things only the app can supply: the tool
 * catalog, the skills to seed, and a default model. Every knob that is not one
 * of those belongs to a replacement kind, registered under `agent` by the
 * caller, which wins for every seat.
 */

import { defineFlow, generator, sequencer } from "@flow-state-dev/core";
import type { GeneratorTool, InitialSkill, ToolCatalog } from "@flow-state-dev/core";
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
export interface AgentKindOptions {
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
}

/** What one worker of this kind configures, in its file. */
function settingsSchema(options: AgentKindOptions) {
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
              `Known tools: ${known.length > 0 ? known.map((k) => `"${k}"`).join(", ") : "(none — no catalog was passed to defineAgentKind)"}. ` +
              `Pass it as \`defineAgentKind({ catalog: { "${name}": <tool> } })\`, or drop it from this worker.`
          });
        }
      }),

    /** The skills switches — contract C1's fourth bag item. */
    skills: z
      .object({
        /**
         * Turn on the up-front matcher's third tier — a model call that
         * classifies the message against the skill catalog. Slash matching
         * and keyword matching (tiers 1-2) always run, every turn, regardless
         * of this switch.
         *
         * **Default off**, which inverts `createSkillActivator`'s own default:
         * a zero-configuration worker must not spend an extra model call per
         * turn deciding whether a skill applies. Left off, skills are still
         * reachable — a slash or keyword hit still activates them, and the
         * generator carries the load tool for the rest.
         */
        enableLlmClassifier: z.boolean().default(false)
      })
      .default({})
  });
}

/**
 * Build an `agent` flow kind.
 *
 * Called with no arguments this returns the built-in — the kind a worker file
 * that names no `flow:` is hired into. Called with arguments it returns a
 * configured one; register it as `kinds: { agent: defineAgentKind({ ... }) }`
 * and it wins for every seat on the roster.
 *
 * Define once, hire many: call this at module scope or app bootstrap, never
 * per hire or per request.
 *
 * @param options The tool catalog, skills and default model only the app can supply.
 * @returns A `defineFlow` result of kind `agent`, cardinality `collection`.
 */
export function defineAgentKind(options: AgentKindOptions = {}) {
  const catalog = options.catalog ?? {};
  const settings = settingsSchema(options);
  const inputSchema = z.object({ message: z.string() });

  const skills = createSkillsLibrary({
    catalog,
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
    uses: [skillsBinding],
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
  // activators are built instead — both carry tiers 1-2 (slash, keyword);
  // only the second also carries tier 3 (the model classifier). The seat's
  // switch picks between them below with two mutually exclusive `.tapIf`
  // steps, so tiers 1-2 run on every turn regardless of the switch, and only
  // tier 3 is conditional.
  //
  // Built once per kind, not per seat — same as before.
  const matcherWithoutClassifier = createSkillActivator({
    enableLlmClassifier: false,
    activeState: ACTIVE_SKILLS_STATE,
    ...(options.skills ? { initialSkills: options.skills } : {})
  });
  const matcherWithClassifier = createSkillActivator({
    enableLlmClassifier: true,
    activeState: ACTIVE_SKILLS_STATE,
    ...(options.classifierModel ? { classifierModel: options.classifierModel } : {}),
    ...(options.confidenceThreshold !== undefined ? { confidenceThreshold: options.confidenceThreshold } : {}),
    ...(options.skills ? { initialSkills: options.skills } : {})
  });

  const run = sequencer({ name: "agent-run", inputSchema, flowConfigSchema: settings })
    .tapIf((_input, ctx) => ctx.flow.config.skills.enableLlmClassifier !== true, matcherWithoutClassifier)
    .tapIf((_input, ctx) => ctx.flow.config.skills.enableLlmClassifier === true, matcherWithClassifier)
    .step(answer);

  return defineFlow({
    kind: AGENT_KIND,
    // Required by contract C2. A plain singleton's seats mint and are then
    // refused at REGISTRATION, one by one — which is why the goal check for
    // this kind reaches the registry rather than stopping at the mint.
    cardinality: "collection",
    configSchema: settings,
    actions: { run: { inputSchema, block: run } }
  });
}
