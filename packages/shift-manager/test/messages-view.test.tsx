// @vitest-environment happy-dom
/** Messages: both sides, newest first, grouped by exchange; a sent message is its own tool line. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolOutputItem } from "@flow-state-dev/core/items";
import type { LoadedSnapshot } from "../src/lib/derive";
import { firstLine, exchangesOf, toMessageRows, type WorkerMessageRow } from "../src/lib/messages";
import { parseRoute, pathFor } from "../src/lib/routes";

const readPages = vi.fn();
vi.mock("@flow-state-dev/client", async (original) => ({
  ...(await original<typeof import("@flow-state-dev/client")>()),
  readEveryCollectionPage: (...a: unknown[]) => readPages(...a),
}));
const lab = { client: { userId: "u_1", resources: {} }, refresh: vi.fn() };
vi.mock("../src/lib/lab-data", () => ({ useLab: () => lab }));

import { Messages } from "../src/surfaces/Messages";
import { ToolLineGroup } from "../src/components/ToolLine";

const row = (over: Partial<WorkerMessageRow> & Pick<WorkerMessageRow, "id" | "from" | "to" | "at">): WorkerMessageRow => ({
  text: "hello",
  exchange: over.id,
  fromSession: `s_${over.from}`,
  fromFlow: "agent",
  toSession: `s_${over.to}`,
  toFlow: "agent",
  hop: 1,
  status: "delivered",
  ...over,
});

const ask = row({ id: "msg_a", from: "researcher", to: "coordinator", at: 1_000, text: "What is the codename?\nThanks." });
const answer = row({ id: "msg_b", from: "coordinator", to: "researcher", at: 3_000, exchange: "msg_a", inReplyTo: "msg_a", text: "BLUE-HERON", hop: 2 });
const other = row({ id: "msg_c", from: "helper-a", to: "helper-b", at: 2_000, status: "refused", reason: "dispatch-rejected: down" });

const snapshot = { sessions: [{ id: "workforce-roster-own-u_1", flowKind: "workforce-roster", parentSessionId: null }], readAt: 1 } as unknown as LoadedSnapshot;

beforeEach(() => {
  readPages.mockReset();
  window.history.replaceState(null, "", "/messages");
});
afterEach(() => cleanup());

describe("the message log, as exchanges", () => {
  it("puts the exchange with the newest message first, each exchange newest first", () => {
    const exchanges = exchangesOf([other, ask, answer]);
    expect(exchanges.map((t) => t.id)).toEqual(["msg_a", "msg_c"]);
    expect(exchanges[0]!.messages.map((m) => m.id)).toEqual(["msg_b", "msg_a"]);
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
    render(<Messages snapshot={snapshot} />);
    const lines = await screen.findAllByTestId("message");
    expect(readPages.mock.calls[0]![1]).toBe("workforce-roster-own-u_1");
    expect(lines.map((l) => `${l.getAttribute("data-from")}>${l.getAttribute("data-to")}`)).toEqual([
      "coordinator>researcher",
      "researcher>coordinator",
      "helper-a>helper-b",
    ]);
    expect(within(lines[1]!).getByTestId("message-text").textContent).toBe("What is the codename?");
    expect(within(lines[2]!).getByTestId("message-status").textContent).toBe("not delivered");
    expect(within(lines[0]!).queryByTestId("message-status")).toBeNull();
    act(() => fireEvent.click(within(lines[1]!).getByTestId("message-to")));
    expect(window.location.pathname).toBe("/s/s_coordinator");
    act(() => fireEvent.click(within(lines[1]!).getByTestId("message-from")));
    expect(window.location.pathname).toBe("/s/s_researcher");
  });

  it("says a message is on its way until its recipient takes it, and when it couldn't be delivered", async () => {
    const onItsWay = row({ id: "msg_d", from: "researcher", to: "helper-a", at: 4_000, status: "unconfirmed" });
    const gaveUp = row({ id: "msg_e", from: "researcher", to: "helper-b", at: 5_000, status: "undeliverable", reason: "it couldn't be delivered within 1440 minutes" });
    readPages.mockResolvedValue([onItsWay, gaveUp].map((r) => ({ topic: `workforce/messages/${r.id}`, clientData: r })));
    render(<Messages snapshot={snapshot} />);
    const lines = await screen.findAllByTestId("message");
    const status = (id: string) => within(lines.find((l) => l.getAttribute("data-message-id") === id)!).getByTestId("message-status").textContent;
    expect(status("msg_d")).toBe("on its way");
    expect(status("msg_e")).toBe("couldn't be delivered");
  });

  it("says so when there are none", async () => {
    readPages.mockResolvedValue([]);
    render(<Messages snapshot={snapshot} />);
    expect((await screen.findByTestId("messages-empty")).textContent).toContain("No messages yet");
  });

  it("says what the Lab answered when the log didn't load", async () => {
    readPages.mockRejectedValue(new Error("store offline"));
    render(<Messages snapshot={snapshot} />);
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
    ({ id, type: "tool_output", status, requestId: "r", toolCall: { name: "sendMessage", arguments: JSON.stringify(args) }, output }) as unknown as ToolOutputItem;
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

  it("names a task or a conversation it was sent to, not 'another worker' (FIX-2160)", () => {
    render(
      <ToolLineGroup
        items={[
          call("t1", { to: { task: "task_42" }, text: "Done yet?" }, { sent: "msg_a" }),
          call("t2", { to: { session: "s_other" }, text: "FYI" }, { ok: false, error: "no_session: no conversation" })
        ]}
      />
    );
    const [toTask, toSession] = screen.getAllByTestId("message-call");
    expect(toTask!.textContent).toContain("To task task_42: Done yet?");
    expect(toSession!.textContent).toContain("Not sent to conversation s_other: FYI");
  });
});
