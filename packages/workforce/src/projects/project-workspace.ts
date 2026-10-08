/**
 * `projectWorkspace()`: where a coding run on a project gets its files.
 *
 * A run source (`@flow-state-dev/workspace`) answers one question for a
 * workspace host: does this run cut a branch of a repository, or work on a set
 * of kept files? Workforce knows the answer for a run on a project, and this
 * is where it gives it. It finds the project one of two ways.
 *
 * **From a workstream.** A run whose session leads a workstream (its readonly
 * `workstreamId`, set when the workstream's open created it and linked at
 * create against the owner's entry) works for that workstream:
 *
 *   session's workstreamId → the owner's entry → the project's row at its visibility
 *         → the project's repository, with its files beside the checkout
 *         → or, with no repository, the project's files alone
 *
 * The workstream's owner is the session's user, so the entry read is always
 * theirs. A private project's row and files are read in the owner's own user
 * scope, a shared project's in the organization's.
 *
 * **From a mailbox board**, given as `board`. The workstream claim path:
 *
 *   board → its mailbox → the workstream's claim → the project row → as above
 *
 * kept for the mailbox boards a project row lists until they become
 * workstreams. A session that leads a workstream is answered from it first.
 *
 * Every step reads stored, server-written data (BP-031): the session's
 * readonly field, the entry, the claim and the row; the mailbox id is derived
 * from the board's minted id (`<mailboxId>.<board>`), never passed beside it;
 * and the run's owner is the request's resolved user, the same identity
 * harness-manager records as the run's owner. Nothing on the row being worked
 * (its input, its metadata, anything a model wrote) is read.
 *
 * Refusals, each naming what it refused on, before any file or clone exists:
 *
 * - `no-project`: the session leads no workstream and no project holds the
 *   board's workstream, or no board was given, so there is nowhere to keep
 *   the run's files.
 * - `no-such-workstream`: the session names a workstream its owner has no
 *   entry for.
 * - `no-such-project`: the entry or the claim names a project with no row.
 * - `not-the-owner`: the run's owner is not the workstream's owner.
 * - `not-a-member`: on the board path, the run's owner is not one of the
 *   project's members.
 *
 * The kept files are the project's slice of `project-files/**` at its
 * visibility: the answer names the project's id as the key prefix, so a host
 * hydrates and saves `project-files/<projectId>/…` and nothing else.
 *
 * The collections are reached through {@link projectWorkspaceCapability},
 * which the block that asks the source must hold: pass it on the manager's
 * `uses`.
 */

import { defineCapability } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import {
  collectionIdFor,
  principalFromContext,
  type ProjectedEntryState,
  type RunSource,
  type RunSourceAnswer,
  type RunSourceRefusal
} from "@flow-state-dev/workspace";
import { WORKSTREAM_STATE_KEY } from "../workers/keys";
import {
  defineProjectFilesCollection,
  definePrivateProjectFilesCollection,
  defineWorkstreamClaimsCollection,
  projectRowSchema,
  WORKSTREAM_CLAIMS_RESOURCE,
  workstreamClaimSchema,
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
import { parseWorkstreamRef, type WorkstreamAddress } from "./workstream-ref";

/**
 * Why {@link projectWorkspace} refused a run. The answer's `message` names the
 * workstream, the project or the users.
 */
export type ProjectWorkspaceRefusalReason =
  | "no-project"
  | "no-such-workstream"
  | "no-such-project"
  | "not-the-owner"
  | "not-a-member";

/**
 * The collections {@link projectWorkspace} reads: the workstream entries, the
 * workstream claims, the projects and the project files, at both
 * visibilities. Pass it on the `uses` of the block that asks the source (for
 * harness-manager, `harnessManager({ uses: [projectWorkspaceCapability] })`).
 *
 * The same declarations the project blocks install, so it meets them in one
 * flow without a conflict.
 */
export const projectWorkspaceCapability = defineCapability({
  name: "project-workspace",
  resources: {
    [WORKSTREAM_CLAIMS_RESOURCE]: defineWorkstreamClaimsCollection(),
    ...PROJECT_ROW_RESOURCES,
    ...PROJECT_FILE_RESOURCES,
    ...WORKSTREAM_RESOURCES
  }
});

/** What {@link projectWorkspace} takes. */
export interface ProjectWorkspaceOptions {
  /**
   * The mailbox board the runs are on, for runs that find their project
   * through the board's workstream claim: the same declaration the manager
   * drains (`mailboxBoard(mailboxId, name)`). Only its minted id is read, and
   * the mailbox is derived from it. Omit it when every run's session leads a
   * workstream.
   */
  board?: { readonly id: string };
}

/**
 * The run source for coding runs on a project.
 *
 * Answers `{ kind: "repo", repo, projectId, files }` for a project with a
 * repository, `{ kind: "files", projectId, files }` for one with none, or a
 * refusal ({@link ProjectWorkspaceRefusalReason}).
 *
 * @param options `board`: the mailbox board whose rows the runs work, if any.
 * @returns A `RunSource` to hand `localWorkspaceHost({ source })`.
 * @throws When built, if the board's id is not a mailbox board's
 *   (`<mailboxId>.<board>`). When asked, if the block asking does not hold
 *   {@link projectWorkspaceCapability}.
 * @example
 *   harnessManager({
 *     workspace: localWorkspaceHost({ root, remotes: { allow: ["github.com"] }, source: projectWorkspace() }),
 *     uses: [projectWorkspaceCapability],
 *     // ...
 *   });
 */
export function projectWorkspace(options: ProjectWorkspaceOptions = {}): RunSource {
  const workstream = options.board === undefined ? undefined : boardWorkstream(options.board.id);

  const source: RunSource = async (looseCtx): Promise<RunSourceAnswer> => {
    const ctx = looseCtx as unknown as BlockContext;
    const link = ctx.session?.state?.[WORKSTREAM_STATE_KEY];
    if (typeof link === "string") return fromWorkstream(ctx, link);
    if (workstream === undefined) {
      return refused(
        "no-project",
        "this run's session leads no workstream and names no board, so its coding runs have nowhere to keep their files."
      );
    }
    return fromClaim(ctx, workstream);
  };
  return source;
}

/** The workstream a mailbox board's minted id names: `<mailboxId>.<board>`. */
function boardWorkstream(boardId: string): string {
  const dot = boardId.lastIndexOf(".");
  if (dot <= 0 || dot === boardId.length - 1) {
    throw new Error(
      `projectWorkspace: "${boardId}" is not a mailbox board's id (\`<mailboxId>.<board>\`), so it ` +
        `names no workstream to find a project by. Pass the board \`mailboxBoard\` returns.`
    );
  }
  return boardId.slice(0, dot);
}

/** The bare user a run belongs to, not `identity.id`: that is the user record's storage key, which carries the org. */
function runOwnerOf(ctx: BlockContext): string | undefined {
  return ctx.user?.identity?.userId;
}

/** A run for the workstream its session leads. */
async function fromWorkstream(ctx: BlockContext, link: string): Promise<RunSourceAnswer> {
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

/** A run on a mailbox board a project lists: found through the workstream's claim. */
async function fromClaim(ctx: BlockContext, workstream: string): Promise<RunSourceAnswer> {
  const claims = collectionAt(ctx, WORKSTREAM_CLAIMS_RESOURCE, notHeld);
  const projects = projectRowsAt(ctx, "shared", notHeld);

  const claim = workstreamClaimSchema.safeParse((await claims.getOptional(workstream))?.state);
  if (!claim.success) {
    return refused(
      "no-project",
      `the workstream "${workstream}" belongs to no project, so its coding runs have nowhere to keep their files.`
    );
  }
  const projectId = claim.data.projectId;
  const stored = await projects.getOptional(projectId);
  if (stored === undefined) {
    return refused(
      "no-such-project",
      `the workstream "${workstream}" is claimed by project "${projectId}", which this organization does not have.`
    );
  }
  // Through the schema, so a row written before `repository` existed reads as none (BP-030).
  const project = projectRowSchema.parse(stored.state);
  const owner = runOwnerOf(ctx);
  if (!isMember(project, owner)) {
    return refused(
      "not-a-member",
      `the run's owner${owner ? ` "${owner}"` : ""} is not a member of project "${projectId}", so it may not work on its files.`
    );
  }
  return answer(ctx, "shared", project);
}

/** The answer for `project` at `visibility`: its repository, or its files, with its kept files beside either. */
function answer(ctx: BlockContext, visibility: ProjectVisibility, project: ProjectRow): RunSourceAnswer {
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
