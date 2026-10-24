/**
 * The `agent` worker flow — the built-in one, and the worker a team
 * gets without writing one. `agent` names the worker; this file is the
 * flow it runs on, which is why the name carries both.
 *
 * A worker file that names no `flow:` is hired into this worker flow, and its body
 * arrives as `instructions`. That is the whole out-of-the-box promise: it
 * talks, and it can reach whatever skills the app handed over.
 *
 * **It is a factory, not a flow constant.**
 * `defineAgentWorkerFlow()` called with no arguments *is* the built-in; the
 * same call with arguments is how an app replaces it. A finished flow value
 * could not carry the app's tool catalog or its skills, which would force a
 * second configuration door onto the hire step — see the contract's C1 in
 * `docs/architecture/workforce-default-worker-flow.md`.
 *
 * {@link AgentWorkerFlowOptions} is the single enumeration of what only the
 * app can supply — its tool catalog, its skills, and its model choices. The
 * fields are documented there and are deliberately not restated here.
 *
 * The rule that puts a knob on the app rather than on a worker: one that
 * cannot be honoured per worker must not be declared per worker. A knob that
 * is neither app-level nor a worker setting belongs to a replacement worker flow,
 * registered under `agent` by the caller, which wins for every worker.
 *
 * **What a worker can call is decided by its own file, in one of two ways.** A
 * worker that WRITES a `tools:` line gets exactly that list: a hard runtime
 * fence, not a hint. An empty list means none, regardless of what else the
 * app's catalog carries or what a capability attached through `uses` would
 * otherwise contribute (FIX-1393). A worker that writes NO `tools:` line gets
 * the tools of every capability preset its own file picked under
 * `capabilities:` — picking is the choice (FIX-1459). Presets the flow switches
 * on by default grant nothing a worker did not pick. The hire keeps an omitted
 * line omitted, never `[]`, so the two cases survive to the tools slot below;
 * either way the generator declares `tools:` and core's fence stays up. See
 * `docs/architecture/capabilities.md` → *The tools fence*. What the fence
 * deliberately does NOT hold back is a framework
 * **control** a capability declares through `controlTools` — the skill loader
 * this worker switched on. A worker only holds those because its own config asked,
 * and they are built
 * inside their capability and never exported, so no `tools:` list could name
 * one back in. The skills library is handed the
 * app's catalog with registration turned off (`registerCatalogTools: false`),
 * so a bound skill's `allowed-tools` are still validated against it — a typo
 * or a tool the app never registered still fails loud at build time — but the
 * library never puts a catalog tool on the generator itself. The generator's
 * own tools slot below stays the only stock tool-registration path, so a
 * worker's own file is the one thing that decides what it can call, no matter
 * what `allowed-tools` a bound skill declares.
 *
 * {@link AgentWorkerFlowOptions.uses} is fenced by the framework too
 * (FIX-1393): core drops a capability's catalog-granted tools when the block
 * declares `tools:`, and this flow declares it on every worker. Catalog tools a
 * capability contributes are therefore copied onto this flow's catalog at
 * construction, so a worker can name them in `tools:` the same way it names an
 * app-passed tool. An empty list still means none. A worker with no `tools:`
 * line gets a preset's tools by picking the preset, which the tools slot adds
 * itself. What the fence does not touch is a capability's `controlTools` — see
 * the paragraph above.
 */

import { defineFlow, generator, handler, sequencer, MANIFEST_DOMAINS } from "@flow-state-dev/core";
import { flattenCapabilities, getBaseCapability, resolveActivePresets } from "@flow-state-dev/core/capability";
import { withOutcome } from "@flow-state-dev/core/helpers";
import type {
  BlockDefinition,
  CapabilityRef,
  DeclaredResources,
  GeneratorTool,
  InitialSkill,
  ToolCatalog,
  UsesSlot
} from "@flow-state-dev/core";
import type { BlockContext, DeclaredResourceEntry, LLMMessage, ResourceVisibilityRule, SessionConfig } from "@flow-state-dev/core/types";
import {
  activeSkillsArraySchema,
  createSkillActivator,
  createSkillsLibrary,
  pushActiveSkill
} from "@flow-state-dev/orchestration";
import { z } from "zod";
import { WORKER_TASK_ENTRY } from "./worker-task-entry";
import { RESPOND_ACTION } from "./worker-door";
import { declareBuiltInRoles } from "./worker-roles";
import { routedTaskHistory } from "./coordinator/routed-brief";
import { workerTaskEntry } from "./conversation-board/task-entry";
import { defineSessionBoard, type SessionBoard } from "./conversation-board/session-board";
import { REPLY_CONCURRENCY } from "./conversation-board/task-settled";
import { finishedTasksAnswerAgain } from "./conversation-board/take-finished";
import { WORKSTREAM_OPENED_ENTRY, workstreamOpenedEntry } from "./projects/workstream-lead";
import { WORKER_PACKAGES_KEY, WORKER_SKILLS_KEY, WORKER_TOOLS_KEY, oneNameMessage } from "./manifest";
import {
  catalogWorkerCapabilities,
  resolveWorkerCapabilities,
  packageToolCollisions,
  pickedToolCollisions,
  workerCapabilityProblems,
  selectedPresetTools,
  type WorkerCapabilityCatalog,
  type WorkerCapabilitySelection
} from "./worker-capabilities";
import { WORKER_DISCOVER_KEY } from "./worker-discovery";
import { workerSkillSchema, workerConfigSchema } from "./worker-config";
import { turnConfigOf, verifiedWorkerOf } from "./workers/verified-worker";
import { markUserTurnStep } from "./standing-rules/user-turn";
import { standingRulesCapability } from "./standing-rules/rules-capability";
import { STANDING_RULES_ACTION, standingRulesAction } from "./standing-rules/rules-action";
import { setWorkProjectAction } from "./projects/work-project";
import { SET_WORK_PROJECT_ACTION } from "./workers/keys";
import type { WorkerInstallation } from "./workers/installation";
import { steerOrTalk } from "./conversation-board/steer";
import { worksConversationResultTask } from "./conversation-board/task-admission";

/**
 * The worker flow name the hire step resolves a record to when it names none, and the
 * key an app registers its own flow under to replace this one.
 */
export const AGENT_FLOW = "agent";

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
 * Where up-front skill matching publishes its result, when a worker turns it on.
 *
 * Explicit rather than the generator's own block state because the matcher runs
 * *before* the generator and so cannot reach a downstream block's state — see
 * `SkillsBindingConfig.activeState`.
 */
const ACTIVE_SKILLS_STATE = { scope: "session", field: "activeSkills" } as const;

/**
 * The parts of a worker's settings bag this file reads off a running block's
 * context, where the bag's type is erased.
 *
 * Narrow on purpose — it exists so the two per-execution reads below are not
 * bare `any`, not to restate {@link settingsSchema}, which remains the one
 * definition of what a worker may declare.
 */
interface WorkerConfig {
  /** Absent when the worker's file wrote no `tools:` line — never `[]` for that. */
  tools?: string[];
  workerSkills: InitialSkill[];
  skills: { active: string[]; activateTool: boolean; enableLlmClassifier: boolean };
  capabilities: WorkerCapabilitySelection;
  /**
   * The worker's own instructions — its file's body. Optional: a bodyless worker
   * is a weak worker, not a failed hire, so the key is absent rather than empty.
   */
  instructions?: string;
  /**
   * The worker's TEAM-level instructions, imposed by the hire when its team wrote
   * any. Absent — never `""` — when the team wrote none or has no file at all.
   */
  teamInstructions?: string;
  /**
   * The packages this worker holds, imposed by the hire only when it holds one.
   * Each package's instructions follow the worker's own in the prompt; its blocks
   * are offered when the worker wrote no `tools:` line.
   */
  workerPackages?: Array<{ name: string; path: string; instructions?: string; tools: GeneratorTool[] }>;
}

/**
 * The instructions of every package a worker holds, in the order it holds them,
 * as one prompt entry — or `undefined` when it holds none with any, so a worker
 * holding nothing gets the prompt it had before packages existed.
 */
function packageInstructionsOf(packages: WorkerConfig["workerPackages"]): string | undefined {
  const texts = (packages ?? []).flatMap((held) =>
    held.instructions === undefined ? [] : [held.instructions]
  );
  return texts.length === 0 ? undefined : texts.join("\n\n");
}

/**
 * The names a worker's `tools:` line resolved to a held package's block that the
 * worker flow's catalog also carries — one message each, naming the package and the
 * catalog. Only names the line actually granted count: a package block the
 * line left out is never offered, so a catalog key of the same name clashes
 * with nothing.
 */
function packageCatalogCollisions(
  catalog: ToolCatalog,
  workerTools: ReadonlyArray<{ name?: unknown }> | undefined,
  packages: ReadonlyArray<{ path: string; tools: ReadonlyArray<{ name?: unknown }> }>
): string[] {
  const granted = new Set((workerTools ?? []).map((tool) => tool.name));
  const problems: string[] = [];
  for (const held of packages) {
    for (const tool of held.tools) {
      const name = tool.name;
      if (typeof name !== "string" || !granted.has(name) || !Object.hasOwn(catalog, name)) continue;
      problems.push(
        `Its \`tools:\` line names "${name}", which is both a block of package "${held.path}" and ` +
          `a key in the worker flow's tool catalog. One name is one tool, and neither shadows the other — ` +
          `rename the block, or drop "${name}" from the catalog.`
      );
    }
  }
  return problems;
}

/**
 * This worker's own skills, off its config — the per-execution read the whole
 * per-worker catalog hangs on.
 *
 * O(1) by construction: the array was resolved when the roster was read and is
 * carried on the bag. Nothing here may walk, parse or touch storage — it runs
 * before every step of every generator turn.
 *
 * Defensive `?? []` because the bag is erased at this point and a replacement
 * worker flow registered under `agent` could hand over a config without the key.
 */
function workerSkillsOf(ctx: BlockContext): InitialSkill[] {
  return (turnConfigOf(ctx) as Partial<WorkerConfig>).workerSkills ?? [];
}

/**
 * Whether this worker turned the mid-turn activate tool on. The other erased read
 * — it picks which of the two answering generators runs, and the default is
 * off, so anything other than an explicit `true` takes the plain arm.
 */
function activateToolOn(ctx: BlockContext): boolean {
  return (turnConfigOf(ctx) as Partial<WorkerConfig>).skills?.activateTool === true;
}

/** `afterAnswer`, rescuing only when the task row says the result goes to the conversation. */
function afterAnswerStep(block: BlockDefinition<any, any>) {
  const keepTheAnswer = handler({
    name: "agent-after-answer-rescue",
    inputSchema: z.unknown(),
    execute: async (error, ctx) => {
      if (!(await worksConversationResultTask(ctx as never))) throw error;
      // eslint-disable-next-line no-console
      console.error(
        `[agent] Background work "${block.name}" failed; the task's result goes to the conversation, so it keeps its answer:`,
        error instanceof Error ? error.message : error
      );
    }
  });
  return sequencer({ name: "agent-after-answer", inputSchema: z.unknown() })
    .step(block)
    .rescue([{ block: keepTheAnswer }]);
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
  /** Skills seeded into the library every worker on this flow reads. */
  skills?: InitialSkill[];
  /** Default model for workers that name none. Defaults to {@link DEFAULT_MODEL}. */
  model?: string;
  /**
   * Model the up-front matcher's third tier uses, when a worker opts in. Mirrors
   * `createSkillActivator`'s option of the same name.
   *
   * An app-level option rather than a worker setting because the matcher is
   * built once for the flow: a per-worker value could not be honoured, and a
   * setting that is silently ignored is the failure this flow's tool handling
   * exists to prevent.
   */
  classifierModel?: string;
  /** Confidence the matcher's third tier must reach. Mirrors `createSkillActivator`. */
  confidenceThreshold?: number;
  /**
   * Capabilities every worker on this flow carries, composed onto the answer
   * generator beside the skills library — which stays first and is never
   * displaced.
   *
   * Deliberately generic. This is the door an app composes memory through
   * (`uses: [mem.capability.presets({ ... })]`); it is not a memory option,
   * and this package knows nothing about memory.
   *
   * **A STATIC entry's resources reach the flow on their own**, through the
   * generator's `declaredResources` and `defineFlow`'s merge — so a capability
   * passed as a plain ref needs nothing declared alongside it.
   *
   * **A DYNAMIC entry (`(ctx) => refs`) does not.** `UsesSlot` accepts both,
   * and a resolver function contributes context, tools and control tools only:
   * resources have to exist before the block runs, so they must be declared
   * statically somewhere (see `UsesEntry` in `@flow-state-dev/core`). Pass a capability
   * dynamically and its stores are *not* installed by that entry alone.
   *
   * **A worker picks presets from what this option installs.** A worker file's
   * `capabilities:` key names a capability listed here and the presets that
   * worker wants; a name that is not a top-level static entry of this array is
   * refused at the mint. Selecting only ever ADDS to what the entry already
   * carries — see `./worker-capabilities`.
   *
   * **Tool-carrying presets ARE fenced** (FIX-1393). Core drops a capability's
   * catalog-granted tools when the consuming block declares `tools:`, and this
   * flow declares it on every worker — so a preset that ships a tool reaches a
   * worker only when that worker's own file picks the preset and writes no
   * `tools:` line, or names the tool in its line. A preset switched on here by
   * default grants no worker anything it did not pick. A capability's
   * `controlTools` are exempt by design.
   */
  uses?: UsesSlot;
  /**
   * Key this flow's user-scoped storage by the flow copy's id, instead of one
   * cell the user's other flows share. Default: false, matching the
   * framework (BP-027).
   *
   * Forwarded to the flow untouched. On an installation every worker runs on
   * the one `agent` copy, so its workers still share one cell per user;
   * only the skills drawer is kept per worker. On a copy minted for one
   * worker, the key is that worker's id, so renaming it leaves its isolated
   * data behind under the old name — and so does flipping this flag on a
   * roster already in use.
   *
   * A memory tier that declares its own `flowIsolation`
   * (`system({ semantic: { flowIsolation: false } })`) wins over this flag in
   * both directions, so one worker flow can isolate some tiers and share others.
   */
  isolateUserState?: boolean;
  /**
   * A block run after the worker answers, as a side-chain — it cannot change
   * the answer, and a failure in it never fails a conversation turn. In a
   * task it fails the attempt, as any background step's failure does, except
   * in a task whose result goes to the conversation, where it is logged and
   * the task keeps its answer (FIX-2088).
   *
   * **It receives the answer generator's output: the assistant's reply text,
   * as a string.** `.sideChain` with no connector passes the preceding step's
   * output straight through, and `agent-answer` declares no `outputSchema`.
   * The type here is deliberately wide (core's own `.sideChain` takes
   * `BlockDefinition<any, any>`), so a block expecting some other shape
   * compiles and fails at run time — check yours against a string, or give it
   * a `connectInput` connector that reads what it actually needs.
   * `mem.captureFromItems` is the latter: its connector ignores this input
   * and reads the session's items.
   *
   * The write-side door. Memory's capture pipeline goes here
   * (`afterAnswer: mem.captureFromItems`); without it a worker carrying
   * memory reads what something else stored and records nothing of its own.
   *
   * Omitted, the flow's sequence is exactly what it is today.
   */
  afterAnswer?: BlockDefinition<any, any>;
  /**
   * Answer again, in the same request, with the tasks that finished while the
   * worker answered (FIX-2159). After the worker answers, this block runs; when
   * it returns `{ message }`, the worker answers again about that message, and
   * the block runs again after that answer. Its input is the worker's answer.
   *
   * - `true` uses the package's pre-built block
   *   ({@link finishedTasksAnswerAgain}): it takes what finished
   *   ({@link takeFinishedTasks}), says each result as a line under its
   *   delegate's name, and tells the worker to use them.
   * - A block replaces it, to change what the worker is told:
   *   `finishedTasksAnswerAgain({ message })`, or a sequencer of your own
   *   around `takeFinishedTasks`.
   *
   * It feeds the one answer-again step the worker's plan already runs, so the
   * answer after the plan and these count toward one cap,
   * {@link MAX_ANSWERS_AGAIN} answers again per request. The take hands
   * over nothing outside a turn a user's own message started, so in a
   * task's turn, or a turn a notice or another worker's message started,
   * results arrive after the turn as before. Only on an installation, where
   * the worker files tasks.
   *
   * Omitted, a turn answers once (and again after its plan), and every
   * result is heard after the turn.
   */
  answerAgain?: true | BlockDefinition<any, any>;
  /**
   * Run workers as data: one copy of this flow for every worker, each
   * session naming its worker when it is created (the installation's create
   * check), and each turn loading that worker's configuration before
   * anything reads it. The drawer is kept per worker.
   *
   * Omitted, the flow reads its settings off the copy, as a copy minted for
   * one worker does.
   */
  installation?: WorkerInstallation;
}

/** The coordinator's tool that once handed a message on, refused by name at load. */
const RETIRED_HAND_OFF = "handOff"; // retired-name-refusal

/**
 * What one worker on this flow configures, in its file.
 *
 * **Composed from the admission contract rather than written beside it.** The
 * four settings a worker's bag may carry — a worker's own instructions, its
 * team's, the skills its folders resolved, and the blocks those folders
 * registered that its `tools:` named — come from
 * `workerConfigSchema()`, and this flow's own settings are extended on at the
 * top level. That is the move every hireable worker flow makes, so the one flow that
 * ships with the framework teaches the rule rather than standing outside it.
 *
 * `workerSkills` is re-declared below rather than inherited untouched: the SHAPE
 * stays the contract's (`workerSkillSchema`), and the refinement on top of it is
 * this flow's, because only this flow holds the app's own skill names to
 * collide a worker's against.
 */
function settingsSchema(
  options: AgentWorkerFlowOptions,
  workerCapabilities: WorkerCapabilityCatalog
) {
  const catalog = options.catalog ?? {};
  const appSkillNames = new Set((options.skills ?? []).map((skill) => skill.name));

  return workerConfigSchema().extend({
    model: z.string().default(options.model ?? DEFAULT_MODEL),

    /**
     * Tools this worker may use, by catalog key — the whole grant when the
     * worker wrote the line.
     *
     * **Optional, with no default, on purpose.** Absent means the worker's
     * file wrote no `tools:` line, and such a worker is granted the tools of
     * the presets it picked (see the tools slot below). `[]` means a line was
     * written and names nothing, so the worker gets no tool. A default would
     * erase that difference, and so would any rewrite of absent to `[]`.
     *
     * Refused **at the mint**, by name, when the catalog does not carry the
     * key — including when there is no catalog at all, which is not a special
     * case. The refusal throws so it lands inside the hire step's collected
     * error with the worker's id in front of it.
     */
    tools: z
      .array(z.string())
      .optional()
      .superRefine((names, ctx) => {
        const known = Object.keys(catalog);
        for (const name of names ?? []) {
          if (Object.hasOwn(catalog, name)) continue;
          // A coordinator hands a message on with `createTask` and the routing settings now.
          if (name === RETIRED_HAND_OFF) { // retired-name-refusal: FIX-1872
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message:
                `names tool "${RETIRED_HAND_OFF}", which no longer exists. A coordinator hands the message it is ` + // retired-name-refusal
                `routing to a delegate with \`createTask\` and the routing settings (\`session: "ongoing"\`, ` +
                `\`resultTo: "conversation"\`), which every coordinator turn carries: drop "${RETIRED_HAND_OFF}" ` + // retired-name-refusal
                `from this worker's \`tools:\` line, and name \`createTask\` in its instructions instead.`
            });
            continue;
          }
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              `names tool "${name}", which nothing registers for this worker — neither its own ` +
              `\`blocks/\` folder nor the app's tool catalog. ` +
              `Known catalog tools: ${known.length > 0 ? known.map((k) => `"${k}"`).join(", ") : "(none — no catalog was passed to defineAgentWorkerFlow)"}. ` +
              `Put the block in this worker's own \`blocks/\` folder and re-run \`fsdev gen\`, ` +
              `pass it as \`defineAgentWorkerFlow({ catalog: { "${name}": <tool> } })\`, or drop ` +
              `it from this worker.`
          });
        }
      }),

    /**
     * The worker's own skills — the contract's key, re-declared here to add ONE
     * refinement this flow alone can make.
     *
     * The shape and the story are `workerConfigSchema()`'s: imposed by the hire
     * step, never authored, present even when empty. What is added below is the
     * collision check against `defineAgentWorkerFlow({ skills })`, which needs
     * the app's own skill names and so cannot live on a contract every worker flow
     * shares.
     */
    [WORKER_SKILLS_KEY]: z
      .array(workerSkillSchema)
      .default([])
      .superRefine((workerSkills, ctx) => {
        // Both sources fill ONE catalog, so a bare name arriving from both has
        // no answer — the same rule the loader already applies across a worker's
        // levels, rather than a second precedence story beside it.
        for (const skill of workerSkills) {
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
         * on the activate tool, or lists the skill here. A name the worker does
         * not hold is refused at the mint, listing what it does hold.
         */
        active: z.array(z.string()).default([]),

        /**
         * Let the model pull a held skill into context mid-turn, with a tool.
         *
         * **Default off.** Turning it on installs the load tool *and* a listing
         * of everything the worker holds, and that listing is a per-turn token
         * cost proportional to the catalog — which is exactly what a
         * zero-configuration worker must not be charged. Left off, a worker's
         * skills are still reachable by slash and by the always-on list.
         */
        activateTool: z.boolean().default(false),

        /**
         * Turn on the up-front matcher's third tier — a model call that
         * classifies the message against the skill catalog. Slash matching
         * (tier 1) always runs, every turn, regardless of this switch. Keyword
         * matching (`createSkillActivator`'s tier 2) is not part of this
         * flow's contract at all — zero-LLM matching earns a second always-on
         * path only once we know we need one — so this flow's activator
         * pipeline never carries it, on either branch of this switch.
         *
         * **Default off**, which inverts `createSkillActivator`'s own default:
         * a zero-configuration worker must not spend an extra model call per
         * turn deciding whether a skill applies. Left off, skills are still
         * reachable — a slash hit still activates them, and `active` and
         * `activateTool` above are the worker's other two doors.
         */
        enableLlmClassifier: z.boolean().default(false)
      })
      .default({}),

    /**
     * The capabilities this worker picks up from what its worker flow carries, and the
     * presets it wants from each.
     *
     * ```yaml
     * capabilities:
     *   research: [briefing]
     * ```
     *
     * **Default empty**, which carries every installed capability's own
     * defaults — what every worker gets today. Naming presets ADDS to that; a
     * worker has no way to switch one off, because what a workforce may do is
     * the app's call and a worker file is not where it is reversed.
     *
     * Refused **at the mint**, by name: an unknown capability, an undeclared
     * preset, and the three presets that cannot travel the per-worker path (one
     * the app turned off, one on a capability with open config, and one whose
     * surface has to exist before a request runs). The whole selection is
     * validated before a worker answers anything, because a typo surfacing as a
     * failed turn in front of a user is worse than the silence this key
     * closes.
     */
    capabilities: z
      .record(z.string(), z.array(z.string()))
      .default({})
      .superRefine((selection, ctx) => {
        for (const message of workerCapabilityProblems(workerCapabilities, selection)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message });
        }
      }),

    /**
     * Which discovery domains this worker sees (FIX-817).
     *
     * ```yaml
     * discover: [workers, skills]
     * ```
     *
     * **Omit the key to see every domain the worker's scope carries** — today's
     * reach, unchanged. Naming domains NARROWS to those; an empty list asks to
     * see none. There is no spelling that widens: a domain the app did not
     * install is not reached by a file naming it, because the narrowing is an
     * intersection over the registry the app built.
     *
     * A misspelled domain is refused **at the mint**, by name, listing the four
     * — a typo that silently narrowed a worker to nothing would surface as a
     * planner that quietly stopped finding anybody. A correctly spelled domain
     * the scope does not carry is NOT a refusal: it is the add-never-widen rule
     * doing its job, and the worker simply sees nothing for it.
     *
     * Read per turn by `createWorkforceCapability`'s door — see
     * `./worker-discovery`.
     */
    [WORKER_DISCOVER_KEY]: z.array(z.enum(MANIFEST_DOMAINS)).optional()
  });
}

/**
 * Refuse an always-on name this worker does not hold, by name, listing what it
 * does hold.
 *
 * **Not at the mint, and not by choice.** `skills.active` and `workerSkills` are
 * two settings, so the check spans them — and a flow's `configSchema` must be a
 * plain `z.object`, because the framework closes undeclared keys on it and a
 * `.superRefine()` wrapper would make that impossible (`closeConfigSchema`,
 * `packages/core/src/flow/defineFlow.ts`). That refusal names the alternative
 * outright: *"a rule spanning two settings belongs in the block that reads
 * them."* This is that block — it is the one that reads `skills.active`.
 *
 * So the refusal lands on the worker's first turn instead of at boot. It is still
 * fatal, still names the skill, and still lists what the worker holds; what is
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
 * The one-name rule over the app's catalog, at the worker flow's construction door.
 *
 * Checked here and not at the scan because the catalog is a **flow-construction
 * argument**: it covers a hand-built map exactly as it covers a generated one,
 * and it leaves a block used only as a flow action alone. Thrown rather than
 * collected — a worker flow is built once, at module scope, so there is no roster to
 * report against and nothing else this call could usefully go on to do.
 *
 * Every mismatch is named in one message, for the reason `hireWorkforce`
 * collects: an author fixing a catalog should see the whole list in one run.
 */
/**
 * Catalog tools a worker flow's `uses` already grants — capability tools fill the
 * flow's catalog so a worker can name them in `tools:`.
 *
 * Not the only route a preset's tool reaches a worker: a worker with no `tools:`
 * line gets the tools of the presets it picked through the tools slot. This
 * fill is how a worker that WRITES a line names a tool from a preset the flow has
 * on by default.
 *
 * Core drops a capability's catalog tools when the consuming block declares
 * `tools:` (FIX-1393). This flow always declares that slot, so a grant that
 * stayed only on the capability would be a name no worker could call. Filling
 * the catalog is what makes "the flow installs via `uses`, worker names the tool"
 * one path rather than two.
 *
 * Static arrays only. A preset whose `tools` is a function cannot be named
 * at flow construction, and is left for the capability merge to contribute
 * when the fence is down.
 */
function catalogToolsFromUses(uses: UsesSlot | undefined): ToolCatalog {
  const filled: ToolCatalog = {};
  if (!uses) return filled;

  const topLevel = uses.filter((entry): entry is CapabilityRef => typeof entry !== "function");
  for (const entry of flattenCapabilities(topLevel)) {
    for (const { preset } of resolveActivePresets(entry)) {
      if (!Array.isArray(preset.tools)) continue;
      for (const tool of preset.tools) {
        const toolName = (tool as { name?: unknown }).name;
        if (typeof toolName !== "string" || toolName.length === 0) continue;
        const existing = filled[toolName];
        if (existing !== undefined && existing !== tool) {
          throw new Error(
            `defineAgentWorkerFlow refused catalog key "${toolName}": two capabilities in ` +
              `\`uses\` contribute different tools under that name (${getBaseCapability(entry).name} ` +
              `and another). One name is one tool.`
          );
        }
        filled[toolName] = tool as GeneratorTool;
      }
    }
  }
  return filled;
}

/**
 * The worker flow's catalog: capability grants first, the app's map on top only when
 * the two agree. A collision of different instances is a construction error
 * rather than a silent overlay — the worker's `tools:` would otherwise name
 * one tool and call the other.
 */
function mergeFlowCatalog(
  uses: UsesSlot | undefined,
  catalog: ToolCatalog | undefined
): ToolCatalog {
  const fromUses = catalogToolsFromUses(uses);
  const fromApp = catalog ?? {};
  for (const [name, tool] of Object.entries(fromApp)) {
    const granted = fromUses[name];
    if (granted !== undefined && granted !== tool) {
      throw new Error(
        `defineAgentWorkerFlow refused catalog key "${name}": the app's catalog and a ` +
          `capability in \`uses\` both contribute that name, as different tools. ` +
          `Drop one, or pass the capability's own tool under that key.`
      );
    }
  }
  return { ...fromUses, ...fromApp };
}

function assertOneNamePerCatalogEntry(catalog: ToolCatalog): void {
  const problems: string[] = [];
  for (const [key, tool] of Object.entries(catalog)) {
    const blockName = (tool as { name?: unknown }).name;
    if (typeof blockName !== "string" || blockName === key) continue;
    problems.push(oneNameMessage(key, blockName, "The app's tool catalog"));
  }
  if (problems.length === 0) return;
  throw new Error(
    `defineAgentWorkerFlow refused ${problems.length} catalog ` +
      `entr${problems.length === 1 ? "y" : "ies"}:\n  - ${problems.join("\n  - ")}`
  );
}

/**
 * What the app's catalog declares, merged into one set for the answer
 * generators to declare as their own.
 *
 * **The gap this closes, and why it is not obvious.** A worker reaches its tools
 * through the `tools:` slot below, which is a resolver that runs per turn off
 * `ctx.flow.config`. `defineFlow` collects `declaredResources` by a STATIC walk
 * over the flow's action blocks (`defineFlow.ts`), and nothing a runtime
 * resolver returns was ever an action block — so a catalog tool that declares a
 * store was hired, advertised to the model, called, and found no handle, while
 * the turn reported success. Declaring them on the generator puts them back
 * inside the walk that installs them, as BLOCK-level declarations on the very
 * block that calls the tools, which keeps each one's own prefetch mode intact.
 *
 * Flow-wide by construction, and deliberately: the catalog is the flow's, so
 * its stores belong to every worker of it — including workers whose `tools:` never
 * name the tool. That is the same bill `uses` already presents, and it is why
 * this is safe where collecting a WORKER's declarations would not be.
 *
 * The tools of every preset a worker may pick count too, on or off for the flow:
 * a worker with no `tools:` line reaches them through the same per-turn resolver.
 * Only presets that list their tools as an array can be read here; a preset
 * whose tools are a function is known only per turn.
 */
function catalogDeclaredResources(
  catalog: ToolCatalog,
  workerCapabilities: WorkerCapabilityCatalog
): DeclaredResources | undefined {
  const merged: DeclaredResources = {};
  /** Accessor key → the catalog key that claimed it, so a clash can name both. */
  const claimedBy: Record<string, string> = {};

  const entries: Array<[string, unknown]> = Object.entries(catalog);
  for (const capability of workerCapabilities.values()) {
    for (const tools of capability.presetTools.values()) {
      if (!Array.isArray(tools)) continue;
      for (const tool of tools) {
        entries.push([String((tool as { name?: unknown }).name), tool]);
      }
    }
  }

  for (const [key, tool] of entries) {
    const declared = (tool as { declaredResources?: DeclaredResources }).declaredResources;
    if (declared === undefined) continue;
    for (const [accessor, resource] of Object.entries(declared)) {
      const held = merged[accessor];
      // Same accessor, same `defineResource()` reference is one resource two
      // tools share. A DIFFERENT reference is two resources one accessor —
      // refused here, by both catalog keys, rather than silently taking the
      // last: core refuses the same pair at the same level, and a last-wins
      // merge is exactly the silent wrong answer this registration exists to
      // remove.
      if (held !== undefined && held !== resource) {
        throw new Error(
          `defineAgentWorkerFlow: catalog tools "${claimedBy[accessor]}" and "${key}" both ` +
            `declare resource "${accessor}" with different defineResource() references. Use the ` +
            `same reference across blocks, or pick distinct accessor keys.`
        );
      }
      merged[accessor] = resource;
      claimedBy[accessor] ??= key;
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * Build a worker flow.
 *
 * Called with no arguments this returns the built-in — the worker flow a worker file
 * that names no `flow:` is hired into. Called with arguments it returns a
 * configured one; register it as `workerFlows: { agent: defineAgentWorkerFlow({ ... }) }`
 * and it wins for every worker on the roster.
 *
 * Define once, hire many: call this at module scope or app bootstrap, never
 * per hire or per request.
 *
 * @param options What only the app can supply — see {@link AgentWorkerFlowOptions}.
 * @returns A `defineFlow` result whose flow kind is `agent`, cardinality `collection`.
 */
export function defineAgentWorkerFlow(given: AgentWorkerFlowOptions = {}) {
  const turn = agentWorkerTurn(given);
  const { options, settings, inputSchema, run, bound, mintProblems, board } = turn;
  const installation = options.installation;
  return defineAgentFlowAround(options, settings, inputSchema, run, bound, mintProblems, installation, board);
}

/**
 * What a flow that shares the agent's turn changes about it. The built-in
 * `agent` flow changes nothing; the `coordinator` flow runs the same turn on
 * its own workers, with its delegate tools.
 */
export interface AgentTurnShare {
  /** The worker flow the turn runs on: the turn loads its worker on this flow. */
  readonly kind: string;
  /** The answer generator's block name, which a scripted model resolves it by. */
  readonly answerName: string;
  /**
   * Tools the turn always carries, beside the ones the worker's own file
   * grants. Not fenced by the worker's `tools:` line: the flow gives them to
   * every worker on it.
   */
  readonly extraTools?: readonly GeneratorTool[];
  /**
   * The session board the turn files through (FIX-1802 S1), when the sharing
   * flow builds its own: the coordinator does, to name the flows its routed
   * tasks reach. Omitted, a turn on an installation builds one for its flow. Its
   * task tools are composed once, here, so a turn carries one instance of
   * each, whatever skill is loaded.
   */
  readonly board?: SessionBoard;
  /**
   * The answer's history, in place of {@link routedTaskHistory}: the
   * coordinator's says each delegate's answer as a line from that delegate.
   */
  readonly history?: (input: unknown, ctx: BlockContext) => Promise<LLMMessage[]>;
}

const AGENT_TURN: AgentTurnShare = { kind: AGENT_FLOW, answerName: "agent-answer" };

/**
 * The built-in agent's turn, built once per flow that runs it: its settings
 * schema, the `run` sequence (skill matching, the worker's default skills,
 * and the answer), the request `onStarted` that loads the turn's worker, the
 * session and resources a flow on an installation declares, the cross-key
 * checks a mint runs, and the names the answer's messages carry as
 * `agentName` (`answerNames`).
 *
 * The `agent` flow is this turn behind a door. The `coordinator` flow runs the
 * same turn for its judgment, with {@link AgentTurnShare.extraTools}, so a
 * fix to the agent's turn reaches both.
 *
 * @param given The agent worker flow's options: the app's catalog, capabilities, skills and models.
 * @param share The sharing flow's name, answer name and extra tools.
 */
export function agentWorkerTurn(given: AgentWorkerFlowOptions = {}, share: AgentTurnShare = AGENT_TURN) {
  const options: AgentWorkerFlowOptions = given;
  const catalog = mergeFlowCatalog(options.uses, options.catalog);
  // Before anything is built from it. A catalog key that disagrees with its
  // block's own name would hand the model a tool no worker's `tools:` can
  // authorize, and the flow is the door that holds the map.
  assertOneNamePerCatalogEntry(catalog);
  // Read once, here: it is what a worker's `capabilities:` is validated against
  // at the mint AND what the per-worker entry below resolves through, and two
  // readings of one `uses` array is how the two halves drift apart.
  const workerCapabilityCatalog = catalogWorkerCapabilities(options.uses);
  // What the catalog's own blocks and pickable presets' tools need, so the
  // flow installs it. See the function's note: without this a tool that
  // declares a store is advertised with nothing behind it.
  const catalogResources = catalogDeclaredResources(catalog, workerCapabilityCatalog);
  const settings = settingsSchema({ ...options, catalog }, workerCapabilityCatalog);
  /**
   * The settings this turn runs with: the configuration of the worker the
   * turn resolved, or the copy's own config on a copy minted for one worker.
   */
  const turnConfig = (ctx: { readonly session: object; readonly flow?: { readonly config: unknown } }) =>
    turnConfigOf(ctx) as z.infer<typeof settings>;
  const inputSchema = z.object({ message: z.string() });

  const appSkills = options.skills ?? [];

  /**
   * What THIS worker's catalog is seeded from — the app's skills plus its own.
   *
   * Kept to an O(1) read of an already-resolved array, because it runs on every
   * render of every binding: before each step of the generator's tool loop, and
   * at the matcher's seed step. The union is only materialized when both halves
   * are non-empty, which is the uncommon case; a name in both is already
   * refused at the mint, so there is nothing to reconcile here.
   */
  const workerCatalog = (ctx: BlockContext): InitialSkill[] => {
    const worker = workerSkillsOf(ctx);
    if (worker.length === 0) return appSkills;
    if (appSkills.length === 0) return worker;
    return [...appSkills, ...worker];
  };

  // `catalog` is passed so a bound skill's declared `allowed-tools` are
  // validated against it (author feedback: a typo or an uncataloged tool
  // fails loud at build time) — but `registerCatalogTools: false` keeps the
  // library's own whole-catalog registration (see the bindings below) from
  // putting every app tool on the generator regardless of a worker's own
  // `tools:` setting. That registration path stays off; the generator's own
  // `tools:` slot below, fenced at the mint by the `tools` schema, is the
  // only stock tool-registration path.
  // User scope, not the library's org default: the drawer is the worker's own
  // working state, and org scope is shared with every member of the org. With
  // the flow's isolation below, each worker's drawer is its user's alone.
  const skills = createSkillsLibrary({
    catalog,
    registerCatalogTools: false,
    scope: "user",
    // Per-execution rather than a fixed array: the catalog is the WORKER's, and
    // a block deliberately cannot see which instance it is, so the worker's own
    // set has to arrive on its config and be read from there.
    initialSkills: workerCatalog,
    // Every worker gets its own drawer. The storage layer keys an isolated
    // resource on the id of the worker's flow copy, which is minted with the worker's
    // id — so two workers' catalogs are two different buckets, with no second
    // collection key, prefix or scope. (A collection seeded before this was
    // switched on re-seeds from the new key; the old rows are orphaned, not
    // lost — BP-030.)
    collectionConfig: { flowIsolation: true },
    // One drawer per worker on a copy the installation runs every worker on:
    // the worker this turn's `resolveWorker` loaded and checked, never a value
    // in session state (BP-031). On a copy minted for one worker the drawer
    // is the copy's.
    ...(options.installation !== undefined
      ? { partitionBy: (ctx: BlockContext) => verifiedWorkerOf(ctx.session as object) }
      : {})
  });

  // Pinned by the contract (C5): the library plus a per-generator binding.
  // `activeState` is explicit because the matcher below runs BEFORE the
  // generator and so cannot reach its block state.
  //
  // TWO bindings, because `dynamicActivation` is a build-time preset and the
  // activate tool is a per-worker switch — the same shape, and the same reason,
  // as the two activators further down. The plain binding is what a
  // zero-configuration worker gets: the reader, and no tool and no catalog
  // listing. `allowed` is omitted on both, so when a worker does turn the tool
  // on it reaches everything it holds.
  //
  // ---------------------------------------------------------------------
  // BEFORE YOU SIMPLIFY THIS: the 2x2 is FORCED, and not from here.
  //
  // Two bindings x two activators x two generators is the widest thing in
  // this file, and it looks like over-engineering until you try to collapse
  // it. Both switches — `skills.activateTool` and
  // `skills.enableLlmClassifier` — are per WORKER, while both mechanisms that
  // implement them are fixed at CONSTRUCTION: `dynamicActivation` is a
  // preset resolved when `skills.with()` is bound, and
  // `enableLlmClassifier` is read by `createSkillActivator` when it builds
  // its pipeline. A worker flow is built once and hired many times, so neither can
  // see the worker, and building one of each and choosing at run time is the
  // only shape that honours a per-worker switch at all.
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
   * What THIS worker's own file added on top of the flow's capabilities — the
   * presets it named that the flow does not already carry.
   *
   * A dynamic entry because it is the only `uses` slot that can see a worker: a
   * worker flow is built once and hired many times, so a static entry is resolved
   * before any worker exists. It carries the DELTA only; every capability stays
   * on its own static entry, which is what keeps a preset from being resolved
   * on both paths (the framework merges the two independently and dedupes
   * across neither).
   *
   * Appended only when the flow installs something selectable, so a flow that
   * passes no `uses` builds exactly the block it built before this key existed
   * rather than one carrying an inert dynamic resolver.
   */
  const workerCapabilities = (ctx: BlockContext) =>
    resolveWorkerCapabilities(
      workerCapabilityCatalog,
      (turnConfigOf(ctx) as Partial<WorkerConfig>).capabilities
    );
  // The session's task board, on an installation: a worker whose session
  // lists a delegate that takes a task files through it (FIX-1802 D1). Its
  // tools are one capability instance on this turn, granted per call.
  const board: SessionBoard | undefined =
    share.board ??
    (options.installation !== undefined
      ? defineSessionBoard({ installation: options.installation, flowKind: share.kind })
      : undefined);
  const usesEntries = [
    ...(options.uses ?? []),
    standingRulesCapability,
    ...(workerCapabilityCatalog.size > 0 ? [workerCapabilities] : []),
    ...(board !== undefined ? [board.tools, board.questions, board.progress, board.steers, board.delegateTools, board.messages] : [])
  ];

  const answerWith = (binding: ReturnType<typeof skills.with>, name: string) =>
    generator({
      name,
      inputSchema,
      flowConfigSchema: settings,
      itemVisibility: { client: true, history: true },
      // The earlier turns of THIS conversation, so a follow-up keeps its
      // subject. A conversation is one session: a worker has one per
      // conversation, so nothing said in one reaches another. Bounded by the
      // session's history window (the framework's default, 50 turns); older turns fall out rather than being summarized.
      // On a coordinator's routed task, the routing conversation's recent
      // lines join it as one user-role message before the message, for this
      // call only; on any other turn it is `history: true` unchanged. A
      // sharing flow may read it its own way (the coordinator's says who
      // wrote each delegate's answer).
      history: share.history ?? routedTaskHistory,
      // What the app's catalog tools declare, declared here so `defineFlow`'s
      // static walk installs it — see `catalogDeclaredResources`. Omitted
      // entirely when the catalog declares nothing, so a flow built without one
      // is byte-for-byte the block it was before this existed.
      ...(catalogResources !== undefined ? { resources: catalogResources } : {}),
      // The skills binding stays FIRST and is never displaced: an app's own
      // capabilities compose beside it. That is what the `uses` option is for.
      uses: [binding, ...usesEntries],
      // The prompt seam — A MARKED INSERTION POINT, NOT AN ABSTRACTION.
      //
      // Three layers, in this order every time: the worker's TEAM speaks first,
      // then the worker's own file, then the packages it holds. The array is the framework's own prompt
      // slot, which resolves each entry, drops the absent ones and joins the
      // rest — so the filter and the join stay the framework's single rule
      // instead of a second copy of it living here.
      //
      // Each resolver returns `undefined` rather than `""` for an absent
      // layer, and that is load-bearing rather than stylistic: the slot drops
      // `null`/`undefined` but keeps `""`, so an empty string would survive
      // the filter and show up as a leading blank line in the prompt of every
      // worker whose team wrote nothing.
      //
      // WHAT THE ORDER BUYS, AND WHAT IT DOES NOT. The position is fixed and
      // checkable, and that is the whole promise. It is NOT a precedence rule.
      // Assembly on this path is plain concatenation with no override,
      // precedence or conflict-resolution mechanism anywhere in it, so if a
      // team says *never touch production* and a worker says *restart the
      // production queue*, what happens is whatever the MODEL does with two
      // contradictory sentences. No doc line, test or PR sentence here should
      // claim the worker's text "wins": a check on the composed string proves
      // order, which is a neighbour of precedence and not precedence. Making
      // the worker's line genuinely win would mean resolving contradictions
      // before the prompt is sent — a different and much larger feature.
      //
      // The shared default worker system prompt is still unshipped and still
      // owned elsewhere; per contract C1 this flow consumes it and defines no
      // second one. When it lands it goes at the FRONT of this array — the
      // framework, then the team, then the worker — and nothing else moves. Do
      // not grow this into a compose helper, a registry or a type: an org-wide
      // fourth layer is the point at which the seam should be re-decided
      // rather than widened a second time.
      //
      // A held package's instructions come third, after the worker's own: the
      // worker holds the package, so its text reads as part of what this worker is
      // told. The same caveat holds — order, not precedence.
      prompt: [
        (_input, ctx) => turnConfig(ctx).teamInstructions,
        (_input, ctx) => turnConfig(ctx).instructions,
        (_input, ctx) => packageInstructionsOf(turnConfig(ctx)[WORKER_PACKAGES_KEY])
      ],
      model: (_input, ctx) => turnConfig(ctx).model,
      // The worker's granted tools. With a written `tools:` line, both halves of
      // it: `tools` holds the names that resolved to the app's CATALOG;
      // `workerTools` holds the blocks that resolved to this worker's own folders,
      // already resolved at the hire step so this slot stays cheap — it runs
      // before every step of every turn. With NO line (`tools` absent, never
      // `[]`), the tools of the presets the worker's own file picked, read from
      // its selection as written; `workerTools` is empty then, because the hire
      // fills it only from a written line. The generator's fence sees ONE
      // declared list and cannot tell where a tool came from, which is the
      // point: a colocated block or a chosen tool is not an exemption from the
      // fence, it joins the declaration.
      //
      // With no line, a held package's blocks are chosen too: holding the
      // package is the choice. With a line they are not added here — a
      // package block the line names already resolved onto `workerTools` at the
      // hire, like a block in the worker's own folder.
      tools: async (_input, ctx): Promise<GeneratorTool[]> => {
        const config = turnConfig(ctx);
        const listed = config.tools;
        const named =
          listed === undefined
            ? [
                ...(await selectedPresetTools(workerCapabilityCatalog, config.capabilities, ctx)),
                ...(config[WORKER_PACKAGES_KEY] ?? []).flatMap((held) => held.tools)
              ]
            : listed.map((toolName) => catalog[toolName] as GeneratorTool);
        const own = config[WORKER_TOOLS_KEY] as GeneratorTool[] | undefined;
        // The sharing flow's own tools, on every worker it runs.
        const extra = share.extraTools ?? [];
        // Materialized only when the worker has both, which is the uncommon case.
        if ((own === undefined || own.length === 0) && extra.length === 0) return named;
        return [...named, ...(own ?? []), ...extra];
      },
      user: (input) => input.message
    });

  // The answer's two generator names, which its messages carry as `agentName`.
  const answerNames = [share.answerName, `${share.answerName}-with-activate-tool`] as const;
  const answer = answerWith(skillsBinding, answerNames[0]);
  const answerWithActivateTool = answerWith(skillsBindingWithActivateTool, answerNames[1]);

  // `createSkillActivator` takes `enableLlmClassifier` at construction, so
  // one instance can't honour a per-worker switch on tier 3 alone. Two full
  // activators are built instead — both carry tier 1 (slash) only, both with
  // tier 2 (keyword) turned off via `enableKeywordMatch: false`, since
  // keyword matching is not part of this flow's contract; only the second
  // also carries tier 3 (the model classifier). The worker's switch picks
  // between them below with two mutually exclusive `.tapIf` steps, so tier 1
  // runs on every turn regardless of the switch, tier 2 never runs on either
  // branch, and only tier 3 is conditional.
  //
  // Built once per worker flow, not per worker — same as before.
  const matcherWithoutClassifier = createSkillActivator({
    enableLlmClassifier: false,
    enableKeywordMatch: false,
    activeState: ACTIVE_SKILLS_STATE,
    initialSkills: workerCatalog
  });
  const matcherWithClassifier = createSkillActivator({
    enableLlmClassifier: true,
    enableKeywordMatch: false,
    activeState: ACTIVE_SKILLS_STATE,
    ...(options.classifierModel ? { classifierModel: options.classifierModel } : {}),
    ...(options.confidenceThreshold !== undefined ? { confidenceThreshold: options.confidenceThreshold } : {}),
    initialSkills: workerCatalog
  });

  /**
   * The worker's always-on skills, appended to whatever the matcher resolved.
   *
   * **After** the matcher, not inside it: the matcher's apply step REPLACES the
   * active set (per-turn semantics, by design), so defaults written before it
   * would be wiped every turn. Appending afterwards is idempotent — the shared
   * `pushActiveSkill` dedupes by name+mode — and costs one state write on a
   * worker that lists any, and nothing at all on one that does not.
   *
   * `mode: "inline"` is stamped rather than read off the persisted manifest,
   * matching the matcher's own apply step and for its reason: a pre-migration
   * record can still say `"pattern"`, which the binding reader would then skip.
   */
  const appendWorkerDefaults = handler({
    name: "append-worker-default-skills",
    inputSchema,
    outputSchema: z.object({ added: z.number() }),
    flowConfigSchema: settings,
    sessionStateSchema: z.object({
      [ACTIVE_SKILLS_STATE.field]: activeSkillsArraySchema
    }),
    execute: async (_input, ctx) => {
      const names = turnConfig(ctx).skills.active;
      // The cross-field refusal the mint could not carry — see the note there.
      assertHeldSkills(names, workerSkillsOf(ctx), appSkills);
      if (names.length === 0) return { added: 0 };
      const activatedAt = Date.now();
      // The REAL delta, not `names.length`. `pushActiveSkill` dedupes by
      // name+mode, so a default the matcher already activated this turn is not
      // an addition — and a count that reports the list's length instead would
      // be wrong exactly when a slash hit and an always-on name coincide, which
      // is the case most likely to be asserted on.
      // Reported through the mutator's return rather than written outward:
      // `atomicState` may run its mutator more than once, and `withOutcome`
      // clears the outcome per invocation — so neither a re-run against fresher
      // state nor an attempt that threw and was absorbed can leave a count
      // behind for a write that never committed. `undefined` means the mutator
      // never completed, which is the same answer as nothing added.
      const added = await withOutcome(
        (mutator: (state: unknown) => Record<string, unknown>) =>
          ctx.session.atomicState(mutator),
        (current: unknown) => {
          const held = (current as Record<string, unknown> | undefined)?.[
            ACTIVE_SKILLS_STATE.field
          ];
          let entries = Array.isArray(held) ? held : [];
          const before = entries.length;
          for (const name of names) {
            entries = pushActiveSkill(entries, { name, mode: "inline", activatedAt });
          }
          return {
            state: { [ACTIVE_SKILLS_STATE.field]: entries },
            result: entries.length - before
          };
        }
      );
      return { added: added ?? 0 };
    }
  });

  const installation = options.installation;
  /**
   * The turn's worker, loaded before anything reads a setting: every read
   * below goes through `turnConfig`, which returns this worker's
   * configuration once it is loaded. It runs as the flow's request
   * `onStarted`, which runs at the start of every run of a request, a resumed
   * one included. A step of the turn would not: a resumed request injects a
   * completed step's recorded output rather than running it again, so the
   * worker would be loaded on the first run only, and a tool that waited for
   * a user would be gone when the answer arrived.
   */
  const resolveTurnWorker = handler({
    name: "agent-resolve-worker",
    inputSchema: z.unknown(),
    outputSchema: z.object({ worker: z.string().nullable() }),
    ...(installation !== undefined ? { resources: { ...installation.resources } } : {}),
    execute: async (_input, ctx) => {
      if (installation === undefined) return { worker: null };
      return { worker: (await installation.resolveWorker(ctx, share.kind)).id };
    }
  });

  const answered = sequencer({ name: "agent-run", inputSchema, flowConfigSchema: settings })
    .tapIf((_input, ctx) => turnConfig(ctx).skills.enableLlmClassifier !== true, matcherWithoutClassifier)
    .tapIf((_input, ctx) => turnConfig(ctx).skills.enableLlmClassifier === true, matcherWithClassifier)
    .tap(appendWorkerDefaults)
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

  // Appended only when the app passed one, so a no-argument call still builds
  // the sequence it built before this option existed rather than one carrying
  // an inert extra step. `.sideChain` rather than `.step`: a post-answer block
  // must not be able to change the answer, and a failure inside it — a capture
  // call that times out, say — is not a conversation failure.
  const answeredRun = options.afterAnswer
    ? answered.sideChain(afterAnswerStep(options.afterAnswer), { name: options.afterAnswer.name })
    : answered;
  // On an installation, every turn runs with its plan (FIX-2076 D1, D2): a
  // step the worker files for itself is worked after the turn, in the same
  // request, one turn of `answeredRun` each, and the worker answers once more.
  // The app's `answerAgain` is the step's second source (FIX-2159).
  const answerAgain = options.answerAgain === true ? finishedTasksAnswerAgain() : options.answerAgain;
  const run = board !== undefined ? board.planned(answeredRun, answerAgain) : answeredRun;

  // On an installation the copy declares every document a worker may be
  // granted, and each turn's model reaches only its worker's: the
  // installation's visibility rule reads the worker this turn loaded. Typed
  // as the optional fields they fill, so the flow's type is one shape either
  // way.
  const bound: AgentTurnBinding =
    installation !== undefined
      ? {
          // The session's delegates and its board's notices, server-written:
          // a create that seeds either is refused.
          session: installation.session(board?.sessionStateShape),
          resources: { ...installation.resources, ...installation.documents, ...(board?.resources ?? {}) },
          resourceVisibility: installation.resourceVisibility,
          request: { onStarted: resolveTurnWorker }
        }
      : {};

  /**
   * The refusals the settings schema cannot carry, run on a minted copy's
   * config. Two picked presets that carry different tools under one name — or
   * a held package's block and a picked preset's tool sharing one — are a
   * problem only for a worker with NO `tools:` line, which is granted both; a
   * worker that wrote a line is granted exactly that line and hires as it
   * always has. The rule reads two settings, and a flow's `configSchema` must
   * be a plain closed object that cannot refine across keys — so it runs on
   * the bag as handed over, where the unset `tools` the hire preserves is
   * still visible.
   *
   * A worker that DID write a line has one clash of its own: a name on the line
   * that is both a held package's block and a key in this flow's catalog. The
   * hire resolved it to the package block because the hire cannot see the
   * catalog; here both are visible, so it is refused rather than letting the
   * package silently shadow the catalog's tool.
   *
   * @returns The message to throw, or `undefined` when there is none.
   */
  const mintProblems = (config: z.infer<typeof settings>): string | undefined => {
    // Unset is no line even when the key is present, as the per-turn tools slot reads it.
    if (config.tools === undefined) {
      const problems = [
        ...pickedToolCollisions(workerCapabilityCatalog, config.capabilities),
        ...packageToolCollisions(workerCapabilityCatalog, config.capabilities, config[WORKER_PACKAGES_KEY] ?? [])
      ];
      return problems.length > 0 ? `This worker writes no \`tools:\` line, and it ${problems.join(" It also ")}` : undefined;
    }
    const problems = packageCatalogCollisions(
      catalog,
      config[WORKER_TOOLS_KEY] as ReadonlyArray<{ name?: unknown }> | undefined,
      config[WORKER_PACKAGES_KEY] ?? []
    );
    return problems.length > 0 ? problems.join(" ") : undefined;
  };

  return { options, settings, inputSchema, run, bound, mintProblems, answerNames, board };
}

/** What a flow on an installation declares to run the agent's turn. */
type AgentTurnBinding = {
  session?: SessionConfig;
  resources?: Record<string, DeclaredResourceEntry>;
  resourceVisibility?: ResourceVisibilityRule;
  request?: { onStarted: BlockDefinition<any, any> };
};

/** The built-in `agent` flow: the agent's turn behind its door, its workstream entries, and its task entry. */
function defineAgentFlowAround(
  options: AgentWorkerFlowOptions,
  settings: ReturnType<typeof agentWorkerTurn>["settings"],
  inputSchema: ReturnType<typeof agentWorkerTurn>["inputSchema"],
  run: ReturnType<typeof agentWorkerTurn>["run"],
  bound: AgentTurnBinding,
  mintProblems: ReturnType<typeof agentWorkerTurn>["mintProblems"],
  installation: WorkerInstallation | undefined,
  board: SessionBoard | undefined
) {
  /**
   * A task as this worker takes it: one turn of `run`, the task as the
   * message, the answer as the result. A turn that throws fails the attempt
   * through the board's ordinary error path. Tasks come from any
   * conversation's board that hands one to a worker on this flow; the
   * conversation that filed a task hears how it ended.
   */
  const taskEntry = workerTaskEntry({ name: "agent-task-turn", turn: run });

  // Only this door marks a user turn. Task, notice and workstream entries run `run` unmarked.
  const userTurn = sequencer({ name: "agent-user-turn", inputSchema }).tap(markUserTurnStep).step(run);

  const flow = defineFlow({
    kind: AGENT_FLOW,
    // Required by contract C2. A plain singleton's workers mint and are then
    // refused at REGISTRATION, one by one — which is why the goal check for
    // this flow reaches the registry rather than stopping at the mint.
    cardinality: "collection",
    // Each worker gets its own user-scoped cell when the app asks for one;
    // shared across the roster otherwise, which is the framework's default.
    isolateUserState: options.isolateUserState ?? false,
    configSchema: settings,
    ...bound,
    // `userMessage` keeps the caller's message as their turn, so a worker's
    // conversation holds both sides and survives a reload.
    // On an installation copy the session names its worker, so a turn whose
    // input names one (or carries any other key) is refused, not stripped.
    actions: {
      // A reply: its notice waits for it to end. In a task session whose task
      // is open, the line steers the task instead (FIX-2086).
      [RESPOND_ACTION]: {
        inputSchema: installation !== undefined ? inputSchema.strict() : inputSchema,
        block: steerOrTalk(userTurn),
        userMessage: (input) => input.message,
        concurrency: REPLY_CONCURRENCY
      },
      [STANDING_RULES_ACTION]: standingRulesAction,
      [SET_WORK_PROJECT_ACTION]: setWorkProjectAction,
      // On an installation: the task actions (`updateTask_tasks` and the
      // rest) over this session's board, and the four delegate actions. A
      // session whose delegates take no task answers `no_delegation_board`.
      ...(board?.actions ?? {})
    },
    internal: {
      actions: {
        // A workstream's open: creates the lead's workstream session, linked
        // at create, and runs nothing. That is what lets an agent worker lead
        // a workstream.
        [WORKSTREAM_OPENED_ENTRY]: workstreamOpenedEntry(),
        // A filing's wake runs this session's board; a task it filed ended
        // wakes this worker's turn with the notice (FIX-1802).
        ...(board?.entries(run) ?? {})
      }
    },
    task: {
      actions: {
        // A task, a coordinator's routed message among them (FIX-2083): one
        // turn of `run`, behind the claim gate, its answer the task's result.
        [WORKER_TASK_ENTRY]: taskEntry
      }
    }
  });

  /**
   * The mint, with the refusals the settings schema cannot carry
   * (`mintProblems`). After the flow's own mint, so the schema's refusals come
   * first; thrown, so the hire collects it under the worker's id.
   *
   * Every property of the defined flow is carried over unchanged: this is the
   * same flow with one more check at its door, not a different one.
   */
  const mint = (mintOptions?: Parameters<typeof flow>[0]) => {
    const worker = flow(mintOptions);
    const problem = mintProblems(worker.config as never);
    if (problem !== undefined) throw new Error(problem);
    return worker;
  };
  // It takes tasks; on an installation it also runs its delegation board.
  return declareBuiltInRoles(Object.assign(mint, flow), board === undefined ? ["contributor"] : ["contributor", "manager"]) as typeof flow;
}
