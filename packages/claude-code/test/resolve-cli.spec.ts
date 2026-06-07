import { describe, it, expect } from "vitest";
import { defaultClaudeCliExec } from "../src/cli/resolve-cli";

describe("defaultClaudeCliExec", () => {
  it("captures stdout and the exit code of a successful process", async () => {
    const { stdout, code } = await defaultClaudeCliExec(
      process.execPath,
      ["-e", "process.stdout.write('hello')"],
      {},
    );
    expect(stdout).toBe("hello");
    expect(code).toBe(0);
  });

  it("resolves with a non-zero code rather than rejecting", async () => {
    const { code } = await defaultClaudeCliExec(process.execPath, ["-e", "process.exit(3)"], {});
    expect(code).toBe(3);
  });

  it("rejects with ENOENT when the binary cannot be launched", async () => {
    await expect(
      defaultClaudeCliExec("definitely-not-a-real-binary-xyz", [], {}),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects when the process exceeds the timeout", async () => {
    await expect(
      defaultClaudeCliExec(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], {
        timeoutMs: 150,
      }),
    ).rejects.toThrow(/timed out/);
  });
});
