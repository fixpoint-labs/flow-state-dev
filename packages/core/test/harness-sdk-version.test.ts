/**
 * The one SDK version gate every harness package calls (FIX-2458 D2): a
 * harness translates its vendor's wire, so an SDK it never ran against
 * produces malformed items, not an error. The gate refuses one outside the
 * range the package tested, naming both versions, and readiness says so
 * before a host builds the block.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  HarnessSdkVersionMismatchError,
  assertTestedSdkVersion,
  readInstalledSdkVersion,
  satisfiesSdkRange,
  sdkVersionReadiness,
  type TestedSdk,
} from "../src/internal";

const TESTED: TestedSdk = { harness: "Example", sdk: "@example/sdk", range: ">=1.2.3 <1.3.0" };

describe("satisfiesSdkRange", () => {
  it("reads a bounded span and an exact version", () => {
    expect(satisfiesSdkRange("1.2.3", ">=1.2.3 <1.3.0")).toBe(true);
    expect(satisfiesSdkRange("1.2.99", ">=1.2.3 <1.3.0")).toBe(true);
    expect(satisfiesSdkRange("1.2.2", ">=1.2.3 <1.3.0")).toBe(false);
    expect(satisfiesSdkRange("1.3.0", ">=1.2.3 <1.3.0")).toBe(false);
    expect(satisfiesSdkRange("0.164.0", "0.164.0")).toBe(true);
    expect(satisfiesSdkRange("0.164.1", "0.164.0")).toBe(false);
  });

  it("refuses what it can't compare: a prerelease, a malformed version, an unknown comparator", () => {
    // A prerelease of a tested version is not the tested version.
    expect(satisfiesSdkRange("1.2.4-beta.1", ">=1.2.3 <1.3.0")).toBe(false);
    expect(satisfiesSdkRange("latest", ">=1.2.3 <1.3.0")).toBe(false);
    expect(satisfiesSdkRange("1.2.4", "^1.2.3")).toBe(false);
  });
});

describe("assertTestedSdkVersion", () => {
  it("passes a version inside the range, and no SDK at all (its absence surfaces on the first run)", () => {
    expect(() => assertTestedSdkVersion(TESTED, () => ({ kind: "version", version: "1.2.5" }))).not.toThrow();
    expect(() => assertTestedSdkVersion(TESTED, () => ({ kind: "absent" }))).not.toThrow();
  });

  it("refuses one step outside the range on either side, naming the SDK, the harness and both versions", () => {
    for (const version of ["1.2.2", "1.3.0"]) {
      let thrown: unknown;
      try {
        assertTestedSdkVersion(TESTED, () => ({ kind: "version", version }));
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(HarnessSdkVersionMismatchError);
      const mismatch = thrown as HarnessSdkVersionMismatchError;
      expect(mismatch.code).toBe("HARNESS_SDK_VERSION_MISMATCH");
      expect(mismatch).toMatchObject({ sdk: "@example/sdk", harness: "Example", installed: version, tested: ">=1.2.3 <1.3.0" });
      expect(mismatch.message).toContain(version);
      expect(mismatch.message).toContain(">=1.2.3 <1.3.0");
      expect(mismatch.message).toContain("@example/sdk");
    }
  });

  it("refuses an SDK whose version can't be read: present and unknown is not safe", () => {
    let thrown: HarnessSdkVersionMismatchError | undefined;
    try {
      assertTestedSdkVersion(TESTED, () => ({ kind: "unreadable", reason: "no manifest" }));
    } catch (error) {
      thrown = error as HarnessSdkVersionMismatchError;
    }
    expect(thrown?.message).toMatch(/no manifest/);
    expect(thrown?.installed).toBeNull();
    // The stable code a host that must branch on the thrown error reads.
    expect(thrown?.code).toBe("HARNESS_SDK_VERSION_MISMATCH");
  });
});

describe("sdkVersionReadiness", () => {
  it("is null for a tested version, and not ready with a remedy for none or one outside the range", () => {
    expect(sdkVersionReadiness(TESTED, () => ({ kind: "version", version: "1.2.3" }))).toBeNull();
    expect(sdkVersionReadiness(TESTED, () => ({ kind: "absent" }))).toEqual({
      ready: false,
      reason: "The Example SDK (@example/sdk) is not installed.",
      remedy: 'npm install "@example/sdk@>=1.2.3 <1.3.0"',
    });
    const above = sdkVersionReadiness(TESTED, () => ({ kind: "version", version: "1.3.0" }));
    expect(above).toMatchObject({ ready: false, remedy: 'npm install "@example/sdk@>=1.2.3 <1.3.0"' });
    expect((above as { reason: string }).reason).toContain("1.3.0");
    expect((above as { reason: string }).reason).toContain(">=1.2.3 <1.3.0");
  });
});

describe("the install remedy", () => {
  it("is a command safe to paste into a shell: a range is quoted, a bare version needs no quotes", () => {
    const absent = () => ({ kind: "absent" }) as const;
    // Unquoted, a shell would read `>=1.2.3` and `<1.3.0` as redirections.
    expect(sdkVersionReadiness(TESTED, absent)).toMatchObject({ remedy: 'npm install "@example/sdk@>=1.2.3 <1.3.0"' });
    expect(sdkVersionReadiness({ ...TESTED, range: "0.164.0" }, absent)).toMatchObject({ remedy: "npm install @example/sdk@0.164.0" });
  });
});

describe("readInstalledSdkVersion", () => {
  const root = mkdtempSync(join(tmpdir(), "harness-sdk-version-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("reads the version of the SDK installed beside the asking package, walking up node_modules", () => {
    mkdirSync(join(root, "node_modules", "@example", "sdk"), { recursive: true });
    writeFileSync(join(root, "node_modules", "@example", "sdk", "package.json"), JSON.stringify({ name: "@example/sdk", version: "1.2.7" }));
    mkdirSync(join(root, "pkg", "src"), { recursive: true });
    const from = pathToFileURL(join(root, "pkg", "src", "index.js")).href;
    expect(readInstalledSdkVersion("@example/sdk", from)).toEqual({ kind: "version", version: "1.2.7" });
  });

  it("answers absent when nothing is installed and the resolver can't find it either", () => {
    const from = pathToFileURL(join(root, "pkg", "src", "index.js")).href;
    expect(readInstalledSdkVersion("@example/not-installed", from)).toEqual({ kind: "absent" });
  });
});
