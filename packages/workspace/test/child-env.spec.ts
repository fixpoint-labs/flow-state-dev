/**
 * What a child process this package starts can see of the host's
 * environment. A host is started with its secrets exported (a GitHub token,
 * a model gateway key, a cron secret); a setup command, a project check or
 * any code in the repository a run works on must not read them unless the
 * host passes one on purpose.
 *
 * Every case plants a secret in this process's environment, starts a real
 * child that writes back the names it was started with, and reads that,
 * never what the package says it would pass.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOST_GIT_PASS, HOST_REMOTE_PASS, WORKSPACE_BASE_PASS } from "../src/child-env";
import { run, runCheckoutCommands, runToEnd } from "../src/index";
import { setUpCheckout } from "../src/setup";
import { tempDir } from "./git-fixtures";

/** A node one-liner printing the child's environment as JSON. */
const PRINT_ENV = ["-e", "process.stdout.write(JSON.stringify(process.env))"];

let dir: string;

beforeEach(() => {
  dir = tempDir("child-env");
  vi.stubEnv("SOME_SECRET", "x");
  vi.stubEnv("GITHUB_TOKEN", "ghp_host");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("a child the workspace starts", () => {
  it("does not see a host secret, buffered", async () => {
    const seen = JSON.parse((await run("node", PRINT_ENV, { cwd: dir, timeoutMs: 30_000 })).stdout) as Record<string, string>;

    expect(seen.SOME_SECRET).toBeUndefined();
    expect(seen.GITHUB_TOKEN).toBeUndefined();
    // Still a working shell: the base passes.
    expect(seen.PATH).toBe(process.env.PATH);
  });

  it("does not see a host secret, line by line", async () => {
    const lines: string[] = [];
    await run("node", PRINT_ENV, { cwd: dir, timeoutMs: 30_000, onLine: (line) => lines.push(line) });
    const seen = JSON.parse(lines.join("\n")) as Record<string, string>;

    expect(seen.SOME_SECRET).toBeUndefined();
    expect(seen.PATH).toBe(process.env.PATH);
  });

  it("does not see a host secret, run to its end", async () => {
    const ended = await runToEnd("node", PRINT_ENV, { cwd: dir, timeoutMs: 30_000, keepChars: 1_000_000 });
    const seen = JSON.parse(ended.output) as Record<string, string>;

    expect(seen.SOME_SECRET).toBeUndefined();
    expect(seen.PATH).toBe(process.env.PATH);
  });

  it("starts with nothing but the base, a name it was passed, and what the caller set", async () => {
    vi.stubEnv("PASSED_ON_PURPOSE", "yes");
    const { stdout } = await run("node", PRINT_ENV, { cwd: dir, timeoutMs: 30_000, pass: ["PASSED_ON_PURPOSE"], env: { SET_BY_CALLER: "1" } });
    const seen = JSON.parse(stdout) as Record<string, string>;

    expect(seen.PASSED_ON_PURPOSE).toBe("yes");
    expect(seen.SET_BY_CALLER).toBe("1");
    // Node may add a few of its own at start; none of them is the host's.
    const allowed = new Set<string>([...WORKSPACE_BASE_PASS, "PASSED_ON_PURPOSE", "SET_BY_CALLER"]);
    const extra = Object.keys(seen).filter((name) => !allowed.has(name) && process.env[name] !== undefined && seen[name] === process.env[name]);
    expect(extra).toEqual([]);
  });

  it("passes the host's git settings, with each numbered config pair, on the host-git list only", async () => {
    vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
    vi.stubEnv("GIT_CONFIG_COUNT", "1");
    vi.stubEnv("GIT_CONFIG_KEY_0", "user.name");
    vi.stubEnv("GIT_CONFIG_VALUE_0", "The Host");
    const asGit = JSON.parse((await run("node", PRINT_ENV, { cwd: dir, timeoutMs: 30_000, pass: HOST_GIT_PASS })).stdout) as Record<string, string>;
    const plain = JSON.parse((await run("node", PRINT_ENV, { cwd: dir, timeoutMs: 30_000 })).stdout) as Record<string, string>;

    expect(asGit).toMatchObject({ GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "user.name", GIT_CONFIG_VALUE_0: "The Host" });
    // The host's git settings, but no credential: those are for its remote calls.
    expect(asGit.GITHUB_TOKEN).toBeUndefined();
    expect(plain.GIT_CONFIG_GLOBAL).toBeUndefined();
    expect(plain.GIT_CONFIG_KEY_0).toBeUndefined();
  });

  it("keeps a credential set through the host's git config pairs off local git, renumbering the rest", async () => {
    // A host can hand git an auth header as a config pair; a local call runs programs the run can configure.
    vi.stubEnv("GIT_CONFIG_COUNT", "3");
    vi.stubEnv("GIT_CONFIG_KEY_0", "http.https://github.com/.extraHeader");
    vi.stubEnv("GIT_CONFIG_VALUE_0", "Authorization: Bearer tok_in_config");
    vi.stubEnv("GIT_CONFIG_KEY_1", "user.name");
    vi.stubEnv("GIT_CONFIG_VALUE_1", "The Host");
    vi.stubEnv("GIT_CONFIG_KEY_2", "url.https://tok@example.com/.insteadOf");
    vi.stubEnv("GIT_CONFIG_VALUE_2", "https://example.com/");
    const local = JSON.parse((await run("node", PRINT_ENV, { cwd: dir, timeoutMs: 30_000, pass: HOST_GIT_PASS })).stdout) as Record<string, string>;
    const remote = JSON.parse(
      (await run("node", PRINT_ENV, { cwd: dir, timeoutMs: 30_000, pass: HOST_REMOTE_PASS, gitCredentials: true })).stdout,
    ) as Record<string, string>;

    expect(JSON.stringify(local)).not.toContain("tok");
    expect(local).toMatchObject({ GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "user.name", GIT_CONFIG_VALUE_0: "The Host" });
    expect(local.GIT_CONFIG_KEY_1).toBeUndefined();
    // The remote calls still get every pair, as the host set them.
    expect(remote).toMatchObject({ GIT_CONFIG_COUNT: "3", GIT_CONFIG_VALUE_0: "Authorization: Bearer tok_in_config", GIT_CONFIG_KEY_2: "url.https://tok@example.com/.insteadOf" });
  });

  it("keeps the operator's corporate CA on the remote calls, and never a switch that turns certificate checks off", async () => {
    vi.stubEnv("GIT_SSL_CAINFO", "/etc/corp/ca.pem");
    vi.stubEnv("GIT_SSL_CAPATH", "/etc/corp/certs");
    vi.stubEnv("GIT_SSL_NO_VERIFY", "1");
    const seen = JSON.parse((await run("node", PRINT_ENV, { cwd: dir, timeoutMs: 30_000, pass: HOST_REMOTE_PASS, gitCredentials: true })).stdout) as Record<string, string>;

    expect(seen).toMatchObject({ GIT_SSL_CAINFO: "/etc/corp/ca.pem", GIT_SSL_CAPATH: "/etc/corp/certs" });
    expect(seen.GIT_SSL_NO_VERIFY).toBeUndefined();
  });

  it("keeps the cache directory credential-cache's socket lives in, on the remote calls", async () => {
    vi.stubEnv("XDG_CACHE_HOME", "/home/op/.cache-elsewhere");
    const seen = JSON.parse((await run("node", PRINT_ENV, { cwd: dir, timeoutMs: 30_000, pass: HOST_REMOTE_PASS, gitCredentials: true })).stdout) as Record<string, string>;

    expect(seen.XDG_CACHE_HOME).toBe("/home/op/.cache-elsewhere");
  });

  it("keeps git's EMAIL identity fallback on local git, where a merge commits", async () => {
    vi.stubEnv("EMAIL", "operator@example.com");
    const seen = JSON.parse((await run("node", PRINT_ENV, { cwd: dir, timeoutMs: 30_000, pass: HOST_GIT_PASS })).stdout) as Record<string, string>;
    const plain = JSON.parse((await run("node", PRINT_ENV, { cwd: dir, timeoutMs: 30_000 })).stdout) as Record<string, string>;

    expect(seen.EMAIL).toBe("operator@example.com");
    expect(plain.EMAIL).toBeUndefined();
  });

  it("passes the host's credentials on the remote list, and still no other secret", async () => {
    vi.stubEnv("SSH_AUTH_SOCK", "/tmp/agent.sock");
    const seen = JSON.parse((await run("node", PRINT_ENV, { cwd: dir, timeoutMs: 30_000, pass: HOST_REMOTE_PASS })).stdout) as Record<string, string>;

    expect(seen.GITHUB_TOKEN).toBe("ghp_host");
    expect(seen.SSH_AUTH_SOCK).toBe("/tmp/agent.sock");
    expect(seen.SOME_SECRET).toBeUndefined();
  });
});

describe("the host's setup command", () => {
  it("does not see a host secret, and sees what its `env` sets", async () => {
    const seenFile = join(dir, "seen.json");
    const script = `require('fs').writeFileSync(${JSON.stringify(seenFile)}, JSON.stringify(process.env))`;

    const outcome = await setUpCheckout(
      { command: ["node", "-e", script], env: { NPM_TOKEN: "npm_on_purpose" } },
      dir,
      join(dir, "marker"),
      true,
      () => 30_000,
    );

    expect(outcome).toEqual({ status: "done" });
    const seen = JSON.parse(readFileSync(seenFile, "utf8")) as Record<string, string>;
    expect(seen.SOME_SECRET).toBeUndefined();
    expect(seen.GITHUB_TOKEN).toBeUndefined();
    expect(seen.NPM_TOKEN).toBe("npm_on_purpose");
  });
});

describe("a project check", () => {
  it("does not see a host secret, even when the run rewrote the script it runs", async () => {
    // A run can edit what a check runs (a package.json script); the check must gain it nothing.
    writeFileSync(join(dir, "check.js"), "require('fs').writeFileSync('seen.json', JSON.stringify(process.env))");

    const [result] = await runCheckoutCommands({ cwd: dir, commands: ["node check.js"], timeoutMs: 30_000 });

    expect(result!.exitCode).toBe(0);
    const seen = JSON.parse(readFileSync(join(dir, "seen.json"), "utf8")) as Record<string, string>;
    expect(seen.SOME_SECRET).toBeUndefined();
    expect(seen.GITHUB_TOKEN).toBeUndefined();
    expect(seen.PATH).toBe(process.env.PATH);
  });
});
