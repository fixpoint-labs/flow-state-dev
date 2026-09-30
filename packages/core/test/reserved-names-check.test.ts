import { describe, expect, it } from "vitest";
// @ts-expect-error — root check script, plain .mjs with no type declarations.
import { allowedFiles, isScannedPath, scanSources } from "../../../scripts/validate-reserved-names.mjs";

type Hit = { file: string; line: number; text: string; rule: string };

const scan = (text: string, path: string): Hit[] =>
  (scanSources as (s: Array<{ path: string; text: string }>) => Hit[])([{ path, text }]);

const scanned = (path: string): boolean => (isScannedPath as (p: string) => boolean)(path);

/**
 * The guard exists so the Windows reserved-name list cannot be copied again.
 * Three copies were kept by hand in three packages before it, one of them in a
 * test nobody had listed, so it has to catch a copy in source and in tests, in
 * whatever shape it is spelled, while staying silent on a test that passes one
 * device name as an input.
 */
describe("a planted copy of the list fails the guard", () => {
  it("catches a source copy spelled as a regex class, with no quoted prn", () => {
    const path = "packages/planted/src/names.ts";
    expect(scanned(path)).toBe(true);
    expect(scan("export const R = /^(con|aux|nul|com[1-9]|lpt[1-9])$/i;", path)).toEqual([
      expect.objectContaining({ file: path, line: 1, rule: "regex-class" }),
    ]);
  });

  it("catches a source copy spelled as a Set with templated devices", () => {
    const path = "packages/planted/src/devices.ts";
    const text = [
      'const DEVICES = new Set(["con", "prn", "aux", "nul",',
      "  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`)]);",
    ].join("\n");
    expect(scan(text, path).map((h) => h.rule)).toEqual(["quoted-prn", "templated"]);
  });

  it("catches a copy in a test, because a test's own list drifts too", () => {
    const path = "packages/planted/test/names.test.ts";
    expect(scanned(path)).toBe(true);
    expect(
      scan("const R = new Set(Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`));", path),
    ).toEqual([expect.objectContaining({ file: path, rule: "templated" })]);
  });
});

describe("a single device name used as a case passes the guard", () => {
  it("ignores a test passing one hostile input like \"PRN\"", () => {
    expect(scan('const HOSTILE = ["../x", "PRN", "lpt9", "acme."];', "packages/x/test/a.test.ts")).toEqual([]);
  });

  it("ignores a spec file doing the same", () => {
    expect(scan("expect(segment('prn')).not.toBe('prn');", "packages/x/src/a.spec.ts")).toEqual([]);
  });
});

describe("scan surface", () => {
  it.each([
    ["packages/engine/src/stores/filesystem/resource-path.ts"],
    ["packages/workforce/src/loader/segments.ts"],
    ["packages/claude-code/test/sdk/agent.spec.ts"],
    ["scripts/some-other-guard.mjs"],
    ["apps/kitchen-sink/app/page.tsx"],
  ])("scans %s", (path) => {
    expect(scanned(path)).toBe(true);
  });

  it("ignores files that are not code", () => {
    expect(scanned("docs/architecture/overview.md")).toBe(false);
    expect(scanned("packages/core/package.json")).toBe(false);
  });

  /** Driven from the guard's own export rather than a second copy of the list. */
  it.each(allowedFiles as string[])("allows %s", (path) => {
    expect(scanned(path)).toBe(false);
  });

  it("allows individual files only, never a directory or a pattern", () => {
    for (const path of allowedFiles as string[]) {
      expect(path).toMatch(/\.(ts|mjs)$/);
      expect(path).not.toMatch(/[*?]/);
    }
  });
});
