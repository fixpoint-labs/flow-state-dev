/**
 * `sessionFields` declares app fields on a worker session only through the
 * installation's session: an agent flow given fields and no installation has
 * no session to put them on, so it refuses, rather than leaving a field the
 * app thinks the server owns open to a seeded create.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineAgentWorkerFlow } from "../src/agent-worker-flow";

describe("sessionFields on the agent flow", () => {
  it("refuses session fields with no installation, naming both", () => {
    expect(() => defineAgentWorkerFlow({ sessionFields: { repositoryId: z.string().optional() } })).toThrow(
      /`sessionFields` \("repositoryId"\) needs `installation`/,
    );
  });
});
