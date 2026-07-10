// Scaffold smoke test — proves the Knowledge Hub flow is registerable and its
// one `ping` action runs through the real `runAction` engine. Keeps CI green
// on the empty scaffold until FIX-882 replaces `ping` with real capture actions.

import { describe, expect, it } from "vitest";
import { testFlow } from "@flow-state-dev/testing";
import knowledgeHubFlow from "../src/flow";

describe("knowledge-hub scaffold", () => {
  it("runs the ping action and echoes its input", async () => {
    const result = await testFlow({
      flow: knowledgeHubFlow,
      action: "ping",
      userId: "cli-user",
      input: { message: "hi" },
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");
    expect(result.output).toEqual({ ok: true, echo: "hi" });
  });
});
