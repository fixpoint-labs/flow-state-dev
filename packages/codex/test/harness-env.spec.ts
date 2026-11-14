/**
 * The environment a Codex run started through `codexHarness()` is handed.
 *
 * A run's model has a shell, so whatever environment its process starts with
 * is readable by any command it runs. Leaving `env` unset hands the child the
 * server's whole `process.env`; the harness value hands it exactly Codex's
 * pass list, and never a server variable outside it. The Codex block is
 * replaced by a recorder, so the options the value hands it are what's read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ options: [] as Array<Record<string, any>> }));
vi.mock("../src/agent", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  codexAgent: (options: Record<string, unknown>) => (seen.options.push(options), {}),
}));

const { codexHarness } = await import("../src/harness");
const { CODEX_PASS } = await import("../src/env-pass");
const { harnessEnv } = await import("@flow-state-dev/core/harness");

const SECRET = "LAB_SERVER_ONLY_SECRET";
const feeds = { cwd: () => "/tmp/run", resume: () => undefined, onSession: () => {}, onUsage: () => {}, onActivity: () => {} };

beforeEach(() => {
  seen.options.length = 0;
  vi.stubEnv(SECRET, "server-only");
});
afterEach(() => vi.unstubAllEnvs());

describe("a Codex run from codexHarness()", () => {
  it("writes its workspace and gets only Codex's pass list, never a server secret", () => {
    codexHarness().agent(feeds as never);
    const [built] = seen.options;
    expect(built!.thread).toEqual({ sandboxMode: "workspace-write" });
    expect(built!.client?.env).toBeDefined();
    expect(Object.keys(built!.client.env)).not.toContain(SECRET);
    expect(built!.client.env).toEqual(harnessEnv({ pass: CODEX_PASS }));
    expect(built!.cwd).toBe(feeds.cwd);
  });
});
