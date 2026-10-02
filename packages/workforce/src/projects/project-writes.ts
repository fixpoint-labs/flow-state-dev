/**
 * The project writes: `createProject` and `setWorkstreams`.
 *
 * Both are blocks an app installs on the flow that creates projects — its own
 * boot code, or the chief of staff's tool — and {@link defineProjectBlocks}
 * also hands back the two as an `actions` map to spread into a flow.
 *
 * **Who the owner is.** The creating session's owner, as the engine recorded
 * it, never a field of the input. `members` in the input is the creator's own
 * grant, and the owner is always one of them. Nothing else writes `members`:
 * `join` never adds its caller.
 *
 * **One project per workstream.** Each workstream is claimed before the row is
 * written, by creating `workstream-claims/<channelId>` with `create`. The claim
 * is one shared key, so of two projects claiming one workstream at once
 * exactly one lands. A refused claim fails the write, names the workstream,
 * and releases the claims this write took, so a refused write leaves the row
 * and the claims as they were.
 *
 * **Re-sending a create.** The same owner sending the same id again gets the
 * existing row back, unchanged, and its talk session bound if it was not:
 * `createProject` dispatches `bind` to the talk kind, keyed on the row id,
 * whenever the owner has no entry in `sessions` after the write. A bind that
 * fails leaves the row unbound until the owner's next create, or `join`.
 */

import { dispatcher, handler, sequencer } from "@flow-state-dev/core";
import { withOutcome } from "@flow-state-dev/core/helpers";
import type { ActionConfig, BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { z } from "zod";
import { CHANNEL_KIND } from "../channel/channel-flow";
import { defineChannelInventoryCollection, type ChannelInventoryRow } from "../inventory/collections";
import { retryOnConflict } from "./cas-retry";
import {
  defineProjectsCollection,
  defineWorkstreamClaimsCollection,
  PROJECTS_RESOURCE,
  projectIdProblem,
  projectRowSchema,
  WORKSTREAM_CLAIMS_RESOURCE,
  type ProjectRow,
  type WorkstreamClaim
} from "./collections";
import { isMember } from "./membership-gate";
import { isAlreadyExists } from "./store-errors";
import { ProjectRefusedError } from "./project-refusal";

/** The talk kind's internal entry `createProject` dispatches to. */
const BIND_ACTION = "bind";

/**
 * The resource-map ref the channel inventory is read through here. Private to
 * these writes, so it never meets an app's own declaration of the inventory
 * under a common ref in the same flow (a flow refuses two under one ref).
 */
const CHANNEL_INVENTORY_RESOURCE = "project-writes-channel-inventory";

/** What creating a project takes. Closed: nothing in it names the owner. */
export const createProjectInputSchema = z
  .object({
    /** The project's id: one path segment, never `unassigned`. */
    id: z.string().min(1),
    title: z.string().min(1),
    brief: z.string().optional(),
    /** Who besides the creator may read and post the room. The creator is always a member. */
    members: z.array(z.string().min(1)).optional(),
    /** Full ids of declared channels, from any team. */
    workstreams: z.array(z.string().min(1)).optional()
  })
  .strict();

/** @see createProjectInputSchema */
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

/** What creating a project returns: the row, and whether this call wrote it. */
export const createProjectOutputSchema = z.object({
  project: projectRowSchema,
  /** `false` when the same owner re-sent an id it already holds; the row is returned unchanged. */
  created: z.boolean()
});

/** @see createProjectOutputSchema */
export type CreateProjectOutput = z.infer<typeof createProjectOutputSchema>;

/** What setting a project's workstreams takes: the whole new list. */
export const setWorkstreamsInputSchema = z
  .object({ projectId: z.string().min(1), workstreams: z.array(z.string().min(1)) })
  .strict();

/** @see setWorkstreamsInputSchema */
export type SetWorkstreamsInput = z.infer<typeof setWorkstreamsInputSchema>;

/** What setting a project's workstreams returns: the row as written. */
export const setWorkstreamsOutputSchema = z.object({ project: projectRowSchema });

/** Options for {@link defineProjectBlocks}. */
export type ProjectBlocksOptions = {
  /**
   * The flow kind a project's talk sessions run on — the one `bind` is
   * dispatched to. Defaults to the built-in `channel` kind.
   */
  talkKind?: string;
};

/** The two project writes, and the same two as an `actions` map. */
export type ProjectBlocks = {
  createProject: ReturnType<typeof createProjectSequence>;
  setWorkstreams: typeof setWorkstreams;
  actions: { createProject: ActionConfig; setWorkstreams: ActionConfig };
};

/** One map, shared by both writes: a flow refuses two declarations under one ref. */
const WRITE_RESOURCES = {
  [PROJECTS_RESOURCE]: defineProjectsCollection(),
  [WORKSTREAM_CLAIMS_RESOURCE]: defineWorkstreamClaimsCollection(),
  [CHANNEL_INVENTORY_RESOURCE]: defineChannelInventoryCollection()
};

function refsOf(ctx: BlockContext) {
  return {
    projects: ctx.resources[PROJECTS_RESOURCE] as unknown as ResourceCollectionRef<ProjectRow>,
    claims: ctx.resources[WORKSTREAM_CLAIMS_RESOURCE] as unknown as ResourceCollectionRef<WorkstreamClaim>,
    inventory: ctx.resources[CHANNEL_INVENTORY_RESOURCE] as unknown as ResourceCollectionRef<ChannelInventoryRow>
  };
}

const unique = (ids: readonly string[]): string[] => [...new Set(ids)];

/** Refuse any id that is not a channel this organization registered. Reads only; checked before any claim. */
async function assertDeclaredChannels(ctx: BlockContext, ids: readonly string[]): Promise<void> {
  const { inventory } = refsOf(ctx);
  for (const id of ids) {
    if ((await inventory.getOptional(id)) === undefined) {
      throw new ProjectRefusedError(
        "unknown-workstream",
        `"${id}" is not a channel in this organization's inventory. A workstream is a declared channel, named by its full id.`
      );
    }
  }
}

/** Release the claims this write took. Best-effort: a claim left behind is reported, not thrown over the refusal. */
async function release(ctx: BlockContext, taken: readonly string[]): Promise<void> {
  const { claims } = refsOf(ctx);
  for (const id of taken) {
    try {
      await claims.delete(id);
    } catch (error) {
      console.error(`[projects] could not release the claim on workstream "${id}": ${String(error)}`);
    }
  }
}

/**
 * Claim each workstream for `projectId`. A claim this project already holds is
 * kept and not counted as taken.
 *
 * @returns the ids this call claimed, for release if the write then fails.
 * @throws `workstream-claimed`, after releasing what it took, when another
 *   project holds one.
 */
async function claim(ctx: BlockContext, projectId: string, ids: readonly string[]): Promise<string[]> {
  const { claims } = refsOf(ctx);
  const taken: string[] = [];
  for (const id of ids) {
    try {
      await claims.create(id, { projectId });
      taken.push(id);
    } catch (error) {
      if (!isAlreadyExists(error)) {
        await release(ctx, taken);
        throw error;
      }
      const holder = (await claims.getOptional(id))?.state.projectId;
      if (holder === projectId) continue;
      await release(ctx, taken);
      throw new ProjectRefusedError(
        "workstream-claimed",
        `workstream "${id}" belongs to project "${holder ?? "(unknown)"}". A workstream belongs to at most one project.`
      );
    }
  }
  return taken;
}

const ownerBound = (row: ProjectRow): boolean => row.sessions.some((link) => link.userId === row.ownerUserId);

const writeProject = handler({
  name: "project-create",
  inputSchema: createProjectInputSchema,
  outputSchema: createProjectOutputSchema,
  resources: WRITE_RESOURCES,
  execute: async (input, rawCtx): Promise<CreateProjectOutput> => {
    const ctx = rawCtx as unknown as BlockContext;
    const problem = projectIdProblem(input.id);
    if (problem !== undefined) throw new ProjectRefusedError("invalid-project-id", `${problem}.`);
    const owner = ctx.session.identity.userId;
    if (owner === undefined || owner.length === 0) {
      throw new Error("createProject needs a session with an owner: the owner is the session's user.");
    }
    const { projects } = refsOf(ctx);

    const heldBy = (row: ProjectRow): CreateProjectOutput => {
      if (row.ownerUserId === owner) return { project: projectRowSchema.parse(row), created: false };
      throw new ProjectRefusedError(
        "project-id-held",
        `project id "${input.id}" is held by another owner. Choose another id.`
      );
    };

    const existing = await projects.getOptional(input.id);
    if (existing !== undefined) return heldBy(existing.state as ProjectRow);

    const workstreams = unique(input.workstreams ?? []);
    await assertDeclaredChannels(ctx, workstreams);
    const taken = await claim(ctx, input.id, workstreams);

    const row: ProjectRow = projectRowSchema.parse({
      id: input.id,
      title: input.title,
      brief: input.brief ?? null,
      ownerUserId: owner,
      members: unique([owner, ...(input.members ?? [])]),
      workstreams,
      sessions: []
    });
    try {
      await projects.create(input.id, row);
    } catch (error) {
      await release(ctx, taken);
      if (!isAlreadyExists(error)) throw error;
      const winner = await projects.getOptional(input.id);
      if (winner === undefined) throw error;
      return heldBy(winner.state as ProjectRow);
    }
    return { project: row, created: true };
  }
});

/** Absorbs a refused `bind` dispatch: the row stands, unbound, until a repair. */
const noteBindRefusal = handler({
  name: "project-bind-refused",
  inputSchema: z.unknown(),
  outputSchema: z.object({ bound: z.literal(false), reason: z.string() }),
  execute: async (error: unknown) => ({
    bound: false as const,
    reason: `talk session not bound: ${error instanceof Error ? error.message : String(error)}`
  })
});

function createProjectSequence(talkKind: string) {
  const bindOwner = dispatcher({
    name: "project-bind-owner",
    flowKind: talkKind,
    action: BIND_ACTION,
    inputSchema: createProjectOutputSchema,
    // Keyed on the row, from the creating session: a re-sent create from the
    // same session re-enters the same talk session rather than minting another.
    session: { key: (out: CreateProjectOutput) => `talk:${out.project.id}` },
    payload: (out: CreateProjectOutput) => ({ resourceId: out.project.id })
  }).rescue([{ block: noteBindRefusal }]);

  return sequencer({
    name: "create-project",
    inputSchema: createProjectInputSchema,
    outputSchema: createProjectOutputSchema
  })
    .step(writeProject)
    .tapIf((out: CreateProjectOutput) => !ownerBound(out.project), bindOwner);
}

/**
 * `setWorkstreams`: replace a project's workstreams. Members only. New ids are
 * claimed before the row is written, and a dropped id's claim is deleted after.
 */
const setWorkstreams = handler({
  name: "project-set-workstreams",
  inputSchema: setWorkstreamsInputSchema,
  outputSchema: setWorkstreamsOutputSchema,
  resources: WRITE_RESOURCES,
  execute: async (input, rawCtx) => {
    const ctx = rawCtx as unknown as BlockContext;
    const { projects, claims } = refsOf(ctx);
    const row = await projects.getOptional(input.projectId);
    if (row === undefined) {
      throw new ProjectRefusedError("no-such-project", `this organization has no project "${input.projectId}".`);
    }
    if (!isMember(row.state, ctx.session.identity.userId)) {
      throw new ProjectRefusedError(
        "not-a-member",
        `only project "${input.projectId}"'s members may change its workstreams.`
      );
    }

    const next = unique(input.workstreams);
    const current = new Set(row.state.workstreams);
    await assertDeclaredChannels(ctx, next.filter((id) => !current.has(id)));
    const taken = await claim(ctx, input.projectId, next.filter((id) => !current.has(id)));

    let written: ProjectRow | undefined;
    try {
      written = await retryOnConflict(() =>
        withOutcome(
          (mutator: (state: ProjectRow) => ProjectRow) => row.updateState(mutator),
          (state: ProjectRow) => {
            const updated = { ...state, workstreams: next };
            return { state: updated, result: updated };
          }
        )
      );
    } catch (error) {
      await release(ctx, taken);
      throw error;
    }

    for (const id of current) {
      if (next.includes(id)) continue;
      if ((await claims.getOptional(id))?.state.projectId === input.projectId) await claims.delete(id);
    }
    return { project: projectRowSchema.parse(written ?? row.state) };
  }
});

/**
 * Build the project writes.
 *
 * @example
 *   const projects = defineProjectBlocks();
 *   defineFlow({ kind: "lab", actions: { ...projects.actions } });
 */
export function defineProjectBlocks(options: ProjectBlocksOptions = {}): ProjectBlocks {
  const createProject = createProjectSequence(options.talkKind ?? CHANNEL_KIND);
  return {
    createProject,
    setWorkstreams,
    actions: {
      createProject: {
        block: createProject,
        description:
          "Create a project owned by the caller, with its members and workstreams. Refused when the id is held by another owner."
      },
      setWorkstreams: {
        block: setWorkstreams,
        description: "Replace a project's workstreams. Members only; a workstream belongs to at most one project."
      }
    }
  };
}
