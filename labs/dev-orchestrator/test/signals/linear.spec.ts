/**
 * Tests for LinearStatusClient over a fake transport. The deterministic read /
 * idempotent-transition / comment behaviors are what the driver relies on; the
 * GraphQL default transport is network I/O and is verified by the manual smoke
 * test, not here.
 */
import { describe, expect, it, vi } from "vitest";
import { LinearStatusClient, type LinearTransport } from "../../src/signals/linear";

/** In-memory transport: a single issue's state plus recorded comments. */
function fakeTransport(initialState: string | null): LinearTransport & {
  comments: string[];
  setCalls: string[];
} {
  let state = initialState;
  const comments: string[] = [];
  const setCalls: string[] = [];
  return {
    comments,
    setCalls,
    async getIssueState() {
      return state;
    },
    async setIssueState(_issueId, stateName) {
      setCalls.push(stateName);
      state = stateName;
    },
    async comment(_issueId, body) {
      comments.push(body);
    },
  };
}

describe("LinearStatusClient.getState", () => {
  it("returns the transport's current state", async () => {
    const client = new LinearStatusClient(fakeTransport("In Spec Review"));
    expect(await client.getState("FIX-1")).toBe("In Spec Review");
  });

  it("returns null for an unknown issue", async () => {
    const client = new LinearStatusClient(fakeTransport(null));
    expect(await client.getState("FIX-404")).toBeNull();
  });
});

describe("LinearStatusClient.transitionTo — idempotent", () => {
  it("writes when the target differs from the current state", async () => {
    const transport = fakeTransport("In Spec Review");
    const client = new LinearStatusClient(transport);
    await client.transitionTo("FIX-1", "Spec Approved");
    expect(transport.setCalls).toEqual(["Spec Approved"]);
    expect(await client.getState("FIX-1")).toBe("Spec Approved");
  });

  it("skips the write when already at the target (tolerates a skill/human that already moved it)", async () => {
    const transport = fakeTransport("Spec Approved");
    const client = new LinearStatusClient(transport);
    await client.transitionTo("FIX-1", "Spec Approved");
    expect(transport.setCalls).toEqual([]);
  });
});

describe("LinearStatusClient.comment", () => {
  it("forwards the body to the transport", async () => {
    const transport = fakeTransport("In Development");
    const client = new LinearStatusClient(transport);
    await client.comment("FIX-1", "⏸ Waiting for spec approval");
    expect(transport.comments).toEqual(["⏸ Waiting for spec approval"]);
  });

  it("surfaces transport failures rather than swallowing them", async () => {
    const transport: LinearTransport = {
      getIssueState: async () => "In Review",
      setIssueState: async () => {},
      comment: vi.fn(async () => {
        throw new Error("network down");
      }),
    };
    const client = new LinearStatusClient(transport);
    await expect(client.comment("FIX-1", "hi")).rejects.toThrow("network down");
  });
});
