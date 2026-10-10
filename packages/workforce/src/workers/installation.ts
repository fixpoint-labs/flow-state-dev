/**
 * The worker model's one module: what a session's worker is, checked when the
 * session is created (S5), and loaded with its configuration on every turn
 * (S6), with the documents it may reach (S8).
 *
 * A worker is data: a row in its owner's user scope, or a standard worker the
 * installation's files declare. The flow it names runs as one registered copy
 * shared by every worker that names it. A session names its worker once, in a
 * readonly session-state field, `workerId`, and the flow's create check
 * confirms it there: the worker is the creating user's own or a standard one,
 * and it runs on this flow. Nothing changes the field afterwards, and no turn
 * names a worker.
 *
 * Callers reach one narrow interface. The create check, `resolveWorker` for a
 * turn, and the session declaration a worker flow spreads in. None of them
 * touches the worker row, the name resolution or the refusal rules, which
 * live here.
 *
 * Every refusal names why and changes nothing: a refused create writes no
 * session, and a refused turn leaves the row and the session for a fix.
 */
import type { InitialSkill } from "@flow-state-dev/core";
import type {
  FlowInstance,
  ResourceCollectionRef,
  SessionCreateCheck,
  SessionCreateCheckInput,
  SessionCreateCheckResult
} from "@flow-state-dev/core/types";
import type { DeclaredResources, ResourceVisibilityRule } from "@flow-state-dev/core";
import { z } from "zod";
import { AGENT_KIND, defineAgentWorkerFlow } from "../agent-worker-flow";
import {
  hireRefusalReasons,
  mintSeats,
  resolveWorkerFlows,
  standardOnlyReason,
  type HireOptions,
  type ResolvedWorkerFlow,
  type WorkerFlowEntry
} from "../hire";
import { isWorkerFlowBuilder, type WorkerFlowBuilder } from "./worker-flow";
import type { PackageManifest, WorkerManifest } from "../manifest";
import { taskChainSchema } from "../conversation-board/chain";
import { criteriaOfState, deriveWorkerSessionId, isDerivedWorkerSessionId } from "./derive-session-id";
import {
  FILING_FLOW_STATE_KEY,
  FILING_SESSION_STATE_KEY,
  STANDARD_WORKERS_RESOURCE,
  TASK_CHAIN_STATE_KEY,
  TASK_FLOW_STATE_KEY,
  TASK_ID_STATE_KEY,
  WORKERS_RESOURCE,
  WORKER_ID_STATE_KEY,
  WORKSTREAM_STATE_KEY
} from "./keys";
import {
  PRIVATE_WORKSTREAMS_RESOURCE,
  WORKSTREAM_RESOURCES,
  WORKSTREAMS_RESOURCE,
  workstreamEntryKey,
  workstreamsAccessor
} from "../projects/workstream-collections";
import { parseWorkstreamRef } from "../projects/workstream-ref";
import { defineStandardWorkerCollection, standardWorkerFlow } from "./standard-workers";
import { defineWorkerCollection, parseWorkerRow, type WorkerRow } from "./worker-row";
import { grantedAccessOf, markVerifiedWorker, type GrantedAccess } from "./verified-worker";

export { verifiedWorkerOf } from "./verified-worker";

/** What an installation is built from: its files, its worker flows, and what its workers may name. */
export interface WorkerInstallationOptions {
  /**
   * The workers the installation's files declare (`readWorkforce(...)`'s
   * roster). Each is a standard worker: every user has it, and nobody can
   * change it at run time.
   */
  standardWorkers?: readonly WorkerManifest[];
  /**
   * The worker flows, by kind, as `hireWorkforce` takes them. A function is
   * read when first needed, so a worker flow defined with this installation's
   * `session` and `resources` can be handed back to it.
   */
  workerFlows?: HireOptions["workerFlows"] | (() => HireOptions["workerFlows"]);
  /** The blocks each standard worker's own folders register (`fsdev gen`'s `seatBlocks`). */
  seatBlocks?: HireOptions["seatBlocks"];
  /** The blocks each package carries (`fsdev gen`'s `packageBlocks`). */
  packageBlocks?: HireOptions["packageBlocks"];
  /** The documents a worker may be granted (`resourcesFromDocs(...)`). */
  documents?: DeclaredResources;
  /** The references a worker may reach (`referencesFromDocs(...)`). */
  references?: DeclaredResources;
  /**
   * The skills a user's own worker may name, resolved by name on each turn.
   * Omitted, every skill a standard worker can see, by name, the first
   * standard worker in id order winning a name two of them hold.
   */
  skills?: readonly InitialSkill[];
  /** The packages a user's own worker may hold by name (the org's library). */
  packages?: readonly PackageManifest[];
}

/**
 * The slice of a block's context a turn's worker is loaded from: the
 * session's state, and the resources the block declares. Any block's context
 * satisfies it.
 */
export type WorkerTurnContext = {
  readonly session: { readonly state: unknown };
  readonly resources: unknown;
};

/** The worker a turn runs as, with what it runs with. */
export interface ResolvedWorker {
  /** The worker's id: a row on the user's roster, or a standard worker's id. */
  id: string;
  /** Whether it is a standard worker (from the files) rather than one of the user's own. */
  standard: boolean;
  /** The flow it runs on, which is the running flow. */
  flow: string;
  /** Its description, or `null`. */
  description: string | null;
  /**
   * Its configuration, as the flow's own `configSchema` parsed it: the
   * worker's settings, its instructions, and its tools, skills and packages
   * resolved against what the installation registers. Read this, never
   * `ctx.flow.config`, which the shared copy holds once for every worker.
   */
  config: Readonly<Record<string, unknown>>;
  /**
   * Whether the worker reaches the flow's resource under `accessor` on this
   * turn: its document grants and the reference wall, applied per turn on the
   * flow's one copy. A resource that isn't a document or a reference is
   * always reached.
   */
  reaches(accessor: string): boolean;
}

/** The two ways an installation's documents and references are handed to a worker flow. */
export interface WorkerGrants {
  /**
   * Every document and reference a worker may be granted, by accessor. A
   * worker flow whose model reaches documents declares them all in its
   * `resources`, and sets {@link resourceVisibility} so each turn's model
   * reaches only its worker's.
   */
  readonly documents: DeclaredResources;
  /**
   * The flow's `resourceVisibility`: on each turn, a granted document is
   * visible to the model's resource tools when the worker `resolveWorker`
   * loaded on this turn reaches it, read-only when its grant is, and hidden
   * otherwise, including on a turn that loaded no worker. Every other resource
   * is visible.
   */
  readonly resourceVisibility: ResourceVisibilityRule;
}

/**
 * A worker on a user's roster, as {@link WorkerInstallation.rosterWorker}
 * reads it: enough to tell whether it is theirs and what it runs on, without
 * loading its configuration.
 */
export interface RosterWorker {
  /** The worker's id. */
  id: string;
  /** Whether it is a standard worker (from the files) rather than one of the user's own. */
  standard: boolean;
  /** The flow it names. */
  flow: string;
  /** Its description, or `null`. */
  description: string | null;
  /** Why it can't run, when its row can't be read or names a flow kept for standard workers. */
  problem?: string;
}

/**
 * Thrown when a turn can't run as the session's worker: it was fired, now
 * names another flow, names something the installation no longer registers,
 * or runs on a flow kept for standard workers. Nothing is written; the row and
 * the session stay for a fix.
 */
export class WorkerTurnRefusedError extends Error {
  readonly code = "worker-turn-refused";

  constructor(
    readonly workerId: string | undefined,
    message: string
  ) {
    super(message);
    this.name = "WorkerTurnRefusedError";
  }
}

/** The readonly session-state fields every worker flow declares. */
export type WorkerSessionStateShape = {
  readonly [WORKER_ID_STATE_KEY]: z.ZodReadonly<z.ZodString>;
  readonly [FILING_SESSION_STATE_KEY]: z.ZodOptional<z.ZodReadonly<z.ZodString>>;
  readonly [WORKSTREAM_STATE_KEY]: z.ZodOptional<z.ZodReadonly<z.ZodString>>;
  readonly [TASK_ID_STATE_KEY]: z.ZodOptional<z.ZodReadonly<z.ZodString>>;
  readonly [FILING_FLOW_STATE_KEY]: z.ZodOptional<z.ZodReadonly<z.ZodString>>;
  readonly [TASK_CHAIN_STATE_KEY]: z.ZodOptional<z.ZodReadonly<typeof taskChainSchema>>;
  readonly [TASK_FLOW_STATE_KEY]: z.ZodOptional<z.ZodReadonly<z.ZodString>>;
};

/** The installation's worker model. Build it once, at boot. */
export interface WorkerInstallation extends WorkerGrants {
  /**
   * The two worker collections, the user's own workers and the standard ones
   * projected from the files, and the workstream entries the create check
   * reads a workstream session's link from. A worker flow spreads them into
   * its `resources`, and so does every block that calls {@link resolveWorker}
   * or writes a worker.
   */
  readonly resources: {
    readonly [WORKERS_RESOURCE]: ReturnType<typeof defineWorkerCollection>;
    readonly [STANDARD_WORKERS_RESOURCE]: ReturnType<typeof defineStandardWorkerCollection>;
    readonly [WORKSTREAMS_RESOURCE]: (typeof WORKSTREAM_RESOURCES)[typeof WORKSTREAMS_RESOURCE];
    readonly [PRIVATE_WORKSTREAMS_RESOURCE]: (typeof WORKSTREAM_RESOURCES)[typeof PRIVATE_WORKSTREAMS_RESOURCE];
  };
  /**
   * The session-state fields a worker flow declares, readonly: spread them
   * into the flow's session `stateSchema`, beside the flow's own fields.
   * `workerId` names the session's worker; `filingSessionId`, when a
   * coordinator's delivery set it, names the conversation it was opened for;
   * `workstreamId`, when a workstream's open set it, names the workstream the
   * session leads; `taskId`, when a conversation's board handed a task over,
   * names the task the session works.
   */
  readonly sessionStateShape: WorkerSessionStateShape;
  /** The create check a worker flow declares as `session.createCheck`. */
  readonly createCheck: SessionCreateCheck;
  /**
   * A worker flow's `session` declaration: {@link sessionStateShape} plus
   * `extraShape` as its `stateSchema`, and {@link createCheck}.
   */
  session<TShape extends z.ZodRawShape = Record<never, never>>(
    extraShape?: TShape
  ): {
    stateSchema: z.ZodObject<WorkerSessionStateShape & TShape>;
    createCheck: SessionCreateCheck;
  };
  /**
   * The worker this turn runs as, loaded now: the session's worker read from
   * the user's roster or the standard workers, with its configuration
   * resolved. Call it on every turn of a worker flow: in the flow's
   * `request.onStarted`, which runs again when a request resumes, or in the
   * block that reads the worker. Not in an earlier step of the turn: a
   * resumed request reuses a finished step's recorded output without running
   * it, so the worker it loaded is gone on the resumed run.
   *
   * @param ctx The block's context. The block must declare {@link resources}.
   * @param flowKind The running flow's kind.
   * @throws WorkerTurnRefusedError when the turn can't run as the worker.
   */
  resolveWorker(ctx: WorkerTurnContext, flowKind: string): Promise<ResolvedWorker>;
  /**
   * The worker `workerId` names on the session user's roster, read by id
   * now: one of their own (read at their scope, so another user's is simply
   * not there) or a standard one. `undefined` when the user has no such
   * worker, which is also the answer for another user's.
   *
   * Answers "is it yours", not "may it run": nothing is minted.
   *
   * @param ctx The block's context. The block must declare {@link resources}.
   */
  rosterWorker(ctx: WorkerTurnContext, workerId: string): Promise<RosterWorker | undefined>;
  /** A standard worker by id, or `undefined`. */
  standardWorker(id: string): WorkerManifest | undefined;
  /** Every standard worker, by id order. */
  standardWorkers(): readonly WorkerManifest[];
  /** The worker flows, resolved: each one's flow and whether it is kept for standard workers. */
  workerFlows(): Record<string, ResolvedWorkerFlow>;
  /**
   * Check a worker's configuration as its flow would on a turn, without
   * running anything: the same resolution and the same refusals. Used by
   * hire, fork and edit before they write.
   *
   * @returns The reasons it would be refused; empty when it would run.
   */
  configurationProblems(id: string, row: WorkerRow): string[];
  /**
   * Check every standard worker the same way, as its file declares it. Used by
   * `hireWorkforce`, which refuses to register anything while one would be
   * refused on its first turn.
   *
   * @returns Each refusal, prefixed with the worker's id; empty when every one would run.
   */
  standardWorkerProblems(): string[];
}

/** The settings a row hands its flow: its own settings, keyed as a `WORKER.md` frontmatter. */
function declaredOf(row: WorkerRow): Record<string, unknown> {
  const declared: Record<string, unknown> = { ...row.settings, flow: row.flow };
  delete declared.description;
  return declared;
}

/**
 * Build the installation's worker model.
 *
 * Refuses a standard worker whose file names no flow, or names one the
 * installation doesn't run, two standard workers under one id, and a standard
 * worker whose `delegates:` names a worker that isn't standard: every user has
 * a standard worker, so its defaults can name only what every user has too.
 */
export function createWorkerInstallation(options: WorkerInstallationOptions = {}): WorkerInstallation {
  const standard = new Map<string, WorkerManifest>();
  for (const manifest of options.standardWorkers ?? []) {
    if (standard.has(manifest.id)) {
      throw new Error(`createWorkerInstallation: standard worker "${manifest.id}" is declared twice.`);
    }
    if (standardWorkerFlow(manifest, AGENT_KIND) === undefined) {
      throw new Error(
        `createWorkerInstallation: standard worker "${manifest.id}" declares a \`flow:\` that names no flow.`
      );
    }
    standard.set(manifest.id, manifest);
  }
  for (const manifest of standard.values()) {
    const delegates = manifest.declared.delegates;
    if (!Array.isArray(delegates)) continue;
    const unknown = delegates.filter((name) => typeof name !== "string" || !standard.has(name));
    if (unknown.length > 0) {
      throw new Error(
        `createWorkerInstallation: standard worker "${manifest.id}" names ` +
          `${unknown.map((name) => JSON.stringify(name)).join(", ")} in \`delegates:\`, which ` +
          `${unknown.length === 1 ? "isn't a standard worker" : "aren't standard workers"}. ` +
          `A standard worker's delegates must be standard workers too.`
      );
    }
  }

  // The built-in `agent`, bound to this installation, unless the app passes
  // its own: built on first use, once, so every turn checks its workers
  // against the one copy `hireWorkforce` registers.
  let boundAgent: unknown;
  // A `workerFlow(...)` builder, built on this installation once.
  const built = new Map<WorkerFlowBuilder, WorkerFlowEntry>();
  const buildOf = (entry: WorkerFlowEntry): WorkerFlowEntry => {
    if (!isWorkerFlowBuilder(entry)) return entry;
    let flow = built.get(entry);
    if (flow === undefined) {
      flow = { flow: entry.build(installation) as never, standardOnly: entry.standardOnly };
      built.set(entry, flow);
    }
    return flow;
  };
  const workerFlowsOption = (): HireOptions["workerFlows"] => {
    const read = typeof options.workerFlows === "function" ? options.workerFlows() : options.workerFlows;
    const given =
      read === undefined ? undefined : Object.fromEntries(Object.entries(read).map(([kind, entry]) => [kind, buildOf(entry)]));
    if (given !== undefined && Object.hasOwn(given, AGENT_KIND)) return given;
    boundAgent ??= defineAgentWorkerFlow({ installation });
    return { [AGENT_KIND]: boundAgent as never, ...given };
  };
  let resolvedFlows: Record<string, ResolvedWorkerFlow> | undefined;
  const workerFlows = (): Record<string, ResolvedWorkerFlow> =>
    (resolvedFlows ??= resolveWorkerFlows(workerFlowsOption()));

  const skillCatalog = new Map<string, InitialSkill>();
  if (options.skills !== undefined) {
    for (const skill of options.skills) skillCatalog.set(skill.name, skill);
  } else {
    for (const manifest of [...standard.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      for (const skill of manifest.skills ?? []) {
        if (!skillCatalog.has(skill.name)) skillCatalog.set(skill.name, skill);
      }
    }
  }

  const resources = {
    [WORKERS_RESOURCE]: defineWorkerCollection(),
    [STANDARD_WORKERS_RESOURCE]: defineStandardWorkerCollection(() => standard, AGENT_KIND),
    ...WORKSTREAM_RESOURCES
  } as const;

  const sessionStateShape = {
    [WORKER_ID_STATE_KEY]: z.string().min(1).readonly(),
    [FILING_SESSION_STATE_KEY]: z.string().min(1).readonly().optional(),
    [WORKSTREAM_STATE_KEY]: z.string().min(1).readonly().optional(),
    [TASK_ID_STATE_KEY]: z.string().min(1).readonly().optional(),
    [FILING_FLOW_STATE_KEY]: z.string().min(1).readonly().optional(),
    [TASK_CHAIN_STATE_KEY]: taskChainSchema.readonly().optional(),
    [TASK_FLOW_STATE_KEY]: z.string().min(1).readonly().optional()
  } as const;

  /** Every resource a worker may be granted: the documents and the references. */
  const documents: DeclaredResources = Object.freeze({ ...(options.documents ?? {}), ...(options.references ?? {}) });

  /**
   * What `hireWorkforce` would refuse this worker for, or the instance it
   * would mint. Nothing is registered: the instance is read and dropped.
   *
   * Reusing the hire on every turn is deliberate: one path decides what a
   * worker runs with, so a save, a hire and a turn refuse the same things in
   * the same words. It costs about 0.13 ms a turn against about 10 ms for a
   * turn with no model (in-memory stores), so it isn't cached.
   */
  const mint = (
    manifest: WorkerManifest
  ): { ok: true; seat: FlowInstance } | { ok: false; problems: string[] } => {
    try {
      const [seat] = mintSeats([manifest], {
        workerFlows: workerFlowsOption(),
        ...(options.seatBlocks !== undefined ? { seatBlocks: options.seatBlocks } : {}),
        ...(options.packageBlocks !== undefined ? { packageBlocks: options.packageBlocks } : {}),
        ...(options.documents !== undefined ? { documents: options.documents } : {}),
        ...(options.references !== undefined ? { references: options.references } : {})
      });
      return { ok: true, seat: seat! };
    } catch (error) {
      return { ok: false, problems: hireRefusalReasons(error, manifest.id) };
    }
  };

  /**
   * A user's row as the record a hire mints from, or the skills it names that
   * nothing registers. The last refusal names the skills that are registered,
   * so a hire can be made again with one of them, or with none.
   */
  const manifestOfRow = (
    id: string,
    row: WorkerRow
  ): { ok: true; manifest: WorkerManifest } | { ok: false; problems: string[] } => {
    const missing = row.skills.filter((name) => !skillCatalog.has(name));
    if (missing.length > 0) {
      const registered = [...skillCatalog.keys()].sort().map((name) => `"${name}"`);
      const known = registered.length === 0 ? "It registers no skills" : `Skills it registers: ${registered.join(", ")}`;
      return {
        ok: false,
        problems: missing.map(
          (name, index) =>
            `names skill "${name}", which this installation doesn't register. Remove it, or register it` +
            (index === missing.length - 1 ? `. ${known}` : "")
        )
      };
    }
    return {
      ok: true,
      manifest: {
        id,
        declared: declaredOf(row),
        body: row.instructions ?? "",
        skills: row.skills.map((name) => skillCatalog.get(name)!),
        ...(row.teamInstructions !== null ? { teamInstructions: row.teamInstructions } : {}),
        packages: [...(options.packages ?? [])]
      }
    };
  };

  /**
   * Which worker an id names, from its stored row (read at the caller's own
   * scope) or the standard workers: the caller's own row first, since a hire
   * can't take a standard worker's id. The create check and a turn word what
   * they find differently, so each keeps its own refusals.
   */
  const lookupWorker = (
    workerId: string,
    stored: unknown
  ):
    | { found: "own"; row: WorkerRow; flow: string; standardOnly: boolean }
    | { found: "standard"; manifest: WorkerManifest; flow: string }
    | { found: "unreadable"; problem: string }
    | { found: "none" } => {
    if (stored !== undefined) {
      const parsed = parseWorkerRow(stored);
      if ("problem" in parsed) return { found: "unreadable", problem: parsed.problem };
      const flow = parsed.row.flow;
      return { found: "own", row: parsed.row, flow, standardOnly: workerFlows()[flow]?.standardOnly === true };
    }
    const file = standard.get(workerId);
    if (file === undefined) return { found: "none" };
    return { found: "standard", manifest: file, flow: standardWorkerFlow(file, AGENT_KIND)! };
  };

  const configurationProblems = (id: string, row: WorkerRow): string[] => {
    const flows = workerFlows();
    const entry = Object.hasOwn(flows, row.flow) ? flows[row.flow] : undefined;
    if (entry === undefined) {
      const known = Object.keys(flows).sort().map((name) => `"${name}"`).join(", ");
      return [`names flow "${row.flow}", which isn't a worker flow here. Worker flows: ${known}`];
    }
    if (entry.standardOnly) return [standardOnlyReason(row.flow, false)];
    const built = manifestOfRow(id, row);
    if (!built.ok) return built.problems;
    const minted = mint(built.manifest);
    return minted.ok ? [] : minted.problems;
  };

  const standardWorkerProblems = (): string[] =>
    [...standard.values()].flatMap((manifest) => {
      const minted = mint(manifest);
      return minted.ok ? [] : minted.problems.map((problem) => `worker "${manifest.id}" — ${problem}`);
    });

  const createCheck: SessionCreateCheck = async (
    input: SessionCreateCheckInput
  ): Promise<SessionCreateCheckResult> => {
    const workerId = input.state[WORKER_ID_STATE_KEY];
    if (typeof workerId !== "string" || workerId.length === 0) {
      return {
        ok: false,
        message: `A session of flow "${input.flow.kind}" runs one worker: name it as "${WORKER_ID_STATE_KEY}" when the session is created.`
      };
    }
    // A task's session is opened only by its board's hand-over, a dispatch
    // into a child of the conversation. A caller naming a task would make a
    // decoy that lookups take for the real one, and a caller naming a chain
    // or a flow would set how deep its filings go and where its split is
    // reached (BP-031).
    for (const key of [TASK_ID_STATE_KEY, FILING_FLOW_STATE_KEY, TASK_CHAIN_STATE_KEY, TASK_FLOW_STATE_KEY]) {
      if (input.state[key] !== undefined && input.via !== "dispatch") {
        return {
          ok: false,
          status: 400,
          message: `"${key}" is set only when a session's board hands a task over; a caller cannot set it.`
        };
      }
    }

    // A derived id names its owner. Recomputed for this caller, so a create at
    // another user's derived id is refused before that user's first ensure.
    if (isDerivedWorkerSessionId(input.sessionId)) {
      const own = await deriveWorkerSessionId({
        userId: input.principal.userId,
        orgId: input.principal.orgId,
        flow: input.flow.kind,
        criteria: criteriaOfState(workerId, input.state)
      });
      if (own !== input.sessionId) {
        return {
          ok: false,
          status: 403,
          message: `Session id "${input.sessionId}" is reserved for another worker session; create this one without it.`
        };
      }
    }

    // The caller's own worker, read at their scope: another user's row is
    // simply not there, so it is refused exactly as a worker that doesn't
    // exist is.
    const found = lookupWorker(workerId, await input.readCollectionItem(WORKERS_RESOURCE, workerId));
    if (found.found === "none") return { ok: false, status: 404, message: `No worker "${workerId}".` };
    if (found.found === "unreadable") {
      return { ok: false, message: `Worker "${workerId}" can't be used: ${found.problem}.` };
    }
    if (found.flow !== input.flow.kind) {
      return {
        ok: false,
        message: `Worker "${workerId}" runs on flow "${found.flow}", not "${input.flow.kind}". Create its session on "${found.flow}".`
      };
    }
    if (found.found === "own" && found.standardOnly) {
      return { ok: false, message: `Worker "${workerId}" ${standardOnlyReason(found.flow, false)}.` };
    }
    const workstream = input.state[WORKSTREAM_STATE_KEY];
    return typeof workstream === "string" ? workstreamLinkCheck(input, workerId, workstream) : { ok: true };
  };

  /**
   * A session that names a workstream is that workstream's lead session: the
   * creating user's own entry must exist, name this worker as its lead, and
   * name no other session. Read at the creator's own scope, so another user's
   * entry is never the one found.
   */
  const workstreamLinkCheck = async (
    input: SessionCreateCheckInput,
    workerId: string,
    ref: string
  ): Promise<SessionCreateCheckResult> => {
    const address = parseWorkstreamRef(ref);
    if (address === undefined) {
      return { ok: false, message: `"${WORKSTREAM_STATE_KEY}" "${ref}" names no workstream: it is <visibility>/<project>/<workstream>.` };
    }
    const entry = await input.readCollectionItem(
      workstreamsAccessor(address.project.visibility),
      workstreamEntryKey(address.project.id, input.principal.userId, address.id)
    );
    if (entry === undefined) {
      return {
        ok: false,
        status: 404,
        message: `You have no workstream "${address.id}" in ${address.project.visibility} project "${address.project.id}". Open it first.`
      };
    }
    if (entry.lead !== workerId) {
      return { ok: false, status: 403, message: `Workstream "${address.id}" is led by "${String(entry.lead)}", not "${workerId}".` };
    }
    if (typeof entry.sessionId === "string" && entry.sessionId !== input.sessionId) {
      return { ok: false, status: 403, message: `Workstream "${address.id}" already has its lead's session, "${entry.sessionId}".` };
    }
    return { ok: true };
  };

  /** The user's worker collection, as the calling block declared it. */
  const workerCollection = (ctx: WorkerTurnContext, caller: string): ResourceCollectionRef => {
    const collection = (ctx.resources as Record<string, unknown>)[WORKERS_RESOURCE] as
      | ResourceCollectionRef
      | undefined;
    if (collection === undefined || typeof collection.getOptional !== "function") {
      throw new Error(
        `${caller} needs the worker collection: declare \`resources: { ...installation.resources }\` ` +
          `on the block that calls it.`
      );
    }
    return collection;
  };

  const resolveWorker = async (ctx: WorkerTurnContext, flowKind: string): Promise<ResolvedWorker> => {
    const workerId = (ctx.session.state as Record<string, unknown>)[WORKER_ID_STATE_KEY];
    if (typeof workerId !== "string" || workerId.length === 0) {
      throw new WorkerTurnRefusedError(
        undefined,
        `This session of flow "${flowKind}" names no worker, so this turn has no worker to run as.`
      );
    }
    const refuse = (message: string): never => {
      throw new WorkerTurnRefusedError(workerId, message);
    };

    const flows = workerFlows();
    if (!Object.hasOwn(flows, flowKind)) {
      refuse(`Flow "${flowKind}" isn't a worker flow here, so worker "${workerId}" can't run on it.`);
    }

    const collection = workerCollection(ctx, "resolveWorker");
    const found = lookupWorker(workerId, (await collection.getOptional(workerId))?.state);
    if (found.found === "none") {
      refuse(`Worker "${workerId}" was fired. This session stays readable; a new turn can't run as it.`);
    }
    if (found.found === "unreadable") refuse(`Worker "${workerId}" can't run: ${found.problem}.`);
    const worker = found as Exclude<typeof found, { found: "none" } | { found: "unreadable" }>;
    const flow = worker.flow;
    if (flow !== flowKind) {
      refuse(
        `Worker "${workerId}" now runs on flow "${flow}", and this session runs on "${flowKind}". ` +
          `A session stays on the flow it was created on: start a new session to talk to it on "${flow}".`
      );
    }

    let manifest: WorkerManifest;
    let description: string | null;
    if (worker.found === "own") {
      if (worker.standardOnly) refuse(`Worker "${workerId}" ${standardOnlyReason(flow, false)}.`);
      const built = manifestOfRow(workerId, worker.row);
      if (!built.ok) refuse(`Worker "${workerId}" can't run: ${built.problems.join("; ")}.`);
      manifest = (built as { manifest: WorkerManifest }).manifest;
      description = worker.row.description;
    } else {
      manifest = worker.manifest;
      const declaredDescription = manifest.declared.description;
      description = typeof declaredDescription === "string" ? declaredDescription : null;
    }

    const minted = mint(manifest);
    if (!minted.ok) refuse(`Worker "${workerId}" can't run: ${minted.problems.join("; ")}.`);
    const seat = (minted as { seat: FlowInstance }).seat;
    const reached = (seat.resources ?? {}) as Record<string, unknown>;

    // What the worker's grants let its model do with each grantable resource:
    // the mint narrows a read-only grant by turning its write flags off.
    const granted = new Map<string, GrantedAccess>();
    for (const accessor of Object.keys(documents)) {
      if (!Object.hasOwn(reached, accessor)) continue;
      const entry = reached[accessor] as { llmWritable?: unknown; writable?: unknown };
      granted.set(accessor, entry.llmWritable === true && entry.writable !== false ? "visible" : "read-only");
    }
    markVerifiedWorker(ctx.session as object, workerId, seat.config as Readonly<Record<string, unknown>>, granted);
    return {
      id: workerId,
      standard: worker.found === "standard",
      flow,
      description,
      config: seat.config as Readonly<Record<string, unknown>>,
      reaches: (accessor: string) => Object.hasOwn(reached, accessor)
    };
  };

  const rosterWorker = async (ctx: WorkerTurnContext, workerId: string): Promise<RosterWorker | undefined> => {
    const collection = workerCollection(ctx, "rosterWorker");
    const found = lookupWorker(workerId, (await collection.getOptional(workerId))?.state);
    if (found.found === "none") return undefined;
    if (found.found === "unreadable") {
      return { id: workerId, standard: false, flow: "", description: null, problem: found.problem };
    }
    if (found.found === "own") {
      return {
        id: workerId,
        standard: false,
        flow: found.flow,
        description: found.row.description,
        ...(found.standardOnly ? { problem: standardOnlyReason(found.flow, false) } : {})
      };
    }
    const declaredDescription = found.manifest.declared.description;
    return {
      id: workerId,
      standard: true,
      flow: found.flow,
      description: typeof declaredDescription === "string" ? declaredDescription : null
    };
  };

  const installation: WorkerInstallation = {
    resources,
    documents,
    resourceVisibility: (ctx, { name }) =>
      Object.hasOwn(documents, name) ? (grantedAccessOf(ctx.session as object, name) ?? "hidden") : "visible",
    sessionStateShape,
    createCheck,
    rosterWorker,
    session(extraShape) {
      return {
        stateSchema: z.object({ ...sessionStateShape, ...(extraShape ?? {}) }) as never,
        createCheck
      };
    },
    resolveWorker,
    standardWorker: (id) => standard.get(id),
    standardWorkers: () => [...standard.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    workerFlows,
    configurationProblems,
    standardWorkerProblems
  };
  return installation;
}
