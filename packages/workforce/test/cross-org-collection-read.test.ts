/**
 * Opening a collection to the browser must open exactly what was intended
 * (FIX-1477 S5, S6, BR-19, BR-21, BR-24).
 *
 * The roster and a channel's board ledger both gained a `client` block so a
 * `Roster` and a `BoardColumns` panel can read them at all — before that, the
 * collection-state route refused every read with `403 State read not
 * permitted`, and an action's return value has no path to a browser, so there
 * was no other door. Opening that door raises two separate questions, and this
 * file answers them separately because one cannot stand in for the other:
 *
 *  1. **Whose rows come back?** The route resolves rows through the SESSION's
 *     stored `orgId` (`getPersistedData` → `resourceScopeIds(session.orgId, …)`),
 *     and a session binds its org from the resolved principal at creation
 *     (`handleCreateSession`: `ctx.principal?.orgId ?? DEFAULT_ORG_ID`, with
 *     `body.orgId` never consulted). So the isolation tests authenticate as
 *     `org-a` while claiming `org-b` in every place a caller can put it — the
 *     session-create body, the read's query string, and two headers.
 *     **Red state, observed:** point the read's org resolution at another org
 *     (`resourceScopeIds(session.orgId, …)` in `resources/internal.ts`) and
 *     `reads only its own org's rows` fails with
 *     `expected [ 'victim.bob' ] to deeply equal [ 'support.ada' ]` — the
 *     org-A reader naming org-B's seat, which is the claim itself.
 *
 *     Worth recording because it surprised: making `handleCreateSession`
 *     prefer `body.orgId` does NOT produce that red state. It fails earlier
 *     with a `403`, because a session whose stored org disagrees with the
 *     request's principal is refused before any row is read. That is defence
 *     in depth working, and it is why the mutation above is aimed at the read
 *     rather than at the binding.
 *
 *  2. **Which FIELDS come back?** `resolveClientProjection` returns the stored
 *     state *unchanged* when a `client` block declares no `data`, `expose` or
 *     `exclude`. A bare `{ state: { read: true } }` would therefore publish the
 *     whole row: the roster's `settings` passthrough bag, and a task
 *     envelope's `claimedBy`, `leaseUntil`, `retryLedger` and `writeLog` —
 *     server-set execution internals that `channelBoardRowSchema` withholds
 *     even from a model. Both declarations carry an explicit `expose`
 *     (BP-015). **Red state:** drop either `expose` and the
 *     `publishes no execution internals` test fails, naming the leaked key.
 *
 * Scope, not `flowIsolation`, is the axis the org half rests on (BP-027 is a
 * different concern): both collections are org-scoped, so their rows are shared
 * within the org by construction. `both panel collections are org-scoped` pins
 * that, because the opt-in's justification dissolves if either is ever moved to
 * user scope.
 *
 * The engine's own unauthenticated-binding regression lives in
 * `packages/engine/test/principal-org-spoofing.test.ts` and covers the ACTION
 * path. This covers the collection-state READ route, which that file does not
 * touch and which is the only path these two panels use.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { z } from "zod";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { defineHiredRosterCollection } from "../src/roster/collections";
import { channelBoard, CHANNEL_BOARD_CLIENT_FIELDS } from "../src/channel/channel-board";
import { channelBoardRowSchema } from "../src/channel/channel-flow";
import {
  CHANNEL_KIND,
  channelInstances,
  defineSeatInventoryCollection,
  openChannels,
  openInventory,
  type ChannelManifest
} from "../src/index";
import {
  createSeatHireBlocks,
  HIRED_ROSTER_RESOURCE,
  SEAT_INVENTORY_RESOURCE
} from "../src/seat-hire-blocks";

/**
 * Resource-map keys must be slash-free — they are one path segment in
 * `/sessions/:id/resources/:ref`, so `workforce/roster` would 404 on
 * segmentation. Distinct from the collection's `workforce/roster/*` PATTERN,
 * which is a storage-key shape and may contain slashes.
 */
const ROSTER_REF = "roster";
const BOARD_REF = "eng.feature.triage";
const FLOW_KIND = "workforce-panels";

const rosterCollection = defineHiredRosterCollection();
const boardLedger = channelBoard("eng.feature", "triage");

/** Execution internals a task envelope carries and a board card must never receive. */
const EXECUTION_INTERNALS = ["claimedBy", "leaseUntil", "retryLedger", "writeLog"] as const;

/**
 * Plants one roster row and one board row in whatever org the running session
 * is bound to. Deliberately an ACTION rather than a direct store write: the
 * rows have to land through the same org resolution the read uses, or the test
 * would be asserting against a fixture it placed by hand.
 *
 * Every row carries a marker in the fields that must not be published, so a
 * leak shows up as the marker rather than as a missing key.
 */
const seed = handler({
  name: "seed",
  inputSchema: z.object({ seatId: z.string(), goal: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  resources: { [ROSTER_REF]: rosterCollection, [BOARD_REF]: boardLedger },
  execute: async (input, ctx) => {
    const roster = ctx.resources[ROSTER_REF] as ResourceCollectionRef<Record<string, unknown>>;
    const board = ctx.resources[BOARD_REF] as ResourceCollectionRef<Record<string, unknown>>;
    await roster.create(input.seatId, {
      seatId: input.seatId,
      flow: "agent",
      settings: { apiKey: "LEAKED-SETTINGS" },
      instructions: null
    });
    await board.create(`task-${input.seatId}`, {
      id: `task-${input.seatId}`,
      goal: input.goal,
      status: "pending",
      attempts: 0,
      createdAt: 1,
      updatedAt: 1,
      // Valid shapes, so the envelope actually stores them — a row the write
      // rejected would make the projection check unable to fire.
      claimedBy: { sessionId: "LEAKED-CLAIMEDBY", requestId: "req-x" },
      leaseUntil: 99999,
      retryLedger: { granted: 7, deniedByBudget: true },
      writeLog: [{ id: "LEAKED-WRITELOG", revision: 3 }],
      metadata: { secret: "LEAKED-METADATA" }
    });
    return { ok: true };
  }
});

/** Identity from a verified header — never from the body. Stands in for a real verifier. */
function panelFlow() {
  return defineFlow({
    kind: FLOW_KIND,
    resources: { [ROSTER_REF]: rosterCollection, [BOARD_REF]: boardLedger },
    actions: {
      seed: { inputSchema: z.object({ seatId: z.string(), goal: z.string() }), block: seed }
    },
    authentication: {
      resolvePrincipal: (context) => {
        const org = context.request?.headers.get("x-verified-org");
        return org === null || org === undefined ? null : { userId: `user-of-${org}`, orgId: org };
      }
    }
  });
}

type Harness = {
  post: (path: string[], body: unknown, headers?: Record<string, string>) => Promise<Answer>;
  get: (path: string[], query?: string, headers?: Record<string, string>) => Promise<Answer>;
};
type Answer = { status: number; json: any };

async function buildHarness(): Promise<Harness> {
  const state = createFlowState({
    flows: { [FLOW_KIND]: panelFlow() },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({})
  });
  const router = (await state.getRouter()) as any;

  const call = async (
    method: "GET" | "POST",
    path: string[],
    query: string,
    body: unknown,
    headers: Record<string, string>
  ): Promise<Answer> => {
    const response = await router[method](
      new Request(`http://test/api/flows/${path.join("/")}${query}`, {
        method,
        headers: { "content-type": "application/json", ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      }),
      { params: { path } }
    );
    const text = await response.text();
    return { status: response.status, json: text.length > 0 ? JSON.parse(text) : undefined };
  };

  return {
    post: (path, body, headers = {}) => call("POST", path, "", body, headers),
    get: (path, query = "", headers = {}) => call("GET", path, query, undefined, headers)
  };
}

/** Creates a session as `org`, while the BODY claims `claimsOrg`. */
async function openSession(h: Harness, org: string, claimsOrg: string): Promise<string> {
  const { status, json } = await h.post(
    [FLOW_KIND, "sessions"],
    { userId: `user-of-${org}`, orgId: claimsOrg },
    { "x-verified-org": org }
  );
  if (status >= 400) throw new Error(`createSession ${status}: ${JSON.stringify(json)}`);
  const id = json.session?.id ?? json.id;
  if (id === undefined) throw new Error(`no session id in ${JSON.stringify(json)}`);
  return id;
}

/**
 * Drives the seed action for one org and waits for it to finish.
 *
 * The action route answers `202 in_progress` and runs the handler afterwards,
 * so a read taken straight after the POST would find the collection empty and
 * "prove" isolation by racing the writer rather than by the org boundary.
 */
async function plant(h: Harness, org: string, seatId: string, goal: string): Promise<void> {
  const sessionId = await openSession(h, org, org);
  const { status, json } = await h.post(
    [FLOW_KIND, sessionId, "actions", "seed"],
    { userId: `user-of-${org}`, input: { seatId, goal } },
    { "x-verified-org": org }
  );
  if (status >= 400) throw new Error(`seed ${status}: ${JSON.stringify(json)}`);

  const requestId = json.request?.id;
  if (requestId === undefined) throw new Error(`no request id in ${JSON.stringify(json)}`);
  for (let attempt = 0; attempt < 300; attempt++) {
    const polled = await h.get([FLOW_KIND, "requests", requestId, "status"], "", {
      "x-verified-org": org
    });
    const seen = polled.json?.status;
    if (seen === "completed") return;
    if (seen === "errored" || seen === "cancelled" || seen === "failed") {
      throw new Error(`seed request ${seen}: ${JSON.stringify(polled.json)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("seed request never reached a terminal status");
}

/** Reads a collection through the real client-facing route. */
function readCollection(
  h: Harness,
  sessionId: string,
  ref: string,
  query = "",
  headers: Record<string, string> = {}
): Promise<Answer> {
  return h.get(["sessions", sessionId, "resources", ref], query, headers);
}

describe("FIX-1477 · the panel collections' client read", () => {
  it("the browser's board fields stay a subset of the model's", () => {
    // `CHANNEL_BOARD_CLIENT_FIELDS` cannot import `channelBoardRowSchema` —
    // the module dependency runs the other way — so the relationship between
    // the two allowlists is asserted here instead of expressed in a type. Add
    // an execution coordinate to the browser's list and this fails by naming
    // it, which is the drift that would otherwise be silent.
    const modelFields = new Set(Object.keys(channelBoardRowSchema.shape));
    const extra = CHANNEL_BOARD_CLIENT_FIELDS.filter((field) => !modelFields.has(field));
    expect(extra, "browser-only board fields the model's allowlist does not publish").toEqual([]);
  });

  it("both panel collections are org-scoped, which is what the opt-in rests on", () => {
    const roster = rosterCollection as unknown as { scope?: string };
    const board = boardLedger as unknown as { scope?: string };
    expect(roster.scope, "the hired roster's scope").toBe("org");
    expect(board.scope, "a channel board ledger's scope").toBe("org");
  });

  it("an org's own member can read both collections at all", async () => {
    const h = await buildHarness();
    await plant(h, "org-a", "support.ada", "ship the thing");
    const sessionId = await openSession(h, "org-a", "org-a");

    for (const ref of [ROSTER_REF, BOARD_REF]) {
      const { status, json } = await readCollection(h, sessionId, ref, "", {
        "x-verified-org": "org-a"
      });
      expect(status, `${ref} read status`).toBe(200);
      expect(json.items.length, `${ref} rows`).toBe(1);
    }
  });

  it("reads only its own org's rows, whatever the caller claims", async () => {
    const h = await buildHarness();

    // Two orgs, each with a seat and a task of its own.
    await plant(h, "org-b", "victim.bob", "VICTIM-GOAL");
    await plant(h, "org-a", "support.ada", "OWN-GOAL");

    // Authenticated as org-a, but the create body claims org-b…
    const sessionId = await openSession(h, "org-a", "org-b");
    // …and the read claims org-b again, in the query string and in two headers.
    const steer = {
      "x-verified-org": "org-a",
      "x-org-id": "org-b",
      "x-organization": "org-b"
    };

    const roster = await readCollection(h, sessionId, ROSTER_REF, "?orgId=org-b", steer);
    const board = await readCollection(h, sessionId, BOARD_REF, "?orgId=org-b", steer);

    expect(roster.status).toBe(200);
    expect(board.status).toBe(200);

    const seatIds = roster.json.items.map((i: any) => i.clientData?.seatId);
    const goals = board.json.items.map((i: any) => i.clientData?.goal);

    expect(seatIds, "the seats an org-a session may see").toEqual(["support.ada"]);
    expect(seatIds).not.toContain("victim.bob");
    expect(goals, "the tasks an org-a session may see").toEqual(["OWN-GOAL"]);
    expect(goals).not.toContain("VICTIM-GOAL");

    // The same claim over the raw payload, so a shape change in `clientData`
    // cannot quietly turn the two assertions above into no-ops.
    expect(JSON.stringify(roster.json)).not.toContain("victim");
    expect(JSON.stringify(board.json)).not.toContain("VICTIM-GOAL");
  });

  // The two projection cases are separate `it`s on purpose: a single case
  // asserting both would stop at whichever leak came first, so dropping one
  // `expose` would show the other's red state and hide its own.
  it("a board card carries no execution internals", async () => {
    const h = await buildHarness();
    await plant(h, "org-a", "support.ada", "ship the thing");
    const sessionId = await openSession(h, "org-a", "org-a");

    const board = await readCollection(h, sessionId, BOARD_REF, "", {
      "x-verified-org": "org-a"
    });

    // Key by key, so a failure names which internal escaped rather than
    // diffing a whole row.
    const card = board.json.items[0].clientData as Record<string, unknown>;
    for (const field of EXECUTION_INTERNALS) {
      expect(card, `board card must not carry "${field}"`).not.toHaveProperty(field);
    }
    // Markers too, so a leak arriving under a renamed key is still caught.
    for (const marker of ["LEAKED-CLAIMEDBY", "LEAKED-WRITELOG", "LEAKED-METADATA"]) {
      expect(JSON.stringify(board.json), `board payload leaked ${marker}`).not.toContain(marker);
    }
    // …and the card still carries what a column renders, so the projection
    // cannot pass by publishing nothing.
    expect(card.goal, "the card still carries what it renders").toBe("ship the thing");
    expect(card.status).toBe("pending");
  });

  it("a roster row carries no settings bag", async () => {
    const h = await buildHarness();
    await plant(h, "org-a", "support.ada", "ship the thing");
    const sessionId = await openSession(h, "org-a", "org-a");

    const roster = await readCollection(h, sessionId, ROSTER_REF, "", {
      "x-verified-org": "org-a"
    });

    // `settings` is passthrough by contract — a flow kind's own config bag,
    // free to grow keys this package has never heard of.
    expect(roster.json.items[0].clientData).toEqual({
      seatId: "support.ada",
      flow: "agent",
      instructions: null
    });
    expect(JSON.stringify(roster.json)).not.toContain("LEAKED-SETTINGS");
  });
});

// ---------------------------------------------------------------------------
// FIX-1502 · the live inventory's browser read (V1, V2, V5)
// ---------------------------------------------------------------------------

/**
 * The inventory half, on the path an app actually runs: the real channel kind
 * built by `channelInstances({ inventory: true })`, channels opened over the
 * real session route by `openChannels`, rows written by `openInventory` through
 * the real writer, and every read through the real collection-state route.
 *
 * Two organizations, with DIFFERENT channel and seat ids. Identical rows in
 * both would make a read that leaks look isolated: the org-a session would get
 * org-b's rows back and they would compare equal.
 *
 * Each case asserts the rows are STORED for both organizations (straight out of
 * org storage, never through the route) before it judges what the route
 * returns, so an empty read cannot pass as an isolated one.
 *
 * **Red states, observed:**
 * - Drop the `client` line from `defineSeatInventoryCollection`: the manifest
 *   stops listing it, so V1 fails with `org-a seat read — the manifest lists no
 *   such collection`, V2 with `inventory/seats/* on a channel with the
 *   inventory on: expected undefined to be defined`, and V5 (which names the
 *   ref directly) with `expected 403 to be 200`.
 * - Drop `expose` from the channel inventory's `client` and the BR-5 case fails
 *   with `a channels row must not carry "secret"`.
 * - Point the route's org read at another org (`resourceScopeIds` in
 *   `resources/internal.ts`, as in the header above) and V1 fails with
 *   `org-a's seats: expected [ 'beta.analyst', 'beta.lead' ] to deeply equal
 *   [ 'alpha.coder', 'alpha.lead' ]` — the other org's seats, by id.
 */

const INV_USER = "u_boot";

/** Org -> the channel it opens and the seats it hires. No id appears in both. */
const INVENTORY_ORGS = {
  "org-a": { channel: "alpha.room", seats: ["alpha.lead", "alpha.coder"] },
  "org-b": { channel: "beta.room", seats: ["beta.lead", "beta.analyst"] }
} as const;
type InvOrg = keyof typeof INVENTORY_ORGS;
const INV_ORGS = Object.keys(INVENTORY_ORGS) as InvOrg[];

type InventoryHarness = Harness & {
  runtime: any;
  /** Every inventory row physically stored for one org, keyed by storage key. */
  stored: (org: string) => Promise<Record<string, Record<string, unknown>>>;
};

/** The same verified-header resolver the panel flow uses, as a standalone function. */
function verifiedHeaderPrincipal(userId: (org: string) => string) {
  return (context: any) => {
    const org = context.request?.headers.get("x-verified-org");
    return org === null || org === undefined ? null : { userId: userId(org), orgId: org };
  };
}

/** A `Harness` over one router. */
function harnessOver(router: any): Harness {
  const call = async (
    method: "GET" | "POST",
    path: string[],
    query: string,
    body: unknown,
    headers: Record<string, string>
  ): Promise<Answer> => {
    const response = await router[method](
      new Request(`http://test/api/flows/${path.join("/")}${query}`, {
        method,
        headers: { "content-type": "application/json", ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      }),
      { params: { path } }
    );
    const text = await response.text();
    return { status: response.status, json: text.length > 0 ? JSON.parse(text) : undefined };
  };
  return {
    post: (path, body, headers = {}) => call("POST", path, "", body, headers),
    get: (path, query = "", headers = {}) => call("GET", path, query, undefined, headers)
  };
}

/**
 * Stand the channel kind up behind a verified-header resolver, open each org's
 * channel over the session route, and fill each org's inventory.
 *
 * @param options.inventory Build the channel kind with the inventory on (the
 *   default) or off — V2's other state.
 * @param options.fill Run `openInventory` for both orgs. Off for V2's
 *   manifest-only cases.
 */
async function buildInventoryHarness(
  options: { inventory?: boolean; fill?: boolean } = {}
): Promise<InventoryHarness> {
  const records: ChannelManifest[] = INV_ORGS.map((org) => ({
    id: INVENTORY_ORGS[org].channel,
    declared: { members: [...INVENTORY_ORGS[org].seats] },
    body: "Charter."
  }));
  const instances = channelInstances(records, { inventory: options.inventory ?? true });
  const byKind: Record<string, any> = Object.fromEntries(
    instances.map((instance) => [instance.kind, instance])
  );
  const state = createFlowState({
    flows: byKind,
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({}),
    // Host-level, because the built-in channel kind carries no authentication
    // of its own. The org comes from a verified header, never the body.
    resolvePrincipal: verifiedHeaderPrincipal(() => INV_USER)
  } as never);
  const runtime = await state.getRuntime();
  const h: InventoryHarness = {
    ...harnessOver(await state.getRouter()),
    runtime,
    stored: async (org) =>
      Object.fromEntries(
        Object.entries(
          await runtime.stores.resourceState.getByPrefix("org", org, "inventory/")
        ).map(([key, entry]: [string, any]) => [key, entry.state])
      )
  };

  for (const org of INV_ORGS) {
    const record = records.find((r) => r.id === INVENTORY_ORGS[org].channel)!;
    // Opened over the real session route, as the org's own principal.
    await openChannels([record], {
      client: {
        createSession: async (create) => {
          const { status, json } = await h.post([create.flowKind, "sessions"], create, {
            "x-verified-org": org
          });
          if (status >= 400) {
            throw Object.assign(new Error(`create ${status}: ${JSON.stringify(json)}`), { status });
          }
          return json;
        },
        getSession: async (sessionId) => {
          const { json } = await h.get(["sessions", sessionId], "", { "x-verified-org": org });
          return json.session ?? json;
        },
        deleteSession: async () => {}
      },
      userId: INV_USER
    });
    if (options.fill === false) continue;

    const binding = await openInventory(
      { seats: INVENTORY_ORGS[org].seats.map((id) => ({ id, kind: "agent" })), channels: [record] },
      {
        run: async (request) => {
          const result: any = await runAction({
            flow: byKind[request.flowKind],
            actionName: request.action,
            input: request.input,
            userId: request.userId,
            orgId: request.orgId,
            sessionId: request.sessionId,
            source: request.source,
            stores: runtime.stores,
            runtimeConfig: { ...runtime.runtimeConfig }
          } as never);
          if (result?.error !== undefined) {
            throw result.error instanceof Error ? result.error : new Error(String(result.error));
          }
          return result;
        },
        // One seat-writer session per org: the default id is one per store,
        // and two orgs writing through one session would be one org's session.
        seatWriter: { flowKind: CHANNEL_KIND, sessionId: `inventory-binder-${org}` },
        userId: INV_USER,
        orgId: org
      }
    );
    if (binding.problems.length > 0) {
      throw new Error(`openInventory for ${org}: ${binding.problems.join("; ")}`);
    }
  }
  return h;
}

/** The refs a session's manifest gives the three collections, found by pattern. */
async function inventoryRefs(h: Harness, sessionId: string, org: string) {
  const { status, json } = await h.get(["sessions", sessionId, "manifest"], "", {
    "x-verified-org": org
  });
  if (status !== 200) throw new Error(`manifest ${status}: ${JSON.stringify(json)}`);
  const resources = json.resources as Array<Record<string, any>>;
  const byPattern = (pattern: string): string | undefined =>
    resources.find((entry) => entry.pattern === pattern)?.ref;
  return {
    resources,
    seats: byPattern("inventory/seats/*"),
    channels: byPattern("inventory/channels/*"),
    memberships: byPattern("inventory/members/**")
  };
}

/** Every page of one collection through the route, as `org`, with optional steering. */
async function listAll(
  h: Harness,
  sessionId: string,
  ref: string | undefined,
  org: string,
  steer: { query?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; rows: Array<Record<string, unknown>>; raw: string }> {
  if (ref === undefined) return { status: -1, rows: [], raw: "the manifest lists no such collection" };
  const rows: Array<Record<string, unknown>> = [];
  let raw = "";
  let cursor: string | undefined;
  do {
    const query =
      `?limit=1${steer.query ?? ""}` + (cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`);
    const answer = await readCollection(h, sessionId, ref, query, {
      "x-verified-org": org,
      ...(steer.headers ?? {})
    });
    if (answer.status !== 200) return { status: answer.status, rows, raw: JSON.stringify(answer.json) };
    raw += JSON.stringify(answer.json);
    rows.push(...answer.json.items.map((item: any) => item.clientData as Record<string, unknown>));
    cursor = answer.json.nextCursor;
  } while (cursor !== undefined);
  return { status: 200, rows, raw };
}

describe("FIX-1502 · the inventory collections' client read", () => {
  it("V1 · each organization's session lists only its own rows, on all three collections (BR-1, BR-2, BR-4)", async () => {
    const h = await buildInventoryHarness();

    // The positive record first: both organizations' rows are in storage.
    for (const org of INV_ORGS) {
      const { channel, seats } = INVENTORY_ORGS[org];
      expect(Object.keys(await h.stored(org)).sort(), `${org}'s stored inventory keys`).toEqual(
        [
          `inventory/channels/${channel}`,
          ...seats.map((seat) => `inventory/members/${seat}/${channel}`),
          ...seats.map((seat) => `inventory/seats/${seat}`)
        ].sort()
      );
    }

    for (const org of INV_ORGS) {
      const own = INVENTORY_ORGS[org];
      const otherOrg: InvOrg = org === "org-a" ? "org-b" : "org-a";
      const other = INVENTORY_ORGS[otherOrg];
      const refs = await inventoryRefs(h, own.channel, org);
      // Every place a caller can name an organization names the OTHER one.
      const steer = {
        query: `&orgId=${otherOrg}`,
        headers: { "x-org-id": otherOrg, "x-organization": otherOrg }
      };

      // `limit=1`, so every read below crosses pages.
      const seats = await listAll(h, own.channel, refs.seats, org, steer);
      const channels = await listAll(h, own.channel, refs.channels, org, steer);
      const memberships = await listAll(h, own.channel, refs.memberships, org, steer);

      expect(seats.status, `${org} seat read — ${seats.raw}`).toBe(200);
      expect(channels.status, `${org} channel read — ${channels.raw}`).toBe(200);
      expect(memberships.status, `${org} membership read — ${memberships.raw}`).toBe(200);

      expect(seats.rows.map((r) => r.id).sort(), `${org}'s seats`).toEqual([...own.seats].sort());
      expect(channels.rows.map((r) => r.id), `${org}'s channels`).toEqual([own.channel]);
      expect(channels.rows[0]!.members, `${org}'s channel members`).toEqual([...own.seats]);
      expect(typeof channels.rows[0]!.openedAt, `${org}'s channel registration time`).toBe("string");
      expect(
        memberships.rows.map((r) => `${r.seatId}>${r.channelId}`).sort(),
        `${org}'s memberships`
      ).toEqual(own.seats.map((seat) => `${seat}>${own.channel}`).sort());

      // Over the raw payload too, so a shape change cannot turn the above into no-ops.
      for (const foreign of [other.channel, ...other.seats]) {
        for (const read of [seats, channels, memberships]) {
          expect(read.raw, `${org}'s read leaked ${foreign}`).not.toContain(foreign);
        }
      }
    }
  });

  it("V1 · a session created claiming another organization in its body is still its principal's (BR-4)", async () => {
    const h = await buildInventoryHarness();
    const refs = await inventoryRefs(h, INVENTORY_ORGS["org-a"].channel, "org-a");
    const created = await h.post(
      [CHANNEL_KIND, "sessions"],
      { userId: INV_USER, orgId: "org-b", sessionId: "s-claims-b" },
      { "x-verified-org": "org-a" }
    );
    expect(created.status, JSON.stringify(created.json)).toBeLessThan(400);
    const seats = await listAll(h, "s-claims-b", refs.seats, "org-a");
    expect(seats.status).toBe(200);
    expect(seats.rows.map((r) => r.id).sort()).toEqual([...INVENTORY_ORGS["org-a"].seats].sort());
    expect(seats.raw).not.toContain("beta.");
  });

  it("V1 control · the same patterns declared WITHOUT the read are refused 403 (BR-3)", async () => {
    // Same patterns, scope and sharing as the factories, and no `client`.
    const unread = {
      seats: defineResourceCollection({
        pattern: "inventory/seats/*",
        scope: "org",
        flowIsolation: false,
        stateSchema: z.object({ id: z.string(), kind: z.string() })
      }),
      channels: defineResourceCollection({
        pattern: "inventory/channels/*",
        scope: "org",
        flowIsolation: false,
        stateSchema: z.object({ id: z.string() })
      }),
      memberships: defineResourceCollection({
        pattern: "inventory/members/**",
        scope: "org",
        flowIsolation: false,
        stateSchema: z.object({ seatId: z.string(), channelId: z.string() })
      })
    };
    const flow = defineFlow({
      kind: "inventory-unread",
      resources: unread,
      actions: {
        noop: {
          inputSchema: z.object({}),
          block: handler({
            name: "noop",
            inputSchema: z.object({}),
            outputSchema: z.object({}),
            execute: async () => ({})
          })
        }
      },
      authentication: { resolvePrincipal: verifiedHeaderPrincipal((org) => `user-of-${org}`) }
    });
    const state = createFlowState({
      flows: { "inventory-unread": flow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: createMockModelResolver({})
    });
    const h = harnessOver(await state.getRouter());
    const created = await h.post(["inventory-unread", "sessions"], { userId: "user-of-org-a" }, {
      "x-verified-org": "org-a"
    });
    const sessionId = created.json.session?.id ?? created.json.id;
    expect(sessionId, JSON.stringify(created.json)).toBeDefined();
    for (const ref of Object.keys(unread)) {
      const answer = await readCollection(h, sessionId, ref, "", { "x-verified-org": "org-a" });
      expect(answer.status, `${ref} without a declared read`).toBe(403);
      expect(JSON.stringify(answer.json)).toMatch(/State read not permitted/);
    }
  });

  it("V1 control · a key written into a stored row does not reach the browser (BR-5)", async () => {
    const h = await buildInventoryHarness();
    const org = "org-a";
    const { channel, seats } = INVENTORY_ORGS[org];
    // A key the named fields leave out, planted straight into each stored row.
    for (const key of [
      `inventory/seats/${seats[0]}`,
      `inventory/channels/${channel}`,
      `inventory/members/${seats[0]}/${channel}`
    ]) {
      const current = await h.runtime.stores.resourceState.get("org", org, key);
      expect(current, `${key} is stored`).toBeDefined();
      await h.runtime.stores.resourceState.set(
        "org",
        org,
        key,
        { ...current.state, secret: "LEAKED-INVENTORY-KEY" },
        "any"
      );
      const planted = await h.runtime.stores.resourceState.get("org", org, key);
      expect(planted.state.secret, `${key} carries the planted key`).toBe("LEAKED-INVENTORY-KEY");
    }

    const refs = await inventoryRefs(h, channel, org);
    for (const [name, ref] of [
      ["seats", refs.seats],
      ["channels", refs.channels],
      ["memberships", refs.memberships]
    ] as const) {
      const read = await listAll(h, channel, ref, org);
      expect(read.status, `${name} read — ${read.raw}`).toBe(200);
      // The rows carrying the planted key are in the read at all.
      expect(read.rows.length, `${name} rows`).toBeGreaterThan(0);
      for (const row of read.rows) {
        expect(row, `a ${name} row must not carry "secret"`).not.toHaveProperty("secret");
      }
      expect(read.raw, `${name} payload`).not.toContain("LEAKED-INVENTORY-KEY");
    }
  });

  it("V2 · the manifest lists the three collections as readable with the inventory on, and none with it off (BR-6)", async () => {
    const patterns = ["inventory/seats/*", "inventory/channels/*", "inventory/members/**"];
    const channel = INVENTORY_ORGS["org-a"].channel;
    const on = await inventoryRefs(await buildInventoryHarness({ inventory: true, fill: false }), channel, "org-a");
    const off = await inventoryRefs(await buildInventoryHarness({ inventory: false, fill: false }), channel, "org-a");

    for (const pattern of patterns) {
      const entry = on.resources.find((e) => e.pattern === pattern);
      expect(entry, `${pattern} on a channel with the inventory on`).toBeDefined();
      expect(entry!.kind).toBe("collection");
      expect(entry!.scope).toBe("org");
      expect(entry!.client?.state?.read, `${pattern} is readable`).toBe(true);
    }
    expect(
      off.resources.filter((e) => String(e.pattern ?? "").startsWith("inventory/")),
      "inventory collections on a channel with the inventory off"
    ).toEqual([]);
  });
});

describe("FIX-1502 · V5 · a fired seat is still listed (BR-15)", () => {
  /**
   * TODAY'S behaviour, asserted as today's: `fire` deletes the roster row and
   * leaves the inventory row, so the browser read still lists the seat. When
   * FIX-1540 makes fire remove the row, this case goes red on purpose — flip
   * it then, do not relax it.
   */
  it("hire then fire through the seat-hire tools; the route still lists the fired seat", async () => {
    const registered = new Map<string, unknown>();
    const { hire, fire } = createSeatHireBlocks({
      register: (seat) => {
        registered.set(seat.id, seat);
      },
      unregister: (id) => registered.delete(id)
    });
    const flow = defineFlow({
      kind: "seat-hirer",
      resources: {
        [HIRED_ROSTER_RESOURCE]: defineHiredRosterCollection(),
        [SEAT_INVENTORY_RESOURCE]: defineSeatInventoryCollection()
      },
      actions: {
        hire: { inputSchema: z.object({ seatId: z.string(), flow: z.string() }), block: hire },
        fire: { inputSchema: z.object({ seatId: z.string() }), block: fire }
      },
      authentication: { resolvePrincipal: verifiedHeaderPrincipal((org) => `user-of-${org}`) }
    } as never);
    const state = createFlowState({
      flows: { "seat-hirer": flow as never },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: createMockModelResolver({})
    });
    const runtime = await state.getRuntime();
    const h = harnessOver(await state.getRouter());
    const org = { "x-verified-org": "org-a" };
    const created = await h.post(["seat-hirer", "sessions"], { userId: "user-of-org-a" }, org);
    const sessionId = created.json.session?.id ?? created.json.id;

    const act = async (action: string, input: unknown): Promise<void> => {
      const posted = await h.post(
        ["seat-hirer", sessionId, "actions", action],
        { userId: "user-of-org-a", input },
        org
      );
      expect(posted.status, JSON.stringify(posted.json)).toBe(202);
      const requestId = posted.json.request.id;
      for (let i = 0; i < 300; i++) {
        const polled = await h.get(["seat-hirer", "requests", requestId, "status"], "", org);
        const seen = polled.json?.status;
        if (seen === "completed") return;
        if (seen === "errored" || seen === "failed" || seen === "cancelled") {
          throw new Error(`${action} ${seen}: ${JSON.stringify(polled.json)}`);
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`${action} never reached a terminal status`);
    };

    // A hired seat's address is `<orgId>.<seatId>`.
    const address = "org-a.eng.ada";
    await act("hire", { seatId: "eng.ada", flow: "agent" });
    expect([...registered.keys()], "the hire registered the seat").toEqual([address]);
    expect(
      Object.keys(await runtime.stores.resourceState.getByPrefix("org", "org-a", "workforce/roster/")),
      "roster rows after the hire"
    ).toEqual(["workforce/roster/eng.ada"]);
    await act("fire", { seatId: "eng.ada" });
    // The fire happened: the address is released and the roster row is gone.
    expect(registered.has(address), "the fire released the seat").toBe(false);
    expect(
      Object.keys(await runtime.stores.resourceState.getByPrefix("org", "org-a", "workforce/roster/")),
      "roster rows after the fire"
    ).toEqual([]);

    const listed = await readCollection(h, sessionId, SEAT_INVENTORY_RESOURCE, "", org);
    expect(listed.status).toBe(200);
    expect(listed.json.items.map((item: any) => item.clientData)).toEqual([
      { id: address, kind: "agent" }
    ]);
  });
});
