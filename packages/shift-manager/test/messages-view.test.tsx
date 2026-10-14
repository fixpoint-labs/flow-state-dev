// @vitest-environment happy-dom
/**
 * Messages (FIX-1989): who talked to whom, read from the user's message log.
 * Jake asked to see it, so the view must show both sides of every message,
 * newest first and grouped by thread, with each side opening the session
 * that holds it; and the sender's conversation must show a message it sent
 * as one, not as a buried tool call.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolOutputItem } from "@flow-state-dev/core/items";
import { GAPS } from "../src/gaps";
import type { LoadedSnapshot } from "../src/lib/derive";
import { firstLine, threadsOf, toMessageRows, type WorkerMessageRow } from "../src/lib/messages";
import { parseRoute, pathFor } from "../src/lib/routes";

const readPages = vi.fn();
vi.mock("@flow-state-dev/client", async (original) => ({
  ...(await original<typeof import("@flow-state-dev/client")>()),
  readEveryCollectionPage: (...a: unknown[]) => readPages(...a),
}));
const lab = { clients: { userId: "u_1", resources: {} }, refresh: vi.fn() };
vi.mock("../src/lib/lab-data", () => ({ useLab: () => lab }));

import { Messages } from "../src/surfaces/Messages";
import { ToolLineGroup } from "../src/components/ToolLine";

const row = (over: Partial<WorkerMessageRow> & Pick<WorkerMessageRow, "id" | "from" | "to" | "at">): WorkerMessageRow => ({
  text: "hello",
  thread: over.id,
  fromSession: `s_${over.from}`,
  fromFlow: "agent",
  toSession: `s_${over.to}`,
  toFlow: "agent",
  answerTo: { sessionId: `s_${over.from}`, flow: "agent" },
  hop: 1,
  status: "delivered",
  ...over,
});

const ask = row({ id: "msg_a", from: "researcher", to: "coordinator", at: 1_000, text: "What is the codename?\nThanks." });
const answer = row({ id: "msg_b", from: "coordinator", to: "researcher", at: 3_000, thread: "msg_a", replyTo: "msg_a", text: "BLUE-HERON", hop: 2 });
const other = row({ id: "msg_c", from: "helper-a", to: "helper-b", at: 2_000, status: "refused", reason: "dispatch-rejected: down" });

const snapshot = { sessions: [{ id: "workforce-roster-own-u_1", flowKind: "workforce-roster", parentSessionId: null }], readAt: 1 } as unknown as LoadedSnapshot;

beforeEach(() => {
  readPages.mockReset();
  window.history.replaceState(null, "", "/messages");
});
afterEach(() => cleanup());

describe("the message log, as threads", () => {
  it("puts the thread with the newest message first, each thread newest first", () => {
    const threads = threadsOf([other, ask, answer]);
    expect(threads.map((t) => t.id)).toEqual(["msg_a", "msg_c"]);
    expect(threads[0]!.messages.map((m) => m.id)).toEqual(["msg_b", "msg_a"]);
  });

  it("leaves out a row that isn't a message, rather than drawing half of one", () => {
    expect(toMessageRows([{ clientData: ask }, { clientData: { id: "x" } }, {}]).map((r) => r.id)).toEqual(["msg_a"]);
  });

  it("shows a message by its first line", () => {
    expect(firstLine("\n  What is the codename?\nThanks.")).toBe("What is the codename?");
  });
});

describe("the Messages view", () => {
  it("lists every message with both sides, read through the user's roster session, and opens either side's session", async () => {
    readPages.mockResolvedValue([ask, answer, other].map((r) => ({ topic: `workforce/messages/${r.id}`, clientData: r })));
    render(<Messages snapshot={snapshot} gaps={GAPS} />);
    const lines = await screen.findAllByTestId("message");
    expect(readPages.mock.calls[0]![1]).toBe("workforce-roster-own-u_1");
    expect(lines.map((l) => `${l.getAttribute("data-from")}>${l.getAttribute("data-to")}`)).toEqual([
      "coordinator>researcher",
      "researcher>coordinator",
      "helper-a>helper-b",
    ]);
    expect(within(lines[1]!).getByTestId("message-text").textContent).toBe("What is the codename?");
    expect(within(lines[2]!).getByTestId("message-status").textContent).toBe("not delivered");
    // Each side opens the session that holds the message on that side.
    act(() => fireEvent.click(within(lines[1]!).getByTestId("message-to")));
    expect(window.location.pathname).toBe("/s/s_coordinator");
    act(() => fireEvent.click(within(lines[1]!).getByTestId("message-from")));
    expect(window.location.pathname).toBe("/s/s_researcher");
  });

  it("says so when there are none", async () => {
    readPages.mockResolvedValue([]);
    render(<Messages snapshot={snapshot} gaps={GAPS} />);
    expect((await screen.findByTestId("messages-empty")).textContent).toContain("No messages yet");
  });

  it("says what the Lab answered when the log didn't load", async () => {
    readPages.mockRejectedValue(new Error("store offline"));
    render(<Messages snapshot={snapshot} gaps={GAPS} />);
    await waitFor(() => expect(screen.getByTestId("messages-failure").textContent).toContain("store offline"));
  });

  it("is at /messages, and a session at /s/<id>", () => {
    expect(parseRoute("/messages")).toEqual({ level: "messages" });
    expect(parseRoute("/s/wks_1")).toEqual({ level: "session", sessionId: "wks_1" });
    expect(pathFor({ level: "session", sessionId: "a/b" })).toBe("/s/a%2Fb");
  });
});

describe("a message the worker sent, in its own conversation", () => {
  const call = (id: string, args: unknown, output: unknown, status = "completed"): ToolOutputItem =>
    ({ id, type: "tool_output", status, requestId: "r", toolCall: { name: "messageWorker", arguments: JSON.stringify(args) }, output }) as unknown as ToolOutputItem;
  const other = { id: "t0", type: "tool_output", status: "completed", requestId: "r", toolCall: { name: "discover", arguments: "{}" } } as unknown as ToolOutputItem;

  it("is its own line, To <recipient>: <text>, never folded into the run's tool count", () => {
    render(<ToolLineGroup items={[other, call("t1", { to: "coordinator", text: "What is the codename?" }, { sent: "msg_a" })]} />);
    const line = screen.getByTestId("message-call");
    expect(line.textContent).toContain("To coordinator: What is the codename?");
    expect(screen.getByTestId("tool-group").textContent).toContain("Used discover");
    act(() => fireEvent.click(screen.getByTestId("message-call-messages")));
    expect(window.location.pathname).toBe("/messages");
  });

  it("says it wasn't sent, and why, when the send was refused", () => {
    render(<ToolLineGroup items={[call("t1", { to: "eng.coder", text: "hi" }, { ok: false, error: "takes_tasks_only: file a task" })]} />);
    expect(screen.getByTestId("message-call").textContent).toContain("Not sent to eng.coder: hi");
    expect(screen.getByTestId("message-call-reason").textContent).toContain("takes_tasks_only");
  });
});
