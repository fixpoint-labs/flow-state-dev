// @vitest-environment happy-dom
/**
 * A task's brief shows its files (FIX-2522): on the brief line a run opens
 * with, under the folded text, and on the task screen's Brief, from the task.
 * Every run of the task gets these files, so a user sees what the worker
 * was handed. Each is read through the Lab's read route, never inlined.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toBlobRef } from "@flow-state-dev/core/attachments";
import type { FileContent, MessageItem } from "@flow-state-dev/core/items";
import { taskBriefMetadata } from "@flow-state-dev/workforce/browser";
import { MessageOrBrief } from "../src/components/TaskBrief";
import { toBoardTaskView } from "../src/lib/reads";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const shot: FileContent = { type: "file", mediaType: "image/png", filename: "bug.png", data: toBlobRef("b_briefshot000001") };

const brief = (content: MessageItem["content"]): MessageItem =>
  ({
    id: "item_brief",
    type: "message",
    role: "user",
    status: "completed",
    content,
    metadata: taskBriefMetadata({ taskId: "t1" }),
  }) as unknown as MessageItem;

describe("a task's brief line", () => {
  it("opens to its text and its files, each read through the Lab's read route", async () => {
    const reads: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      reads.push(url);
      return new Response(new Blob([new Uint8Array([1])], { type: "image/png" }), { status: 200 });
    });
    render(<MessageOrBrief item={brief([{ type: "output_text", text: "Fix the button in the screenshot" }, shot])} />);
    await act(async () => fireEvent.click(screen.getByText("Task brief")));
    const files = screen.getByTestId("task-brief-files");
    expect(within(files).getByRole("list", { name: "Attached files" })).toBeTruthy();
    expect(reads).toEqual(["/api/flows/blobs/b_briefshot000001"]);
    expect(screen.getByText("Fix the button in the screenshot")).toBeTruthy();
  });

  it("draws no files row for a brief filed with none", async () => {
    render(<MessageOrBrief item={brief([{ type: "output_text", text: "Just words" }])} />);
    await act(async () => fireEvent.click(screen.getByText("Task brief")));
    expect(screen.queryByTestId("task-brief-files")).toBeNull();
  });
});

describe("a task's brief files, as the board publishes them", () => {
  it("read as the references the board published, and nothing that isn't one", () => {
    const task = toBoardTaskView("s_conv.tasks", "s_conv", "t1", {
      id: "t1",
      goal: "look",
      attachments: [shot, { type: "file", mediaType: "image/png", data: "aGk=" }, { type: "text", text: "no" }],
    });
    expect(task.attachments).toEqual([shot]);
    expect(toBoardTaskView("s_conv.tasks", "s_conv", "t2", { id: "t2", goal: "look" }).attachments).toEqual([]);
  });
});
