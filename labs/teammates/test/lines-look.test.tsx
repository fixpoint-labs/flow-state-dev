// @vitest-environment happy-dom
/**
 * How the lab draws each line React's conversation model hands it. The lab
 * decides no line itself: workforce writes a message sent, a task filed and a
 * task's ending as their own lines, and the lab only gives each its look. A
 * task's ending names its task and how it ended (a cancelled task never reads
 * as failed), and opens the task. A message the worker sent opens its
 * exchange; one it couldn't send says so, and why, and opens nothing. A
 * filed task is its card from the filing, before the board's row arrives. A
 * `user_approval` stop is a card until answered. A run of tool calls is one
 * line, open while it runs, and a call its turn left running reads failed
 * once the turn is over.
 */
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkerMessageResourceState } from "@flow-state-dev/workforce/browser";
import { answerIn } from "../src/components/Popups";
import { exchangeOf } from "../src/lib/talk";
import { answered, approval, call, drawLines, filed, linesOf, message, received, result, sent } from "./lines";

afterEach(cleanup);

const CODER = "teammates.claude-code";
const WRITER = "teammates.writer";

describe("a task's ending", () => {
  it("names the task and the worker that ran it, and opens the task", () => {
    const opened: string[] = [];
    drawLines(linesOf([result("r", "q1", { taskId: "task_y", from: WRITER, title: "Draft the post", text: "writer finished: Draft the post", ending: "completed" })]), { openTask: (id) => void opened.push(id), nameOf: () => "writer" });
    const line = screen.getByRole("button", { name: "writer finished: Draft the post" });
    expect(line.getAttribute("data-status")).toBe("done");
    fireEvent.click(line);
    expect(opened).toEqual(["task_y"]);
  });

  it("says a task that errored couldn't finish, and a cancelled one was cancelled, never failed", () => {
    drawLines(linesOf([
      result("a", "q1", { taskId: "task_x", from: CODER, title: "Fix it", text: "…", ending: "errored" }),
      result("b", "q1", { taskId: "task_c", from: CODER, title: "Tidy", text: "…", ending: "cancelled" }),
    ]), { isCoding: (id) => id === CODER });
    expect(screen.getByRole("button", { name: "Coding task couldn't finish: Fix it" }).getAttribute("data-status")).toBe("failed");
    expect(screen.getByRole("button", { name: "Coding task was cancelled: Tidy" }).getAttribute("data-status")).toBe("cancelled");
  });
});

describe("a message the worker sent", () => {
  it("is one line that opens its exchange, with how it stands", () => {
    const opened: unknown[] = [];
    drawLines(linesOf([sent("s", "q1", { to: WRITER, text: "Draft it.", messageId: "msg_1" })]), {
      nameOf: () => "writer",
      answerOf: (id) => (id === "msg_1" ? "replied" : undefined),
      openMessage: (m) => void opened.push(m),
    });
    const line = screen.getByRole("button", { name: "Messaged writer: Draft it." });
    expect(line.querySelector("[data-sent-status]")?.textContent).toBe("replied");
    fireEvent.click(line);
    expect(opened).toEqual([{ to: WRITER, messageId: "msg_1", text: "Draft it." }]);
  });

  it("says one it couldn't send wasn't sent, and why, and opens nothing", () => {
    drawLines(linesOf([sent("s", "q1", { to: WRITER, text: "Hi.", refused: "no_worker: Nothing was sent." })]), { nameOf: () => "writer", openMessage: () => undefined });
    expect(screen.queryByRole("button")).toBeNull();
    const line = document.querySelector("[data-entry=sent]")!;
    expect(line.getAttribute("data-state")).toBe("refused");
    expect(line.textContent).toContain("Not sent to writer: Hi.");
    expect(line.textContent).toContain("no_worker: Nothing was sent.");
  });
});

describe("a message another worker sent", () => {
  it("lands under the sender's name, marked as a reply", () => {
    drawLines(linesOf([received("c", "q1", { id: "msg_2", from: WRITER, text: "Nov 12", inReplyTo: "msg_1", budget: 3 })]), { nameOf: () => "writer" });
    const line = screen.getByRole("region", { name: "From writer" });
    expect(line.textContent).toContain("← writer · reply");
    expect(line.textContent).toContain("Nov 12");
  });
});

describe("a task the worker filed", () => {
  it("is its card from the filing, before the board's row arrives, and then from the row", () => {
    const lines = linesOf([filed("f", "q1", { taskId: "task_1", title: "Draft the post", assignee: WRITER })]);
    const view = drawLines(lines, { nameOf: () => "writer" });
    expect(screen.getByRole("button", { name: "Asked writer to draft the post" }).getAttribute("data-status")).toBe("running");
    view.unmount();
    const row = { id: "task_1", goal: "Draft the post", title: "Draft the post", assignee: WRITER, status: "completed", attempts: 1, asks: [], harness: null, review: null, landed: null, error: null, pullRequests: [], runFlow: null, detail: null };
    drawLines(lines, { nameOf: () => "writer", tasks: [row as never] });
    expect(screen.getByRole("button", { name: "Asked writer to draft the post" }).getAttribute("data-status")).toBe("done");
  });
});

describe("a worker waiting for your yes", () => {
  it("is a card with Approve and Deny until answered, and then says how", () => {
    const stop = approval("s1", "r1", "sus_1", "Publish the draft?");
    drawLines(linesOf([stop]), { workerName: "writer" });
    const card = screen.getByRole("region", { name: "writer asks" });
    expect(within(card).getByRole("button", { name: "Approve" })).toBeTruthy();
    cleanup();
    drawLines(linesOf([stop, answered("s2", "r1", "sus_1", "approved")]), { workerName: "writer" });
    expect(screen.getByRole("region", { name: "writer asks" }).textContent).toContain("writer asks · approved");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});

describe("a worker's tool steps", () => {
  const read = (id: string, path: string, status = "completed", requestId = "r1") =>
    call(id, requestId, "readProjectSource", { path }, status, status === "completed" ? { kind: "read", status: "ok", path, content: "x" } : undefined);
  const run = () => document.querySelector("details")!;

  it("are one line, open while a step runs and naming the file in flight, folded and summed up once done", () => {
    drawLines(linesOf([read("t1", "docs/launch.md"), read("t2", "src/config/release.ts", "in_progress")]));
    expect(run().open).toBe(true);
    expect(run().querySelector("summary")?.textContent).toBe("Read src/config/release.ts…");
    cleanup();
    const grep = call("t3", "r1", "grepProjectSource", { pattern: "LAUNCH" }, "completed", { kind: "grep", matches: [{ path: "a", line: 1, text: "x" }] });
    drawLines(linesOf([read("t1", "docs/launch.md"), read("t2", "src/release.ts"), grep]));
    expect(run().open).toBe(false);
    expect(run().querySelector("summary")?.textContent).toBe("Read 2 files and searched the code");
  });

  it("start a new run for a new turn, and for a call after a line the worker wrote", () => {
    const lines = linesOf([read("t1", "a.md"), message("a1", "r1", "assistant", "Looking."), read("t2", "b.md"), read("t3", "c.md", "completed", "r2")]);
    expect(lines.map((line) => line.kind)).toEqual(["steps", "assistant", "steps", "steps"]);
  });

  it("say a step its turn left running failed once the turn is over, so a crashed turn's run doesn't stay open", () => {
    const items = [read("t1", "a.md"), read("t2", "b.md", "in_progress")];
    drawLines(linesOf(items, [{ id: "r1", status: "failed" }]));
    expect(run().open).toBe(false);
    expect(run().querySelector("summary")?.textContent).toBe("Read 2 files (1 failed)");
  });
});

describe("how a sent message stands", () => {
  const logEntry = (fields: Partial<WorkerMessageResourceState> & Pick<WorkerMessageResourceState, "id" | "from" | "to" | "text" | "at">): WorkerMessageResourceState => ({
    exchange: fields.id, fromSession: "s_from", fromFlow: "agent", toSession: "s_to", toFlow: "agent", hop: 1, status: "delivered", ...fields,
  });
  const out = logEntry({ id: "msg_1", from: "teammates.chief-of-staff", to: "teammates.researcher", text: "Launch date?", at: 1 });
  const reply = logEntry({ id: "msg_2", from: out.to, to: out.from, text: "Nov 12", at: 2, inReplyTo: "msg_1" });

  it("is replied when a message answers it, a waited send's answer included", () => {
    expect(answerIn([out], "msg_1")).toBe("working");
    expect(answerIn([out, reply], "msg_1")).toBe("replied");
    expect(answerIn([{ ...out, replyRequested: true as const }, reply], "msg_1")).toBe("replied");
  });

  // The framework's "no answer" is a reply row too: it must not read as an answer.
  it("is no answer when the reply is the framework's no answer", () => {
    expect(answerIn([out, { ...reply, text: "No answer came back: the turn ended without saying anything.", noAnswer: true as const }], "msg_1")).toBe("no answer");
  });
});

describe("the turn a message's popup shows", () => {
  it("follows the turn that took a message over after its first taker died", () => {
    const lines = linesOf([received("c1", "r1", { id: "msg_1", from: WRITER, text: "Launch date?" }), received("c2", "r2", { id: "msg_1", from: WRITER, text: "Launch date?" }), message("a2", "r2", "assistant", "Nov 12")]);
    expect(exchangeOf(lines, "msg_1").map((line) => line.id)).toEqual(["c2", "a2"]);
  });
});
