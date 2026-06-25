import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { importOkf, exportOkf, parseOkfBundle } from "../src/okf/index";
import { makeConceptCollection, FIXTURE_BUNDLE } from "./helpers";

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "okf-export-"));
}

describe("exportOkf", () => {
  it("writes one file per concept with canonical frontmatter and a verbatim body", async () => {
    const collection = await makeConceptCollection();
    await importOkf(FIXTURE_BUNDLE, collection);

    const out = await tmpDir();
    const result = await exportOkf(collection, out);
    expect(result.exported).toBe(3);

    const orders = await fs.readFile(path.join(out, "tables/orders.md"), "utf8");
    // Frontmatter `type` is emitted first (canonical order); body is preserved.
    expect(orders.startsWith("---\ntype: BigQuery Table\n")).toBe(true);
    expect(orders).toContain("# Schema");

    const { concepts } = await parseOkfBundle(out);
    expect(concepts.map((c) => c.id).sort()).toEqual([
      "datasets/sales",
      "tables/customers",
      "tables/orders",
    ]);
  });

  it("generates a root index.md with okf_version and a concept listing", async () => {
    const collection = await makeConceptCollection();
    await importOkf(FIXTURE_BUNDLE, collection);

    const out = await tmpDir();
    await exportOkf(collection, out);

    const index = await fs.readFile(path.join(out, "index.md"), "utf8");
    expect(index).toContain('okf_version: "0.1"');
    expect(index).toContain("[Orders](/tables/orders.md)");
    // The root index is reserved — it must not re-import as a concept.
    const { okfVersion, concepts } = await parseOkfBundle(out);
    expect(okfVersion).toBe("0.1");
    expect(concepts.map((c) => c.id)).not.toContain("index");
  });

  it("materializes a programmatic edge (not in the body) into a # Related section", async () => {
    const collection = await makeConceptCollection();
    await importOkf(FIXTURE_BUNDLE, collection);

    // An edge the body does not express — e.g. linking customers -> sales.
    const customers = await collection.get("tables/customers");
    await customers.edges!.add({ from: "tables/customers", to: "datasets/sales", type: "references" });

    const out = await tmpDir();
    await exportOkf(collection, out);

    const text = await fs.readFile(path.join(out, "tables/customers.md"), "utf8");
    expect(text).toContain("# Related");
    expect(text).toContain("[datasets/sales](/datasets/sales.md)");
  });
});
