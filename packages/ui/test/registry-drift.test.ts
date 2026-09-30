/**
 * The copy comparison any app runs over its own registry folder.
 *
 * Driven over temp folders holding a fresh copy of the registry, so each case
 * starts from "the copies are the registry" and breaks exactly one thing. The
 * app that runs it on its real folder (kitchen-sink today) pins its own count
 * and scope; this pins what the comparison sees.
 */
import { appendFileSync, cpSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareRegistryCopies, REGISTRY_SOURCE_DIR } from "../scripts/registry-drift";

let target: string;

afterEach(() => rmSync(target, { recursive: true, force: true }));

/** A folder holding byte-identical copies of every registry file, stories included. */
function freshCopies(): string {
  target = mkdtempSync(join(tmpdir(), "fsd-copies-"));
  cpSync(REGISTRY_SOURCE_DIR, target, { recursive: true });
  return target;
}

describe("compareRegistryCopies", () => {
  it("reports nothing for byte-identical copies, and says what it compared", () => {
    const drift = compareRegistryCopies({ targetDir: freshCopies() });
    expect(drift.compared.length).toBeGreaterThan(30);
    expect(drift.compared.some((file) => file.endsWith(".stories.tsx"))).toBe(false);
    expect(drift.mismatches).toEqual([]);
    // Stories were copied too, and each has a source, so none is a fork.
    expect(drift.forks).toEqual([]);
  });

  it("names a copy that differs by one byte", () => {
    const dir = freshCopies();
    appendFileSync(join(dir, "tool.tsx"), " ");
    expect(compareRegistryCopies({ targetDir: dir }).mismatches).toEqual(["tool.tsx"]);
  });

  it("names a source the app never installed, unless the app says so", () => {
    const dir = freshCopies();
    unlinkSync(join(dir, "generative/info-card.tsx"));
    expect(compareRegistryCopies({ targetDir: dir }).mismatches).toEqual(["generative/info-card.tsx (not installed)"]);
    const scoped = compareRegistryCopies({ targetDir: dir, notInstalled: (file) => file.startsWith("generative/") });
    expect(scoped.mismatches).toEqual([]);
    expect(scoped.compared.some((file) => file.startsWith("generative/"))).toBe(false);
  });

  it("names a file with no registry source, unless the app keeps it with a reason", () => {
    const dir = freshCopies();
    writeFileSync(join(dir, "my-fork.tsx"), "export {};\n");
    expect(compareRegistryCopies({ targetDir: dir }).forks).toEqual(["my-fork.tsx"]);
    expect(compareRegistryCopies({ targetDir: dir, appOnly: { "my-fork.tsx": "ours" } }).forks).toEqual([]);
  });
});
