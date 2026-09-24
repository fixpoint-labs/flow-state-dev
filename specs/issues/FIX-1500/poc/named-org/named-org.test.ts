/**
 * FIX-1500 · POC · kitchen-sink as ONE named organization (owner decision A).
 *
 * NOT production code and not part of any default test run. See README.md for
 * how to run it, what it observed, and each leg's planted control.
 *
 * The mechanism under test is ONE host-level `resolvePrincipal` handed to the
 * router — what `createFlowState({ resolvePrincipal })` in
 * `apps/kitchen-sink/fsdev.config.ts` would forward. Its organization is a
 * constant in host code; nothing on the request is read for it (BP-031). Every
 * flow that declares no resolver of its own — the rail's flow, every seat, every
 * channel — resolves through it, so they all run in one organization.
 *
 * Everything else is the app's real code or the package's real code: the
 * `kitchen-sink` generated kinds and catalog, the real `workforceRegistrar`
 * proxy (installed over the router's own registry, as `fsdev.config.ts`
 * installs it over FlowState's), `createSeatHireBlocks` as PR-D mounts it,
 * `createSeatHireCapability` + discover on the `agent` kind as FIX-1527 S1
 * composes it, the real `workforce-admin` flow and its bearer resolver, and the
 * boot's own `reloadHiredSeats` + `admitReloadedSeats`. The requests go through
 * `createFlowApiRouter` — session create, action, and resource read routes —
 * so route-level authentication runs exactly as it would in the app.
 *
 * Legs (README.md → "Legs"):
 *   N1  the rail's hire lands in the named org and the rail's read finds it
 *   N2  hire and read agree on the org; a body `orgId` changes nothing
 *   N3  a file-declared seat's request runs in the named org, so its
 *       `discover` lists the rail's hire
 *   N4  a restart (fresh registry, fresh router, same stores) reloads it
 *   N5  the operator's `workforce-admin` fire releases a rail hire and a
 *       seat-tool hire, with a token bound to the named org (FIX-1527 BR-10)
 *   N6  the capability's `fire` goes through `isFromRoster`: an address held by
 *       a registration the roster did not make is left alone
 *   N7  what the resolver's user id does to route-level ownership checks
 *   N8  a store written BEFORE the change (every record in the default org):
 *       what the boot's channel open does on it — characterization
 */
import { beforeAll, describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  type PrincipalResolver,
} from "@flow-state-dev/engine";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import { createSessionClient } from "@flow-state-dev/client";
import {
  createSeatHireBlocks,
  createSeatHireCapability,
  createWorkforceCapability,
  defineAgentWorkerFlow,
  defineHiredRosterCollection,
  defineSeatInventoryCollection,
  hireWorkforce,
  openChannels,
  reloadHiredSeats,
  splitResourceModules,
  HIRED_ROSTER_RESOURCE,
  SEAT_INVENTORY_RESOURCE,
  type HireOptions,
  type SeatHireCapabilityOptions,
} from "@flow-state-dev/workforce";

import { admitReloadedSeats } from "@/lib/roster-reload-report";
import { setWorkforceRegistrarImpl, workforceRegistrar } from "@/lib/workforce-registrar";
import { blocks, kinds as generatedKinds, resourceModules } from "@/workforce/workforce.gen";
import { hireKitchenSinkWorkforce } from "@/workforce/hire";

// ---------------------------------------------------------------------------
// Planted controls (README.md → "Controls"). Each flips ONE input its leg
// depends on; the leg must go red and the others stay green.
// ---------------------------------------------------------------------------
/** N1: `default` swaps the named-org resolver for none at all (the app as it ships). */
const RESOLVER = process.env.POC_RESOLVER ?? "named";
/** N2: `1` gives the rail's flow a resolver that names one org for actions and another for reads. */
const SPLIT = process.env.POC_SPLIT === "1";
/** N3: an org the resolver hands to requests addressed to a SEAT instead of the named one. */
const SEAT_ORG = process.env.POC_SEAT_ORG;
/** N4: `1` boots the second process on EMPTY stores instead of the first one's. */
const RELOAD_EMPTY = process.env.POC_RELOAD_EMPTY === "1";
/** N5: the org the operator's token is bound to. */
const ADMIN_ORG = process.env.POC_ADMIN_ORG;
/** N6: `1` passes the registrar's `unregister` straight through, with no provenance check. */
const UNGUARDED = process.env.POC_UNGUARDED === "1";
/** N7: `body` reads the user from the request body; anything else uses one constant user. */
const USER_POLICY = process.env.POC_USER_POLICY ?? "constant";
/** N8: `named` makes the FIRST boot named-org too, so the store holds no default-org records. */
const N8_FIRST = process.env.POC_N8_FIRST ?? "default";

/** The one organization kitchen-sink runs as. A constant in host code. */
const KITCHEN_SINK_ORG_ID = "kitchen-sink";
/** The one user an unauthenticated kitchen-sink visitor is (the page's own default). */
const KITCHEN_SINK_USER_ID = "devuser";

const ADMIN_TOKEN = "poc-admin-token";
const RAIL = "rail";

function bodyUserId(context: Parameters<PrincipalResolver>[0]): string | undefined {
  const meta = context.envelope.metadata as { body?: { userId?: unknown } } | undefined;
  const fromBody = meta?.body?.userId;
  return typeof fromBody === "string" && fromBody.length > 0 ? fromBody : undefined;
}

/**
 * THE MECHANISM. Organization: a constant. User: see N7.
 *
 * `SEAT_ORG` is N3's control only — it is how a split between the rail and the
 * seats would look if the org were set per flow and one flow were missed.
 */
const namedOrgResolver: PrincipalResolver = (context) => {
  const seatAddressed = context.envelope.flowKind.startsWith("support.");
  const orgId = SEAT_ORG !== undefined && seatAddressed ? SEAT_ORG : KITCHEN_SINK_ORG_ID;
  const userId =
    USER_POLICY === "body"
      ? (bodyUserId(context) ?? KITCHEN_SINK_USER_ID)
      : KITCHEN_SINK_USER_ID;
  return { userId, orgId };
};

/** N2's control: a resolver that answers actions and bodyless reads differently. */
const splitResolver: PrincipalResolver = (context) => ({
  userId: KITCHEN_SINK_USER_ID,
  orgId: context.envelope.metadata?.body !== undefined ? KITCHEN_SINK_ORG_ID : "globex",
});

// ---------------------------------------------------------------------------
// The app, composed the way the PLANs say.
// ---------------------------------------------------------------------------

/**
 * The shared seat-hire options object — ONE object that both doors take:
 * PR-D's `createSeatHireBlocks` (the rail) and FIX-1527's
 * `createSeatHireCapability` (mara). In PR-B/FIX-1527 it is exported from
 * `apps/kitchen-sink/workforce/hire.ts`.
 */
function kitchenSinkSeatHire() {
  const { capabilities } = splitResourceModules(resourceModules);
  const kinds: NonNullable<HireOptions["kinds"]> = { ...generatedKinds };
  const seatHireOptions: SeatHireCapabilityOptions = {
    kinds,
    register: (seat, pin) => workforceRegistrar.registerFromRoster(seat, { pin }),
    // Provenance first: release only an address THIS app registered from a
    // roster row. The capability's own `fire` checks kind, not provenance.
    unregister: UNGUARDED
      ? (id) => workforceRegistrar.unregister(id)
      : (id) => workforceRegistrar.isFromRoster(id) && workforceRegistrar.unregister(id),
    kindAt: (id) => workforceRegistrar.kindAt(id),
  };
  const discover = createWorkforceCapability({
    roster: { workers: [], channels: [] },
    inventory: { seats: SEAT_INVENTORY_RESOURCE },
    hiredRoster: HIRED_ROSTER_RESOURCE,
  });
  kinds.agent = defineAgentWorkerFlow({
    uses: [...capabilities, createSeatHireCapability(seatHireOptions), discover],
    catalog: blocks,
  });
  return { kinds, seatHireOptions };
}

/**
 * The rail's flow, reduced to what PR-D adds to `chat-agent`: the two keys the
 * hire block writes, and one action whose block IS
 * `createSeatHireBlocks(...).hire`.
 *
 * ONE roster key. `chat-agent` declares the panel's roster under `ROSTER_REF`
 * (`"roster"`) today, and the hire block reads `HIRED_ROSTER_RESOURCE`
 * (`"hiredRoster"`). Declaring both on one flow is refused at definition
 * ("Resource collision … resolve to the same effective storage key") — the
 * first run of this POC hit it. So PR-D re-keys the panel's roster to
 * `HIRED_ROSTER_RESOURCE`; this POC reads through that key.
 */
function railFlow(seatHireOptions: SeatHireCapabilityOptions): FlowInstance {
  const seatHire = createSeatHireBlocks(seatHireOptions);
  const defined = defineFlow({
    kind: RAIL,
    requireUser: true,
    ...(SPLIT ? { authentication: { resolvePrincipal: splitResolver } } : {}),
    resources: {
      [HIRED_ROSTER_RESOURCE]: defineHiredRosterCollection(),
      [SEAT_INVENTORY_RESOURCE]: defineSeatInventoryCollection(),
    },
    actions: { hireSeat: { block: seatHire.hire } },
  });
  return defined() as FlowInstance;
}

type Script = Array<{ toolCalls: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }> } | { text: string }>;

/** One process of the app: registry, router, registrar installed over it. */
async function boot(options: {
  stores: ReturnType<typeof createInMemoryStores>;
  script?: Script;
  reload?: boolean;
}) {
  const { kinds, seatHireOptions } = kitchenSinkSeatHire();
  const registry = createFlowRegistry();
  setWorkforceRegistrarImpl({
    register: (flow, opts) => registry.register(flow, opts),
    unregister: (id) => registry.unregister(id),
    kindAt: (id) => registry.get(id)?.kind,
  });
  const [mara, otto] = hireWorkforce(
    [
      { id: "support.mara", declared: { tools: ["hire", "fire"] }, body: "You staff the desk." },
      { id: "support.otto", declared: { tools: ["desk-note"] }, body: "You answer questions." },
    ],
    { kinds },
  );
  registry.register(railFlow(seatHireOptions));
  registry.register(mara!);
  registry.register(otto!);

  // `workforce-admin` closes over its credential at module evaluation, so the
  // env is set before the import (fsdev.config.ts registers it only when set).
  process.env.WORKFORCE_ADMIN_TOKENS = `${ADMIN_ORG ?? KITCHEN_SINK_ORG_ID}:${ADMIN_TOKEN}`;
  const admin = (await import("@/flows/workforce-admin/flow")).default as FlowInstance;
  registry.register(admin);

  // The boot's durable half, exactly as fsdev.config.ts runs it.
  let reloaded: string[] = [];
  let orgIds: string[] = [];
  if (options.reload === true) {
    orgIds = [...new Set((await options.stores.org.list()).map((record) => record.orgId))].sort();
    const reload = await reloadHiredSeats({ stores: options.stores as never, orgIds, kinds });
    const admitted = await admitReloadedSeats({
      reload,
      stores: options.stores as never,
      admit: (seat) =>
        workforceRegistrar.registerFromRoster(
          seat,
          seat.ownerPin !== undefined ? { pin: seat.ownerPin } : undefined,
        ),
    });
    reloaded = admitted.seats;
  }

  const router = createFlowApiRouter({
    registry,
    stores: options.stores,
    ...(RESOLVER === "default" ? {} : { resolvePrincipal: namedOrgResolver }),
    modelResolver: createMockModelResolver({
      generators: { "agent-answer": mockGenerator({ name: "agent-answer", script: (options.script ?? [{ text: "ok" }]) as never }) },
      policy: "allow",
    }),
  });
  return { router, registry, kinds, reloaded, orgIds };
}

async function drain(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (stream === null) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

type Router = ReturnType<typeof createFlowApiRouter>;

async function call(router: Router, method: "GET" | "POST", path: string[], body?: unknown, headers: Record<string, string> = {}) {
  const res = await router[method](
    new Request(`http://localhost/api/flows/${path.map(encodeURIComponent).join("/")}`, {
      method,
      headers: { "content-type": "application/json", accept: "text/event-stream", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: { path } },
  );
  const text = await drain(res.body);
  return { status: res.status, text };
}

/** The rail opens its session the way the page does: POST .../sessions with its userId. */
async function openSession(router: Router, flowId: string, userId = KITCHEN_SINK_USER_ID) {
  const res = await call(router, "POST", [flowId, "sessions"], { userId });
  const parsed = res.text.length > 0 ? JSON.parse(res.text) : {};
  return { status: res.status, sessionId: parsed.session?.id as string | undefined, orgId: parsed.session?.orgId as string | undefined, text: res.text };
}

async function act(router: Router, flowId: string, action: string, sessionId: string, input: unknown, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return call(router, "POST", [flowId, "actions", action], { userId: KITCHEN_SINK_USER_ID, sessionId, input, ...extra }, headers);
}

/** The rail's own read: one roster item through its session, over the resource route. */
async function railRead(router: Router, sessionId: string, seatId: string, ref = HIRED_ROSTER_RESOURCE) {
  const res = await call(router, "GET", ["sessions", sessionId, "resources", ref, seatId]);
  return { status: res.status, row: res.text.length > 0 ? JSON.parse(res.text) : null };
}

async function hireFromRail(router: Router, seatId: string, extra: Record<string, unknown> = {}) {
  const session = await openSession(router, RAIL);
  const hired = await act(router, RAIL, "hireSeat", session.sessionId!, { seatId, flow: "agent", instructions: "Takes refunds." }, extra);
  return { session, hired };
}

const ADDR = (seatId: string) => `${KITCHEN_SINK_ORG_ID}.${seatId}`;

describe("FIX-1500 POC · kitchen-sink runs as one named organization", () => {
  beforeAll(() => {
    delete process.env.FSDEV_DEFAULT_MODEL;
  });

  it("N1 · the rail's hire lands in the named org and the rail's read finds it", async () => {
    const stores = createInMemoryStores();
    const { router, registry } = await boot({ stores });
    const { session, hired } = await hireFromRail(router, "support.pat");

    expect(session.orgId, session.text).toBe(KITCHEN_SINK_ORG_ID);
    expect(hired.text).not.toMatch(/"type":"error"|__fsd_default_org__/);
    expect(registry.get(ADDR("support.pat"))?.kind).toBe("agent");
    const read = await railRead(router, session.sessionId!, "support.pat");
    expect(read.status).toBe(200);
    expect(JSON.stringify(read.row)).toContain("Takes refunds.");
    // The hired seat is pinned to the org it was hired under; a visitor opening
    // it resolves the same org through the same resolver, so the pin admits it.
    const opened = await openSession(router, ADDR("support.pat"));
    expect(opened.status, opened.text).toBe(201);
    expect(opened.orgId).toBe(KITCHEN_SINK_ORG_ID);
  });

  it("N2 · hire and read resolve one org; a body orgId changes nothing", async () => {
    const stores = createInMemoryStores();
    const { router, registry } = await boot({ stores });
    const { session, hired } = await hireFromRail(router, "support.pat", { orgId: "globex" });
    if (SPLIT) console.log("[N2 split]", session.orgId, hired.text.match(/"message":"[^"]*"/)?.[0]);

    // Where the row ended up, not whether the call succeeded.
    expect(registry.get("globex.support.pat")).toBeUndefined();
    expect(registry.get(ADDR("support.pat"))).toBeDefined();
    // The read goes through the same session the hire ran in, on a bodyless
    // management route — the path a split would break.
    const read = await railRead(router, session.sessionId!, "support.pat");
    expect(read.row).not.toBeNull();
  });

  it("N3 · a file-declared seat runs in the named org, so its discover lists the rail's hire", async () => {
    const stores = createInMemoryStores();
    const { router } = await boot({
      stores,
      script: [
        { toolCalls: [{ toolCallId: "d1", toolName: "discover", args: {} }] },
        { text: "done" },
      ],
    });
    await hireFromRail(router, "support.pat");
    const seat = await openSession(router, "support.mara");
    expect(seat.orgId).toBe(SEAT_ORG ?? KITCHEN_SINK_ORG_ID);
    const ran = await act(router, "support.mara", "run", seat.sessionId!, { message: "who is around?" });
    // The hire above already happened in another request; this request's
    // stream carries the address only if discover listed it.
    expect(ran.text).toContain(ADDR("support.pat"));
  });

  it("N4 · a restart on the same stores brings the hire back, into the named org", async () => {
    const stores = createInMemoryStores();
    const first = await boot({ stores });
    await hireFromRail(first.router, "support.pat");

    const second = await boot({ stores: RELOAD_EMPTY ? createInMemoryStores() : stores, reload: true });
    expect(second.orgIds).toContain(KITCHEN_SINK_ORG_ID);
    expect(second.reloaded).toEqual([ADDR("support.pat")]);
    expect(workforceRegistrar.isFromRoster(ADDR("support.pat"))).toBe(true);
    const session = await openSession(second.router, RAIL);
    expect((await railRead(second.router, session.sessionId!, "support.pat")).row).not.toBeNull();
  });

  it("N5 · the operator's fire releases a rail hire and a seat-tool hire (token bound to the named org)", async () => {
    const stores = createInMemoryStores();
    const { router, registry } = await boot({
      stores,
      script: [
        { toolCalls: [{ toolCallId: "h1", toolName: "hire", args: { seatId: "support.quinn", flow: "agent" } }] },
        { text: "done" },
      ],
    });
    await hireFromRail(router, "support.pat");
    const seat = await openSession(router, "support.mara");
    await act(router, "support.mara", "run", seat.sessionId!, { message: "hire quinn" });
    expect(registry.get(ADDR("support.quinn"))?.kind).toBe("agent");

    const auth = { authorization: `Bearer ${ADMIN_TOKEN}` };
    for (const seatId of ["support.pat", "support.quinn"]) {
      const fired = await call(router, "POST", ["workforce-admin", "actions", "fire"], { sessionId: `admin-${seatId}`, input: { seatId } }, auth);
      expect(fired.text, fired.text).toContain('"released":true');
      expect(registry.get(ADDR(seatId))).toBeUndefined();
    }
  });

  it("N6 · the capability's fire leaves an address the roster did not register", async () => {
    const stores = createInMemoryStores();
    const { router, registry, kinds } = await boot({
      stores,
      script: [
        { toolCalls: [{ toolCallId: "f1", toolName: "fire", args: { seatId: "support.pat" } }] },
        { text: "done" },
      ],
    });
    await hireFromRail(router, "support.pat");
    // The address is released and re-taken by a registration the roster did
    // not make, of the SAME kind — so the capability's kind check cannot tell.
    workforceRegistrar.unregister(ADDR("support.pat"));
    const [squatter] = hireWorkforce([{ id: ADDR("support.pat"), declared: {}, body: "declared elsewhere" }], { kinds });
    workforceRegistrar.register(squatter!);
    expect(workforceRegistrar.isFromRoster(ADDR("support.pat"))).toBe(false);

    const seat = await openSession(router, "support.mara");
    const ran = await act(router, "support.mara", "run", seat.sessionId!, { message: "fire pat" });
    expect(ran.text).toContain('"released":false');
    expect(registry.get(ADDR("support.pat"))).toBe(squatter);
  });

  it("N7 · an e2e-style user keeps its session through create, action and read", async () => {
    const stores = createInMemoryStores();
    const { router } = await boot({ stores });
    const session = await openSession(router, RAIL, "e2e-user-1");
    const hired = await act(router, RAIL, "hireSeat", session.sessionId!, { seatId: "support.pat", flow: "agent" }, { userId: "e2e-user-1" });
    const read = await railRead(router, session.sessionId!, "support.pat");
    // Recorded, not asserted green: README.md → N7 says what each policy does.
    console.log(
      `[N7 policy=${USER_POLICY}] create=${session.status} owner-org=${session.orgId} ` +
        `action=${hired.status} ${hired.text.includes('"type":"error"') ? "action-errored" : "action-ok"} ` +
        `read=${read.status} row=${read.row === null ? "null" : "found"} ` +
        `${hired.text.match(/"message":"[^"]*"/)?.[0] ?? ""}`,
    );
    expect(read.status).toBe(200);
    expect(read.row).not.toBeNull();
  });

  it("N8 · a store written before the change: the channel boot on the first named-org boot", async () => {
    const stores = createInMemoryStores();
    const workforce = await hireKitchenSinkWorkforce();
    // The boot's own channel open, over a loopback router — as fsdev.config.ts does it.
    const openAll = async (resolvePrincipal?: PrincipalResolver) => {
      const registry = createFlowRegistry();
      for (const flow of workforce.channelFlows) registry.register(flow);
      const router = createFlowApiRouter({ registry, stores, ...(resolvePrincipal ? { resolvePrincipal } : {}) });
      const client = createSessionClient({
        fetcher: async (input, init) => {
          const url = new URL(String(input), "http://kitchen-sink.local");
          const path = url.pathname.replace(/^\/api\/flows\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
          const method = (init?.method ?? "GET").toUpperCase() as "GET" | "POST" | "PATCH" | "DELETE";
          return router[method](new Request(url, init), { params: { path } });
        },
      });
      await openChannels(workforce.channels, { client, userId: KITCHEN_SINK_USER_ID });
    };
    // First boot: the app as it ships (every channel session in the default org),
    // unless the control makes it a named-org boot too.
    await openAll(N8_FIRST === "named" ? namedOrgResolver : undefined);
    const outcome = await openAll(namedOrgResolver).then(
      () => "opened",
      (error: Error) => error.message,
    );
    console.log(`[N8] second boot, named org, same store: ${outcome}`);
    const binding = (await stores.session.get(workforce.channels[0]!.id))?.orgId;
    console.log(`[N8] ${workforce.channels[0]!.id} is bound to: ${binding}`);
    // The finding PR-B must handle, asserted so a re-run notices if it moves:
    // the first named-org boot over a store the shipped app wrote cannot open
    // its channels, and fsdev.config.ts awaits that open at module scope.
    expect(outcome).toMatch(/could not be opened.*403/);
  });
});
