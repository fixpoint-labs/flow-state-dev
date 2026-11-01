/**
 * The environment a coding run the lab starts is handed.
 *
 * A run's model has a shell, so whatever environment its harness process
 * starts with is readable by any command it runs. Each harness package turns
 * its `env` option into exactly the child's environment (its own specs hold
 * that against the real spawn); leaving `env` unset hands the child the lab
 * server's whole `process.env`. So what this pins is the lab's half: every
 * harness the `harness-thread` flow builds is given an `env`, and that `env`
 * holds the harness's own pass list and never a server variable outside it.
 *
 * The three harness factories are replaced by recorders so the options each
 * builder hands its package are what's read; nothing is run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ options: [] as Array<{ harness: string; options: Record<string, unknown> }> }));

vi.mock("@flow-state-dev/claude-code/sdk", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  claudeCodeAgent: (options: Record<string, unknown>) => (seen.options.push({ harness: "claude-code", options }), {}),
}));
vi.mock("@flow-state-dev/codex", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  codexAgent: (options: Record<string, unknown>) => (seen.options.push({ harness: "codex", options }), {}),
}));
vi.mock("@flow-state-dev/cursor", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  cursorAgent: (options: Record<string, unknown>) => (seen.options.push({ harness: "cursor", options }), {}),
}));

const { HARNESSES } = await import("../workforce/flows/harness-thread.mts");
const { CLAUDE_CODE_PASS } = await import("@flow-state-dev/claude-code/sdk");
const { CODEX_PASS } = await import("@flow-state-dev/codex");
const { CURSOR_PASS } = await import("@flow-state-dev/cursor");

const SECRET = "LAB_SERVER_ONLY_SECRET";
const feeds = { cwd: () => "/tmp/run", resume: () => undefined, onSession: () => {}, onActivity: () => {} };

/** Each package's pass list, and where its `env` sits in the options the lab hands it. */
const EXPECTED: Record<string, { pass: readonly string[]; envOf: (options: Record<string, any>) => unknown }> = {
  "claude-code": { pass: CLAUDE_CODE_PASS, envOf: (o) => o.env },
  "claude-code-plan": { pass: CLAUDE_CODE_PASS, envOf: (o) => o.env },
  codex: { pass: CODEX_PASS, envOf: (o) => o.client?.env },
  cursor: { pass: CURSOR_PASS, envOf: (o) => o.env },
};

beforeEach(() => {
  seen.options.length = 0;
  vi.stubEnv(SECRET, "server-only");
  vi.stubEnv("PATH", process.env.PATH ?? "/usr/bin");
});
afterEach(() => vi.unstubAllEnvs());

describe("the harness-thread flow's coding runs", () => {
  it("builds a run for every harness this test checks, so a new one can't slip past it", () => {
    expect(Object.keys(HARNESSES).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.keys(EXPECTED))("hands a %s run only its package's pass list, never a server secret", (name) => {
    HARNESSES[name]!(feeds as never);
    const [built] = seen.options;
    const env = EXPECTED[name]!.envOf(built!.options as Record<string, any>) as Record<string, string> | undefined;

    // Unset means the child inherits the server's whole environment.
    expect(env, `${name} run built with no env`).toBeDefined();
    expect(Object.keys(env!)).not.toContain(SECRET);
    expect(Object.keys(env!).every((key) => EXPECTED[name]!.pass.includes(key))).toBe(true);
    // The list is applied, not an empty stand-in: PATH is on every list and set here.
    expect(env!.PATH).toBe(process.env.PATH);
  });
});
