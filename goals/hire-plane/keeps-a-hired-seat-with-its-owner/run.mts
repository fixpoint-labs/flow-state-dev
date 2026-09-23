/**
 * Goal check — a hired seat stays with the organization and the user that
 * hired it, on the HTTP router, with no model.
 *
 * See goal.md for the contract, including the two source-revert controls.
 *
 * Run: pnpm tsx goals/hire-plane/keeps-a-hired-seat-with-its-owner/run.mts
 */
import { defineFlow, defineResourceCollection, handler, type FlowInstance } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import {
  defineHiredRosterCollection,
  encodeUserSegment,
  reloadHiredSeats,
  seatAddress,
} from "@flow-state-dev/workforce";
import { z } from "zod";
import { loadFixture, runGoal } from "../../lib/index.mts";

type Fixture = {
  ownerOrg: string;
  otherOrg: string;
  ownerUser: string;
  peerUser: string;
  foreignUser: string;
  seatId: string;
  legacySeatId: string;
  secret: string;
  widePattern: string;
};

type Who = { user: string; org: string };

const fixture = loadFixture<Fixture>(import.meta.url);
const tagInput = z.object({ tag: z.string() });

const resources = {
  seen: defineResourceCollection({
    pattern: "seen/*",
    scope: "org",
    stateSchema: z.object({
      instance: z.string(),
      as: z.string(),
      instructions: z.string().nullable(),
    }),
    client: { state: { read: true } },
  }),
  roster: defineHiredRosterCollection(),
};

const verified = {
  resolvePrincipal: (context: { request?: Request }) => {
    const userId = context.request?.headers.get("x-verified-user");
    const orgId = context.request?.headers.get("x-verified-org");
    return userId && orgId ? { userId, orgId } : null;
  },
};

const whoami = handler({
  name: "whoami",
  inputSchema: tagInput,
  outputSchema: z.object({ ok: z.boolean() }),
  resources,
  execute: async (input, ctx) => {
    const seen = ctx.resources.seen as unknown as ResourceCollectionRef;
    const config = ctx.flow.config as { instructions?: string };
    const instance = (ctx.flow as unknown as { id: string }).id;
    const { userId = "", orgId = "" } = ctx.session.identity;
    await seen.create(input.tag, {
      instance,
      as: `${userId}@${orgId}`,
      instructions: config.instructions ?? null,
    });
    return { ok: true };
  },
});

const peekBrowser = handler({
  name: "peek-browser",
  inputSchema: tagInput,
  outputSchema: z.object({ ok: z.boolean() }),
  resources,
  execute: async (input, ctx) => {
    const ref = ctx.resources.roster as unknown as ResourceCollectionRef;
    const key = `~${encodeUserSegment(fixture.ownerUser)}/${fixture.seatId}`;
    let got: string;
    try {
      const row = await ref.getOptional(key);
      got = row === undefined ? "undefined" : JSON.stringify(row.state);
    } catch (error) {
      got = `threw: ${(error as Error).message}`;
    }
    const seen = ctx.resources.seen as unknown as ResourceCollectionRef;
    const { userId = "", orgId = "" } = ctx.session.identity;
    await seen.create(input.tag, {
      instance: "peek-browser",
      as: `${userId}@${orgId}`,
      instructions: got,
    });
    return { ok: true };
  },
});

const seatKind = defineFlow({
  kind: "seat",
  cardinality: "collection",
  configSchema: z.object({ instructions: z.string().nullable().default(null) }),
  resources,
  actions: { whoami: { inputSchema: tagInput, block: whoami } },
  authentication: verified,
});

const appFlow = defineFlow({
  kind: "app",
  resources,
  actions: {
    whoami: { inputSchema: tagInput, block: whoami },
    peekBrowser: { inputSchema: tagInput, block: peekBrowser },
  },
  authentication: verified,
});

const owner: Who = { user: fixture.ownerUser, org: fixture.ownerOrg };
const peer: Who = { user: fixture.peerUser, org: fixture.ownerOrg };
const foreign: Who = { user: fixture.foreignUser, org: fixture.otherOrg };
const ownedAddress = seatAddress(fixture.ownerOrg, fixture.seatId, fixture.ownerUser);
const legacyAddress = seatAddress(fixture.ownerOrg, fixture.legacySeatId);
const claimedAddress = seatAddress(fixture.ownerOrg, "claimed");

await runGoal(async () => {
  const failures: string[] = [];
  const fail = (leg: string, line: string) => failures.push(`[${leg}] ${line}`);
  const stores = inMemoryStores();
  const state = createFlowState({
    flows: { app: appFlow() },
    resolvePrincipal: verified.resolvePrincipal,
    stores: { default: { primary: stores } },
  });
  const router = (await state.getRouter()) as {
    GET: (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>;
    POST: (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>;
  };
  const runtime = await state.getRuntime();

  const call = async (method: "GET" | "POST", path: string[], who?: Who, body?: unknown) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (who !== undefined) {
      headers["x-verified-user"] = who.user;
      headers["x-verified-org"] = who.org;
    }
    const response = await router[method](
      new Request(`http://goal/api/flows/${path.join("/")}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { params: { path } },
    );
    const text = await response.text();
    return { status: response.status, json: text.length > 0 ? JSON.parse(text) : undefined };
  };

  const seenInstructions = async (org: string, tag: string): Promise<string | undefined> => {
    const row = (await runtime.stores.resourceState.get("org", org, `seen/${tag}`)) as
      | { state?: { instructions?: string } }
      | undefined;
    return row?.state?.instructions ?? undefined;
  };

  const open = async (who: Who, address: string) =>
    call("POST", [address, "sessions"], who, { userId: who.user });

  const run = async (who: Who, sessionId: string, action: string, tag: string, address = "app") => {
    const posted = await call("POST", [address, sessionId, "actions", action], who, {
      userId: who.user,
      input: { tag },
    });
    if (posted.status >= 400) return { http: posted.status, error: posted.json?.error as string | undefined };
    const requestId = posted.json.request?.id as string;
    for (let i = 0; i < 100; i++) {
      const status = (await call("GET", [address, "requests", requestId, "status"], who)).json
        ?.status as string | undefined;
      if (status && !["pending", "in_progress", "running", "queued"].includes(status)) {
        return { http: posted.status, outcome: status };
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    return { http: posted.status, outcome: "timed-out" };
  };

  const catalogIds = async (who?: Who): Promise<string[]> => {
    const listed = await call("GET", [], who);
    const flows = (listed.json?.flows ?? []) as { id: string }[];
    return flows.map((flow) => flow.id);
  };

  state.register(
    seatKind({ id: ownedAddress, config: { instructions: fixture.secret } }) as unknown as FlowInstance,
    { pin: { orgId: fixture.ownerOrg, userId: fixture.ownerUser } },
  );

  const ownerSession = await open(owner, ownedAddress);
  if (ownerSession.status !== 201) {
    fail("a", `owner open returned ${ownerSession.status} ${JSON.stringify(ownerSession.json)}`);
  } else {
    const ran = await run(owner, ownerSession.json.session.id as string, "whoami", "owner", ownedAddress);
    if (ran.outcome !== "completed") fail("a", `owner run did not complete: ${JSON.stringify(ran)}`);
    const wrote = await seenInstructions(fixture.ownerOrg, "owner");
    if (wrote !== fixture.secret) fail("a", `owner seen instructions were ${JSON.stringify(wrote)}`);
  }

  const peerOpen = await open(peer, ownedAddress);
  if (peerOpen.status !== 404) fail("b", `teammate open returned ${peerOpen.status}`);
  if ((await seenInstructions(fixture.ownerOrg, "peer")) !== undefined) {
    fail("b", "teammate open wrote a seen row");
  }

  const foreignOpen = await open(foreign, ownedAddress);
  if (foreignOpen.status !== 404) fail("c", `other org open returned ${foreignOpen.status}`);
  const ownerCatalog = await catalogIds(owner);
  const foreignCatalog = await catalogIds(foreign);
  const anonymousCatalog = await catalogIds();
  if (!ownerCatalog.includes(ownedAddress)) fail("c", "owner catalog omitted the seat");
  if (foreignCatalog.includes(ownedAddress)) fail("c", "other org catalog listed the seat");
  if (anonymousCatalog.includes(ownedAddress)) fail("c", "anonymous catalog listed the seat");
  if (!foreignCatalog.includes("app")) fail("c", "other org catalog omitted the shared app flow");
  const foreignApp = await open(foreign, "app");
  if (foreignApp.status !== 201) fail("c", `shared app open for the other org returned ${foreignApp.status}`);
  else {
    const ran = await run(foreign, foreignApp.json.session.id as string, "whoami", "shared");
    if (ran.outcome !== "completed") fail("c", `shared app did not run: ${JSON.stringify(ran)}`);
  }

  const resumeSession = ownerSession.json?.session?.id as string | undefined;
  state.unregister(ownedAddress);
  state.register(
    seatKind({ id: ownedAddress, config: { instructions: fixture.secret } }) as unknown as FlowInstance,
    { pin: { orgId: fixture.otherOrg, userId: fixture.foreignUser } },
  );
  if (resumeSession !== undefined) {
    const resumed = await run(owner, resumeSession, "whoami", "resumed", ownedAddress);
    if (resumed.http !== 404) fail("d", `resume after re-pin returned ${JSON.stringify(resumed)}`);
    if ((await seenInstructions(fixture.ownerOrg, "resumed")) !== undefined) {
      fail("d", "resume wrote the marker");
    }
  }

  const primary = await stores.resolve(["primary"]);
  await primary.resourceState!.set(
    "org",
    fixture.ownerOrg,
    `workforce/roster/~${encodeUserSegment(fixture.ownerUser)}/${fixture.seatId}`,
    {
      seatId: fixture.seatId,
      flow: "seat",
      settings: {},
      instructions: fixture.secret,
      owningOrgId: fixture.ownerOrg,
      ownerUserId: fixture.ownerUser,
    },
    "any",
  );
  const peerApp = await open(peer, "app");
  if (peerApp.status !== 201) fail("e", `teammate app open returned ${peerApp.status}`);
  else {
    const ran = await run(peer, peerApp.json.session.id as string, "peekBrowser", "browser");
    if (ran.outcome !== "completed") fail("e", `browser read did not complete: ${JSON.stringify(ran)}`);
    const got = await seenInstructions(fixture.ownerOrg, "browser");
    if (got !== "undefined") fail("e", `browser read returned ${JSON.stringify(got)}`);
    if (got?.includes(fixture.secret)) fail("e", "browser read contained the marker");
  }

  let wideRefused = "";
  try {
    const wide = defineFlow({
      kind: "wide",
      resources: {
        ...resources,
        wide: defineResourceCollection({
          pattern: fixture.widePattern,
          scope: "org",
          stateSchema: z.object({}).passthrough(),
        }),
      },
      actions: {
        whoami: { inputSchema: tagInput, block: whoami },
      },
      authentication: verified,
    })();
    state.register(wide);
    wideRefused = "";
  } catch (error) {
    wideRefused = (error as Error).message;
  }
  if (wideRefused.length === 0) {
    fail("f", `pattern ${fixture.widePattern} was admitted`);
  } else if (!wideRefused.includes(fixture.widePattern)) {
    fail("f", `refusal did not name the pattern: ${wideRefused}`);
  }
  if ((await seenInstructions(fixture.ownerOrg, "wide"))?.includes(fixture.secret)) {
    fail("f", "admitted pattern wrote the marker");
  }

  state.unregister(ownedAddress);
  await primary.resourceState!.set(
    "org",
    fixture.ownerOrg,
    `workforce/roster/${fixture.legacySeatId}`,
    {
      seatId: fixture.legacySeatId,
      flow: "seat",
      settings: {},
      instructions: fixture.secret,
      owningOrgId: fixture.otherOrg,
      ownerUserId: null,
    },
    "any",
  );
  const reloaded = await reloadHiredSeats({
    stores: runtime.stores,
    orgIds: [fixture.ownerOrg],
    kinds: { seat: seatKind },
  });
  const claimed = reloaded.seats.find((seat) => seat.id === claimedAddress || seat.id === legacyAddress);
  if (claimed !== undefined) fail("g", `reload minted ${claimed.id}`);
  if (reloaded.problems.length === 0) fail("g", "reload reported no problem for the foreign owning org");
  const claimedOpen = await open(foreign, legacyAddress);
  if (claimedOpen.status !== 404) fail("g", `foreign-owned row opened as ${claimedOpen.status}`);

  const evidence =
    failures.length > 0
      ? ""
      : `owner wrote ${fixture.secret} at ${ownedAddress}; teammate and ${fixture.otherOrg} got 404; ` +
        `catalog listed the seat for the owner only; resume after re-pin was 404; ` +
        `browser read was undefined; ${fixture.widePattern} was refused; ` +
        `a row owned by ${fixture.otherOrg} was a reload problem and did not open. ` +
        `Shared app still ran for ${fixture.otherOrg}.`;
  return { failures, evidence };
});
