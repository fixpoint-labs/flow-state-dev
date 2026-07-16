/**
 * Unit tests for the filesystem key↔path mapping module. This is where the
 * nested-layout design's risk lives (encoding reversibility, collision
 * avoidance, defensive reconstruction, BP-033 prefix narrowing), so it gets
 * focused coverage independent of the store CRUD wrapping.
 */
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectRecords,
  encodeSegment,
  keyToRelativePath,
  relativePathToKey,
  validateSegment
} from "../src/stores/filesystem/resource-path";

const EXT = ".md";

describe("resource-path mapping", () => {
  describe("keyToRelativePath / relativePathToKey round-trip", () => {
    for (const key of [
      "overview",
      "concepts/flow-state-dev/overview",
      "50%_off",
      "files/src/utils.ts",
      "résumé",
      ".env",
      "files/*/notes",
      "a.md/b",
      "build.tmp-1"
    ]) {
      it(`round-trips ${JSON.stringify(key)}`, () => {
        const rel = keyToRelativePath(key, EXT);
        expect(relativePathToKey(rel, EXT)).toBe(key);
      });
    }

    it("maps a dotted-extension leaf to an escaped segment", () => {
      expect(keyToRelativePath("files/src/utils.ts", EXT)).toBe(
        path.join("files", "src", "utils%2Ets") + ".md"
      );
    });

    it("escapes '.' to %2E and does not let '..' traverse", () => {
      expect(encodeSegment(".")).toBe("%2E");
      expect(encodeSegment("..")).toBe("%2E%2E");
    });

    it("keeps a leading-dot key reversible and unrejected", () => {
      expect(keyToRelativePath(".env", EXT)).toBe("%2Eenv.md");
      expect(relativePathToKey("%2Eenv.md", EXT)).toBe(".env");
    });

    it("escapes '*' to %2A and round-trips", () => {
      expect(keyToRelativePath("files/*/notes", EXT)).toBe(
        path.join("files", "%2A", "notes") + ".md"
      );
      expect(relativePathToKey(path.join("files", "%2A", "notes") + ".md", EXT)).toBe(
        "files/*/notes"
      );
    });

    it("avoids the extension-named-segment collision", () => {
      // `a` and `a.md/b` must map to distinct paths — the escaped "." is what
      // prevents `a.md` (the leaf of key `a`) from aliasing directory `a.md`.
      expect(keyToRelativePath("a", EXT)).toBe("a.md");
      expect(keyToRelativePath("a.md/b", EXT)).toBe(path.join("a%2Emd", "b") + ".md");
    });

    it("lets a leaf and a branch of the same name coexist", () => {
      expect(keyToRelativePath("x", EXT)).toBe("x.md");
      expect(keyToRelativePath("x/y", EXT)).toBe(path.join("x", "y") + ".md");
    });
  });

  describe("validateSegment", () => {
    it("rejects an empty segment", () => {
      expect(() => keyToRelativePath("a//b", EXT)).toThrow();
    });

    it("rejects Windows reserved names, case-insensitively", () => {
      expect(() => validateSegment("con")).toThrow();
      expect(() => validateSegment("CON")).toThrow();
      expect(() => validateSegment("Com1")).toThrow();
      expect(() => validateSegment("lpt9")).toThrow();
    });

    it("allows ordinary and leading-dot segments", () => {
      expect(() => validateSegment("overview")).not.toThrow();
      expect(() => validateSegment(".env")).not.toThrow();
    });
  });

  describe("collectRecords", () => {
    let root: string;
    const dirs: string[] = [];

    afterEach(async () => {
      vi.restoreAllMocks();
      await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
    });

    async function makeScope(): Promise<string> {
      root = await mkdtemp(path.join(tmpdir(), "fsd-resource-path-"));
      dirs.push(root);
      return root;
    }

    async function writeFileAt(scope: string, rel: string, body = "x"): Promise<void> {
      const full = path.join(scope, rel);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, body, "utf8");
    }

    it("reconstructs nested keys and skips temp + dot entries", async () => {
      const scope = await makeScope();
      await writeFileAt(scope, "overview.md");
      await writeFileAt(scope, path.join("concepts", "flow-state-dev", "overview.md"));
      await writeFileAt(scope, "notes.md.tmp-123-456"); // crash temp — no ext suffix
      await writeFileAt(scope, path.join(".obsidian", "workspace.md")); // dot dir
      await writeFileAt(scope, ".hidden.md"); // dot file

      const records = await collectRecords(scope, EXT);
      expect(records.map((r) => r.resourceKey).sort()).toEqual([
        "concepts/flow-state-dev/overview",
        "overview"
      ]);
    });

    it("skips non-canonical names without throwing", async () => {
      const scope = await makeScope();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await writeFileAt(scope, "good.md");
      await writeFileAt(scope, "a%2Fb.md"); // aliases a/b.md — non-canonical
      await writeFileAt(scope, "100%.md"); // decode throws — non-canonical

      const records = await collectRecords(scope, EXT);
      expect(records.map((r) => r.resourceKey)).toEqual(["good"]);
      expect(warn).toHaveBeenCalled();
    });

    it("narrows the walk to the prefix's complete leading segments", async () => {
      const scope = await makeScope();
      await writeFileAt(scope, path.join("files", "a.md"));
      await writeFileAt(scope, path.join("files", "sub", "b.md"));
      await writeFileAt(scope, "other.md");

      const records = await collectRecords(scope, EXT, "files/");
      expect(records.map((r) => r.resourceKey).sort()).toEqual(["files/a", "files/sub/b"]);
    });

    it("matches partial trailing segments across the whole scope", async () => {
      const scope = await makeScope();
      // Write at the canonical encoded paths so reconstruction yields the keys.
      for (const key of ["50%_off", "50%_offers", "5000_off"]) {
        await writeFileAt(scope, keyToRelativePath(key, EXT));
      }

      // Partial trailing piece: narrowing keeps the whole scope, caller filters.
      const records = await collectRecords(scope, EXT, "50%_");
      const keys = records.map((r) => r.resourceKey).sort();
      expect(keys).toContain("50%_off");
      expect(keys).toContain("50%_offers");
    });

    it("returns [] for an unrepresentable complete prefix segment", async () => {
      const scope = await makeScope();
      await writeFileAt(scope, path.join("con", "x.md"));
      expect(await collectRecords(scope, EXT, "con/x")).toEqual([]);
    });

    it("does not follow a symlinked directory", async () => {
      const scope = await makeScope();
      const outside = await mkdtemp(path.join(tmpdir(), "fsd-resource-path-outside-"));
      dirs.push(outside);
      await writeFile(path.join(outside, "secret.md"), "s", "utf8");
      await writeFileAt(scope, "real.md");
      await symlink(outside, path.join(scope, "linked"), "dir");

      const records = await collectRecords(scope, EXT);
      expect(records.map((r) => r.resourceKey)).toEqual(["real"]);
    });
  });
});
