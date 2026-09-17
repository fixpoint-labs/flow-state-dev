/**
 * Specs for `fsdev gen` — the two things the command owns that the convention
 * does not.
 *
 * The walk's own rules live with the walk, in `@flow-state-dev/workforce`.
 * What is left here is the file this command WRITES: that it refuses to follow
 * a symlinked target, and that it compares on content rather than on bytes so
 * a checkout's line endings cannot report a clean tree as stale.
 *
 * Real temp directories through the real function — both behaviours are
 * filesystem behaviours, and a mock would only restate the implementation.
 */
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeGenCommand } from "../src/commands/gen";

const roots: string[] = [];
let cwd: string;

beforeEach(() => {
  cwd = process.cwd();
});

afterEach(() => {
  process.chdir(cwd);
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** An app directory holding a `workforce/` tree with one block in it. */
function app(): string {
  const dir = mkdtempSync(join(tmpdir(), "fsdev-gen-"));
  roots.push(dir);
  mkdirSync(join(dir, "workforce/blocks"), { recursive: true });
  writeFileSync(join(dir, "workforce/blocks/triage.ts"), "export default {};");
  process.chdir(dir);
  return dir;
}

describe("the file the command writes", () => {
  it("refuses a symlinked generated file rather than writing through it", async () => {
    // `writeFile` follows a symlink, so without this the command overwrites
    // whatever the link points at — a file outside the configured root, which
    // is the no-follow promise broken on the way out instead of the way in.
    const dir = app();
    const outside = mkdtempSync(join(tmpdir(), "fsdev-gen-outside-"));
    roots.push(outside);
    const victim = join(outside, "important.ts");
    writeFileSync(victim, "PRECIOUS");
    symlinkSync(victim, join(dir, "workforce/workforce.gen.ts"));

    await expect(executeGenCommand({ root: "workforce" })).rejects.toThrow(
      /Symlinked generated file "workforce\.gen\.ts" — refused for safety/,
    );
    expect(readFileSync(victim, "utf-8")).toBe("PRECIOUS");
  });

  it("refuses a symlinked generated file under --check too", async () => {
    // `--check` only reads, but `readFile` follows the link just as happily,
    // so the comparison would be against a file that is not this app's.
    const dir = app();
    const outside = mkdtempSync(join(tmpdir(), "fsdev-gen-outside-"));
    roots.push(outside);
    writeFileSync(join(outside, "important.ts"), "PRECIOUS");
    symlinkSync(join(outside, "important.ts"), join(dir, "workforce/workforce.gen.ts"));

    await expect(executeGenCommand({ root: "workforce", check: true })).rejects.toThrow(
      /Symlinked generated file/,
    );
  });

  it("reads a CRLF checkout as up to date, and still writes LF", async () => {
    const dir = app();
    const file = join(dir, "workforce/workforce.gen.ts");

    const written = await executeGenCommand({ root: "workforce" });
    expect(written.upToDate).toBe(false);
    const lf = readFileSync(file, "utf-8");

    // What a Windows checkout with `core.autocrlf=true` hands back. The bytes
    // differ; the content does not, and the difference is git's rather than
    // the author's — so reporting it as stale would fail CI on a clean tree.
    writeFileSync(file, lf.replace(/\n/g, "\r\n"));
    expect(await executeGenCommand({ root: "workforce", check: true })).toMatchObject({
      upToDate: true,
    });

    // Normalising is for the comparison only. A file this command writes is
    // LF, so nothing here quietly adopts the checkout's line endings.
    expect(readFileSync(file, "utf-8")).toContain("\r\n");
    rmSync(file);
    await executeGenCommand({ root: "workforce" });
    expect(readFileSync(file, "utf-8")).not.toContain("\r\n");
  });

  it("still reports a genuinely stale file", async () => {
    // The guard against the fix above: normalising newlines must not soften
    // the staleness check itself.
    const dir = app();
    await executeGenCommand({ root: "workforce" });
    writeFileSync(join(dir, "workforce/blocks/second.ts"), "export default {};");

    expect(await executeGenCommand({ root: "workforce", check: true })).toMatchObject({
      upToDate: false,
    });
  });
});
