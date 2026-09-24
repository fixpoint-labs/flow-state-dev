/**
 * Kitchen-sink runs as one named organization — driven through the app's own
 * `fsdev.config.ts` and the router it builds, not through `runAction`.
 *
 * Every case imports the real config. So the host resolver, the admin
 * credential, the boot's channel open and the step that clears a pre-change
 * store's channels are the ones the app ships, and a request goes through
 * route-level authentication exactly as a browser's does. Promoted from the
 * spec POC (`specs/issues/FIX-1500/poc/named-org/`).
 *
 * Two things are substituted, both below the wiring under test:
 *
 *   - The model. `KITCHEN_SINK_TEST_MODE=1` makes the config build its model
 *     resolver from `test/mock-flowstate`, which this file mocks with a
 *     scripted `agent-answer`, so a seat's tool calls are fixed.
 *   - The rail's hire door. The action that mounts `createSeatHireBlocks` on
 *     the rail's flow is not in this app yet. A stand-in flow that carries only
 *     that action, built from the app's own `kitchenSinkSeatHireOptions`, is
 *     registered into the running FlowState. It declares no resolver, so it
 *     takes the host fallback as the rail's flow does.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1500/PLAN.md`), and the red
 * state each was seen in before its green was trusted:
 *
 *   V18 A session on the assistant's flow, on a seat and on a channel binds to
 *       `kitchen-sink`. A rail hire lands there whatever the body says, reads
 *       back through the rail's session and the assistant's roster, and mara's
 *       `discover` lists it. Red: remove `resolvePrincipal` from
 *       `fsdev.config.ts` — every session binds to `__fsd_default_org__` and
 *       the hire is refused (`Organization id "__fsd_default_org__" …`).
 *   V19 Over a store written before the app named its organization, the boot
 *       completes and every file-declared channel's session is bound to
 *       `kitchen-sink` and readable (200), with one of its boards. Earlier
 *       history is left behind: not in the new channel, not listed under it,
 *       and still in the store. Red: drop the set-aside step — the boot throws
 *       `channel "support.ada-wren" could not be opened — Request failed (403)`.
 *       Red: swallow that throw — the boot completes, the channel is still
 *       `__fsd_default_org__`, and its read is 403. Red (history): move the
 *       session and not its requests — the old channel's runs are listed under
 *       the new one.
 *   V22 With `acme:t1,kitchen-sink:t2`, the `acme` token is refused (401) and
 *       named in the boot log, and the `kitchen-sink` token's `fire` releases a
 *       rail hire and a mara hire. Red: accept the `acme` binding — its token
 *       resolves, and its fire answers `This organization hired no seat`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineFlow, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFilesystemStores, createFlowState, filesystemStores, type FlowState } from "@flow-state-dev/engine";
import { createSessionClient } from "@flow-state-dev/client";
import {
  channelBoardIds,
  createSeatHireBlocks,
  defineHiredRosterCollection,
  defineSeatInventoryCollection,
  openChannels,
  HIRED_ROSTER_RESOURCE,
  SEAT_INVENTORY_RESOURCE,
} from "@flow-state-dev/workforce";

type ScriptStep =
  | { toolCalls: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }> }
  | { text: string };

/** What the mocked `agent-answer` says next. Set before a boot; read when the config builds its resolver. */
const script = vi.hoisted(() => ({ steps: [] as unknown[] }));

vi.mock("@/test/mock-flowstate", async () => {
  const { createMockModelResolver, mockGenerator } = await import("@flow-state-dev/testing");
  return {
    createKitchenSinkTestModelResolver: () =>
      createMockModelResolver({
        generators: {
          "agent-answer": mockGenerator({ name: "agent-answer", script: script.steps as never }),
        },
        policy: "allow",
      }),
  };
});

const ORG = "kitchen-sink";
const RAIL = "rail-standin";
const ADDR = (seatId: string) => `${ORG}.${seatId}`;

type Router = Awaited<ReturnType<FlowState["getRouter"]>>;

// ---------------------------------------------------------------------------
// One boot of the app, from its real config.
// ---------------------------------------------------------------------------

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  const hmr = globalThis as { __fsdFlowstate?: FlowState };
  await hmr.__fsdFlowstate?.dispose();
  delete hmr.__fsdFlowstate;
  while (cleanups.length > 0) await cleanups.pop()!();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function bootApp(options: { dataDir?: string; tokens?: string; steps?: ScriptStep[] } = {}) {
  vi.resetModules();
  script.steps = options.steps ?? [{ text: "ok" }];
  vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
  vi.stubEnv("STORE_TYPE", options.dataDir === undefined ? "memory" : "filesystem");
  vi.stubEnv("WORKFORCE_ADMIN_TOKENS", options.tokens ?? "");
  delete process.env.FSDEV_DEFAULT_MODEL;
  // The config roots the filesystem profile at `<cwd>/.fsdev/data`.
  if (options.dataDir !== undefined) vi.spyOn(process, "cwd").mockReturnValue(options.dataDir);
  const log: string[] = [];
  const realError = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    log.push(args.map(String).join(" "));
    realError(...args);
  });

  const flowstate = (await import("@/fsdev.config")).default as FlowState;
  const runtime = await flowstate.getRuntime();
  const router = await flowstate.getRouter();
  return { flowstate, runtime, router, log };
}

/** The rail's hire door, reduced to what the rail's flow will carry, from the app's own options. */
async function registerRailStandIn(flowstate: FlowState): Promise<void> {
  const { kitchenSinkSeatHireOptions } = await import("@/workforce/hire");
  const seatHire = createSeatHireBlocks(kitchenSinkSeatHireOptions);
  const rail = defineFlow({
    kind: RAIL,
    requireUser: true,
    resources: {
      [HIRED_ROSTER_RESOURCE]: defineHiredRosterCollection(),
      [SEAT_INVENTORY_RESOURCE]: defineSeatInventoryCollection(),
    },
    actions: { hireSeat: { block: seatHire.hire } },
  });
  flowstate.register(rail() as FlowInstance);
}

// ---------------------------------------------------------------------------
// Requests, as the browser makes them.
// ---------------------------------------------------------------------------

async function call(
  router: Router,
  method: "GET" | "POST",
  segments: string[],
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const res = await router[method](
    new Request(`http://localhost/api/flows/${segments.map(encodeURIComponent).join("/")}`, {
      method,
      headers: { "content-type": "application/json", accept: "text/event-stream", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: { path: segments } },
  );
  return { status: res.status, text: await res.text() };
}

/** Wait for something a background run writes. Fails with the last value seen. */
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, what: string): Promise<T> {
  let value = await read();
  for (let attempt = 0; attempt < 100 && !done(value); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    value = await read();
  }
  if (!done(value)) throw new Error(`${what} never happened; last saw ${JSON.stringify(value)}`);
  return value;
}

/** An out-of-band handle on a filesystem store: not the booted runtime's. */
const storeAt = (dataDir: string) =>
  createFilesystemStores({ rootDir: path.join(dataDir, ".fsdev", "data"), developmentOnly: true });

const json = (text: string) => (text.length > 0 ? JSON.parse(text) : null);

/** Open a session the way the page does: a body `userId`, which a resolver overrides. */
async function openSession(router: Router, flowId: string, body: Record<string, unknown> = {}) {
  const res = await call(router, "POST", [flowId, "sessions"], { userId: "someone-else", ...body });
  const session = json(res.text)?.session as { id?: string; orgId?: string } | undefined;
  return { status: res.status, id: session?.id, orgId: session?.orgId, text: res.text };
}

async function act(router: Router, flowId: string, action: string, sessionId: string, input: unknown, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return call(router, "POST", [flowId, "actions", action], { userId: "someone-else", sessionId, input, ...extra }, headers);
}

async function hireFromRail(router: Router, seatId: string, extra: Record<string, unknown> = {}) {
  const session = await openSession(router, RAIL);
  const hired = await act(router, RAIL, "hireSeat", session.id!, { seatId, flow: "agent", instructions: "Takes refunds." }, extra);
  return { session, hired };
}

const hireScript = (seatId: string): ScriptStep[] => [
  { toolCalls: [{ toolCallId: "h1", toolName: "hire", args: { seatId, flow: "agent" } }] },
  { text: "hired" },
];

// ---------------------------------------------------------------------------

describe("V18 · one organization, from the host resolver", () => {
  it("binds the assistant's flow, a seat and a channel to kitchen-sink, whatever the body says", async () => {
    const { router } = await bootApp();

    for (const flowId of ["chat-agent", "support.ada", "support.mara", "channel"]) {
      const opened = await openSession(router, flowId, { orgId: "globex" });
      expect(opened.status, `${flowId}: ${opened.text}`).toBe(201);
      expect(opened.orgId, flowId).toBe(ORG);
    }
    // And the channels the boot itself opened.
    const desk = await call(router, "GET", ["sessions", "support.desk"]);
    expect(desk.status, desk.text).toBe(200);
    expect(json(desk.text).session.orgId).toBe(ORG);
  });

  it("lands a rail hire in kitchen-sink, reads it back on the rail and the assistant, and mara's discover lists it", async () => {
    const { flowstate, runtime, router } = await bootApp({
      steps: [{ toolCalls: [{ toolCallId: "d1", toolName: "discover", args: {} }] }, { text: "done" }],
    });
    await registerRailStandIn(flowstate);

    const { session, hired } = await hireFromRail(router, "support.pat", { orgId: "globex" });
    expect(session.orgId).toBe(ORG);
    expect(hired.text).not.toMatch(/Organization id|"type":"error"/);
    // Where the seat ended up, not whether the call said ok.
    expect(runtime.registry.get(ADDR("support.pat"))?.kind).toBe("agent");
    expect(runtime.registry.get("globex.support.pat")).toBeUndefined();

    // The rail's own read, through its own session.
    const onRail = await call(router, "GET", ["sessions", session.id!, "resources", HIRED_ROSTER_RESOURCE, "support.pat"]);
    expect(onRail.status, onRail.text).toBe(200);
    expect(onRail.text).toContain("Takes refunds.");
    // The assistant's roster panel reads the same organization's rows.
    const chat = await openSession(router, "chat-agent");
    const onAssistant = await call(router, "GET", ["sessions", chat.id!, "resources", "roster", "support.pat"]);
    expect(onAssistant.status, onAssistant.text).toBe(200);
    expect(onAssistant.text).toContain("Takes refunds.");

    // The hired seat opens for the visitor: its pin is kitchen-sink, and so are they.
    const opened = await openSession(router, ADDR("support.pat"));
    expect(opened.status, opened.text).toBe(201);

    // A file-declared seat, in another request, sees the hire.
    const mara = await openSession(router, "support.mara");
    const ran = await act(router, "support.mara", "run", mara.id!, { message: "who is around?" });
    expect(ran.text).toContain(ADDR("support.pat"));
  });
});

describe("V22 · every admin token is bound to kitchen-sink", () => {
  it("refuses and names an acme token, and the kitchen-sink token fires a rail hire and a mara hire", async () => {
    const { flowstate, runtime, router, log } = await bootApp({
      tokens: "acme:t1,kitchen-sink:t2",
      steps: hireScript("support.quinn"),
    });
    await registerRailStandIn(flowstate);

    expect(log.join("\n")).toMatch(/names organization "acme"/);

    // The rail's hire, and mara's, both in the one organization.
    await hireFromRail(router, "support.pat");
    const mara = await openSession(router, "support.mara");
    await act(router, "support.mara", "run", mara.id!, { message: "hire quinn" });
    expect(runtime.registry.get(ADDR("support.pat"))?.kind).toBe("agent");
    expect(runtime.registry.get(ADDR("support.quinn"))?.kind).toBe("agent");

    const acme = await act(router, "workforce-admin", "fire", "admin-acme", { seatId: "support.pat" }, {}, { authorization: "Bearer t1" });
    expect(acme.status, acme.text).toBe(401);
    expect(runtime.registry.get(ADDR("support.pat"))).toBeDefined();

    for (const seatId of ["support.pat", "support.quinn"]) {
      const fired = await act(router, "workforce-admin", "fire", `admin-${seatId}`, { seatId }, {}, { authorization: "Bearer t2" });
      expect(fired.text).toContain('"released":true');
      expect(runtime.registry.get(ADDR(seatId))).toBeUndefined();
    }
  });
});

describe("V19 · a store written before the app named its organization", () => {
  /**
   * The boot the app ran before it named its organization, for the part that
   * matters here: the same channel kinds and the same channel open, through a
   * router with no resolver, so every channel session lands in the
   * development organization. Then one post and one board row, so the channel
   * has history to leave behind.
   */
  async function preChangeBoot(dataDir: string) {
    const { hireKitchenSinkWorkforce } = await import("@/workforce/hire");
    const workforce = await hireKitchenSinkWorkforce();
    const flowstate = createFlowState({
      flows: Object.fromEntries(workforce.channelFlows.map((flow) => [flow.id, flow])),
      stores: { dev: { primary: filesystemStores({ rootDir: path.join(dataDir, ".fsdev", "data") }) } },
    });
    const router = await flowstate.getRouter();
    const client = createSessionClient({
      fetcher: async (input, init) => {
        const url = new URL(String(input), "http://kitchen-sink.local");
        const segments = url.pathname.replace(/^\/api\/flows\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
        const method = (init?.method ?? "GET").toUpperCase() as "GET" | "POST" | "PATCH" | "DELETE";
        return router[method](new Request(url, init), { params: { path: segments } });
      },
    });
    await openChannels(workforce.channels, { client, userId: "devuser" });
    const runtime = await flowstate.getRuntime();
    await act(router, "channel", "post", "support.desk", { body: "PRE-CHANGE post" }, { userId: "devuser" });
    await until(
      () => runtime.stores.session.get("support.desk"),
      (session) => JSON.stringify(session?.state).includes("PRE-CHANGE post"),
      "the pre-change post",
    );
    await act(router, "channel", "fileTask", "support.desk", { board: "followups", goal: "PRE-CHANGE row" }, { userId: "devuser" });
    await until(
      () => runtime.stores.resourceState.getByPrefix("org", DEFAULT_ORG_ID, "support.desk.followups/"),
      (rows) => JSON.stringify(rows).includes("PRE-CHANGE row"),
      "the pre-change board row",
    );
    await until(
      () => runtime.stores.request.list({ sessionId: "support.desk" }),
      (runs) => runs.length > 0 && runs.every((run) => run.status === "completed"),
      "the pre-change runs settling",
    );
    const desk = await runtime.stores.session.get("support.desk");
    await flowstate.dispose();
    return { channels: workforce.channels, desk };
  }

  it("opens every file-declared channel in kitchen-sink and leaves the old history behind", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "ks-named-org-"));
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }));

    const before = await preChangeBoot(dataDir);
    expect(before.desk?.orgId).toBe(DEFAULT_ORG_ID);
    expect(JSON.stringify(before.desk?.state)).toContain("PRE-CHANGE post");

    const { router } = await bootApp({ dataDir });

    // Out of band: a fresh handle over the same location, not the booted runtime.
    const store = storeAt(dataDir);
    const boards = channelBoardIds(before.channels);
    expect(before.channels.length).toBeGreaterThan(0);
    for (const channel of before.channels) {
      const stored = await store.session.get(channel.id);
      expect(stored?.orgId, channel.id).toBe(ORG);
      const read = await call(router, "GET", ["sessions", channel.id]);
      expect(read.status, `${channel.id}: ${read.text}`).toBe(200);
      for (const board of boards.filter((id) => id.startsWith(`${channel.id}.`))) {
        const rows = await call(router, "GET", ["sessions", channel.id, "resources", board]);
        expect(rows.status, `${board}: ${rows.text}`).toBe(200);
        // A board starts empty in the new organization: the old row stays with the old one.
        expect(rows.text, board).not.toContain("PRE-CHANGE row");
      }
    }

    // H1 · left behind: the new channel carries none of it, and lists none of it…
    const desk = await store.session.get("support.desk");
    expect(JSON.stringify(desk?.state)).not.toContain("PRE-CHANGE post");
    const listed = await call(router, "GET", ["sessions", "support.desk", "requests"]);
    expect(listed.status, listed.text).toBe(200);
    expect(json(listed.text).requests).toEqual([]);
    // …and deleted none of it: the old session, its runs and its board row are all still stored.
    const setAside = await store.session.get(`support.desk~${DEFAULT_ORG_ID}`);
    expect(setAside?.orgId).toBe(DEFAULT_ORG_ID);
    expect(JSON.stringify(setAside?.state)).toContain("PRE-CHANGE post");
    const oldRuns = await store.request.list({ sessionId: `support.desk~${DEFAULT_ORG_ID}` });
    expect(oldRuns.map((run) => run.actionName)).toEqual(expect.arrayContaining(["post", "fileTask"]));
    expect(oldRuns.every((run) => run.orgId === DEFAULT_ORG_ID)).toBe(true);
    const oldRows = await store.resourceState.getByPrefix("org", DEFAULT_ORG_ID, "support.desk.followups/");
    expect(JSON.stringify(oldRows)).toContain("PRE-CHANGE row");
    // Unreachable from the app: it is another organization's session.
    const oldRead = await call(router, "GET", ["sessions", `support.desk~${DEFAULT_ORG_ID}`]);
    expect(oldRead.status).toBe(403);
  });

  it("does nothing on the next boot over the same store", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "ks-named-org-"));
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
    await preChangeBoot(dataDir);
    await bootApp({ dataDir });
    const store = storeAt(dataDir);
    const first = await store.session.get("support.desk");

    const { router } = await bootApp({ dataDir });
    const again = await store.session.get("support.desk");
    expect(again?.lineageId).toBe(first?.lineageId);
    expect((await call(router, "GET", ["sessions", "support.desk"])).status).toBe(200);
  });
});
