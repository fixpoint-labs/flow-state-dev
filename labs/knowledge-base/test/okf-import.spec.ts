import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { importOkf, parseOkfBundle } from "../src/okf/index";
import { makeConceptCollection, FIXTURE_BUNDLE } from "./helpers";

describe("importOkf", () => {
  it("imports every non-reserved concept with coerced state and content", async () => {
    const collection = await makeConceptCollection();
    const result = await importOkf(FIXTURE_BUNDLE, collection);

    expect(result.imported).toBe(3); // index.md + log.md excluded

    const orders = await collection.get("tables/orders");
    expect(orders.state.type).toBe("BigQuery Table");
    expect(orders.state.title).toBe("Orders");
    expect(orders.state.description).toBe("One row per completed customer order.");
    expect(orders.state.tags).toEqual(["sales", "orders"]);
    expect(orders.state.timestamp).toBe("2026-05-28T00:00:00Z");
    expect(await orders.readContent()).toContain("# Schema");
  });

  it("projects in-bundle markdown links into typed `references` edges", async () => {
    const collection = await makeConceptCollection();
    await importOkf(FIXTURE_BUNDLE, collection);

    const sales = await collection.get("datasets/sales");
    const outgoing = sales.edges!.all().filter((e) => e.from === "datasets/sales");
    expect(outgoing.map((e) => e.to).sort()).toEqual(["tables/customers", "tables/orders"]);
    expect(outgoing.every((e) => e.type === "references")).toBe(true);

    // A relative link (`./orders.md`) resolves against the linking concept's dir.
    const customers = await collection.get("tables/customers");
    expect(customers.edges!.all().map((e) => e.to)).toContain("tables/orders");
  });

  it("preserves unknown frontmatter fields in `extra`, YAML 1.2 (no Norway problem)", async () => {
    const collection = await makeConceptCollection();
    await importOkf(FIXTURE_BUNDLE, collection);

    const sales = await collection.get("datasets/sales");
    const extra = Object.fromEntries(sales.state.extra.map((e) => [e.key, e.value]));
    // `country: NO` stays the string "NO" (would be boolean false under YAML 1.1),
    // `enabled: on` stays "on" (would be boolean true under YAML 1.1).
    expect(extra.country).toBe("NO");
    expect(extra.enabled).toBe("on");
    expect(extra.schema_version).toBe("1.2");
  });

  it("warns on a dangling link and skips the edge, without failing the bundle", async () => {
    const collection = await makeConceptCollection();
    const result = await importOkf(FIXTURE_BUNDLE, collection);

    expect(result.warnings.some((w) => w.includes("ghost"))).toBe(true);
    const sales = await collection.get("datasets/sales");
    expect(sales.edges!.all().map((e) => e.to)).not.toContain("tables/ghost");
  });

  it("excludes reserved index.md / log.md from the concept set", async () => {
    const { concepts } = await parseOkfBundle(FIXTURE_BUNDLE);
    const ids = concepts.map((c) => c.id);
    expect(ids).not.toContain("index");
    expect(ids).not.toContain("log");
    expect(ids.sort()).toEqual(["datasets/sales", "tables/customers", "tables/orders"]);
  });

  it("excludes reserved index.md / log.md at a NESTED level too", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "okf-nested-"));
    await fs.mkdir(path.join(dir, "sub"), { recursive: true });
    await fs.writeFile(path.join(dir, "sub/index.md"), "# Sub\n\n* [Real](/sub/real.md)\n");
    await fs.writeFile(path.join(dir, "sub/real.md"), "---\ntype: Note\n---\n\nReal concept.\n");

    const { concepts } = await parseOkfBundle(dir);
    const ids = concepts.map((c) => c.id);
    expect(ids).toContain("sub/real");
    expect(ids).not.toContain("sub/index");
  });

  it("treats non-mapping frontmatter (a bare scalar/list) as best-effort, not corruption", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "okf-malformed-"));
    // A bare YAML list as frontmatter — not a mapping. Must not become {0:..,1:..}.
    await fs.writeFile(path.join(dir, "bad.md"), "---\n- one\n- two\n---\n\nBody.\n");

    const collection = await makeConceptCollection();
    const result = await importOkf(dir, collection);

    const bad = await collection.get("bad");
    expect(bad.state.type).toBe("concept");
    expect(bad.state.extra).toEqual([]); // no spurious "0"/"1" index keys
    expect(result.warnings.some((w) => w.includes("missing required"))).toBe(true);
  });

  it("defaults a missing `type` to `concept` with a warning (best-effort)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "okf-notype-"));
    await fs.writeFile(path.join(dir, "loose.md"), "---\ntitle: No Type Here\n---\n\nBody.\n");

    const collection = await makeConceptCollection();
    const result = await importOkf(dir, collection);

    const loose = await collection.get("loose");
    expect(loose.state.type).toBe("concept");
    expect(result.warnings.some((w) => w.includes("missing required"))).toBe(true);
  });
});
