/**
 * The lab itself — one module both checks import, so the model-free contract
 * gate and the model-backed honesty check drive the *same* tree, the same hire
 * and the same wiring, and differ by one block.
 *
 * What `openLab` does, in order, and nothing else: read the tree, resolve the
 * feature channel's board, build the two kinds on it, hire, register, open the
 * declared channels when asked (and their organization's inventory, when that
 * is asked too), hand back the handles. Every convention file it
 * reads is found by walking from one root; no file is named in this code.
 *
 * **The board belongs to the channel.** The feature channel's `CHANNEL.md`
 * names it (`boards: [work]`), the framework mints its id from where the
 * channel sits, and this host resolves it with `channelBoard(channel.id,
 * boardName)` — both read off the tree, the way
 * `goals/multi-seat-collab/lab/host.mts` does. Both kinds are handed that one
 * ledger, so a row the EM files and the coder's run settles is the row the
 * channel serves. It is kept per organization, so it exists whether or not the
 * channel is opened.
 *
 * Five pieces here are the lab's rather than the framework's, each because the
 * framework has no opinion at that spot:
 *
 * 1. **The board's two declarations** (`board.mts`): the EM's, which hands a
 *    row across flows, and the coder's, which the cross-flow claim gate
 *    requires. The ledger under both is the channel's.
 * 2. **The assignee → seat address.** A board's `workers` keys are assignees,
 *    not Workforce seats; which seat an assignee reaches is a dispatcher's
 *    `flowKind`, and it is a static instance id rather than a lookup. The
 *    caller supplies it, which is also what lets a control point it at the
 *    wrong seat and watch the negative claim go red.
 * 3. **The harness slot**, handed to the `coder` kind. The one expression that
 *    differs between this lab's two checks.
 * 4. **The channel's address map** (`notify.mts`), and whether a channel is
 *    opened at all. The framework keeps the member walk and runs a notify block
 *    once per declared member; which member resolves to which seat is the app's,
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
  runAction,
  type FlowState,
  type PrincipalResolver,
} from "@flow-state-dev/engine";
import { defineCapability } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import {
  AGENT_KIND,
  CHANNEL_KIND,
  channelBoard,
  channelBoardIds,
  channelInstances,
  channelPostCapability,
  createSeatHireCapability,
  createWorkforceCapability,
  defineAgentWorkerFlow,
  defineChannelFlow,
  defineChannelInventoryCollection,
  HIRED_ROSTER_RESOURCE,
  hireWorkforce,
  openChannels,
  openInventory,
  reloadHiredSeats,
  resourcesFromDocs,
  SEAT_INVENTORY_RESOURCE,
  type ChannelTranscriptLine,
  type HireOptions,
  type InventoryActionRequest,
} from "@flow-state-dev/workforce";
import {
  readDeclaredRoster,
  type DeclaredRoster,
} from "@flow-state-dev/workforce/loader";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { fileURLToPath } from "node:url";
import type { FeatureLedger } from "./board.mts";
import { INSPECT_ENTRY, SEAT_FACTS_COMPONENT } from "./seat-config.mts";
import { defineImplementPhase } from "./phase.mts";
import { CODER_KIND, defineCoderWorkerFlow } from "./workforce/flows/workers/coder.mts";
import {
  DRAIN_ENTRY,
  EM_KIND,
  FILE_ENTRY,
  defineEmWorkerFlow,
} from "./workforce/flows/workers/em.mts";
import type { HarnessStub } from "./harness-stub.mts";
import { labNotify, type NotifyLog } from "./notify.mts";
import {
  RAISE_ASK_STEP,
  raiseAsk,
  seatSessionId,
  type AskFeature,
  type RaiseAskResult,
} from "./ask.mts";

/** The authored tree — the one path this code names. Everything else is walked. */
export const LAB_TREE = fileURLToPath(new URL("./workforce", import.meta.url));

/**
 * Who the lab runs as, and the org every document read is bound to. The org id
 * is a legal address segment (lowercase, hyphenated) because a seat the chief
 * of staff hires is addressed `<org>.<seatId>`.
 */
export const LAB_USER_ID = "u_devforce_lab";
export const LAB_ORG_ID = "devforce-lab";

/**
 * Host-owned verified identity for this lab's HTTP door (FIX-1515).
 *
 * After FIX-1442 an app that configures no resolver runs under the built-in
 * development organization. That default is not a refusal, so an org-less
 * probe at the transport door was being answered. Wiring a real
 * `resolvePrincipal` is what makes an unauthenticated read have nothing to
 * fall back to — the same posture a deployment that has verified identity
 * uses. The mint FIX-1503 will ship is not here yet; this is the thin
 * host-owned stub that issue allows: one secret, one principal, fail-closed
 * when nothing verified is presented.
 *
 * In-process `runAction` is not HTTP and keeps the explicit lab org
 * (FIX-1503: trusted process callers). Only the door this check probes goes
 * through the resolver.
 */
const LAB_PRINCIPAL_SECRET = "devforce-lab-verified-principal";

const verifyLabBearer = createBearerSecretPrincipalResolver({
  secret: LAB_PRINCIPAL_SECRET,
  principal: { userId: LAB_USER_ID, orgId: LAB_ORG_ID },
});

const resolveLabPrincipal: PrincipalResolver = async (context) => {
  const principal = await verifyLabBearer(context);
  if (principal === null) {
    throw new PrincipalResolutionError(
      "Request requires a verified organization: no verified principal was presented.",
      { status: 401 },
    );
  }
  return principal;
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

export interface OpenLabOptions {
  /** The store adapter this lab runs over — `inMemoryStores()` is enough. */
  stores: unknown;
  /** The harness the `coder` kind runs. The one thing the two checks differ by. */
  harness: HarnessStub["slot"];
  /** Where checkouts are cut, from what repository, off which ref. */
  workspace: { root: string; sourceRepo: string; baseRef: string };
  /**
   * The seat instance id the board's `coder` assignee is addressed to.
   *
   * The address map is the app's, not the tree's. Supplied by the caller for
   * that reason — and because a control that points it at the wrong declared
   * seat is the only way "the row reached the seat it named" can be made to go
   * red.
   */
  coderSeatId: string;
  /** Wall-clock budget for one harness run. Default 60s. */
  runTimeoutMs?: number;
  /** The tree to read. Defaults to the lab's own. */
  root?: string;
  /** Silence the engine's own logging. */
  logger?: unknown;
  /**
   * Open the channels the tree declares, and address the fan-out.
   *
   * **Absent means absent**, and that is the shape the two existing checks
   * keep: no channel instance is registered, `openChannels` is not called, and
   * the lab behaves exactly as it did before the channel door existed. An
   * entry that is only there to do nothing is worse than none — which is how
   * `defineChannelFlow`'s own notify slot works, and the reason this is an
   * option rather than a widening of every check that imports `openLab`.
   *
   * `addresses` is member id → hired seat instance id. A declared member absent
   * from it is recorded in `log.skipped` and never dispatched to.
   */
  channels?: {
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
   * **Absent means absent**, as with `channels`: no durable execution, no
   * request, no store write, and the other checks open exactly as they
   * did. Present turns durable execution on, because the answer arrives later
   * through the engine's resume route, and open fails, naming the step, if the
   * ask could not be raised.
   */
  ask?: AskFeature;
  /**
   * Open the organization's seat and channel inventory after the channels, the
   * collections Shift Manager's TEAMS and PROJECTS read. Needs `channels`: the
   * inventory's writer is the channel kind, built with `inventory: true`.
   *
   * **Absent means absent**: the channel kind is built without the writer and
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

  // ---- controls, each the red state of one claim -------------------------

  /**
   * The asking door files its row before it suspends. The red state of
   * "nothing is filed until a person approves".
   */
  fileBeforeAsking?: boolean;

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
   * Build the two kinds on this ledger instead of the channel's.
   *
   * The goal check's `kind-ledger` control: the kinds keep a ledger of their
   * own, as they did before the board moved onto the channel. The run still
   * completes; only where its row lives moves, which is the red state of "the
   * channel's board holds the row". The channel still declares its board, and
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
   * The feature channel's board, as the tree declares it: its local `name`
   * (from `CHANNEL.md`) and the `id` the framework minted from where the
   * channel sits. Read off the tree, so no check spells either.
   */
  board: { name: string; id: string };
  /** The hired seats, by id. */
  seats: Record<string, FlowInstance>;
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
   * The channel the tree declared, once `channels` was asked for.
   *
   * The id is minted from where `CHANNEL.md` sits, never named in this code.
   */
  channelId?: string;
  /**
   * Post one line on that channel, as an operator would.
   *
   * The whole of the channel leg's front door: nothing else in this lab files a
   * row when `channels` is on. Absent when no channel was opened.
   */
  post?(body: string): Promise<{ output?: unknown; error?: string }>;
  /** Read the channel's transcript back. Absent when no channel was opened. */
  transcript?(): Promise<ChannelTranscriptLine[]>;
  /**
   * Run one of the channel's own actions (`read`, `readBoard`) — the reads
   * Shift Manager makes of a workstream. Absent when no channel was opened.
   */
  channelAct?(actionName: string, input: unknown): Promise<{ output?: unknown; error?: string }>;
  /**
   * Read the channel's board through the HTTP door a browser uses — the
   * collection read route, on the channel's session.
   *
   * `"bearer"` carries the lab's verified bearer; `"org-less"` carries no
   * credential and is refused before anything is read. Absent when no channel
   * was opened, since the door reads through the channel's session.
   */
  readBoardAtDoor?(
    door: "org-less" | "bearer",
  ): Promise<{ status: number; rows?: Array<Record<string, unknown>>; error?: string }>;
  /**
   * Every child session the EM seat's drain started, with the flow it was
   * attributed to — the **dispatch record**.
   *
   * This is what BR-6 and BR-8 are graded on. A seat's absence from a result
   * says nothing: a stray dispatch whose run produced nothing would be
   * indistinguishable from no dispatch at all.
   */
  dispatched(
    seatId: string,
  ): Promise<Array<{ sessionId: string; flowKind: string; flowId: string | undefined }>>;
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
   * The flow state the seats are registered in: what a host hands `raiseAsk`
   * when it calls the step itself.
   */
  state: FlowState;
  /** The ledger both kinds file onto, as `raiseAsk` takes it. */
  ledger: FeatureLedger;
  /**
   * Send one request through the lab's HTTP door, as a person's client would.
   *
   * `path` is everything after `/api/flows/`, query string included. The lab's
   * verified bearer is sent unless `bearer` is `false`, which is how a check
   * shows the door refuses a caller that presented nothing.
   */
  door(
    method: "GET" | "POST",
    path: string,
    options?: { body?: unknown; bearer?: boolean },
  ): Promise<{ status: number; body: any }>;
  dispose(): Promise<void>;
}

/**
 * Read the tree, build the kinds, hire, and register.
 *
 * @param options The stores, the harness slot, the workspace and the address.
 * @returns The live lab. Call `dispose()` when done.
 * @throws If the tree does not load, or if any record refuses at the mint —
 *   which is BR-2, and deliberately fatal: nothing is hired, nothing registered.
 */
export async function openLab(options: OpenLabOptions): Promise<Lab> {
  const roster = await loadTree(options.root ?? LAB_TREE);

  // **The board, read off the tree.** One channel, one declared board: the
  // lab's wiring hands one ledger to both kinds, so a tree that grew a second
  // channel or board would be a different lab, and is refused by what it has
  // rather than resolved by guessing which one was meant.
  if (roster.channels.length !== 1) {
    throw new Error(`the tree declares ${roster.channels.length} channel(s); this lab runs one`);
  }
  const channel = roster.channels[0]!;
  const declaredBoards = channel.declared.boards as string[] | undefined;
  if (declaredBoards?.length !== 1) {
    throw new Error(
      `channel "${channel.id}" declares ${declaredBoards?.length ?? 0} board(s); this lab runs one`,
    );
  }
  const boardName = declaredBoards[0]!;
  const board = channelBoard(channel.id, boardName);
  const ledger: FeatureLedger = options.ledger ?? { id: board.id, collection: board };

  // The documents, as the L1 resource map a flow installs. Org-scoped, which is
  // what makes the seats' document reads — and BR-17 — matter.
  const resources = resourcesFromDocs(roster.documents);

  // The controls mutate the RECORD, before the mint, so a perturbed seat
  // genuinely runs on what the control gave it rather than being graded as if
  // it did.
  const overrides = options.documentOverrides ?? {};
  const workers = roster.workers.map((worker) => {
    const declared = { ...worker.declared };
    if (Object.hasOwn(overrides, worker.id)) declared.document = overrides[worker.id];
    const redirected = { ...worker, declared };
    return options.mutateSkills === undefined
      ? redirected
      : {
          ...redirected,
          skills: options.mutateSkills(redirected.id, (redirected.skills ?? []) as SeatSkill[]),
        };
  });

  const emKind = defineEmWorkerFlow({
    coderSeatId: options.coderSeatId,
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
  const coderKind = defineCoderWorkerFlow({
    ledger,
    ...(emRecords[0] === undefined ? {} : { coordinatorSeatId: emRecords[0].id }),
    harness: options.harness,
    workspace: options.workspace,
    // The channel's charter and members, resolved once here so the prompt
    // builder stays a function of the run and these options. Not the whole
    // manifest: the charter is the only channel content a run is handed.
    // Known limit: this is a snapshot, so a charter edited while the lab is
    // open does not reach later prompts. A real host should read it per run.
    phase: defineImplementPhase({
      requireAcceptance: options.requireAcceptance === true,
      channel: {
        id: channel.id,
        charter: channel.body,
        members: (channel.declared.members as string[] | undefined) ?? [],
      },
      ...(options.dropTask === true ? { dropTask: true } : {}),
    }),
    runTimeoutMs: options.runTimeoutMs ?? 60_000,
    resources,
  });

  // The built-in `agent` kind, which the chief of staff (`org/workers/
  // chief-of-staff/`) runs on. Every seat of it gets the discovery door; a
  // seat holds post, hire, fire and the repairs only by naming them in its
  // `tools:`, and in this tree only the chief of staff does. A hire lands at
  // once; a fire, and a repair always, waits for a person's Approve in Inbox,
  // which needs durable execution (`ask` turns it on). The kind mounts no
  // members' private roster, so the chief of staff lists, fires and repairs
  // the organization's seats only. The register reaches
  // the flow state built below, so it is bound once that exists.
  const kinds: NonNullable<HireOptions["kinds"]> = {
    [EM_KIND]: emKind as never,
    [CODER_KIND]: coderKind as never,
  };
  let registrar: { state: FlowState; registry: { get(id: string): { kind: string } | undefined } } | undefined;
  const seatHire = createSeatHireCapability({
    kinds,
    register: (seat, pin) => registrar!.state.register(seat, { pin }),
    unregister: (id) => registrar!.state.unregister(id),
    kindAt: (id) => registrar?.registry.get(id)?.kind,
    allowKinds: [CODER_KIND, AGENT_KIND],
    channelBoards: channelBoardIds(roster.channels),
    askBefore: ["fire"],
  });
  kinds[AGENT_KIND] = defineAgentWorkerFlow({
    uses: [
      // The channel inventory, which the discovery door reads beside the seats
      // the hire capability mounts.
      defineCapability({ name: "lab-channel-inventory", resources: { channelInventory: defineChannelInventoryCollection() } }),
      createWorkforceCapability({
        roster: { workers: roster.workers, channels: roster.channels },
        inventory: { seats: SEAT_INVENTORY_RESOURCE, channels: "channelInventory" },
        hiredRoster: HIRED_ROSTER_RESOURCE,
      }),
      channelPostCapability,
      seatHire,
    ],
  }) as never;

  // Refuses the WHOLE roster when any record cannot be hired, naming the
  // worker. Nothing is returned partially, so a refusal cannot leave a short
  // roster running.
  // Handed the tree's board ids, so a kind that stopped declaring the board
  // would be named in hire's unattended-board warning.
  const hired = hireWorkforce(workers, {
    kinds,
    channelBoards: channelBoardIds(roster.channels),
  });
  const seats: Record<string, FlowInstance> = Object.fromEntries(
    hired.map((seat) => [seat.id, seat]),
  );

  // The channel instances, when the caller asked for a channel door. One
  // instance per DISTINCT kind, never one per record — the binder's contract,
  // composed rather than restated. The built-in kind is replaced wholesale with
  // one carrying this lab's notify slot, because a slot cannot be added to a
  // kind after it is built.
  if (options.inventory === true && options.channels === undefined) {
    throw new Error("openLab: `inventory` needs `channels`, whose kind writes the inventory");
  }
  const channelKind =
    options.channels === undefined
      ? undefined
      : defineChannelFlow({
          notify: labNotify(options.channels) as never,
          ...(options.inventory === true ? { inventory: true } : {}),
        });
  const instances =
    channelKind === undefined
      ? []
      : channelInstances(roster.channels, {
          kinds: { [CHANNEL_KIND]: channelKind as never },
        });

  const state = createFlowState({
    flows: {
      ...Object.fromEntries(instances.map((instance) => [instance.kind, instance])),
      ...Object.fromEntries(hired.map((seat) => [seat.id, seat])),
    },
    stores: { default: { primary: options.stores } },
    // A configured resolver, so the development-organization fallback does
    // not answer an unauthenticated HTTP read (FIX-1515 / BR-17).
    resolvePrincipal: resolveLabPrincipal,
    ...(options.logger === undefined ? {} : { runtimeConfig: { logger: options.logger } }),
    // Only when the ask is: the other checks run without it, as before.
    ...(options.ask === undefined ? {} : { durable: true }),
    ...(options.devtool === true ? { devtool: { userId: LAB_USER_ID, bearerToken: LAB_PRINCIPAL_SECRET } } : {}),
  } as never);

  const runtime = await state.getRuntime();
  registrar = { state, registry: runtime.registry as never };

  // The seats the chief of staff hired while an earlier run of this Lab was
  // serving, read back from the roster and admitted one by one. A store that
  // starts fresh has none. A row that no longer starts (its kind was cut) is
  // skipped and named; `brokenSeats` lists it for the chief of staff.
  const reload = await reloadHiredSeats({ stores: runtime.stores, orgIds: [LAB_ORG_ID], kinds });
  for (const seat of reload.seats) {
    state.register(seat, { pin: (seat as { ownerPin?: { orgId: string } }).ownerPin ?? { orgId: LAB_ORG_ID } });
  }
  for (const problem of reload.problems) console.error(`[devforce-lab] skipped a hired seat — ${problem}`);

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

  /** The session the EM seat's actions run in — one per seat, stable across a run. */
  const sessionFor = seatSessionId;

  /**
   * The session client `openChannels` is handed.
   *
   * Direct store writes rather than the HTTP router: the route is
   * fire-and-forget and this needs the session to exist before the next line.
   *
   * **`openChannels` takes no `orgId`, and no wrapper is written here.** Its
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

  if (channelKind !== undefined) {
    await openChannels(roster.channels, { client: sessionClient, userId: LAB_USER_ID });
  }

  // The inventory, in-process, under the lab's organization, once the channel
  // sessions it registers from exist. A problem fails the open, naming it.
  if (options.inventory === true) {
    const flows: Record<string, unknown> = {
      ...Object.fromEntries(instances.map((instance) => [instance.kind, instance])),
      ...seats,
    };
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
    const opened = await openInventory(
      { seats: hired, channels: roster.channels },
      { run, seatWriter: { flowKind: CHANNEL_KIND }, userId: LAB_USER_ID, orgId: LAB_ORG_ID },
    );
    if (opened.problems.length > 0) {
      await state.dispose();
      throw new Error(`openLab: the inventory did not open: ${opened.problems.join("; ")}`);
    }
  }

  const channelInstance = instances.find((instance) => instance.kind === CHANNEL_KIND);
  /** The one channel this tree declares. Its id is its session id. */
  const channelId = channel.id;

  /**
   * Where the kinds' ledger keeps its rows: the organization for the
   * channel's board, the user for a ledger a control built of its own.
   */
  const ledgerScope = ledger.collection.scope === "org" ? "org" : "user";
  const ledgerScopeId = ledgerScope === "org" ? LAB_ORG_ID : LAB_USER_ID;

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
    const emSeats = hired.filter((seat) => seat.kind === EM_KIND);
    try {
      if (emSeats.length !== 1) {
        throw new Error(
          `${RAISE_ASK_STEP}: wanted one "${EM_KIND}" seat to ask from, found ${emSeats.length}`,
        );
      }
      ask = await raiseAsk({
        state,
        emSeat: emSeats[0]!,
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
    doorOptions?: { body?: unknown; bearer?: boolean },
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
          : { authorization: `Bearer ${LAB_PRINCIPAL_SECRET}` }),
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
    const seat = seats[seatId];
    if (seat === undefined) throw new Error(`no seat "${seatId}" was hired`);
    return await actOn(seat, sessionFor(seatId), actionName, input);
  };

  return {
    roster: { ...roster, workers },
    board: { name: boardName, id: board.id },
    seats,

    file: (seatId, input) => act(seatId, FILE_ENTRY, input),
    drain: (seatId) => act(seatId, DRAIN_ENTRY, {}),

    ...(channelInstance === undefined || channelId === undefined
      ? {}
      : {
          channelId,
          post: (body: string) => actOn(channelInstance, channelId, "post", { body }),
          transcript: async (): Promise<ChannelTranscriptLine[]> => {
            const result = await actOn(channelInstance, channelId, "read", {});
            if (result.error !== undefined) {
              throw new Error(`reading the channel was refused — ${result.error}`);
            }
            return (result.output as { transcript: ChannelTranscriptLine[] }).transcript;
          },
          channelAct: (actionName: string, input: unknown) =>
            actOn(channelInstance, channelId, actionName, input),
          readBoardAtDoor: async (door: "org-less" | "bearer") => {
            // The collection read route, on the channel's own session, under
            // the board's minted id — the read a board panel makes.
            const segments = ["sessions", channelId, "resources", board.id];
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
        scope === "org" ? LAB_ORG_ID : LAB_USER_ID,
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
      // **`flowId`, not just `flowKind`.** Two seats on this tree are hired
      // into the SAME kind — the coder and the never-woken reviewer — so a
      // dispatch record read by kind alone cannot tell them apart, and BR-8's
      // whole claim is which of the two the row reached.
      return (children as Array<{ id: string; flowKind: string; flowId?: string }>).map(
        (child) => ({ sessionId: child.id, flowKind: child.flowKind, flowId: child.flowId }),
      );
    },

    inspect: async (seatId: string, inspectOptions?: { door?: "org-less" | "bearer" }) => {
      if (seatId in seats === false) throw new Error(`no seat "${seatId}" was hired`);

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
        // nothing either way.
        const segments = [seatId, `${inspectOptions.door}-${seatId}`, "actions", INSPECT_ENTRY];
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
    state,
    ledger,
    door,

    dispose: () => state.dispose(),
  };
}

/** One wording for whatever a refusal turns out to be. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
