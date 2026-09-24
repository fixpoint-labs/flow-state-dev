/**
 * The in-process principal answer (FIX-1551): who `fsdev run` / `fsdev chat`
 * is, asked through the same resolution every inbound host uses, and the
 * reservation of `source: "cli"` for that one entry point.
 *
 * Why these matter:
 *   - The CLI answering for itself is how a terminal run and the app's own
 *     routes came to disagree about which organization a run is in. The answer
 *     must be the host's, precedence and organization rules included.
 *   - A resolver may hand a terminal a credential-free identity by branching on
 *     `source === "cli"`. If any transport adapter could put that source on a
 *     network request, that branch would be an unauthenticated door. The host
 *     is shared and adapters build their own contexts, so only a mark the
 *     adapter cannot set closes it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createBearerSecretPrincipalResolver,
  createFlowRegistry,
  createFlowState,
  inMemoryStores,
  resolveInProcessPrincipal,
  type InboundTransportAdapter,
  type InboundTransportHost,
  type PrincipalResolutionContext,
  type PrincipalResolver
} from "../../src";

const echoInput = z.object({ message: z.string() });

function flow(kind: string, authentication?: Parameters<typeof defineFlow>[0]["authentication"]) {
  return defineFlow({
    kind,
    authentication,
    actions: {
      respond: {
        inputSchema: echoInput,
        block: handler({
          name: `${kind}-respond`,
          inputSchema: echoInput,
          outputSchema: z.object({ reply: z.string() }),
          execute: async (input) => ({ reply: input.message })
        })
      }
    }
  })();
}

const question = (flowKind: string, userId = "cli-user") => ({
  flowKind,
  action: "respond",
  input: { message: "hi" },
  userId
});

/** Refusal message, or the answer — so a test compares outcomes, not throws. */
async function outcome(p: Promise<unknown>): Promise<string> {
  return p.then(
    (v) => `ok ${JSON.stringify(v)}`,
    (err: Error) => `refused: ${err.message}`
  );
}

describe("resolveInProcessPrincipal · the host's own answer", () => {
  it("returns the host resolver's organization for a flow with no resolver of its own", async () => {
    const app = createFlowState({
      flows: { echo: flow("echo") },
      stores: { default: { primary: inMemoryStores() } },
      resolvePrincipal: () => ({ userId: "devuser", orgId: "kitchen-sink" })
    });
    await expect(app.resolveInProcessPrincipal(question("echo"))).resolves.toEqual({
      userId: "devuser",
      orgId: "kitchen-sink",
      from: "resolver"
    });
  });

  it("asks the flow's own resolver before the host's, as the routes do", async () => {
    const app = createFlowState({
      flows: {
        own: flow("own", { resolvePrincipal: () => ({ userId: "flow-user", orgId: "flow-org" }) })
      },
      stores: { default: { primary: inMemoryStores() } },
      resolvePrincipal: () => ({ userId: "devuser", orgId: "kitchen-sink" })
    });
    await expect(app.resolveInProcessPrincipal(question("own"))).resolves.toEqual({
      userId: "flow-user",
      orgId: "flow-org",
      from: "resolver"
    });
  });

  it("with no resolver anywhere, keeps the caller-named user in the development organization", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const app = createFlowState({
      flows: { echo: flow("echo") },
      stores: { default: { primary: inMemoryStores() } },
      logger
    });
    await expect(app.resolveInProcessPrincipal(question("echo", "alice"))).resolves.toEqual({
      userId: "alice",
      orgId: DEFAULT_ORG_ID,
      from: "development-default"
    });
    // The CLI reports the identity it used itself; the host's once-per-deployment
    // warning would be a second, redundant line on every terminal run.
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("answers a bare registry the same way (the discovery path)", async () => {
    const registry = createFlowRegistry();
    registry.register(flow("echo"));
    await expect(resolveInProcessPrincipal({ registry }, question("echo"))).resolves.toEqual({
      userId: "cli-user",
      orgId: DEFAULT_ORG_ID,
      from: "development-default"
    });
  });

  it("refuses a resolver that claims the placeholder organization, as the host does", async () => {
    const app = createFlowState({
      flows: { echo: flow("echo") },
      stores: { default: { primary: inMemoryStores() } },
      resolvePrincipal: () => ({ userId: "x", orgId: DEFAULT_ORG_ID })
    });
    expect(await outcome(app.resolveInProcessPrincipal(question("echo")))).toMatch(
      /^refused: Request requires a verified organization: "__fsd_default_org__" is reserved/
    );
  });

  it("refuses a credential-checking flow: the terminal carries no credential", async () => {
    const app = createFlowState({
      flows: {
        admin: flow("admin", {
          resolvePrincipal: createBearerSecretPrincipalResolver({
            secret: "s3cret",
            principal: { userId: "admin", orgId: "kitchen-sink" }
          })
        })
      },
      stores: { default: { primary: inMemoryStores() } }
    });
    expect(await outcome(app.resolveInProcessPrincipal(question("admin")))).toBe(
      "refused: Action request requires non-empty userId"
    );
  });

  it("hands the resolver a terminal's question: source cli, no request, the caller-named user", async () => {
    const seen: PrincipalResolutionContext[] = [];
    const app = createFlowState({
      flows: { echo: flow("echo") },
      stores: { default: { primary: inMemoryStores() } },
      resolvePrincipal: (ctx) => {
        seen.push(ctx);
        return { userId: "u", orgId: "o" };
      }
    });
    await app.resolveInProcessPrincipal(question("echo", "bob"));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      source: "cli",
      envelope: { flowKind: "echo", action: "respond", input: { message: "hi" }, metadata: { body: { userId: "bob" } } }
    });
    expect(seen[0]!.request).toBeUndefined();
  });
});

describe("source \"cli\" is reserved for the in-process entry point", () => {
  /** A resolver that gives a terminal a local identity with no credential. */
  const cliBranch: PrincipalResolver = (ctx) =>
    ctx.source === "cli" ? { userId: "local-dev", orgId: "acme" } : null;

  /** A custom adapter that declares its own source and keeps the shared host. */
  function stashingAdapter(stash: { host?: InboundTransportHost }): InboundTransportAdapter {
    return {
      source: "custom-ws",
      createBindings(host) {
        stash.host = host;
        return {};
      }
    };
  }

  it("refuses an adapter-built context stamped cli, whatever source the adapter declared", async () => {
    const stash: { host?: InboundTransportHost } = {};
    const app = createFlowState({
      flows: { echo: flow("echo") },
      stores: { default: { primary: inMemoryStores() } },
      resolvePrincipal: cliBranch,
      adapters: [stashingAdapter(stash)]
    });
    await app.getRouter();
    const networkRequest: PrincipalResolutionContext = {
      source: "cli",
      request: new Request("http://app.local/ws", { method: "POST" }),
      envelope: { flowKind: "echo", action: "respond", input: { message: "hi" } }
    };
    expect(await outcome(Promise.resolve(stash.host!.resolvePrincipal(networkRequest)))).toMatch(
      /^refused: source "cli" is reserved for the engine's in-process entry point/
    );
    // The same app still answers its own terminal.
    await expect(app.resolveInProcessPrincipal(question("echo"))).resolves.toEqual({
      userId: "local-dev",
      orgId: "acme",
      from: "resolver"
    });
    await app.dispose();
  });

  it("refuses a copy of an in-process context: the mark is the object, not its fields", async () => {
    let captured: PrincipalResolutionContext | undefined;
    const stash: { host?: InboundTransportHost } = {};
    const app = createFlowState({
      flows: { echo: flow("echo") },
      stores: { default: { primary: inMemoryStores() } },
      resolvePrincipal: (ctx) => {
        captured ??= ctx;
        return cliBranch(ctx);
      },
      adapters: [stashingAdapter(stash)]
    });
    await app.getRouter();
    await app.resolveInProcessPrincipal(question("echo"));
    expect(await outcome(Promise.resolve(stash.host!.resolvePrincipal({ ...captured! })))).toMatch(
      /^refused: source "cli" is reserved/
    );
    await app.dispose();
  });

  it("no engine route calls the in-process entry point", () => {
    const routesDir = resolve(import.meta.dirname, "../../src/routes");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith(".ts")) files.push(path);
      }
    };
    walk(routesDir);
    expect(files.length).toBeGreaterThan(0);
    const callers = files.filter((f) => readFileSync(f, "utf-8").includes("resolveInProcessPrincipal"));
    expect(callers).toEqual([]);
  });
});
