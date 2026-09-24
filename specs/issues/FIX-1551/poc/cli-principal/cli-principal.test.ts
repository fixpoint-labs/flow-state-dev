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
 *       app's action route gives an equivalent HTTP caller, flow by flow
 *   P4  the outcome: a run under P3's principal leaves a session the app's own
 *       router reads back
 *   P5  a developer-named org stays out of the app's view
 *   P6  today a custom network adapter can put `source: "cli"` on the context it
 *       resolves, whatever source it declared (characterization, Codex finding 1)
 *   P7  a mark only the in-process entry point can set closes P6 without
 *       changing what the CLI's own ask gets
 *   P8  today `--seed-session` rewrites a same-org, other-user session before the
 *       run refuses it (characterization, Codex finding 2)
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
  echoFlow,
  hostResolver,
  hostResolverEnabled,
  makeAdapterApp,
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
    const statuses: Record<string, { cli: unknown; http: number }> = {};
    for (const flowId of ["echo", "admin", "digest"]) {
      const cli = await cliResolve(runtime, flowId);
      // The action route the CLI's run stands in for, with the same action and input.
      const http = await call(router, "POST", `${flowId}/actions/respond`, {
        userId: CLI_USER,
        input: { message: "hi" },
      });
      // Accepted: read who the request ran as from its own record. Refused: compare the
      // host's refusal message, not the status — the action route maps the host's
      // missing-user 401 to a legacy 400, and the CLI maps every refusal to one exit code.
      let request: { userId?: string; orgId?: string } | undefined;
      if (http.status < 300 && typeof http.json?.request?.id === "string") {
        // The route answers 202 and runs the action detached; wait for its record.
        for (let i = 0; i < 50 && request === undefined; i++) {
          request = (await runtime.stores.request.get(http.json.request.id)) as typeof request;
          if (request === undefined) await new Promise((r) => setTimeout(r, 10));
        }
      }
      rows[flowId] = {
        cli: cli.ok ? `ok ${cli.userId}@${cli.orgId}` : `refused: ${cli.message}`,
        http:
          http.status < 300
            ? `ok ${request?.userId}@${request?.orgId}`
            : `refused: ${http.json?.error}`,
      };
      statuses[flowId] = { cli: cli.ok ? "ok" : cli.status, http: http.status };
    }
    console.log("[P3]", rows, statuses);
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

  it("P6 · today a custom network adapter can stamp `source: \"cli\"` (characterization)", async () => {
    const stash: { host?: { resolvePrincipal: (ctx: PrincipalResolutionContext) => unknown } } = {};
    const flowState = makeAdapterApp(stash as never);
    open.push(flowState);
    await flowState.getRouter(); // adapters get their bindings, and the shared host, here
    const answer = await Promise.resolve(stash.host!.resolvePrincipal(networkContext()))
      .then((p) => ({ ok: true as const, p }))
      .catch((err: Error) => ({ ok: false as const, message: err.message }));
    console.log("[P6]", { adapterSource: "custom-ws", contextSource: "cli", answer });
    // The adapter declared `custom-ws`, not `cli`: refusing adapters that DECLARE `cli`
    // would not stop this. Control POC_CLI_BRANCH=0 (no cli branch): refused, red here.
    expect(answer).toEqual({ ok: true, p: { userId: "local-dev", orgId: "acme" } });
  });

  it("P7 · an in-process-only mark closes P6 and keeps the CLI's ask", async () => {
    const stash: { host?: { resolvePrincipal: (ctx: PrincipalResolutionContext) => unknown } } = {};
    const flowState = makeAdapterApp(stash as never);
    open.push(flowState);
    await flowState.getRouter();
    const resolveGuarded = guard(stash.host!.resolvePrincipal);
    const viaAdapter = await Promise.resolve(resolveGuarded(networkContext()))
      .then((p) => `ok ${JSON.stringify(p)}`)
      .catch((err: Error) => `refused: ${err.message}`);
    const viaCli = await inProcessAsk(resolveGuarded, {
      envelope: { flowKind: "echo", action: "respond", input: { message: "hi" } },
    }).then((p) => `ok ${JSON.stringify(p)}`, (err: Error) => `refused: ${err.message}`);
    console.log("[P7]", { viaAdapter, viaCli });
    // Control POC_NO_GUARD=1: the adapter gets the local identity again, red here.
    expect(viaAdapter).toMatch(/^refused: source "cli" is reserved/);
    expect(viaCli).toBe(`ok ${JSON.stringify({ userId: "local-dev", orgId: "acme" })}`);
  });

  it("P8 · today --seed-session rewrites another user's session before the run is refused (characterization)", async () => {
    const stores = createInMemoryStores();
    const owner = process.env.POC_SEED_OWNER ?? "alice";
    const flow = echoFlow(false);
    const first = await runAction({
      flow,
      actionName: "respond",
      input: { message: "hi" },
      userId: owner,
      orgId: DEFAULT_ORG_ID, // the org today's CLI runs in: same org, different user
      sessionId: "alice-s",
      stores,
      runtimeConfig: {},
    });
    expect(first.error).toBeUndefined();
    const before = await stores.session.get("alice-s");
    const run = await executeRunCommand("echo", "respond", {
      cwd: fixtureDir,
      input: '{"message":"hi"}',
      session: "alice-s",
      seedSession: '{"tampered":true}',
      stores,
      quiet: true,
    });
    const after = await stores.session.get("alice-s");
    console.log("[P8]", {
      owner,
      runSucceeded: run.success,
      error: run.error?.message,
      stateBefore: before?.state,
      stateAfter: after?.state,
    });
    // Control POC_SEED_OWNER=cli-user (the caller owns it): the run succeeds, red here.
    expect(run.success).toBe(false);
    // The finding: the seed landed on a record the run then refused to touch.
    expect(after?.state).toMatchObject({ tampered: true });
  });
});

/** What a custom adapter builds for a network request: no credential, `source: "cli"`. */
function networkContext(): PrincipalResolutionContext {
  return {
    source: "cli",
    request: new Request("http://poc.local/ws", { method: "POST" }),
    envelope: { flowKind: "echo", action: "respond", input: { message: "hi" } },
  };
}

/**
 * The mechanism sketch for S1. In the engine this is module-private state inside
 * the host's resolution (never exported, never `Symbol.for`): the only code that
 * can add to it is the in-process entry point, which network adapters never get.
 */
const inProcessAsks = new WeakSet<object>();

function guard(resolve: (ctx: PrincipalResolutionContext) => unknown) {
  return async (ctx: PrincipalResolutionContext) => {
    if (process.env.POC_NO_GUARD !== "1" && ctx.source === "cli" && !inProcessAsks.has(ctx)) {
      throw new Error('source "cli" is reserved for the in-process CLI ask');
    }
    return resolve(ctx);
  };
}

async function inProcessAsk(
  resolve: (ctx: PrincipalResolutionContext) => Promise<unknown>,
  partial: Omit<PrincipalResolutionContext, "source">,
) {
  const ctx: PrincipalResolutionContext = { ...partial, source: "cli" };
  inProcessAsks.add(ctx);
  return resolve(ctx);
}
