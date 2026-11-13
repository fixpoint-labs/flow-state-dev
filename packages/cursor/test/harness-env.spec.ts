/**
 * The environment a Cursor run started through `cursorHarness()` is handed:
 * exactly Cursor's pass list, never a server variable outside it, since a
 * run's model has a shell. The Cursor block is replaced by a recorder, so the
 * options the value hands it are what's read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ options: [] as Array<Record<string, any>> }));
vi.mock("../src/agent", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  cursorAgent: (options: Record<string, unknown>) => (seen.options.push(options), {}),
}));

const { cursorHarness } = await import("../src/harness");
const { CURSOR_PASS } = await import("../src/env-pass");
const { harnessEnv } = await import("@flow-state-dev/core/harness");

const SECRET = "LAB_SERVER_ONLY_SECRET";
const feeds = { cwd: () => "/tmp/run", resume: () => undefined, onSession: () => {}, onUsage: () => {}, onActivity: () => {} };

beforeEach(() => {
  seen.options.length = 0;
  vi.stubEnv(SECRET, "server-only");
});
afterEach(() => vi.unstubAllEnvs());

describe("a Cursor run from cursorHarness()", () => {
  it("names a model and gets only Cursor's pass list, never a server secret", () => {
    cursorHarness().agent(feeds as never);
    const [built] = seen.options;
    expect(built!.model).toBe("default");
    expect(Object.keys(built!.env)).not.toContain(SECRET);
    expect(built!.env).toEqual(harnessEnv({ pass: CURSOR_PASS }));
  });

  it("runs on the model the options name", () => {
    cursorHarness({ model: "composer-2.5" } as never).agent(feeds as never);
    expect(seen.options[0]!.model).toBe("composer-2.5");
  });
});
