/**
 * FIX-1551 · POC · which organization a CLI run executes under.
 *
 * NOT production code and not part of any default test run. `run.sh` copies
 * this file and `fixture/` into `packages/cli/test/`, runs it, and removes the
 * copy. README.md records what each leg showed and its planted control.
 *
 * Legs:
 *   P1  today: `fsdev run` stores its session in the placeholder org while the
 *       same app's router binds a session to the app's org (characterization)
 *   P2  the premise: the host-level resolver is not reachable from anything a
 *       loaded FlowState exposes
 *   P3  the mechanism: the host's own normalized resolution, asked with a
 *       CLI-local context (no request, no credential), gives the same answer the
 *       app's router gives an equivalent HTTP caller, flow by flow
 *   P4  the outcome: a run under P3's principal leaves a session the app's own
 *       router reads back
 *   P5  a developer-named org stays out of the app's view
 */
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createInMemoryStores,
  createInboundTransportHost,
  defaultBodyUserIdPrincipalResolver,
  runAction,
  type FlowState,
  type PrincipalResolutionContext,
} from "@flow-state-dev/engine";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { executeRunCommand } from "../../src/commands/run";
import {
  APP_ORG,
  APP_USER,
  hostResolver,
  hostResolverEnabled,
  makeFlowState,
} from "./fixture/app";

const fixtureDir = resolve(import.meta.dirname, "fixture");
const CLI_USER = "cli-user";
const open: FlowState[] = [];

afterEach(async () => {
  while (open.length > 0) await open.pop()!.dispose().catch(() => undefined);
});

async function app() {
  const flowState = makeFlowState();
  open.push(flowState);
  const runtime = await flowState.getRuntime();
  const router = await flowState.getRouter();
  return { flowState, runtime, router };
}

type Router = Awaited<ReturnType<FlowState["getRouter"]>>;

async function call(
  router: Router,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const url = new URL(`http://poc.local/api/flows/${path}`);
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  const res = await router[method](new Request(url, init), {
    params: { path: path.split("/").filter((s) => s.length > 0) },
  });
  const text = await res.text();
  let json: any = undefined;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

/**
 * The sketch under test: ask the app's host the question HTTP asks, with a
 * CLI-local context. The CLI names its local user the way an unauthenticated
 * HTTP caller does (the body's `userId`); it carries no request and no
 * credential, and its `source` is one no network adapter stamps.
 *
 * The POC has to build the host from the resolver it configured itself —
 * P2 is why: a loaded FlowState does not hand the resolver out.
 *
 * `POC_CLI_FALLBACK=1` plants fork 2's option B: a refusal falls back to the
 * placeholder org, as `fsdev run` behaves for every app today.
 */
async function cliResolve(
  runtime: Awaited<ReturnType<FlowState["getRuntime"]>>,
  flowId: string,
): Promise<{ ok: true; userId: string; orgId: string } | { ok: false; status: number; message: string }> {
  const host = createInboundTransportHost({
    registry: runtime.registry,
    stores: runtime.stores,
    resolvePrincipal: hostResolverEnabled() ? hostResolver : defaultBodyUserIdPrincipalResolver,
    runtimeConfig: runtime.runtimeConfig,
  });
  const context: PrincipalResolutionContext = {
    source: "cli",
    envelope: {
      flowKind: flowId,
      action: "respond",
      input: { message: "hi" },
      metadata: { body: { userId: CLI_USER } },
    },
  };
  try {
    const principal = await host.resolvePrincipal(context);
    return { ok: true, ...principal };
  } catch (err) {
    if (process.env.POC_CLI_FALLBACK === "1") {
      return { ok: true, userId: CLI_USER, orgId: DEFAULT_ORG_ID };
    }
    return {
      ok: false,
      status: (err as { status?: number }).status ?? -1,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

describe("FIX-1551 POC", () => {
  it("P1 · today the CLI and the app disagree on the org (characterization)", async () => {
    const stores = createInMemoryStores();
    const result = await executeRunCommand("echo", "respond", {
      cwd: fixtureDir,
      input: '{"message":"hi"}',
      session: "cli-s1",
      stores,
      quiet: true,
    });
    expect(result.success).toBe(true);
    const cliSession = await stores.session.get("cli-s1");

    const { router } = await app();
    const http = await call(router, "POST", "echo/sessions", { userId: "someone" });

    console.log("[P1]", { cli: { orgId: cliSession?.orgId, userId: cliSession?.userId }, http: http.json?.session?.orgId, status: http.status });
    expect(cliSession?.orgId).toBe(DEFAULT_ORG_ID);
    expect(cliSession?.userId).toBe(CLI_USER);
    // Control POC_HOST_RESOLVER=none: the app is on the placeholder too, so this goes red.
    expect(http.json?.session?.orgId).toBe(APP_ORG);
  });

  it("P2 · the host resolver is not reachable from a loaded FlowState", async () => {
    const { flowState, runtime } = await app();
    const found: string[] = [];
    const visit = (label: string, value: unknown) => {
      if (value === hostResolver) found.push(label);
    };
    for (const [k, v] of Object.entries(runtime)) visit(`runtime.${k}`, v);
    for (const [k, v] of Object.entries(runtime.runtimeConfig)) visit(`runtime.runtimeConfig.${k}`, v);
    for (const [k, v] of Object.entries(flowState.meta)) visit(`meta.${k}`, v);
    for (const flow of runtime.registry.list()) {
      visit(`registry.${flow.id}.authentication.resolvePrincipal`, flow.authentication?.resolvePrincipal);
    }
    console.log("[P2]", { runtimeKeys: Object.keys(runtime), reachableAt: found });
    // Control POC_PER_FLOW=1 moves the same resolver onto `echo`: found = [registry.echo…], red.
    expect(found).toEqual([]);
  });

  it("P3 · the CLI-local ask gives what HTTP gives, flow by flow", async () => {
    const { runtime, router } = await app();
    const rows: Record<string, { cli: string; http: string }> = {};
    for (const flowId of ["echo", "admin", "digest"]) {
      const cli = await cliResolve(runtime, flowId);
      const http = await call(router, "POST", `${flowId}/sessions`, { userId: CLI_USER });
      rows[flowId] = {
        cli: cli.ok ? `ok ${cli.userId}@${cli.orgId}` : `refused ${cli.status}`,
        http: http.status < 300 ? `ok ${http.json?.session?.userId}@${http.json?.session?.orgId}` : `refused ${http.status}`,
      };
    }
    console.log("[P3]", rows);
    // Control POC_HOST_RESOLVER=none: echo is ok cli-user@__fsd_default_org__, red here.
    expect(rows.echo.cli).toBe(`ok ${APP_USER}@${APP_ORG}`);
    // Control POC_CLI_FALLBACK=1: admin and digest become ok@placeholder while HTTP refuses, red here.
    for (const flowId of Object.keys(rows)) expect(rows[flowId].cli, flowId).toBe(rows[flowId].http);
  });

  it("P4 · a run under the resolved principal is readable through the app's router", async () => {
    const { runtime, router } = await app();
    const principal =
      process.env.POC_TODAY === "1"
        ? { ok: true as const, userId: CLI_USER, orgId: DEFAULT_ORG_ID }
        : await cliResolve(runtime, "echo");
    if (!principal.ok) throw new Error(`echo refused: ${principal.message}`);
    const run = await runAction({
      flow: runtime.registry.get("echo")!,
      actionName: "respond",
      input: { message: "hi" },
      userId: principal.userId,
      orgId: principal.orgId,
      sessionId: "cli-s4",
      stores: runtime.stores,
      runtimeConfig: runtime.runtimeConfig,
    });
    expect(run.error).toBeUndefined();
    const read = await call(router, "GET", "sessions/cli-s4");
    console.log("[P4]", { principal, readStatus: read.status, readOrg: read.json?.session?.orgId });
    // Control POC_TODAY=1 runs as the CLI does today: the app cannot read it, red here.
    expect(read.status).toBe(200);
    expect(read.json?.session?.orgId).toBe(APP_ORG);
  });

  it("P5 · a developer-named org stays out of the app's view", async () => {
    const { runtime, router } = await app();
    const named = process.env.POC_NAMED_ORG ?? "acme-local";
    const run = await runAction({
      flow: runtime.registry.get("echo")!,
      actionName: "respond",
      input: { message: "hi" },
      userId: APP_USER,
      orgId: named,
      sessionId: "cli-s5",
      stores: runtime.stores,
      runtimeConfig: runtime.runtimeConfig,
    });
    expect(run.error).toBeUndefined();
    const stored = await runtime.stores.session.get("cli-s5");
    const read = await call(router, "GET", "sessions/cli-s5");
    console.log("[P5]", { stored: stored?.orgId, readStatus: read.status });
    expect(stored?.orgId).toBe(named);
    // Control POC_NAMED_ORG=kitchen-sink names the app's own org: readable, red here.
    expect(read.status).not.toBe(200);
  });
});
