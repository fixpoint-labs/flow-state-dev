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
 * **That fence has a second gate now the skills are the seat's own.** A skill a
 * seat holds can declare `agents:`, which installs the delegation surface and
 * seats BOARD WORKERS — separate generators — from the catalog. The generator's
 * `tools:` mapping cannot reach those, so the library is given a
 * `toolSeatFence` that narrows them to this seat's own `tools:` list. The fence
 * is the seat's, not the skill's: a seat with `tools: []` reaches nothing,
 * including through a worker it delegated to.
 */

import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import type { GeneratorTool, InitialSkill, ToolCatalog } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import {
  activeSkillsArraySchema,
  createSkillActivator,
  createSkillsLibrary,
  pushActiveSkill
} from "@flow-state-dev/orchestration";
import { z } from "zod";
import { SEAT_SKILLS_KEY } from "./manifest";

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

/**
 * The parts of a seat's settings bag this file reads off a running block's
 * context, where the bag's type is erased.
 *
 * Narrow on purpose — it exists so the two per-execution reads below are not
 * bare `any`, not to restate {@link settingsSchema}, which remains the one
 * definition of what a seat may declare.
 */
interface SeatConfig {
  tools: string[];
  seatSkills: InitialSkill[];
  skills: { active: string[]; activateTool: boolean; enableLlmClassifier: boolean };
}

/**
 * This seat's own skills, off its config — the per-execution read the whole
 * per-seat catalog hangs on.
 *
 * O(1) by construction: the array was resolved when the roster was read and is
 * carried on the bag. Nothing here may walk, parse or touch storage — it runs
 * before every step of every generator turn.
 *
 * Defensive `?? []` because the bag is erased at this point and a replacement
 * kind registered under `agent` could hand over a config without the key.
 */
function seatSkillsOf(ctx: BlockContext): InitialSkill[] {
  return (ctx.flow.config as Partial<SeatConfig> | undefined)?.seatSkills ?? [];
}

/**
 * Whether this seat turned the mid-turn activate tool on. The other erased read
 * — it picks which of the two answering generators runs, and the default is
 * off, so anything other than an explicit `true` takes the plain arm.
 */
function activateToolOn(ctx: BlockContext): boolean {
  return (ctx.flow.config as Partial<SeatConfig> | undefined)?.skills?.activateTool === true;
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
}

/**
 * One skill as it rides into the bag. Structural, not a second parser: the
 * loader has already parsed every `SKILL.md` that reaches here, so this checks
 * the SHAPE arrived intact (a hand-built roster is the case it catches) and
 * leaves the contents to the seeder, which parses them again where a parse
 * failure can be reported per skill.
 */
const seatSkillSchema = z
  .object({
    name: z.string().min(1),
    skillMd: z.string(),
    files: z
      .array(z.object({ path: z.string().min(1), content: z.string() }).strict())
      .optional()
  })
  .strict();

/** What one worker of this kind configures, in its file. */
function settingsSchema(options: AgentWorkerFlowOptions) {
  const catalog = options.catalog ?? {};
  const appSkillNames = new Set((options.skills ?? []).map((skill) => skill.name));

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

    /**
     * The seat's own skills — **imposed by the hire step, never authored.**
     *
     * The loader resolves the org ∪ team ∪ own-folder union per seat and hands
     * it over on the worker's record, exactly as a worker's body is handed over
     * as `instructions`. A `seatSkills:` in a worker file is refused by name at
     * both doors; see `manifest.ts`.
     *
     * Spelled `seatSkills` rather than `skills` because the bag already carries
     * an author-written `skills` object below.
     */
    [SEAT_SKILLS_KEY]: z
      .array(seatSkillSchema)
      .default([])
      .superRefine((seatSkills, ctx) => {
        // Both sources fill ONE catalog, so a bare name arriving from both has
        // no answer — the same rule the loader already applies across a seat's
        // three levels, rather than a second precedence story beside it.
        for (const skill of seatSkills) {
          if (!appSkillNames.has(skill.name)) continue;
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              `holds skill "${skill.name}" from its own folders, and ` +
              `defineAgentWorkerFlow({ skills }) carries a skill of the same name. ` +
              `They fill one catalog and there is no precedence rule — rename one, or drop one.`
          });
        }
      }),

    /** The skills switches — contract C1's fourth bag item. */
    skills: z
      .object({
        /**
         * Skills this worker always has in context, by name — its always-on
         * set, appended to whatever the up-front matcher resolved for the turn.
         *
         * **Default empty**, because being colocated with a worker makes a
         * skill *reachable*, not always-in-context: a folder dropped beside a
         * worker costs that worker nothing until someone types `/name`, turns
         * on the activate tool, or lists the skill here. A name the seat does
         * not hold is refused at the mint, listing what it does hold.
         */
        active: z.array(z.string()).default([]),

        /**
         * Let the model pull a held skill into context mid-turn, with a tool.
         *
         * **Default off.** Turning it on installs the load tool *and* a listing
         * of everything the seat holds, and that listing is a per-turn token
         * cost proportional to the catalog — which is exactly what a
         * zero-configuration worker must not be charged. Left off, a seat's
         * skills are still reachable by slash and by the always-on list.
         */
        activateTool: z.boolean().default(false),

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
         * reachable — a slash hit still activates them, and `active` and
         * `activateTool` above are the seat's other two doors.
         */
        enableLlmClassifier: z.boolean().default(false)
      })
      .default({})
  });
}

/**
 * Refuse an always-on name this seat does not hold, by name, listing what it
 * does hold.
 *
 * **Not at the mint, and not by choice.** `skills.active` and `seatSkills` are
 * two settings, so the check spans them — and a flow's `configSchema` must be a
 * plain `z.object`, because the framework closes undeclared keys on it and a
 * `.superRefine()` wrapper would make that impossible (`closeConfigSchema`,
 * `packages/core/src/flow/defineFlow.ts`). That refusal names the alternative
 * outright: *"a rule spanning two settings belongs in the block that reads
 * them."* This is that block — it is the one that reads `skills.active`.
 *
 * So the refusal lands on the seat's first turn instead of at boot. It is still
 * fatal, still names the skill, and still lists what the seat holds; what is
 * lost is the collected roster-wide report a mint-time refusal would have
 * joined.
 */
function assertHeldSkills(names: string[], held: InitialSkill[], appSkills: InitialSkill[]): void {
  if (names.length === 0) return;
  const heldNames = new Set([
    ...appSkills.map((skill) => skill.name),
    ...held.map((skill) => skill.name)
  ]);
  const missing = names.filter((name) => !heldNames.has(name));
  if (missing.length === 0) return;
  const heldList =
    heldNames.size > 0 ? [...heldNames].map((n) => `"${n}"`).join(", ") : "(none)";
  throw new Error(
    `This worker lists ${missing.map((n) => `"${n}"`).join(", ")} in \`skills.active\`, ` +
      `which it does not hold. It holds: ${heldList}. A skill reaches a worker from the org's, ` +
      `its team's, or its own \`skills/\` folder, or from \`defineAgentWorkerFlow({ skills })\`.`
  );
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

  const appSkills = options.skills ?? [];

  /**
   * What THIS seat's catalog is seeded from — the app's skills plus its own.
   *
   * Kept to an O(1) read of an already-resolved array, because it runs on every
   * render of every binding: before each step of the generator's tool loop, and
   * at the matcher's seed step. The union is only materialized when both halves
   * are non-empty, which is the uncommon case; a name in both is already
   * refused at the mint, so there is nothing to reconcile here.
   */
  const seatCatalog = (ctx: BlockContext): InitialSkill[] => {
    const seat = seatSkillsOf(ctx);
    if (seat.length === 0) return appSkills;
    if (appSkills.length === 0) return seat;
    return [...appSkills, ...seat];
  };

  // `catalog` is passed so a bound skill's declared `allowed-tools` are
  // validated against it (author feedback: a typo or an uncataloged tool
  // fails loud at build time) — but `registerCatalogTools: false` keeps the
  // library's own whole-catalog registration (see the bindings below) from
  // putting every app tool on the generator regardless of a seat's own
  // `tools:` setting. That registration path stays off; the generator's own
  // `tools:` slot below, fenced at the mint by the `tools` schema, is the
  // only stock tool-registration path.
  const skills = createSkillsLibrary({
    catalog,
    registerCatalogTools: false,
    // Per-execution rather than a fixed array: the catalog is the SEAT's, and
    // a block deliberately cannot see which instance it is, so the seat's own
    // set has to arrive on its config and be read from there.
    initialSkills: seatCatalog,
    // Every seat gets its own drawer. The storage layer keys an isolated
    // resource on the flow instance id, and a seat is minted with the worker's
    // id — so two seats' catalogs are two different buckets, with no second
    // collection key, prefix or scope. (A collection seeded before this was
    // switched on re-seeds from the new key; the old rows are orphaned, not
    // lost — BP-030.)
    collectionConfig: { flowIsolation: true },
    // The second half of the `tools:` fence. A skill a seat merely HOLDS can
    // declare `agents:`, and the delegation surface would otherwise seat board
    // workers — separate generators the `tools:` mapping below never sees —
    // from the app's whole catalog. The fence is the seat's own list, so a
    // seat with `tools: []` reaches nothing, delegated or not.
    toolSeatFence: (ctx) => (ctx.flow.config as Partial<SeatConfig>).tools ?? []
  });

  // Pinned by the contract (C5): the library plus a per-generator binding.
  // `activeState` is explicit because the matcher below runs BEFORE the
  // generator and so cannot reach its block state.
  //
  // TWO bindings, because `dynamicActivation` is a build-time preset and the
  // activate tool is a per-seat switch — the same shape, and the same reason,
  // as the two activators further down. The plain binding is what a
  // zero-configuration seat gets: the reader, and no tool and no catalog
  // listing. `allowed` is omitted on both, so when a seat does turn the tool
  // on it reaches everything it holds.
  //
  // ---------------------------------------------------------------------
  // BEFORE YOU SIMPLIFY THIS: the 2x2 is FORCED, and not from here.
  //
  // Two bindings x two activators x two generators is the widest thing in
  // this file, and it looks like over-engineering until you try to collapse
  // it. Both switches — `skills.activateTool` and
  // `skills.enableLlmClassifier` — are per SEAT, while both mechanisms that
  // implement them are fixed at CONSTRUCTION: `dynamicActivation` is a
  // preset resolved when `skills.with()` is bound, and
  // `enableLlmClassifier` is read by `createSkillActivator` when it builds
  // its pipeline. A kind is built once and hired many times, so neither can
  // see the seat, and building one of each and choosing at run time is the
  // only shape that honours a per-seat switch at all.
  //
  // The real fix is a RUNTIME toggle in `@flow-state-dev/orchestration` —
  // a binding whose load tool installs per execution, and an activator
  // whose classifier tier is conditional — at which point this collapses
  // to one binding, one activator and one generator. It is not a fix that
  // can be made in this file, and flattening the branching here without
  // that change means dropping one of the two switches.
  // ---------------------------------------------------------------------
  //
  // The cast is contained here on purpose: `createSkillsLibrary` declares its
  // return as a bare `DefinedCapability`, which erases the binding-config type,
  // so `.with()`'s typed surface admits only preset flags. Both keys below are
  // its own `bindingConfigSchema`'s and are validated at build time — the
  // erased return type is an upstream gap, not a looser contract here.
  const skillsBinding = skills.with({
    activeState: ACTIVE_SKILLS_STATE
  } as never);
  const skillsBindingWithActivateTool = skills.with({
    dynamicActivation: true,
    activeState: ACTIVE_SKILLS_STATE
  } as never);

  /**
   * The answering generator. Identity is all that varies between the two copies
   * — the binding and the name — so this is a factory, not a helper (BP-024).
   */
  const answerWith = (binding: ReturnType<typeof skills.with>, name: string) =>
    generator({
      name,
      inputSchema,
      flowConfigSchema: settings,
      itemVisibility: { client: true, history: true },
      uses: [binding],
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
        ctx.flow.config.tools.map((toolName) => catalog[toolName] as GeneratorTool),
      user: (input) => input.message
    });

  const answer = answerWith(skillsBinding, "agent-answer");
  const answerWithActivateTool = answerWith(
    skillsBindingWithActivateTool,
    "agent-answer-with-activate-tool"
  );

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
    initialSkills: seatCatalog
  });
  const matcherWithClassifier = createSkillActivator({
    enableLlmClassifier: true,
    enableKeywordMatch: false,
    activeState: ACTIVE_SKILLS_STATE,
    ...(options.classifierModel ? { classifierModel: options.classifierModel } : {}),
    ...(options.confidenceThreshold !== undefined ? { confidenceThreshold: options.confidenceThreshold } : {}),
    initialSkills: seatCatalog
  });

  /**
   * The seat's always-on skills, appended to whatever the matcher resolved.
   *
   * **After** the matcher, not inside it: the matcher's apply step REPLACES the
   * active set (per-turn semantics, by design), so defaults written before it
   * would be wiped every turn. Appending afterwards is idempotent — the shared
   * `pushActiveSkill` dedupes by name+mode — and costs one state write on a
   * seat that lists any, and nothing at all on one that does not.
   *
   * `mode: "inline"` is stamped rather than read off the persisted manifest,
   * matching the matcher's own apply step and for its reason: a pre-migration
   * record can still say `"pattern"`, which the binding reader would then skip.
   */
  const appendSeatDefaults = handler({
    name: "append-seat-default-skills",
    inputSchema,
    outputSchema: z.object({ added: z.number() }),
    flowConfigSchema: settings,
    sessionStateSchema: z.object({
      [ACTIVE_SKILLS_STATE.field]: activeSkillsArraySchema
    }),
    execute: async (_input, ctx) => {
      const names = ctx.flow.config.skills.active;
      // The cross-field refusal the mint could not carry — see the note there.
      assertHeldSkills(names, seatSkillsOf(ctx), appSkills);
      if (names.length === 0) return { added: 0 };
      const activatedAt = Date.now();
      // The REAL delta, not `names.length`. `pushActiveSkill` dedupes by
      // name+mode, so a default the matcher already activated this turn is not
      // an addition — and a count that reports the list's length instead would
      // be wrong exactly when a slash hit and an always-on name coincide, which
      // is the case most likely to be asserted on.
      let added = 0;
      await ctx.session.atomicState((current) => {
        const held = (current as Record<string, unknown> | undefined)?.[
          ACTIVE_SKILLS_STATE.field
        ];
        let entries = Array.isArray(held) ? held : [];
        const before = entries.length;
        for (const name of names) {
          entries = pushActiveSkill(entries, { name, mode: "inline", activatedAt });
        }
        // Reassigned rather than accumulated: `atomicState` may re-run its
        // mutator against fresher state, and a `+=` would then count the
        // discarded attempt too.
        added = entries.length - before;
        return { [ACTIVE_SKILLS_STATE.field]: entries };
      });
      return { added };
    }
  });

  const run = sequencer({ name: "agent-run", inputSchema, flowConfigSchema: settings })
    .tapIf((_input, ctx) => ctx.flow.config.skills.enableLlmClassifier !== true, matcherWithoutClassifier)
    .tapIf((_input, ctx) => ctx.flow.config.skills.enableLlmClassifier === true, matcherWithClassifier)
    .tap(appendSeatDefaults)
    // Two arms rather than two `.stepIf`s: the answer is the sequencer's OUTPUT,
    // and a second conditional step would have to be typed against the first
    // one's result. A branch says what this is — one answer, built two ways —
    // and the arms are exhaustive by negation, so the "no matching route"
    // throw is unreachable.
    .branch({
      plain: [(value) => value, (_value, ctx: BlockContext) => !activateToolOn(ctx), answer],
      withActivateTool: [
        (value) => value,
        (_value, ctx: BlockContext) => activateToolOn(ctx),
        answerWithActivateTool
      ]
    });

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
