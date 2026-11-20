// @vitest-environment happy-dom
/**
 * The conversation lines a screen configures instead of copying: what each
 * line offers is what the screen's line context says it can do, and a line
 * outside a provider offers nothing. Lines come from React's conversation
 * model, as an app's do, so the Retry rule is the model's `retryable` and the
 * screen's `retry` together, never either alone.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { OutputItem } from "@flow-state-dev/core/items";
import { conversationLines, FlowProvider, ItemsRenderer, type ItemLine, type LineTurn } from "@flow-state-dev/react";
import { CompactSteps, conversationLineRenderers, LineContext, type LineContextValue } from "../../registry/components/conversation-lines";
import { ToolGroup } from "../../registry/components/tool";
import { suspensionItem, suspensionResumeItem, toolItem } from "../../stories/fixtures/items";

afterEach(cleanup);

const failure = (requestId: string): OutputItem =>
  ({ id: `e-${requestId}`, type: "error", status: "failed", requestId, itemIndex: 0, ts: 0, message: "The model refused the request", code: "provider_error" }) as unknown as OutputItem;

const linesOf = (items: readonly OutputItem[], turns: readonly LineTurn[] = []): ItemLine[] => conversationLines([...items], turns, { renderers: conversationLineRenderers });

function draw(lines: readonly ItemLine[], screenOf?: LineContextValue, steps: ComponentProps<typeof ItemsRenderer>["toolGroupRenderer"] = ToolGroup) {
  const body = <ItemsRenderer lines={lines} toolGroupRenderer={steps} />;
  return render(<FlowProvider renderers={conversationLineRenderers}>{screenOf === undefined ? body : <LineContext.Provider value={screenOf}>{body}</LineContext.Provider>}</FlowProvider>);
}

describe("a failed turn", () => {
  it("offers Retry when the model offers it and the screen can run it, and retries that turn", async () => {
    const retried: string[] = [];
    draw(linesOf([failure("q1")], [{ id: "q1", status: "failed", retryable: true }]), { who: "Ada", retry: async (id) => void retried.push(id) });
    const line = screen.getByRole("alert");
    expect(line.textContent).toContain("Ada couldn't finish this turn");
    await act(async () => fireEvent.click(within(line).getByRole("button", { name: "Retry" })));
    expect(retried).toEqual(["q1"]);
  });

  it("offers no Retry when the engine won't run the turn again, whatever the screen can do", () => {
    draw(linesOf([failure("q1")], [{ id: "q1", status: "failed", retryable: false }]), { retry: async () => {} });
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  // A popup draws the same line with no way to run it again.
  it("offers no Retry outside a screen that can run it", () => {
    draw(linesOf([failure("q1")], [{ id: "q1", status: "failed", retryable: true }]));
    expect(screen.getByRole("alert").textContent).toContain("The model refused the request");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});

describe("a stopped turn", () => {
  const stopped = () => linesOf([toolItem({ requestId: "q1" })], [{ id: "q1", status: "aborted" }]);

  it("says the work still running when the screen counts it for this line, with View", () => {
    const seen: string[] = [];
    let viewed = 0;
    draw(stopped(), { stillRunning: (id) => (seen.push(id), 2), onViewRunning: () => void viewed++ });
    const line = document.querySelector("[data-line=stopped]")!;
    expect(line.textContent).toContain("Interrupted by you · 2 background tasks still running");
    expect(seen).toEqual([stopped().at(-1)!.id]);
    fireEvent.click(within(line as HTMLElement).getByRole("button", { name: "View" }));
    expect(viewed).toBe(1);
  });

  it("says only that it was stopped outside a provider", () => {
    draw(stopped());
    expect(document.querySelector("[data-line=stopped]")!.textContent).toBe("Interrupted by you");
  });
});

describe("a wait for the person's yes", () => {
  const ask = suspensionItem({ suspensionId: "s1", message: "Publish the draft?" });

  it("is answered with Approve and Reject on a screen that answers it", () => {
    draw(linesOf([ask]), { who: "writer", canAnswer: true });
    const card = screen.getByRole("region", { name: "writer asks" });
    expect(within(card).getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Reject" })).toBeTruthy();
  });

  // A popup has no flow to answer through: buttons there would do nothing.
  it("offers no answer where the screen doesn't answer it, and says it waits", () => {
    draw(linesOf([ask]), { who: "writer" });
    const card = screen.getByRole("region", { name: "writer asks" });
    expect(within(card).queryByRole("button")).toBeNull();
    expect(card.textContent).toContain("Waiting for you");
  });

  it("says how it was answered, from the line, with nothing left to press", () => {
    draw(linesOf([ask, suspensionResumeItem({ suspensionId: "s1", resolution: "rejected" })]), { who: "writer", canAnswer: true });
    const card = screen.getByRole("region", { name: "writer asks" });
    expect(card.getAttribute("data-resolution")).toBe("rejected");
    expect(within(card).queryByRole("button")).toBeNull();
    expect(card.textContent).toContain("Publish the draft?");
  });

  it("draws nothing for a wait that isn't for a yes", () => {
    draw(linesOf([suspensionItem({ reason: "user_input", resumeSchema: { type: "object", properties: { answer: { type: "string" } } } })]), { canAnswer: true });
    expect(document.querySelector("[data-line=approval]")).toBeNull();
  });
});

describe("a run of tool calls", () => {
  const read = (path: string, status: "completed" | "in_progress" = "completed") =>
    toolItem({ name: "readProjectSource", args: { path }, status, requestId: "q1", output: status === "completed" ? { kind: "read", status: "ok", path, content: "x" } : null });

  it("is the tool item's group in the default look", () => {
    draw(linesOf([read("a.ts"), read("b.ts")]));
    expect(screen.getByTestId("tool-group").textContent).toBe("Read 2 files");
  });

  it("is one small line in the compact look, open while it runs and folded once done", () => {
    draw(linesOf([read("docs/a.md"), read("src/b.ts", "in_progress")]), undefined, CompactSteps);
    expect(document.querySelector("details")!.open).toBe(true);
    expect(document.querySelector("summary")!.textContent).toBe("Read src/b.ts…");
    cleanup();
    draw(linesOf([read("docs/a.md"), read("src/b.ts")]), undefined, CompactSteps);
    expect(document.querySelector("details")!.open).toBe(false);
    expect(document.querySelector("summary")!.textContent).toBe("Read 2 files");
  });

  // A turn that crashed mid-call must not leave its steps reading as still going.
  it("reads a call its turn left running as failed once the turn is over, in the compact look", () => {
    draw(linesOf([read("a.ts"), read("b.ts", "in_progress")], [{ id: "q1", status: "failed" }]), undefined, CompactSteps);
    expect(document.querySelector("summary")!.textContent).toBe("Read 2 files (1 failed)");
  });

  it("reads a call the agent redid as tried, in the compact look", () => {
    draw(linesOf([toolItem({ name: "openWorkstream", status: "failed", requestId: "q1" }), toolItem({ name: "openWorkstream", requestId: "q1" })]), undefined, CompactSteps);
    const run = document.querySelector("[data-line=steps]")!;
    expect(run.getAttribute("data-state")).toBe("completed");
    expect(run.querySelector("li")!.textContent).toBe("· Tried openWorkstream");
  });
});
