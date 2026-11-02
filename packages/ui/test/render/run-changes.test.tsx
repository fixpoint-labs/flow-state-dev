// @vitest-environment happy-dom
/**
 * A reviewer sees what a run changed before accepting it: the file count and
 * lines on one line, each file under it, and a file's patch when they open it.
 *
 * A patch is read only when its file is opened (a run can change hundreds of
 * files, and the read is one git call each), and once: closing and reopening a
 * file doesn't read it again. A run whose changes couldn't be read draws
 * nothing, since "0 files changed" would be a claim nobody checked.
 *
 * Renders registry source, which imports shadcn primitives through `@/`; the
 * vitest config aliases those to Storybook's stubs, the way Storybook builds.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunChanges } from "../../registry/components/run-changes";

afterEach(cleanup);

const files = [
  { path: "src/a.ts", added: 3, removed: 1 },
  { path: "logo.png", added: null, removed: null },
];

describe("a run's changes", () => {
  it("says how many files changed and by how many lines, and lists them when opened", () => {
    render(<RunChanges files={files} />);
    const summary = screen.getByRole("button", { name: /2 files changed/ });
    expect(summary.textContent).toContain("+3");
    expect(summary.textContent).toContain("−1");
    expect(screen.queryByText("src/a.ts")).toBeNull();
    fireEvent.click(summary);
    expect(screen.getByText("src/a.ts")).toBeTruthy();
    expect(screen.getByText("binary")).toBeTruthy();
  });

  it("counts the files and lines the read reported beyond the ones it listed", () => {
    render(<RunChanges files={files} fileCount={205} added={900} removed={40} defaultOpen />);
    expect(screen.getByRole("button", { name: /205 files changed/ }).textContent).toContain("+900");
    expect(screen.getByText("and 203 more files")).toBeTruthy();
  });

  it("reads a file's patch when it is opened, once, and colours its lines", async () => {
    const loadPatch = vi.fn(async () => ({ patch: "@@ -1 +1 @@\n-old\n+new", truncated: false }));
    render(<RunChanges files={files} loadPatch={loadPatch} defaultOpen />);
    expect(loadPatch).not.toHaveBeenCalled();
    const row = screen.getByRole("button", { name: /src\/a\.ts/ });
    fireEvent.click(row);
    expect(loadPatch).toHaveBeenCalledWith("src/a.ts");
    expect((await screen.findByText("+new")).getAttribute("class")).toContain("text-success");
    expect(screen.getByText("-old").getAttribute("class")).toContain("text-destructive");
    fireEvent.click(row);
    fireEvent.click(row);
    expect(loadPatch).toHaveBeenCalledTimes(1);
  });

  it("says when a patch was cut, and when it couldn't be read", async () => {
    const loadPatch = vi.fn(async (path: string) => {
      if (path === "logo.png") throw new Error("no checkout");
      return { patch: "+x", truncated: true };
    });
    render(<RunChanges files={files} loadPatch={loadPatch} defaultOpen />);
    fireEvent.click(screen.getByRole("button", { name: /src\/a\.ts/ }));
    expect(await screen.findByText(/The patch is cut here/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /logo\.png/ }));
    expect(await screen.findByText(/couldn't be read: no checkout/)).toBeTruthy();
  });

  it("says an unread patch couldn't be read instead of showing no changes, and reads it again on reopen", async () => {
    const loadPatch = vi.fn(async () => ({ patch: "", truncated: false, verified: false }));
    render(<RunChanges files={files} loadPatch={loadPatch} defaultOpen />);
    const row = screen.getByRole("button", { name: /src\/a\.ts/ });
    fireEvent.click(row);
    expect(await screen.findByText(/couldn't be read: git couldn't read it/)).toBeTruthy();
    expect(screen.queryByText("No changes to show.")).toBeNull();
    fireEvent.click(row);
    fireEvent.click(row);
    expect(loadPatch).toHaveBeenCalledTimes(2);
  });

  it("draws nothing when the run's changes couldn't be read", () => {
    const { container } = render(<RunChanges files={null} />);
    expect(container.innerHTML).toBe("");
  });
});
