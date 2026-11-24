/**
 * The checks a host runs in a run's checkout: what a command is, and how a
 * set of them runs inside one wall clock.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CHECK_OUTPUT_TAIL_CHARS,
  checkCommandsFrom,
  checkoutCommandPassed,
  checkoutCommandProblem,
  parseCheckoutCommand,
  runCheckoutCommands,
  setupCommandFrom,
  splitCheckoutCommand,
} from "../src/index";

describe("a setting's checks", () => {
  it("are its `;`-separated commands, trimmed, blanks dropped", () => {
    expect(checkCommandsFrom(" pnpm typecheck ;; pnpm --filter web test ", "APP_CHECKS")).toEqual(["pnpm typecheck", "pnpm --filter web test"]);
  });

  it("are none when the setting is unset or blank", () => {
    expect(checkCommandsFrom(undefined, "APP_CHECKS")).toBeUndefined();
    expect(checkCommandsFrom(" ; ", "APP_CHECKS")).toBeUndefined();
  });

  it("refuse a command that needs a shell, naming the setting", () => {
    expect(() => checkCommandsFrom("pnpm build && pnpm test", "APP_CHECKS")).toThrow(/^APP_CHECKS: .*shell operator/);
  });
});

describe("a setting's setup command", () => {
  it("is its one command, split into words with quoted words kept together", () => {
    expect(setupCommandFrom(` pnpm install --filter "@acme/web app" `, "APP_SETUP")).toEqual({ command: ["pnpm", "install", "--filter", "@acme/web app"] });
  });

  it("is none when the setting is unset or blank", () => {
    expect(setupCommandFrom(undefined, "APP_SETUP")).toBeUndefined();
    expect(setupCommandFrom("   ", "APP_SETUP")).toBeUndefined();
  });

  it("refuses a line that needs a shell, or an unclosed quote, naming the setting", () => {
    expect(() => setupCommandFrom("pnpm install && pnpm build", "APP_SETUP")).toThrow(/^APP_SETUP: .*shell operator/);
    expect(() => setupCommandFrom('pnpm install "unclosed', "APP_SETUP")).toThrow(/^APP_SETUP: /);
  });
});

describe("what a command is", () => {
  it("splits words and keeps quoted words together", () => {
    expect(splitCheckoutCommand(`pnpm --filter "@acme/web app" test`)).toEqual(["pnpm", "--filter", "@acme/web app", "test"]);
  });

  it("refuses a line a shell would read as more than one program", () => {
    for (const line of ["pnpm i && pnpm test", "a | b", "a; b", "a > out", "echo $(id)", "echo `id`", "a &"]) {
      expect(checkoutCommandProblem(line), line).toMatch(/shell operator/);
    }
  });

  it("refuses an empty line and an unclosed quote, and accepts a plain one", () => {
    expect(checkoutCommandProblem("   ")).toMatch(/empty/);
    expect(checkoutCommandProblem(`node "x`)).toMatch(/never closed/);
    expect(checkoutCommandProblem("pnpm typecheck")).toBeUndefined();
  });

  it("parses a line once into its words, or the same refusal as checkoutCommandProblem", () => {
    expect(parseCheckoutCommand(`pnpm install --filter "a b"`)).toEqual({ words: ["pnpm", "install", "--filter", "a b"] });
    for (const line of ["pnpm build && pnpm test", "   ", `node "x`]) {
      expect(parseCheckoutCommand(line), line).toEqual({ problem: checkoutCommandProblem(line) });
    }
  });
});

describe("runCheckoutCommands", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "checkout-commands-"));
    writeFileSync(join(dir, "pass.mjs"), "console.log('fine');");
    writeFileSync(join(dir, "fail.mjs"), "console.error('\\u001b[31mTS2322: wrong type\\u001b[0m'); process.exit(2);");
    writeFileSync(join(dir, "noisy.mjs"), `process.stdout.write("x".repeat(${CHECK_OUTPUT_TAIL_CHARS * 3}) + "END");`);
    writeFileSync(join(dir, "hang.mjs"), "setInterval(() => {}, 1000);");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("runs every command in the checkout, a red one not stopping the rest", async () => {
    const results = await runCheckoutCommands({ cwd: dir, commands: ["node fail.mjs", "node pass.mjs"], timeoutMs: 30_000 });
    expect(results.map((r) => [r.command, r.exitCode, checkoutCommandPassed(r)])).toEqual([
      ["node fail.mjs", 2, false],
      ["node pass.mjs", 0, true],
    ]);
    // The failure's words reach the reader, without the colour codes.
    expect(results[0]!.tail).toContain("TS2322: wrong type");
    expect(results[0]!.tail).not.toContain("\u001b[");
  });

  it("keeps only the end of a long output", async () => {
    const [result] = await runCheckoutCommands({ cwd: dir, commands: ["node noisy.mjs"], timeoutMs: 30_000 });
    expect(result!.tail.length).toBe(CHECK_OUTPUT_TAIL_CHARS);
    expect(result!.tail.endsWith("END")).toBe(true);
  });

  it("stops the command the clock runs out on, and skips the rest", async () => {
    const results = await runCheckoutCommands({ cwd: dir, commands: ["node hang.mjs", "node pass.mjs"], timeoutMs: 500 });
    expect(results[0]).toMatchObject({ timedOut: true, exitCode: null, skipped: false });
    expect(results[1]).toMatchObject({ skipped: true, exitCode: null });
    expect(results.some(checkoutCommandPassed)).toBe(false);
  });

  it("leaves nothing a passing command started running after it", async () => {
    // The check exits 0 but leaves a child behind in its group, which would
    // write after the caller has let the checkout go.
    writeFileSync(
      join(dir, "leaves-child.mjs"),
      `import { spawn } from "node:child_process";\n` +
        `spawn(process.execPath, ["-e", "setTimeout(() => require('fs').writeFileSync('late.txt', 'x'), 500)"], { stdio: "ignore" }).unref();\n`,
    );
    const [result] = await runCheckoutCommands({ cwd: dir, commands: ["node leaves-child.mjs"], timeoutMs: 30_000 });
    expect(result!.exitCode).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(existsSync(join(dir, "late.txt"))).toBe(false);
  });

  it("reports a passing command as passed even when a child it left holds its output open", async () => {
    // The child inherits the pipes and would keep them open for 20 s.
    writeFileSync(
      join(dir, "holds-pipes.mjs"),
      `import { spawn } from "node:child_process";\n` +
        `spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { stdio: "inherit" }).unref();\n` +
        `console.log("passed");\n`,
    );
    const started = Date.now();
    const [result] = await runCheckoutCommands({ cwd: dir, commands: ["node holds-pipes.mjs"], timeoutMs: 5_000 });
    expect(result).toMatchObject({ exitCode: 0, timedOut: false });
    expect(result!.tail).toContain("passed");
    expect(Date.now() - started).toBeLessThan(4_000);
  });

  it("stops the running command when its signal aborts, and starts none after it", async () => {
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 300);
    const started = Date.now();
    const results = await runCheckoutCommands({ cwd: dir, commands: ["node hang.mjs", "node pass.mjs"], timeoutMs: 30_000, signal: stop.signal });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(results[0]).toMatchObject({ timedOut: true, exitCode: null });
    expect(results[1]).toMatchObject({ skipped: true });
  });

  it("reports a refused or missing program as a failed result, never a throw", async () => {
    const results = await runCheckoutCommands({ cwd: dir, commands: ["node pass.mjs && rm -rf /", "no-such-program-xyz"], timeoutMs: 30_000 });
    expect(results[0]).toMatchObject({ exitCode: null, skipped: false });
    expect(results[0]!.tail).toMatch(/shell operator/);
    expect(results[1]!.exitCode).toBe(127);
  });
});
