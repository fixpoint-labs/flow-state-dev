// @vitest-environment happy-dom
/**
 * A task's result is the worker's own text, and a coding run writes it in
 * Markdown: a cause in bold, the commit in inline code, the changed files as a
 * list. The popup's result card draws that Markdown, the way the thread draws a
 * worker's reply, so none of it reads as literal `**` or backticks. HTML in the
 * result stays text, as it does in the thread. A question the run asks is drawn the same way.
 */
import { cleanup, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import { PopupView } from "../src/components/Popups";
import { lookOf } from "../src/lib/looks";
import { codingTask, hold, stubServer, TestProvider } from "./stub-server";

afterEach(cleanup);

/** Streamdown draws bold as a marked span, not `<strong>`. */
const STRONG = '[data-streamdown="strong"]';

/** One task on a stand-in board, with no run: all the popup reads. Its action row is never pressed. */
function drawTask(task: CodingBoardTask) {
  const { client } = stubServer({ board: { s1: [task] } });
  render(
    <TestProvider client={client}>
    <PopupView
     
      popup={{ kind: "task", sessionId: "s1", taskId: "t1" }}
      nameOf={(id) => id}
      lookOf={(id) => lookOf({ id, name: id })}
      isCoding={() => true}
      coders={[]}
      onClose={() => {}}
    />
    </TestProvider>,
  );
}

const drawResult = (answer: string) => drawTask(codingTask({ id: "t1", assignee: "coder", title: "Fix the adapter", status: "completed", detail: { answer, answerCut: false } }));

describe("a task popup's cards", () => {
  it("draws the result's Markdown: bold, inline code and a list, with no literal markers", async () => {
    drawResult("**Cause:** the adapter dropped the row.\n\nCommit `c15d6f098`.\n\n**Changed files**\n\n- `src/adapter.ts`\n- `test/adapter.test.ts`");
    const card = await within(document.body).findByRole("region", { name: "Result" });
    await waitFor(() => expect(card.querySelector(STRONG)?.textContent).toBe("Cause:"));
    expect([...card.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["src/adapter.ts", "test/adapter.test.ts"]);
    expect([...card.querySelectorAll("code")].map((c) => c.textContent)).toContain("c15d6f098");
    expect(card.textContent).not.toContain("**");
    expect(card.textContent).not.toContain("`");
  });

  it("shows HTML in the result as text, never as elements", async () => {
    drawResult('Done: <b>bold</b> <img src="x" onerror="alert(1)"> <script>alert(2)</script>');
    const card = await within(document.body).findByRole("region", { name: "Result" });
    await waitFor(() => expect(card.textContent).toContain("<b>bold</b>"));
    expect(card.querySelector("b")).toBeNull();
    expect(card.querySelector("img")).toBeNull();
    expect(card.querySelector("script")).toBeNull();
  });

  it("draws a question the run asks as Markdown too", async () => {
    drawTask(codingTask({ id: "t1", assignee: "coder", title: "Fix the adapter", status: "in_progress", asks: [hold("question", "Fix **only** `src/adapter.ts`, or every caller?")] }));
    const asked = await within(document.body).findByRole("region", { name: "Waiting on you" });
    await waitFor(() => expect(asked.querySelector(STRONG)?.textContent).toBe("only"));
    expect(asked.querySelector("code")?.textContent).toBe("src/adapter.ts");
    expect(asked.textContent).not.toContain("**");
  });
});
