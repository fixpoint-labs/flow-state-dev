/**
 * `harnessEnv` — the allowlisted environment for a harness's child process.
 *
 * The point of the helper is what it leaves OUT: a coding agent that can run
 * shell commands can read anything in its environment, so a server secret
 * that was not named must never reach it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { harnessEnv } from "../src";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("harnessEnv", () => {
  it("passes the named variables and nothing else the server holds", () => {
    vi.stubEnv("HARNESS_ENV_TEST_PATH", "/usr/bin");
    vi.stubEnv("HARNESS_ENV_TEST_SECRET", "server-only-secret");

    const env = harnessEnv({ pass: ["HARNESS_ENV_TEST_PATH"] });

    expect(env).toEqual({ HARNESS_ENV_TEST_PATH: "/usr/bin" });
    expect(Object.values(env)).not.toContain("server-only-secret");
  });

  it("does not hand over the rest of process.env by default", () => {
    // PATH and HOME are set in every test process; they are left out unless named.
    const env = harnessEnv({ pass: [] });

    expect(env).toEqual({});
  });

  it("leaves out a named variable that is unset, rather than passing it empty", () => {
    vi.stubEnv("HARNESS_ENV_TEST_SET", "yes");

    const env = harnessEnv({ pass: ["HARNESS_ENV_TEST_SET", "HARNESS_ENV_TEST_NEVER_SET"] });

    expect(env).toEqual({ HARNESS_ENV_TEST_SET: "yes" });
    expect("HARNESS_ENV_TEST_NEVER_SET" in env).toBe(false);
  });

  it("keeps a variable that is set to the empty string", () => {
    // Set-but-empty is a value the child may act on (e.g. `NO_PROXY=`); only unset is dropped.
    vi.stubEnv("HARNESS_ENV_TEST_EMPTY", "");

    expect(harnessEnv({ pass: ["HARNESS_ENV_TEST_EMPTY"] })).toEqual({ HARNESS_ENV_TEST_EMPTY: "" });
  });

  it("reads the values when called, so a later change does not leak in", () => {
    vi.stubEnv("HARNESS_ENV_TEST_LATER", "first");
    const env = harnessEnv({ pass: ["HARNESS_ENV_TEST_LATER"] });

    vi.stubEnv("HARNESS_ENV_TEST_LATER", "second");

    expect(env).toEqual({ HARNESS_ENV_TEST_LATER: "first" });
  });
});
