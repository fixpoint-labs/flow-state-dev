/**
 * The header's store-size readout: shows the store's own reading, and shows
 * nothing at all when there is no reading to show (a store that can't measure
 * itself, a closed debug gate, a failed read), never a placeholder number.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { ClientHttpError } from "@flow-state-dev/client";

const storage = vi.fn();
vi.mock("../src/react/context/devtool-context", () => ({
  useDevTool: () => ({ client: { debug: { storage } } }),
}));

import { StorageSizeReadout } from "../src/react/components/shared/storage-size";
import { formatBytes } from "../src/react/lib/utils";

beforeEach(() => {
  storage.mockReset();
});

describe("StorageSizeReadout", () => {
  it("shows the size, with the store kind and location in its tooltip", async () => {
    storage.mockResolvedValue({ storage: { kind: "sqlite", bytes: 44_355_584, location: "/app/.fsdev/data/flowstate.db" } });
    render(<StorageSizeReadout />);

    const readout = await screen.findByTestId("storage-size");
    expect(readout.textContent).toBe("DB 42.3 MB");
    expect(readout.getAttribute("title")).toContain("sqlite");
    expect(readout.getAttribute("title")).toContain("/app/.fsdev/data/flowstate.db");
  });

  it("renders nothing for a store that can't measure itself", async () => {
    storage.mockResolvedValue({ storage: null });
    const { container } = render(<StorageSizeReadout />);

    await waitFor(() => expect(storage).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("renders nothing when the debug gate is closed", async () => {
    storage.mockRejectedValue(new ClientHttpError("Forbidden", { status: 403, body: { error: "debug_endpoints_disabled" } }));
    const { container } = render(<StorageSizeReadout />);

    await waitFor(() => expect(storage).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});

describe("formatBytes", () => {
  it("reads in binary units", () => {
    expect(formatBytes(812)).toBe("812 B");
    expect(formatBytes(4096)).toBe("4.0 KB");
    expect(formatBytes(1024 * 1024 * 1.5)).toBe("1.5 MB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.0 GB");
  });
});
