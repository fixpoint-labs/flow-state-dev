/**
 * The Workstreams panel (FIX-1071).
 *
 * What is pinned here is that a row renders from the *session* record alone. A
 * Workstream can arrive with no topic, no coordinate, no status and no task
 * behind it, and each of those is an ordinary state rather than a reason to drop
 * the row — a panel that only rendered fully-labelled, board-backed rows would
 * look correct on the happy path and hide exactly the work a developer went
 * looking for.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import type { WorkstreamSummary } from "@flow-state-dev/client";
import { WorkstreamsView } from "../src/react/components/workspace/workstreams-view";

function workstream(
  overrides: Partial<WorkstreamSummary> & { id: string }
): WorkstreamSummary {
  return {
    parentSessionId: "sess_parent",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,
    ...overrides,
  };
}

function renderView(props: Partial<React.ComponentProps<typeof WorkstreamsView>> = {}) {
  const onOpen = vi.fn();
  const onRefresh = vi.fn();
  render(
    <WorkstreamsView
      sessionId="sess_parent"
      workstreams={[]}
      isLoading={false}
      error={null}
      truncated={false}
      onRefresh={onRefresh}
      items={[]}
      onOpen={onOpen}
      {...props}
    />
  );
  return { onOpen, onRefresh };
}

describe("WorkstreamsView", () => {
  it("says a session has no background work rather than showing a bare table", () => {
    renderView();
    expect(screen.getByText(/No background work in this session/i)).toBeInTheDocument();
  });

  it("renders a row for a Workstream with no task, no labels and no status", () => {
    // The case the whole panel exists for: a Workstream reachable from no board.
    // Every derived column is absent, and the row still has to be clickable.
    const { onOpen } = renderView({
      workstreams: [workstream({ id: "dsx_bare" })],
    });

    expect(screen.getByText("unlabelled")).toBeInTheDocument();
    // Absence of a status is not a status — it says nothing has run yet.
    expect(screen.getByText("not started")).toBeInTheDocument();

    fireEvent.click(screen.getByText("unlabelled"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "dsx_bare" }));
  });

  it("decodes the board and worker out of the coordinate label", () => {
    // The raw label is `10:issue-work|20:assignee|9:implement`. Rendering that
    // verbatim beside a hashed id tells a developer nothing.
    renderView({
      workstreams: [
        workstream({
          id: "dsx_1",
          topic: "FIX-1",
          coordinate: "10:issue-work|20:assignee|9:implement",
          status: "active",
        }),
      ],
    });

    expect(screen.getByText("issue-work")).toBeInTheDocument();
    expect(screen.getByText("assignee:implement")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  it("shows an unrecognised coordinate raw instead of dropping it", () => {
    // Some other writer's label is still the most specific thing known about
    // that worker.
    renderView({
      workstreams: [workstream({ id: "dsx_1", topic: "t", coordinate: "opaque" })],
    });
    expect(screen.getByText("opaque")).toBeInTheDocument();
  });

  it("names the board tasks a Workstream is running", () => {
    renderView({
      workstreams: [workstream({ id: "dsx_1", topic: "task-a" })],
      items: [
        {
          id: "item-1",
          type: "component",
          component: "task-change",
          data: {
            collectionId: "issues",
            taskId: "task-a",
            kind: "claimed",
            task: { id: "task-a", goal: "ship it", status: "in_progress" },
          },
        } as never,
      ],
    });

    // Twice: once as the row's topic, once as the task it resolved to. The Tasks
    // column is the one that proves the item stream was folded in.
    expect(screen.getAllByText("task-a")).toHaveLength(2);
  });

  it("surfaces a failed re-read without blanking the rows it already has", () => {
    // Keeping the rows matters: an empty list is the panel's way of saying "no
    // background work", so blanking on error would state something false.
    renderView({
      workstreams: [workstream({ id: "dsx_1", topic: "FIX-1" })],
      error: "network down",
    });

    expect(screen.getByText("network down")).toBeInTheDocument();
    expect(screen.getByText("FIX-1")).toBeInTheDocument();
  });

  it("reads a null status as not-started rather than an empty badge", () => {
    // A store that nulls absent keys hands back `null` where an older record
    // has `undefined`. A strict `undefined` check renders the badge with no
    // text in it, which looks like a status nobody can name (BP-030).
    renderView({
      workstreams: [
        workstream({ id: "dsx_1", topic: "FIX-1", status: null as never }),
      ],
    });

    expect(screen.getByText("not started")).toBeInTheDocument();
  });

  it("opens a Workstream from the keyboard, not only by pointer", () => {
    // The row's onClick is a pointer convenience. A clickable `<tr>` takes no
    // focus, no Enter and announces nothing, so the tab's primary action has to
    // be a real control or it does not exist for a keyboard user.
    const { onOpen } = renderView({
      workstreams: [workstream({ id: "dsx_1", topic: "FIX-1" })],
    });

    const open = screen.getByRole("button", { name: /Open workstream dsx_1/i });
    open.focus();
    expect(open).toHaveFocus();

    // Enter on a focused native button dispatches a click.
    fireEvent.click(open);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "dsx_1" }));
  });

  it("says so when the listing stopped at its bound", () => {
    // The count beside a truncated list is the failure that matters: it reads
    // as complete, so the newest background work looks like it does not exist.
    renderView({
      workstreams: [workstream({ id: "dsx_1", topic: "FIX-1" })],
      truncated: true,
    });

    expect(
      screen.getByText(/more background work than the panel reads in one go/i)
    ).toBeInTheDocument();
  });
});
