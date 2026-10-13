/**
 * `projectWorkspace()`: where a coding run on a project gets its files.
 *
 * A run source (`@flow-state-dev/workspace`) answers one question for a
 * workspace host: does this run cut a branch of a repository, or work on a set
 * of kept files? Workforce knows the answer for a run on a project, and this
 * is where it gives it. It finds the project in this order, first match wins.
 *
 * **1. From a workstream.** A run whose session leads a workstream (its
 * readonly `workstreamId`, set when the workstream's open created it and
 * linked at create against the owner's entry), or a run in a task session
 * filed from one (its readonly `filingWorkstreamId`, which each hand-over
 * carries down from the session that filed it), works for that workstream:
 *
 *   session's workstreamId → the owner's entry → the project's row at its visibility
 *         → the project's repository, with its files beside the checkout
 *         → or, with no repository, the project's files alone
 *
 * The workstream's owner is the session's user, so the entry read is always
 * theirs. A private project's row and files are read in the owner's own user
 * scope, a shared project's in the organization's.
 *
 * **2. From the project the task was filed from.** A run in a task session a
 * project's conversation filed (its readonly `filingProjectId`, which the
 * hand-over copies from the conversation's `projectId`) works in that
 * project.
 *
 * **3. From the project the task names.** A run in a task session filed from
 * a conversation with no project reads `input.project`, a project address
 * (`{ visibility, id }`), off the row it holds: the row the claim gate
 * verified, whose run link names this request, on the board of the
 * conversation the session was opened for. A bare id names nothing. The task
 * names a project; it never grants one, so the run's owner is checked against
 * the project's members. A task naming a project other than its
 * conversation's (1 or 2) is refused, never followed.
 *
 * Every step reads stored, server-written data (BP-031): the session's
 * readonly fields, the entry and the rows; and the run's owner is the
 * request's resolved user, the same identity harness-manager records as the
 * run's owner. The one thing read
 * from the row being worked is its `input.project`, and only as a name the
 * membership check then decides on.
 *
 * Refusals, each naming what it refused on, before any file or clone exists:
 *
 * - `no-project`: none of the three finds a project, the task names one that
 *   doesn't exist, or names one by anything but its visibility and id.
 * - `no-such-workstream`: the session names a workstream its owner has no
 *   entry for.
 * - `no-such-project`: the entry names a project with no row.
 * - `not-the-owner`: the run's owner is not the workstream's owner.
 * - `not-a-member`: on the project and task paths, the run's owner is
 *   not one of the project's members (for a private project, its owner).
 * - `other-project`: the task names a project other than its conversation's.
 *
 * The kept files are the project's slice of `project-files/**` at its
 * visibility: the answer names the project's id as the key prefix, so a host
 * hydrates and saves `project-files/<projectId>/…` and nothing else.
 *
 * **A checkout on this machine, for the projects the operator names.** With
 * `checkouts`, a shared project an entry names, by its organization and id
 * (and tenant, exactly), whose row's `repository` is the entry's `remote`,
 * is answered with the entry's `checkout` path instead of the remote, for a
 * host that lists that path in `localRepositories`. The organization and
 * tenant are the run's session's, from its verified principal
 * (`principalFromContext`), never anything on the task. A private project, a
 * project in another organization or tenant, and a session with no
 * organization are never mapped: they get the answer they would without
 * `checkouts`. The row still names its remote; the path is the operator's.
 *
 * The collections are reached through {@link projectWorkspaceCapability},
 * which the block that asks the source must hold: pass it on the manager's
 * `uses`.
 */

import { isAbsolute } from "node:path";
import { defineCapability, type LooseBlockContext } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import {
  collectionIdFor,
  principalFromContext,
  type ProjectedEntryState,
  type RunSource,
  type RunSourceAnswer,
  type RunSourceRefusal,
  type ScopePrincipal
} from "@flow-state-dev/workspace";
import { filingProjectOf, filingWorkstreamOf } from "../conversation-board/filing-session";
import { conversationLedgerResources } from "../conversation-board/ledger";
import { heldTask } from "../conversation-board/held-task";
import {
  defineProjectFilesCollection,
  definePrivateProjectFilesCollection,
  projectAddressSchema,
  projectRowSchema,
  type ProjectAddress,
  type ProjectRow,
  type ProjectVisibility
} from "./collections";
import { isMember } from "./membership-gate";
import { repositoryProblem } from "./repository-value";
import {
  collectionAt,
  projectFilesAccessor,
  projectRowsAt,
  PROJECT_FILE_RESOURCES,
  PROJECT_ROW_RESOURCES,
  workstreamsAt,
  type MissingCollection
} from "./project-address";
import { WORKSTREAM_RESOURCES, workstreamEntryKey } from "./workstream-collections";
import { parseProjectRef, parseWorkstreamRef, type WorkstreamAddress } from "./workstream-ref";

/**
 * Why {@link projectWorkspace} refused a run. The answer's `message` names the
 * workstream, the project or the users.
 */
export type ProjectWorkspaceRefusalReason =
  | "no-project"
  | "no-such-workstream"
  | "no-such-project"
  | "not-the-owner"
  | "not-a-member"
  | "other-project";

/**
 * The collections {@link projectWorkspace} reads: the workstream entries, the
 * projects and the project files, at both
 * visibilities, and the conversation ledger a task's row is read from. Pass it on the `uses` of the block that asks the source (for
 * harness-manager, `harnessManager({ uses: [projectWorkspaceCapability] })`).
 *
 * The same declarations the project blocks install, so it meets them in one
 * flow without a conflict.
 */
export const projectWorkspaceCapability = defineCapability({
  name: "project-workspace",
  resources: {
    ...PROJECT_ROW_RESOURCES,
    ...PROJECT_FILE_RESOURCES,
    ...WORKSTREAM_RESOURCES,
    ...conversationLedgerResources
  }
});

/**
 * A checkout on the server's machine that some shared projects' runs work in,
 * instead of a clone of their remote. The operator's config, never a row.
 */
export interface ProjectCheckout {
  /** The remote, exactly as the projects' rows store it in `repository`. */
  remote: string;
  /** The checkout's absolute path. List it in the host's `localRepositories` too. */
  checkout: string;
  /**
   * The shared projects whose runs work here, each by its organization and
   * id. `tenantId` is matched exactly: an entry that names one matches only a
   * run in that tenant, and one that names none only a run with none.
   */
  projects: readonly { orgId: string; id: string; tenantId?: string }[];
  /** The branch a run's branch is cut from. Omitted: whatever the checkout has checked out (`HEAD`). */
  baseRef?: string;
}

/** Options for {@link projectWorkspace}. */
export interface ProjectWorkspaceOptions {
  /** Checkouts on this machine, and the shared projects whose runs work in each. */
  checkouts?: readonly ProjectCheckout[];
}

/**
 * The run source for coding runs on a project.
 *
 * Answers `{ kind: "repo", repo, projectId, files }` for a project with a
 * repository, `{ kind: "files", projectId, files }` for one with none, or a
 * refusal ({@link ProjectWorkspaceRefusalReason}). A shared project named in
 * `checkouts`, in the run's own organization and tenant and on the entry's
 * remote, is answered with the entry's `checkout` as its `repo` and the
 * entry's `baseRef`.
 *
 * @param options `checkouts`: see {@link ProjectCheckout}.
 * @returns A `RunSource` to hand `localWorkspaceHost({ source })`.
 * @throws When called, for a checkout that isn't an absolute path, a remote
 *   a project's row couldn't store, or a project (organization, tenant and
 *   id) named twice, naming the entry. When asked, if the block asking does
 *   not hold {@link projectWorkspaceCapability}.
 * @example
 *   harnessManager({
 *     workspace: localWorkspaceHost({ root, remotes: { allow: ["github.com"] }, source: projectWorkspace() }),
 *     uses: [projectWorkspaceCapability],
 *     // ...
 *   });
 */
export function projectWorkspace(options: ProjectWorkspaceOptions = {}): RunSource {
  const checkouts = checkedCheckouts(options.checkouts ?? []);
  const answer = (ctx: LooseBlockContext, visibility: ProjectVisibility, project: ProjectRow): RunSourceAnswer =>
    answerFor(ctx, visibility, project, checkouts);
  const source: RunSource = async (ctx): Promise<RunSourceAnswer> => {
    const named = await namedProjectOf(ctx);
    if (named.kind === "malformed") return named.refusal;
    const link = filingWorkstreamOf(ctx.session?.state);
    if (link !== undefined) {
      const conflict = otherProject(named, parseWorkstreamRef(link)?.project);
      return conflict ?? fromWorkstream(ctx, link, answer);
    }
    const filedIn = filingProjectOf(ctx.session?.state);
    if (filedIn !== undefined) {
      const address = parseProjectRef(filedIn);
      if (address === undefined) return refused("no-project", `this run's session names project "${filedIn}", which names no project.`);
      return otherProject(named, address) ?? fromProject(ctx, address, answer);
    }
    if (named.kind === "named") return fromProject(ctx, named.address, answer);
    return refused(
      "no-project",
      "this run's session works for no workstream or project, and its task names none, so its coding runs have " +
        'nowhere to keep their files. A task can name one as `input.project`: `{ "visibility": "shared", "id": "<project>" }`.'
    );
  };
  return source;
}

/** What the task this run holds says about its project. */
type NamedProject =
  | { readonly kind: "none" }
  | { readonly kind: "named"; readonly address: ProjectAddress }
  | { readonly kind: "malformed"; readonly refusal: RunSourceRefusal };

/**
 * The project the task this run holds names in `input.project`, by visibility
 * and id. The row is the one the gate verified for this run, on the
 * conversation's board the task session was opened for: the row whose run
 * link names this request (`heldTask`). Never the dispatch's payload. A run
 * outside a conversation's task session names none.
 */
async function namedProjectOf(ctx: LooseBlockContext): Promise<NamedProject> {
  const held = await heldTask(ctx as unknown as BlockContext);
  const input = held?.row.input as { project?: unknown } | null | undefined;
  if (input == null || typeof input !== "object" || input.project == null) return { kind: "none" };
  const parsed = projectAddressSchema.safeParse(input.project);
  if (parsed.success) return { kind: "named", address: parsed.data };
  return {
    kind: "malformed",
    refusal: refused(
      "no-project",
      `the task names project ${JSON.stringify(input.project)}, and a project is named by its visibility and id: ` +
        '`{ "visibility": "shared" | "private", "id": "<project>" }`.'
    )
  };
}

/**
 * The refusal for a task naming a project other than its conversation's, or
 * `undefined` when it names none, or the same one. A conversation's project
 * is never overridden.
 */
function otherProject(named: NamedProject, own: ProjectAddress | undefined): RunSourceRefusal | undefined {
  if (named.kind !== "named" || own === undefined) return undefined;
  const { address } = named;
  if (address.visibility === own.visibility && address.id === own.id) return undefined;
  return refused(
    "other-project",
    `the task names ${address.visibility} project "${address.id}", but the conversation that filed it belongs to ` +
      `${own.visibility} project "${own.id}". A task works in its conversation's project.`
  );
}

/** The bare user a run belongs to, not `identity.id`: that is the user record's storage key, which carries the org. */
function runOwnerOf(ctx: LooseBlockContext): string | undefined {
  return ctx.user?.identity?.userId;
}

/** The answer for a project at its visibility, once the project is found and the run allowed. */
type Answer = (ctx: LooseBlockContext, visibility: ProjectVisibility, project: ProjectRow) => RunSourceAnswer;

/** A run for the workstream its session leads. */
async function fromWorkstream(ctx: LooseBlockContext, link: string, answer: Answer): Promise<RunSourceAnswer> {
  const address: WorkstreamAddress | undefined = parseWorkstreamRef(link);
  const owner = ctx.session.identity.userId;
  if (address === undefined || owner === undefined || owner.length === 0) {
    return refused("no-such-workstream", `this run's session names workstream "${link}", which names no workstream.`);
  }
  const { project, id } = address;
  const runOwner = runOwnerOf(ctx);
  if (runOwner !== owner) {
    return refused(
      "not-the-owner",
      `the run's owner${runOwner ? ` "${runOwner}"` : ""} is not workstream "${id}"'s owner "${owner}", so it may not work on its project's files.`
    );
  }
  const entries = workstreamsAt(ctx, project.visibility, notHeld);
  if ((await entries.getOptional(workstreamEntryKey(project.id, owner, id))) === undefined) {
    return refused("no-such-workstream", `"${owner}" has no workstream "${id}" in project "${project.id}".`);
  }
  const stored = await projectRowsAt(ctx, project.visibility, notHeld).getOptional(project.id);
  if (stored === undefined) {
    return refused("no-such-project", `workstream "${id}" is in project "${project.id}", which doesn't exist.`);
  }
  return answer(ctx, project.visibility, projectRowSchema.parse(stored.state));
}

/**
 * A run on the project at `address`: the one its conversation belongs to, or
 * the one its task names. The row is read at the address's visibility (a
 * private project in the run owner's own scope), and the run's owner must be
 * one of a shared project's members, or a private project's owner.
 */
async function fromProject(ctx: LooseBlockContext, address: ProjectAddress, answer: Answer): Promise<RunSourceAnswer> {
  const stored = await projectRowsAt(ctx, address.visibility, notHeld).getOptional(address.id);
  if (stored === undefined) {
    return refused("no-project", `there is no ${address.visibility} project "${address.id}" this run can work in.`);
  }
  const project = projectRowSchema.parse(stored.state);
  const owner = runOwnerOf(ctx);
  const allowed = address.visibility === "private" ? owner !== undefined && project.ownerUserId === owner : isMember(project, owner);
  if (!allowed) {
    return refused(
      "not-a-member",
      `the run's owner${owner ? ` "${owner}"` : ""} is not a member of project "${address.id}", so it may not work on its files.`
    );
  }
  return answer(ctx, address.visibility, project);
}

/**
 * The answer for `project` at `visibility`: its repository, or its files, with
 * its kept files beside either. A shared project a checkout entry maps, in
 * the run's own organization and tenant, gets the checkout instead of its
 * remote.
 */
function answerFor(
  ctx: LooseBlockContext,
  visibility: ProjectVisibility,
  project: ProjectRow,
  checkouts: readonly ProjectCheckout[]
): RunSourceAnswer {
  const declaration = visibility === "private" ? definePrivateProjectFilesCollection() : defineProjectFilesCollection();
  const principal = principalFromContext(ctx);
  const kept = {
    collection: collectionAt<ProjectedEntryState>(ctx, projectFilesAccessor(visibility), notHeld),
    collectionId: collectionIdFor(declaration, principal)
  };
  if (project.repository == null) return { kind: "files", projectId: project.id, files: kept };
  const mapped = checkoutFor(checkouts, visibility, project, principal);
  if (mapped !== undefined) {
    return {
      kind: "repo",
      repo: mapped.checkout,
      ...(mapped.baseRef !== undefined ? { baseRef: mapped.baseRef } : {}),
      projectId: project.id,
      files: kept
    };
  }
  return { kind: "repo", repo: project.repository, projectId: project.id, files: kept };
}

/**
 * The checkout entry that maps `project`, or `undefined`. Only a shared row,
 * only in a run whose session names an organization, matched on the stored
 * row's id and repository and the session's organization and tenant (BP-031).
 * Exported for its tests.
 */
export function checkoutFor(
  checkouts: readonly ProjectCheckout[],
  visibility: ProjectVisibility,
  project: Pick<ProjectRow, "id" | "repository">,
  principal: Pick<ScopePrincipal, "orgId" | "tenantId">
): ProjectCheckout | undefined {
  const { orgId, tenantId } = principal;
  if (visibility !== "shared" || orgId === undefined) return undefined;
  return checkouts.find(
    (entry) =>
      entry.remote === project.repository &&
      entry.projects.some((named) => named.id === project.id && named.orgId === orgId && named.tenantId === tenantId)
  );
}

/** `checkouts`, checked once when the source is built (BR-6). Each refusal names the entry. */
function checkedCheckouts(checkouts: readonly ProjectCheckout[]): readonly ProjectCheckout[] {
  const seen = new Set<string>();
  checkouts.forEach((entry, index) => {
    const at = `projectWorkspace: checkouts[${index}]`;
    if (!isAbsolute(entry.checkout)) {
      throw new Error(`${at}: the checkout ${JSON.stringify(entry.checkout)} must be an absolute path.`);
    }
    const problem = repositoryProblem(entry.remote);
    if (problem !== undefined) throw new Error(`${at}: its remote can't be a project's repository: ${problem}.`);
    for (const named of entry.projects) {
      const key = JSON.stringify([named.orgId, named.tenantId ?? null, named.id]);
      if (seen.has(key)) {
        throw new Error(
          `${at}: project "${named.id}" of organization "${named.orgId}"` +
            `${named.tenantId !== undefined ? ` in tenant "${named.tenantId}"` : ""} is already named. ` +
            `A project's runs work in one checkout.`
        );
      }
      seen.add(key);
    }
  });
  return checkouts;
}

/** A refusal answer. */
function refused(reason: ProjectWorkspaceRefusalReason, message: string): RunSourceRefusal {
  return { kind: "refused", reason, message };
}

/** A run source's block that lacks a collection: name the capability that installs it. */
const notHeld: MissingCollection = (accessor) =>
  `projectWorkspace: the block asking for a run's source does not hold "${accessor}". ` +
  `Pass projectWorkspaceCapability on its \`uses\` (for harness-manager, \`harnessManager({ uses })\`).`;
