/**
 * The app this goal starts four times over one SQLite file.
 *
 * Model-free. Two seat kinds, each answering one `answer` action with the
 * address it runs at. Before the release (`release: "before"`) the app carries
 * both; after it (`"after"`) the cut kind is gone and the kept kind's settings
 * require one more key, so a seat hired without it is refused at start.
 *
 * The `ops` flow mounts the seat-hire blocks as actions, plus `repair`: the
 * approval a person answers before a seat is retired or re-hired. It suspends
 * on a stock `human_approval`; Approve applies the repair, Deny changes nothing.
 *
 * Under `GOAL_CONTROL=fire-keeps-inventory`, retire is today's fire: the roster
 * row is deleted and the address released, and the inventory row stays.
 */
import { defineFlow, handler, sequencer, SuspensionRejectedError } from "@flow-state-dev/core";
import type { BlockContext, FlowInstance, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createFlowState, runAction } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import {
  createSeatHireBlocks,
  defineHiredRosterCollection,
  defineSeatInventoryCollection,
  HIRED_ROSTER_RESOURCE,
  reloadHiredSeats,
  SEAT_INVENTORY_RESOURCE,
  seatAddress,
  workerConfigSchema,
} from "@flow-state-dev/workforce";
import { z } from "zod";

export type Fixture = {
  orgId: string;
  userId: string;
  cutKind: string;
  keptKind: string;
  requiredSetting: string;
  settingValue: string;
  cutSeat: string;
  rehireSeat: string;
  refusedSeat: string;
  healthySeat: string;
  firedBeforeSeat: string;
  marker: string;
};

export type Release = "before" | "after";

const tagInput = z.object({ tag: z.string() });

/** What a seat does when asked: say which address answered. */
const answer = handler({
  name: "answer",
  inputSchema: tagInput,
  outputSchema: z.object({ answeredAs: z.string(), tag: z.string() }),
  execute: (input, ctx) => ({ answeredAs: (ctx.flow as unknown as { id: string }).id, tag: input.tag }),
});

function seatKind(kind: string, setting: string, required: boolean) {
  return defineFlow({
    kind,
    cardinality: "collection",
    configSchema: workerConfigSchema().extend({ [setting]: required ? z.string() : z.string().optional() }),
    actions: { answer: { inputSchema: tagInput, block: answer } },
  } as never);
}

/** The kind map this release boots with. */
export function kindsFor(fixture: Fixture, release: Release) {
  return release === "before"
    ? {
        [fixture.cutKind]: seatKind(fixture.cutKind, fixture.requiredSetting, false),
        [fixture.keptKind]: seatKind(fixture.keptKind, fixture.requiredSetting, false),
      }
    : { [fixture.keptKind]: seatKind(fixture.keptKind, fixture.requiredSetting, true) };
}

const repairInput = z.object({
  op: z.enum(["retire", "rehire"]),
  seatId: z.string(),
  flow: z.string().optional(),
  settings: z.record(z.unknown()).optional(),
});
const decision = repairInput.extend({ approved: z.boolean() });

/** The ask: a stock approval naming the repair. */
const gate = handler({
  name: "repair-gate",
  inputSchema: repairInput,
  outputSchema: decision,
  execute: async (input, ctx) => {
    try {
      await ctx.suspend!({
        reason: "human_approval",
        message: `${input.op === "retire" ? "Retire" : `Re-hire onto ${input.flow}`} ${input.seatId}?`,
        allow: ["approve", "reject"],
      });
      return { ...input, approved: true };
    } catch (error) {
      if (error instanceof SuspensionRejectedError) return { ...input, approved: false };
      throw error;
    }
  },
});

/** The control: retire as fire was before this change, leaving the inventory row. */
function todaysFire(unregister: (id: string) => boolean) {
  return handler({
    name: "fire-keeps-inventory",
    inputSchema: z.object({ seatId: z.string() }),
    outputSchema: z.object({ released: z.boolean() }),
    execute: async (input, ctx: BlockContext) => {
      const orgId = String(ctx.org?.identity.orgId ?? ctx.org?.identity.id);
      const roster = ctx.resources[HIRED_ROSTER_RESOURCE] as unknown as ResourceCollectionRef;
      await roster.delete(input.seatId);
      return { released: unregister(seatAddress(orgId, input.seatId)) };
    },
  });
}

/** Open the app over `dbFile`, reload the stored roster, and register what comes back. */
export async function openApp(options: { fixture: Fixture; release: Release; dbFile: string; control?: string }) {
  const { fixture, release } = options;
  const kinds = kindsFor(fixture, release);
  let registry: { get(id: string): { kind: string } | undefined } | undefined;
  let state: ReturnType<typeof createFlowState>;

  const register = (seat: FlowInstance, pin: { orgId: string; userId?: string }) => state.register(seat, { pin });
  const unregister = (id: string) => state.unregister(id);
  const blocks = createSeatHireBlocks({
    kinds,
    register,
    unregister,
    kindAt: (id) => registry?.get(id)?.kind,
  });
  const retire = options.control === "fire-keeps-inventory" ? todaysFire(unregister) : blocks.fire;

  const repair = sequencer({ name: "repair", inputSchema: repairInput })
    .step(gate)
    .stepIf((d: any) => d.approved === true && d.op === "retire", (d: any) => ({ seatId: d.seatId }), retire)
    .stepIf(
      (d: any) => d.approved === true && d.op === "rehire",
      (d: any) => ({ seatId: d.seatId, flow: d.flow, settings: d.settings ?? {} }),
      blocks.rehire,
    );

  const ops = defineFlow({
    kind: "ops",
    resources: {
      [HIRED_ROSTER_RESOURCE]: defineHiredRosterCollection(),
      [SEAT_INVENTORY_RESOURCE]: defineSeatInventoryCollection(),
    },
    actions: {
      hire: { block: blocks.hire },
      brokenSeats: { block: blocks.brokenSeats },
      repair: { block: repair, durable: true },
    },
  } as never)();

  state = createFlowState({
    flows: { ops: ops as never },
    stores: { default: { primary: sqliteStores({ filename: options.dbFile }) } },
    durable: true,
    resolvePrincipal: (context: { request?: Request }) => {
      const userId = context.request?.headers.get("x-verified-user");
      const orgId = context.request?.headers.get("x-verified-org");
      return userId && orgId ? { userId, orgId } : null;
    },
  } as never);
  const runtime = await state.getRuntime();
  registry = runtime.registry as never;

  // The boot: the stored roster read back, each seat registered under its own pin.
  const reload = await reloadHiredSeats({ stores: runtime.stores, orgIds: [fixture.orgId], kinds });
  for (const seat of reload.seats) {
    state.register(seat, { pin: (seat as { ownerPin?: { orgId: string } }).ownerPin ?? { orgId: fixture.orgId } });
  }

  const router = (await state.getRouter()) as Record<string, (r: Request, c: unknown) => Promise<Response>>;
  const who = { "x-verified-user": fixture.userId, "x-verified-org": fixture.orgId };
  const call = async (method: "GET" | "POST", path: string[], body?: unknown) => {
    const response = await router[method]!(
      new Request(`http://goal/api/flows/${path.map(encodeURIComponent).join("/")}`, {
        method,
        headers: { "content-type": "application/json", ...who },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { params: { path } },
    );
    const text = await response.text();
    return { status: response.status, json: text.length > 0 ? JSON.parse(text) : undefined };
  };

  /**
   * Wait for a request to leave the running states. After a resume, a request
   * still reading `suspended` has not picked the answer up yet, so it waits on that too.
   */
  const settle = async (flowId: string, requestId: string, resumed = false): Promise<{ status: string; body: any }> => {
    const running = ["pending", "in_progress", "running", "queued", ...(resumed ? ["suspended"] : [])];
    for (let i = 0; i < 400; i++) {
      const polled = await call("GET", [flowId, "requests", requestId, "status"]);
      const status = polled.json?.status as string | undefined;
      if (status && !running.includes(status)) return { status, body: polled.json };
      await new Promise((r) => setTimeout(r, 10));
    }
    return { status: "timed-out", body: undefined };
  };

  /** Run one action in a fresh session as the fixture's person, through the HTTP router. */
  const act = async (flowId: string, action: string, input: unknown) => {
    const session = await call("POST", [flowId, "sessions"], { userId: fixture.userId });
    if (session.status !== 201) return { status: `session ${session.status}`, body: session.json, requestId: "" };
    const sessionId = session.json.session.id as string;
    const posted = await call("POST", [flowId, sessionId, "actions", action], { userId: fixture.userId, input });
    if (posted.status >= 400) return { status: `http ${posted.status}`, body: posted.json, requestId: "" };
    const requestId = posted.json.request.id as string;
    return { ...(await settle(flowId, requestId)), requestId };
  };

  /**
   * Run one `ops` action and hand back what it answered — for the read, whose
   * answer is the surface a person sees. The HTTP status route carries no output.
   */
  let n = 0;
  const answerOf = async (action: string, input: unknown) => {
    n += 1;
    return (await runAction({
      flow: ops,
      actionName: action,
      input,
      userId: fixture.userId,
      orgId: fixture.orgId,
      sessionId: `goal-${action}-${Date.now()}-${n}`,
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig },
    } as never)) as { output?: unknown; error?: { message?: string } };
  };

  return { state, runtime, reload, call, act, settle, answerOf };
}
