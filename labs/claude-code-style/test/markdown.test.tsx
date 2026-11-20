// @vitest-environment happy-dom
/**
 * Agent text renders as Markdown: while it streams, an unfinished code fence
 * already draws as code, and HTML in the text shows as text, never as an element.
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { conversationLines } from "@flow-state-dev/react";
import { TASK_RESULT_DATA_TYPE } from "@flow-state-dev/workforce/browser";
import { claudeCodeRenderers, WorkLines } from "../src/components/lines";

// A result line reads the board's rows where the screen opens tasks; drawn here with none.
vi.mock("../src/app/tasks", async (original) => ({ ...(await original<typeof import("../src/app/tasks")>()), useTasks: () => ({ value: undefined, stale: false }) }));

afterEach(cleanup);

const drawn = (items: object[]) => render(<WorkLines lines={conversationLines(items as never, [], { renderers: claudeCodeRenderers })} />).container;
const say = (text: string) => drawn([{ id: "a1", type: "message", role: "assistant", requestId: "r1", status: "completed", content: [{ type: "output_text", text }] }]);

describe("agent Markdown", () => {
  it("draws headings, lists and emphasis as elements, not as marks", () => {
    const view = say("## Findings\n\n- **Acme** ships weekly\n- Globex ships monthly");
    expect(view.querySelector("h2")?.textContent).toBe("Findings");
    expect(view.querySelectorAll("li")).toHaveLength(2);
    expect(view.querySelector('[data-streamdown="strong"]')?.textContent).toBe("Acme");
    expect(view.textContent).not.toContain("**");
    expect(view.textContent).not.toContain("##");
  });

  it("draws a code fence that hasn't closed yet as code while the text streams in", async () => {
    // The text as it stands mid-stream: the fence is open and its last line half written.
    const view = say("Here is the change:\n\n```ts\nconst answer = 4");
    await waitFor(() => expect(view.querySelector("pre")).not.toBeNull());
    expect(view.querySelector("pre")!.textContent).toContain("const answer = 4");
    // No stray fence marks leak into the prose around it.
    expect(view.textContent).not.toContain("```");
    expect(view.textContent).toContain("Here is the change:");
  });

  it("shows HTML in agent text as the text it is, instead of building it into elements", () => {
    const view = say('Plain <b>bold</b> text <img src="x" onerror="alert(1)"> and <a href="javascript:alert(1)">a link</a>.');
    expect(view.querySelector("b")).toBeNull();
    expect(view.querySelector("img")).toBeNull();
    expect(view.querySelector('a[href^="javascript"]')).toBeNull();
    expect(view.textContent).toContain("<b>bold</b>");
  });

  it("renders a background result's summary as Markdown too, once its line is opened", () => {
    const view = drawn([
      { id: "r1", type: "data", dataType: TASK_RESULT_DATA_TYPE, requestId: "r1", status: "completed", value: { taskId: "t1", title: "Research Acme", text: "Acme ships **weekly**.", ending: "completed" }, provenance: { blockInstanceId: "r1:x:0" } },
    ]);
    fireEvent.click(view.querySelector("button")!);
    expect(view.querySelector('[data-streamdown="strong"]')?.textContent).toBe("weekly");
  });
});
