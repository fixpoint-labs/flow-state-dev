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
import { defineFlow, handler } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { z } from "zod";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { defineHiredRosterCollection } from "../src/roster/collections";
import { channelBoard, CHANNEL_BOARD_CLIENT_FIELDS } from "../src/channel/channel-board";
import { channelBoardRowSchema } from "../src/channel/channel-flow";

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
