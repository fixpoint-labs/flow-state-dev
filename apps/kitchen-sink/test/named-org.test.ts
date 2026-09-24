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
 * One thing is substituted, below the wiring under test: the model.
 * `KITCHEN_SINK_TEST_MODE=1` makes the config build its model resolver from
 * `test/mock-flowstate`, which this file mocks with a scripted `agent-answer`,
 * so a seat's tool calls are fixed. The rail's hire door is the real one:
 * `chat-agent`'s `hireSeat` action, which declares no resolver and so takes
 * the host fallback.
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
 *   V19 A store written before the app named its organization is not
 *       upgraded: it is wiped (the owner's call on #2159). The boot over one
 *       refuses to start, names every channel stored under another
 *       organization, and says to delete the store. The guard only reads: no
 *       channel is moved, rebound or deleted. Red: remove the guard in `fsdev.config.ts` — the boot fails with the
 *       bare `channel "support.ada-wren" could not be opened — Request failed
 *       (403)`, which names neither the cause nor the fix.
 *   V11 (inside V18's hire case) A rail hire whose body and input both name
 *       `orgId: "globex"` lands in the session's organization. The assertion
 *       is where the seat ended up, not that the call succeeded. Red: have
 *       the sequence read the input's `orgId` — the seat registers at
 *       `globex.support.pat` and the `kitchen-sink` address is empty.
 *   V14 A rail hire survives the process that made it, at node level. (a) The
 *       row is in the durable store, read out of band. (b) A second boot over
 *       the same location serves the seat and the rail reads its row. The
 *       negative control is part of the case: a third boot over an EMPTY
 *       location must not have it, or (b) could be passing off a cache in
 *       this process rather than the store.
 *   V22 With `acme:t1,kitchen-sink:t2`, the `acme` token is refused (401) and
 *       named in the boot log, and the `kitchen-sink` token's `fire` releases a
 *       rail hire and a mara hire. Red: accept the `acme` binding — its token
 *       resolves, and its fire answers `This organization hired no seat`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createFilesystemStores, createFlowState, filesystemStores, type FlowState } from "@flow-state-dev/engine";
import { createSessionClient } from "@flow-state-dev/client";
import { openChannels, HIRED_ROSTER_RESOURCE } from "@flow-state-dev/workforce";

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
/** The flow the rail's session runs on, and the one carrying its hire door. */
const RAIL = "chat-agent";
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

/** Hire through the rail's door. `orgId` names another organization in the body and in the input, as a caller could. */
async function hireFromRail(router: Router, seatId: string, orgId?: string) {
  const session = await openSession(router, RAIL);
  const named = orgId === undefined ? {} : { orgId };
  const hired = await act(router, RAIL, "hireSeat", session.id!, { seatId, flow: "agent", instructions: "Takes refunds.", ...named }, named);
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
    const { runtime, router } = await bootApp({
      steps: [{ toolCalls: [{ toolCallId: "d1", toolName: "discover", args: {} }] }, { text: "done" }],
    });

    const { session, hired } = await hireFromRail(router, "support.pat", "globex");
    expect(session.orgId).toBe(ORG);
    expect(hired.text).not.toMatch(/Organization id|"type":"error"/);
    // Where the seat ended up, not whether the call said ok.
    expect(runtime.registry.get(ADDR("support.pat"))?.kind).toBe("agent");
    expect(runtime.registry.get("globex.support.pat")).toBeUndefined();

    // The rail's own read, through the session that hired, and through
    // another of the assistant's sessions: the same organization's row.
    for (const sessionId of [session.id!, (await openSession(router, RAIL)).id!]) {
      const onRail = await call(router, "GET", ["sessions", sessionId, "resources", HIRED_ROSTER_RESOURCE, "support.pat"]);
      expect(onRail.status, onRail.text).toBe(200);
      expect(onRail.text).toContain("Takes refunds.");
    }

    // The hired seat opens for the visitor: its pin is kitchen-sink, and so are they.
    const opened = await openSession(router, ADDR("support.pat"));
    expect(opened.status, opened.text).toBe(201);

    // A file-declared seat, in another request, sees the hire.
    const mara = await openSession(router, "support.mara");
    const ran = await act(router, "support.mara", "run", mara.id!, { message: "who is around?" });
    expect(ran.text).toContain(ADDR("support.pat"));
  });
});

describe("V14 · a rail hire outlives the process that made it", () => {
  /** End a boot the way a process exit would, so the next import builds a new one. */
  async function shutDown(flowstate: FlowState): Promise<void> {
    await flowstate.dispose();
    delete (globalThis as { __fsdFlowstate?: FlowState }).__fsdFlowstate;
  }

  it("is in the store out of band, is served by a fresh boot over it, and not by one over an empty store", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "ks-rail-hire-"));
    const emptyDir = await mkdtemp(path.join(tmpdir(), "ks-rail-hire-empty-"));
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
    cleanups.push(() => rm(emptyDir, { recursive: true, force: true }));

    const first = await bootApp({ dataDir });
    const { hired } = await hireFromRail(first.router, "support.pat");
    expect(hired.text).not.toMatch(/"type":"error"/);
    await shutDown(first.flowstate);

    // (a) Out of band: a store handle this test opened, not the runtime's.
    const rows = await storeAt(dataDir).resourceState.getByPrefix("org", ORG, "workforce/roster/");
    expect(Object.keys(rows)).toEqual(["workforce/roster/support.pat"]);
    expect(rows["workforce/roster/support.pat"]!.state).toMatchObject({ flow: "agent", instructions: "Takes refunds." });

    // (b) A new boot over the same location serves the seat, and the rail reads it.
    const second = await bootApp({ dataDir });
    expect(second.runtime.registry.get(ADDR("support.pat"))?.kind).toBe("agent");
    const rail = await openSession(second.router, RAIL);
    const read = await call(second.router, "GET", ["sessions", rail.id!, "resources", HIRED_ROSTER_RESOURCE, "support.pat"]);
    expect(read.status, read.text).toBe(200);
    expect(read.text).toContain("Takes refunds.");
    await shutDown(second.flowstate);

    // The control: the same boot over an empty location has no such seat.
    const empty = await bootApp({ dataDir: emptyDir });
    expect(empty.runtime.registry.get(ADDR("support.pat"))).toBeUndefined();
  }, 30_000); // Three boots of the whole app.
});

describe("V22 · every admin token is bound to kitchen-sink", () => {
  it("refuses and names an acme token, and the kitchen-sink token fires a rail hire and a mara hire", async () => {
    const { runtime, router, log } = await bootApp({
      tokens: "acme:t1,kitchen-sink:t2",
      steps: hireScript("support.quinn"),
    });

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
   * development organization.
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
    await flowstate.dispose();
    return workforce.channels.map((channel) => channel.id).sort();
  }

  it("refuses to boot, names every stale channel and the fix, and moves no channel", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "ks-named-org-"));
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
    const channelIds = await preChangeBoot(dataDir);
    expect(channelIds.length).toBeGreaterThan(0);

    const boot = bootApp({ dataDir });
    await expect(boot).rejects.toThrow(/written before kitchen-sink ran as organization "kitchen-sink"/);
    await expect(boot).rejects.toThrow(/Delete the store and restart: .*remove \.fsdev\/data/);
    const message = await boot.catch((error: Error) => error.message);
    for (const id of channelIds) expect(message).toContain(`"${id}" (organization "${DEFAULT_ORG_ID}")`);

    // Nothing was migrated or deleted: every channel is still where the old boot left it.
    // (The guard only reads. The boot step before it still writes its per-organization
    // roster report, as it does on every boot.)
    const store = storeAt(dataDir);
    for (const id of channelIds) expect((await store.session.get(id))?.orgId, id).toBe(DEFAULT_ORG_ID);
  });

  it("boots over the same location once the store is wiped", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "ks-named-org-"));
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
    await preChangeBoot(dataDir);
    await rm(path.join(dataDir, ".fsdev", "data"), { recursive: true, force: true });

    const { router } = await bootApp({ dataDir });
    const desk = await call(router, "GET", ["sessions", "support.desk"]);
    expect(desk.status, desk.text).toBe(200);
    expect(json(desk.text).session.orgId).toBe(ORG);
  });
});
