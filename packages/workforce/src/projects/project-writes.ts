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
 * **Claims follow the committed row.** There is no lock around a project's
 * writes; two can run at once. Each write stamps the claims it lists with a
 * token of its own before its row write, and the row records each claim's
 * token. Releasing a claim is a check against that token, fenced by the
 * claim's version: a write deletes a claim only while it still carries the
 * token this write stamped (a write that failed) or the token the row it
 * replaced recorded (a workstream its committed write dropped). A claim
 * another write has re-stamped since is that write's, and stays.
 * `createProject` only creates claims, never adopts one: a claim its id
 * already holds is refused like any other, so two duplicate creates never
 * share one. `setWorkstreams` commits only while every claim it lists still
 * carries its token, takes what it dropped from the row it actually replaced,
 * never from what it read first, and when it fails hands its stamps back
 * against the row as it stands then, checked again after.
 *
 * What this does not cover: a writer that dies between stamping a claim and
 * finishing leaves that claim with a token no row records. Its project can
 * list and drop the workstream again to clear it; no other project can take
 * it until then.
 *
 * **Re-sending a create.** The same owner sending the same id again gets the
 * existing row back, unchanged, and its talk session bound if it was not:
 * `createProject` dispatches `bind` to the talk kind, keyed on the row id,
 * whenever the owner has no entry in `sessions` after the write. A bind that
 * fails leaves the row unbound until the owner's next create, or `join`.
 */

import { dispatcher, handler, sequencer } from "@flow-state-dev/core";
import { withOutcome } from "@flow-state-dev/core/helpers";
import type { ActionConfig, BlockContext, ResourceCollectionRef, ResourceRef } from "@flow-state-dev/core/types";
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
import { isAlreadyExists, isConcurrentModification, isResourceDeleted } from "./store-errors";
import { ProjectRefusedError } from "./project-refusal";
import { noteBindRefusal, noteTalkBindKind, TALK_BIND_ACTION, talkSessionKey } from "./talk-template";

/**
 * The resource-map ref the channel inventory is read through here. Private to
 * these writes, so it never meets an app's own accessor for the inventory.
 */
const CHANNEL_INVENTORY_RESOURCE = "project-writes-channel-inventory";

/**
 * The channel inventory as the project writes declare it.
 *
 * A flow declares one storage key once: two accessors may share it only as one
 * declaration. So a flow that installs the writes and also reads the inventory
 * itself (a chief of staff's discovery door, say) declares its own read with
 * this object, under any accessor, rather than with a
 * `defineChannelInventoryCollection()` of its own, which that flow refuses.
 *
 * @example
 *   resources: { channels: projectWritesChannelInventory }
 */
export const projectWritesChannelInventory = defineChannelInventoryCollection();

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
  [CHANNEL_INVENTORY_RESOURCE]: projectWritesChannelInventory
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

const newToken = (): string => crypto.randomUUID();

const claimedBy = (id: string, holder: string | undefined) =>
  new ProjectRefusedError(
    "workstream-claimed",
    `workstream "${id}" belongs to project "${holder ?? "(unknown)"}". A workstream belongs to at most one project.`
  );

/** The token `row` recorded for `id`, or `undefined` when the row does not list it. */
const listedToken = (row: ProjectRow | undefined, id: string): string | undefined =>
  row?.workstreams.includes(id) === true ? row.claimTokens[id] : undefined;

/**
 * A claim as the store holds it now, not as this request first read it.
 * `undefined` when there is none.
 */
async function freshClaim(ctx: BlockContext, id: string): Promise<ResourceRef<WorkstreamClaim> | undefined> {
  const ref = await refsOf(ctx).claims.getOptional(id);
  if (ref === undefined) return undefined;
  try {
    // A no-op write re-reads the stored row and takes it when it moved.
    await ref.updateState((state) => state);
  } catch (error) {
    if (isResourceDeleted(error)) return undefined;
    throw error;
  }
  return ref;
}

/**
 * Delete `projectId`'s claim on `id` if it still carries `token`. The delete is
 * conditioned on the version just read, so a re-stamp that lands in between
 * wins and the claim stays. Best-effort: a claim left behind is reported, not
 * thrown over the error that led here.
 */
async function releaseIfStamped(ctx: BlockContext, projectId: string, id: string, token: string | undefined): Promise<void> {
  if (token === undefined) return;
  try {
    const held = await freshClaim(ctx, id);
    if (held === undefined || held.state.projectId !== projectId || held.state.token !== token) return;
    await refsOf(ctx).claims.delete(id);
  } catch (error) {
    if (isConcurrentModification(error)) return; // re-stamped under us: no longer ours to release
    console.error(`[projects] could not release the claim on workstream "${id}": ${String(error)}`);
  }
}

/**
 * Stamp `projectId`'s claim on `id` with `token`: create it, or re-stamp it
 * when this project already holds it.
 *
 * @throws `workstream-claimed` when another project holds it.
 */
async function stampClaim(ctx: BlockContext, projectId: string, id: string, token: string): Promise<void> {
  const { claims } = refsOf(ctx);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await claims.create(id, { projectId, token });
      return;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
    // The refused create folded the holder's row in.
    const held = await claims.getOptional(id);
    if (held === undefined) continue;
    if (held.state.projectId !== projectId) throw claimedBy(id, held.state.projectId);
    try {
      await held.updateState((state) => {
        if (state.projectId !== projectId) throw claimedBy(id, state.projectId);
        return { ...state, token };
      });
      return;
    } catch (error) {
      if (!isResourceDeleted(error)) throw error; // released under us: create it again
    }
  }
  throw new Error(`workstream "${id}": its claim kept changing under this write`);
}

/** Thrown from a row write's updater when a claim it lists was re-stamped; retried like a lost CAS race. */
class ClaimMovedError extends Error {
  readonly code = "concurrent_modification";
  constructor(id: string) {
    super(`the claim on workstream "${id}" changed under this write`);
  }
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
    const { claims } = refsOf(ctx);
    const token = newToken();
    // Every claim is created here, never adopted: a claim this id already
    // holds belongs to a duplicate create still in flight (or one that never
    // finished), and sharing it would leave each duplicate releasing a claim
    // the other relies on. So the claims this call holds are exactly the ones
    // it created, and nobody else's row can list them.
    const taken: string[] = [];
    const releaseTaken = (keep: ReadonlySet<string>) =>
      Promise.all(taken.filter((id) => !keep.has(id)).map((id) => releaseIfStamped(ctx, input.id, id, token)));
    try {
      for (const id of workstreams) {
        try {
          await claims.create(id, { projectId: input.id, token });
          taken.push(id);
        } catch (error) {
          if (!isAlreadyExists(error)) throw error;
          throw claimedBy(id, (await claims.getOptional(id))?.state.projectId);
        }
      }
    } catch (error) {
      await releaseTaken(new Set());
      throw error;
    }

    const row: ProjectRow = projectRowSchema.parse({
      id: input.id,
      title: input.title,
      brief: input.brief ?? null,
      ownerUserId: owner,
      members: unique([owner, ...(input.members ?? [])]),
      workstreams,
      claimTokens: Object.fromEntries(workstreams.map((id) => [id, token])),
      sessions: []
    });
    try {
      await projects.create(input.id, row);
    } catch (error) {
      // A duplicate create won the row. Its claims are its own; release ours,
      // keeping any the winning row lists all the same.
      const winner = isAlreadyExists(error) ? (await projects.getOptional(input.id))?.state : undefined;
      await releaseTaken(new Set(winner?.workstreams ?? []));
      if (winner === undefined) throw error;
      return heldBy(winner as ProjectRow);
    }
    return { project: row, created: true };
  }
});

function createProjectSequence(talkKind: string) {
  const bindOwner = dispatcher({
    name: "project-bind-owner",
    flowKind: talkKind,
    action: TALK_BIND_ACTION,
    inputSchema: createProjectOutputSchema,
    // Keyed on the row, from the creating session: a re-sent create from the
    // same session re-enters the same talk session rather than minting another,
    // and the template's reaction on create (`talk-template.ts`) derives the
    // same key, so the two converge on one session.
    session: { key: (out: CreateProjectOutput) => talkSessionKey(out.project.id) },
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
 * `setWorkstreams`: replace a project's workstreams. Members only. Every listed
 * workstream's claim is stamped with this write's token before the row is
 * written, and the row is written only while all of them still carry it. The
 * claims of the workstreams the committed write dropped are released after.
 */
const setWorkstreams = handler({
  name: "project-set-workstreams",
  inputSchema: setWorkstreamsInputSchema,
  outputSchema: setWorkstreamsOutputSchema,
  resources: WRITE_RESOURCES,
  execute: async (input, rawCtx) => {
    const ctx = rawCtx as unknown as BlockContext;
    const { projects } = refsOf(ctx);
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
    await assertDeclaredChannels(ctx, next.filter((id) => !row.state.workstreams.includes(id)));
    const token = newToken();
    const stamped = new Set<string>();

    let transition: { replaced: ProjectRow; written: ProjectRow } | undefined;
    try {
      transition = await retryOnConflict(async () => {
        for (const id of next) {
          await stampClaim(ctx, input.projectId, id, token);
          stamped.add(id);
        }
        return withOutcome(
          (mutator: (state: ProjectRow) => Promise<ProjectRow>) => row.updateState(mutator),
          async (state: ProjectRow) => {
            // Commit only while every listed claim is still this write's. A
            // claim re-stamped since belongs to a write that may commit after
            // this one; stamping again and retrying keeps the two in order.
            for (const id of next) {
              const held = await freshClaim(ctx, id);
              if (held?.state.projectId !== input.projectId || held.state.token !== token) throw new ClaimMovedError(id);
            }
            const written: ProjectRow = {
              ...state,
              workstreams: next,
              claimTokens: Object.fromEntries(next.map((id) => [id, token]))
            };
            return { state: written, result: { replaced: state, written } };
          }
        );
      });
    } catch (error) {
      await settleFailedStamps(ctx, row, input.projectId, [...stamped], token);
      throw error;
    }
    if (transition === undefined) throw new Error(`project "${input.projectId}": the workstream write committed nothing`);

    // Release what the committed write dropped, as the row it replaced recorded it.
    const { replaced, written } = transition;
    for (const id of replaced.workstreams) {
      if (!next.includes(id)) await releaseIfStamped(ctx, input.projectId, id, replaced.claimTokens[id]);
    }
    return { project: projectRowSchema.parse(written) };
  }
});

/**
 * After a `setWorkstreams` that did not commit: hand each claim it stamped back
 * to the row. Decided against the row as it stands at that moment, then
 * checked again after: a write that committed in between and dropped the
 * workstream found this write's stamp on the claim and could not release it,
 * so the release falls to this write.
 *
 * - The row lists the workstream: put the row's token back, while the claim
 *   still carries this write's. Then re-read the row; if it no longer lists the
 *   workstream with that token, release the claim while it carries it.
 * - The row does not list it: release it while it carries this write's token.
 *   No committed row records that token, so nothing relies on such a claim.
 *
 * Every delete is conditioned on the token and the claim's version, so a
 * claim another write stamped meanwhile is left to that write.
 */
async function settleFailedStamps(
  ctx: BlockContext,
  row: ResourceRef<ProjectRow>,
  projectId: string,
  stamped: readonly string[],
  token: string
): Promise<void> {
  const current = async (): Promise<ProjectRow | undefined> => {
    try {
      await row.updateState((state) => state);
      return row.state;
    } catch (error) {
      if (!isResourceDeleted(error)) console.error(`[projects] could not re-read project "${projectId}": ${String(error)}`);
      return undefined;
    }
  };
  for (const id of stamped) {
    const rowToken = listedToken(await current(), id);
    if (rowToken === undefined) {
      await releaseIfStamped(ctx, projectId, id, token);
      continue;
    }
    try {
      const held = await freshClaim(ctx, id);
      await held?.updateState((state) => (state.token === token ? { ...state, token: rowToken } : state));
    } catch (error) {
      console.error(`[projects] could not restore the claim on workstream "${id}": ${String(error)}`);
    }
    if (listedToken(await current(), id) !== rowToken) await releaseIfStamped(ctx, projectId, id, rowToken);
  }
}

/**
 * Build the project writes.
 *
 * @example
 *   const projects = defineProjectBlocks();
 *   defineFlow({ kind: "lab", actions: { ...projects.actions } });
 */
export function defineProjectBlocks(options: ProjectBlocksOptions = {}): ProjectBlocks {
  const talkKind = options.talkKind ?? CHANNEL_KIND;
  noteTalkBindKind(defineProjectsCollection(), talkKind);
  const createProject = createProjectSequence(talkKind);
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
