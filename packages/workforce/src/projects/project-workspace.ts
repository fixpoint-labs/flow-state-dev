/**
 * `projectWorkspace({ board })`: where a coding run on a project's board gets
 * its files.
 *
 * A run source (`@flow-state-dev/workspace`) answers one question for a
 * workspace host: does this run cut a branch of a repository, or work on a set
 * of kept files? For a run on a mailbox's board, Workforce knows the answer,
 * and this is where it gives it:
 *
 *   board → its mailbox → the workstream's claim → the project row
 *         → the project's repository, with its files beside the checkout
 *         → or, with no repository, the project's files alone
 *
 * Every step reads stored, server-written data (BP-031): the mailbox id is
 * derived from the board's minted id (`<mailboxId>.<board>`), never passed
 * beside it, so the two cannot disagree; the claim and the row are read from
 * the organization's collections; and the run's owner is the request's
 * resolved user, the same identity harness-manager records as the run's owner.
 * Nothing on the row being worked (its input, its metadata, anything a model
 * wrote) is read.
 *
 * Three answers are refusals, each naming what it refused on, before any file
 * or clone exists:
 *
 * - `no-project`: no project holds the board's workstream, so there is nowhere
 *   to keep the run's files.
 * - `no-such-project`: the workstream's claim names a project with no row.
 * - `not-a-member`: the run's owner is not one of the project's members.
 *
 * The kept files are the project's slice of `project-files/**`: the answer
 * names the project's id as the key prefix, so a host hydrates and saves
 * `project-files/<projectId>/…` and nothing else.
 *
 * The collections are reached through {@link projectWorkspaceCapability},
 * which the block that asks the source must hold: pass it on the manager's
 * `uses`.
 */

import { defineCapability } from "@flow-state-dev/core";
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import {
  collectionIdFor,
  principalFromContext,
  type ProjectedEntryState,
  type RunSource,
  type RunSourceAnswer,
  type RunSourceRefusal
} from "@flow-state-dev/workspace";
import {
  defineProjectFilesCollection,
  defineProjectsCollection,
  defineWorkstreamClaimsCollection,
  PROJECT_FILES_RESOURCE,
  PROJECTS_RESOURCE,
  projectRowSchema,
  WORKSTREAM_CLAIMS_RESOURCE,
  workstreamClaimSchema
} from "./collections";
import { isMember } from "./membership-gate";

/**
 * Why {@link projectWorkspace} refused a run. The answer's `message` names the
 * workstream or the project.
 */
export type ProjectWorkspaceRefusalReason = "no-project" | "no-such-project" | "not-a-member";

/**
 * The collections {@link projectWorkspace} reads: the workstream claims and
 * the projects, and the project files it hands the host. Pass it on the
 * `uses` of the block that asks the source (for harness-manager,
 * `harnessManager({ uses: [projectWorkspaceCapability] })`).
 *
 * The same declarations the project writes install, so it meets them in one
 * flow without a conflict.
 */
export const projectWorkspaceCapability = defineCapability({
  name: "project-workspace",
  resources: {
    [WORKSTREAM_CLAIMS_RESOURCE]: defineWorkstreamClaimsCollection(),
    [PROJECTS_RESOURCE]: defineProjectsCollection(),
    [PROJECT_FILES_RESOURCE]: defineProjectFilesCollection()
  }
});

/** What {@link projectWorkspace} takes. */
export interface ProjectWorkspaceOptions {
  /**
   * The mailbox board the runs are on: the same declaration the manager drains
   * (`mailboxBoard(mailboxId, name)`). Only its minted id is read, and the
   * mailbox is derived from it.
   */
  board: { readonly id: string };
}

/**
 * The run source for coding runs on a board a project holds.
 *
 * Answers `{ kind: "repo", repo, projectId, files }` for a project with a
 * repository, `{ kind: "files", projectId, files }` for one with none, or a
 * refusal ({@link ProjectWorkspaceRefusalReason}).
 *
 * @param options `board`: the mailbox board whose rows the runs work.
 * @returns A `RunSource` to hand `localWorkspaceHost({ source })`.
 * @throws When built, if the board's id is not a mailbox board's
 *   (`<mailboxId>.<board>`). When asked, if the block asking does not hold
 *   {@link projectWorkspaceCapability}.
 * @example
 *   const work = mailboxBoard("eng.feature", "work");
 *   harnessManager({
 *     boardCollectionId: work.id,
 *     boardCollection: work,
 *     workspace: localWorkspaceHost({ root, remotes: { allow: ["github.com"] }, source: projectWorkspace({ board: work }) }),
 *     uses: [projectWorkspaceCapability],
 *     // ...
 *   });
 */
export function projectWorkspace(options: ProjectWorkspaceOptions): RunSource {
  const boardId = options.board.id;
  const dot = boardId.lastIndexOf(".");
  if (dot <= 0 || dot === boardId.length - 1) {
    throw new Error(
      `projectWorkspace: "${boardId}" is not a mailbox board's id (\`<mailboxId>.<board>\`), so it ` +
        `names no workstream to find a project by. Pass the board \`mailboxBoard\` returns.`
    );
  }
  const workstream = boardId.slice(0, dot);

  const source: RunSource = async (looseCtx): Promise<RunSourceAnswer> => {
    const ctx = looseCtx as unknown as BlockContext;
    const claims = collectionOn(ctx, WORKSTREAM_CLAIMS_RESOURCE);
    const projects = collectionOn(ctx, PROJECTS_RESOURCE);
    const files = collectionOn(ctx, PROJECT_FILES_RESOURCE) as ResourceCollectionRef<ProjectedEntryState>;

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
    // The bare user, not `identity.id`: that is the user record's storage key,
    // which carries the org.
    const owner = ctx.user?.identity?.userId;
    if (!isMember(project, owner)) {
      return refused(
        "not-a-member",
        `the run's owner${owner ? ` "${owner}"` : ""} is not a member of project "${projectId}", so it may not work on its files.`
      );
    }

    const kept = {
      collection: files,
      collectionId: collectionIdFor(defineProjectFilesCollection(), principalFromContext(ctx))
    };
    return project.repository == null
      ? { kind: "files", projectId, files: kept }
      : { kind: "repo", repo: project.repository, projectId, files: kept };
  };
  return source;
}

/** A refusal answer. */
function refused(reason: ProjectWorkspaceRefusalReason, message: string): RunSourceRefusal {
  return { kind: "refused", reason, message };
}

/** The collection at `accessor`, or a loud error naming the capability that installs it. */
function collectionOn(ctx: BlockContext, accessor: string): ResourceCollectionRef {
  const ref = (ctx.resources as Record<string, unknown> | undefined)?.[accessor];
  if (ref === undefined) {
    throw new Error(
      `projectWorkspace: the block asking for a run's source does not hold "${accessor}". ` +
        `Pass projectWorkspaceCapability on its \`uses\` (for harness-manager, \`harnessManager({ uses })\`).`
    );
  }
  return ref as ResourceCollectionRef;
}
