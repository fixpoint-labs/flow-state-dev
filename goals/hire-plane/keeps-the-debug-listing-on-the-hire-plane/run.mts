/**
 * Goal check — with debug endpoints switched on, the debug resource listing
 * shows a session only the hire rows its user may see, on the HTTP router,
 * with no model.
 *
 * See goal.md for the contract, including the source-revert control.
 *
 * Run: pnpm tsx goals/hire-plane/keeps-the-debug-listing-on-the-hire-plane/run.mts
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import type { JsonObject, ResourceCollectionRef } from "@flow-state-dev/core/types";
import {
  defineHiredRosterCollection,
  defineHiredRosterPrivateCollection,
  hiredRosterStorageKey,
  toHiredSeatRow,
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
  orgSeatId: string;
  secret: string;
  orgSecret: string;
};

type Who = { user: string; org: string };

const fixture = loadFixture<Fixture>(import.meta.url);

const resources = {
  roster: defineHiredRosterCollection(),
  privateRoster: defineHiredRosterPrivateCollection(),
};

const verified = {
  resolvePrincipal: (context: { request?: Request }) => {
    const userId = context.request?.headers.get("x-verified-user");
    const orgId = context.request?.headers.get("x-verified-org");
    return userId && orgId ? { userId, orgId } : null;
  },
};

// Writes the session user's private hire row through the branded writer, and
// one org-visible row through the org roster, the way a hire does.
const hire = handler({
  name: "hire",
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean() }),
  resources,
  execute: async (_input, ctx) => {
    const { userId = "", orgId = "" } = ctx.session.identity;
    const own = toHiredSeatRow({
      seatId: fixture.seatId,
      flow: "seat",
      instructions: fixture.secret,
      owningOrgId: orgId,
      ownerUserId: userId,
    });
    // The writer's pattern is `[owner]/[seat]`; the owner segment is the
    // `~<escaped user>` half of the row's storage key.
    const [ownerSegment, seat] = hiredRosterStorageKey(own).split("/");
    await (ctx.resources.privateRoster as unknown as ResourceCollectionRef).create(
      { owner: ownerSegment!, seat: seat! },
      own as unknown as JsonObject,
    );
    const shared = toHiredSeatRow({
      seatId: fixture.orgSeatId,
      flow: "seat",
      instructions: fixture.orgSecret,
      owningOrgId: orgId,
    });
    await (ctx.resources.roster as unknown as ResourceCollectionRef).create(
      hiredRosterStorageKey(shared),
      shared as unknown as JsonObject,
    );
    return { ok: true };
  },
});

const appFlow = defineFlow({
  kind: "app",
  resources,
  actions: { hire: { inputSchema: z.object({}), block: hire } },
  authentication: verified,
});

const owner: Who = { user: fixture.ownerUser, org: fixture.ownerOrg };
const peer: Who = { user: fixture.peerUser, org: fixture.ownerOrg };
const foreign: Who = { user: fixture.foreignUser, org: fixture.otherOrg };

await runGoal(async () => {
  const failures: string[] = [];
  const fail = (leg: string, line: string) => failures.push(`[${leg}] ${line}`);
  const state = createFlowState({
    flows: { app: appFlow() },
    resolvePrincipal: verified.resolvePrincipal,
    stores: { default: { primary: inMemoryStores() } },
    // What `fsdev dev` does. The property under test only exists with it on.
    debugEndpointsEnabled: true,
  });
  const router = (await state.getRouter()) as {
    GET: (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>;
    POST: (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>;
  };

  const call = async (method: "GET" | "POST", path: string[], who: Who, body?: unknown) => {
    const response = await router[method](
      new Request(`http://goal/api/flows/${path.join("/")}`, {
        method,
        headers: {
          "content-type": "application/json",
          "x-verified-user": who.user,
          "x-verified-org": who.org,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { params: { path } },
    );
    const text = await response.text();
    return { status: response.status, text, json: text.length > 0 ? JSON.parse(text) : undefined };
  };

  const open = async (who: Who): Promise<string | undefined> => {
    const opened = await call("POST", ["app", "sessions"], who, { userId: who.user });
    return opened.status === 201 ? (opened.json.session.id as string) : undefined;
  };

  const runHire = async (who: Who, sessionId: string): Promise<string> => {
    const posted = await call("POST", ["app", sessionId, "actions", "hire"], who, {
      userId: who.user,
      input: {},
    });
    if (posted.status >= 400) return `http ${posted.status}`;
    const requestId = posted.json.request?.id as string;
    for (let i = 0; i < 100; i++) {
      const status = (await call("GET", ["app", "requests", requestId, "status"], who)).json
        ?.status as string | undefined;
      if (status && !["pending", "in_progress", "running", "queued"].includes(status)) return status;
      await new Promise((r) => setTimeout(r, 5));
    }
    return "timed-out";
  };

  // Every debug read a session can make of the two rosters.
  const debugReads = async (who: Who, sessionId: string) => {
    const base = ["sessions", sessionId, "debug", "resources"];
    const tree = await call("GET", base, who);
    const privateItems = await call("GET", [...base, "privateRoster", "items"], who);
    const orgItems = await call("GET", [...base, "roster", "items"], who);
    const entries = (tree.json?.resources ?? []) as { primaryName: string; itemCount?: number }[];
    const topics = (r: { json?: { items?: { topic: string }[] } }) =>
      (r.json?.items ?? []).map((item) => item.topic);
    return {
      statuses: [tree.status, privateItems.status, orgItems.status],
      body: tree.text + privateItems.text + orgItems.text,
      privateCount: entries.find((e) => e.primaryName === "privateRoster")?.itemCount,
      privateTopics: topics(privateItems),
      orgTopics: topics(orgItems),
    };
  };

  const ownerSession = await open(owner);
  const peerSession = await open(peer);
  const foreignSession = await open(foreign);
  if (ownerSession === undefined || peerSession === undefined || foreignSession === undefined) {
    fail("setup", "a session did not open");
    return { failures, evidence: "" };
  }

  // (a) The owner hires and her own session's debug listing shows the row.
  const hired = await runHire(owner, ownerSession);
  if (hired !== "completed") fail("a", `owner hire did not complete: ${hired}`);
  const mine = await debugReads(owner, ownerSession);
  if (mine.statuses.some((s) => s !== 200)) fail("a", `owner debug statuses ${mine.statuses}`);
  if (!mine.body.includes(fixture.secret)) fail("a", "owner debug listing did not show her row");
  if (mine.privateCount !== 1) fail("a", `owner private itemCount was ${mine.privateCount}`);

  // (b) A teammate's session in the same org: the org row, never the private one.
  const theirs = await debugReads(peer, peerSession);
  if (theirs.statuses.some((s) => s !== 200)) fail("b", `teammate debug statuses ${theirs.statuses}`);
  if (theirs.body.includes(fixture.secret)) fail("b", "teammate debug listing contained the owner's marker");
  if (theirs.privateTopics.length !== 0) fail("b", `teammate private topics ${JSON.stringify(theirs.privateTopics)}`);
  if (theirs.privateCount !== 0) fail("b", `teammate private itemCount was ${theirs.privateCount}`);
  if (JSON.stringify(theirs.orgTopics) !== JSON.stringify([fixture.orgSeatId])) {
    fail("b", `teammate org roster topics ${JSON.stringify(theirs.orgTopics)}`);
  }
  if (!theirs.body.includes(fixture.orgSecret)) fail("b", "teammate lost the org-visible row");

  // (c) Another org's session sees neither row.
  const outside = await debugReads(foreign, foreignSession);
  if (outside.statuses.some((s) => s !== 200)) fail("c", `other org debug statuses ${outside.statuses}`);
  if (outside.body.includes(fixture.secret)) fail("c", "other org saw the owner's marker");
  if (outside.body.includes(fixture.orgSecret)) fail("c", "other org saw the org roster marker");

  const evidence =
    failures.length > 0
      ? ""
      : `${fixture.ownerUser} hired ${fixture.seatId}; her debug listing showed ${fixture.secret} (count 1). ` +
        `${fixture.peerUser}'s debug listing showed ${fixture.orgSeatId} only (private count 0, marker absent). ` +
        `${fixture.otherOrg}'s debug listing showed neither marker.`;
  return { failures, evidence };
});
