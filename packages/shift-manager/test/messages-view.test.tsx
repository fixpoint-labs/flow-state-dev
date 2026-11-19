// @vitest-environment happy-dom
/** Messages: both sides, newest first, grouped by exchange; a sent message is its own tool line. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientHttpError, createClient, type ClientFetch } from "@flow-state-dev/client";
import type { ToolOutputItem } from "@flow-state-dev/core/items";
import type { LoadedSnapshot } from "../src/lib/derive";
import { firstLine, exchangesOf, toMessages, type WorkerMessageResourceState } from "../src/lib/messages";
import { parseRoute, pathFor } from "../src/lib/routes";

/** The log the screen reads, and a failure the next list throws. */
const held: { messages: WorkerMessageResourceState[]; fail?: Error; lists: string[] } = { messages: [], lists: [] };

const fetcher: ClientFetch = async (input) => {
  const url = new URL(String(input), "http://x");
  if (held.fail !== undefined) throw held.fail;
  if (!url.pathname.endsWith("/entries")) throw new Error(`unrouted ${url.pathname}`);
  held.lists.push(url.search);
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const cursor = url.searchParams.get("cursor");
  const newest = url.searchParams.get("order") === "newest";
  const ranked = [...held.messages].sort((a, b) => (newest ? b.at - a.at || a.id.localeCompare(b.id) : a.id.localeCompare(b.id)));
  const start =
    cursor === null
      ? 0
      : ranked.findIndex((message) =>
          newest
            ? JSON.stringify([message.at, `workforce/messages/${message.id}`]) === cursor
            : `workforce/messages/${message.id}` === cursor
        ) + 1;
  const page = ranked.slice(Math.max(start, 0), Math.max(start, 0) + limit);
  const last = page.at(-1);
  const nextCursor =
    start + limit < ranked.length && last !== undefined
      ? newest
        ? JSON.stringify([last.at, `workforce/messages/${last.id}`])
        : `workforce/messages/${last.id}`
      : undefined;
  return new Response(
    JSON.stringify({
      items: page.map((message) => ({ topic: message.id, storageKey: `workforce/messages/${message.id}`, value: message, version: 1 })),
      ...(nextCursor === undefined ? {} : { nextCursor })
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
};

const real = createClient({ userId: "u_1", baseUrl: "", fetcher });
const resource = vi.fn(real.resource.bind(real));
const lab = { client: { userId: "u_1", resource, subscribe: () => ({ close() {} }) }, refresh: vi.fn() };
vi.mock("../src/lib/lab-data", () => ({ useLab: () => lab }));

import { Messages } from "../src/surfaces/Messages";
import { ToolLineGroup } from "../src/components/ToolLine";

const message = (over: Partial<WorkerMessageResourceState> & Pick<WorkerMessageResourceState, "id" | "from" | "to" | "at">): WorkerMessageResourceState => ({
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

const ask = message({ id: "msg_a", from: "researcher", to: "coordinator", at: 1_000, text: "What is the codename?\nThanks." });
const answer = message({ id: "msg_b", from: "coordinator", to: "researcher", at: 3_000, exchange: "msg_a", inReplyTo: "msg_a", text: "BLUE-HERON", hop: 2 });
const other = message({ id: "msg_c", from: "helper-a", to: "helper-b", at: 2_000, status: "refused", reason: "dispatch-rejected: down" });

// FIX-2624: the user holds no session at all; the log is read by user scope.
const snapshot = { sessions: [], readAt: 1 } as unknown as LoadedSnapshot;

beforeEach(() => {
  held.messages = [];
  held.fail = undefined;
  held.lists = [];
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
    held.messages = [ask, answer, other];
    render(<Messages snapshot={snapshot} />);
    const lines = await screen.findAllByTestId("message");
    expect(resource.mock.calls[0]?.[0]).toEqual({ scope: "user", pattern: "workforce/messages/*" });
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
    const onItsWay = message({ id: "msg_d", from: "researcher", to: "helper-a", at: 4_000, status: "unconfirmed" });
    const gaveUp = message({ id: "msg_e", from: "researcher", to: "helper-b", at: 5_000, status: "undeliverable", reason: "it couldn't be delivered within 1440 minutes" });
    held.messages = [onItsWay, gaveUp];
    render(<Messages snapshot={snapshot} />);
    const lines = await screen.findAllByTestId("message");
    const status = (id: string) => within(lines.find((l) => l.getAttribute("data-message-id") === id)!).getByTestId("message-status").textContent;
    expect(status("msg_d")).toBe("on its way");
    expect(status("msg_e")).toBe("couldn't be delivered");
  });

  it("says where a reply request's answer is: waiting, waiting on the user, answered, or answered after its sender's wait ended (FIX-2318)", async () => {
    const waiting = message({ id: "msg_f", from: "researcher", to: "helper-a", at: 6_000, status: "unconfirmed", replyRequested: true, deadlineAt: 66_000 });
    const onPerson = message({ id: "msg_g", from: "researcher", to: "helper-b", at: 7_000, status: "unconfirmed", replyRequested: true, queuedBehind: "user" });
    const answered = message({ id: "msg_h", from: "researcher", to: "coordinator", at: 8_000, replyRequested: true, deadlineAt: 68_000, answeredBy: "msg_x" });
    const late = message({ id: "msg_i", from: "researcher", to: "coordinator", at: 9_000, replyRequested: true, deadlineAt: 10_000, waitEndedAt: 10_000, answeredBy: "msg_y" });
    held.messages = [waiting, onPerson, answered, late, ask];
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
    held.messages = [];
    render(<Messages snapshot={snapshot} />);
    expect((await screen.findByTestId("messages-empty")).textContent).toContain("No messages yet");
  });

  it("says this Lab keeps no log when no flow declares it", async () => {
    held.fail = new ClientHttpError("Request failed (404) Not Found", { status: 404, body: { error: "unknown_resource" } });
    render(<Messages snapshot={snapshot} />);
    expect((await screen.findByTestId("messages-empty")).textContent).toContain("keeps no roster");
  });

  it("says what the Lab answered when the log didn't load", async () => {
    held.fail = new Error("store offline");
    render(<Messages snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByTestId("messages-failure").textContent).toContain("store offline"));
  });

  it("shows the newest page of a log past one page, and loads older messages on scroll", async () => {
    held.messages = Array.from({ length: 250 }, (_, i) =>
      message({ id: `msg_${String(i).padStart(3, "0")}`, from: "researcher", to: "coordinator", at: 1_000 + i, text: `line ${i}` })
    );
    render(<Messages snapshot={snapshot} />);
    const first = await screen.findAllByTestId("message");
    expect(first).toHaveLength(200);
    expect(first[0]!.getAttribute("data-message-id")).toBe("msg_249");
    expect(first[199]!.getAttribute("data-message-id")).toBe("msg_050");
    expect(screen.queryByTestId("messages-failure")).toBeNull();
    expect(held.lists.every((search) => search.includes("order=newest"))).toBe(true);
    expect(held.lists.some((search) => search.includes("manifest=1"))).toBe(false);

    const scroller = screen.getByTestId("messages-scroller");
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 4000 });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 400 });
    scroller.scrollTop = 3600;
    act(() => fireEvent.scroll(scroller));
    await waitFor(() => expect(screen.getAllByTestId("message")).toHaveLength(250));
    const shown = screen.getAllByTestId("message").map((line) => line.getAttribute("data-message-id"));
    expect(shown[0]).toBe("msg_249");
    expect(shown[249]).toBe("msg_000");
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

  it("reads Asked <recipient> for a send that asks for a reply, with a waited answer under it, or that it comes as a message (FIX-2318)", () => {
    render(
      <ToolLineGroup
        items={[
          call("t1", { to: "coordinator", text: "What is the codename?", wait: true }, { status: "answered", sent: "msg_a", reply: "BLUE-HERON" }),
          call("t2", { to: "helper-b", text: "Ready?", wait: true }, { status: "running", sent: "msg_b", recipient: "waiting_on_person" }),
          call("t3", { to: "pm", text: "The plan?", replyRequested: true }, { sent: "msg_c" }),
        ]}
      />,
    );
    const [asked, running, later] = screen.getAllByTestId("message-call");
    expect(asked!.textContent).toContain("Asked coordinator: What is the codename?");
    expect(within(asked!).getByTestId("message-call-answer").textContent).toBe("BLUE-HERON");
    expect(within(running!).getByTestId("message-call-answer").textContent).toBe("No answer by the deadline: it waits on the user. The answer comes as a message.");
    // Asked and went on: the answer is a message of its own, so nothing is drawn under the line.
    expect(later!.textContent).toContain("Asked pm: The plan?");
    expect(within(later!).queryByTestId("message-call-answer")).toBeNull();
  });

  it("says it wasn't sent, and why, when the send was refused", () => {
    render(<ToolLineGroup items={[call("t1", { to: "eng.coder", text: "hi" }, { ok: false, error: "task_sessions_only: \"eng.coder\" answers only from its tasks' sessions" })]} />);
    expect(screen.getByTestId("message-call").textContent).toContain("Not sent to eng.coder: hi");
    expect(screen.getByTestId("message-call-reason").textContent).toContain("task_sessions_only");
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
