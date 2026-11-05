// @vitest-environment happy-dom
/**
 * The review card and the approval card show text an agent or a tool wrote:
 * a review's prompt, a run's commit subjects, a stop's message. That text is
 * Markdown, so the cards draw it as Markdown, with the renderer chat messages
 * use, instead of showing literal `**` and backticks. HTML in it stays text:
 * a card never turns a model's or a tool's words into elements. A commit
 * subject stays one line: inline Markdown only, still truncated.
 *
 * Renders registry source the way `review-hold.test.tsx` does.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import type { SuspensionItem } from "@flow-state-dev/core/items";
import { FlowProvider, SuspensionResolverProvider } from "@flow-state-dev/react";
import { afterEach, describe, expect, it } from "vitest";
import { Approval } from "../../registry/components/approval";
import { ReviewHold } from "../../registry/components/review-hold";
import { SessionItemsProvider } from "../../registry/components/session-items-context";

afterEach(cleanup);

/** Streamdown draws bold as a marked span, not `<strong>`. */
const STRONG = '[data-streamdown="strong"]';

const MARKDOWN = "**Cause:** the adapter dropped the row.\n\n- in `src/adapter.ts`\n- and its test";
const HTML = 'Look: <b>bold</b> <img src="x" onerror="alert(1)"> <script>alert(2)</script>';

/** The card's text has no element HTML could have made, and keeps the HTML as text. */
async function htmlStaysText(el: HTMLElement) {
  await waitFor(() => expect(el.textContent).toContain("<b>bold</b>"));
  expect(el.querySelector("b")).toBeNull();
  expect(el.querySelector("img")).toBeNull();
  expect(el.querySelector("script")).toBeNull();
}

/** Bold, a list and inline code drawn as elements, with no literal markers left. */
async function drawsMarkdown(el: HTMLElement) {
  await waitFor(() => expect(el.querySelector(STRONG)?.textContent).toBe("Cause:"));
  expect([...el.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["in src/adapter.ts", "and its test"]);
  expect(el.querySelector("code")?.textContent).toBe("src/adapter.ts");
  expect(el.textContent).not.toContain("**");
  expect(el.textContent).not.toContain("`");
}

describe("the review card draws its text as Markdown", () => {
  it("draws a review's prompt as Markdown", async () => {
    const { container } = render(<ReviewHold prompt={MARKDOWN} answer={async () => {}} />);
    await drawsMarkdown(container.querySelector<HTMLElement>("[data-review-prompt]")!);
  });

  it("shows HTML in a review's prompt as text", async () => {
    const { container } = render(<ReviewHold prompt={HTML} answer={async () => {}} />);
    await htmlStaysText(container.querySelector<HTMLElement>("[data-review-prompt]")!);
  });

  it("draws a commit subject's inline Markdown on one truncated line", async () => {
    const subject = "Fix **the adapter** in `relay`";
    const { container } = render(<ReviewHold review={{ branch: "b", commits: 1, subjects: [subject], judge: null }} />);
    const line = container.querySelector<HTMLElement>(`li[title="${subject}"]`)!;
    await waitFor(() => expect(line.querySelector(STRONG)?.textContent).toBe("the adapter"));
    expect(line.querySelector("code")?.textContent).toBe("relay");
    expect(line.textContent).toBe("·Fix the adapter in relay");
    // One line: no paragraph or list inside the subject, and the text still truncates.
    expect(line.querySelector("p, ul, ol, h1, h2, h3, pre")).toBeNull();
    expect(line.querySelector(".truncate.whitespace-nowrap")).not.toBeNull();
  });

  it("keeps a subject that reads like a list or heading as one line", async () => {
    const { container } = render(<ReviewHold review={{ branch: "b", commits: 2, subjects: ["- not a list", "# not a heading"], judge: null }} />);
    await waitFor(() => expect(container.querySelector('li[title="- not a list"]')?.textContent).toContain("not a list"));
    const lines = container.querySelectorAll("li[title]");
    for (const line of lines) expect(line.querySelector("p, ul, ol, li, h1, h2, h3, pre")).toBeNull();
  });

  it("shows HTML in a commit subject as text", async () => {
    const { container } = render(<ReviewHold review={{ branch: "b", commits: 1, subjects: [HTML], judge: null }} />);
    await htmlStaysText(container.querySelector<HTMLElement>("ul")!);
  });
});

const stop = (message: string): SuspensionItem =>
  ({
    id: "item_sus",
    type: "suspension",
    status: "completed",
    requestId: "req_1",
    itemIndex: 0,
    provenance: { blockName: "b", blockInstanceId: "b1", phase: "main" },
    ts: 0,
    suspensionId: "sus_1",
    reason: "user_approval",
    kind: "approval",
    message,
  }) as SuspensionItem;

function drawApproval(message: string) {
  const item = stop(message);
  return render(
    <FlowProvider flowKind="demo">
      <SuspensionResolverProvider resolve={async () => {}}>
        <SessionItemsProvider value={[item]}>
          <Approval item={item} />
        </SessionItemsProvider>
      </SuspensionResolverProvider>
    </FlowProvider>,
  ).container.querySelector<HTMLElement>("[data-suspension]")!;
}

describe("the approval card draws its message as Markdown", () => {
  it("draws a stop's message as Markdown", async () => {
    await drawsMarkdown(drawApproval(MARKDOWN));
  });

  it("shows HTML in a stop's message as text", async () => {
    await htmlStaysText(drawApproval(HTML));
  });
});
