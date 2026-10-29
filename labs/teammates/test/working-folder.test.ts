/**
 * The working folder check: the lab refuses to start unless `TEAMMATES_WORKDIR`
 * names a git checkout, so a coding run never lands in the current directory or
 * the lab's own checkout by accident.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { workingFolder } from "../host.mts";

describe("workingFolder", () => {
  const root = mkdtempSync(join(tmpdir(), "teammates-workdir-"));

  it("refuses an unset or blank setting instead of falling back to the current directory", () => {
    expect(() => workingFolder(undefined)).toThrow(/TEAMMATES_WORKDIR is not set/);
    expect(() => workingFolder("  ")).toThrow(/TEAMMATES_WORKDIR is not set/);
  });

  it("refuses a path that is missing or not a folder, naming it", () => {
    const missing = join(root, "nope");
    expect(() => workingFolder(missing)).toThrow(`names ${missing}, which is not a folder`);
    const file = join(root, "file.txt");
    writeFileSync(file, "");
    expect(() => workingFolder(file)).toThrow(`names ${file}, which is not a folder`);
  });

  it("refuses a folder that is not a git checkout", () => {
    const plain = join(root, "plain");
    mkdirSync(plain);
    expect(() => workingFolder(plain)).toThrow(`names ${plain}, which is not a git checkout`);
  });

  it("returns a git checkout as an absolute path", () => {
    const checkout = join(root, "checkout");
    mkdirSync(join(checkout, ".git"), { recursive: true });
    expect(workingFolder(checkout)).toBe(checkout);
  });
});
