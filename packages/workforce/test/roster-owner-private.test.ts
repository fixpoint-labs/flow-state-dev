/**
 * The private roster is an owner-private collection.
 *
 * `defineHiredRosterPrivateCollection()` declares `ownerPrivate` on `owner`,
 * so Engine's generic fences keep each user-owned row with its owner. This
 * file holds the roster-shaped cases: which patterns a Workforce app is
 * refused (the characterization corpus the change was designed against),
 * rows stored before the change reading back unmigrated, and an app that
 * never installs Workforce paying nothing for it.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler, ownerSegment } from "@flow-state-dev/core";
import type { FlowInstance, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createFlowRegistry, createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { defineHiredRosterPrivateCollection } from "../src/roster";

const PRIVATE = "workforce/roster/[owner]/[seat]";

const overlap = (pattern: string): string =>
  `Collection pattern "${pattern}" can reach the rows of owner-private collection "${PRIVATE}". ` +
  `Only that collection reads or writes them, each for the user it belongs to.`;

/**
 * pattern → the complete refusal at the roster's `org` scope once the private
 * roster is registered, or `null` when admitted. The first twelve are the
 * characterization corpus: on the parent commit an app without Workforce was
 * refused the first eight at registration. The last is the hire-plane goal's
 * wide pattern.
 */
const CORPUS: ReadonlyArray<readonly [string, string | null]> = [
  ["workforce/roster/[owner]/notes", overlap("workforce/roster/[owner]/notes")],
  ["workforce/roster/**", overlap("workforce/roster/**")],
  ["workforce/**", overlap("workforce/**")],
  [PRIVATE, overlap(PRIVATE)],
  ["**", overlap("**")],
  ["[tenant]/**", overlap("[tenant]/**")],
  ["[a]/[b]/[c]/[d]", overlap("[a]/[b]/[c]/[d]")],
  ["*/**", overlap("*/**")],
  ["workforce/roster/*", null],
  ["files/**", null],
  ["[tenant]/notes/[id]", null],
  ["[a]/[b]/[c]", null],
  ["workforce/[area]/[owner]/[seat]", overlap("workforce/[area]/[owner]/[seat]")],
];

let n = 0;
/** A flow whose resources are set after definition, so registration is measured on its own. */
function flowWith(kind: string, resources: Record<string, unknown>): FlowInstance {
  n += 1;
  const flow = defineFlow({
    kind,
    actions: {
      ping: {
        inputSchema: z.object({}),
        block: handler({
          name: `ping-${n}`,
          inputSchema: z.object({}),
          outputSchema: z.object({ ok: z.boolean() }),
          execute: () => ({ ok: true }),
        }),
      },
    },
  })();
  (flow as { resources: unknown }).resources = resources;
  return flow;
}

const overlapping = (kind: string, pattern: string, scope = "org") => flowWith(kind, { wide: { pattern, scope } });

function refusal(run: () => void): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

describe("the roster corpus · an app without the private roster", () => {
  it.each(CORPUS)("defines and registers %s", (pattern) => {
    expect(() =>
      defineResourceCollection({ pattern, scope: "org", stateSchema: z.object({}).passthrough() })
    ).not.toThrow();
    const registry = createFlowRegistry();
    registry.register(overlapping(`app-${n}`, pattern));
    expect(registry.list()).toHaveLength(1);
  });
});

describe("the roster corpus · beside the private roster", () => {
  it.each(CORPUS)("private roster first, then %s: the complete message, or admitted", (pattern, message) => {
    const registry = createFlowRegistry();
    registry.register(flowWith("hires", { roster: defineHiredRosterPrivateCollection() }));
    expect(refusal(() => registry.register(overlapping("late", pattern)))).toBe(message);
    expect(registry.get("late") !== undefined).toBe(message === null);
  });

  it.each(CORPUS.filter(([, message]) => message !== null))(
    "%s first, then the private roster: refused, naming the earlier flow, and nothing changes",
    (pattern, message) => {
      const registry = createFlowRegistry();
      registry.register(overlapping("early", pattern));
      expect(refusal(() => registry.register(flowWith("hires", { roster: defineHiredRosterPrivateCollection() })))).toBe(
        `${message} Flow "early" declares it and is already registered.`
      );
      expect(registry.list().map((flow) => flow.id)).toEqual(["early"]);
    }
  );

  it("admits the private roster on several flows, and a collection in another scope whatever its pattern", () => {
    const registry = createFlowRegistry();
    registry.register(flowWith("hires-a", { roster: defineHiredRosterPrivateCollection() }));
    registry.register(flowWith("hires-b", { roster: defineHiredRosterPrivateCollection() }));
    registry.register(overlapping("session-wide", "[tenant]/**", "session"));
    expect(registry.list().map((flow) => flow.id)).toEqual(["hires-a", "hires-b", "session-wide"]);
  });
});

const verified = {
  resolvePrincipal: (context: { request?: Request }) => {
    const userId = context.request?.headers.get("x-verified-user");
    const orgId = context.request?.headers.get("x-verified-org");
    return userId && orgId ? { userId, orgId } : null;
  },
};

/** Boot `flows` over `stores`; `run` posts one action for `user` in org acme and waits for `probes/<tag>`. */
async function boot(flows: Record<string, FlowInstance>, stores: ReturnType<typeof inMemoryStores>) {
  const state = createFlowState({
    flows: flows as never,
    resolvePrincipal: verified.resolvePrincipal,
    stores: { default: { primary: stores } },
    modelResolver: createMockModelResolver({}),
  });
  const router = (await state.getRouter()) as Record<
    string,
    (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>
  >;
  const runtime = await state.getRuntime();
  const call = async (user: string, path: string[], body: unknown) => {
    const response = await router.POST!(
      new Request(`http://test/api/flows/${path.join("/")}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-verified-user": user, "x-verified-org": "acme" },
        body: JSON.stringify(body),
      }),
      { params: { path } }
    );
    return { status: response.status, json: await response.json() };
  };
  const run = async (flow: string, user: string, action: string, tag: string) => {
    const opened = await call(user, [flow, "sessions"], { userId: user });
    expect(opened.status).toBe(201);
    const posted = await call(user, [flow, opened.json.session.id, "actions", action], { userId: user, input: { tag } });
    expect(posted.status).toBe(202);
    let row: { state?: { seen?: string } } | undefined;
    for (let i = 0; i < 200 && row === undefined; i++) {
      row = await runtime.stores.resourceState.get("org", "acme", `probes/${tag}`);
      if (row === undefined) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return JSON.parse(row!.state!.seen!);
  };
  return { run };
}

const tagInput = z.object({ tag: z.string() });
const probes = defineResourceCollection({ pattern: "probes/*", scope: "org", stateSchema: z.object({ seen: z.string() }) });

async function plant(stores: ReturnType<typeof inMemoryStores>, rows: Record<string, unknown>) {
  const primary = await stores.resolve(["primary"]);
  for (const [key, state] of Object.entries(rows)) {
    await primary.resourceState!.set("org", "acme", key, state as never, "any");
  }
}

describe("rows stored before the private roster was owner-private", () => {
  it("read back for their owner through the private roster, a seat id beginning ~ included", async () => {
    const roster = defineHiredRosterPrivateCollection();
    const row = (seatId: string, instructions: string) => ({
      seatId,
      flow: "desk-clerk",
      settings: {},
      instructions,
      owningOrgId: "acme",
      ownerUserId: "alice",
    });
    const read = handler({
      name: "read-roster",
      inputSchema: tagInput,
      outputSchema: z.object({ ok: z.boolean() }),
      resources: { roster, probes },
      execute: async (input, ctx) => {
        const handle = ctx.resources.roster as unknown as ResourceCollectionRef;
        const owner = ownerSegment(ctx.session.identity.userId!);
        const seen = {
          list: (await handle.list()).map((entry) => entry.path).sort(),
          research: (await handle.getOptional({ owner, seat: "research" }))?.state.instructions ?? null,
          tilde: (await handle.getOptional({ owner, seat: "~research" }))?.state.instructions ?? null,
        };
        await (ctx.resources.probes as unknown as ResourceCollectionRef).create(input.tag, { seen: JSON.stringify(seen) });
        return { ok: true };
      },
    });
    const stores = inMemoryStores();
    await plant(stores, {
      "workforce/roster/~alice/research": row("research", "ALICE-RESEARCH"),
      "workforce/roster/~alice/~research": row("~research", "ALICE-TILDE"),
    });
    const app = await boot(
      {
        hires: defineFlow({
          kind: "hires",
          resources: { roster, probes },
          actions: { read: { inputSchema: tagInput, block: read } },
          authentication: verified,
        })(),
      },
      stores
    );

    expect(await app.run("hires", "alice", "read", "alice")).toEqual({
      list: ["workforce/roster/~alice/research", "workforce/roster/~alice/~research"],
      research: "ALICE-RESEARCH",
      tilde: "ALICE-TILDE",
    });
    expect(await app.run("hires", "bob", "read", "bob")).toEqual({ list: [], research: null, tilde: null });
  });
});

/**
 * An app that never installs Workforce, end to end through `createFlowState`
 * and the HTTP router. It declares collections whose patterns reach the
 * roster's user-owned rows, writes and lists through them, and starts. The
 * store already holds another member's user-owned row, as a store shared with
 * a Workforce app would; the app's lists never show it. The same flow beside
 * the private roster refuses to start. No model call is involved.
 */
describe("an app without Workforce", () => {
  const notesSchema = z.object({ text: z.string() }).passthrough();
  const resources = {
    tenantNotes: defineResourceCollection({
      pattern: "[tenant]/**",
      scope: "org",
      flowIsolation: false,
      stateSchema: notesSchema,
    }),
    rosterNotes: defineResourceCollection({
      pattern: "workforce/roster/[owner]/notes",
      scope: "org",
      flowIsolation: false,
      stateSchema: notesSchema,
    }),
    probes,
  };
  const writeAndList = handler({
    name: "write-and-list",
    inputSchema: tagInput,
    outputSchema: z.object({ ok: z.boolean() }),
    resources,
    execute: async (input, ctx) => {
      const tenant = ctx.resources.tenantNotes as unknown as ResourceCollectionRef;
      const roster = ctx.resources.rosterNotes as unknown as ResourceCollectionRef;
      await tenant.create({ tenant: "acme" }, { text: "tenant note" });
      await roster.create({ owner: "team" }, { text: "team note" });
      const paths = [...(await tenant.list()), ...(await roster.list())].map((entry) => entry.path).sort();
      await (ctx.resources.probes as unknown as ResourceCollectionRef).create(input.tag, { seen: JSON.stringify(paths) });
      return { ok: true };
    },
  });
  const app = () =>
    defineFlow({
      kind: "app",
      resources,
      actions: { write: { inputSchema: tagInput, block: writeAndList } },
      authentication: verified,
    })();

  it("starts, writes and lists through roster-shaped patterns, and never lists a user-owned row", async () => {
    const stores = inMemoryStores();
    await plant(stores, {
      "workforce/roster/~alice/research": { text: "ALICE-PRIVATE" },
      "workforce/roster/~alice/notes": { text: "ALICE-PRIVATE" },
    });
    const started = await boot({ app: app() }, stores);
    // `[tenant]/**` is parameterized, so the matcher reads its `**` as a
    // literal segment: the note it creates is stored at `acme/**`.
    expect(await started.run("app", "bob", "write", "bob")).toEqual(["acme/**", "workforce/roster/team/notes"]);
  });

  it("the same flow beside the private roster refuses to start", async () => {
    const hires = flowWith("hires", { roster: defineHiredRosterPrivateCollection() });
    await expect(boot({ hires, app: app() }, inMemoryStores())).rejects.toThrow(overlap("[tenant]/**"));
  });
});
