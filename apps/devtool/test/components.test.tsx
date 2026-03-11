import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

import { StatusBadge } from "@/components/shared/status-badge";
import { KindIndicator } from "@/components/shared/kind-indicator";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorAlert } from "@/components/shared/error-alert";

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
