/**
 * A user's project coordinator (FIX-1793 S5): a session of the standard
 * coordinator worker the installation names, linked to one project when it is
 * created (its readonly `projectId`), one per user per project.
 *
 * **Its delegates are its user's open workstreams there.** One delegate record
 * per workstream the user has open in the project: the lead, with the
 * workstream's address as the record's target (`workstreamRef`), so two
 * workstreams led by one worker are two delegates. The records live where
 * every coordinator's do, in its server-written session state, and change
 * only two ways:
 *
 * - **When the session's list is first read**, it is seeded with a record per
 *   workstream its user has open there ({@link workstreamDelegateSeed}), as
 *   any worker's list is seeded with its defaults. Never after.
 * - **When a workstream opens, is marked done, or moves back out of done**,
 *   its entry path dispatches {@link WORKSTREAM_DELEGATE_ACTION} into the
 *   user's coordinator session, which adds or removes the one record
 *   ({@link workstreamDelegateEntry}). That entry is internal, and the public
 *   delegate actions take no target, so nothing else writes a record with one.
 *
 * A post reads its delegates from the session's state only, never from the
 * entries. A delivery to a record goes into the workstream's own session: the
 * session the user's entry names, resolved at delivery
 * ({@link resolveWorkstreamTarget}), on the lead's flow.
 *
 * **What it reads.** The project, every workstream's entry and the progress
 * worked out from them, through its `readProject` tool
 * ({@link projectCoordinatorTools}), which an app puts in its agent catalog
 * and the coordinator's file names in its `tools:`. Bob's entries included:
 * shared means the organization reads it. It hands work only to its user's.
 */
import { handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import type { DelegateChecker } from "../delegates/delegate-check";
import {
  changeDelegates,
  currentDelegates,
  delegateSessionStateSchema,
  sameDelegate,
  type DelegateDefaults,
  type DelegateRecord
} from "../delegates/delegate-list";
import { PROJECT_STATE_KEY } from "../workers/keys";
import type { ProjectAddress } from "./collections";
import { PROJECT_ROW_RESOURCES, workstreamsAt, type ResourcesContext } from "./project-address";
import { DONE_STATUS } from "./project-progress";
import { projectEntries, readProjectAt, readProjectOutputSchema } from "./project-read";
import { ProjectRefusedError } from "./project-refusal";
import { WORKSTREAM_RESOURCES, workstreamEntryKey, workstreamEntrySchema } from "./workstream-collections";
import { parseProjectRef, parseWorkstreamRef, workstreamRef } from "./workstream-ref";

/**
 * The coordinator's internal entry an entry path dispatches into the user's
 * coordinator session, to add or remove one workstream's record. **Pinned**:
 * the workstream writes name it.
 */
export const WORKSTREAM_DELEGATE_ACTION = "changeWorkstreamDelegate";

/** What a workstream's entry path hands its coordinator: the change, and the record. */
export const workstreamDelegateChangeSchema = z
  .object({
    change: z.enum(["add", "remove"]),
    /** The workstream's lead. */
    worker: z.string().min(1),
    /** The workstream's address, as `workstreamRef` writes it. */
    target: z.string().min(1)
  })
  .strict();

/** @see workstreamDelegateChangeSchema */
export type WorkstreamDelegateChange = z.infer<typeof workstreamDelegateChangeSchema>;

/** The slice of a block's context these read: its session, and the resources it declared. */
type CoordinatorContext = ResourcesContext & {
  readonly session: { readonly state: unknown; readonly identity: { readonly userId?: string } };
};

/** The project a session is linked to by its readonly `projectId`, or `undefined`. */
export function linkedProjectOf(state: unknown): ProjectAddress | undefined {
  const ref = (state as Record<string, unknown> | undefined)?.[PROJECT_STATE_KEY];
  return typeof ref === "string" ? parseProjectRef(ref) : undefined;
}

/** The session's user: a workstream's owner, when it is theirs. */
function userOf(ctx: CoordinatorContext): string {
  const user = ctx.session.identity.userId;
  if (user === undefined || user.length === 0) throw new Error("A project coordinator's session has no user.");
  return user;
}

/**
 * The records a project coordinator session starts with: one per workstream
 * its user has open in its project, the lead with the workstream's address,
 * oldest first. `undefined` for a session linked to no project. One prefix
 * read of the project's entries, the one its `readProject` tool makes.
 */
export async function workstreamDelegateSeed(ctx: CoordinatorContext): Promise<DelegateRecord[] | undefined> {
  const project = linkedProjectOf(ctx.session.state);
  if (project === undefined) return undefined;
  const user = userOf(ctx);
  return (await projectEntries(ctx, project))
    .filter((entry) => entry.owner === user && entry.status !== DONE_STATUS)
    .map((entry) => ({ worker: entry.lead, target: workstreamRef({ project, id: entry.id }) }));
}

/**
 * Why `record` can't be one of this session's workstream delegates now, or
 * the workstream's entry when it can: the target is a workstream of the
 * session's project that its user has open, led by the record's worker.
 */
async function workstreamOf(ctx: CoordinatorContext, record: { worker: string; target: string }) {
  const project = linkedProjectOf(ctx.session.state);
  if (project === undefined) {
    return { problem: "this conversation is linked to no project, so it has no workstream to hand work to" } as const;
  }
  const address = parseWorkstreamRef(record.target);
  if (address === undefined || address.project.visibility !== project.visibility || address.project.id !== project.id) {
    return { problem: `"${record.target}" is not a workstream of project "${project.id}"` } as const;
  }
  const stored = await workstreamsAt(ctx, project.visibility).getOptional(
    workstreamEntryKey(project.id, userOf(ctx), address.id)
  );
  if (stored === undefined) return { problem: `you have no workstream "${address.id}" in project "${project.id}"` } as const;
  const entry = workstreamEntrySchema.parse(stored.state);
  if (entry.lead !== record.worker) {
    return { problem: `workstream "${address.id}" is led by "${entry.lead}", not "${record.worker}"` } as const;
  }
  if (entry.status === DONE_STATUS) return { problem: `workstream "${address.id}" is done, and done work takes no more` } as const;
  return { entry } as const;
}

/**
 * The session a delivery to a workstream delegate goes into: the one the
 * user's entry names, which only the workstream's open created and linked.
 * Or why it can't take the post now.
 */
export async function resolveWorkstreamTarget(
  ctx: CoordinatorContext,
  record: { worker: string; target: string }
): Promise<{ sessionId: string } | { problem: string }> {
  const found = await workstreamOf(ctx, record);
  if ("problem" in found) return { problem: found.problem as string };
  if (found.entry.sessionId == null) return { problem: `workstream "${record.target}" has no session of its lead yet` };
  return { sessionId: found.entry.sessionId };
}

/**
 * The coordinator's internal entry for one workstream's record
 * ({@link WORKSTREAM_DELEGATE_ACTION}): add it, or remove it, as one
 * versioned write of the session's delegate list. An add is checked first:
 * the workstream is the session's user's, in its project, open, and led by
 * the record's worker, and the worker passes the one delegate check. A
 * record already there, or already gone, changes nothing. Refused: an add
 * that fails a check, and one past the cap.
 *
 * @param options The flow's delegate check, and its defaults with the seed.
 */
export function workstreamDelegateEntry(options: {
  check: DelegateChecker;
  defaults: (ctx: BlockContext) => Promise<DelegateDefaults>;
}) {
  const block = handler({
    name: "coordinator-workstream-delegate",
    inputSchema: workstreamDelegateChangeSchema,
    outputSchema: z.object({ changed: z.boolean() }),
    resources: { ...WORKSTREAM_RESOURCES },
    sessionStateSchema: delegateSessionStateSchema,
    execute: async (input: WorkstreamDelegateChange, ctx) => {
      const record: DelegateRecord = { worker: input.worker, target: input.target };
      if (input.change === "add") {
        const found = await workstreamOf(ctx as never, record as { worker: string; target: string });
        if ("problem" in found) throw new ProjectRefusedError("no-such-workstream", `${found.problem}.`);
        const checked = await options.check(ctx as never, record.worker, "add");
        if (!checked.ok) throw new Error(checked.message);
      }
      const defaults = await options.defaults(ctx as never);
      const outcome = await changeDelegates(ctx.session, defaults, input.change === "add" ? { add: record } : { remove: record });
      if (outcome.ok) return { changed: true };
      // Already there, or already gone: the list is as this change wants it.
      const listed = currentDelegates(ctx.session.state, defaults).delegates.some((held) => sameDelegate(held, record));
      if (listed === (input.change === "add")) return { changed: false };
      throw new Error(outcome.message);
    }
  });
  return { inputSchema: workstreamDelegateChangeSchema, block };
}

/**
 * A project coordinator's `readProject` tool: the project its session is
 * linked to, every workstream's entry and the progress worked out from them.
 */
const readLinkedProject = handler({
  name: "readProject",
  description:
    "Read the project this conversation is about: its title and brief, every workstream in it (whose it is, " +
    "who leads it, its status, due date and objectives, and when it was last updated), and its progress. " +
    "Answer how the project is going from this, never from memory.",
  inputSchema: z.object({}).strict(),
  outputSchema: readProjectOutputSchema,
  resources: { ...PROJECT_ROW_RESOURCES, ...WORKSTREAM_RESOURCES },
  execute: async (_input, ctx) => {
    const project = linkedProjectOf(ctx.session.state);
    if (project === undefined) {
      throw new ProjectRefusedError("no-such-project", "this conversation is linked to no project.");
    }
    return readProjectAt(ctx, project);
  }
});

/**
 * The tools a project coordinator's file can name, by key: put them in the
 * agent catalog the coordinator flow is built with
 * (`defineCoordinatorFlow({ agent: { catalog } })`), and list `readProject`
 * in the project coordinator's `tools:`. Handing work to a workstream is the
 * coordinator's own `handOff`, by the workstream's delegate record.
 */
export const projectCoordinatorTools = { readProject: readLinkedProject } as const;
