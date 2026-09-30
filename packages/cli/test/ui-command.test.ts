/**
 * `fsdev ui add` with several components installs them in one shadcn call.
 *
 * Run once per component, a later one that shares a dependency with an
 * earlier one (`tool` needs `code-block`'s `select`) stops at an overwrite
 * prompt for the file the earlier call wrote. The shadcn CLI is stubbed; what
 * is asserted is the call it would receive.
 */
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnSync = vi.fn(() => ({ status: 0 }));
vi.mock("node:child_process", () => ({ spawnSync }));

const { registerUiCommand } = await import("../src/commands/ui");

async function run(...args: string[]): Promise<void> {
  const program = new Command().exitOverride();
  registerUiCommand(program);
  await program.parseAsync(["node", "fsdev", "ui", "add", ...args]);
}

afterEach(() => {
  spawnSync.mockClear();
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("fsdev ui add", () => {
  it("installs every component in one shadcn call", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await run("code-block", "tool", "approval", "--registry", "https://example.test/r", "--cwd", "/app");
    expect(spawnSync).toHaveBeenCalledTimes(1);
    expect(spawnSync.mock.calls[0]).toEqual([
      "npx",
      [
        "shadcn@latest",
        "add",
        "https://example.test/r/code-block.json",
        "https://example.test/r/tool.json",
        "https://example.test/r/approval.json",
      ],
      expect.objectContaining({ cwd: "/app" }),
    ]);
    expect(process.exitCode).toBe(0);
  });

  it("reports a failed install and sets a failing exit code", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    spawnSync.mockReturnValueOnce({ status: 1 });
    await run("tool", "--registry", "https://example.test/r");
    expect(error).toHaveBeenCalledWith("Failed to install tool.");
    expect(process.exitCode).not.toBe(0);
  });
});
