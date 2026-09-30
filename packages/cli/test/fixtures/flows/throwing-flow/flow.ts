/**
 * Test fixture: a flow whose actions fail, for error handling tests.
 * `fail` throws in its block; `answerThenHookFails` answers, then its
 * completion hook throws, so the run fails after the action answered.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

const throwingHandler = handler({
  name: "throwing-handler",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  execute: async () => {
    throw new Error("Intentional test error from flow");
  },
});

const answeringHandler = handler({
  name: "answering-handler",
  inputSchema: z.object({ message: z.string() }),
  execute: async () => ({ ok: false, error: "already settled" }),
});

const throwingHook = handler({
  name: "throwing-hook",
  execute: async () => {
    throw new Error("Intentional completion hook error");
  },
});

const throwingFlow = defineFlow({
  kind: "throwing",
  actions: {
    fail: {
      inputSchema: z.object({ message: z.string() }),
      block: throwingHandler,
    },
    answerThenHookFails: {
      inputSchema: z.object({ message: z.string() }),
      block: answeringHandler,
      onCompleted: throwingHook,
    },
  },
});

const flow = throwingFlow();

export default flow;
