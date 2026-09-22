/**
 * FIX-1477 amendment 1 · premise proof, experiment 1 of 2.
 *
 * NOT production code and not part of any default test run. See README.md for
 * how to run it, what it observed, and its limits.
 *
 * The claim under test, quoted from the merged `DECISIONS.md → Open`:
 *
 *   "reading an org-scoped collection from the shell requires the shell's flow
 *    to resolve a principal, because without one a session's org is whatever
 *    the caller sent"
 *
 * These run the REAL router. Nothing is stubbed.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORG_ID,
  defineFlow,
  defineResourceCollection,
  handler
} from "@flow-state-dev/core";
import { z } from "zod";
import { createFlowApiRouter, createFlowRegistry, createInMemoryStores } from "../src";
import type { SessionRecord } from "../src";

const rowSchema = z.object({ label: z.string().default("") });

/** Org-scoped, shared across flows — the roster's and a channel board's config. */
function boardCollection() {
  return defineResourceCollection({
    pattern: "board/*",
    scope: "org",
    flowIsolation: false,
    stateSchema: rowSchema
  });
}

type Capture = { rows?: string[]; org?: string };

function actions(board: ReturnType<typeof boardCollection>, capture: Capture) {
  const seed = handler({
    name: "seed",
    inputSchema: z.object({ label: z.string() }),
    outputSchema: z.object({}),
    resources: { board },
    execute: async (input: { label: string }, ctx) => {
      const ref = ctx.resources.board as unknown as {
        create(k: string, v: { label: string }, o: { replace: boolean }): Promise<unknown>;
      };
      await ref.create(input.label, { label: input.label }, { replace: true });
      return {};
    }
  });

  const read = handler({
    name: "read",
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    resources: { board },
    execute: async (_input: unknown, ctx) => {
      const ref = ctx.resources.board as unknown as {
        list(): Promise<{ state: { label?: string } }[]>;
      };
      const refs = await ref.list();
      capture.rows = refs.map((r) => r.state?.label ?? "?").sort();
      capture.org = ctx.request.identity.orgId;
      return {};
    }
  });

  return { seed, read };
}

/** Authenticated flow: org comes from a verified header. Used only to PLANT victim data. */
function secureFlow(capture: Capture) {
  const board = boardCollection();
  const { seed, read } = actions(board, capture);
  return defineFlow({
    kind: "secure",
    resources: { board },
    actions: {
      seed: { inputSchema: z.object({ label: z.string() }), block: seed },
      read: { inputSchema: z.object({}), block: read }
    },
    authentication: {
      resolvePrincipal: (context) => {
        const org = context.request?.headers.get("x-verified-org");
        return org === null || org === undefined ? null : { userId: "planter", orgId: org };
      }
    }
  });
}

/** THE SHELL: no `authentication` at all. */
function shellFlow(capture: Capture) {
  const board = boardCollection();
  const { seed, read } = actions(board, capture);
  return defineFlow({
    kind: "shell",
    resources: { board },
    actions: {
      seed: { inputSchema: z.object({ label: z.string() }), block: seed },
      read: { inputSchema: z.object({}), block: read }
    }
  });
}

function build(capture: Capture) {
  const registry = createFlowRegistry();
  registry.register(secureFlow(capture));
  registry.register(shellFlow(capture));
  const stores = createInMemoryStores();
  // No host-level resolvePrincipal either: nothing authenticates anybody.
  return { router: createFlowApiRouter({ registry, stores }), stores };
}

type Router = ReturnType<typeof createFlowApiRouter>;

async function post(
  router: Router,
  path: string[],
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<Response> {
  const request = new Request(`http://localhost/api/flows/${path.join("/")}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream", ...headers },
    body: JSON.stringify(body)
  });
  const response = await router.POST(request, { params: { path } });
  if (response.body !== null) {
    const reader = response.body.getReader();
    while (!(await reader.read()).done) {
      /* drain */
    }
  }
  return response;
}

async function createShellSession(
  router: Router,
  body: Record<string, unknown>
): Promise<string> {
  const path = ["shell", "sessions"];
  const request = new Request(`http://localhost/api/flows/${path.join("/")}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const response = await router.POST(request, { params: { path } });
  const json = (await response.json()) as { session?: { id: string }; id?: string };
  const id = json.session?.id ?? json.id;
  if (id === undefined) throw new Error(`no session id in ${JSON.stringify(json)}`);
  return id;
}

describe("FIX-1477 premise · a shell session's org with no principal", () => {
  it("binds the session to DEFAULT_ORG_ID, not to the body's orgId", async () => {
    const capture: Capture = {};
    const { router, stores } = build(capture);

    const sessionId = await createShellSession(router, { userId: "u1", orgId: "victim-org" });

    const stored = (await stores.session.get(sessionId)) as SessionRecord | undefined;
    expect(stored, "session record").toBeDefined();
    // The premise says this should be "victim-org".
    expect(stored?.orgId).toBe(DEFAULT_ORG_ID);
    expect(stored?.orgId).not.toBe("victim-org");
  });

  it("cannot read another org's rows, whatever the caller sends", async () => {
    const capture: Capture = {};
    const { router } = build(capture);

    // Plant a row under victim-org through the AUTHENTICATED flow.
    await post(
      router,
      ["secure", "actions", "seed"],
      { userId: "planter", input: { label: "victim-row" } },
      { "x-verified-org": "victim-org" }
    );

    // Confirm the plant landed where we think it did.
    await post(
      router,
      ["secure", "actions", "read"],
      { userId: "planter", input: {} },
      { "x-verified-org": "victim-org" }
    );
    expect(capture.rows, "planted under victim-org").toEqual(["victim-row"]);

    // Now the shell, claiming victim-org every way a caller can.
    const sessionId = await createShellSession(router, { userId: "u1", orgId: "victim-org" });
    await post(
      router,
      ["shell", sessionId, "actions", "seed"],
      { userId: "u1", orgId: "victim-org", input: { label: "shell-row" } },
      { "x-verified-org": "victim-org", "x-org-id": "victim-org" }
    );
    await post(
      router,
      ["shell", sessionId, "actions", "read"],
      { userId: "u1", orgId: "victim-org", input: {} },
      { "x-verified-org": "victim-org", "x-org-id": "victim-org" }
    );

    expect(capture.org, "the org the shell ran under").toBe(DEFAULT_ORG_ID);
    expect(capture.rows, "what the shell can see").toEqual(["shell-row"]);
    expect(capture.rows).not.toContain("victim-row");
  });
});
