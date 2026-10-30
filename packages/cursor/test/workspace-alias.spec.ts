/**
 * The folder of short links a deep working directory reaches Cursor through:
 * one per OS user, and private, because `tmpdir()` is often a `/tmp` every
 * account on the machine shares.
 */
import { describe, it, expect } from "vitest";
import { chmod, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cursorWorkingDirectory } from "../src/workspace-alias";

describe.skipIf(process.platform === "win32")("cursorWorkingDirectory's link folder", () => {
  it("is this user's own, private, and refused once anyone else could write to it", async () => {
    const base = await mkdtemp(join(tmpdir(), "cursor-alias-"));
    const deep = join(base, "r".repeat(100), "u".repeat(100), "n".repeat(60));
    await mkdir(deep, { recursive: true });
    const link = await cursorWorkingDirectory(deep);
    const root = dirname(link);
    try {
      // Another account could otherwise take the shared name first and refuse
      // this one's links, or repoint one and have the agent write elsewhere.
      expect(root).toBe(join(tmpdir(), `fsd-cursor-${process.getuid!()}`));
      expect((await stat(root)).mode & 0o777).toBe(0o700);

      await chmod(root, 0o777);
      await expect(cursorWorkingDirectory(deep)).rejects.toThrow(/not a private directory this user owns/);
    } finally {
      await chmod(root, 0o700);
      await rm(link, { force: true });
      await rm(base, { recursive: true, force: true });
    }
  });
});
