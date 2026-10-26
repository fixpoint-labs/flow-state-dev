// @vitest-environment happy-dom
/**
 * While an agent's step is in flight, the group's own line says what it is
 * doing, so the streaming indicator under it would say the same thing twice.
 * The indicator comes back whenever no step is in flight, which is when it is
 * the only sign the request is alive.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RequestGroupRenderer } from "../../registry/components/request-group";
import { messageItem, toolItem } from "../../stories/fixtures/items";

afterEach(cleanup);

const bash = (description: string, status: "completed" | "in_progress") =>
  toolItem({ name: "Bash", args: { command: "pnpm test", description }, status });

function renderStream(items: ReturnType<typeof toolItem>[], statusMessage?: string) {
  render(<RequestGroupRenderer items={[messageItem({ role: "user" }), ...items]} isStreaming statusMessage={statusMessage} />);
}

describe("the streaming indicator beside a live group", () => {
  it("is not shown while a step is in flight, so the same words are not on screen twice", () => {
    renderStream([bash("Read core harness contract", "in_progress")], "Read core harness contract");
    expect(screen.getAllByText(/Read core harness contract/)).toHaveLength(1);
    expect(screen.queryByText("Working...")).toBeNull();
  });

  it("is shown when the steps so far are done and the agent is between them", () => {
    renderStream([bash("Read core harness contract", "completed")]);
    expect(screen.getByText("Working...")).toBeTruthy();
  });

  it("is shown before the first step", () => {
    renderStream([], "Starting Claude Code…");
    expect(screen.getByText("Starting Claude Code…")).toBeTruthy();
  });
});
