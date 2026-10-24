/**
 * The work-project action (FIX-2161): how a user sets the project one of
 * their own conversations with a worker works in, a new session of the worker
 * or the worker's one default conversation, from the screen.
 *
 * Declared on every worker flow, beside the standing-rules action, and run in
 * the conversation it sets. It writes the session's server-owned
 * `workProjectId`, which `filingProjectOf` reads, so the conversation's runs
 * and the tasks it files work in that project. It admits only:
 *
 * - the session's own user, on a project they may work in: a member of a
 *   shared one, the owner of a private one, the rule `runProjectOf` checks
 *   at every run;
 * - a user's own conversation: never the project coordinator's, a task's,
 *   a delegate's or a workstream lead's session, which take their project
 *   from where they were created, filed or opened.
 *
 * The input names the project and nothing else (BP-031). A refusal fails the
 * request with its reason and stores nothing. Setting another project later
 * replaces it; the tasks already filed keep the one stamped on their rows.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  FILING_PROJECT_STATE_KEY,
  FILING_SESSION_STATE_KEY,
  FILING_WORKSTREAM_STATE_KEY,
  PROJECT_STATE_KEY,
  TASK_ID_STATE_KEY,
  WORK_PROJECT_STATE_KEY,
  WORKER_ID_STATE_KEY,
  WORKSTREAM_STATE_KEY
} from "../workers/keys";
import { projectAddressSchema, projectRowSchema } from "./collections";
import { isMember } from "./membership-gate";
import { PROJECT_ROW_RESOURCES, projectRowsAt } from "./project-address";
import { projectRef } from "./workstream-ref";

/**
 * What the action takes: the project, by visibility and id, and the worker
 * the caller means the session to run, which it must. `worker` is a check on
 * the caller's intent, which the workforce client always sends, not a
 * boundary: a caller that leaves it out sets whichever of its own sessions it
 * names.
 */
export const setWorkProjectInputSchema = z.object({ project: projectAddressSchema, worker: z.string().min(1).optional() }).strict();

export type SetWorkProjectInput = z.infer<typeof setWorkProjectInputSchema>;

/** What the action answers: the project the conversation now works in. */
export const setWorkProjectOutputSchema = z.object({ project: projectAddressSchema });

export type SetWorkProjectOutput = z.infer<typeof setWorkProjectOutputSchema>;

/**
 * The session fields that make a session someone else's than the user's own conversation, and what
 * each one is. A task session carries `taskId` and `filingProjectId` both, and a step's session
 * `taskId` alone; each is listed, so either one refuses.
 */
const LINKED: ReadonlyArray<readonly [string, string]> = [
  [PROJECT_STATE_KEY, "a project coordinator's session, which is linked to its project when it is created"],
  [TASK_ID_STATE_KEY, "a task's session, which works in the project its task was filed in"],
  [FILING_PROJECT_STATE_KEY, "a task's session, which works in the project its task was filed in"],
  [FILING_WORKSTREAM_STATE_KEY, "a task's session, which works in its workstream's project"],
  [FILING_SESSION_STATE_KEY, "a delegate's session, which works in the project of the task it holds"],
  [WORKSTREAM_STATE_KEY, "a workstream lead's session, which works in its workstream's project"]
];

function refuse(message: string): never {
  throw new Error(`Refused: ${message}`);
}

/**
 * The action's block, refusing too each session `otherSession` names as not
 * the user's own conversation: sessions a flow's own code opens, which carry
 * none of the fields above (the Error Reporter's report sessions).
 *
 * @param otherSession What a session that isn't the user's own conversation
 *   is, by its id, for the refusal; `undefined` admits it.
 */
export function defineSetWorkProjectBlock(otherSession: (sessionId: string) => string | undefined = () => undefined) {
  return handler({
    name: "set-work-project",
    inputSchema: setWorkProjectInputSchema,
    outputSchema: setWorkProjectOutputSchema,
    resources: { ...PROJECT_ROW_RESOURCES },
    execute: async (input, ctx) => {
      const state = (ctx.session.state ?? {}) as Record<string, unknown>;
      const running = state[WORKER_ID_STATE_KEY];
      if (typeof running !== "string") refuse("this session runs no worker, so it has no project to set.");
      if (input.worker !== undefined && input.worker !== running) {
        refuse(`this session runs "${running}", not "${input.worker}". Name the session's own worker.`);
      }
      for (const [key, what] of LINKED) {
        if (state[key] !== undefined) refuse(`this is ${what}. Its project can't be set.`);
      }
      const other = otherSession(ctx.session.identity.id);
      if (other !== undefined) refuse(`this is ${other}. Its project can't be set.`);
      const user = ctx.user?.identity?.userId;
      const owner = ctx.session.identity.userId;
      if (user === undefined || user !== owner) refuse("only the session's own user sets the project it works in.");
      const { visibility, id } = input.project;
      const stored = await projectRowsAt(ctx, visibility).getOptional(id);
      if (stored === undefined) {
        refuse(
          visibility === "private" ? `you have no private project "${id}".` : `this organization has no project "${id}" you can read.`
        );
      }
      const row = projectRowSchema.parse(stored.state);
      const allowed = visibility === "private" ? row.ownerUserId === user : isMember(row, user);
      if (!allowed) refuse(`not-a-member: "${user}" is not a member of project "${id}", so this conversation can't work in it.`);
      await ctx.session.patchState({ [WORK_PROJECT_STATE_KEY]: projectRef(input.project) });
      return { project: input.project };
    }
  });
}

/** The action's block, for a flow whose every session runs a worker for its user. */
const setWorkProjectBlock = defineSetWorkProjectBlock();

/** The action, as a worker flow declares it under `SET_WORK_PROJECT_ACTION`. */
export const setWorkProjectAction = { inputSchema: setWorkProjectInputSchema, block: setWorkProjectBlock };
