/**
 * The lab itself — one module both checks import, so the model-free contract
 * gate and the model-backed honesty check drive the *same* tree, the same hire
 * and the same wiring, and differ by one block.
 *
 * What `openLab` does, in order, and nothing else: read the tree, resolve the
 * feature mailbox's board, build the installation and the two kinds on it,
 * register one copy of each worker flow, open the declared mailboxes when asked (and their organization's inventory, when that
 * is asked too), hand back the handles. Every convention file it
 * reads is found by walking from one root; no file is named in this code.
 *
 * **The board belongs to the mailbox.** The feature mailbox's `MAILBOX.md`
 * names it (`boards: [work]`), the framework mints its id from where the
 * mailbox sits, and this host resolves it with `mailboxBoard(mailbox.id,
 * boardName)` — both read off the tree, the way
 * `packages/shift-manager/test/fixtures/multi-seat-collab/host.mts` does. Both kinds are handed that one
 * ledger, so a row the EM files and the coder's run settles is the row the
 * mailbox serves. It is kept per organization, so it exists whether or not the
 * mailbox is opened.
 *
 * Five pieces here are the lab's rather than the framework's, each because the
 * framework has no opinion at that spot:
 *
 * 1. **The board and the coder's door** (`board.mts`): the EM's board hands a
 *    row across flows, and the coder takes it through a door on the same
 *    ledger, with no board of its own. The ledger is the mailbox's.
 * 2. **The assignee → worker address.** The board routes its own `coder`
 *    assignee to the worker the caller supplies, which is what lets a
 *    control point it at the wrong worker and watch the negative claim go
 *    red. Any other assignee goes to the Workforce worker lookup.
 * 3. **The harness slot**, handed to the `coder` kind. The one expression that
 *    differs between this lab's two checks.
 * 4. **The mailbox's address map** (`notify.mts`), and whether a mailbox is
 *    opened at all. The framework keeps the member walk and runs a notify block
 *    once per declared member; which member resolves to which worker is the app's,
 *    because the dispatch seam refuses a target read out of stored data.
 * 5. **The host `resolvePrincipal`.** FSD does not provide login. After
 *    FIX-1442 an unconfigured host runs under the development organization,
 *    which is not a refusal. The lab wires a fail-closed bearer check so an
 *    unauthenticated HTTP read is turned away for real (FIX-1515 / BR-17).
 *
 * **Not `workforce.gen.ts`.** `fsdev gen` renders that file for an app
 * directory, and `goals/` is not one. The kinds are hand-assembled here, which
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
import type { BlockContext, FlowInstance, ModelResolver } from "@flow-state-dev/core/types";
import type { WorkspaceConfig } from "@flow-state-dev/harness-manager";
import { localWorkspaceHost, redactRemote, type WorkspaceHost } from "@flow-state-dev/workspace";
import { z } from "zod";
import {
  AGENT_KIND,
  COORDINATOR_KIND,
  defineCoordinatorFlow,
  MAILBOX_KIND,
  mailboxBoard,
  mailboxBoardIds,
  mailboxInstances,
  createWorkerHireBlocks,
  createWorkerInstallation,
  createWorkforceCapability,
  createWorkerLookup,
  defineAgentWorkerFlow,
  defineMailboxFlow,
  defineSeatInventoryCollection,
  hireWorkforce,
  inventorySeats,
  createProjectInputSchema,
  createProjectOutputSchema,
  defineProjectBlocks,
  projectWorkspace,
  projectWritesMailboxInventory,
  mergeSeatFlows,
  openMailboxes,
  openInventory,
  resourcesFromDocs,
  splitResourceModules,
  workerMailboxPostCapability,
  type MailboxTranscriptLine,
  type CreateProjectInput,
  type CreateProjectOutput,
  type HireOptions,
  type WorkerInstallation,
  setRepositoryInputSchema,
  setRepositoryOutputSchema,
  type InventoryActionRequest,
  type ProjectBlocks,
} from "@flow-state-dev/workforce";
import { discoverWorkforceCode } from "@flow-state-dev/workforce/codegen";
import {
  readDeclaredRoster,
  type DeclaredRoster,
} from "@flow-state-dev/workforce/loader";
import { defineFlow } from "@flow-state-dev/core";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WORKER_ID_STATE_KEY } from "@flow-state-dev/workforce/browser";
import { ASSIGNEE, type FeatureLedger } from "./board.mts";
import { DOCUMENT_KEY, INSPECT_ENTRY, SEAT_FACTS_COMPONENT, seatOf } from "./seat-config.mts";
import { defineImplementPhase, noteStartingFiles } from "./phase.mts";
import { CODER_KIND, defineCoderWorkerFlow } from "./workforce/flows/workers/coder.mts";
import {
  DRAIN_ENTRY,
  EM_KIND,
  FILE_ENTRY,
  defineEmWorkerFlow,
} from "./workforce/flows/workers/em.mts";
import type { HarnessStub } from "./harness-stub.mts";
import { labNotify, type NotifyLog } from "./notify.mts";
import { withWriteLatency } from "./write-latency.mts";
import {
  openSeatSession,
  RAISE_ASK_STEP,
  raiseAsk,
  seatSessionId,
  type AskFeature,
  type RaiseAskResult,
} from "./ask.mts";

/** The authored tree — the one path this code names. Everything else is walked. */
export const LAB_TREE = fileURLToPath(new URL("./workforce", import.meta.url));

/** The flow kind the lab creates projects through at open. */
export const PROJECTS_KIND = "projects";

/** The session the lab's own project writes run in, as the owner. Each creator's talk session is its child. */
export const PROJECTS_SESSION = "devforce-projects";

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
 * the page is handed), a second member of the default projects, and an
 * outsider who is in the organization and on no project. The two others exist
 * so a check can read a project's room as a member who did not create it, and
 * be refused it as someone who is not a member.
 */
export const LAB_USERS = {
  owner: { userId: LAB_USER_ID, bearer: LAB_PRINCIPAL_SECRET },
  member: { userId: "u_devforce_member", bearer: "devforce-lab-verified-member" },
  outsider: { userId: "u_devforce_outsider", bearer: "devforce-lab-verified-outsider" },
} as const;

/**
 * More members of the default projects, each with a secret of their own. With
 * the member above they are eight people whose first joins of one project can
 * race: the engine's own retries absorb a race between two or three people
 * appending to a row's `sessions`, so a check that the room's own retry is
 * load-bearing needs more of them.
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
 * One secret per person. Each resolver refuses a bearer that is not its own,
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
 * and wrong here: a seat that failed to load is a seat this lab does not have,
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
        : `${p.layer} ${p.path} (seat ${p.worker}): ${p.error.message}`,
    );
    throw new Error(`the tree at ${root} did not load cleanly:\n  - ${lines.join("\n  - ")}`);
  }
  return roster;
}

/**
 * The one mailbox in the tree that holds a board: the one the EM files onto
 * and the coder's runs settle. Refuses a tree where none does, or several do.
 *
 * @throws Naming how many mailboxes hold a board.
 */
export function boardMailboxOf(roster: Pick<DeclaredRoster, "mailboxes">): DeclaredRoster["mailboxes"][number] {
  const holding = roster.mailboxes.filter(
    (mailbox) => ((mailbox.declared.boards as string[] | undefined) ?? []).length > 0,
  );
  if (holding.length !== 1) {
    throw new Error(
      `the tree has ${holding.length} mailbox(es) holding a board` +
        `${holding.length === 0 ? "" : ` (${holding.map((c) => c.id).join(", ")})`}; this lab runs one`,
    );
  }
  return holding[0]!;
}

/**
 * The project writes as the chief of staff's tools, `createProject`,
 * `setWorkstreams` and `setRepository`: the same blocks the Lab's own open
 * creates projects through, under the names its `tools:` line spells. A
 * catalog key must be the tool's own name, so `setWorkstreams` is the block
 * under `.as()`; the two that wait for an approval first are sequencers.
 *
 * The owner is the session's user, so a project the chief of staff creates
 * belongs to the person talking to it, who is always a member; `members` adds
 * whoever they name.
 *
 * **A repository waits for the person.** Which remote a project's code is
 * cloned from is the person's to say, so `setRepository`, and `createProject`
 * with a `repository`, pause on a stock `human_approval` before the write.
 * Approve writes it; Deny throws out of the tool before the write runs, and
 * nothing changes. Without durable execution the tool refuses rather than
 * writing unasked.
 */
export function chiefOfStaffProjectTools(blocks: ProjectBlocks) {
  return {
    createProject: sequencer({
      name: "createProject",
      description:
        "Create a project for the person you are talking to. They own it and are always a member. " +
        "`id` is a short lowercase slug; `members` adds the user ids they name; `workstreams` takes " +
        "full mailbox ids (`team.mailbox`), each in at most one project; `repository` is the git " +
        "remote its code lives in, if they named one. With a repository, the person approves it first.",
      inputSchema: createProjectInputSchema,
      outputSchema: createProjectOutputSchema,
    })
      .tapIf((input) => input.repository != null, askRepository((input) => input.id))
      .step(blocks.createProject),
    setWorkstreams: blocks.setWorkstreams.as({
      name: "setWorkstreams",
      description:
        "Replace a project's workstreams with this list of full mailbox ids. Only the project's " +
        "members may; a workstream belongs to at most one project.",
    }),
    setRepository: sequencer({
      name: "setRepository",
      description:
        "Set, change or clear (null) the git remote a project's code lives in. Only the project's " +
        "members may, and the person approves it first.",
      inputSchema: setRepositoryInputSchema,
      outputSchema: setRepositoryOutputSchema,
    })
      .tap(askRepository((input) => input.project?.id))
      .step(blocks.setRepository),
  };
}

/**
 * Hire and fire as the chief of staff's tools, under the names its `tools:`
 * line spells: Workforce's hire blocks, each a write to the roster of the
 * person talking to it. A catalog key must be the tool's own name, so `hire`
 * is the block under `.as()`; `fire` is a sequencer, because it waits for an
 * approval first.
 *
 * **A fire waits for the person.** It pauses on a stock `human_approval`
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
        "Hire a worker of the person's own: `id` is a short lowercase slug, `flow` the flow it runs on " +
        "(`agent` when omitted), and `settings` the keys its file would declare. It lands at once.",
    }),
    fire: sequencer({
      name: "fire",
      description:
        "Fire one of the person's own workers, by its id, once the person approves it. A worker the files declare can't be fired.",
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
        `firing "${input.id}" waits for a person's approval here, and this app can't ask for one: it runs ` +
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
function askRepository(projectOf: (input: z.infer<typeof repositoryAskInputSchema>) => string | undefined) {
  return handler({
    name: "devforce-cos-ask-repository",
    inputSchema: repositoryAskInputSchema,
    outputSchema: z.void(),
    execute: async (input: z.infer<typeof repositoryAskInputSchema>, ctx: BlockContext) => {
      const project = projectOf(input) ?? "";
      if (ctx.suspend === undefined) {
        throw new Error(
          `the repository of project "${project}" waits for a person's approval here, and this app ` +
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

/**
 * The organization's TypeScript resource modules (`org/resources/*.ts`), found
 * by walking the tree and imported, as the resource map `fsdev gen` would
 * render for an app. This lab has no generated module (see the header), so the
 * walk and the import happen here. The projects collection and its talk
 * template are declared this way.
 */
async function loadResourceModules(root: string): Promise<Record<string, unknown>> {
  // Throws, naming every problem, when the walk finds a file it won't render.
  const found = await discoverWorkforceCode(root);
  const modules: Record<string, unknown> = {};
  for (const module of found.resourceModules) {
    const imported = (await import(pathToFileURL(join(root, module.path)).href)) as { default?: unknown };
    modules[module.ref] = imported.default;
  }
  return splitResourceModules(modules as never).resources;
}

export interface OpenLabOptions {
  /** The store adapter this lab runs over — `inMemoryStores()` is enough. */
  stores: unknown;
  /** The harness the `coder` kind runs. The one thing the two checks differ by. */
  harness: HarnessStub["slot"];
  /**
   * Where each coding run works.
   *
   * `{ root, sourceRepo, baseRef }`: every run is a new branch of one fixed
   * repository, as the older checks run. `{ root, remotes }`: a workspace host
   * whose source is `projectWorkspace` on the board the coder kind drains, so
   * a run works in a branch of its project's repository (reached only if
   * `remotes.allow` lists it), or on its project's files when the project has
   * none.
   */
  workspace: WorkspaceConfig | LabWorkspaceHost;
  /**
   * The worker the board's `coder` assignee is handed to.
   *
   * The address map is the app's, not the tree's. Supplied by the caller for
   * that reason — and because a control that points it at the wrong declared
   * worker is the only way "the row reached the seat it named" can be made to
   * go red.
   */
  coderSeatId: string;
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
   * Open the mailboxes the tree declares, and address the fan-out.
   *
   * **Absent means absent**, and that is the shape the two existing checks
   * keep: no mailbox instance is registered, `openMailboxes` is not called, and
   * the lab behaves exactly as it did before the mailbox door existed. An
   * entry that is only there to do nothing is worse than none — which is how
   * `defineMailboxFlow`'s own notify slot works, and the reason this is an
   * option rather than a widening of every check that imports `openLab`.
   *
   * `addresses` is member id → the worker it is delivered to. A declared
   * member absent from it is recorded in `log.skipped` and never dispatched to.
   */
  mailboxes?: {
    addresses: Record<string, string>;
    log: NotifyLog;
  };
  /**
   * Make the brief's acceptance check part of the done-condition (BR-4).
   *
   * Absent for the two older checks, whose scripted stub writes a file the
   * current brief does not name. See `phase.mts`.
   */
  requireAcceptance?: boolean;
  /**
   * Raise the EM seat's ask on open: one pending approval, in the EM seat's
   * own session, naming this feature (`ask.mts`).
   *
   * **Absent means absent**, as with `mailboxes`: no request and no store write
   * for it (durable execution stays on when a seat holds a tool that asks
   * first). Present turns durable execution on, because the answer arrives later
   * through the engine's resume route, and open fails, naming the step, if the
   * ask could not be raised.
   */
  ask?: AskFeature;
  /**
   * Open the organization's seat and mailbox inventory after the mailboxes, the
   * collections Shift Manager's TEAMS and PROJECTS read. Needs `mailboxes`: the
   * inventory's writer is the mailbox kind, built with `inventory: true`.
   *
   * **Absent means absent**: the mailbox kind is built without the writer and
   * nothing is registered, as the other checks have always run.
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
   * Projects to create at open, as the lab's owner, through the same
   * `createProject` action anything else creates a project with. A project
   * the store already holds for the owner is handed back unchanged, so a
   * second open on a surviving store creates and mints nothing new. Each
   * creator's talk session is bound in the same turn.
   *
   * Needs `mailboxes`: a project's room runs on the mailbox kind, and its
   * workstreams must be mailboxes the inventory registers, so `inventory` too.
   * **Absent means absent**: nothing is created, as the other checks run.
   */
  projects?: readonly CreateProjectInput[];

  // ---- controls, each the red state of one claim -------------------------

  /**
   * The asking door files its row before it suspends. The red state of
   * "nothing is filed until a person approves".
   */
  fileBeforeAsking?: boolean;

  /**
   * The workspace host saves nothing back: a run's project files are laid
   * down before it and dropped after. Only with a `{ root, remotes }`
   * workspace. The red state of "a run's files are kept by the project".
   */
  saveNothing?: boolean;

  /**
   * Repoint a seat at a different file-declared document, by seat id.
   *
   * Applied to the RECORD before the mint, so the seat genuinely runs on the
   * other ref rather than being graded as if it did. That is what makes it a
   * control: the prompt the manager builds then carries the wrong document's
   * token, which is the failure BR-10 exists to detect.
   */
  documentOverrides?: Record<string, string>;
  /**
   * Build the two kinds on this ledger instead of the mailbox's.
   *
   * The goal check's `kind-ledger` control: the kinds keep a ledger of their
   * own, as they did before the board moved onto the mailbox. The run still
   * completes; only where its row lives moves, which is the red state of "the
   * mailbox's board holds the row". The mailbox still declares its board, and
   * {@link Lab.board} still names it.
   */
  ledger?: FeatureLedger;
  /**
   * Rewrite one seat's resolved skill union before the mint.
   *
   * Applied to the record for the same reason, so the seat genuinely hires with
   * the mutated set and reads it back through its own config.
   */
  mutateSkills?: (seatId: string, skills: SeatSkill[]) => SeatSkill[];
  /**
   * Build the phase so its prompt builder ignores the task the manager hands
   * it. The red state of "a run is handed the work a person approved".
   */
  dropTask?: boolean;
  /**
   * Leave the project tools out: not in the catalog the agent turn is built
   * with (the `agent` kind's, and the chief of staff's on the coordinator
   * flow), and not in any seat's `tools:`, as before the chief of staff had
   * them. Applied to the record before the mint, so the seat boots and
   * genuinely cannot create a project. The red state of "the chief of staff
   * creates projects".
   */
  withoutProjectTools?: boolean;
}

/** A workspace host for the lab to build: where its places live, and which remotes it may reach. */
export interface LabWorkspaceHost {
  /** The host directory every clone and place lives under. */
  root: string;
  /** The remotes the host may reach; list `"file"` to allow `file://` remotes. */
  remotes: { allow: readonly string[] };
}

/** One skill on a worker record, as the loader shapes it. */
export interface SeatSkill {
  name: string;
  skillMd: string;
  files?: Array<{ path: string; content: string }>;
}

/** Everything a check needs to drive and observe one lab. */
export interface Lab {
  roster: DeclaredRoster;
  /**
   * The feature mailbox's board, as the tree declares it: its local `name`
   * (from `MAILBOX.md`) and the `id` the framework minted from where the
   * mailbox sits. Read off the tree, so no check spells either.
   */
  board: { name: string; id: string };
  /**
   * Each declared worker, by id, with the one registered copy of the flow it
   * runs on. Workers on one flow share its copy; the session names the worker.
   */
  seats: Record<string, FlowInstance>;
  /** The worker model the lab was built on. */
  installation: WorkerInstallation;
  /** File one row through the EM seat's own action. */
  file(
    seatId: string,
    input: { issue: string; goal: string; maxAttempts?: number },
  ): Promise<{ output?: unknown; error?: string }>;
  /** Run the board through the EM seat's own action, and wait for it to return. */
  drain(seatId: string): Promise<{ output?: unknown; error?: string }>;
  /** Read one row out of the ledger the kinds run on, where it is stored. */
  row(taskId: string): Promise<Task | undefined>;
  /**
   * Every stored resource key in one scope, with its state — the raw storage
   * a check reads to say where a row lives and that no copy of it exists
   * anywhere else. `org` reads the lab's organization, `user` the lab's user.
   */
  stored(scope: "org" | "user", prefix?: string): Promise<Record<string, unknown>>;
  /**
   * Every row on the feature board, by ledger key.
   *
   * **Presence is not exclusivity.** BR-7 says a post files *exactly one* row,
   * and a check that looks up the id it expects can only ever confirm the
   * first half — a regression that filed a second row under another id would
   * stay green. This enumerates, so the claim can be graded as written.
   */
  rows(): Promise<Record<string, Task>>;
  /**
   * The mailbox that holds the tree's board, once `mailboxes` was asked for.
   * The tree's other mailboxes are opened too, and hold no board.
   *
   * The id is minted from where `MAILBOX.md` sits, never named in this code.
   */
  mailboxId?: string;
  /**
   * Post one line on that mailbox, as an operator would.
   *
   * The whole of the mailbox leg's front door: nothing else in this lab files a
   * row when `mailboxes` is on. Absent when no mailbox was opened.
   */
  post?(body: string): Promise<{ output?: unknown; error?: string }>;
  /** Read the mailbox's transcript back. Absent when no mailbox was opened. */
  transcript?(): Promise<MailboxTranscriptLine[]>;
  /**
   * Run one of the mailbox's own actions (`read`, `readBoard`) — the reads
   * Shift Manager makes of a workstream. Absent when no mailbox was opened.
   */
  mailboxAct?(actionName: string, input: unknown): Promise<{ output?: unknown; error?: string }>;
  /**
   * Read the mailbox's board through the HTTP door a browser uses — the
   * collection read route, on the mailbox's session.
   *
   * `"bearer"` carries the lab's verified bearer; `"org-less"` carries no
   * credential and is refused before anything is read. Absent when no mailbox
   * was opened, since the door reads through the mailbox's session.
   */
  readBoardAtDoor?(
    door: "org-less" | "bearer",
  ): Promise<{ status: number; rows?: Array<Record<string, unknown>>; error?: string }>;
  /**
   * Every child session the EM seat's drain started, with the flow it ran on
   * and the worker it names — the **dispatch record**.
   *
   * This is what BR-6 and BR-8 are graded on. A seat's absence from a result
   * says nothing: a stray dispatch whose run produced nothing would be
   * indistinguishable from no dispatch at all.
   */
  dispatched(
    seatId: string,
  ): Promise<Array<{ sessionId: string; flowKind: string; flowId: string | undefined; workerId: string | undefined }>>;
  /**
   * Read one seat's own view of itself.
   *
   * `door` sends the request through the transport door instead of a direct
   * `runAction`: `"org-less"` with no credential at all, which BR-17 says is
   * refused before anything runs, and `"bearer"` with the lab's verified
   * bearer, which takes its org from that bearer and lands. A refusal is
   * returned rather than thrown, so it can be graded on its wording.
   */
  inspect(
    seatId: string,
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
   * Run one of the project writes (`createProject`, `setWorkstreams`,
   * `setRepository`) as the lab's owner, in the session the open created
   * projects in. Absent when `projects` was not asked for.
   */
  projectAct?(actionName: string, input: unknown): Promise<{ output?: unknown; error?: string }>;
  /**
   * The workspace host the coder kind runs on, when the lab built one
   * (`workspace: { root, remotes }`).
   */
  workspaceHost?: WorkspaceHost;
  /**
   * The flow state the worker flows are registered in: what a host hands
   * `raiseAsk` when it calls the step itself.
   */
  state: FlowState;
  /** The ledger both kinds file onto, as `raiseAsk` takes it. */
  ledger: FeatureLedger;
  /**
   * Send one request through the lab's HTTP door, as a person's client would.
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
 * Read the tree, build the installation and the kinds, and register them.
 *
 * @param options The stores, the harness slot, the workspace and the address.
 * @returns The live lab. Call `dispose()` when done.
 * @throws If the tree does not load, or if any worker would be refused on its
 *   first turn — which is BR-2, and deliberately fatal: nothing is registered.
 */
export async function openLab(options: OpenLabOptions): Promise<Lab> {
  const roster = await loadTree(options.root ?? LAB_TREE);

  // **The board, read off the tree.** One mailbox holds a board, and it holds
  // one: the lab's wiring hands one ledger to both kinds, so a tree that grew
  // a second board would be a different lab, and is refused by what it has
  // rather than resolved by guessing which one was meant. Mailboxes that hold
  // no board are workstreams like any other; they are opened, registered and
  // grouped into projects, and file nothing.
  const mailbox = boardMailboxOf(roster);
  const declaredBoards = mailbox.declared.boards as string[] | undefined;
  if (declaredBoards?.length !== 1) {
    throw new Error(
      `mailbox "${mailbox.id}" declares ${declaredBoards?.length ?? 0} board(s); this lab runs one`,
    );
  }
  const boardName = declaredBoards[0]!;
  const board = mailboxBoard(mailbox.id, boardName);
  const ledger: FeatureLedger = options.ledger ?? { id: board.id, collection: board };

  // A host's source is the project that holds the board the coder kind drains.
  const workspaceHost: WorkspaceHost | undefined =
    "sourceRepo" in options.workspace
      ? undefined
      : labWorkspaceHost(options.workspace, ledger.id, options.saveNothing === true);
  if (options.saveNothing === true && workspaceHost === undefined) {
    throw new Error("openLab: `saveNothing` needs a `{ root, remotes }` workspace; a fixed repository keeps no files");
  }

  // The documents, as the L1 resource map a flow installs. Org-scoped, which is
  // what makes the seats' document reads — and BR-17 — matter.
  const resources = resourcesFromDocs(roster.documents);

  // The project writes, built once: the flow that creates projects at open runs
  // them as actions, and the chief of staff calls the same two as tools.
  const projectBlocks = defineProjectBlocks();
  const projectTools = chiefOfStaffProjectTools(projectBlocks);

  // The controls mutate the RECORD, before the mint, so a perturbed seat
  // genuinely runs on what the control gave it rather than being graded as if
  // it did.
  const overrides = options.documentOverrides ?? {};
  const workers = roster.workers.map((worker) => {
    const declared = { ...worker.declared };
    if (Object.hasOwn(overrides, worker.id)) declared.document = overrides[worker.id];
    if (options.withoutProjectTools === true && Array.isArray(declared.tools)) {
      declared.tools = (declared.tools as string[]).filter((name) => !Object.hasOwn(projectTools, name));
    }
    const redirected = { ...worker, declared };
    return options.mutateSkills === undefined
      ? redirected
      : {
          ...redirected,
          skills: options.mutateSkills(redirected.id, (redirected.skills ?? []) as SeatSkill[]),
        };
  });

  // The worker model: the tree's workers are its standard workers, and each
  // runs on one copy of the flow it names. The flows are read when first
  // needed, so the kinds below can be built on the installation.
  let kinds: NonNullable<HireOptions["workerFlows"]> = {};
  const installation = createWorkerInstallation({
    standardWorkers: workers,
    workerFlows: () => kinds,
    documents: resources as never,
  });
  const flowOf = (workerId: string): string =>
    (installation.standardWorker(workerId)?.declared.flow as string | undefined) ?? AGENT_KIND;
  // A worker of either kind reads its brief by the document it names; one that
  // names none would pass every isolation check trivially, so it never boots.
  for (const worker of workers) {
    const kind = worker.declared.flow;
    if ((kind === EM_KIND || kind === CODER_KIND) && typeof worker.declared[DOCUMENT_KEY] !== "string") {
      throw new Error(`seat "${worker.id}" runs on "${kind}" and names no \`${DOCUMENT_KEY}:\`; every seat of this kind reads one`);
    }
  }

  // Any assignee but the board's own `coder` is looked up per row, over the
  // installation's standard workers. The mailbox's `fileTask` asks the same
  // lookup before it files.
  const workerLookup = createWorkerLookup({ installation });
  const emKind = defineEmWorkerFlow({
    installation,
    coderWorker: options.coderSeatId,
    // A worker the tree doesn't declare runs on no flow: the hand-off names
    // the id itself, which no flow answers, so the row is refused by it.
    coderFlow: installation.standardWorker(options.coderSeatId) === undefined ? options.coderSeatId : flowOf(options.coderSeatId),
    findWorker: { flowKind: workerLookup.flowKind, state: workerLookup.state },
    resources,
    ledger,
    ...(options.fileBeforeAsking === true ? { fileBeforeAsking: true } : {}),
  });
  // The coordinator a coder seat's message door re-runs the board on, read off
  // the tree like the board. Two would be a guess, so the lab refuses; none
  // leaves the coder with no door, since nothing re-runs its board.
  const emRecords = roster.workers.filter((worker) => worker.declared.flow === EM_KIND);
  if (emRecords.length > 1) {
    throw new Error(`the tree declares ${emRecords.length} EM seats; this lab runs one`);
  }
  // With no EM seat the coder kind has no door, and a worker flow with none is
  // refused when it is registered. An open asked to raise the ask names that
  // step instead, since it is the one that has nothing to ask from.
  if (emRecords.length === 0 && options.ask !== undefined) {
    throw new Error(`${RAISE_ASK_STEP}: wanted one "${EM_KIND}" seat to ask from, found 0`);
  }
  const coderKind = defineCoderWorkerFlow({
    installation,
    ledger,
    ...(emRecords[0] === undefined ? {} : { coordinatorFlow: EM_KIND }),
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
    // The mailbox's charter and members, resolved once here so the prompt
    // builder stays a function of the run and these options. Not the whole
    // manifest: the charter is the only mailbox content a run is handed.
    // Known limit: this is a snapshot, so a charter edited while the lab is
    // open does not reach later prompts. A real host should read it per run.
    phase: defineImplementPhase({
      seatOf: seatOf(installation, CODER_KIND),
      requireAcceptance: options.requireAcceptance === true,
      mailbox: {
        id: mailbox.id,
        charter: mailbox.body,
        members: (mailbox.declared.members as string[] | undefined) ?? [],
      },
      ...(options.dropTask === true ? { dropTask: true } : {}),
    }),
    runTimeoutMs: options.runTimeoutMs ?? 60_000,
    resources,
  });

  // The built-in `agent` kind, which the chief of staff (`org/workers/
  // chief-of-staff/`) runs on. Every worker on it gets the discovery door; a
  // worker holds post, hire, fire and the project writes only by naming them in
  // its `tools:`, and in this tree only the chief of staff does. Hire and fire
  // write the roster of the person talking to it: a worker of their own, which
  // runs on that person's turns only. A fire, and a project's repository, wait
  // for a person's Approve in Inbox, which needs durable execution (on
  // whenever a worker holds a tool that asks first).
  const rosterTools = chiefOfStaffRosterTools(installation);
  const asksFirst = new Set(["fire", ...(options.withoutProjectTools === true ? [] : ["createProject", "setRepository"])]);
  const asksBeforeChanging = workers.some((worker) =>
    ((worker.declared.tools as string[] | undefined) ?? []).some((tool) => asksFirst.has(tool)),
  );
  // What the agent's turn is built with. The `agent` flow runs it behind its
  // door, and the `coordinator` flow, which the chief of staff runs on, runs
  // the same turn for its judgment: one catalog, one set of capabilities.
  const agentTurn = {
    // The project tools and the roster writes a worker names in `tools:`.
    // The kind carries them, and only the chief of staff's line names them.
    catalog: { ...(options.withoutProjectTools === true ? {} : projectTools), ...rosterTools },
    uses: [
      // The seat and mailbox inventories, which the discovery door reads.
      // The mailbox inventory is declared with the project writes' own
      // object, because the project tools read it too and a flow takes one
      // declaration per storage key.
      defineCapability({
        name: "lab-inventory",
        resources: { seatInventory: defineSeatInventoryCollection(), mailboxInventory: projectWritesMailboxInventory },
      }),
      createWorkforceCapability({
        roster: { workers: roster.workers, mailboxes: roster.mailboxes },
        inventory: { seats: "seatInventory", mailboxes: "mailboxInventory" },
      }),
      workerMailboxPostCapability,
    ],
  };
  const agentKind = defineAgentWorkerFlow({ installation, ...agentTurn });
  kinds = {
    [EM_KIND]: emKind as never,
    [CODER_KIND]: coderKind as never,
    [AGENT_KIND]: agentKind as never,
    // The chief of staff's flow. A delivery reaches a delegate on a flow that
    // takes a delegated post: here, `agent`. Best fit's evaluator runs on the
    // Lab's small model; the chief of staff routes by judgment, so it calls it
    // only for a coordinator that names `routing: best-fit`.
    [COORDINATOR_KIND]: defineCoordinatorFlow({
      installation,
      delegateFlows: [agentKind],
      routeModel: "openai/gpt-5.4-mini",
      agent: agentTurn,
    }) as never,
  };

  // One copy per worker flow, and the roster flow. Refuses the WHOLE tree when
  // a worker would be refused on its first turn, or a worker flow doesn't
  // declare the installation's session, naming each (BR-2). Handed the tree's
  // board ids, so a kind that stopped declaring the board would be named in
  // the unattended-board warning.
  const copies = hireWorkforce(installation, { mailboxBoards: mailboxBoardIds(roster.mailboxes) });
  const copyOf = (kind: string): FlowInstance => copies.find((copy) => copy.id === kind)!;
  const seats: Record<string, FlowInstance> = Object.fromEntries(
    installation.standardWorkers().map((worker) => [worker.id, copyOf(flowOf(worker.id))]),
  );

  // The mailbox instances, when the caller asked for a mailbox door. One
  // instance per DISTINCT kind, never one per record — the binder's contract,
  // composed rather than restated. The built-in kind is replaced wholesale with
  // one carrying this lab's notify slot, because a slot cannot be added to a
  // kind after it is built.
  if (options.inventory === true && options.mailboxes === undefined) {
    throw new Error("openLab: `inventory` needs `mailboxes`, whose kind writes the inventory");
  }
  const mailboxKind =
    options.mailboxes === undefined
      ? undefined
      : defineMailboxFlow({
          notify: labNotify({ ...options.mailboxes, flowOf }) as never,
          checkAssignee: workerLookup.filingCheck({ [ledger.id]: [ASSIGNEE] }),
          ...(options.inventory === true ? { inventory: true } : {}),
        });
  // The org's resource modules: where the projects collection and its talk
  // template are declared. The binder reads the template off them, builds its
  // seats and charter onto the mailbox kind, and installs the mint on create.
  const orgResources = mailboxKind === undefined ? {} : await loadResourceModules(options.root ?? LAB_TREE);
  const instances =
    mailboxKind === undefined
      ? []
      : mailboxInstances(roster.mailboxes, {
          kinds: { [MAILBOX_KIND]: mailboxKind as never },
          resources: orgResources,
        });

  if (options.projects !== undefined && options.inventory !== true) {
    throw new Error("openLab: `projects` needs `inventory`: a project's workstreams are checked against it");
  }
  // The flow a project is created through at open: the project writes, as an
  // app installs them. The chief of staff calls the same two as tools.
  const projectsFlow =
    options.projects === undefined
      ? undefined
      : defineFlow({ kind: PROJECTS_KIND, actions: projectBlocks.actions } as never)();

  const latencyEnv = process.env.DEVFORCE_LAB_WRITE_LATENCY_MS;
  const writeLatency = latencyEnv === undefined || latencyEnv === "" ? undefined : Number(latencyEnv);
  if (writeLatency !== undefined && !(writeLatency > 0)) {
    throw new Error(`DEVFORCE_LAB_WRITE_LATENCY_MS must be a positive number of milliseconds, not "${latencyEnv}"`);
  }
  if (writeLatency !== undefined) console.error(`[devforce-lab] holding checked store writes up to ${writeLatency}ms`);

  // One record for the Lab's own flows and the worker flows' copies. A copy's
  // id is its kind, so a worker flow named like one of the Lab's flows
  // (`mailbox`, `projects`) would take that flow's key; `mergeSeatFlows`
  // refuses it, by name.
  const flows: Record<string, unknown> = mergeSeatFlows(
    {
      ...Object.fromEntries(instances.map((instance) => [instance.kind, instance])),
      ...(projectsFlow === undefined ? {} : { [PROJECTS_KIND]: projectsFlow }),
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
    // When something can wait for a person: the EM's ask, or a worker holding
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

  /** The session a seat's actions run in — one per worker, stable across a run. */
  const sessionFor = seatSessionId;

  /**
   * The session client `openMailboxes` is handed.
   *
   * Direct store writes rather than the HTTP router: the route is
   * fire-and-forget and this needs the session to exist before the next line.
   *
   * **`openMailboxes` takes no `orgId`, and no wrapper is written here.** Its
   * declared `createSession` has no such field and never did — the binder gave
   * up the authority to choose an organization, and the server-created session
   * carries one from the verified principal instead (FIX-1442). This stand-in
   * for the session route binds what that route binds, which is the lab's own
   * org, and is the only reason an `orgId` is written at all.
   */
  const sessionClient = {
    createSession: async (create: {
      flowKind: string;
      userId: string;
      sessionId?: string;
      description?: string;
      state?: Record<string, unknown>;
    }) => {
      const id = String(create.sessionId);
      if ((await runtime.stores.session.get(id)) !== undefined) {
        throw Object.assign(new Error(`Session "${id}" exists`), { status: 409 });
      }
      const now = Date.now();
      await runtime.stores.session.set(
        id,
        {
          id,
          flowKind: create.flowKind,
          flowId: create.flowKind,
          userId: create.userId,
          orgId: LAB_ORG_ID,
          description: create.description,
          state: create.state ?? {},
          lineageId: `lin_${id}`,
          version: 0,
          createdAt: now,
          updatedAt: now,
          journal: [],
        } as never,
        "absent",
      );
      return { id };
    },
    getSession: async (sessionId: string) => {
      const found = (await runtime.stores.session.get(sessionId)) as
        | {
            flowKind: string;
            flowId?: string;
            userId: string;
            state?: Record<string, unknown>;
          }
        | undefined;
      return {
        flowKind: String(found?.flowKind),
        flowId: found?.flowId,
        userId: String(found?.userId),
        state: found?.state,
      };
    },
    deleteSession: async (sessionId: string) => {
      await runtime.stores.session.delete(sessionId);
    },
  };

  if (mailboxKind !== undefined) {
    await openMailboxes(roster.mailboxes, { client: sessionClient, userId: LAB_USER_ID });
  }

  // The inventory, in-process, under the lab's organization, once the mailbox
  // sessions it registers from exist. A problem fails the open, naming it.
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
    // The standard workers, the ones every member has. A person's own workers
    // are theirs, on their roster, and not listed here.
    const opened = await openInventory(
      { seats: inventorySeats(installation), mailboxes: roster.mailboxes },
      { run, seatWriter: { flowKind: MAILBOX_KIND }, userId: LAB_USER_ID, orgId: LAB_ORG_ID },
    );
    if (opened.problems.length > 0) {
      await state.dispose();
      throw new Error(`openLab: the inventory did not open: ${opened.problems.join("; ")}`);
    }
  }

  // The projects, once the inventory their workstreams are checked against is
  // written: one `createProject` turn each, as the owner, in the lab's own
  // projects session. A row the owner already holds comes back unchanged.
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

  const mailboxInstance = instances.find((instance) => instance.kind === MAILBOX_KIND);
  /** The mailbox holding the board. Its id is its session id. */
  const mailboxId = mailbox.id;

  /**
   * Where the kinds' ledger keeps its rows: the organization for the
   * mailbox's board, the user for a ledger a control built of its own.
   */
  const ledgerScope = ledger.collection.scope === "org" ? "org" : "user";
  const ledgerScopeId = ledgerScope === "org" ? LAB_ORG_ID : LAB_USER_CELL;

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
  ): Promise<{ output?: unknown; error?: string }> => {
    try {
      const result = (await runAction({
        flow,
        actionName,
        input,
        userId: LAB_USER_ID,
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

  // The ask, last, once everything it runs over is registered. One EM seat is
  // what this tree declares; a tree with none, or two, has no single seat the
  // ask belongs to, and that is a refusal rather than a guess.
  let ask: RaiseAskResult | undefined;
  if (options.ask !== undefined) {
    try {
      if (emRecords.length !== 1) {
        throw new Error(
          `${RAISE_ASK_STEP}: wanted one "${EM_KIND}" seat to ask from, found ${emRecords.length}`,
        );
      }
      ask = await raiseAsk({
        state,
        emFlow: copyOf(EM_KIND),
        emWorker: emRecords[0]!.id,
        feature: options.ask,
        principal: { userId: LAB_USER_ID, orgId: LAB_ORG_ID },
        ledger,
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
    seatId: string,
    actionName: string,
    input: unknown,
  ): Promise<{ output?: unknown; error?: string }> => {
    const flow = seats[seatId];
    if (flow === undefined) throw new Error(`no seat "${seatId}" is declared`);
    try {
      await openSeatSession(runtime.stores, { flow, workerId: seatId, principal: { userId: LAB_USER_ID, orgId: LAB_ORG_ID } });
    } catch (error) {
      return { error: messageOf(error) };
    }
    return await actOn(flow, sessionFor(seatId), actionName, input);
  };

  return {
    roster: { ...roster, workers },
    board: { name: boardName, id: board.id },
    seats,
    installation,

    file: (seatId, input) => act(seatId, FILE_ENTRY, input),
    drain: (seatId) => act(seatId, DRAIN_ENTRY, {}),

    ...(mailboxInstance === undefined || mailboxId === undefined
      ? {}
      : {
          mailboxId,
          post: (body: string) => actOn(mailboxInstance, mailboxId, "post", { body }),
          transcript: async (): Promise<MailboxTranscriptLine[]> => {
            const result = await actOn(mailboxInstance, mailboxId, "read", {});
            if (result.error !== undefined) {
              throw new Error(`reading the mailbox was refused — ${result.error}`);
            }
            return (result.output as { transcript: MailboxTranscriptLine[] }).transcript;
          },
          mailboxAct: (actionName: string, input: unknown) =>
            actOn(mailboxInstance, mailboxId, actionName, input),
          readBoardAtDoor: async (door: "org-less" | "bearer") => {
            // The collection read route, on the mailbox's own session, under
            // the board's minted id — the read a board panel makes.
            const segments = ["sessions", mailboxId, "resources", board.id];
            const response = await (router as any).GET(
              new Request(`http://lab/api/flows/${segments.join("/")}`, {
                method: "GET",
                headers:
                  door === "bearer" ? { authorization: `Bearer ${LAB_PRINCIPAL_SECRET}` } : {},
              }),
              { params: { path: segments } },
            );
            const text: string = await response.text();
            const json = text.length > 0 ? JSON.parse(text) : undefined;
            if (response.status >= 400) {
              return { status: response.status, error: JSON.stringify(json) };
            }
            const items = (json?.items ?? []) as Array<{ clientData?: Record<string, unknown> }>;
            return {
              status: response.status,
              rows: items.map((item) => item.clientData ?? {}),
            };
          },
        }),

    row: async (taskId: string) => {
      const record = await runtime.stores.resourceState.get(
        ledgerScope,
        ledgerScopeId,
        `${ledger.id}/${taskId}`,
      );
      return record?.state as Task | undefined;
    },

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

    rows: async () => {
      const found = await runtime.stores.resourceState.getByPrefix(
        ledgerScope,
        ledgerScopeId,
        `${ledger.id}/`,
      );
      return Object.fromEntries(
        Object.entries(found).map(([key, record]) => [
          key,
          (record as { state: unknown }).state as Task,
        ]),
      );
    },

    dispatched: async (seatId: string) => {
      const children = await runtime.stores.session.list({
        userId: LAB_USER_ID,
        parentage: { parentOf: sessionFor(seatId) },
      });
      // **The worker, not the flow.** Two seats on this tree run on the SAME
      // kind — the coder and the never-woken reviewer — so a dispatch record
      // read by flow alone cannot tell them apart, and BR-8's whole claim is
      // which of the two the row reached. The child session names it.
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

    inspect: async (seatId: string, inspectOptions?: { door?: "org-less" | "bearer" }) => {
      if (seatId in seats === false) throw new Error(`no seat "${seatId}" is declared`);

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
        const probeSession = `${inspectOptions.door}-${seatId}`;
        if (bearer) {
          const created = await door("POST", `${flowOf(seatId)}/sessions`, {
            body: { userId: LAB_USER_ID, sessionId: probeSession, state: { [WORKER_ID_STATE_KEY]: seatId } },
          });
          if (created.status !== 201 && created.status !== 409) {
            return { error: `${created.status}: ${JSON.stringify(created.body)}` };
          }
        }
        const segments = [flowOf(seatId), probeSession, "actions", INSPECT_ENTRY];
        const request = new Request(`http://lab/api/flows/${segments.join("/")}`, {
          method: "POST",
          // The inline stream, because the plain POST acks 202 with no output
          // and the positive half is graded on the seat's facts.
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
              event.item?.type === "component" && event.item.component === SEAT_FACTS_COMPONENT,
          )
          .at(-1)?.item?.data;
        const completed = events.some((event) => event.type === "request.completed");
        if (completed && facts !== undefined) return { facts };
        const seen = events.map((event) => event.type).join(", ");
        return {
          error: completed
            ? `request.completed fired with no ${SEAT_FACTS_COMPONENT} component (events: ${seen})`
            : `request.completed never fired (events: ${seen})`,
        };
      }

      const result = await act(seatId, INSPECT_ENTRY, {});
      return result.error === undefined
        ? { facts: (result.output ?? {}) as Record<string, unknown> }
        : { error: result.error };
    },

    ...(ask === undefined ? {} : { ask }),
    ...(projects === undefined
      ? {}
      : { projects, projectAct: (actionName: string, input: unknown) => actOn(projectsFlow, PROJECTS_SESSION, actionName, input) }),
    ...(workspaceHost === undefined ? {} : { workspaceHost }),
    state,
    ledger,
    door,

    dispose: () => state.dispose(),
  };
}

/**
 * The lab's workspace host: `localWorkspaceHost` over `root`, reaching only
 * the remotes listed, with `projectWorkspace` on the drained board as its
 * source. `saveNothing` is the `no-sync-back` control's seam: the host is the
 * same, and its `save` reports nothing saved.
 */
function labWorkspaceHost(options: LabWorkspaceHost, boardId: string, saveNothing: boolean): WorkspaceHost {
  const host = localWorkspaceHost({
    root: options.root,
    remotes: { allow: [...options.remotes.allow] },
    source: projectWorkspace({ board: { id: boardId } }),
  });
  if (!saveNothing) return host;
  return { ...host, save: async () => ({ outcomes: [], conflicts: [], contested: [] }) };
}

/** One wording for whatever a refusal turns out to be. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
