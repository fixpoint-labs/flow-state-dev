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
 * conversation's (1 or 2) is refused, never followed. The board writes that
 * project over the filer's (`../conversation-board/board`).
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
 * - `not-a-member`: the run's owner is
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
import {
  collectionIdFor,
  principalFromContext,
  type ProjectedEntryState,
  type RunSource,
  type RunSourceAnswer,
  type ScopePrincipal
} from "@flow-state-dev/workspace";
import { conversationLedgerResources } from "../conversation-board/ledger";
import {
  defineProjectFilesCollection,
  definePrivateProjectFilesCollection,
  type ProjectRow,
  type ProjectVisibility
} from "./collections";
import { repositoryProblem } from "./repository-value";
import { collectionAt, projectFilesAccessor, PROJECT_FILE_RESOURCES, PROJECT_ROW_RESOURCES } from "./project-address";
import { notHeld, runProjectOf } from "./run-project";
import { WORKSTREAM_RESOURCES } from "./workstream-collections";

export type { ProjectWorkspaceRefusalReason } from "./run-project";

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
  const source: RunSource = async (ctx): Promise<RunSourceAnswer> => {
    const found = await runProjectOf(ctx);
    if (found.kind === "refused") return found;
    return answerFor(ctx, found.visibility, found.project, checkouts);
  };
  return source;
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
