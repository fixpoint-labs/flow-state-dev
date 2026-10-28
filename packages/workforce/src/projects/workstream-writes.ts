/**
 * The workstream writes: `openWorkstream` and `updateWorkstream`, as app
 * actions, and `updateWorkstream`, `editWorkstream` and `listLeads` as tools.
 *
 * **Opening one.** The caller names a project by its address, an id, a title
 * and a lead from their own roster: a worker on a lead flow that lists
 * delegates, since a lead runs its workstream through them (BR-42).
 * `listLeads` lists the ones that can. On a shared project only its members may
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
 * when it is (`project-coordinator.ts`). An open made in the owner's
 * coordinator's own turn, with its `openWorkstream` tool, writes the record
 * in that turn instead, since a dispatch into the session it runs in would
 * land after the turn, and the dispatch that follows would find no record
 * (BR-38). The coordinator holds at most
 * `MAX_DELEGATES` records, so an owner with that many open workstreams in a
 * project is refused another before anything is written (BR-21b).
 *
 * **A worker's open is checked for fit.** With `leadFit` set, the
 * `openWorkstreamTool` a worker calls asks the one fit check best fit also
 * routes by, after every other refusal and before anything is written, about
 * the chosen lead, and refuses `lead-doesnt-fit` only when it answers that
 * none fits (`lead-fit.ts`). Opening a workstream again is not checked: it was accepted
 * once. A user's `openWorkstream` action is their own pick and is not checked.
 * A check that can't answer lets the open through, and the tool's answer says
 * why in `leadFit`.
 *
 * **Updating one.** Only its owner writes an entry, and the engine enforces
 * that at the store whichever flow writes. The app's action writes the entry
 * its input names, the caller's own unless it names another owner, which the
 * store then refuses. The lead's tool writes the workstream its session
 * leads, read from the session's readonly `workstreamId`, so it only ever
 * reaches its own owner's entry. It takes no title: naming a workstream is
 * its owner's. The owner's project coordinator's tool,
 * `editWorkstream`, writes one of its user's workstreams by id, in the project
 * its conversation is linked to and no other. Each write is a compare-and-swap that
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
import type { RosterWorker, WorkerInstallation } from "../workers/installation";
import { WORKER_ID_STATE_KEY, WORKSTREAM_STATE_KEY } from "../workers/keys";
import { changeWorkstreamRecordHere, projectOfWrite, WORKSTREAM_DELEGATE_ACTION } from "./project-coordinator";
import { DONE_STATUS } from "./project-progress";
import { projectEntries } from "./project-read";
import { retryOnConflict } from "./cas-retry";
import { projectAddressSchema, type ProjectAddress } from "./collections";
import { defineLeadFitCheck, LEAD_FIT_STATE, leadFitCaseSchema, leadFitRecordSchema, leadFitStateSchema, type LeadFitCase } from "./lead-fit";
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
import { ALL_DELEGATES } from "../delegates/delegate-keys";

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
  /**
   * Check a worker's pick of lead against the work before its
   * `openWorkstreamTool` opens it, with the one fit check on this model (asked
   * again as a language model when the model serves no evaluations). Left out, the
   * tool opens with any lead that can lead.
   */
  leadFit?: { model: string };
}

/** What opening a workstream takes. Closed: nothing in it names the owner. */
export const openWorkstreamInputSchema = z
  .object({
    /**
     * The project's address: where it lives, and its id. Left out in a
     * conversation linked to a project (a project coordinator's), it is that
     * project, the only one such a conversation may open in.
     */
    project: projectAddressSchema.optional(),
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

/** What the lead list answers: each worker on the caller's roster that can lead, with what it does. */
export const listLeadsOutputSchema = z.object({
  leads: z.array(z.object({ id: z.string(), description: z.string().nullable() }))
});

/** @see listLeadsOutputSchema */
export type ListLeadsOutput = z.infer<typeof listLeadsOutputSchema>;

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

/**
 * What the lead's tool takes: the changes, but never a title. Its workstream is
 * the one its session leads. A workstream's name is its owner's, set at the
 * open and changed by the owner or their project coordinator: a lead of
 * several workstreams is handed each post with the coordinator conversation's
 * recent lines, which name the others, and with a title to write it could put
 * one's name on another.
 */
export const updateOwnWorkstreamInputSchema = z
  .object({ status: changesShape.status, due: changesShape.due, objectives: changesShape.objectives, report: changesShape.report })
  .strict();

/** @see updateOwnWorkstreamInputSchema */
export type UpdateOwnWorkstreamInput = z.infer<typeof updateOwnWorkstreamInputSchema>;

/**
 * What the coordinator's `editWorkstream` tool takes: one of the caller's own
 * workstreams, by id, and the changes. The latest report stays the lead's.
 * Left out, `project` is the one the conversation is linked to, the only one
 * such a conversation may change.
 */
export const editWorkstreamInputSchema = z
  .object({
    project: projectAddressSchema.optional(),
    id: z.string().min(1),
    title: changesShape.title,
    status: changesShape.status,
    due: changesShape.due,
    objectives: changesShape.objectives
  })
  .strict();

/** @see editWorkstreamInputSchema */
export type EditWorkstreamInput = z.infer<typeof editWorkstreamInputSchema>;

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
  /**
   * The workers on the caller's roster that can lead a workstream, read now:
   * their own workers (one a hire made counts) and the standard ones, each on
   * a lead flow and listing delegates. Give it to whoever picks a lead.
   */
  listLeadsTool: BlockDefinition<z.ZodObject<{}, "strict">, typeof listLeadsOutputSchema, Record<string, never>, ListLeadsOutput>;
  /**
   * `openWorkstream` for a worker to call: with `leadFit` set, it first asks
   * the one fit check about the lead, and refuses `lead-doesnt-fit` only when
   * it answers that none fits. Work that doesn't say what sort it is is never refused.
   * Without `leadFit`, it is `openWorkstream`.
   */
  openWorkstreamTool: BlockDefinition<
    typeof openWorkstreamInputSchema,
    z.ZodTypeAny,
    OpenWorkstreamInput,
    OpenWorkstreamOutput
  >;
  /** The lead's tool: updates the workstream its session leads. Give it to a lead's flow. */
  updateWorkstreamTool: BlockDefinition<
    typeof updateOwnWorkstreamInputSchema,
    typeof updateWorkstreamOutputSchema,
    UpdateOwnWorkstreamInput,
    UpdateWorkstreamOutput
  >;
  /**
   * The owner's tool: changes one of the caller's workstreams by id (its
   * title, status, due date or objectives), in the project the conversation
   * is linked to. Give it to a project coordinator.
   */
  editWorkstreamTool: BlockDefinition<
    typeof editWorkstreamInputSchema,
    typeof updateWorkstreamOutputSchema,
    EditWorkstreamInput,
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

/** What the check hands on: the open, its lead's flow, and the lead fit check's case, or none to judge. */
const checkedOpenSchema = z.object({
  open: openWorkstreamInputSchema,
  flow: z.string(),
  fitCase: leadFitCaseSchema.nullable()
});

type CheckedOpen = z.infer<typeof checkedOpenSchema>;

/** The refusal for an open naming another lead than the open workstream's. */
function leadDiffers(id: string, lead: string): ProjectRefusedError {
  return new ProjectRefusedError("lead-differs", `workstream "${id}" is already open, led by "${lead}". A workstream's lead doesn't change.`);
}

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
  const leadFlowNames = new Set(options.leadFlows.map((flow) => flow.kind));
  /**
   * Why a worker on the caller's roster can't lead, or `undefined` when it
   * can: it runs on a lead flow, and it lists delegates, since a lead runs its
   * workstream through them (BR-42).
   */
  const leadProblem = (worker: RosterWorker): string | undefined => {
    if (worker.problem !== undefined) return `can't lead a workstream: ${worker.problem}`;
    if (!leadFlowNames.has(worker.flow)) return `runs on flow "${worker.flow}", which can't lead a workstream`;
    // `all` is the whole roster, never empty: the lead itself is on it.
    if (worker.delegates !== ALL_DELEGATES && worker.delegates.length === 0) {
      return "lists no delegates, so it can't lead a workstream: a lead runs its workstream through its delegates";
    }
    return undefined;
  };
  const resources = { ...installation.resources, ...PROJECT_ROW_RESOURCES, ...WORKSTREAM_RESOURCES };

  /**
   * Check the open: everything that can refuse, short of the lead's fit, runs
   * here, before anything is written. Answers the open, its lead's flow, and
   * the fit check's case, or none when there is nothing to check: the
   * workstream is open already, or its lead has no description. Why there is
   * none is noted for the open's record.
   */
  const checkOpen = handler({
    name: "workstream-open-check",
    inputSchema: openWorkstreamInputSchema,
    outputSchema: checkedOpenSchema,
    resources,
    requestStateSchema: leadFitStateSchema,
    execute: async (input: OpenWorkstreamInput, ctx): Promise<CheckedOpen> => {
      const owner = ownerOf(ctx, "openWorkstream");
      assertWorkstreamId(input.id);
      const at = projectOfWrite(ctx.session.state, input.project, "open workstreams");
      const project = await projectAt(ctx, at);
      if (!isMember(project.state, owner)) {
        throw new ProjectRefusedError(
          "not-a-member",
          `only project "${at.id}"'s members may open workstreams in it.`
        );
      }
      const lead = await installation.rosterWorker(ctx, input.lead);
      if (lead === undefined) throw new ProjectRefusedError("no-such-worker", `No worker "${input.lead}" on your roster.`);
      if (lead.problem !== undefined) {
        throw new ProjectRefusedError("no-such-worker", `Worker "${input.lead}" can't lead a workstream: ${lead.problem}.`);
      }
      const cannotLead = leadProblem(lead);
      if (cannotLead !== undefined) throw new ProjectRefusedError("cannot-lead", `Worker "${input.lead}" ${cannotLead}.`);

      const entries = workstreamsAt(ctx, at.visibility);
      const key = workstreamEntryKey(at.id, owner, input.id);
      const held = await entries.getOptional(key);
      if (held !== undefined && held.state.lead !== input.lead) throw leadDiffers(input.id, held.state.lead);
      // Each open workstream is a record on the owner's coordinator, which
      // holds so many: refused before anything is written (BR-21b).
      if (installation.projectCoordinator() !== undefined && held === undefined) {
        const open = (await projectEntries(ctx, at)).filter(
          (held) => held.owner === owner && held.status !== DONE_STATUS
        );
        if (open.length >= MAX_DELEGATES) {
          throw new ProjectRefusedError(
            "too-many-workstreams",
            `you have ${open.length} open workstreams in project "${at.id}", and your project ` +
              `coordinator holds at most ${MAX_DELEGATES} delegates, one for each. Mark one done first.`
          );
        }
      }
      const unchecked = held !== undefined ? "already-open" : lead.description === null ? "no-description" : undefined;
      if (unchecked !== undefined) await ctx.request.patchState({ [LEAD_FIT_STATE]: { checked: false, why: unchecked } });
      const fitCase: LeadFitCase | null =
        unchecked === undefined
          ? { lead: input.lead, description: lead.description!, title: input.title, objectives: input.objectives ?? [] }
          : null;
      return { open: input, flow: lead.flow, fitCase };
    }
  });

  /** Make the entry or find it, and say whether the lead's session is still to be created. */
  const makeOpen = handler({
    name: "workstream-open-make",
    inputSchema: checkedOpenSchema,
    outputSchema: openStepSchema,
    resources,
    requestStateSchema: openingStateSchema,
    execute: async ({ open: input, flow }: CheckedOpen, ctx): Promise<OpenStep> => {
      const owner = ownerOf(ctx, "openWorkstream");
      const at = projectOfWrite(ctx.session.state, input.project, "open workstreams");
      const address: WorkstreamAddress = { project: at, id: input.id };
      const entries = workstreamsAt(ctx, at.visibility);
      const key = workstreamEntryKey(at.id, owner, input.id);
      const now = nowIso();
      const fresh: Omit<WorkstreamEntry, "writtenBy"> = {
        title: input.title,
        lead: input.lead,
        sessionId: null,
        status: "on-track",
        due: input.due ?? null,
        objectives: (input.objectives ?? []).map((text) => ({ text, met: false, metAt: null, metBy: null })),
        openedAt: now,
        updatedAt: now
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
      // Another open may have made it since the check.
      if (!opened && entry.state.lead !== input.lead) throw leadDiffers(input.id, entry.state.lead);
      const needsSession = entry.state.sessionId == null && !(await sessionNamedSoon(entry, opened));
      const opening: Opening = { address, owner, lead: input.lead, flow, opened, needsSession };
      await ctx.request.patchState({ [OPENING_STATE]: opening });
      return { needsSession, flow, lead: input.lead, ref: workstreamRef(address) };
    }
  });

  /** One dispatcher per lead flow: creates the lead's session, linked at create, and runs nothing. */
  const openSessionOn = (flow: string) =>
    dispatcher({
      name: `workstream-open-session-${flow}`,
      flowKind: flow,
      action: WORKSTREAM_OPENED_ENTRY,
      inputSchema: openStepSchema,
      session: {
        key: (step: OpenStep) => `workstream:${step.ref}`,
        state: (step: OpenStep) => ({ [WORKER_ID_STATE_KEY]: step.lead, [WORKSTREAM_STATE_KEY]: step.ref })
      },
      payload: () => ({})
    });
  const dispatchers = new Map([...leadFlowNames].map((flow) => [flow, openSessionOn(flow)] as const));
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
    ctx: WriteContext,
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
    const record = { change: change as RecordChange["change"], worker: workstream.lead, target: workstreamRef({ project: workstream.project, id: workstream.id }) };
    // Written from the owner's coordinator's own turn: the record lands in this
    // turn, so the dispatch after it finds it (BR-38). Only an open, whose lead
    // was just checked, or a removal, which needs no check: re-adding a
    // reopened workstream's record goes through the checked entry, since its
    // lead may have left the roster since.
    const here = before === undefined || change === "remove";
    if (here && coordinatorSessionId === (ctx.session.identity as { id?: string }).id) {
      await changeWorkstreamRecordHere(ctx as never, record, options.installation);
      return undefined;
    }
    return { ...record, coordinatorSessionId };
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
    resources: WORKSTREAM_RESOURCES,
    inputSchema: openWorkstreamOutputSchema,
    outputSchema: openWorkstreamOutputSchema.extend({ record: recordChangeSchema.optional() }),
    execute: async (out: OpenWorkstreamOutput, ctx) => {
      const record = await recordFor(ctx, out.workstream, undefined);
      return record === undefined ? out : { ...out, record };
    }
  });

  /**
   * The open's steps. A worker's open (`checksFit`) runs the lead fit check
   * between the check and the write, unless the check found nothing to judge,
   * and answers what became of it as `leadFit`.
   */
  const openWith = (name: string, fitCheck?: ReturnType<typeof defineLeadFitCheck>) => {
    const checked = sequencer({
      name,
      inputSchema: openWorkstreamInputSchema,
      outputSchema: fitCheck === undefined ? openWorkstreamOutputSchema : openWorkstreamOutputSchema.extend({ leadFit: leadFitRecordSchema })
    }).step(checkOpen);
    const steps = (
      fitCheck === undefined
        ? checked
        : checked.tapIf((step: CheckedOpen) => step.fitCase !== null, (step: CheckedOpen) => step.fitCase!, fitCheck)
    )
      .step(makeOpen)
      .stepIf((step: OpenStep) => step.needsSession, createSession)
      .step(finishOpen);
    const recorded =
      changeRecord === undefined
        ? steps
        : steps
            .step(recordOpen)
            .tapIf((out: { record?: RecordChange }) => out.record !== undefined, (out: { record?: RecordChange }) => out.record!, changeRecord)
            .map(({ workstream, opened }: OpenWorkstreamOutput) => ({ workstream, opened }));
    return fitCheck === undefined ? recorded : recorded.step(withFitRecord);
  };

  /** A worker's open answers what became of its lead fit check. */
  const withFitRecord = handler({
    name: "workstream-open-fit-record",
    inputSchema: openWorkstreamOutputSchema,
    outputSchema: openWorkstreamOutputSchema.extend({ leadFit: leadFitRecordSchema }),
    requestStateSchema: leadFitStateSchema,
    execute: (out: OpenWorkstreamOutput, ctx) => ({
      ...out,
      leadFit: ctx.request.state[LEAD_FIT_STATE] ?? { checked: false, why: "not-asked" }
    })
  });

  const openWorkstream = openWith("open-workstream");
  const openWorkstreamTool =
    options.leadFit === undefined ? openWorkstream : openWith("open-workstream-checked", defineLeadFitCheck(options.leadFit.model));


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

  const editFromCoordinator = handler({
    name: "workstream-edit-write",
    inputSchema: editWorkstreamInputSchema,
    outputSchema: updatedStepSchema,
    resources: WORKSTREAM_RESOURCES,
    execute: async (input: EditWorkstreamInput, ctx): Promise<UpdatedStep> => {
      const { project, id, ...changes } = input;
      const at = projectOfWrite(ctx.session.state, project, "change workstreams");
      const written = await updateEntry(ctx, { project: at, id }, ownerOf(ctx, "editWorkstream"), changes);
      const record = await recordFor(ctx, written.workstream, written.before);
      return { workstream: written.workstream, ...(record === undefined ? {} : { record }) };
    }
  });
  const editWorkstreamTool = withRecord(
    "editWorkstream",
    editFromCoordinator,
    "Change one of the user's own workstreams in this project, by its id: its title, status (\"done\" closes it), " +
      "due date (YYYY-MM-DD, or null to clear it) or objectives (the whole list, each met or not). What you leave out stays. " +
      "Leave `project` out. Nobody else's workstream can be changed."
  );

  const listLeadsTool = handler({
    name: "listLeads",
    description:
      "List the workers on the user's roster that can lead a workstream: each one's id and what it does. " +
      "Pick a workstream's lead from this, by the work its description says it does, never from memory.",
    inputSchema: z.object({}).strict(),
    outputSchema: listLeadsOutputSchema,
    resources: installation.resources,
    execute: async (_input, ctx): Promise<ListLeadsOutput> => ({
      leads: (await installation.roster(ctx))
        .filter((worker) => leadProblem(worker) === undefined)
        .map((worker) => ({ id: worker.id, description: worker.description }))
    })
  });

  return {
    openWorkstream,
    openWorkstreamTool: openWorkstreamTool as WorkstreamBlocks["openWorkstreamTool"],
    updateWorkstream,
    listLeadsTool,
    updateWorkstreamTool,
    editWorkstreamTool,
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
