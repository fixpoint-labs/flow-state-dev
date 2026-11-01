/**
 * Kitchen Sink says which store it runs on when its config loads (FIX-2424).
 *
 * A stray `FSD_DB_URL` in a local shell moves dev onto Postgres, skips the
 * interrupted-run scan and closes the DevTool's debug endpoints. Nothing else
 * says so, so this line is the only place a developer sees it. It must name
 * what the wiring actually built, and it must stay off stdout: the `fsdev` CLI
 * imports this config and writes NDJSON there.
 *
 * Red states seen before green: with the line removed from `fsdev.config.ts`,
 * every line case fails on "no startup line"; with the line reading
 * `STORE_TYPE` instead of the wired `devStore`, the unknown-`STORE_TYPE` case
 * fails.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FlowState } from "@flow-state-dev/engine";

vi.setConfig({ testTimeout: 30_000 });

const DB_URL = "postgres://nobody@127.0.0.1:1/none";

afterEach(async () => {
  const hmr = globalThis as { __fsdFlowstate?: FlowState };
  await hmr.__fsdFlowstate?.dispose();
  delete hmr.__fsdFlowstate;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Load the real config under `env` and return the `[flowstate] profile=` lines per stream. */
async function loadConfig(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const key of ["FSD_ENV", "FSD_DB_URL", "DATABASE_URL", "STORE_TYPE", "REDIS_URL"]) {
    vi.stubEnv(key, undefined);
  }
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
  const stdout = [vi.spyOn(console, "log"), vi.spyOn(console, "info")];
  await import("@/fsdev.config");
  const lines = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[flowstate] profile="));
  return { stderr: lines(stderr), stdout: stdout.flatMap(lines) };
}

describe("the config's startup line", () => {
  it.each([
    ["no env: dev on SQLite, scan on", {}, "profile=dev store=sqlite durable=true interruptedScan=true"],
    ["STORE_TYPE=memory", { STORE_TYPE: "memory" }, "profile=dev store=memory durable=true interruptedScan=true"],
    // The wiring falls back to SQLite on a value it doesn't know; the line must say what was built.
    ["an unknown STORE_TYPE is SQLite", { STORE_TYPE: "postgres" }, "profile=dev store=sqlite durable=true interruptedScan=true"],
    ["a database URL picks prod", { FSD_DB_URL: DB_URL }, "profile=prod store=postgres durable=true interruptedScan=false"],
    // The stray-URL case the issue was filed for: the profile says dev, the gates say deployed.
    ["FSD_ENV=dev with a stray URL", { FSD_ENV: "dev", FSD_DB_URL: DB_URL }, "profile=dev store=sqlite durable=true interruptedScan=false"],
  ])("%s", async (_name, env, expected) => {
    const { stderr, stdout } = await loadConfig(env);
    expect(stderr, "no startup line").toEqual([`[flowstate] ${expected}`]);
    expect(stdout).toEqual([]);
  });

  it("fails the load on an FSD_ENV no profile declares", async () => {
    await expect(loadConfig({ FSD_ENV: "bogus" })).rejects.toThrow(/FSD_ENV="bogus"/);
  });
});
