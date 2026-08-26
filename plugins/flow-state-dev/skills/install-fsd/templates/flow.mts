// fsd:generated
import { defineFlow, generator } from "@flow-state-dev/core";
import {
  createBearerSecretPrincipalResolver,
  PrincipalResolutionError,
} from "@flow-state-dev/engine";
import { z } from "zod";

const inputSchema = z.object({
  userId: z.string(),
  message: z.string(),
});

const chat = generator({
  name: "chat",
  model: "intent/chat",
  prompt: "You are a helpful assistant.",
  inputSchema,
  history: true,
  user: (input) => input.message,
});

function resolveDemoPrincipal(context: { request?: Request }) {
  const secret = process.env.FSD_DEMO_TOKEN;
  if (!secret) {
    throw new PrincipalResolutionError("Demo flow is closed. Set FSD_DEMO_TOKEN.", {
      status: 401,
    });
  }
  return createBearerSecretPrincipalResolver({
    secret,
    principal: { userId: "demo" },
  })(context);
}

export default defineFlow({
  kind: "hello",
  authentication: {
    resolvePrincipal: resolveDemoPrincipal,
    requireUser: true,
  },
  actions: {
    send: {
      inputSchema,
      block: chat,
      userMessage: (input) => input.message,
    },
  },
  session: {
    stateSchema: z.object({}),
  },
})();
