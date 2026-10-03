/**
 * The talk session's actions as a page on any origin runs them: a Join that
 * names its new session without `crypto.randomUUID`, and a post the Lab
 * completed whose answer couldn't be read back.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { LabClients } from "../src/lib/connection";
import { joinRoom, postToRoom } from "../src/lib/talk";

/**
 * Clients whose talk actions complete at once and answer `output`. `lookup`
 * stands in for reading the answer back from the session's requests.
 */
function clientsAnswering(output: unknown, lookup: () => Promise<void> = async () => undefined) {
  const sent: Array<{ action: string; sessionId: string }> = [];
  const clients = {
    actions: () => ({
      sendAction: async (action: string, _input: unknown, options: { sessionId: string }) => {
        sent.push({ action, sessionId: options.sessionId });
        return { request: { id: "req-1" } };
      },
      getRequestStatus: async () => ({ status: "completed" }),
    }),
    sessions: {
      listSessionRequests: async () => {
        await lookup();
        return [{ id: "req-1", result: { output } }];
      },
    },
  } as unknown as LabClients;
  return { clients, sent };
}

const realRandomUUID = globalThis.crypto.randomUUID;
afterEach(() => {
  Object.defineProperty(globalThis.crypto, "randomUUID", { value: realRandomUUID, configurable: true, writable: true });
});

describe("Join on a page without crypto.randomUUID (plain HTTP)", () => {
  it("names the new talk session from getRandomValues and sends the join", async () => {
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true, writable: true });
    const { clients, sent } = clientsAnswering({ sessionId: "talk-bound" });
    await expect(joinRoom(clients, "channel", "desk")).resolves.toBe("talk-bound");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.sessionId).toMatch(/^talk-[0-9a-f]{32}$/);
  });
});
