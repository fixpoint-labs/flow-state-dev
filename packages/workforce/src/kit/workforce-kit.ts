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
import { z } from "zod";
import { AGENT_FLOW, defineAgentWorkerFlow, type AgentWorkerFlowOptions } from "../agent-worker-flow";
import { COORDINATOR_FLOW } from "../coordinator/coordinator-keys";
import { defineCoordinatorFlow, type CoordinatorFlowOptions } from "../coordinator/coordinator-flow";
import type { WorkerFlowEntry } from "../hire";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { readWorkforceFolder, type WorkforceFolder } from "../loader/read-workforce-folder";
import { consultSessionsCapability, type ConsultSessionsOptions } from "../messages/consult";
import type { MessageLimits } from "../messages/message-limits";
import { referencesFromDocs } from "../references-from-docs";
import { resourcesFromDocs } from "../resources-from-docs";
import { createRoutinesCapability, type RoutinesOptions } from "../routines/routines";
import { githubServiceFlow, type GitHubServiceFlowOptions } from "../service-flows/github/service-flow";
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
  /** One worker flow per file under `flows/workers/`. */
  readonly workerFlows?: Readonly<Record<string, WorkerFlowEntry>>;
  /** One block per file under `blocks/`: the agent flow's tool catalog, when its config names none. */
  readonly blocks?: Readonly<Record<string, BlockDefinition<any, any>>>;
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
  /** The app's generated `workforce.gen.ts`, imported whole. */
  generated?: GeneratedWorkforce;
  /** The most tasks one top task may have under it. Omitted: 100. */
  taskChainLimit?: number;
  /** The limits on worker messages. */
  messages?: MessageLimits;
  /** The standard worker each user's project coordinator runs as. */
  projectCoordinator?: string;
}

/** Accepts any object: what the field holds is checked where it is used. */
const object = <T>() => z.custom<T>((value) => typeof value === "object" && value !== null);

const configSchema: z.ZodType<WorkforceConfig, z.ZodTypeDef, WorkforceConfig> = z
  .object({
    agent: object<WorkforceAgentOptions>().optional(),
    coordinator: object<WorkforceCoordinatorOptions>().optional(),
    consult: object<ConsultSessionsOptions>().optional(),
    routines: object<RoutinesOptions>().optional(),
    github: object<Omit<GitHubServiceFlowOptions, "installation">>().optional(),
    generated: object<GeneratedWorkforce>().optional(),
    taskChainLimit: z.number().int().positive().optional(),
    messages: object<MessageLimits>().optional(),
    projectCoordinator: z.string().min(1).optional(),
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
  const filled = slots.workerFlows;
  if (config.agent !== undefined && Object.hasOwn(filled, AGENT_FLOW)) {
    throw new Error(`workforce: \`agent\` is configured, and \`workerFlows\` holds an "${AGENT_FLOW}" flow too. Keep one.`);
  }
  if (config.coordinator !== undefined && Object.hasOwn(filled, COORDINATOR_FLOW)) {
    throw new Error(`workforce: \`coordinator\` is configured, and \`workerFlows\` holds a "${COORDINATOR_FLOW}" flow too. Keep one.`);
  }
  const generated = config.generated ?? {};
  /** What every flow this kit builds adds: the slot's capabilities and workforce's own two. */
  const added = (installation: WorkerInstallation): CapabilityRef[] =>
    [
      ...slots.uses,
      consultSessionsCapability(installation, config.consult ?? {}),
      createRoutinesCapability(installation),
    ] as CapabilityRef[];

  const builtIn: Record<string, WorkerFlowEntry> = {};
  if (!Object.hasOwn(filled, AGENT_FLOW)) {
    const { showSettings, ...agent } = config.agent ?? {};
    builtIn[AGENT_FLOW] = workerFlow(
      (installation) =>
        defineAgentWorkerFlow({
          ...(generated.blocks === undefined ? {} : { catalog: generated.blocks as never }),
          ...agent,
          installation,
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
        agent: { ...coordinator.agent, uses: [...(coordinator.agent?.uses ?? []), ...added(installation)] },
      }),
    );
  }

  const installation = createWorkerInstallation({
    standardWorkers: folder.workers,
    workerFlows: { ...generated.workerFlows, ...filled, ...builtIn },
    ...(generated.workerBlocks === undefined ? {} : { workerBlocks: generated.workerBlocks as never }),
    ...(generated.packageBlocks === undefined ? {} : { packageBlocks: generated.packageBlocks as never }),
    ...(folder.documents.length === 0 ? {} : { documents: resourcesFromDocs([...folder.documents]) as never }),
    ...(folder.references.length === 0 ? {} : { references: referencesFromDocs([...folder.references]) as never }),
    ...(config.projectCoordinator === undefined ? {} : { projectCoordinator: config.projectCoordinator }),
  });
  const copies = hireWorkforce(installation, {
    ...(config.taskChainLimit === undefined ? {} : { taskChainLimit: config.taskChainLimit }),
    ...(config.messages === undefined ? {} : { messages: config.messages }),
    ...(config.routines === undefined ? {} : { routines: config.routines }),
  });
  const built = Object.values(slots.flows).flatMap((build) => build(installation) as FlowInstance[]);
  const github = config.github === undefined ? [] : [githubServiceFlow({ ...config.github, installation }) as unknown as FlowInstance];
  return [...copies, ...github, ...built];
}
