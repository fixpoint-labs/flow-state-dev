/**
 * The workforce kit: workforce installed into an app with one config object.
 *
 * `createFlowState({ kits: [workforce({ agent: { model } })] })` reads the
 * app's `workforce/` folder (every file used or refused), builds the worker
 * model over the workers it declares, and serves one copy of each worker flow
 * and the roster flow. The host never builds the installation or hires: those
 * are this kit's install.
 *
 * Two slots take what other kits and the app add:
 *
 * - `workerFlows` (keyed by flow name): worker flows beside the built-in
 *   `agent`, each an entry as `workerFlow(…)` builds one, so a flow that needs
 *   the installation receives it rather than closing over a variable filled
 *   later. An entry keyed `agent` or `coordinator` replaces the kit's own,
 *   which is then not configured here.
 * - `uses` (a list): capabilities added to the agent and coordinator flows
 *   this kit builds, as the harness kit adds its readiness.
 * - `flows` (keyed): flows that aren't worker flows but are built on the
 *   installation (an app's projects and workstreams flow, say). Each entry is
 *   a builder handed the installation; the kit serves what it returns beside
 *   its worker flows. Workforce ships none of its own.
 *
 * The kit adds two capabilities of workforce's own to those flows, over its
 * installation: consulting another conversation (`consultSessions`) and the
 * routine tools. Each is offered only to a worker whose file picks it.
 */
import { defineKit, slot, type CapabilityRef, type UsesEntry } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { z, type ZodTypeAny } from "zod";
import type { SessionFields } from "../workers/session-fields";
import { AGENT_FLOW, defineAgentWorkerFlow, type AgentWorkerFlowOptions } from "../agent-worker-flow";
import { COORDINATOR_FLOW } from "../coordinator/coordinator-keys";
import { defineCoordinatorFlow, type CoordinatorFlowOptions } from "../coordinator/coordinator-flow";
import type { WorkerFlowEntry } from "../hire";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { readWorkforceFolder, type WorkforceFolder } from "../loader/read-workforce-folder";
import { consultSessionsCapability, type ConsultSessionsOptions } from "../messages/consult";
import type { MessageLimits } from "../messages/message-limits";
import { referencesFromDocs } from "../references-from-docs";
import type { ResourceModules } from "../resource-modules";
import { resourcesFromDocs } from "../resources-from-docs";
import { splitResourceModules } from "../split-resource-modules";
import { createRoutinesCapability, type RoutinesOptions } from "../routines/routines";
import { githubServiceFlow, type GitHubServiceFlowOptions } from "../service-flows/github/service-flow";
import { internalServiceFlow, type InternalServiceFlow, type InternalServiceFlowOptions } from "../service-flows/internal-events/service-flow";
import { createWorkerInstallation, type WorkerInstallation } from "../workers/installation";
import { hireWorkforce } from "../workers/register";
import { workerFlow } from "../workers/worker-flow";

/** The built-in agent flow's options, as the kit's config takes them. */
export type WorkforceAgentOptions = Omit<AgentWorkerFlowOptions, "installation"> & {
  /** The settings a user sees on a worker's roster row (`icon`, `color`). */
  showSettings?: readonly string[];
};

/** The coordinator flow's options, as the kit's config takes them. */
export type WorkforceCoordinatorOptions = Omit<CoordinatorFlowOptions, "installation">;

/** What `fsdev gen` renders into `workforce/workforce.gen.ts`: the app imports it and hands it over whole. */
export interface GeneratedWorkforce {
  /** One worker flow per file under `flows/workers/`. One named `agent` or `coordinator` replaces the kit's own. */
  readonly workerFlows?: Readonly<Record<string, WorkerFlowEntry>>;
  /** One block per file under `blocks/`: the agent flow's tool catalog, when its config names none. */
  readonly blocks?: Readonly<Record<string, BlockDefinition<any, any>>>;
  /**
   * One export per TypeScript file in a `resources/` folder: its capabilities
   * go in the `uses` of the agent and coordinator flows the kit builds, and
   * its resources beside the folder's documents, for a worker to be granted.
   */
  readonly resourceModules?: ResourceModules;
  /** The blocks each standard worker's own folders register. */
  readonly workerBlocks?: Readonly<Record<string, Readonly<Record<string, BlockDefinition<any, any>>>>>;
  /** The blocks each package carries. */
  readonly packageBlocks?: Readonly<Record<string, Readonly<Record<string, BlockDefinition<any, any>>>>>;
}

/** The workforce kit's config. */
export interface WorkforceConfig {
  /** The built-in `agent` flow's options. Omitted: its defaults, unless `workerFlows` holds an `agent`. */
  agent?: WorkforceAgentOptions;
  /** The `coordinator` flow's options. Omitted: no coordinator flow, unless `workerFlows` holds one. */
  coordinator?: WorkforceCoordinatorOptions;
  /** Consulting another of the user's conversations: the model and budget it reads on. */
  consult?: ConsultSessionsOptions;
  /** Routines: the schedule index, the providers an event routine follows, polling, the app's declared ones. */
  routines?: RoutinesOptions;
  /** GitHub's service flow, which delivers GitHub's events to the conversations that follow them. Omitted: none. */
  github?: Omit<GitHubServiceFlowOptions, "installation">;
  /**
   * Internal events: the topics a session may publish on and a routine may
   * follow. The kit serves the internal service flow, adds its provider to
   * routines, and a worker flow built on the installation reaches its
   * publish through {@link internalEventsOf}. Omitted: none.
   */
  internalEvents?: Omit<InternalServiceFlowOptions, "installation">;
  /** The app's generated `workforce.gen.ts`, imported whole. */
  generated?: GeneratedWorkforce;
  /** The most tasks one top task may have under it. Omitted: 100. */
  taskChainLimit?: number;
  /** The limits on worker messages. */
  messages?: MessageLimits;
  /** The standard worker each user's project coordinator runs as. */
  projectCoordinator?: string;
  /**
   * Session fields the app declares on the agent and coordinator sessions, a
   * schema each, by name. Only the server writes one: a create that seeds it
   * is refused, naming it, and the client reads it off the session.
   * Every field is visible to the session's browser. Never put a secret here.
   */
  sessionFields?: SessionFields;
}

/** Accepts any object: what the field holds is checked where it is used. */
const object = <T>() => z.custom<T>((value) => typeof value === "object" && value !== null);

/** A generated map: a plain record. */
const generatedMap = z.record(z.unknown());

/** The generated module's maps, and no other: a misspelled one is refused rather than dropped. */
const generatedSchema = object<GeneratedWorkforce>().pipe(
  z
    .object({
      workerFlows: generatedMap.optional(),
      blocks: generatedMap.optional(),
      resourceModules: generatedMap.optional(),
      workerBlocks: z.record(generatedMap).optional(),
      packageBlocks: z.record(generatedMap).optional(),
    })
    .strict() as never,
) as unknown as z.ZodType<GeneratedWorkforce, z.ZodTypeDef, GeneratedWorkforce>;

const configSchema: z.ZodType<WorkforceConfig, z.ZodTypeDef, WorkforceConfig> = z
  .object({
    agent: object<WorkforceAgentOptions>().optional(),
    coordinator: object<WorkforceCoordinatorOptions>().optional(),
    consult: object<ConsultSessionsOptions>().optional(),
    routines: object<RoutinesOptions>().optional(),
    github: object<Omit<GitHubServiceFlowOptions, "installation">>().optional(),
    internalEvents: object<Omit<InternalServiceFlowOptions, "installation">>().optional(),
    generated: generatedSchema.optional(),
    taskChainLimit: z.number().int().positive().optional(),
    messages: object<MessageLimits>().optional(),
    projectCoordinator: z.string().min(1).optional(),
    sessionFields: z.record(z.custom<ZodTypeAny>((value) => value instanceof z.ZodType, { message: "a session field is a zod schema" })).optional(),
  })
  .strict();

/** A `workerFlows` entry: a flow, `{ flow, … }`, or a `workerFlow(…)` builder. */
const workerFlowEntrySchema = z.custom<WorkerFlowEntry>(
  (value) => typeof value === "function" || (typeof value === "object" && value !== null),
  { message: "a worker flow entry is a flow, `{ flow }`, or `workerFlow(…)`" },
);

/** A `flows` entry: builds flows on the installation the kit hired. */
export type WorkforceFlowsBuilder = (installation: WorkerInstallation) => readonly FlowInstance<any, any>[];

const flowsBuilderSchema = z.custom<WorkforceFlowsBuilder>((value) => typeof value === "function", {
  message: "a `flows` entry is a function that builds flows on the installation",
});

/** A `uses` entry: a capability, or a function choosing them per turn. */
const usesEntrySchema = z.custom<UsesEntry>(
  (value) => typeof value === "function" || (typeof value === "object" && value !== null),
  { message: "a `uses` entry is a capability" },
);

/**
 * Workforce, as a kit. Its folder defaults to `workforce/` beside the app.
 *
 * @example
 *   createFlowState({ kits: [workforce({ agent: { model: "openai/gpt-6-luna" } })], stores });
 */
export const workforce = defineKit({
  name: "workforce",
  config: configSchema,
  slots: {
    workerFlows: slot.keyed(workerFlowEntrySchema),
    uses: slot.list(usesEntrySchema),
    flows: slot.keyed(flowsBuilderSchema),
  },
  directory: { path: "workforce", read: (folder) => readWorkforceFolder(folder) },
  install: ({ config, folder, slots }) => ({ flows: installWorkforce(config, folder as WorkforceFolder, slots) }),
});

/** Build the installation over the folder's workers and hire it. */
function installWorkforce(
  config: WorkforceConfig,
  folder: WorkforceFolder,
  slots: {
    readonly workerFlows: Readonly<Record<string, WorkerFlowEntry>>;
    readonly uses: readonly UsesEntry[];
    readonly flows: Readonly<Record<string, WorkforceFlowsBuilder>>;
  },
): FlowInstance[] {
  const generated = config.generated ?? {};
  // A worker flow is the generated module's or the slot's, never both; one
  // keyed `agent` or `coordinator` from either replaces the kit's own, which
  // is then not configured.
  const both = Object.keys(generated.workerFlows ?? {}).filter((name) => Object.hasOwn(slots.workerFlows, name));
  if (both.length > 0) {
    throw new Error(`workforce: the generated module and \`workerFlows\` both hold ${both.map((name) => `"${name}"`).join(", ")}. Keep one.`);
  }
  const filled: Record<string, WorkerFlowEntry> = { ...generated.workerFlows, ...slots.workerFlows };
  if (config.agent !== undefined && Object.hasOwn(filled, AGENT_FLOW)) {
    throw new Error(`workforce: \`agent\` is configured, and the app's worker flows hold an "${AGENT_FLOW}" flow too. Keep one.`);
  }
  if (config.coordinator !== undefined && Object.hasOwn(filled, COORDINATOR_FLOW)) {
    throw new Error(`workforce: \`coordinator\` is configured, and the app's worker flows hold a "${COORDINATOR_FLOW}" flow too. Keep one.`);
  }
  // The `resources/` folders' TypeScript modules: capabilities for the flows, resources for the grants.
  const modules = splitResourceModules(generated.resourceModules ?? {});
  /** What every flow this kit builds adds: the slot's capabilities and workforce's own two. */
  const added = (installation: WorkerInstallation): CapabilityRef[] =>
    [
      ...slots.uses,
      ...modules.capabilities,
      consultSessionsCapability(installation, config.consult ?? {}),
      createRoutinesCapability(installation),
    ] as CapabilityRef[];

  /** The app's session fields, for the agent and coordinator flows the kit builds. */
  const fields = config.sessionFields === undefined ? {} : { sessionFields: config.sessionFields };
  const builtIn: Record<string, WorkerFlowEntry> = {};
  if (!Object.hasOwn(filled, AGENT_FLOW)) {
    const { showSettings, ...agent } = config.agent ?? {};
    builtIn[AGENT_FLOW] = workerFlow(
      (installation) =>
        defineAgentWorkerFlow({
          ...(generated.blocks === undefined ? {} : { catalog: generated.blocks as never }),
          ...agent,
          installation,
          ...fields,
          uses: [...(agent.uses ?? []), ...added(installation)],
        }),
      { showSettings: showSettings ?? [] },
    );
  }
  if (config.coordinator !== undefined) {
    const coordinator = config.coordinator;
    builtIn[COORDINATOR_FLOW] = workerFlow((installation) =>
      defineCoordinatorFlow({
        ...coordinator,
        installation,
        ...fields,
        agent: { ...coordinator.agent, uses: [...(coordinator.agent?.uses ?? []), ...added(installation)] },
      }),
    );
  }

  const installation = createWorkerInstallation({
    standardWorkers: folder.workers,
    workerFlows: { ...filled, ...builtIn },
    ...(generated.workerBlocks === undefined ? {} : { workerBlocks: generated.workerBlocks as never }),
    ...(generated.packageBlocks === undefined ? {} : { packageBlocks: generated.packageBlocks as never }),
    documents: { ...resourcesFromDocs([...folder.documents]), ...modules.resources } as never,
    ...(folder.references.length === 0 ? {} : { references: referencesFromDocs([...folder.references]) as never }),
    ...(config.projectCoordinator === undefined ? {} : { projectCoordinator: config.projectCoordinator }),
  });
  // Built before the hire: its provider joins routines, and the worker flows the hire builds reach its publish.
  const internal = config.internalEvents === undefined ? undefined : internalServiceFlow({ ...config.internalEvents, installation });
  if (internal !== undefined) internalEvents.set(installation, internal);
  const routines =
    internal === undefined ? config.routines : { ...config.routines, providers: [...(config.routines?.providers ?? []), internal.provider] };
  const copies = hireWorkforce(installation, {
    ...(config.taskChainLimit === undefined ? {} : { taskChainLimit: config.taskChainLimit }),
    ...(config.messages === undefined ? {} : { messages: config.messages }),
    ...(routines === undefined ? {} : { routines }),
  });
  const built = Object.values(slots.flows).flatMap((build) => build(installation) as FlowInstance[]);
  const github = config.github === undefined ? [] : [githubServiceFlow({ ...config.github, installation }) as unknown as FlowInstance];
  const service = internal === undefined ? [] : [internal.flow as unknown as FlowInstance];
  return [...copies, ...github, ...service, ...built];
}

/** The internal events each installation the kit hired serves, by installation. */
const internalEvents = new WeakMap<WorkerInstallation, InternalServiceFlow>();

/**
 * The internal events the workforce kit serves for `installation`: its
 * `publishEvent`, the resources a block that calls it declares, and its tool
 * as a capability. Call it in a worker flow's builder, or a `flows` builder,
 * with the installation it is handed.
 *
 * @throws When the kit that hired `installation` has no `internalEvents` config.
 */
export function internalEventsOf(installation: WorkerInstallation): InternalServiceFlow {
  const internal = internalEvents.get(installation);
  if (internal === undefined) throw new Error("internalEventsOf: the workforce kit was given no `internalEvents`, so it serves none.");
  return internal;
}
