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

  it("opens and closes a file's diff under its row, with several files open at once", async () => {
    const loadPatch = vi.fn(async (path: string) => ({ patch: `@@ -1 +1 @@\n+in ${path}`, truncated: false }));
    render(<RunChanges files={[files[0]!, { path: "src/b.ts", added: 1, removed: 0 }]} loadPatch={loadPatch} defaultOpen />);
    const a = screen.getByRole("button", { name: /src\/a\.ts/ });
    const b = screen.getByRole("button", { name: /src\/b\.ts/ });
    expect(a.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(a);
    fireEvent.click(b);
    expect(a.getAttribute("aria-expanded")).toBe("true");
    expect(await screen.findByText("+in src/a.ts")).toBeTruthy();
    expect(await screen.findByText("+in src/b.ts")).toBeTruthy();
    fireEvent.click(a);
    expect(a.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("+in src/a.ts")).toBeNull();
    expect(screen.getByText("+in src/b.ts")).toBeTruthy();
  });

  it("tints added and removed lines and hunk headers, and leaves out git's file header", async () => {
    const patch = ["diff --git a/src/a.ts b/src/a.ts", "index 1..2 100644", "--- a/src/a.ts", "+++ b/src/a.ts", "@@ -1,2 +1,2 @@", " same", "-old", "+new"].join("\n");
    render(<RunChanges files={files} loadPatch={async () => ({ patch, truncated: false })} defaultOpen />);
    fireEvent.click(screen.getByRole("button", { name: /src\/a\.ts/ }));
    expect((await screen.findByText("+new")).getAttribute("class")).toContain("bg-success/10");
    expect(screen.getByText("-old").getAttribute("class")).toContain("bg-destructive/10");
    expect(screen.getByText("@@ -1,2 +1,2 @@").getAttribute("class")).toContain("text-muted-foreground");
    expect(screen.queryByText("+++ b/src/a.ts")).toBeNull();
    expect(screen.queryByText("index 1..2 100644")).toBeNull();
  });

  it("says a binary, deleted or renamed file in one line instead of drawing its patch", async () => {
    const patches: Record<string, string> = {
      "logo.png": "diff --git a/logo.png b/logo.png\nnew file mode 100644\nindex 0..1\nBinary files /dev/null and b/logo.png differ",
      "src/a.ts": "diff --git a/src/a.ts b/src/a.ts\ndeleted file mode 100644\nindex 1..0\n--- a/src/a.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone",
      "src/c.ts": "diff --git a/src/old.ts b/src/c.ts\nsimilarity index 100%\nrename from src/old.ts\nrename to src/c.ts",
    };
    render(<RunChanges files={[...files, { path: "src/c.ts", added: 0, removed: 0 }]} loadPatch={async (path) => ({ patch: patches[path]!, truncated: false })} defaultOpen />);
    for (const name of [/logo\.png/, /src\/a\.ts/, /src\/c\.ts/]) fireEvent.click(screen.getByRole("button", { name }));
    expect(await screen.findByText("Binary file: no lines to show.")).toBeTruthy();
    expect(await screen.findByText("File deleted.")).toBeTruthy();
    expect(screen.queryByText("-gone")).toBeNull();
    expect(await screen.findByText("Renamed from src/old.ts.")).toBeTruthy();
  });

  it("says when a patch was cut and how long the whole one is, and when it couldn't be read", async () => {
    const loadPatch = vi.fn(async (path: string) => {
      if (path === "logo.png") throw new Error("no checkout");
      return { patch: "@@ -0,0 +1,5000 @@\n+x", truncated: true, lines: 5006 };
    });
    render(<RunChanges files={files} loadPatch={loadPatch} defaultOpen />);
    fireEvent.click(screen.getByRole("button", { name: /src\/a\.ts/ }));
    expect(await screen.findByText("Diff too large, 5,006 lines: showing the start.")).toBeTruthy();
    expect(screen.getByText("The diff is cut here.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /logo\.png/ }));
    expect(await screen.findByText(/couldn't be read: no checkout/)).toBeTruthy();
  });

  it("says the diff is no longer available instead of showing no changes, and reads it again on reopen", async () => {
    const loadPatch = vi.fn(async () => ({ patch: "", truncated: false, verified: false }));
    render(<RunChanges files={files} loadPatch={loadPatch} defaultOpen />);
    const row = screen.getByRole("button", { name: /src\/a\.ts/ });
    fireEvent.click(row);
    expect(await screen.findByText("Diff no longer available.")).toBeTruthy();
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
