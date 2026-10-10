/**
 * Specs for `fsdev gen` — what the command owns that a generator does not:
 * finding the generator among the app's dependencies, and the file it WRITES.
 *
 * The generator here is a stand-in package installed into a temp app, so the
 * command is exercised the way an app runs it: resolved from the app's own
 * `package.json`, with no knowledge of any one convention. The real one is
 * tested where it lives, in its own package.
 *
 * Real temp directories through the real function — these are filesystem
 * behaviours, and a mock would only restate the implementation.
 */
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeGenCommand, registerGenCommand } from "../src/commands/gen";
import { EXIT_CONFIG_ERROR, EXIT_EXECUTION_ERROR, EXIT_SUCCESS } from "../src/exit-codes";

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

/**
 * A stand-in generator: lists `blocks/*.ts` under the root into `out.gen.ts`,
 * and refuses a file named `bad.ts` the way a real one refuses: an error with
 * a `problems` list.
 */
const GENERATOR_SOURCE = `
import { readdirSync } from "node:fs";
import { join } from "node:path";
export const generator = {
  defaultRoot: "code",
  async generate(root) {
    const names = readdirSync(join(root, "blocks")).filter((f) => f.endsWith(".ts")).sort();
    if (names.includes("bad.ts")) {
      throw Object.assign(new Error("Refused bad.ts"), { problems: ["blocks/bad.ts"] });
    }
    return {
      file: "out.gen.ts",
      content: "export const blocks = " + JSON.stringify(names) + ";\\n",
      searched: ["blocks/"],
      entries: names.map((n) => "blocks/" + n + " -> " + n.slice(0, -3)),
      paths: names.map((n) => "blocks/" + n),
      summary: names.length + " block(s)",
    };
  },
};
`;

/** Install a package named `name` into `dir`, exporting `exports`. */
function installPackage(dir: string, name: string, exports: Record<string, string>, files: Record<string, string>): void {
  const pkg = join(dir, "node_modules", name);
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name, type: "module", exports }));
  for (const [file, source] of Object.entries(files)) writeFileSync(join(pkg, file), source);
}

/**
 * An app directory depending on a generator package (and on one plain package
 * beside it), holding a `code/` tree with one block in it.
 */
function app(generators: string[] = ["fake-gen"]): string {
  const dir = mkdtempSync(join(tmpdir(), "fsdev-gen-"));
  roots.push(dir);
  const dependencies: Record<string, string> = { plain: "1.0.0" };
  installPackage(dir, "plain", { ".": "./index.mjs" }, { "index.mjs": "export {};" });
  for (const name of generators) {
    dependencies[name] = "1.0.0";
    installPackage(dir, name, { "./fsdev-gen": "./gen.mjs" }, { "gen.mjs": GENERATOR_SOURCE });
  }
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app", dependencies }));
  mkdirSync(join(dir, "code/blocks"), { recursive: true });
  writeFileSync(join(dir, "code/blocks/triage.ts"), "export default {};");
  process.chdir(dir);
  return dir;
}

/** Run the registered command, returning what it printed to stderr. */
async function run(args: string[]): Promise<string> {
  const errors: string[] = [];
  const original = console.error;
  console.error = (message: string) => errors.push(message);
  try {
    const program = new Command();
    registerGenCommand(program);
    await program.parseAsync(["node", "fsdev", "gen", ...args]);
  } finally {
    console.error = original;
  }
  return errors.join("\n");
}

describe("finding the generator", () => {
  it("runs the generator a dependency exports, on its own default root", async () => {
    const dir = app();
    const result = await executeGenCommand({});
    expect(result.generator).toBe("fake-gen");
    expect(result.file).toBe(join(dir, "code/out.gen.ts"));
    expect(readFileSync(result.file, "utf-8")).toContain(`"triage.ts"`);
  });

  it("reads --root instead of the generator's default", async () => {
    const dir = app();
    mkdirSync(join(dir, "elsewhere/blocks"), { recursive: true });
    writeFileSync(join(dir, "elsewhere/blocks/other.ts"), "export default {};");
    const result = await executeGenCommand({ root: "elsewhere" });
    expect(readFileSync(result.file, "utf-8")).toContain(`"other.ts"`);
  });

  it("exits 3 naming the subpath when no dependency supplies a generator", async () => {
    // The app depends only on a package with no `./fsdev-gen` export. A
    // command that fell back to some built-in convention here would be the
    // layer line crossed again.
    app([]);
    const stderr = await run([]);
    expect(process.exitCode).toBe(EXIT_CONFIG_ERROR);
    expect(stderr).toMatch(/No dependency .* exports a generator on "\.\/fsdev-gen"/);
  });

  it("refuses to pick between two generators", async () => {
    app(["gen-a", "gen-b"]);
    const stderr = await run([]);
    expect(process.exitCode).toBe(EXIT_CONFIG_ERROR);
    expect(stderr).toContain("gen-a, gen-b");
  });
});

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
    symlinkSync(victim, join(dir, "code/out.gen.ts"));

    await expect(executeGenCommand({})).rejects.toThrow(
      /Symlinked generated file "out\.gen\.ts" — refused for safety/,
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
    symlinkSync(join(outside, "important.ts"), join(dir, "code/out.gen.ts"));

    await expect(executeGenCommand({ check: true })).rejects.toThrow(
      /Symlinked generated file/,
    );
  });

  it("reads a CRLF checkout as up to date, and still writes LF", async () => {
    const dir = app();
    const file = join(dir, "code/out.gen.ts");

    const written = await executeGenCommand({});
    expect(written.upToDate).toBe(false);
    const lf = readFileSync(file, "utf-8");

    // What a Windows checkout with `core.autocrlf=true` hands back. The bytes
    // differ; the content does not, and the difference is git's rather than
    // the author's — so reporting it as stale would fail CI on a clean tree.
    writeFileSync(file, lf.replace(/\n/g, "\r\n"));
    expect(await executeGenCommand({ check: true })).toMatchObject({
      upToDate: true,
    });

    // Normalising is for the comparison only. A file this command writes is
    // LF, so nothing here quietly adopts the checkout's line endings.
    expect(readFileSync(file, "utf-8")).toContain("\r\n");
    rmSync(file);
    await executeGenCommand({});
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
    await executeGenCommand({});
    writeFileSync(join(dir, "code/blocks/second.ts"), "export default {};");

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
    expect(readFileSync(join(dir, "code/out.gen.ts"), "utf-8")).toContain("triage");
  });

  it("still reports a genuinely stale file", async () => {
    // The guard against the fix above: normalising newlines must not soften
    // the staleness check itself.
    const dir = app();
    await executeGenCommand({});
    writeFileSync(join(dir, "code/blocks/second.ts"), "export default {};");

    expect(await executeGenCommand({ check: true })).toMatchObject({
      upToDate: false,
    });
  });
});

describe("a refusal from the generator", () => {
  it("writes nothing and exits 1, with the generator's own message", async () => {
    // Nothing is generated when the generator refuses, so a tree is never left
    // half registered, and the refusal an author sees is the generator's, with
    // this command adding only the exit code.
    const dir = app();
    await executeGenCommand({});
    const before = readFileSync(join(dir, "code/out.gen.ts"), "utf-8");
    writeFileSync(join(dir, "code/blocks/bad.ts"), "export default {};");

    const stderr = await run([]);
    expect(process.exitCode).toBe(EXIT_EXECUTION_ERROR);
    expect(stderr).toContain("Refused bad.ts");
    expect(readFileSync(join(dir, "code/out.gen.ts"), "utf-8")).toBe(before);
  });

  it("names what the tree holds in the stale report", async () => {
    const dir = app();
    await executeGenCommand({});
    writeFileSync(join(dir, "code/blocks/second.ts"), "export default {};");

    const stderr = await run(["--check"]);
    expect(process.exitCode).toBe(EXIT_EXECUTION_ERROR);
    expect(stderr).toContain("2 block(s)");
    expect(stderr).toContain("  - blocks/second.ts");
  });
});
