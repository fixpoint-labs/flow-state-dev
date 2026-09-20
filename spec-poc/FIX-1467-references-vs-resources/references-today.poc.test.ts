/**
 * FIX-1467 POC — what a Workforce `resources/*.md` document ACTUALLY does today.
 *
 * Throwaway. Lives on the never-merged spec branch, ships nowhere. It exists to
 * check the claims FIX-1467's body builds its direction on, against real `main`
 * code — the loader, `hireWorkforce`, and a real execution context — rather than
 * against the teaching.
 *
 * The five legs are the body's own POC spine, in its order. Each leg is written
 * as the spine's PROMISE, so a leg that fails is the spine naming work that does
 * not exist yet, rather than a broken harness.
 *
 * **The honest control.** The red legs are each paired with a control that runs
 * the SAME harness with exactly ONE input changed — the app's install filter
 * (leg 2), one frontmatter key (leg 3), the seat's own `resources:` key (leg 4).
 * The control goes green. That pair is what makes a red mean "the gap is real"
 * instead of "the check never reached the code": a harness that could not observe
 * the behaviour at all would be red in both halves.
 *
 * Run:
 *   pnpm --filter @flow-state-dev/workforce exec vitest run \
 *     ../../spec-poc/FIX-1467-references-vs-resources/references-today.poc.test.ts
 */
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { defineFlow, handler, type DeclaredResources } from "@flow-state-dev/core";
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
  const hired = hireWorkforce([seat("ada")], {
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

describe("LEG 4 · a mutable resource beside the references", () => {
  it("RED — the ungranted seat reaches it with no grant at all", async () => {
    const { seat: ada } = await seatOn(await tree());
    const { ctx } = await ctxFor(ada);
    // The spine's promise: mutable access is explicit. Absent-key narrows nothing,
    // so the same absence that grants ambient reads also hands over the pen.
    expect(handleFor(ctx, ENG_SCRATCH)).toBeUndefined();
  });

  it("CONTROL (green) — the seat DOES narrow once it declares `resources:`", async () => {
    const read = await readResourcesDirectory(await tree());
    const catalog = resourcesFromDocs(read.documents);
    const hired = hireWorkforce([seat("ada", { resources: [ORG_HANDBOOK] })], {
      kinds: { [KIND]: kindWith(catalog) as never },
      documents: catalog
    });
    const { ctx } = await ctxFor(hired[0]!);
    expect(handleFor(ctx, ENG_SCRATCH)).toBeUndefined();
    await expect(handleFor(ctx, ORG_HANDBOOK)!.readContent()).resolves.toContain("ORG HANDBOOK");
  });
});

// --------------------------------------------------------------------------
// Leg 5 — the bash mount.
// --------------------------------------------------------------------------

describe("LEG 5 · references on the agent FS", () => {
  it("RED — a document is a SINGLE resource, and bash mounts only collections", async () => {
    const read = await readResourcesDirectory(await tree());
    const catalog = resourcesFromDocs(read.documents);
    const orgHandbook = catalog[ORG_HANDBOOK] as { pattern?: unknown };
    // `discoverMounts` keeps an entry only when `isCollectionRef(value)`, which
    // reads `.pattern`. A single resource has none, so it is skipped: references
    // are on no mount at all today, RO or otherwise.
    expect(orgHandbook.pattern).toBeDefined();
  });
});
