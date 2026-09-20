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
 * `docs/architecture/workforce-default-worker-kind.md`.
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
 * of what else the app's catalog carries — and, since FIX-1393, regardless of
 * what a capability attached through `uses` would otherwise contribute. Core
 * enforces that half; see `docs/architecture/capabilities.md` → *The tools
 * fence*. What the fence deliberately does NOT hold back is a framework
 * **control** a capability declares through `controlTools` — the skill loader
 * this seat switched on, the delegation board a skill it holds asked for. A
 * seat only holds those because its own config asked, and they are built
 * inside their capability and never exported, so no `tools:` list could name
 * one back in. The skills library is handed the
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
 *
 * {@link AgentWorkerFlowOptions.uses} is fenced by the framework too
 * (FIX-1393): core drops a capability's catalog-granted tools when the block
 * declares `tools:`, and this kind declares it on every seat. An app passing a
 * capability with default-on tools no longer has to turn them off to keep a
 * seat's list honest. What the fence does not touch is a capability's
 * `controlTools` — see the paragraph above.
 */

import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import { withOutcome } from "@flow-state-dev/core/helpers";
import type {
  BlockDefinition,
  DeclaredResources,
  GeneratorTool,
  InitialSkill,
  ToolCatalog,
  UsesSlot
} from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import {
  activeSkillsArraySchema,
  createSkillActivator,
  createSkillsLibrary,
  pushActiveSkill
} from "@flow-state-dev/orchestration";
import { z } from "zod";
import { SEAT_SKILLS_KEY, SEAT_TOOLS_KEY, oneNameMessage } from "./manifest";
import {
  catalogSeatCapabilities,
  resolveSeatCapabilities,
  seatCapabilityProblems,
  type SeatCapabilityCatalog,
  type SeatCapabilitySelection
} from "./seat-capabilities";
import { seatSkillSchema, workerConfigSchema } from "./worker-config";

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
  capabilities: SeatCapabilitySelection;
  /**
   * The seat's own instructions — its file's body. Optional: a bodyless worker
   * is a weak seat, not a failed hire, so the key is absent rather than empty.
   */
  instructions?: string;
  /**
   * The seat's TEAM-level instructions, imposed by the hire when its team wrote
   * any. Absent — never `""` — when the team wrote none or has no file at all.
   */
  teamInstructions?: string;
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
  /**
   * Capabilities every worker of this kind carries, composed onto the answer
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
   * and a resolver function contributes context and tools only: resources have
   * to exist before the block runs, so they must be declared statically
   * somewhere (see `UsesEntry` in `@flow-state-dev/core`). Pass a capability
   * dynamically and its stores are *not* installed by that entry alone.
   *
   * **A seat picks presets from what this option installs.** A worker file's
   * `capabilities:` key names a capability listed here and the presets that
   * seat wants; a name that is not a top-level static entry of this array is
   * refused at the mint. Selecting only ever ADDS to what the entry already
   * carries — see `./seat-capabilities`.
   *
   * **Tool-carrying presets ARE fenced** (FIX-1393). Core drops a capability's
   * catalog-granted tools when the consuming block declares `tools:`, and this
   * kind declares it on every seat — so a preset that ships a tool does not
   * reach a worker whose `tools:` is empty. Turning such presets off at the
   * preset (as the README's memory recipe does with `recall` and `connect`) is
   * still reasonable on cost grounds, but it is no longer what keeps the seat's
   * list honest. A capability's `controlTools` are exempt by design.
   */
  uses?: UsesSlot;
  /**
   * Give each worker of this kind its own user-scoped storage, instead of one
   * cell shared by every worker serving the same person. Default: false,
   * matching the framework (BP-027).
   *
   * Forwarded to the flow untouched. The key is the worker's id, so renaming
   * a worker leaves its isolated data behind under the old name — and so does
   * flipping this flag on a roster already in use.
   *
   * All-or-nothing for the kind: a roster is either all-isolated or
   * all-shared, never a mix. Mixing would need each resource to carry its own
   * `flowIsolation`, which is FIX-1396's.
   */
  isolateUserState?: boolean;
  /**
   * A block run after the worker answers, as a side-chain — it cannot change
   * the answer, and a failure in it does not fail the turn.
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
   * Omitted, the kind's sequence is exactly what it is today.
   */
  afterAnswer?: BlockDefinition<any, any>;
}

/**
 * What one worker of this kind configures, in its file.
 *
 * **Composed from the admission contract rather than written beside it.** The
 * four settings a seat's bag may carry — a worker's own instructions, its
 * team's, the skills its folders resolved, and the blocks those folders
 * registered that its `tools:` named — come from
 * `workerConfigSchema()`, and this kind's own settings are extended on at the
 * top level. That is the move every hireable kind makes, so the one kind that
 * ships with the framework teaches the rule rather than standing outside it.
 *
 * `seatSkills` is re-declared below rather than inherited untouched: the SHAPE
 * stays the contract's (`seatSkillSchema`), and the refinement on top of it is
 * this kind's, because only this kind holds the app's own skill names to
 * collide a seat's against.
 */
function settingsSchema(
  options: AgentWorkerFlowOptions,
  seatCapabilities: SeatCapabilityCatalog
) {
  const catalog = options.catalog ?? {};
  const appSkillNames = new Set((options.skills ?? []).map((skill) => skill.name));

  return workerConfigSchema().extend({
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
              `names tool "${name}", which nothing registers for this seat — neither its own ` +
              `\`blocks/\` folder nor the app's tool catalog. ` +
              `Known catalog tools: ${known.length > 0 ? known.map((k) => `"${k}"`).join(", ") : "(none — no catalog was passed to defineAgentWorkerFlow)"}. ` +
              `Put the block in this worker's own \`blocks/\` folder and re-run \`fsdev gen\`, ` +
              `pass it as \`defineAgentWorkerFlow({ catalog: { "${name}": <tool> } })\`, or drop ` +
              `it from this worker.`
          });
        }
      }),

    /**
     * The seat's own skills — the contract's key, re-declared here to add ONE
     * refinement this kind alone can make.
     *
     * The shape and the story are `workerConfigSchema()`'s: imposed by the hire
     * step, never authored, present even when empty. What is added below is the
     * collision check against `defineAgentWorkerFlow({ skills })`, which needs
     * the app's own skill names and so cannot live on a contract every kind
     * shares.
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
      .default({}),

    /**
     * The capabilities this seat picks up from what its kind carries, and the
     * presets it wants from each.
     *
     * ```yaml
     * capabilities:
     *   research: [briefing]
     * ```
     *
     * **Default empty**, which carries every installed capability's own
     * defaults — what every seat gets today. Naming presets ADDS to that; a
     * seat has no way to switch one off, because what a workforce may do is
     * the app's call and a worker file is not where it is reversed.
     *
     * Refused **at the mint**, by name: an unknown capability, an undeclared
     * preset, and the three presets that cannot travel the per-seat path (one
     * the app turned off, one on a capability with open config, and one whose
     * surface has to exist before a request runs). The whole selection is
     * validated before a seat answers anything, because a typo surfacing as a
     * failed turn in front of a user is worse than the silence this key
     * closes.
     */
    capabilities: z
      .record(z.string(), z.array(z.string()))
      .default({})
      .superRefine((selection, ctx) => {
        for (const message of seatCapabilityProblems(seatCapabilities, selection)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message });
        }
      })
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
 * The one-name rule over the app's catalog, at the kind's construction door.
 *
 * Checked here and not at the scan because the catalog is a **kind-construction
 * argument**: it covers a hand-built map exactly as it covers a generated one,
 * and it leaves a block used only as a flow action alone. Thrown rather than
 * collected — a kind is built once, at module scope, so there is no roster to
 * report against and nothing else this call could usefully go on to do.
 *
 * Every mismatch is named in one message, for the reason `hireWorkforce`
 * collects: an author fixing a catalog should see the whole list in one run.
 */
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
 * **The gap this closes, and why it is not obvious.** A seat reaches its tools
 * through the `tools:` slot below, which is a resolver that runs per turn off
 * `ctx.flow.config`. `defineFlow` collects `declaredResources` by a STATIC walk
 * over the flow's action blocks (`defineFlow.ts`), and nothing a runtime
 * resolver returns was ever an action block — so a catalog tool that declares a
 * store was hired, advertised to the model, called, and found no handle, while
 * the turn reported success. Declaring them on the generator puts them back
 * inside the walk that installs them, as BLOCK-level declarations on the very
 * block that calls the tools, which keeps each one's own prefetch mode intact.
 *
 * Kind-wide by construction, and deliberately: the catalog is the kind's, so
 * its stores belong to every seat of it — including seats whose `tools:` never
 * name the tool. That is the same bill `uses` already presents, and it is why
 * this is safe where collecting a SEAT's declarations would not be.
 */
/**
 * Whether any catalog tool declared that it needs org context.
 *
 * The SECOND axis of the gap {@link catalogDeclaredResources} closes, and it
 * has to be closed the same way: `defineFlow` collects `requiresOrg` from the
 * flow's action blocks, and nothing a per-turn `tools:` resolver returns was
 * ever one. Left alone, a block that DECLARED it needs an org runs without one,
 * and the transport that would have refused the request is told the flow has no
 * such requirement — a declaration that silently does not bind, which is the
 * defect class this whole seam exists to remove.
 *
 * Raised on the kind, for every seat of it, for the reason the resources are:
 * the catalog is already kind-wide, so this installs no requirement the kind
 * was not already scoped for.
 */
function catalogRequiresOrg(catalog: ToolCatalog): boolean {
  for (const tool of Object.values(catalog)) {
    if ((tool as { requiresOrg?: boolean }).requiresOrg === true) return true;
  }
  return false;
}

function catalogDeclaredResources(catalog: ToolCatalog): DeclaredResources | undefined {
  const merged: DeclaredResources = {};
  /** Accessor key → the catalog key that claimed it, so a clash can name both. */
  const claimedBy: Record<string, string> = {};

  for (const [key, tool] of Object.entries(catalog)) {
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
  // Before anything is built from it. A catalog key that disagrees with its
  // block's own name would hand the model a tool no seat's `tools:` can
  // authorize, and the kind is the door that holds the map.
  assertOneNamePerCatalogEntry(catalog);
  // What the catalog's own blocks need, so the flow installs it. See the
  // function's note: without this a catalog tool that declares a store is
  // advertised with nothing behind it.
  const catalogResources = catalogDeclaredResources(catalog);
  const catalogNeedsOrg = catalogRequiresOrg(catalog);
  // Read once, here: it is what a seat's `capabilities:` is validated against
  // at the mint AND what the per-seat entry below resolves through, and two
  // readings of one `uses` array is how the two halves drift apart.
  const seatCapabilityCatalog = catalogSeatCapabilities(options.uses);
  const settings = settingsSchema(options, seatCapabilityCatalog);
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
   * What THIS seat's own file added on top of the kind's capabilities — the
   * presets it named that the kind does not already carry.
   *
   * A dynamic entry because it is the only `uses` slot that can see a seat: a
   * kind is built once and hired many times, so a static entry is resolved
   * before any seat exists. It carries the DELTA only; every capability stays
   * on its own static entry, which is what keeps a preset from being resolved
   * on both paths (the framework merges the two independently and dedupes
   * across neither).
   *
   * Appended only when the kind installs something selectable, so a kind that
   * passes no `uses` builds exactly the block it built before this key existed
   * rather than one carrying an inert dynamic resolver.
   */
  const seatCapabilities = (ctx: BlockContext) =>
    resolveSeatCapabilities(
      seatCapabilityCatalog,
      (ctx.flow.config as Partial<SeatConfig> | undefined)?.capabilities
    );
  const usesEntries = [
    ...(options.uses ?? []),
    ...(seatCapabilityCatalog.size > 0 ? [seatCapabilities] : [])
  ];

  const answerWith = (binding: ReturnType<typeof skills.with>, name: string) =>
    generator({
      name,
      inputSchema,
      flowConfigSchema: settings,
      itemVisibility: { client: true, history: true },
      // What the app's catalog tools declare, declared here so `defineFlow`'s
      // static walk installs it — see `catalogDeclaredResources`. Omitted
      // entirely when the catalog declares nothing, so a kind built without one
      // is byte-for-byte the block it was before this existed.
      ...(catalogResources !== undefined ? { resources: catalogResources } : {}),
      // The second axis, declared on the same block and for the same reason —
      // see `catalogRequiresOrg`. Omitted entirely when no catalog tool asks
      // for it, so a kind built without one is the block it was before.
      ...(catalogNeedsOrg ? { requireOrg: true as const } : {}),
      // The skills binding stays FIRST and is never displaced: an app's own
      // capabilities compose beside it. That is what the `uses` option is for.
      uses: [binding, ...usesEntries],
      // The prompt seam — A MARKED INSERTION POINT, NOT AN ABSTRACTION.
      //
      // Two layers, in this order every time: the seat's TEAM speaks first,
      // the seat's own file last. The array is the framework's own prompt
      // slot, which resolves each entry, drops the absent ones and joins the
      // rest — so the filter and the join stay the framework's single rule
      // instead of a second copy of it living here.
      //
      // Each resolver returns `undefined` rather than `""` for an absent
      // layer, and that is load-bearing rather than stylistic: the slot drops
      // `null`/`undefined` but keeps `""`, so an empty string would survive
      // the filter and show up as a leading blank line in the prompt of every
      // seat whose team wrote nothing.
      //
      // WHAT THE ORDER BUYS, AND WHAT IT DOES NOT. The position is fixed and
      // checkable, and that is the whole promise. It is NOT a precedence rule.
      // Assembly on this path is plain concatenation with no override,
      // precedence or conflict-resolution mechanism anywhere in it, so if a
      // team says *never touch production* and a seat says *restart the
      // production queue*, what happens is whatever the MODEL does with two
      // contradictory sentences. No doc line, test or PR sentence here should
      // claim the seat's text "wins": a check on the composed string proves
      // order, which is a neighbour of precedence and not precedence. Making
      // the seat's line genuinely win would mean resolving contradictions
      // before the prompt is sent — a different and much larger feature.
      //
      // The shared default worker system prompt is still unshipped and still
      // owned elsewhere; per contract C1 this kind consumes it and defines no
      // second one. When it lands it goes at the FRONT of this array — the
      // framework, then the team, then the seat — and nothing else moves. Do
      // not grow this into a compose helper, a registry or a type: an org-wide
      // fourth layer is the point at which the seam should be re-decided
      // rather than widened a second time.
      prompt: [
        (_input, ctx) => ctx.flow.config.teamInstructions,
        (_input, ctx) => ctx.flow.config.instructions
      ],
      model: (_input, ctx) => ctx.flow.config.model,
      // The seat's declared tools, both halves. `tools` holds the names that
      // resolved to the app's CATALOG; `seatTools` holds the blocks that
      // resolved to this seat's own folders, already resolved at the hire step
      // so this slot stays an O(1) read — it runs before every step of every
      // turn. The generator's fence sees ONE declared list and cannot tell
      // which half a tool came from, which is the point: a colocated block is
      // not an exemption from the fence, it joins the declaration.
      tools: (_input, ctx): GeneratorTool[] => {
        const named = ctx.flow.config.tools.map((toolName) => catalog[toolName] as GeneratorTool);
        const own = ctx.flow.config[SEAT_TOOLS_KEY] as GeneratorTool[] | undefined;
        // Materialized only when the seat has both, which is the uncommon case.
        if (own === undefined || own.length === 0) return named;
        return named.length === 0 ? own : [...named, ...own];
      },
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

  const answered = sequencer({ name: "agent-run", inputSchema, flowConfigSchema: settings })
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
