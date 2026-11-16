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

  // FIX-2754.
  it("reads the default by id beside one full page of newer conversations, and pages no further for it", async () => {
    // Why it matters: paging to find the default costs a refresh up to ten
    // reads, and still misses a default behind more than 999 newer sessions.
    const page = Array.from({ length: 100 }, (_, at) => listed(`c${at}`, { workerId: "otto" }));
    const queries: SessionListQuery[] = [];
    const sessions = {
      list: async (query: SessionListQuery = {}) => {
        queries.push(query);
        if (query.ids !== undefined) return { sessions: query.ids.includes("main") ? [listed("main", { workerId: "otto" })] : [], more: false };
        return { sessions: (query.offset ?? 0) === 0 ? page : [listed("main", { workerId: "otto" })], more: (query.offset ?? 0) === 0 };
      },
      read: async () => undefined
    } as unknown as RequestSessions;
    const ids = (await conversationCandidates(sessions, "agent", { worker: "otto" }, "main")).map((session) => session.id);
    expect(ids.filter((id) => id === "main")).toHaveLength(1);
    expect(queries.filter((query) => query.ids === undefined).map((query) => query.offset ?? 0)).toEqual([0]);
    expect(queries.filter((query) => query.ids !== undefined)).toEqual([expect.objectContaining({ flowKind: "agent", ids: ["main"] })]);
  });

  it("reads the default by id only when the first page doesn't hold it", async () => {
    // The usual case, a default used recently, costs one read.
    const queries: SessionListQuery[] = [];
    const sessions = {
      list: async (query: SessionListQuery = {}) => {
        queries.push(query);
        return { sessions: [listed("main", { workerId: "otto" }), listed("c1", { workerId: "otto" })], more: false };
      },
      read: async () => undefined
    } as unknown as RequestSessions;
    const ids = (await conversationCandidates(sessions, "agent", { worker: "otto" }, "main")).map((session) => session.id);
    expect(ids).toEqual(["main", "c1"]);
    expect(queries).toHaveLength(1);
  });
});
