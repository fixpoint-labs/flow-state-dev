/**
 * The lab itself — one module both checks import, so the model-free contract
 * gate and the model-backed honesty check drive the *same* tree, the same hire
 * and the same wiring, and differ by one block.
 *
 * What `openLab` does, in order, and nothing else: read the tree, build the
 * installation and the worker flows on it, register one copy of each worker flow,
 * write the organization's inventory when asked, create the projects and open
 * the workstreams it was given, and hand back the handles. Every convention
 * file it reads is found by walking from one root; no file is named in this
 * code.
 *
 * **A task lives on the board of the session it was filed from.** The EM
 * worker's sessions each keep one (Workforce's session board): its
 * `WORKER.md` names the coder and the reviewer as delegates, and a task it
 * files there is handed to its delegate in a task session of its own, and
 * reports back to the session that filed it. A workstream the EM leads is a
 * session of the EM, so its board is the workstream's.
 *
 * Three pieces here are the lab's rather than the framework's, each because
 * the framework has no opinion at that spot:
 *
 * 1. **The worker the lab's doors file for.** The EM's `file` and `askToFile`
 *    doors file each feature for the worker the caller supplies, which is what
 *    lets a control point it at the wrong delegate and watch the negative
 *    claim go red.
 * 2. **The harness slot**, handed to the `coder` worker flow. The one expression that
 *    differs between this lab's two checks.
 * 3. **The host `resolvePrincipal`.** FSD does not provide login. After
 *    FIX-1442 an unconfigured host runs under the development organization,
 *    which is not a refusal. The lab wires a fail-closed bearer check so an
 *    unauthenticated HTTP read is turned away for real (FIX-1515 / BR-17).
 *
 * **Not `workforce.gen.ts`.** `fsdev gen` renders that file for an app
 * directory, and `goals/` is not one. The worker flows are hand-assembled here, which
 * FIX-1357's own contract says composes with a generated map rather than being
 * deprecated by it. `goals/pentest-lab/lab/host.mts` does the same, for the same
 * reason.
 */

import {
  createBearerSecretPrincipalResolver,
  createFlowState,
  PrincipalResolutionError,
  resolveUserStorageKey,
  runAction,
  type FlowState,
  type PrincipalResolver,
} from "@flow-state-dev/engine";
import { defineCapability, handler, sequencer } from "@flow-state-dev/core";
import { encodeUserSegment, type BlockContext, type FlowInstance, type ModelResolver } from "@flow-state-dev/core/types";
import type { WorkspaceConfig } from "@flow-state-dev/harness-manager";
import { localWorkspaceHost, redactRemote, type WorkspaceHost } from "@flow-state-dev/workspace";
import { z } from "zod";
import {
  AGENT_FLOW,
  COORDINATOR_FLOW,
  defineCoordinatorFlow,
  createWorkerHireBlocks,
  createWorkerInstallation,
  createWorkforceCapability,
  defineAgentWorkerFlow,
  defineWorkerInventoryCollection,
  hireWorkforce,
  inventoryWorkers,
  inventoryWriterActions,
  createProjectInputSchema,
  createProjectOutputSchema,
  defineProjectBlocks,
  listProjectsInputSchema,
  listProjectsOutputSchema,
  defineWorkstreamBlocks,
  linkedProjectOf,
  projectCoordinatorTools,
  projectWorkspace,
  mergeWorkerFlows,
  openInventory,
  resourcesFromDocs,
  WORKSTREAM_OPENED_ENTRY,
  type CreateProjectInput,
  type CreateProjectOutput,
  type HireOptions,
  type OpenWorkstreamInput,
  type OpenWorkstreamOutput,
  type ProjectCheckout,
  type WorkerInstallation,
  setRepositoryInputSchema,
  setRepositoryOutputSchema,
  type InventoryActionRequest,
  type ProjectBlocks,
  type WorkstreamBlocks,
} from "@flow-state-dev/workforce";
import {
  readDeclaredRoster,
  type DeclaredRoster,
} from "@flow-state-dev/workforce/loader";
import { defineFlow } from "@flow-state-dev/core";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WORKER_ID_STATE_KEY } from "@flow-state-dev/workforce/browser";
import { DOCUMENT_KEY, INSPECT_ENTRY, WORKER_FACTS_COMPONENT, workerOf } from "./worker-config.mts";
import { defineAnswerPhase, defineImplementPhase, noteStartingFiles } from "./phase.mts";
import { defineCoderJudge } from "./judge.mts";
import { CODER_FLOW, defineCoderWorkerFlow } from "./workforce/flows/workers/coder.mts";
import {
  DRAIN_ENTRY,
  EM_FLOW,
  FILE_ENTRY,
  defineEmWorkerFlow,
  featureIssueOf,
} from "./workforce/flows/workers/em.mts";
import type { HarnessStub } from "./harness-stub.mts";
import { coordinatorMemory } from "./memory.mts";
import { withWriteLatency } from "./write-latency.mts";
import {
  openWorkerSession,
  RAISE_ASK_STEP,
  raiseAsk,
  workerSessionId,
  type AskFeature,
  type RaiseAskResult,
} from "./ask.mts";

/** The authored tree — the one path this code names. Everything else is walked. */
export const LAB_TREE = fileURLToPath(new URL("./workforce", import.meta.url));

/** The flow the lab creates projects through at open. */
export const PROJECTS_FLOW = "projects";

/** The session the lab's own project writes run in, as the owner. */
export const PROJECTS_SESSION = "devforce-projects";

/**
 * The collection a session's board keeps its rows in: Workforce's
 * conversation ledger, under each session's partition.
 */
const SESSION_BOARD_COLLECTION = "tasks";

/** The flow the inventory's worker rows are written from: the lab's own, carrying the writer. */
export const INVENTORY_WRITER_FLOW = "inventory-writer";

/**
 * The standard worker every user's project coordinator runs as: the
 * installation names it, and each user's coordinator for a project is a
 * session of it (`org/workers/project-coordinator/`).
 */
export const PROJECT_COORDINATOR = "project-coordinator";

/** Who the lab runs as, and the org every document read is bound to. */
export const LAB_USER_ID = "u_devforce_lab";
export const LAB_ORG_ID = "devforce-lab";

/** The Lab user's cell in the Lab org, where every flow keeps that user's data. */
const LAB_USER_CELL = resolveUserStorageKey(LAB_USER_ID, LAB_ORG_ID, { id: "", isolateUserState: false });

/**
 * Host-owned verified identity for this lab's HTTP door (FIX-1515).
 *
 * After FIX-1442 an app that configures no resolver runs under the built-in
 * development organization. That default is not a refusal, so an org-less
 * probe at the transport door was being answered. Wiring a real
 * `resolvePrincipal` is what makes an unauthenticated read have nothing to
 * fall back to — the same posture a deployment that has verified identity
 * uses. The mint FIX-1503 will ship is not here yet; this is the thin
 * host-owned stub that issue allows: one secret per principal
 * ({@link LAB_USERS}), fail-closed when nothing verified is presented.
 *
 * In-process `runAction` is not HTTP and keeps the explicit lab org
 * (FIX-1503: trusted process callers). Only the door this check probes goes
 * through the resolver.
 */
const LAB_PRINCIPAL_SECRET = "devforce-lab-verified-principal";

/**
 * The three named people this lab's door knows, each by a secret of their
 * own, all in the lab's organization: the owner (who the lab runs as, and who
 * the page is handed), a second project member of the default projects, and an
 * outsider who is in the organization and on no project. The two others exist
 * so a check can act in a project as a project member who did not create it,
 * and be refused as someone who is not one.
 */
export const LAB_USERS = {
  owner: { userId: LAB_USER_ID, bearer: LAB_PRINCIPAL_SECRET },
  member: { userId: "u_devforce_member", bearer: "devforce-lab-verified-member" },
  outsider: { userId: "u_devforce_outsider", bearer: "devforce-lab-verified-outsider" },
} as const;

/**
 * More members of the default projects, each with a secret of their own. With
 * the project member above they are eight people whose writes to one project can
 * race: the engine's own retries absorb a race between two or three writers,
 * so a check that the projects' own retry is load-bearing needs more of them.
 */
export const LAB_CROWD = Array.from({ length: 7 }, (_, i) => ({
  userId: `u_devforce_crowd_${i + 1}`,
  bearer: `devforce-lab-verified-crowd-${i + 1}`,
}));

const labBearers = [...Object.values(LAB_USERS), ...LAB_CROWD].map((user) =>
  createBearerSecretPrincipalResolver({
    secret: user.bearer,
    principal: { userId: user.userId, orgId: LAB_ORG_ID },
  }),
);

/**
 * One secret per user. Each resolver refuses a bearer that is not its own,
 * so the first that recognises the token answers; a token none recognises,
 * and a request with none, is refused.
 */
const resolveLabPrincipal: PrincipalResolver = async (context) => {
  for (const verify of labBearers) {
    try {
      const principal = await verify(context);
      if (principal !== null) return principal;
      break; // No bearer at all: every resolver would say the same.
    } catch (error) {
      if (!(error instanceof PrincipalResolutionError)) throw error;
    }
  }
  throw new PrincipalResolutionError(
    "Request requires a verified organization: no verified principal was presented.",
    { status: 401 },
  );
};

/**
 * Read a workforce tree into records, refusing a tree that did not load
 * cleanly.
 *
 * The shared reader collects rather than throws, which is right for a library
 * and wrong here: a worker that failed to load is a worker this lab does not have,
 * and a short roster that still runs is the failure BR-2 exists to exclude. The
 * refusal is this lab's own policy, which is why it lives here and not behind
 * the export.
 */
async function loadTree(root: string): Promise<DeclaredRoster> {
  const roster = await readDeclaredRoster(root);
  if (roster.problems.length > 0) {
    const lines = roster.problems.map((p) =>
      p.worker === undefined
        ? `${p.layer} ${p.path}: ${p.error.message}`
        : `${p.layer} ${p.path} (worker ${p.worker}): ${p.error.message}`,
    );
    throw new Error(`the tree at ${root} did not load cleanly:\n  - ${lines.join("\n  - ")}`);
  }
  return roster;
}

/**
 * The projects flow's action that names this Lab's project setup, for Shift
 * Manager: it doesn't name the project coordinator itself, and reads it here.
 */
export const PROJECT_SETUP_ACTION = "projectSetup";

/**
 * The project setup as the projects flow answers it: the installation's
 * project coordinator, or `null` when the tree doesn't declare one.
 */
function projectSetup(installation: WorkerInstallation) {
  return handler({
    name: "devforce-project-setup",
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({ projectCoordinator: z.string().nullable() }),
    execute: () => ({ projectCoordinator: installation.projectCoordinator()?.worker ?? null }),
  });
}

/**
 * The lead flows as the workstream writes check them: the built-in `agent`
 * flow and the EM's `em` flow each declare the entry that starts a
 * workstream's session. Read before the flows are built, which need the
 * writes' tools in their catalogs.
 */
const LEAD_FLOWS = [AGENT_FLOW, EM_FLOW].map((flow) => ({ kind: flow, internal: { actions: { [WORKSTREAM_OPENED_ENTRY]: {} } } }));

/** The project tools, by the names the chief of staff's and the project coordinator's `tools:` lines spell. */
const PROJECT_TOOL_NAMES: readonly string[] = ["createProject", "setRepository", "setBrief", "openWorkstream", "listProjects"];

/** The user's projects, with what a coder's task that names no project does next. */
const listedForCodingSchema = listProjectsOutputSchema.extend({ forCoding: z.string() });

/**
 * What a coder's task that names no project does next, worked out from the
 * projects with a repository rather than left to the model to count: file it
 * for the one there is, or ask, naming them. A real model told the rule in
 * prose picked one of two, or offered instead of filing, about one turn in
 * three.
 */
const forCoding = handler({
  name: "list-projects-for-coding",
  inputSchema: listProjectsOutputSchema,
  outputSchema: listedForCodingSchema,
  execute: (listed) => {
    const coded = listed.projects.filter((project) => project.repository != null);
    const named = (project: (typeof coded)[number]) => `${project.title} (${JSON.stringify({ visibility: project.visibility, id: project.id })})`;
    const [only] = coded;
    const next =
      coded.length === 1 && only !== undefined
        ? `One project has a repository: ${named(only)}. Hand a coder's task that names no project to it now, with dispatchTask, without asking.`
        : coded.length === 0
          ? "No project has a repository. Ask which project the user means."
          : `${coded.length} projects have a repository: ${coded.map(named).join(", ")}. File nothing. Ask which one the user means, naming each.`;
    return { ...listed, forCoding: next };
  },
});

/**
 * The project writes as the chief of staff's tools, `createProject`,
 * `setRepository` and `openWorkstream`, and its one project read,
 * `listProjects`: the same blocks the Lab's own projects flow runs, under the
 * names its `tools:` line spells. A catalog key must be the tool's own name,
 * so `openWorkstream` and `setBrief` are the blocks under `.as()`; the others
 * are sequencers named for the tool, since each waits for an approval first,
 * or, for `listProjects`, adds `forCoding`.
 *
 * `listProjects` is how the chief of staff knows which project a coder's task
 * works in: the projects the user is a member of, read when asked, never
 * guessed.
 *
 * `openWorkstream` names its lead: a worker on the user's roster that can
 * lead, and whose description says it does the work. The project coordinator
 * opens workstreams through the same block.
 *
 * The owner is the session's user, so a project the chief of staff creates
 * belongs to the user talking to it, who is always a project member; `members` adds
 * whoever they name.
 *
 * **A repository waits for the user.** Which remote a project's code is
 * cloned from is the user's to say, so `setRepository`, and `createProject`
 * with a `repository`, pause on a stock `human_approval` before the write.
 * Approve writes it; Deny throws out of the tool before the write runs, and
 * nothing changes. Without durable execution the tool refuses rather than
 * writing unasked.
 */
export function chiefOfStaffProjectTools(blocks: ProjectBlocks, workstreams: WorkstreamBlocks) {
  return {
    listProjects: sequencer({
      name: "listProjects",
      description:
        "List the projects the user you are talking to is a member of: each one's address " +
        "(`visibility` and `id`), its title, and its `repository` (null when it has none), and " +
        "`forCoding`, what to do with a coder's task that names no project. Answer which projects " +
        "they have, and pick the project a task works in, from this, never from memory.",
      inputSchema: listProjectsInputSchema,
      outputSchema: listedForCodingSchema,
    })
      .step(blocks.listProjects)
      .step(forCoding),
    openWorkstream: workstreams.openWorkstreamTool.as({
      name: "openWorkstream",
      description:
        "Open a workstream for the user you are talking to, in a project, by the project's address " +
        "(`visibility` and `id`): a short lowercase `id`, its `title`, and its `lead`, a worker on their " +
        "roster that leads it. They own it, and nobody else can change it. On a shared project, members only.",
    }),
    createProject: sequencer({
      name: "createProject",
      description:
        "Create a project for the user you are talking to. They own it and are always a project member. " +
        "`id` is a short lowercase slug; `members` adds the user ids they name; `repository` is the git " +
        "remote its code lives in, if they named one. With a repository, the user approves it first.",
      inputSchema: createProjectInputSchema,
      outputSchema: createProjectOutputSchema,
    })
      .tapIf((input) => input.repository != null, askRepository((input) => input.id))
      .step(blocks.createProject),
    setRepository: sequencer({
      name: "setRepository",
      description:
        "Set, change or clear (null) the git remote a project's code lives in, by the project's address " +
        "(`visibility` and `id`); in a project's own conversation, leave `project` out. " +
        "Only project members may, and the user approves it first.",
      inputSchema: setRepositoryInputSchema,
      outputSchema: setRepositoryOutputSchema,
    })
      .tap(
        askRepository((input, ctx) => {
          // Only a project the write can change is asked about: a linked conversation naming another is refused below.
          const linked = linkedProjectOf(ctx.session.state);
          if (linked === undefined) return input.project?.id;
          const named = input.project as { id: string; visibility?: unknown } | undefined;
          return named === undefined || (named.id === linked.id && named.visibility === linked.visibility) ? linked.id : undefined;
        }),
      )
      .step(blocks.setRepository),
    setBrief: blocks.setBrief.as({
      name: "setBrief",
      description:
        "Set, change or clear (null) a project's brief, what the project is for, by the project's address " +
        "(`visibility` and `id`); in a project's own conversation, leave `project` out. Only project members may.",
    }),
  };
}

/**
 * Hire and fire as the chief of staff's tools, under the names its `tools:`
 * line spells: Workforce's hire blocks, each a write to the roster of the
 * user talking to it. A catalog key must be the tool's own name, so `hire`
 * is the block under `.as()`; `fire` is a sequencer, because it waits for an
 * approval first.
 *
 * **A fire waits for the user.** It pauses on a stock `human_approval`
 * naming the worker before the write; Deny throws out of the tool before the
 * write runs, and nothing changes. Without durable execution the tool refuses
 * rather than firing unasked.
 */
export function chiefOfStaffRosterTools(installation: WorkerInstallation) {
  const blocks = createWorkerHireBlocks(installation);
  return {
    hire: blocks.hire.as({
      name: "hire",
      description:
        "Hire a worker of the user's own: `id` is a short lowercase slug, `flow` the flow it runs on " +
        "(`agent` when omitted), and `settings` the keys its file would declare. It lands at once.",
    }),
    fire: sequencer({
      name: "fire",
      description:
        "Fire one of the user's own workers, by its id, once the user approves it. A worker the files declare can't be fired.",
      inputSchema: blocks.fire.inputSchema,
      outputSchema: blocks.fire.outputSchema,
    })
      .tap(askFire)
      .step(blocks.fire),
  };
}

/** The approval a fire waits on: a stock `human_approval` naming the worker. Returns on Approve; on Deny the runtime throws out of it. */
const askFire = handler({
  name: "devforce-cos-ask-fire",
  inputSchema: z.object({ id: z.string() }).passthrough(),
  outputSchema: z.void(),
  execute: async (input: { id: string }, ctx: BlockContext) => {
    if (ctx.suspend === undefined) {
      throw new Error(
        `firing "${input.id}" waits for a user's approval here, and this app can't ask for one: it runs ` +
          `without durable execution. Nothing was changed.`,
      );
    }
    await ctx.suspend({
      reason: "human_approval",
      message: `Fire worker "${input.id}"?`,
      data: { worker: input.id },
      allow: ["approve", "reject"],
    });
  },
});

/** What a repository ask reads off a write's input. */
const repositoryAskInputSchema = z
  .object({
    id: z.string().optional(),
    project: z.object({ id: z.string() }).passthrough().optional(),
    repository: z.string().nullable().optional(),
  })
  .passthrough();

/**
 * The approval a repository write waits on: a stock `human_approval` naming
 * the project and the remote, with any user or password left out of what
 * Inbox shows. Returns on Approve; on Deny the runtime throws out of it.
 */
function askRepository(
  projectOf: (input: z.infer<typeof repositoryAskInputSchema>, ctx: BlockContext) => string | undefined,
) {
  return handler({
    name: "devforce-cos-ask-repository",
    inputSchema: repositoryAskInputSchema,
    outputSchema: z.void(),
    execute: async (input: z.infer<typeof repositoryAskInputSchema>, ctx: BlockContext) => {
      const project = projectOf(input, ctx);
      // No project to name: the write that follows refuses, so there is nothing to approve.
      if (project === undefined) return;
      if (ctx.suspend === undefined) {
        throw new Error(
          `the repository of project "${project}" waits for a user's approval here, and this app ` +
            `can't ask for one: it runs without durable execution. Nothing was changed.`,
        );
      }
      const repository = input.repository == null ? null : redactRemote(input.repository);
      await ctx.suspend({
        reason: "human_approval",
        message:
          repository === null
            ? `Clear the repository of project "${project}"? Its coding work will run on its files.`
            : `Set the repository of project "${project}" to ${repository}?`,
        data: { project, repository },
        allow: ["approve", "reject"],
      });
    },
  });
}

export interface OpenLabOptions {
  /** The store adapter this lab runs over — `inMemoryStores()` is enough. */
  stores: unknown;
  /** The harness the `coder` worker flow runs. The one thing the two checks differ by. */
  harness: HarnessStub["slot"];
  /**
   * Where each coding run works.
   *
   * `{ root, sourceRepo, baseRef }`: every feature run is a new branch of one
   * fixed repository, as the older checks run. `{ root, remotes }`: a
   * workspace host whose source is `projectWorkspace()`, so a run works in a
   * branch of its project's repository (reached only if `remotes.allow` lists
   * it), or on its project's files when the project has none. Its project is
   * the one of the workstream its task was filed from, or the one the task
   * names.
   */
  workspace: WorkspaceConfig | LabWorkspaceHost;
  /**
   * The worker the EM's `file` and `askToFile` doors file each feature for:
   * one of the EM's delegates that takes tasks.
   *
   * Supplied by the caller because a control that points it at the wrong
   * declared worker is the only way "the row reached the worker it named" can
   * be made to go red.
   */
  coderWorkerId: string;
  /** Wall-clock budget for one harness run. Default 60s. */
  runTimeoutMs?: number;
  /**
   * The models the lab's flows resolve. For a check that scripts the model: it
   * reaches every path a request takes, the HTTP door's resume included.
   * Absent, the environment's.
   */
  modelResolver?: ModelResolver;
  /** The tree to read. Defaults to the lab's own. */
  root?: string;
  /** Silence the engine's own logging. */
  logger?: unknown;
  /**
   * Make the brief's acceptance check part of the done-condition (BR-4).
   *
   * Absent for the two older checks, whose scripted stub writes a file the
   * current brief does not name. See `phase.mts`.
   */
  requireAcceptance?: boolean;
  /**
   * Raise the EM worker's ask on open: one pending approval, in the EM worker's
   * own session, naming this feature (`ask.mts`).
   *
   * **Absent means absent**: no request and no store write for it (durable
   * execution stays on when a worker holds a tool that asks first). Present turns durable execution on, because the answer arrives later
   * through the engine's resume route, and open fails, naming the step, if the
   * ask could not be raised.
   */
  ask?: AskFeature;
  /**
   * Write the organization's worker inventory, the collection Shift Manager's
   * TEAMS reads, from the lab's own inventory-writer flow.
   *
   * **Absent means absent**: nothing is registered, as the other checks have
   * always run.
   */
  inventory?: boolean;
  /**
   * Hand a page the lab's user and verified bearer through the `devtool`
   * connection config, which the host injects on a loopback bind only. For a
   * long-lived server a browser reads (Shift Manager, the DevTool). Absent for the
   * checks, which read in-process.
   */
  devtool?: boolean;
  /**
   * Record each conversation with the shift coordinator into its memory after
   * each answer (`memory.mts`). Absent, its memory is read-side only: it
   * reads what is there and records nothing.
   */
  memoryCapture?: boolean;
  /**
   * Projects to create at open, as the lab's owner, through the same
   * `createProject` action anything else creates a project with. A project
   * the store already holds for the owner is handed back unchanged, so a
   * second open on a surviving store creates nothing new.
   *
   * **Absent means absent**: nothing is created, as the other checks run.
   */
  projects?: readonly CreateProjectInput[];
  /**
   * Workstreams to open at open, after the projects, each as one of the
   * {@link LAB_USERS}, through the same `openWorkstream` action Shift Manager
   * opens one with. A workstream already open is handed back unchanged.
   *
   * **Absent means absent**: nothing is opened.
   */
  workstreams?: readonly { as: keyof typeof LAB_USERS; input: OpenWorkstreamInput }[];

  // ---- controls, each the red state of one claim -------------------------

  /**
   * The asking door files its row before it suspends. The red state of
   * "nothing is filed until a user approves".
   */
  fileBeforeAsking?: boolean;

  /**
   * The workspace host saves nothing back: a run's project files are laid
   * down before it and dropped after. Only with a `{ root, remotes }`
   * workspace. The red state of "a run's files are kept by the project".
   */
  saveNothing?: boolean;

  /**
   * Repoint a worker at a different file-declared document, by worker id.
   *
   * Applied to the RECORD before the mint, so the worker genuinely runs on the
   * other ref rather than being graded as if it did. That is what makes it a
   * control: the prompt the manager builds then carries the wrong document's
   * token, which is the failure BR-10 exists to detect.
   */
  documentOverrides?: Record<string, string>;
  /**
   * Rewrite one worker's resolved skill union before the mint.
   *
   * Applied to the record for the same reason, so the worker genuinely hires with
   * the mutated set and reads it back through its own config.
   */
  mutateSkills?: (workerId: string, skills: WorkerSkill[]) => WorkerSkill[];
  /**
   * Build the phase so its prompt builder ignores the task the manager hands
   * it. The red state of "a run is handed the work a user approved".
   */
  dropTask?: boolean;
  /**
   * Leave the chief of staff's `listProjects` out: not in the catalog, and not
   * in its `tools:`, so it can't read which projects the user has. The red
   * state of "the chief of staff names the project a coder's task works in
   * without asking".
   */
  withoutProjectList?: boolean;
  /**
   * Leave the project tools out: not in the catalog the agent turn is built
   * with (the `agent` worker flow's, and the chief of staff's on the coordinator
   * flow), and not in any worker's `tools:`, as before the chief of staff had
   * them. Applied to the record before the mint, so the worker boots and
   * genuinely cannot create a project. The red state of "the chief of staff
   * creates projects".
   */
  withoutProjectTools?: boolean;
  /**
   * Build the coder's managers with no judge: a task settles on its phase's
   * check alone. The red state of "an answer Jev judged as missing the goal
   * doesn't close as completed".
   */
  withoutJudge?: boolean;
}

/** A workspace host for the lab to build: where its places live, and which remotes it may reach. */
export interface LabWorkspaceHost {
  /** The host directory every clone and place lives under. */
  root: string;
  /** The remotes the host may reach; list `"file"` to allow `file://` remotes. */
  remotes: { allow: readonly string[] };
  /**
   * Checkouts on this machine that named shared projects' runs work in, as
   * `projectWorkspace({ checkouts })` takes them: a run on one gets a
   * worktree of the checkout instead of a clone of its remote. Both of the
   * lab's hosts (a board's rows and a conversation's tasks) get them, and
   * each checkout is listed in both hosts' `localRepositories`. Absent: no
   * project is mapped, as before.
   */
  checkouts?: readonly ProjectCheckout[];
}

/** One skill on a worker record, as the loader shapes it. */
export interface WorkerSkill {
  name: string;
  skillMd: string;
  files?: Array<{ path: string; content: string }>;
}

/** Everything a check needs to drive and observe one lab. */
export interface Lab {
  roster: DeclaredRoster;
  /**
   * Each declared worker, by id, with the one registered copy of the flow it
   * runs on. Workers on one flow share its copy; the session names the worker.
   */
  workers: Record<string, FlowInstance>;
  /** The worker model the lab was built on. */
  installation: WorkerInstallation;
  /** File one row through the EM worker's own action, on its own session's board. */
  file(
    workerId: string,
    input: { issue: string; goal: string; maxAttempts?: number; project?: { visibility: "shared" | "private"; id: string } },
  ): Promise<{ output?: unknown; error?: string }>;
  /**
   * Run the EM worker's own session's board through its action, then wait
   * until no row on it is pending or in progress: a filing starts the board
   * by itself, so the run it started may hold the row this one finds busy.
   */
  drain(workerId: string): Promise<{ output?: unknown; error?: string }>;
  /**
   * Read the row filed for one feature, by its issue, off the board of the EM
   * worker's own session, where it is stored. The board mints a row's id, so a
   * feature is found by the issue its payload names.
   */
  featureRow(issue: string): Promise<Task | undefined>;
  /**
   * Every stored resource key in one scope, with its state — the raw storage
   * a check reads to say where a row lives and that no copy of it exists
   * anywhere else. `org` reads the lab's organization, `user` the lab's user.
   */
  stored(scope: "org" | "user", prefix?: string): Promise<Record<string, unknown>>;
  /**
   * Every row on the board of the EM worker's own session, by stored key.
   *
   * **Presence is not exclusivity.** A check that looks up the id it expects
   * can only ever confirm a row is there — a regression that filed a second
   * row under another id would stay green. This enumerates, so "exactly one"
   * can be graded as written.
   */
  rows(): Promise<Record<string, Task>>;
  /**
   * Every child session the EM worker's drain started, with the flow it ran on
   * and the worker it names — the **dispatch record**.
   *
   * This is what BR-6 and BR-8 are graded on. A worker's absence from a result
   * says nothing: a stray dispatch whose run produced nothing would be
   * indistinguishable from no dispatch at all.
   */
  dispatched(
    workerId: string,
  ): Promise<Array<{ sessionId: string; flowKind: string; flowId: string | undefined; workerId: string | undefined }>>;
  /**
   * Read one worker's own view of itself.
   *
   * `door` sends the request through the transport door instead of a direct
   * `runAction`: `"org-less"` with no credential at all, which BR-17 says is
   * refused before anything runs, and `"bearer"` with the lab's verified
   * bearer, which takes its org from that bearer and lands. A refusal is
   * returned rather than thrown, so it can be graded on its wording.
   */
  inspect(
    workerId: string,
    options?: { door?: "org-less" | "bearer" },
  ): Promise<{ facts?: Record<string, unknown>; error?: string }>;
  /**
   * What raising the ask did on this open. Absent when `ask` was not asked for.
   */
  ask?: RaiseAskResult;
  /**
   * What creating each of `projects` returned, in order: the row, and whether
   * this open wrote it. Absent when `projects` was not asked for.
   */
  projects?: CreateProjectOutput[];
  /**
   * What opening each of `workstreams` returned, in order. Absent when
   * `workstreams` was not asked for.
   */
  workstreams?: OpenWorkstreamOutput[];
  /**
   * Run one of the project and workstream writes (`createProject`,
   * `setRepository`, `openWorkstream`, `updateWorkstream`) as the lab's owner,
   * or as another of the {@link LAB_USERS}, in that user's projects
   * session. Absent when `projects` was not asked for.
   */
  projectAct?(
    actionName: string,
    input: unknown,
    as?: keyof typeof LAB_USERS,
  ): Promise<{ output?: unknown; error?: string }>;
  /**
   * The workspace host the coder worker flow runs on, when the lab built one
   * (`workspace: { root, remotes }`).
   */
  workspaceHost?: WorkspaceHost;
  /**
   * The flow state the worker flows are registered in: what a host hands
   * `raiseAsk` when it calls the step itself.
   */
  state: FlowState;
  /**
   * Send one request through the lab's HTTP door, as a user's client would.
   *
   * `path` is everything after `/api/flows/`, query string included. The lab's
   * verified bearer is sent unless `bearer` is `false`, which is how a check
   * shows the door refuses a caller that presented nothing. `as` sends one of
   * the other {@link LAB_USERS}' bearers instead.
   */
  door(
    method: "GET" | "POST",
    path: string,
    options?: { body?: unknown; bearer?: boolean; as?: keyof typeof LAB_USERS },
  ): Promise<{ status: number; body: any }>;
  dispose(): Promise<void>;
}

/**
 * Read the tree, build the installation and the worker flows, and register them.
 *
 * @param options The stores, the harness slot, the workspace and the address.
 * @returns The live lab. Call `dispose()` when done.
 * @throws If the tree does not load, or if any worker would be refused on its
 *   first turn — which is BR-2, and deliberately fatal: nothing is registered.
 */
export async function openLab(options: OpenLabOptions): Promise<Lab> {
  const roster = await loadTree(options.root ?? LAB_TREE);

  // A feature task works in its project: the workstream's it was filed from,
  // or the one it names.
  const lab = "remotes" in options.workspace ? options.workspace : undefined;
  const remotes = lab?.remotes.allow ?? [];
  const saveNothing = options.saveNothing === true;
  const workspaceHost: WorkspaceHost | undefined =
    lab === undefined ? undefined : workspaceHostOf(lab.root, remotes, lab.checkouts, saveNothing);
  // An answer task works in its project too, in places of its own. A lab on
  // one fixed repository reaches no remote here: only a project with no
  // repository can answer there.
  const answerHost = workspaceHostOf(join(options.workspace.root, "answers"), remotes, lab?.checkouts, saveNothing);
  if (saveNothing && workspaceHost === undefined) {
    throw new Error("openLab: `saveNothing` needs a `{ root, remotes }` workspace; a fixed repository keeps no files");
  }

  // The documents, as the L1 resource map a flow installs. Org-scoped, which is
  // what makes the workers' document reads — and BR-17 — matter.
  const resources = resourcesFromDocs(roster.documents);

  // The project writes, built once: the flow that creates projects at open runs
  // them as actions, and the chief of staff calls the same ones as tools. The
  // workstream writes are built with the installation, below.
  const projectBlocks = defineProjectBlocks();

  // The controls mutate the RECORD, before the mint, so a perturbed worker
  // genuinely runs on what the control gave it rather than being graded as if
  // it did.
  const overrides = options.documentOverrides ?? {};
  const workers = roster.workers.map((worker) => {
    const declared = { ...worker.declared };
    if (Object.hasOwn(overrides, worker.id)) declared.document = overrides[worker.id];
    if (options.withoutProjectTools === true && Array.isArray(declared.tools)) {
      declared.tools = (declared.tools as string[]).filter((name) => !PROJECT_TOOL_NAMES.includes(name));
    }
    if (options.withoutProjectList === true && Array.isArray(declared.tools)) {
      declared.tools = (declared.tools as string[]).filter((name) => name !== "listProjects");
    }
    const redirected = { ...worker, declared };
    return options.mutateSkills === undefined
      ? redirected
      : {
          ...redirected,
          skills: options.mutateSkills(redirected.id, (redirected.skills ?? []) as WorkerSkill[]),
        };
  });

  // The worker model: the tree's workers are its standard workers, and each
  // runs on one copy of the flow it names. The flows are read when first
  // needed, so the worker flows below can be built on the installation.
  let builtFlows: NonNullable<HireOptions["workerFlows"]> = {};
  const installation = createWorkerInstallation({
    standardWorkers: workers,
    workerFlows: () => builtFlows,
    documents: resources as never,
    // Each user's coordinator for a project, when the tree declares it.
    ...(workers.some((worker) => worker.id === PROJECT_COORDINATOR) ? { projectCoordinator: PROJECT_COORDINATOR } : {}),
  });
  // The workstream writes. A workstream's lead runs on the built-in `agent`
  // flow or the EM's `em` flow, each of which declares the entry that starts
  // its workstream session. A worker's open is checked against the lead's
  // description first: told in prose, the small model still opened research
  // under the EM, the one lead it had.
  const workstreamBlocks = defineWorkstreamBlocks({
    installation,
    leadFlows: LEAD_FLOWS,
    leadFit: { model: "openai/gpt-5.4-mini" },
  });
  const { listProjects, ...projectWrites } = chiefOfStaffProjectTools(projectBlocks, workstreamBlocks);
  const projectTools = options.withoutProjectList === true ? projectWrites : { listProjects, ...projectWrites };
  const flowOf = (workerId: string): string =>
    (installation.standardWorker(workerId)?.declared.flow as string | undefined) ?? AGENT_FLOW;
  // A worker on either flow reads its brief by the document it names; one that
  // names none would pass every isolation check trivially, so it never boots.
  for (const worker of workers) {
    const flow = worker.declared.flow;
    if ((flow === EM_FLOW || flow === CODER_FLOW) && typeof worker.declared[DOCUMENT_KEY] !== "string") {
      throw new Error(`worker "${worker.id}" runs on "${flow}" and names no \`${DOCUMENT_KEY}:\`; every worker on this flow reads one`);
    }
  }

  // The EM: its doors file for the worker the caller names, and its turn holds
  // the lead's tool, which updates the workstream its session leads. A worker
  // that isn't one of its delegates is refused at the hand-over.
  const emFlow = defineEmWorkerFlow({
    installation,
    coderWorker: options.coderWorkerId,
    resources,
    catalog: { updateWorkstream: workstreamBlocks.updateWorkstreamTool },
    ...(options.fileBeforeAsking === true ? { fileBeforeAsking: true } : {}),
  });
  // The EM worker the lab's doors and its ask run as, read off the tree. Two
  // would be a guess, so the lab refuses.
  const emRecords = roster.workers.filter((worker) => worker.declared.flow === EM_FLOW);
  if (emRecords.length > 1) {
    throw new Error(`the tree declares ${emRecords.length} EM workers; this lab runs one`);
  }
  // With no EM worker the coder worker flow has no door, and a worker flow with none is
  // refused when it is registered. An open asked to raise the ask names that
  // step instead, since it is the one that has nothing to ask from.
  if (emRecords.length === 0 && options.ask !== undefined) {
    throw new Error(`${RAISE_ASK_STEP}: wanted one "${EM_FLOW}" worker to ask from, found 0`);
  }
  const coderWorkerOf = workerOf(installation, CODER_FLOW);
  const coderFlow = defineCoderWorkerFlow({
    installation,
    answerWorkspace: answerHost,
    answerPhase: defineAnswerPhase({ workerOf: coderWorkerOf }),
    ...(options.withoutJudge === true ? {} : { judge: defineCoderJudge() }),
    // What a files run starts on, kept so its done-condition asks for a change.
    harness: (feeds) =>
      options.harness({
        ...feeds,
        cwd: async (ctx) => {
          const cwd = await feeds.cwd(ctx);
          noteStartingFiles(cwd);
          return cwd;
        },
      }),
    workspace: workspaceHost ?? (options.workspace as WorkspaceConfig),
    phase: defineImplementPhase({
      workerOf: coderWorkerOf,
      requireAcceptance: options.requireAcceptance === true,
      ...(options.dropTask === true ? { dropTask: true } : {}),
    }),
    runTimeoutMs: options.runTimeoutMs ?? 60_000,
    resources,
  });

  // The built-in `agent` worker flow, which the chief of staff (`org/workers/
  // chief-of-staff/`) runs on. Every worker on it gets the discovery door; a
  // worker holds hire, fire and the project writes only by naming them in
  // its `tools:`: in this tree the chief of staff names them, and the project
  // coordinator names the writes to its own project. Hire and fire
  // write the roster of the user talking to it: a worker of their own, which
  // runs on that user's turns only. A fire, and a project's repository, wait
  // for a user's Approve in Inbox, which needs durable execution (on
  // whenever a worker holds a tool that asks first).
  const rosterTools = chiefOfStaffRosterTools(installation);
  const asksFirst = new Set(["fire", ...(options.withoutProjectTools === true ? [] : ["createProject", "setRepository"])]);
  const asksBeforeChanging = workers.some((worker) =>
    ((worker.declared.tools as string[] | undefined) ?? []).some((tool) => asksFirst.has(tool)),
  );
  // What the agent's turn is built with. The `agent` flow runs it behind its
  // door, and the `coordinator` flow, which the chief of staff runs on, runs
  // the same turn for its judgment, with memory added (below).
  const agentTurn = {
    // The project tools and the roster writes a worker names in `tools:`.
    // The worker flow carries them, and only the chief of staff's line names
    // the roster writes; a project coordinator's line names `readProject`,
    // `setBrief`, `setRepository`, `listLeads`, `openWorkstream` and
    // `editWorkstream`, and a workstream's lead's `updateWorkstream`.
    catalog: {
      ...(options.withoutProjectTools === true ? {} : projectTools),
      ...rosterTools,
      ...projectCoordinatorTools,
      listLeads: workstreamBlocks.listLeadsTool,
      updateWorkstream: workstreamBlocks.updateWorkstreamTool,
      editWorkstream: workstreamBlocks.editWorkstreamTool,
    },
    uses: [
      // The worker inventory, which the discovery door reads.
      defineCapability({
        name: "lab-inventory",
        resources: { workerInventory: defineWorkerInventoryCollection() },
      }),
      createWorkforceCapability({
        roster: { workers: roster.workers },
        inventory: { workers: "workerInventory" },
      }),
    ],
  };
  const agentFlow = defineAgentWorkerFlow({ installation, ...agentTurn });
  builtFlows = {
    [EM_FLOW]: emFlow as never,
    [CODER_FLOW]: coderFlow as never,
    [AGENT_FLOW]: agentFlow as never,
    // The chief of staff's flow. A delivery reaches a delegate on a flow that
    // takes a delegated post: here, `agent` and the EM's `em`, so the chief of
    // staff can hand feature work to its EM delegate. `coder` takes tasks, not
    // posts. Best fit's evaluator runs on Jev, through the AI Gateway: it
    // reports the confidence the chief of staff's `minConfidence:` reads.
    [COORDINATOR_FLOW]: defineCoordinatorFlow({
      installation,
      delegateFlows: [agentFlow, emFlow as never],
      routeModel: "typesafe-ai/jev",
      agent: coordinatorMemory(agentTurn, {
        model: "openai/gpt-5.4-mini",
        capture: options.memoryCapture === true,
      }),
    }) as never,
  };

  // One copy per worker flow, and the roster flow. Refuses the WHOLE tree when
  // a worker would be refused on its first turn, or a worker flow doesn't
  // declare the installation's session, naming each (BR-2).
  const copies = hireWorkforce(installation);
  const copyOf = (flow: string): FlowInstance => copies.find((copy) => copy.id === flow)!;
  const copiesByWorker: Record<string, FlowInstance> = Object.fromEntries(
    installation.standardWorkers().map((worker) => [worker.id, copyOf(flowOf(worker.id))]),
  );

  // The flow the inventory's worker rows are written from. The write takes
  // caller-supplied rows, so it is internal only.
  const inventoryWriter =
    options.inventory === true
      ? defineFlow({ kind: INVENTORY_WRITER_FLOW, internal: { actions: { ...inventoryWriterActions() } } } as never)()
      : undefined;

  if (options.workstreams !== undefined && options.projects === undefined) {
    throw new Error("openLab: `workstreams` needs `projects`: a workstream opens in a project");
  }
  // The flow projects and workstreams are written through: the project and
  // workstream writes, as an app installs them. A project is created through
  // it at open, and Shift Manager reads the project setup from it. The chief
  // of staff and the project coordinator open workstreams with the same
  // writes as tools.
  const projectsFlow = defineFlow({
    kind: PROJECTS_FLOW,
    actions: {
      ...projectBlocks.actions,
      ...workstreamBlocks.actions,
      [PROJECT_SETUP_ACTION]: {
        block: projectSetup(installation),
        description:
          "Name this Lab's project setup: the worker each user's project coordinator runs as.",
      },
    },
  } as never)();

  const latencyEnv = process.env.DEVFORCE_LAB_WRITE_LATENCY_MS;
  const writeLatency = latencyEnv === undefined || latencyEnv === "" ? undefined : Number(latencyEnv);
  if (writeLatency !== undefined && !(writeLatency > 0)) {
    throw new Error(`DEVFORCE_LAB_WRITE_LATENCY_MS must be a positive number of milliseconds, not "${latencyEnv}"`);
  }
  if (writeLatency !== undefined) console.error(`[devforce-lab] holding checked store writes up to ${writeLatency}ms`);

  // One record for the Lab's own flows and the worker flows' copies. A copy's
  // id is its flow's name, so a worker flow named like one of the Lab's flows
  // (`projects`, `inventory-writer`) would take that flow's key;
  // `mergeWorkerFlows` refuses it, by name.
  const flows: Record<string, unknown> = mergeWorkerFlows(
    {
      ...(inventoryWriter === undefined ? {} : { [INVENTORY_WRITER_FLOW]: inventoryWriter }),
      [PROJECTS_FLOW]: projectsFlow,
    },
    copies,
  );

  const state = createFlowState({
    flows,
    // A goal that grades a burst sets DEVFORCE_LAB_WRITE_LATENCY_MS, so the
    // burst's writes really race (`write-latency.mts`). Unset, the store is as given.
    stores: { default: { primary: writeLatency === undefined ? options.stores : withWriteLatency(options.stores, writeLatency) } },
    // A configured resolver, so the development-organization fallback does
    // not answer an unauthenticated HTTP read (FIX-1515 / BR-17).
    resolvePrincipal: resolveLabPrincipal,
    ...(options.modelResolver === undefined ? {} : { modelResolver: options.modelResolver }),
    ...(options.logger === undefined ? {} : { runtimeConfig: { logger: options.logger } }),
    // When something can wait for a user: the EM's ask, or a worker holding
    // a tool that asks first. Trees with neither run without it.
    ...(options.ask === undefined && !asksBeforeChanging ? {} : { durable: true }),
    ...(options.devtool === true ? { devtool: { userId: LAB_USER_ID, bearerToken: LAB_PRINCIPAL_SECRET } } : {}),
  } as never);

  const runtime = await state.getRuntime();

  // `createFlowState` builds its own `RuntimeConfig` and takes no logger
  // option, and a hand-off's child request is started from that resolved object
  // rather than from anything a caller passes per action. Setting it here is
  // the one place that reaches both.
  if (options.logger !== undefined) {
    (runtime.runtimeConfig as { logger?: unknown }).logger = options.logger;
  }
  // After the logger is set, so the router the door probes run through is
  // built with it too.
  const router = await state.getRouter();

  /** The session a worker's actions run in — one per worker, stable across a run. */
  const sessionFor = workerSessionId;

  // The inventory, in-process, under the lab's organization. A problem fails
  // the open, naming it.
  if (options.inventory === true) {
    const run = async (request: InventoryActionRequest): Promise<unknown> => {
      const result = (await runAction({
        flow: flows[request.flowKind],
        actionName: request.action,
        input: request.input,
        userId: request.userId,
        orgId: request.orgId,
        sessionId: request.sessionId,
        source: request.source,
        stores: runtime.stores,
        runtimeConfig: runtime.runtimeConfig,
      } as never)) as { error?: unknown };
      if (result?.error !== undefined) throw new Error(messageOf(result.error));
      return result;
    };
    // The standard workers, the ones every user has. A user's own workers
    // are theirs, on their roster, and not listed here.
    const opened = await openInventory(
      { workers: inventoryWorkers(installation) },
      { run, workerWriter: { flowKind: INVENTORY_WRITER_FLOW }, userId: LAB_USER_ID, orgId: LAB_ORG_ID },
    );
    if (opened.problems.length > 0) {
      await state.dispose();
      throw new Error(`openLab: the inventory did not open: ${opened.problems.join("; ")}`);
    }
  }

  // The projects: one `createProject` turn each, as the owner, in the lab's
  // own projects session. A row the owner already holds comes back unchanged.
  let projects: CreateProjectOutput[] | undefined;
  if (options.projects !== undefined) {
    projects = [];
    for (const input of options.projects) {
      const result = (await runAction({
        flow: projectsFlow,
        actionName: "createProject",
        input,
        userId: LAB_USER_ID,
        orgId: LAB_ORG_ID,
        sessionId: PROJECTS_SESSION,
        stores: runtime.stores,
        runtimeConfig: runtime.runtimeConfig,
      } as never)) as { output?: unknown; error?: unknown };
      if (result.error !== undefined) {
        await state.dispose();
        throw new Error(`openLab: project "${input.id}" was not created: ${messageOf(result.error)}`);
      }
      projects.push(result.output as CreateProjectOutput);
    }
  }

  /** The session a user's own project and workstream writes run in. */
  const projectsSessionOf = (as: keyof typeof LAB_USERS): string =>
    as === "owner" ? PROJECTS_SESSION : `${PROJECTS_SESSION}-${as}`;

  // The workstreams, once their projects exist: one `openWorkstream` each, as
  // the user it names, in their projects session. One already open comes
  // back unchanged.
  let workstreams: OpenWorkstreamOutput[] | undefined;
  if (options.workstreams !== undefined) {
    workstreams = [];
    for (const { as, input } of options.workstreams) {
      const result = (await runAction({
        flow: projectsFlow,
        actionName: "openWorkstream",
        input,
        userId: LAB_USERS[as].userId,
        orgId: LAB_ORG_ID,
        sessionId: projectsSessionOf(as),
        stores: runtime.stores,
        runtimeConfig: runtime.runtimeConfig,
      } as never)) as { output?: unknown; error?: unknown };
      if (result.error !== undefined) {
        await state.dispose();
        throw new Error(`openLab: workstream "${input.id}" was not opened: ${messageOf(result.error)}`);
      }
      workstreams.push(result.output as OpenWorkstreamOutput);
    }
  }

  /**
   * The rows on the board of the EM worker's own session: the lab user's,
   * under the session's partition (its id, then `~`).
   */
  const emRows = async (): Promise<Record<string, Task>> => {
    if (emRecords.length !== 1) return {};
    const found = await runtime.stores.resourceState.getByPrefix(
      "user",
      LAB_USER_CELL,
      `${SESSION_BOARD_COLLECTION}/${encodeUserSegment(`${sessionFor(emRecords[0]!.id)}~`)}`,
    );
    return Object.fromEntries(
      Object.entries(found).map(([key, record]) => [key, (record as { state: unknown }).state as Task]),
    );
  };

  /**
   * Run one action and hand back what it returned.
   *
   * `runAction` rather than the HTTP route, for one reason: the route is
   * fire-and-forget (202 plus a request id) and the request record carries no
   * output, so reading an action's result off it is not a thing that works.
   * This is the same entry the route dispatches into.
   */
  const actOn = async (
    flow: unknown,
    sessionId: string,
    actionName: string,
    input: unknown,
    userId: string = LAB_USER_ID,
  ): Promise<{ output?: unknown; error?: string }> => {
    try {
      const result = (await runAction({
        flow,
        actionName,
        input,
        userId,
        orgId: LAB_ORG_ID,
        sessionId,
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig },
      } as never)) as { output?: unknown; error?: unknown };
      return result.error === undefined
        ? { output: result.output }
        : { error: messageOf(result.error) };
    } catch (error) {
      // A refusal the substrate throws rather than returns. Returned like any
      // other refusal, so a leg that expects one grades its wording instead of
      // taking the run down.
      return { error: messageOf(error) };
    }
  };

  // The ask, last, once everything it runs over is registered. One EM worker is
  // what this tree declares; a tree with none, or two, has no single worker the
  // ask belongs to, and that is a refusal rather than a guess.
  let ask: RaiseAskResult | undefined;
  if (options.ask !== undefined) {
    try {
      if (emRecords.length !== 1) {
        throw new Error(
          `${RAISE_ASK_STEP}: wanted one "${EM_FLOW}" worker to ask from, found ${emRecords.length}`,
        );
      }
      ask = await raiseAsk({
        state,
        emFlow: copyOf(EM_FLOW),
        emWorker: emRecords[0]!.id,
        feature: options.ask,
        principal: { userId: LAB_USER_ID, orgId: LAB_ORG_ID },
        filed: async (issue) => featureRowOf(await emRows(), issue),
      });
    } catch (error) {
      await state.dispose();
      throw error;
    }
  }

  const door = async (
    method: "GET" | "POST",
    path: string,
    doorOptions?: { body?: unknown; bearer?: boolean; as?: keyof typeof LAB_USERS },
  ): Promise<{ status: number; body: any }> => {
    const url = new URL(`http://lab/api/flows/${path}`);
    const segments = url.pathname.slice("/api/flows/".length).split("/");
    const request = new Request(url, {
      method,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(doorOptions?.bearer === false
          ? {}
          : { authorization: `Bearer ${LAB_USERS[doorOptions?.as ?? "owner"].bearer}` }),
      },
      ...(doorOptions?.body === undefined ? {} : { body: JSON.stringify(doorOptions.body) }),
    });
    const response = await (router as any)[method](request, { params: { path: segments } });
    const text: string = await response.text();
    let body: unknown = text;
    try {
      body = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      // Not JSON; hand back the text.
    }
    return { status: response.status, body };
  };

  const act = async (
    workerId: string,
    actionName: string,
    input: unknown,
  ): Promise<{ output?: unknown; error?: string }> => {
    const flow = copiesByWorker[workerId];
    if (flow === undefined) throw new Error(`no worker "${workerId}" is declared`);
    try {
      await openWorkerSession(runtime.stores, { flow, workerId: workerId, principal: { userId: LAB_USER_ID, orgId: LAB_ORG_ID } });
    } catch (error) {
      return { error: messageOf(error) };
    }
    return await actOn(flow, sessionFor(workerId), actionName, input);
  };

  /** Wait until no row on the EM's own board is pending or in progress, or `timeoutMs` passes. */
  const settled = async (timeoutMs: number): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    const busy = (rows: Record<string, Task>) =>
      Object.values(rows).some((row) => row.status === "pending" || row.status === "in_progress");
    while (busy(await emRows()) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  return {
    roster: { ...roster, workers },
    workers: copiesByWorker,
    installation,

    file: (workerId, input) => act(workerId, FILE_ENTRY, input),
    drain: async (workerId) => {
      const result = await act(workerId, DRAIN_ENTRY, {});
      if (result.error === undefined) await settled(2 * (options.runTimeoutMs ?? 60_000));
      return result;
    },

    featureRow: async (issue: string) => featureRowOf(await emRows(), issue),

    stored: async (scope: "org" | "user", prefix = "") => {
      const found = await runtime.stores.resourceState.getByPrefix(
        scope,
        scope === "org" ? LAB_ORG_ID : LAB_USER_CELL,
        prefix,
      );
      return Object.fromEntries(
        Object.entries(found).map(([key, record]) => [key, (record as { state: unknown }).state]),
      );
    },

    rows: emRows,

    dispatched: async (workerId: string) => {
      const children = await runtime.stores.session.list({
        userId: LAB_USER_ID,
        parentage: { parentOf: sessionFor(workerId) },
      });
      // **The worker, not the flow.** Two workers on this tree run on the SAME
      // worker flow — the coder and the reviewer — so a dispatch record read by flow
      // alone cannot tell them apart, and BR-8's whole claim is which of the
      // two the row reached. The child session names it.
      return (children as Array<{ id: string; flowKind: string; flowId?: string; state?: Record<string, unknown> }>).map(
        (child) => {
          const workerId = child.state?.[WORKER_ID_STATE_KEY];
          return {
            sessionId: child.id,
            flowKind: child.flowKind,
            flowId: child.flowId,
            workerId: typeof workerId === "string" ? workerId : undefined,
          };
        },
      );
    },

    inspect: async (workerId: string, inspectOptions?: { door?: "org-less" | "bearer" }) => {
      if (workerId in copiesByWorker === false) throw new Error(`no worker "${workerId}" is declared`);

      // BR-17 is about the DOOR, and the door is the transport host: a bare
      // `runAction` never reaches `resolvePrincipal`, so an org-less one runs
      // happily — and, because a file-declared document's body is static
      // content rather than stored state, it even reads the document. The
      // refusal this rule names therefore has to be asked for where it lives.
      // The host is wired with `resolveLabPrincipal`, so an org-less request
      // has nothing to fall back to: no bearer, no verified org, 401. Its
      // positive half goes through the SAME door carrying the lab's bearer, so
      // a door that refused everything cannot pass as one that refused only
      // the unverified.
      if (inspectOptions?.door !== undefined) {
        const bearer = inspectOptions.door === "bearer";
        // A session id nothing has used, one per probe, and that is
        // load-bearing: `validateDispatch` satisfies the org requirement from
        // an EXISTING session's stored org binding. Reusing the ordinary
        // session would hand the org-less probe the very org it is withholding
        // (the refusal would never fire), and would let the bearer probe land
        // on a stored org rather than the verified one — a green that means
        // nothing either way. The bearer probe opens it through the same door
        // first, naming the worker, so its org is the verified one.
        const probeSession = `${inspectOptions.door}-${workerId}`;
        if (bearer) {
          const created = await door("POST", `${flowOf(workerId)}/sessions`, {
            body: { userId: LAB_USER_ID, sessionId: probeSession, state: { [WORKER_ID_STATE_KEY]: workerId } },
          });
          if (created.status !== 201 && created.status !== 409) {
            return { error: `${created.status}: ${JSON.stringify(created.body)}` };
          }
        }
        const segments = [flowOf(workerId), probeSession, "actions", INSPECT_ENTRY];
        const request = new Request(`http://lab/api/flows/${segments.join("/")}`, {
          method: "POST",
          // The inline stream, because the plain POST acks 202 with no output
          // and the positive half is graded on the worker's facts.
          headers: {
            accept: "text/event-stream",
            ...(bearer ? { authorization: `Bearer ${LAB_PRINCIPAL_SECRET}` } : {}),
          },
          body: JSON.stringify({ userId: LAB_USER_ID, input: {} }),
        });
        const response = await (router as any).POST(request, { params: { path: segments } });
        const text: string = await response.text();
        if (response.status >= 400) {
          const json = text.length > 0 ? JSON.parse(text) : undefined;
          return { error: `${response.status}: ${JSON.stringify(json)}` };
        }
        const events = text
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map(
            (line) =>
              JSON.parse(line.slice(6)) as {
                type: string;
                item?: { type?: string; component?: string; data?: Record<string, unknown> };
              },
          );
        // The facts come off the client-visible component the entry emits, by
        // name, not off any trace item: trace items are not for clients, and
        // are not captured at all when trace observability is off.
        const facts = events
          .filter(
            (event) =>
              event.item?.type === "component" && event.item.component === WORKER_FACTS_COMPONENT,
          )
          .at(-1)?.item?.data;
        const completed = events.some((event) => event.type === "request.completed");
        if (completed && facts !== undefined) return { facts };
        const seen = events.map((event) => event.type).join(", ");
        return {
          error: completed
            ? `request.completed fired with no ${WORKER_FACTS_COMPONENT} component (events: ${seen})`
            : `request.completed never fired (events: ${seen})`,
        };
      }

      const result = await act(workerId, INSPECT_ENTRY, {});
      return result.error === undefined
        ? { facts: (result.output ?? {}) as Record<string, unknown> }
        : { error: result.error };
    },

    ...(ask === undefined ? {} : { ask }),
    ...(projects === undefined
      ? {}
      : {
          projects,
          projectAct: (actionName: string, input: unknown, as: keyof typeof LAB_USERS = "owner") =>
            actOn(projectsFlow, projectsSessionOf(as), actionName, input, LAB_USERS[as].userId),
        }),
    ...(workstreams === undefined ? {} : { workstreams }),
    ...(workspaceHost === undefined ? {} : { workspaceHost }),
    state,
    door,

    dispose: () => state.dispose(),
  };
}

/**
 * A workspace host of the lab's: `localWorkspaceHost` over `root`, reaching
 * only the `remotes` listed, with `projectWorkspace()` as its source, given
 * the lab's `checkouts` ({@link checkoutSource}). The lab builds two: a
 * board's rows' and, beside it, a conversation's answer tasks'. `saveNothing`
 * is the `no-sync-back` control's seam: the host is the same, and its `save`
 * reports nothing saved.
 */
function workspaceHostOf(
  root: string,
  remotes: readonly string[],
  checkouts: LabWorkspaceHost["checkouts"],
  saveNothing: boolean,
): WorkspaceHost {
  const host = localWorkspaceHost({ root, remotes: { allow: [...remotes] }, ...checkoutSource(checkouts) });
  if (!saveNothing) return host;
  return { ...host, save: async () => ({ outcomes: [], conflicts: [], contested: [] }) };
}

/**
 * A host's `source` and `localRepositories` from one `checkouts` value, so
 * the two never disagree: every checkout a project is mapped to is one the
 * host may work in, and no other is.
 */
function checkoutSource(checkouts: LabWorkspaceHost["checkouts"]) {
  if (checkouts === undefined || checkouts.length === 0) return { source: projectWorkspace() };
  return {
    source: projectWorkspace({ checkouts }),
    localRepositories: [...new Set(checkouts.map((entry) => entry.checkout))],
  };
}

/** The row filed for `issue` among `rows`, by the issue its payload names. */
function featureRowOf(rows: Record<string, Task>, issue: string): Task | undefined {
  return Object.values(rows).find((row) => featureIssueOf(row) === issue);
}

/** One wording for whatever a refusal turns out to be. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
