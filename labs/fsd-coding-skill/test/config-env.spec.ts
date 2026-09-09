/**
 * Host environment reading — executed, not just typed.
 *
 * A config file's checks are the code nobody runs until it is too late.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  readAdditionalDirectories,
  readHarness,
  readHostOptionsFromEnv,
  readModel,
  readNetworkAccess,
  requireCwd,
} from "../src/config-env";

afterEach(() => {
  delete process.env.FSD_CODING_HARNESS;
  delete process.env.FSD_CODING_CWD;
  delete process.env.FSD_CODING_MODEL;
  delete process.env.FSD_CODING_NETWORK_ACCESS;
  delete process.env.FSD_CODING_ADD_DIR;
});

describe("FSD_CODING_HARNESS", () => {
  it("defaults to cursor when omitted", () => {
    expect(readHarness({})).toBe("cursor");
  });

  it("accepts codex or cursor", () => {
    expect(readHarness({ FSD_CODING_HARNESS: "codex" })).toBe("codex");
    expect(readHarness({ FSD_CODING_HARNESS: "cursor" })).toBe("cursor");
  });

  it("refuses any other name", () => {
    expect(() => readHarness({ FSD_CODING_HARNESS: "claude" })).toThrow(
      /expected codex or cursor/,
    );
  });
});

describe("FSD_CODING_CWD", () => {
  it("refuses an absent one rather than defaulting to process.cwd()", () => {
    expect(() => requireCwd({})).toThrow(/FSD_CODING_CWD is not set/);
  });
});

describe("FSD_CODING_MODEL", () => {
  it("is omitted when unset", () => {
    expect(readModel({})).toBeUndefined();
  });

  it("refuses whitespace-only", () => {
    expect(() => readModel({ FSD_CODING_MODEL: "   " })).toThrow(/needs a value/);
  });
});

describe("Codex-only permissions", () => {
  it("refuses network access on Cursor", () => {
    expect(() => readNetworkAccess("cursor", { FSD_CODING_NETWORK_ACCESS: "1" })).toThrow(
      /only supported with FSD_CODING_HARNESS=codex/,
    );
  });

  it("refuses extra dirs on Cursor", () => {
    expect(() => readAdditionalDirectories("cursor", { FSD_CODING_ADD_DIR: "/git" })).toThrow(
      /only supported with FSD_CODING_HARNESS=codex/,
    );
  });

  it("splits colon-separated dirs for Codex", () => {
    expect(readAdditionalDirectories("codex", { FSD_CODING_ADD_DIR: "/git:/objects" })).toEqual([
      "/git",
      "/objects",
    ]);
  });
});

describe("readHostOptionsFromEnv", () => {
  it("assembles the host bag the config hands the flow", () => {
    expect(readHostOptionsFromEnv({
      FSD_CODING_HARNESS: "codex",
      FSD_CODING_CWD: "/work",
      FSD_CODING_MODEL: "gpt-5.5",
      FSD_CODING_NETWORK_ACCESS: "true",
      FSD_CODING_ADD_DIR: "/git",
    })).toEqual({
      harness: "codex",
      cwd: "/work",
      model: "gpt-5.5",
      networkAccess: true,
      additionalDirectories: ["/git"],
    });
  });
});
