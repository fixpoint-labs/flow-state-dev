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
 * The collections are reached through {@link projectWorkspaceCapability},
 * which the block that asks the source must hold: pass it on the manager's
 * `uses`.
 */

import { defineCapability, type LooseBlockContext } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import {
  collectionIdFor,
  principalFromContext,
  type ProjectedEntryState,
  type RunSource,
  type RunSourceAnswer,
  type RunSourceRefusal
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
 * The run source for coding runs on a project.
 *
 * Answers `{ kind: "repo", repo, projectId, files }` for a project with a
 * repository, `{ kind: "files", projectId, files }` for one with none, or a
 * refusal ({@link ProjectWorkspaceRefusalReason}).
 *
 * @returns A `RunSource` to hand `localWorkspaceHost({ source })`.
 * @throws When asked, if the block asking does not hold
 *   {@link projectWorkspaceCapability}.
 * @example
 *   harnessManager({
 *     workspace: localWorkspaceHost({ root, remotes: { allow: ["github.com"] }, source: projectWorkspace() }),
 *     uses: [projectWorkspaceCapability],
 *     // ...
 *   });
 */
export function projectWorkspace(): RunSource {
  const source: RunSource = async (ctx): Promise<RunSourceAnswer> => {
    const named = await namedProjectOf(ctx);
    if (named.kind === "malformed") return named.refusal;
    const link = filingWorkstreamOf(ctx.session?.state);
    if (link !== undefined) {
      const conflict = otherProject(named, parseWorkstreamRef(link)?.project);
      return conflict ?? fromWorkstream(ctx, link);
    }
    const filedIn = filingProjectOf(ctx.session?.state);
    if (filedIn !== undefined) {
      const address = parseProjectRef(filedIn);
      if (address === undefined) return refused("no-project", `this run's session names project "${filedIn}", which names no project.`);
      return otherProject(named, address) ?? fromProject(ctx, address);
    }
    if (named.kind === "named") return fromProject(ctx, named.address);
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

/** A run for the workstream its session leads. */
async function fromWorkstream(ctx: LooseBlockContext, link: string): Promise<RunSourceAnswer> {
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
async function fromProject(ctx: LooseBlockContext, address: ProjectAddress): Promise<RunSourceAnswer> {
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

/** The answer for `project` at `visibility`: its repository, or its files, with its kept files beside either. */
function answer(ctx: LooseBlockContext, visibility: ProjectVisibility, project: ProjectRow): RunSourceAnswer {
  const declaration = visibility === "private" ? definePrivateProjectFilesCollection() : defineProjectFilesCollection();
  const kept = {
    collection: collectionAt<ProjectedEntryState>(ctx, projectFilesAccessor(visibility), notHeld),
    collectionId: collectionIdFor(declaration, principalFromContext(ctx))
  };
  return project.repository == null
    ? { kind: "files", projectId: project.id, files: kept }
    : { kind: "repo", repo: project.repository, projectId: project.id, files: kept };
}

/** A refusal answer. */
function refused(reason: ProjectWorkspaceRefusalReason, message: string): RunSourceRefusal {
  return { kind: "refused", reason, message };
}

/** A run source's block that lacks a collection: name the capability that installs it. */
const notHeld: MissingCollection = (accessor) =>
  `projectWorkspace: the block asking for a run's source does not hold "${accessor}". ` +
  `Pass projectWorkspaceCapability on its \`uses\` (for harness-manager, \`harnessManager({ uses })\`).`;
