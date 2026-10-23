/**
 * The worker factory: a worker record becomes one addressable, configured copy of
 * a flow the app already defined.
 *
 * The design fact the rest of this file follows from: the flow's own closed
 * `configSchema` is the only gatekeeper. This module reads `flow` and
 * `description` and hands over everything else — a worker's instructions
 * included, as one setting, `instructions`.
 *
 * **A bag goes to every record, and every record meets its worker flow's schema.**
 * There is no probe of what a worker flow happens to declare and no thin record that
 * mints without being admitted, because the one silent branch a probe has —
 * *this flow did not declare the key, so say nothing* — is exactly the failure
 * this step exists to remove. A worker flow whose schema cannot take that bag refuses,
 * loudly, for the whole roster, at boot — and composing `workerConfigSchema()`
 * is how a worker flow makes sure it can.
 *
 * **Before any record, the flows themselves.** The app's worker
 * flows, the built-in `agent` among them, are checked against the worker
 * contract (`worker-flow-contract.ts`) once per flow, and any problem refuses
 * the whole call: no flow is registered and no worker is hired over one. A
 * worker then resolves to a registered flow — `agent` when it names none —
 * and a flow the app keeps for declared workers refuses a hired worker.
 */

import type {
  ActionConfig,
  BlockDefinition,
  DeclaredResourceEntry,
  FlowInstance,
  FlowType,
  OrgConfig,
  RequestConfig,
  SessionConfig,
  UserConfig
} from "@flow-state-dev/core/types";
import type { DeclaredResources } from "@flow-state-dev/core";
import type { ZodTypeAny } from "zod";
import {
  INSTRUCTIONS_KEY,
  PACKAGES_KEY,
  REFUSED_PERSONA_KEY,
  REFUSED_PERSONA_KEY_MESSAGE,
  REFUSED_WORKER_ID_KEY_MESSAGE,
  REFUSED_WORKER_PACKAGES_KEY_MESSAGE,
  REFUSED_WORKER_SKILLS_KEY_MESSAGE,
  REFUSED_WORKER_TOOLS_KEY_MESSAGE,
  REFUSED_TEAM_INSTRUCTIONS_KEY_MESSAGE,
  WORKER_ID_KEY,
  WORKER_PACKAGES_KEY,
  WORKER_SKILLS_KEY,
  WORKER_TOOLS_KEY,
  TEAM_INSTRUCTIONS_KEY,
  colocatedResourceMessage,
  oneNameMessage,
  type WorkerManifest
} from "./manifest";
import { AGENT_FLOW, defineAgentWorkerFlow } from "./agent-worker-flow";
import { readDeclaredFlow } from "./declared-flow";
import {
  WORKER_RESOURCES_KEY,
  parseWorkerResources,
  resolveWorkerResources,
  verifyWorkerNarrowing,
  type WorkerResourceGrant
} from "./worker-resources";
import {
  WORKER_REFERENCES_KEY,
  applyReferenceWall,
  verifyWorkerReferenceWall
} from "./worker-references";
import { heldPackageProblems, resolveHeldPackages } from "./worker-packages";
import { recordWorkerDescription } from "./worker-description";
import { workerFlowProblems } from "./worker-flow-contract";
import { isWorkerFlowBuilder, type WorkerFlowBuilder } from "./workers/worker-flow";
import { builtInRolesOf, type WorkerRole } from "./worker-roles";

/**
 * The keys the factory itself reads. Everything else is the worker's settings.
 *
 * `name` is the worker's display name, for people only: views read it off the
 * worker's rows, and no worker flow is handed it.
 *
 * `resources`, `references` and `packages` join them rather than travelling to
 * the worker flow as settings: each is an instruction to THIS step about what to mint
 * the worker with, not a value any worker flow declares. A flow that happened to declare a
 * setting of either name no longer receives an authored one — both keys are
 * public and pinned here, and a worker file cannot mean two things at once.
 */
const RESERVED_KEYS = [
  "flow",
  "description",
  "name",
  WORKER_RESOURCES_KEY,
  WORKER_REFERENCES_KEY,
  PACKAGES_KEY
] as const;

/**
 * The stock `agent` flow, built once for the life of the module.
 *
 * Held here rather than exported: an app that wants a different one registers
 * its own under `agent` (`workerFlows: { agent: defineAgentWorkerFlow({ ... }) }`),
 * which merges over this one. Define once, hire many — never per hire or per request.
 */
const builtInAgentWorkerFlow = defineAgentWorkerFlow() as unknown as AnyFlowType;

/**
 * One entry of {@link HireOptions.workerFlows}: a flow; a flow with whether
 * this app keeps it for declared workers and the roles it declares; or a
 * `workerFlow(...)` builder the installation builds on itself.
 *
 * `roles` is what the flow does beside taking a user's message on `respond`:
 * `contributor` (takes tasks on `work`), `manager` (runs its delegation board
 * on `dispatch`), `coordinator` (routes messages; the built-in coordinator's).
 * The hire checks each declared role's entries, and refuses a role's piece on
 * a flow that doesn't declare it. Omitted, a flow has no role beyond every
 * worker's; a built-in flow declares its own.
 */
export type WorkerFlowEntry =
  | AnyFlowType
  | { flow: AnyFlowType; standardOnly?: boolean; roles?: readonly WorkerRole[] }
  | WorkerFlowBuilder;

/** One worker flow as a hire resolves a `flow:` against it. */
export type ResolvedWorkerFlow = { flow: AnyFlowType; standardOnly: boolean; roles: readonly WorkerRole[] };

/**
 * The worker flows a hire resolves a `flow:` against: the built-in `agent`
 * underneath the app's map, so the app's own `agent` wins,
 * each entry read as a flow and its standard-only flag.
 *
 * Unchecked: {@link hireWorkforce} checks every one before any worker runs.
 * Shared with the roster's per-row check (`roster/check.ts`), which decides a
 * stored worker's flow is gone before anything is minted, and has to decide it
 * against exactly this map.
 */
export function resolveWorkerFlows(
  workerFlows: HireOptions["workerFlows"]
): Record<string, ResolvedWorkerFlow> {
  const all: Record<string, WorkerFlowEntry> = { [AGENT_FLOW]: builtInAgentWorkerFlow, ...workerFlows };
  const resolved: Record<string, ResolvedWorkerFlow> = {};
  for (const [name, entry] of Object.entries(all)) {
    if (isWorkerFlowBuilder(entry)) {
      throw new Error(
        `Worker flow "${name}" is a workerFlow(...) builder, which is built on an installation: ` +
          `pass it to createWorkerInstallation({ workerFlows }).`
      );
    }
    resolved[name] =
      typeof entry === "function"
        ? { flow: entry, standardOnly: false, roles: builtInRolesOf(entry) ?? [] }
        : { flow: entry.flow, standardOnly: entry.standardOnly === true, roles: entry.roles ?? builtInRolesOf(entry.flow) ?? [] };
  }
  return resolved;
}

/**
 * Each flow's contract problems, by the name and roles it was registered
 * under — kept for the life of the flow definition, so a flow is checked once
 * however many hires, reloads and runtime hires resolve against it, and two
 * registrations with different roles never share a verdict.
 */
const contractVerdicts = new WeakMap<object, Map<string, readonly string[]>>();

function contractProblemsOf(name: string, { flow, roles }: ResolvedWorkerFlow): readonly string[] {
  let byRegistration = contractVerdicts.get(flow);
  if (byRegistration === undefined) {
    byRegistration = new Map();
    contractVerdicts.set(flow, byRegistration);
  }
  const key = JSON.stringify([name, roles]);
  let problems = byRegistration.get(key);
  if (problems === undefined) {
    problems = workerFlowProblems(name, flow as never, roles);
    byRegistration.set(key, problems);
  }
  return problems;
}

/**
 * Refuse unless every worker flow meets the contract — every problem with
 * every flow in one error, so an author fixes them in one pass. Exported for
 * `hireWorkforce` (`workers/register.ts`), not from the package root.
 */
export function checkWorkerFlows(flows: Record<string, ResolvedWorkerFlow>): void {
  const refused: string[] = [];
  const problems: string[] = [];
  for (const name of Object.keys(flows).sort()) {
    const found = contractProblemsOf(name, flows[name]!);
    if (found.length === 0) continue;
    refused.push(name);
    problems.push(...found);
  }
  if (problems.length === 0) return;
  throw new Error(
    `hireWorkforce refused ${refused.length} worker flow${refused.length === 1 ? "" : "s"} ` +
      `(${refused.map((name) => `"${name}"`).join(", ")}); nothing was hired:\n  - ${problems.join("\n  - ")}`
  );
}

function availableFlows(flowNames: readonly string[]): string {
  return flowNames.length > 0 ? flowNames.map((k) => `"${k}"`).join(", ") : "(none)";
}

function missingFlowReason(flow: string, available: string): string {
  return `names flow "${flow}", which is not in the worker flows passed to hireWorkforce. Worker flows passed: ${available}`;
}

/**
 * Why a hired worker can't run on `flow`: the app keeps it for
 * the workers its files define. `defaulted` when the worker named no flow and
 * `agent` is the default it fell to.
 */
export function standardOnlyReason(flow: string, defaulted: boolean): string {
  return (
    `${defaulted ? `names no flow, so it runs on "${flow}"` : `names flow "${flow}"`}, which this ` +
    `app keeps for declared workers, the ones its WORKER.md files define. A hired worker can't run ` +
    `on it`
  );
}

/**
 * What {@link hireWorkforce} throws when every refusal came from a worker flow's own
 * minter (its `configSchema`), and none from the framework. The message is
 * the ordinary refusal; the type lets a runtime hire say the caller can
 * correct the settings and try again, which no framework refusal allows.
 */
export class WorkerFlowRefusedHireError extends Error {}

function hireRefusalMessage(refused: number, total: number, problems: readonly string[]): string {
  return (
    `hireWorkforce refused ${refused} of ${total} worker${total === 1 ? "" : "s"}; ` +
    `nothing was hired:\n  - ${problems.join("\n  - ")}`
  );
}

/**
 * The reasons a one-worker {@link hireWorkforce} call refused `workerId` for,
 * each without the call's header or the worker's name in front of it: the
 * sentences a caller that names the worker itself shows. Reads the message
 * {@link hireRefusalMessage} builds, so the two stay in one file.
 *
 * @param error What `hireWorkforce` threw.
 * @param workerId The one worker it was given.
 * @returns The reasons, or the whole message when it isn't a hire refusal.
 */
export function hireRefusalReasons(error: unknown, workerId: string): string[] {
  const message = error instanceof Error ? error.message : String(error);
  const [head, ...lines] = message.split("\n  - ");
  if (!head?.startsWith("hireWorkforce refused") || lines.length === 0) return [message];
  const prefix = `worker "${workerId}" — `;
  return lines.map((line) => (line.startsWith(prefix) ? line.slice(prefix.length) : line));
}

/**
 * What `hireWorkforce` throws for one record whose only fault is a flow it was
 * not passed — the same sentence, built without a hire.
 *
 * The roster's per-row check names a stored worker whose flow is gone before it
 * mints anything, and the boot report it feeds must not change wording because
 * of that. One builder for both is what keeps them saying the same thing.
 *
 * @param manifestId The record's id (a hired worker's address).
 * @param flow The flow it names.
 * @param workerFlows The app's worker flows, as passed to `hireWorkforce`.
 */
export function missingWorkerFlowRefusal(
  manifestId: string,
  flow: string,
  workerFlows: HireOptions["workerFlows"]
): string {
  const available = availableFlows(Object.keys(resolveWorkerFlows(workerFlows)));
  return hireRefusalMessage(1, 1, [`worker "${manifestId}" — ${missingFlowReason(flow, available)}`]);
}

export interface HireOptions {
  /**
   * The app's worker flows, by name — `defineFlow(...)` results,
   * passed directly, or `{ flow, standardOnly: true }` for a flow kept for the
   * workers the app's WORKER.md files define. A record's `flow` names one, and
   * it is called once per worker to mint that worker's copy.
   *
   * Every flow here, and the built-in `agent` under them, is checked against
   * the worker contract before any worker is hired: it takes the configuration
   * a hire supplies, has one door, and declares any resource with `writtenBy`
   * through `sharedResource()` (`workerFlowProblems`). One problem refuses the whole call.
   *
   * Optional: the built-in `agent` flow is always available underneath, so a
   * roster of records that name no flow needs none of these. Passing a flow
   * under `agent` replaces the built-in for every worker, and its
   * `standardOnly` is the entry's.
   *
   * Standard-only is checked after the `agent` default: a hired worker (a
   * runtime hire or a stored roster row, org-visible or private: any record
   * carrying an owner) that names no flow is refused when `agent` is kept
   * for declared workers.
   */
  workerFlows?: Record<string, WorkerFlowEntry>;

  /**
   * The blocks each worker's own folders REGISTER, keyed by worker id and then by
   * block name — `fsdev gen`'s `workerBlocks` export, passed straight through.
   *
   * **Registration, not a grant.** An entry here makes that name resolvable by
   * that worker; the worker's `tools:` is still what decides whether it may call
   * it, and a registered block the file never names is not on the model's
   * toolset. A name resolves worker folder → team folder → the app's catalog,
   * first match wins; the first two arrive here already collapsed by the
   * generated map, and this step is where the last hop happens.
   *
   * Per worker and never installed on the worker flow: a flow's capabilities and
   * resources are shared by every worker of it, so one worker's folder installed
   * there would change every sibling. That is why a block here may USE a store
   * the flow has and may not DECLARE one — see
   * {@link colocatedResourceMessage}.
   *
   * Optional. Omitted, every worker hires exactly as it did before this existed.
   */
  workerBlocks?: Record<string, Record<string, BlockDefinition<any, any>>>;

  /**
   * The blocks each package carries, keyed by the package's address and then
   * by block name — `fsdev gen`'s `packageBlocks` export, passed straight
   * through.
   *
   * A package's blocks reach only the workers that HOLD the package: the ones
   * with it in their own `packages/` folder, and the ones whose `packages:`
   * line takes it from their team's or the org's library. They are never put
   * in a worker flow's catalog, so no other worker can name them. A worker holding a
   * package with no `tools:` line can call every block in it; a worker that
   * writes a `tools:` line can call the ones it lists.
   *
   * Optional. Omitted, a held package brings its instructions and no tools.
   */
  packageBlocks?: Record<string, Record<string, BlockDefinition<any, any>>>;


  /**
   * The documents this app declared, keyed by ref — the map
   * `resourcesFromDocs(documents)` returns, handed over unchanged.
   *
   * **Handed over, never worked out.** A worker's `resources:` grant narrows the
   * DOCUMENTS in the map its worker flow declares at flow level and leaves the rest of
   * that map — the app's boards, its stores — standing. Telling a document from
   * a board is what this answers, and the app is the only party that knows:
   * inferring it from an entry's shape would make the boundary of a permission
   * feature rest on a heuristic, and a board that happened to look like a
   * document would become grantable.
   *
   * The same list the app already spreads into its own flow-level map, so there
   * is one catalog and not a second table describing the same documents.
   *
   * Optional, and consulted only for a worker that declares `resources:`. A
   * roster where no worker does hires exactly as it did before this existed. A
   * worker that DOES declare one while this is absent refuses, rather than
   * resolving every ref to nothing — a lockout that reads like a typo.
   */
  documents?: DeclaredResources;

  /**
   * The references this app declared, keyed by ref — the map
   * `referencesFromDocs(references)` returns, handed over unchanged.
   *
   * **Handed over for the reason `documents` is, and used for more.** It says
   * which entries on a worker flow's map are references, which is what the derived
   * tree wall narrows: a worker reaches the references at or above its place in
   * the tree, and no others. That wall applies whether or not the worker declares
   * `references:` — the key narrows within it, and can never widen past it.
   *
   * Optional. Absent, no entry is a reference, no wall applies, and every worker
   * is minted exactly as it was before this existed.
   *
   * A ref may not appear in both this map and {@link HireOptions.documents}:
   * the two behave differently and one accessor cannot be both, so the pair is
   * refused rather than resolved.
   */
  references?: DeclaredResources;
}

/** The type arguments every `FlowOf` shares: any actions, scopes and resources. */
type WideFlowType<TConfigSchema extends ZodTypeAny | undefined> = FlowType<
  Record<string, ActionConfig>,
  SessionConfig | undefined,
  RequestConfig | undefined,
  UserConfig | undefined,
  OrgConfig | undefined,
  Record<string, DeclaredResourceEntry>,
  TConfigSchema
>;

/**
 * A flow whose settings schema is `TConfigSchema`, whatever it declares elsewhere.
 *
 * `FlowType`'s properties as they are, and its call signature re-declared as a
 * method, so it is checked bivariantly. Under `strictFunctionTypes` (any app on
 * `strict: true`) the call's `options` are checked contravariantly, and a flow
 * that declares a session — every worker flow does — takes narrower options than
 * the wide ones, so `defineFlow(...)` itself would not be accepted.
 *
 * `Omit<…, never>` keeps the properties and drops the original call signature;
 * intersecting `WideFlowType` itself would keep it, and the strict check with it.
 * `bivariantCall` is a type-only name: nothing calls it.
 */
type FlowOf<TConfigSchema extends ZodTypeAny | undefined> = Omit<WideFlowType<TConfigSchema>, never> &
  {
    bivariantCall(
      options?: Parameters<WideFlowType<TConfigSchema>>[0]
    ): ReturnType<WideFlowType<TConfigSchema>>;
  }["bivariantCall"];

/**
 * A flow of either shape: one that declares settings, and one that declares
 * none.
 *
 * **Do not collapse this union to one shape.** It reads redundant and is not:
 * a flow's settings schema sits in an invariant position (`config` is a
 * deferred conditional on it), so neither half accepts the other's flows, and
 * both sorts are hired here. Each collapse fails a different way, and both were
 * hit while writing this:
 *
 * - bare `FlowType` pins `TConfigSchema` to its own default, `undefined`, so it
 *   means "a flow that declares no settings". A configured flow is rejected —
 *   *Type 'ZodObject<…>' is not assignable to type 'undefined'*.
 * - `FlowOf<ZodTypeAny>` alone flips that failure onto the settings-less flow a
 *   thin worker is hired into — *Type 'undefined' is not assignable to type
 *   'ZodTypeAny'*.
 */
type AnyFlowType = FlowOf<ZodTypeAny> | FlowOf<undefined>;

/**
 * The one unsound spot, and deliberately here rather than at every call site: a
 * flow's bag type belongs to that one definition, while a roster's settings are
 * data whose shape is unknown until run time. The flow's `configSchema` checks
 * it at the mint, per worker, so a type here would only restate a guarantee
 * made somewhere else.
 */
function minter(
  flow: AnyFlowType
): (options: {
  id: string;
  config?: Record<string, unknown>;
  resources?: DeclaredResources;
}) => FlowInstance {
  return flow as unknown as (options: {
    id: string;
    config?: Record<string, unknown>;
    resources?: DeclaredResources;
  }) => FlowInstance;
}

/** The worker's settings bag: what the record declared, minus the reserved keys. */
function settingsOf(manifest: WorkerManifest): Record<string, unknown> {
  const settings: Record<string, unknown> = { ...manifest.declared };
  for (const key of RESERVED_KEYS) delete settings[key];
  return settings;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Why one worker's own block registry cannot be used as written — every reason,
 * or an empty list.
 *
 * Checked against the REGISTRY rather than against the names the worker declared,
 * on purpose: registering a name is a promise that the name resolves to
 * something callable, so a registry the framework cannot keep that promise over
 * is broken whether or not this particular worker happens to name it. Waiting
 * until it is named would make the same tree pass or fail depending on one line
 * of a Markdown file.
 *
 * Collected, not thrown, so one run names every problem — the bargain the rest
 * of this step makes.
 */
function workerBlockProblems(registry: Record<string, BlockDefinition<any, any>>): string[] {
  const problems: string[] = [];
  for (const [key, block] of Object.entries(registry)) {
    const blockName = (block as { name?: unknown }).name;
    if (typeof blockName === "string" && blockName !== key) {
      problems.push(oneNameMessage(key, blockName, "This worker's own folder"));
    }
    const declared = (block as { declaredResources?: Record<string, unknown> }).declaredResources;
    const accessors = declared === undefined ? [] : Object.keys(declared);
    if (accessors.length > 0) problems.push(colocatedResourceMessage(key, accessors));
  }
  return problems;
}

/**
 * Split a worker's declared tool names by where each one resolved.
 *
 * The worker's own registry is nearer than the app's catalog, so it answers first
 * — the worker → team → org precedence, with the first two already collapsed
 * onto the registry. What resolved there becomes a live block on
 * {@link WORKER_TOOLS_KEY}; what did not stays a NAME on `tools`, which is what
 * the worker flow checks its catalog against.
 *
 * A `tools:` that is not an array of strings is left exactly as the author
 * wrote it: the flow's own schema is what refuses a malformed setting, and
 * guessing here would refuse it twice, differently.
 */
function resolveDeclaredTools(
  declared: unknown,
  registry: Record<string, BlockDefinition<any, any>>
): { catalogNames: unknown; workerTools: Array<BlockDefinition<any, any>> } {
  if (!Array.isArray(declared) || declared.some((name) => typeof name !== "string")) {
    return { catalogNames: declared, workerTools: [] };
  }
  const catalogNames: string[] = [];
  const workerTools: Array<BlockDefinition<any, any>> = [];
  for (const name of declared as string[]) {
    if (Object.hasOwn(registry, name)) workerTools.push(registry[name]!);
    else catalogNames.push(name);
  }
  return { catalogNames, workerTools };
}

/**
 * Build the configured flow copy each worker record runs as, ordered by id,
 * without registering any of them: what a worker's configuration is checked
 * against when it is saved and on every turn (`createWorkerInstallation`).
 * The installation's flows are registered once each, by `hireWorkforce`.
 *
 * Every problem throws, but they are collected first, so one call names all
 * of them. Nothing is returned partially.
 *
 * @param manifests The roster — from the loader, or hand-built.
 * @param options   `workerFlows`: the worker flows the app defined.
 *                  Optional — the built-in `agent` flow is always available
 *                  underneath, and a flow passed under `agent` replaces it for
 *                  every worker.
 * @returns One `FlowInstance` per record, ordered by id. Not for registering.
 * @throws If a worker flow misses the contract (naming every problem with
 *   every flow), or if any record cannot be hired (naming every bad worker).
 */
export function mintWorkers(
  manifests: WorkerManifest[],
  options: HireOptions = {}
): FlowInstance[] {
  // The built-in sits UNDERNEATH the caller's, so a caller who registers their
  // own `agent` wins — for every worker, not just the ones that name it. This is
  // precedence, not extension: configuring the built-in's tools or skills means
  // replacing the worker flow (`defineAgentWorkerFlow({ ... })` registered here), never a
  // second option on this function. A roster hired with `workerFlows: {}`
  // therefore carries an empty tool catalog, because nothing ever merges into
  // ours.
  const flows = resolveWorkerFlows(options.workerFlows);

  // The flows before any record: a worker flow that misses the contract is
  // the app's problem, not one worker's, so it refuses the call
  // whatever the roster holds — an empty one included.
  checkWorkerFlows(flows);

  // One ref cannot be both a document and a reference. Checked here as well as
  // at the loader, the same two-door reason every other refusal in this file
  // has: a hand-built catalog never passes the loader. Thrown rather than
  // collected — it is the app's wiring, not one worker's file, so there is no
  // worker to report it against and no roster that hires correctly around it.
  const bothFlows = Object.keys(options.references ?? {}).filter((ref) =>
    Object.hasOwn(options.documents ?? {}, ref)
  );
  if (bothFlows.length > 0) {
    throw new Error(
      `hireWorkforce was given ${bothFlows.map((ref) => `"${ref}"`).join(", ")} as both a ` +
        `document and a reference. One ref is one accessor, and the two behave differently — a ` +
        `reference is read from its file and sealed, a document seeds a row and then evolves — ` +
        `so whichever won would be a coin flip. Keep one: leave the file in \`resources/\`, or ` +
        `move it to \`references/\`.`
    );
  }

  const available = availableFlows(Object.keys(flows));

  const ordered = [...manifests].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const workers: FlowInstance[] = [];
  const problems: string[] = [];
  // Which WORKERS were refused, which is not `problems.length`: one worker can
  // contribute several reasons — two unresolved grants, two malformed entries —
  // and counting sentences is how `refused 2 of 1 worker` gets printed.
  const refusedWorkers = new Set<string>();
  // The workers whose one refusal came from their worker flow's own minter.
  const flowRefusedWorkers = new Set<string>();
  const seen = new Set<string>();
  const workerBlocks = options.workerBlocks ?? {};
  const packageBlocks = options.packageBlocks ?? {};

  for (const manifest of ordered) {
    const refuse = (reason: string): void => {
      problems.push(`worker "${manifest.id}" — ${reason}`);
      refusedWorkers.add(manifest.id);
    };

    // Caught here as well as at the registry so it reads as a ROSTER problem,
    // reported alongside the others rather than on its own later.
    if (seen.has(manifest.id)) {
      refuse("declared twice in this roster; a worker's id is its address and must be unique");
      continue;
    }
    seen.add(manifest.id);

    const settings = settingsOf(manifest);

    // The refused key, caught before anything else looks at the bag.
    // Checked here as well as in the loader because a hand-built roster never
    // passes the loader, and this is the key the factory itself imposes.
    //
    // Left to fall through, it reaches the flow as an ordinary setting. A flow
    // whose schema has been renamed refuses it, but as `"persona" is not a
    // declared setting` — which reads as a misspelt setting, not as a key the
    // framework refuses. The case that has to be caught here is the other one: a
    // flow whose `configSchema` has NOT been renamed still declares `persona`
    // and so accepts it, and the worker hires configured the old way carrying no
    // `instructions` at all, with nothing said anywhere.
    if (Object.hasOwn(settings, REFUSED_PERSONA_KEY)) {
      refuse(REFUSED_PERSONA_KEY_MESSAGE);
      continue;
    }

    // The other imposed key, refused here for the same reason: a hand-built
    // roster never passes the loader, and a flow whose `configSchema` declares
    // `workerSkills` would accept an authored one and run with a skill set no
    // folder backs.
    if (Object.hasOwn(settings, WORKER_SKILLS_KEY)) {
      refuse(REFUSED_WORKER_SKILLS_KEY_MESSAGE);
      continue;
    }

    // The third contract key, refused for the sharper version of the same
    // reason. Every hireable worker flow now DECLARES `teamInstructions` by composing
    // the contract, so an authored one would not be caught by the closed
    // schema the way an undeclared key is — it would be accepted, and the worker
    // would run on team instructions its team never wrote. A team's
    // instructions belong to its team.
    if (Object.hasOwn(settings, TEAM_INSTRUCTIONS_KEY)) {
      refuse(REFUSED_TEAM_INSTRUCTIONS_KEY_MESSAGE);
      continue;
    }

    // The fourth contract key, refused for the reason the other two imposed
    // keys are: a worker flow composing the contract declares it, so an authored one
    // would be accepted and the worker would run carrying tools no folder of its
    // backs — silently, and only for that worker.
    if (Object.hasOwn(settings, WORKER_TOOLS_KEY)) {
      refuse(REFUSED_WORKER_TOOLS_KEY_MESSAGE);
      continue;
    }

    // The fifth, for the same reason: a worker carrying packages no folder of
    // its holds.
    if (Object.hasOwn(settings, WORKER_PACKAGES_KEY)) {
      refuse(REFUSED_WORKER_PACKAGES_KEY_MESSAGE);
      continue;
    }

    // The sixth, and the sharpest case: an authored `workerId` would be accepted
    // by every composed worker flow, and the worker would sign what it files or posts
    // as whichever worker the record named.
    if (Object.hasOwn(settings, WORKER_ID_KEY)) {
      refuse(REFUSED_WORKER_ID_KEY_MESSAGE);
      continue;
    }

    // A body is instructions; whitespace is not. An empty string handed to a
    // flow that declares `instructions` would be a worse lie than omitting it —
    // and it would turn every thin worker into a failed hire.
    if (manifest.body.trim().length > 0) {
      if (Object.hasOwn(settings, INSTRUCTIONS_KEY)) {
        refuse(
          `declares "${INSTRUCTIONS_KEY}" in its frontmatter and carries a body — two sources for ` +
            `one setting, and there is no precedence rule. Remove one: a worker's instructions are ` +
            `handed to its flow as "${INSTRUCTIONS_KEY}".`
        );
        continue;
      }
      // Verbatim: the check is on the trimmed body, the value is the body.
      settings[INSTRUCTIONS_KEY] = manifest.body;
    }

    // The refusal that stood here SPLITS; it does not disappear. One condition
    // used to refuse an absent `flow:` and a whitespace-only one alike. Only
    // an ABSENT key now resolves to the built-in.
    //
    // Which case the `flow:` is in is `readDeclaredFlow`'s call (its doc
    // carries why a key holding `null` is present, not absent). The sentences
    // stay here: they are this door's words.
    const declaredFlow = readDeclaredFlow(manifest.declared, AGENT_FLOW);

    if ("refused" in declaredFlow && declaredFlow.refused === "blank") {
      // A whitespace-only value keeps refusing, because whitespace is a typo or a
      // YAML artefact rather than an expression of intent, and reading it as "use
      // the default" would paper over a mistake in the one step whose whole story
      // is loud failure. C2 is explicit that adding an implicit default must not
      // weaken an existing refusal, and this is the one place it could.
      refuse("declares an empty `flow:`, which names no worker flow. Remove the key to hire on the built-in `agent` worker flow, or name a worker flow you passed");
      continue;
    }

    if ("refused" in declaredFlow) {
      // The same class of refusal as the empty-string case above, for a
      // present `flow:` whose value isn't a string at all — `flow:`/`flow: ~`
      // /`flow: null` from a file, or `{ flow: 42 }` from a hand-built
      // manifest. Silently defaulting here is the weakened refusal C2
      // forbids, worded for what was actually declared instead of a blank.
      refuse(
        `declares \`flow:\` as ${JSON.stringify(declaredFlow.value)}, which names no worker flow. ` +
          "Remove the key to hire on the built-in `agent` worker flow, or name a worker flow you passed"
      );
      continue;
    }

    // Absent (no `flow` key at all) has already resolved to the built-in.
    const flow = declaredFlow.kind;

    // `hasOwn` rather than a bare lookup: a record's `flow` is author-supplied,
    // and `flows["constructor"]` would otherwise resolve off the prototype and
    // hand us something that is not a flow factory at all.
    const entry = Object.hasOwn(flows, flow) ? flows[flow] : undefined;
    if (entry === undefined) {
      refuse(missingFlowReason(flow, available));
      continue;
    }

    const factory = entry.flow;

    // The worker's own skills, imposed on EVERY record — loaded or hand-built,
    // non-empty or empty, whatever worker flow this is.
    //
    // No probe of what the worker flow declares. The probe's other arm was silence:
    // a worker whose folders declared skills minted, ran, and held none, with
    // nothing said anywhere. Handing the bag over unconditionally turns that
    // into one loud refusal at boot, which an author can act on.
    //
    // `?? []` and not a conditional: present-and-empty is the answer for
    // *nothing to give*, and the bag is handed over all the same. The record
    // still distinguishes *never read for* (absent) from *read and empty*, and
    // that distinction stays on the record, where it belongs.
    settings[WORKER_SKILLS_KEY] = manifest.skills ?? [];

    // The worker's own id, on EVERY record: the one per-worker fact a block inside
    // the worker can read, since the flow's id is kept off the block context.
    // Written here and nowhere else, so every mint path (files, the runtime
    // `hire` tool, the boot reload) carries it. A hired record's `id` is its
    // org-qualified address, so it brings the logical id on
    // `manifest.workerId`; a file record's `id` is that id.
    settings[WORKER_ID_KEY] = manifest.id;

    // The worker's TEAM-level instructions — and **only when the record carries
    // them**, which is the opposite of the line above and deliberately so.
    //
    // `workerSkills` is imposed on every record because present-and-empty is a
    // real answer for a worker's skills: the folders were read and held nothing.
    // A team layer has no such answer. A team that wrote no instructions and a
    // team with no file at all both mean *this worker is told nothing extra*, and
    // handing `""` over would make them a value every worker flow's schema can see —
    // a different bag for every team in every tree that has no file, and the
    // trap the body rule above already names.
    //
    // Whitespace is not instructions here either. The loader will not produce
    // such a record, but a hand-built roster never passes the loader, and this
    // is the same one-line rule its neighbour applies to a body.
    if (
      typeof manifest.teamInstructions === "string" &&
      manifest.teamInstructions.trim().length > 0
    ) {
      // Verbatim: the check is on the trimmed value, the value is the value.
      settings[TEAM_INSTRUCTIONS_KEY] = manifest.teamInstructions;
    }

    // The worker's own block registry, and the names its file resolved out of it.
    // Imposed on EVERY record for the reason `workerSkills` is: present-and-empty
    // is the answer for *nothing registered*, and the bag is handed over all
    // the same.
    const registry = workerBlocks[manifest.id] ?? {};
    const registryProblems = workerBlockProblems(registry);
    if (registryProblems.length > 0) {
      for (const problem of registryProblems) refuse(problem);
      continue;
    }
    // The packages this worker holds: its own folder's, then the ones its
    // `packages:` line takes from its team's or the org's library. Their
    // blocks join the worker's registry for resolving a written `tools:` line —
    // a package's blocks are the worker's own for that purpose — after every
    // name among them has been shown to be one tool. This step cannot see a
    // worker flow's catalog, so a named package block that is also a catalog key is
    // refused by the flow at its mint (the built-in one does), not here.
    // The worker id it was hired as, not a hired worker's org-qualified address:
    // the same id the reference wall places the worker by.
    const { held, problems: heldProblems } = resolveHeldPackages(
      manifest.id,
      manifest.declared[PACKAGES_KEY],
      manifest.packages,
      packageBlocks
    );
    const packageProblems = [...heldProblems, ...heldPackageProblems(held, registry)];
    if (packageProblems.length > 0) {
      for (const problem of packageProblems) refuse(problem);
      continue;
    }
    const withPackages = { ...registry };
    for (const { blocks } of held) Object.assign(withPackages, blocks);

    const { catalogNames, workerTools } = resolveDeclaredTools(settings["tools"], withPackages);
    // Only a record that WROTE a `tools:` line carries the key onward, and it
    // keeps carrying it after the split even when every name moved onto
    // `workerTools` and the list emptied. The built-in worker flow reads an unset
    // `tools` (omitted, or a hand-built key with no value) as "wrote no line"
    // (grant what the file picked) and a set one as "wrote a line" (grant
    // exactly that line), so an omitted `tools:` must never be filled in here
    // or anywhere after.
    if (Object.hasOwn(settings, "tools")) settings["tools"] = catalogNames;
    settings[WORKER_TOOLS_KEY] = workerTools;

    // Only for a worker that holds one, like the team's instructions: a worker
    // holding nothing hands its worker flow exactly the bag it did before packages
    // existed. The flow decides what a held package does; this step decides
    // only which ones are held.
    if (held.length > 0) {
      settings[WORKER_PACKAGES_KEY] = held.map(({ manifest: pkg, blocks }) => ({
        name: pkg.name,
        path: pkg.path,
        ...(pkg.instructions === undefined ? {} : { instructions: pkg.instructions }),
        tools: Object.values(blocks)
      }));
    }

    // The worker's document allowlist, resolved against what the app declared.
    //
    // **Only for a record that DECLARES the key**, and the map is passed only
    // then. A minted worker's `resources` option REPLACES the definition's
    // flow-level map, so a worker that restricted nothing must be minted with no
    // map at all: passing an empty one locks every existing worker out of every
    // document, and reconstructing "everything" diverges the moment the worker flow's
    // map changes. Absent is not empty here, at either end.
    let workerResources: DeclaredResources | undefined;
    let workerGrants: readonly WorkerResourceGrant[] = [];
    // Whether the worker NARROWED its documents, which is no longer the same
    // question as whether it is minted with a map: the reference wall below
    // gives a map to a worker that granted nothing. `verifyWorkerNarrowing` asks
    // about the grant, so it has to read this and not the map — keyed on the
    // map, a worker that declared no `resources:` would have every document on
    // its worker flow reported as having escaped a narrowing nobody asked for.
    const narrowedDocuments = Object.hasOwn(manifest.declared, WORKER_RESOURCES_KEY);
    if (narrowedDocuments) {
      const parsed = parseWorkerResources(manifest.declared[WORKER_RESOURCES_KEY]);
      if (parsed.problems.length > 0) {
        for (const problem of parsed.problems) refuse(problem);
        continue;
      }
      const workerFlowResources = (factory.resources ?? {}) as DeclaredResources;
      const resolved = resolveWorkerResources({
        grants: parsed.grants ?? [],
        catalog: options.documents,
        workerFlowResources,
        // The worker flow's own flow-level keys, which is the subset a worker's map
        // replaces. Falling back to every key would read the flow's BLOCK
        // resources as flow-level ones and copy them onto the worker's map,
        // where they would override the blocks that declared them.
        flowLevelKeys: factory.flowLevelResourceKeys ?? new Set<string>(),
        kind: flow
      });
      if (resolved.problems.length > 0) {
        for (const problem of resolved.problems) refuse(problem);
        continue;
      }
      workerResources = resolved.resources;
      workerGrants = parsed.grants ?? [];
    }

    // The reference wall: derived from where this worker and each reference sit
    // in the tree, and applied to whatever map the worker would otherwise get.
    //
    // **Unconditional, unlike the block above.** A `resources:` grant is a
    // narrowing a worker asks for, so it runs only when the worker asks; the wall
    // is a boundary, so it runs for every worker whether or not its file says
    // anything. What keeps that from touching an app with no references is the
    // wall itself: a flow holding none hands `base` straight back, including
    // handing back `undefined` so the worker is minted with no map at all.
    //
    // Placed by the worker id, not the address: a runtime hire answers on an
    // org-qualified address (`acme.engineering.ada`), and its place in the
    // tree is the worker id it was hired as (`engineering.ada`).
    const placedAs = manifest.id;
    const wall = applyReferenceWall({
      workerId: placedAs,
      declared: manifest.declared[WORKER_REFERENCES_KEY],
      hasDeclared: Object.hasOwn(manifest.declared, WORKER_REFERENCES_KEY),
      catalog: options.references,
      workerFlowResources: (factory.resources ?? {}) as DeclaredResources,
      flowLevelKeys: factory.flowLevelResourceKeys ?? new Set<string>(),
      base: workerResources
    });
    if (wall.problems.length > 0) {
      for (const problem of wall.problems) refuse(problem);
      continue;
    }
    workerResources = wall.resources;

    // True only while the worker flow's own minter runs, so the catch below can tell
    // the flow's refusal (its `configSchema`) from a throw after it.
    let minting = true;
    try {
      // Always a bag, so always admitted. The branch that stood here passed no
      // bag at all for a record that declared nothing — which is admission
      // SKIPPED, not admission passed: a thin worker minted without its worker flow's
      // schema ever seeing it. Every record meets the schema now, including the
      // thinnest one there is.
      const worker = minter(factory)({
        id: manifest.id,
        config: settings,
        ...(workerResources !== undefined ? { resources: workerResources } : {})
      });
      minting = false;

      // The narrowing is checked on the worker that was BUILT, not on the map it
      // was built from. `defineFlow` merges the blocks' own declarations on top
      // of the instance's map, so a document a block also declares comes back
      // after the worker's map has removed it — and nothing readable off the worker flow
      // distinguishes that document from one no block mentions. Only the
      // instance knows. Skipped when the worker narrowed nothing, which denies
      // nothing.
      if (narrowedDocuments && options.documents !== undefined) {
        const escaped = verifyWorkerNarrowing({
          minted: worker.resources as DeclaredResources | undefined,
          grants: workerGrants,
          catalog: options.documents,
          kind: flow
        });
        if (escaped.length > 0) {
          for (const problem of escaped) refuse(problem);
          continue;
        }
      }

      // The same check for the wall, and it exists for the same substrate
      // reason: a reference a block ALSO declares comes back after the worker's
      // map removed it, and only the built instance shows that. Read off the
      // minted flow rather than predicted from the worker flow.
      const crossed = verifyWorkerReferenceWall({
        minted: worker.resources as DeclaredResources | undefined,
        allowed: wall.reachable,
        catalog: options.references,
        workerId: placedAs,
        kind: flow
      });
      if (crossed.length > 0) {
        for (const problem of crossed) refuse(problem);
        continue;
      }

      // Beside the worker, never in its settings: see `worker-description.ts`.
      const description = manifest.declared.description;
      if (typeof description === "string") recordWorkerDescription(worker, description);
      workers.push(worker);
    } catch (error) {
      // The flow's own refusal, with the worker's id in front of it. The flow
      // already met the contract, so this is about the worker's own settings.
      refuse(messageOf(error));
      if (minting) flowRefusedWorkers.add(manifest.id);
    }
  }

  // **An entry addressed to a worker this call is not hiring is not a problem.**
  // A short roster is a supported mode — `readWorkforce` reports a folder that
  // produced no worker and loads the rest, and a caller may hire what loaded —
  // while `workerBlocks` is generated from the WHOLE tree. So the two sets
  // legitimately differ, and refusing the difference broke the documented mode:
  // one skipped worker turned every other worker's hire into a refusal, which is
  // how `refused 2 of 1 worker` became a sentence this function could print.
  //
  // Nothing is lost by staying quiet. The generated map cannot address a worker
  // the tree does not hold, because one walk produces both; a hand-built map is
  // the caller's business in the same way a hand-built roster is. What is
  // validated is every registry belonging to a manifest actually being hired,
  // which happens in the loop above.

  if (problems.length > 0) {
    const message = hireRefusalMessage(refusedWorkers.size, ordered.length, problems);
    // Typed only when every refusal is a worker flow's own: one framework refusal in
    // the roster and the whole error stays the framework's.
    // A flow-refused worker contributes exactly one problem (the catch is its
    // last step), so the counts match only when nothing else was refused.
    throw problems.length === flowRefusedWorkers.size
      ? new WorkerFlowRefusedHireError(message)
      : new Error(message);
  }

  return workers;
}
