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
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeGenCommand, registerGenCommand } from "../src/commands/gen";
import { EXIT_EXECUTION_ERROR, EXIT_SUCCESS } from "../src/exit-codes";

const roots: string[] = [];
let cwd: string;
let exitCode: number | string | undefined;

beforeEach(() => {
  cwd = process.cwd();
  exitCode = process.exitCode;
});

afterEach(() => {
  process.exitCode = exitCode;
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

  it("sets an exit code and returns, so the stale report is not cut off", async () => {
    // `process.exit()` terminates before pending stderr writes flush when the
    // stream is a pipe, which is exactly what CI gives it — so the exit status
    // survives and the list of what changed does not. Someone then sees a
    // failed `--check` with no reason in the log.
    //
    // The assertion is that control comes BACK from the action: with the exit
    // call in place, this command would take the test runner down with it.
    const dir = app();
    await executeGenCommand({ root: "workforce" });
    writeFileSync(join(dir, "workforce/blocks/second.ts"), "export default {};");

    const program = new Command();
    registerGenCommand(program);
    await program.parseAsync(["node", "fsdev", "gen", "--check"]);

    expect(process.exitCode).toBe(EXIT_EXECUTION_ERROR);
  });

  it("clears a previously-set failure code on the ordinary success path", async () => {
    // The `--check` success branch resets the code and the plain one did not,
    // so a host that had already set a failure code saw `gen` print success
    // and still exit non-zero. Two branches doing the same job have to agree;
    // the asymmetry is the bug, not the value.
    const dir = app();
    process.exitCode = EXIT_EXECUTION_ERROR;

    const program = new Command();
    registerGenCommand(program);
    await program.parseAsync(["node", "fsdev", "gen"]);

    expect(process.exitCode).toBe(EXIT_SUCCESS);
    expect(readFileSync(join(dir, "workforce/workforce.gen.ts"), "utf-8")).toContain("triage");
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

describe("a package block the tree gained", () => {
  // The same bargain for a package's tools: a block added to a package and
  // not generated is a tool its holders are quietly short of.
  it("is caught by --check, named in the result, and green again once the command has run", async () => {
    const dir = app();
    await executeGenCommand({ root: "workforce" });

    const pkg = "workforce/teams/support/workers/clerk/packages/refunds";
    mkdirSync(join(dir, pkg, "blocks"), { recursive: true });
    writeFileSync(join(dir, pkg, "PACKAGE.md"), "---\ndescription: Refunds\n---\nRefund.\n");
    writeFileSync(join(dir, pkg, "blocks/issue-refund.ts"), "export default {};");

    const stale = await executeGenCommand({ root: "workforce", check: true });
    expect(stale.upToDate).toBe(false);
    expect(stale.packageBlocks.map((entry) => entry.path)).toEqual([
      "teams/support/workers/clerk/packages/refunds/blocks/issue-refund.ts",
    ]);

    await executeGenCommand({ root: "workforce" });
    expect(await executeGenCommand({ root: "workforce", check: true })).toMatchObject({
      upToDate: true,
    });
    expect(readFileSync(join(dir, "workforce/workforce.gen.ts"), "utf-8")).toContain(
      `"teams/support/workers/clerk/packages/refunds": {`,
    );
  });

  it("names the package block in the stale report", async () => {
    const dir = app();
    await executeGenCommand({ root: "workforce" });
    const pkg = "workforce/teams/support/packages/escalation";
    mkdirSync(join(dir, pkg, "blocks"), { recursive: true });
    writeFileSync(join(dir, pkg, "PACKAGE.md"), "---\ndescription: Escalation\n---\n");
    writeFileSync(join(dir, pkg, "blocks/page-oncall.ts"), "export default {};");

    const errors: string[] = [];
    const original = console.error;
    console.error = (message: string) => errors.push(message);
    try {
      const program = new Command();
      registerGenCommand(program);
      await program.parseAsync(["node", "fsdev", "gen", "--check"]);
    } finally {
      console.error = original;
    }
    expect(process.exitCode).toBe(EXIT_EXECUTION_ERROR);
    expect(errors.join("\n")).toContain("teams/support/packages/escalation/blocks/page-oncall.ts");
    expect(errors.join("\n")).toContain("1 package block(s)");
  });
});

describe("a resource module the tree gained", () => {
  // `--check` is the whole guard on the two-step bargain: a team that writes a
  // file and forgets the command gets a seat that is quietly short, and this is
  // the only thing that catches it. So the rule the command owns is that the
  // new family is covered by the same check, with no special case.

  it("is caught by --check, and green again once the command has run", async () => {
    const dir = app();
    await executeGenCommand({ root: "workforce" });

    mkdirSync(join(dir, "workforce/teams/engineering/resources"), { recursive: true });
    writeFileSync(
      join(dir, "workforce/teams/engineering/resources/research.ts"),
      "export default {};",
    );

    // Red on the tree as it stands — the committed file knows nothing about
    // the module — and the report names the file that disagrees, not just that
    // something does.
    const stale = await executeGenCommand({ root: "workforce", check: true });
    expect(stale.upToDate).toBe(false);
    expect(stale.resourceModules.map((module) => module.path)).toEqual([
      "teams/engineering/resources/research.ts",
    ]);

    await executeGenCommand({ root: "workforce" });

    expect(await executeGenCommand({ root: "workforce", check: true })).toMatchObject({
      upToDate: true,
    });
    expect(readFileSync(join(dir, "workforce/workforce.gen.ts"), "utf-8")).toContain(
      `"teams/engineering/research": resource_teams__engineering__research,`,
    );
  });

  it("stops the command from writing anything when the tree is refused", async () => {
    // Nothing is generated when the walk refuses, so a tree is never left half
    // registered — and the refusal an author sees comes from the convention,
    // with this command adding only the exit code.
    const dir = app();
    await executeGenCommand({ root: "workforce" });
    const before = readFileSync(join(dir, "workforce/workforce.gen.ts"), "utf-8");

    mkdirSync(join(dir, "workforce/teams/engineering/resources"), { recursive: true });
    writeFileSync(join(dir, "workforce/teams/engineering/resources/research.md"), "---\n---\n");
    writeFileSync(
      join(dir, "workforce/teams/engineering/resources/research.ts"),
      "export default {};",
    );

    await expect(executeGenCommand({ root: "workforce" })).rejects.toThrow(
      /a document and a module cannot share a ref/,
    );
    expect(readFileSync(join(dir, "workforce/workforce.gen.ts"), "utf-8")).toBe(before);
  });
});
