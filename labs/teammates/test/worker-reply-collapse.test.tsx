// @vitest-environment happy-dom
/**
 * Worker-originated conversation lines collapse by default when long; the
 * assistant's own messages stay fully visible.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FlowProvider } from "@flow-state-dev/react";
import { afterEach, describe, expect, it } from "vitest";
import { LineContext } from "../src/components/flow-state/conversation-lines";
import { Line, teammatesRenderers } from "../src/components/lines";
import { drawLines, linesOf, message, received, result } from "./lines";
import { codingTask, stubServer, TestProvider } from "./stub-server";

afterEach(cleanup);

const WRITER = "teammates.writer";
const LONG =
  "Here is the research dump.\n\n" +
  "First finding goes into detail about the launch timeline and what depends on the relay module.\n\n" +
  "Second finding covers staffing and who signs off before we ship.";

describe("another worker's reply", () => {
  it("is collapsed by default when long, with a preview and an expand control", async () => {
    drawLines(linesOf([received("c", "q1", { id: "msg_1", from: WRITER, text: LONG })]), { nameOf: () => "Writer" });
    const line = await waitFor(() => screen.getByRole("region", { name: "From Writer" }));
    expect(line.getAttribute("data-collapsed-default")).toBe("true");
    expect(line.getAttribute("data-state")).toBe("closed");
    expect(line.querySelector('[data-part="preview"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Show full message from Writer" }).getAttribute("aria-expanded")).toBe("false");
    const preview = line.querySelector('[data-part="preview"]')!;
    expect(preview.textContent).toContain("research dump");
    expect(preview.className).toContain("line-clamp-2");
  });

  it("expands to the full text per message, then folds again", async () => {
    drawLines(linesOf([received("c", "q1", { id: "msg_1", from: WRITER, text: LONG })]), { nameOf: () => "Writer" });
    const line = screen.getByRole("region", { name: "From Writer" });
    const toggle = await screen.findByRole("button", { name: "Show full message from Writer" });
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute("aria-expanded")).toBe("true"));
    expect(line.getAttribute("data-state")).toBe("open");
    expect(line.querySelector('[data-part="body"]')).not.toBeNull();
    expect(line.textContent).toContain("Second finding");
    expect(screen.getByRole("button", { name: "Collapse message from Writer" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Collapse message from Writer" }));
    await waitFor(() => expect(toggle.getAttribute("aria-expanded")).toBe("false"));
    expect(line.getAttribute("data-state")).toBe("closed");
  });

  it("shows short replies fully with no expand control", async () => {
    drawLines(linesOf([received("c", "q1", { id: "msg_2", from: WRITER, text: "Nov 12" })]), { nameOf: () => "writer" });
    const line = screen.getByRole("region", { name: "From writer" });
    await waitFor(() => expect(line.getAttribute("data-collapsed-default")).toBe("false"));
    expect(screen.queryByRole("button", { name: /Show full message/ })).toBeNull();
    expect(line.textContent).toContain("Nov 12");
  });
});

describe("a finished task's line", () => {
  // What the board said of the ending: the line's `text`, never the worker's reply.
  const ENDING = 'Task "Plan the PR tab" (task_a77ed7ba463f48a38320) completed.';
  const REPLY = "## Plan\n\nPoll the pull requests every minute, and mark a stale row.";
  const draw = () => {
    const server = stubServer({ board: { wks_cos: [codingTask({ id: "task_y", title: "Plan the PR tab", assignee: WRITER, status: "completed", detail: { answer: REPLY, answerCut: false } })] } });
    const opened: string[] = [];
    render(
      <TestProvider client={server.client}>
        <FlowProvider sessionId="wks_cos" renderers={teammatesRenderers}>
          <LineContext.Provider value={{ nameOf: () => "Writer", openTask: (id) => void opened.push(id) }}>
            {linesOf([result("r", "q1", { taskId: "task_y", from: WRITER, title: "Plan the PR tab", text: ENDING, ending: "completed" })]).map((line) => (
              <Line key={line.id} line={line} />
            ))}
          </LineContext.Provider>
        </FlowProvider>
      </TestProvider>,
    );
    return { line: screen.getByRole("region", { name: "Task result from Writer" }), opened };
  };

  it("is one clean line while collapsed: no second line, no board text, no task id", () => {
    const { line } = draw();
    expect(line.getAttribute("data-state")).toBe("closed");
    expect(line.querySelector('[data-part="preview"]')).toBeNull();
    expect(line.querySelector('[data-part="body"]')).toBeNull();
    expect(line.textContent).not.toContain("task_a77ed7ba463f48a38320");
    expect(line.textContent).not.toContain('Task "Plan the PR tab"');
  });

  it("expands to the worker's reply, read for its task, and collapses again", async () => {
    const { line } = draw();
    const toggle = screen.getByRole("button", { name: "Show Writer's result" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    await waitFor(() => expect(line.getAttribute("data-state")).toBe("open"));
    await waitFor(() => expect(line.querySelector('[data-part="body"]')?.textContent).toContain("mark a stale row"));
    expect(line.textContent).not.toContain("task_a77ed7ba463f48a38320");
    fireEvent.click(screen.getByRole("button", { name: "Hide Writer's result" }));
    await waitFor(() => expect(line.getAttribute("data-state")).toBe("closed"));
    expect(line.querySelector('[data-part="body"]')).toBeNull();
  });

  it("opens the task from its title, apart from the expand toggle", () => {
    const { opened } = draw();
    fireEvent.click(screen.getByRole("button", { name: "Writer finished: Plan the PR tab" }));
    expect(opened).toEqual(["task_y"]);
    expect(screen.getByRole("region", { name: "Task result from Writer" }).getAttribute("data-state")).toBe("closed");
  });
});

describe("the assistant's own message", () => {
  it("stays fully visible with no collapse chrome", () => {
    drawLines(linesOf([message("a", "q1", "assistant", LONG)]), { nameOf: () => "Lead" });
    const entry = document.querySelector('[data-entry="assistant"]')!;
    expect(entry.textContent).toContain("Second finding");
    expect(screen.queryByRole("button", { name: /Show full/ })).toBeNull();
    expect(document.querySelector('[data-line="received"]')).toBeNull();
  });
});