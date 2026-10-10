/**
 * Specs for the generator `fsdev gen` runs: `@flow-state-dev/workforce/fsdev-gen`.
 *
 * `fsdev gen` knows no convention, so everything an author reads from it about
 * a workforce tree comes from here: the file it writes, the lines it prints,
 * the paths a stale `--check` names, and a refusal it can tell from a setup
 * error. Each family the walk finds has to reach every one of those, or a file
 * added and not generated goes unreported.
 *
 * Real temp directories through the real walk.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generator } from "../src/codegen/fsdev-gen";
import { GENERATED_FILE_NAME } from "../src/codegen/render";

const roots: string[] = [];

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A `workforce/` tree with one block in it, returned as its absolute root. */
function tree(): string {
  const dir = mkdtempSync(join(tmpdir(), "workforce-fsdev-gen-"));
  roots.push(dir);
  const root = join(dir, "workforce");
  mkdirSync(join(root, "blocks"), { recursive: true });
  writeFileSync(join(root, "blocks/triage.ts"), "export default {};");
  return root;
}

/** Write `source` at `path` under `root`, making the folders on the way. */
function put(root: string, path: string, source: string): void {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), source);
}

describe("the workforce generator", () => {
  it("reads the workforce folder by default and renders workforce.gen.ts", async () => {
    expect(generator.defaultRoot).toBe("workforce");
    const result = await generator.generate(tree());
    expect(result.file).toBe(GENERATED_FILE_NAME);
    expect(result.content).toContain("triage");
    expect(result.entries).toEqual(["blocks/triage.ts -> triage"]);
    expect(result.paths).toEqual(["blocks/triage.ts"]);
    expect(result.summary).toBe(
      "0 worker kind(s), 0 mailbox kind(s), 1 block(s), 0 resource module(s), 0 seat block(s), 0 package block(s)",
    );
  });

  it("carries a package block into the content, the paths and the count", async () => {
    // A block added to a package and not generated is a tool its holders are
    // quietly short of; `--check` can only name it if it is in `paths`.
    const root = tree();
    const pkg = "teams/support/workers/clerk/packages/refunds";
    put(root, `${pkg}/PACKAGE.md`, "---\ndescription: Refunds\n---\nRefund.\n");
    put(root, `${pkg}/blocks/issue-refund.ts`, "export default {};");

    const result = await generator.generate(root);
    expect(result.paths).toContain(`${pkg}/blocks/issue-refund.ts`);
    expect(result.content).toContain(`"${pkg}": {`);
    expect(result.summary).toContain("1 package block(s)");
  });

  it("carries a resource module into the content, the paths and the entries", async () => {
    const root = tree();
    put(root, "teams/engineering/resources/research.ts", "export default {};");

    const result = await generator.generate(root);
    expect(result.paths).toContain("teams/engineering/resources/research.ts");
    expect(result.entries).toContain(
      "teams/engineering/resources/research.ts -> teams/engineering/research",
    );
    expect(result.content).toContain(
      `"teams/engineering/research": resource_teams__engineering__research,`,
    );
  });

  it("refuses with a problems list, which is how fsdev tells a refusal from a setup error", async () => {
    const root = tree();
    put(root, "teams/engineering/resources/research.md", "---\n---\n");
    put(root, "teams/engineering/resources/research.ts", "export default {};");

    const refusal = await generator.generate(root).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).message).toMatch(/a document and a module cannot share a ref/);
    expect(Array.isArray((refusal as { problems?: unknown }).problems)).toBe(true);
  });
});
