// @vitest-environment happy-dom
/**
 * Where a task's popup draws depends on where it was opened from. The panel's
 * task cards open it docked against the panel, so the list it came from stays
 * beside it. Opened from the conversation (a finished-task line, a filed
 * task's card, the waiting banner), it floats centred over the conversation:
 * docked there, it read as if it came from the panel's list.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PopupView, type Popup } from "../src/components/Popups";
import { lookOf } from "../src/lib/looks";
import { codingTask, stubServer, TestProvider } from "./stub-server";

afterEach(cleanup);

const open = (popup: Popup) => {
  const server = stubServer({ board: { wks_cos: [codingTask({ id: "task_r", title: "Plan it", assignee: "researcher", status: "completed" })] } });
  render(
    <TestProvider client={server.client}>
      <PopupView popup={popup} nameOf={(id) => id} lookOf={(id) => lookOf({ id, name: id })} isCoding={() => false} coders={[]} onClose={() => {}} />
    </TestProvider>,
  );
  return screen.getByRole("dialog").closest("[data-overlay-backdrop]")!;
};

describe("a task popup's placement", () => {
  it("is centred over the conversation when the conversation opened it", () => {
    const backdrop = open({ kind: "task", sessionId: "wks_cos", taskId: "task_r", opener: "conversation" });
    expect(backdrop.className).toContain("justify-center");
    expect(backdrop.className).not.toContain("justify-end");
  });

  it("control: stays docked beside the panel when the panel opened it", () => {
    const backdrop = open({ kind: "task", sessionId: "wks_cos", taskId: "task_r" });
    expect(backdrop.className).toContain("justify-end");
  });
});
