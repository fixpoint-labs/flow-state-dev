/**
 * `harnessEnv` — the allowlisted environment for a harness's child process.
 *
 * The point of the helper is what it leaves OUT: a coding agent that can run
 * shell commands can read anything in its environment, so a server secret
 * that was not named must never reach it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { HARNESS_BASE_PASS, harnessEnv } from "../src/harness";

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

  it("reads from an explicit source instead of process.env when one is given", () => {
    vi.stubEnv("HARNESS_ENV_TEST_FROM_PROCESS", "process-value");

    const env = harnessEnv({
      pass: ["HARNESS_ENV_TEST_FROM_PROCESS", "TOKEN"],
      env: { TOKEN: "from-source", OTHER: "not-named" },
    });

    expect({ ...env }).toEqual({ TOKEN: "from-source" });
  });

  it("returns an empty environment, rather than throwing, where there is no process global", () => {
    // Core is isomorphic: a browser or edge runtime has no `process`.
    vi.stubGlobal("process", undefined);
    try {
      expect({ ...harnessEnv({ pass: ["PATH", "HOME"] }) }).toEqual({});
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not treat names every object inherits as set", () => {
    // `process.env.toString` is a function; passing it would hand the child
    // something that is not a variable at all.
    const env = harnessEnv({ pass: ["toString", "constructor", "hasOwnProperty"] });

    expect(Object.keys(env)).toEqual([]);
    expect(env.toString).toBeUndefined();
  });

  it("passes a variable literally named __proto__ as a variable, not a prototype", () => {
    const source = JSON.parse('{"__proto__":"proto-value","PATH":"/bin"}') as Record<string, string>;

    const env = harnessEnv({ pass: ["__proto__", "PATH"], env: source });

    expect(Object.keys(env).sort()).toEqual(["PATH", "__proto__"]);
    expect(Object.getOwnPropertyDescriptor(env, "__proto__")?.value).toBe("proto-value");
  });

  it("skips a named entry whose value is not a string", () => {
    const source = { GOOD: "yes", BAD: 42 } as unknown as Record<string, string>;

    expect({ ...harnessEnv({ pass: ["GOOD", "BAD"], env: source }) }).toEqual({ GOOD: "yes" });
  });

  it("reads the values when called, so a later change does not leak in", () => {
    vi.stubEnv("HARNESS_ENV_TEST_LATER", "first");
    const env = harnessEnv({ pass: ["HARNESS_ENV_TEST_LATER"] });

    vi.stubEnv("HARNESS_ENV_TEST_LATER", "second");

    expect(env).toEqual({ HARNESS_ENV_TEST_LATER: "first" });
  });
});

// The base every harness's pass-list starts from: what a coding agent's shell
// needs on any machine, and nothing that names a vendor. A host building the
// environment for a harness of its own spreads it and adds its own key.
describe("HARNESS_BASE_PASS", () => {
  it("is the shell's own variables and the proxy settings, in both cases", () => {
    expect([...HARNESS_BASE_PASS].sort()).toEqual(
      [
        "PATH", "HOME", "USER", "SHELL", "TMPDIR",
        "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy",
        "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy",
      ].sort(),
    );
  });

  it("names no credential: a key reaches a run only when its host adds it", () => {
    for (const name of HARNESS_BASE_PASS) expect(name).not.toMatch(/KEY|TOKEN|SECRET|CERT/i);
  });

  it("is the pass value for harnessEnv, with a host's own names after it", () => {
    const env = harnessEnv({ pass: [...HARNESS_BASE_PASS, "MY_KEY"], env: { PATH: "/bin", MY_KEY: "k", OTHER: "x" } });
    expect(env).toEqual({ PATH: "/bin", MY_KEY: "k" });
  });
});
