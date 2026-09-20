/**
 * FIX-1467 POC — what a Workforce `resources/*.md` document ACTUALLY does today,
 * and which half of D1 today's core API can already express.
 *
 * Throwaway. Lives on the never-merged spec branch, ships nowhere. It exists to
 * check the claims FIX-1467's body builds its direction on, against real `main`
 * code — the loader, `hireWorkforce`, and a real execution context — rather than
 * against the teaching.
 *
 * Legs 1–4 are the body's own POC spine, in its order. Each is written as the
 * spine's PROMISE, so a leg that fails is the spine naming work that does not
 * exist yet, rather than a broken harness.
 *
 * **The honest control.** The red legs are each paired with a control that runs
 * the SAME harness with exactly ONE input changed — the app's install filter
 * (leg 2), one frontmatter key (leg 3). The control goes green. That pair is
 * what makes a red mean "the gap is real" instead of "the check never reached
 * the code": a harness that could not observe the behaviour at all would be red
 * in both halves.
 *
 * **Leg 5 is a different kind of leg, and it is all green on purpose.** It names
 * no work. It answers the feasibility question review round 1 put to the spec —
 * can D1 be built on today's core API, or does it need a core/engine contract
 * change? Every assertion there pins real `main` behaviour, and the comment
 * above it says what that behaviour costs D1.
 *
 * Run:
 *   ln -sfn ../../packages/workforce/node_modules \
 *     spec-poc/FIX-1467-references-vs-resources/node_modules
 *   cd packages/workforce
 *   env -u FSDEV_DEFAULT_MODEL pnpm exec vitest run \
 *     --root ../../spec-poc/FIX-1467-references-vs-resources
 */
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { defineFlow, defineResource, handler, type DeclaredResources } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createExecutionContext, createInMemoryStores } from "@flow-state-dev/engine";
import { readResourcesDirectory } from "../../packages/workforce/src/loader";
import { resourcesFromDocs } from "../../packages/workforce/src/resources-from-docs";
import { hireWorkforce } from "../../packages/workforce/src/hire";
import type { WorkerManifest } from "../../packages/workforce/src/manifest";
import { workerConfigSchema } from "../../packages/workforce/src/worker-config";

const ORG = "org_fix1467";
const USER = "user_fix1467";
const KIND = "desk";

const ORG_HANDBOOK = "handbook";
const ENG_HANDBOOK = "teams/engineering/handbook";
const SALES_HANDBOOK = "teams/sales/handbook";
const ENG_SCRATCH = "teams/engineering/scratch";

/**
 * A VALID engineering placement. `WorkerManifest.id` is team-qualified,
 * `"<teamId>.<name>"` — `manifest.ts` is explicit that a `/` here is unroutable
 * (decision 2). An earlier draft hired a bare `"ada"`, which is not a seat the
 * loader could ever mint, so D2's own-team-vs-sibling-team distinction had no
 * valid placement to be distinguished FROM.
 *
 * On `main` this changes no result — nothing in today's reachability path reads
 * the team half of the id, which is precisely why leg 2's cross-team assertion
 * is red. It matters for PLAN's VG: that check adapts this harness AFTER D2
 * derives reachability from tree position, and at that point a bare id would
 * make VG pass or fail for the wrong reason.
 */
const ENG_SEAT = "engineering.ada";

// --------------------------------------------------------------------------
// A real workforce tree on disk, read by the real loader.
// --------------------------------------------------------------------------

const roots: string[] = [];

async function tree(opts: { sealOrgHandbook?: boolean } = {}): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fix1467-"));
  roots.push(root);
  const write = async (rel: string, body: string) => {
    await fs.mkdir(path.join(root, path.dirname(rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), body, "utf8");
  };

  // The org handbook. `writable: false` is the ONE input leg 3's control changes.
  const seal = opts.sealOrgHandbook === true ? "writable: false\n" : "";
  await write(
    "org/resources/handbook.md",
    `---\ndescription: The org handbook\nllmReadable: true\n${seal}---\nORG HANDBOOK v1`
  );
  await write(
    "teams/engineering/resources/handbook.md",
    "---\ndescription: Engineering handbook\nllmReadable: true\n---\nENGINEERING HANDBOOK v1"
  );
  await write(
    "teams/sales/resources/handbook.md",
    "---\ndescription: Sales handbook\nllmReadable: true\n---\nSALES HANDBOOK v1"
  );
  // The mutable Door-B-shaped neighbour leg 4 is about.
  await write(
    "teams/engineering/resources/scratch.md",
    "---\ndescription: Engineering scratchpad\nllmReadable: true\nllmWritable: true\n---\nseed"
  );
  return root;
}

afterAll(async () => {
  for (const root of roots) await fs.rm(root, { recursive: true, force: true });
});

const work = handler({
  name: "desk-work",
  requireOrg: true,
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async () => ({ ok: true })
});

/** Build the kind with a given slice of the app's documents installed on it. */
function kindWith(documents: DeclaredResources) {
  return defineFlow({
    kind: KIND,
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    resources: { ...documents } as DeclaredResources,
    actions: { run: { inputSchema: z.object({}), block: work } }
  });
}

/** A seat record as the loader produces one. No `resources:` key = no narrowing. */
function seat(id: string, declared: Record<string, unknown> = {}): WorkerManifest {
  return { id, declared: { flow: KIND, description: id, ...declared }, body: "" };
}

type Handle = {
  readContent(): Promise<string | null>;
  writeContent(body: string): Promise<void>;
};

async function ctxFor(flow: FlowInstance, stores = createInMemoryStores()) {
  const ctx = await createExecutionContext({
    flow,
    actionName: "run",
    requestId: `req_${flow.id}`,
    sessionId: `sess_${flow.id}`,
    userId: USER,
    orgId: ORG,
    stores
  });
  return { ctx, stores };
}

/**
 * The handle, or `undefined` when the seat cannot reach that ref at all.
 *
 * `ctx.resources.get` THROWS on an unregistered accessor rather than returning
 * nothing, so "unreachable" has to be caught to be asserted on. Catching it here,
 * once, is what lets every leg below say `toBeUndefined()` and mean *this seat
 * does not see that document*.
 */
const handleFor = (
  ctx: { resources: { get(k: string): unknown } },
  key: string
): Handle | undefined => {
  try {
    return ctx.resources.get(key) as Handle;
  } catch {
    return undefined;
  }
};

/**
 * The whole path in one call: disk -> loader -> L1 map -> (optional app filter)
 * -> kind -> hire -> a live seat.
 */
async function seatOn(
  root: string,
  installFilter: (ref: string) => boolean = () => true
): Promise<{ seat: FlowInstance; catalog: DeclaredResources }> {
  const read = await readResourcesDirectory(root);
  expect(read.errors).toEqual([]);
  const catalog = resourcesFromDocs(read.documents);
  const installed: DeclaredResources = {};
  for (const [ref, def] of Object.entries(catalog)) {
    if (installFilter(ref)) installed[ref] = def;
  }
  const hired = hireWorkforce([seat(ENG_SEAT)], {
    kinds: { [KIND]: kindWith(installed) as never },
    documents: catalog
  });
  return { seat: hired[0]!, catalog };
}

// --------------------------------------------------------------------------
// Leg 1 — the convention loads. (The body's claim C3.)
// --------------------------------------------------------------------------

describe("LEG 1 · loaders walk workforce/**/resources/ and mint tree-qualified refs", () => {
  it("GREEN — org, team and the refs the body names all load", async () => {
    const read = await readResourcesDirectory(await tree());
    expect(read.errors).toEqual([]);
    expect(read.documents.map((d) => d.ref).sort()).toEqual(
      [ENG_HANDBOOK, ENG_SCRATCH, ORG_HANDBOOK, SALES_HANDBOOK].sort()
    );
  });

  it("CHARACTERIZATION — every document is minted org-scoped; the tree is a NAME, not a scope", async () => {
    const read = await readResourcesDirectory(await tree());
    const catalog = resourcesFromDocs(read.documents);
    for (const def of Object.values(catalog)) {
      expect((def as { scope?: string }).scope).toBe("org");
    }
  });
});

// --------------------------------------------------------------------------
// Leg 2 — ambient inherit, and the cross-team wall.
// --------------------------------------------------------------------------

describe("LEG 2 · a seat with no grant list", () => {
  it("GREEN — reads the org handbook and its own team's, with no `resources:` key", async () => {
    const { seat: ada } = await seatOn(await tree());
    const { ctx } = await ctxFor(ada);
    await expect(handleFor(ctx, ORG_HANDBOOK)!.readContent()).resolves.toContain("ORG HANDBOOK");
    await expect(handleFor(ctx, ENG_HANDBOOK)!.readContent()).resolves.toContain(
      "ENGINEERING HANDBOOK"
    );
  });

  it("RED — and it reads ANOTHER TEAM'S handbook too. The spine says never cross-team", async () => {
    const { seat: ada } = await seatOn(await tree());
    const { ctx } = await ctxFor(ada);
    // The spine's promise, asserted straight. Fails on main.
    expect(handleFor(ctx, SALES_HANDBOOK)).toBeUndefined();
  });

  it("CONTROL (green) — same harness, one input changed: the APP filters the install", async () => {
    // The only difference from the red case above. Isolation exists today; it is
    // the app's hand-written filter at the call site, not anything the tree derives.
    const { seat: ada } = await seatOn(
      await tree(),
      (ref) => !ref.startsWith("teams/") || ref.startsWith("teams/engineering/")
    );
    const { ctx } = await ctxFor(ada);
    expect(handleFor(ctx, SALES_HANDBOOK)).toBeUndefined();
    await expect(handleFor(ctx, ENG_HANDBOOK)!.readContent()).resolves.toContain(
      "ENGINEERING HANDBOOK"
    );
  });
});

// --------------------------------------------------------------------------
// Leg 3 — "cannot write".
// --------------------------------------------------------------------------

describe("LEG 3 · the ungranted seat and the pen", () => {
  it("RED — it CAN overwrite the org handbook. `writable` defaults to true", async () => {
    const { seat: ada } = await seatOn(await tree());
    const { ctx } = await ctxFor(ada);
    // The spine's promise: an ungranted seat cannot write a reference.
    await expect(handleFor(ctx, ORG_HANDBOOK)!.writeContent("DEFACED")).rejects.toThrow(
      /read-only/i
    );
  });

  it("CONTROL (green) — same harness, one frontmatter key added: `writable: false`", async () => {
    const { seat: ada } = await seatOn(await tree({ sealOrgHandbook: true }));
    const { ctx } = await ctxFor(ada);
    await expect(handleFor(ctx, ORG_HANDBOOK)!.writeContent("DEFACED")).rejects.toThrow(
      /read-only/i
    );
  });

  it("RED — and the write STICKS: the disk body is a first-boot seed, not the source", async () => {
    const { seat: ada } = await seatOn(await tree());
    const { ctx, stores } = await ctxFor(ada);
    await handleFor(ctx, ORG_HANDBOOK)!.writeContent("DEFACED");
    // A fresh context over the same store — a later request, a later deploy.
    const again = await ctxFor(ada, stores);
    // The spine treats references/ as read-only docs ON DISK. If that were so,
    // the file's body would come back.
    await expect(handleFor(again.ctx, ORG_HANDBOOK)!.readContent()).resolves.toContain(
      "ORG HANDBOOK v1"
    );
  });
});

// --------------------------------------------------------------------------
// Leg 4 — a mutable neighbour still needs an explicit grant.
// --------------------------------------------------------------------------

/**
 * An earlier draft asserted the opposite of this — that an ungranted seat should
 * NOT reach a mutable resource — and called that "the spine's promise". It is
 * not. BUSINESS-RULES BR-14 and PLAN V4 say the reverse, deliberately: absent
 * `resources:` keeps today's mutable reachability, and FIX-1467 does not tighten
 * it. A grant is OPTIONAL NARROWING, not a precondition for reach.
 *
 * So this leg is a green characterization, not a red. An implementer chasing
 * "make leg 4 green" against the old wording would have broken W5 — and the
 * regression V4 exists to catch is exactly the one that wording invited.
 */
describe("LEG 4 · a mutable resource beside the references (BR-14 / PLAN V4)", () => {
  it("GREEN characterization — the ungranted seat DOES reach it, and must still after FIX-1467", async () => {
    const { seat: ada } = await seatOn(await tree());
    const { ctx } = await ctxFor(ada);
    // `hire.ts` narrows only when the seat DECLARES the key, so an absent key
    // yields the kind's whole map. BR-14 pins this as the regression that must
    // not happen; V4 is the check that holds it.
    await expect(handleFor(ctx, ENG_SCRATCH)!.readContent()).resolves.toContain("seed");
  });

  it("CONTROL (green) — #1943's narrowing still works when the seat DOES declare `resources:`", async () => {
    const read = await readResourcesDirectory(await tree());
    const catalog = resourcesFromDocs(read.documents);
    const hired = hireWorkforce([seat(ENG_SEAT, { resources: [ORG_HANDBOOK] })], {
      kinds: { [KIND]: kindWith(catalog) as never },
      documents: catalog
    });
    const { ctx } = await ctxFor(hired[0]!);
    expect(handleFor(ctx, ENG_SCRATCH)).toBeUndefined();
    await expect(handleFor(ctx, ORG_HANDBOOK)!.readContent()).resolves.toContain("ORG HANDBOOK");
  });
});

// --------------------------------------------------------------------------
// Leg 5 — CAN D1 BE BUILT ON TODAY'S CORE API?
//
// Review round 1 (Codex P1) says D1 is unimplementable in `workforce` alone:
// `DeclaredResourceEntry` admits only `DefinedResource | DefinedResourceCollection`
// (core/src/types/block.ts:984), and every `ResourceRef` declares `writeContent()`
// unconditionally (core/src/types/resource.ts:456). Both type facts are exactly
// as stated. But a type fact is not a behaviour, so this leg asks the runtime.
//
// D1 has two halves and they have different answers:
//   (a) BLOCKING WRITES — refusing the pen.
//   (b) READING FROM DISK — the file, not a stored row, being the source.
//
// The legs below establish each separately, against real `main`.
//
// The shape under test is the one S3 would produce with NO core change: the
// install half swaps `content: doc.body` for `contentFile: <path>` and adds
// `writable: false`. `contentFile` is already a DERIVED key
// (`manifest.ts:519-528`), so the install layer owns it. `writable` is NOT —
// it passes through from frontmatter today, which is the one gap S3 has to
// close with a references-specific derived set (BR-12). Not a core change.
// --------------------------------------------------------------------------

/** A `references/` candidate as S3 would install it today, with no core change. */
function referenceCandidate(ref: string, filePath: string, opts: { sealed?: boolean } = {}) {
  return defineResource({
    ref,
    scope: "org",
    stateSchema: z.object({}).passthrough(),
    default: {},
    contentFile: filePath,
    llmReadable: true,
    ...(opts.sealed === true ? { writable: false } : {})
  });
}

/** Hire a seat over a hand-built catalog, bypassing the markdown loader. */
async function seatOnCatalog(catalog: DeclaredResources, stores = createInMemoryStores()) {
  const hired = hireWorkforce([seat(ENG_SEAT)], {
    kinds: { [KIND]: kindWith(catalog) as never },
    documents: catalog
  });
  return await ctxFor(hired[0]!, stores);
}

describe("LEG 5 · which half of D1 today's core API can already express", () => {
  it("(a) EXPRESSIBLE — `writable: false` refuses the write, at the engine, by name", async () => {
    const root = await tree();
    const file = path.join(root, "org/resources/handbook.md");
    const { ctx } = await seatOnCatalog({
      [ORG_HANDBOOK]: referenceCandidate(ORG_HANDBOOK, file, { sealed: true })
    });
    // resource-registry.ts:1971 — `config.writable === false` throws
    // `resource_read_only`. A refusal MECHANISM exists today. What does NOT
    // exist is an absent verb: the handle still CARRIES `writeContent`, so this
    // is a runtime refusal, not the contract D1's wording asks for.
    const handle = handleFor(ctx, ORG_HANDBOOK)!;
    expect(typeof handle.writeContent).toBe("function");
    await expect(handle.writeContent("DEFACED")).rejects.toThrow(/read-only/i);
  });

  it("(b) EXPRESSIBLE PER CONTEXT — sealed + `contentFile` re-reads the edited file on restart", async () => {
    const root = await tree();
    const file = path.join(root, "org/resources/handbook.md");
    const catalog: DeclaredResources = {
      [ORG_HANDBOOK]: referenceCandidate(ORG_HANDBOOK, file, { sealed: true })
    };
    const stores = createInMemoryStores();

    const first = await seatOnCatalog(catalog, stores);
    await expect(handleFor(first.ctx, ORG_HANDBOOK)!.readContent()).resolves.toContain(
      "ORG HANDBOOK v1"
    );

    // Someone edits the file in git and redeploys.
    await fs.writeFile(file, "---\ndescription: The org handbook\n---\nORG HANDBOOK v2", "utf8");

    // A fresh context over the SAME stores — a later request, a later deploy.
    const again = await seatOnCatalog(catalog, stores);
    // GREEN. Because nothing could ever write a row for this key, the store has
    // none, and `normalizeScopeResourceContent` falls through to `contentFile`
    // and re-reads the file. BR-2 is satisfied with no core change — but ONLY
    // because (a) holds. (a) is load-bearing for (b); see the next leg.
    await expect(handleFor(again.ctx, ORG_HANDBOOK)!.readContent()).resolves.toContain(
      "ORG HANDBOOK v2"
    );
  });

  it("(b) DEPENDS ON (a) — UNsealed + `contentFile` loses the file forever after one write", async () => {
    const root = await tree();
    const file = path.join(root, "org/resources/handbook.md");
    const catalog: DeclaredResources = {
      // The ONE input changed from the leg above: no `writable: false`.
      [ORG_HANDBOOK]: referenceCandidate(ORG_HANDBOOK, file)
    };
    const stores = createInMemoryStores();

    const first = await seatOnCatalog(catalog, stores);
    await handleFor(first.ctx, ORG_HANDBOOK)!.writeContent("DEFACED");

    await fs.writeFile(file, "---\ndescription: The org handbook\n---\nORG HANDBOOK v2", "utf8");

    const again = await seatOnCatalog(catalog, stores);
    // resource-registry.ts:502 — a stored row WINS over `config.contentFile`,
    // exactly as it wins over `config.content`. So `contentFile` alone is not
    // D1: it is a first-boot seed with a longer name. This is the finding that
    // rules out cursor's "`contentFile` + load at hire" option on its own.
    await expect(handleFor(again.ctx, ORG_HANDBOOK)!.readContent()).resolves.toBe("DEFACED");
  });

  it("(b) THE MIGRATION HOLE — a row written BEFORE the seal shadows the file forever", async () => {
    const root = await tree();
    const file = path.join(root, "org/resources/handbook.md");
    const stores = createInMemoryStores();

    // Era 1: the document lives under `resources/`, and something writes it.
    const before = await seatOnCatalog(
      { [ORG_HANDBOOK]: referenceCandidate(ORG_HANDBOOK, file) },
      stores
    );
    await handleFor(before.ctx, ORG_HANDBOOK)!.writeContent("WRITTEN BEFORE THE MOVE");

    // Era 2: S7 moves the file into `references/`; it is now sealed.
    const after = await seatOnCatalog(
      { [ORG_HANDBOOK]: referenceCandidate(ORG_HANDBOOK, file, { sealed: true }) },
      stores
    );
    // The seal stops NEW writes, but it cannot evict the row that is already
    // there — and that row still wins at resource-registry.ts:502. So the
    // sealed-reference promise ("what is in git is what the agents read") does
    // NOT hold for a tree that has already been written to. This is S7's data
    // migration, and PLAN currently records it only as an open question.
    await expect(handleFor(after.ctx, ORG_HANDBOOK)!.readContent()).resolves.toBe(
      "WRITTEN BEFORE THE MOVE"
    );
  });

  it("(b) NOT EXPRESSIBLE LITERALLY — an edit mid-context is not seen; there is no per-read disk hook", async () => {
    const root = await tree();
    const file = path.join(root, "org/resources/handbook.md");
    const { ctx } = await seatOnCatalog({
      [ORG_HANDBOOK]: referenceCandidate(ORG_HANDBOOK, file, { sealed: true })
    });
    const handle = handleFor(ctx, ORG_HANDBOOK)!;
    await expect(handle.readContent()).resolves.toContain("ORG HANDBOOK v1");

    await fs.writeFile(file, "---\ndescription: The org handbook\n---\nORG HANDBOOK v2", "utf8");

    // `readContent()` reads `options.readResourceContent()[storageKey]` — the
    // in-memory map built once at context construction. The only read-time
    // content hooks core offers are `contentTemplate` / `contentTemplateRef`
    // (Liquid over state / another RESOURCE's body) and `render` (a transform
    // of the stored string). None of them reaches the filesystem. So D1's
    // literal "served from disk on EVERY read" needs a core contract change;
    // "fresh from disk on every execution context" does not.
    await expect(handle.readContent()).resolves.toContain("ORG HANDBOOK v1");
  });
});
