/**
 * The checkout's `start` and `dev` scripts (`scripts/checkout.mts`), run as
 * `pnpm shift-manager:dev` runs them: which profile opens with no `--config`,
 * that `--config` opens the `fsd` profile, and that under `--dev` a coder the
 * profile can't start refuses before the watcher starts, whichever profile it is.
 *
 * Each case runs the script in a child process with no Claude credential (no
 * `ANTHROPIC_API_KEY`, no `CLAUDE_CODE_OAUTH_TOKEN`, an empty home). Which
 * profile opened is read from which store file it created, not from its output.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const pkg = fileURLToPath(new URL("../", import.meta.url));
const tsx = join(pkg, "node_modules", ".bin", "tsx");
const script = join(pkg, "scripts/checkout.mts");
const assets = fileURLToPath(new URL("./fixtures/assets", import.meta.url));
const FSD = "teams/devteam/fsd.fsdev.config.mts";

const running: ChildProcess[] = [];
afterEach(() => {
  for (const child of running.splice(0)) child.kill("SIGTERM");
});

/** Where each profile keeps its store in one run, both fresh. */
function stores() {
  const dir = mkdtempSync(join(tmpdir(), "sm-checkout-"));
  return { dir, devteam: join(dir, "devteam.sqlite"), fsd: join(dir, "fsd.sqlite") };
}

/**
 * Run the script from the package folder with `args` and no Claude credential;
 * resolve once it listens or exits, or after `timeoutMs`.
 */
function run(args: string[], s: ReturnType<typeof stores>, env: Record<string, string> = {}, timeoutMs = 90_000) {
  const childEnv: Record<string, string | undefined> = {
    ...process.env,
    INIT_CWD: pkg,
    HOME: s.dir,
    DEVTEAM_STORE: s.devteam,
    FSD_STORE: s.fsd,
    SHIFT_MANAGER_SHIFT: undefined,
    ANTHROPIC_API_KEY: undefined,
    CLAUDE_CODE_OAUTH_TOKEN: undefined,
    DEVFORCE_LAB_HARNESS: undefined,
    DEVFORCE_LAB_STEP_MS: "0",
    ...env,
  };
  const child = spawn(tsx, [script, "--port", "0", "--no-open", ...args], { cwd: pkg, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  running.push(child);
  let output = "";
  child.stdout!.on("data", (d) => (output += String(d)));
  child.stderr!.on("data", (d) => (output += String(d)));
  return new Promise<{ outcome: "listening" | "exited" | "neither"; code?: number | null; output: string }>((resolve) => {
    const timer = setTimeout(() => resolve({ outcome: "neither", output }), timeoutMs);
    child.stderr!.on("data", () => {
      if (/App:\s+http/.test(output) && /Data:/.test(output)) {
        clearTimeout(timer);
        resolve({ outcome: "listening", output });
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ outcome: "exited", code, output });
    });
  });
}

describe("the checkout's script", () => {
  it("with no --config opens DevTeam on the scripted coder, so no credential is needed", async () => {
    const s = stores();
    const started = await run(["--assets", assets], s);
    expect(started.outcome, started.output).toBe("listening");
    expect(started.output).toContain("Coder: the scripted run, no model");
    expect(existsSync(s.devteam)).toBe(true);
    expect(existsSync(s.fsd)).toBe(false);
  }, 120_000);

  it("with --config naming the fsd profile opens fsd, not DevTeam", async () => {
    const s = stores();
    const started = await run(["--assets", assets, "--config", FSD], s, { DEVFORCE_LAB_HARNESS: "stub" });
    expect(started.outcome, started.output).toBe("listening");
    expect(existsSync(s.fsd)).toBe(true);
    expect(existsSync(s.devteam)).toBe(false);
  }, 120_000);

  // Under --dev a Lab that fails to load leaves the watcher waiting for a save,
  // so a refusal only ends the command if it comes before the watcher starts.
  it.each([
    ["--dev --config <fsd> (Claude Code by default)", ["--dev", "--config", FSD], {}],
    ["--dev --config=<fsd>", ["--dev", `--config=${FSD}`], {}],
    ["--dev on DevTeam with DEVFORCE_LAB_HARNESS=claude-code", ["--dev"], { DEVFORCE_LAB_HARNESS: "claude-code" }],
  ] as const)("%s with no credential exits 3 before it listens, naming what to set", async (_, args, env) => {
    const started = await run([...args], stores(), env, 60_000);
    expect(started.outcome, started.output).toBe("exited");
    expect(started.code).toBe(3);
    expect(started.output).toContain("DEVFORCE_LAB_HARNESS=stub");
  }, 90_000);
});
