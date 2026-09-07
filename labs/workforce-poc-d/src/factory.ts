/**
 * Lab-local seat factory — L2 convention on today's `defineAgent` + `defineFlow`.
 *
 * Not a `loadWorkforce()` export. Not a second registry. A seat file becomes
 * one Agent (for `createAgentRegistry`) and one worker `defineFlow` (for
 * `createFlowState` / `FlowRegistry`). `materializeAgent` still emits a
 * generator; the worker contract is the flow, same as lab A.
 */
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { Agent } from "@flow-state-dev/core";
import { defineAgent } from "@flow-state-dev/workforce";
import { z } from "zod";

export const sessionStateSchema = z.object({
  lastTalk: z.string().nullable().default(null),
  lastWake: z
    .object({
      body: z.string(),
      fromSessionId: z.string()
    })
    .nullable()
    .default(null)
});

const wakeInputSchema = z.object({
  sessionId: z.string(),
  body: z.string(),
  fromSessionId: z.string()
});

export const seatFileSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  persona: z.string().min(1),
  model: z.string().optional(),
  role: z.string().optional(),
  personality: z.string().optional(),
  tools: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional()
});

export type SeatConfig = z.infer<typeof seatFileSchema>;

/** Turn a seat file into today's Agent. Same type `createAgentRegistry` takes. */
export function seatToAgent(seat: SeatConfig): Agent {
  return defineAgent({
    name: seat.name,
    description: seat.description,
    persona: seat.persona,
    model: seat.model,
    allowedTools: seat.tools
  });
}

/**
 * Emit one worker flow of the lab A contract shape: talk (DM), deliver
 * (one hop), whoami. Internal `receive` is the only entry `dispatcher()` wakes.
 */
export function seatToWorkerFlow(seat: SeatConfig): FlowInstance {
  const whoami = handler({
    name: `${seat.name}-whoami`,
    inputSchema: z.object({}),
    outputSchema: z.object({
      kind: z.string(),
      description: z.string(),
      persona: z.string(),
      tools: z.array(z.string()),
      skills: z.array(z.string())
    }),
    execute: async () => ({
      kind: seat.name,
      description: seat.description,
      persona: seat.persona,
      tools: [...(seat.tools ?? [])],
      skills: [...(seat.skills ?? [])]
    })
  });

  const talk = handler({
    name: `${seat.name}-talk`,
    inputSchema: z.object({ message: z.string() }),
    outputSchema: z.object({ sessionId: z.string(), heard: z.string() }),
    sessionStateSchema,
    execute: async (input, ctx) => {
      await ctx.session.patchState({ lastTalk: input.message });
      return { sessionId: ctx.session.identity.id, heard: input.message };
    }
  });

  const receive = handler({
    name: `${seat.name}-receive`,
    inputSchema: z.object({
      body: z.string(),
      fromSessionId: z.string()
    }),
    outputSchema: z.object({ sessionId: z.string() }),
    sessionStateSchema,
    execute: async (input, ctx) => {
      await ctx.session.patchState({ lastWake: input });
      return { sessionId: ctx.session.identity.id };
    }
  });

  const deliver = dispatcher({
    name: `${seat.name}-deliver`,
    type: "internal",
    target: "receive",
    inputSchema: wakeInputSchema,
    session: { id: (input) => input.sessionId },
    payload: (input) => ({
      body: input.body,
      fromSessionId: input.fromSessionId
    })
  });

  return defineFlow({
    kind: seat.name,
    session: { stateSchema: sessionStateSchema },
    actions: {
      whoami: { block: whoami },
      talk: { block: talk },
      deliver: { block: deliver }
    },
    internal: {
      actions: {
        receive: { block: receive }
      }
    }
  })({ id: seat.name });
}
