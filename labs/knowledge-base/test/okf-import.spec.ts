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

  it("syncs the collection to the bundle — a re-mount prunes concepts not present", async () => {
    const collection = await makeConceptCollection();
    await importOkf(FIXTURE_BUNDLE, collection); // datasets/sales, tables/orders, tables/customers

    const other = await fs.mkdtemp(path.join(os.tmpdir(), "okf-remount-"));
    await fs.writeFile(path.join(other, "solo.md"), "---\ntype: Note\n---\n\nOnly me.\n");
    await importOkf(other, collection);

    const remaining = (await collection.list()).map((r) => r.path).sort();
    expect(remaining).toEqual(["concepts/solo"]); // prior bundle's concepts pruned
  });

  it("skips a concept with unparseable YAML and warns, without failing the bundle", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "okf-badyaml-"));
    await fs.writeFile(path.join(dir, "good.md"), "---\ntype: Note\n---\n\nFine.\n");
    await fs.writeFile(path.join(dir, "bad.md"), "---\nfoo: [unclosed\nbar: : :\n---\n\nBroken.\n");

    const collection = await makeConceptCollection();
    const result = await importOkf(dir, collection);

    expect(await collection.getOptional("good")).toBeDefined();
    expect(await collection.getOptional("bad")).toBeUndefined();
    expect(result.warnings.some((w) => w.includes("failed to parse"))).toBe(true);
  });

  it("does not turn a markdown image (`![]()`) into a concept edge", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "okf-image-"));
    await fs.writeFile(path.join(dir, "target.md"), "---\ntype: Note\n---\n\nTarget.\n");
    // `imaged` links to target only via an image; `prosed` via a prose link.
    await fs.writeFile(path.join(dir, "imaged.md"), "---\ntype: Note\n---\n\n![pic](/target.md)\n");
    await fs.writeFile(path.join(dir, "prosed.md"), "---\ntype: Note\n---\n\nSee [target](/target.md).\n");

    const collection = await makeConceptCollection();
    await importOkf(dir, collection);

    const imaged = await collection.get("imaged");
    const prosed = await collection.get("prosed");
    expect(imaged.edges!.all().some((e) => e.from === "imaged")).toBe(false);
    expect(prosed.edges!.all().some((e) => e.from === "prosed" && e.to === "target")).toBe(true);
  });
});
