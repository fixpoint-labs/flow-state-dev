/**
 * Member worker — same contract as intake, different flow kind.
 * Picks up work the intake worker filed on the shared board.
 * A wake from the intake flow into this session is the named gap.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { BOARD_NAME, intakeBoard, routePayloadSchema } from "./board";
import { MEMBER_KIND } from "./roster";

export const memberSessionSchema = z.object({
  lastPickup: z
    .object({
      taskId: z.string(),
      body: z.string(),
      route: z.enum(["claim", "ordered", "fan-out"]),
    })
    .nullable()
    .default(null),
});

export const pickupInputSchema = z.object({
  seat: z.string(),
  taskId: z.string().optional(),
});

export const pickupOutputSchema = z.object({
  sessionId: z.string(),
  seat: z.string(),
  claimed: z.boolean(),
  taskId: z.string().optional(),
  reason: z.string(),
});

const pickup = handler({
  name: "member-pickup",
  inputSchema: pickupInputSchema,
  outputSchema: pickupOutputSchema,
  sessionStateSchema: memberSessionSchema,
  uses: [intakeBoard.capability],
  execute: async (input, ctx) => {
    const collection = await ctx.cap[BOARD_NAME].tasks();
    const claimed = await collection.claim(input.seat, {
      eligibility: (task) =>
        task.assignee === input.seat &&
        (input.taskId === undefined || task.id === input.taskId),
    });
    if (claimed === null) {
      return {
        sessionId: ctx.session.identity.id,
        seat: input.seat,
        claimed: false,
        reason: "not-claimable",
      };
    }
    const payload = routePayloadSchema.parse(claimed.input ?? {});
    await collection.complete(claimed.id, {
      seat: input.seat,
      text: `reply from ${input.seat}`,
    });
    await ctx.session.patchState({
      lastPickup: {
        taskId: claimed.id,
        body: payload.body,
        route: payload.route,
      },
    });
    return {
      sessionId: ctx.session.identity.id,
      seat: input.seat,
      claimed: true,
      taskId: claimed.id,
      reason: "claimed",
    };
  },
});

export const memberFlow = defineFlow({
  kind: MEMBER_KIND,
  session: { stateSchema: memberSessionSchema },
  actions: {
    pickup: { block: pickup },
  },
})({ id: "member" });
