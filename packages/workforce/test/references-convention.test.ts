/**
 * The `references/` convention, end to end: a tree on disk, the loader, the
 * install half, `hireWorkforce`, and a live execution context.
 *
 * `BR-n` / `V-n` are the issue's rule and check numbers, kept so a finding can
 * be cited by one; every case states the rule it owns, so nothing here needs a
 * second document to read.
 *
 * **Three of these were RED before this convention existed**, and they are the
 * work. Each is written as the promise, on the real path, so a green is the
 * promise holding and not the harness agreeing with itself:
 *
 * - **V3 / BR-7** — an ungranted seat reads another team's handbook. The wall
 *   has to come from where the file sits, with no filter written by the app.
 * - **V2 / BR-11** — an ungranted seat overwrites the org handbook.
 * - **V2 / BR-1** — the write STICKS: the disk body was a first-boot seed, so
 *   the file in git stopped being what anyone read.
 *
 * **Two are the regressions that would ship silently**, and they matter more
 * than the reds:
 *
 * - **V4 / BR-14** — a seat with no `resources:` key still reaches every
 *   MUTABLE resource. Tightening that while making the wall work is the
 *   cheapest way to break the rest of this wave, and it would pass every check
 *   above.
 * - **V2b / BR-19** — a row written BEFORE the move still shadows the file. The
 *   seal stops new writes and cannot evict an old one, so a fresh-tree test
 *   passes either way and hides it. This is the case that needs a tree with
 *   history, which is why it builds one.
 *
 * Bodies are asserted with `toBe`, never `toContain`. `contentFile` hands the
 * engine the raw file, frontmatter and all, so a `toContain("ORG HANDBOOK v1")`
 * passes while every prompt in the product carries a block of YAML.
 */
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { defineFlow, defineResource, handler, type DeclaredResources } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createExecutionContext, createInMemoryStores } from "@flow-state-dev/engine";
import { readReferencesDirectory, readResourcesDirectory } from "../src/loader";
import { discoverResourceModules } from "../src/codegen/discover-resource-modules";
import { readDeclaredRoster } from "../src/loader/read-declared-roster";
import { referencesFromDocs } from "../src/references-from-docs";
import { resourcesFromDocs } from "../src/resources-from-docs";
import { clearShadowedReferences } from "../src/clear-shadowed-references";
import { hireWorkforce } from "../src/hire";
import type { WorkerManifest } from "../src/manifest";
import { SEAT_REFERENCES_KEY } from "../src/seat-references";
import { SEAT_RESOURCES_KEY } from "../src/seat-resources";
import { workerConfigSchema } from "../src/worker-config";

const ORG = "org_fix1467";
const USER = "user_fix1467";
const KIND = "desk";

const ORG_HANDBOOK = "handbook";
const ENG_HANDBOOK = "teams/engineering/handbook";
const SALES_HANDBOOK = "teams/sales/handbook";
const ENG_SCRATCH = "teams/engineering/scratch";
const ADA_NOTES = "teams/engineering/workers/ada/notes";
const BOB_NOTES = "teams/engineering/workers/bob/notes";

/**
 * A VALID engineering placement. A worker id is team-qualified,
 * `"<teamId>.<name>"` — a `/` there is unroutable — so this seat's folder is
 * `teams/engineering/workers/ada/`, and that is the place the wall is derived
 * from. A bare `"ada"` is not a seat the loader can mint, so it would give the
 * own-team / sibling-team distinction nothing to be distinguished FROM.
 */
const ENG_SEAT = "engineering.ada";

const roots: string[] = [];

/** A workforce tree on disk, read by the real loader. */
async function tree(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fix1467-"));
  roots.push(root);
  await writeInto(root, {
    "org/references/handbook.md": doc("The org handbook", "ORG HANDBOOK v1"),
    "teams/engineering/references/handbook.md": doc("Engineering handbook", "ENGINEERING HANDBOOK v1"),
    "teams/sales/references/handbook.md": doc("Sales handbook", "SALES HANDBOOK v1"),
    "teams/engineering/workers/ada/references/notes.md": doc("Ada's notes", "ADA NOTES v1"),
    "teams/engineering/workers/bob/references/notes.md": doc("Bob's notes", "BOB NOTES v1"),
    // The mutable neighbour BR-14 is about. Unchanged by this convention.
    "teams/engineering/resources/scratch.md":
      "---\ndescription: Engineering scratchpad\nllmReadable: true\nllmWritable: true\n---\nseed",
  });
  return root;
}

const doc = (description: string, body: string): string =>
  `---\ndescription: ${description}\nllmReadable: true\n---\n${body}`;

async function writeInto(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    await fs.mkdir(path.join(root, path.dirname(rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), body, "utf8");
  }
}

afterAll(async () => {
  for (const root of roots) await fs.rm(root, { recursive: true, force: true });
});

const work = handler({
  name: "desk-work",
  requireOrg: true,
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async () => ({ ok: true }),
});

function kindWith(resources: DeclaredResources) {
  return defineFlow({
    kind: KIND,
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    resources: { ...resources } as DeclaredResources,
    actions: { run: { inputSchema: z.object({}), block: work } },
  });
}

/** A seat record as the loader produces one. */
function seat(id: string, declared: Record<string, unknown> = {}): WorkerManifest {
  return { id, declared: { flow: KIND, description: id, ...declared }, body: "" };
}

type Handle = { readContent(): Promise<string | null>; writeContent(body: string): Promise<void> };

async function ctxFor(flow: FlowInstance, stores = createInMemoryStores()) {
  const ctx = await createExecutionContext({
    flow,
    actionName: "run",
    requestId: `req_${flow.id}`,
    sessionId: `sess_${flow.id}`,
    userId: USER,
    orgId: ORG,
    stores,
  });
  return { ctx, stores };
}

/**
 * The handle, or `undefined` when the seat cannot reach that ref at all.
 *
 * `ctx.resources.get` THROWS on an unregistered accessor rather than returning
 * nothing, so "unreachable" has to be caught to be asserted on.
 */
const handleFor = (ctx: { resources: { get(k: string): unknown } }, key: string): Handle | undefined => {
  try {
    return ctx.resources.get(key) as Handle;
  } catch {
    return undefined;
  }
};

/**
 * The whole path in one call: disk → loader → both install halves → kind →
 * hire → a live seat.
 *
 * **No install filter.** That is the point of V3: the app hands the kind every
 * document and every reference it loaded, and the cross-team wall has to come
 * from somewhere else.
 */
async function seatOn(root: string, seatRecord: WorkerManifest = seat(ENG_SEAT)) {
  const documents = resourcesFromDocs((await readResourcesDirectory(root)).documents);
  const references = referencesFromDocs((await readReferencesDirectory(root)).documents);
  const hired = hireWorkforce([seatRecord], {
    kinds: { [KIND]: kindWith({ ...documents, ...references }) as never },
    documents,
    references,
  });
  return { seat: hired[0]!, documents, references };
}

// ---------------------------------------------------------------------------
// V1 · the reader
// ---------------------------------------------------------------------------

describe("V1 · the references/ slot loads at every level (BR-1, BR-18)", () => {
  it("walks org, team and worker references/, minting into the resources namespace", async () => {
    const read = await readReferencesDirectory(await tree());
    expect(read.errors).toEqual([]);
    expect(read.documents.map((d) => d.ref).sort()).toEqual(
      [ADA_NOTES, BOB_NOTES, ENG_HANDBOOK, ORG_HANDBOOK, SALES_HANDBOOK].sort(),
    );
  });

  it("carries each record's file path — the thing the install half installs", async () => {
    const root = await tree();
    const read = await readReferencesDirectory(root);
    const org = read.documents.find((d) => d.ref === ORG_HANDBOOK)!;
    expect(org.filePath).toBe(path.join(root, "org/references/handbook.md"));
  });

  it("reads only its own slot: resources/ documents are not references", async () => {
    const root = await tree();
    const references = await readReferencesDirectory(root);
    const documents = await readResourcesDirectory(root);
    expect(references.documents.map((d) => d.ref)).not.toContain(ENG_SCRATCH);
    expect(documents.documents.map((d) => d.ref)).toEqual([ENG_SCRATCH]);
  });

  it("BR-18 — a directory in the slot is reported, naming references/ and not resources/", async () => {
    const root = await tree();
    await fs.mkdir(path.join(root, "org/references/handbook-folder"), { recursive: true });
    const read = await readReferencesDirectory(root);
    const reported = read.errors.find((e) => e.path === "org/references/handbook-folder");
    expect(reported?.kind).toBe("folder-where-file-belongs");
    // The message has to name the slot the author actually wrote in.
    expect(reported?.error.message).toContain("references/");
    expect(reported?.error.message).not.toContain("resources/");
  });

  it("BR-18 — a non-.md file is passed over in silence", async () => {
    const root = await tree();
    await fs.writeFile(path.join(root, "org/references/notes.txt"), "loose", "utf8");
    const read = await readReferencesDirectory(root);
    expect(read.errors).toEqual([]);
    expect(read.documents.map((d) => d.ref)).not.toContain("notes");
  });
});

// ---------------------------------------------------------------------------
// V2 · the read path — D1
// ---------------------------------------------------------------------------

describe("V2 · a reference is read from its file and sealed (D1)", () => {
  it("BR-11 RED→GREEN — an ungranted seat CANNOT write the org handbook", async () => {
    const { seat: ada } = await seatOn(await tree());
    const { ctx } = await ctxFor(ada);
    await expect(handleFor(ctx, ORG_HANDBOOK)!.writeContent("DEFACED")).rejects.toThrow(/read-only/i);
  });

  it("BR-1 RED→GREEN — after a write is attempted, the body is still the FILE's", async () => {
    const { seat: ada } = await seatOn(await tree());
    const { ctx, stores } = await ctxFor(ada);
    await expect(handleFor(ctx, ORG_HANDBOOK)!.writeContent("DEFACED")).rejects.toThrow();

    // A fresh context over the same store — a later request, a later deploy.
    const again = await ctxFor(ada, stores);
    expect(await handleFor(again.ctx, ORG_HANDBOOK)!.readContent()).toBe("ORG HANDBOOK v1");
  });

  it("BR-1 — the body is the DOCUMENT, not the file: no frontmatter leaks through", async () => {
    const { seat: ada } = await seatOn(await tree());
    const { ctx } = await ctxFor(ada);
    const body = await handleFor(ctx, ORG_HANDBOOK)!.readContent();
    // `contentFile` hands the engine the raw bytes. Exact equality is the only
    // assertion that catches the YAML block a `toContain` would wave through.
    expect(body).toBe("ORG HANDBOOK v1");
    expect(body).not.toContain("description:");
    expect(body).not.toContain("---");
  });

  it("BR-2 — an edit in git reaches the next execution context", async () => {
    const root = await tree();
    const { seat: ada } = await seatOn(root);
    const { ctx, stores } = await ctxFor(ada);
    expect(await handleFor(ctx, ORG_HANDBOOK)!.readContent()).toBe("ORG HANDBOOK v1");

    await fs.writeFile(
      path.join(root, "org/references/handbook.md"),
      doc("The org handbook", "ORG HANDBOOK v2"),
      "utf8",
    );

    const again = await ctxFor(ada, stores);
    expect(await handleFor(again.ctx, ORG_HANDBOOK)!.readContent()).toBe("ORG HANDBOOK v2");
  });

  it("BR-3 — and NOT mid-request: a read already in flight does not see the edit", async () => {
    const root = await tree();
    const { seat: ada } = await seatOn(root);
    const { ctx } = await ctxFor(ada);
    const handle = handleFor(ctx, ORG_HANDBOOK)!;
    expect(await handle.readContent()).toBe("ORG HANDBOOK v1");

    await fs.writeFile(
      path.join(root, "org/references/handbook.md"),
      doc("The org handbook", "ORG HANDBOOK v2"),
      "utf8",
    );

    // Pinned deliberately, and asserted rather than left unsaid: the promise is
    // "the file is the source", per request. Anything that starts asserting
    // immediacy here is promising hot reload the substrate does not offer.
    expect(await handle.readContent()).toBe("ORG HANDBOOK v1");
  });

  it("BR-12 — a reference declaring `writable:` is refused by name, at EITHER value", async () => {
    for (const value of ["true", "false"]) {
      const root = await tree();
      await fs.writeFile(
        path.join(root, "org/references/handbook.md"),
        `---\ndescription: The org handbook\nwritable: ${value}\n---\nORG HANDBOOK v1`,
        "utf8",
      );
      const read = await readReferencesDirectory(root);
      const refused = read.errors.find((e) => e.path === "org/references/handbook.md");
      expect(refused?.kind).toBe("refused-declaration");
      expect(refused?.error.message).toContain("writable");
    }
  });

  it("BR-12 — and `llmWritable:` and `render:`, the other two halves of the seal", async () => {
    for (const key of ["llmWritable: true", "render: nope"]) {
      const root = await tree();
      await fs.writeFile(
        path.join(root, "org/references/handbook.md"),
        `---\ndescription: The org handbook\n${key}\n---\nORG HANDBOOK v1`,
        "utf8",
      );
      const read = await readReferencesDirectory(root);
      expect(read.errors.find((e) => e.path === "org/references/handbook.md")?.kind).toBe(
        "refused-declaration",
      );
    }
  });

  it("BR-13 — a resources/ document may still declare `writable:`. The shared list did not widen", async () => {
    const root = await tree();
    await fs.writeFile(
      path.join(root, "teams/engineering/resources/scratch.md"),
      "---\ndescription: Engineering scratchpad\nwritable: false\n---\nseed",
      "utf8",
    );
    const read = await readResourcesDirectory(root);
    expect(read.errors).toEqual([]);
    expect(read.documents[0]!.declared["writable"]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// V2b · BR-19, the migration hole
// ---------------------------------------------------------------------------

describe("V2b · BR-19 — a row written BEFORE the move shadows the file", () => {
  /**
   * Era 1: the handbook lives under `resources/`, and something writes it.
   * Era 2: it moves to `references/` and is sealed.
   *
   * The seal stops new writes. It cannot evict the row already there, and that
   * row still wins — so the git-is-source promise does not hold for a tree with
   * history until the row is cleared. A fresh tree passes either way, which is
   * exactly why this builds one with a past.
   */
  async function treeWithHistory() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "fix1467-hist-"));
    roots.push(root);
    const stores = createInMemoryStores();

    // Era 1 — mutable, under resources/.
    await writeInto(root, {
      "org/resources/handbook.md": doc("The org handbook", "ORG HANDBOOK v1"),
    });
    const documents = resourcesFromDocs((await readResourcesDirectory(root)).documents);
    const before = hireWorkforce([seat(ENG_SEAT)], {
      kinds: { [KIND]: kindWith(documents) as never },
      documents,
    });
    const era1 = await ctxFor(before[0]!, stores);
    await handleFor(era1.ctx, ORG_HANDBOOK)!.writeContent("WRITTEN BEFORE THE MOVE");

    // Era 2 — the file moves into references/ and is sealed.
    await fs.rm(path.join(root, "org/resources/handbook.md"));
    await writeInto(root, {
      "org/references/handbook.md": doc("The org handbook", "ORG HANDBOOK v1"),
    });
    return { root, stores };
  }

  it("the hole is real — sealing alone leaves the stale row serving forever", async () => {
    const { root, stores } = await treeWithHistory();
    const { seat: ada } = await seatOn(root);
    const { ctx } = await ctxFor(ada, stores);
    // Not an aspiration: this is what a `git mv` on its own buys. The next case
    // is what makes it wrong.
    expect(await handleFor(ctx, ORG_HANDBOOK)!.readContent()).toBe("WRITTEN BEFORE THE MOVE");
  });

  it("RED→GREEN — after the migration the file wins, and it says what it cleared", async () => {
    const { root, stores } = await treeWithHistory();
    const { seat: ada, references } = await seatOn(root);

    const result = await clearShadowedReferences({ references, orgId: ORG, content: stores.content });

    // Observable, not silent: the migration names the ref it unshadowed and
    // hands back the body that had been served in the file's place.
    expect(result.checked).toEqual([ORG_HANDBOOK]);
    expect(result.cleared).toEqual([
      { ref: ORG_HANDBOOK, shadowedContent: "WRITTEN BEFORE THE MOVE" },
    ]);

    const { ctx } = await ctxFor(ada, stores);
    expect(await handleFor(ctx, ORG_HANDBOOK)!.readContent()).toBe("ORG HANDBOOK v1");
  });

  it("dryRun reports the same finding and changes nothing", async () => {
    const { root, stores } = await treeWithHistory();
    const { seat: ada, references } = await seatOn(root);

    const result = await clearShadowedReferences({
      references,
      orgId: ORG,
      content: stores.content,
      dryRun: true,
    });
    expect(result.cleared.map((r) => r.ref)).toEqual([ORG_HANDBOOK]);

    const { ctx } = await ctxFor(ada, stores);
    expect(await handleFor(ctx, ORG_HANDBOOK)!.readContent()).toBe("WRITTEN BEFORE THE MOVE");
  });

  it("is idempotent, and a clean tree reports nothing cleared", async () => {
    const root = await tree();
    const { references } = await seatOn(root);
    const stores = createInMemoryStores();

    const first = await clearShadowedReferences({ references, orgId: ORG, content: stores.content });
    expect(first.cleared).toEqual([]);
    expect(first.checked.length).toBe(5);

    const second = await clearShadowedReferences({ references, orgId: ORG, content: stores.content });
    expect(second.cleared).toEqual([]);
  });

  it("never touches a resources/ document's row — the mutable path keeps its history", async () => {
    const root = await tree();
    const { seat: ada, references } = await seatOn(root);
    const { ctx, stores } = await ctxFor(ada);
    await handleFor(ctx, ENG_SCRATCH)!.writeContent("scratch edit");

    await clearShadowedReferences({ references, orgId: ORG, content: stores.content });

    const again = await ctxFor(ada, stores);
    expect(await handleFor(again.ctx, ENG_SCRATCH)!.readContent()).toBe("scratch edit");
  });
});

// ---------------------------------------------------------------------------
// V3 · the derived wall — D2
// ---------------------------------------------------------------------------

describe("V3 · the wall comes from the tree, with no filter written by the app (D2)", () => {
  it("BR-1 — an ungranted seat reads the org's references and its own team's", async () => {
    const { seat: ada } = await seatOn(await tree());
    const { ctx } = await ctxFor(ada);
    expect(await handleFor(ctx, ORG_HANDBOOK)!.readContent()).toBe("ORG HANDBOOK v1");
    expect(await handleFor(ctx, ENG_HANDBOOK)!.readContent()).toBe("ENGINEERING HANDBOOK v1");
  });

  it("BR-7 RED→GREEN — and CANNOT read another team's, with no install filter", async () => {
    const { seat: ada } = await seatOn(await tree());
    const { ctx } = await ctxFor(ada);
    // Not an empty read and not a null body: the ref is not reachable at all.
    expect(handleFor(ctx, SALES_HANDBOOK)).toBeUndefined();
  });

  it("BR-1 — its own worker folder is reachable", async () => {
    const { seat: ada } = await seatOn(await tree());
    const { ctx } = await ctxFor(ada);
    expect(await handleFor(ctx, ADA_NOTES)!.readContent()).toBe("ADA NOTES v1");
  });

  it("BR-9 — a SIBLING seat's folder on the same team is not", async () => {
    const { seat: ada } = await seatOn(await tree());
    const { ctx } = await ctxFor(ada);
    // The walk inherits downward only. A sibling's folder is not above anyone.
    expect(handleFor(ctx, BOB_NOTES)).toBeUndefined();
  });

  it("BR-10 — width comes from the tree: moving the file up reaches both teams", async () => {
    const root = await tree();
    // The sales handbook moves to the org level. Nothing else changes — no
    // grant, no install-side override, because there is none to write.
    await fs.rm(path.join(root, "teams/sales/references/handbook.md"));
    await writeInto(root, { "org/references/company.md": doc("Company-wide", "COMPANY v1") });

    for (const seatId of ["engineering.ada", "sales.sam"]) {
      const { seat: hired } = await seatOn(root, seat(seatId));
      const { ctx } = await ctxFor(hired);
      expect(await handleFor(ctx, "company")!.readContent()).toBe("COMPANY v1");
    }
  });

  it("BR-4 — a `references:` list narrows within the wall", async () => {
    const { seat: ada } = await seatOn(
      await tree(),
      seat(ENG_SEAT, { [SEAT_REFERENCES_KEY]: [ENG_HANDBOOK] }),
    );
    const { ctx } = await ctxFor(ada);
    expect(await handleFor(ctx, ENG_HANDBOOK)!.readContent()).toBe("ENGINEERING HANDBOOK v1");
    expect(handleFor(ctx, ORG_HANDBOOK)).toBeUndefined();
  });

  it("BR-4 / BP-031 — and can never widen past it: naming a sibling team refuses", async () => {
    await expect(
      seatOn(await tree(), seat(ENG_SEAT, { [SEAT_REFERENCES_KEY]: [SALES_HANDBOOK] })),
    ).rejects.toThrow(/cannot add one from outside|is not a reference/i);
  });

  it("BR-5 — present-and-empty is restricted to nothing, and is not absent", async () => {
    const { seat: ada } = await seatOn(
      await tree(),
      seat(ENG_SEAT, { [SEAT_REFERENCES_KEY]: [] }),
    );
    const { ctx } = await ctxFor(ada);
    expect(handleFor(ctx, ORG_HANDBOOK)).toBeUndefined();
    expect(handleFor(ctx, ENG_HANDBOOK)).toBeUndefined();
    // …and the mutable neighbour is untouched by a references: key.
    expect(await handleFor(ctx, ENG_SCRATCH)!.readContent()).toBe("seed");
  });

  it("BR-6 — a ref matching no file refuses at hire, naming it", async () => {
    await expect(
      seatOn(await tree(), seat(ENG_SEAT, { [SEAT_REFERENCES_KEY]: ["teams/engineering/hanbdook"] })),
    ).rejects.toThrow(/hanbdook/);
  });

  it("a malformed `references:` refuses rather than resolving to nothing", async () => {
    await expect(
      seatOn(await tree(), seat(ENG_SEAT, { [SEAT_REFERENCES_KEY]: "teams/engineering/handbook" })),
    ).rejects.toThrow(/is a LIST/);
  });
});

// ---------------------------------------------------------------------------
// V4 · the second path (BP-035) — BR-14, the regression that must not happen
// ---------------------------------------------------------------------------

describe("V4 · BR-14 — the mutable path is untouched", () => {
  it("a seat with NO `resources:` key still reaches every mutable resource", async () => {
    const { seat: ada } = await seatOn(await tree());
    const { ctx } = await ctxFor(ada);
    // A `resources:` grant is optional NARROWING, never a precondition for
    // reach. Breaking this breaks every app in the monorepo, and it would pass
    // every reference check above.
    expect(await handleFor(ctx, ENG_SCRATCH)!.readContent()).toBe("seed");
  });

  it("…and can still WRITE it. The wall seals references, not resources", async () => {
    const { seat: ada } = await seatOn(await tree());
    const { ctx, stores } = await ctxFor(ada);
    await handleFor(ctx, ENG_SCRATCH)!.writeContent("scratch edit");
    const again = await ctxFor(ada, stores);
    expect(await handleFor(again.ctx, ENG_SCRATCH)!.readContent()).toBe("scratch edit");
  });

  it("a mutable resource is NOT walled by the tree — a sibling team's stays reachable", async () => {
    const root = await tree();
    await writeInto(root, {
      "teams/sales/resources/pipeline.md": doc("Sales pipeline", "pipeline seed"),
    });
    const { seat: ada } = await seatOn(root);
    const { ctx } = await ctxFor(ada);
    // Deliberate, and the boundary of this change: D2 derives a wall for
    // REFERENCES. Tightening the mutable path is a different decision with a
    // different blast radius, and this spec does not make it.
    expect(await handleFor(ctx, "teams/sales/pipeline")!.readContent()).toBe("pipeline seed");
  });

  it("#1943's `resources:` narrowing still works, alongside the wall", async () => {
    const { seat: ada } = await seatOn(
      await tree(),
      seat(ENG_SEAT, { [SEAT_RESOURCES_KEY]: [ENG_SCRATCH] }),
    );
    const { ctx } = await ctxFor(ada);
    expect(await handleFor(ctx, ENG_SCRATCH)!.readContent()).toBe("seed");
    // The wall still applies to the references beside it.
    expect(handleFor(ctx, SALES_HANDBOOK)).toBeUndefined();
    expect(await handleFor(ctx, ORG_HANDBOOK)!.readContent()).toBe("ORG HANDBOOK v1");
  });

  it("an app with no references/ folder reaches every document, including a sibling team's", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "fix1467-noref-"));
    roots.push(root);
    await writeInto(root, {
      "teams/engineering/resources/scratch.md": doc("Scratch", "seed"),
      "teams/sales/resources/pipeline.md": doc("Sales pipeline", "pipeline seed"),
      "org/resources/coc.md": doc("Code of conduct", "coc seed"),
    });
    const documents = resourcesFromDocs((await readResourcesDirectory(root)).documents);
    const hired = hireWorkforce([seat(ENG_SEAT)], {
      kinds: { [KIND]: kindWith(documents) as never },
      documents,
    });
    const { ctx } = await ctxFor(hired[0]!);

    // The whole map, cross-team included, exactly as before this convention
    // existed. Asserted as reach rather than as "no map was passed", because
    // reach is the thing an app would lose and a minted instance's `resources`
    // is the kind's merged map either way.
    for (const [ref, body] of [
      [ENG_SCRATCH, "seed"],
      ["teams/sales/pipeline", "pipeline seed"],
      ["coc", "coc seed"],
    ] as const) {
      expect(await handleFor(ctx, ref)!.readContent()).toBe(body);
    }
  });
});

// ---------------------------------------------------------------------------
// BR-15 · one basename, two slots
// ---------------------------------------------------------------------------

describe("BR-15 · a ref claimed by both slots is refused at both doors", () => {
  it("the loader reports it, naming both paths", async () => {
    const root = await tree();
    await writeInto(root, {
      "org/resources/handbook.md": doc("The org handbook", "a second handbook"),
    });
    const roster = await readDeclaredRoster(root);
    const collision = roster.problems.find((p) => p.error.message.includes("both claim the ref"));
    expect(collision).toBeDefined();
    expect(collision!.error.message).toContain("org/references/handbook.md");
    expect(collision!.error.message).toContain("org/resources/handbook.md");
  });

  it("the codegen door refuses a resources/ MODULE colliding with a references/ document", async () => {
    const root = await tree();
    // Same level, same basename, different slot — one ref between them, and a
    // directory apart, so the within-folder listing cannot see the pair.
    await writeInto(root, { "org/resources/handbook.ts": "export default {};\n" });
    const found = await discoverResourceModules(root);
    const collision = found.problems.find((p) => p.includes("cannot share a ref"));
    expect(collision).toBeDefined();
    expect(collision).toContain("org/resources/handbook.ts");
    // Names the file that actually claims the ref, not a resources/ path that
    // does not exist.
    expect(collision).toContain("org/references/handbook.md");
  });

  it("hireWorkforce throws for a hand-built catalog that never passed the loader", () => {
    const shared = defineResource({
      ref: ORG_HANDBOOK,
      scope: "org",
      stateSchema: z.object({}).passthrough(),
      default: {},
      content: "x",
    });
    expect(() =>
      hireWorkforce([seat(ENG_SEAT)], {
        kinds: { [KIND]: kindWith({ [ORG_HANDBOOK]: shared }) as never },
        documents: { [ORG_HANDBOOK]: shared },
        references: { [ORG_HANDBOOK]: shared },
      }),
    ).toThrow(/both a document and a reference/);
  });
});

// ---------------------------------------------------------------------------
// BR-16 / BR-17 · migration coexistence
// ---------------------------------------------------------------------------

describe("BR-16 / BR-17 · both folders at one level, each by its own rules", () => {
  it("a tree with references/ and resources/ side by side reads both", async () => {
    const root = await tree();
    await writeInto(root, {
      "teams/engineering/resources/scratch.md": doc("Scratch", "seed"),
      "teams/engineering/references/handbook.md": doc("Engineering handbook", "ENGINEERING HANDBOOK v1"),
    });
    const { seat: ada } = await seatOn(root);
    const { ctx, stores } = await ctxFor(ada);

    // The reference: sealed, served from the file.
    await expect(handleFor(ctx, ENG_HANDBOOK)!.writeContent("x")).rejects.toThrow(/read-only/i);
    // The document beside it: writable, and the row becomes the source.
    await handleFor(ctx, ENG_SCRATCH)!.writeContent("evolved");
    const again = await ctxFor(ada, stores);
    expect(await handleFor(again.ctx, ENG_SCRATCH)!.readContent()).toBe("evolved");
    expect(await handleFor(again.ctx, ENG_HANDBOOK)!.readContent()).toBe("ENGINEERING HANDBOOK v1");
  });
});
