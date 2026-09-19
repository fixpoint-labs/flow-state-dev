/**
 * The seat resource allowlist — a `WORKER.md`'s `resources:` key, from the
 * words an author writes to what the seat can actually reach.
 *
 * `BR-n` and `V-n` are the issue's own rule and check numbers, kept so a
 * finding can be cited by one; each case states the rule it owns, so nothing
 * here needs a second document to read. Two of the checks carry most of the
 * weight and are worth naming up front, because a suite without them is green
 * for an implementation that has quietly broken every app in the monorepo:
 *
 * - **V5, the second path.** A seat that declares NO `resources:` must reach
 *   and write every document, exactly as before. That is the case nobody
 *   writes a test for, and the one a flipped default silently takes.
 * - **V7, the subtraction.** A flow instance's `resources` option REPLACES the
 *   definition's flow-level map, so a map built from the grants alone deletes
 *   the app's own boards and stores with nothing said. The pair runs both
 *   ways: the second construction is the red state, and it is what makes the
 *   first mean anything.
 *
 * Every refusal is asserted on the distinctive part of its own wording, so a
 * message that stops naming what actually went wrong fails its own case. The
 * wordings stay private to `seat-resources.ts`; a permission module does not
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
import { hireWorkforce, type HireOptions } from "../src/hire";
import type { WorkerManifest } from "../src/manifest";
import {
  SEAT_RESOURCES_KEY,
  SEAT_RESOURCE_MODE_READ,
  SEAT_RESOURCE_MODE_WRITE,
  parseSeatResources
} from "../src/seat-resources";
import { workerConfigSchema } from "../src/worker-config";

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

/** A resource the KIND's own block declares — its machinery, under an accessor key. */
const seatInbox = defineResource({
  ref: "seat-inbox",
  scope: "org",
  stateSchema: z.object({ notes: z.array(z.string()).default([]) }),
  default: { notes: [] },
  writable: true
});

const work = handler({
  name: "desk-work",
  resources: { inbox: seatInbox },
  requireOrg: true,
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async () => ({ ok: true })
});

const DESK_KIND = "desk";

/**
 * The realistic kind: every document AND the app's own store in one flow-level
 * map, plus a block that declares its own `inbox`. A fixture whose flow-level
 * map held only documents is what let the spec's first four premises pass
 * while the approach was wrong.
 */
const deskFlow = defineFlow({
  kind: DESK_KIND,
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  resources: { ...CATALOG, "audit-log": auditLog } as DeclaredResources,
  actions: { run: { inputSchema: z.object({}), block: work } }
});

const COLLIDING_KIND = "colliding-desk";

/**
 * The kind BR-8 is about: a block that names its own resource with a string
 * that is also a document's ref, on a kind that does not declare that document
 * at flow level. Nothing is wrong with it until a seat grants that ref.
 */
const collidingFlow = defineFlow({
  kind: COLLIDING_KIND,
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  // Payroll IS installed here, so the control below grants something this kind
  // holds; the handbook is not, and the block has taken its name.
  resources: { [PAYROLL]: CATALOG[PAYROLL]!, "audit-log": auditLog } as DeclaredResources,
  actions: {
    run: {
      inputSchema: z.object({}),
      block: handler({
        name: "colliding-work",
        resources: { [HANDBOOK]: seatInbox },
        requireOrg: true,
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: async () => ({ ok: true })
      })
    }
  }
});

/** A seat record, as the loader produces one. `declared` is frontmatter verbatim. */
function seat(id: string, declared: Record<string, unknown> = {}): WorkerManifest {
  return { id, declared: { flow: DESK_KIND, description: id, ...declared }, body: "" };
}

function hire(manifests: WorkerManifest[], options: Partial<HireOptions> = {}): FlowInstance[] {
  return hireWorkforce(manifests, {
    kinds: { [DESK_KIND]: deskFlow as never },
    documents: CATALOG,
    ...options
  });
}

function byId(seats: FlowInstance[], id: string): FlowInstance {
  const found = seats.find((s) => s.id === id);
  if (found === undefined) throw new Error(`no seat "${id}" in ${seats.map((s) => s.id).join(", ")}`);
  return found;
}

async function contextFor(flow: FlowInstance, sessionId: string) {
  return createExecutionContext({
    flow,
    actionName: "run",
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

describe("V1 · a seat's `resources:` parses into grants", () => {
  it("a bare ref is read-only, and `rw` is the extra word that grants writes (BR-1, BR-2)", () => {
    const parsed = parseSeatResources([HANDBOOK, { [PAYROLL]: SEAT_RESOURCE_MODE_WRITE }]);

    expect(parsed.problems).toEqual([]);
    expect(parsed.grants).toEqual([
      { ref: HANDBOOK, mode: SEAT_RESOURCE_MODE_READ },
      { ref: PAYROLL, mode: SEAT_RESOURCE_MODE_WRITE }
    ]);
  });

  it("explicit `ro` is sugar for the bare ref and carries no separate meaning", () => {
    expect(parseSeatResources([{ [HANDBOOK]: SEAT_RESOURCE_MODE_READ }]).grants).toEqual(
      parseSeatResources([HANDBOOK]).grants
    );
  });

  it("a mode that is neither refuses, naming both valid ones (BR-6)", () => {
    const parsed = parseSeatResources([{ [HANDBOOK]: "write" }]);

    expect(parsed.grants).toBeUndefined();
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0]).toContain(`"${HANDBOOK}"`);
    expect(parsed.problems[0]).toContain(`\`${SEAT_RESOURCE_MODE_READ}\``);
    expect(parsed.problems[0]).toContain(`\`${SEAT_RESOURCE_MODE_WRITE}\``);
  });

  it("present-and-empty parses to zero grants, not to a problem (BR-5)", () => {
    expect(parseSeatResources([])).toEqual({ grants: [], problems: [] });
  });

  it("a declaration that is not a list refuses, rather than being read as one entry", () => {
    // The near miss an author writes: a mapping instead of a list.
    const parsed = parseSeatResources({ [HANDBOOK]: SEAT_RESOURCE_MODE_READ });

    expect(parsed.grants).toBeUndefined();
    expect(parsed.problems[0]).toContain(`\`${SEAT_RESOURCES_KEY}:\``);
    expect(parsed.problems[0]).toContain("LIST");
  });

  it("absent and present-and-empty are different answers at the seat factory (BR-4, BR-5)", async () => {
    const seats = hire([seat("eng.open"), seat("eng.locked", { [SEAT_RESOURCES_KEY]: [] })]);

    const open = await contextFor(byId(seats, "eng.open"), "sess_v1_open");
    const locked = await contextFor(byId(seats, "eng.locked"), "sess_v1_locked");

    expect(open.resources.get(HANDBOOK)).toBeDefined();
    expect(() => locked.resources.get(HANDBOOK)).toThrow(/not registered/i);
  });
});

describe("V2 · a bad grant refuses the whole roster, and every one is named", () => {
  it("a ref no document matches refuses, naming the seat and the ref (BR-9)", () => {
    expect(() => hire([seat("eng.lead", { [SEAT_RESOURCES_KEY]: ["teams/engineering/hanbdook"] })]))
      .toThrow(/eng\.lead[\s\S]*teams\/engineering\/hanbdook/);
  });

  it("the same ref twice refuses, whatever the modes (BR-10, BR-11)", () => {
    expect(() =>
      hire([seat("eng.lead", { [SEAT_RESOURCES_KEY]: [HANDBOOK, HANDBOOK] })])
    ).toThrow(/2 times/);

    // With DIFFERENT modes the message carries both, so the author sees the
    // conflict rather than only the repetition.
    let message = "";
    try {
      hire([
        seat("eng.lead", {
          [SEAT_RESOURCES_KEY]: [HANDBOOK, { [HANDBOOK]: SEAT_RESOURCE_MODE_WRITE }]
        })
      ]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(`\`${SEAT_RESOURCE_MODE_READ}\``);
    expect(message).toContain(`\`${SEAT_RESOURCE_MODE_WRITE}\``);
  });

  it("every bad grant across the roster is named in ONE message, not just the first", () => {
    let message = "";
    try {
      hire([
        seat("eng.lead", { [SEAT_RESOURCES_KEY]: ["no/such/doc"] }),
        seat("eng.intake", { [SEAT_RESOURCES_KEY]: [{ [PAYROLL]: "write" }] }),
        seat("finance.cfo", { [SEAT_RESOURCES_KEY]: [PAYROLL, PAYROLL] })
      ]);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("no/such/doc");
    expect(message).toContain("eng.intake");
    expect(message).toContain("finance.cfo");
    expect(message).toMatch(/refused 3 of 3 workers/);
  });

  it("nothing is hired when one seat's grant is bad — a partial hire is not a refusal", () => {
    expect(() =>
      hire([seat("eng.good", { [SEAT_RESOURCES_KEY]: [HANDBOOK] }), seat("eng.bad", { [SEAT_RESOURCES_KEY]: ["nope"] })])
    ).toThrow(/nothing was hired/);
  });
});

describe("V3 · a granted seat reaches what it named and nothing else (BR-3)", () => {
  it("the document it did not name is gone from get() AND from property access", async () => {
    const seats = hire([seat("eng.lead", { [SEAT_RESOURCES_KEY]: [HANDBOOK] })]);
    const ctx = await contextFor(byId(seats, "eng.lead"), "sess_v3");

    expect(ctx.resources.get(HANDBOOK)).toBeDefined();
    expect(() => ctx.resources.get(PAYROLL)).toThrow(/not registered/i);
    // The flat registry spreads its handles, so `get()` is not the only door —
    // a gate that covered only it would be theatre.
    expect((ctx.resources as unknown as Record<string, unknown>)[PAYROLL]).toBeUndefined();
  });

  it("two seats of ONE kind carry different maps — the kind is built once", async () => {
    const seats = hire([
      seat("eng.lead", { [SEAT_RESOURCES_KEY]: [HANDBOOK] }),
      seat("finance.cfo", { [SEAT_RESOURCES_KEY]: [PAYROLL] })
    ]);

    const lead = await contextFor(byId(seats, "eng.lead"), "sess_v3_lead");
    const cfo = await contextFor(byId(seats, "finance.cfo"), "sess_v3_cfo");

    expect(() => lead.resources.get(PAYROLL)).toThrow(/not registered/i);
    expect(() => cfo.resources.get(HANDBOOK)).toThrow(/not registered/i);
  });
});

describe("V4 · `ro` closes both write doors, and `rw` leaves them open", () => {
  it("a ro grant reads, and refuses a state write and a content write (BR-1, BR-13)", async () => {
    const seats = hire([seat("eng.lead", { [SEAT_RESOURCES_KEY]: [HANDBOOK] })]);
    const ctx = await contextFor(byId(seats, "eng.lead"), "sess_v4_ro");
    const handbook = handleFor(ctx, HANDBOOK);

    await expect(handbook.readContent()).resolves.toContain("Engineering handbook");
    await expect(handbook.setState({ tampered: true })).rejects.toThrow(/read-only/i);
    await expect(handbook.writeContent("rewritten")).rejects.toThrow(/read-only/i);
  });

  it("the model's own write tool is closed on a ro grant and open on rw (BR-14)", async () => {
    const seats = hire([
      seat("eng.lead", { [SEAT_RESOURCES_KEY]: [HANDBOOK] }),
      seat("finance.cfo", { [SEAT_RESOURCES_KEY]: [{ [PAYROLL]: SEAT_RESOURCE_MODE_WRITE }] })
    ]);
    const writeTool = writeResourceContentTool();

    const leadCtx = await contextFor(byId(seats, "eng.lead"), "sess_v4_tool_ro");
    const leadUri = handleFor(leadCtx, HANDBOOK).uri;
    await expect(
      runForTest(writeTool, { uri: leadUri, content: "rewritten by the model" }, leadCtx as never)
    ).rejects.toThrow(/Writable resource not found/);

    // The control: the SAME tool, on a seat that asked for `rw`, writes. Without
    // it the refusal above is equally consistent with the tool being broken.
    const cfoCtx = await contextFor(byId(seats, "finance.cfo"), "sess_v4_tool_rw");
    const cfoUri = handleFor(cfoCtx, PAYROLL).uri;
    await expect(
      runForTest(writeTool, { uri: cfoUri, content: "rewritten by the model" }, cfoCtx as never)
    ).resolves.toMatchObject({ ok: true });
  });

  it("the same document granted rw still writes — ro is the grant, not the document (BR-2)", async () => {
    const seats = hire([
      seat("eng.lead", { [SEAT_RESOURCES_KEY]: [{ [HANDBOOK]: SEAT_RESOURCE_MODE_WRITE }] })
    ]);
    const ctx = await contextFor(byId(seats, "eng.lead"), "sess_v4_rw");

    await expect(handleFor(ctx, HANDBOOK).setState({ tampered: true })).resolves.toBeUndefined();
  });
});

describe("V5 · the second path — a seat that declares nothing is untouched (BR-4, D1)", () => {
  it("reaches AND writes every declared document, exactly as before this existed", async () => {
    const seats = hire([seat("eng.unrestricted")]);
    const ctx = await contextFor(byId(seats, "eng.unrestricted"), "sess_v5");

    for (const ref of [HANDBOOK, PAYROLL]) {
      expect(ctx.resources.get(ref)).toBeDefined();
      await expect(handleFor(ctx, ref).setState({ touched: true })).resolves.toBeUndefined();
    }
    // The app's own store too, and the kind's block resource.
    expect(ctx.resources.get("audit-log")).toBeDefined();
    expect(ctx.resources.get("inbox")).toBeDefined();
  });

  it("is minted with NO resource map at all — not an empty one, not a rebuilt one", () => {
    const [unrestricted] = hire([seat("eng.unrestricted")]);
    const [restricted] = hire([seat("eng.lead", { [SEAT_RESOURCES_KEY]: [HANDBOOK] })]);

    // Passing a map REPLACES the kind's, so the untouched seat must carry the
    // kind's own flow-level key set, byte for byte.
    expect([...unrestricted!.flowLevelResourceKeys].sort()).toEqual(
      [...deskFlow.flowLevelResourceKeys].sort()
    );
    expect([...restricted!.flowLevelResourceKeys].sort()).not.toEqual(
      [...deskFlow.flowLevelResourceKeys].sort()
    );
  });

  it("hires with no `documents` passed at all, the way every caller before this did", () => {
    const seats = hireWorkforce([seat("eng.unrestricted")], { kinds: { [DESK_KIND]: deskFlow as never } });

    expect(seats).toHaveLength(1);
    expect([...seats[0]!.flowLevelResourceKeys].sort()).toEqual(
      [...deskFlow.flowLevelResourceKeys].sort()
    );
  });
});

describe("V6 · the kind's own machinery is never what a grant governs (BR-7, BR-8)", () => {
  it("a block's resource is reachable and writable on the narrowest seat there is (BR-7)", async () => {
    const seats = hire([seat("eng.intern", { [SEAT_RESOURCES_KEY]: [] })]);
    const ctx = await contextFor(byId(seats, "eng.intern"), "sess_v6_control");

    expect(() => ctx.resources.get(HANDBOOK)).toThrow(/not registered/i);
    // Under its ACCESSOR key, which is what the block's own map named it.
    expect(ctx.resources.get("inbox")).toBeDefined();
    await expect(
      handleFor(ctx, "inbox").setState({ notes: ["still reachable"] })
    ).resolves.toBeUndefined();
  });

  it("a grant that COLLIDES with a block's accessor refuses, naming the seat and the kind (BR-8)", () => {
    // Constructed rather than trusted absent, and constructed where the hazard
    // actually lives: the kind's BLOCK names the accessor and the kind itself
    // does NOT declare that document at flow level. Honouring the grant would
    // install the document at flow level, where it wins the merge — a seat file
    // repointing its kind's wiring.
    expect(() =>
      hireWorkforce(
        [
          {
            id: "eng.lead",
            declared: { flow: COLLIDING_KIND, description: "d", [SEAT_RESOURCES_KEY]: [HANDBOOK] },
            body: ""
          }
        ],
        { kinds: { [COLLIDING_KIND]: collidingFlow as never }, documents: CATALOG }
      )
    ).toThrow(new RegExp(`eng\\.lead[\\s\\S]*${COLLIDING_KIND}`));
  });

  it("the same kind hires a seat whose grant does NOT collide, and keeps the block's resource", async () => {
    // The control. Without it the refusal above is equally consistent with this
    // kind being unhireable for some reason that has nothing to do with the ref.
    const seats = hireWorkforce(
      [
        {
          id: "eng.lead",
          declared: { flow: COLLIDING_KIND, description: "d", [SEAT_RESOURCES_KEY]: [PAYROLL] },
          body: ""
        }
      ],
      { kinds: { [COLLIDING_KIND]: collidingFlow as never }, documents: CATALOG }
    );
    const ctx = await contextFor(byId(seats, "eng.lead"), "sess_v6_control_ok");

    expect(ctx.resources.get(PAYROLL)).toBeDefined();
    // The block's own declaration, under the accessor it chose, untouched.
    expect(ctx.resources.get(HANDBOOK)).toBeDefined();
    await expect(
      handleFor(ctx, HANDBOOK).setState({ notes: ["the kind's own, not the document"] })
    ).resolves.toBeUndefined();
  });
});

describe("V7 · the narrowing is a subtraction, not a rebuild (BR-15)", () => {
  it("a flow-level resource that is NOT a document survives a narrowing grant", async () => {
    const seats = hire([seat("eng.lead", { [SEAT_RESOURCES_KEY]: [HANDBOOK] })]);
    const ctx = await contextFor(byId(seats, "eng.lead"), "sess_v7_kept");

    expect(ctx.resources.get(HANDBOOK)).toBeDefined();
    expect(() => ctx.resources.get(PAYROLL)).toThrow(/not registered/i);
    // The app's own store: no seat file mentioned it, no grant excluded it.
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
      config: { seatSkills: [], seatTools: [] },
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
      hire([seat("eng.lead", { [SEAT_RESOURCES_KEY]: [{ [SEALED]: SEAT_RESOURCE_MODE_WRITE }] })])
    ).toThrow(/writable: false/);
  });

  it("the same sealed document taken read-only hires, and still refuses a write", async () => {
    const seats = hire([seat("eng.lead", { [SEAT_RESOURCES_KEY]: [SEALED] })]);
    const ctx = await contextFor(byId(seats, "eng.lead"), "sess_v8_sealed");

    await expect(handleFor(ctx, SEALED).readContent()).resolves.toContain("Sealed");
    await expect(handleFor(ctx, SEALED).setState({ tampered: true })).rejects.toThrow(/read-only/i);
  });

  it("a document the app declared but did NOT install on this kind refuses, not widens", () => {
    // The app's documented way to give a team only its own documents is to
    // filter before installing. A grant that reached past that filter would let
    // a seat file widen itself past its own kind — the one direction a grant
    // may never move.
    const filteredFlow = defineFlow({
      kind: "filtered-desk",
      cardinality: "collection",
      configSchema: workerConfigSchema(),
      // Only the handbook. Payroll is in the catalog and not on this kind.
      resources: { [HANDBOOK]: CATALOG[HANDBOOK]!, "audit-log": auditLog } as DeclaredResources,
      actions: { run: { inputSchema: z.object({}), block: work } }
    });
    const hireFiltered = (refs: unknown) =>
      hireWorkforce(
        [{ id: "eng.lead", declared: { flow: "filtered-desk", description: "d", [SEAT_RESOURCES_KEY]: refs }, body: "" }],
        { kinds: { "filtered-desk": filteredFlow as never }, documents: CATALOG }
      );

    expect(() => hireFiltered([PAYROLL])).toThrow(/did not install on the `filtered-desk` kind/);
    // The control: the document the kind DOES hold still grants, so the refusal
    // above is about the filter and not about this kind being unhireable.
    expect(hireFiltered([HANDBOOK])).toHaveLength(1);
  });

  it("a seat declaring `resources:` with no documents supplied refuses, naming what is missing (BR-18)", () => {
    expect(() =>
      hireWorkforce([seat("eng.lead", { [SEAT_RESOURCES_KEY]: [HANDBOOK] })], {
        kinds: { [DESK_KIND]: deskFlow as never }
      })
    ).toThrow(/no documents to resolve it against/);
  });
});

describe("the grant is the factory's to read, never a setting the kind receives", () => {
  it("`resources:` does not reach the kind's config bag", () => {
    const [lead] = hire([seat("eng.lead", { [SEAT_RESOURCES_KEY]: [HANDBOOK] })]);

    expect(Object.hasOwn(lead!.config as object, SEAT_RESOURCES_KEY)).toBe(false);
  });
});

describe("V9 · the narrowing is checked on the seat that was BUILT", () => {
  /**
   * The kind whose block ALSO declares a document the kind declares at flow
   * level. Nothing distinguishes it from a kind no block mentions until a seat
   * narrows: the flow-level entry shadows the block's at definition time, and
   * the block's comes back the moment a seat's map replaces the flow-level one.
   */
  const restoringFlow = defineFlow({
    kind: "restoring-desk",
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    resources: { ...CATALOG, "audit-log": auditLog } as DeclaredResources,
    actions: {
      run: {
        inputSchema: z.object({}),
        block: handler({
          name: "restoring-work",
          // The same document, declared again by the block.
          resources: { [HANDBOOK]: CATALOG[HANDBOOK]! },
          requireOrg: true,
          inputSchema: z.object({}),
          outputSchema: z.object({ ok: z.boolean() }),
          execute: async () => ({ ok: true })
        })
      }
    }
  });

  const hireRestoring = (refs: unknown) =>
    hireWorkforce(
      [{ id: "eng.lead", declared: { flow: "restoring-desk", description: "d", [SEAT_RESOURCES_KEY]: refs }, body: "" }],
      { kinds: { "restoring-desk": restoringFlow as never }, documents: CATALOG }
    );

  it("a document a block re-declares does not come back for a seat that was denied it", () => {
    // Denying everything is the sharpest form: the seat's own file says NO
    // documents, and without this check it reads and writes the handbook
    // anyway. The refusal must name the ref and the kind, so an operator knows
    // which block to look at.
    expect(() => hireRestoring([])).toThrow(/eng\.lead[\s\S]*teams\/engineering\/handbook/);
    expect(() => hireRestoring([])).toThrow(/reaches that document anyway/);
  });

  it("granting the document the block re-declares hires, so the refusal is about the denial", () => {
    // The control. Without it the refusal above is equally consistent with this
    // kind being unhireable for a reason that has nothing to do with narrowing.
    expect(hireRestoring([{ [HANDBOOK]: SEAT_RESOURCE_MODE_WRITE }, PAYROLL, SEALED])).toHaveLength(1);
  });

  it("a `ro` grant keeps the pen shut even though the block declares the same document writable", async () => {
    // The other half of the same kind, and the reason the check above only
    // looks at denials: a granted document is installed at flow level as the
    // read-only copy, and a flow-level entry wins the merge over a block's.
    const [lead] = hireRestoring([HANDBOOK, PAYROLL, SEALED]);
    const ctx = await contextFor(lead!, "sess_restoring_ro");

    await expect(handleFor(ctx, HANDBOOK).readContent()).resolves.toContain("Engineering handbook");
    await expect(handleFor(ctx, HANDBOOK).writeContent("rewritten")).rejects.toThrow(/read-only/i);
  });

  it("an alias for a document is narrowed with it, not left behind as a second door", async () => {
    // A map is an object, so an app can expose one definition under a second
    // key. Matching document names alone leaves the alias on the seat's map —
    // a writable handle on a document the seat was denied, under another name.
    const aliasedFlow = defineFlow({
      kind: "aliased-desk",
      cardinality: "collection",
      configSchema: workerConfigSchema(),
      resources: {
        ...CATALOG,
        handbookAlias: CATALOG[HANDBOOK]!,
        "audit-log": auditLog
      } as DeclaredResources,
      actions: { run: { inputSchema: z.object({}), block: work } }
    });

    const [lead] = hireWorkforce(
      [{ id: "eng.lead", declared: { flow: "aliased-desk", description: "d", [SEAT_RESOURCES_KEY]: [] }, body: "" }],
      { kinds: { "aliased-desk": aliasedFlow as never }, documents: CATALOG }
    );

    const ctx = await contextFor(lead!, "sess_alias");
    expect(() => ctx.resources.get("handbookAlias")).toThrow(/not registered/i);
    // The app's own store, which no alias and no grant governs, is untouched.
    await expect(handleFor(ctx, "audit-log").setState({ entries: ["ok"] })).resolves.toBeUndefined();
  });
});

describe("a refusal counts workers, not reasons", () => {
  it("one worker with two bad grants is one refused worker", () => {
    // `refused 2 of 1 worker` is not a sentence this function may print.
    expect(() =>
      hire([seat("eng.lead", { [SEAT_RESOURCES_KEY]: ["no/such/doc", "also/missing"] })])
    ).toThrow(/refused 1 of 1 worker;/);
  });
});
