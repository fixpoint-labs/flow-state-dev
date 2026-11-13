/**
 * `sessionFields` declares app fields on a worker session only through the
 * installation's session: an agent flow given fields and no installation has
 * no session to put them on, so it refuses, rather than leaving a field the
 * app thinks the server owns open to a seeded create.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { defineCoordinatorFlow } from "../src/coordinator/coordinator-flow";
import { createWorkerInstallation } from "../src/workers/installation";

describe("sessionFields on the agent flow", () => {
  it("refuses session fields with no installation, naming both", () => {
    expect(() => defineAgentWorkerFlow({ sessionFields: { repositoryId: z.string().optional() } })).toThrow(
      /`sessionFields` \("repositoryId"\) needs `installation`/,
    );
  });

  it("refuses session fields on the coordinator's agent options: the coordinator's own option is the one place", () => {
    const installation = createWorkerInstallation({ standardWorkers: [] });
    const nested = { sessionFields: { repositoryId: z.string().optional() } } as never;
    expect(() => defineCoordinatorFlow({ installation, routeModel: "openai/gpt-6-luna", agent: nested })).toThrow(
      /`agent.sessionFields`.*`sessionFields`/,
    );
  });
});
