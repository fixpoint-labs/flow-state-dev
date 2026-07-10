// ---------------------------------------------------------------------------
// Knowledge Hub lab — scaffold flow (FIX-881).
//
// An empty starting point for the Knowledge Hub (FIX-882–884). The single
// `ping` action exists only so the package compiles and `fsdev run` proves the
// wiring end to end; the real capture / staging / sweeper / workforce actions
// land in the follow-on issues. `ping` is a pure echo of its input — it never
// touches `ctx`, so the scaffold carries no handler-context typing to inherit.
// ---------------------------------------------------------------------------

import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

const pingHandler = handler({
  name: "ping",
  inputSchema: z.object({ message: z.string().default("hello") }),
  outputSchema: z.object({ ok: z.boolean(), echo: z.string() }),
  execute: async (input) => ({ ok: true, echo: input.message }),
});

const knowledgeHubFlow = defineFlow({
  kind: "knowledge-hub",
  requireUser: false,
  actions: {
    ping: {
      block: pingHandler,
      description: "Scaffold no-op: echoes its input to prove the flow runs.",
    },
  },
});

export default knowledgeHubFlow({ id: "default" });
