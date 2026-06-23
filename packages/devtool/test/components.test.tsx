import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

import { StatusBadge } from "../src/react/components/shared/status-badge";
import { KindIndicator } from "../src/react/components/shared/kind-indicator";
import { EmptyState } from "../src/react/components/shared/empty-state";
import { ErrorAlert } from "../src/react/components/shared/error-alert";

// ── StatusBadge ───────────────────────────────────────────────

describe("StatusBadge", () => {
  it("renders the status text", () => {
    render(<StatusBadge status="completed" />);
    expect(screen.getByText("completed")).toBeInTheDocument();
  });

  it("renders unknown statuses without crashing", () => {
    render(<StatusBadge status="unknown_status" />);
    expect(screen.getByText("unknown_status")).toBeInTheDocument();
  });

  it.each(["completed", "in_progress", "failed", "incomplete", "created"])(
    "renders %s status",
    (status) => {
      const { container } = render(<StatusBadge status={status} />);
      expect(container.firstChild).toBeTruthy();
    },
  );
});

// ── KindIndicator ─────────────────────────────────────────────

describe("KindIndicator", () => {
  it("renders known kind labels", () => {
    render(<KindIndicator kind="generator" />);
    expect(screen.getByText("GEN")).toBeInTheDocument();
  });

  it("renders handler as HDL", () => {
    render(<KindIndicator kind="handler" />);
    expect(screen.getByText("HDL")).toBeInTheDocument();
  });

  it("renders sequencer as SEQ", () => {
    render(<KindIndicator kind="sequencer" />);
    expect(screen.getByText("SEQ")).toBeInTheDocument();
  });

  it("renders router as RTR", () => {
    render(<KindIndicator kind="router" />);
    expect(screen.getByText("RTR")).toBeInTheDocument();
  });

  it("falls back to raw kind string for unknown kinds", () => {
    render(<KindIndicator kind="custom" />);
    expect(screen.getByText("custom")).toBeInTheDocument();
  });
});

// ── EmptyState ────────────────────────────────────────────────

describe("EmptyState", () => {
  it("renders the message", () => {
    render(<EmptyState message="No items yet" />);
    expect(screen.getByText("No items yet")).toBeInTheDocument();
  });

  it("renders icon when provided", () => {
    render(<EmptyState message="Empty" icon={<span data-testid="icon">X</span>} />);
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });
});

// ── ErrorAlert ────────────────────────────────────────────────

describe("ErrorAlert", () => {
  it("renders the error message", () => {
    render(<ErrorAlert message="Something went wrong" />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("shows retry button when onRetry is provided", () => {
    const onRetry = vi.fn();
    render(<ErrorAlert message="Error" onRetry={onRetry} />);

    const retryButton = screen.getByText("Retry");
    expect(retryButton).toBeInTheDocument();

    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("hides retry button when onRetry is not provided", () => {
    render(<ErrorAlert message="Error" />);
    expect(screen.queryByText("Retry")).not.toBeInTheDocument();
  });
});

// ── RequestSeparator (FIX-438 source badge) ─────────────────

import { RequestSeparator } from "../src/react/components/workspace/request-separator";
import { DebugProvider } from "../src/react/context/debug-context";

function renderSeparator(props: Parameters<typeof RequestSeparator>[0]) {
  return render(
    <DebugProvider>
      <RequestSeparator {...props} />
    </DebugProvider>,
  );
}

describe("RequestSeparator (transport source surface)", () => {
  const baseProps = {
    requestId: "req_123",
    action: "run",
    status: "completed",
  };

  it("shows a badge for non-http sources", () => {
    renderSeparator({ ...baseProps, source: "webhook" });
    expect(screen.getByText("Webhook")).toBeInTheDocument();
  });

  it("renders unknown sources as a generic badge", () => {
    renderSeparator({ ...baseProps, source: "custom-bot" });
    expect(screen.getByText("custom-bot")).toBeInTheDocument();
  });

  it("does not render the badge for http or undefined source", () => {
    renderSeparator({ ...baseProps, source: "http" });
    expect(screen.queryByText("HTTP")).not.toBeInTheDocument();

    renderSeparator({ ...baseProps });
    expect(screen.queryByText("Webhook")).not.toBeInTheDocument();
  });

  it("appends · scheduleId to the source chip for scheduled requests", () => {
    renderSeparator({
      ...baseProps,
      source: "scheduled",
      metadata: { schedule: { scheduleId: "monthly-invoices", origin: "static" } },
    });
    expect(screen.getByText(/Scheduled\s*·\s*monthly-invoices/)).toBeInTheDocument();
  });

  it("renders an origin badge alongside the scheduled chip", () => {
    renderSeparator({
      ...baseProps,
      source: "scheduled",
      metadata: { schedule: { scheduleId: "u_1/digest", origin: "dynamic" } },
    });
    expect(screen.getByText("dynamic")).toBeInTheDocument();
  });

  it("labels the chip from legacy flat metadata during a rolling deploy", () => {
    // Records enqueued by the pre-namespacing build carry flat
    // `metadata.{scheduleId,origin}`. The chip falls back to them so in-flight
    // jobs stay distinguishable while a mixed deployment drains.
    renderSeparator({
      ...baseProps,
      source: "scheduled",
      metadata: { scheduleId: "monthly-invoices", origin: "static" },
    });
    expect(screen.getByText(/Scheduled\s*·\s*monthly-invoices/)).toBeInTheDocument();
  });

  it("truncates long schedule ids in the middle for the chip", () => {
    const longId = "a".repeat(20) + "/" + "b".repeat(40);
    renderSeparator({
      ...baseProps,
      source: "scheduled",
      metadata: { schedule: { scheduleId: longId, origin: "dynamic" } },
    });
    expect(screen.getByText(/…/)).toBeInTheDocument();
  });

  it("opens the provenance panel when the source chip is clicked", () => {
    renderSeparator({
      ...baseProps,
      source: "scheduled",
      metadata: {
        schedule: {
          scheduleId: "monthly-invoices",
          origin: "static",
          cron: "0 0 1 * *",
          nominalFireTime: "2026-06-01T00:00:00Z",
        },
      },
    });
    fireEvent.click(screen.getByText(/Scheduled/));
    expect(screen.getByText("Provenance")).toBeInTheDocument();
    // The namespaced `schedule` slot is flattened in the provenance panel,
    // so the cron value still renders as its own row.
    expect(screen.getByText("0 0 1 * *")).toBeInTheDocument();
  });
});
