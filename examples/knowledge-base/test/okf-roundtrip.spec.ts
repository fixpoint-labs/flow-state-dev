import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { importOkf, exportOkf } from "../src/okf/index";
import { makeConceptCollection, FIXTURE_BUNDLE } from "./helpers";

/** Read every file under `dir` into a { relpath -> content } map for tree comparison. */
async function readTree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(d: string): Promise<void> {
    for (const entry of await fs.readdir(d, { withFileTypes: true })) {
      const abs = path.join(d, entry.name);
      if (entry.isDirectory()) await walk(abs);
      else out[path.relative(dir, abs).split(path.sep).join("/")] = await fs.readFile(abs, "utf8");
    }
  }
  await walk(dir);
  return out;
}

async function tmpDir(tag: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `okf-rt-${tag}-`));
}

describe("OKF round-trip idempotency", () => {
  // The load-bearing correctness gate: export -> import -> export yields a
  // byte-identical bundle. Content, canonical frontmatter, and link structure
  // must survive; edge metadata is intentionally not asserted (lossy by design).
  it("export -> import -> export is byte-identical", async () => {
    const first = await makeConceptCollection();
    await importOkf(FIXTURE_BUNDLE, first);

    const dir1 = await tmpDir("1");
    await exportOkf(first, dir1);

    const second = await makeConceptCollection();
    await importOkf(dir1, second);

    const dir2 = await tmpDir("2");
    await exportOkf(second, dir2);

    expect(await readTree(dir2)).toEqual(await readTree(dir1));
  });

  it("a programmatic edge survives the round trip exactly once (no duplication)", async () => {
    const first = await makeConceptCollection();
    await importOkf(FIXTURE_BUNDLE, first);
    const customers = await first.get("tables/customers");
    await customers.edges!.add({ from: "tables/customers", to: "datasets/sales", type: "references" });

    const dir1 = await tmpDir("edge1");
    await exportOkf(first, dir1);

    const second = await makeConceptCollection();
    await importOkf(dir1, second);
    const dir2 = await tmpDir("edge2");
    await exportOkf(second, dir2);

    expect(await readTree(dir2)).toEqual(await readTree(dir1));
    // The materialized link appears exactly once in the body.
    const text = (await readTree(dir2))["tables/customers.md"]!;
    expect(text.match(/\(\/datasets\/sales\.md\)/g)?.length).toBe(1);
  });
});
