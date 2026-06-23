/**
 * Tests for the FIX-141 operator-UI surface: the SuspensionsView list/detail
 * pane, the suspension stream-item renderer, and the `suspended` status badge.
 * Mocks `useDevTool` to inject fake debug/recovery clients (the same idiom as
 * use-sessions.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import type { SuspensionRecord } from "@flow-state-dev/client";

const listSuspensions = vi.fn();
const resumeSuspensionStream = vi.fn();

const devToolState = {
  sessionClient: { debug: { listSuspensions } },
  recoveryClient: { resumeSuspensionStream },
};

vi.mock("../src/react/context/devtool-context", () => ({
  useDevTool: () => devToolState,
}));

import { SuspensionsView } from "../src/react/components/workspace/suspensions-view";
import { StatusBadge } from "../src/react/components/shared/status-badge";
import { SuspensionItemView } from "../src/react/components/items/suspension-item";
import type { SuspensionItem } from "@flow-state-dev/core/items";

function pendingRecord(overrides: Partial<SuspensionRecord> = {}): SuspensionRecord {
  return {
    suspensionId: "sus_1",
    requestId: "req_1",
    flowKind: "chat",
    actionName: "ask",
    userId: "user_1",
    reason: "human_approval",
    message: "Approve this draft?",
    status: "pending",
    blockInstanceId: "b1",
    stepIndex: 0,
    createdAt: 1000,
    ...overrides,
  };
}

describe("SuspensionsView", () => {
  beforeEach(() => {
    listSuspensions.mockReset().mockResolvedValue({ suspensions: [] });
    // Streaming resume returns a Response; a 202-style (non-SSE) response is the
    // simplest stand-in — the hook drains its body and reports stream: null.
    resumeSuspensionStream.mockReset().mockResolvedValue({
      headers: { get: () => "application/json" },
      body: null,
    });
  });

  it("renders an empty state when there are no suspensions", async () => {
    render(<SuspensionsView sessionId="sess_1" />);
    await waitFor(() => {
      expect(screen.getByText(/No suspensions/i)).toBeInTheDocument();
    });
  });

  it("renders a pending suspension and resolves it via Approve", async () => {
    listSuspensions.mockResolvedValue({ suspensions: [pendingRecord()] });
    render(<SuspensionsView sessionId="sess_1" />);

    // Row appears (the list shows flowKind / reason, not the message).
    await waitFor(() => {
      expect(screen.getByText("chat")).toBeInTheDocument();
    });

    // Select the row to open the detail pane, then the message shows.
    fireEvent.click(screen.getByText("chat"));
    await waitFor(() => {
      expect(screen.getByText("Approve this draft?")).toBeInTheDocument();
    });

    const approve = await screen.findByRole("button", { name: "Approve" });
    fireEvent.click(approve);

    await waitFor(() => {
      expect(resumeSuspensionStream).toHaveBeenCalledWith("chat", "req_1", {
        suspensionId: "sus_1",
        action: "approve",
        data: undefined,
        resumedBy: undefined,
      });
    });
  });

  it("shows the debug-disabled notice on a 403 gate", async () => {
    const { ClientHttpError } = await import("@flow-state-dev/client");
    listSuspensions.mockRejectedValue(
      new ClientHttpError("forbidden", {
        status: 403,
        body: { error: "debug_endpoints_disabled" },
      })
    );
    render(<SuspensionsView sessionId="sess_1" />);

    await waitFor(() => {
      expect(screen.getByText(/Debug endpoints are disabled/i)).toBeInTheDocument();
    });
  });
});

describe("StatusBadge (suspended)", () => {
  it("renders the suspended status", () => {
    render(<StatusBadge status="suspended" />);
    expect(screen.getByText("suspended")).toBeInTheDocument();
  });
});

describe("SuspensionItemView", () => {
  it("renders the message, reason, and status", () => {
    const item = {
      id: "i1",
      type: "suspension",
      status: "completed",
      requestId: "req_1",
      itemIndex: 0,
      ts: 0,
      provenance: {
        blockName: "approve",
        blockInstanceId: "b1",
        phase: "main",
      },
      suspensionId: "sus_1",
      suspensionStatus: "pending",
      reason: "human_approval",
      message: "Approve this draft?",
    } as unknown as SuspensionItem;

    render(<SuspensionItemView item={item} />);
    expect(screen.getByText("Approve this draft?")).toBeInTheDocument();
    expect(screen.getByText("human_approval")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
  });
});
