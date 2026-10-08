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
 * **Updating one.** Only its owner writes an entry, and the engine enforces
 * that at the store whichever flow writes. The app's action and the lead's
 * tool both write the caller's own entry: the action by the address it is
 * given, the tool by the workstream its session leads, read from the
 * session's readonly `workstreamId`. Each write is a compare-and-swap that
 * recomputes on retry, stamps `writtenBy` from the session and sets
 * `updatedAt` from the server's clock. Nothing deletes an entry; done is a
 * status.
 */

import { dispatcher, dispatchHandleSchema, handler, router, sequencer } from "@flow-state-dev/core";
import type { BlockContext, BlockDefinition, ResourceCollectionRef, ResourceRef } from "@flow-state-dev/core/types";
import { z } from "zod";
import { withWrittenBy } from "../shared-resource";
import type { WorkerInstallation } from "../workers/installation";
import { WORKER_ID_STATE_KEY, WORKSTREAM_STATE_KEY } from "../workers/keys";
import { retryOnConflict } from "./cas-retry";
import { projectAddressSchema, type ProjectAddress } from "./collections";
import { isMember } from "./membership-gate";
import { projectAt, PROJECT_ROW_RESOURCES } from "./project-address";
import { ProjectRefusedError } from "./project-refusal";
import { isAlreadyExists } from "./store-errors";
import {
  WORKSTREAM_RESOURCES,
  workstreamDueSchema,
  workstreamEntryKey,
  workstreamEntrySchema,
  workstreamIdProblem,
  workstreamsAccessor,
  workstreamStatusSchema,
  type WorkstreamEntry,
  type WorkstreamObjective
} from "./workstream-collections";
import { leadsWorkstreams, WORKSTREAM_OPENED_ENTRY } from "./workstream-lead";
import { parseWorkstreamRef, workstreamRef, type WorkstreamAddress } from "./workstream-ref";

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

/** One workstream as the writes answer it: its entry, with its project, its owner and its id. */
export const workstreamViewSchema = workstreamEntrySchema.extend({
  project: projectAddressSchema,
  id: z.string(),
  owner: z.string()
});

/** @see workstreamViewSchema */
export type WorkstreamView = z.infer<typeof workstreamViewSchema>;

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

/** What updating a workstream from the app takes: its address, and the changes. */
export const updateWorkstreamInputSchema = z
  .object({ project: projectAddressSchema, id: z.string().min(1), ...changesShape })
  .strict();

/** @see updateWorkstreamInputSchema */
export type UpdateWorkstreamInput = z.infer<typeof updateWorkstreamInputSchema>;

/** What the lead's tool takes: the changes. Its workstream is the one its session leads. */
export const updateOwnWorkstreamInputSchema = z.object(changesShape).strict();

/** What an update returns: the entry as written. */
export const updateWorkstreamOutputSchema = z.object({ workstream: workstreamViewSchema });

/** The workstream writes, and the same blocks as an `actions` map and a tool. */
export type WorkstreamBlocks = {
  openWorkstream: BlockDefinition<any, any>;
  updateWorkstream: BlockDefinition<any, any>;
  /** The lead's tool: updates the workstream its session leads. Give it to a lead's flow. */
  updateWorkstreamTool: BlockDefinition<any, any>;
  actions: {
    openWorkstream: { block: BlockDefinition<any, any>; description: string };
    updateWorkstream: { block: BlockDefinition<any, any>; description: string };
  };
};

/** How long an open that found another open's entry waits for that open to name its session. */
const SESSION_WAIT_ATTEMPTS = 40;
const SESSION_WAIT_MS = 50;

const nowIso = () => new Date().toISOString();

/** The caller: the session's user, as the engine recorded it. */
function ownerOf(ctx: BlockContext, what: string): string {
  const owner = ctx.session.identity.userId;
  if (owner === undefined || owner.length === 0) {
    throw new Error(`${what} needs a session with an owner: a workstream is its session's user's.`);
  }
  return owner;
}

/** The entries at `visibility`, as the calling block declared them. */
function entriesAt(ctx: BlockContext, visibility: ProjectAddress["visibility"]): ResourceCollectionRef<WorkstreamEntry> {
  return ctx.resources[workstreamsAccessor(visibility)] as unknown as ResourceCollectionRef<WorkstreamEntry>;
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
    execute: async (input: OpenWorkstreamInput, rawCtx): Promise<OpenStep> => {
      const ctx = rawCtx as unknown as BlockContext;
      const owner = ownerOf(ctx, "openWorkstream");
      assertWorkstreamId(input.id);
      const project = await projectAt(ctx, input.project);
      if (!isMember(project.state, owner)) {
        throw new ProjectRefusedError(
          "not-a-member",
          `only project "${input.project.id}"'s members may open workstreams in it.`
        );
      }
      const lead = await installation.rosterWorker(ctx as never, input.lead);
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
      const entries = entriesAt(ctx, input.project.visibility);
      const key = workstreamEntryKey(input.project.id, owner, input.id);
      const at = nowIso();
      const fresh: Record<string, unknown> = {
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
          entry = await entries.create(key, withWrittenBy(ctx, fresh) as never);
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
      await ctx.request.patchState({ [OPENING_STATE]: opening } as never);
      return { needsSession, flow: lead.flow, lead: input.lead, ref: workstreamRef(address) };
    }
  });

  /** One dispatcher per lead flow: creates the lead's session, linked at create, and runs nothing. */
  const dispatchers = new Map<string, BlockDefinition<any, any>>();
  for (const kind of leadFlowKinds) {
    dispatchers.set(
      kind,
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
      })
    );
  }
  const createSession = router({
    name: "workstream-open-session",
    inputSchema: openStepSchema,
    routes: [...dispatchers.values()],
    execute: (step: OpenStep) => {
      const route = dispatchers.get(step.flow);
      if (route === undefined) throw new Error(`No workstream session can be created on flow "${step.flow}".`);
      return route;
    }
  } as never) as BlockDefinition<any, any>;

  /** Name the session on the entry, unless another open named one first, and answer the entry. */
  const finishOpen = handler({
    name: "workstream-open-finish",
    inputSchema: z.unknown(),
    outputSchema: openWorkstreamOutputSchema,
    resources,
    requestStateSchema: openingStateSchema,
    execute: async (value: unknown, rawCtx): Promise<OpenWorkstreamOutput> => {
      const ctx = rawCtx as unknown as BlockContext;
      const opening = (ctx.request.state as Record<string, unknown>)[OPENING_STATE] as Opening | undefined;
      if (opening === undefined) throw new Error("No workstream is being opened in this request.");
      const { address, owner } = opening;
      const entries = entriesAt(ctx, address.project.visibility);
      const entry = await entries.get(workstreamEntryKey(address.project.id, owner, address.id));
      const handle = dispatchHandleSchema.safeParse(value);
      if (opening.needsSession && handle.success) {
        await retryOnConflict(() =>
          entry.updateState((state) =>
            state.sessionId == null
              ? (withWrittenBy(ctx, { ...state, sessionId: handle.data.sessionId, updatedAt: nowIso() }) as never)
              : state
          )
        );
      }
      return { workstream: viewOf(address, owner, entry.state), opened: opening.opened };
    }
  });

  const openWorkstream = sequencer({
    name: "open-workstream",
    inputSchema: openWorkstreamInputSchema,
    outputSchema: openWorkstreamOutputSchema
  })
    .step(checkOpen)
    .stepIf((step: OpenStep) => step.needsSession, createSession)
    .step(finishOpen);

  const updateWorkstream = handler({
    name: "workstream-update",
    inputSchema: updateWorkstreamInputSchema,
    outputSchema: updateWorkstreamOutputSchema,
    resources: WORKSTREAM_RESOURCES,
    execute: async (input: UpdateWorkstreamInput, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      const { project, id, ...changes } = input;
      return { workstream: await updateEntry(ctx, { project, id }, ownerOf(ctx, "updateWorkstream"), changes) };
    }
  });

  const updateWorkstreamTool = handler({
    name: "updateWorkstream",
    description:
      "Update the workstream you lead: its status (on-track, at-risk, blocked or done), due date, objectives (the whole list, each met or not) and your latest report. Every reader of the project sees it.",
    inputSchema: updateOwnWorkstreamInputSchema,
    outputSchema: updateWorkstreamOutputSchema,
    resources: WORKSTREAM_RESOURCES,
    execute: async (changes, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      const ref = (ctx.session.state as Record<string, unknown>)[WORKSTREAM_STATE_KEY];
      const address = typeof ref === "string" ? parseWorkstreamRef(ref) : undefined;
      if (address === undefined) {
        throw new ProjectRefusedError("not-a-workstream-session", "this session leads no workstream, so there is none to update.");
      }
      return { workstream: await updateEntry(ctx, address, ownerOf(ctx, "updateWorkstream"), changes) };
    }
  });

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
 * Write the caller's own entry: a compare-and-swap that recomputes on retry,
 * then the report as its content. The owner rule at the store is what makes
 * the entry the caller's to write; this only ever addresses the caller's key.
 */
async function updateEntry(
  ctx: BlockContext,
  address: WorkstreamAddress,
  owner: string,
  changes: Omit<UpdateWorkstreamInput, "project" | "id">
): Promise<WorkstreamView> {
  assertWorkstreamId(address.id);
  const entries = entriesAt(ctx, address.project.visibility);
  const entry = await entries.getOptional(workstreamEntryKey(address.project.id, owner, address.id));
  if (entry === undefined) {
    throw new ProjectRefusedError(
      "no-such-workstream",
      `you have no workstream "${address.id}" in project "${address.project.id}".`
    );
  }
  const { report, objectives, ...fields } = changes;
  await retryOnConflict(() =>
    entry.updateState((state) => {
      const at = nowIso();
      const signed = withWrittenBy(ctx, {});
      return withWrittenBy(ctx, {
        ...state,
        ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
        ...(objectives === undefined ? {} : { objectives: nextObjectives(state.objectives, objectives, at, signed.writtenBy) }),
        updatedAt: at
      }) as never;
    })
  );
  if (report !== undefined) await entry.writeContent(report);
  return viewOf(address, owner, entry.state);
}
