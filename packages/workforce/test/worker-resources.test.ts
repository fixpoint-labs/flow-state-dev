/**
 * The worker resource allowlist — a `WORKER.md`'s `resources:` key, from the
 * words an author writes to what the worker can actually reach.
 *
 * `BR-n` and `V-n` are the issue's own rule and check numbers, kept so a
 * finding can be cited by one; each case states the rule it owns, so nothing
 * here needs a second document to read. Two of the checks carry most of the
 * weight and are worth naming up front, because a suite without them is green
 * for an implementation that has quietly broken every app in the monorepo:
 *
 * - **V5, the second path.** A worker that declares NO `resources:` must reach
 *   and write every document, exactly as before. That is the case nobody
 *   writes a test for, and the one a flipped default silently takes.
 * - **V7, the subtraction.** The `resources` option on a worker's flow copy REPLACES the
 *   definition's flow-level map, so a map built from the grants alone deletes
 *   the app's own boards and stores with nothing said. The pair runs both
 *   ways: the second construction is the red state, and it is what makes the
 *   first mean anything.
 *
 * Every refusal is asserted on the distinctive part of its own wording, so a
 * message that stops naming what actually went wrong fails its own case. The
 * wordings stay private to `worker-resources.ts`; a permission module does not
 * widen its surface for its tests. The key and the two modes are imported,
 * so renaming one moves its checks with it instead of leaving a door open.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineFlow,
  defineResource,
  handler,
  writeResourceContentTool,
  type DeclaredResources
} from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createExecutionContext, createInMemoryStores } from "@flow-state-dev/engine";
import { runForTest } from "@flow-state-dev/testing";
import { mintWorkers, type HireOptions } from "../src/hire";
import type { WorkerManifest } from "../src/manifest";
import {
  WORKER_RESOURCES_KEY,
  WORKER_RESOURCE_MODE_READ,
  WORKER_RESOURCE_MODE_WRITE,
  parseWorkerResources
} from "../src/worker-resources";
import { workerConfigSchema } from "../src/worker-config";
import { workerDoor } from "./worker-door";

const ORG = "org_fix1381";
const USER = "user_fix1381";

const HANDBOOK = "teams/engineering/handbook";
const PAYROLL = "finance/payroll";
const SEALED = "teams/engineering/sealed";

/** A document, the shape `resourcesFromDocs` produces: org-scoped, body as content. */
function document(ref: string, content: string, extra: Record<string, unknown> = {}) {
  return defineResource({
    ref,
    scope: "org",
    stateSchema: z.object({}).passthrough(),
    default: {},
    content,
    llmReadable: true,
    llmWritable: true,
    ...extra
  });
}

/** The app's declared documents — the catalog the app hands the hire step. */
const CATALOG: DeclaredResources = {
  [HANDBOOK]: document(HANDBOOK, "# Engineering handbook"),
  [PAYROLL]: document(PAYROLL, "# Payroll"),
  // Declares itself unwritable in its own frontmatter, which no grant may widen.
  [SEALED]: document(SEALED, "# Sealed", { writable: false, llmWritable: false })
} as DeclaredResources;

/** NOT a document: an app-level store declared at flow level beside them. */
const auditLog = defineResource({
  ref: "audit-log",
  scope: "org",
  stateSchema: z.object({ entries: z.array(z.string()).default([]) }),
  default: { entries: [] },
  writable: true
});

/** A resource the WORKER FLOW's own block declares — its machinery, under an accessor key. */
const workerInbox = defineResource({
  ref: "worker-inbox",
  scope: "org",
  stateSchema: z.object({ notes: z.array(z.string()).default([]) }),
  default: { notes: [] },
  writable: true
});

const work = handler({
  name: "desk-work",
  resources: { inbox: workerInbox },
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async () => ({ ok: true })
});

const DESK_FLOW = "desk";

/**
 * The realistic worker flow: every document AND the app's own store in one flow-level
 * map, plus a block that declares its own `inbox`. A fixture whose flow-level
 * map held only documents is what let the spec's first four premises pass
 * while the approach was wrong.
 */
const deskFlow = defineFlow({
  kind: DESK_FLOW,
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  resources: { ...CATALOG, "audit-log": auditLog } as DeclaredResources,
  actions: { ...workerDoor, run: { inputSchema: z.object({}), block: work } }
});

const COLLIDING_FLOW = "colliding-desk";

/**
 * The worker flow BR-8 is about: a block that names its own resource with a string
 * that is also a document's ref, on a worker flow that does not declare that document
 * at flow level. Nothing is wrong with it until a worker grants that ref.
 */
const collidingFlow = defineFlow({
  kind: COLLIDING_FLOW,
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  // Payroll IS installed here, so the control below grants something this worker flow
  // holds; the handbook is not, and the block has taken its name.
  resources: { [PAYROLL]: CATALOG[PAYROLL]!, "audit-log": auditLog } as DeclaredResources,
  actions: {
    ...workerDoor,
    run: {
      inputSchema: z.object({}),
      block: handler({
        name: "colliding-work",
        resources: { [HANDBOOK]: workerInbox },
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: async () => ({ ok: true })
      })
    }
  }
});

/** A worker record, as the loader produces one. `declared` is frontmatter verbatim. */
function worker(id: string, declared: Record<string, unknown> = {}): WorkerManifest {
  return { id, declared: { flow: DESK_FLOW, description: id, ...declared }, body: "" };
}

function hire(manifests: WorkerManifest[], options: Partial<HireOptions> = {}): FlowInstance[] {
  return mintWorkers(manifests, {
    workerFlows: { [DESK_FLOW]: deskFlow as never },
    documents: CATALOG,
    ...options
  });
}

function byId(workers: FlowInstance[], id: string): FlowInstance {
  const found = workers.find((s) => s.id === id);
  if (found === undefined) throw new Error(`no worker "${id}" in ${workers.map((s) => s.id).join(", ")}`);
  return found;
}

async function contextFor(flow: FlowInstance, sessionId: string) {
  return createExecutionContext({
    flow,
    actionName: "respond",
    requestId: `req_${sessionId}`,
    sessionId,
    userId: USER,
    orgId: ORG,
    stores: createInMemoryStores()
  });
}

/** A resource handle as a block holds it. */
type Handle = {
  uri: string;
  readContent(): Promise<string | null>;
  setState(next: Record<string, unknown>): Promise<void>;
  writeContent(body: string): Promise<void>;
};

const handleFor = (ctx: Awaited<ReturnType<typeof contextFor>>, key: string): Handle =>
  ctx.resources.get(key) as unknown as Handle;

describe("V1 · a worker's `resources:` parses into grants", () => {
  it("a bare ref is read-only, and `rw` is the extra word that grants writes (BR-1, BR-2)", () => {
    const parsed = parseWorkerResources([HANDBOOK, { [PAYROLL]: WORKER_RESOURCE_MODE_WRITE }]);

    expect(parsed.problems).toEqual([]);
    expect(parsed.grants).toEqual([
      { ref: HANDBOOK, mode: WORKER_RESOURCE_MODE_READ },
      { ref: PAYROLL, mode: WORKER_RESOURCE_MODE_WRITE }
    ]);
  });

  it("explicit `ro` is sugar for the bare ref and carries no separate meaning", () => {
    expect(parseWorkerResources([{ [HANDBOOK]: WORKER_RESOURCE_MODE_READ }]).grants).toEqual(
      parseWorkerResources([HANDBOOK]).grants
    );
  });

  it("a mode that is neither refuses, naming both valid ones (BR-6)", () => {
    const parsed = parseWorkerResources([{ [HANDBOOK]: "write" }]);

    expect(parsed.grants).toBeUndefined();
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0]).toContain(`"${HANDBOOK}"`);
    expect(parsed.problems[0]).toContain(`\`${WORKER_RESOURCE_MODE_READ}\``);
    expect(parsed.problems[0]).toContain(`\`${WORKER_RESOURCE_MODE_WRITE}\``);
  });

  it("present-and-empty parses to zero grants, not to a problem (BR-5)", () => {
    expect(parseWorkerResources([])).toEqual({ grants: [], problems: [] });
  });

  it("a declaration that is not a list refuses, rather than being read as one entry", () => {
    // The near miss an author writes: a mapping instead of a list.
    const parsed = parseWorkerResources({ [HANDBOOK]: WORKER_RESOURCE_MODE_READ });

    expect(parsed.grants).toBeUndefined();
    expect(parsed.problems[0]).toContain(`\`${WORKER_RESOURCES_KEY}:\``);
    expect(parsed.problems[0]).toContain("LIST");
  });

  it("absent and present-and-empty are different answers at the worker factory (BR-4, BR-5)", async () => {
    const workers = hire([worker("eng.open"), worker("eng.locked", { [WORKER_RESOURCES_KEY]: [] })]);

    const open = await contextFor(byId(workers, "eng.open"), "sess_v1_open");
    const locked = await contextFor(byId(workers, "eng.locked"), "sess_v1_locked");

    expect(open.resources.get(HANDBOOK)).toBeDefined();
    expect(() => locked.resources.get(HANDBOOK)).toThrow(/not registered/i);
  });
});

describe("V2 · a bad grant refuses the whole roster, and every one is named", () => {
  it("a ref no document matches refuses, naming the worker and the ref (BR-9)", () => {
    expect(() => hire([worker("eng.lead", { [WORKER_RESOURCES_KEY]: ["teams/engineering/hanbdook"] })]))
      .toThrow(/eng\.lead[\s\S]*teams\/engineering\/hanbdook/);
  });

  it("the same ref twice refuses, whatever the modes (BR-10, BR-11)", () => {
    expect(() =>
      hire([worker("eng.lead", { [WORKER_RESOURCES_KEY]: [HANDBOOK, HANDBOOK] })])
    ).toThrow(/2 times/);

    // With DIFFERENT modes the message carries both, so the author sees the
    // conflict rather than only the repetition.
    let message = "";
    try {
      hire([
        worker("eng.lead", {
          [WORKER_RESOURCES_KEY]: [HANDBOOK, { [HANDBOOK]: WORKER_RESOURCE_MODE_WRITE }]
        })
      ]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(`\`${WORKER_RESOURCE_MODE_READ}\``);
    expect(message).toContain(`\`${WORKER_RESOURCE_MODE_WRITE}\``);
  });

  it("every bad grant across the roster is named in ONE message, not just the first", () => {
    let message = "";
    try {
      hire([
        worker("eng.lead", { [WORKER_RESOURCES_KEY]: ["no/such/doc"] }),
        worker("eng.intake", { [WORKER_RESOURCES_KEY]: [{ [PAYROLL]: "write" }] }),
        worker("finance.cfo", { [WORKER_RESOURCES_KEY]: [PAYROLL, PAYROLL] })
      ]);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("no/such/doc");
    expect(message).toContain("eng.intake");
    expect(message).toContain("finance.cfo");
    expect(message).toMatch(/refused 3 of 3 workers/);
  });

  it("nothing is hired when one worker's grant is bad — a partial hire is not a refusal", () => {
    expect(() =>
      hire([worker("eng.good", { [WORKER_RESOURCES_KEY]: [HANDBOOK] }), worker("eng.bad", { [WORKER_RESOURCES_KEY]: ["nope"] })])
    ).toThrow(/nothing was hired/);
  });
});

describe("V3 · a granted worker reaches what it named and nothing else (BR-3)", () => {
  it("the document it did not name is gone from get() AND from property access", async () => {
    const workers = hire([worker("eng.lead", { [WORKER_RESOURCES_KEY]: [HANDBOOK] })]);
    const ctx = await contextFor(byId(workers, "eng.lead"), "sess_v3");

    expect(ctx.resources.get(HANDBOOK)).toBeDefined();
    expect(() => ctx.resources.get(PAYROLL)).toThrow(/not registered/i);
    // The flat registry spreads its handles, so `get()` is not the only door —
    // a gate that covered only it would be theatre.
    expect((ctx.resources as unknown as Record<string, unknown>)[PAYROLL]).toBeUndefined();
  });

  it("two workers on ONE worker flow carry different maps — the flow is built once", async () => {
    const workers = hire([
      worker("eng.lead", { [WORKER_RESOURCES_KEY]: [HANDBOOK] }),
      worker("finance.cfo", { [WORKER_RESOURCES_KEY]: [PAYROLL] })
    ]);

    const lead = await contextFor(byId(workers, "eng.lead"), "sess_v3_lead");
    const cfo = await contextFor(byId(workers, "finance.cfo"), "sess_v3_cfo");

    expect(() => lead.resources.get(PAYROLL)).toThrow(/not registered/i);
    expect(() => cfo.resources.get(HANDBOOK)).toThrow(/not registered/i);
  });
});

describe("V4 · `ro` closes both write doors, and `rw` leaves them open", () => {
  it("a ro grant reads, and refuses a state write and a content write (BR-1, BR-13)", async () => {
    const workers = hire([worker("eng.lead", { [WORKER_RESOURCES_KEY]: [HANDBOOK] })]);
    const ctx = await contextFor(byId(workers, "eng.lead"), "sess_v4_ro");
    const handbook = handleFor(ctx, HANDBOOK);

    await expect(handbook.readContent()).resolves.toContain("Engineering handbook");
    await expect(handbook.setState({ tampered: true })).rejects.toThrow(/read-only/i);
    await expect(handbook.writeContent("rewritten")).rejects.toThrow(/read-only/i);
  });

  it("the model's own write tool is closed on a ro grant and open on rw (BR-14)", async () => {
    const workers = hire([
      worker("eng.lead", { [WORKER_RESOURCES_KEY]: [HANDBOOK] }),
      worker("finance.cfo", { [WORKER_RESOURCES_KEY]: [{ [PAYROLL]: WORKER_RESOURCE_MODE_WRITE }] })
    ]);
    const writeTool = writeResourceContentTool();

    const leadCtx = await contextFor(byId(workers, "eng.lead"), "sess_v4_tool_ro");
    const leadUri = handleFor(leadCtx, HANDBOOK).uri;
    await expect(
      runForTest(writeTool, { uri: leadUri, content: "rewritten by the model" }, leadCtx as never)
    ).rejects.toThrow(/Writable resource not found/);

    // The control: the SAME tool, on a worker that asked for `rw`, writes. Without
    // it the refusal above is equally consistent with the tool being broken.
    const cfoCtx = await contextFor(byId(workers, "finance.cfo"), "sess_v4_tool_rw");
    const cfoUri = handleFor(cfoCtx, PAYROLL).uri;
    await expect(
      runForTest(writeTool, { uri: cfoUri, content: "rewritten by the model" }, cfoCtx as never)
    ).resolves.toMatchObject({ ok: true });
  });

  it("the same document granted rw still writes — ro is the grant, not the document (BR-2)", async () => {
    const workers = hire([
      worker("eng.lead", { [WORKER_RESOURCES_KEY]: [{ [HANDBOOK]: WORKER_RESOURCE_MODE_WRITE }] })
    ]);
    const ctx = await contextFor(byId(workers, "eng.lead"), "sess_v4_rw");

    await expect(handleFor(ctx, HANDBOOK).setState({ tampered: true })).resolves.toBeUndefined();
  });
});

describe("V5 · the second path — a worker that declares nothing is untouched (BR-4, D1)", () => {
  it("reaches AND writes every declared document, exactly as before this existed", async () => {
    const workers = hire([worker("eng.unrestricted")]);
    const ctx = await contextFor(byId(workers, "eng.unrestricted"), "sess_v5");

    for (const ref of [HANDBOOK, PAYROLL]) {
      expect(ctx.resources.get(ref)).toBeDefined();
      await expect(handleFor(ctx, ref).setState({ touched: true })).resolves.toBeUndefined();
    }
    // The app's own store too, and the worker flow's block resource.
    expect(ctx.resources.get("audit-log")).toBeDefined();
    expect(ctx.resources.get("inbox")).toBeDefined();
  });

  it("is minted with NO resource map at all — not an empty one, not a rebuilt one", () => {
    const [unrestricted] = hire([worker("eng.unrestricted")]);
    const [restricted] = hire([worker("eng.lead", { [WORKER_RESOURCES_KEY]: [HANDBOOK] })]);

    // Passing a map REPLACES the worker flow's, so the untouched worker must carry the
    // worker flow's own flow-level key set, byte for byte.
    expect([...unrestricted!.flowLevelResourceKeys].sort()).toEqual(
      [...deskFlow.flowLevelResourceKeys].sort()
    );
    expect([...restricted!.flowLevelResourceKeys].sort()).not.toEqual(
      [...deskFlow.flowLevelResourceKeys].sort()
    );
  });

  it("hires with no `documents` passed at all, the way every caller before this did", () => {
    const workers = mintWorkers([worker("eng.unrestricted")], { workerFlows: { [DESK_FLOW]: deskFlow as never } });

    expect(workers).toHaveLength(1);
    expect([...workers[0]!.flowLevelResourceKeys].sort()).toEqual(
      [...deskFlow.flowLevelResourceKeys].sort()
    );
  });
});

describe("V6 · the worker flow's own machinery is never what a grant governs (BR-7, BR-8)", () => {
  it("a block's resource is reachable and writable on the narrowest worker there is (BR-7)", async () => {
    const workers = hire([worker("eng.intern", { [WORKER_RESOURCES_KEY]: [] })]);
    const ctx = await contextFor(byId(workers, "eng.intern"), "sess_v6_control");

    expect(() => ctx.resources.get(HANDBOOK)).toThrow(/not registered/i);
    // Under its ACCESSOR key, which is what the block's own map named it.
    expect(ctx.resources.get("inbox")).toBeDefined();
    await expect(
      handleFor(ctx, "inbox").setState({ notes: ["still reachable"] })
    ).resolves.toBeUndefined();
  });

  it("a grant that COLLIDES with a block's accessor refuses, naming the worker and the worker flow (BR-8)", () => {
    // Constructed rather than trusted absent, and constructed where the hazard
    // actually lives: the worker flow's BLOCK names the accessor and the flow itself
    // does NOT declare that document at flow level. Honouring the grant would
    // install the document at flow level over the block's own resource — a worker
    // file repointing its worker flow's wiring.
    expect(() =>
      mintWorkers(
        [
          {
            id: "eng.lead",
            declared: { flow: COLLIDING_FLOW, description: "d", [WORKER_RESOURCES_KEY]: [HANDBOOK] },
            body: ""
          }
        ],
        { workerFlows: { [COLLIDING_FLOW]: collidingFlow as never }, documents: CATALOG }
      )
    ).toThrow(new RegExp(`eng\\.lead[\\s\\S]*${COLLIDING_FLOW}`));
  });

  it("the same worker flow hires a worker whose grant does NOT collide, and keeps the block's resource", async () => {
    // The control. Without it the refusal above is equally consistent with this
    // worker flow being unhireable for some reason that has nothing to do with the ref.
    const workers = mintWorkers(
      [
        {
          id: "eng.lead",
          declared: { flow: COLLIDING_FLOW, description: "d", [WORKER_RESOURCES_KEY]: [PAYROLL] },
          body: ""
        }
      ],
      { workerFlows: { [COLLIDING_FLOW]: collidingFlow as never }, documents: CATALOG }
    );
    const ctx = await contextFor(byId(workers, "eng.lead"), "sess_v6_control_ok");

    expect(ctx.resources.get(PAYROLL)).toBeDefined();
    // The block's own declaration, under the accessor it chose, untouched.
    expect(ctx.resources.get(HANDBOOK)).toBeDefined();
    await expect(
      handleFor(ctx, HANDBOOK).setState({ notes: ["the worker flow's own, not the document"] })
    ).resolves.toBeUndefined();
  });
});

describe("V7 · the narrowing is a subtraction, not a rebuild (BR-15)", () => {
  it("a flow-level resource that is NOT a document survives a narrowing grant", async () => {
    const workers = hire([worker("eng.lead", { [WORKER_RESOURCES_KEY]: [HANDBOOK] })]);
    const ctx = await contextFor(byId(workers, "eng.lead"), "sess_v7_kept");

    expect(ctx.resources.get(HANDBOOK)).toBeDefined();
    expect(() => ctx.resources.get(PAYROLL)).toThrow(/not registered/i);
    // The app's own store: no worker file mentioned it, no grant excluded it.
    expect(ctx.resources.get("audit-log")).toBeDefined();
    await expect(
      handleFor(ctx, "audit-log").setState({ entries: ["still writable"] })
    ).resolves.toBeUndefined();
  });

  it("the RED state: a documents-only map drops it, which is what the check above catches", async () => {
    // The construction the plan's sketch originally described — mint with the
    // granted documents and nothing else. Run here so the assertion above is
    // known to be sensitive to the thing it claims to check.
    const documentsOnly = deskFlow({
      id: "eng.lead",
      config: { workerSkills: [], workerTools: [] },
      resources: { [HANDBOOK]: CATALOG[HANDBOOK]! } as DeclaredResources
    });
    const ctx = await contextFor(documentsOnly as FlowInstance, "sess_v7_red");

    expect(ctx.resources.get(HANDBOOK)).toBeDefined();
    expect(() => ctx.resources.get("audit-log")).toThrow(/not registered/i);
  });
});

describe("V8 · a grant never widens, and never resolves against nothing", () => {
  it("`rw` on a document that declared itself unwritable refuses at the hire (BR-16)", () => {
    expect(() =>
      hire([worker("eng.lead", { [WORKER_RESOURCES_KEY]: [{ [SEALED]: WORKER_RESOURCE_MODE_WRITE }] })])
    ).toThrow(/writable: false/);
  });

  it("the same sealed document taken read-only hires, and still refuses a write", async () => {
    const workers = hire([worker("eng.lead", { [WORKER_RESOURCES_KEY]: [SEALED] })]);
    const ctx = await contextFor(byId(workers, "eng.lead"), "sess_v8_sealed");

    await expect(handleFor(ctx, SEALED).readContent()).resolves.toContain("Sealed");
    await expect(handleFor(ctx, SEALED).setState({ tampered: true })).rejects.toThrow(/read-only/i);
  });

  it("a document the app declared but did NOT install on this worker flow refuses, not widens", () => {
    // The app's documented way to give a team only its own documents is to
    // filter before installing. A grant that reached past that filter would let
    // a worker file widen itself past its own worker flow — the one direction a grant
    // may never move.
    const filteredFlow = defineFlow({
      kind: "filtered-desk",
      cardinality: "collection",
      configSchema: workerConfigSchema(),
      // Only the handbook. Payroll is in the catalog and not on this worker flow.
      resources: { [HANDBOOK]: CATALOG[HANDBOOK]!, "audit-log": auditLog } as DeclaredResources,
      actions: { ...workerDoor, run: { inputSchema: z.object({}), block: work } }
    });
    const hireFiltered = (refs: unknown) =>
      mintWorkers(
        [{ id: "eng.lead", declared: { flow: "filtered-desk", description: "d", [WORKER_RESOURCES_KEY]: refs }, body: "" }],
        { workerFlows: { "filtered-desk": filteredFlow as never }, documents: CATALOG }
      );

    expect(() => hireFiltered([PAYROLL])).toThrow(/did not install on the `filtered-desk` worker flow/);
    // The control: the document the worker flow DOES hold still grants, so the refusal
    // above is about the filter and not about this worker flow being unhireable.
    expect(hireFiltered([HANDBOOK])).toHaveLength(1);
  });

  it("a worker declaring `resources:` with no documents supplied refuses, naming what is missing (BR-18)", () => {
    expect(() =>
      mintWorkers([worker("eng.lead", { [WORKER_RESOURCES_KEY]: [HANDBOOK] })], {
        workerFlows: { [DESK_FLOW]: deskFlow as never }
      })
    ).toThrow(/no documents to resolve it against/);
  });
});

describe("the grant is the factory's to read, never a setting the worker flow receives", () => {
  it("`resources:` does not reach the worker flow's config bag", () => {
    const [lead] = hire([worker("eng.lead", { [WORKER_RESOURCES_KEY]: [HANDBOOK] })]);

    expect(Object.hasOwn(lead!.config as object, WORKER_RESOURCES_KEY)).toBe(false);
  });
});

describe("V9 · the narrowing is checked on the worker that was BUILT", () => {
  /**
   * The worker flow whose block ALSO declares a document the flow itself declares at flow
   * level, with the same reference. Nothing distinguishes it from a worker flow no
   * block mentions until a worker narrows: the block's declaration merges back
   * the moment a worker's map replaces the flow-level one.
   */
  const restoringFlow = defineFlow({
    kind: "restoring-desk",
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    resources: { ...CATALOG, "audit-log": auditLog } as DeclaredResources,
    actions: { ...workerDoor,
      run: {
        inputSchema: z.object({}),
        block: handler({
          name: "restoring-work",
          // The same document, declared again by the block.
          resources: { [HANDBOOK]: CATALOG[HANDBOOK]! },
          inputSchema: z.object({}),
          outputSchema: z.object({ ok: z.boolean() }),
          execute: async () => ({ ok: true })
        })
      }
    }
  });

  const hireRestoring = (refs: unknown) =>
    mintWorkers(
      [{ id: "eng.lead", declared: { flow: "restoring-desk", description: "d", [WORKER_RESOURCES_KEY]: refs }, body: "" }],
      { workerFlows: { "restoring-desk": restoringFlow as never }, documents: CATALOG }
    );

  it("a document a block re-declares does not come back for a worker that was denied it", () => {
    // Denying everything is the sharpest form: the worker's own file says NO
    // documents, and without this check it reads and writes the handbook
    // anyway. The refusal must name the ref and the worker flow, so an operator knows
    // which block to look at.
    expect(() => hireRestoring([])).toThrow(/eng\.lead[\s\S]*teams\/engineering\/handbook/);
    expect(() => hireRestoring([])).toThrow(/reaches that document anyway/);
  });

  it("granting the document the block re-declares hires, so the refusal is about the denial", () => {
    // The control. Without it the refusal above is equally consistent with this
    // worker flow being unhireable for a reason that has nothing to do with narrowing.
    expect(hireRestoring([{ [HANDBOOK]: WORKER_RESOURCE_MODE_WRITE }, PAYROLL, SEALED])).toHaveLength(1);
  });

  it("a `ro` grant refuses the hire rather than leave the block a writable pen", () => {
    // The other half of the same worker flow, and the reason the check above only
    // looks at denials: a granted document is installed at flow level as the
    // read-only copy, which is a different definition from the writable one the
    // block declares. `defineFlow` refuses a flow-level entry that would swap a
    // block's resource, so the worker is never minted — neither narrowed under
    // the block's feet nor left writable. The `rw` control above hires.
    expect(() => hireRestoring([HANDBOOK, PAYROLL, SEALED])).toThrow(
      /eng\.lead[\s\S]*Resource conflict in flow "restoring-desk": "teams\/engineering\/handbook"/
    );
  });

  it("an alias for a document is narrowed with it, not left behind as a second door", async () => {
    // A map is an object, so an app can expose one definition under a second
    // key. Matching document names alone leaves the alias on the worker's map —
    // a writable handle on a document the worker was denied, under another name.
    const aliasedFlow = defineFlow({
      kind: "aliased-desk",
      cardinality: "collection",
      configSchema: workerConfigSchema(),
      resources: {
        ...CATALOG,
        handbookAlias: CATALOG[HANDBOOK]!,
        "audit-log": auditLog
      } as DeclaredResources,
      actions: { ...workerDoor, run: { inputSchema: z.object({}), block: work } }
    });

    const [lead] = mintWorkers(
      [{ id: "eng.lead", declared: { flow: "aliased-desk", description: "d", [WORKER_RESOURCES_KEY]: [] }, body: "" }],
      { workerFlows: { "aliased-desk": aliasedFlow as never }, documents: CATALOG }
    );

    const ctx = await contextFor(lead!, "sess_alias");
    expect(() => ctx.resources.get("handbookAlias")).toThrow(/not registered/i);
    // The app's own store, which no alias and no grant governs, is untouched.
    await expect(handleFor(ctx, "audit-log").setState({ entries: ["ok"] })).resolves.toBeUndefined();
  });
});

describe("a document's ref must hold that document on the worker flow", () => {
  it("a worker flow declaring something else under a document's ref refuses rather than narrowing it", () => {
    // Without this the subtraction reads the store as a document and deletes
    // it, and a `ro` grant on that ref would make the worker flow's own store
    // read-only — the one thing a worker's list promises never to touch.
    const impostorFlow = defineFlow({
      kind: "impostor-desk",
      cardinality: "collection",
      configSchema: workerConfigSchema(),
      // `PAYROLL` is a document's ref, and what sits there is the app's store.
      resources: { [HANDBOOK]: CATALOG[HANDBOOK]!, [PAYROLL]: auditLog } as DeclaredResources,
      actions: { ...workerDoor, run: { inputSchema: z.object({}), block: work } }
    });
    const hireImpostor = (refs: unknown) =>
      mintWorkers(
        [{ id: "eng.lead", declared: { flow: "impostor-desk", description: "d", [WORKER_RESOURCES_KEY]: refs }, body: "" }],
        { workerFlows: { "impostor-desk": impostorFlow as never }, documents: CATALOG }
      );

    // Even the empty list, because the subtraction is what would drop the store.
    expect(() => hireImpostor([])).toThrow(new RegExp(`${PAYROLL}[\\s\\S]*not the document`));
    expect(() => hireImpostor([HANDBOOK])).toThrow(/not the document/);
  });

  it("the same worker flow with the document actually installed there hires", async () => {
    // The control: only the impostor entry refuses, not this worker flow's shape.
    const honestFlow = defineFlow({
      kind: "honest-desk",
      cardinality: "collection",
      configSchema: workerConfigSchema(),
      resources: { [HANDBOOK]: CATALOG[HANDBOOK]!, [PAYROLL]: CATALOG[PAYROLL]!, "audit-log": auditLog } as DeclaredResources,
      actions: { ...workerDoor, run: { inputSchema: z.object({}), block: work } }
    });
    const [lead] = mintWorkers(
      [{ id: "eng.lead", declared: { flow: "honest-desk", description: "d", [WORKER_RESOURCES_KEY]: [HANDBOOK] }, body: "" }],
      { workerFlows: { "honest-desk": honestFlow as never }, documents: CATALOG }
    );

    const ctx = await contextFor(lead!, "sess_honest");
    expect(() => ctx.resources.get(PAYROLL)).toThrow(/not registered/i);
    await expect(handleFor(ctx, "audit-log").setState({ entries: ["kept"] })).resolves.toBeUndefined();
  });
});

describe("a refusal counts workers, not reasons", () => {
  it("one worker with two bad grants is one refused worker", () => {
    // `refused 2 of 1 worker` is not a sentence this function may print.
    expect(() =>
      hire([worker("eng.lead", { [WORKER_RESOURCES_KEY]: ["no/such/doc", "also/missing"] })])
    ).toThrow(/refused 1 of 1 worker;/);
  });
});
