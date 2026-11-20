// @vitest-environment happy-dom
/** Messages: both sides, newest first, grouped by exchange; a sent message is its own line in the conversation. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientHttpError } from "@flow-state-dev/client";
import { liveRead } from "@flow-state-dev/client/internal";
import type { ToolOutputItem } from "@flow-state-dev/core/items";
import type { LoadedSnapshot } from "../src/lib/derive";
import { firstLine, exchangesOf, toMessages, type WorkerMessageResourceState } from "../src/lib/messages";
import { parseRoute, pathFor } from "../src/lib/routes";

const readPages = vi.fn();
vi.mock("@flow-state-dev/client", async (original) => ({
  ...(await original<typeof import("@flow-state-dev/client")>()),
  readEveryCollectionPage: (...a: unknown[]) => readPages(...a),
}));
const resource = vi.fn((def: { scope: string; pattern?: string }) => ({ ...def, list: vi.fn() }));
// The client's own live read, over a subscription that hears nothing: each view reads once on open.
const live = (topics: Parameters<typeof liveRead>[1], options: Parameters<typeof liveRead>[2]) => liveRead(() => ({ close: () => {} }), topics, options);
const lab = { client: { userId: "u_1", resources: {}, resource, live }, refresh: vi.fn() };
vi.mock("../src/lib/lab-data", () => ({ useLab: () => lab }));

import { Messages } from "../src/surfaces/Messages";
import { shiftManagerRenderers, StepsLine } from "../src/components/ToolLine";
import { conversationLines, FlowProvider, ItemsRenderer } from "@flow-state-dev/react";
import type { DataItem } from "@flow-state-dev/core/items";

const row = (over: Partial<WorkerMessageResourceState> & Pick<WorkerMessageResourceState, "id" | "from" | "to" | "at">): WorkerMessageResourceState => ({
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

// FIX-2624: the user holds no session at all; the log is read by user scope.
const snapshot = { sessions: [], readAt: 1 } as unknown as LoadedSnapshot;

beforeEach(() => {
  readPages.mockReset();
  resource.mockClear();
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
    expect(toMessages([{ clientData: ask }, { clientData: { id: "x" } }, {}]).map((r) => r.id)).toEqual(["msg_a"]);
  });

  it("shows a message by its first line", () => {
    expect(firstLine("\n  What is the codename?\nThanks.")).toBe("What is the codename?");
  });
});

describe("the Messages view", () => {
  it("lists every message with both sides, read by user scope with no session, and opens either side's session", async () => {
    readPages.mockResolvedValue([ask, answer, other].map((r) => ({ topic: `workforce/messages/${r.id}`, clientData: r })));
    render(<Messages snapshot={snapshot} />);
    const lines = await screen.findAllByTestId("message");
    expect(resource).toHaveBeenCalledWith({ scope: "user", pattern: "workforce/messages/*" });
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

  it("says where a reply request's answer is: waiting, waiting on the user, answered, or answered after its sender's wait ended (FIX-2318)", async () => {
    const waiting = row({ id: "msg_f", from: "researcher", to: "helper-a", at: 6_000, status: "unconfirmed", replyRequested: true, deadlineAt: 66_000 });
    const onPerson = row({ id: "msg_g", from: "researcher", to: "helper-b", at: 7_000, status: "unconfirmed", replyRequested: true, queuedBehind: "user" });
    const answered = row({ id: "msg_h", from: "researcher", to: "coordinator", at: 8_000, replyRequested: true, deadlineAt: 68_000, answeredBy: "msg_x" });
    const late = row({ id: "msg_i", from: "researcher", to: "coordinator", at: 9_000, replyRequested: true, deadlineAt: 10_000, waitEndedAt: 10_000, answeredBy: "msg_y" });
    readPages.mockResolvedValue([waiting, onPerson, answered, late, ask].map((r) => ({ topic: `workforce/messages/${r.id}`, clientData: r })));
    render(<Messages snapshot={snapshot} />);
    const lines = await screen.findAllByTestId("message");
    const replyState = (id: string) => within(lines.find((l) => l.getAttribute("data-message-id") === id)!).queryByTestId("message-reply-state")?.textContent;
    expect(replyState("msg_f")).toBe("reply · waiting");
    expect(replyState("msg_g")).toBe("reply · waiting on the user");
    expect(replyState("msg_h")).toBe("reply · answered");
    expect(replyState("msg_i")).toBe("reply · answered late");
    // A plain message owes no reply.
    expect(replyState("msg_a")).toBeUndefined();
  });

  it("says so when there are none", async () => {
    readPages.mockResolvedValue([]);
    render(<Messages snapshot={snapshot} />);
    expect((await screen.findByTestId("messages-empty")).textContent).toContain("No messages yet");
  });

  it("says this Lab keeps no log when no flow declares it", async () => {
    readPages.mockRejectedValue(new ClientHttpError("Request failed (404) Not Found", { status: 404, body: { error: "unknown_resource" } }));
    render(<Messages snapshot={snapshot} />);
    expect((await screen.findByTestId("messages-empty")).textContent).toContain("keeps no roster");
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
  // The send's own line, as workforce writes it (`workforce:sent`), tied to the call that wrote it by its key.
  const sent = (id: string, value: Record<string, unknown>, callId = `tc_${id}`) =>
    ({
      id,
      type: "data",
      status: "completed",
      requestId: "r",
      dataType: "workforce:sent",
      key: `r:root/step[0]/tool[sendMessage][${callId}]`,
      value,
      provenance: { blockName: "sendMessage", blockInstanceId: `r:root/step[0]/tool[sendMessage][${callId}]:0`, phase: "main" },
    }) as unknown as DataItem;
  // The call that wrote it: the model reads it as that line, never as a step.
  const sendCall = (id: string, callId = `tc_${id}`) =>
    ({ id, type: "tool_output", status: "completed", requestId: "r", toolCall: { callId, name: "sendMessage", arguments: "{}" }, output: {}, provenance: { blockName: "gen", blockInstanceId: "r:root/step[0]:0", phase: "main" } }) as unknown as ToolOutputItem;
  const other = { id: "t0", type: "tool_output", status: "completed", requestId: "r", toolCall: { callId: "tc_0", name: "discover", arguments: "{}" }, provenance: { blockName: "gen", blockInstanceId: "r:root/step[0]:0", phase: "main" } } as unknown as ToolOutputItem;
  const drawLines = (items: unknown[]) =>
    render(
      <FlowProvider renderers={shiftManagerRenderers}>
        <ItemsRenderer lines={conversationLines(items as never, [], { renderers: shiftManagerRenderers })} toolGroupRenderer={StepsLine} />
      </FlowProvider>,
    );

  it("is its own line, To <recipient>: <text>, drawn once, never folded into the run's tool count", () => {
    drawLines([other, sendCall("t1", "tc_A"), sent("d1", { to: "coordinator", text: "What is the codename?", messageId: "msg_a" }, "tc_A")]);
    expect(screen.getAllByTestId("message-call").map((line) => line.textContent)).toEqual([expect.stringContaining("To coordinator: What is the codename?")]);
    expect(screen.getByTestId("tool-group").textContent).toContain("Used discover");
    act(() => fireEvent.click(screen.getByTestId("message-call-messages")));
    expect(window.location.pathname).toBe("/messages");
  });

  it("reads Asked <recipient> for a send that asks for a reply, with a waited answer under it, or that it comes as a message (FIX-2318)", () => {
    drawLines([
      sent("d1", { to: "coordinator", text: "What is the codename?", messageId: "msg_a", wait: { status: "answered", reply: "BLUE-HERON" } }),
      sent("d2", { to: "helper-b", text: "Ready?", messageId: "msg_b", wait: { status: "running", recipient: "waiting_on_person" } }),
      sent("d3", { to: "pm", text: "The plan?", messageId: "msg_c", replyRequested: true }),
    ]);
    const [asked, running, later] = screen.getAllByTestId("message-call");
    expect(asked!.textContent).toContain("Asked coordinator: What is the codename?");
    expect(within(asked!).getByTestId("message-call-answer").textContent).toBe("BLUE-HERON");
    expect(within(running!).getByTestId("message-call-answer").textContent).toBe("No answer by the deadline: it waits on the user. The answer comes as a message.");
    // Asked and went on: the answer is a message of its own, so nothing is drawn under the line.
    expect(later!.textContent).toContain("Asked pm: The plan?");
    expect(within(later!).queryByTestId("message-call-answer")).toBeNull();
  });

  it("says it wasn't sent, and why, when the send was refused", () => {
    drawLines([sent("d1", { to: "eng.coder", text: "hi", refused: "task_sessions_only: \"eng.coder\" answers only from its tasks' sessions" })]);
    expect(screen.getByTestId("message-call").textContent).toContain("Not sent to eng.coder: hi");
    expect(screen.getByTestId("message-call-reason").textContent).toContain("task_sessions_only");
  });

  it("says why when a waited send's delivery failed", () => {
    drawLines([sent("d2", { to: "coordinator", text: "Ping?", messageId: "msg_b", wait: { status: "failed", error: "not_delivered: the session is gone." } })]);
    expect(screen.getByTestId("message-call-reason").textContent).toBe("not_delivered: the session is gone.");
  });

  it("names a task or a conversation it was sent to, not 'another worker' (FIX-2160)", () => {
    drawLines([
      sent("d1", { to: { task: "task_42" }, text: "Done yet?", messageId: "msg_a" }),
      sent("d2", { to: { session: "s_other" }, text: "FYI", refused: "no_session: no conversation" }),
    ]);
    const [toTask, toSession] = screen.getAllByTestId("message-call");
    expect(toTask!.textContent).toContain("To task task_42: Done yet?");
    expect(toSession!.textContent).toContain("Not sent to conversation s_other: FYI");
  });
});
