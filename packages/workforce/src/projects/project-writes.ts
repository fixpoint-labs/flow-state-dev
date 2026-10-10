/**
 * The project writes: `createProject`, `setWorkstreams` and `setRepository`.
 *
 * **Shared or private.** `createProject` takes a `visibility`, `"shared"` when
 * omitted. A shared project is a row of the organization's `projects`; a
 * private one is the same row in its owner's user scope, with only its owner
 * as a member and no workstreams by mailbox id. Every later read
 * and write names the project by its address, its visibility plus its id
 * (`project-address.ts`).
 *
 * Each is a block an app installs on the flow that creates projects — its own
 * boot code, or the chief of staff's tool — and {@link defineProjectBlocks}
 * also hands them back, with the project files read (`project-files.ts`), as
 * an `actions` map to spread into a flow.
 *
 * **Who the owner is.** The creating session's owner, as the engine recorded
 * it, never a field of the input. `members` in the input is the creator's own
 * grant, and the owner is always one of them. Nothing else writes `members`:
 * `join` never adds its caller.
 *
 * **One project per workstream.** Each workstream is claimed before the row is
 * written, by creating `workstream-claims/<mailboxId>` with `create`. The claim
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
 * existing row back, unchanged.
 */

import { handler } from "@flow-state-dev/core";
import { withOutcome } from "@flow-state-dev/core/helpers";
import type { ActionConfig, BlockContext, ResourceCollectionRef, ResourceRef } from "@flow-state-dev/core/types";
import { z } from "zod";
import { defineMailboxInventoryCollection, type MailboxInventoryRow } from "../inventory/collections";
import { retryOnConflict } from "./cas-retry";
import {
  defineWorkstreamClaimsCollection,
  PROJECTS_RESOURCE,
  projectAddressSchema,
  projectIdProblem,
  projectRowSchema,
  projectVisibilitySchema,
  WORKSTREAM_CLAIMS_RESOURCE,
  type ProjectRow,
  type ProjectVisibility,
  type WorkstreamClaim
} from "./collections";
import { projectAt, projectRowsAt, PROJECT_ROW_RESOURCES } from "./project-address";
import { isMember } from "./membership-gate";
import { isAlreadyExists, isConcurrentModification, isResourceDeleted } from "./store-errors";
import { readProjectFiles } from "./project-files";
import { readProject } from "./project-read";
import { ProjectRefusedError } from "./project-refusal";
import { repositoryProblem } from "./repository-value";

/**
 * The resource-map ref the mailbox inventory is read through here. Private to
 * these writes, so it never meets an app's own accessor for the inventory.
 */
const MAILBOX_INVENTORY_RESOURCE = "project-writes-mailbox-inventory";

/**
 * The mailbox inventory as the project writes declare it.
 *
 * A flow declares one storage key once: two accessors may share it only as one
 * declaration. So a flow that installs the writes and also reads the inventory
 * itself (a chief of staff's discovery door, say) declares its own read with
 * this object, under any accessor, rather than with a
 * `defineMailboxInventoryCollection()` of its own, which that flow refuses.
 *
 * @example
 *   resources: { mailboxes: projectWritesMailboxInventory }
 */
export const projectWritesMailboxInventory = defineMailboxInventoryCollection();

/** What creating a project takes. Closed: nothing in it names the owner. */
export const createProjectInputSchema = z
  .object({
    /** The project's id: one path segment, never `unassigned`. */
    id: z.string().min(1),
    title: z.string().min(1),
    brief: z.string().optional(),
    /**
     * `"shared"` (the default): a row of the organization, which everyone in it
     * reads. `"private"`: the same row in the creator's user scope, which nobody
     * else lists or reads.
     */
    visibility: projectVisibilitySchema.optional(),
    /**
     * On a shared project, who besides the creator may open workstreams and
     * change its workstream list. The creator is always a member. A private project
     * names nobody else.
     */
    members: z.array(z.string().min(1)).optional(),
    /** Full ids of declared mailboxes, from any team. Shared projects only. */
    workstreams: z.array(z.string().min(1)).optional(),
    /** The git remote the project's code lives in. Omitted or `null`: a project with no repository. */
    repository: z.string().nullable().optional()
  })
  .strict();

/** @see createProjectInputSchema */
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

/** What creating a project returns: the row, where it lives, and whether this call wrote it. */
export const createProjectOutputSchema = z.object({
  project: projectRowSchema,
  /** Where the row lives. With the row's id, the project's address. */
  visibility: projectVisibilitySchema,
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

/** What setting a project's repository takes: the project's address, and the new remote or `null` to clear it. */
export const setRepositoryInputSchema = z
  .object({ project: projectAddressSchema, repository: z.string().nullable() })
  .strict();

/** @see setRepositoryInputSchema */
export type SetRepositoryInput = z.infer<typeof setRepositoryInputSchema>;

/** What setting a project's repository returns: the row as written. */
export const setRepositoryOutputSchema = z.object({ project: projectRowSchema });

/** The project writes, the project read and the project files read, and the same blocks as an `actions` map. */
export type ProjectBlocks = {
  createProject: typeof writeProject;
  setWorkstreams: typeof setWorkstreams;
  setRepository: typeof setRepository;
  readProject: typeof readProject;
  readProjectFiles: typeof readProjectFiles;
  actions: {
    createProject: ActionConfig;
    setWorkstreams: ActionConfig;
    setRepository: ActionConfig;
    readProject: ActionConfig;
    readProjectFiles: ActionConfig;
  };
};

/** One map, shared by every write: a flow refuses two declarations under one ref. */
const WRITE_RESOURCES = {
  ...PROJECT_ROW_RESOURCES,
  [WORKSTREAM_CLAIMS_RESOURCE]: defineWorkstreamClaimsCollection(),
  [MAILBOX_INVENTORY_RESOURCE]: projectWritesMailboxInventory
};

function refsOf(ctx: BlockContext) {
  return {
    projects: ctx.resources[PROJECTS_RESOURCE] as unknown as ResourceCollectionRef<ProjectRow>,
    claims: ctx.resources[WORKSTREAM_CLAIMS_RESOURCE] as unknown as ResourceCollectionRef<WorkstreamClaim>,
    inventory: ctx.resources[MAILBOX_INVENTORY_RESOURCE] as unknown as ResourceCollectionRef<MailboxInventoryRow>
  };
}

const unique = (ids: readonly string[]): string[] => [...new Set(ids)];

/** Refuse any id that is not a mailbox this organization registered. Reads only; checked before any claim. */
async function assertDeclaredMailboxes(ctx: BlockContext, ids: readonly string[]): Promise<void> {
  const { inventory } = refsOf(ctx);
  for (const id of ids) {
    if ((await inventory.getOptional(id)) === undefined) {
      throw new ProjectRefusedError(
        "unknown-workstream",
        `"${id}" is not a mailbox in this organization's inventory. A workstream is a declared mailbox, named by its full id.`
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

/** Refuse a repository value no row may record. `null` and omitted are a project with none. */
function assertRepository(repository: string | null | undefined): void {
  if (repository == null) return;
  const problem = repositoryProblem(repository);
  if (problem !== undefined) throw new ProjectRefusedError("invalid-repository", `${problem}.`);
}

const writeProject = handler({
  name: "project-create",
  inputSchema: createProjectInputSchema,
  outputSchema: createProjectOutputSchema,
  resources: WRITE_RESOURCES,
  execute: async (input, rawCtx): Promise<CreateProjectOutput> => {
    const ctx = rawCtx as unknown as BlockContext;
    const problem = projectIdProblem(input.id);
    if (problem !== undefined) throw new ProjectRefusedError("invalid-project-id", `${problem}.`);
    assertRepository(input.repository);
    const owner = ctx.session.identity.userId;
    if (owner === undefined || owner.length === 0) {
      throw new Error("createProject needs a session with an owner: the owner is the session's user.");
    }
    const visibility: ProjectVisibility = input.visibility ?? "shared";
    if (visibility === "private") return writePrivateProject(ctx, input, owner);
    const { projects } = refsOf(ctx);

    const heldBy = (row: ProjectRow): CreateProjectOutput => {
      if (row.ownerUserId === owner) return { project: projectRowSchema.parse(row), visibility, created: false };
      throw new ProjectRefusedError(
        "project-id-held",
        `project id "${input.id}" is held by another owner. Choose another id.`
      );
    };

    const existing = await projects.getOptional(input.id);
    if (existing !== undefined) return heldBy(existing.state as ProjectRow);

    const workstreams = unique(input.workstreams ?? []);
    await assertDeclaredMailboxes(ctx, workstreams);
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
      repository: input.repository ?? null,
      claimTokens: Object.fromEntries(workstreams.map((id) => [id, token]))
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
    return { project: row, visibility, created: true };
  }
});

/**
 * Create a private project: the row in the owner's own user scope, with the
 * owner as its only member. Nobody else writes that scope, so an id it holds
 * is the owner's own, and a re-sent create hands the row back unchanged.
 *
 * @throws `private-has-members` when the input names anyone but the owner;
 *   `private-has-workstreams` when it lists workstreams by mailbox id, which
 *   only a shared project holds.
 */
async function writePrivateProject(ctx: BlockContext, input: CreateProjectInput, owner: string): Promise<CreateProjectOutput> {
  const others = unique(input.members ?? []).filter((member) => member !== owner);
  if (others.length > 0) {
    throw new ProjectRefusedError(
      "private-has-members",
      `a private project is its owner's alone, so it can't list ${others.map((m) => `"${m}"`).join(", ")}. ` +
        `Make it shared to work on it with others.`
    );
  }
  if ((input.workstreams ?? []).length > 0) {
    throw new ProjectRefusedError(
      "private-has-workstreams",
      "a private project can't list workstreams by mailbox id; that list is for shared projects."
    );
  }
  const projects = projectRowsAt(ctx, "private");
  const done = (state: unknown, created: boolean): CreateProjectOutput => ({
    project: projectRowSchema.parse(state),
    visibility: "private",
    created
  });
  const existing = await projects.getOptional(input.id);
  if (existing !== undefined) return done(existing.state, false);
  const row: ProjectRow = projectRowSchema.parse({
    id: input.id,
    title: input.title,
    brief: input.brief ?? null,
    ownerUserId: owner,
    members: [owner],
    repository: input.repository ?? null
  });
  try {
    await projects.create(input.id, row);
  } catch (error) {
    // The same owner's duplicate create won: hand its row back.
    const winner = isAlreadyExists(error) ? await projects.getOptional(input.id) : undefined;
    if (winner === undefined) throw error;
    return done(winner.state, false);
  }
  return done(row, true);
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
    await assertDeclaredMailboxes(ctx, next.filter((id) => !row.state.workstreams.includes(id)));
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
 * `setRepository`: set, change or clear a project's repository. Members only.
 * The row is rewritten from the state the store hands the updater, so a
 * concurrent `join` or `setWorkstreams` keeps what it wrote, and of two
 * `setRepository` writes at once the later one wins whole. A lost race is
 * retried past the engine's own budget, as the other contended row writes are.
 */
const setRepository = handler({
  name: "project-set-repository",
  inputSchema: setRepositoryInputSchema,
  outputSchema: setRepositoryOutputSchema,
  resources: WRITE_RESOURCES,
  execute: async (input, rawCtx) => {
    const ctx = rawCtx as unknown as BlockContext;
    const row = await projectAt(ctx, input.project);
    if (!isMember(row.state, ctx.session.identity.userId)) {
      throw new ProjectRefusedError(
        "not-a-member",
        `only project "${input.project.id}"'s members may change its repository.`
      );
    }
    assertRepository(input.repository);
    await retryOnConflict(() => row.updateState((state) => ({ ...state, repository: input.repository })));
    return { project: projectRowSchema.parse(row.state) };
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
 * Build the project writes, the project read and the project files read.
 *
 * @example
 *   const projects = defineProjectBlocks();
 *   defineFlow({ kind: "lab", actions: { ...projects.actions } });
 */
export function defineProjectBlocks(): ProjectBlocks {
  const createProject = writeProject;
  return {
    createProject,
    setWorkstreams,
    setRepository,
    readProject,
    readProjectFiles,
    actions: {
      createProject: {
        block: createProject,
        description:
          "Create a project owned by the caller, with its members and workstreams. Refused when the id is held by another owner."
      },
      setWorkstreams: {
        block: setWorkstreams,
        description: "Replace a project's workstreams. Members only; a workstream belongs to at most one project."
      },
      setRepository: {
        block: setRepository,
        description:
          "Set, change or clear (null) the git remote a project's code lives in. Members only; a bare path or a remote carrying a credential is refused."
      },
      readProject: {
        block: readProject,
        description:
          "Read a project by its address: its row, every workstream's entry, and its progress worked out from them."
      },
      readProjectFiles: {
        block: readProjectFiles,
        description: "Read the files a project keeps: each file's path under the project and its size in bytes. Members only."
      }
    }
  };
}
