/**
 * The worker sessions view reads the worker's sessions a page at a time,
 * newest first by latest activity. A turn that starts between two pages moves
 * its session to the front, so a session of the first page comes back on the
 * second. Why it matters: a session listed twice is two entries with one key, can
 * be two default conversations, and sends one id twice to the running read.
 */
import { describe, expect, it } from "vitest";
import type { ListedSession, RequestSessions, SessionListQuery } from "@flow-state-dev/core/internal";
import { conversationCandidates } from "../src/workers/session-views";

const listed = (id: string, state: Record<string, unknown>): ListedSession => ({
  id,
  flowKind: "agent",
  lineageId: `lin_${id}`,
  createdAt: 1,
  updatedAt: 1,
  state
});

describe("conversationCandidates", () => {
  it("answers each session once when a write between two pages shifts a session onto the next one", async () => {
    // The first page: 50 conversations and 50 project sessions, so it reads on.
    const first = [
      ...Array.from({ length: 50 }, (_, at) => listed(`c${at}`, { workerId: "otto" })),
      ...Array.from({ length: 50 }, (_, at) => listed(`p${at}`, { workerId: "otto", projectId: `p${at}` }))
    ];
    // A session moved to the front meanwhile, so the second page starts with the first page's last conversation.
    const second = [listed("c49", { workerId: "otto" }), listed("c50", { workerId: "otto" })];
    const sessions = {
      list: async (query?: SessionListQuery) => ({ sessions: (query?.offset ?? 0) === 0 ? first : second, more: (query?.offset ?? 0) === 0 }),
      read: async () => undefined
    } as unknown as RequestSessions;
    const ids = (await conversationCandidates(sessions, "agent", { worker: "otto" }, "none")).map((session) => session.id);
    expect(ids.filter((id) => id === "c49")).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("c50");
  });
});
