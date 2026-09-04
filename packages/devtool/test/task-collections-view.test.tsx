/**
 * The Tasks tab's ChildSession column (FIX-1071).
 *
 * The column answers "is a ChildSession running this task", and its absence is
 * only a FACT when the whole ChildSession listing was read. The panel reads one
 * page, so past that page — or when the check for more failed — an unmatched
 * task is unverified rather than unmatched. A bare dash makes the stronger
 * claim, which is the same completeness assertion the truncation union exists
 * to prevent, arriving on the other tab.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { TaskCollectionsView } from "../src/react/components/workspace/task-collections-view";
import type { TaskStreamItem } from "../src/react/lib/task-collection-state";
import type { Truncation } from "../src/react/hooks/use-child-sessions";

/** One `task-change` item, so the fold produces a board with one task on it. */
const taskItem = {
  id: "item_1",
  type: "component",
  status: "completed",
  requestId: "req_1",
  itemIndex: 0,
  provenance: { blockName: "board", blockInstanceId: "b:0", phase: "main" },
  ts: 1_000,
  component: "task-change",
  data: {
    collectionId: "issues",
    taskId: "task-a",
    kind: "claimed",
    task: {
      id: "task-a",
      goal: "do the thing",
      status: "in_progress",
      assignee: "implement",
      metadata: { topic: "FIX-1" },
    },
  },
} as never as TaskStreamItem;

function renderTasks(
  truncation: Truncation,
  childSessions: Parameters<typeof TaskCollectionsView>[0]["childSessions"] = []
) {
  render(
    <TaskCollectionsView
      items={[taskItem]}
      childSessions={childSessions}
      truncation={truncation}
      onOpenChildSession={vi.fn()}
    />
  );
}

/** A ChildSession that matches `task-a` by topic and worker. */
const matching = {
  id: "dsx_1",
  parentSessionId: "sess_parent",
  createdAt: 1,
  updatedAt: 2,
  topic: "FIX-1",
  coordinate: "10:issue-work|20:assignee|9:implement",
} as never;

describe("TaskCollectionsView — an unmatched task", () => {
  it("says nothing is running it only when the whole listing was read", () => {
    renderTasks("complete");

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("—?")).not.toBeInTheDocument();
  });

  it("marks it unverified when ChildSessions were left unread", () => {
    // `more`: the match may be on a page this panel does not read, so the
    // absence is not evidence — and refreshing will not change it.
    renderTasks("more");

    const marker = screen.getByText("—?");
    expect(marker).toBeInTheDocument();
    expect(marker.getAttribute("title")).toMatch(/more background work than the panel reads/i);
  });

  it("distinguishes a failed check from an unread page", () => {
    // `unknown` leads somewhere different: the check itself failed, so
    // refreshing MIGHT settle it. Collapsing the two would tell a reader
    // deciding whether to retry the wrong thing.
    renderTasks("unknown");

    const marker = screen.getByText("—?");
    expect(marker.getAttribute("title")).toMatch(/didn't come back/i);
    expect(marker.getAttribute("title")).not.toMatch(/more background work than the panel reads/i);
  });
});

describe("TaskCollectionsView — a matched task", () => {
  it("links plainly when the whole listing was read", () => {
    renderTasks("complete", [matching]);

    const link = screen.getByRole("button", { name: /FIX-1/ });
    expect(link.getAttribute("title")).not.toMatch(/may not be the one/i);
  });

  it("marks the link unverified when part of the listing was not read", () => {
    // The match is page-local: `resolveChildSession` found exactly one candidate
    // among the rows LOADED. An older unlisted ChildSession sharing the topic and
    // a compatible worker would fit too, and would belong to another board.
    //
    // Marked, not withheld — the link is a best-effort navigation affordance,
    // and withholding it would delete the feature on any session big enough to
    // page.
    renderTasks("more", [matching]);

    const link = screen.getByRole("button", { name: /FIX-1/ });
    expect(link.getAttribute("title")).toMatch(/may not be the one running the task/i);
  });
});
