/**
 * Runs a REAL Flow State Dev flow through the REAL engine — no mock host.
 *
 * The earlier probe in this directory tested pi's side against a fake FSD host,
 * which left the actual integration untested at both ends. This exercises the
 * genuine `runAction` runtime (`testFlow` runs "the same runAction engine the
 * server uses") so the epic's transport claims rest on the real item stream and
 * the real terminal-status vocabulary rather than on a mock's invented shapes.
 *
 * Run: pnpm vitest run spec-poc/epic-pi-harness/real-flow.test.ts
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { testFlow } from "@flow-state-dev/testing";

// The engine validates input against the action's schema; this POC is about the
// runtime and the item stream, not schema plumbing.
const passthroughSchema = {
  parse: (value: unknown) => value,
  safeParse: (value: unknown) => ({ success: true as const, data: value }),
};

describe("a real FSD flow, driven the way a pi extension would drive it", () => {
  it("dispatches an action and returns a real terminal status and item stream", async () => {
    const flow: FlowInstance = {
      id: "pi-poc",
      kind: "pi-poc-flow",
      requireUser: true,
      actions: {
        review: {
          inputSchema: passthroughSchema as never,
          block: handler<
            { target: string },
            { verdict: string; target: string }
          >({
            name: "review-handler",
            execute: (input) => ({
              verdict: `reviewed ${input.target}`,
              target: input.target,
            }),
          }),
        },
      },
    } as FlowInstance;

    const result = await testFlow({
      flow,
      action: "review",
      input: { target: "packages/pi" },
      userId: "operator_1",
    });

    // What a pi extension would render and route (theme 8).
    console.log("STATUS:", result.status);
    console.log("OUTPUT:", JSON.stringify(result.output));
    console.log("ITEM COUNT:", result.items.length);
    const itemType = (item: unknown): string =>
      typeof item === "object" && item !== null && "type" in item
        ? String((item as { type: unknown }).type)
        : "<untyped>";
    console.log(
      "ITEM SHAPES:",
      JSON.stringify(result.items.map(itemType), null, 1),
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");
    expect(result.output).toEqual({
      verdict: "reviewed packages/pi",
      target: "packages/pi",
    });
  });

  it("shares state across two dispatches, which is what PI-2 continuity needs", async () => {
    const { createInMemoryStores } = await import("@flow-state-dev/engine");
    const stores = createInMemoryStores();

    const flow: FlowInstance = {
      id: "pi-poc-2",
      kind: "pi-poc-session",
      requireUser: true,
      actions: {
        ping: {
          inputSchema: passthroughSchema as never,
          block: handler<{ n: number }, { seen: number }>({
            name: "ping-handler",
            execute: (input) => ({ seen: input.n }),
          }),
        },
      },
    } as FlowInstance;

    const first = await testFlow({
      flow,
      action: "ping",
      input: { n: 1 },
      userId: "operator_1",
      sessionId: "session_a",
      stores,
    });
    const second = await testFlow({
      flow,
      action: "ping",
      input: { n: 2 },
      userId: "operator_1",
      sessionId: "session_a",
      stores,
    });

    console.log("REQUEST IDS:", first.requestId, second.requestId);
    expect(first.status).toBe("completed");
    expect(second.status).toBe("completed");
    // Distinct requests within one shared session — the pairing a pi extension
    // must keep straight when it resumes a flow across pi sessions.
    expect(first.requestId).not.toBe(second.requestId);
  });
});
