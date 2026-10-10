/**
 * The workstream writes: `openWorkstream` and `updateWorkstream`, as app
 * actions, and `updateWorkstream` as a tool for a workstream's lead.
 *
 * **Opening one.** The caller names a project by its address, an id, a title
 * and a lead from their own roster. On a shared project only its members may
 * open one. The entry is the caller's: keyed by their owner segment, so no one
 * else can write it (`workstream-collections.ts`). Then the lead's workstream
 * session is created, the caller's, naming the lead as its worker and the
 * workstream as its `workstreamId`, which the lead flow's create check links
 * at create; its id is written onto the entry.
 *
 * **One entry, one session.** The entry is created with `create`, so of two
 * opens of one workstream at once one makes it. The other finds the entry and
 * waits briefly for its session to be named on it. Opening a workstream again
 * hands the entry back, and finishes an open that made the entry but never
 * named its session. Its lead doesn't change: an open naming another lead is
 * refused.
 *
 * **Its project coordinator's record** (FIX-1793 BR-21a). When the
 * installation names a project coordinator, each open workstream is one
 * delegate record on its owner's coordinator for the project: the lead, with
 * the workstream's address as its target. An open (and opening it again)
 * adds the record, marking it done removes it, and moving it back out of
 * done adds it again, each by dispatching the coordinator's internal
 * `changeWorkstreamDelegate` into the owner's coordinator session, found at
 * the id derived for it. A coordinator not yet created takes its records
 * when it is (`project-coordinator.ts`). The coordinator holds at most
 * `MAX_DELEGATES` records, so an owner with that many open workstreams in a
 * project is refused another before anything is written (BR-21b).
 *
 * **Updating one.** Only its owner writes an entry, and the engine enforces
 * that at the store whichever flow writes. The app's action writes the entry
 * its input names, the caller's own unless it names another owner, which the
 * store then refuses. The lead's tool writes the workstream its session
 * leads, read from the session's readonly `workstreamId`, so it only ever
 * reaches its own owner's entry. Each write is a compare-and-swap that
 * recomputes on retry, stamps `writtenBy` from the session and sets
 * `updatedAt` from the server's clock. Nothing deletes an entry; done is a
 * status.
 */

import { dispatcher, dispatchHandleSchema, handler, router, sequencer } from "@flow-state-dev/core";
import { updateStateWith } from "@flow-state-dev/core/helpers";
import { DispatchRefusedError, type ActionConfig, type BlockDefinition, type ResourceRef } from "@flow-state-dev/core/types";
import { z } from "zod";
import { MAX_DELEGATES } from "../delegates/delegate-keys";
import { withWrittenBy, type SharedWriteContext } from "../shared-resource";
import { deriveWorkerSessionId } from "../workers/derive-session-id";
import type { WorkerInstallation } from "../workers/installation";
import { WORKER_ID_STATE_KEY, WORKSTREAM_STATE_KEY } from "../workers/keys";
import { WORKSTREAM_DELEGATE_ACTION } from "./project-coordinator";
import { DONE_STATUS } from "./project-progress";
import { projectEntries } from "./project-read";
import { retryOnConflict } from "./cas-retry";
import { projectAddressSchema } from "./collections";
import { isMember } from "./membership-gate";
import { projectAt, PROJECT_ROW_RESOURCES, workstreamsAt, type ResourcesContext } from "./project-address";
import { ProjectRefusedError } from "./project-refusal";
import { isAlreadyExists } from "./store-errors";
import {
  WORKSTREAM_RESOURCES,
  workstreamDueSchema,
  workstreamEntryKey,
  workstreamEntrySchema,
  workstreamIdProblem,
  workstreamStatusSchema,
  workstreamViewSchema,
  type WorkstreamEntry,
  type WorkstreamObjective,
  type WorkstreamView
} from "./workstream-collections";
import { leadsWorkstreams, WORKSTREAM_OPENED_ENTRY } from "./workstream-lead";
import { parseWorkstreamRef, workstreamRef, type WorkstreamAddress } from "./workstream-ref";

/** What a write hands on for its coordinator's record: none, or the change and the record. */
const recordChangeSchema = z.object({
  change: z.enum(["add", "remove"]),
  worker: z.string(),
  target: z.string(),
  /** The owner's coordinator session for the project, at the id derived for it. */
  coordinatorSessionId: z.string()
});

type RecordChange = z.infer<typeof recordChangeSchema>;

/** A write's own output, with the change its coordinator's record takes, when it takes one. */
const updatedStepSchema = z.object({ workstream: workstreamViewSchema, record: recordChangeSchema.optional() });

type UpdatedStep = z.infer<typeof updatedStepSchema>;

/** What the workstream blocks are built from. */
export interface WorkstreamBlocksOptions {
  /** The worker installation the leads belong to: a lead is a worker on the caller's roster. */
  installation: WorkerInstallation;
  /**
   * The worker flows a lead can run on. Each declares the internal
   * `onWorkstreamOpened` entry (`workstreamOpenedEntry()`), as the built-in
   * `agent` flow does. A worker on any other flow is refused as a lead.
   */
  leadFlows: readonly { readonly kind: string }[];
}

/** What opening a workstream takes. Closed: nothing in it names the owner. */
export const openWorkstreamInputSchema = z
  .object({
    /** The project's address: where it lives, and its id. */
    project: projectAddressSchema,
    /** The workstream's id: one path segment, unique in the project for its owner. */
    id: z.string().min(1),
    title: z.string().min(1),
    /** The worker that leads it: one on the caller's roster, on a flow that can lead. */
    lead: z.string().min(1),
    /** When it is due, `YYYY-MM-DD`, or none. */
    due: workstreamDueSchema.nullable().optional(),
    /** What it sets out to do, each one unmet to begin with. */
    objectives: z.array(z.string().min(1)).optional()
  })
  .strict();

/** @see openWorkstreamInputSchema */
export type OpenWorkstreamInput = z.infer<typeof openWorkstreamInputSchema>;

/** What opening a workstream returns: the entry, and whether this call made it. */
export const openWorkstreamOutputSchema = z.object({
  workstream: workstreamViewSchema,
  /** `false` when the workstream was already open: the entry is handed back. */
  opened: z.boolean()
});

/** @see openWorkstreamOutputSchema */
export type OpenWorkstreamOutput = z.infer<typeof openWorkstreamOutputSchema>;

/** What a change to an entry can set. Every field is optional; what is left out stays. */
const changesShape = {
  title: z.string().min(1).optional(),
  status: workstreamStatusSchema.optional(),
  due: workstreamDueSchema.nullable().optional(),
  /**
   * The whole list of objectives, each met or not. An objective met before
   * keeps when and by whom it was met; one met by this write is stamped now,
   * by this session.
   */
  objectives: z.array(z.object({ text: z.string().min(1), met: z.boolean() }).strict()).optional(),
  /** The latest report: the entry's content. */
  report: z.string().optional()
};

/**
 * What updating a workstream from the app takes: the entry's place (its
 * project's address, its owner and its id), and the changes. `owner` defaults
 * to the caller. Naming anyone else addresses their entry, and the store
 * refuses the write by the owner rule.
 */
export const updateWorkstreamInputSchema = z
  .object({ project: projectAddressSchema, owner: z.string().min(1).optional(), id: z.string().min(1), ...changesShape })
  .strict();

/** @see updateWorkstreamInputSchema */
export type UpdateWorkstreamInput = z.infer<typeof updateWorkstreamInputSchema>;

/** What the lead's tool takes: the changes. Its workstream is the one its session leads. */
export const updateOwnWorkstreamInputSchema = z.object(changesShape).strict();

/** @see updateOwnWorkstreamInputSchema */
export type UpdateOwnWorkstreamInput = z.infer<typeof updateOwnWorkstreamInputSchema>;

/** What an update returns: the entry as written. */
export const updateWorkstreamOutputSchema = z.object({ workstream: workstreamViewSchema });

/** @see updateWorkstreamOutputSchema */
export type UpdateWorkstreamOutput = z.infer<typeof updateWorkstreamOutputSchema>;

/** The workstream writes, and the same blocks as an `actions` map and a tool. */
export type WorkstreamBlocks = {
  openWorkstream: BlockDefinition<
    typeof openWorkstreamInputSchema,
    typeof openWorkstreamOutputSchema,
    OpenWorkstreamInput,
    OpenWorkstreamOutput
  >;
  updateWorkstream: BlockDefinition<
    typeof updateWorkstreamInputSchema,
    typeof updateWorkstreamOutputSchema,
    UpdateWorkstreamInput,
    UpdateWorkstreamOutput
  >;
  /** The lead's tool: updates the workstream its session leads. Give it to a lead's flow. */
  updateWorkstreamTool: BlockDefinition<
    typeof updateOwnWorkstreamInputSchema,
    typeof updateWorkstreamOutputSchema,
    UpdateOwnWorkstreamInput,
    UpdateWorkstreamOutput
  >;
  actions: {
    openWorkstream: ActionConfig;
    updateWorkstream: ActionConfig;
  };
};

/** How long an open that found another open's entry waits for that open to name its session. */
const SESSION_WAIT_ATTEMPTS = 40;
const SESSION_WAIT_MS = 50;

const nowIso = () => new Date().toISOString();

/** What a write reads off its block's context: the session's user, and the entries it declared. */
type WriteContext = ResourcesContext & Pick<SharedWriteContext, "session">;

/** The caller: the session's user, as the engine recorded it. */
function ownerOf(ctx: Pick<SharedWriteContext, "session">, what: string): string {
  const owner = ctx.session.identity.userId;
  if (owner === undefined || owner.length === 0) {
    throw new Error(`${what} needs a session with an owner: a workstream is its session's user's.`);
  }
  return owner;
}

/** An entry as the writes answer it. */
function viewOf(address: WorkstreamAddress, owner: string, state: unknown): WorkstreamView {
  return { ...workstreamEntrySchema.parse(state), project: address.project, id: address.id, owner };
}

/** Refuse an id no entry can be keyed by. */
function assertWorkstreamId(id: string): void {
  const problem = workstreamIdProblem(id);
  if (problem !== undefined) throw new ProjectRefusedError("invalid-workstream-id", `${problem}.`);
}

/** Request state: the open in progress, from the step that checked it to the step that finishes it. */
const OPENING_STATE = "openingWorkstream";

const openingSchema = z.object({
  address: z.object({ project: projectAddressSchema, id: z.string() }),
  owner: z.string(),
  lead: z.string(),
  /** The flow the lead runs on, which its session is created on. */
  flow: z.string(),
  /** Whether this call made the entry. */
  opened: z.boolean(),
  /** Whether the entry still needs its session. */
  needsSession: z.boolean()
});

type Opening = z.infer<typeof openingSchema>;

const openingStateSchema = z.object({ [OPENING_STATE]: openingSchema.optional() });

/** What the check step hands on: enough to dispatch the lead's session, when it needs one. */
const openStepSchema = z.object({
  needsSession: z.boolean(),
  flow: z.string(),
  lead: z.string(),
  ref: z.string()
});

type OpenStep = z.infer<typeof openStepSchema>;

/**
 * Build the workstream writes.
 *
 * @throws When a lead flow declares no `onWorkstreamOpened` entry.
 * @example
 *   const workstreams = defineWorkstreamBlocks({ installation, leadFlows: [agentFlow] });
 *   defineFlow({ kind: "projects", actions: { ...projects.actions, ...workstreams.actions } });
 */
export function defineWorkstreamBlocks(options: WorkstreamBlocksOptions): WorkstreamBlocks {
  const { installation } = options;
  for (const flow of options.leadFlows) {
    if (!leadsWorkstreams(flow)) {
      throw new Error(
        `defineWorkstreamBlocks: lead flow "${flow.kind}" declares no internal "${WORKSTREAM_OPENED_ENTRY}" entry, ` +
          `so a worker on it couldn't lead a workstream. Declare it with workstreamOpenedEntry().`
      );
    }
  }
  const leadFlowKinds = new Set(options.leadFlows.map((flow) => flow.kind));
  const resources = { ...installation.resources, ...PROJECT_ROW_RESOURCES, ...WORKSTREAM_RESOURCES };

  /**
   * Check the open, and make the entry or find it: everything that can refuse
   * runs before anything is written.
   */
  const checkOpen = handler({
    name: "workstream-open-check",
    inputSchema: openWorkstreamInputSchema,
    outputSchema: openStepSchema,
    resources,
    requestStateSchema: openingStateSchema,
    execute: async (input: OpenWorkstreamInput, ctx): Promise<OpenStep> => {
      const owner = ownerOf(ctx, "openWorkstream");
      assertWorkstreamId(input.id);
      const project = await projectAt(ctx, input.project);
      if (!isMember(project.state, owner)) {
        throw new ProjectRefusedError(
          "not-a-member",
          `only project "${input.project.id}"'s members may open workstreams in it.`
        );
      }
      const lead = await installation.rosterWorker(ctx, input.lead);
      if (lead === undefined) throw new ProjectRefusedError("no-such-worker", `No worker "${input.lead}" on your roster.`);
      if (lead.problem !== undefined) {
        throw new ProjectRefusedError("no-such-worker", `Worker "${input.lead}" can't lead a workstream: ${lead.problem}.`);
      }
      if (!leadFlowKinds.has(lead.flow)) {
        throw new ProjectRefusedError(
          "cannot-lead",
          `Worker "${input.lead}" runs on flow "${lead.flow}", which can't lead a workstream.`
        );
      }

      const address: WorkstreamAddress = { project: input.project, id: input.id };
      const entries = workstreamsAt(ctx, input.project.visibility);
      const key = workstreamEntryKey(input.project.id, owner, input.id);
      // Each open workstream is a record on the owner's coordinator, which
      // holds so many: refused before anything is written (BR-21b).
      if (installation.projectCoordinator() !== undefined && (await entries.getOptional(key)) === undefined) {
        const open = (await projectEntries(ctx, input.project)).filter(
          (held) => held.owner === owner && held.status !== DONE_STATUS
        );
        if (open.length >= MAX_DELEGATES) {
          throw new ProjectRefusedError(
            "too-many-workstreams",
            `you have ${open.length} open workstreams in project "${input.project.id}", and your project ` +
              `coordinator holds at most ${MAX_DELEGATES} delegates, one for each. Mark one done first.`
          );
        }
      }
      const at = nowIso();
      const fresh: Omit<WorkstreamEntry, "writtenBy"> = {
        title: input.title,
        lead: input.lead,
        sessionId: null,
        status: "on-track",
        due: input.due ?? null,
        objectives: (input.objectives ?? []).map((text) => ({ text, met: false, metAt: null, metBy: null })),
        openedAt: at,
        updatedAt: at
      };
      let opened = false;
      let entry: ResourceRef<WorkstreamEntry> | undefined = await entries.getOptional(key);
      if (entry === undefined) {
        try {
          entry = await entries.create(key, withWrittenBy(ctx, fresh));
          opened = true;
        } catch (error) {
          if (!isAlreadyExists(error)) throw error;
          entry = await entries.getOptional(key);
          if (entry === undefined) throw error;
        }
      }
      if (!opened && entry.state.lead !== input.lead) {
        throw new ProjectRefusedError(
          "lead-differs",
          `workstream "${input.id}" is already open, led by "${entry.state.lead}". A workstream's lead doesn't change.`
        );
      }
      const needsSession = entry.state.sessionId == null && !(await sessionNamedSoon(entry, opened));
      const opening: Opening = { address, owner, lead: input.lead, flow: lead.flow, opened, needsSession };
      await ctx.request.patchState({ [OPENING_STATE]: opening });
      return { needsSession, flow: lead.flow, lead: input.lead, ref: workstreamRef(address) };
    }
  });

  /** One dispatcher per lead flow: creates the lead's session, linked at create, and runs nothing. */
  const openSessionOn = (kind: string) =>
    dispatcher({
      name: `workstream-open-session-${kind}`,
      flowKind: kind,
      action: WORKSTREAM_OPENED_ENTRY,
      inputSchema: openStepSchema,
      session: {
        key: (step: OpenStep) => `workstream:${step.ref}`,
        state: (step: OpenStep) => ({ [WORKER_ID_STATE_KEY]: step.lead, [WORKSTREAM_STATE_KEY]: step.ref })
      },
      payload: () => ({})
    });
  const dispatchers = new Map([...leadFlowKinds].map((kind) => [kind, openSessionOn(kind)] as const));
  const createSession = router({
    name: "workstream-open-session",
    inputSchema: openStepSchema,
    routes: [...dispatchers.values()],
    execute: (step: OpenStep) => {
      const route = dispatchers.get(step.flow);
      if (route === undefined) throw new Error(`No workstream session can be created on flow "${step.flow}".`);
      return route;
    }
  });

  /** Name the session on the entry, unless another open named one first, and answer the entry. */
  const finishOpen = handler({
    name: "workstream-open-finish",
    inputSchema: z.unknown(),
    outputSchema: openWorkstreamOutputSchema,
    resources,
    requestStateSchema: openingStateSchema,
    execute: async (value: unknown, ctx): Promise<OpenWorkstreamOutput> => {
      const opening = ctx.request.state[OPENING_STATE];
      if (opening === undefined) throw new Error("No workstream is being opened in this request.");
      const { address, owner } = opening;
      const entries = workstreamsAt(ctx, address.project.visibility);
      const entry = await entries.get(workstreamEntryKey(address.project.id, owner, address.id));
      const handle = dispatchHandleSchema.safeParse(value);
      if (opening.needsSession && handle.success) {
        await retryOnConflict(() =>
          entry.updateState((state) =>
            state.sessionId == null
              ? withWrittenBy(ctx, { ...state, sessionId: handle.data.sessionId, updatedAt: nowIso() })
              : state
          )
        );
      }
      return { workstream: viewOf(address, owner, entry.state), opened: opening.opened };
    }
  });

  // --- the coordinator's record -------------------------------------------

  const coordinator = installation.projectCoordinator();

  /**
   * The change the owner's coordinator record takes for `workstream`, now
   * that it reads `status` and read `before` it, or none: an open workstream
   * is a record, a done one isn't. `before` is `undefined` for an open.
   */
  const recordFor = async (
    ctx: Pick<SharedWriteContext, "session">,
    workstream: WorkstreamView,
    before: string | undefined
  ): Promise<RecordChange | undefined> => {
    if (coordinator === undefined) return undefined;
    const done = workstream.status === DONE_STATUS;
    const change = before === undefined ? (done ? undefined : "add") : before === DONE_STATUS ? (done ? undefined : "add") : done ? "remove" : undefined;
    if (change === undefined) return undefined;
    const orgId = (ctx.session.identity as { orgId?: string }).orgId;
    if (orgId === undefined) throw new Error("A workstream's write needs a session in an organization, to find its project coordinator.");
    const coordinatorSessionId = await deriveWorkerSessionId({
      userId: workstream.owner,
      orgId,
      flow: coordinator.flow,
      criteria: { worker: coordinator.worker, projectId: workstream.project }
    });
    return {
      change,
      worker: workstream.lead,
      target: workstreamRef({ project: workstream.project, id: workstream.id }),
      coordinatorSessionId
    };
  };

  /** A coordinator not created yet has nothing to change: it takes its records when it is. */
  const noCoordinatorYet = handler({
    name: "workstream-record-no-coordinator",
    inputSchema: z.unknown(),
    outputSchema: z.object({}),
    execute: (error: unknown) => {
      if (error instanceof DispatchRefusedError && error.refused === "session-not-found") return {};
      throw error;
    }
  });

  /** Add or remove the record on the owner's coordinator session, which runs the one delegate path. */
  const changeRecord =
    coordinator === undefined
      ? undefined
      : dispatcher({
          name: "workstream-record-change",
          flowKind: coordinator.flow,
          action: WORKSTREAM_DELEGATE_ACTION,
          inputSchema: recordChangeSchema,
          session: { id: (step: RecordChange) => step.coordinatorSessionId },
          payload: (step: RecordChange) => ({ change: step.change, worker: step.worker, target: step.target })
        }).rescue([{ block: noCoordinatorYet }]);

  /** Hand a write's record change, when it has one, to the owner's coordinator; answer the entry. */
  const withRecord = (name: string, write: BlockDefinition<any, any>, description?: string) => {
    const steps = sequencer({
      name,
      ...(description === undefined ? {} : { description }),
      inputSchema: write.inputSchema,
      outputSchema: updateWorkstreamOutputSchema
    }).step(write);
    return (
      changeRecord === undefined
        ? steps
        : steps.tapIf((step: UpdatedStep) => step.record !== undefined, (step: UpdatedStep) => step.record!, changeRecord)
    ).map((step: UpdatedStep) => ({ workstream: step.workstream }));
  };

  /** An open's answer, with the record change it hands the owner's coordinator. */
  const recordOpen = handler({
    name: "workstream-open-record",
    inputSchema: openWorkstreamOutputSchema,
    outputSchema: openWorkstreamOutputSchema.extend({ record: recordChangeSchema.optional() }),
    execute: async (out: OpenWorkstreamOutput, ctx) => {
      const record = await recordFor(ctx, out.workstream, undefined);
      return record === undefined ? out : { ...out, record };
    }
  });

  const openSteps = sequencer({
    name: "open-workstream",
    inputSchema: openWorkstreamInputSchema,
    outputSchema: openWorkstreamOutputSchema
  })
    .step(checkOpen)
    .stepIf((step: OpenStep) => step.needsSession, createSession)
    .step(finishOpen);
  const openWorkstream =
    changeRecord === undefined
      ? openSteps
      : openSteps
          .step(recordOpen)
          .tapIf((out: { record?: RecordChange }) => out.record !== undefined, (out: { record?: RecordChange }) => out.record!, changeRecord)
          .map(({ workstream, opened }: OpenWorkstreamOutput) => ({ workstream, opened }));

  const updateFromApp = handler({
    name: "workstream-update-write",
    inputSchema: updateWorkstreamInputSchema,
    outputSchema: updatedStepSchema,
    resources: WORKSTREAM_RESOURCES,
    execute: async (input: UpdateWorkstreamInput, ctx): Promise<UpdatedStep> => {
      const { project, id, owner, ...changes } = input;
      const written = await updateEntry(ctx, { project, id }, owner ?? ownerOf(ctx, "updateWorkstream"), changes);
      const record = await recordFor(ctx, written.workstream, written.before);
      return { workstream: written.workstream, ...(record === undefined ? {} : { record }) };
    }
  });
  const updateWorkstream = withRecord("workstream-update", updateFromApp);

  const updateFromLead = handler({
    name: "workstream-update-own-write",
    inputSchema: updateOwnWorkstreamInputSchema,
    outputSchema: updatedStepSchema,
    resources: WORKSTREAM_RESOURCES,
    execute: async (changes, ctx): Promise<UpdatedStep> => {
      const ref = ctx.session.state[WORKSTREAM_STATE_KEY];
      const address = typeof ref === "string" ? parseWorkstreamRef(ref) : undefined;
      if (address === undefined) {
        throw new ProjectRefusedError("not-a-workstream-session", "this session leads no workstream, so there is none to update.");
      }
      const written = await updateEntry(ctx, address, ownerOf(ctx, "updateWorkstream"), changes);
      const record = await recordFor(ctx, written.workstream, written.before);
      return { workstream: written.workstream, ...(record === undefined ? {} : { record }) };
    }
  });
  const updateWorkstreamTool = withRecord(
    "updateWorkstream",
    updateFromLead,
    "Update the workstream you lead: its status (a short label in your own words; \"done\" marks it finished), due date, objectives (the whole list, each met or not) and your latest report. Every reader of the project sees it."
  );

  return {
    openWorkstream,
    updateWorkstream,
    updateWorkstreamTool,
    actions: {
      openWorkstream: {
        block: openWorkstream,
        description:
          "Open a workstream the caller owns in a project, led by a worker on their roster, and start the lead's workstream session. On a shared project, members only."
      },
      updateWorkstream: {
        block: updateWorkstream,
        description:
          "Update a workstream the caller owns: its title, status, due date, objectives or latest report. Nobody else's entry can be written."
      }
    }
  };
}

/**
 * Wait for another open to name the entry's session: an entry this call found
 * rather than made, with no session yet, is usually an open still in flight.
 * Gives up after a short wait, so an open that made the entry and died before
 * creating its session is finished by this one.
 */
async function sessionNamedSoon(entry: ResourceRef<WorkstreamEntry>, opened: boolean): Promise<boolean> {
  if (opened) return false;
  for (let attempt = 0; attempt < SESSION_WAIT_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, SESSION_WAIT_MS));
    // A no-op write re-reads the stored entry and takes it when it moved.
    await retryOnConflict(() => entry.updateState((state) => state));
    if (entry.state.sessionId != null) return true;
  }
  return false;
}

/** The objectives after a change: met ones keep when and by whom; ones met now are stamped. */
function nextObjectives(
  before: readonly WorkstreamObjective[],
  after: readonly { text: string; met: boolean }[],
  at: string,
  by: WorkstreamObjective["metBy"]
): WorkstreamObjective[] {
  return after.map(({ text, met }) => {
    if (!met) return { text, met: false, metAt: null, metBy: null };
    const kept = before.find((objective) => objective.text === text && objective.met);
    return kept ?? { text, met: true, metAt: at, metBy: by };
  });
}

/**
 * Write `owner`'s entry: a compare-and-swap that recomputes on retry, then the
 * report as its content. Nothing here checks who the caller is: the owner rule
 * at the store refuses a write to anyone else's entry, whichever path asks.
 */
async function updateEntry(
  ctx: WriteContext,
  address: WorkstreamAddress,
  owner: string,
  changes: Omit<UpdateWorkstreamInput, "project" | "id" | "owner">
): Promise<{ workstream: WorkstreamView; before: string }> {
  assertWorkstreamId(address.id);
  const entries = workstreamsAt(ctx, address.project.visibility);
  const entry = await entries.getOptional(workstreamEntryKey(address.project.id, owner, address.id));
  if (entry === undefined) {
    throw new ProjectRefusedError(
      "no-such-workstream",
      `"${owner}" has no workstream "${address.id}" in project "${address.project.id}".`
    );
  }
  const { report, objectives, ...fields } = changes;
  // The status the write that landed replaced, as that write's own outcome:
  // each retry recomputes from the state it is handed.
  const before =
    (await retryOnConflict(() =>
      updateStateWith(entry, (state) => {
        const at = nowIso();
        const signed = withWrittenBy(ctx, {});
        return {
          state: withWrittenBy(ctx, {
            ...state,
            ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
            ...(objectives === undefined ? {} : { objectives: nextObjectives(state.objectives, objectives, at, signed.writtenBy) }),
            updatedAt: at
          }),
          result: state.status
        };
      })
    )) ?? entry.state.status;
  if (report !== undefined) await entry.writeContent(report);
  return { workstream: viewOf(address, owner, entry.state), before };
}
