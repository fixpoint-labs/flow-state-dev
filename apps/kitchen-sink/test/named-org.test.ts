/**
 * Kitchen-sink runs as one named organization — driven through the app's own
 * `fsdev.config.ts` and the router it builds, not through `runAction`.
 *
 * Every case imports the real config. So the host resolver, the boot's
 * mailbox open and the step that clears a pre-change
 * store's mailboxes are the ones the app ships, and a request goes through
 * route-level authentication exactly as a browser's does. Promoted from the
 * spec POC (`specs/issues/FIX-1500/poc/named-org/`).
 *
 * One thing is substituted, below the wiring under test: the model.
 * `KITCHEN_SINK_TEST_MODE=1` makes the config build its model resolver from
 * `test/mock-flowstate`, which this file mocks with a scripted `agent-answer`,
 * so a seat's answer is fixed.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1500/PLAN.md`), and the red
 * state each was seen in before its green was trusted:
 *
 *   V18 A session on the assistant's flow, with a worker and on a mailbox
 *       binds to `kitchen-sink`, whatever the body says. Red: remove `resolvePrincipal`
 *       from `fsdev.config.ts` — every session binds to `__fsd_default_org__`.
 *   V19 A store written before the app named its organization is not
 *       upgraded: it is wiped (the owner's call on #2159). The boot over one
 *       refuses to start, names every mailbox stored under another
 *       organization, and says to delete the store. The guard only reads: no
 *       mailbox is moved, rebound or deleted. Red: remove the guard in `fsdev.config.ts` — the boot fails with the
 *       bare `mailbox "support.help" could not be opened — Request failed
 *       (403)`, which names neither the cause nor the fix.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createFilesystemStores, createFlowState, filesystemStores, type FlowState } from "@flow-state-dev/engine";
import { createSessionClient } from "@flow-state-dev/client";
import { PRE_RENAME_NAMES, openMailboxes } from "@flow-state-dev/workforce";

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

// Each case imports the whole app afresh. The first import is cold (about 4.8s
// on its own), and beside another file doing the same it outruns vitest's 5s
// default.
vi.setConfig({ testTimeout: 30_000 });

const ORG = "kitchen-sink";

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

async function bootApp(options: { dataDir?: string; steps?: ScriptStep[] } = {}) {
  vi.resetModules();
  script.steps = options.steps ?? [{ text: "ok" }];
  vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
  vi.stubEnv("STORE_TYPE", options.dataDir === undefined ? "memory" : "filesystem");
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

// ---------------------------------------------------------------------------

describe("V18 · one organization, from the host resolver", () => {
  it("binds the assistant's flow, a worker's conversation and a mailbox to kitchen-sink, whatever the body says", async () => {
    const { router } = await bootApp();

    const opens: Array<[string, Record<string, unknown>]> = [
      ["chat-agent", {}],
      ["agent", { state: { workerId: "support.devices" } }],
      ["agent", { state: { workerId: "support.general" } }],
      ["mailbox", {}],
    ];
    for (const [flowId, body] of opens) {
      const opened = await openSession(router, flowId, { orgId: "globex", ...body });
      expect(opened.status, `${flowId}: ${opened.text}`).toBe(201);
      expect(opened.orgId, flowId).toBe(ORG);
    }
    // And the mailbox the boot itself opened.
    const help = await call(router, "GET", ["sessions", "support.help"]);
    expect(help.status, help.text).toBe(200);
    expect(json(help.text).session.orgId).toBe(ORG);
  });

});

describe("V19 · a store written before the app named its organization", () => {
  /**
   * The boot the app ran before it named its organization, for the part that
   * matters here: the same mailbox kinds and the same mailbox open, through a
   * router with no resolver, so every mailbox session lands in the
   * development organization.
   */
  async function preChangeBoot(dataDir: string) {
    const { buildKitchenSinkWorkforce } = await import("@/workforce/hire");
    const workforce = await buildKitchenSinkWorkforce();
    const flowstate = createFlowState({
      flows: Object.fromEntries(workforce.mailboxFlows.map((flow) => [flow.id, flow])),
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
    await openMailboxes(workforce.mailboxes, { client, userId: "devuser" });
    await flowstate.dispose();
    return workforce.mailboxes.map((mailbox) => mailbox.id).sort();
  }

  it("refuses to boot, names every stale mailbox and the fix, and moves no mailbox", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "ks-named-org-"));
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
    const mailboxIds = await preChangeBoot(dataDir);
    expect(mailboxIds.length).toBeGreaterThan(0);

    const boot = bootApp({ dataDir });
    await expect(boot).rejects.toThrow(/written before kitchen-sink ran as organization "kitchen-sink"/);
    await expect(boot).rejects.toThrow(/Delete the store and restart: .*remove \.fsdev\/data/);
    const message = await boot.catch((error: Error) => error.message);
    for (const id of mailboxIds) expect(message).toContain(`"${id}" (organization "${DEFAULT_ORG_ID}")`);

    // Nothing was migrated or deleted: every mailbox is still where the old boot left it.
    // (The guard only reads. The boot step before it still writes its per-organization
    // roster report, as it does on every boot.)
    const store = storeAt(dataDir);
    for (const id of mailboxIds) expect((await store.session.get(id))?.orgId, id).toBe(DEFAULT_ORG_ID);
  });

  it("boots over the same location once the store is wiped", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "ks-named-org-"));
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
    await preChangeBoot(dataDir);
    await rm(path.join(dataDir, ".fsdev", "data"), { recursive: true, force: true });

    const { router } = await bootApp({ dataDir });
    const help = await call(router, "GET", ["sessions", "support.help"]);
    expect(help.status, help.text).toBe(200);
    expect(json(help.text).session.orgId).toBe(ORG);
  });
});

/**
 * A store written before mailboxes were renamed is not carried over either.
 * The boot stops before opening anything, names each stale mailbox and what
 * gave it away, and says how to reset, as the organization check above does.
 * It only reads: the old data is still there afterwards.
 *
 * Two marks: a session on the old built-in kind, and a mailbox whose kind
 * never said anything (a custom kind keeps its name) but whose transcript
 * holds a line under the old item name.
 */
describe("a store written before mailboxes were renamed", () => {
  const now = Date.now();

  async function seedSession(dataDir: string, flowKind: string) {
    await storeAt(dataDir).session.set(
      "support.help",
      {
        id: "support.help", flowKind, flowId: flowKind, userId: "devuser", orgId: ORG, state: { members: [], instructions: "" },
        lineageId: "lin_support.help", version: 0, createdAt: now, updatedAt: now, journal: [],
      } as never,
      "absent",
    );
  }

  async function seedOldLine(dataDir: string) {
    await storeAt(dataDir).request.set(
      "req_old_line",
      {
        id: "req_old_line", flowKind: "mailbox", flowId: "mailbox", actionName: "post", userId: "devuser", sessionId: "support.help",
        orgId: ORG, source: "http", status: "completed", startedAtMs: now, state: {}, lineageId: "lin_req_old_line", version: 0,
        createdAt: now, updatedAt: now, journal: [],
        items: [{ id: "item_old_line", type: "component", component: PRE_RENAME_NAMES.postComponent, data: { body: "hi" }, status: "completed", createdAt: now }],
      } as never,
      "absent",
    );
  }

  async function refusedBoot(dataDir: string) {
    const boot = bootApp({ dataDir });
    await expect(boot).rejects.toThrow(/were renamed to mailboxes/);
    await expect(boot).rejects.toThrow(/Delete the store and restart: .*remove \.fsdev\/data/);
    return boot.catch((error: Error) => error.message);
  }

  it("refuses to boot over a session on the old built-in kind, naming the mailbox, and moves nothing", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "ks-pre-rename-"));
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
    await seedSession(dataDir, PRE_RENAME_NAMES.kind);

    const message = await refusedBoot(dataDir);

    expect(message).toContain(`mailbox "support.help" (it is a session on the "${PRE_RENAME_NAMES.kind}" kind)`);
    expect((await storeAt(dataDir).session.get("support.help"))?.flowKind).toBe(PRE_RENAME_NAMES.kind);
  });

  it("refuses to boot over a mailbox whose transcript holds a line under the old item name", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "ks-pre-rename-"));
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
    await seedSession(dataDir, "mailbox");
    await seedOldLine(dataDir);

    const message = await refusedBoot(dataDir);

    expect(message).toContain(`mailbox "support.help" (its transcript holds "${PRE_RENAME_NAMES.postComponent}" items)`);
  });
});
