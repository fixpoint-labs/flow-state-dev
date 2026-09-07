/**
 * Intake worker — a thin sequencer flow. Address-the-team is this
 * worker's static DM. Not a TeamFlow. Not a fifth block kind.
 */
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { BOARD_NAME, intakeBoard } from "./board";
import { fileRoute } from "./helpers";
import { INTAKE_KIND, ROSTERS } from "./roster";

export const intakeSessionSchema = z.object({
  lastTalk: z.string().nullable().default(null),
  lastRoute: z
    .object({
      route: z.enum(["claim", "ordered", "fan-out"]),
      postId: z.string(),
      taskIds: z.array(z.string()),
      roster: z.string(),
    })
    .nullable()
    .default(null),
});

export const talkInputSchema = z.object({
  message: z.string(),
  roster: z.string(),
  postId: z.string().optional(),
});

export const talkOutputSchema = z.object({
  sessionId: z.string(),
  roster: z.string(),
  route: z.enum(["claim", "ordered", "fan-out"]),
  postId: z.string(),
  taskIds: z.array(z.string()),
  seat: z.string().optional(),
});

const talk = handler({
  name: "intake-talk",
  inputSchema: talkInputSchema,
  outputSchema: talkOutputSchema,
  sessionStateSchema: intakeSessionSchema,
  uses: [intakeBoard.capability],
  execute: async (input, ctx) => {
    const roster = ROSTERS[input.roster];
    if (roster === undefined) {
      throw new Error(`unknown roster "${input.roster}"`);
    }
    const collection = await ctx.cap[BOARD_NAME].tasks();
    const postId = input.postId ?? `post_${ctx.request.identity.id}`;
    const filed = await fileRoute({
      collection,
      postId,
      body: input.message,
      roster,
    });
    await ctx.session.patchState({
      lastTalk: input.message,
      lastRoute: {
        route: filed.route,
        postId,
        taskIds: filed.taskIds,
        roster: input.roster,
      },
    });
    return {
      sessionId: ctx.session.identity.id,
      roster: input.roster,
      route: filed.route,
      postId,
      taskIds: filed.taskIds,
      ...(filed.seat !== undefined ? { seat: filed.seat } : {}),
    };
  },
});

const inspect = handler({
  name: "intake-inspect",
  inputSchema: z.object({}),
  outputSchema: z.object({
    tasks: z.array(
      z.object({
        id: z.string(),
        status: z.string(),
        assignee: z.string().optional(),
        deps: z.array(z.string()).optional(),
      }),
    ),
  }),
  uses: [intakeBoard.capability],
  execute: async (_input, ctx) => {
    const collection = await ctx.cap[BOARD_NAME].tasks();
    return {
      tasks: collection.list().map((task) => ({
        id: task.id,
        status: task.status,
        ...(task.assignee !== undefined ? { assignee: task.assignee } : {}),
        ...(task.deps !== undefined ? { deps: task.deps } : {}),
      })),
    };
  },
});

/**
 * Same-flow wake into a named session. Used only to prove that a
 * member-flow session is session-not-addressable from this worker.
 */
const receive = handler({
  name: "intake-receive",
  inputSchema: z.object({
    postId: z.string(),
    body: z.string(),
    fromSessionId: z.string(),
  }),
  outputSchema: z.object({ sessionId: z.string() }),
  sessionStateSchema: intakeSessionSchema,
  execute: async (_input, ctx) => {
    return { sessionId: ctx.session.identity.id };
  },
});

export const wakeInputSchema = z.object({
  sessionId: z.string(),
  postId: z.string(),
  body: z.string(),
  fromSessionId: z.string(),
});

const wakeMember = dispatcher({
  name: "intake-wake-member",
  type: "internal",
  target: "receive",
  inputSchema: wakeInputSchema,
  session: { id: (input) => input.sessionId },
  payload: (input) => ({
    postId: input.postId,
    body: input.body,
    fromSessionId: input.fromSessionId,
  }),
});

export const intakeFlow = defineFlow({
  kind: INTAKE_KIND,
  session: { stateSchema: intakeSessionSchema },
  actions: {
    talk: { block: talk },
    inspect: { block: inspect },
    wake: { block: wakeMember },
  },
  internal: {
    actions: {
      receive: { block: receive },
    },
  },
})({ id: "intake" });
