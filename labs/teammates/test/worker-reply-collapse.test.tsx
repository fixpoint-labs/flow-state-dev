// @vitest-environment happy-dom
/**
 * Worker-originated conversation lines collapse by default when long; the
 * assistant's own messages stay fully visible.
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { drawLines, linesOf, message, received, result } from "./lines";

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

describe("a task result from another worker", () => {
  it("collapses long result text by default", async () => {
    drawLines(linesOf([result("r", "q1", { taskId: "task_y", from: WRITER, title: "Draft", text: LONG, ending: "completed" })]), { nameOf: () => "writer" });
    const line = await waitFor(() => screen.getByRole("region", { name: "Task result from writer" }));
    expect(line.getAttribute("data-collapsed-default")).toBe("true");
    expect(screen.getByRole("button", { name: "Show full result from writer" })).toBeTruthy();
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