/**
 * The pending-changeset predicate the vocabulary guard and the changeset check share, held to
 * `@changesets/read`, the module `changeset version` reads notes with. If they disagree, the
 * guard would excuse or refuse an exemption for a file the release treats the other way.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — root check script, plain .mjs with no type declarations.
import { isPendingChangeset } from "../../../scripts/pending-changesets.mjs";
// @ts-expect-error — root check script, plain .mjs with no type declarations.
import { loadChangesets } from "../../../scripts/validate-publish-set.mjs";

const pending = isPendingChangeset as (path: string) => boolean;
const NOTE = "---\n---\n\nA note.\n";
const FILES = ["a-note.md", "README.md", "readme.md", "Readme.MD", ".draft.md", "notes.txt", "config.json"];

describe("pending changesets are the notes changeset version reads", () => {
  it("treats a dotfile and a README in any case as not pending", () => {
    expect(pending(".changeset/.draft.md")).toBe(false);
    expect(pending(".changeset/readme.md")).toBe(false);
    expect(pending(".changeset/README.md")).toBe(false);
    expect(pending(".changeset/nested/a-note.md")).toBe(false);
    expect(pending("docs/a-note.md")).toBe(false);
    expect(pending(".changeset/a-note.md")).toBe(true);
  });

  it("agrees with @changesets/read on the same folder", async () => {
    const root = mkdtempSync(join(tmpdir(), "pending-changesets-"));
    try {
      // Read takes a subfolder as a pre-v2 changeset folder, a format this repo has never had,
      // so the agreement is over the top level, where every note lives.
      mkdirSync(join(root, ".changeset"), { recursive: true });
      for (const file of FILES) writeFileSync(join(root, ".changeset", file), NOTE);
      const { read } = (loadChangesets as () => { read: (root: string) => Promise<{ id: string }[]> })();
      const byRead = (await read(root)).map((note) => `.changeset/${note.id}.md`).sort();
      const byPredicate = FILES.map((f) => `.changeset/${f}`).filter(pending).sort();
      expect(byPredicate).toEqual(byRead);
      expect(byRead).toEqual([".changeset/a-note.md"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
