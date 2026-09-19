/**
 * FIX-1381 spec POC — characterization, not a proposal.
 *
 * The spec's approach rests on two claims about how the framework ALREADY
 * behaves. Neither is documented, both are load-bearing, and prose cannot
 * settle either. This pins them on the real path so the reviewer and the owner
 * can see the answer rather than take mine.
 *
 *   P1  A flow instance minted with its own `resources` map REPLACES the
 *       definition's flow-level map — so a per-seat narrowed map is a real
 *       narrowing of what reaches `ctx.resources`, not a merge.
 *
 *   P2  A resource entry carrying `writable: false` refuses writes at the
 *       engine's write seam while reads still work — so `ro` needs no new
 *       enforcement mechanism.
 *
 * And one negative control, which is the point of the exercise rather than a
 * footnote:
 *
 *   P3  A BLOCK-declared resource survives the narrowing. The instance option
 *       replaces only the flow-level map; block resources merge in underneath
 *       (`defineFlow.ts` -> `mergeFlowResourceMap`). If this test ever goes
 *       green in the other direction, the allowlist's fence has moved and
 *       BUSINESS-RULES.md R-4 is wrong.
 *
 * Throwaway. Lives on the never-merged spec branch, under `spec-poc/`, which
 * CI ignores. Nothing here is a proposed API — the seat-facing surface is
 * SPEC.md's; this only shows the substrate those surfaces would stand on.
 *
 * Run, from the repo root (after `pnpm install`):
 *
 *   pnpm exec vitest run --config spec-poc/FIX-1381-seat-resource-allowlist/vitest.config.ts
 *
 * Expect: 5 passed. Every assertion here has been watched go red — the mode
 * flags were un-flipped (P2 fails), and the mint was made to ignore the
 * narrowed map (P1 and P3 fail). A green run of a check nobody has seen fail
 * is not evidence (tenet 7).
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineFlow,
  defineResource,
  handler,
  type DeclaredResources,
} from "@flow-state-dev/core";
import { createExecutionContext, createInMemoryStores } from "@flow-state-dev/engine";

const ORG = "org_fix1381";
const USER = "user_fix1381";

/** Two org documents, the shape `resourcesFromDocs` produces (scope: "org"). */
const handbook = defineResource({
  ref: "teams/engineering/handbook",
  scope: "org",
  stateSchema: z.object({}).passthrough(),
  default: {},
  content: "# Engineering handbook",
});

const payroll = defineResource({
  ref: "finance/payroll",
  scope: "org",
  stateSchema: z.object({}).passthrough(),
  default: {},
  content: "# Payroll",
});

/**
 * The `ro` projection, as the spec proposes to build it: a shallow copy of the
 * SAME definition with the mode flags flipped. Not a new definition path and
 * not a second table — the entry IS the config the engine reads.
 *
 * `llmWritable: false` is flipped alongside `writable: false` because they gate
 * two different doors: `writable` gates code (`ctx.resources.x.setState`), and
 * `llmWritable` gates the model's own built-in write tool
 * (`core/src/tools/resource-tools.ts:263`). A `ro` that closed only one of them
 * would be a mode that holds against the implementer and not against the model,
 * which on this ticket is the wrong way round.
 */
function readOnly<T extends object>(entry: T): T {
  return { ...entry, writable: false, llmWritable: false };
}

/** A resource the KIND's own block declares — the machinery, not a document. */
const seatInbox = defineResource({
  ref: "seat-inbox",
  scope: "org",
  stateSchema: z.object({ notes: z.array(z.string()).default([]) }),
  default: { notes: [] },
  writable: true,
});

const readsEverything = handler({
  name: "reads-everything",
  // Block-declared: this is the P3 control.
  resources: { inbox: seatInbox },
  requireOrg: true,
  execute: async () => ({ ok: true }),
});

/** One kind, defined ONCE — the fact that makes per-seat narrowing hard. */
const workerKind = defineFlow({
  kind: "fix1381-seat",
  // The app's flow-level map: every org document, which is today's behaviour
  // and the gap the ticket names.
  resources: { [handbook.ref!]: handbook, [payroll.ref!]: payroll } as DeclaredResources,
  actions: {
    run: { inputSchema: z.object({}), block: readsEverything },
  },
});

/** Mint one seat with its own narrowed map, the way `hireWorkforce` would. */
function hireSeat(id: string, allowed: DeclaredResources) {
  return workerKind({ id, resources: allowed });
}

async function contextFor(flow: ReturnType<typeof hireSeat>, sessionId: string) {
  return createExecutionContext({
    flow,
    actionName: "run",
    requestId: `req_${sessionId}`,
    sessionId,
    userId: USER,
    orgId: ORG,
    stores: createInMemoryStores(),
  });
}

describe("FIX-1381 P1 — a per-seat resources map narrows what the seat can reach", () => {
  it("a seat allowed one document cannot reach the other", async () => {
    const seat = hireSeat("engineering.lead", {
      [handbook.ref!]: handbook,
    } as DeclaredResources);

    const ctx = await contextFor(seat, "sess_p1_narrow");

    // What it was granted.
    expect(ctx.resources.get(handbook.ref!)).toBeDefined();

    // What it was not. The honest "not registered" error, not a silent handle.
    expect(() => ctx.resources.get(payroll.ref!)).toThrow(/not registered/i);

    // And not reachable by direct property access either — the flat registry
    // spreads its handles, so `get()` is not the only door and a gate that
    // only covered `get()` would be theatre.
    expect(
      (ctx.resources as unknown as Record<string, unknown>)[payroll.ref!]
    ).toBeUndefined();
  });

  it("two seats of ONE kind carry different maps — the kind is built once", async () => {
    const lead = hireSeat("engineering.lead", {
      [handbook.ref!]: handbook,
    } as DeclaredResources);
    const cfo = hireSeat("finance.cfo", {
      [payroll.ref!]: payroll,
    } as DeclaredResources);

    const leadCtx = await contextFor(lead, "sess_p1_lead");
    const cfoCtx = await contextFor(cfo, "sess_p1_cfo");

    expect(() => leadCtx.resources.get(payroll.ref!)).toThrow(/not registered/i);
    expect(() => cfoCtx.resources.get(handbook.ref!)).toThrow(/not registered/i);
  });
});

describe("FIX-1381 P2 — `writable: false` already enforces ro at the write seam", () => {
  it("a ro grant reads and refuses to write", async () => {
    const seat = hireSeat("engineering.lead", {
      [handbook.ref!]: readOnly(handbook),
    } as DeclaredResources);

    const ctx = await contextFor(seat, "sess_p2_ro");
    const ref = ctx.resources.get(handbook.ref!) as {
      readContent(): Promise<string | null>;
      setState(next: Record<string, unknown>): Promise<void>;
      writeContent(body: string): Promise<void>;
    };

    // Reads work.
    await expect(ref.readContent()).resolves.toContain("Engineering handbook");

    // State writes refuse.
    await expect(ref.setState({ tampered: true })).rejects.toThrow(/read-only/i);

    // Content writes refuse too — both doors, not just the one.
    await expect(ref.writeContent("rewritten")).rejects.toThrow(/read-only/i);
  });

  it("the SAME document granted rw still writes — ro is the grant, not the document", async () => {
    const seat = hireSeat("engineering.lead", {
      [handbook.ref!]: handbook,
    } as DeclaredResources);

    const ctx = await contextFor(seat, "sess_p2_rw");
    const ref = ctx.resources.get(handbook.ref!) as {
      setState(next: Record<string, unknown>): Promise<void>;
    };

    await expect(ref.setState({ tampered: true })).resolves.toBeUndefined();
  });
});

describe("FIX-1381 P3 (negative control) — block-declared resources escape the narrowing", () => {
  it("the kind's own block resource is present even on the narrowest seat", async () => {
    // The narrowest grant there is: nothing.
    const seat = hireSeat("engineering.intern", {} as DeclaredResources);

    const ctx = await contextFor(seat, "sess_p3_control");

    // Both documents are gone, as P1 says.
    expect(() => ctx.resources.get(handbook.ref!)).toThrow(/not registered/i);
    expect(() => ctx.resources.get(payroll.ref!)).toThrow(/not registered/i);

    // But the BLOCK's resource is still there — under its ACCESSOR key, which
    // is what the block's `resources:` map named it, not the definition's
    // `ref`. (Writing this test against the ref is what the first run caught:
    // it failed with "not registered" and looked like proof of the opposite
    // fact. The control earned its place on its first run.)
    expect(ctx.resources.get("inbox")).toBeDefined();

    // And it is writable — the narrowing took nothing away from it. This is
    // the fence the spec states as R-4, and the reason the allowlist is
    // honestly scoped to DECLARED DOCUMENTS rather than sold to the owner as
    // "everything a seat can touch".
    await expect(
      (ctx.resources.get("inbox") as unknown as {
        setState(next: Record<string, unknown>): Promise<void>;
      }).setState({ notes: ["still reachable"] })
    ).resolves.toBeUndefined();
  });
});
