/**
 * The project a coding run works on, and the user it works for: the one
 * reader both of a run's project answers come from, `projectWorkspace()`
 * (where its files are) and `projectMcpTools()` (which MCP servers it gets).
 *
 * It finds the project in this order, first match wins (the steps are
 * documented in full on `project-workspace.ts`):
 *
 * 1. the workstream the run's session leads, or the one its task was filed
 *    from (`workstreamId` / `filingWorkstreamId`);
 * 2. the session's own project: the project coordinator's (`projectId`), the
 *    one its user set (`workProjectId`), or the one its task was filed from
 *    (`filingProjectId`);
 * 3. the held task's: the project its row was stamped with when it was filed
 *    (a delegate's ongoing session has none of its own), else the one it
 *    names in `input.project`, by visibility and id.
 *
 * Every step reads stored, server-written data (BP-031): the session's
 * server-written fields, the held row's filing stamp, the workstream entry, the project row and the row the
 * claim gate verified for this run. The owner is the request's resolved user,
 * checked against the project's members on every path (and, for a workstream,
 * against its owner first), never a field of the task or a hand-over's payload.
 */

import type { LooseBlockContext } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import type { RunSourceRefusal } from "@flow-state-dev/workspace";
import { filingProjectAddressOf, filingProjectOf, filingWorkstreamOf } from "../conversation-board/filing-session";
import { filedProjectOf, claimedTask } from "../conversation-board/held-task";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { projectAddressSchema, projectRowSchema, type ProjectAddress, type ProjectRow, type ProjectVisibility } from "./collections";
import { isMember } from "./membership-gate";
import { projectRowsAt, workstreamsAt, type MissingCollection } from "./project-address";
import { workstreamEntryKey } from "./workstream-collections";
import { parseProjectRef, parseWorkstreamRef, type WorkstreamAddress } from "./workstream-ref";

/**
 * Why a run's project lookup refused. The refusal's `message` names the
 * workstream, the project or the users.
 */
export type ProjectWorkspaceRefusalReason =
  | "no-project"
  | "no-such-workstream"
  | "no-such-project"
  | "not-the-owner"
  | "not-a-member"
  | "other-project";

/** The project a run works on, where it lives, and the user the run works for. */
export interface RunProject {
  readonly kind: "found";
  readonly visibility: ProjectVisibility;
  readonly project: ProjectRow;
  /** The run's owner: the request's resolved user, allowed on the project. */
  readonly owner: string;
}

/**
 * Find the project a run works on, or refuse.
 *
 * @param ctx The context of the block asking. It must hold the collections
 *   `projectWorkspaceCapability` installs.
 * @returns The project, its visibility and the run's owner, or a refusal.
 */
export async function runProjectOf(ctx: LooseBlockContext): Promise<RunProject | RunSourceRefusal> {
  const held = (await claimedTask(ctx as unknown as BlockContext))?.row;
  const named = namedProjectOf(held);
  if (named.kind === "malformed") return named.refusal;
  // The session's project address is the one the board writes on a task it
  // files (`filingProjectAddressOf`), so the two can't disagree.
  const state = ctx.session?.state;
  const own = filingProjectAddressOf(state);
  const link = filingWorkstreamOf(state);
  if (link !== undefined) return otherProject(named, own) ?? fromWorkstream(ctx, link);
  const filedIn = filingProjectOf(state);
  if (filedIn !== undefined) {
    if (own === undefined) return refused("no-project", `this run's session names project "${filedIn}", which names no project.`);
    return otherProject(named, own) ?? fromProject(ctx, own);
  }
  // The project the held task was filed in (FIX-2161), kept on its row.
  const stamped = filedProjectOf(held);
  if (stamped !== undefined) {
    const address = parseProjectRef(stamped);
    if (address === undefined) return refused("no-project", `the task was filed in project "${stamped}", which names no project.`);
    return otherProject(named, address) ?? fromProject(ctx, address);
  }
  if (named.kind === "named") return fromProject(ctx, named.address);
  return refused(
    "no-project",
    "this run's session works for no workstream or project, and its task names none, so its coding runs have " +
      "nowhere to keep their files. Set the project of the conversation that files it (listProjects, then " +
      "setWorkProject), then file the task again."
  );
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
 * link names this request (`claimedTask`). Never the dispatch's payload. A run
 * outside a conversation's task session names none.
 */
function namedProjectOf(held: Task | undefined): NamedProject {
  const input = held?.input as { project?: unknown } | null | undefined;
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
async function fromWorkstream(ctx: LooseBlockContext, link: string): Promise<RunProject | RunSourceRefusal> {
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
  const row = projectRowSchema.parse(stored.state);
  // The same check the project path makes: an owner taken off the project loses its runs.
  if (!mayWorkOn(project.visibility, row, owner)) return notAMember(owner, project.id);
  return { kind: "found", visibility: project.visibility, project: row, owner };
}

/**
 * A run on the project at `address`: the one its conversation belongs to, or
 * the one its task names. The row is read at the address's visibility (a
 * private project in the run owner's own scope), and the run's owner must be
 * one of a shared project's members, or a private project's owner.
 */
async function fromProject(ctx: LooseBlockContext, address: ProjectAddress): Promise<RunProject | RunSourceRefusal> {
  const stored = await projectRowsAt(ctx, address.visibility, notHeld).getOptional(address.id);
  if (stored === undefined) {
    return refused("no-project", `there is no ${address.visibility} project "${address.id}" this run can work in.`);
  }
  const project = projectRowSchema.parse(stored.state);
  const owner = runOwnerOf(ctx);
  if (owner === undefined || !mayWorkOn(address.visibility, project, owner)) return notAMember(owner, address.id);
  return { kind: "found", visibility: address.visibility, project, owner };
}

/** Whether `owner` may work on `project`: one of a shared project's members, or a private project's owner. */
function mayWorkOn(visibility: ProjectVisibility, project: ProjectRow, owner: string): boolean {
  return visibility === "private" ? project.ownerUserId === owner : isMember(project, owner);
}

/** The refusal for a run whose owner may not work on the project. */
function notAMember(owner: string | undefined, projectId: string): RunSourceRefusal {
  return refused(
    "not-a-member",
    `the run's owner${owner ? ` "${owner}"` : ""} is not a member of project "${projectId}", so it may not work on its files.`
  );
}

/** A refusal answer. */
export function refused(reason: ProjectWorkspaceRefusalReason, message: string): RunSourceRefusal {
  return { kind: "refused", reason, message };
}

/** A block asking for a run's project that lacks a collection: name the capability that installs it. */
export const notHeld: MissingCollection = (accessor) =>
  `projectWorkspace: the block asking for a run's source does not hold "${accessor}". ` +
  `Pass projectWorkspaceCapability on its \`uses\` (for harness-manager, \`harnessManager({ uses })\`).`;
